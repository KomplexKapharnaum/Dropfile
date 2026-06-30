# Dropfile → Media-Controller: Refactor Roadmap

Turns Dropfile from a file-drop tool into a media controller: a **pool of Players** (display surfaces) fed by **Sources** grouped into **Projects**.

## Status (implemented on `media-controller`, deployed at drop.kxkm.net)

- **Phase 1 — core** ✅ projects, players pool, scenes, integrated browser (thumbnails, ordering, bulk delete/archive), blind drop, LED scaler (exact-pixel custom resolution, even-line = vertical-50 % squash, position/fit/rotation), live settings, restart-resume.
- **Phase 2 — camera takeover** ✅ *code* — `stream` is a scene accept-type; *Go live* on the drop page; mesh WebRTC (streamers offer, players answer); player renders single/grid; live takes over & reverts; active-stream audio. **Needs coturn reachable** — verify at `/diag` (as of last test `turn.kxkm.net` was unreachable on 3478/5349 from outside the LAN). *This is the one feature that is code-complete but not yet verified live.*
- **Phase 3 — MIDI** ✅ learn on the player (`m`) and in the admin; map note/CC → select a clip / transport / blackout; a workspace "console" drives any player from one controller. (The original `playMode: midi` trigger-surface was folded into the live **diaporama / manual-select** model — MIDI is now a binding layer over either; see Phase 4.)
- **Phase 4 — workspaces & control room** ✅ admin reorganised into a **Projects** grid → a per-project **workspace**: a live **control room** (one column per attached player — pick a scene, click a clip, transport + blackout, live player-status feedback, per-workspace console MIDI learn) above a scenes & media manager. The drop page became a **KXKM chat** composer (message / attach / *Go live*) that adapts to each scene's accept-types.
- **Phase 5 — machines & stations** ✅ the "player" split into a **Machine** (physical box: static name, device type, description, fixed kiosk URL) and a per-project **Station** (a machine bound into a project with its own surface/playback/MIDI + rig nickname). Control-room columns are stations; a gear opens the station settings modal; activating a scene drives the station's machine (taking it over from other projects). Migration preserves kiosk tokens.
- **Extras** ✅ text drop (`.txt`) shown on players, admin playback remote, `/diag` WebRTC tester.

A few names shifted from the original plan below: *sources* are called **scenes**
(each reachable by its own shareable URL — no public/private flag); camera takeover
is the scene accept-type **`stream`** (not a separate `/cam` URL); the live admin
loop now centres on a project **workspace / control room**. The server also split
into an **`app.js`** factory (wiring) + a thin **`server.js`** (listen), and gained
**`lib/model.js`** (store queries) and **`lib/playlist.js`** (active-source → playlist) —
the *New mental model*, *Data model*, *Server restructure* and *Front-end* sections
below are the original plan; see Phase 4 at the bottom for the as-built shape.

## Context — why this change

Today Dropfile (`server.js`, ~200 lines) is a single-purpose drop tool: filesystem-only storage (projects = directories under `UPLOAD_PATH`), multer uploads named `{nick}_{ts}_{last10}`, a real-time "fresh-queue" diaporama (`www/diaporama.js`), and admin delegated to an external **Filebrowser** child process proxied at `/admin`. No auth, no QR, no concept of display hardware.

The collective's real need is a **media controller**: physical **display surfaces** (monitors and scaler-less LED walls) fed by **sources** (preloaded server folders, public drop folders, later live phone cameras and MIDI-selected media), configured and driven live from an admin console. This roadmap restructures the project around that model while keeping the lightweight stack (Express + Socket.IO + multer, vanilla front-end, no build step).

## New mental model

```
Players  (top-level POOL — each = one physical display surface)
  player "LED wall stage-left"  token URL (+QR) · hardware/scaler settings · playback settings
  player "lobby TV"             token URL (+QR) · ...
        │  (many-to-many attach)
        ▼
Projects  (content grouping)
  Project "Festival2026"
    └── Sources
         ├── drop folder      → public blind drop box (QR/URL), user-contributed
         └── preloaded folder → files placed/managed by admin
```

- A **Source** maps to one filesystem folder and belongs to one project.
- A **Player** is an independent entity (nickname + token URL + hardware/scaler settings). It is **attached to one or more projects** and, at any moment, points at one **active source** within one of those projects. Re-pointing a player to another project's source is a live admin action — the player's URL and scaler config stay put because they describe the *screen*, not the content.
- Attach is **bidirectional in the UI**: from a player's page you pick projects; from a project's page you pick players. Canonically stored once (on the player) to avoid desync — the project→players list is derived.
- Admin edits → persisted to JSON → broadcast live to every open player over WebSocket.

