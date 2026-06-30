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

// auto-play behaviour (per station)
function defaultPlayback() {
    return { imageDuration: 5, loop: 'all', lastX: 20, prioritizeFresh: true };
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

// The settings object the kiosk consumes (unchanged shape, so player.js is
// untouched): playback flags at top level + scaler + midi + current playMode.
function composeSettings(machine, station) {
    const surface = (station && station.surface) || defaultSurface();
    const playback = (station && station.playback) || defaultPlayback();
    const midi = (station && station.midi) || { map: {} };
    return Object.assign(
        { playMode: (machine && machine.playMode) || 'diaporama' },
        cleanPlayback(playback),
        { scaler: cleanSurface(surface), midi: { map: (midi && midi.map) || {} } }
    );
}

module.exports = {
    defaultDeviceTypes, defaultSurface, defaultPlayback,
    cleanSurface, cleanPlayback, composeSettings
};
