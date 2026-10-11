# H5P Agent Viewer — Handoff

**Date:** 10 October 2026  
**Location:** `D:\edu\h5p\H5P agent viewer`  
**Built from:** ACS H5P Opus Viewer v0.1.1 (release build)  
**Player engine:** @missing-elements/h5p-offline-player 0.3.1  
**Status:** Working — packages load and render in browser  

## What this is

A standalone, agent-friendly H5P viewer that runs in any browser. No Directory Opus, no C++ DLL, no WebView2 embedding required. Built by adapting the ACS H5P Opus Viewer's helper server and web assets, adding API endpoints and a multi-package browser shell.

## How to run

```bash
cd "D:\edu\h5p\H5P agent viewer"
node launch.mjs
```

The server starts on an ephemeral port and prints:
```
VIEWER_URL=http://127.0.0.1:54321/
```

Open that URL in any browser. The sidebar shows all `.h5p` files in the `packages/` directory. Click any package to load it — the page navigates to a token-scoped URL, the Service Worker registers, and the H5P renders.

To load a specific package at startup:
```bash
node launch.mjs "D:\edu\h5p\H5P agent viewer\packages\cpccbc4012-01-flooring-bracing-site-plans.h5p"
```

Flags:
- `--no-browser` — don't auto-open browser
- `--port <N>` — bind to specific port (default: ephemeral)

## What's included

### Pre-loaded packages (CPCCBC4012 module — 7 chapters)

| File | Title |
|---|---|
| `cpccbc4012-01-flooring-bracing-site-plans.h5p` | Flooring, bracing and site plans |
| `cpccbc4012-02-structural-principles-loads.h5p` | Structural principles and loads |
| `cpccbc4012-03-comparing-structural-info.h5p` | Comparing structural load bearing information |
| `cpccbc4012-04-provisional-sums-prime-costs.h5p` | Provisional sums and prime costs |
| `cpccbc4012-05-drawings-sketches-illustrations.h5p` | Drawings, sketches and illustrations |
| `cpccbc4012-06-ncc-building-classifications.h5p` | NCC building classifications |
| `cpccbc4012-07-plan-types-bim-civil.h5p` | Plan types, BIM and civil drawings |

Each package is a self-contained ZIP with all H5P libraries bundled (44 libraries, 84+ images per chapter).

### File structure

```
H5P agent viewer/
├── launch.mjs              # Node launcher (start here)
├── package.json             # npm metadata
├── runtime.json             # Node path config
├── README.md                # Full documentation
├── HANDOFF.md               # This file
├── helper/
│   └── server.mjs           # Enhanced HTTP server with API endpoints
├── web/
│   ├── index.html           # Agent shell (sidebar + player + bottom panel)
│   ├── app.js               # Shell logic (package list, xAPI capture, scores)
│   ├── sw.js                # Service worker anchor
│   ├── config.json          # Default config (overwritten at runtime)
│   ├── assets/
│   │   ├── h5p-player.js    # H5P Offline Player 0.3.1 (51 KB)
│   │   ├── h5p-jobs.js      # Background job handler (25 KB)
│   │   ├── h5p-sw.js        # Service Worker for ZIP reading (207 KB)
│   │   ├── h5p-sw-mount.js  # SW mount helper (207 KB)
│   │   ├── VERSION          # Player version
│   │   └── frame-assets/    # H5P standalone runtime
│   │       ├── frame.bundle.js  # Main H5P frame (144 KB)
│   │       ├── main.bundle.js   # H5P main bundle (23 KB)
│   │       ├── h5p.css          # H5P styles (72 KB)
│   │       ├── MANIFEST.json    # Version manifest
│   │       ├── LICENSE.txt     # GPL-3.0
│   │       ├── NOTICE.txt
│   │       └── fonts/          # Inter + Open Sans woff2
│   └── licenses/
│       ├── GPL-3.0.txt
│       └── h5p-offline-player-NOTICE.md
├── packages/                # Drop .h5p files here
│   ├── cpccbc4012-01-*.h5p
│   ├── cpccbc4012-02-*.h5p
│   ├── ...
│   └── cpccbc4012-07-*.h5p
└── screenshots/             # Empty — for agent screenshot captures
```

