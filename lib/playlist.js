// Resolve a player's active source into a concrete media playlist.
const model = require('./model');
const { listMedia, orderMedia } = require('./media');

// the player's active source, with project/source objects attached (or null)
function activeOf(player) {
    if (!player.activeProjectId || !player.activeSourceId) return null;
    const found = model.findSource(player.activeProjectId, player.activeSourceId);
    if (!found) return null;
    return {
        projectId: found.project.id,
        sourceId: found.source.id,
        sourceName: found.source.name,
        sourceType: found.source.type,
        project: found.project,
        source: found.source
    };
}

// compact active descriptor for the wire (no internal objects)
function activeInfo(player) {
    const a = activeOf(player);
    if (!a) return null;
    return { projectId: a.projectId, sourceId: a.sourceId, sourceName: a.sourceName, sourceType: a.sourceType };
}

function playlist(uploadPath, player) {
    const a = activeOf(player);
    if (!a) return [];
    const dir = model.sourceDir(uploadPath, a.project, a.source);
    return orderMedia(listMedia(dir), a.source.order).map(m => ({
        name: m.name,
        type: m.type,
        mtime: m.mtime,
        url: model.mediaUrl(a.project, a.source, m.name)
    }));
}

module.exports = { activeOf, activeInfo, playlist };
