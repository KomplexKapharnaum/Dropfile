// KXKM chat-style drop box. A familiar messaging UI: send text, pick or shoot
// photos/videos, record a voice message, or go live with the camera. The
// timeline shows only what *you* sent (each device tracked by a local visitor
// id). The composer adapts to what the scene accepts. A hook is left for future
// server-broadcast messages (they'd append as .msg.them).
(function () {
    const token = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
    const $ = id => document.getElementById(id);

    // ---- i18n (English / French, by browser language; fallback English) ----
    const STR = {
        en: {
            live_title: 'Go live with your camera', nick_title: 'Your name', attach_title: 'Add media',
            ph_message: 'Message…', send: 'Send', cancel: 'Cancel', ok: 'OK',
            nick_h: 'Your name', nick_hint: 'Shown on the screen with what you send.', nick_ph: 'e.g. Alex',
            rec_title: 'Voice message', rec_start: 'Tap the mic to start', rec_recording: 'Recording… tap to stop',
            rec_listen: 'Listen back, then send', retake: 'Retake', close: 'Close',
            cam_live_badge: '● LIVE', cam_starting: 'starting…', cam_flip: '↺ Flip camera', cam_stop: '■ Stop',
            empty_stream: 'Tap the camera in the top bar to go live on the big screen.',
            empty_default: 'Only you can see what you send here — it appears on the big screen.',
            send_image: 'Send photo', send_video: 'Send video', send_audio: 'Send audio',
            row_camera: 'Camera', row_camera_sub: 'Take a photo',
            row_video: 'Video camera', row_video_sub: 'Record a video',
            row_lib_both: 'Photo & video library', row_lib_photo: 'Photo library', row_lib_video: 'Video library',
            row_lib_sub: 'Choose from your device',
            row_rec: 'Record audio', row_rec_sub: 'Record a voice message',
            row_audiofile: 'Audio file', row_audiofile_sub: 'Choose an audio file',
            sheet_title_audio: 'Send audio', sheet_title_media: 'Send media',
            meta_notsent: 'Not sent', meta_delete: 'Delete',
            toast_msg_failed: 'Message not sent', toast_type: 'That file type isn’t accepted here',
            toast_upload_failed: 'Upload failed', toast_upload_conn: 'Upload failed — check your connection',
            toast_delete_failed: 'Could not delete', toast_rec_unsupported: 'Recording isn’t supported on this browser',
            toast_mic_denied: 'Microphone permission denied',
            day_today: 'Today', day_yesterday: 'Yesterday',
            cam_waiting: 'waiting for a screen…', cam_connecting: 'connecting…', cam_cannot: 'cannot start',
            cam_error: 'Camera error: ', cam_live: (n) => '● live · ' + n + ' screen' + (n > 1 ? 's' : '')
        },
        fr: {
            live_title: 'Filmer en direct', nick_title: 'Votre nom', attach_title: 'Ajouter un média',
            ph_message: 'Message…', send: 'Envoyer', cancel: 'Annuler', ok: 'OK',
            nick_h: 'Votre nom', nick_hint: 'Affiché à l’écran avec ce que vous envoyez.', nick_ph: 'ex. Alex',
            rec_title: 'Message vocal', rec_start: 'Touchez le micro pour démarrer', rec_recording: 'Enregistrement… touchez pour arrêter',
            rec_listen: 'Réécoutez, puis envoyez', retake: 'Recommencer', close: 'Fermer',
            cam_live_badge: '● EN DIRECT', cam_starting: 'démarrage…', cam_flip: '↺ Changer de caméra', cam_stop: '■ Arrêter',
            empty_stream: 'Touchez la caméra en haut pour passer en direct sur le grand écran.',
            empty_default: 'Vous seul voyez ce que vous envoyez ici — cela apparaît sur le grand écran.',
            send_image: 'Envoyer photo', send_video: 'Envoyer vidéo', send_audio: 'Envoyer audio',
            row_camera: 'Appareil photo', row_camera_sub: 'Prendre une photo',
            row_video: 'Caméra vidéo', row_video_sub: 'Filmer une vidéo',
            row_lib_both: 'Photos et vidéos', row_lib_photo: 'Photothèque', row_lib_video: 'Vidéothèque',
            row_lib_sub: 'Choisir sur votre appareil',
            row_rec: 'Enregistrer un audio', row_rec_sub: 'Enregistrer un message vocal',
            row_audiofile: 'Fichier audio', row_audiofile_sub: 'Choisir un fichier audio',
            sheet_title_audio: 'Envoyer un audio', sheet_title_media: 'Envoyer un média',
            meta_notsent: 'Non envoyé', meta_delete: 'Supprimer',
            toast_msg_failed: 'Message non envoyé', toast_type: 'Ce type de fichier n’est pas accepté ici',
            toast_upload_failed: 'Échec de l’envoi', toast_upload_conn: 'Échec de l’envoi — vérifiez votre connexion',
            toast_delete_failed: 'Suppression impossible', toast_rec_unsupported: 'L’enregistrement n’est pas pris en charge sur ce navigateur',
            toast_mic_denied: 'Accès au microphone refusé',
            day_today: 'Aujourd’hui', day_yesterday: 'Hier',
            cam_waiting: 'en attente d’un écran…', cam_connecting: 'connexion…', cam_cannot: 'impossible de démarrer',
            cam_error: 'Erreur caméra : ', cam_live: (n) => '● en direct · ' + n + ' écran' + (n > 1 ? 's' : '')
        }
    };
    function pickLang() {
        const prefs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ''];
        for (const p of prefs) { const c = String(p).toLowerCase(); if (c.startsWith('fr')) return 'fr'; if (c.startsWith('en')) return 'en'; }
        return 'en';
    }
    const lang = pickLang();
    const D = Object.assign({}, STR.en, STR[lang] || {});
    const t = (k) => (D[k] != null ? D[k] : k);
    document.documentElement.lang = lang;

    // apply translations to static markup tagged with data-i18n / -title / -ph
    function applyI18n() {
        document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
        document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.getAttribute('data-i18n-title')); });
        document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
    }
    applyI18n();

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
    let welcome = '';            // operator's intro message, shown as an incoming bubble
    let autoReplies = [];        // scripted bot answers: one sent after each of my contributions
    let maxChars = 140;          // text-input cap from the scene; 0 = unlimited
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
    // apply the scene config (accept types, intro, auto-answers, text cap). Called
    // once on load and again whenever the operator edits it (live 'drop-meta' push).
    function applyMeta(info) {
        accept = info.accept || accept;
        if (typeof info.allowSelfDelete === 'boolean') allowSelfDelete = info.allowSelfDelete;
        welcome = (info.welcome || '').trim();
        if (Array.isArray(info.autoReplies)) autoReplies = info.autoReplies;
        if (typeof info.maxChars === 'number' && info.maxChars >= 0) maxChars = Math.floor(info.maxChars);
        setupComposer();
        render();
    }
    fetch('/api/drop/' + token).then(r => r.ok ? r.json() : Promise.reject()).then(info => {
        $('sub').textContent = (info.project || '') + (info.source ? ' · ' + info.source : '');
        ICE = info.ice || [];
        applyMeta(info);
        if (!nick) showNick(true); else $('nickName').textContent = nick;
        loadMine();
        connectMeta();
    }).catch(() => { $('sub').textContent = 'unknown'; });

    // live config: operator edits to the intro / auto-answers / accepted types are
    // pushed to this open page. Best-effort — the page works fine without it.
    let metaSocket = null;
    function connectMeta() {
        if (!window.io || metaSocket) return;
        try { metaSocket = io(); } catch (e) { return; }
        const join = () => metaSocket.emit('drop-join', token);
        metaSocket.on('connect', join);
        if (metaSocket.connected) join();
        metaSocket.on('drop-meta', (m) => { if (m) applyMeta(m); });
    }

    function mediaFamilies() {
        const f = [];
        if (accept.image) f.push('image');
        if (accept.video) f.push('video');
        if (accept.audio) f.push('audio');
        return f;
    }
    const familyIcon = { image: 'image', video: 'video', audio: 'mic' };

    function setupComposer() {
        const fam = mediaFamilies();

        // header: go-live camera button (toggles both ways — accept can change live)
        $('liveBtn').classList.toggle('hidden', !accept.stream);

        // text field + send button
        const noText = !accept.text;
        $('textInput').classList.toggle('hidden', noText);
        $('sendBtn').classList.toggle('hidden', noText);
        if (!noText) {
            if (maxChars > 0) $('textInput').setAttribute('maxlength', String(maxChars));
            else $('textInput').removeAttribute('maxlength');
        }

        // attach / media button
        const attachBtn = $('attachBtn');
        attachBtn.classList.toggle('hidden', !fam.length);
        if (fam.length) {
            const single = fam.length === 1 ? fam[0] : null;
            // a dedicated, labelled button when the scene is one media family only
            // (e.g. audio-only -> "Send audio"); grouped "+" media icon otherwise.
            if (single && !accept.text) {
                attachBtn.classList.add('labeled');
                $('attachIc').innerHTML = svg(familyIcon[single]);
                $('attachLabel').textContent = t('send_' + single);
            } else {
                attachBtn.classList.remove('labeled');
                $('attachIc').innerHTML = svg('image');
            }
        }

        // an empty composer (stream-only) is hidden entirely
        $('composer').classList.toggle('hidden', !accept.text && !fam.length);

        // library picker accepts whatever AV the scene takes
        const av = [];
        if (accept.image) av.push('image/*');
        if (accept.video) av.push('video/*');
        $('fileInput').setAttribute('accept', av.join(','));

        // empty-state hint
        const hint = $('emptyHint');
        const txt = (!accept.text && !fam.length && accept.stream) ? t('empty_stream') : t('empty_default');
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
        if (accept.image) rows.appendChild(row('cam-photo', 'camera', t('row_camera'), t('row_camera_sub'), () => $('photoCapture').click()));
        if (accept.video) rows.appendChild(row('cam-video', 'video', t('row_video'), t('row_video_sub'), () => $('videoCapture').click()));
        if (accept.image || accept.video) {
            const lib = (accept.image && accept.video) ? t('row_lib_both') : (accept.image ? t('row_lib_photo') : t('row_lib_video'));
            rows.appendChild(row('library', 'image', lib, t('row_lib_sub'), () => $('fileInput').click()));
        }
        if (accept.audio) rows.appendChild(row('rec-audio', 'mic', t('row_rec'), t('row_rec_sub'), openRecorder));
        if (accept.audio) rows.appendChild(row('lib-audio', 'music', t('row_audiofile'), t('row_audiofile_sub'), () => $('audioPick').click()));
        const only = mediaFamilies();
        $('sheetTitle').textContent = (only.length === 1 && only[0] === 'audio') ? t('sheet_title_audio') : t('sheet_title_media');
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
            .catch(() => { p.state = 'error'; markPending(p); toast(t('toast_msg_failed')); });
    }

    // ---- upload files (optimistic + progress) ----
    function uploadFiles(files) {
        files = (files || []).filter(Boolean);
        if (!files.length) return;
        if (!nick) return showNick(true);
        files.forEach(uploadOne);
    }
    function guessType(file) {
        const mt = (file.type || '').split('/')[0];
        if (mt === 'image' || mt === 'video' || mt === 'audio') return mt;
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
        xhr.onerror = () => { p.state = 'error'; markPending(p); toast(t('toast_upload_conn')); };
        xhr.send(fd);
    }
    function httpErr(xhr) {
        return xhr.status === 415 ? t('toast_type') : t('toast_upload_failed');
    }
    function dropPending(p) { pending = pending.filter(x => x !== p); if (p.url) { try { URL.revokeObjectURL(p.url); } catch (e) {} } }
    function markPending(p) {
        const el = timeline.querySelector('[data-pid="' + p.id + '"]');
        if (!el) { render(); return; }
        el.classList.add('error'); el.classList.remove('sending');
        const meta = el.querySelector('.msg-meta span'); if (meta) meta.textContent = t('meta_notsent');
        const ov = el.querySelector('.sending'); if (ov) ov.remove();
    }

    function removeMsg(fileId) {
        fetch('/api/drop/' + token + '/' + fileId + '?visitor=' + encodeURIComponent(visitor), { method: 'DELETE' })
            .then(r => r.ok ? r.json() : Promise.reject()).then(loadMine).catch(() => toast(t('toast_delete_failed')));
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
        if (sameDay(d, now)) return t('day_today');
        const y = new Date(now); y.setDate(now.getDate() - 1);
        if (sameDay(d, y)) return t('day_yesterday');
        try { return d.toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short' }); } catch (e) { return d.toDateString(); }
    }

    function render() {
        const confirmed = serverItems.slice().sort((a, b) => a.time - b.time);
        timeline.querySelectorAll('.msg, .day-sep').forEach(n => n.remove());
        if (welcome) timeline.appendChild(incomingBubble(welcome, 'welcome'));   // pinned intro at the top
        let lastDay = '';
        const daySep = (ms) => {
            const dl = dayLabel(ms);
            if (dl !== lastDay) { lastDay = dl; const sep = document.createElement('div'); sep.className = 'day-sep'; sep.textContent = dl; timeline.appendChild(sep); }
        };
        // my confirmed contributions, each followed by the next scripted auto-answer
        // (line 1 after the 1st, line 2 after the 2nd, …) — like a chat bot.
        let replyIdx = 0;
        confirmed.forEach(u => {
            daySep(u.time);
            timeline.appendChild(bubble(u));
            if (replyIdx < autoReplies.length) timeline.appendChild(incomingBubble(autoReplies[replyIdx++], 'bot'));
        });
        // in-flight (optimistic) bubbles — their auto-answer arrives once they confirm
        pending.forEach(p => { const u = Object.assign({ pending: true }, p); daySep(u.time); timeline.appendChild(bubble(u)); });
        // the welcome message already gives instructions, so suppress the generic empty hint when it's set
        $('emptyHint').classList.toggle('hidden', (confirmed.length + pending.length) > 0 || !!welcome);
        timeline.scrollTop = timeline.scrollHeight;
    }

    // operator message (intro or a scripted auto-answer): an incoming (left-aligned)
    // text bubble, no time/tick/delete.
    function incomingBubble(text, extraClass) {
        const wrap = document.createElement('div');
        wrap.className = 'msg them text ' + (extraClass || '');
        const body = document.createElement('div'); body.className = 'msg-body text';
        body.textContent = text;
        wrap.appendChild(body);
        return wrap;
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
            else { body.textContent = '…'; fetch(u.url).then(r => r.text()).then(txt => { body.textContent = txt; }).catch(() => { body.textContent = '(text)'; }); }
        }
        else { body.classList.add('text'); body.textContent = u.name || '(file)'; }

        // sending overlay (spinner) for media bubbles in flight
        if (u.pending && u.type !== 'text') { const ov = document.createElement('div'); ov.className = 'sending'; ov.innerHTML = '<span class="spinner"></span>'; body.appendChild(ov); }
        wrap.appendChild(body);

        const meta = document.createElement('div'); meta.className = 'msg-meta';
        const tm = document.createElement('span'); tm.textContent = u.state === 'error' ? t('meta_notsent') : fmtTime(u.time); meta.appendChild(tm);
        if (!u.pending) { const tick = document.createElement('span'); tick.className = 'tick'; tick.innerHTML = svg('check'); meta.appendChild(tick); }
        if (!u.pending && allowSelfDelete) { const del = document.createElement('button'); del.className = 'msg-del'; del.textContent = t('meta_delete'); del.onclick = () => removeMsg(u.fileId); meta.appendChild(del); }
        wrap.appendChild(meta);
        return wrap;
    }

    function fmtTime(ms) { try { return new Date(ms).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }

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
        $('recHint').textContent = t('rec_start');
        $('recTime').textContent = '0:00';
    }
    $('recToggle').onclick = () => { if (mediaRec && mediaRec.state === 'recording') stopRec(); else startRec(); };
    async function startRec() {
        if (!window.MediaRecorder) { toast(t('toast_rec_unsupported')); return; }
        try { recStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
        catch (e) { toast(t('toast_mic_denied')); return; }
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
        $('recHint').textContent = t('rec_recording');
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
        $('recHint').textContent = t('rec_listen');
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
        const el = $('toast'); el.textContent = msg; el.classList.remove('hidden');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
    }

    // ---- live camera ----
    function startCamera() {
        $('camOverlay').classList.remove('hidden');
        const status = $('camStatus');
        const labels = { waiting: t('cam_waiting'), connecting: t('cam_connecting'), cannotStart: t('cam_cannot'), live: D.cam_live };
        sender = new CameraSender({ token, ice: ICE, getNick: () => nick || 'anon', preview: $('camPreview'), onStatus: s => { status.textContent = s; }, labels });
        sender.start().catch(e => { status.textContent = t('cam_error') + (e.message || e); });
        $('camFlip').onclick = () => sender && sender.flip().catch(() => {});
        $('camStop').onclick = stopCamera;
    }
    function stopCamera() { if (sender) { sender.stop(); sender = null; } $('camOverlay').classList.add('hidden'); }

    // Incoming operator messages (the pinned intro + scripted auto-answers) render
    // as .msg.them via incomingBubble(); a live 'drop-meta' push refreshes them.
})();
