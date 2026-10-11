# H5P Agent Viewer — Testing Handoff Prompt

Copy everything below the line and paste it into a new agent conversation to get testing started.

---

## H5P Agent Viewer — Test and Verify

You are testing the **H5P Agent Viewer**, a local web application that plays H5P interactive lessons in any browser. It is located at `D:\edu\h5p\H5P agent viewer`.

### What it is

A standalone, agent-friendly H5P viewer built on the ACS H5P Opus Viewer engine (H5P Offline Player 0.3.1). It runs a loopback HTTP server with API endpoints for package loading, xAPI statement capture, and score reporting. No Directory Opus, no C++ DLL, no WebView2 — just Node.js + a browser.

7 CPCCBC4012 (construction plans) H5P packages are pre-loaded in `packages/`. Each is a self-contained ZIP with 44 bundled H5P libraries and 84+ images.

### How to start it

```bash
cd "D:\edu\h5p\H5P agent viewer"
node launch.mjs --no-browser
```

The server prints `VIEWER_URL=http://127.0.0.1:<port>/`. Capture that port — you'll need it for API calls.

**Important:** If using `curl` to test API endpoints, always pass `--noproxy '*'` because this machine has an HTTP proxy env var that breaks localhost requests. Browser `fetch()` is not affected.

### What to test

Run through these tasks in order. Report what works, what fails, and any errors you see.

#### Task 1: Start the server and verify the API

1. Start the server with `node launch.mjs --no-browser`
2. Capture the port from the `VIEWER_URL=...` output line
3. Test these endpoints with curl (use `--noproxy '*'`):

```bash
# List packages — should return 7 packages
curl --noproxy '*' -s http://127.0.0.1:<PORT>/api/packages

# Check status — should show generation 0, no package loaded
curl --noproxy '*' -s http://127.0.0.1:<PORT>/api/status

# Root page — should return 200 text/html
curl --noproxy '*' -s -o /dev/null -w "%{http_code}" http://127.0.0.1:<PORT>/

# Root-level app.js — should return 200 text/javascript
curl --noproxy '*' -s -o /dev/null -w "%{http_code}" http://127.0.0.1:<PORT>/app.js
```

#### Task 2: Load a package via API and verify token-scoped endpoints

```bash
# Load chapter 1
curl --noproxy '*' -s -X POST http://127.0.0.1:<PORT>/api/load \
  -H "Content-Type: application/json" \
  -H "Origin: http://127.0.0.1:<PORT>" \
  -d '{"name":"cpccbc4012-01-flooring-bracing-site-plans.h5p"}'
```

This returns a JSON with a `url` field containing a token. Extract the token from the URL (the random string between `/` and `/index.html`). Then test:

```bash
# Token-scoped config — should return packageUrl
curl --noproxy '*' -s http://127.0.0.1:<PORT>/<TOKEN>/config.json

# Token-scoped package file — should return 200
curl --noproxy '*' -s -o /dev/null -w "%{http_code}" http://127.0.0.1:<PORT>/<TOKEN>/package.h5p

# Token-scoped player JS — should return 200
curl --noproxy '*' -s -o /dev/null -w "%{http_code}" http://127.0.0.1:<PORT>/<TOKEN>/assets/h5p-player.js
```

#### Task 3: Load a second package and verify old token is invalidated

```bash
# Load chapter 2
curl --noproxy '*' -s -X POST http://127.0.0.1:<PORT>/api/load \
  -H "Content-Type: application/json" \
  -H "Origin: http://127.0.0.1:<PORT>" \
  -d '{"name":"cpccbc4012-02-structural-principles-loads.h5p"}'
```

Then verify the OLD token from Task 2 now returns 404, and the NEW token works.

#### Task 4: Open in browser and verify H5P renders

1. Open the `VIEWER_URL` in a browser (or use Playwright)
2. The sidebar should show all 7 packages with titles and sizes
3. Click `cpccbc4012-01-flooring-bracing-site-plans` in the sidebar
4. The page should navigate to a token URL and the H5P Course Presentation should render
5. You should see slides with interactive activities (drag-and-drop, fill-in-the-blanks, multiple choice, etc.)
6. Check the **Events** tab in the bottom panel — should show "Loading" and "Loaded" messages
7. Switch to chapter 2 by clicking it in the sidebar — should load a new package

**What to look for:**
- No "Failed to fetch" errors in the Events tab
- No "Could not register h5p-sw.js" errors in the browser console
- The H5P content renders (slides, images, interactive elements)
- The status bar shows "Ready" after loading

#### Task 5: Answer activities and verify xAPI capture

1. With a package loaded, interact with activities (click answers, drag items, fill blanks)
2. Check the **xAPI** tab in the bottom panel — should show statements like "answered: [activity name]"
3. Check the **Scores** tab — should show score results for answered activities
4. Query the API for xAPI data:

```bash
# Get all xAPI statements
curl --noproxy '*' -s http://127.0.0.1:<PORT>/api/xapi

# Get extracted scores
curl --noproxy '*' -s http://127.0.0.1:<PORT>/api/scores

# Get status (should show xapiCount > 0)
curl --noproxy '*' -s http://127.0.0.1:<PORT>/api/status
```

