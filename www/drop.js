// KXKM chat-style drop box. Send text / photos / video, or go live with the
// camera. The timeline shows only what *you* sent (each device tracked by a
// local visitor id). A hook is left for future server-broadcast messages.
(function () {
    const token = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');

    // device identity + remembered nick (cookie)
    let visitor = localStorage.getItem('df_visitor');
    if (!visitor) { visitor = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now()); localStorage.setItem('df_visitor', visitor); }
    function getCookie(n) { return (document.cookie.split('; ').find(c => c.startsWith(n + '=')) || '').split('=')[1] || ''; }
    function setCookie(n, v) { document.cookie = n + '=' + encodeURIComponent(v) + ';path=/;max-age=' + (3600 * 24 * 365); }
    let nick = decodeURIComponent(getCookie('df_nick') || '');

    const $ = id => document.getElementById(id);
    const timeline = $('timeline');
    let accept = { image: true, video: true, text: false, stream: false };
    let allowSelfDelete = false;
    let ICE = [];
    let sender = null;

    // ---- nickname ----
    function showNick(force) {
        $('nickField').value = nick || '';
        $('nickModal').classList.remove('hidden');
        $('nickField').focus();
        $('nickModal').dataset.force = force ? '1' : '';
    }
    function saveNick() {
        const v = $('nickField').value.replace(/ /g, '_').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20);
        if (v.length < 2) { $('nickField').focus(); return; }
        nick = v; setCookie('df_nick', v);
        $('nickName').textContent = nick;
        $('nickModal').classList.add('hidden');
    }
    $('nickSave').onclick = saveNick;
    $('nickField').addEventListener('keydown', e => { if (e.key === 'Enter') saveNick(); });
    $('nickBtn').onclick = () => showNick(false);

    // ---- meta ----
    fetch('/api/drop/' + token).then(r => r.ok ? r.json() : Promise.reject()).then(info => {
        $('sub').textContent = (info.project || '') + (info.source ? ' · ' + info.source : '');
        accept = info.accept || accept;
        allowSelfDelete = info.allowSelfDelete;
        ICE = info.ice || [];
        setupComposer();
        if (!nick) showNick(true); else $('nickName').textContent = nick;
        loadMine();
    }).catch(() => { $('sub').textContent = 'unknown'; });

    function setupComposer() {
        if (!accept.text) { $('textInput').classList.add('hidden'); $('sendBtn').classList.add('hidden'); }
        if (!(accept.image || accept.video)) $('attachBtn').classList.add('hidden');
        else {
            const types = []; if (accept.image) types.push('image/*'); if (accept.video) types.push('video/*');
            $('fileInput').setAttribute('accept', types.join(','));
        }
        if (accept.stream) $('liveBtn').classList.remove('hidden');
    }

    // ---- send ----
    $('composer').addEventListener('submit', e => { e.preventDefault(); sendText(); });
    $('attachBtn').onclick = () => requireNick(() => $('fileInput').click());
    $('fileInput').addEventListener('change', e => { const files = [...e.target.files]; e.target.value = ''; uploadFiles(files); });
    $('liveBtn').onclick = () => requireNick(startCamera);

    function requireNick(fn) { if (!nick) { showNick(true); } else fn(); }

    function sendText() {
        const ta = $('textInput'); const text = ta.value.trim();
        if (!text) return;
        if (!nick) return showNick(true);
        ta.value = '';
        fetch('/api/drop/' + token + '/text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, nick, visitor }) })
            .then(r => r.ok ? r.json() : Promise.reject()).then(loadMine).catch(() => {});
    }

    function uploadFiles(files) {
        if (!files.length || !nick) { if (!nick) showNick(true); return; }
        let i = 0;
        const next = () => {
            if (i >= files.length) return loadMine();
            const fd = new FormData();
            fd.append('file', files[i]); fd.append('nick', nick); fd.append('visitor', visitor);
            fetch('/api/drop/' + token, { method: 'POST', body: fd }).then(() => { i++; loadMine(); next(); }).catch(() => { i++; next(); });
        };
        next();
    }

    function removeMsg(fileId) {
        fetch('/api/drop/' + token + '/' + fileId + '?visitor=' + encodeURIComponent(visitor), { method: 'DELETE' }).then(loadMine);
    }

    // ---- timeline ----
    function loadMine() {
        fetch('/api/drop/' + token + '/mine?visitor=' + encodeURIComponent(visitor))
            .then(r => r.json())
            .then(data => { allowSelfDelete = data.allowSelfDelete; render((data.uploads || []).slice().sort((a, b) => a.time - b.time)); })
            .catch(() => {});
    }

    function render(items) {
        const atBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 80;
        timeline.innerHTML = '';
        items.forEach(u => timeline.appendChild(bubble(u)));
        if (atBottom || true) timeline.scrollTop = timeline.scrollHeight;
    }

    function bubble(u) {
        const wrap = document.createElement('div');
        wrap.className = 'msg me';
        const body = document.createElement('div'); body.className = 'msg-body';
        if (u.type === 'image') { const img = document.createElement('img'); img.src = u.url; img.loading = 'lazy'; body.appendChild(img); }
        else if (u.type === 'video') { const v = document.createElement('video'); v.src = u.url; v.controls = true; v.playsInline = true; body.appendChild(v); }
        else if (u.type === 'text') { body.classList.add('text'); fetch(u.url).then(r => r.text()).then(t => { body.textContent = t; }).catch(() => { body.textContent = '(text)'; }); }
        else { body.classList.add('text'); body.textContent = u.name; }
        wrap.appendChild(body);

        const meta = document.createElement('div'); meta.className = 'msg-meta';
        meta.textContent = fmtTime(u.time);
        if (allowSelfDelete) { const del = document.createElement('button'); del.className = 'msg-del'; del.textContent = 'delete'; del.onclick = () => removeMsg(u.fileId); meta.appendChild(del); }
        wrap.appendChild(meta);
        return wrap;
    }

    function fmtTime(ms) { try { return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }

    // ---- camera ----
    function startCamera() {
        $('camOverlay').classList.remove('hidden');
        const status = $('camStatus');
        sender = new CameraSender({ token, ice: ICE, getNick: () => nick || 'anon', preview: $('camPreview'), onStatus: s => { status.textContent = s; } });
        sender.start().catch(e => { status.textContent = 'Camera error: ' + (e.message || e); });
        $('camFlip').onclick = () => sender && sender.flip().catch(() => {});
        $('camStop').onclick = stopCamera;
    }
    function stopCamera() { if (sender) { sender.stop(); sender = null; } $('camOverlay').classList.add('hidden'); }

    // ---- future: server broadcast messages would append here as .msg.them ----
})();
