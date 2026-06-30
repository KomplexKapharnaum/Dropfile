// Thumbnail cache: sharp for images, ffmpeg (poster frame) for videos.
// Cached as JPEGs under <UPLOAD_PATH>/.thumbs/<sha>.jpg, keyed by path+mtime+size.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const sharp = require('sharp');
const { mediaType } = require('./media');

const THUMB_W = 400;
let thumbRoot = null;

function init(uploadPath) {
    thumbRoot = path.join(uploadPath, '.thumbs');
    try { fs.mkdirSync(thumbRoot, { recursive: true }); } catch (e) {}
}

function keyFor(absPath, st) {
    return crypto.createHash('sha1')
        .update(absPath + ':' + st.mtimeMs + ':' + st.size)
        .digest('hex');
}

// Returns the absolute path to a cached thumbnail, generating it on demand.
async function getThumb(absPath) {
    if (!thumbRoot) throw new Error('thumbs not initialised');
    const st = fs.statSync(absPath);
    const out = path.join(thumbRoot, keyFor(absPath, st) + '.jpg');
    if (fs.existsSync(out) && fs.statSync(out).size > 0) return out;

    const type = mediaType(absPath);
    if (type === 'image') {
        await sharp(absPath, { failOn: 'none' })
            .rotate() // honour EXIF orientation
            .resize(THUMB_W, THUMB_W, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 70 })
            .toFile(out);
    } else if (type === 'video') {
        await videoThumb(absPath, out);
    } else if (type === 'text') {
        let content = '';
        try { content = fs.readFileSync(absPath, 'utf8'); } catch (e) {}
        await sharp(textCardSvg(content, THUMB_W)).jpeg({ quality: 80 }).toFile(out);
    } else {
        throw new Error('unsupported media type for thumbnail');
    }
    return out;
}

// A small "message card" thumbnail for dropped text, rendered as an SVG and
// rasterised by sharp (so .txt scenes get real tiles in the grid / control room).
function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function wrapForCard(text, perLine, maxLines) {
    const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!words.length) return ['(empty)'];
    const lines = [];
    let line = '';
    for (const w of words) {
        if (line && (line.length + 1 + w.length) > perLine) { lines.push(line); line = w; }
        else line = line ? line + ' ' + w : w;
        if (lines.length >= maxLines) break;
    }
    if (line && lines.length < maxLines) lines.push(line);
    if (lines.length >= maxLines && (words.join(' ').length > lines.join(' ').length)) {
        lines[maxLines - 1] = lines[maxLines - 1].slice(0, perLine - 1).trimEnd() + '…';
    }
    return lines.slice(0, maxLines);
}

function textCardSvg(content, size) {
    const lines = wrapForCard(content.slice(0, 600), 22, 9);
    const fs_ = 30, lh = 40;
    const startY = (size - lines.length * lh) / 2 + fs_ * 0.75;
    const tspans = lines.map((l, i) => `<tspan x="${size / 2}" y="${Math.round(startY + i * lh)}">${escapeXml(l)}</tspan>`).join('');
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
        `<rect width="${size}" height="${size}" fill="#1b1e27"/>` +
        `<rect x="0" y="0" width="${size}" height="6" fill="#3b82f6"/>` +
        `<text font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-size="${fs_}" font-weight="600" fill="#e9edf5" text-anchor="middle" xml:space="preserve">${tspans}</text>` +
        `<text x="${size - 12}" y="${size - 14}" font-family="sans-serif" font-size="16" fill="#8a93a3" text-anchor="end">TXT</text>` +
        `</svg>`;
    return Buffer.from(svg);
}

function videoThumb(input, out) {
    return new Promise((resolve, reject) => {
        // try a frame ~1s in, fall back to the very first frame for short clips
        runFfmpeg(['-ss', '1', '-i', input, '-frames:v', '1', '-vf', `scale=${THUMB_W}:-2`, '-y', out], () => {
            if (ok(out)) return resolve(out);
            runFfmpeg(['-i', input, '-frames:v', '1', '-vf', `scale=${THUMB_W}:-2`, '-y', out], () => {
                if (ok(out)) resolve(out);
                else reject(new Error('ffmpeg could not extract a frame'));
            });
        });
    });
}

function ok(file) {
    try { return fs.statSync(file).size > 0; } catch (e) { return false; }
}

function runFfmpeg(args, done) {
    const p = spawn('ffmpeg', ['-loglevel', 'error', ...args]);
    p.on('error', done);
    p.on('close', done);
}

module.exports = { init, getThumb };
