#!/usr/bin/env node
/**
 * get_codex_usage.js — Extract Codex usage limits
 *
 * Two methods:
 *   1. API method (fast): Gets session token → calls backend-api/wham/usage
 *   2. Scraping method (fallback): Renders page → extracts from DOM
 *
 * Requires: running Chrome with CDP on configured port (default 18800)
 *
 * Usage:
 *   node get_codex_usage.js [--cdp-port 18800] [--json] [--quiet] [--method api|scrape]
 *
 * Output: JSON with usage data
 */

const http = require('http');
const WebSocket = require('ws');

// Parse args
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
}
const CDP_PORT = parseInt(getArg('--cdp-port', '18800'), 10);
const JSON_ONLY = args.includes('--json');
const QUIET = args.includes('--quiet');
const METHOD = getArg('--method', 'api');
const USAGE_URL = 'https://chatgpt.com/codex/settings/usage';

function log(...a) { if (!QUIET) console.error('[codex-usage]', ...a); }

// === HTTP helpers ===

function httpReq(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const u = new (require('url').URL)(url);
    const opts = { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// === CDP Session ===

class CDP {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.ws = null; this.id = 1; this.pending = new Map(); }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl, { perMessageDeflate: false });
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
        }
      });
    });
  }
  send(method, params = {}, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeout);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(t); resolve(v); },
        reject: (e) => { clearTimeout(t); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(code, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', {
      expression: typeof code === 'function' ? `(${code.toString()})()` : code,
      returnByValue: true,
      awaitPromise,
    });
    return r.result?.value;
  }
  close() { this.ws?.close(); }
}

// === Get or create a chatgpt.com tab ===

