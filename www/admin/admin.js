// Admin SPA logic (Alpine.js component). All API calls go under /admin/api,
// which shares the Basic-auth protection space so the browser sends credentials.
async function api(method, pathname, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    const r = await fetch('/admin/api' + pathname, opts);
    if (!r.ok) throw new Error((await r.text().catch(() => '')) || ('HTTP ' + r.status));
    const ct = r.headers.get('content-type') || '';
    return ct.includes('application/json') ? r.json() : r.text();
}

// --- inline icons (stroke, currentColor) ---
function svgIcon(inner) {
    return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
}
const ICONS = {
    pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3"/><path d="M21 14v.01"/><path d="M14 21h.01"/><path d="M21 21v-3h-3"/>',
    close: '<path d="M18 6 6 18"/><path d="M6 6l12 12"/>',
    left: '<path d="M15 18l-6-6 6-6"/>',
    right: '<path d="M9 18l6-6-6-6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>',
    grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.35-4.35a2 2 0 0 0-2.83 0L5 19"/>',
    video: '<rect x="2" y="5" width="14" height="14" rx="2"/><path d="m22 8-6 4 6 4V8Z"/>',
    text: '<path d="M15 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z"/><path d="M15 3v4h4"/><path d="M9 13h6"/><path d="M9 17h6"/>',
    stream: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
    play: '<polygon points="6 4 20 12 6 20 6 4"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    prev: '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/>',
    next: '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>',
    reload: '<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    restart: '<polygon points="11 19 2 12 11 5 11 19"/><polygon points="22 19 13 12 22 5 22 19"/>'
};

