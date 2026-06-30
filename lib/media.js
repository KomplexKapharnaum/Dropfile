// Media helpers: extensions, type detection, sanitisation, directory listing.
const fs = require('fs');
const path = require('path');

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
const VIDEO_EXTS = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv'];
// audio-only extensions (kept disjoint from VIDEO_EXTS so recorded voice notes —
// .weba/.m4a/.oga — and picked tracks classify as audio, while ambiguous
// .ogg/.webm stay video as before).
const AUDIO_EXTS = ['.mp3', '.m4a', '.aac', '.wav', '.weba', '.oga', '.opus', '.flac'];
const TEXT_EXTS = ['.txt'];
const ALLOWED = [...IMAGE_EXTS, ...VIDEO_EXTS, ...AUDIO_EXTS, ...TEXT_EXTS];

function mediaType(file) {
    const ext = path.extname(file).toLowerCase();
    if (IMAGE_EXTS.includes(ext)) return 'image';
    if (VIDEO_EXTS.includes(ext)) return 'video';
    if (AUDIO_EXTS.includes(ext)) return 'audio';
    if (TEXT_EXTS.includes(ext)) return 'text';
    return null;
}

// names starting with . or _ are hidden (e.g. .thumbs, _archive)
function isHidden(name) {
    return name.startsWith('.') || name.startsWith('_');
}

// keep a single filename segment safe (no path traversal, no spaces)
function safeSegment(s, max = 60) {
    return String(s || '').replace(/ /g, '_').replace(/[^a-zA-Z0-9_.-]/g, '').substr(0, max);
}

// keep a short nickname safe
function safeNick(s, max = 20) {
    return String(s || '').replace(/ /g, '_').replace(/[^a-zA-Z0-9_-]/g, '').substr(0, max);
}

// list media files (not directories, not hidden) in a folder, with stats.
// sorted oldest -> newest by mtime (matches the legacy diaporama ordering).
function listMedia(dirPath) {
    let files = [];
    try {
        files = fs.readdirSync(dirPath);
    } catch (e) {
        return [];
    }
    return files
        .filter(f => !f.startsWith('.') && ALLOWED.includes(path.extname(f).toLowerCase()))
        .map(f => {
            let mtime = 0, size = 0;
            try {
                const st = fs.statSync(path.join(dirPath, f));
                if (!st.isFile()) return null;
                mtime = st.mtimeMs;
                size = st.size;
            } catch (e) {
                return null;
            }
            return { name: f, type: mediaType(f), mtime, size };
        })
        .filter(Boolean)
        .sort((a, b) => a.mtime - b.mtime);
}

// Apply a scene's explicit order: files named in `order` come first in that
// sequence; everything else (e.g. new uploads) is appended by upload time.
// With no order, the result is plain upload-time order.
function orderMedia(list, order) {
    if (!Array.isArray(order) || !order.length) {
        return list.slice().sort((a, b) => a.mtime - b.mtime);
    }
    const pos = new Map(order.map((n, i) => [n, i]));
    const known = [], unknown = [];
    for (const m of list) (pos.has(m.name) ? known : unknown).push(m);
    known.sort((a, b) => pos.get(a.name) - pos.get(b.name));
    unknown.sort((a, b) => a.mtime - b.mtime);
    return [...known, ...unknown];
}

module.exports = {
    IMAGE_EXTS, VIDEO_EXTS, AUDIO_EXTS, TEXT_EXTS, ALLOWED,
    mediaType, isHidden, safeSegment, safeNick, listMedia, orderMedia
};
