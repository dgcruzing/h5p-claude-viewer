# H5P Agent Viewer browser test — 10 October 2026

Tested in the Codex in-app browser using the local Node launcher. No application or package files changed.

## Outcome
Useful for section navigation and visual review. Score reporting is not ready for automated acceptance checks.

- Seven packages listed and loaded in the browser.
- Every slide visited: chapters 1–7 had 12, 11, 11, 9, 10, 11, 13 slides respectively (77 total). This was navigation/render smoke testing, not a content accuracy audit or completion of every interaction.
- Chapter 1 Mark the site plan features completed with 5/5.
- API captured 16 events after navigating to and answering that activity. Events appeared duplicated; two capture-active messages were visible.
- Scores API returned {"scores":[],"count":0} despite the captured answered statement containing raw 5, max 5, scaled 1.
- The transmitted event contains a statement wrapper. The server reads entry.statement.result instead of entry.statement.statement.result. This explains failed score extraction.
- Capture setup runs independently after both src mutation and ready, with a per-call captured flag. This explains duplicate listeners/events.
- Root app.js and token config returned HTTP 200. Package list returned count 7.
- Switching chapter 1 to chapter 2 invalidated the old token: config returned 404; status showed generation 2 and chapter 2.
- Clear xAPI log calls /api/clear, which unloaded the package: status generation 9, loaded null, xapiCount 0. The browser continued showing Ready and the existing lesson. The control label and visible state are misleading.
- Loading/Loaded event messages are lost when the page navigates; the surviving panel showed Player ready and capture-active messages.
- Browser warning/error log query after chapters 2–7 returned []. No fetch or service-worker registration errors observed once launched outside sandbox network isolation.

## Environment
Initial sandboxed launch printed a URL but browser timed out. Sandboxed local requests returned EACCES. Restarting the launcher with approved elevated execution made it reachable. Running URL: http://127.0.0.1:56261/ (temporary process).

## Recommended repairs
1. Normalize xAPI payloads before storage and score extraction.
2. Register one capture listener per iframe; await POST completion before updating scores.
3. Separate clearing logs from unloading a package, and keep UI state consistent.
4. Add a section checklist/export with slide visit, attempted activity, score, and screenshot evidence.

Screenshot: screenshots/browser-test-2026-10-10.jpg. Viewer left open on chapter 1 slide 2.