function adminApp() {
    return {
        tab: 'projects',
        publicUrl: '',
        projects: [],
        players: [],
        toast: '',
        editPlayers: {},   // per-project: choosing enabled players
        editProjects: {},  // per-player: choosing attached projects
        paused: {},        // per-player optimistic play/pause state (remote)
        // per-scene UI state (keyed by scene id)
        expanded: {},
        files: {},
        sel: {},
        uploading: {},
        uploadTarget: null,
        // drag state
        drag: { sid: null, from: -1, name: null },         // media tiles
        sceneDrag: { pid: null, from: -1, sid: null },      // scenes
        // overlays
        lightbox: { open: false, files: [], index: 0 },
        qr: { open: false, url: '', title: '' },

        icon(name) { return svgIcon(ICONS[name] || ''); },
        pad(n) { return String(n).padStart(2, '0'); },

        async init() {
            try {
                const c = await api('GET', '/config');
                this.publicUrl = c.publicUrl || location.origin;
            } catch (e) { this.publicUrl = location.origin; }
            if (!this.publicUrl) this.publicUrl = location.origin;
            await this.loadAll();
        },

        notify(msg) { this.toast = msg; setTimeout(() => { if (this.toast === msg) this.toast = ''; }, 2000); },
        async guard(fn) { try { await fn(); } catch (e) { this.notify('Error: ' + e.message); } },

        base() { return (this.publicUrl || location.origin).replace(/\/$/, ''); },
        dropUrl(s) { return this.base() + '/d/' + s.dropToken; },
        playerUrl(pl) { return this.base() + '/p/' + pl.token; },
        qrPng(data) { return '/admin/api/qr?type=png&data=' + encodeURIComponent(data); },
        copy(text) { navigator.clipboard.writeText(text).then(() => this.notify('Link copied')); },

        async loadAll() { await this.loadProjects(); await this.loadPlayers(); },
        async loadProjects() { this.projects = (await api('GET', '/projects')).projects; },
        async loadPlayers() { this.players = (await api('GET', '/players')).players; },

        // ---- projects ----
        createProject() {
            const name = (prompt('Project name', '') || '').trim(); if (!name) return;
            this.guard(async () => { await api('POST', '/projects', { name }); await this.loadProjects(); });
        },
        renameProject(p) {
            const name = prompt('Project name', p.name); if (!name) return;
            this.guard(async () => { await api('PUT', '/projects/' + p.id, { name }); await this.loadAll(); });
        },
        deleteProject(p) {
            if (!confirm('Delete project "' + p.name + '"? Media files stay on disk.')) return;
            this.guard(async () => { await api('DELETE', '/projects/' + p.id); await this.loadAll(); });
        },
        // clicking a project header collapses all its scenes
        collapseScenes(p) { for (const s of p.sources) this.expanded[s.id] = false; },

        // ---- scenes ----
        addScene(p) {
            const name = prompt('Scene name', 'Scene'); if (name === null) return;
            this.guard(async () => {
                const r = await api('POST', '/projects/' + p.id + '/sources', { name: name.trim() || 'Scene', public: false });
                this.replaceProject(r.project);
            });
        },
        renameScene(p, s) {
            const name = prompt('Scene name', s.name); if (!name) return;
            this.guard(async () => {
                const r = await api('PUT', `/projects/${p.id}/sources/${s.id}`, { name: name.trim() });
                this.replaceProject(r.project);
            });
        },
        toggleScenePublic(p, s) {
            this.guard(async () => {
                const r = await api('PUT', `/projects/${p.id}/sources/${s.id}`, { public: !s.public });
                this.replaceProject(r.project);
            });
        },
        toggleSelfDelete(p, s) {
            this.guard(async () => {
                const r = await api('PUT', `/projects/${p.id}/sources/${s.id}`, { allowSelfDelete: !s.allowSelfDelete });
                this.replaceProject(r.project);
            });
        },
        // accepted content types (image/video/text/stream) per scene
        acceptAll(s) { return !!(s.accept && s.accept.image && s.accept.video && s.accept.text && s.accept.stream); },
        setAcceptAll(p, s) {
            this.guard(async () => {
                const r = await api('PUT', `/projects/${p.id}/sources/${s.id}`, { accept: { image: true, video: true, text: true, stream: true } });
                this.replaceProject(r.project);
            });
        },
        toggleAccept(p, s, kind) {
            const accept = Object.assign({ image: true, video: true, text: false, stream: false }, s.accept || {});
            accept[kind] = !accept[kind];
            this.guard(async () => {
                const r = await api('PUT', `/projects/${p.id}/sources/${s.id}`, { accept });
                this.replaceProject(r.project);
            });
        },
        setStreamMode(p, s, mode) {
            this.guard(async () => {
                const r = await api('PUT', `/projects/${p.id}/sources/${s.id}`, { streamMode: mode });
                this.replaceProject(r.project);
            });
        },
        deleteScene(p, s) {
            if (!confirm('Delete scene "' + s.name + '"? Files stay on disk.')) return;
            this.guard(async () => {
                const r = await api('DELETE', `/projects/${p.id}/sources/${s.id}`);
                this.replaceProject(r.project);
                delete this.expanded[s.id]; delete this.files[s.id]; delete this.sel[s.id];
            });
        },
        replaceProject(project) {
            const i = this.projects.findIndex(x => x.id === project.id);
            if (i >= 0) this.projects.splice(i, 1, project); else this.projects.push(project);
            this.loadPlayers();
        },

        // ---- scene drag reorder (handle = index chip) ----
        sceneDragStart(p, i, ev) {
            this.sceneDrag = { pid: p.id, from: i, sid: p.sources[i].id };
            if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
        },
        sceneDragOver(p, i) {
            if (this.sceneDrag.pid !== p.id || this.sceneDrag.from === i || i < 0) return;
            const cont = document.querySelector(`[data-scenes="${p.id}"]`);
            this.flipReorder(cont, p.sources, this.sceneDrag.from, i, 'sid');
            this.sceneDrag.from = i;
        },
        sceneDragEnd(p) {
            if (this.sceneDrag.pid === p.id) {
                const order = p.sources.map(s => s.id);
                this.guard(async () => { await api('PUT', `/projects/${p.id}/scene-order`, { order }); });
            }
            this.sceneDrag = { pid: null, from: -1, sid: null };
        },
        isSceneDragging(p, s) { return this.sceneDrag.pid === p.id && this.sceneDrag.sid === s.id; },

        // ---- scene media (inline grid) ----
        toggleExpand(p, s) {
            this.expanded[s.id] = !this.expanded[s.id];
            if (this.expanded[s.id] && !this.files[s.id]) this.loadFiles(p, s);
        },
        async loadFiles(p, s) {
            await this.guard(async () => {
                const r = await api('GET', `/projects/${p.id}/sources/${s.id}/files`);
                this.files[s.id] = r.files;
                this.sel[s.id] = {};
            });
        },
        filesOf(s) { return this.files[s.id] || []; },

        addMedia(p, s) { this.uploadTarget = { p, s }; this.$refs.fileInput.click(); },
        onUpload(e) {
            const input = e.target;
            const files = input.files; if (!files || !files.length) return;
            const { p, s } = this.uploadTarget || {};
            if (!s) return;
            const fd = new FormData();
            for (const f of files) fd.append('files', f);
            this.uploading[s.id] = true;
            fetch(`/admin/api/projects/${p.id}/sources/${s.id}/upload`, { method: 'POST', body: fd })
                .then(r => { if (!r.ok) throw new Error('upload failed'); })
                .then(async () => { await this.loadFiles(p, s); await this.loadProjects(); this.notify('Uploaded ' + files.length); })
                .catch(err => this.notify('Error: ' + err.message))
                .finally(() => { this.uploading[s.id] = false; input.value = ''; });
        },

        // ---- selection (per scene) + bulk ----
        toggleSel(s, name) { this.sel[s.id] = this.sel[s.id] || {}; this.sel[s.id][name] = !this.sel[s.id][name]; },
        isSel(s, name) { return !!(this.sel[s.id] && this.sel[s.id][name]); },
        selNames(s) { const m = this.sel[s.id] || {}; return Object.keys(m).filter(n => m[n]); },
        selCount(s) { return this.selNames(s).length; },
        // selection-mode: once something is selected, a plain click toggles
        // selection; otherwise it opens the preview.
        tileClick(s, idx) {
            const f = this.filesOf(s)[idx]; if (!f) return;
            if (this.selCount(s) > 0) this.toggleSel(s, f.name);
            else this.openLightbox(s, idx);
        },
        bulk(op, p, s) {
            const names = this.selNames(s); if (!names.length) return;
            if (op === 'delete' && !confirm('Permanently delete ' + names.length + ' file(s)?')) return;
            this.guard(async () => {
                const r = await api('POST', '/files/' + op, { projectId: p.id, sourceId: s.id, names });
                await this.loadFiles(p, s); await this.loadProjects();
                this.notify(op + ': ' + r.count);
            });
        },

        // ---- media tile drag reorder (FLIP animated) ----
        mediaDragStart(s, i, ev) {
            this.drag = { sid: s.id, from: i, name: this.filesOf(s)[i].name };
            if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
        },
        mediaDragOver(s, i) {
            if (this.drag.sid !== s.id || this.drag.from === i || i < 0) return;
            const grid = document.querySelector(`[data-grid="${s.id}"]`);
            this.flipReorder(grid, this.files[s.id], this.drag.from, i, 'name');
            this.drag.from = i;
        },
        mediaDragEnd(p, s) {
            if (this.drag.sid === s.id) {
                const order = this.files[s.id].map(f => f.name);
                this.guard(async () => { await api('PUT', `/projects/${p.id}/sources/${s.id}/order`, { order }); });
            }
            this.drag = { sid: null, from: -1, name: null };
        },
        isDragging(s, f) { return this.drag.sid === s.id && this.drag.name === f.name; },

        // FLIP: animate siblings to their new positions after an in-place move.
        flipReorder(container, arr, from, to, key) {
            if (!container) { const [m] = arr.splice(from, 1); arr.splice(to, 0, m); return; }
            const before = new Map();
            for (const c of container.children) {
                const k = c.getAttribute('data-' + key);
                if (k != null) before.set(k, c.getBoundingClientRect());
            }
            const [m] = arr.splice(from, 1); arr.splice(to, 0, m);
            this.$nextTick(() => {
                for (const c of container.children) {
                    const k = c.getAttribute('data-' + key);
                    const f = k != null && before.get(k);
                    if (!f) continue;
                    const l = c.getBoundingClientRect();
                    const dx = f.left - l.left, dy = f.top - l.top;
                    if (dx || dy) {
                        c.style.transition = 'none';
                        c.style.transform = `translate(${dx}px,${dy}px)`;
                        requestAnimationFrame(() => {
                            c.style.transition = 'transform 170ms ease';
                            c.style.transform = '';
                        });
                    }
                }
            });
        },

        // ---- lightbox ----
        openLightbox(s, i) { this.lightbox = { open: true, files: this.files[s.id] || [], index: i }; },
        lbCurrent() { return this.lightbox.files[this.lightbox.index] || null; },
        lbNext() { const n = this.lightbox.files.length; if (n) this.lightbox.index = (this.lightbox.index + 1) % n; },
        lbPrev() { const n = this.lightbox.files.length; if (n) this.lightbox.index = (this.lightbox.index - 1 + n) % n; },
        lbClose() { this.lightbox.open = false; },

        // ---- QR modal ----
        openQr(url, title) { this.qr = { open: true, url, title: title || '' }; },
        closeQr() { this.qr.open = false; },
        async copyQrImage() {
            try {
                const blob = await (await fetch(this.qrPng(this.qr.url))).blob();
                await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
                this.notify('QR image copied');
            } catch (e) { this.notify('Copy not supported — use download'); }
        },
        async downloadQr() {
            try {
                const blob = await (await fetch(this.qrPng(this.qr.url))).blob();
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'qr-' + (this.qr.title || 'dropfile').replace(/[^a-z0-9]+/gi, '-') + '.png';
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            } catch (e) { this.notify('Download failed'); }
        },

        // ---- players ----
        createPlayer() {
            const name = (prompt('Player nickname', '') || '').trim(); if (!name) return;
            this.guard(async () => { await api('POST', '/players', { name }); await this.loadPlayers(); });
        },
        // players enabled on a project (full objects), lookups, and navigation
        attachedPlayers(p) { return this.players.filter(pl => (pl.projectIds || []).includes(p.id)); },
        playerById(id) { return this.players.find(pl => pl.id === id); },
        gotoPlayer(id) {
            this.tab = 'players';
            this.$nextTick(() => { const el = document.getElementById('player-' + id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
        },
        isActiveScene(pl, pid, sid) { return !!pl && pl.activeProjectId === pid && pl.activeSourceId === sid; },
        projActiveKey(pl, pid) { return (pl && pl.activeProjectId === pid && pl.activeSourceId) ? pid + '|' + pl.activeSourceId : ''; },
        renamePlayer(pl) {
            const name = prompt('Player name', pl.name); if (!name) return;
            this.guard(async () => { await api('PUT', '/players/' + pl.id, { name }); await this.loadAll(); });
        },
        deletePlayer(pl) {
            if (!confirm('Delete player "' + pl.name + '"?')) return;
            this.guard(async () => { await api('DELETE', '/players/' + pl.id); await this.loadAll(); });
        },
        isAttached(pl, projectId) { return (pl.projectIds || []).includes(projectId); },
        toggleAttach(pl, projectId) {
            const p = '/players/' + pl.id + (this.isAttached(pl, projectId) ? '/detach' : '/attach');
            this.guard(async () => { await api('POST', p, { projectId }); await this.loadAll(); });
        },
        attachedProjects(pl) { return this.projects.filter(p => (pl.projectIds || []).includes(p.id)); },
        sourcesFor(pl) {
            const out = [];
            for (const p of this.attachedProjects(pl)) {
                for (const s of p.sources) out.push({ key: p.id + '|' + s.id, label: p.name + ' / ' + s.name });
            }
            return out;
        },
        activeKey(pl) { return (pl.activeProjectId && pl.activeSourceId) ? pl.activeProjectId + '|' + pl.activeSourceId : ''; },
        setActive(pl, key) {
            let projectId = '', sourceId = '';
            if (key) [projectId, sourceId] = key.split('|');
            this.guard(async () => { await api('PUT', '/players/' + pl.id + '/active', { projectId, sourceId }); await this.loadPlayers(); this.notify('Source set'); });
        },
        saveSettings(pl) {
            this.guard(async () => { await api('PUT', '/players/' + pl.id + '/settings', { settings: pl.settings }); this.notify('Applied live'); });
        },
        playerCommand(pl, cmd) {
            this.guard(async () => { await api('POST', '/players/' + pl.id + '/command', { cmd }); });
        },
        togglePause(pl) {
            const p = !this.paused[pl.id];
            this.paused[pl.id] = p;
            this.playerCommand(pl, p ? 'pause' : 'play');
        },

        fmtSize(n) { if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(0) + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; }
    };
}
window.adminApp = adminApp;
