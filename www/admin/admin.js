// Admin SPA (Alpine.js). Views: 'projects' (landing) · 'machines' (pool of
// physical boxes) · 'workspace' (one project: live control room + scenes/media).
// A Machine is a box (stable kiosk URL); a Station is a Machine bound into one
// project with its own surface / playback / MIDI + nickname. All API calls go
// under /admin/api (shares the Basic-auth protection space).
async function api(method, pathname, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const r = await fetch('/admin/api' + pathname, opts);
    if (!r.ok) throw new Error((await r.text().catch(() => '')) || ('HTTP ' + r.status));
    const ct = r.headers.get('content-type') || '';
    return ct.includes('application/json') ? r.json() : r.text();
}

function svgIcon(inner) {
    return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
}
const ICONS = {
    pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3"/><path d="M21 14v.01"/><path d="M14 21h.01"/><path d="M21 21v-3h-3"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
    close: '<path d="M18 6 6 18"/><path d="M6 6l12 12"/>',
    left: '<path d="M15 18l-6-6 6-6"/>',
    right: '<path d="M9 18l6-6-6-6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    back: '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>',
    open: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.35-4.35a2 2 0 0 0-2.83 0L5 19"/>',
    video: '<rect x="2" y="5" width="14" height="14" rx="2"/><path d="m22 8-6 4 6 4V8Z"/>',
    audio: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
    text: '<path d="M15 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z"/><path d="M15 3v4h4"/><path d="M9 13h6"/><path d="M9 17h6"/>',
    stream: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
    filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
    play: '<polygon points="6 4 20 12 6 20 6 4"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    prev: '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/>',
    next: '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>',
    reload: '<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    restart: '<polygon points="11 19 2 12 11 5 11 19"/><polygon points="22 19 13 12 22 5 22 19"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    relay: '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"/>'
};

