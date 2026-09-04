// Two jobs:
//  1. maybeMigrate(): first-boot import of existing UPLOAD_PATH folders as
//     projects, each with one "Drop" scene pointing at that folder.
//  2. upgradeStore(): bring an older store up to the current model — normalise
//     scenes, seed device types, and split legacy Players into Machines (the
//     physical box + stable kiosk URL) plus per-project Stations (a box bound
//     into a project with its own surface / playback / MIDI). Idempotent.
const fs = require('fs');
const store = require('./store');
const ids = require('./ids');
const defaults = require('./defaults');

function newScene(extra) {
    return Object.assign({
        id: ids.id(),
        name: 'Drop',
        folder: '',
        dropToken: ids.token(),
        allowSelfDelete: true,
        order: [],
        accept: { image: true, video: true, text: false, stream: false },
        streamMode: 'replace',
        buttonLabel: '',
        playback: defaults.defaultPlayback(),
        createdAt: Date.now()
    }, extra);
}

function maybeMigrate(uploadPath) {
    const hasData = Object.keys(store.data.projects).length > 0
        || Object.keys(store.data.machines || {}).length > 0
        || Object.keys(store.data.players || {}).length > 0;
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
            homeToken: ids.token(),
            homeWelcome: '',
            sources: { [scene.id]: scene },
            sceneOrder: [scene.id],
            console: { map: {} },
            stations: {},
            stationOrder: []
        };
        imported++;
    }

    if (imported > 0) {
        store.save();
        console.log(`[migrate] imported ${imported} existing folder(s) as projects`);
    }
    return imported > 0;
}

// Legacy Player -> Machine (identity + stable token) + one Station per attached
// project (surface/playback/MIDI copied from the player's settings).
function migratePlayers() {
    const players = store.data.players;
    if (!players || !Object.keys(players).length) return false;
    store.data.machines = store.data.machines || {};

    for (const pl of Object.values(players)) {
        const machineId = pl.id || ids.id();
        const settings = pl.settings || {};
        store.data.machines[machineId] = {
            id: machineId,
            name: pl.name || 'Machine',
            token: pl.token || ids.token(),         // PRESERVE the kiosk URL
            type: '',
            description: '',
            createdAt: pl.createdAt || Date.now(),
            activeProjectId: pl.activeProjectId || null,
            activeStationId: null,
            activeSceneId: pl.activeSourceId || null,
            selectedName: pl.selectedName || null,
            playMode: settings.playMode === 'manual' ? 'manual' : 'diaporama'
        };
        for (const projectId of (pl.projectIds || [])) {
            const project = store.data.projects[projectId];
            if (!project) continue;
            project.stations = project.stations || {};
            project.stationOrder = project.stationOrder || [];
            const stationId = ids.id();
            project.stations[stationId] = {
                id: stationId,
                machineId,
                nickname: pl.name || 'Station',
                surface: defaults.cleanSurface(settings.scaler),
                playback: defaults.cleanPlayback(settings),
                midi: { map: (settings.midi && settings.midi.map) || {} },
                ndi: defaults.defaultStationNdi(),
                createdAt: pl.createdAt || Date.now()
            };
            project.stationOrder.push(stationId);
            if (pl.activeProjectId === projectId) store.data.machines[machineId].activeStationId = stationId;
        }
    }
    delete store.data.players;
    return true;
}

// Bring every project/scene up to the current shape + run the player split.
function upgradeStore() {
    let changed = false;

    if (!Array.isArray(store.data.deviceTypes) || !store.data.deviceTypes.length) {
        store.data.deviceTypes = defaults.defaultDeviceTypes();
        changed = true;
    }

    for (const p of Object.values(store.data.projects)) {
        if (!Array.isArray(p.sceneOrder)) { p.sceneOrder = Object.keys(p.sources || {}); changed = true; }
        if (!p.homeToken) { p.homeToken = ids.token(); changed = true; }   // public "drop home" menu URL
        if (typeof p.homeWelcome !== 'string') { p.homeWelcome = ''; changed = true; }
        if (!p.console || typeof p.console !== 'object') { p.console = { map: {} }; changed = true; }
        if (!p.console.map || typeof p.console.map !== 'object') { p.console.map = {}; changed = true; }
        if (!p.stations || typeof p.stations !== 'object') { p.stations = {}; changed = true; }
        if (!Array.isArray(p.stationOrder)) { p.stationOrder = Object.keys(p.stations); changed = true; }
        for (const s of Object.values(p.sources || {})) {
            if ('public' in s) { delete s.public; changed = true; } // scenes are URL-shared now
            if (!s.dropToken) { s.dropToken = ids.token(); changed = true; }
            if (!Array.isArray(s.order)) { s.order = []; changed = true; }
            if (s.allowSelfDelete === undefined) { s.allowSelfDelete = true; changed = true; }
            if (s.name === 'Files') { s.name = 'Drop'; changed = true; }
            if (!s.accept || typeof s.accept !== 'object') { s.accept = { image: true, video: true, text: false, stream: false }; changed = true; }
            if (s.accept.stream === undefined) { s.accept.stream = false; changed = true; }
            if (s.streamMode !== 'replace' && s.streamMode !== 'grid') { s.streamMode = 'replace'; changed = true; }
            if (typeof s.buttonLabel !== 'string') { s.buttonLabel = ''; changed = true; } // menu button on the drop home; '' = hidden
            if (!s.playback || typeof s.playback !== 'object') { s.playback = defaults.defaultPlayback(); changed = true; } // diaporama prefs moved from station -> scene
            if ('type' in s) { delete s.type; changed = true; } // no longer used
            if (!s.ndi || typeof s.ndi !== 'object') { s.ndi = defaults.defaultSceneNdi(); changed = true; } // NDI input intent
        }
        // diaporama playback moved from station -> scene; drop the vestigial copy
        for (const st of Object.values(p.stations || {})) {
            if ('playback' in st) { delete st.playback; changed = true; }
            if (!st.ndi || typeof st.ndi !== 'object') { st.ndi = defaults.defaultStationNdi(); changed = true; } // NDI source name
        }
    }

    if (migratePlayers()) { changed = true; console.log('[migrate] split legacy players into machines + stations'); }

    // normalise machine runtime + station settings to the current shape
    for (const m of Object.values(store.data.machines || {})) {
        if (typeof m.type !== 'string') { m.type = ''; changed = true; }
        if (typeof m.description !== 'string') { m.description = ''; changed = true; }
        if (m.playMode !== 'manual' && m.playMode !== 'diaporama') { m.playMode = 'diaporama'; changed = true; }
        for (const k of ['activeProjectId', 'activeStationId', 'activeSceneId', 'selectedName']) {
            if (!(k in m)) { m[k] = null; changed = true; }
        }
    }

    if (changed) {
        store.save();
        console.log('[upgrade] normalised store to the current machine/station model');
    }
    return changed;
}

module.exports = { maybeMigrate, upgradeStore };
