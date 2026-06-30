// KXKM chat-style drop box. A familiar messaging UI: send text, pick or shoot
// photos/videos, record a voice message, or go live with the camera. The
// timeline shows only what *you* sent (each device tracked by a local visitor
// id). The composer adapts to what the scene accepts. A hook is left for future
// server-broadcast messages (they'd append as .msg.them).
(function () {
    const token = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
    const $ = id => document.getElementById(id);

    // ---- inline icons (stroke, currentColor) ----
    const ICONS = {
        video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m22 8-6 4 6 4V8Z"/>',
        user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
        send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/>',
        image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.35-4.35a2 2 0 0 0-2.83 0L5 19"/>',
        camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3.5"/>',
        mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/>',
        music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
        stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
        check: '<path d="M20 6 9 17l-5-5"/>',
        close: '<path d="M18 6 6 18M6 6l12 12"/>'
    };
    function svg(name) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>'; }
    function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

    // device identity + remembered nick (cookie)
    let visitor = localStorage.getItem('df_visitor');
    if (!visitor) { visitor = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now()); localStorage.setItem('df_visitor', visitor); }
    function getCookie(n) { return (document.cookie.split('; ').find(c => c.startsWith(n + '=')) || '').split('=')[1] || ''; }
    function setCookie(n, v) { document.cookie = n + '=' + encodeURIComponent(v) + ';path=/;max-age=' + (3600 * 24 * 365); }
    let nick = decodeURIComponent(getCookie('df_nick') || '');

    const timeline = $('timeline');
    let accept = { image: true, video: true, audio: false, text: false, stream: false };
    let allowSelfDelete = false;
    let ICE = [];
    let sender = null;

    let serverItems = [];        // my uploads from the server
    let pending = [];            // optimistic bubbles still uploading
    let pendId = 1;

    // ---- static icons ----
    $('sendBtn').innerHTML = svg('send');
    $('liveBtn').innerHTML = svg('video');
    $('recClose').innerHTML = svg('close');
    document.querySelector('.nick-ic').innerHTML = svg('user');

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
    function requireNick(fn) { if (!nick) showNick(true); else fn(); }
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

    function mediaFamilies() {
        const f = [];
        if (accept.image) f.push('image');
        if (accept.video) f.push('video');
        if (accept.audio) f.push('audio');
        return f;
    }
    const familyWord = { image: 'photo', video: 'video', audio: 'audio' };
    const familyIcon = { image: 'image', video: 'video', audio: 'mic' };

    function setupComposer() {
        const fam = mediaFamilies();

        // header: go-live camera button
        if (accept.stream) $('liveBtn').classList.remove('hidden');

        // text field + send button
        if (!accept.text) { $('textInput').classList.add('hidden'); $('sendBtn').classList.add('hidden'); }

        // attach / media button
        const attachBtn = $('attachBtn');
        if (!fam.length) attachBtn.classList.add('hidden');
        else {
            const single = fam.length === 1 ? fam[0] : null;
            // a dedicated, labelled button when the scene is one media family only
            // (e.g. audio-only -> "Send audio"); grouped "+" media icon otherwise.
            if (single && !accept.text) {
                attachBtn.classList.add('labeled');
                $('attachIc').innerHTML = svg(familyIcon[single]);
                $('attachLabel').textContent = 'Send ' + familyWord[single];
            } else {
                attachBtn.classList.remove('labeled');
                $('attachIc').innerHTML = svg('image');
            }
        }

        // an empty composer (stream-only) is hidden entirely
        if (!accept.text && !fam.length) $('composer').classList.add('hidden');

        // library picker accepts whatever AV the scene takes
        const av = [];
        if (accept.image) av.push('image/*');
        if (accept.video) av.push('video/*');
        $('fileInput').setAttribute('accept', av.join(','));

        // empty-state hint
        const hint = $('emptyHint');
        const txt = (!accept.text && !fam.length && accept.stream)
            ? 'Tap the camera in the top bar to go live on the big screen.'
            : 'Only you can see what you send here — it appears on the big screen.';
        hint.innerHTML = '<span class="lock">🔒</span>' + esc(txt);

        updateSend();
    }

    // ---- composer events ----
    $('textInput').addEventListener('input', updateSend);
    $('composer').addEventListener('submit', e => { e.preventDefault(); sendText(); });
    $('attachBtn').onclick = () => requireNick(openSheet);
    $('liveBtn').onclick = () => requireNick(startCamera);

    function updateSend() {
        if (!accept.text) return;
        const has = $('textInput').value.trim().length > 0;
        $('sendBtn').classList.toggle('off', !has);
    }

    // ---- attachment action sheet ----
    function openSheet() { buildSheet(); $('sheet').classList.remove('hidden'); }
    function closeSheet() { $('sheet').classList.add('hidden'); }
    $('sheetBack').onclick = closeSheet;
    $('sheetCancel').onclick = closeSheet;

    function row(cls, icon, title, sub, fn) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'sheet-row'; b.setAttribute('role', 'menuitem');
        b.innerHTML = '<span class="ic ' + cls + '">' + svg(icon) + '</span><span class="lbl">' + esc(title) + '<small>' + esc(sub) + '</small></span>';
        b.onclick = () => { closeSheet(); fn(); };
        return b;
    }
    function buildSheet() {
        const rows = $('sheetRows');
        rows.innerHTML = '';
        if (accept.image) rows.appendChild(row('cam-photo', 'camera', 'Camera', 'Take a photo', () => $('photoCapture').click()));
        if (accept.video) rows.appendChild(row('cam-video', 'video', 'Video camera', 'Record a video', () => $('videoCapture').click()));
        if (accept.image || accept.video) {
            const lib = (accept.image && accept.video) ? 'Photo & video library' : (accept.image ? 'Photo library' : 'Video library');
            rows.appendChild(row('library', 'image', lib, 'Choose from your device', () => $('fileInput').click()));
        }
        if (accept.audio) rows.appendChild(row('rec-audio', 'mic', 'Record audio', 'Record a voice message', openRecorder));
        if (accept.audio) rows.appendChild(row('lib-audio', 'music', 'Audio file', 'Choose an audio file', () => $('audioPick').click()));
        const only = mediaFamilies();
        $('sheetTitle').textContent = (only.length === 1 && only[0] === 'audio') ? 'Send audio' : 'Send media';
    }

    // ---- file pickers ----
    function onPick(e) { const files = [...e.target.files]; e.target.value = ''; uploadFiles(files); }
    $('fileInput').addEventListener('change', onPick);
    $('photoCapture').addEventListener('change', onPick);
    $('videoCapture').addEventListener('change', onPick);
    $('audioPick').addEventListener('change', onPick);

    // ---- send text (optimistic) ----
    function sendText() {
        const ta = $('textInput'); const text = ta.value.trim();
        if (!text) return;
        if (!nick) return showNick(true);
        ta.value = ''; updateSend();
        const p = { id: 'p' + (pendId++), type: 'text', text, time: Date.now(), state: 'sending' };
        pending.push(p); render();
        fetch('/api/drop/' + token + '/text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, nick, visitor }) })
            .then(r => r.ok ? r.json() : Promise.reject(r))
            .then(() => { dropPending(p); loadMine(); })
            .catch(() => { p.state = 'error'; markPending(p); toast('Message not sent'); });
    }

    // ---- upload files (optimistic + progress) ----
    function uploadFiles(files) {
        files = (files || []).filter(Boolean);
        if (!files.length) return;
        if (!nick) return showNick(true);
        files.forEach(uploadOne);
    }
    function guessType(file) {
        const t = (file.type || '').split('/')[0];
        if (t === 'image' || t === 'video' || t === 'audio') return t;
        const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
        if (['.mp3', '.m4a', '.aac', '.wav', '.weba', '.oga', '.opus', '.flac'].includes(ext)) return 'audio';
        if (['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv'].includes(ext)) return 'video';
        if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'].includes(ext)) return 'image';
        return 'file';
    }
    function uploadOne(file) {
        const type = guessType(file);
        const p = { id: 'p' + (pendId++), type, time: Date.now(), state: 'sending', name: file.name };
        if (type === 'image' || type === 'video' || type === 'audio') { try { p.url = URL.createObjectURL(file); } catch (e) {} }
        pending.push(p); render();
        const fd = new FormData();
        // nick/visitor before the file so multer's filename() sees the real nick
        // (the on-disk name carries it; the player reads the sender from there).
        fd.append('nick', nick); fd.append('visitor', visitor); fd.append('file', file);
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/drop/' + token);
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) { dropPending(p); loadMine(); }
            else { p.state = 'error'; markPending(p); toast(httpErr(xhr)); }
        };
        xhr.onerror = () => { p.state = 'error'; markPending(p); toast('Upload failed — check your connection'); };
        xhr.send(fd);
    }
    function httpErr(xhr) {
        if (xhr.status === 415) return 'That file type isn’t accepted here';
        try { const j = JSON.parse(xhr.responseText); if (j && j.error) return j.error; } catch (e) {}
        return 'Upload failed';
    }
    function dropPending(p) { pending = pending.filter(x => x !== p); if (p.url) { try { URL.revokeObjectURL(p.url); } catch (e) {} } }
    function markPending(p) {
        const el = timeline.querySelector('[data-pid="' + p.id + '"]');
        if (!el) { render(); return; }
        el.classList.add('error'); el.classList.remove('sending');
        const meta = el.querySelector('.msg-meta span'); if (meta) meta.textContent = 'Not sent';
        const ov = el.querySelector('.sending'); if (ov) ov.remove();
    }

    function removeMsg(fileId) {
        fetch('/api/drop/' + token + '/' + fileId + '?visitor=' + encodeURIComponent(visitor), { method: 'DELETE' })
            .then(r => r.ok ? r.json() : Promise.reject()).then(loadMine).catch(() => toast('Could not delete'));
    }

    // ---- timeline ----
    function loadMine() {
        fetch('/api/drop/' + token + '/mine?visitor=' + encodeURIComponent(visitor))
            .then(r => r.json())
            .then(data => { allowSelfDelete = data.allowSelfDelete; serverItems = data.uploads || []; render(); })
            .catch(() => {});
    }

    function dayLabel(ms) {
        const d = new Date(ms), now = new Date();
        const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
        if (sameDay(d, now)) return 'Today';
        const y = new Date(now); y.setDate(now.getDate() - 1);
        if (sameDay(d, y)) return 'Yesterday';
        try { return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }); } catch (e) { return d.toDateString(); }
    }

    function render() {
        const items = serverItems.slice().sort((a, b) => a.time - b.time)
            .concat(pending.map(p => Object.assign({ pending: true }, p)));
        timeline.querySelectorAll('.msg, .day-sep').forEach(n => n.remove());
        let lastDay = '';
        items.forEach(u => {
            const dl = dayLabel(u.time);
            if (dl !== lastDay) { lastDay = dl; const sep = document.createElement('div'); sep.className = 'day-sep'; sep.textContent = dl; timeline.appendChild(sep); }
            timeline.appendChild(bubble(u));
        });
        $('emptyHint').classList.toggle('hidden', items.length > 0);
        timeline.scrollTop = timeline.scrollHeight;
    }

    function bubble(u) {
        const wrap = document.createElement('div');
        wrap.className = 'msg me' + (u.pending ? ' sending' : '') + (u.state === 'error' ? ' error' : '') + (u.type === 'text' ? ' text' : '');
        if (u.pending) wrap.dataset.pid = u.id;

        const body = document.createElement('div'); body.className = 'msg-body';
        if (u.type === 'image' && u.url) { body.classList.add('media'); const img = document.createElement('img'); img.src = u.url; img.loading = 'lazy'; body.appendChild(img); }
        else if (u.type === 'video' && u.url) { body.classList.add('media'); const v = document.createElement('video'); v.src = u.url; v.controls = true; v.playsInline = true; v.preload = 'metadata'; body.appendChild(v); }
        else if (u.type === 'audio' && u.url) { body.classList.add('audio'); const mic = document.createElement('span'); mic.className = 'mic'; mic.innerHTML = svg('mic'); body.appendChild(mic); const a = document.createElement('audio'); a.src = u.url; a.controls = true; a.preload = 'metadata'; body.appendChild(a); }
        else if (u.type === 'text') {
            body.classList.add('text');
            if (u.pending) body.textContent = u.text;
            else { body.textContent = '…'; fetch(u.url).then(r => r.text()).then(t => { body.textContent = t; }).catch(() => { body.textContent = '(text)'; }); }
        }
        else { body.classList.add('text'); body.textContent = u.name || '(file)'; }

        // sending overlay (spinner) for media bubbles in flight
        if (u.pending && u.type !== 'text') { const ov = document.createElement('div'); ov.className = 'sending'; ov.innerHTML = '<span class="spinner"></span>'; body.appendChild(ov); }
        wrap.appendChild(body);

        const meta = document.createElement('div'); meta.className = 'msg-meta';
        const tm = document.createElement('span'); tm.textContent = u.state === 'error' ? 'Not sent' : fmtTime(u.time); meta.appendChild(tm);
        if (!u.pending) { const tick = document.createElement('span'); tick.className = 'tick'; tick.innerHTML = svg('check'); meta.appendChild(tick); }
        if (!u.pending && allowSelfDelete) { const del = document.createElement('button'); del.className = 'msg-del'; del.textContent = 'Delete'; del.onclick = () => removeMsg(u.fileId); meta.appendChild(del); }
        wrap.appendChild(meta);
        return wrap;
    }

    function fmtTime(ms) { try { return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }

    // ---- audio recorder (MediaRecorder) ----
    let mediaRec = null, recChunks = [], recStream = null, recBlob = null, recMime = '', recTimer = null, recStart = 0;
    function pickAudioMime() {
        const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4', 'audio/aac'];
        for (const m of cands) { if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m; }
        return '';
    }
    function extForMime(m) {
        m = m || '';
        if (/mp4|aac|m4a/.test(m)) return '.m4a';
        if (/ogg/.test(m)) return '.oga';
        return '.weba';
    }
    function openRecorder() { requireNick(() => { resetRecorder(); $('recOverlay').classList.remove('hidden'); }); }
    function resetRecorder() {
        recBlob = null; recChunks = [];
        $('recOverlay').classList.remove('recording');
        const pv = $('recPreview'); pv.classList.add('hidden'); pv.pause && pv.pause(); pv.removeAttribute('src');
        $('recRetake').classList.add('hidden'); $('recSend').classList.add('hidden');
        const tog = $('recToggle'); tog.classList.remove('hidden'); tog.innerHTML = svg('mic');
        $('recHint').textContent = 'Tap the mic to start';
        $('recTime').textContent = '0:00';
    }
    $('recToggle').onclick = () => { if (mediaRec && mediaRec.state === 'recording') stopRec(); else startRec(); };
    async function startRec() {
        if (!window.MediaRecorder) { toast('Recording isn’t supported on this browser'); return; }
        try { recStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
        catch (e) { toast('Microphone permission denied'); return; }
        recMime = pickAudioMime();
        try { mediaRec = recMime ? new MediaRecorder(recStream, { mimeType: recMime }) : new MediaRecorder(recStream); }
        catch (e) { mediaRec = new MediaRecorder(recStream); }
        recChunks = [];
        mediaRec.ondataavailable = e => { if (e.data && e.data.size) recChunks.push(e.data); };
        mediaRec.onstop = onRecStop;
        mediaRec.start();
        recStart = Date.now();
        $('recOverlay').classList.add('recording');
        $('recToggle').innerHTML = svg('stop');
        $('recHint').textContent = 'Recording… tap to stop';
        recTimer = setInterval(tickRec, 200);
    }
    function tickRec() {
        const s = Math.floor((Date.now() - recStart) / 1000);
        $('recTime').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
        if (s >= 300) stopRec();          // 5-minute cap
    }
    function stopRec() {
        if (recTimer) { clearInterval(recTimer); recTimer = null; }
        try { if (mediaRec && mediaRec.state !== 'inactive') mediaRec.stop(); } catch (e) {}
        $('recOverlay').classList.remove('recording');
    }
    function onRecStop() {
        if (recStream) { recStream.getTracks().forEach(t => t.stop()); recStream = null; }
        const type = (mediaRec && mediaRec.mimeType) || recMime || 'audio/webm';
        recBlob = new Blob(recChunks, { type });
        const pv = $('recPreview'); pv.src = URL.createObjectURL(recBlob); pv.classList.remove('hidden');
        $('recToggle').classList.add('hidden');
        $('recRetake').classList.remove('hidden');
        $('recSend').classList.remove('hidden');
        $('recHint').textContent = 'Listen back, then send';
    }
    $('recRetake').onclick = resetRecorder;
    $('recSend').onclick = () => {
        if (!recBlob) return;
        const ext = extForMime(recBlob.type || recMime);
        let file;
        try { file = new File([recBlob], 'voice' + ext, { type: recBlob.type || 'audio/webm' }); }
        catch (e) { file = recBlob; file.name = 'voice' + ext; }
        closeRecorder();
        uploadFiles([file]);
    };
    $('recClose').onclick = closeRecorder;
    function closeRecorder() {
        stopRec();
        if (recStream) { recStream.getTracks().forEach(t => t.stop()); recStream = null; }
        $('recOverlay').classList.add('hidden');
    }

    // ---- toast ----
    let toastTimer = null;
    function toast(msg) {
        const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
    }

    // ---- live camera ----
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
