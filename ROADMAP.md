# Dropfile → Media-Controller: Refactor Roadmap

Turns Dropfile from a file-drop tool into a media controller: a **pool of Players** (display surfaces) fed by **Sources** grouped into **Projects**.

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
      "sources": {
        "<sourceId>": { "id", "type": "drop|preloaded", "name", "folder",
                        "dropToken", "allowSelfDelete" }
      }
    }
  },
  "players": {                          // TOP-LEVEL POOL
    "<playerId>": {
      "id", "name", "token",           // token = stable public display URL
      "createdAt",
      "projectIds": [...],             // CANONICAL many-to-many attach list
      "activeProjectId", "activeSourceId",
      "settings": {
        "playMode": "diaporama|manual", "imageDuration", "loop": "all|lastX", "lastX",
        "prioritizeFresh": true,
        "scaler": { "container": "full|custom", "width", "height",
                    "fit": "contain|cover",
                    "hPosition", "hOffset", "vPosition", "vOffset",
                    "rotation", "evenLineSuppression" }
      }
    }
  },
  "uploads": {                         // blind-box "my uploads" view
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

```
server.js            # wiring: app, http, io, mount routers, start, load store
lib/store.js         # atomic JSON store
lib/ids.js           # id/token (crypto) + slug helpers
lib/media.js         # ext detection, mtime listing, sanitize helpers
lib/thumbs.js        # sharp + ffmpeg thumbnail cache (sha-keyed)
lib/auth.js          # Basic-auth middleware (ADMIN_PASSWORD)
lib/turn.js          # WebRTC ICE: short-lived coturn creds (use-auth-secret)
lib/migrate.js       # one-time import of existing folders → projects
routes/drop.js       # /d, /api/drop/*
routes/player.js     # /p, /api/player/*
routes/admin.js      # /admin, /api/admin/* (behind auth)
sockets/index.js     # connection, player rooms, settings/active broadcast
```

**Remove:** `filebrowser` spawn + `express-http-proxy` + `filebrowser.db` (replaced by integrated browser); drop `body-parser` for built-in `express.json`/`urlencoded`.

**Reuse:** multer disk storage with dynamic per-source destination; image/video ext arrays + media mapping; mtime sort; sanitization regexes; the fresh-queue diaporama engine.

## Front-end (Alpine.js via CDN, no build)

```
www/
  drop.html  + drop.js     # blind drop box (Dropzone multi-upload) + "my uploads" manager
  player.html+ player.js   # canvas compositor + diaporama engine
  admin/index.html + admin.js  # Alpine: projects, sources, browser, player pool, settings, QR
```

- **Drop page** — Dropzone multi-upload; QR/share; "my uploads" grid with delete (visitor cookie token); never lists others' media.
- **Player engine** — joins `player:<token>`, fetches config + playlist, renders every frame through a `<canvas>` compositor for pixel-accurate LED scaling, hot-applies `settings`/`active-change` live, supports `diaporama` and `manual`, resumes active source on reconnect/restart.
- **Canvas compositor** — forced output resolution, `fit` contain/cover, h/v position+offset, rotation, and **even-line suppression** (draw only odd output rows).
- **Admin** — Alpine panels: Projects (sources + integrated browser with thumbnail grid, sort by upload date, bulk delete/archive); Players pool (attach both directions, set active source, settings form incl. full scaler block, display QR).

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

## Phase 3 — MIDI source

Web MIDI on the player; **learn mode** (incoming note/CC → media index) stored per player; manual selection via controller (e.g. Korg nanoKONTROL). `sourceMode: midi` over a folder source.