**Note on xAPI timing:** The xAPI capture polls every 500ms for up to 30 seconds to find `H5P.externalDispatcher` inside the player's iframe. If the player loads slowly, early statements may be missed. This is a known limitation.

#### Task 6: Test the clear endpoint

```bash
# Clear the current package
curl --noproxy '*' -s -X POST http://127.0.0.1:<PORT>/api/clear \
  -H "Content-Type: application/json" \
  -H "Origin: http://127.0.0.1:<PORT>"
```

Then verify `/api/status` shows no package loaded and xapiCount is 0.

### Expected results summary

| Test | Expected | 
|---|---|
| Server starts | Prints `VIEWER_URL=http://127.0.0.1:<port>/` |
| GET /api/packages | 7 packages with titles, mainLibrary, size |
| GET / (root) | 200, serves index.html |
| GET /app.js (root) | 200, serves app.js |
| POST /api/load | `{"ok":true,"generation":N,"name":...,"title":...,"url":...}` |
| GET /<token>/config.json | `{"generation":N,"name":...,"title":...,"packageUrl":"/<token>/package.h5p"}` |
| GET /<token>/package.h5p | 200, application/octet-stream |
| Old token after new load | 404 |
| Browser: sidebar | Shows 7 packages |
| Browser: click package | Page navigates, H5P renders, no SW errors |
| Browser: switch packages | New package loads, old token invalidated |
| Browser: answer activities | xAPI tab shows statements, Scores tab shows results |
| GET /api/xapi | Array of xAPI statements |
| GET /api/scores | Array of score objects |
| POST /api/clear | `{"ok":true,"generation":N}` |

### Known limitations (not bugs)

1. **xAPI capture timing** — Polls for 30 seconds max; early statements may be missed if player loads slowly
2. **One package at a time** — Loading a new package invalidates the old session (old URLs return 404)
3. **No persistence** — xAPI statements are in-memory only, reset on server restart or package switch
4. **No screenshot automation** — Use Playwright for automated screenshots
5. **CSP restrictions** — `default-src 'self'` blocks external images; H5P packages must be self-contained
6. **Proxy interference** — Use `--noproxy '*'` with curl; browser fetch is unaffected

### Architecture summary

```
launch.mjs (Node launcher)
  └── helper/server.mjs (loopback HTTP server)
        ├── /api/* endpoints (package list, load, clear, status, xAPI, scores)
        ├── /<token>/package.h5p (byte-range ZIP serving)
        ├── /<token>/config.json (player config with packageUrl)
        └── /<token>/index.html + assets/ (web shell + H5P player)
              ├── h5p-player.js (offline player engine 0.3.1)
              ├── h5p-sw.js (service worker for ZIP reading)
              ├── frame-assets/ (H5P standalone runtime)
              └── app.js (agent shell: sidebar, xAPI capture, score panel)
```

### Package loading flow

1. Browser opens `http://127.0.0.1:<port>/`
2. Server serves `index.html` + `app.js` + `h5p-player.js` at root (no token)
3. `app.js` fetches `/api/packages` → sidebar populates
4. User clicks a package → `app.js` sends `POST /api/load` with `{"name":"..."}`
5. Server loads H5P ZIP, creates token, responds with `{"url":"http://127.0.0.1:<port>/<token>/index.html?generation=N"}`
6. `app.js` navigates: `window.location.href = data.url`
7. Page loads at `/<token>/index.html` — SW registers at `/<token>/assets/h5p-sw.js`
8. `app.js` fetches `./config.json` → `{"packageUrl":"/<token>/package.h5p"}`
9. Sets `player.src = "/<token>/package.h5p"`
10. Player SW reads H5P ZIP via byte-range HTTP
11. H5P Course Presentation renders with all activities interactive

### File locations

- **Viewer root:** `D:\edu\h5p\H5P agent viewer`
- **Server:** `D:\edu\h5p\H5P agent viewer\helper\server.mjs`
- **Web shell:** `D:\edu\h5p\H5P agent viewer\web\index.html` + `app.js`
- **Launcher:** `D:\edu\h5p\H5P agent viewer\launch.mjs`
- **Packages:** `D:\edu\h5p\H5P agent viewer\packages\` (7 .h5p files)
- **Handoff doc:** `D:\edu\h5p\H5P agent viewer\HANDOFF.md`
- **Notion page:** https://app.notion.com/p/3f5d50fbce668018acedf685b2e59926

### Node.js path

Use the managed Node binary: `C:\Users\ACS\.workbuddy-ai\binaries\node\versions\22.22.2-6\node.exe`

Or if that's not available, the system Node: `node` (must be v22+).

### After testing

Report:
1. Which tasks passed and which failed
2. Any error messages from the Events tab or browser console
3. Whether xAPI statements were captured (and how many)
4. Whether scores were extracted correctly
5. Any visual rendering issues with the H5P content
6. Suggestions for improvements or additional features
