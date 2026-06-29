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
    socket.on('settings', (s) => { settings = s; layout(); });
    socket.on('active-change', (data) => {
        active = data.active || null;
        playlist = data.media || [];
        buildQueue();
        updateStreamMembership();
        if (!streaming) start();
    });
    socket.on('new-media', (m) => { fresh.push(m); updateCounter(); });
    socket.on('command', (cmd) => {
        if (cmd === 'next') next();
        else if (cmd === 'prev') prev();
        else if (cmd === 'reload') reload();
    });

    function setStatus(msg) {
        statusEl.textContent = msg;
        overlay.style.display = msg ? 'flex' : 'none';
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
                if (!streaming) start();
                if (!state.active) setStatus('No source selected');
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
        clearTimers();
        playingFresh = false;
        index = 0;
        if (!queue.length && !fresh.length) { setStatus('No media'); clearCanvas(); return; }
        setStatus('');
        next(true);
    }

    function next(fromStart) {
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
        if (playingFresh) return;
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

    function show(item) {
        current = item;
        setStatus('');
        updateCounter();
        stopRaf();
        video.onended = null;

        if (item.type === 'image') {
            img.onload = () => { redraw(); scheduleNext(); };
            img.onerror = () => scheduleNext();
            img.src = item.url;
            if (img.complete && img.naturalWidth) { redraw(); scheduleNext(); }
        } else {
            video.onloadeddata = () => startRaf();
            video.onended = () => next();
            video.src = item.url;
            video.currentTime = 0;
            const p = video.play();
            if (p && p.catch) p.catch(() => {});
        }
    }

    function scheduleNext() {
        if (settings.playMode === 'diaporama') timer = setTimeout(next, Math.max(1, settings.imageDuration) * 1000);
    }
    function clearTimers() { if (timer) { clearTimeout(timer); timer = null; } }
    function stopRaf() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
    function startRaf() { stopRaf(); const loop = () => { redraw(); rafId = requestAnimationFrame(loop); }; loop(); }

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

    // ---- camera takeover ----
    function updateStreamMembership() {
        if (!receiver) return;
        if (active && active.stream && active.sourceId) receiver.join(active.sourceId);
        else receiver.leave();
    }

    function onStreamChange() {
        const has = receiver && receiver.has();
        if (has && !streaming) {
            streaming = true;
            clearTimers(); stopRaf();
            startStreamRaf();
            setStatus('');
        } else if (!has && streaming) {
            streaming = false;
            stopStreamRaf();
            start(); // revert to the folder diaporama
        }
        if (streaming) updateAudio();
        updateCounter();
    }

    function startStreamRaf() { stopStreamRaf(); const loop = () => { drawStreams(); streamRaf = requestAnimationFrame(loop); }; loop(); }
    function stopStreamRaf() { if (streamRaf) { cancelAnimationFrame(streamRaf); streamRaf = null; } }

    function drawStreams() {
        const sc = settings.scaler;
        const C = container();
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
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
    });
    canvas.addEventListener('click', () => { if (streaming) updateAudio(); else next(); });
    window.addEventListener('resize', layout);

    layout();
    reload();
})();
