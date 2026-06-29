// Player display engine: canvas compositor (LED scaler) + diaporama/manual
// playback + live control over Socket.IO. The server holds authoritative state,
// so a reload/restart resumes the current source automatically.
(function () {
    const token = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');

    const canvas = document.getElementById('surface');
    const ctx = canvas.getContext('2d');
    const statusEl = document.getElementById('status');
    const overlay = document.getElementById('overlay');
    const counter = document.getElementById('counter');

    // offscreen media elements (drawn into the canvas)
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.crossOrigin = 'anonymous';

    // ---- state ----
    let settings = defaultSettings();
    let playlist = [];        // full media from server
    let queue = [];           // active rotation (after loop/lastX applied)
    let index = 0;
    let fresh = [];           // freshly uploaded items (priority)
    let playingFresh = false;
    let current = null;       // current item being shown
    let timer = null;
    let rafId = null;

    function defaultSettings() {
        return {
            playMode: 'diaporama', imageDuration: 5, loop: 'all', lastX: 20, prioritizeFresh: true,
            scaler: { container: 'full', width: 0, height: 0, fit: 'contain',
                hPosition: 'center', hOffset: 0, vPosition: 'center', vOffset: 0,
                rotation: 0, evenLineSuppression: false }
        };
    }

    // ---- socket ----
    const socket = io();
    socket.on('connect', () => { socket.emit('player-join', token); setStatus(''); });
    socket.on('disconnect', () => setStatus('reconnecting…'));
    socket.on('settings', (s) => { settings = s; applyLayout(); redraw(); });
    socket.on('active-change', (data) => { playlist = data.media || []; buildQueue(); start(); });
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

    // ---- load initial state from server (authoritative) ----
    function reload() {
        fetch('/api/player/' + token)
            .then(r => r.ok ? r.json() : Promise.reject(new Error('unknown player')))
            .then(state => {
                settings = state.settings || defaultSettings();
                playlist = state.media || [];
                applyLayout();
                buildQueue();
                start();
                if (!state.active) setStatus('No source selected');
            })
            .catch(e => setStatus(String(e.message || e)));
    }

    // ---- playlist shaping (loop / lastX) ----
    function buildQueue() {
        let list = playlist.slice();
        if (settings.loop === 'lastX' && settings.lastX > 0) {
            list = list.slice(-settings.lastX); // playlist is oldest->newest, so tail = newest
        }
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

    // ---- advance ----
    function next(fromStart) {
        clearTimers();

        if (settings.prioritizeFresh && fresh.length) {
            playingFresh = true;
            show(fresh.shift());
            return;
        }
        if (playingFresh) { playingFresh = false; } // resume normal rotation

        if (!queue.length) {
            if (fresh.length) { playingFresh = true; show(fresh.shift()); }
            else { setStatus('No media'); }
            return;
        }

        if (!fromStart) index++;
        if (index >= queue.length) {
            // loop: re-read latest from server so new uploads appear
            reloadPlaylist();
            return;
        }
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
                if (queue.length) show(queue[0]);
                else setStatus('No media');
            })
            .catch(() => { index = 0; if (queue.length) show(queue[0]); });
    }

    // ---- show one item ----
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
            video.onloadeddata = () => { startRaf(); };
            video.onended = () => { if (settings.playMode === 'diaporama' || true) next(); };
            video.src = item.url;
            video.currentTime = 0;
            const p = video.play();
            if (p && p.catch) p.catch(() => {});
        }
    }

    function scheduleNext() {
        if (settings.playMode === 'diaporama') {
            timer = setTimeout(next, Math.max(1, settings.imageDuration) * 1000);
        }
        // manual mode: wait for keypress / tap
    }

    function clearTimers() { if (timer) { clearTimeout(timer); timer = null; } }
    function stopRaf() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
    function startRaf() {
        stopRaf();
        const loop = () => { redraw(); rafId = requestAnimationFrame(loop); };
        loop();
    }

    // ---- canvas compositor (the LED scaler) ----
    function surfaceSize() {
        const sc = settings.scaler;
        if (sc.container === 'custom' && sc.width > 0 && sc.height > 0) return { w: sc.width, h: sc.height };
        return { w: window.innerWidth, h: window.innerHeight };
    }

    function applyLayout() {
        const { w, h } = surfaceSize();
        canvas.width = w; canvas.height = h;
        const sc = settings.scaler;
        if (sc.container === 'custom' && sc.width > 0 && sc.height > 0) {
            // fit the native-resolution buffer into the viewport for preview;
            // on a 1:1 LED-resolution window this resolves to scale = 1.
            const scale = Math.min(window.innerWidth / w, window.innerHeight / h);
            canvas.style.width = Math.round(w * scale) + 'px';
            canvas.style.height = Math.round(h * scale) + 'px';
        } else {
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
        }
        redraw();
    }

    function clearCanvas() {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

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
        const S = { w: canvas.width, h: canvas.height };
        const rot = ((sc.rotation % 360) + 360) % 360;
        const swap = (rot === 90 || rot === 270);
        const box = { w: swap ? S.h : S.w, h: swap ? S.w : S.h };

        const size = fittedSize(m.w, m.h, box.w, box.h, sc.fit);

        // position within the (rotation-aligned) box
        let cx = 0, cy = 0;
        if (sc.hPosition === 'left') cx = -(box.w - size.w) / 2;
        else if (sc.hPosition === 'right') cx = (box.w - size.w) / 2;
        else if (sc.hPosition === 'custom') cx = sc.hOffset || 0;
        if (sc.vPosition === 'top') cy = -(box.h - size.h) / 2;
        else if (sc.vPosition === 'bottom') cy = (box.h - size.h) / 2;
        else if (sc.vPosition === 'custom') cy = sc.vOffset || 0;

        ctx.save();
        ctx.translate(S.w / 2, S.h / 2);
        if (rot) ctx.rotate(rot * Math.PI / 180);
        try { ctx.drawImage(m.el, cx - size.w / 2, cy - size.h / 2, size.w, size.h); } catch (e) {}
        ctx.restore();

        if (sc.evenLineSuppression) suppressEvenLines(S);
    }

    // Blank every even output row (0,2,4…) so content only lands on the rows a
    // semi-transparent LED panel actually displays.
    function suppressEvenLines(S) {
        ctx.fillStyle = '#000';
        for (let y = 0; y < S.h; y += 2) ctx.fillRect(0, y, S.w, 1);
    }

    // ---- counter ----
    function updateCounter() {
        if (playingFresh) {
            counter.classList.add('fresh');
            counter.textContent = '★ ' + (fresh.length) + ' fresh';
        } else {
            counter.classList.remove('fresh');
            counter.textContent = queue.length ? (index + 1) + ' / ' + queue.length : '';
        }
    }

    // ---- input (manual mode + skip) ----
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
        else if (e.key === 'ArrowLeft') { prev(); }
        else if (e.key === 'f') { document.documentElement.requestFullscreen?.(); }
    });
    canvas.addEventListener('click', () => next());
    window.addEventListener('resize', applyLayout);

    // ---- go ----
    applyLayout();
    reload();
})();