## Decisions locked

| Topic | Decision |
|---|---|
| Hosting | Public internet; players/phones/admin on different networks |
| Open access | Drop, player display & camera URLs open, secured by **unguessable token** in URL (QR-first UX) |
| Admin auth | **Single shared password** from `.env` (HTTP Basic on admin routes/pages) |
| Config store | **JSON store** (lowdb-style), media stays on filesystem |
| Players vs projects | **Players are a top-level pool**, many-to-many attach to projects, re-pointable live |
| Scaler settings owner | Belong to the **player** (the physical surface), not the project/source |
| Restart behaviour | **Players survive restart** — state read from `db.json`, auto-resume active source |
| `loop: lastX` | Means **last X *uploaded*** (newest X by upload time) |
| Camera | **WebRTC** (audio+video, front/back switch), Socket.IO signaling — Phase 2 |
| WebRTC NAT | **Self-hosted coturn** (STUN+TURN) on the public box; short-lived ICE creds via `lib/turn.js` (coturn `use-auth-secret`, no static password shipped to clients); install = ops step in README |
| Front-end | **Vanilla + Alpine.js** (CDN, ~10KB), no build step |
| Thumbnails | **sharp** (images) + **ffmpeg** (video posters), cached on disk |
| Drop privacy | **Blind box** — uploader never sees others' media; may see/remove only *their own* (visitor token) |

## Data model — `DATA_PATH/db.json` (gitignored)

`lib/store.js`: tiny atomic JSON store (read whole file; write via temp-file + `rename`). Stays commonjs. IDs/tokens via `crypto.randomBytes` in `lib/ids.js`.

```jsonc
{
  "projects": {
    "<projectId>": {
      "id", "name", "slug",            // slug = folder under UPLOAD_PATH
      "createdAt",
      "sceneOrder": [ "<sourceId>", ... ],                    // explicit scene order
      "console": { "map": { "<midiKey>": { "playerId", "action" } } }, // workspace operator desk
      "sources": {                     // "scenes"
        "<sourceId>": { "id", "name", "folder",
                        "dropToken",                          // every scene is URL-shared
                        "allowSelfDelete",
                        "accept": { "image", "video", "text", "stream" },
                        "streamMode": "replace|grid",
                        "order": [ "<filename>", ... ] }      // explicit media order
      }
    }
  },
  "players": {                          // TOP-LEVEL POOL
    "<playerId>": {
      "id", "name", "token",           // token = stable public display URL
      "createdAt",
      "projectIds": [...],             // CANONICAL many-to-many attach list
      "activeProjectId", "activeSourceId",
      "selectedName",                  // clip held in manual mode (resumes after restart)
      "settings": {
        "playMode": "diaporama|manual", "imageDuration", "loop": "all|lastX", "lastX",
        "prioritizeFresh": true,
        "scaler": { "container": "full|custom", "width", "height",
                    "fit": "contain|cover",
                    "posX": "left|center|right|custom", "offsetX",
                    "posY": "top|center|bottom|custom", "offsetY",
                    "rotation", "evenLineSuppression" },
        "midi": { "map": { "<midiKey>": { "type": "media|transport|blackout", ... } } }
      }
    }
  },
  "uploads": {                         // blind-box "my uploads" manifest (per scene)
    "<sourceId>": { "<fileId>": { "filename", "uploaderToken", "nick", "time", "type" } }
  }
}
```

`project → players` is **derived** by filtering players whose `projectIds` contains the project id — no mirrored array, no desync.

## Filesystem layout (under `UPLOAD_PATH`)

```
UPLOAD_PATH/
  <project-slug>/
    <source-folder>/        # drop or preloaded files
      _archive/             # bulk-archived files
  .thumbs/<sha>.jpg         # thumbnail cache
```

Listings exclude names starting with `_`/`.`, so `_archive` and `.thumbs` are filtered for free.

## URL & routing scheme

**Public (token-secured, QR-first):**
- `GET /d/:dropToken` → blind drop page for one source
- `GET /p/:playerToken` → player display (canvas renderer)
- `GET /media/<project>/<source>/<file>` → media

