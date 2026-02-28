#!/usr/bin/env node
/**
 * Hydra Mail UI Server (no deps)
 * - Serves a local UI
 * - Proxies temp-mail API with HTTP Basic Auth (keeps creds off browser)
 * - Keeps local email archive to preserve messages beyond remote 24h cleanup
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
const ARCHIVE_FILE = path.join(DATA_DIR, 'email_archive.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Auto-load .env
const envPath = path.join(SKILL_DIR, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}

const MAIL_BASE = process.env.TEMP_MAIL_URL;
if (!MAIL_BASE) { console.error('Error: set TEMP_MAIL_URL env var or create .env'); process.exit(1); }
const MAIL_API = MAIL_BASE.replace(/\/$/, '') + '/api';
const MAIL_USER = process.env.TEMP_MAIL_USER || 'admin';

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

async function readJsonBody(req) {
  const bodyRaw = await readBody(req);
  if (!bodyRaw) return {};
  try {
    return JSON.parse(bodyRaw);
  } catch {
    throw new Error('Invalid JSON body');
  }
}

function decodeParam(v) {
  try { return decodeURIComponent(String(v || '')); } catch { return String(v || ''); }
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
          try {
            const parsed = raw ? JSON.parse(raw) : {};
            resolve({ status, json: parsed });
          } catch {
            resolve({
              status,
              json: {
                success: false,
                error: 'Invalid JSON from mail API',
                raw,
                status,
              }
            });
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

/* ---------- Local archive helpers ---------- */

function readArchive() {
  const arc = readJson(ARCHIVE_FILE, { byId: {}, mailboxIndex: {} });
  if (!arc || typeof arc !== 'object') return { byId: {}, mailboxIndex: {} };
  if (!arc.byId || typeof arc.byId !== 'object') arc.byId = {};
  if (!arc.mailboxIndex || typeof arc.mailboxIndex !== 'object') arc.mailboxIndex = {};
  for (const k of Object.keys(arc.mailboxIndex)) {
    if (!Array.isArray(arc.mailboxIndex[k])) arc.mailboxIndex[k] = [];
  }
  return arc;
}

function writeArchive(archive) {
  writeJson(ARCHIVE_FILE, archive);
}

function normalizeRetentionDays(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function readSettings() {
  const raw = readJson(SETTINGS_FILE, { retentionDays: 0 });
  return { retentionDays: normalizeRetentionDays(raw?.retentionDays ?? 0) };
}

function writeSettings(settings) {
  writeJson(SETTINGS_FILE, { retentionDays: normalizeRetentionDays(settings?.retentionDays ?? 0) });
}

function extractEmailList(payload) {
  if (Array.isArray(payload?.data?.emails)) return payload.data.emails;
  if (Array.isArray(payload?.emails)) return payload.emails;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function extractEmailDetail(payload) {
  if (payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    return payload.data;
  }
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.id) {
    return payload;
  }
  return null;
}

function guessMailbox(detail) {
  const candidates = [
    detail?.to_address,
    detail?.to,
    detail?.recipient,
    detail?.email,
    detail?.mailbox,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.includes('@')) return c.trim().toLowerCase();
  }
  return null;
}

function normalizeEmail(raw, mailboxHint = null) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id != null ? String(raw.id) : raw.message_id != null ? String(raw.message_id) : null;
  if (!id) return null;

  const mailbox = mailboxHint || guessMailbox(raw) || null;

  return {
    ...raw,
    id,
    subject: raw.subject || '(без темы)',
    from: raw.from || raw.from_address || '—',
    from_address: raw.from_address || raw.from || '—',
    _mailbox: mailbox,
    _archivedAt: raw._archivedAt || new Date().toISOString(),
  };
}

function ensureMailboxIndex(archive, mailbox) {
  if (!mailbox) return;
  if (!archive.mailboxIndex[mailbox]) archive.mailboxIndex[mailbox] = [];
}

function upsertArchiveEmails(archive, mailbox, emails) {
  if (!Array.isArray(emails) || !emails.length) return 0;
  let count = 0;

  for (const raw of emails) {
    const normalized = normalizeEmail(raw, mailbox);
    if (!normalized || !normalized.id) continue;

    const prev = archive.byId[normalized.id] || {};
    const merged = {
      ...prev,
      ...normalized,
      id: normalized.id,
      _mailbox: normalized._mailbox || prev._mailbox || mailbox || null,
      _archivedAt: prev._archivedAt || normalized._archivedAt || new Date().toISOString(),
    };

    archive.byId[normalized.id] = merged;

    const mb = merged._mailbox;
    if (mb) {
      ensureMailboxIndex(archive, mb);
      if (!archive.mailboxIndex[mb].includes(normalized.id)) {
        archive.mailboxIndex[mb].unshift(normalized.id);
      }
    }

    count++;
  }

  return count;
}

function removeArchivedEmail(archive, id) {
  const key = String(id || '');
  if (!key) return;
  delete archive.byId[key];
  for (const mb of Object.keys(archive.mailboxIndex)) {
    archive.mailboxIndex[mb] = archive.mailboxIndex[mb].filter((x) => String(x) !== key);
    if (!archive.mailboxIndex[mb].length) delete archive.mailboxIndex[mb];
  }
}

