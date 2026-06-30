// WebRTC camera sender for the public drop page. Streams the phone camera +
// mic to every player currently displaying the scene (mesh). The streamer is
// always the offerer; players answer. Front/back camera via replaceTrack.
class CameraSender {
    constructor(opts) {
        this.token = opts.token;
        this.ice = opts.ice || [{ urls: 'stun:stun.l.google.com:19302' }];
        this.getNick = opts.getNick || (() => 'guest');
        this.preview = opts.preview;            // <video> element
        this.onStatus = opts.onStatus || (() => {});
        this.pcs = {};                          // playerSocketId -> RTCPeerConnection
        this.stream = null;
        this.facing = 'environment';
        this.socket = null;
        this.via = null;                        // host | srflx | relay (diagnostic)
    }

    async start() {
        this.stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: this.facing, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: true
        });
        if (this.preview) { this.preview.srcObject = this.stream; this.preview.play().catch(() => {}); }

        this.socket = io();
        this.socket.on('connect', () => this._join());
        this.socket.on('stream-peer-joined', (p) => { if (p.role === 'player') this._offerTo(p.id); });
        this.socket.on('stream-peer-left', (p) => this._closePeer(p.id));
        this.socket.on('rtc-answer', (m) => this._onAnswer(m));
        this.socket.on('rtc-ice', (m) => this._onIce(m));
        if (this.socket.connected) this._join();
        this._status();
    }

    _join() {
        this.socket.emit('stream-join', { role: 'streamer', token: this.token, name: this.getNick() }, (resp) => {
            if (!resp || resp.error) { this.onStatus('⚠ ' + ((resp && resp.error) || 'cannot start')); return; }
            (resp.peers || []).filter(p => p.role === 'player').forEach(p => this._offerTo(p.id));
            this._status();
        });
    }

    async _offerTo(playerId) {
        if (this.pcs[playerId]) return;
        const pc = new RTCPeerConnection({ iceServers: this.ice });
        this.pcs[playerId] = pc;
        this.stream.getTracks().forEach(t => pc.addTrack(t, this.stream));
        pc.onicecandidate = (e) => { if (e.candidate) this.socket.emit('rtc-ice', { to: playerId, candidate: e.candidate }); };
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'connected') this._reportVia(pc);
            if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) this._closePeer(playerId);
            this._status();
        };
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            this.socket.emit('rtc-offer', { to: playerId, sdp: pc.localDescription });
        } catch (e) { this._closePeer(playerId); }
    }

    async _onAnswer(m) { const pc = this.pcs[m.from]; if (pc) try { await pc.setRemoteDescription(m.sdp); } catch (e) {} }
    async _onIce(m) { const pc = this.pcs[m.from]; if (pc && m.candidate) try { await pc.addIceCandidate(m.candidate); } catch (e) {} }
    _closePeer(id) { const pc = this.pcs[id]; if (pc) { try { pc.close(); } catch (e) {} delete this.pcs[id]; } this._status(); }

    _status() {
        const ids = Object.keys(this.pcs);
        if (!ids.length) return this.onStatus('waiting for a screen…');
        const connected = ids.filter(id => this.pcs[id].connectionState === 'connected').length;
        const via = (connected && this.via) ? ' · via ' + this.via : '';
        this.onStatus(connected ? ('● live · ' + connected + ' screen' + (connected > 1 ? 's' : '') + via) : 'connecting…');
    }

    // best-effort: which candidate type won (host/srflx/relay) — relay = TURN
    async _reportVia(pc) {
        try {
            const stats = await pc.getStats();
            let pairId = null, pair = null, local = null;
            stats.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId; });
            stats.forEach(r => { if (r.type === 'candidate-pair' && (r.id === pairId || (r.nominated && r.state === 'succeeded'))) pair = r; });
            if (pair) stats.forEach(r => { if (r.id === pair.localCandidateId) local = r; });
            if (local) { this.via = local.candidateType; this._status(); }
        } catch (e) {}
    }

    async flip() {
        this.facing = this.facing === 'environment' ? 'user' : 'environment';
        const ns = await navigator.mediaDevices.getUserMedia({ video: { facingMode: this.facing }, audio: false });
        const nv = ns.getVideoTracks()[0];
        for (const pc of Object.values(this.pcs)) {
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) sender.replaceTrack(nv);
        }
        const old = this.stream.getVideoTracks()[0];
        if (old) { this.stream.removeTrack(old); old.stop(); }
        this.stream.addTrack(nv);
        if (this.preview) this.preview.srcObject = this.stream;
    }

    stop() {
        Object.keys(this.pcs).forEach(id => this._closePeer(id));
        if (this.stream) this.stream.getTracks().forEach(t => t.stop());
        if (this.socket) { try { this.socket.emit('stream-leave'); } catch (e) {} this.socket.disconnect(); }
        this.stream = null; this.socket = null;
    }
}
window.CameraSender = CameraSender;
