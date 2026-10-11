# Handover: fixes in "H5P claude viewer" that can be ported to V1 ("H5P agent viewer")

Date: 2026-10-10. Fork source: `D:\edu\h5p\H5P agent viewer` (0.1.1-agent). Fork: `D:\edu\h5p\H5P claude viewer`.
Everything below is tested in the Claude desktop browser pane (Chromium/Electron, no service-worker support) across all 7 chapters (see Verification at the end).

## Summary

| # | Fix | Files | Port effort | Needed for |
|---|-----|-------|-------------|------------|
| 1 | xAPI payload normalised, scores extract correctly | `helper/server.mjs` | tiny | all browsers |
| 2 | Single xAPI capture, no duplicate listeners, scores refresh after POST completes | `web/app.js` | small | all browsers |
| 3 | "Clear xAPI log" no longer unloads the package (`POST /api/xapi/clear`) | `helper/server.mjs`, `web/app.js` | tiny | all browsers |
| 4 | Event log survives page navigation (sessionStorage) | `web/app.js` | tiny | all browsers |
| 5 | **Service-worker-free playback** (server serves frame + ZIP entries, plain iframe) | `helper/server.mjs`, `web/index.html`, `web/app.js`, new `web/assets/frame-boot.js` | medium | browsers that cannot register a SW (Claude pane) |

Fixes 1-4 are independent and safe to port alone. Fix 5 replaces the `<h5p-player>` element and its SW; port it only if V1 must also run where SWs are blocked (or if you want one code path everywhere). Fixes 1-4 stay valid with or without 5.

## 1. xAPI normalisation and score extraction (server.mjs)

**Bug:** `app.js` posted `event.data` (shape `{statement, ...}`), server stored it as `entry.statement`, then `/api/scores` read `entry.statement.result`, which is undefined (the real path is `entry.statement.statement.result`). Result: `/api/scores` always empty.

**Fix:** normalise on write, and loosen the score filter.

```js
function recordXapi(raw) {
  const statement = raw && raw.statement && typeof raw.statement === 'object' ? raw.statement : raw;
  xapiLog.push({ time: Date.now(), statement });
  if (xapiLog.length > MAX_XAPI) xapiLog = xapiLog.slice(-MAX_XAPI);
}
```

In `GET /api/scores`, replace the condition
`if (s?.object?.definition?.interactionType || s?.result?.score)` with
`if (s?.result?.score || s?.result?.success !== undefined)`.

Also tighten the POST route to `parts.length === 2` so it cannot shadow `/api/xapi/clear` (see 3).

Verified: multiple choice answered, `/api/scores` returned `raw 1 / max 1 / scaled 1 / success true`, plus the course-level entry (`raw 0 / max 19`, completion true). Note the course-level entry's `object` is the content URL, not a title; consider falling back to `h5p.json` title if you want readable names.

## 2. One capture, ordered score refresh (app.js)

**Bug:** `setupXapiCapture` was triggered by both the `ready` event and a MutationObserver on `src`, each with its own `captured` flag, so two listeners attached (the double "xAPI capture active" line, duplicate statements). `updateScores()` also fired before the POST finished, so the panel lagged one statement behind.

**Fix:** module-level `let captureStarted = false` guard (V1 route), or, with fix 5, no polling at all. In either route, chain `posted.then(updateScores)` instead of calling `updateScores()` straight after the `fetch`. Delete the MutationObserver.

## 3. Clear xAPI log must not unload the package

**Bug:** the sidebar "Clear xAPI log" button called `POST /api/clear`, which bumps the generation and sets `current = null`. The token died while the page kept showing the lesson, so the UI lied.

**Fix:** new route, placed before `/api/load`:

```js
if (parts[0]==='api' && parts[1]==='xapi' && parts[2]==='clear' && req.method==='POST') {
  xapiLog = [];
  return sendJson(res, { ok: true, generation, xapiCount: 0 });
}
```

`app.js` button now calls `/api/xapi/clear` and logs "xAPI log cleared (package still loaded)", without wiping the Events panel. `POST /api/clear` is unchanged (still the real unload). Update `AGENT-TEST-PROMPT.md` Task 6 to cover both.

## 4. Event log persistence (app.js)

Package switching navigates the whole page (`window.location.href = data.url`), so "Loading"/"Loaded" lines vanished. Fix: `logEvent` also appends to `sessionStorage['h5pv-events']` (last 100 lines, wrapped in try/catch) and the log is replayed at startup before `loadPackageList()`.

## 5. Service-worker-free playback (the big one)

**Why:** the Claude browser pane rejects any `navigator.serviceWorker.register()`, even for a trivial script on 127.0.0.1 ("unknown error occurred when fetching the script"). So V1 shows a blank player there. Chrome and Codex are fine.

**Finding that made the fix cheap:** the offline player's service worker only does two things:
- `/<scope>/h5p/frame/<pkgId>` returns a small HTML page that loads `main.bundle.js`, a JSON boot config, then an inline boot script;
- `/<scope>/h5p/virtual/<pkgId>/<path>` returns a raw entry from the `.h5p` ZIP.

The frame bundle (H5PStandalone 3.8.2) fetches `h5p.json`, content and libraries from `h5pJsonPath`. That is all plain HTTP, so Node can do the SW's job.

