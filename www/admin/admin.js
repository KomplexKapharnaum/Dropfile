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

function adminApp() {
    return {
        tab: 'projects',
        publicUrl: '',
        projects: [],
        players: [],
        newProjectName: '',
        newPlayerName: '',
        toast: '',
        browser: { open: false, project: null, source: null, files: [], selected: {}, sort: 'date', dir: 'asc' },

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
        qrUrl(data) { return '/admin/api/qr?type=png&data=' + encodeURIComponent(data); },
        copy(text) { navigator.clipboard.writeText(text).then(() => this.notify('Copied')); },

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
        addSource(p, type) {
            const name = prompt(type === 'drop' ? 'Drop name' : 'Folder name', type === 'drop' ? 'Public drop' : 'Files');
            if (name === null) return;
            this.guard(async () => { await api('POST', '/projects/' + p.id + '/sources', { type, name }); await this.loadProjects(); });
        },
        deleteSource(p, s) {
            if (!confirm('Delete source "' + s.name + '"? Files stay on disk.')) return;
            this.guard(async () => { await api('DELETE', '/projects/' + p.id + '/sources/' + s.id); await this.loadAll(); });
        },
        toggleSelfDelete(p, s) {
            this.guard(async () => { await api('PUT', '/projects/' + p.id + '/sources/' + s.id, { allowSelfDelete: !s.allowSelfDelete }); await this.loadProjects(); });
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
            const path = '/players/' + pl.id + (this.isAttached(pl, projectId) ? '/detach' : '/attach');
            this.guard(async () => { await api('POST', path, { projectId }); await this.loadAll(); });
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

        // ---- file browser ----
        openBrowser(p, s) {
            this.browser.open = true; this.browser.project = p; this.browser.source = s; this.browser.selected = {};
            this.guard(() => this.loadFiles());
        },
        closeBrowser() { this.browser.open = false; },
        async loadFiles() {
            const b = this.browser;
            const q = `/projects/${b.project.id}/files?source=${b.source.id}&sort=${b.sort}&dir=${b.dir}`;
            b.files = (await api('GET', q)).files;
        },
        changeSort() { this.guard(() => this.loadFiles()); },
        toggleSel(name) { this.browser.selected[name] = !this.browser.selected[name]; },
        selectedNames() { return Object.keys(this.browser.selected).filter(n => this.browser.selected[n]); },
        selectedCount() { return this.selectedNames().length; },
        bulk(op) {
            const names = this.selectedNames(); if (!names.length) return;
            if (op === 'delete' && !confirm('Permanently delete ' + names.length + ' file(s)?')) return;
            this.guard(async () => {
                const r = await api('POST', '/files/' + op, { projectId: this.browser.project.id, sourceId: this.browser.source.id, names });
                this.browser.selected = {}; await this.loadFiles(); this.notify(op + ': ' + r.count);
            });
        },

        fmtSize(n) { if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(0) + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; },
        fmtDate(ms) { try { return new Date(ms).toLocaleString(); } catch (e) { return ''; } }
    };
}
window.adminApp = adminApp;