**Public APIs:**
- `POST /api/drop/:dropToken` → upload (multer dest = that source's folder; record in `uploads`)
- `GET /api/drop/:dropToken/mine` → caller's own uploads (visitor cookie token)
- `DELETE /api/drop/:dropToken/:fileId` → remove own file (if `allowSelfDelete` & token matches)
- `GET /api/player/:playerToken` → resolved config (active source, settings, ICE servers)
- `GET /api/player/:playerToken/playlist` → media list (mtime sort)

**Admin (HTTP Basic, `ADMIN_PASSWORD`):** `/admin/*` pages + `/api/admin/*`
- Projects CRUD; Sources CRUD (per project)
- Players CRUD (pool); `POST /api/admin/players/:id/attach` / `/detach` `{projectId}`
- `PUT /api/admin/players/:id/active` `{projectId, sourceId}` → set active + broadcast
- `PUT /api/admin/players/:id/settings` → persist + broadcast
- `GET /api/admin/projects/:id/files?source=&sort=` → browser (thumbs, size, mtime; default sort = upload date)
- `POST /api/admin/files/delete` / `/archive` (bulk)
- `GET /api/admin/qr?data=<url>` → QR PNG/SVG

**Socket.IO** (rooms keyed by player token):
- `player-join` `{playerToken}` → join `player:<token>`
- Server → `settings` (live config/scaler), `active-change` (reload playlist), `new-media` (fresh upload to active source), `command` (manual next/prev/reload)

## Server restructure

*As built (the plan below merged the factory + listener into one `server.js`; it
was split for testability, and `model`/`playlist` were extracted):*

```
app.js               # build() — wires Express app + HTTP + Socket.IO (importable factory)
server.js            # loads app, listens on FRONTEND_PORT
lib/store.js         # atomic JSON store (db.json)
lib/ids.js           # id/token (crypto) + slug helpers
lib/media.js         # ext detection, mtime listing, ordering, sanitize helpers
lib/model.js         # store queries (find by token, source dir, project↔players)
lib/playlist.js      # resolve a player's active source → media playlist
lib/thumbs.js        # sharp + ffmpeg thumbnail cache (sha-keyed)
lib/auth.js          # Basic-auth middleware (ADMIN_PASSWORD)
lib/turn.js          # WebRTC ICE: short-lived coturn creds (use-auth-secret)
lib/migrate.js       # first-boot folder import + idempotent store upgrades
routes/drop.js       # /d, /api/drop/* (upload, text, blind "my uploads")
routes/player.js     # /p, /api/player/*, /diag, /api/ice
routes/admin.js      # /admin/api/* + static admin SPA (behind Basic auth)
sockets/index.js     # player rooms, live status feedback, WebRTC stream signaling
```

**Remove:** `filebrowser` spawn + `express-http-proxy` + `filebrowser.db` (replaced by integrated browser); drop `body-parser` for built-in `express.json`/`urlencoded`.

**Reuse:** multer disk storage with dynamic per-source destination; image/video ext arrays + media mapping; mtime sort; sanitization regexes; the fresh-queue diaporama engine.

## Front-end (Alpine.js via CDN, no build)

```
www/
  drop.html  + drop.js         # KXKM chat composer (text / attach / Go live) + "my messages"
  player.html+ player.js       # canvas compositor + diaporama/manual engine + MIDI
  receiver.js + camera.js      # WebRTC player-side receiver + drop-side camera sender
  midi.js                      # shared Web MIDI bus (player + admin)
  diag.html                    # WebRTC Trickle-ICE tester
  admin/index.html + admin.js  # Alpine SPA: Projects grid · Players pool · Workspace (control room)
```

- **Drop page** — **KXKM chat**: a composer that adapts to the scene's accept-types (message box / media attach / *Go live*); the timeline shows only *your own* contributions; delete your own (visitor token); never lists others' media.
- **Player engine** — joins `player:<token>`, fetches config + playlist, renders every frame through a `<canvas>` compositor for pixel-accurate LED scaling, hot-applies `settings`/`active-change` live, supports `diaporama` and `manual`, reports live status back to the control room, resumes active source on reconnect/restart.
- **Canvas compositor** — forced output resolution, `fit` contain/cover, h/v position+offset, rotation, and **even-line suppression** (draw only odd output rows).
- **Admin** — Alpine SPA, three views: a **Projects** grid → a per-project **workspace** (a live **control room** — one column per attached player: scene buttons, clip thumbnails, transport, blackout, live status, console MIDI learn — above a scenes & media manager with thumbnail grid, drag-reorder, and a bulk delete/archive media modal); and a **Players** pool page (per-screen scaler / auto-play / local-MIDI config + display QR).

## Dependencies

Add: `sharp`, `qrcode`; `alpinejs` via CDN. `ffmpeg` via `child_process` for video posters. **Remove:** `express-http-proxy`, `body-parser`; drop external `filebrowser`.

New `.env` keys (see `.env.example`): `PUBLIC_URL`, `ADMIN_PASSWORD`, `DATA_PATH`, and Phase-2 `TURN_HOST`/`TURN_SECRET`/`TURN_TTL`.

## Migration (`lib/migrate.js`, run on first boot if `db.json` absent)

Scan `UPLOAD_PATH`; for each existing valid top-level dir create a project with one `preloaded` source pointing at that folder; generate ids/tokens; write `db.json`. No players created (admin adds them). Existing `/diaporama?folder=X` links 302-redirect to a player route during a deprecation window.

## Phase 1 — build in one shot

1. **Foundations** — `lib/store`, `lib/ids`, `lib/media`, `lib/auth`, `.env` additions, `server.js` rewired; remove filebrowser/proxy/body-parser; `lib/migrate` auto-import.
2. **Thumbnails** — `lib/thumbs`: sha-keyed cache in `.thumbs/`, sharp for images, `ffmpeg -ss 1 -frames:v 1` → sharp for videos.
3. **Admin auth + projects/sources CRUD** — Basic auth gate; project + source create/rename/delete; drop token + QR.
4. **Integrated browser** — thumbnail grid, size, upload date; default sort by upload date; multi-select bulk delete + archive (→ `_archive`). Replaces Filebrowser.
5. **Players pool + attach** — player CRUD; attach/detach projects (both directions); set active project+source; settings form incl. scaler; display QR.
6. **Drop UX** — `/d/:dropToken` blind page: multi-upload, QR/share, "my uploads" with delete; record uploads in manifest; never expose others' files.
7. **Player display + live control** — `/p/:playerToken`: canvas compositor + diaporama/manual engine; reloads on `active-change`; fresh `new-media` queue; live `settings` apply; resumes after restart.
8. **LED/scaler** — finalize compositor: forced resolution, fit, position+offset, rotation, even-line suppression.

**Phase 1 acceptance:** password-gated admin creates a project + drop + preloaded source, browses files with thumbnails/sorting/bulk archive; a phone scans a drop QR and multi-uploads, seeing only its own uploads; a pooled player attached to multiple projects can be pointed at any source live, shown on two screens that both update within ~1s on settings/scaler/active-source change; fresh uploads appear on players whose active source matches; players auto-resume after a server restart.

## Phase 2 — Camera takeover (WebRTC)

`/p/:playerToken/cam` phone sender; Socket.IO signaling (`cam-offer`/`cam-answer`/`cam-ice` in the player room); ICE servers built by `lib/turn.js` from `.env` (coturn `use-auth-secret` → short-lived HMAC creds, no static password shipped to clients); front/back switch; player `sourceMode: camera` with takeover/release. **README** documents coturn install + config (public box, ports 3478/5349 + relay range, realm, `static-auth-secret`, `external-ip`) — see `extra/turnserver.conf`.

**Built as:** camera takeover is a scene accept-type **`stream`** (4th alongside image/video/text) with a per-scene **single / grid** mode, not a separate `/cam` URL. The streamer joins the scene's room (`stream-join` by `dropToken`); players join by `playerToken`; mesh signaling uses `rtc-offer`/`rtc-answer`/`rtc-ice`. The player renders incoming streams on its canvas compositor (single = newest fills container; grid = tiled), **takes over** the folder diaporama while anyone is live and **reverts** when all stop; audio plays from the **active (newest)** stream only. `www/camera.js` = sender, `www/receiver.js` = player. `/diag` (+ `/api/ice`) is a single-device Trickle-ICE tester for coturn.

## Phase 3 — MIDI source

Web MIDI on the player; **learn mode** (incoming note/CC → media index) stored per player; manual selection via controller (e.g. Korg nanoKONTROL). `sourceMode: midi` over a folder source.

**Built as:** a player **`playMode: midi`** (trigger surface — holds the triggered clip, no auto-advance). A shared `www/midi.js` runs on **both** the player and the admin (Web MIDI). Mappings (`settings.midi.map`, key `note:ch:d1` / `cc:ch:d1`) bind to one of: **select a media**, **transport** (next/prev/play/pause/restart/reload), or **blackout** (toggled in the canvas compositor). Learn happens on the player screen (press `m`) or in the admin's per-player MIDI panel; the admin also has a **"drive from my controller"** toggle that dispatches mapped pad presses to the player via the command channel. Map persists via `PUT /admin/api/players/:id/midi` (admin) and `PUT /api/player/:token/midi` (player), kept separate from the general settings PUT so neither clobbers the other.

> Superseded by Phase 4: there is no longer a `playMode: midi`. Play mode is
> `diaporama | manual`, switched live from the control room (auto-play vs select);
> MIDI is a **binding layer** over either, both player-local (`settings.midi.map`)
> and at the workspace console (`project.console.map`).

## Phase 4 — Workspaces, control room & chat drop

The admin collapsed from per-entity pages into a **task-oriented** shape.

- **Projects grid** (landing) → open one into a **workspace**.
- **Workspace = live control room + content manager.** The control room shows one
  **column per attached player**: a live status line (fed back over Socket.IO via
  `player-status` → the `admins` room), scene buttons, the active scene's clip
  thumbnails, transport (restart/prev/pause/next), an **auto-play** toggle
  (diaporama) with its duration/loop/fresh options, and **blackout**. Clicking a
  scene re-points that player live; clicking a clip sets **manual** mode and holds
  it (`selectedName`). Below it, a **scenes & media** manager: drag-reorder scenes
  and media, per-scene accept-type chips (`image`/`video`/`text`/`stream` + single/grid
  stream mode), bulk delete/archive in a media modal.
- **Operator console MIDI** is per-workspace (`project.console.map`): MIDI-learn a pad
  to any player's scene / clip / transport / blackout, then drive the whole desk from
  one controller. This replaced the Phase-3 `playMode: midi` trigger surface; a player
  still keeps its own local MIDI map (`settings.midi.map`).
- **Players pool** stays a separate top-level page for per-screen config (scaler,
  auto-play defaults, local MIDI, display QR).
- **Drop page → KXKM chat.** The blind drop became a chat-style composer that adapts
  to the scene's accept-types: a message box (text → `.txt`), a media attach button,
  and/or **Go live** (camera). The timeline shows only the visitor's own contributions;
  a hook is left in `drop.js` for future operator → audience broadcast messages.

## Phase 5 — Machines & Stations

The original **Player** conflated the physical box (its kiosk URL + identity) with
per-show display config (surface, attachments, active scene). Split into two:

- **Machine** — a physical box (pool, `store.data.machines`). Identity (`name`,
  `type` from the editable `store.data.deviceTypes`, `description`) + a **stable
  kiosk `token`** (`/p/:token`, set once on the box, never changes) + runtime
  *active* (`activeProjectId`, `activeStationId`, `activeSceneId`, `selectedName`,
  `playMode`). The machine is the runtime display target — it shows one thing.
- **Station** — a machine bound into one project (`project.stations[id]`):
  `machineId`, `nickname` ("Totem screen", "Cart 1"), `surface` (the scaler block),
  `playback` (imageDuration/loop/lastX/prioritizeFresh) and a `midi` map. The same
  box is a different station per project — at most one station per machine per
  project; `machine ↔ stations` is derived by scanning projects.

```jsonc
"machines": { "<id>": { "id","name","token","type","description","createdAt",
                        "activeProjectId","activeStationId","activeSceneId",
                        "selectedName","playMode" } },
"deviceTypes": [ "Raspberry Pi 4", "N150 miniPC", … ],
"projects": { "<id>": { …, "stations": { "<sid>": {
   "id","machineId","nickname",
   "surface": { container,width,height,posX,offsetX,posY,offsetY,fit,rotation,evenLineSuppression },
   "playback": { imageDuration,loop,lastX,prioritizeFresh },
   "midi": { map } } }, "stationOrder": [ … ] } }
```

**Runtime / takeover.** The kiosk (`/api/player/:machineToken`) resolves the machine
→ its active station → **composes** the same `settings` object the kiosk already
consumed (surface as `scaler`, playback flags, `midi`, `playMode`) — so `player.js`
is unchanged. Activating a scene on a station (control room or console MIDI) sets the
machine's active to *(project, station, scene)* and **takes the box over** from any
other project; that project's column then shows the station as *in use elsewhere*.

**UI.** The Players page became a **Machines** pool (name, device type, description,
kiosk URL/QR, "manage device types"). Control-room columns are **stations**; a gear
opens a **station settings modal** (surface + playback + local MIDI), since these are
set once at project start. `lib/defaults.js` holds the default/clean shapes and
`composeSettings`; `lib/model.js` and `lib/playlist.js` resolve machines/stations.

**Migration** (`lib/migrate.js`, idempotent): each legacy player → one Machine
(**same token/URL**) + one Station per attached project (surface/playback/MIDI copied
from the player's settings), carrying the runtime active state. No kiosk re-provisioning.
