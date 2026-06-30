// Public kiosk routes (token-secured). The token identifies a Machine (a
// physical box). What it shows + its surface come from the machine's active
// Station, composed server-side so the kiosk front-end (player.js) is unchanged.
const express = require('express');
const path = require('path');
const store = require('../lib/store');
const model = require('../lib/model');
const playlistLib = require('../lib/playlist');
const turn = require('../lib/turn');

module.exports = function (ctx) {
    const router = express.Router();
    const { UPLOAD_PATH } = ctx;

    // display page (same HTML for every token; token read from the URL client-side).
    // no-cache so a rebooted kiosk always loads the latest build (see app.js).
    router.get('/p/:token', (req, res) => {
        res.set('Cache-Control', 'no-cache');
        res.sendFile(path.join(__dirname, '..', 'www', 'player.html'));
    });

    // WebRTC diagnostic page + the ICE servers it (and clients) use
    router.get('/diag', (req, res) => {
        res.set('Cache-Control', 'no-cache');
        res.sendFile(path.join(__dirname, '..', 'www', 'diag.html'));
    });
    router.get('/api/ice', (req, res) => {
        res.json({ ice: turn.iceServers() });
    });

    // full resolved state: composed settings + active scene + playlist + ICE
    router.get('/api/player/:token', (req, res) => {
        const machine = model.findMachineByToken(req.params.token);
        if (!machine) return res.status(404).json({ error: 'unknown player' });
        res.json({
            id: machine.id,
            name: machine.name,
            token: machine.token,
            settings: playlistLib.settingsFor(machine),
            selectedName: machine.selectedName || null,
            active: playlistLib.activeInfo(machine),
            media: playlistLib.playlist(UPLOAD_PATH, machine),
            ice: turn.iceServers()
        });
    });

    // playlist only (used for reloads)
    router.get('/api/player/:token/playlist', (req, res) => {
        const machine = model.findMachineByToken(req.params.token);
        if (!machine) return res.status(404).json({ error: 'unknown player' });
        res.json({ media: playlistLib.playlist(UPLOAD_PATH, machine) });
    });

    // persist the MIDI map learned on the kiosk -> the active station's map
    router.put('/api/player/:token/midi', (req, res) => {
        const machine = model.findMachineByToken(req.params.token);
        if (!machine) return res.status(404).json({ error: 'unknown player' });
        const a = playlistLib.activeOf(machine);
        if (a && a.station) {
            a.station.midi = a.station.midi || { map: {} };
            if (req.body.map && typeof req.body.map === 'object') a.station.midi.map = req.body.map;
            store.save();
            ctx.io.to('player:' + machine.token).emit('settings', playlistLib.settingsFor(machine));
        }
        res.json({ ok: true });
    });

    return router;
};
