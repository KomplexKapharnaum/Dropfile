// Admin API (password-gated in server.js) + static admin SPA.
const express = require('express');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const store = require('../lib/store');
const ids = require('../lib/ids');
const model = require('../lib/model');
const thumbs = require('../lib/thumbs');
const playlistLib = require('../lib/playlist');
const { listMedia, safeSegment } = require('../lib/media');

module.exports = function (ctx) {
    const { UPLOAD_PATH, io } = ctx;
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
                fit: 'contain',
                hPosition: 'center', hOffset: 0,
                vPosition: 'center', vOffset: 0,
                rotation: 0,
                evenLineSuppression: false
            }
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

    function serializeProject(p) {
        return {
            id: p.id, name: p.name, slug: p.slug, createdAt: p.createdAt,
            sources: Object.values(p.sources || {}).map(s => ({
                id: s.id, type: s.type, name: s.name, folder: s.folder,
                dropToken: s.dropToken, allowSelfDelete: !!s.allowSelfDelete
            })),
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
        store.save();
        // refresh any players showing this source
        for (const pl of model.playersForSource(s.id)) broadcastActive(pl);
        res.json({ ok: true, count });
    }

    function removeFromManifest(sourceId, filename) {
        const manifest = store.data.uploads[sourceId];
        if (!manifest) return;
        for (const [fid, u] of Object.entries(manifest)) {
            if (u.filename === filename) delete manifest[fid];
        }
    }

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
                res.type('png').send(await QRCode.toBuffer(data, { margin: 1, width: 320 }));
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
        store.data.projects[id] = { id, name, slug, createdAt: Date.now(), sources: {} };
        try { fs.mkdirSync(path.join(UPLOAD_PATH, slug), { recursive: true }); } catch (e) {}
        store.save();
        res.json({ project: serializeProject(store.data.projects[id]) });
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

    // ---- sources -----------------------------------------------------------
    api.post('/projects/:id/sources', (req, res) => {
        const p = store.data.projects[req.params.id];
        if (!p) return res.status(404).json({ error: 'not found' });
        const type = req.body.type === 'preloaded' ? 'preloaded' : 'drop';
        const name = String(req.body.name || (type === 'drop' ? 'Drop' : 'Files')).trim();
        const folder = ids.uniqueSlug(ids.slugify(name), Object.values(p.sources || {}).map(s => s.folder).filter(Boolean));
        const sid = ids.id();
        p.sources = p.sources || {};
        p.sources[sid] = {
            id: sid, type, name, folder,
            dropToken: type === 'drop' ? ids.token() : null,
            allowSelfDelete: type === 'drop'
        };
        try { fs.mkdirSync(path.join(UPLOAD_PATH, p.slug, folder), { recursive: true }); } catch (e) {}
        store.save();
        res.json({ source: p.sources[sid], project: serializeProject(p) });
    });

    api.put('/projects/:id/sources/:sid', (req, res) => {
        const p = store.data.projects[req.params.id];
        if (!p || !(p.sources || {})[req.params.sid]) return res.status(404).json({ error: 'not found' });
        const s = p.sources[req.params.sid];
        if (req.body.name) s.name = String(req.body.name).trim();
        if (typeof req.body.allowSelfDelete === 'boolean') s.allowSelfDelete = req.body.allowSelfDelete;
        store.save();
        res.json({ source: s });
    });

    api.delete('/projects/:id/sources/:sid', (req, res) => {
        const p = store.data.projects[req.params.id];
        if (!p || !(p.sources || {})[req.params.sid]) return res.status(404).json({ error: 'not found' });
        const sid = req.params.sid;
        for (const pl of Object.values(store.data.players)) {
            if (pl.activeSourceId === sid) {
                pl.activeSourceId = null; pl.activeProjectId = pl.activeProjectId; broadcastActive(pl);
            }
        }
        delete p.sources[sid];
        delete store.data.uploads[sid];
        store.save();
        res.json({ ok: true });
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

    // ---- file browser ------------------------------------------------------
    api.get('/projects/:id/files', (req, res) => {
        const p = store.data.projects[req.params.id];
        if (!p) return res.status(404).json({ error: 'not found' });
        const s = (p.sources || {})[req.query.source];
        if (!s) return res.status(404).json({ error: 'source not found' });
        const dir = model.sourceDir(UPLOAD_PATH, p, s);
        const sort = req.query.sort || 'date';
        const sign = req.query.dir === 'desc' ? -1 : 1;
        const files = listMedia(dir).sort((a, b) => {
            let c;
            if (sort === 'name') c = a.name.localeCompare(b.name);
            else if (sort === 'size') c = a.size - b.size;
            else c = a.mtime - b.mtime;
            return c * sign;
        }).map(m => ({
            name: m.name, type: m.type, size: m.size, mtime: m.mtime,
            url: model.mediaUrl(p, s, m.name),
            thumb: `/admin/api/thumb?project=${p.id}&source=${s.id}&name=${encodeURIComponent(m.name)}`
        }));
        res.json({ files });
    });

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

    api.post('/files/delete', (req, res) => bulkFiles(req, res, 'delete'));
    api.post('/files/archive', (req, res) => bulkFiles(req, res, 'archive'));

    return { api, page: express.static(path.join(__dirname, '..', 'www', 'admin')) };
};
