// Builds the fully-wired Express app + HTTP server + Socket.IO instance.
// server.js calls build() then listens on a TCP port; tests can listen on a
// unix socket. Keeping this a factory makes the whole stack importable.
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const socketIO = require('socket.io');

const store = require('./lib/store');
const thumbs = require('./lib/thumbs');
const basicAuth = require('./lib/auth');
const { maybeMigrate, upgradeStore } = require('./lib/migrate');

function build(opts = {}) {
    const UPLOAD_PATH = opts.UPLOAD_PATH || process.env.UPLOAD_PATH || path.join(__dirname, 'uploads');
    const UPLOAD_SIZE = parseInt(opts.UPLOAD_SIZE || process.env.UPLOAD_SIZE || '300', 10);

    try {
        fs.mkdirSync(UPLOAD_PATH, { recursive: true });
    } catch (e) {
        console.warn('[init] could not create UPLOAD_PATH:', UPLOAD_PATH, '-', e.message);
    }
    thumbs.init(UPLOAD_PATH);
    maybeMigrate(UPLOAD_PATH);
    upgradeStore();

    const app = express();
    const server = http.createServer(app);
    const io = socketIO(server);

    app.use(express.json({ limit: UPLOAD_SIZE + 'mb' }));
    app.use(express.urlencoded({ extended: true, limit: UPLOAD_SIZE + 'mb' }));

    const ctx = { store, io, UPLOAD_PATH, UPLOAD_SIZE };
    require('./sockets')(io, ctx);

    // Admin (password-gated): API under /admin/api so it shares the Basic-auth
    // protection space (browser sends credentials preemptively).
    const admin = require('./routes/admin')(ctx);
    app.use('/admin/api', basicAuth, admin.api);
    app.use('/admin', basicAuth, admin.page);

    // Public token-secured routes
    app.use('/', require('./routes/player')(ctx));
    app.use('/', require('./routes/drop')(ctx));

    // Uploaded media: cache hard. Playlist / admin URLs carry a ?v=<mtime>-<size>
    // tag (model.mediaVersion), so a same-name replacement gets a new URL and is
    // fetched fresh; unchanged media is served from disk cache with zero network,
    // warm across kiosk reboots.
    app.use('/media', express.static(UPLOAD_PATH, { immutable: true, maxAge: 31536000000 }));
    app.get('/diaporama', (req, res) => res.redirect('/admin'));
    // Front-end code (player.js, receiver.js, midi.js, player.css, *.html): never
    // long-cache. Kiosks keep a persistent browser cache across reboots, so code
    // must revalidate to always run the latest build. no-cache = revalidate before
    // use (cheap 304 via ETag), not "don't store" — still fast, just never stale.
    app.use(express.static(path.join(__dirname, 'www'), {
        setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
    }));

    return { app, server, io, UPLOAD_PATH, UPLOAD_SIZE };
}

module.exports = { build };
