const player = document.querySelector('#player');
const nameEl = document.querySelector('#pkg-name');
const statusEl = document.querySelector('#status');
const pkgList = document.querySelector('#pkg-list');
const eventLog = document.getElementById('event-log');
const xapiLog = document.getElementById('xapi-log');
const scoreLog = document.getElementById('score-log');
const resizeHandle = document.getElementById('resize-handle');
const bottomPanel = document.getElementById('bottom-panel');

const setStatus = (text) => { statusEl.textContent = text; };

// --- Tab switching ---
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content > div').forEach(d => d.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// --- Resize bottom panel ---
let resizing = false;
resizeHandle.addEventListener('mousedown', (e) => {
  resizing = true;
  e.preventDefault();
});
document.addEventListener('mousemove', (e) => {
  if (!resizing) return;
  const rect = bottomPanel.getBoundingClientRect();
  const newHeight = window.innerHeight - e.clientY;
  bottomPanel.style.height = Math.max(80, Math.min(400, newHeight)) + 'px';
});
document.addEventListener('mouseup', () => { resizing = false; });

// --- Event logging ---
const LOGKEY = 'h5pv-events';
function persistEvent(line) { try { const a = JSON.parse(sessionStorage.getItem(LOGKEY) || '[]'); a.push(line); sessionStorage.setItem(LOGKEY, JSON.stringify(a.slice(-100))); } catch {} }
function logEvent(target, msg, noPersist) {
  const empty = target.querySelector('.empty-msg');
  if (empty) empty.remove();
  const line = document.createElement('div');
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  if (target === eventLog && !noPersist) persistEvent(line.textContent);
  target.appendChild(line);
  target.scrollTop = target.scrollHeight;
}

try { for (const l of JSON.parse(sessionStorage.getItem(LOGKEY) || '[]')) { const e = eventLog.querySelector('.empty-msg'); if (e) e.remove(); const d = document.createElement('div'); d.textContent = l; eventLog.appendChild(d); } } catch {}

