import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(root, 'web');
const packagesDir = path.join(root, 'packages');
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json', '.png':'image/png', '.svg':'image/svg+xml', '.woff':'font/woff', '.woff2':'font/woff2', '.txt':'text/plain; charset=utf-8' };
let generation = 0;
let current = null;
let xapiLog = [];
const MAX_XAPI = 500;
const responses = new Set();
const invalidate = () => { current = null; for (const res of responses) res.destroy(); };

const out = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const fail = (gen, message) => out({ type: 'error', generation: Number.isInteger(gen) ? gen : undefined, message: String(message) });
const safeJoin = (base, relative) => { const resolved = path.resolve(base, relative); return resolved === base || resolved.startsWith(`${base}${path.sep}`) ? resolved : null; };
const tokenFor = () => crypto.randomBytes(18).toString('base64url');
const MAX_CENTRAL = 32 * 1024 * 1024, MAX_METADATA = 1 * 1024 * 1024;

// --- H5P ZIP metadata reader (unchanged from original) ---
async function packageMetadata(file) {
  const handle = await fsp.open(file, 'r');
  try {
    const stat = await handle.stat();
    const tailLength = Math.min(stat.size, 65557);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, stat.size - tailLength);
    const eocd = tail.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
    if (eocd < 0 || eocd + 22 > tail.length) throw new Error('Not a valid H5P ZIP archive');
    if (tail.readUInt16LE(eocd + 4) || tail.readUInt16LE(eocd + 6) || tail.readUInt16LE(eocd + 10) === 65535) throw new Error('Split and ZIP64 archives are not supported');
    const centralSize = tail.readUInt32LE(eocd + 12), centralOffset = tail.readUInt32LE(eocd + 16);
    if (centralSize > MAX_CENTRAL || centralOffset === 0xffffffff || centralOffset + centralSize > stat.size - tailLength + eocd) throw new Error('Invalid or unsupported ZIP central directory');
    const central = Buffer.alloc(centralSize);
    if ((await handle.read(central, 0, centralSize, centralOffset)).bytesRead !== centralSize) throw new Error('Truncated ZIP central directory');
    let p = 0;
    while (p + 46 <= central.length && central.readUInt32LE(p) === 0x02014b50) {
      const method = central.readUInt16LE(p + 10), compressed = central.readUInt32LE(p + 20), nameLen = central.readUInt16LE(p + 28), extraLen = central.readUInt16LE(p + 30), commentLen = central.readUInt16LE(p + 32), localOffset = central.readUInt32LE(p + 42);
      if (p + 46 + nameLen + extraLen + commentLen > central.length) throw new Error('Invalid ZIP central directory entry');
      const name = central.subarray(p + 46, p + 46 + nameLen).toString('utf8');
      if (name === 'h5p.json') {
        if (compressed > MAX_METADATA || localOffset + 30 > stat.size) throw new Error('h5p.json is too large or outside the archive');
        const local = Buffer.alloc(30); const localRead = await handle.read(local, 0, 30, localOffset); if (localRead.bytesRead !== 30 || local.readUInt32LE(0) !== 0x04034b50) throw new Error('Invalid h5p.json local header');
        const localNameLen = local.readUInt16LE(26), localExtraLen = local.readUInt16LE(28);
        const dataOffset = localOffset + 30 + localNameLen + localExtraLen; if (dataOffset + compressed > stat.size) throw new Error('h5p.json data is outside the archive');
        const body = Buffer.alloc(compressed); const bodyRead = await handle.read(body, 0, compressed, dataOffset); if (bodyRead.bytesRead !== compressed) throw new Error('Truncated h5p.json');
        const json = method === 0 ? body : method === 8 ? zlib.inflateRawSync(body, { maxOutputLength: MAX_METADATA }) : null;
        if (!json) throw new Error('Unsupported h5p.json compression');
        return JSON.parse(json.toString('utf8'));
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    throw new Error('H5P package is missing h5p.json');
  } finally { await handle.close(); }
}

// --- Direct ZIP entry access (replaces the Service Worker for browsers that cannot register one) ---
const zipIndexCache = new Map();
async function zipIndex(file) {
  const hit = zipIndexCache.get(file); if (hit) return hit;
  const handle = await fsp.open(file, 'r');
  try {
    const stat = await handle.stat(); const tailLen = Math.min(stat.size, 65557); const tail = Buffer.alloc(tailLen);
    await handle.read(tail, 0, tailLen, stat.size - tailLen);
    const eocd = tail.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06])); if (eocd < 0) throw new Error('Not a valid ZIP');
    const size = tail.readUInt32LE(eocd + 12), off = tail.readUInt32LE(eocd + 16);
    const central = Buffer.alloc(size); await handle.read(central, 0, size, off);
    const entries = new Map(); let p = 0;
    while (p + 46 <= central.length && central.readUInt32LE(p) === 0x02014b50) {
      const method = central.readUInt16LE(p + 10), comp = central.readUInt32LE(p + 20), nl = central.readUInt16LE(p + 28), el = central.readUInt16LE(p + 30), cl = central.readUInt16LE(p + 32), lo = central.readUInt32LE(p + 42);
      const name = central.subarray(p + 46, p + 46 + nl).toString('utf8');
      if (!name.endsWith('/')) entries.set(name, { method, comp, lo });
      p += 46 + nl + el + cl;
    }
    const idx = { entries }; zipIndexCache.set(file, idx); return idx;
  } finally { await handle.close(); }
}
async function zipEntry(file, name) {
  const e = (await zipIndex(file)).entries.get(name); if (!e) return null;
  const handle = await fsp.open(file, 'r');
  try {
    const local = Buffer.alloc(30); await handle.read(local, 0, 30, e.lo);
    const start = e.lo + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
    const raw = Buffer.alloc(e.comp); await handle.read(raw, 0, e.comp, start);
    return e.method === 0 ? raw : zlib.inflateRawSync(raw);
  } finally { await handle.close(); }
}
const entryMime = { '.json':'application/json; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp', '.mp3':'audio/mpeg', '.mp4':'video/mp4', '.webm':'video/webm', '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf', '.html':'text/html; charset=utf-8', '.txt':'text/plain; charset=utf-8', '.vtt':'text/vtt' };
const escHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const FRAME_FONTS = [['Inter','normal','400','inter-400'],['Inter','italic','400','inter-400-italic'],['Inter','normal','600','inter-600'],['Inter','italic','600','inter-600-italic'],['Inter','normal','800','inter-800'],['Inter','italic','800','inter-800-italic'],['Open Sans','normal','400','open-sans-400'],['Open Sans','italic','400','open-sans-400-italic'],['Open Sans','normal','600','open-sans-600'],['Open Sans','italic','600','open-sans-600-italic'],['Open Sans','normal','700','open-sans-700']];
function frameHtml(token, title) {
  const base = `/${token}/assets/frame-assets/`;
  const cfg = JSON.stringify({ pkgId: token, h5pJsonPath: `/${token}/virtual`, frameJs: base + 'frame.bundle.js', frameCss: base + 'h5p.css' }).replaceAll('<', '\\u003c');
  const fonts = FRAME_FONTS.map(([f, st, w, file]) => `@font-face{font-display:swap;font-family:'${f}';font-style:${st};font-weight:${w};src:url("${base}fonts/${file}.woff2") format('woff2')}`).join('\n');
  return `<!DOCTYPE html><html lang="en" class="h5p-iframe"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src * data: blob:; media-src * data: blob:; frame-src *; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'"><title>${escHtml(title)}</title><style>html,body{background:transparent}body{overflow-x:hidden}#h5p-root{width:100%}.h5p-video.h5p-youtube iframe{position:absolute;top:0;left:0;width:100%;height:100%}${fonts}</style></head><body><div id="h5p-root"></div><script src="${base}main.bundle.js" charset="UTF-8"></script><script type="application/json" id="h5p-boot-config">${cfg}</script><script src="/${token}/assets/frame-boot.js"></script></body></html>`;
}

