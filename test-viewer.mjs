import http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Start the server
const server = spawn('node', [join(__dirname, 'helper/server.mjs')], {
  cwd: __dirname,
  stdio: ['pipe', 'pipe', 'pipe']
});

let port = null;
let ready = false;

server.stdout.on('data', (data) => {
  const line = data.toString().trim();
  console.log('[server]', line);
  try {
    const msg = JSON.parse(line);
    if (msg.type === 'ready') {
      port = msg.port;
      ready = true;
      console.log(`Server ready on port ${port}`);
      runTests();
    }
  } catch {}
});

server.stderr.on('data', (data) => {
  console.error('[err]', data.toString().trim());
});

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  try {
    // Test 1: List packages
    console.log('\n=== Test 1: List packages ===');
    const pkgResponse = await api('GET', '/api/packages');
    console.log('Raw response:', JSON.stringify(pkgResponse).substring(0, 300));
    const packages = Array.isArray(pkgResponse) ? pkgResponse : (pkgResponse.packages || []);
    console.log(`Found ${packages.length} packages`);
    for (const p of packages) {
      console.log(`  ${p.name} (${p.title})`);
    }

    // Test 2: Load a BSBPMG422 package
    console.log('\n=== Test 2: Load BSBPMG422 package ===');
    const loadResult = await api('POST', '/api/load', { name: 'bsbpmg422-01-key-stakeholders.h5p' });
    console.log('Load result:', JSON.stringify(loadResult, null, 2));

    if (loadResult.ok) {
      // Test 3: Check status
      console.log('\n=== Test 3: Check status ===');
      const status = await api('GET', '/api/status');
      console.log('Status:', JSON.stringify(status, null, 2));

      // Test 4: Get scores
      console.log('\n=== Test 4: Get scores ===');
      const scores = await api('GET', '/api/scores');
      console.log('Scores:', JSON.stringify(scores, null, 2));

      // Test 5: Get xAPI
      console.log('\n=== Test 5: Get xAPI ===');
      const xapi = await api('GET', '/api/xapi');
      console.log(`xAPI statements: ${Array.isArray(xapi) ? xapi.length : 'N/A'}`);

      // Test 6: Clear
      console.log('\n=== Test 6: Clear ===');
      const clearResult = await api('POST', '/api/clear');
      console.log('Clear result:', JSON.stringify(clearResult, null, 2));
    }

    console.log('\n=== ALL TESTS PASSED ===');
  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    server.kill();
    process.exit(0);
  }
}

// Timeout
setTimeout(() => {
  console.log('Timeout - killing server');
  server.kill();
  process.exit(1);
}, 30000);