function clearMailboxArchive(archive, mailbox) {
  const ids = archive.mailboxIndex[mailbox] || [];
  for (const id of ids) {
    const email = archive.byId[id];
    if (email && email._mailbox === mailbox) delete archive.byId[id];
  }
  delete archive.mailboxIndex[mailbox];
}

function getArchivedByMailbox(archive, mailbox) {
  const ids = archive.mailboxIndex[mailbox] || [];
  return ids.map((id) => archive.byId[id]).filter(Boolean);
}

function tsValue(email) {
  const v = email?.created_at || email?.timestamp || null;
  if (!v) return 0;
  const d = new Date(typeof v === 'number' && v < 2e10 ? v * 1000 : v);
  const t = d.getTime();
  return Number.isFinite(t) ? t : 0;
}

function mergeEmails(remoteEmails, archivedEmails) {
  const map = new Map();

  for (const e of archivedEmails || []) {
    if (!e || e.id == null) continue;
    const id = String(e.id);
    map.set(id, { ...e, id });
  }

  for (const e of remoteEmails || []) {
    if (!e || e.id == null) continue;
    const id = String(e.id);
    const prev = map.get(id) || {};
    map.set(id, { ...prev, ...e, id, _archivedAt: prev._archivedAt || new Date().toISOString() });
  }

  return Array.from(map.values()).sort((a, b) => tsValue(b) - tsValue(a));
}

function pruneArchive(archive, maxByMailbox = 5000) {
  for (const mailbox of Object.keys(archive.mailboxIndex)) {
    const ids = archive.mailboxIndex[mailbox] || [];
    if (ids.length <= maxByMailbox) continue;

    const kept = ids.slice(0, maxByMailbox);
    const dropped = new Set(ids.slice(maxByMailbox));
    archive.mailboxIndex[mailbox] = kept;

    for (const id of dropped) {
      // remove only if no mailbox references it anymore
      let stillReferenced = false;
      for (const mb of Object.keys(archive.mailboxIndex)) {
        if (archive.mailboxIndex[mb].includes(id)) {
          stillReferenced = true;
          break;
        }
      }
      if (!stillReferenced) delete archive.byId[id];
    }
  }
}

/* ---------- API ---------- */

