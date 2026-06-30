// Admin API (password-gated in app.js) + static admin SPA.
// Model: a Machine is a physical box (pool, stable kiosk token); a Station is a
// Machine bound into one project (project.stations) with its own surface /
// playback / MIDI + nickname. The machine's runtime "active" (project/station/
// scene) decides what its kiosk shows.
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const QRCode = require('qrcode');
const store = require('../lib/store');
const ids = require('../lib/ids');
const model = require('../lib/model');
const thumbs = require('../lib/thumbs');
const defaults = require('../lib/defaults');
const playlistLib = require('../lib/playlist');
const { listMedia, orderMedia, safeSegment } = require('../lib/media');

module.exports = function (ctx) {
    const { UPLOAD_PATH, UPLOAD_SIZE, io } = ctx;
    const api = express.Router();

    // ---- machine / station factories --------------------------------------
    function newMachine(id, name) {
        return {
            id, name, token: ids.token(), type: '', description: '', createdAt: Date.now(),
            activeProjectId: null, activeStationId: null, activeSceneId: null,
            selectedName: null, playMode: 'diaporama'
        };
    }
    function newStation(machineId, nickname) {
        return {
            id: ids.id(), machineId, nickname,
            surface: defaults.defaultSurface(), playback: defaults.defaultPlayback(),
            midi: { map: {} }, createdAt: Date.now()
        };
    }

    function clearMachine(m) { m.activeProjectId = null; m.activeStationId = null; m.activeSceneId = null; m.selectedName = null; }
    function broadcastSettings(m) { io.to('player:' + m.token).emit('settings', playlistLib.settingsFor(m)); }
    function broadcastActive(m) {
        io.to('player:' + m.token).emit('active-change', {
            active: playlistLib.activeInfo(m),
            media: playlistLib.playlist(UPLOAD_PATH, m)
        });
    }
    function refreshSceneMachines(sceneId) { for (const m of model.machinesForScene(sceneId)) broadcastActive(m); }

    // ---- scene helpers (unchanged model) -----------------------------------
    function sceneCount(p, s) {
        try { return listMedia(model.sourceDir(UPLOAD_PATH, p, s)).length; } catch (e) { return 0; }
    }
    function defaultAccept() { return { image: true, video: true, text: false, stream: false }; }
    function cleanAccept(a) { return { image: !!a.image, video: !!a.video, text: !!a.text, stream: !!a.stream }; }

    function makeScene(p, name, accept) {
        const folder = ids.uniqueSlug(ids.slugify(name), Object.values(p.sources || {}).map(s => s.folder).filter(Boolean));
        const sid = ids.id();
        const scene = {
            id: sid, name, folder,
            dropToken: ids.token(), allowSelfDelete: true, order: [],
            accept: accept ? cleanAccept(accept) : defaultAccept(),
            streamMode: 'replace', createdAt: Date.now()
        };
        p.sources = p.sources || {};
        p.sources[sid] = scene;
        p.sceneOrder = p.sceneOrder || [];
        p.sceneOrder.push(sid);
        try { fs.mkdirSync(path.join(UPLOAD_PATH, p.slug, folder), { recursive: true }); } catch (e) {}
        return scene;
    }

    function serializeScene(p, s) {
        return {
            id: s.id, name: s.name, folder: s.folder,
            dropToken: s.dropToken,
            allowSelfDelete: !!s.allowSelfDelete,
            accept: s.accept ? cleanAccept(s.accept) : defaultAccept(),
            streamMode: s.streamMode === 'grid' ? 'grid' : 'replace',
            count: sceneCount(p, s)
        };
    }

    function orderedScenes(p) {
        const all = p.sources || {};
        const order = Array.isArray(p.sceneOrder) ? p.sceneOrder : [];
        const seen = new Set();
        const out = [];
        for (const sid of order) { if (all[sid]) { out.push(all[sid]); seen.add(sid); } }
        for (const s of Object.values(all)) { if (!seen.has(s.id)) out.push(s); }
        return out;
    }

    // ---- machine / station serialisers ------------------------------------
    function serializeMachine(m) {
        const stations = model.machineStations(m.id);
        return {
            id: m.id, name: m.name, token: m.token,
            type: m.type || '', description: m.description || '',
            playMode: m.playMode || 'diaporama',
            activeProjectId: m.activeProjectId || null,
            activeStationId: m.activeStationId || null,
            activeSceneId: m.activeSceneId || null,
            usedIn: stations.length,
            showing: (m.activeProjectId && store.data.projects[m.activeProjectId]) ? store.data.projects[m.activeProjectId].name : null
        };
    }

    function serializeStation(project, st) {
        const m = model.stationMachine(st);
        const driving = model.stationDriving(project.id, st);
        let busyElsewhere = null;
        if (m && !driving && m.activeStationId && m.activeProjectId && m.activeProjectId !== project.id) {
            const op = store.data.projects[m.activeProjectId];
            busyElsewhere = op ? op.name : 'another project';
        }
        return {
            id: st.id, machineId: st.machineId, nickname: st.nickname,
            surface: defaults.cleanSurface(st.surface),
            playback: defaults.cleanPlayback(st.playback),
            midi: { map: (st.midi && st.midi.map) || {} },
            machine: m ? { id: m.id, name: m.name, type: m.type || '', token: m.token } : null,
            driving,
            playMode: driving ? (m.playMode || 'diaporama') : null,
            activeSceneId: driving ? (m.activeSceneId || null) : null,
            selectedName: driving ? (m.selectedName || null) : null,
            busyElsewhere
        };
    }

    function serializeProject(p) {
        const scenes = orderedScenes(p).map(s => serializeScene(p, s));
        return {
            id: p.id, name: p.name, slug: p.slug, createdAt: p.createdAt,
            sources: scenes,
            sceneCount: scenes.length,
            mediaCount: scenes.reduce((n, s) => n + s.count, 0),
            console: { map: (p.console && p.console.map) ? p.console.map : {} },
            stations: model.stationsForProject(p.id).map(st => serializeStation(p, st))
        };
    }

    // ---- file helpers (unchanged) -----------------------------------------
    function removeFromManifest(sourceId, filename) {
        const manifest = store.data.uploads[sourceId];
        if (!manifest) return;
        for (const [fid, u] of Object.entries(manifest)) if (u.filename === filename) delete manifest[fid];
    }

    function bulkFiles(req, res, op) {
        const p = store.data.projects[req.body.projectId];
        if (!p) return res.status(404).json({ error: 'project not found' });
        const s = (p.sources || {})[req.body.sourceId];
        if (!s) return res.status(404).json({ error: 'source not found' });
        const dir = model.sourceDir(UPLOAD_PATH, p, s);
        const names = Array.isArray(req.body.names) ? req.body.names : [];
        const archiveDir = path.join(dir, '_archive');
        if (op === 'archive') { try { fs.mkdirSync(archiveDir, { recursive: true }); } catch (e) {} }

        let count = 0;
        for (const raw of names) {
            const name = safeSegment(raw);
            if (!name) continue;
            const src = path.join(dir, name);
            if (!fs.existsSync(src)) continue;
            try {
                if (op === 'archive') fs.renameSync(src, path.join(archiveDir, name));
                else fs.unlinkSync(src);
                count++;
                removeFromManifest(s.id, name);
            } catch (e) { /* skip */ }
        }
        if (Array.isArray(s.order) && s.order.length) {
            const present = new Set(listMedia(dir).map(m => m.name));
            s.order = s.order.filter(n => present.has(n));
        }
        store.save();
        refreshSceneMachines(s.id);
        res.json({ ok: true, count });
    }

    function resolveSource(req, res, next) {
        const p = store.data.projects[req.params.id];
        if (!p) return res.status(404).json({ error: 'project not found' });
        const s = (p.sources || {})[req.params.sid];
        if (!s) return res.status(404).json({ error: 'source not found' });
        req._project = p; req._source = s;
        req._dir = model.sourceDir(UPLOAD_PATH, p, s);
        try { fs.mkdirSync(req._dir, { recursive: true }); } catch (e) {}
        next();
    }

    const uploadStorage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, req._dir),
        filename: (req, file, cb) => {
            let ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
            if (ext.length > 8) ext = ext.slice(0, 8);
            const base = (safeSegment(path.basename(file.originalname, path.extname(file.originalname))) || 'media').slice(0, 40);
            cb(null, `${base}-${ids.id().slice(0, 5)}${ext}`);
        }
    });
    const upload = multer({ storage: uploadStorage, limits: { fileSize: UPLOAD_SIZE * 1024 * 1024 } });

    // ---- config + QR -------------------------------------------------------
    api.get('/config', (req, res) => res.json({ publicUrl: process.env.PUBLIC_URL || '' }));

    api.get('/qr', async (req, res) => {
        const data = String(req.query.data || '');
        if (!data) return res.status(400).send('missing data');
        try {
            if (String(req.query.type) === 'svg') res.type('svg').send(await QRCode.toString(data, { type: 'svg', margin: 1 }));
            else res.type('png').send(await QRCode.toBuffer(data, { margin: 1, width: 600 }));
        } catch (e) { res.status(500).send('qr error'); }
    });

    // ---- device types (editable global list) ------------------------------
    api.get('/device-types', (req, res) => res.json({ deviceTypes: store.data.deviceTypes || [] }));
    api.put('/device-types', (req, res) => {
        const list = Array.isArray(req.body.deviceTypes) ? req.body.deviceTypes : [];
        const seen = new Set();
        store.data.deviceTypes = list
            .map(t => String(t || '').trim()).filter(Boolean)
            .filter(t => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
            .slice(0, 50);
        store.save();
        res.json({ deviceTypes: store.data.deviceTypes });
    });

    // ---- projects ----------------------------------------------------------
    api.get('/projects', (req, res) => {
        res.json({ projects: Object.values(store.data.projects).map(serializeProject) });
    });

    api.post('/projects', (req, res) => {
        const name = String(req.body.name || '').trim();
        if (!name) return res.status(400).json({ error: 'name required' });
        const slug = ids.uniqueSlug(ids.slugify(name), Object.values(store.data.projects).map(p => p.slug));
        const id = ids.id();
        const project = { id, name, slug, createdAt: Date.now(), sources: {}, sceneOrder: [], console: { map: {} }, stations: {}, stationOrder: [] };
        store.data.projects[id] = project;
        try { fs.mkdirSync(path.join(UPLOAD_PATH, slug), { recursive: true }); } catch (e) {}
        makeScene(project, 'Drop');
        store.save();
        res.json({ project: serializeProject(project) });
    });

    api.put('/projects/:id', (req, res) => {
        const p = store.data.projects[req.params.id];
        if (!p) return res.status(404).json({ error: 'not found' });
        if (req.body.name) p.name = String(req.body.name).trim();
        store.save();
        res.json({ project: serializeProject(p) });
    });

    api.delete('/projects/:id', (req, res) => {
        const p = store.data.projects[req.params.id];
        if (!p) return res.status(404).json({ error: 'not found' });
        for (const m of Object.values(store.data.machines)) {
            if (m.activeProjectId === p.id) { clearMachine(m); broadcastSettings(m); broadcastActive(m); }
        }
        delete store.data.projects[req.params.id]; // its stations go with it
        store.save();
        res.json({ ok: true }); // media left on disk on purpose
    });

    // ---- scenes (sources) --------------------------------------------------
    api.post('/projects/:id/sources', (req, res) => {
        const p = store.data.projects[req.params.id];
        if (!p) return res.status(404).json({ error: 'not found' });
        const name = String(req.body.name || 'Scene').trim() || 'Scene';
        makeScene(p, name, req.body.accept);
        store.save();
        res.json({ project: serializeProject(p) });
    });

    api.put('/projects/:id/scene-order', (req, res) => {
        const p = store.data.projects[req.params.id];
        if (!p) return res.status(404).json({ error: 'not found' });
        const valid = new Set(Object.keys(p.sources || {}));
        const order = (Array.isArray(req.body.order) ? req.body.order : []).filter(id => valid.has(id));
        for (const id of valid) if (!order.includes(id)) order.push(id);
        p.sceneOrder = order;
        store.save();
        res.json({ project: serializeProject(p) });
    });

    api.put('/projects/:id/sources/:sid', resolveSource, (req, res) => {
        const s = req._source;
        if (req.body.name) s.name = String(req.body.name).trim();
        if (typeof req.body.allowSelfDelete === 'boolean') s.allowSelfDelete = req.body.allowSelfDelete;
        if (req.body.accept && typeof req.body.accept === 'object') s.accept = cleanAccept(req.body.accept);
        if (req.body.streamMode === 'replace' || req.body.streamMode === 'grid') s.streamMode = req.body.streamMode;
        store.save();
        refreshSceneMachines(s.id); // push new accept/streamMode to players already showing this scene
        res.json({ project: serializeProject(req._project) });
    });

    api.delete('/projects/:id/sources/:sid', (req, res) => {
        const p = store.data.projects[req.params.id];
        if (!p || !(p.sources || {})[req.params.sid]) return res.status(404).json({ error: 'not found' });
        const sid = req.params.sid;
        for (const m of model.machinesForScene(sid)) { clearMachine(m); broadcastSettings(m); broadcastActive(m); }
        delete p.sources[sid];
        delete store.data.uploads[sid];
        p.sceneOrder = (p.sceneOrder || []).filter(x => x !== sid);
        store.save();
        res.json({ project: serializeProject(p) });
    });

    // ---- scene media: list / upload / reorder ------------------------------
    api.get('/projects/:id/sources/:sid/files', resolveSource, (req, res) => {
        const files = orderMedia(listMedia(req._dir), req._source.order).map(m => ({
            name: m.name, type: m.type, size: m.size, mtime: m.mtime,
            url: model.mediaUrl(req._project, req._source, m.name) + '?v=' + model.mediaVersion(m),
            thumb: `/admin/api/thumb?project=${req._project.id}&source=${req._source.id}&name=${encodeURIComponent(m.name)}&v=${model.mediaVersion(m)}`
        }));
        res.json({ files });
    });

    api.post('/projects/:id/sources/:sid/upload', resolveSource, upload.array('files', 50), (req, res) => {
        const added = (req.files || []).map(f => f.filename);
        refreshSceneMachines(req._source.id);
        res.json({ ok: true, added, count: added.length });
    });

    api.put('/projects/:id/sources/:sid/order', resolveSource, (req, res) => {
        const present = new Set(listMedia(req._dir).map(m => m.name));
        const order = (Array.isArray(req.body.order) ? req.body.order : [])
            .map(n => safeSegment(n)).filter(n => present.has(n));
        req._source.order = order;
        store.save();
        refreshSceneMachines(req._source.id);
        res.json({ ok: true });
    });

    api.post('/files/delete', (req, res) => bulkFiles(req, res, 'delete'));
    api.post('/files/archive', (req, res) => bulkFiles(req, res, 'archive'));

    api.get('/thumb', async (req, res) => {
        const p = store.data.projects[req.query.project];
        if (!p) return res.status(404).end();
        const s = (p.sources || {})[req.query.source];
        if (!s) return res.status(404).end();
        const name = safeSegment(req.query.name);
        const file = path.join(model.sourceDir(UPLOAD_PATH, p, s), name);
        if (!name || !fs.existsSync(file)) return res.status(404).end();
        try { res.sendFile(await thumbs.getThumb(file)); }
        catch (e) { res.status(500).end(); }
    });

    // ---- machines (pool of physical boxes) ---------------------------------
    api.get('/machines', (req, res) => {
        res.json({ machines: Object.values(store.data.machines).map(serializeMachine) });
    });

    api.post('/machines', (req, res) => {
        const id = ids.id();
        store.data.machines[id] = newMachine(id, String(req.body.name || 'Machine').trim() || 'Machine');
        store.save();
        res.json({ machine: serializeMachine(store.data.machines[id]) });
    });

    api.put('/machines/:id', (req, res) => {
        const m = store.data.machines[req.params.id];
        if (!m) return res.status(404).json({ error: 'not found' });
        if (req.body.name) m.name = String(req.body.name).trim();
        if (typeof req.body.type === 'string') m.type = req.body.type.trim();
        if (typeof req.body.description === 'string') m.description = req.body.description.slice(0, 500);
        store.save();
        res.json({ machine: serializeMachine(m) });
    });

    api.delete('/machines/:id', (req, res) => {
        const m = store.data.machines[req.params.id];
        if (!m) return res.status(404).json({ error: 'not found' });
        for (const { project, station } of model.machineStations(m.id)) {
            delete project.stations[station.id];
            project.stationOrder = (project.stationOrder || []).filter(x => x !== station.id);
        }
        delete store.data.machines[req.params.id];
        store.save();
        res.json({ ok: true });
    });

    // ---- stations (a machine bound into a project) -------------------------
    api.post('/projects/:pid/stations', (req, res) => {
        const p = store.data.projects[req.params.pid];
        if (!p) return res.status(404).json({ error: 'project not found' });
        const machineId = String(req.body.machineId || '');
        const machine = store.data.machines[machineId];
        if (!machine) return res.status(400).json({ error: 'unknown machine' });
        if (Object.values(p.stations || {}).some(s => s.machineId === machineId)) {
            return res.status(400).json({ error: 'machine already in this project' });
        }
        const nickname = String(req.body.nickname || machine.name || 'Station').trim() || 'Station';
        const st = newStation(machineId, nickname);
        p.stations = p.stations || {}; p.stations[st.id] = st;
        p.stationOrder = p.stationOrder || []; p.stationOrder.push(st.id);
        store.save();
        res.json({ project: serializeProject(p) });
    });

    api.put('/projects/:pid/stations/:sid', (req, res) => {
        const found = model.findStation(req.params.pid, req.params.sid);
        if (!found) return res.status(404).json({ error: 'not found' });
        const st = found.station;
        if (req.body.nickname) st.nickname = String(req.body.nickname).trim();
        if (req.body.surface && typeof req.body.surface === 'object') st.surface = defaults.cleanSurface(Object.assign({}, st.surface, req.body.surface));
        if (req.body.playback && typeof req.body.playback === 'object') st.playback = defaults.cleanPlayback(Object.assign({}, st.playback, req.body.playback));
        if (req.body.midi && req.body.midi.map && typeof req.body.midi.map === 'object') { st.midi = st.midi || { map: {} }; st.midi.map = req.body.midi.map; }
        store.save();
        const m = model.stationMachine(st);
        if (m && model.stationDriving(found.project.id, st)) broadcastSettings(m);
        res.json({ project: serializeProject(found.project) });
    });

    api.delete('/projects/:pid/stations/:sid', (req, res) => {
        const found = model.findStation(req.params.pid, req.params.sid);
        if (!found) return res.status(404).json({ error: 'not found' });
        const m = model.stationMachine(found.station);
        const wasDriving = m && model.stationDriving(found.project.id, found.station);
        delete found.project.stations[found.station.id];
        found.project.stationOrder = (found.project.stationOrder || []).filter(x => x !== found.station.id);
        if (wasDriving) { clearMachine(m); broadcastSettings(m); broadcastActive(m); }
        store.save();
        res.json({ project: serializeProject(found.project) });
    });

    // set/clear the station's machine active scene (activate = take over the box)
    api.put('/projects/:pid/stations/:sid/active', (req, res) => {
        const found = model.findStation(req.params.pid, req.params.sid);
        if (!found) return res.status(404).json({ error: 'not found' });
        const m = model.stationMachine(found.station);
        if (!m) return res.status(400).json({ error: 'station has no machine' });
        const sceneId = String(req.body.sceneId || '');
        if (!sceneId) { // stop: only clears if this station currently drives the box
            if (m.activeStationId === found.station.id) { clearMachine(m); store.save(); broadcastSettings(m); broadcastActive(m); }
            return res.json({ project: serializeProject(found.project) });
        }
        if (!(found.project.sources || {})[sceneId]) return res.status(400).json({ error: 'invalid scene' });
        m.activeProjectId = found.project.id;
        m.activeStationId = found.station.id;
        m.activeSceneId = sceneId;
        m.selectedName = null;
        store.save();
        broadcastSettings(m);    // surface may differ between stations
        broadcastActive(m);
        res.json({ project: serializeProject(found.project) });
    });

    // playback remote + MIDI: push a command to the station's machine
    const SIMPLE = ['next', 'prev', 'reload', 'pause', 'play', 'restart'];
    api.post('/projects/:pid/stations/:sid/command', (req, res) => {
        const found = model.findStation(req.params.pid, req.params.sid);
        if (!found) return res.status(404).json({ error: 'not found' });
        const m = model.stationMachine(found.station);
        if (!m) return res.status(400).json({ error: 'station has no machine' });
        const room = 'player:' + m.token;
        const cmd = String(req.body.cmd || '');
        if (SIMPLE.includes(cmd)) io.to(room).emit('command', cmd);
        else if (cmd === 'autoplay') { m.playMode = 'diaporama'; m.selectedName = null; store.save(); io.to(room).emit('command', 'autoplay'); }
        else if (cmd === 'select') { m.playMode = 'manual'; m.selectedName = String(req.body.name || ''); store.save(); io.to(room).emit('command', { cmd: 'select', name: m.selectedName }); }
        else if (cmd === 'blackout') io.to(room).emit('command', { cmd: 'blackout', on: req.body.on });
        else return res.status(400).json({ error: 'unknown command' });
        res.json({ ok: true });
    });

    // persist a workspace's operator-console MIDI map (admin device -> station actions)
    api.put('/projects/:id/console', (req, res) => {
        const p = store.data.projects[req.params.id];
        if (!p) return res.status(404).json({ error: 'not found' });
        p.console = p.console || { map: {} };
        if (req.body.map && typeof req.body.map === 'object') p.console.map = req.body.map;
        store.save();
        res.json({ project: serializeProject(p) });
    });

    // no-cache so the admin always loads the latest build (control-room code is
    // front-end too; see app.js). Cheap 304s via ETag keep it fast.
    const page = express.static(path.join(__dirname, '..', 'www', 'admin'), {
        setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
    });
    return { api, page };
};
