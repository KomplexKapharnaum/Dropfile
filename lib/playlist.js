// Resolve a Machine's runtime "active" into a concrete scene + media playlist,
// and compose the settings object the kiosk consumes (from the active Station).
const model = require('./model');
const defaults = require('./defaults');
const { listMedia, orderMedia } = require('./media');

// the machine's active scene + station (or null), with objects attached
function activeOf(machine) {
    if (!machine || !machine.activeProjectId || !machine.activeSceneId) return null;
    const found = model.findSource(machine.activeProjectId, machine.activeSceneId);
    if (!found) return null;
    const station = machine.activeStationId ? (found.project.stations || {})[machine.activeStationId] : null;
    return {
        projectId: found.project.id,
        sceneId: found.source.id,
        sceneName: found.source.name,
        project: found.project,
        source: found.source,
        station: station || null
    };
}

// compact active descriptor for the wire (no internal objects)
function activeInfo(machine) {
    const a = activeOf(machine);
    if (!a) return null;
    return {
        projectId: a.projectId, sceneId: a.sceneId, sceneName: a.sceneName,
        stream: !!(a.source.accept && a.source.accept.stream),
        streamMode: a.source.streamMode === 'grid' ? 'grid' : 'replace'
    };
}

function playlist(uploadPath, machine) {
    const a = activeOf(machine);
    if (!a) return [];
    const dir = model.sourceDir(uploadPath, a.project, a.source);
    return orderMedia(listMedia(dir), a.source.order).map(m => ({
        name: m.name, type: m.type, mtime: m.mtime,
        url: model.mediaUrl(a.project, a.source, m.name) + '?v=' + model.mediaVersion(m)
    }));
}

// the settings object for the kiosk (composed from the active station + machine)
function settingsFor(machine) {
    const a = activeOf(machine);
    return defaults.composeSettings(machine, a ? a.station : null);
}

module.exports = { activeOf, activeInfo, playlist, settingsFor };
