// Socket.IO wiring:
//  - player display rooms (live settings / active / new-media broadcast)
//  - WebRTC stream signaling for camera takeover (mesh; streamers offer,
//    players answer). One stream room per scene: 'stream:<sceneId>'.
const model = require('../lib/model');

module.exports = function (io, ctx) {
    io.on('connection', (socket) => {
        socket.on('player-join', (token) => {
            const player = model.findPlayerByToken(String(token || ''));
            if (player) socket.join('player:' + player.token);
        });

        // ---- WebRTC stream signaling ----
        socket.on('stream-join', (msg, ack) => {
            const role = (msg && msg.role === 'player') ? 'player' : 'streamer';
            let sceneId = null, name = '';

            if (role === 'streamer') {
                const found = model.findSourceByDropToken(String((msg && msg.token) || ''));
                if (!found || !found.source.public || !(found.source.accept && found.source.accept.stream)) {
                    return ack && ack({ error: 'streaming not available' });
                }
                sceneId = found.source.id;
                name = String((msg && msg.name) || 'guest').slice(0, 24);
            } else {
                const player = model.findPlayerByToken(String((msg && msg.token) || ''));
                if (!player || !player.activeSourceId) return ack && ack({ error: 'no active scene' });
                sceneId = player.activeSourceId;
            }

            const room = 'stream:' + sceneId;
            socket.data.stream = { role, sceneId, name };
            socket.join(room);

            // hand the joiner the peers already in the room
            const peers = [];
            const roomSet = io.sockets.adapter.rooms.get(room) || new Set();
            for (const sid of roomSet) {
                if (sid === socket.id) continue;
                const s = io.sockets.sockets.get(sid);
                if (s && s.data.stream) peers.push({ id: sid, role: s.data.stream.role, name: s.data.stream.name });
            }
            if (ack) ack({ ok: true, sceneId, peers });
            socket.to(room).emit('stream-peer-joined', { id: socket.id, role, name });
        });

        function leaveStream() {
            const st = socket.data.stream;
            if (!st) return;
            socket.to('stream:' + st.sceneId).emit('stream-peer-left', { id: socket.id });
            socket.data.stream = null;
        }
        socket.on('stream-leave', leaveStream);

        // relay SDP / ICE to a specific peer socket
        socket.on('rtc-offer', (m) => { if (m && m.to) io.to(m.to).emit('rtc-offer', { from: socket.id, sdp: m.sdp }); });
        socket.on('rtc-answer', (m) => { if (m && m.to) io.to(m.to).emit('rtc-answer', { from: socket.id, sdp: m.sdp }); });
        socket.on('rtc-ice', (m) => { if (m && m.to) io.to(m.to).emit('rtc-ice', { from: socket.id, candidate: m.candidate }); });

        socket.on('disconnect', leaveStream);
    });
};
