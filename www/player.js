// Player display engine: canvas compositor (LED scaler) + diaporama/manual
// playback + live control over Socket.IO. The server holds authoritative state,
// so a reload/restart resumes the current source automatically.
//
// Compositor rules:
//  - container 'full'   -> canvas fills the window.
//  - container 'custom' -> canvas is EXACTLY width×height device pixels (no
//    fit-to-window scaling — LED walls have no scaler), placed on screen via
//    posX/posY (+offset); the stage clips overflow.
//  - evenLineSuppression -> the whole composite is squashed vertically to 50%
//    (e.g. 256×640 -> 256×320), deforming the image; the semi-transparent panel
//    re-expands it across its present rows. Not black bars.
(function () {
    const token = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');

    const canvas = document.getElementById('surface');
    const ctx = canvas.getContext('2d');
    const statusEl = document.getElementById('status');
    const overlay = document.getElementById('overlay');
    const counter = document.getElementById('counter');

    const img = new Image();
    img.crossOrigin = 'anonymous';
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.crossOrigin = 'anonymous';
    const audioEl = new Audio();            // dropped voice notes / music clips (unmuted)
    audioEl.crossOrigin = 'anonymous';

    let settings = defaultSettings();
    let active = null;          // active scene info (incl. stream flag/mode)
    let playlist = [];
    let queue = [];
    let index = 0;
    let fresh = [];
    let playingFresh = false;
    let current = null;
    let timer = null;
    let rafId = null;
    let paused = false;
    let blackedOut = false;
    let textContent = '';       // current text clip's body (when current.type === 'text')
    let midi = null;
    // camera takeover
    let receiver = null;
    let streaming = false;
    let streamRaf = null;

    function defaultSettings() {
        return {
            playMode: 'diaporama', imageDuration: 5, loop: 'all', lastX: 20, prioritizeFresh: true,
            scaler: {
                container: 'full', width: 0, height: 0,
                posX: 'center', offsetX: 0, posY: 'center', offsetY: 0,
                fit: 'contain', rotation: 0, evenLineSuppression: false
            }
        };
    }

    // ---- socket ----
    const socket = io();
    receiver = new StreamReceiver({ token, socket, onChange: onStreamChange });
    socket.on('connect', () => { socket.emit('player-join', token); setStatus(''); });
    socket.on('disconnect', () => setStatus('reconnecting…'));
    socket.on('settings', (s) => { settings = s; layout(); if (learnEl && !learnEl.classList.contains('hidden')) buildLearn(); });
    socket.on('active-change', (data) => {
        active = data.active || null;
        playlist = data.media || [];
        if (data.playMode) settings.playMode = data.playMode;   // scene-loop vs held clip
        buildQueue();
        updateStreamMembership();
        if (!streaming) {
            // a directly-picked clip jumps straight to it (no scene-loop first)
            if (data.selectedName && settings.playMode === 'manual') { selectByName(data.selectedName); if (!current) start(); }
            else start();
        }
    });
    socket.on('new-media', (m) => { fresh.push(m); updateCounter(); });
    socket.on('command', (c) => {
        const cmd = (typeof c === 'string') ? c : (c && c.cmd);
        if (cmd === 'autoplay') { settings.playMode = 'diaporama'; start(); }
        else if (cmd === 'select') { settings.playMode = 'manual'; selectByName(c.name); }
        else if (cmd === 'blackout') setBlackout(c.on === undefined ? !blackedOut : !!c.on);
        else doTransport(cmd);
    });

    function setStatus(msg) {
        statusEl.textContent = msg;
        overlay.style.display = msg ? 'flex' : 'none';
    }

    // report what we're showing, for the admin control room
    function emitStatus() {
        let mode = 'stopped', name = null;
        if (streaming) mode = 'stream';
        else if (blackedOut) mode = 'black';
        else if (current) { mode = (settings.playMode === 'manual') ? 'manual' : 'diaporama'; name = current.name; }
        else if (!queue.length) mode = 'stopped';
        else mode = (settings.playMode === 'manual') ? 'manual' : 'diaporama';
        try { socket.emit('player-status', { token, status: { online: true, mode, name, index: streaming ? -1 : index, count: queue.length, paused, blackout: blackedOut } }); } catch (e) {}
    }

    function reload() {
        fetch('/api/player/' + token)
            .then(r => r.ok ? r.json() : Promise.reject(new Error('unknown player')))
            .then(state => {
                settings = state.settings || defaultSettings();
                active = state.active || null;
                playlist = state.media || [];
                if (state.ice && receiver) receiver.ice = state.ice;
                layout();
                buildQueue();
                updateStreamMembership();
                if (!streaming) {
                    if (settings.playMode === 'manual' && state.selectedName) { selectByName(state.selectedName); if (!current) start(); }
                    else start();
                }
                if (!state.active) { setStatus('No source selected'); emitStatus(); }
            })
            .catch(e => setStatus(String(e.message || e)));
    }

    // ---- playlist shaping (loop / lastX) ----
    function buildQueue() {
        let list = playlist.slice();
        if (settings.loop === 'lastX' && settings.lastX > 0) list = list.slice(-settings.lastX);
        queue = list;
        if (index >= queue.length) index = 0;
    }

    function start() {
        if (streaming) return;          // a live stream owns the canvas — don't run the playlist under it
        clearTimers();
        paused = false;
        playingFresh = false;
        index = 0;
        if (!queue.length && !fresh.length) { current = null; setStatus(active ? 'No media in this scene' : 'No source selected'); clearCanvas(); emitStatus(); return; }
        setStatus('');
        next(true);
    }

    function next(fromStart) {
        if (streaming) return;
        clearTimers();
        if (settings.prioritizeFresh && fresh.length) { playingFresh = true; show(fresh.shift()); return; }
        if (playingFresh) playingFresh = false;
        if (!queue.length) {
            if (fresh.length) { playingFresh = true; show(fresh.shift()); }
            else setStatus('No media');
            return;
        }
        if (!fromStart) index++;
        if (index >= queue.length) { reloadPlaylist(); return; }
        show(queue[index]);
    }

    function prev() {
        if (streaming || playingFresh) return;
        clearTimers();
        index = Math.max(0, index - 1);
        show(queue[index]);
    }

    function reloadPlaylist() {
        fetch('/api/player/' + token + '/playlist')
            .then(r => r.json())
            .then(data => {
                playlist = data.media || [];
                buildQueue();
                index = 0;
                if (queue.length) show(queue[0]); else setStatus('No media');
            })
            .catch(() => { index = 0; if (queue.length) show(queue[0]); });
    }

    // ---- transport (admin remote) ----
    function pause() {
        if (streaming) return;
        paused = true;
        clearTimers();
        if (current && current.type === 'video') video.pause();
        else if (current && current.type === 'audio') audioEl.pause();
        emitStatus();
    }
    function play() {
        if (streaming || !paused) return;
        paused = false;
        if (!current) { start(); return; }
        if (current.type === 'video') { const p = video.play(); if (p && p.catch) p.catch(() => {}); }
        else if (current.type === 'audio') { const p = audioEl.play(); if (p && p.catch) p.catch(() => {}); }
        else scheduleNext();
        emitStatus();
    }
    function restart() {
        if (streaming) return;
        paused = false;
        clearTimers();
        if (!queue.length) { reloadPlaylist(); return; }
        index = 0;
        show(queue[0]);
    }

    function doTransport(cmd) {
        if (cmd === 'next') next();
        else if (cmd === 'prev') prev();
        else if (cmd === 'reload') reload();
        else if (cmd === 'pause') pause();
        else if (cmd === 'play') play();
        else if (cmd === 'restart') restart();
    }

    // jump straight to a media item by filename (MIDI / admin select)
    function selectByName(name) {
        if (!name) return;
        clearTimers(); paused = false;
        if (blackedOut) setBlackout(false);
        const qi = queue.findIndex(m => m.name === name);
        if (qi >= 0) { index = qi; show(queue[qi]); return; }
        const item = playlist.find(m => m.name === name);
        if (item) show(item);
    }

    function setBlackout(on) {
        blackedOut = on;
        if (on) { clearTimers(); clearCanvas(); if (current && current.type === 'audio') audioEl.pause(); }
        else if (!streaming && current) {
            redraw();
            if (current.type === 'audio' && !paused) { const p = audioEl.play(); if (p && p.catch) p.catch(() => {}); }
        }
        emitStatus();
    }

    // ---- MIDI dispatch ----
    function handleMidi(key) {
        const map = (settings.midi && settings.midi.map) || {};
        const a = map[key];
        if (!a) return;
        if (a.type === 'media') selectByName(a.name);
        else if (a.type === 'transport') doTransport(a.cmd);
        else if (a.type === 'blackout') setBlackout(!blackedOut);
    }

    // ---- MIDI learn overlay (press 'm' on the player machine) ----
    const learnEl = document.getElementById('midiLearn');
    function toggleLearn() {
        if (!learnEl) return;
        if (learnEl.classList.contains('hidden')) { buildLearn(); learnEl.classList.remove('hidden'); }
        else { learnEl.classList.add('hidden'); if (midi) midi.cancelLearn(); }
    }
    function midiMap() { settings.midi = settings.midi || { map: {} }; settings.midi.map = settings.midi.map || {}; return settings.midi.map; }
    function sameAction(a, b) { return a && b && a.type === b.type && (a.name || '') === (b.name || '') && (a.cmd || '') === (b.cmd || ''); }
    function keyForAction(action) { const map = midiMap(); for (const [k, a] of Object.entries(map)) if (sameAction(a, action)) return k; return null; }
    function unbind(action) { const map = midiMap(); for (const k of Object.keys(map)) if (sameAction(map[k], action)) delete map[k]; persistMidi(); buildLearn(); }
    function arm(action, keyEl) {
        if (!midi) { keyEl.textContent = 'no MIDI'; return; }
        keyEl.textContent = 'press a pad…';
        midi.learnNext((key) => {
            const map = midiMap();
            for (const k of Object.keys(map)) if (sameAction(map[k], action)) delete map[k];
            map[key] = action;
            persistMidi(); buildLearn();
        });
    }
    function persistMidi() {
        fetch('/api/player/' + token + '/midi', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ map: midiMap() }) }).catch(() => {});
    }
    function buildLearn() {
        if (!learnEl) return;
        document.getElementById('mlPorts').textContent = (midi && midi.inputs && midi.inputs.length) ? ('in: ' + midi.inputs.map(i => i.name).join(', '))
            : (midi && midi.supported ? 'no MIDI input detected' : 'Web MIDI not supported');
        const actions = document.getElementById('mlActions');
        actions.innerHTML = '';
        [['restart', '⏮'], ['prev', '◀'], ['play', '▶'], ['pause', '⏸'], ['next', '▶▶'], ['reload', '⟲']]
            .forEach(([cmd, label]) => actions.appendChild(targetEl({ type: 'transport', cmd }, label)));
        actions.appendChild(targetEl({ type: 'blackout' }, '⬛ black'));
        const grid = document.getElementById('mlGrid');
        grid.innerHTML = '';
        const list = queue.length ? queue : playlist;
        if (!list.length) { grid.innerHTML = '<span class="ml-empty">No media in this scene.</span>'; return; }
        list.forEach(m => grid.appendChild(mediaTargetEl(m)));
    }
    function targetEl(action, label) {
        const div = document.createElement('div'); div.className = 'ml-target';
        const k = keyForAction(action);
        const btn = document.createElement('button'); btn.className = 'ml-btn'; btn.textContent = label;
        const key = document.createElement('span'); key.className = 'ml-key'; key.textContent = k ? midiKeyLabel(k) : 'unmapped';
        btn.onclick = () => arm(action, key);
        div.appendChild(btn); div.appendChild(key);
        if (k) { const x = document.createElement('button'); x.className = 'ml-x'; x.textContent = '×'; x.onclick = () => unbind(action); div.appendChild(x); }
        return div;
    }
    function mediaTargetEl(m) {
        const div = document.createElement('div'); div.className = 'ml-tile';
        const action = { type: 'media', name: m.name };
        const k = keyForAction(action);
        if (m.type === 'image') { const img = document.createElement('img'); img.src = m.url; div.appendChild(img); }
        else { const ph = document.createElement('div'); ph.className = 'ml-ph'; ph.textContent = m.type === 'text' ? 'T' : m.type === 'audio' ? '♪' : '▶'; div.appendChild(ph); }
        const key = document.createElement('span'); key.className = 'ml-key'; key.textContent = k ? midiKeyLabel(k) : 'tap to learn';
        div.appendChild(key);
        div.onclick = () => arm(action, key);
        if (k) { const x = document.createElement('button'); x.className = 'ml-x'; x.textContent = '×'; x.onclick = (e) => { e.stopPropagation(); unbind(action); }; div.appendChild(x); }
        return div;
    }

    if (window.MidiBus) {
        midi = new MidiBus();
        midi.onpress = handleMidi;
        midi.onports = () => { if (learnEl && !learnEl.classList.contains('hidden')) buildLearn(); };
        midi.init().catch(() => {});
    }

    function show(item) {
        if (streaming) return;          // never draw/play playlist media while a stream is live
        current = item;
        setStatus('');
        updateCounter();
        emitStatus();
        stopRaf();
        stopAudio();
        video.onended = null;

        if (item.type === 'image') {
            img.onload = () => { redraw(); scheduleNext(); };
            img.onerror = () => scheduleNext();
            img.src = item.url;
            if (img.complete && img.naturalWidth) { redraw(); scheduleNext(); }
        } else if (item.type === 'text') {
            textContent = '';
            fetch(item.url).then(r => r.text())
                .then(t => { textContent = String(t || '').slice(0, 1500); redraw(); scheduleNext(); })
                .catch(() => { textContent = ''; redraw(); scheduleNext(); });
        } else if (item.type === 'audio') {
            // play the clip and paint a "now playing" card; advance on end (diaporama)
            redraw();
            audioEl.loop = (settings.playMode === 'manual');
            audioEl.onended = () => { if (current === item && settings.playMode !== 'manual') next(); };
            audioEl.onerror = () => { if (current === item && settings.playMode !== 'manual') next(); };
            audioEl.src = item.url;
            audioEl.currentTime = 0;
            const p = audioEl.play();
            if (p && p.catch) p.catch(() => {});
            if (paused || blackedOut) audioEl.pause();
        } else {
            video.onloadeddata = () => startRaf();
            // a manually-selected clip loops itself; in diaporama it advances on end
            video.loop = (settings.playMode === 'manual');
            video.onended = () => { if (settings.playMode !== 'manual') next(); };
            video.src = item.url;
            video.currentTime = 0;
            const p = video.play();
            if (p && p.catch) p.catch(() => {});
            if (paused) video.pause();
        }
    }

    function scheduleNext() {
        if (paused || streaming) return;
        if (settings.playMode === 'diaporama') timer = setTimeout(next, Math.max(1, settings.imageDuration) * 1000);
    }
    function clearTimers() { if (timer) { clearTimeout(timer); timer = null; } }
    function stopRaf() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
    function stopAudio() { audioEl.onended = null; audioEl.onerror = null; try { audioEl.pause(); } catch (e) {} }
    function startRaf() { if (streaming) return; stopRaf(); const loop = () => { redraw(); rafId = requestAnimationFrame(loop); }; loop(); }

    // ---- compositor ----
    function container() {
        const sc = settings.scaler;
        if (sc.container === 'custom' && sc.width > 0 && sc.height > 0) return { w: sc.width, h: sc.height };
        return { w: window.innerWidth, h: window.innerHeight };
    }

    function placeX(mode, off, w) {
        const W = window.innerWidth;
        if (mode === 'left') return 0;
        if (mode === 'right') return W - w;
        if (mode === 'custom') return Number(off) || 0;
        return (W - w) / 2;
    }
    function placeY(mode, off, h) {
        const H = window.innerHeight;
        if (mode === 'top') return 0;
        if (mode === 'bottom') return H - h;
        if (mode === 'custom') return Number(off) || 0;
        return (H - h) / 2;
    }

    function layout() {
        const sc = settings.scaler;
        const C = container();
        const even = !!sc.evenLineSuppression;
        const outH = even ? Math.max(1, Math.round(C.h / 2)) : C.h;

        canvas.width = C.w;          // buffer = output pixels (1:1 on screen)
        canvas.height = outH;
        canvas.style.width = C.w + 'px';
        canvas.style.height = outH + 'px';

        let left = 0, top = 0;
        if (sc.container === 'custom') {
            left = placeX(sc.posX, sc.offsetX, C.w);
            top = placeY(sc.posY, sc.offsetY, outH);
        }
        canvas.style.left = Math.round(left) + 'px';
        canvas.style.top = Math.round(top) + 'px';
        if (streaming) drawStreams(); else redraw();
    }

    function clearCanvas() { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); }

    function mediaIntrinsic() {
        if (!current) return null;
        if (current.type === 'image') {
            if (!img.naturalWidth) return null;
            return { el: img, w: img.naturalWidth, h: img.naturalHeight };
        }
        if (!video.videoWidth) return null;
        return { el: video, w: video.videoWidth, h: video.videoHeight };
    }

    function fittedSize(srcW, srcH, boxW, boxH, fit) {
        const sr = srcW / srcH, br = boxW / boxH;
        const widthBound = (fit === 'cover') ? (sr < br) : (sr > br);
        return widthBound ? { w: boxW, h: boxW / sr } : { w: boxH * sr, h: boxH };
    }

    function redraw() {
        clearCanvas();
        if (blackedOut) return;
        if (current && current.type === 'text') { drawText(); return; }
        if (current && current.type === 'audio') { drawAudioCard(); return; }
        const m = mediaIntrinsic();
        if (!m) return;
        const sc = settings.scaler;
        const C = container();

        ctx.save();
        // squash the whole composite into the (possibly halved) canvas height
        ctx.scale(canvas.width / C.w, canvas.height / C.h);

        const rot = ((sc.rotation % 360) + 360) % 360;
        const swap = (rot === 90 || rot === 270);
        const box = { w: swap ? C.h : C.w, h: swap ? C.w : C.h };
        const size = fittedSize(m.w, m.h, box.w, box.h, sc.fit);

        ctx.translate(C.w / 2, C.h / 2);
        if (rot) ctx.rotate(rot * Math.PI / 180);
        try { ctx.drawImage(m.el, -size.w / 2, -size.h / 2, size.w, size.h); } catch (e) {}
        ctx.restore();
    }

    // draw the current text clip, auto-fitted and centred, honouring rotation +
    // the even-line squash (same transform setup as the image path).
    function drawText() {
        const sc = settings.scaler;
        const C = container();
        ctx.save();
        ctx.scale(canvas.width / C.w, canvas.height / C.h);
        const rot = ((sc.rotation % 360) + 360) % 360;
        const swap = (rot === 90 || rot === 270);
        const boxW = swap ? C.h : C.w, boxH = swap ? C.w : C.h;
        ctx.translate(C.w / 2, C.h / 2);
        if (rot) ctx.rotate(rot * Math.PI / 180);
        drawWrappedText((textContent || '').trim(), boxW, boxH);
        ctx.restore();
    }

    // draw a "now playing" card for an audio clip (same transform setup as text),
    // since audio has no picture — a waveform glyph + the sender's name.
    function drawAudioCard() {
        const sc = settings.scaler;
        const C = container();
        ctx.save();
        ctx.scale(canvas.width / C.w, canvas.height / C.h);
        const rot = ((sc.rotation % 360) + 360) % 360;
        const swap = (rot === 90 || rot === 270);
        const boxW = swap ? C.h : C.w, boxH = swap ? C.w : C.h;
        ctx.translate(C.w / 2, C.h / 2);
        if (rot) ctx.rotate(rot * Math.PI / 180);
        const bars = [0.35, 0.6, 0.85, 0.5, 1, 0.7, 0.4, 0.65, 0.9, 0.55, 0.3, 0.7, 0.45];
        const span = Math.min(boxW * 0.7, 560);
        const bw = span / (bars.length * 2);
        const maxH = Math.min(boxH * 0.34, 200);
        ctx.fillStyle = '#7cc4ff';
        bars.forEach((v, i) => {
            const h = Math.max(6, v * maxH);
            ctx.fillRect(-span / 2 + i * bw * 2, -h / 2, bw, h);
        });
        const label = audioLabel();
        ctx.fillStyle = '#cdd6e4';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const fsz = Math.max(16, Math.min(Math.round(boxH * 0.09), 64));
        ctx.font = `600 ${fsz}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
        ctx.fillText('♪ ' + label, 0, maxH / 2 + fsz * 1.6);
        ctx.restore();
    }

    // sender label from the on-disk filename ("<nick>_<ts>_<id>.<ext>")
    function audioLabel() {
        const n = (current && current.name) || '';
        const nick = n.split('_')[0];
        return (nick && /[a-zA-Z0-9]/.test(nick)) ? nick : 'Audio';
    }

    function wrapText(text, maxW, fontSpec) {
        ctx.font = fontSpec;
        const out = [];
        for (const para of text.split('\n')) {
            const words = para.split(/\s+/).filter(Boolean);
            if (!words.length) { out.push(''); continue; }
            let line = '';
            for (const w of words) {
                const test = line ? line + ' ' + w : w;
                if (ctx.measureText(test).width > maxW && line) { out.push(line); line = w; }
                else line = test;
            }
            out.push(line);
        }
        return out;
    }

    function drawWrappedText(text, boxW, boxH) {
        if (!text) return;
        const maxW = boxW * 0.86, maxH = boxH * 0.86;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        let size = Math.max(12, Math.min(Math.round(boxH * 0.5), 240));
        let lines = [];
        const fontAt = (px) => `600 ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
        for (; size >= 12; size -= Math.max(2, Math.round(size * 0.08))) {
            lines = wrapText(text, maxW, fontAt(size));
            const widest = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
            if (lines.length * size * 1.25 <= maxH && widest <= maxW) break;
        }
        ctx.font = fontAt(Math.max(12, size));
        const lh = Math.max(12, size) * 1.25;
        let y = -(lines.length * lh) / 2 + lh / 2;
        for (const ln of lines) { ctx.fillText(ln, 0, y); y += lh; }
    }

    // ---- camera takeover ----
    function updateStreamMembership() {
        if (!receiver) return;
        if (active && active.stream && active.sceneId) receiver.join(active.sceneId);
        else receiver.leave();
    }

    function onStreamChange() {
        const has = receiver && receiver.has();
        if (has && !streaming) {
            streaming = true;
            clearTimers(); stopRaf();
            try { video.pause(); } catch (e) {}    // freeze any background video so it can't draw/sound under the stream
            stopAudio();                            // silence any playlist audio clip under the live stream
            startStreamRaf();
            setStatus('');
        } else if (!has && streaming) {
            streaming = false;
            stopStreamRaf();
            start(); // revert to the folder diaporama
        }
        if (streaming) updateAudio();
        updateCounter();
        emitStatus();
    }

    function startStreamRaf() { stopStreamRaf(); const loop = () => { drawStreams(); streamRaf = requestAnimationFrame(loop); }; loop(); }
    function stopStreamRaf() { if (streamRaf) { cancelAnimationFrame(streamRaf); streamRaf = null; } }

    function drawStreams() {
        const sc = settings.scaler;
        const C = container();
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (blackedOut) return;
        const list = receiver.list().filter(s => s.video.videoWidth);
        if (!list.length) return;

        ctx.save();
        ctx.scale(canvas.width / C.w, canvas.height / C.h);
        const mode = (active && active.streamMode) || 'replace';
        if (mode === 'grid' && list.length > 1) {
            const n = list.length;
            const cols = Math.ceil(Math.sqrt(n));
            const rows = Math.ceil(n / cols);
            const cw = C.w / cols, ch = C.h / rows;
            list.forEach((s, i) => drawVideoCover(s.video, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch));
        } else {
            drawFittedVideo(list[list.length - 1].video, C.w, C.h, sc.fit); // newest = active
        }
        ctx.restore();
    }

    function drawFittedVideo(video, boxW, boxH, fit) {
        const size = fittedSize(video.videoWidth, video.videoHeight, boxW, boxH, fit);
        try { ctx.drawImage(video, (boxW - size.w) / 2, (boxH - size.h) / 2, size.w, size.h); } catch (e) {}
    }

    function drawVideoCover(video, x, y, w, h) {
        const sr = video.videoWidth / video.videoHeight, br = w / h;
        let dw, dh;
        if (sr > br) { dh = h; dw = h * sr; } else { dw = w; dh = w / sr; }
        ctx.save();
        ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
        try { ctx.drawImage(video, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); } catch (e) {}
        ctx.restore();
    }

    // audio: active (newest) stream only, others muted
    function updateAudio() {
        const list = receiver.list();
        list.forEach((s, i) => {
            const isActive = (i === list.length - 1);
            s.video.muted = !isActive;
            if (isActive) { const p = s.video.play(); if (p && p.catch) p.catch(() => {}); }
        });
    }

    function updateCounter() {
        if (streaming) { counter.classList.add('fresh'); counter.textContent = '● ' + receiver.list().length + ' live'; return; }
        if (playingFresh) { counter.classList.add('fresh'); counter.textContent = '★ ' + fresh.length + ' fresh'; }
        else { counter.classList.remove('fresh'); counter.textContent = queue.length ? (index + 1) + ' / ' + queue.length : ''; }
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
        else if (e.key === 'ArrowLeft') { prev(); }
        else if (e.key === 'f') { document.documentElement.requestFullscreen?.(); }
        else if (e.key === 'm') { toggleLearn(); }
    });
    canvas.addEventListener('click', () => { if (streaming) updateAudio(); else next(); });
    window.addEventListener('resize', layout);

    layout();
    reload();
})();
