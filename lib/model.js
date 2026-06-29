// Query helpers over the JSON store. The relationship project<->players is
// stored canonically on the player (player.projectIds); project->players is derived.
const path = require('path');
const store = require('./store');

function findSourceByDropToken(dropToken) {
    for (const project of Object.values(store.data.projects)) {
        for (const source of Object.values(project.sources || {})) {
            if (source.dropToken && source.dropToken === dropToken) {
                return { project, source };
            }
        }
    }
    return null;
}

function findPlayerByToken(token) {
    return Object.values(store.data.players).find(p => p.token === token) || null;
}

function findSource(projectId, sourceId) {
    const project = store.data.projects[projectId];
    if (!project) return null;
    const source = (project.sources || {})[sourceId];
    if (!source) return null;
    return { project, source };
}

// absolute directory on disk for a source. folder === '' means the project root
// (used by migrated projects whose media sits directly in the project folder).
function sourceDir(uploadPath, project, source) {
    return path.join(uploadPath, project.slug, source.folder || '');
}

// public media URL path for a file in a source
function mediaUrl(project, source, fileName) {
    const parts = [project.slug, source.folder, fileName].filter(Boolean);
    return '/media/' + parts.map(encodeURIComponent).join('/');
}

// players currently displaying a given source (their active source matches)
function playersForSource(sourceId) {
    return Object.values(store.data.players).filter(p => p.activeSourceId === sourceId);
}

// players attached to a project
function projectPlayers(projectId) {
    return Object.values(store.data.players).filter(p => (p.projectIds || []).includes(projectId));
}

module.exports = {
    findSourceByDropToken, findPlayerByToken, findSource,
    sourceDir, mediaUrl, playersForSource, projectPlayers
};
