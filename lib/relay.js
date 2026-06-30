// Optional, best-effort forwarding of dropped text + images to the KXKM "relay"
// app (Klive, https://relay.kxkm.net). A scene opts in per-type via its
// relayText / relayImage flags; when set, routes/drop.js fires these helpers.
// They never throw and are never awaited on the request path, so a slow or down
// relay can never delay or fail an audience upload.
//
// The relay exposes two unauthenticated HTTP endpoints (Klive apps/relay.js):
//   POST /post/new/sms   form { from, text }                 -> a text post
//   POST /post/new/img   multipart: imageData=<dataURI>, from -> an image post
// The image endpoint base64-decodes and stores the bytes itself, and multer
// caps that form field near 1 MB, so we downscale to a modest JPEG first (the
// relay's own web client does the same client-side). RELAY_URL unset = off.
const sharp = require('sharp');

const TIMEOUT_MS = 10000;
const MAX_EDGE = 1280;       // longest side of the relayed image, px
const JPEG_QUALITY = 80;

// Read at call time (not module load) so it tracks env and stays test-friendly.
function baseUrl() {
    const u = (process.env.RELAY_URL || '').trim().replace(/\/+$/, '');
    return u || null;
}

function enabled() { return !!baseUrl(); }

async function postWithTimeout(url, init) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try { return await fetch(url, Object.assign({ signal: ctrl.signal }, init)); }
    finally { clearTimeout(t); }
}

// Forward a text message. Logs and swallows every error.
async function relayText({ from, text }) {
    const base = baseUrl();
    if (!base) return;
    try {
        const body = new URLSearchParams({ from: String(from || 'anon'), text: String(text || '') });
        const res = await postWithTimeout(base + '/post/new/sms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body
        });
        if (!res.ok) console.warn('[relay] text ->', res.status);
    } catch (e) {
        console.warn('[relay] text failed:', e.message);
    }
}

// Forward an image. Downscales to a JPEG data-URI to stay under the relay's
// ~1 MB field cap, then posts it as the multipart `imageData` field, exactly as
// the relay's own browser client does. The full-resolution original stays in
// Dropfile untouched.
async function relayImage({ from, filePath }) {
    const base = baseUrl();
    if (!base) return;
    try {
        const jpeg = await sharp(filePath)
            .rotate()                                                       // honour EXIF orientation
            .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: JPEG_QUALITY })
            .toBuffer();
        const form = new FormData();
        form.append('from', String(from || 'anon'));
        form.append('imageData', 'data:image/jpeg;base64,' + jpeg.toString('base64'));
        const res = await postWithTimeout(base + '/post/new/img', { method: 'POST', body: form });
        if (!res.ok) console.warn('[relay] image ->', res.status);
    } catch (e) {
        console.warn('[relay] image failed:', e.message);
    }
}

module.exports = { enabled, baseUrl, relayText, relayImage };
