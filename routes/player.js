// Public player display routes (token-secured).
const express = require('express');
const path = require('path');
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

    return router;
};