// --- Package loading ---
async function loadPackage(file, gen) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('An absolute H5P file path is required');
  const absolute = path.resolve(file);
  const stat = await fsp.stat(absolute);
  if (!stat.isFile() || path.extname(absolute).toLowerCase() !== '.h5p') throw new Error('Selected path must be a regular .h5p file');
  const metadata = await packageMetadata(absolute);
  if (gen !== generation) return;
  const token = tokenFor();
  current = { file: absolute, token, generation: gen, name: path.basename(absolute), metadata, title: metadata.title || path.basename(absolute) };
  xapiLog = []; zipIndexCache.clear();
  out({ type: 'loaded', generation: gen, url: `http://127.0.0.1:${server.address().port}/${token}/index.html?generation=${gen}`, name: current.name, title: current.title });
}

// --- List packages in the packages directory ---
async function listPackages() {
  const items = [];
  try {
    const entries = await fsp.readdir(packagesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.h5p')) {
        const fullPath = path.join(packagesDir, entry.name);
        try {
          const meta = await packageMetadata(fullPath);
          items.push({ name: entry.name, title: meta.title || entry.name, mainLibrary: meta.mainLibrary || '', size: (await fsp.stat(fullPath)).size });
        } catch {
          items.push({ name: entry.name, title: entry.name, mainLibrary: '', size: 0, error: 'Cannot read metadata' });
        }
      }
    }
  } catch { /* packages dir may not exist yet */ }
  return items;
}

