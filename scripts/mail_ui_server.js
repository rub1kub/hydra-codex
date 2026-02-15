#!/usr/bin/env node
/**
 * Hydra Mail UI Server (no deps)
 * - Serves a small local UI
 * - Proxies temp-mail API with HTTP Basic Auth (keeps creds off the browser)
 *
 * Usage:
 *   node scripts/mail_ui_server.js --port 8787 --host 127.0.0.1
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const SKILL_DIR = path.resolve(__dirname, '..');
const UI_DIR = path.join(SKILL_DIR, 'ui', 'mail');
const DATA_DIR = path.join(SKILL_DIR, 'data');
const MAILBOXES_FILE = path.join(DATA_DIR, 'mailboxes.json');

const MAIL_BASE = process.env.TEMP_MAIL_URL;
if (!MAIL_BASE) { console.error('Error: set TEMP_MAIL_URL env var or create .env'); process.exit(1); }
const MAIL_API = MAIL_BASE.replace(/\/$/, '') + '/api';
const MAIL_USER = process.env.TEMP_MAIL_USER || 'admin';
// Auto-load .env
const envPath = path.join(SKILL_DIR, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}
const MAIL_PASS = process.env.TEMP_MAIL_PASS;
if (!MAIL_PASS) { console.error('Error: set TEMP_MAIL_PASS env var or create .env'); process.exit(1); }
const MAIL_AUTH = Buffer.from(`${MAIL_USER}:${MAIL_PASS}`).toString('base64');

function parseArgs(argv) {
  const out = { host: '127.0.0.1', port: 8787 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--host') out.host = argv[++i];
    else if (a === '--port') out.port = Number(argv[++i]);
  }
  return out;
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(text);
}

function safeJoin(base, target) {
  const targetPath = path.normalize(path.join(base, target));
  if (!targetPath.startsWith(base)) return null;
  return targetPath;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) {
        req.destroy();
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function mailApiRequest(method, pathname, searchParams, jsonBody) {
  return new Promise((resolve, reject) => {
    const url = new URL(MAIL_API + pathname);
    if (searchParams) {
      for (const [k, v] of Object.entries(searchParams)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }

    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const body = jsonBody ? JSON.stringify(jsonBody) : null;

    const req = lib.request(
      url,
      {
        method,
        headers: {
          'Authorization': `Basic ${MAIL_AUTH}`,
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {})
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (d) => (raw += d));
        res.on('end', () => {
          const status = res.statusCode || 500;
          if (status >= 200 && status < 300) {
            try {
              resolve({ status, json: JSON.parse(raw) });
            } catch {
              resolve({ status, json: { success: false, error: 'Invalid JSON from mail API', raw } });
            }
          } else {
            resolve({ status, json: { success: false, error: 'Mail API error', status, raw } });
          }
        });
      }
    );

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function contentTypeFor(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

async function handleApi(req, res, url) {
  // GET /api/mailboxes
  if (req.method === 'GET' && url.pathname === '/api/mailboxes') {
    const mb = readJson(MAILBOXES_FILE, { selected: null, mailboxes: [] });
    return sendJson(res, 200, { ok: true, data: mb });
  }

  // POST /api/mailboxes  {prefix?}
  if (req.method === 'POST' && url.pathname === '/api/mailboxes') {
    const bodyRaw = await readBody(req);
    const body = bodyRaw ? JSON.parse(bodyRaw) : {};

    const resp = await mailApiRequest('POST', '/generate-email', null, body.prefix ? { prefix: String(body.prefix) } : {});
    if (!resp.json?.success) return sendJson(res, 502, { ok: false, error: resp.json?.error || 'Mail API error', raw: resp.json });

    const email = resp.json.data?.email;
    if (!email) return sendJson(res, 502, { ok: false, error: 'No email in response', raw: resp.json });

    const mb = readJson(MAILBOXES_FILE, { selected: null, mailboxes: [] });
    if (!mb.mailboxes.includes(email)) mb.mailboxes.unshift(email);
    mb.selected = email;
    writeJson(MAILBOXES_FILE, mb);

    return sendJson(res, 200, { ok: true, data: mb });
  }

  // POST /api/select {email}
  if (req.method === 'POST' && url.pathname === '/api/select') {
    const bodyRaw = await readBody(req);
    const body = bodyRaw ? JSON.parse(bodyRaw) : {};
    const email = String(body.email || '').trim();
    if (!email) return sendJson(res, 400, { ok: false, error: 'email required' });

    const mb = readJson(MAILBOXES_FILE, { selected: null, mailboxes: [] });
    if (!mb.mailboxes.includes(email)) mb.mailboxes.unshift(email);
    mb.selected = email;
    writeJson(MAILBOXES_FILE, mb);

    return sendJson(res, 200, { ok: true, data: mb });
  }

  // GET /api/emails?email=
  if (req.method === 'GET' && url.pathname === '/api/emails') {
    const email = url.searchParams.get('email');
    if (!email) return sendJson(res, 400, { ok: false, error: 'email required' });

    const resp = await mailApiRequest('GET', '/emails', { email }, null);
    return sendJson(res, 200, { ok: true, data: resp.json });
  }

  // GET /api/email/:id
  const emailIdMatch = url.pathname.match(/^\/api\/email\/(.+)$/);
  if (req.method === 'GET' && emailIdMatch) {
    const id = emailIdMatch[1];
    const resp = await mailApiRequest('GET', `/email/${encodeURIComponent(id)}`, null, null);
    return sendJson(res, 200, { ok: true, data: resp.json });
  }

  // DELETE /api/email/:id
  if (req.method === 'DELETE' && emailIdMatch) {
    const id = emailIdMatch[1];
    const resp = await mailApiRequest('DELETE', `/email/${encodeURIComponent(id)}`, null, null);
    return sendJson(res, 200, { ok: true, data: resp.json });
  }

  // DELETE /api/emails/clear?email=
  if (req.method === 'DELETE' && url.pathname === '/api/emails/clear') {
    const email = url.searchParams.get('email');
    if (!email) return sendJson(res, 400, { ok: false, error: 'email required' });
    const resp = await mailApiRequest('DELETE', '/emails/clear', { email }, null);
    return sendJson(res, 200, { ok: true, data: resp.json });
  }

  return sendJson(res, 404, { ok: false, error: 'Not found' });
}

async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url);
    }

    // Static UI
    const fileRel = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = safeJoin(UI_DIR, fileRel);
    if (!filePath) return sendText(res, 400, 'Bad path');

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return sendText(res, 404, 'Not found');
    }

    const data = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentTypeFor(filePath),
      'Cache-Control': 'no-store'
    });
    res.end(data);
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: String(e?.message || e) });
  }
}

const { host, port } = parseArgs(process.argv);

const server = http.createServer(handler);
server.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`Mail UI running: http://${host}:${port}`);
});
