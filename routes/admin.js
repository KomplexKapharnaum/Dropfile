// Admin API (password-gated in app.js) + static admin SPA.
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const QRCode = require('qrcode');
const store = require('../lib/store');
const ids = require('../lib/ids');
const model = require('../lib/model');
const thumbs = require('../lib/thumbs');
const playlistLib = require('../lib/playlist');
const { listMedia, orderMedia, safeSegment } = require('../lib/media');

module.exports = function (ctx) {
    const { UPLOAD_PATH, UPLOAD_SIZE, io } = ctx;
    const api = express.Router();

    // ---- helpers (closure over ctx) ----------------------------------------
    function defaultSettings() {
        return {
            playMode: 'diaporama',
            imageDuration: 5,
            loop: 'all',
            lastX: 20,
            prioritizeFresh: true,
            scaler: {
                container: 'full', width: 0, height: 0,
                posX: 'center', offsetX: 0,     // container placement on screen (custom res)
                posY: 'center', offsetY: 0,
                fit: 'contain',                 // common filling options:
                rotation: 0,
                evenLineSuppression: false      // vertical 50% squash for semi-transparent LED
            },
            midi: { map: {} }                   // MIDI key -> action (media/transport/blackout)
        };
    }

    function newPlayer(id, name) {
        return {
            id, name, token: ids.token(), createdAt: Date.now(),
            projectIds: [], activeProjectId: null, activeSourceId: null,
            settings: defaultSettings()
        };
    }

    function mergeSettings(base, inc) {
        const out = Object.assign({}, base, inc);
        out.scaler = Object.assign({}, (base && base.scaler) || {}, inc.scaler || {});
        return out;
    }

    function sceneCount(p, s) {
        try { return listMedia(model.sourceDir(UPLOAD_PATH, p, s)).length; } catch (e) { return 0; }
    }

    function defaultAccept() { return { image: true, video: true, text: false, stream: false }; }
    function cleanAccept(a) { return { image: !!a.image, video: !!a.video, text: !!a.text, stream: !!a.stream }; }

    // create a scene under project p (shared by project-create and scene-create)
    function makeScene(p, name, accept) {
        const folder = ids.uniqueSlug(ids.slugify(name), Object.values(p.sources || {}).map(s => s.folder).filter(Boolean));
        const sid = ids.id();
        const scene = {
            id: sid, name, folder,
            dropToken: ids.token(),            // every scene is reachable by its URL
            allowSelfDelete: true, order: [],
            accept: accept ? cleanAccept(accept) : defaultAccept(),
            streamMode: 'replace',
            createdAt: Date.now()
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

    // scenes in their explicit project order (unknown ones appended)
    function orderedScenes(p) {
        const all = p.sources || {};
        const order = Array.isArray(p.sceneOrder) ? p.sceneOrder : [];
        const seen = new Set();
        const out = [];
        for (const sid of order) { if (all[sid]) { out.push(all[sid]); seen.add(sid); } }
        for (const s of Object.values(all)) { if (!seen.has(s.id)) out.push(s); }
        return out;
    }

    function serializeProject(p) {
        const scenes = orderedScenes(p).map(s => serializeScene(p, s));
        return {
            id: p.id, name: p.name, slug: p.slug, createdAt: p.createdAt,
            sources: scenes,
            sceneCount: scenes.length,
            mediaCount: scenes.reduce((n, s) => n + s.count, 0),
            console: { map: (p.console && p.console.map) ? p.console.map : {} },
            players: model.projectPlayers(p.id).map(pl => ({ id: pl.id, name: pl.name }))
        };
    }

    function serializePlayer(pl) {
        return {
            id: pl.id, name: pl.name, token: pl.token,
            projectIds: pl.projectIds || [],
            activeProjectId: pl.activeProjectId || null,
            activeSourceId: pl.activeSourceId || null,
            settings: pl.settings
        };
    }

    function broadcastActive(pl) {
        io.to('player:' + pl.token).emit('active-change', {
            active: playlistLib.activeInfo(pl),
            media: playlistLib.playlist(UPLOAD_PATH, pl)
        });
    }

    function refreshSourcePlayers(sourceId) {
        for (const pl of model.playersForSource(sourceId)) broadcastActive(pl);
    }

    function removeFromManifest(sourceId, filename) {
        const manifest = store.data.uploads[sourceId];
        if (!manifest) return;
        for (const [fid, u] of Object.entries(manifest)) {
            if (u.filename === filename) delete manifest[fid];
        }
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
        // drop removed files from the explicit order
        if (Array.isArray(s.order) && s.order.length) {
            const present = new Set(listMedia(dir).map(m => m.name));
            s.order = s.order.filter(n => present.has(n));
        }
        store.save();
        refreshSourcePlayers(s.id);
        res.json({ ok: true, count });
    }

    // resolve :id/:sid -> req._project / req._source / req._dir (mkdir'd)
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

    // multer for admin-side uploads (any scene)
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
    api.get('/config', (req, res) => {
        res.json({ publicUrl: process.env.PUBLIC_URL || '' });
    });

    api.get('/qr', async (req, res) => {
        const data = String(req.query.data || '');
        if (!data) return res.status(400).send('missing data');
        try {
            if (String(req.query.type) === 'svg') {
                res.type('svg').send(await QRCode.toString(data, { type: 'svg', margin: 1 }));
            } else {
                res.type('png').send(await QRCode.toBuffer(data, { margin: 1, width: 600 }));
            }
        } catch (e) {
            res.status(500).send('qr error');
        }
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
        const project = { id, name, slug, createdAt: Date.now(), sources: {}, sceneOrder: [] };
        store.data.projects[id] = project;
        try { fs.mkdirSync(path.join(UPLOAD_PATH, slug), { recursive: true }); } catch (e) {}
        makeScene(project, 'Drop');  // every new project starts with a Drop scene
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
        for (const pl of Object.values(store.data.players)) {
            pl.projectIds = (pl.projectIds || []).filter(x => x !== p.id);
            if (pl.activeProjectId === p.id) {
                pl.activeProjectId = null; pl.activeSourceId = null; broadcastActive(pl);
            }
        }
        delete store.data.projects[req.params.id];
        store.save();
        res.json({ ok: true }); // media left on disk on purpose
    });

    // ---- scenes (sources) --------------------------------------------------
    // One unified create; a scene is public or private. dropToken is always
    // minted so toggling public is instant. New scenes default to private.
    api.post('/projects/:id/sources', (req, res) => {
        const p = store.data.projects[req.params.id];
        if (!p) return res.status(404).json({ error: 'not found' });
        const name = String(req.body.name || 'Scene').trim() || 'Scene';
        makeScene(p, name, req.body.accept);
        store.save();
        res.json({ project: serializeProject(p) });
    });

    // reorder scenes within a project (drives the 01- index prefix)
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
        res.json({ project: serializeProject(req._project) });
    });

    api.delete('/projects/:id/sources/:sid', (req, res) => {
        const p = store.data.projects[req.params.id];
        if (!p || !(p.sources || {})[req.params.sid]) return res.status(404).json({ error: 'not found' });
        const sid = req.params.sid;
        for (const pl of Object.values(store.data.players)) {
            if (pl.activeSourceId === sid) { pl.activeSourceId = null; broadcastActive(pl); }
        }
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
            url: model.mediaUrl(req._project, req._source, m.name),
            thumb: `/admin/api/thumb?project=${req._project.id}&source=${req._source.id}&name=${encodeURIComponent(m.name)}`
        }));
        res.json({ files });
    });

    api.post('/projects/:id/sources/:sid/upload', resolveSource, upload.array('files', 50), (req, res) => {
        const added = (req.files || []).map(f => f.filename);
        // new uploads stay out of the explicit order -> appended by upload time
        refreshSourcePlayers(req._source.id);
        res.json({ ok: true, added, count: added.length });
    });

    api.put('/projects/:id/sources/:sid/order', resolveSource, (req, res) => {
        const present = new Set(listMedia(req._dir).map(m => m.name));
        const order = (Array.isArray(req.body.order) ? req.body.order : [])
            .map(n => safeSegment(n)).filter(n => present.has(n));
        req._source.order = order;
        store.save();
        refreshSourcePlayers(req._source.id);
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
        try {
            res.sendFile(await thumbs.getThumb(file));
        } catch (e) {
            res.status(500).end();
        }
    });

    // ---- players (pool) ----------------------------------------------------
    api.get('/players', (req, res) => {
        res.json({ players: Object.values(store.data.players).map(serializePlayer) });
    });

    api.post('/players', (req, res) => {
        const id = ids.id();
        store.data.players[id] = newPlayer(id, String(req.body.name || 'Player').trim());
        store.save();
        res.json({ player: serializePlayer(store.data.players[id]) });
    });

    api.put('/players/:id', (req, res) => {
        const pl = store.data.players[req.params.id];
        if (!pl) return res.status(404).json({ error: 'not found' });
        if (req.body.name) pl.name = String(req.body.name).trim();
        store.save();
        res.json({ player: serializePlayer(pl) });
    });

    api.delete('/players/:id', (req, res) => {
        if (!store.data.players[req.params.id]) return res.status(404).json({ error: 'not found' });
        delete store.data.players[req.params.id];
        store.save();
        res.json({ ok: true });
    });

    api.post('/players/:id/attach', (req, res) => {
        const pl = store.data.players[req.params.id];
        const projectId = String(req.body.projectId || '');
        if (!pl || !store.data.projects[projectId]) return res.status(404).json({ error: 'not found' });
        pl.projectIds = pl.projectIds || [];
        if (!pl.projectIds.includes(projectId)) pl.projectIds.push(projectId);
        store.save();
        res.json({ player: serializePlayer(pl) });
    });

    api.post('/players/:id/detach', (req, res) => {
        const pl = store.data.players[req.params.id];
        const projectId = String(req.body.projectId || '');
        if (!pl) return res.status(404).json({ error: 'not found' });
        pl.projectIds = (pl.projectIds || []).filter(x => x !== projectId);
        if (pl.activeProjectId === projectId) {
            pl.activeProjectId = null; pl.activeSourceId = null; broadcastActive(pl);
        }
        store.save();
        res.json({ player: serializePlayer(pl) });
    });

    api.put('/players/:id/active', (req, res) => {
        const pl = store.data.players[req.params.id];
        if (!pl) return res.status(404).json({ error: 'not found' });
        const projectId = String(req.body.projectId || '');
        const sourceId = String(req.body.sourceId || '');
        if (!projectId && !sourceId) { // clear
            pl.activeProjectId = null; pl.activeSourceId = null;
            store.save(); broadcastActive(pl);
            return res.json({ player: serializePlayer(pl) });
        }
        if (!model.findSource(projectId, sourceId)) return res.status(400).json({ error: 'invalid source' });
        if (!(pl.projectIds || []).includes(projectId)) return res.status(400).json({ error: 'project not attached' });
        pl.activeProjectId = projectId;
        pl.activeSourceId = sourceId;
        store.save();
        broadcastActive(pl);
        res.json({ player: serializePlayer(pl) });
    });

    api.put('/players/:id/settings', (req, res) => {
        const pl = store.data.players[req.params.id];
        if (!pl) return res.status(404).json({ error: 'not found' });
        pl.settings = mergeSettings(pl.settings || defaultSettings(), req.body.settings || {});
        store.save();
        io.to('player:' + pl.token).emit('settings', pl.settings);
        res.json({ player: serializePlayer(pl) });
    });

    // playback remote + MIDI: push a command to the live player(s)
    const SIMPLE = ['next', 'prev', 'reload', 'pause', 'play', 'restart'];
    api.post('/players/:id/command', (req, res) => {
        const pl = store.data.players[req.params.id];
        if (!pl) return res.status(404).json({ error: 'not found' });
        const room = 'player:' + pl.token;
        const cmd = String(req.body.cmd || '');
        if (SIMPLE.includes(cmd)) io.to(room).emit('command', cmd);
        else if (cmd === 'select') io.to(room).emit('command', { cmd: 'select', name: String(req.body.name || '') });
        else if (cmd === 'blackout') io.to(room).emit('command', { cmd: 'blackout', on: req.body.on });
        else return res.status(400).json({ error: 'unknown command' });
        res.json({ ok: true });
    });

    // persist a workspace's operator-console MIDI map (admin device -> player actions)
    api.put('/projects/:id/console', (req, res) => {
        const p = store.data.projects[req.params.id];
        if (!p) return res.status(404).json({ error: 'not found' });
        p.console = p.console || { map: {} };
        if (req.body.map && typeof req.body.map === 'object') p.console.map = req.body.map;
        store.save();
        res.json({ project: serializeProject(p) });
    });

    // persist a player's MIDI map (admin side)
    api.put('/players/:id/midi', (req, res) => {
        const pl = store.data.players[req.params.id];
        if (!pl) return res.status(404).json({ error: 'not found' });
        pl.settings = pl.settings || defaultSettings();
        pl.settings.midi = pl.settings.midi || { map: {} };
        if (req.body.map && typeof req.body.map === 'object') pl.settings.midi.map = req.body.map;
        store.save();
        io.to('player:' + pl.token).emit('settings', pl.settings);
        res.json({ player: serializePlayer(pl) });
    });

    return { api, page: express.static(path.join(__dirname, '..', 'www', 'admin')) };
};
