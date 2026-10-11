// For each package: every "path" referenced in content/content.json must exist as a zip entry under content/.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'packages');
let failures = 0;
for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.h5p'))) {
  const buf = fs.readFileSync(path.join(dir, f));
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const size = buf.readUInt32LE(eocd + 12), off = buf.readUInt32LE(eocd + 16);
  const names = new Set(); let content = null; let p = off;
  while (p < off + size && buf.readUInt32LE(p) === 0x02014b50) {
    const method = buf.readUInt16LE(p + 10), comp = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nl).toString('utf8'); names.add(name);
    if (name === 'content/content.json') { const s = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28); const raw = buf.subarray(s, s + comp); content = JSON.parse((method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8')); }
    p += 46 + nl + el + cl;
  }
  const refs = new Set();
  (function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (typeof o.path === 'string' && /\.(png|jpe?g|gif|svg|webp|mp3|mp4|webm|vtt|wav|ogg)(#|$)/i.test(o.path)) refs.add(o.path.split('#')[0]); Object.values(o).forEach(walk); } })(content);
  const missing = [...refs].filter(r => !names.has('content/' + r));
  if (missing.length) failures++;
  console.log(`${missing.length ? 'FAIL' : 'PASS'} ${f}: ${refs.size} media refs, ${missing.length} missing${missing.length ? ' e.g. ' + missing.slice(0, 3).join(', ') : ''}`);
}
console.log(failures ? `${failures} FAILED` : 'ALL MEDIA REFERENCES RESOLVE');
process.exit(failures ? 1 : 0);
