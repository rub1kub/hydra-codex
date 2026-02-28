/* Hydra Mail UI — app.js */
const $ = (id) => document.getElementById(id);

const STORAGE_KEYS = {
  theme: 'hydra-mail-theme-v1',
  readState: 'hydra-mail-read-state-v1',
};

const MOSCOW_TZ = 'Europe/Moscow';
const ICON_TRASH = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1m2 0v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4h10z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const state = {
  mailboxes: [],
  selected: null,
  emails: [],
  emailCounts: {},       // mailbox -> total count
  unreadCounts: {},      // mailbox -> unread count
  selectedEmailId: null,
  selectedEmail: null,
  autoTimer: null,
  readState: loadLocalJson(STORAGE_KEYS.readState, {}),
  themeMode: localStorage.getItem(STORAGE_KEYS.theme) || 'dark',
};

/* ——— Helpers ——— */

function setStatus(text) {
  $('status').textContent = text;
}

function toast(msg, type = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast'; }, 2500);
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

function timeFmt(ts) {
  if (!ts) return '';
  const d = new Date(typeof ts === 'number' && ts < 2e10 ? ts * 1000 : ts);
  if (isNaN(d)) return String(ts);

  const dateKey = (x) => new Intl.DateTimeFormat('ru-RU', {
    timeZone: MOSCOW_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(x);

  const now = new Date();
  const sameDay = dateKey(d) === dateKey(now);

  if (sameDay) {
    return d.toLocaleTimeString('ru-RU', {
      timeZone: MOSCOW_TZ,
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return d.toLocaleDateString('ru-RU', {
    timeZone: MOSCOW_TZ,
    day: 'numeric',
    month: 'short',
  }) + ' ' + d.toLocaleTimeString('ru-RU', {
    timeZone: MOSCOW_TZ,
    hour: '2-digit',
    minute: '2-digit',
  });
}

function stripHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ');
}

function loadLocalJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
    return fallback;
  } catch {
    return fallback;
  }
}

function saveLocalJson(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}

function saveReadState() {
  saveLocalJson(STORAGE_KEYS.readState, state.readState);
}

function getMailboxReadState(mailbox) {
  if (!mailbox) return { seen: {}, unread: {} };
  if (!state.readState[mailbox]) {
    state.readState[mailbox] = { seen: {}, unread: {} };
  }
  if (!state.readState[mailbox].seen) state.readState[mailbox].seen = {};
  if (!state.readState[mailbox].unread) state.readState[mailbox].unread = {};
  return state.readState[mailbox];
}

function isUnread(id, mailbox = state.selected) {
  if (!id || !mailbox) return false;
  const mbState = getMailboxReadState(mailbox);
  return !!mbState.unread[String(id)];
}

function markRead(id, mailbox = state.selected) {
  if (!id || !mailbox) return;
  const key = String(id);
  const mbState = getMailboxReadState(mailbox);
  mbState.seen[key] = Date.now();
  delete mbState.unread[key];
  saveReadState();
}

function markUnread(id, mailbox = state.selected) {
  if (!id || !mailbox) return;
  const key = String(id);
  const mbState = getMailboxReadState(mailbox);
  mbState.seen[key] = mbState.seen[key] || Date.now();
  mbState.unread[key] = true;
  saveReadState();
}

function extractOtp(text) {
  if (!text) return null;
  const src = String(text);

  const contextual = [
    /(?:verification|verify|otp|one[-\s]?time|code|код|парол[ья]|подтвержден[ияи])[^\d]{0,24}(\d{4,8})/i,
    /\b(\d{6})\b/,
    /\b(\d{4,8})\b/
  ];

  for (const re of contextual) {
    const m = src.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

function getMessageOtp(msg) {
  if (!msg || typeof msg !== 'object') return null;
  if (msg._otp !== undefined) return msg._otp;

  const source = [
    msg.subject,
    msg.content,
    msg.text_content,
    msg.raw_content,
    stripHtml(msg.html_content || msg.html),
  ].filter(Boolean).join('\n');

  msg._otp = extractOtp(source);
  return msg._otp;
}

function applyTheme(mode, persist = true) {
  const selected = mode || 'dark';
  state.themeMode = selected;

  let actual = selected;
  if (selected === 'auto') {
    actual = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  document.documentElement.setAttribute('data-theme', actual);
  if (persist) localStorage.setItem(STORAGE_KEYS.theme, selected);
  if ($('theme-select')) $('theme-select').value = selected;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json();
  // Handle both {ok:true,data:...} and {success:true,data:...} formats
  if (!data.ok && !data.success) throw new Error(data.error || 'API error');
  return data.data;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Скопировано', 'success');
  } catch {
    toast('Не удалось скопировать', 'error');
  }
}

/* ——— Render ——— */

function renderMailboxes() {
  const root = $('mailboxes');
  root.innerHTML = '';

  if (!state.mailboxes.length) {
    root.innerHTML = '<div class="empty-state" style="padding:30px 0"><div class="empty-icon">📭</div><div class="empty-text">Нажмите + чтобы создать</div></div>';
    return;
  }

  for (const mb of state.mailboxes) {
    const div = document.createElement('div');
    div.className = 'mailbox-item' + (mb === state.selected ? ' active' : '');

    const total = state.emailCounts[mb] || 0;
    const unread = state.unreadCounts[mb] || 0;
    const badgeClass = total > 0 ? `mailbox-badge${unread > 0 ? ' unread' : ''}` : 'mailbox-badge empty';
    const badgeText = unread > 0 ? String(unread) : String(total);

    const title = document.createElement('span');
    title.className = 'mailbox-email';
    title.title = mb;
    title.textContent = mb;

    const badge = document.createElement('span');
    badge.className = badgeClass;
    badge.textContent = badgeText;
    badge.title = unread > 0 ? `Непрочитанных: ${unread} / Всего: ${total}` : `Всего: ${total}`;

    const actions = document.createElement('div');
    actions.className = 'mailbox-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'mailbox-copy';
    copyBtn.title = 'Копировать адрес';
    copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" stroke="currentColor" stroke-width="1.3"/></svg>';
    copyBtn.onclick = (e) => {
      e.stopPropagation();
      copyText(mb);
    };

    const delBtn = document.createElement('button');
    delBtn.className = 'mailbox-delete';
    delBtn.title = 'Удалить ящик';
    delBtn.innerHTML = ICON_TRASH;
    delBtn.onclick = (e) => {
      e.stopPropagation();
      deleteMailbox(mb).catch((err) => toast('Ошибка: ' + err.message, 'error'));
    };

    actions.appendChild(copyBtn);
    actions.appendChild(delBtn);

    div.appendChild(title);
    div.appendChild(badge);
    div.appendChild(actions);

    div.onclick = () => selectMailbox(mb);
    root.appendChild(div);
  }
}

function renderInbox() {
  const root = $('inbox');
  root.innerHTML = '';

  const title = $('inbox-title');
  if (state.selected) {
    const unread = state.unreadCounts[state.selected] || 0;
    title.textContent = unread > 0
      ? `Входящие — ${state.emails.length} (новых: ${unread})`
      : `Входящие — ${state.emails.length}`;
  } else {
    title.textContent = 'Входящие';
  }

  if (!state.selected) {
    root.innerHTML = '<div class="empty-state"><div class="empty-icon">📬</div><div class="empty-text">Выберите почтовый ящик</div></div>';
    return;
  }

  if (!state.emails.length) {
    root.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">Нет писем</div></div>';
    return;
  }

  for (const msg of state.emails) {
    const id = String(msg.id);
    const div = document.createElement('div');
    const unreadClass = isUnread(id, state.selected) ? ' email-unread' : '';
    div.className = 'email-item' + (id === String(state.selectedEmailId || '') ? ' active' : '') + unreadClass;

    const subj = msg.subject || '(без темы)';
    const from = msg.from_address || msg.from || '—';
    const time = timeFmt(msg.created_at || msg.timestamp);
    const otp = getMessageOtp(msg);

    const head = document.createElement('div');
    head.className = 'email-head';

    const subjectNode = document.createElement('div');
    subjectNode.className = 'email-subject';
    subjectNode.textContent = subj;

    const actions = document.createElement('div');
    actions.className = 'email-actions-inline';

    if (otp) {
      const otpBtn = document.createElement('button');
      otpBtn.className = 'otp-chip';
      otpBtn.textContent = otp;
      otpBtn.title = 'Скопировать код';
      otpBtn.onclick = (e) => {
        e.stopPropagation();
        copyText(otp);
      };
      actions.appendChild(otpBtn);
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'email-inline-delete';
    delBtn.title = 'Удалить письмо';
    delBtn.innerHTML = ICON_TRASH;
    delBtn.onclick = async (e) => {
      e.stopPropagation();
      await deleteEmailById(id, { askConfirm: true });
    };
    actions.appendChild(delBtn);

    head.appendChild(subjectNode);
    head.appendChild(actions);

    const meta = document.createElement('div');
    meta.className = 'email-meta';
    meta.innerHTML = `<span class="email-from">${escHtml(from)}</span><span class="email-time">${escHtml(time)}</span>`;

    div.appendChild(head);
    div.appendChild(meta);
    div.onclick = () => openEmail(msg);
    root.appendChild(div);
  }
}

function renderViewer(email) {
  const header = $('viewer-header');
  const body = $('viewer-body');

  if (!email) {
    header.style.display = 'none';
    body.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">Выберите письмо для просмотра</div></div>';
    return;
  }

  header.style.display = 'flex';
  $('viewer-subject').textContent = email.subject || '(без темы)';
  $('viewer-from').textContent = `От: ${email.from_address || email.from || '—'} • ${timeFmt(email.created_at || email.timestamp)}`;

  updateViewerActions(email);

  const html = email.html_content || email.html || '';
  const text = email.content || email.text_content || email.raw_content || '';

  if (html) {
    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-same-origin';
    iframe.style.cssText = 'width:100%;border:none;background:#fff;border-radius:6px;min-height:400px';
    body.innerHTML = '';
    body.appendChild(iframe);
    iframe.srcdoc = `<html><head><style>body{font-family:sans-serif;padding:16px;color:#222;font-size:14px;line-height:1.5}img{max-width:100%}a{color:#2563eb}</style></head><body>${html}</body></html>`;
    iframe.onload = () => {
      try {
        const h = iframe.contentDocument.body.scrollHeight;
        iframe.style.height = Math.max(h + 40, 200) + 'px';
      } catch {}
    };
  } else if (text) {
    body.innerHTML = `<pre style="white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:14px;line-height:1.6;color:var(--text)">${escHtml(text)}</pre>`;
  } else {
    body.innerHTML = '<div class="empty-state"><div class="empty-text">Письмо пустое</div></div>';
  }
}

function updateViewerActions(email) {
  const id = String(email?.id || state.selectedEmailId || '');
  const unread = id ? isUnread(id, state.selected) : false;

  const unreadBtn = $('toggle-unread-btn');
  unreadBtn.textContent = unread ? 'Прочитано' : 'Непрочитано';
  unreadBtn.title = unread ? 'Пометить как прочитанное' : 'Пометить как непрочитанное';

  const otpBtn = $('copy-otp-btn');
  const otp = getMessageOtp(email);
  if (otp) {
    otpBtn.style.display = 'inline-flex';
    otpBtn.textContent = `OTP ${otp}`;
  } else {
    otpBtn.style.display = 'none';
  }
}

/* ——— Actions ——— */

async function loadMailboxes() {
  const mb = await api('api/mailboxes');
  state.mailboxes = mb.mailboxes || [];
  state.selected = mb.selected || state.selected;
  renderMailboxes();
}

async function selectMailbox(email) {
  const mb = await api('api/select', { method: 'POST', body: JSON.stringify({ email }) });
  state.mailboxes = mb.mailboxes || [];
  state.selected = mb.selected || email;
  state.selectedEmailId = null;
  state.selectedEmail = null;
  state.emails = [];
  renderMailboxes();
  renderInbox();
  renderViewer(null);
  await refreshInbox();
}

async function createMailbox() {
  const prefix = $('prefix').value.trim();
  setStatus('Создаю ящик…');
  const mb = await api('api/mailboxes', { method: 'POST', body: JSON.stringify(prefix ? { prefix } : {}) });
  state.mailboxes = mb.mailboxes || [];
  state.selected = mb.selected || null;
  $('prefix').value = '';
  $('create-form').style.display = 'none';
  renderMailboxes();
  toast(`✅ Создан: ${state.selected}`, 'success');
  await refreshInbox();
}

async function deleteMailbox(email) {
  if (!email) return;
  if (!confirm(`Удалить ящик ${email}?\n\nПисьма этого ящика также будут удалены из локального архива UI.`)) return;

  const mb = await api(`api/mailboxes/${encodeURIComponent(email)}`, { method: 'DELETE' });
  state.mailboxes = mb.mailboxes || [];
  state.selected = mb.selected || null;

  delete state.emailCounts[email];
  delete state.unreadCounts[email];
  delete state.readState[email];
  saveReadState();

  state.selectedEmailId = null;
  state.selectedEmail = null;
  state.emails = [];

  renderMailboxes();
  renderViewer(null);
  renderInbox();

  if (state.selected) {
    await refreshInbox();
  } else {
    setStatus('Ящик удалён. Создайте новый →');
  }

  toast('Ящик удалён', 'success');
}

function normalizeEmails(resp) {
  const emails = resp?.data?.emails || resp?.emails || [];
  return emails.map(x => ({
    id: x.id,
    subject: x.subject,
    from: x.from,
    from_address: x.from_address,
    created_at: x.created_at,
    timestamp: x.timestamp,
    content: x.content,
    html_content: x.html_content,
    html: x.html,
    text_content: x.text_content,
    raw_content: x.raw_content,
  }));
}

function cleanupReadStateForMailbox(mailbox, existingIdsSet) {
  const mbState = getMailboxReadState(mailbox);

  for (const id of Object.keys(mbState.unread)) {
    if (!existingIdsSet.has(id)) delete mbState.unread[id];
  }

  // Keep "seen" history bounded
  const seenEntries = Object.entries(mbState.seen);
  if (seenEntries.length > 1500) {
    seenEntries.sort((a, b) => Number(a[1] || 0) - Number(b[1] || 0));
    const toDrop = seenEntries.slice(0, seenEntries.length - 1200);
    for (const [id] of toDrop) {
      if (!existingIdsSet.has(id) && !mbState.unread[id]) delete mbState.seen[id];
    }
  }
}

async function refreshInbox() {
  if (!state.selected) return;

  const resp = await api(`api/emails?email=${encodeURIComponent(state.selected)}`);
  state.emails = normalizeEmails(resp);

  const mailbox = state.selected;
  const mbState = getMailboxReadState(mailbox);
  const existingIds = new Set();

  for (const msg of state.emails) {
    const id = String(msg.id || '');
    if (!id) continue;
    existingIds.add(id);

    if (!mbState.seen[id]) {
      mbState.seen[id] = Date.now();
      mbState.unread[id] = true; // New incoming email
    }
  }

  cleanupReadStateForMailbox(mailbox, existingIds);
  saveReadState();

  state.emailCounts[mailbox] = state.emails.length;
  state.unreadCounts[mailbox] = state.emails.reduce((acc, m) => acc + (isUnread(String(m.id || ''), mailbox) ? 1 : 0), 0);

  // If selected email disappeared from list - reset viewer
  if (state.selectedEmailId && !existingIds.has(String(state.selectedEmailId))) {
    state.selectedEmailId = null;
    state.selectedEmail = null;
    renderViewer(null);
  }

  renderInbox();
  renderMailboxes();
  setStatus(`${state.selected} • ${state.emails.length} писем • непрочитанных: ${state.unreadCounts[mailbox] || 0} • ${new Date().toLocaleTimeString('ru-RU', { timeZone: MOSCOW_TZ, hour: '2-digit', minute: '2-digit' })} МСК`);
}

async function openEmail(msg) {
  state.selectedEmailId = String(msg.id);
  markRead(state.selectedEmailId);
  renderInbox();

  // Fetch full email
  try {
    const resp = await api(`api/email/${encodeURIComponent(msg.id)}`);
    const full = resp?.data || resp || {};
    state.selectedEmail = { ...msg, ...full };
  } catch {
    state.selectedEmail = msg;
  }

  // Recompute counters after read action
  if (state.selected) {
    state.unreadCounts[state.selected] = state.emails.reduce((acc, m) => acc + (isUnread(String(m.id || ''), state.selected) ? 1 : 0), 0);
  }

  renderMailboxes();
  renderInbox();
  renderViewer(state.selectedEmail);
}

async function deleteEmailById(id, { askConfirm = false } = {}) {
  if (!id) return;
  const emailId = String(id);

  if (askConfirm && !confirm('Удалить это письмо?')) return;

  try {
    await api(`api/email/${encodeURIComponent(emailId)}`, { method: 'DELETE' });

    // Clean local read/unread markers for all mailboxes
    for (const mb of Object.keys(state.readState)) {
      const mbState = getMailboxReadState(mb);
      delete mbState.unread[emailId];
      delete mbState.seen[emailId];
    }
    saveReadState();

    if (String(state.selectedEmailId || '') === emailId) {
      state.selectedEmailId = null;
      state.selectedEmail = null;
      renderViewer(null);
    }

    toast('Письмо удалено', 'success');
    await refreshInbox();
  } catch (e) {
    toast('Ошибка: ' + e.message, 'error');
  }
}

async function deleteEmail() {
  if (!state.selectedEmailId) return;
  await deleteEmailById(state.selectedEmailId, { askConfirm: true });
}

async function toggleUnreadCurrent() {
  if (!state.selectedEmailId || !state.selected) return;
  const id = String(state.selectedEmailId);
  if (isUnread(id, state.selected)) {
    markRead(id, state.selected);
    toast('✅ Помечено как прочитанное', 'success');
  } else {
    markUnread(id, state.selected);
    toast('Помечено как непрочитанное', 'success');
  }

  state.unreadCounts[state.selected] = state.emails.reduce((acc, m) => acc + (isUnread(String(m.id || ''), state.selected) ? 1 : 0), 0);
  renderMailboxes();
  renderInbox();
  if (state.selectedEmail) updateViewerActions(state.selectedEmail);
}

function copyOtpCurrent() {
  if (!state.selectedEmail) return;
  const otp = getMessageOtp(state.selectedEmail);
  if (!otp) {
    toast('OTP код не найден', 'error');
    return;
  }
  copyText(otp);
}

async function clearInbox() {
  if (!state.selected) return;
  if (!confirm(`Очистить все письма в ${state.selected}?`)) return;
  try {
    await api(`api/emails/clear?email=${encodeURIComponent(state.selected)}`, { method: 'DELETE' });

    // Clear local read state for this mailbox
    const mbState = getMailboxReadState(state.selected);
    mbState.seen = {};
    mbState.unread = {};
    saveReadState();

    state.selectedEmailId = null;
    state.selectedEmail = null;
    renderViewer(null);
    toast('Inbox очищен', 'success');
    await refreshInbox();
  } catch (e) {
    toast('Ошибка: ' + e.message, 'error');
  }
}

function setupAutoRefresh() {
  if (state.autoTimer) clearInterval(state.autoTimer);
  state.autoTimer = null;
  if (!$('autorefresh').checked) return;
  state.autoTimer = setInterval(() => {
    refreshInbox().catch(() => {});
  }, 5000);
}

/* ——— Init ——— */

async function init() {
  applyTheme(state.themeMode, false);

  const mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  if (mql) {
    const onThemeChange = () => {
      if (state.themeMode === 'auto') applyTheme('auto', false);
    };
    if (mql.addEventListener) mql.addEventListener('change', onThemeChange);
    else if (mql.addListener) mql.addListener(onThemeChange);
  }

  $('theme-select').onchange = (e) => applyTheme(e.target.value, true);

  // Create form toggle
  $('create-btn').onclick = () => {
    const form = $('create-form');
    form.style.display = form.style.display === 'none' ? 'flex' : 'none';
    if (form.style.display !== 'none') $('prefix').focus();
  };
  $('create-go').onclick = () => createMailbox().catch(e => toast('Ошибка: ' + e.message, 'error'));
  $('create-cancel').onclick = () => { $('create-form').style.display = 'none'; };
  $('prefix').onkeydown = (e) => { if (e.key === 'Enter') createMailbox().catch(e2 => toast('Ошибка: ' + e2.message, 'error')); };

  // Actions
  $('refresh-btn').onclick = () => {
    $('refresh-btn').classList.add('spinning');
    refreshInbox().catch(e => toast('Ошибка: ' + e.message, 'error')).finally(() => $('refresh-btn').classList.remove('spinning'));
  };
  $('clear-btn').onclick = () => clearInbox();
  $('delete-email-btn').onclick = () => deleteEmail();
  $('toggle-unread-btn').onclick = () => toggleUnreadCurrent();
  $('copy-otp-btn').onclick = () => copyOtpCurrent();
  $('autorefresh').onchange = () => setupAutoRefresh();

  // Load
  try {
    setStatus('Загрузка…');
    await loadMailboxes();
    if (state.selected) await refreshInbox();
    setupAutoRefresh();
    if (!state.selected) setStatus('Создайте почтовый ящик →');
  } catch (e) {
    setStatus('Ошибка: ' + e.message);
    toast('Ошибка загрузки', 'error');
  }
}

init();
