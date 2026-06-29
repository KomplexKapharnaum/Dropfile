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

    // Uploaded media + legacy redirect + front-end
    app.use('/media', express.static(UPLOAD_PATH));
    app.get('/diaporama', (req, res) => res.redirect('/admin'));
    app.use(express.static(path.join(__dirname, 'www')));

    return { app, server, io, UPLOAD_PATH, UPLOAD_SIZE };
}

module.exports = { build };