**Pieces:**
1. `web/assets/frame-boot.js`: the SW's inline boot script (`var dp='...'` in `h5p-sw.js`), extracted verbatim. It posts `{channel:'h5p-player', type:'ready'|'xapi'|'error'|'finished', ...}` to `parent`. Its `navigator.serviceWorker` listener is guarded and harmless. If the player is upgraded, re-extract it.
2. `server.mjs`: `zipIndex(file)` and `zipEntry(file, name)` (central-directory read, stored or deflate-raw, index cached per package, cache cleared on load); `frameHtml(token, title)` generating the frame page with `h5pJsonPath = /<token>/virtual`, same-origin CSP (`script-src 'self' 'unsafe-eval'`, no nonce needed because scripts are files); routes `GET /<token>/frame` and `GET /<token>/virtual/<path...>` (with `..` rejection and Range support, served from the decoded buffer).
3. `web/index.html`: `<h5p-player ...>` replaced by `<iframe id="player" allow="fullscreen; autoplay" allowfullscreen>`; `h5p-player.js` script tag removed; CSS selector changed to `#player`.
4. `web/app.js`: `loadConfig` sets `player.src = './frame'` (relative to `/<token>/index.html`). A `window.addEventListener('message')` handler accepts only `event.origin === location.origin`, `event.source === player.contentWindow` and `channel === 'h5p-player'`, then handles `ready` (status Ready), `xapi` (POST `{statement}` to `/api/xapi`, log, refresh scores), `error`, `finished`. This removes the iframe polling for `H5P.externalDispatcher` and its 30-second capture-timing limitation: statements are no longer missed on slow loads.

**Known gaps in fix 5 (not tested):**
- Drag-and-drop was only checked as 'renders and Check button works', not by dragging. These packages have no video/audio/image files, so Range on large media is implemented (206 verified on h5p.json) but not exercised on real media.
- Large entries are fully buffered per request (fine for these ~5 MB packages).
- Resume/user-data features of the offline player are dropped (`saveFreq:false`, no resume); the boot script's user-data path only runs with `resume=1`, which we never pass.
- `h5p-player.js`, `h5p-sw.js`, `h5p-sw-mount.js`, `sw.js` still ship in `web/assets` but are unused by the fork; they can be deleted once V1 adopts this route.

## Suggested porting order for V1
1. Fixes 1, 3 (server only) and 2, 4 (app.js): ten minutes, no risk.
2. Re-run `AGENT-TEST-PROMPT.md` Tasks 1-6 in Chrome/Codex to confirm nothing regressed; add a check that `/api/scores` is non-empty after one answer, and that `/api/xapi/clear` leaves `/api/status` showing the package.
3. Fix 5 only if you want pane-compatible playback; keep the SW route as a fallback if preferred (feature-detect `serviceWorker.register`, else iframe mode).

## Handy numbers from the fork test
- Port was dynamic each launch (`VIEWER_URL=` line). Packages: 7 (CPCCBC4012 ch1-7).
- Chapter 1: 12 slides; activity slides: 5 drag-text, 6 mark-the-words, 7 blanks, 8 drag-question, 9 dialogcards, 10 true/false, 11 multichoice (0-based index 4-10), summary on slide 12.
- After one multichoice answer plus slide jumping: 22 statements captured, 2 scored entries.

## Not done / next ideas
- `/api/section-check`: visit every slide, attempt each activity, return slide visits, attempted activities, scores (the checklist export recommended in `BROWSER-TEST-2026-10-10.md`).
- Screenshot evidence per slide.
- Title lookup for the course-level score entry.

## Verification (all 7 chapters, 2026-10-10, fork on a dynamic port)

Scripts (re-runnable, in `test/`):
- `node test/entries-check.mjs <port>`: loads every package, fetches every ZIP entry through `/<token>/virtual/`, checks status 200 and exact uncompressed size, fetches frame + shell assets, checks Range returns 206 and `..` traversal is rejected (400).
- `node test/content-refs-check.mjs`: every media path referenced by `content/content.json` exists in the zip.

Results:
| Check | Result |
|---|---|
| ZIP entries served byte-exact | 7/7 packages PASS (2208 entries each), Range 206, traversal 400 |
| Frame boots in the pane (no SW), status Ready | 7/7, about 0.2 s each, no error messages |
| Slides rendered | 12, 11, 11, 9, 10, 11, 13 (77 total, matches the earlier Codex count) |
| Activities exercised (rendered, answered, Check pressed) | drag-text, mark-the-words, blanks, drag-and-drop, dialog cards, true/false, multichoice, summary: all present and responsive, no script errors |
| xAPI captured | 20-38 statements per chapter; `/api/scores` non-empty for every chapter (2-8 entries) |
| Real UI path (sidebar click, chapter 3) | page navigates to token URL, Ready, one "capture active" line per load, xAPI tab shows statements, Scores tab shows `Question 1/1 success=true` |
| Clear xAPI log button | count 6 -> 0, package still loaded, status Ready |
| Old token after switching package | 404 (API test earlier in the session) |
| Media references | packages contain no images/audio/video (0 refs); nothing missing. The test prompt's "84+ images" does not match these packages |

Harness caveats: the in-pane runs used a hidden same-origin iframe per chapter and forwarded `xapi` messages to `/api/xapi` themselves, because the app only listens to its own `#player`. A first overlapping run corrupted chapter 1's row (it removed the iframe of a still-running timed-out script); chapter 1 was rerun alone and passes (28 statements, 7 scored entries). The pane limits one script to 45 s, so long loops must run in the background and be polled.

Minor leftovers: the xAPI/Scores panel lines render without line breaks in `innerText` (cosmetic, check the CSS `white-space` on `.tab-content`); the course-level score's `object` is the content URL instead of the title.
