# Dropfile · media controller

Dropfile turns drop-folders and displays into a small **media controller**:

- **Machines** — a top-level pool of physical boxes (Raspberry Pi, mini-PC…).
  Each machine has a static name, a device type (from an editable list) and a
  **fixed kiosk URL** (+QR) set once on the box — it never changes across projects.
- **Stations** — per project, a machine bound into the show with its own **display
  surface** (forced resolution, even-line suppression, position, fit, rotation),
  playback options and MIDI map, plus a rig nickname ("Totem screen", "Cart 1").
  The same box is a different station in each project — the surface belongs to the
  *screen-in-this-show*, the URL to the *box*. Activating a scene on a station
  drives its machine, taking it over from any other project using that box.
- **Projects / workspaces** — content groupings. The admin opens a project into a
  **workspace**: a live **control room** (one column per **station** — click a
  scene to make it active, click a clip to show it, transport + stop + blackout,
  console **MIDI learn**; a gear opens the station's surface/playback settings)
  plus scenes & media management.
- **Scenes** — a folder of media inside a project. Every scene is reachable by its
  **URL** (+QR via the share button); access is controlled simply by whether you
  share that link. The admin can add media and **reorder** it (drag); the chosen
  order drives playback. New uploads append in upload-time order. Each uploader
  only ever sees and deletes *their own* contributions.
- **Content types** — each scene picks what it accepts: **images**, **videos**,
  **text** (saved as `.txt`), and/or a live **camera stream**. The drop page is a
  **KXKM chat** that adapts: a message box, a media attach button, and/or *Go live*.
- **Player modes** — *diaporama* (auto-advance) or *manual* (a held clip), switched
  live from the control room. A **MIDI** controller and the admin playback remote
  (prev/next/play-pause/restart/blackout) drive either mode as control surfaces. A
  live **camera takeover** overrides the playlist while anyone streams and reverts
  when they stop.

Admin changes are pushed live to every open player over WebSocket.

See [ROADMAP.md](ROADMAP.md) for the full design and status. Phases 1–5 (core,
WebRTC camera takeover, MIDI, workspaces/control-room, machines+stations) are
implemented — the WebRTC camera takeover is code-complete but still needs a
reachable coturn, verified at `/diag`.

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
| `RELAY_URL` | Optional — base URL of the KXKM relay app. Scenes with their relay toggle on forward incoming text / images there (images downscaled). Unset = off. |

Config and media live on the filesystem — there is no database server. On first
boot with an empty store, existing top-level folders under `UPLOAD_PATH` are
imported as projects with one **public scene**.

## Run

```sh
pm2 start server.js --name drop      # production
# or
npm start                            # node server.js
```

## URLs

- `/admin` — console (password-gated): a **Projects** grid → open a **workspace**
  (live control room + scenes/media), and a **Machines** pool page (configure
  boxes, device types, share the kiosk URL). `/diag` for WebRTC.
- `/d/<dropToken>` — a scene's **KXKM chat** drop page (open via its QR/link).
- `/p/<machineToken>` — a machine's kiosk display (open on the box; URL is fixed).

The old `/admin` Filebrowser and the `/diaporama?folder=…` page are gone;
`/diaporama` now redirects to `/admin`.

## Architecture

```
app.js               # builds the wired Express app + HTTP server + Socket.IO
server.js            # loads app + listens on FRONTEND_PORT
lib/store.js         # atomic JSON store (db.json)
lib/ids.js           # id / token / slug helpers
lib/media.js         # extensions, sanitisation, mtime listing
lib/defaults.js      # machine/station defaults + kiosk-settings composition
lib/model.js         # queries over the store (machines, stations, scenes)
lib/playlist.js      # resolve a machine's active station -> settings + playlist
lib/thumbs.js        # sharp (images) + ffmpeg (video posters) thumbnail cache
lib/auth.js          # HTTP Basic middleware (ADMIN_PASSWORD)
lib/turn.js          # WebRTC ICE: short-lived coturn credentials (TURN REST)
lib/migrate.js       # import legacy folders + split players->machines/stations
routes/drop.js       # /d, /api/drop/* (upload, text, blind "my uploads")
routes/player.js     # /p, /api/player/* (machine kiosk), /diag, /api/ice
routes/admin.js      # /admin/api/* machines + per-project stations + scenes
sockets/index.js     # machine rooms + WebRTC stream signaling (offer/answer/ice)
www/                 # admin SPA (Alpine), drop, player (canvas engine),
                     #   camera.js (sender), receiver.js (player), midi.js, diag.html
```

## Live control & diagnostics

- **Playback remote** (admin player card): prev / next / play-pause / restart /
  reload, pushed live over WebSocket.
- **MIDI** (player `m` overlay, or the admin MIDI panel): learn a pad/CC → select
  a clip, transport, or blackout. Map persists per player; an admin "drive from
  my controller" toggle lets a console controller drive any player. Web MIDI needs
  a secure context (HTTPS / localhost).
- **WebRTC diagnostic** — `/admin` → *WebRTC ↗*, or `/diag` directly. Click *Run
  test*: **relay** candidates mean TURN works.

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

**Verify** at `/diag` (also linked from the admin) — click *Run test*:

- **relay** candidates → TURN works; cross-network streaming will connect.
- **srflx** only → STUN works but no relay; check `TURN_SECRET` == coturn's
  `static-auth-secret`, `external-ip`, and that **3478 + 5349 (tcp/udp)** and the
  relay range are open on the public box.
- nothing → coturn unreachable / not running.

Run `/diag` from a phone on **mobile data** for a true test. The TURN host must be
reachable from the **public internet**, not just the LAN — an internal machine
hitting the public IP can fail on hairpin NAT and is *not* a valid test (e.g.
`nc -uvz turn.host 3478` from inside the LAN may time out even when coturn is
fine for outside clients).
