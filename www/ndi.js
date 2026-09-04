// NDI input for the player. Same surface as StreamReceiver (list/has/onChange) so
// player.js treats an NDI feed like any live stream. The video comes from a local
// V4L2 device (the HNdi bridge, /dev/video10) exposed to the page as a camera
// labelled "NDI"; we grab it with getUserMedia and draw it like a WebRTC stream.
//
// Signal presence is authoritative from the BRIDGE, not the frames: the loopback
// device keeps emitting black when no NDI arrives, so a black frame is not "live".
// We poll the bridge's local API (127.0.0.1:8791, reachable even from an https
// page — localhost is exempt from mixed-content) and only report a live source
// when the bridge state is "running". When the bridge can't be reached (the page
// is not on a bridge box) we fall back to frame presence, so a plain NDI webcam
// still works.
class NdiInput {
    constructor(opts) {
        opts = opts || {};
        this.label = opts.label || /NDI/i;
        this.width = opts.width || 1920;
        this.height = opts.height || 1080;
        this.fps = opts.fps || 60;
        this.onChange = opts.onChange || (() => {});
        this.apiBase = opts.apiBase || 'http://127.0.0.1:8791';
        this.started = false;
        this.source = '';           // desired source name (from the active scene's station)
        this.error = null;          // null | 'no-device' | 'denied' | 'ended'
        this.video = null;
        this.track = null;
        this.joinedAt = 0;
        this.bridge = { ok: false, state: null, source: '', sources: [] };
        this._acquireTimer = null;
        this._pollTimer = null;
        this._acquiring = false;
        this._lastPut = '';
    }

    // ---- lifecycle -----------------------------------------------------
    start(source) {
        this.source = (source || '').trim();
        if (this.started) { this._maybeSwitch(); return; }
        this.started = true;
        this.error = null;
        this._ensureVideo();
        this._acquire();
        this._poll();
        this._pollTimer = setInterval(() => this._poll(), 1000);
    }

    stop() {
        if (!this.started && !this.track) return;
        this.started = false;
        if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
        if (this._acquireTimer) { clearTimeout(this._acquireTimer); this._acquireTimer = null; }
        this._release();
        this.bridge = { ok: false, state: null, source: '', sources: [] };
        this.error = null;
        this.onChange();
    }

    // ---- the live-source contract (mirrors StreamReceiver) -------------
    has() {
        const framing = !!(this.track && this.track.readyState === 'live' && this.video && this.video.videoWidth > 0);
        if (!framing) return false;
        // bridge gates it DOWN only when we can reach it and it is not running.
        if (this.bridge.ok) return this.bridge.state === 'running';
        return true;                 // no bridge reachable → trust the frames
    }
    list() { return this.has() ? [{ id: 'ndi', name: 'NDI', video: this.video, joinedAt: this.joinedAt || 1 }] : []; }

    // ---- device acquisition -------------------------------------------
    _ensureVideo() {
        if (this.video) return;
        const v = document.createElement('video');
        v.autoplay = true; v.playsInline = true; v.muted = true;
        v.style.display = 'none';
        document.body.appendChild(v);
        this.video = v;
    }

    _release() {
        if (this.track) { try { this.track.stop(); } catch (e) {} this.track = null; }
        if (this.video) { try { this.video.srcObject = null; } catch (e) {} }
        this.joinedAt = 0;
    }

    async _pickDevice() {
        let devs = await navigator.mediaDevices.enumerateDevices();
        if (!devs.some(d => d.kind === 'videoinput' && d.label)) {
            // labels are hidden until a permission is granted once
            try { (await navigator.mediaDevices.getUserMedia({ video: true })).getTracks().forEach(t => t.stop()); } catch (e) {}
            devs = await navigator.mediaDevices.enumerateDevices();
        }
        const cams = devs.filter(d => d.kind === 'videoinput');
        return cams.find(d => this.label.test(d.label || '')) || null;
    }

    async _acquire() {
        if (!this.started || this._acquiring || (this.track && this.track.readyState === 'live')) return;
        this._acquiring = true;
        try {
            const dev = await this._pickDevice();
            if (!dev) { this.error = 'no-device'; this._retry(); return; }
            const video = { width: { ideal: this.width }, height: { ideal: this.height }, frameRate: { ideal: this.fps } };
            if (dev.deviceId) video.deviceId = { exact: dev.deviceId };
            const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
            this._ensureVideo();
            this.video.srcObject = stream;
            await this.video.play().catch(() => {});
            this.track = stream.getVideoTracks()[0];
            this.joinedAt = Date.now();
            this.error = null;
            this.track.onended = () => { this.error = 'ended'; this._release(); this.onChange(); if (this.started) this._retry(); };
            this.onChange();
        } catch (e) {
            this.error = (e && e.name === 'NotAllowedError') ? 'denied' : 'no-device';
            this._retry();
        } finally {
            this._acquiring = false;
        }
    }

    _retry() {
        if (!this.started || this._acquireTimer) return;
        this._acquireTimer = setTimeout(() => { this._acquireTimer = null; this._acquire(); }, 2000);
    }

    // ---- bridge API ----------------------------------------------------
    async _poll() {
        if (!this.started) return;
        const was = this.has();
        try {
            const r = await fetch(this.apiBase + '/status', { cache: 'no-store' });
            if (r.ok) {
                const s = await r.json();
                this.bridge = { ok: true, state: s.state, stalled: !!s.stalled, restarts: s.restarts,
                                bandwidth: s.bandwidth, mode: s.mode, source: (s.source && s.source.resolved) || '', sources: this.bridge.sources };
                this._maybeSwitch();
            } else { this.bridge.ok = false; }
        } catch (e) { this.bridge.ok = false; }
        // acquire if the device isn't live yet
        if (!(this.track && this.track.readyState === 'live')) this._acquire();
        if (this.has() !== was) this.onChange();
    }

    // switch the bridge to the scene's source when it differs (no persist)
    _maybeSwitch() {
        if (!this.started || !this.source || !this.bridge.ok) return;
        if (this.bridge.source === this.source || this._lastPut === this.source) return;
        this._lastPut = this.source;
        fetch(this.apiBase + '/source', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: this.source, persist: false })
        }).catch(() => {});
    }
}
window.NdiInput = NdiInput;
