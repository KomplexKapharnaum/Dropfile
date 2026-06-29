// TURN / STUN credentials for WebRTC (coturn `use-auth-secret` / TURN REST API).
//
// coturn runs on the public box with a shared `static-auth-secret`; we mint
// short-lived credentials here with the SAME secret — no network call to coturn
// is needed. The browser uses these as ICE server credentials and they expire on
// their own (nothing to revoke). See extra/turnserver.conf.
//
// .env:  TURN_HOST=turn.dropfile.example
//        TURN_SECRET=<same as coturn static-auth-secret>
//        TURN_TTL=43200            # optional, seconds (default 12h)
const crypto = require('crypto');

// Time-limited credential signed with the shared secret.
//   username = <unix-expiry>[:<id>]   ·   credential = base64(HMAC-SHA1(secret, username))
function credentials(ttlSeconds, id) {
    const secret = process.env.TURN_SECRET || '';
    const ttl = ttlSeconds || Number(process.env.TURN_TTL) || 12 * 3600;
    const expiry = Math.floor(Date.now() / 1000) + ttl;
    const username = id ? `${expiry}:${id}` : String(expiry);
    const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
    return { username, credential };
}

let warned = false;

// Full ICE server list to hand to a browser's RTCPeerConnection.
// `id` (optional) tags the credential to a visitor/player for log correlation.
// Returns [] (with a one-time warning) if TURN is not configured.
function iceServers(id) {
    const host = process.env.TURN_HOST || '';
    const secret = process.env.TURN_SECRET || '';

    if (!host || !secret) {
        if (!warned) {
            console.warn('[turn] TURN_HOST / TURN_SECRET not set — WebRTC has no STUN/TURN relay. Set them in .env.');
            warned = true;
        }
        return [];
    }

    const { username, credential } = credentials(undefined, id);
    return [
        { urls: `stun:${host}:3478` },
        {
            urls: [
                `turn:${host}:3478?transport=udp`,
                `turn:${host}:3478?transport=tcp`,
                `turns:${host}:5349?transport=tcp`, // TLS fallback for locked-down networks
            ],
            username,
            credential,
        },
    ];
}

module.exports = { credentials, iceServers };
