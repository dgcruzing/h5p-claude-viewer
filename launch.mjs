#!/usr/bin/env node
// H5P Agent Viewer — Launcher
// Usage:
//   node launch.mjs                          — start server, open browser at package picker
//   node launch.mjs <path-to-h5p>            — start server, load specific package
//   node launch.mjs --port <port>            — bind to specific port (default: ephemeral)
//   node launch.mjs --no-browser             — don't auto-open browser
//
// The server stays running until Ctrl+C. Packages can also be placed in the
// packages/ directory and selected from the sidebar in the browser.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const helperPath = path.join(__dirname, 'helper', 'server.mjs');

// Parse args
const args = process.argv.slice(2);
let h5pPath = null;
let fixedPort = null;
let openBrowser = true;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && i + 1 < args.length) {
    fixedPort = parseInt(args[++i], 10);
  } else if (args[i] === '--no-browser') {
    openBrowser = false;
  } else if (!args[i].startsWith('-')) {
    h5pPath = args[i];
  }
}

// Resolve H5P path to absolute
if (h5pPath) {
  h5pPath = path.resolve(h5pPath);
  if (!fs.existsSync(h5pPath)) {
    console.error('File not found:', h5pPath);
    process.exit(1);
  }
}

console.log('H5P Agent Viewer');
console.log('================');
console.log('Helper:', helperPath);
if (h5pPath) console.log('Package:', h5pPath);
console.log('');

// Start the helper server
const child = spawn(process.execPath, [helperPath], {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: __dirname
});

let buffer = '';
let serverPort = null;
let readyUrl = null;

child.stdout.on('data', (data) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop();

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.type === 'ready') {
        serverPort = msg.port;
        readyUrl = msg.url;
        console.log('Server ready on port', serverPort);

        if (h5pPath) {
          // Send load command
          const cmd = JSON.stringify({ cmd: 'load', path: h5pPath, generation: 1 }) + '\n';
          child.stdin.write(cmd);
        } else {
          // No package specified — open the package picker
          console.log('');
          console.log('VIEWER_URL=' + readyUrl);
          console.log('');
          console.log('Open this URL to browse packages in the packages/ folder.');
          console.log('Press Ctrl+C to stop the server.');
        }
      } else if (msg.type === 'loaded') {
        console.log('Package loaded:', msg.name);
        if (msg.title) console.log('Title:', msg.title);
        console.log('');
        console.log('VIEWER_URL=' + msg.url);
        console.log('');
        console.log('Open this URL in your browser. Press Ctrl+C to stop the server.');
      } else if (msg.type === 'error') {
        console.error('Error:', msg.message);
        process.exit(1);
      }
    } catch (e) {
      // Not JSON, ignore
    }
  }
});

child.stderr.on('data', (data) => {
  process.stderr.write(data);
});

child.on('error', (err) => {
  console.error('Spawn error:', err.message);
  process.exit(1);
});

child.on('exit', (code) => {
  console.log('Server exited with code', code);
});

// Keep alive
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  child.stdin.write(JSON.stringify({ cmd: 'shutdown' }) + '\n');
  setTimeout(() => process.exit(0), 500);
});
