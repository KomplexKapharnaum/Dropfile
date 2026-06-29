// WebRTC stream receiver for the player. Shares the player's Socket.IO socket.
// Players answer streamer offers and collect incoming MediaStreams. Each stream
// is attached to a hidden, muted <video> element so it can be drawn to the
// player canvas; audio is handled by the player (active stream only).
class StreamReceiver {
    constructor(opts) {
        this.token = opts.token;
        this.socket = opts.socket;
        this.ice = opts.ice || [{ urls: 'stun:stun.l.google.com:19302' }];
        this.onChange = opts.onChange || (() => {});
        this.pcs = {};        // streamerId -> RTCPeerConnection
        this.streams = {};    // streamerId -> { stream, video, joinedAt, name }
        this.sceneId = null;
        this.joined = false;
        this._bind();
    }

    _bind() {
        this.socket.on('rtc-offer', (m) => this._onOffer(m));
        this.socket.on('rtc-ice', (m) => this._onIce(m));
        this.socket.on('stream-peer-left', (p) => this._close(p.id));
        // streamers announce via stream-peer-joined; they will send us an offer.
    }

    join(sceneId) {
        if (this.joined && this.sceneId === sceneId) return;
        this.leave();
        this.sceneId = sceneId;
        this.joined = true;
        this.socket.emit('stream-join', { role: 'player', token: this.token }, () => {});
    }

    leave() {
        if (this.joined) { try { this.socket.emit('stream-leave'); } catch (e) {} }
        Object.keys(this.pcs).forEach(id => this._close(id, true));
        this.joined = false; this.sceneId = null;
        this.onChange();
    }

    async _onOffer(m) {
        if (!this.joined) return;
        let pc = this.pcs[m.from];
        if (!pc) {
            pc = new RTCPeerConnection({ iceServers: this.ice });
            this.pcs[m.from] = pc;
            pc.onicecandidate = (e) => { if (e.candidate) this.socket.emit('rtc-ice', { to: m.from, candidate: e.candidate }); };
            pc.ontrack = (e) => this._addStream(m.from, e.streams[0]);
            pc.onconnectionstatechange = () => { if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) this._close(m.from); };
        }
        try {
            await pc.setRemoteDescription(m.sdp);
            const ans = await pc.createAnswer();
            await pc.setLocalDescription(ans);
            this.socket.emit('rtc-answer', { to: m.from, sdp: pc.localDescription });
        } catch (e) { this._close(m.from); }
    }

    async _onIce(m) { const pc = this.pcs[m.from]; if (pc && m.candidate) try { await pc.addIceCandidate(m.candidate); } catch (e) {} }

    _addStream(id, stream) {
        if (!stream) return;
        let entry = this.streams[id];
        if (!entry) {
            const video = document.createElement('video');
            video.autoplay = true; video.playsInline = true; video.muted = true;
            this.streams[id] = entry = { stream, video, joinedAt: Date.now() };
        }
        entry.stream = stream;
        entry.video.srcObject = stream;
        entry.video.play().catch(() => {});
        this.onChange();
    }

    _close(id, silent) {
        const pc = this.pcs[id]; if (pc) { try { pc.close(); } catch (e) {} delete this.pcs[id]; }
        const s = this.streams[id]; if (s) { try { s.video.srcObject = null; } catch (e) {} delete this.streams[id]; }
        if (!silent) this.onChange();
    }

    // oldest -> newest; the newest is the "active" stream
    list() {
        return Object.keys(this.streams).map(id => Object.assign({ id }, this.streams[id])).sort((a, b) => a.joinedAt - b.joinedAt);
    }
    has() { return Object.keys(this.streams).length > 0; }
}
window.StreamReceiver = StreamReceiver;