async function getTab() {
  const tabs = await httpReq(`http://127.0.0.1:${CDP_PORT}/json`);
  let target = tabs.find(t => t.url?.includes('chatgpt.com'));
  if (!target) {
    log('No chatgpt.com tab found, opening new...');
    target = await httpReq(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(USAGE_URL)}`, 'PUT');
    await new Promise(r => setTimeout(r, 5000));
  }
  if (!target?.webSocketDebuggerUrl) throw new Error('No WebSocket URL for tab');
  return target;
}

// === Method 1: API (fast) ===

async function methodApi(cdp) {
  log('Using API method...');

  // Ensure we're on chatgpt.com (for cookies)
  const urlCheck = await cdp.eval(`location.hostname`);
  if (!urlCheck?.includes('chatgpt.com')) {
    log('Navigating to chatgpt.com...');
    await cdp.send('Page.navigate', { url: USAGE_URL });
    await new Promise(r => setTimeout(r, 5000));
  }

  // Get session token
  log('Fetching session token...');
  const session = await cdp.eval(`(async () => {
    const r = await fetch('/api/auth/session', { credentials: 'include' });
    return await r.json();
  })()`, true);

  const token = session?.accessToken;
  if (!token) throw new Error('No access token in session');

  const email = session?.user?.email || null;
  log(`Authenticated as: ${email}`);

  // Call usage API
  log('Calling wham/usage API...');
  const usage = await cdp.eval(`(async () => {
    const r = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      headers: { 'Authorization': 'Bearer ${token}' },
      credentials: 'include'
    });
    return await r.json();
  })()`, true);

  if (usage?.detail === 'Unauthorized') throw new Error('API returned Unauthorized');

  // Format output
  const rl = usage.rate_limit || {};
  const cr = usage.code_review_rate_limit || {};
  const pw = rl.primary_window || {};
  const sw = rl.secondary_window || {};
  const cw = cr.primary_window || {};

  const cards = [];

  if (sw && sw.used_percent !== undefined) {
    cards.push({
      label: '5-hour usage limit',
      remaining_pct: 100 - sw.used_percent,
      used_pct: sw.used_percent,
      reset_at: sw.reset_at ? new Date(sw.reset_at * 1000).toISOString() : null,
      reset_seconds: sw.reset_after_seconds,
    });
  }

  if (pw.used_percent !== undefined) {
    cards.push({
      label: 'Weekly usage limit',
      remaining_pct: 100 - pw.used_percent,
      used_pct: pw.used_percent,
      reset_at: pw.reset_at ? new Date(pw.reset_at * 1000).toISOString() : null,
      reset_seconds: pw.reset_after_seconds,
    });
  }

  if (cw.used_percent !== undefined) {
    cards.push({
      label: 'Code review',
      remaining_pct: 100 - cw.used_percent,
      used_pct: cw.used_percent,
      reset_at: cw.reset_at ? new Date(cw.reset_at * 1000).toISOString() : null,
      reset_seconds: cw.reset_after_seconds,
    });
  }

  if (usage.credits !== null && usage.credits !== undefined) {
    cards.push({
      label: 'Credits',
      remaining: usage.credits,
    });
  }

  return {
    ok: true,
    method: 'api',
    fetched_at: new Date().toISOString(),
    account: {
      email: usage.email || email,
      user_id: usage.user_id,
      plan: usage.plan_type,
    },
    limit_reached: rl.limit_reached || false,
    cards,
    raw: usage,
  };
}

// === Method 2: Scraping (fallback) ===

async function methodScrape(cdp) {
  log('Using scraping method...');

  // Navigate to usage page
  const urlCheck = await cdp.eval(`location.href`);
  if (!urlCheck?.includes('codex/settings/usage')) {
    log('Navigating to usage page...');
    await cdp.send('Page.navigate', { url: USAGE_URL });
    await new Promise(r => setTimeout(r, 5000));
  }

  // Wait for articles to load
  log('Waiting for content...');
  let attempts = 0;
  while (attempts < 15) {
    const count = await cdp.eval(`document.querySelectorAll('article').length`);
    if (count > 0) break;
    await new Promise(r => setTimeout(r, 1000));
    attempts++;
  }

  // Extract
  log('Extracting data from DOM...');
  const data = await cdp.eval(function() {
    const articles = document.querySelectorAll('article');
    if (articles.length === 0) return null;
    const cards = [];
    for (const a of articles) {
      const text = a.innerText.trim().replace(/\s+/g, ' ');
      const pctMatch = text.match(/(\d+)\s*%/);
      const resetMatch = text.match(/Resets?\s+(.+?)$/i) || text.match(/Сброс\s+(.+?)$/i);
      const lines = a.innerText.trim().split('\n').map(l => l.trim()).filter(Boolean);
      cards.push({
        label: lines[0] || '',
        remaining_pct: pctMatch ? Number(pctMatch[1]) : null,
        reset_text: resetMatch ? resetMatch[1].trim() : null,
      });
    }
    const account = document.querySelector('[data-testid=profile-button]')?.innerText?.trim() || null;
    return { cards, account };
  });

  if (!data) throw new Error('No usage cards found on page');

  return {
    ok: true,
    method: 'scrape',
    fetched_at: new Date().toISOString(),
    account: { initials: data.account },
    cards: data.cards,
  };
}

// === Main ===

async function main() {
  try {
    const target = await getTab();
    log(`Connecting to: ${target.title || target.url}`);

    const cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');

    let result;
    try {
      result = METHOD === 'scrape' ? await methodScrape(cdp) : await methodApi(cdp);
    } catch (apiErr) {
      if (METHOD !== 'scrape') {
        log(`API method failed (${apiErr.message}), falling back to scrape...`);
        result = await methodScrape(cdp);
      } else {
        throw apiErr;
      }
    }

    cdp.close();

    // Output
    console.log(JSON_ONLY ? JSON.stringify(result) : JSON.stringify(result, null, 2));

    if (!QUIET && !JSON_ONLY) {
      console.error('\n--- Summary ---');
      for (const c of result.cards) {
        const pct = c.remaining_pct !== null ? `${c.remaining_pct}%` : (c.remaining !== undefined ? c.remaining : '?');
        const reset = c.reset_at ? ` (resets ${new Date(c.reset_at).toLocaleString()})` : (c.reset_text ? ` (resets ${c.reset_text})` : '');
        console.error(`  ${c.label}: ${pct} remaining${reset}`);
      }
      if (result.account?.email) console.error(`  Account: ${result.account.email} (${result.account.plan})`);
      if (result.limit_reached) console.error('  ⚠️  LIMIT REACHED!');
    }

    process.exit(0);
  } catch (e) {
    const err = { ok: false, error: e.message, fetched_at: new Date().toISOString() };
    console.log(JSON_ONLY ? JSON.stringify(err) : JSON.stringify(err, null, 2));
    if (!QUIET) console.error('Error:', e.message);
    process.exit(1);
  }
}

main();
