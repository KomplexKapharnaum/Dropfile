// Public blind drop box (token-secured). Uploaders never see other people's
// media; they may list / delete only their own uploads (by visitor token).
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const store = require('../lib/store');
const ids = require('../lib/ids');
const model = require('../lib/model');
const turn = require('../lib/turn');
const relay = require('../lib/relay');
const { mediaType, safeNick } = require('../lib/media');

module.exports = function (ctx) {
    const router = express.Router();
    const { UPLOAD_PATH, UPLOAD_SIZE, io } = ctx;

    // text-input character cap for a scene: default 140, 0 = unlimited
    function dropMaxChars(src) { const n = Math.floor(Number(src && src.maxChars)); return (Number.isFinite(n) && n >= 0) ? n : 140; }

    // resolve :token -> drop project / source / on-disk dir
    function resolveDrop(req, res, next) {
        const found = model.findSourceByDropToken(req.params.token);
        if (!found) return res.status(404).json({ error: 'unknown drop' });
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

    // drop page (blind box) — same HTML for every token.
    // no-cache so audience devices always load the latest build (see app.js).
    router.get('/d/:token', (req, res) => {
        res.set('Cache-Control', 'no-cache');
        res.sendFile(path.join(__dirname, '..', 'www', 'drop.html'));
    });

    // project "drop home" — a menu page listing the project's labelled scenes so a
    // visitor can pick which one to send to. Same HTML for every project token.
    router.get('/h/:token', (req, res) => {
        res.set('Cache-Control', 'no-cache');
        res.sendFile(path.join(__dirname, '..', 'www', 'home.html'));
    });

    // metadata for a project drop home: title, intro, and the scene buttons.
    // A scene is listed only when it carries a (non-empty) buttonLabel.
    router.get('/api/home/:token', (req, res) => {
        const project = model.findProjectByHomeToken(req.params.token);
        if (!project) return res.status(404).json({ error: 'unknown drop' });
        const scenes = model.orderedScenes(project)
            .filter(s => s.dropToken && String(s.buttonLabel || '').trim())
            .map(s => ({ label: String(s.buttonLabel).trim(), url: '/d/' + s.dropToken }));
        res.json({ project: project.name, welcome: project.homeWelcome || '', scenes });
    });

    // metadata about this drop (name etc.) — no file listing
    router.get('/api/drop/:token', resolveDrop, (req, res) => {
        res.json({
            project: req.dropProject.name,
            source: req.dropSource.name,
            sceneId: req.dropSource.id,
            allowSelfDelete: !!req.dropSource.allowSelfDelete,
            accept: req.dropSource.accept || { image: true, video: true, audio: false, text: false, stream: false },
            welcome: req.dropSource.welcome || '',   // operator's intro, shown as an incoming message
            autoReplies: model.autoReplyLines(req.dropSource),  // scripted bot answers, one per contribution
            maxChars: dropMaxChars(req.dropSource),  // text-input cap; 0 = unlimited
            ice: turn.iceServers()
        });
    });

    // upload one file
    router.post('/api/drop/:token', resolveDrop, upload.single('file'), (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'no file' });
        const filename = req.file.filename;
        const type = mediaType(filename);
        const accept = req.dropSource.accept || { image: true, video: true, audio: false, text: false };
        if (!type || !accept[type]) {
            try { fs.unlinkSync(req.file.path); } catch (e) {}
            return res.status(415).json({ error: 'file type not allowed here' });
        }
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
            for (const p of model.machinesForScene(sid)) {
                io.to('player:' + p.token).emit('new-media', payload);
            }
        }
        io.to('admins').emit('scene-media', { sceneId: sid });   // live-refresh admin scene/clip grids

        // optionally mirror images to the KXKM relay (best-effort, never awaited)
        if (type === 'image' && req.dropSource.relayImage) {
            relay.relayImage({ from: `${nick} (${req.dropSource.name})`, filePath: req.file.path });
        }
        res.json({ ok: true, fileId });
    });

    // submit a text message -> saved as a .txt file (when the scene accepts text)
    router.post('/api/drop/:token/text', resolveDrop, (req, res) => {
        const accept = req.dropSource.accept || {};
        if (!accept.text) return res.status(403).json({ error: 'text not accepted here' });
        const max = dropMaxChars(req.dropSource);
        let text = String(req.body.text || '').slice(0, 100000);
        if (max > 0) text = text.slice(0, max);   // enforce the scene's cap server-side too
        if (!text.trim()) return res.status(400).json({ error: 'empty text' });
        const nick = safeNick(req.body.nick) || 'anon';
        const visitor = String(req.body.visitor || '').slice(0, 64);
        const filename = `${nick}_${Date.now()}_${ids.id().slice(0, 6)}.txt`;
        try { fs.writeFileSync(path.join(req.dropDir, filename), text, 'utf8'); }
        catch (e) { return res.status(500).json({ error: 'write failed' }); }

        const fileId = ids.id();
        const sid = req.dropSource.id;
        store.data.uploads[sid] = store.data.uploads[sid] || {};
        store.data.uploads[sid][fileId] = { filename, uploaderToken: visitor, nick, time: Date.now(), type: 'text' };
        store.save();

        // push to any player currently displaying this source (fresh-queue)
        const payload = { name: filename, type: 'text', url: model.mediaUrl(req.dropProject, req.dropSource, filename) };
        for (const p of model.machinesForScene(sid)) io.to('player:' + p.token).emit('new-media', payload);
        io.to('admins').emit('scene-media', { sceneId: sid });   // live-refresh admin scene/clip grids

        // optionally mirror the message to the KXKM relay (best-effort, never awaited)
        if (req.dropSource.relayText) {
            relay.relayText({ from: `${nick} (${req.dropSource.name})`, text });
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
        io.to('admins').emit('scene-media', { sceneId: req.dropSource.id });   // live-remove from admin grids
        res.json({ ok: true });
    });

    return router;
};
