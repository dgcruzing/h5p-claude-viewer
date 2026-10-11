# H5P Claude Viewer

A local browser H5P viewer with package browsing, xAPI capture and score inspection. This fork serves H5P frames and ZIP entries directly, supporting browser panes that block service workers. No Claude account or API key is required.

## Setup

Install Node.js 22 or later, then run the following from this repository. No npm dependencies need installing.

```powershell
node launch.mjs
# To prevent opening a browser automatically:
node launch.mjs --no-browser
# To open a specific lesson:
node launch.mjs "C:\Lessons\lesson.h5p"
```

Open the printed `VIEWER_URL` and press Ctrl+C in the terminal to stop the server. The port is allocated dynamically.

## Lessons and results

Add your own self-contained `.h5p` files to `packages/`. Lesson files are deliberately excluded from Git. Their content libraries must be bundled in the package. External content may be blocked by the player policy. Scores are observations from H5P, not an LMS gradebook. Export or collect results before switching packages or closing the viewer; session results are not a persistent learning record.

## Project layout

- `launch.mjs`: launcher.
- `helper/server.mjs`: local HTTP server and package API.
- `web/`: viewer interface, player assets and third-party license notices.
- `packages/`: your local lesson library, ignored by Git.

## Local operation

The server binds to `127.0.0.1`. Keep it local; it is not a public hosting service or an authenticated LMS. Load lesson packages you trust. Use the actual printed URL rather than assuming a fixed port.

## Validation

See [SETUP.md](SETUP.md) for checks and troubleshooting. Historical browser test notes describe earlier runs; they do not certify every possible H5P activity.

## Attribution and licenses

Adapted from [ACS H5P Opus Viewer](https://github.com/dgcruzing/acs-h5p-opus-viewer), using H5P Offline Player 0.3.1 and H5P Standalone assets. Preserve the notices in `web/licenses/` and `web/assets/frame-assets/`. These components have their own license terms, including GPL-3.0. Package content retains its authors' licenses. A repository-wide license grant is not added in this preparation.
