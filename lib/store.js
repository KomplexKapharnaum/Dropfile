// Tiny atomic JSON store (lowdb-style). Stays commonjs, no deps.
// The exported `data` object reference is stable across load() calls.
const fs = require('fs');
const path = require('path');

const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_PATH, 'db.json');

const data = { projects: {}, players: {}, uploads: {} };

function load() {
    let parsed = {};
    try {
        parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch (e) {
        // missing or invalid file -> keep empty defaults
    }
    data.projects = parsed.projects || {};
    data.players = parsed.players || {};
    data.uploads = parsed.uploads || {};
}

function save() {
    fs.mkdirSync(DATA_PATH, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, FILE);
}

load();

module.exports = { data, save, load, FILE, DATA_PATH };
