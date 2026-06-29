// Two jobs:
//  1. maybeMigrate(): first-boot import of existing UPLOAD_PATH folders as
//     projects, each with one public "scene" pointing at that folder.
//  2. upgradeStore(): normalise any older-shape sources to the current scene
//     model (public flag, dropToken, order[]) — idempotent, runs every boot.
const fs = require('fs');
const store = require('./store');
const ids = require('./ids');

function newScene(extra) {
    return Object.assign({
        id: ids.id(),
        name: 'Files',
        folder: '',
        public: true,            // legacy folders are public
        dropToken: ids.token(),
        allowSelfDelete: true,
        order: [],
        createdAt: Date.now()
    }, extra);
}

function maybeMigrate(uploadPath) {
    const hasData = Object.keys(store.data.projects).length > 0
        || Object.keys(store.data.players).length > 0;
    if (hasData) return false;

    let entries = [];
    try {
        entries = fs.readdirSync(uploadPath, { withFileTypes: true });
    } catch (e) {
        return false; // upload path not readable yet
    }

    let imported = 0;
    for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (e.name.startsWith('.') || e.name.startsWith('_')) continue;

        const pid = ids.id();
        const scene = newScene({ folder: '' }); // existing media lives in the project root
        store.data.projects[pid] = {
            id: pid,
            name: e.name.replace(/_/g, ' '),
            slug: e.name,
            createdAt: Date.now(),
            sources: { [scene.id]: scene }
        };
        imported++;
    }

    if (imported > 0) {
        store.save();
        console.log(`[migrate] imported ${imported} existing folder(s) as projects`);
    }
    return imported > 0;
}

// Bring every existing source up to the current scene shape. Sources without an
// explicit `public` flag are treated as legacy (imported folders) => public.
function upgradeStore() {
    let changed = false;
    for (const p of Object.values(store.data.projects)) {
        for (const s of Object.values(p.sources || {})) {
            if (s.public === undefined) { s.public = true; changed = true; }
            if (!s.dropToken) { s.dropToken = ids.token(); changed = true; }
            if (!Array.isArray(s.order)) { s.order = []; changed = true; }
            if (s.allowSelfDelete === undefined) { s.allowSelfDelete = true; changed = true; }
            if ('type' in s) { delete s.type; changed = true; } // no longer used
        }
    }
    if (changed) {
        store.save();
        console.log('[upgrade] normalised sources to the scene model');
    }
    return changed;
}

module.exports = { maybeMigrate, upgradeStore };
