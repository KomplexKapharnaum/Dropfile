// ID / token / slug helpers (crypto-based, no external deps).
const crypto = require('crypto');

const COMBINING_MARKS = /[̀-ͯ]/g; // accents after NFD normalisation

// short opaque id for internal entities
function id() {
    return crypto.randomBytes(8).toString('hex'); // 16 hex chars
}

// unguessable, url-safe token for public URLs (drop / player)
function token() {
    return crypto.randomBytes(16).toString('base64url'); // ~22 chars
}

// filesystem-safe slug from a display name
function slugify(name) {
    const s = String(name || '')
        .toLowerCase()
        .normalize('NFD').replace(COMBINING_MARKS, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substr(0, 40);
    return s || 'item';
}

// make `base` unique against an existing set of taken strings
function uniqueSlug(base, taken) {
    const set = new Set(taken);
    if (!set.has(base)) return base;
    let i = 2;
    while (set.has(base + '-' + i)) i++;
    return base + '-' + i;
}

module.exports = { id, token, slugify, uniqueSlug };
