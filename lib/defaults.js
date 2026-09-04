// Default shapes for machines, stations and their per-show settings.
// A Machine is a physical box (stable kiosk URL). A Station is a Machine bound
// into one project with its own display surface, playback prefs and MIDI map.

function defaultDeviceTypes() {
    return ['Raspberry Pi 4', 'Raspberry Pi 5', 'N150 miniPC', 'Intel NUC', 'Browser'];
}

// the display-surface / LED-scaler block (per station, since it describes the screen)
function defaultSurface() {
    return {
        container: 'full', width: 0, height: 0,
        posX: 'center', offsetX: 0,
        posY: 'center', offsetY: 0,
        fit: 'contain',
        rotation: 0,
        evenLineSuppression: false
    };
}

// auto-play behaviour (per scene — how that scene's media plays)
function defaultPlayback() {
    return { imageDuration: 5, loop: 'all', lastX: 20, prioritizeFresh: true };
}

// which media types this station displays (default: everything)
function defaultMediaFilter() {
    return { image: true, video: true, audio: true, text: true, stream: true, ndi: true };
}

function cleanSurface(s) {
    const d = defaultSurface();
    s = s || {};
    return {
        container: s.container === 'custom' ? 'custom' : 'full',
        width: Number(s.width) || 0,
        height: Number(s.height) || 0,
        posX: ['left', 'center', 'right', 'custom'].includes(s.posX) ? s.posX : 'center',
        offsetX: Number(s.offsetX) || 0,
        posY: ['top', 'center', 'bottom', 'custom'].includes(s.posY) ? s.posY : 'center',
        offsetY: Number(s.offsetY) || 0,
        fit: s.fit === 'cover' ? 'cover' : 'contain',
        rotation: [0, 90, 180, 270].includes(Number(s.rotation)) ? Number(s.rotation) : 0,
        evenLineSuppression: !!s.evenLineSuppression
    };
}

function cleanPlayback(p) {
    p = p || {};
    return {
        imageDuration: Math.max(1, Number(p.imageDuration) || 5),
        loop: p.loop === 'lastX' ? 'lastX' : 'all',
        lastX: Math.max(1, Number(p.lastX) || 20),
        prioritizeFresh: p.prioritizeFresh !== false
    };
}

// missing keys default to true so legacy stations (no filter saved) show all
function cleanMediaFilter(f) {
    f = f || {};
    return {
        image: f.image !== false,
        video: f.video !== false,
        audio: f.audio !== false,
        text: f.text !== false,
        stream: f.stream !== false,
        ndi: f.ndi !== false
    };
}

// per-scene NDI intent: whether this scene calls for the box's NDI input.
// The source NAME lives on the station (the box in this project), not here.
function defaultSceneNdi() { return { on: false }; }
function cleanNdi(n) { n = n || {}; return { on: !!n.on }; }

// per-station NDI: which NDI source this box subscribes to (blank = box default).
function defaultStationNdi() { return { source: '' }; }
function cleanStationNdi(n) { n = n || {}; return { source: String(n.source || '').trim().slice(0, 128) }; }

// The settings object the kiosk consumes (unchanged shape, so player.js is
// untouched): playback flags at top level + scaler + midi + current playMode.
// Surface + MIDI come from the active Station (they describe the screen/box);
// diaporama playback comes from the active Scene (how its media plays).
function composeSettings(machine, station, scene) {
    const surface = (station && station.surface) || defaultSurface();
    const playback = (scene && scene.playback) || defaultPlayback();
    const midi = (station && station.midi) || { map: {} };
    return Object.assign(
        { playMode: (machine && machine.playMode) || 'diaporama' },
        cleanPlayback(playback),
        { scaler: cleanSurface(surface), midi: { map: (midi && midi.map) || {} } }
    );
}

module.exports = {
    defaultDeviceTypes, defaultSurface, defaultPlayback, defaultMediaFilter,
    defaultSceneNdi, cleanNdi, defaultStationNdi, cleanStationNdi,
    cleanSurface, cleanPlayback, cleanMediaFilter, composeSettings
};
