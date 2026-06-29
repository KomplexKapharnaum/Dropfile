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
    } else {
        throw new Error('unsupported media type for thumbnail');
    }
    return out;
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
