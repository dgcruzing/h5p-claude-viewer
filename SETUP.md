# Setup and checks

Install Node.js 22+ and a modern browser. Clone or download the repository, open a terminal in its folder, and run `node launch.mjs`. There is no npm install step. Add your own self-contained lessons to `packages/`.

## Troubleshooting

- Blank player: confirm the package includes libraries, then inspect the browser console.
- Missing lessons: add `.h5p` files to this checkout's `packages/` folder and refresh the package list.
- Port or stale page: use the URL from the current launch; old package URLs can expire when switching lessons.
- No scores: answer a scored interaction. Not every H5P activity emits scored xAPI events.
- Keep the whole checkout together: player assets are needed at runtime.

## API

Use the origin of the printed VIEWER_URL for `/api/packages`, `/api/status`, `/api/xapi` and `/api/scores`. POST `/api/load` accepts `{"name":"lesson.h5p"}` or an absolute `path`; POST `/api/clear` unloads the lesson. Endpoints are local and results are session-only.

## Checks

`node --check launch.mjs` and `node --check helper/server.mjs` check syntax. `node test-viewer.mjs` is a legacy smoke script, not a complete assertion suite. Verify navigation, questions, score capture and media in your browser with your own packages.

POST `/api/xapi/clear` clears observations while retaining the lesson. With the server running, `node test/entries-check.mjs <port>` and `node test/content-refs-check.mjs <port>` inspect your local lesson library. This fork avoids service-worker registration.
