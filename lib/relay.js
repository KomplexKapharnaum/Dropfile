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
const TICKET_ROWS = 4;       // the ticket printer fits at most this many rows per ticket

// Reformat a message for the ticket printer's multi-row layout before relaying.
// The scene's character cap (maxChars, e.g. 140) is spread across the ticket's
// rows — 140 / 4 = 35 chars per row — so a message longer than one row's worth is
// broken into 2–4 balanced lines: >35 chars -> 2 rows, >70 -> 3, >105 -> 4. Each
// '\n' becomes its own printed row (printer-daemon trame.py: `text.split('\n')`,
// scaling the font to fit), so we only insert the breaks at word boundaries.
function splitForTicket(text, maxChars) {
    const clean = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!clean) return clean;
    const cap = Math.floor(Number(maxChars));
    const perRow = (Number.isFinite(cap) && cap > 0) ? cap / TICKET_ROWS : 35;
    const rows = Math.min(TICKET_ROWS, Math.max(1, Math.ceil(clean.length / perRow)));
    if (rows <= 1) return clean;
    return balanceLines(clean, rows).join('\n');
}

// Break a single-spaced string into `n` lines of ~equal length, cutting only at
// the word boundaries nearest the ideal even-split positions (k·L/n). Never splits
// a word; with fewer words than lines it just returns one word per line.
function balanceLines(text, n) {
    const words = text.split(' ');
    const m = words.length;
    if (n <= 1 || m <= 1) return [text];
    if (m <= n) return words;                  // one word per line, at most m lines

    // end[i] = char length of "words[0]..words[i]" joined by single spaces
    const end = [];
    let acc = 0;
    for (let i = 0; i < m; i++) { acc += words[i].length + (i > 0 ? 1 : 0); end[i] = acc; }
    const L = end[m - 1];

    const cuts = [];                           // cut AFTER word index c
    let prev = -1;
    for (let k = 1; k < n; k++) {
        const target = (k * L) / n;
        const remaining = n - k;               // lines still to come after this cut
        const lo = prev + 1;                   // this line needs >= 1 word
        const hi = m - 1 - remaining;          // leave >= 1 word for each remaining line
        let best = lo, bestD = Infinity;
        for (let j = lo; j <= hi; j++) {
            const d = Math.abs(end[j] - target);
            if (d < bestD) { bestD = d; best = j; }
        }
        cuts.push(best);
        prev = best;
    }

    const lines = [];
    let start = 0;
    for (const c of cuts) { lines.push(words.slice(start, c + 1).join(' ')); start = c + 1; }
    lines.push(words.slice(start).join(' '));
    return lines;
}

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

// Forward a text message. The body is reflowed into up to 4 balanced rows for the
// ticket printer (see splitForTicket); maxChars is the scene's per-message cap.
// Logs and swallows every error.
async function relayText({ from, text, maxChars }) {
    const base = baseUrl();
    if (!base) return;
    try {
        const body = new URLSearchParams({ from: String(from || 'anon'), text: splitForTicket(text, maxChars) });
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

module.exports = { enabled, baseUrl, relayText, relayImage, splitForTicket };
