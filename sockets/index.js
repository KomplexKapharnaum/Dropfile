// Socket.IO wiring:
//  - kiosk (machine) display rooms (live settings / active / new-media / command)
//  - machine -> admin live status feedback ('admins' room)
//  - WebRTC stream signaling for camera takeover (mesh)
// Event names keep the legacy `player-*` spelling so the kiosk front-end
// (player.js) is unchanged; a "player" on the wire is a Machine here.
const model = require('../lib/model');

module.exports = function (io, ctx) {
    const liveStatus = {}; // machineId -> last reported status (in-memory)

    io.on('connection', (socket) => {
        socket.on('player-join', (token) => {
            const machine = model.findMachineByToken(String(token || ''));
            if (machine) { socket.join('player:' + machine.token); socket.join('players'); socket.data.machineId = machine.id; }
        });

        // admin console listens for live machine status
        socket.on('admin-join', () => { socket.join('admins'); socket.emit('status-snapshot', liveStatus); });

        // a machine reports what it is currently showing
        socket.on('player-status', (msg) => {
            const machine = model.findMachineByToken(String((msg && msg.token) || ''));
            if (!machine) return;
            liveStatus[machine.id] = (msg && msg.status) || null;
            io.to('admins').emit('player-status', { machineId: machine.id, status: liveStatus[machine.id] });
        });

        // ---- WebRTC stream signaling ----
        socket.on('stream-join', (msg, ack) => {
            const role = (msg && msg.role === 'player') ? 'player' : 'streamer';
            let sceneId = null, name = '';
            if (role === 'streamer') {
                const found = model.findSourceByDropToken(String((msg && msg.token) || ''));
                if (!found || !(found.source.accept && found.source.accept.stream)) return ack && ack({ error: 'streaming not available' });
                sceneId = found.source.id;
                name = String((msg && msg.name) || 'guest').slice(0, 24);
            } else {
                const machine = model.findMachineByToken(String((msg && msg.token) || ''));
                if (!machine || !machine.activeSceneId) return ack && ack({ error: 'no active scene' });
                sceneId = machine.activeSceneId;
            }
            const room = 'stream:' + sceneId;
            socket.data.stream = { role, sceneId, name };
            socket.join(room);
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
        socket.on('rtc-offer', (m) => { if (m && m.to) io.to(m.to).emit('rtc-offer', { from: socket.id, sdp: m.sdp }); });
        socket.on('rtc-answer', (m) => { if (m && m.to) io.to(m.to).emit('rtc-answer', { from: socket.id, sdp: m.sdp }); });
        socket.on('rtc-ice', (m) => { if (m && m.to) io.to(m.to).emit('rtc-ice', { from: socket.id, candidate: m.candidate }); });

        socket.on('disconnect', () => {
            leaveStream();
            if (socket.data.machineId) {
                liveStatus[socket.data.machineId] = { online: false };
                io.to('admins').emit('player-status', { machineId: socket.data.machineId, status: liveStatus[socket.data.machineId] });
            }
        });
    });
};
