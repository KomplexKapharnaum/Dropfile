// One-time import: if the store has no projects/players yet, turn each existing
// top-level folder under UPLOAD_PATH into a project with a single "preloaded"
// source pointing at that folder (source.folder === '' = project root).
const fs = require('fs');
const store = require('./store');
const ids = require('./ids');

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
        const sid = ids.id();
        store.data.projects[pid] = {
            id: pid,
            name: e.name.replace(/_/g, ' '),
            slug: e.name,
            createdAt: Date.now(),
            sources: {
                [sid]: {
                    id: sid,
                    type: 'preloaded',
                    name: 'Files',
                    folder: '',            // existing media lives in the project root
                    dropToken: null,
                    allowSelfDelete: false
                }
            }
        };
        imported++;
    }

    if (imported > 0) {
        store.save();
        console.log(`[migrate] imported ${imported} existing folder(s) as projects`);
    }
    return imported > 0;
}

module.exports = { maybeMigrate };
