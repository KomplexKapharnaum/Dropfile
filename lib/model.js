// Query helpers over the JSON store.
//  - A Machine is a physical box (stable kiosk token). Runtime "active" state
//    (which project/station/scene it shows) lives on the machine.
//  - A Station is a Machine bound into one project (project.stations), carrying
//    that project's surface / playback / MIDI + a nickname.
//  - machine <-> stations is derived by scanning projects (canonical = machineId
//    on the station), like project<->players used to be.
const path = require('path');
const store = require('./store');

function findSourceByDropToken(dropToken) {
    for (const project of Object.values(store.data.projects)) {
        for (const source of Object.values(project.sources || {})) {
            if (source.dropToken && source.dropToken === dropToken) return { project, source };
        }
    }
    return null;
}

function findMachineByToken(token) {
    return Object.values(store.data.machines || {}).find(m => m.token === token) || null;
}

// a scene (source) within a project
function findSource(projectId, sourceId) {
    const project = store.data.projects[projectId];
    if (!project) return null;
    const source = (project.sources || {})[sourceId];
    if (!source) return null;
    return { project, source };
}

function findStation(projectId, stationId) {
    const project = store.data.projects[projectId];
    if (!project) return null;
    const station = (project.stations || {})[stationId];
    if (!station) return null;
    return { project, station };
}

// absolute directory on disk for a source. folder === '' means the project root.
function sourceDir(uploadPath, project, source) {
    return path.join(uploadPath, project.slug, source.folder || '');
}

// public media URL path for a file in a source
function mediaUrl(project, source, fileName) {
    const parts = [project.slug, source.folder, fileName].filter(Boolean);
    return '/media/' + parts.map(encodeURIComponent).join('/');
}

// Cache-busting version tag for a media file: changes whenever the bytes do, so
// a same-name replacement gets a new URL and is fetched fresh (the /media mount
// is cached immutably). mtime alone can be preserved by sync tools (Syncthing),
// so pair it with size — for images/video the size virtually always changes.
function mediaVersion(m) {
    return Math.floor(m.mtime || 0) + '-' + (m.size || 0);
}

// machines currently displaying a given scene (their runtime active scene matches)
function machinesForScene(sceneId) {
    return Object.values(store.data.machines || {}).filter(m => m.activeSceneId === sceneId);
}

// stations of a project (in stationOrder; unknown ones appended)
function stationsForProject(projectId) {
    const project = store.data.projects[projectId];
    if (!project) return [];
    const all = project.stations || {};
    const order = Array.isArray(project.stationOrder) ? project.stationOrder : [];
    const seen = new Set();
    const out = [];
    for (const id of order) { if (all[id]) { out.push(all[id]); seen.add(id); } }
    for (const s of Object.values(all)) if (!seen.has(s.id)) out.push(s);
    return out;
}

// all stations that reference a machine, across projects (derived)
function machineStations(machineId) {
    const out = [];
    for (const project of Object.values(store.data.projects)) {
        for (const station of Object.values(project.stations || {})) {
            if (station.machineId === machineId) out.push({ project, station });
        }
    }
    return out;
}

// the machine a station drives (or null)
function stationMachine(station) {
    return (station && store.data.machines[station.machineId]) || null;
}

// is this station the one currently driving its machine?
function stationDriving(projectId, station) {
    const m = stationMachine(station);
    return !!(m && m.activeStationId === station.id && m.activeProjectId === projectId);
}

module.exports = {
    findSourceByDropToken, findMachineByToken, findSource, findStation,
    sourceDir, mediaUrl, mediaVersion, machinesForScene,
    stationsForProject, machineStations, stationMachine, stationDriving
};
