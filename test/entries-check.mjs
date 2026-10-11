// Loads every package via the API and fetches every ZIP entry through /<token>/virtual/, plus frame + shell assets.
// Usage: node test/entries-check.mjs <port>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const port = Number(process.argv[2]);
if (!port) { console.error('usage: node test/entries-check.mjs <port>'); process.exit(2); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = `http://127.0.0.1:${port}`;

// node's fetch honours proxy env vars on some setups; plain http avoids it.
const req = (method, url, body) => new Promise((resolve, reject) => {
  const u = new URL(url);
  const r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: { Origin: base, 'Content-Type': 'application/json' } }, res => {
    const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }));
  });
  r.on('error', reject); if (body) r.write(body); r.end();
});

function listEntries(file) {
  const buf = fs.readFileSync(file);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const size = buf.readUInt32LE(eocd + 12), off = buf.readUInt32LE(eocd + 16);
  const out = []; let p = off;
  while (p < off + size && buf.readUInt32LE(p) === 0x02014b50) {
    const usize = buf.readUInt32LE(p + 24), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const name = buf.subarray(p + 46, p + 46 + nl).toString('utf8');
    if (!name.endsWith('/')) out.push({ name, usize });
    p += 46 + nl + el + cl;
  }
  return out;
}

const pk = JSON.parse((await req('GET', `${base}/api/packages`)).body);
let failures = 0;
for (const p of pk.packages) {
  const load = JSON.parse((await req('POST', `${base}/api/load`, JSON.stringify({ name: p.name }))).body);
  const token = new URL(load.url).pathname.split('/')[1];
  const entries = listEntries(path.join(root, 'packages', p.name));
  const bad = [];
  for (const e of entries) {
    const r = await req('GET', `${base}/${token}/virtual/${e.name.split('/').map(encodeURIComponent).join('/')}`);
    if (r.status !== 200 || r.body.length !== e.usize) bad.push(`${e.name}: ${r.status} len ${r.body.length} expected ${e.usize}`);
  }
  const shell = {};
  for (const f of ['frame', 'assets/frame-boot.js', 'assets/frame-assets/main.bundle.js', 'assets/frame-assets/frame.bundle.js', 'assets/frame-assets/h5p.css', 'assets/frame-assets/fonts/inter-400.woff2', 'config.json']) shell[f] = (await req('GET', `${base}/${token}/${f}`)).status;
  const range = await req('GET', `${base}/${token}/virtual/h5p.json`);
  const rr = await new Promise(resolve => { const u = new URL(`${base}/${token}/virtual/h5p.json`); http.get({ host: u.hostname, port: u.port, path: u.pathname, headers: { Range: 'bytes=0-9' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); });
  const traversal = (await req('GET', `${base}/${token}/virtual/..%2f..%2fpackage.json`)).status;
  const shellBad = Object.entries(shell).filter(([, s]) => s !== 200);
  const ok = !bad.length && !shellBad.length && rr === 206 && traversal >= 400;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${p.name}: ${entries.length} entries, range ${rr}, traversal ${traversal}${bad.length ? '\n  ' + bad.slice(0, 5).join('\n  ') : ''}${shellBad.length ? '\n  shell: ' + JSON.stringify(shellBad) : ''}`);
}
await req('POST', `${base}/api/clear`);
console.log(failures ? `${failures} package(s) FAILED` : 'ALL PACKAGES PASS');
process.exit(failures ? 1 : 0);