// --- xAPI statement collection ---
function recordXapi(raw) {
  // Player posts the dispatcher event data ({statement, ...}); accept bare statements too.
  const statement = raw && raw.statement && typeof raw.statement === 'object' ? raw.statement : raw;
  xapiLog.push({ time: Date.now(), statement });
  if (xapiLog.length > MAX_XAPI) xapiLog = xapiLog.slice(-MAX_XAPI);
}

// --- Security: loopback only ---
function requestAllowed(req, port) {
  const host = req.headers.host;
  const origin = req.headers.origin;
  return (host === `127.0.0.1:${port}` || host === `localhost:${port}`) && (!origin || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`);
}

// --- File sender with byte-range support (unchanged) ---
async function sendFile(req, res, file, range) {
  if (!file) { res.writeHead(404).end('No package selected'); return; }
  const handle = await fsp.open(file, 'r');
  let handedOff = false;
  try {
  const stat = await handle.stat(), size = stat.size;
  if (!stat.isFile()) throw new Error('Not a regular file');
  let start = 0, end = size - 1, status = 200;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    if (size === 0) { res.writeHead(416, { 'Content-Range': `bytes */0` }); return res.end(); }
    if (match[1] === '') { const suffix = Number(match[2]); if (!suffix) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); } start = Math.max(0, size - suffix); end = size - 1; }
    else { start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1; }
    if (!Number.isSafeInteger(start) || !Number.isInteger(end) || start >= size || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    end = Math.min(end, size - 1); status = 206;
  }
  const headers = { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  if (res.destroyed) return;
  res.writeHead(status, headers); if (req.method === 'HEAD' || size === 0) return res.end();
  const stream = handle.createReadStream({ start, end, autoClose: true }); handedOff = true;
  stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
  } finally { if (!handedOff) await handle.close(); }
}

// --- JSON response helper ---
function sendJson(res, obj, status = 200) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'null' });
  return res.end(body);
}

// --- Read POST body ---
async function readBody(req, maxLen = 65536) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > maxLen) { reject(new Error('Body too large')); req.destroy(); } });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// --- Main HTTP server ---
const server = http.createServer(async (req, res) => {
  responses.add(res); res.on('close', () => responses.delete(res));
  try {
  const port = server.address()?.port;
  if (!requestAllowed(req, port)) return res.writeHead(403).end('Local clients only');

  let pathname; try { pathname = decodeURIComponent(new URL(req.url, `http://127.0.0.1:${port}`).pathname); } catch { return res.writeHead(400).end('Malformed URL'); }
  const parts = pathname.split('/').filter(Boolean);

  // === Agent API endpoints (no token required) ===
  // GET /api/packages — list packages in the packages directory
  if (parts[0] === 'api' && parts[1] === 'packages' && req.method === 'GET') {
    const items = await listPackages();
    return sendJson(res, { packages: items, count: items.length });
  }

  // GET /api/status — current package and generation
  if (parts[0] === 'api' && parts[1] === 'status' && req.method === 'GET') {
    return sendJson(res, {
      generation,
      loaded: current ? { name: current.name, title: current.title || '', file: current.file } : null,
      xapiCount: xapiLog.length
    });
  }

  // GET /api/xapi — get collected xAPI statements
  if (parts[0] === 'api' && parts[1] === 'xapi' && req.method === 'GET') {
    return sendJson(res, { statements: xapiLog, count: xapiLog.length });
  }

  // POST /api/xapi/clear — clear captured statements only (package stays loaded)
  if (parts[0] === 'api' && parts[1] === 'xapi' && parts[2] === 'clear' && req.method === 'POST') {
    xapiLog = [];
    return sendJson(res, { ok: true, generation, xapiCount: 0 });
  }

  // POST /api/load — load a package by path or name
  if (parts[0] === 'api' && parts[1] === 'load' && req.method === 'POST') {
    const body = await readBody(req);
    let cmd; try { cmd = JSON.parse(body); } catch { return sendJson(res, { error: 'Invalid JSON' }, 400); }
    const filePath = cmd.path || cmd.name;
    if (!filePath) return sendJson(res, { error: 'Missing "path" or "name" field' }, 400);
    // If it's just a filename, resolve from packages dir
    const abs = path.isAbsolute(filePath) ? filePath : path.join(packagesDir, filePath);
    const gen = ++generation;
    // Invalidate old sessions but preserve THIS response so we can reply
    responses.delete(res);
    current = null;
    for (const r of responses) r.destroy();
    responses.add(res);
    xapiLog = [];
    try {
      await loadPackage(abs, gen);
      return sendJson(res, { ok: true, generation: gen, name: current?.name, title: current?.title, url: `http://127.0.0.1:${port}/${current?.token}/index.html?generation=${gen}` });
    } catch (e) {
      return sendJson(res, { error: e.message }, 400);
    }
  }

  // POST /api/clear — unload current package
  if (parts[0] === 'api' && parts[1] === 'clear' && req.method === 'POST') {
    ++generation;
    responses.delete(res);
    current = null;
    for (const r of responses) r.destroy();
    responses.add(res);
    xapiLog = [];
    return sendJson(res, { ok: true, generation });
  }

  // POST /api/xapi — receive xAPI statement from the player
  if (parts[0] === 'api' && parts[1] === 'xapi' && parts.length === 2 && req.method === 'POST') {
    const body = await readBody(req, 262144);
    try { const stmt = JSON.parse(body); recordXapi(stmt); return sendJson(res, { ok: true, count: xapiLog.length }); }
    catch (e) { return sendJson(res, { error: e.message }, 400); }
  }

  // GET /api/scores — extract scored results from xAPI log
  if (parts[0] === 'api' && parts[1] === 'scores' && req.method === 'GET') {
    const scores = [];
    for (const entry of xapiLog) {
      const s = entry.statement;
      if (s?.result?.score || s?.result?.success !== undefined) {
        const obj = s.object?.definition?.name?.['en-US'] || s.object?.id || 'unknown';
        const score = s.result?.score;
        const completion = s.result?.completion;
        const success = s.result?.success;
        const response = s.result?.response;
        scores.push({ object: obj, score, completion, success, response, time: entry.time });
      }
    }
    return sendJson(res, { scores, count: scores.length });
  }

  // OPTIONS for CORS preflight (for fetch from player)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': 'null', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  // === Token-based package serving (original logic) ===
  if (!current || parts[0] !== current.token) {
    // Serve web assets at root level (for the no-package-loaded shell)
    if (parts.length > 0) {
      const relative = parts.join('/');
      const allowed = relative === 'index.html' || relative === 'app.js' || relative === 'sw.js' || relative === 'config.json' || relative.startsWith('assets/');
      if (allowed) {
        const file = safeJoin(webRoot, relative);
        if (file && fs.existsSync(file) && !fs.statSync(file).isDirectory()) {
          const realWeb = fs.realpathSync(webRoot), realFile = fs.realpathSync(file);
          if (realFile.startsWith(`${realWeb}${path.sep}`)) {
            if (relative === 'config.json') res.setHeader('Cache-Control', 'no-store');
            return await sendFile(req, res, file, req.headers.range);
          }
        }
      }
    }
    // If no token and requesting root, serve the agent shell
    if (parts.length === 0) {
      const shellFile = safeJoin(webRoot, 'index.html');
      if (shellFile && fs.existsSync(shellFile)) return await sendFile(req, res, shellFile, req.headers.range);
    }
    return res.writeHead(404).end('Not found');
  }

  // Package file serving
  if (parts[1] === 'package.h5p' && parts.length === 2) return await sendFile(req, res, current.file, req.headers.range);

  // SW-free frame page and ZIP entries
  if (parts[1] === 'frame' && parts.length === 2) {
    const body = Buffer.from(frameHtml(current.token, current.title || current.name));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
    return res.end(body);
  }
  if (parts[1] === 'virtual' && parts.length > 2 && current.file) {
    const name = parts.slice(2).join('/');
    if (name.split('/').includes('..')) return res.writeHead(400).end('Bad path');
    const data = await zipEntry(current.file, name);
    if (!data) return res.writeHead(404).end('Not found');
    const headers = { 'Content-Type': entryMime[path.extname(name).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      const s = m[1] === '' ? Math.max(0, data.length - Number(m[2])) : Number(m[1]);
      const e = m[1] === '' || m[2] === '' ? data.length - 1 : Math.min(Number(m[2]), data.length - 1);
      if (s >= data.length || e < s) { res.writeHead(416, { 'Content-Range': `bytes */${data.length}` }); return res.end(); }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${s}-${e}/${data.length}`, 'Content-Length': e - s + 1 });
      return req.method === 'HEAD' ? res.end() : res.end(data.subarray(s, e + 1));
    }
    res.writeHead(200, { ...headers, 'Content-Length': data.length });
    return req.method === 'HEAD' ? res.end() : res.end(data);
  }

  // Config endpoint
  if (parts[1] === 'config.json' && parts.length === 2) {
    const body = Buffer.from(JSON.stringify({ generation: current.generation, name: current.name, title: current.title || current.name, packageUrl: current.file ? `/${current.token}/package.h5p` : null }));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
    return req.method === 'HEAD' ? res.end() : res.end(body);
  }

  // Web asset serving
  const relative = parts.slice(1).join('/') || 'index.html';
  const allowed = relative === 'index.html' || relative === 'app.js' || relative === 'sw.js' || relative.startsWith('assets/');
  if (!allowed) return res.writeHead(404).end('Not found');
  const file = safeJoin(webRoot, relative);
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end('Not found');
  const realWeb = fs.realpathSync(webRoot), realFile = fs.realpathSync(file);
  if (!realFile.startsWith(`${realWeb}${path.sep}`)) return res.writeHead(404).end('Not found');
  if (relative === 'config.json') { res.setHeader('Cache-Control', 'no-store'); }
  await sendFile(req, res, file, req.headers.range);
  } catch {
    if (!res.headersSent && !res.destroyed) res.writeHead(404).end('Resource unavailable'); else res.destroy();
  }
});

// --- stdin JSON-lines protocol (original, for backwards compat with DLL/launcher) ---
const shutdown = () => { server.closeAllConnections?.(); server.close(() => process.exit(0)); };
process.stdin.setEncoding('utf8'); let input = '';
process.stdin.on('data', chunk => {
  input += chunk;
  if (input.length > 262144) { fail(undefined, 'Command exceeds size limit'); shutdown(); return; }
  let i;
  while ((i = input.indexOf('\n')) >= 0) {
    const line = input.slice(0, i).trim(); input = input.slice(i + 1);
    if (!line) continue;
    let cmd; try { cmd = JSON.parse(line); if (!cmd || typeof cmd !== 'object') throw new Error(); } catch { fail(undefined, 'Invalid JSON command'); continue; }
    if (cmd.cmd === 'shutdown') { shutdown(); return; }
    if (cmd.cmd !== 'clear' && cmd.cmd !== 'load') { fail(cmd.generation, 'Unknown command'); continue; }
    const gen = Number.isSafeInteger(cmd.generation) ? cmd.generation : generation + 1;
    if (gen <= generation) { fail(gen, 'Stale generation'); continue; }
    generation = gen; invalidate();
    if (cmd.cmd === 'clear') out({ type: 'cleared', generation });
    else loadPackage(cmd.path, gen).catch(e => { if (gen === generation) fail(gen, e.message); });
  }
});
process.stdin.on('end', shutdown);
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const token = tokenFor();
  current = { token, generation: 0, file: null, name: null };
  out({ type: 'ready', port, url: `http://127.0.0.1:${port}/` });
});