## API endpoints

All endpoints are loopback-only (`127.0.0.1`). No external access.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/packages` | List packages in `packages/` dir with metadata |
| POST | `/api/load` | Load package by name or path — body: `{"name":"file.h5p"}` or `{"path":"C:\\abs.h5p"}` |
| POST | `/api/clear` | Unload current package, reset xAPI log |
| GET | `/api/status` | Current package name, generation, xAPI count |
| GET | `/api/xapi` | All collected xAPI statements (max 500) |
| GET | `/api/scores` | Score/success/completion results extracted from xAPI |
| POST | `/api/xapi` | Receive an xAPI statement from the player |

### Example: load a package via API

```bash
curl --noproxy '*' -X POST http://127.0.0.1:<port>/api/load \
  -H "Content-Type: application/json" \
  -H "Origin: http://127.0.0.1:<port>" \
  -d '{"name":"cpccbc4012-01-flooring-bracing-site-plans.h5p"}'
```

Response:
```json
{
  "ok": true,
  "generation": 1,
  "name": "cpccbc4012-01-flooring-bracing-site-plans.h5p",
  "title": "CPCCBC4012 - 01 - Flooring, bracing and site plans",
  "url": "http://127.0.0.1:54321/AbCdEf.../index.html?generation=1"
}
```

## Bugs fixed during testing

### Bug 1: POST /api/load returns "Failed to fetch" in browser

**Root cause:** The `invalidate()` function called `res.destroy()` on ALL responses in the `responses` Set — including the current POST request's own response. The socket was destroyed before `sendJson()` could write the response.

**Fix:** In `POST /api/load` and `POST /api/clear` handlers, remove the current response from the Set before invalidating, then re-add it:
```js
responses.delete(res);
current = null;
for (const r of responses) r.destroy();  // only destroys old connections
responses.add(res);                       // put ours back
```

### Bug 2: "Could not register h5p-sw.js" Service Worker error

**Root cause:** When a package was clicked in the sidebar, `app.js` set `player.src` to the new token URL but the page itself stayed at the old URL (or root `/`). The Service Worker tried to register at `assets/h5p-sw.js` relative to the page URL, which resolved to the wrong token scope.

**Fix (two parts):**

1. **Page navigation** — `app.js` now navigates the whole page to the new token URL (`window.location.href = data.url`) instead of just setting `player.src`. This ensures the page, SW, and player all share the same token scope.

2. **Root-level asset serving** — When the page is at root `/` (no package loaded), the server now serves `app.js`, `sw.js`, `config.json`, and `assets/*` without requiring a token. Previously these returned 404 at the root level.

### Bug 3: loadConfig() not setting player src

**Root cause:** The agent shell's `loadConfig()` fetched `/api/status` but didn't set `player.src` from the result. The player never received the package URL.

**Fix:** `loadConfig()` now fetches `./config.json` (relative to the page URL, served by the token-based config endpoint) and sets `player.src = config.packageUrl`, matching the original ACS viewer's behavior.

## What was changed from the original ACS viewer

### `helper/server.mjs` — enhanced

**Added:**
- `GET /api/packages` — scans `packages/` directory, reads h5p.json metadata
- `POST /api/load` — loads by filename (resolved from packages/) or absolute path
- `POST /api/clear` — unloads current package
- `GET /api/status` — returns current package info
- `GET /api/xapi` — returns collected xAPI statements
- `GET /api/scores` — extracts scored results from xAPI log
- `POST /api/xapi` — receives xAPI statements from the browser
- `OPTIONS` handling for CORS preflight
- Root URL (`/`) and root-level assets (`/app.js`, `/assets/*`, etc.) served without a token
- xAPI log array (max 500 entries, reset on package load)
- Safe invalidate in POST handlers (preserves current response)

**Preserved:**
- All original ZIP-reading logic (byte-range, central directory parsing)
- All original security (loopback-only, opaque tokens, Host/Origin checks)
- stdin JSON-lines protocol (backwards compatible with DLL/launcher)
- Token-based package serving

### `web/index.html` — new agent shell

**Added:**
- Left sidebar with package list (title, filename, size)
- Bottom panel with 3 tabs: Events, xAPI, Scores
- Resizable bottom panel (drag handle)
- Refresh packages button
- Clear xAPI button

**Preserved:**
- `<h5p-player>` element with same attributes (`sw`, `assets-base`, `resume`)
- CSP meta tag
- Service worker registration

### `web/app.js` — new shell logic

**Added:**
- Package list fetching from `/api/packages`
- Click-to-load from sidebar (navigates page to token URL)
- `loadConfig()` fetches `./config.json` and sets `player.src`
- xAPI statement capture via `H5P.externalDispatcher.on('xAPI', ...)` polling
- Score panel auto-update
- Event log
- Tab switching
- Resize handle

### `launch.mjs` — new launcher

Starts the server, optionally loads a package, prints the URL. Supports `--no-browser` and `--port` flags.

## How package loading works (flow)

1. User opens `http://127.0.0.1:<port>/` in browser
2. Server serves `index.html` + `app.js` + `h5p-player.js` at root level (no token)
3. `app.js` fetches `/api/packages` → sidebar populates with 7 packages
4. User clicks a package → `app.js` sends `POST /api/load` with `{"name":"..."}`
5. Server loads the H5P ZIP, extracts metadata, creates a new token, responds with `{"url":"http://127.0.0.1:<port>/<token>/index.html?generation=N"}`
6. `app.js` navigates: `window.location.href = data.url`
7. Page loads at `/<token>/index.html` — SW registers at `/<token>/assets/h5p-sw.js` ✓
8. `app.js` fetches `./config.json` → `/<token>/config.json` → `{"packageUrl":"/<token>/package.h5p"}`
9. Sets `player.src = "/<token>/package.h5p"`
10. Player SW reads the H5P ZIP via byte-range HTTP from `/<token>/package.h5p`
11. H5P Course Presentation renders with all activities interactive

## Known limitations

1. **xAPI capture timing** — The H5P player runs inside a Service Worker-controlled iframe. The xAPI hook polls every 500ms for up to 30 seconds to find `H5P.externalDispatcher`. If the player loads slowly, some early statements may be missed.

2. **One package at a time** — The server serves one active package. Loading a new one invalidates the old session (old SW URLs return 404). This is by design (security: opaque tokens).

3. **No persistence** — xAPI statements are in-memory only. They reset when the server restarts or a new package loads. Use the API to capture them before switching.

4. **No screenshot automation** — The viewer doesn't include built-in screenshot capture. Use Playwright or the browser's built-in tools.

5. **CSP restrictions** — The `default-src 'self'` CSP blocks external images. H5P packages must be self-contained (all assets inside the ZIP).

6. **Proxy interference** — If the machine has an HTTP proxy configured (e.g., `http_proxy` env var), `curl` requests may route through it and fail. Use `--noproxy '*'` or set `no_proxy=127.0.0.1`. Browser `fetch()` from the page is not affected since it goes directly to `127.0.0.1`.

## Next steps for agents

1. **Test the viewer** — Run `node launch.mjs`, open the URL, click through the 7 CPCCBC4012 chapters
2. **Verify xAPI capture** — Answer activities and check the xAPI/Score tabs
3. **Add Playwright integration** — Point Playwright at the viewer URL for automated screenshot capture
4. **Add more packages** — Copy `.h5p` files from other modules into `packages/`
5. **Integrate with build pipeline** — After V2.2 finalise, auto-copy packages to this viewer's `packages/` dir

## Source attribution

- **ACS H5P Opus Viewer** by @dgcruzing — https://github.com/dgcruzing/acs-h5p-opus-viewer (MIT)
- **H5P Offline Player** 0.3.1 by @missing-elements (MIT + GPL-3.0)
- **H5P Standalone** 3.8.2 — bundled in frame-assets
- Agent shell, launcher, and API enhancements — original work for this project
