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
        name: 'Drop',
        folder: '',
        public: true,            // legacy folders are public
        dropToken: ids.token(),
        allowSelfDelete: true,
        order: [],
        accept: { image: true, video: true, text: false, stream: false },
        streamMode: 'replace',
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
            sources: { [scene.id]: scene },
            sceneOrder: [scene.id]
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
        if (!Array.isArray(p.sceneOrder)) { p.sceneOrder = Object.keys(p.sources || {}); changed = true; }
        for (const s of Object.values(p.sources || {})) {
            if (s.public === undefined) { s.public = true; changed = true; }
            if (!s.dropToken) { s.dropToken = ids.token(); changed = true; }
            if (!Array.isArray(s.order)) { s.order = []; changed = true; }
            if (s.allowSelfDelete === undefined) { s.allowSelfDelete = true; changed = true; }
            if (s.name === 'Files') { s.name = 'Drop'; changed = true; }
            if (!s.accept || typeof s.accept !== 'object') { s.accept = { image: true, video: true, text: false, stream: false }; changed = true; }
            if (s.accept.stream === undefined) { s.accept.stream = false; changed = true; }
            if (s.streamMode !== 'replace' && s.streamMode !== 'grid') { s.streamMode = 'replace'; changed = true; }
            if ('type' in s) { delete s.type; changed = true; } // no longer used
        }
    }
    // normalise player scaler settings to the current shape
    const xmap = { left: 'left', right: 'right', center: 'center', custom: 'custom' };
    const ymap = { top: 'top', bottom: 'bottom', center: 'center', custom: 'custom' };
    for (const pl of Object.values(store.data.players)) {
        const s = pl.settings || (pl.settings = {});
        const sc = s.scaler || (s.scaler = {});
        if (sc.posX === undefined) { sc.posX = xmap[sc.hPosition] || 'center'; changed = true; }
        if (sc.posY === undefined) { sc.posY = ymap[sc.vPosition] || 'center'; changed = true; }
        if (sc.offsetX === undefined) { sc.offsetX = Number(sc.hOffset) || 0; changed = true; }
        if (sc.offsetY === undefined) { sc.offsetY = Number(sc.vOffset) || 0; changed = true; }
        for (const k of ['hPosition', 'vPosition', 'hOffset', 'vOffset']) {
            if (k in sc) { delete sc[k]; changed = true; }
        }
        if (sc.container === undefined) { sc.container = 'full'; changed = true; }
        if (sc.width === undefined) { sc.width = 0; changed = true; }
        if (sc.height === undefined) { sc.height = 0; changed = true; }
        if (sc.fit === undefined) { sc.fit = 'contain'; changed = true; }
        if (sc.rotation === undefined) { sc.rotation = 0; changed = true; }
        if (sc.evenLineSuppression === undefined) { sc.evenLineSuppression = false; changed = true; }
    }

    if (changed) {
        store.save();
        console.log('[upgrade] normalised sources/players to the current model');
    }
    return changed;
}

module.exports = { maybeMigrate, upgradeStore };
