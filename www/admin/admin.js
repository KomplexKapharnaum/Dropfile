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
    archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>'
};

function adminApp() {
    return {
        tab: 'projects',
        publicUrl: '',
        projects: [],
        players: [],
        newProjectName: '',
        newPlayerName: '',
        toast: '',
        // per-scene UI state (keyed by scene/source id)
        expanded: {},
        files: {},
        sel: {},
        uploading: {},
        uploadTarget: null,
        // overlays
        lightbox: { open: false, files: [], index: 0 },
        qr: { open: false, url: '', title: '' },
        drag: { sid: null, from: -1 },

        icon(name) { return svgIcon(ICONS[name] || ''); },

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
            const name = this.newProjectName.trim(); if (!name) return;
            this.guard(async () => { await api('POST', '/projects', { name }); this.newProjectName = ''; await this.loadProjects(); });
        },
        renameProject(p) {
            const name = prompt('Project name', p.name); if (!name) return;
            this.guard(async () => { await api('PUT', '/projects/' + p.id, { name }); await this.loadAll(); });
        },
        deleteProject(p) {
            if (!confirm('Delete project "' + p.name + '"? Media files stay on disk.')) return;
            this.guard(async () => { await api('DELETE', '/projects/' + p.id); await this.loadAll(); });
        },

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
                this.notify(s.public ? 'Scene is now public' : 'Scene is now private');
            });
        },
        toggleSelfDelete(p, s) {
            this.guard(async () => {
                const r = await api('PUT', `/projects/${p.id}/sources/${s.id}`, { allowSelfDelete: !s.allowSelfDelete });
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
            // keep player attach views in sync (names may matter)
            this.loadPlayers();
        },

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

        // ---- selection + bulk ----
        toggleSel(s, name, ev) { if (ev) ev.stopPropagation(); this.sel[s.id] = this.sel[s.id] || {}; this.sel[s.id][name] = !this.sel[s.id][name]; },
        isSel(s, name) { return !!(this.sel[s.id] && this.sel[s.id][name]); },
        selNames(s) { const m = this.sel[s.id] || {}; return Object.keys(m).filter(n => m[n]); },
        selCount(s) { return this.selNames(s).length; },
        bulk(op, p, s) {
            const names = this.selNames(s); if (!names.length) return;
            if (op === 'delete' && !confirm('Permanently delete ' + names.length + ' file(s)?')) return;
            this.guard(async () => {
                const r = await api('POST', '/files/' + op, { projectId: p.id, sourceId: s.id, names });
                await this.loadFiles(p, s); await this.loadProjects();
                this.notify(op + ': ' + r.count);
            });
        },

        // ---- drag reorder ----
        dragStart(s, i) { this.drag = { sid: s.id, from: i }; },
        dropOn(p, s, i) {
            if (this.drag.sid !== s.id || this.drag.from < 0) return;
            const arr = this.files[s.id];
            const [m] = arr.splice(this.drag.from, 1);
            arr.splice(i, 0, m);
            this.drag = { sid: null, from: -1 };
            this.guard(async () => { await api('PUT', `/projects/${p.id}/sources/${s.id}/order`, { order: arr.map(f => f.name) }); });
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
            const name = this.newPlayerName.trim(); if (!name) return;
            this.guard(async () => { await api('POST', '/players', { name }); this.newPlayerName = ''; await this.loadPlayers(); });
        },
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

        fmtSize(n) { if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(0) + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; }
    };
}
window.adminApp = adminApp;
