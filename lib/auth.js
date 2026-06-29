// HTTP Basic auth middleware. Password comes from ADMIN_PASSWORD (.env).
// The username is ignored; only the password is checked (timing-safe).
const crypto = require('crypto');

function safeEqual(a, b) {
    const ab = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
}

let warned = false;

function basicAuth(req, res, next) {
    const password = process.env.ADMIN_PASSWORD || '';

    if (!password) {
        if (!warned) {
            console.warn('[auth] ADMIN_PASSWORD is not set — admin is OPEN. Set it in .env.');
            warned = true;
        }
        return next();
    }

    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
        const decoded = Buffer.from(encoded, 'base64').toString('utf8');
        const pass = decoded.slice(decoded.indexOf(':') + 1);
        if (safeEqual(pass, password)) return next();
    }

    res.set('WWW-Authenticate', 'Basic realm="Dropfile Admin"');
    return res.status(401).send('Authentication required');
}

module.exports = basicAuth;