// --- Package list ---
async function loadPackageList() {
  try {
    const res = await fetch('/api/packages', { cache: 'no-store' });
    const data = await res.json();
    pkgList.innerHTML = '';
    if (!data.packages || data.packages.length === 0) {
      pkgList.innerHTML = '<div id="pkg-empty">No packages found.<br>Copy .h5p files to the<br><code>packages/</code> folder.</div>';
      return;
    }
    for (const pkg of data.packages) {
      const div = document.createElement('div');
      div.className = 'pkg-item';
      div.dataset.name = pkg.name;
      const sizeKB = (pkg.size / 1024).toFixed(0);
      div.innerHTML = `<span class="pkg-title">${esc(pkg.title)}</span><span class="pkg-meta">${esc(pkg.name)} &middot; ${sizeKB} KB</span>`;
      div.addEventListener('click', () => loadPackage(pkg.name, div));
      pkgList.appendChild(div);
    }
  } catch (e) {
    pkgList.innerHTML = '<div id="pkg-empty">Cannot reach server.</div>';
  }
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// --- Load a package via API ---
async function loadPackage(name, el) {
  setStatus('Loading ' + name + '...');
  logEvent(eventLog, 'Loading: ' + name);
  try {
    const res = await fetch('/api/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (data.error) {
      setStatus('Error: ' + data.error);
      logEvent(eventLog, 'ERROR: ' + data.error);
      return;
    }
    // Update active state
    document.querySelectorAll('.pkg-item').forEach(i => i.classList.remove('active'));
    if (el) el.classList.add('active');
    nameEl.textContent = data.title || data.name || name;
    // Navigate the whole page to the new token URL so the SW scope matches
    if (data.url) {
      logEvent(eventLog, 'Loaded: ' + (data.title || data.name) + ' (gen ' + data.generation + ')');
      window.location.href = data.url;
    }
  } catch (e) {
    setStatus('Error: ' + e.message);
    logEvent(eventLog, 'ERROR: ' + e.message);
  }
}

// --- Player events (SW-free frame posts messages to this window) ---
function handleXapi(stmt) {
  const posted = fetch('/api/xapi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statement: stmt }) }).catch(() => {});
  const obj = stmt?.object?.definition?.name?.['en-US'] || stmt?.object?.id || 'unknown';
  const verb = stmt?.verb?.display?.['en-US'] || stmt?.verb?.id || 'unknown';
  const score = stmt?.result?.score;
  const scoreStr = score ? ` raw=${score.raw ?? '?'}/${score.max ?? '?'} scaled=${score.scaled ?? '?'}` : '';
  const success = stmt?.result?.success !== undefined ? ` success=${stmt.result.success}` : '';
  const completion = stmt?.result?.completion !== undefined ? ` completion=${stmt.result.completion}` : '';
  logEvent(xapiLog, `${verb}: ${obj}${scoreStr}${success}${completion}`);
  if (score || stmt?.result?.success !== undefined) posted.then(updateScores);
}
window.addEventListener('message', (event) => {
  const d = event.data;
  if (event.origin !== location.origin || event.source !== player.contentWindow || !d || d.channel !== 'h5p-player') return;
  if (d.type === 'ready') { setStatus('Ready'); logEvent(eventLog, 'Player ready; xAPI capture active'); }
  else if (d.type === 'xapi' && d.statement) handleXapi(d.statement);
  else if (d.type === 'error') { setStatus('Error: ' + d.message); logEvent(eventLog, 'ERROR: ' + d.message); }
  else if (d.type === 'finished') logEvent(eventLog, 'Content reported finished');
});

// --- Update score panel from server ---
async function updateScores() {
  try {
    const res = await fetch('/api/scores', { cache: 'no-store' });
    const data = await res.json();
    scoreLog.innerHTML = '';
    if (!data.scores || data.scores.length === 0) {
      scoreLog.innerHTML = '<span class="empty-msg">No scores yet.</span>';
      return;
    }
    for (const s of data.scores) {
      const row = document.createElement('div');
      row.className = 'score-row';
      const sc = s.score;
      const scoreStr = sc ? `${sc.raw ?? '?'}/${sc.max ?? '?'} (scaled: ${sc.scaled ?? '?'})` : 'no score';
      row.innerHTML = `<span class="score-obj">${esc(s.object)}</span> <span class="score-val">${scoreStr}</span>${s.success !== undefined ? ` success=${s.success}` : ''}${s.completion !== undefined ? ` completion=${s.completion}` : ''}<br><span class="score-raw">${new Date(s.time).toLocaleTimeString()}</span>`;
      scoreLog.appendChild(row);
    }
    scoreLog.scrollTop = scoreLog.scrollHeight;
  } catch (e) {
    // Ignore
  }
}

// --- Reload button ---
document.querySelector('#reload').addEventListener('click', () => {
  location.reload();
});

// --- Refresh packages button ---
document.querySelector('#refresh-pkgs').addEventListener('click', loadPackageList);

// --- Clear xAPI button ---
document.querySelector('#clear-xapi').addEventListener('click', async () => {
  try {
    await fetch('/api/xapi/clear', { method: 'POST' });
    xapiLog.innerHTML = '<span class="empty-msg">No xAPI statements yet.</span>';
    scoreLog.innerHTML = '<span class="empty-msg">No scores yet.</span>';
    logEvent(eventLog, 'xAPI log cleared (package still loaded)');
  } catch (e) {
    logEvent(eventLog, 'ERROR clearing: ' + e.message);
  }
});

// --- Config loading (fetches ./config.json relative to page URL) ---
async function loadConfig() {
  try {
    const config = await (await fetch('./config.json', { cache: 'no-store' })).json();
    nameEl.textContent = config.title || config.name || 'No package selected';
    if (config.packageUrl) {
      player.src = './frame';
      setStatus('Loading package...');
    } else {
      setStatus('Select a package from the sidebar');
    }
  } catch (error) {
    setStatus('Waiting for package...');
  }
}

// --- Initialize ---
loadPackageList();
loadConfig();
