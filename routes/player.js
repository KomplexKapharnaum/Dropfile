// Public player display routes (token-secured).
const express = require('express');
const path = require('path');
const store = require('../lib/store');
const model = require('../lib/model');
const playlistLib = require('../lib/playlist');
const turn = require('../lib/turn');

module.exports = function (ctx) {
    const router = express.Router();
    const { UPLOAD_PATH } = ctx;

    // display page (same HTML for every token; token read from the URL client-side)
    router.get('/p/:token', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'www', 'player.html'));
    });

    // WebRTC diagnostic page + the ICE servers it (and clients) use
    router.get('/diag', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'www', 'diag.html'));
    });
    router.get('/api/ice', (req, res) => {
        res.json({ ice: turn.iceServers() });
    });

    // full resolved state: settings + active source + playlist + ICE servers
    router.get('/api/player/:token', (req, res) => {
        const player = model.findPlayerByToken(req.params.token);
        if (!player) return res.status(404).json({ error: 'unknown player' });
        res.json({
            id: player.id,
            name: player.name,
            token: player.token,
            settings: player.settings,
            active: playlistLib.activeInfo(player),
            media: playlistLib.playlist(UPLOAD_PATH, player),
            ice: turn.iceServers()
        });
    });

    // playlist only (used for reloads)
    router.get('/api/player/:token/playlist', (req, res) => {
        const player = model.findPlayerByToken(req.params.token);
        if (!player) return res.status(404).json({ error: 'unknown player' });
        res.json({ media: playlistLib.playlist(UPLOAD_PATH, player) });
    });

    // persist the MIDI map from the player side (token-secured, no admin auth)
    router.put('/api/player/:token/midi', (req, res) => {
        const player = model.findPlayerByToken(req.params.token);
        if (!player) return res.status(404).json({ error: 'unknown player' });
        player.settings = player.settings || {};
        player.settings.midi = player.settings.midi || { map: {} };
        if (req.body.map && typeof req.body.map === 'object') player.settings.midi.map = req.body.map;
        store.save();
        ctx.io.to('player:' + player.token).emit('settings', player.settings);
        res.json({ ok: true });
    });

    return router;
};