function adminApp() {
    return {
        view: 'projects',
        projectId: null,
        publicUrl: '',
        projects: [],
        machines: [],
        deviceTypes: [],
        toast: '',
        // scene/media explorer state (keyed by scene id)
        expanded: {}, files: {}, sel: {}, welcomeOpen: {},
        uploading: {}, uploadTarget: null,
        // overlays
        share: { open: false, url: '', title: '' },
        mediaModal: { open: false, pid: null, sid: null },
        stationModal: { open: false, pid: null, sid: null },
        typesModal: { open: false },
        typesEdit: [],
        lightbox: { open: false, files: [], index: 0 },
        // drag
        drag: { sid: null, from: -1, name: null },
        sceneDrag: { pid: null, from: -1, sid: null },
        // MIDI
        midiBus: null, midiPorts: [], consoleLearn: false,
        transportTargets: [
            { cmd: 'restart', label: 'Restart', icon: 'restart' },
            { cmd: 'prev', label: 'Prev', icon: 'prev' },
            { cmd: 'play', label: 'Play', icon: 'play' },
            { cmd: 'pause', label: 'Pause', icon: 'pause' },
            { cmd: 'next', label: 'Next', icon: 'next' },
            { cmd: 'reload', label: 'Reload', icon: 'reload' }
        ],
        socket: null, status: {}, autoScroll: true, autoplayOpts: {}, mediaFilterOpts: {}, crOpen: {},
        stationMidiMedia: {},   // station id -> active scene files (station modal, local MIDI)
        mediaTimers: {},        // scene id -> debounce timer for live media refresh

        icon(name) { return svgIcon(ICONS[name] || ''); },
        pad(n) { return String(n).padStart(2, '0'); },

        async init() {
            try { const c = await api('GET', '/config'); this.publicUrl = c.publicUrl || location.origin; }
            catch (e) { this.publicUrl = location.origin; }
            if (!this.publicUrl) this.publicUrl = location.origin;
            await this.loadAll();
            // history: we manage scroll ourselves so Back restores the prior view
            if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
            window.addEventListener('popstate', (e) => this.applyState(e.state || this.parseHash(), { fromPop: true }));
            this.go(this.parseHash(), { replace: true, initial: true });
            if (window.io) {
                this.socket = io();
                this.socket.on('connect', () => this.socket.emit('admin-join'));
                this.socket.on('status-snapshot', (snap) => { this.status = Object.assign({}, snap || {}); });
                this.socket.on('player-status', (m) => { if (m && m.machineId) { this.status[m.machineId] = m.status; this.maybeScroll(m.machineId); } });
                this.socket.on('scene-media', (m) => this.onSceneMedia(m));
            }
        },
        // a drop/upload changed a scene's media -> live-refresh the scene grid + per-station
        // clip grids (both read this.files[sceneId]) and the media counts. Debounced per
        // scene so a burst of audience uploads coalesces into one refetch.
        onSceneMedia(m) {
            const sceneId = m && m.sceneId; if (!sceneId) return;
            clearTimeout(this.mediaTimers[sceneId]);
            this.mediaTimers[sceneId] = setTimeout(async () => {
                const p = this.projects.find(x => (x.sources || []).some(s => s.id === sceneId));
                const s = p && p.sources.find(x => x.id === sceneId);
                if (p && s && this.files[sceneId] !== undefined) await this.refreshSceneFiles(p, s);
                await this.loadProjects();   // media counts on scene cards
            }, 350);
        },
        // refetch a scene's files, keeping any current bulk-selection on files that remain
        async refreshSceneFiles(p, s) {
            try {
                const r = await api('GET', `/projects/${p.id}/sources/${s.id}/files`);
                this.files[s.id] = r.files;
                if (this.sel[s.id]) { const present = new Set(r.files.map(f => f.name)); for (const k of Object.keys(this.sel[s.id])) if (!present.has(k)) delete this.sel[s.id][k]; }
            } catch (e) { /* ignore transient */ }
        },
        notify(m) { this.toast = m; setTimeout(() => { if (this.toast === m) this.toast = ''; }, 2000); },
        async guard(fn) { try { await fn(); } catch (e) { this.notify('Error: ' + e.message); } },
        base() { return (this.publicUrl || location.origin).replace(/\/$/, ''); },
        dropUrl(s) { return this.base() + '/d/' + s.dropToken; },
        machineUrl(m) { return this.base() + '/p/' + m.token; },
        qrPng(d) { return '/admin/api/qr?type=png&data=' + encodeURIComponent(d); },

        async loadAll() { await this.loadProjects(); await this.loadMachines(); await this.loadDeviceTypes(); },
        async loadProjects() { this.projects = (await api('GET', '/projects')).projects; },
        async loadMachines() { this.machines = (await api('GET', '/machines')).machines; },
        async loadDeviceTypes() { this.deviceTypes = (await api('GET', '/device-types')).deviceTypes || []; },
        project() { return this.projects.find(p => p.id === this.projectId) || null; },
        replaceProject(project) {
            const i = this.projects.findIndex(x => x.id === project.id);
            if (i >= 0) this.projects.splice(i, 1, project); else this.projects.push(project);
        },

        // ---- navigation + browser history ----------------------------------
        // projects · machines · workspace mirrored to the History API so back/
        // forward work (e.g. workspace -> machines -> Back returns to the workspace).
        hashFor(s) {
            if (s.view === 'workspace' && s.projectId) return '#/workspace/' + encodeURIComponent(s.projectId);
            if (s.view === 'machines') return '#/machines';
            return '#/projects';
        },
        parseHash() {
            const m = (location.hash || '').match(/^#\/(projects|machines|workspace)(?:\/([^/?]+))?/);
            if (!m) return { view: 'projects' };
            if (m[1] === 'workspace') return m[2] ? { view: 'workspace', projectId: decodeURIComponent(m[2]) } : { view: 'projects' };
            return { view: m[1] };
        },
        go(state, opts = {}) {
            if (!opts.replace && history.state) {
                try { history.replaceState(Object.assign({}, history.state, { scrollY: window.scrollY }), ''); } catch (e) {}
            }
            const data = { view: state.view || 'projects', projectId: state.projectId || null, scrollY: 0 };
            try { history[opts.replace ? 'replaceState' : 'pushState'](data, '', this.hashFor(data)); } catch (e) {}
            this.applyState(data, opts);
        },
        applyState(state, opts = {}) {
            state = state || { view: 'projects' };
            let view = state.view || 'projects';
            let projectId = state.projectId || null;
            if (view === 'workspace' && (!projectId || !this.projects.find(p => p.id === projectId))) { view = 'projects'; projectId = null; }
            this.view = view;
            this.projectId = projectId;
            if (view === 'workspace') {
                this.consoleLearn = false;
                const p = this.project();
                if (p) (p.sources || []).forEach(s => this.ensureFiles(p, s));
            }
            this.$nextTick(() => { window.scrollTo(0, opts.fromPop ? (state.scrollY || 0) : 0); });
        },
        openProject(p) { this.go({ view: 'workspace', projectId: p.id }); },
        goProjects() { this.go({ view: 'projects' }); },
        goMachines() { this.go({ view: 'machines' }); },

        // ---- share modal ----
        openShare(url, title) { this.share = { open: true, url, title: title || '' }; },
        closeShare() { this.share.open = false; },
        copyText(t) { navigator.clipboard.writeText(t).then(() => this.notify('Copied')); },
        async copyImage(url) {
            try { const b = await (await fetch(this.qrPng(url))).blob(); await navigator.clipboard.write([new ClipboardItem({ [b.type]: b })]); this.notify('QR image copied'); }
            catch (e) { this.notify('Copy not supported — use download'); }
        },
        async downloadImage(url, title) {
            try { const b = await (await fetch(this.qrPng(url))).blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'qr-' + (title || 'dropfile').replace(/[^a-z0-9]+/gi, '-') + '.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
            catch (e) { this.notify('Download failed'); }
        },

        // ---- projects ----
        createProject() {
            const name = (prompt('Project name', '') || '').trim(); if (!name) return;
            this.guard(async () => { const r = await api('POST', '/projects', { name }); await this.loadProjects(); this.openProject(r.project); });
        },
        renameProject(p) { const name = prompt('Project name', p.name); if (!name) return; this.guard(async () => { const r = await api('PUT', '/projects/' + p.id, { name }); this.replaceProject(r.project); }); },
        deleteProject(p) {
            if (!confirm('Delete project "' + p.name + '"? Media files stay on disk.')) return;
            this.guard(async () => { await api('DELETE', '/projects/' + p.id); await this.loadAll(); this.goProjects(); });
        },

        // ---- scenes ----
        addScene(p) { const name = prompt('Scene name', 'Scene'); if (name === null) return; this.guard(async () => { const r = await api('POST', '/projects/' + p.id + '/sources', { name: name.trim() || 'Scene' }); this.replaceProject(r.project); }); },
        renameScene(p, s) { const name = prompt('Scene name', s.name); if (!name) return; this.guard(async () => { const r = await api('PUT', `/projects/${p.id}/sources/${s.id}`, { name: name.trim() }); this.replaceProject(r.project); }); },
        deleteScene(p, s) { if (!confirm('Delete scene "' + s.name + '"? Files stay on disk.')) return; this.guard(async () => { const r = await api('DELETE', `/projects/${p.id}/sources/${s.id}`); this.replaceProject(r.project); delete this.expanded[s.id]; delete this.files[s.id]; delete this.sel[s.id]; delete this.welcomeOpen[s.id]; }); },
        toggleWelcome(s) { this.welcomeOpen[s.id] = !this.welcomeOpen[s.id]; },
        saveWelcome(p, s) { this.guard(async () => { const r = await api('PUT', `/projects/${p.id}/sources/${s.id}`, { welcome: s.welcome || '' }); this.replaceProject(r.project); }); },
        toggleSelfDelete(p, s) { this.guard(async () => { const r = await api('PUT', `/projects/${p.id}/sources/${s.id}`, { allowSelfDelete: !s.allowSelfDelete }); this.replaceProject(r.project); }); },
        acceptAll(s) { return !!(s.accept && s.accept.image && s.accept.video && s.accept.audio && s.accept.text && s.accept.stream); },
        setAcceptAll(p, s) { this.guard(async () => { const r = await api('PUT', `/projects/${p.id}/sources/${s.id}`, { accept: { image: true, video: true, audio: true, text: true, stream: true } }); this.replaceProject(r.project); }); },
        toggleAccept(p, s, kind) { const accept = Object.assign({ image: true, video: true, audio: false, text: false, stream: false }, s.accept || {}); accept[kind] = !accept[kind]; this.guard(async () => { const r = await api('PUT', `/projects/${p.id}/sources/${s.id}`, { accept }); this.replaceProject(r.project); }); },
        setStreamMode(p, s, mode) { this.guard(async () => { const r = await api('PUT', `/projects/${p.id}/sources/${s.id}`, { streamMode: mode }); this.replaceProject(r.project); }); },
        saveMaxChars(p, s) { const n = Math.floor(Number(s.maxChars)); const v = (Number.isFinite(n) && n >= 0) ? n : 140; s.maxChars = v; this.guard(async () => { const r = await api('PUT', `/projects/${p.id}/sources/${s.id}`, { maxChars: v }); this.replaceProject(r.project); }); },
        toggleRelay(p, s, kind) { const key = kind === 'image' ? 'relayImage' : 'relayText'; const patch = {}; patch[key] = !s[key]; this.guard(async () => { const r = await api('PUT', `/projects/${p.id}/sources/${s.id}`, patch); this.replaceProject(r.project); }); },

        // scene drag-reorder (handle = index chip)
        sceneDragStart(p, i, ev) { this.sceneDrag = { pid: p.id, from: i, sid: p.sources[i].id }; if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move'; },
        sceneDragOver(p, i) { if (this.sceneDrag.pid !== p.id || this.sceneDrag.from === i || i < 0) return; this.flip(document.querySelector(`[data-scenes="${p.id}"]`), p.sources, this.sceneDrag.from, i, 'sid'); this.sceneDrag.from = i; },
        sceneDragEnd(p) { if (this.sceneDrag.pid === p.id) this.guard(async () => { await api('PUT', `/projects/${p.id}/scene-order`, { order: p.sources.map(s => s.id) }); }); this.sceneDrag = { pid: null, from: -1, sid: null }; },
        isSceneDragging(p, s) { return this.sceneDrag.pid === p.id && this.sceneDrag.sid === s.id; },

        // ---- media explorer ----
        openMediaModal(p, s) { this.mediaModal = { open: true, pid: p.id, sid: s.id }; this.ensureFiles(p, s); },
        closeMediaModal() { this.mediaModal.open = false; },
        mediaModalScene() { const p = this.project(); if (!p || !this.mediaModal.open) return null; return p.sources.find(s => s.id === this.mediaModal.sid) || null; },
        async loadFiles(p, s) { await this.guard(async () => { const r = await api('GET', `/projects/${p.id}/sources/${s.id}/files`); this.files[s.id] = r.files; this.sel[s.id] = {}; }); },
        filesOf(s) { return this.files[s.id] || []; },
        ensureFiles(p, s) { if (!this.files[s.id]) this.loadFiles(p, s); },
        addMedia(p, s) { this.uploadTarget = { p, s }; this.$refs.fileInput.click(); },
        onUpload(e) {
            const input = e.target; const files = input.files; if (!files || !files.length) return;
            const { p, s } = this.uploadTarget || {}; if (!s) return;
            const fd = new FormData(); for (const f of files) fd.append('files', f);
            this.uploading[s.id] = true;
            fetch(`/admin/api/projects/${p.id}/sources/${s.id}/upload`, { method: 'POST', body: fd })
                .then(r => { if (!r.ok) throw new Error('upload failed'); })
                .then(async () => { await this.loadFiles(p, s); await this.loadProjects(); this.notify('Uploaded ' + files.length); })
                .catch(err => this.notify('Error: ' + err.message))
                .finally(() => { this.uploading[s.id] = false; input.value = ''; });
        },
        toggleSel(s, name) { this.sel[s.id] = this.sel[s.id] || {}; this.sel[s.id][name] = !this.sel[s.id][name]; },
        isSel(s, name) { return !!(this.sel[s.id] && this.sel[s.id][name]); },
        selNames(s) { const m = this.sel[s.id] || {}; return Object.keys(m).filter(n => m[n]); },
        selCount(s) { return this.selNames(s).length; },
        tileClick(s, idx) { const f = this.filesOf(s)[idx]; if (!f) return; if (this.selCount(s) > 0) this.toggleSel(s, f.name); else this.openLightbox(s, idx); },
        bulk(op, p, s) { const names = this.selNames(s); if (!names.length) return; if (op === 'delete' && !confirm('Permanently delete ' + names.length + ' file(s)?')) return; this.guard(async () => { const r = await api('POST', '/files/' + op, { projectId: p.id, sourceId: s.id, names }); await this.loadFiles(p, s); await this.loadProjects(); this.notify(op + ': ' + r.count); }); },
        mediaDragStart(s, i, ev) { this.drag = { sid: s.id, from: i, name: this.filesOf(s)[i].name }; if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move'; },
        mediaDragOver(s, i) { if (this.drag.sid !== s.id || this.drag.from === i || i < 0) return; this.flip(document.querySelector(`[data-grid="${s.id}"]`), this.files[s.id], this.drag.from, i, 'name'); this.drag.from = i; },
        mediaDragEnd(p, s) { if (this.drag.sid === s.id) this.guard(async () => { await api('PUT', `/projects/${p.id}/sources/${s.id}/order`, { order: this.files[s.id].map(f => f.name) }); }); this.drag = { sid: null, from: -1, name: null }; },
        isDragging(s, f) { return this.drag.sid === s.id && this.drag.name === f.name; },
        flip(container, arr, from, to, key) {
            if (!container) { const [m] = arr.splice(from, 1); arr.splice(to, 0, m); return; }
            const before = new Map();
            for (const c of container.children) { const k = c.getAttribute('data-' + key); if (k != null) before.set(k, c.getBoundingClientRect()); }
            const [m] = arr.splice(from, 1); arr.splice(to, 0, m);
            this.$nextTick(() => { for (const c of container.children) { const k = c.getAttribute('data-' + key); const f = k != null && before.get(k); if (!f) continue; const l = c.getBoundingClientRect(); const dx = f.left - l.left, dy = f.top - l.top; if (dx || dy) { c.style.transition = 'none'; c.style.transform = `translate(${dx}px,${dy}px)`; requestAnimationFrame(() => { c.style.transition = 'transform 170ms ease'; c.style.transform = ''; }); } } });
        },
        openLightbox(s, i) { this.lightbox = { open: true, files: this.files[s.id] || [], index: i }; },
        lbCurrent() { return this.lightbox.files[this.lightbox.index] || null; },
        lbStopVideo() { const v = document.querySelector('.lb-stage video'); if (v) { try { v.pause(); } catch (e) {} } },
        lbNext() { this.lbStopVideo(); const n = this.lightbox.files.length; if (n) this.lightbox.index = (this.lightbox.index + 1) % n; },
        lbPrev() { this.lbStopVideo(); const n = this.lightbox.files.length; if (n) this.lightbox.index = (this.lightbox.index - 1 + n) % n; },
        lbClose() { this.lbStopVideo(); this.lightbox.open = false; },

        // ---- machines (pool of physical boxes) ----
        reloadStations() { if (!confirm('Force every connected station to reload its page now? Picks up new code (JS/HTML/CSS); media stays cached, no reboot.')) return; this.guard(async () => { await api('POST', '/machines/reload'); this.notify('Reload sent to connected stations'); }); },
        createMachine() { const name = (prompt('Machine name (the label on the box)', '') || '').trim(); if (!name) return; this.guard(async () => { await api('POST', '/machines', { name }); await this.loadMachines(); }); },
        renameMachine(m) { const name = prompt('Machine name', m.name); if (!name) return; this.guard(async () => { const r = await api('PUT', '/machines/' + m.id, { name }); this.replaceMachine(r.machine); }); },
        deleteMachine(m) { if (!confirm('Delete machine "' + m.name + '"? It will be removed from every project that uses it.')) return; this.guard(async () => { await api('DELETE', '/machines/' + m.id); await this.loadAll(); }); },
        saveMachine(m) { this.guard(async () => { const r = await api('PUT', '/machines/' + m.id, { type: m.type || '', description: m.description || '' }); this.replaceMachine(r.machine); this.notify('Saved'); }); },
        replaceMachine(machine) { const i = this.machines.findIndex(x => x.id === machine.id); if (i >= 0) this.machines.splice(i, 1, machine); else this.machines.push(machine); },

        // ---- device types (editable list) ----
        openTypes() { this.typesEdit = (this.deviceTypes || []).slice(); this.typesModal.open = true; },
        closeTypes() { this.typesModal.open = false; },
        addType() { this.typesEdit.push(''); },
        removeType(i) { this.typesEdit.splice(i, 1); },
        saveTypes() { this.guard(async () => { const r = await api('PUT', '/device-types', { deviceTypes: this.typesEdit }); this.deviceTypes = r.deviceTypes; this.typesModal.open = false; this.notify('Device types saved'); }); },

        // ---- control room: stations (in the project serialization) ----
        availableMachines(p) { const used = new Set((p.stations || []).map(st => st.machineId)); return this.machines.filter(m => !used.has(m.id)); },
        addStation(p, machineId) {
            if (!machineId) return;
            const m = this.machines.find(x => x.id === machineId);
            const nickname = (prompt('Station nickname (e.g. "Totem screen")', m ? m.name : '') || '').trim();
            if (!nickname) return;
            this.guard(async () => { const r = await api('POST', '/projects/' + p.id + '/stations', { machineId, nickname }); this.replaceProject(r.project); });
        },
        removeStation(p, st) { if (!confirm('Remove station "' + st.nickname + '" from this project? (the machine stays in the pool)')) return; this.guard(async () => { const r = await api('DELETE', `/projects/${p.id}/stations/${st.id}`); this.replaceProject(r.project); }); },
        renameStation(p, st) { const name = prompt('Station nickname', st.nickname); if (!name) return; this.guard(async () => { const r = await api('PUT', `/projects/${p.id}/stations/${st.id}`, { nickname: name.trim() }); this.replaceProject(r.project); }); },

        isActiveScene(st, s) { return st.activeSceneId === s.id; },
        // which scene's media grid is open in this station's column (defaults to the active scene)
        openSceneId(st) { const v = this.crOpen[st.id]; return (v === undefined) ? st.activeSceneId : v; },
        isSceneOpen(st, s) { return this.openSceneId(st) === s.id; },
        toggleSceneOpen(st, s) {
            const cur = this.openSceneId(st);
            this.crOpen[st.id] = (cur === s.id) ? '' : s.id;     // accordion: one scene open at a time
            const p = this.project(); if (p) this.ensureFiles(p, s);
        },
        // click a scene -> start the whole scene (diaporama loop)
        playScene(p, st, s) {
            if (this.consoleLearn) return this.learnConsole(st.id, { type: 'scene', sceneId: s.id });
            this.guard(async () => { const r = await api('PUT', `/projects/${p.id}/stations/${st.id}/active`, { sceneId: s.id }); this.replaceProject(r.project); this.crOpen[st.id] = s.id; this.ensureFiles(p, s); });
        },
        // click a clip -> jump straight to it (held + looped), even from a non-active scene
        playClip(p, st, s, f) {
            if (this.consoleLearn) return this.learnConsole(st.id, { type: 'media', sceneId: s.id, name: f.name });
            this.guard(async () => {
                if (st.activeSceneId === s.id) {                 // already showing this scene -> just hold the clip
                    await api('POST', `/projects/${p.id}/stations/${st.id}/command`, { cmd: 'select', name: f.name });
                } else {                                         // one atomic activate+select -> no scene-loop flash
                    const r = await api('PUT', `/projects/${p.id}/stations/${st.id}/active`, { sceneId: s.id, name: f.name });
                    this.replaceProject(r.project); this.crOpen[st.id] = s.id;
                }
                this.notify('▸ ' + f.name);
            });
        },
        autoplay(p, st) { if (this.consoleLearn) return this.learnConsole(st.id, { type: 'autoplay' }); api('POST', `/projects/${p.id}/stations/${st.id}/command`, { cmd: 'autoplay' }).catch(() => {}); },
        transport(p, st, cmd) { if (this.consoleLearn) return this.learnConsole(st.id, { type: 'transport', cmd }); api('POST', `/projects/${p.id}/stations/${st.id}/command`, { cmd }).catch(() => {}); },
        blackout(p, st) { if (this.consoleLearn) return this.learnConsole(st.id, { type: 'blackout' }); api('POST', `/projects/${p.id}/stations/${st.id}/command`, { cmd: 'blackout' }).catch(() => {}); },
        stop(p, st) { if (this.consoleLearn) return this.learnConsole(st.id, { type: 'stop' }); this.guard(async () => { const r = await api('PUT', `/projects/${p.id}/stations/${st.id}/active`, { sceneId: '' }); this.replaceProject(r.project); }); },
        isStopped(st) { return !st.activeSceneId; },
        toggleAutoplayOpts(st) { this.autoplayOpts[st.id] = !this.autoplayOpts[st.id]; },
        // per-station media-type filter (which kinds of media this station displays)
        toggleMediaFilterOpts(st) { this.mediaFilterOpts[st.id] = !this.mediaFilterOpts[st.id]; },
        mediaFilterAll(st) { const f = st.mediaFilter || {}; return !!(f.image && f.video && f.audio && f.text && f.stream); },
        setMediaFilterAll(st) { st.mediaFilter = { image: true, video: true, audio: true, text: true, stream: true }; this.saveStationFilter(st); },
        toggleMediaFilter(st, kind) { const f = Object.assign({ image: true, video: true, audio: true, text: true, stream: true }, st.mediaFilter || {}); f[kind] = !f[kind]; st.mediaFilter = f; this.saveStationFilter(st); },
        saveStationFilter(st) { const p = this.project(); if (!p) return; this.guard(async () => { const r = await api('PUT', `/projects/${p.id}/stations/${st.id}`, { mediaFilter: st.mediaFilter }); this.replaceProject(r.project); this.notify('Applied live'); }); },

        // ---- live status (keyed by machine) ----
        statusLabel(st) {
            if (st.busyElsewhere) return '↗ ' + st.busyElsewhere;
            const s = this.status[st.machineId];
            if (!s) return '— no status';
            if (s.online === false) return 'offline';
            if (s.mode === 'stream') return '● live';
            if (s.mode === 'black') return '⬛ blackout';
            if (s.mode === 'stopped') return '⏹ stopped';
            if (s.mode === 'manual') return '▸ ' + (s.name || '?') + (s.paused ? ' · paused' : '');
            return '⟳ ' + (s.name || '?') + ' · ' + (((s.index | 0) + 1)) + '/' + (s.count || 0) + (s.paused ? ' · paused' : '');
        },
        statusClass(st) {
            if (st.busyElsewhere) return 'off';
            const s = this.status[st.machineId];
            if (!s || s.online === false) return 'off';
            if (s.mode === 'stream') return 'live';
            if (s.mode === 'diaporama' && !s.paused) return 'playing';
            if (s.mode === 'stopped' || s.mode === 'black') return 'off';
            return 'on';
        },
        isCurrentClip(st, f) { if (!st.driving) return false; const s = this.status[st.machineId]; return !!(s && (s.mode === 'manual' || s.mode === 'diaporama') && s.name === f.name); },
        isAutoplaying(st) { if (!st.driving) return false; const s = this.status[st.machineId]; return !!(s && s.mode === 'diaporama'); },
        maybeScroll(machineId) {
            if (!this.autoScroll) return;
            const s = this.status[machineId]; if (!s || !s.name) return;
            this.$nextTick(() => {
                const cont = document.querySelector(`[data-cr-clips="${machineId}"]`); if (!cont) return;
                const el = cont.querySelector(`[data-name="${(window.CSS && CSS.escape) ? CSS.escape(s.name) : s.name}"]`);
                if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            });
        },

        // ---- station settings modal (surface / playback / local MIDI) ----
        openStationModal(p, st) { this.stationModal = { open: true, pid: p.id, sid: st.id }; this.loadStationMidiMedia(st); },
        closeStationModal() { this.stationModal.open = false; },
        stationModalStation() { const p = this.project(); if (!p || !this.stationModal.open) return null; return (p.stations || []).find(st => st.id === this.stationModal.sid) || null; },
        saveStation(st) { const p = this.project(); if (!p) return; this.guard(async () => { await api('PUT', `/projects/${p.id}/stations/${st.id}`, { surface: st.surface, playback: st.playback }); this.notify('Applied live'); }); },
        loadStationMidiMedia(st) {
            const p = this.project();
            if (!p || !st.driving || !st.activeSceneId) { this.stationMidiMedia[st.id] = []; return; }
            api('GET', `/projects/${p.id}/sources/${st.activeSceneId}/files`).then(r => { this.stationMidiMedia[st.id] = r.files; }).catch(() => { this.stationMidiMedia[st.id] = []; });
        },
        stationMidiEnsureMap(st) { st.midi = st.midi || { map: {} }; st.midi.map = st.midi.map || {}; return st.midi.map; },
        smSame(a, b) { return a && b && a.type === b.type && (a.name || '') === (b.name || '') && (a.cmd || '') === (b.cmd || ''); },
        stationMidiKey(st, action) { const map = (st.midi && st.midi.map) || {}; for (const [k, a] of Object.entries(map)) if (this.smSame(a, action)) return window.midiKeyLabel(k); return 'unmapped'; },
        async stationMidiLearn(st, action) { await this.ensureMidi(); if (!this.midiBus) return; this.notify('Press a pad…'); this.midiBus.learnNext((key) => { const map = this.stationMidiEnsureMap(st); for (const k of Object.keys(map)) if (this.smSame(map[k], action)) delete map[k]; map[key] = action; this.stationMidiSave(st); }); },
        stationMidiSave(st) { const p = this.project(); if (!p) return; this.guard(async () => { await api('PUT', `/projects/${p.id}/stations/${st.id}`, { midi: { map: this.stationMidiEnsureMap(st) } }); this.notify('MIDI saved'); }); },

        // ---- console MIDI (operator desk, per workspace; targets stations) ----
        async ensureMidi() { if (this.midiBus || !window.MidiBus) return; const bus = new MidiBus(); bus.onpress = (k) => this.onMidiPress(k); bus.onports = (n) => { this.midiPorts = n; }; try { await bus.init(); this.midiBus = bus; } catch (e) { this.midiBus = null; this.notify('Web MIDI unavailable'); } },
        async toggleConsoleLearn() { await this.ensureMidi(); this.consoleLearn = !this.consoleLearn; this.notify(this.consoleLearn ? 'MIDI learn: click a trigger, then press a pad' : 'MIDI learn off'); },
        consoleMap() { const p = this.project(); if (!p) return {}; p.console = p.console || { map: {} }; return p.console.map; },
        sameAction(a, b) { return a && b && a.type === b.type && (a.sceneId || '') === (b.sceneId || '') && (a.name || '') === (b.name || '') && (a.cmd || '') === (b.cmd || ''); },
        consoleKey(stId, action) { const map = this.consoleMap(); for (const [k, v] of Object.entries(map)) if (v.stationId === stId && this.sameAction(v.action, action)) return window.midiKeyLabel(k); return ''; },
        async learnConsole(stId, action) {
            await this.ensureMidi(); if (!this.midiBus) return;
            this.notify('Press a pad…');
            this.midiBus.learnNext((key) => {
                const map = this.consoleMap();
                for (const k of Object.keys(map)) if (map[k].stationId === stId && this.sameAction(map[k].action, action)) delete map[k];
                map[key] = { stationId: stId, action };
                this.saveConsole();
            });
        },
        saveConsole() { const p = this.project(); if (!p) return; this.guard(async () => { await api('PUT', '/projects/' + p.id + '/console', { map: this.consoleMap() }); this.notify('MIDI saved'); }); },
        onMidiPress(key) {
            if (this.view !== 'workspace' || this.consoleLearn) return;
            const p = this.project(); if (!p) return;
            const bind = (p.console && p.console.map || {})[key]; if (!bind) return;
            const st = (p.stations || []).find(x => x.id === bind.stationId); if (!st) return;
            this.dispatchConsole(p, st, bind.action);
        },
        dispatchConsole(p, st, a) {
            const base = `/projects/${p.id}/stations/${st.id}`;
            if (a.type === 'scene') api('PUT', base + '/active', { sceneId: a.sceneId }).then(r => this.replaceProject(r.project)).catch(() => {});
            else if (a.type === 'media') api('PUT', base + '/active', { sceneId: a.sceneId, name: a.name }).then(r => this.replaceProject(r.project)).catch(() => {});
            else if (a.type === 'autoplay') api('POST', base + '/command', { cmd: 'autoplay' }).catch(() => {});
            else if (a.type === 'transport') api('POST', base + '/command', { cmd: a.cmd }).catch(() => {});
            else if (a.type === 'blackout') api('POST', base + '/command', { cmd: 'blackout' }).catch(() => {});
            else if (a.type === 'stop') api('PUT', base + '/active', { sceneId: '' }).then(r => this.replaceProject(r.project)).catch(() => {});
        },

        fmtSize(n) { if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(0) + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; }
    };
}
window.adminApp = adminApp;
