// Socket.IO wiring. Players join a room keyed by their token; the admin routes
// broadcast `settings` / `active-change` / `new-media` into those rooms.
const model = require('../lib/model');

module.exports = function (io, ctx) {
    io.on('connection', (socket) => {
        socket.on('player-join', (token) => {
            const player = model.findPlayerByToken(String(token || ''));
            if (player) socket.join('player:' + player.token);
        });
    });
};
