// Public blind drop box (token-secured). Uploaders never see other people's
// media; they may list / delete only their own uploads (by visitor token).
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const store = require('../lib/store');
const ids = require('../lib/ids');
const model = require('../lib/model');
const { mediaType, safeNick } = require('../lib/media');

module.exports = function (ctx) {
    const router = express.Router();
    const { UPLOAD_PATH, UPLOAD_SIZE, io } = ctx;

    // resolve :token -> drop project / source / on-disk dir
    function resolveDrop(req, res, next) {
        const found = model.findSourceByDropToken(req.params.token);
        if (!found || !found.source.public) return res.status(404).json({ error: 'unknown drop' });
        req.dropProject = found.project;
        req.dropSource = found.source;
        req.dropDir = model.sourceDir(UPLOAD_PATH, found.project, found.source);
        try { fs.mkdirSync(req.dropDir, { recursive: true }); } catch (e) {}
        next();
    }

    const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, req.dropDir),
        filename: (req, file, cb) => {
            const nick = safeNick(req.body.nick) || 'anon';
            let ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
            if (ext.length > 8) ext = ext.slice(0, 8);
            cb(null, `${nick}_${Date.now()}_${ids.id().slice(0, 6)}${ext}`);
        }
    });
    const upload = multer({ storage, limits: { fileSize: UPLOAD_SIZE * 1024 * 1024 } });

    // drop page (blind box) — same HTML for every token
    router.get('/d/:token', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'www', 'drop.html'));
    });

    // metadata about this drop (name etc.) — no file listing
    router.get('/api/drop/:token', resolveDrop, (req, res) => {
        res.json({
            project: req.dropProject.name,
            source: req.dropSource.name,
            allowSelfDelete: !!req.dropSource.allowSelfDelete
        });
    });

    // upload one file
    router.post('/api/drop/:token', resolveDrop, upload.single('file'), (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'no file' });
        const filename = req.file.filename;
        const type = mediaType(filename);
        const visitor = String(req.body.visitor || '').slice(0, 64);
        const nick = safeNick(req.body.nick) || 'anon';
        const fileId = ids.id();
        const sid = req.dropSource.id;

        store.data.uploads[sid] = store.data.uploads[sid] || {};
        store.data.uploads[sid][fileId] = {
            filename, uploaderToken: visitor, nick, time: Date.now(), type: type || 'file'
        };
        store.save();

        // push to any player currently displaying this source
        if (type) {
            const payload = { name: filename, type, url: model.mediaUrl(req.dropProject, req.dropSource, filename) };
            for (const p of model.playersForSource(sid)) {
                io.to('player:' + p.token).emit('new-media', payload);
            }
        }
        res.json({ ok: true, fileId });
    });

    // list ONLY my own uploads (by visitor token)
    router.get('/api/drop/:token/mine', resolveDrop, (req, res) => {
        const visitor = String(req.query.visitor || '');
        const manifest = store.data.uploads[req.dropSource.id] || {};
        const mine = Object.entries(manifest)
            .filter(([, u]) => visitor && u.uploaderToken === visitor)
            .map(([fileId, u]) => ({
                fileId, name: u.filename, type: u.type, time: u.time,
                url: model.mediaUrl(req.dropProject, req.dropSource, u.filename)
            }))
            .sort((a, b) => b.time - a.time);
        res.json({ allowSelfDelete: !!req.dropSource.allowSelfDelete, uploads: mine });
    });

    // delete one of my own uploads
    router.delete('/api/drop/:token/:fileId', resolveDrop, (req, res) => {
        if (!req.dropSource.allowSelfDelete) return res.status(403).json({ error: 'deletion disabled' });
        const visitor = String(req.query.visitor || '');
        const manifest = store.data.uploads[req.dropSource.id] || {};
        const entry = manifest[req.params.fileId];
        if (!entry) return res.status(404).json({ error: 'not found' });
        if (!visitor || entry.uploaderToken !== visitor) return res.status(403).json({ error: 'not yours' });

        try { fs.unlinkSync(path.join(req.dropDir, entry.filename)); } catch (e) {}
        delete manifest[req.params.fileId];
        store.save();
        res.json({ ok: true });
    });

    return router;
};
