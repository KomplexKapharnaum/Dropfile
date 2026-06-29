# Dropfile · media controller

Dropfile turns drop-folders and displays into a small **media controller**:

- **Players** — a top-level pool of display surfaces. Each player has its own
  URL (+QR) and its own hardware/scaler settings (forced resolution, even-line
  suppression, position, fit, rotation). A player is attached to one or more
  projects and points at one **active source** at a time. Re-pointing it is a
  live action — the URL and scaler config belong to the *screen*, not the content.
- **Projects** — content groupings.
- **Sources** — a folder of media inside a project:
  - `drop` — a public **blind drop box** (QR/URL). Uploaders only ever see and
    delete *their own* files, never anyone else's.
  - `preloaded` — files placed/managed by the admin.

Admin changes are pushed live to every open player over WebSocket.

See [ROADMAP.md](ROADMAP.md) for the full design and the Phase 2/3 plan
(WebRTC camera takeover, MIDI source).

## Requirements

- Node.js 18+
- **ffmpeg** on `PATH` (video thumbnail/poster frames)
- pm2 (production process manager)

`sharp` (image thumbnails) and `qrcode` are installed via npm.

## Install

```sh
git clone https://github.com/KomplexKapharnaum/Dropfile.git
cd Dropfile
npm install
cp .env.example .env     # then edit .env
```

## Configure (`.env`)

| Key | Meaning |
|-----|---------|
| `UPLOAD_PATH` | Media root on disk (one folder per project slug) |
| `UPLOAD_SIZE` | Max upload size (MB) |
| `FRONTEND_PORT` | HTTP port (Socket.IO shares it) |
| `DATA_PATH` | Where `db.json` (projects/players/uploads) is stored |
| `PUBLIC_URL` | Base URL for QR codes & share links (falls back to browser origin) |
| `ADMIN_PASSWORD` | Admin password (HTTP Basic, any username). **If empty, admin is open.** |
| `TURN_HOST` / `TURN_SECRET` / `TURN_TTL` | Phase 2 (WebRTC) — coturn host + shared secret for short-lived ICE creds |

Config and media live on the filesystem — there is no database server. On first
boot with an empty store, existing top-level folders under `UPLOAD_PATH` are
imported as projects with a `preloaded` source.

## Run

```sh
pm2 start server.js --name drop      # production
# or
npm start                            # node server.js
```

## URLs

- `/admin` — management console (password-gated). Create projects, sources and
  players; browse files with thumbnails; bulk delete/archive; configure players.
- `/d/<dropToken>` — a drop box (open via its QR/link).
- `/p/<playerToken>` — a player display (open on the target screen).

The old `/admin` Filebrowser and the `/diaporama?folder=…` page are gone;
`/diaporama` now redirects to `/admin`.

## Architecture

```
app.js               # builds the wired Express app + HTTP server + Socket.IO
server.js            # loads app + listens on FRONTEND_PORT
lib/store.js         # atomic JSON store (db.json)
lib/ids.js           # id / token / slug helpers
lib/media.js         # extensions, sanitisation, mtime listing
lib/model.js         # queries over the store (find by token, source dirs, …)
lib/playlist.js      # resolve a player's active source -> media playlist
lib/thumbs.js        # sharp (images) + ffmpeg (video posters) thumbnail cache
lib/auth.js          # HTTP Basic middleware (ADMIN_PASSWORD)
lib/migrate.js       # one-time import of existing folders
routes/drop.js       # /d, /api/drop/*
routes/player.js     # /p, /api/player/*
routes/admin.js      # /admin/api/* (+ static admin SPA), behind auth
sockets/index.js     # player rooms; settings/active/new-media broadcast
www/                 # admin SPA (Alpine.js), drop page, player canvas engine
```

## Phase 2 — WebRTC camera takeover (coturn)

Camera takeover needs a STUN/TURN server because phones and players are on
different networks. Run a self-hosted **coturn** on the **public-facing box**
(the one the router forwards ports to / that runs nginx) — TURN is its own
UDP/TCP protocol, **not** HTTP, so it does *not* go through the nginx reverse
proxy. A sample config is in [extra/turnserver.conf](extra/turnserver.conf):

```sh
sudo apt install coturn
sudo sed -i 's/^#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
sudo cp extra/turnserver.conf /etc/turnserver.conf   # then fill the <PLACEHOLDERS>
sudo systemctl enable --now coturn
# firewall: 3478 + 5349 (tcp/udp) and the 49152:49300/udp relay range
```

In `turnserver.conf` set `external-ip=<PUBLIC_IP>/<LOCAL_IP>`, `realm`, the TLS
cert paths, and `static-auth-secret`. Then in `.env`:

```
TURN_HOST   = turn.drop.example.org
TURN_SECRET = <same hex as static-auth-secret>   # openssl rand -hex 32
TURN_TTL    = 43200                                # optional, seconds (12h)
```

`lib/turn.js` signs **short-lived** credentials with `TURN_SECRET` (no static
password is shipped to clients); the player API advertises the resulting ICE
servers automatically.