async function handleApi(req, res, url) {
  // GET /api/mailboxes
  if (req.method === 'GET' && url.pathname === '/api/mailboxes') {
    const mb = readJson(MAILBOXES_FILE, { selected: null, mailboxes: [] });
    return sendJson(res, 200, { ok: true, data: mb });
  }

  // GET /api/settings
  if (req.method === 'GET' && url.pathname === '/api/settings') {
    return sendJson(res, 200, { ok: true, data: readSettings() });
  }

  // POST /api/settings { retentionDays }
  if (req.method === 'POST' && url.pathname === '/api/settings') {
    const body = await readJsonBody(req);
    const current = readSettings();
    const next = { retentionDays: normalizeRetentionDays(body?.retentionDays ?? current.retentionDays) };
    writeSettings(next);
    return sendJson(res, 200, { ok: true, data: next });
  }

  // POST /api/mailboxes  {prefix?}
  if (req.method === 'POST' && url.pathname === '/api/mailboxes') {
    const body = await readJsonBody(req);
    const payload = body.prefix ? { prefix: String(body.prefix) } : {};

    const resp = await mailApiRequest('POST', '/generate-email', null, payload);
    if (!resp.json?.success) {
      return sendJson(res, 502, { ok: false, error: resp.json?.error || 'Mail API error', raw: resp.json });
    }

    const email = resp.json.data?.email;
    if (!email) {
      return sendJson(res, 502, { ok: false, error: 'No email in response', raw: resp.json });
    }

    const mb = readJson(MAILBOXES_FILE, { selected: null, mailboxes: [] });
    if (!mb.mailboxes.includes(email)) mb.mailboxes.unshift(email);
    mb.selected = email;
    writeJson(MAILBOXES_FILE, mb);

    return sendJson(res, 200, { ok: true, data: mb });
  }

  // DELETE /api/mailboxes/:email
  const mailboxDeleteMatch = url.pathname.match(/^\/api\/mailboxes\/(.+)$/);
  if (req.method === 'DELETE' && mailboxDeleteMatch) {
    const email = decodeParam(mailboxDeleteMatch[1]).trim();
    if (!email) return sendJson(res, 400, { ok: false, error: 'email required' });

    const mb = readJson(MAILBOXES_FILE, { selected: null, mailboxes: [] });
    mb.mailboxes = (mb.mailboxes || []).filter((x) => String(x) !== email);
    if (mb.selected === email) mb.selected = mb.mailboxes[0] || null;
    writeJson(MAILBOXES_FILE, mb);

    // Clear local archive for removed mailbox
    const archive = readArchive();
    clearMailboxArchive(archive, email);
    pruneArchive(archive);
    writeArchive(archive);

    // Try to clear remote mailbox too (best effort)
    try {
      await mailApiRequest('DELETE', '/emails/clear', { email }, null);
    } catch {
      // ignore remote cleanup failure
    }

    return sendJson(res, 200, { ok: true, data: mb });
  }

  // POST /api/select {email}
  if (req.method === 'POST' && url.pathname === '/api/select') {
    const body = await readJsonBody(req);
    const email = String(body.email || '').trim();
    if (!email) return sendJson(res, 400, { ok: false, error: 'email required' });

    const mb = readJson(MAILBOXES_FILE, { selected: null, mailboxes: [] });
    if (!mb.mailboxes.includes(email)) mb.mailboxes.unshift(email);
    mb.selected = email;
    writeJson(MAILBOXES_FILE, mb);

    return sendJson(res, 200, { ok: true, data: mb });
  }

  // GET /api/emails?email=&limit=&offset=
  if (req.method === 'GET' && url.pathname === '/api/emails') {
    const email = url.searchParams.get('email');
    if (!email) return sendJson(res, 400, { ok: false, error: 'email required' });

    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 100)));
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));

    let remote;
    try {
      remote = await mailApiRequest('GET', '/emails', { email }, null);
    } catch (e) {
      remote = { status: 599, json: { success: false, error: String(e?.message || e) } };
    }

    const remoteEmails = extractEmailList(remote.json);

    const archive = readArchive();
    if (remoteEmails.length) {
      upsertArchiveEmails(archive, email, remoteEmails);
    }

    const archivedEmails = getArchivedByMailbox(archive, email);
    const merged = mergeEmails(remoteEmails, archivedEmails);

    // Keep merged state in archive for stable retention
    upsertArchiveEmails(archive, email, merged);
    pruneArchive(archive);
    writeArchive(archive);

    const total = merged.length;
    const page = merged.slice(offset, offset + limit);
    const hasMore = offset + page.length < total;

    return sendJson(res, 200, {
      ok: true,
      data: {
        success: true,
        data: {
          emails: page,
          pagination: {
            limit,
            offset,
            total,
            hasMore,
          }
        },
        pagination: {
          limit,
          offset,
          total,
          hasMore,
        },
        meta: {
          remoteOk: !!remote.json?.success,
          remoteCount: remoteEmails.length,
          archiveCount: archivedEmails.length,
          mergedCount: merged.length,
          retention: 'local-archive-enabled',
        }
      }
    });
  }

  // GET /api/email/:id
  const emailIdMatch = url.pathname.match(/^\/api\/email\/(.+)$/);
  if (req.method === 'GET' && emailIdMatch) {
    const id = decodeParam(emailIdMatch[1]);

    let remote;
    try {
      remote = await mailApiRequest('GET', `/email/${encodeURIComponent(id)}`, null, null);
    } catch (e) {
      remote = { status: 599, json: { success: false, error: String(e?.message || e) } };
    }

    const remoteDetail = extractEmailDetail(remote.json);
    const archive = readArchive();

    if (remoteDetail && (remoteDetail.id != null || id)) {
      const mailboxGuess = guessMailbox(remoteDetail);
      upsertArchiveEmails(archive, mailboxGuess, [{ ...remoteDetail, id: remoteDetail.id != null ? remoteDetail.id : id }]);
      pruneArchive(archive);
      writeArchive(archive);

      const finalId = String(remoteDetail.id != null ? remoteDetail.id : id);
      const fromArchive = archive.byId[finalId] || { ...remoteDetail, id: finalId };
      return sendJson(res, 200, { ok: true, data: { success: true, data: fromArchive } });
    }

    const cached = archive.byId[String(id)];
    if (cached) {
      return sendJson(res, 200, { ok: true, data: { success: true, data: { ...cached, _fromArchive: true } } });
    }

    return sendJson(res, 404, { ok: false, error: 'Email not found' });
  }

  // DELETE /api/email/:id
  if (req.method === 'DELETE' && emailIdMatch) {
    const id = decodeParam(emailIdMatch[1]);

    let remote;
    try {
      remote = await mailApiRequest('DELETE', `/email/${encodeURIComponent(id)}`, null, null);
    } catch (e) {
      remote = { status: 599, json: { success: false, error: String(e?.message || e) } };
    }

    const archive = readArchive();
    removeArchivedEmail(archive, id);
    writeArchive(archive);

    return sendJson(res, 200, {
      ok: true,
      data: {
        success: true,
        data: {
          deleted: true,
          id: String(id),
          remote: remote.json,
        }
      }
    });
  }

  // DELETE /api/emails/clear?email=
  if (req.method === 'DELETE' && url.pathname === '/api/emails/clear') {
    const email = url.searchParams.get('email');
    if (!email) return sendJson(res, 400, { ok: false, error: 'email required' });

    let remote;
    try {
      remote = await mailApiRequest('DELETE', '/emails/clear', { email }, null);
    } catch (e) {
      remote = { status: 599, json: { success: false, error: String(e?.message || e) } };
    }

    const archive = readArchive();
    clearMailboxArchive(archive, email);
    writeArchive(archive);

    return sendJson(res, 200, {
      ok: true,
      data: {
        success: true,
        data: {
          cleared: true,
          email,
          remote: remote.json,
        }
      }
    });
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
