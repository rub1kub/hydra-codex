/* Hydra Mail UI — app.js */
const $ = (id) => document.getElementById(id);

const state = {
  mailboxes: [],
  selected: null,
  emails: [],
  emailCounts: {},      // email -> count
  selectedEmailId: null,
  selectedEmail: null,   // full email object
  autoTimer: null,
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
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
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
    toast('📋 Скопировано!', 'success');
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

    const cnt = state.emailCounts[mb] || 0;
    const badgeClass = cnt > 0 ? 'mailbox-badge' : 'mailbox-badge empty';

    div.innerHTML = `
      <span class="mailbox-email" title="${escHtml(mb)}">${escHtml(mb)}</span>
      <span class="${badgeClass}">${cnt}</span>
      <button class="mailbox-copy" title="Копировать адрес" onclick="event.stopPropagation();copyText('${escHtml(mb)}')">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" stroke="currentColor" stroke-width="1.3"/></svg>
      </button>
    `;

    div.onclick = () => selectMailbox(mb);
    root.appendChild(div);
  }
}

function renderInbox() {
  const root = $('inbox');
  root.innerHTML = '';

  const title = $('inbox-title');
  if (state.selected) {
    title.textContent = `Входящие — ${state.emails.length}`;
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
    const div = document.createElement('div');
    div.className = 'email-item' + (msg.id === state.selectedEmailId ? ' active' : '');

    const subj = msg.subject || '(без темы)';
    const from = msg.from_address || msg.from || '—';
    const time = timeFmt(msg.created_at || msg.timestamp);

    div.innerHTML = `
      <div class="email-subject">${escHtml(subj)}</div>
      <div class="email-meta">
        <span class="email-from">${escHtml(from)}</span>
        <span class="email-time">${escHtml(time)}</span>
      </div>
    `;

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

  // Try to render HTML content
  const html = email.html_content || email.html || '';
  const text = email.content || email.text_content || email.raw_content || '';

  if (html) {
    // Use sandboxed iframe for HTML emails
    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-same-origin';
    iframe.style.cssText = 'width:100%;border:none;background:#fff;border-radius:6px;min-height:400px';
    body.innerHTML = '';
    body.appendChild(iframe);
    iframe.srcdoc = `<html><head><style>body{font-family:sans-serif;padding:16px;color:#222;font-size:14px;line-height:1.5}img{max-width:100%}a{color:#2563eb}</style></head><body>${html}</body></html>`;
    // Auto-resize iframe
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

async function refreshInbox() {
  if (!state.selected) return;
  const resp = await api(`api/emails?email=${encodeURIComponent(state.selected)}`);
  const emails = resp?.data?.emails || resp?.emails || [];
  state.emails = emails.map(x => ({
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

  // Update count
  state.emailCounts[state.selected] = state.emails.length;

  renderInbox();
  renderMailboxes();
  setStatus(`${state.selected} • ${state.emails.length} писем • ${new Date().toLocaleTimeString('ru')}`);
}

async function openEmail(msg) {
  state.selectedEmailId = msg.id;
  renderInbox();

  // Fetch full email
  try {
    const resp = await api(`api/email/${encodeURIComponent(msg.id)}`);
    const full = resp?.data || resp || {};
    state.selectedEmail = { ...msg, ...full };
  } catch {
    state.selectedEmail = msg;
  }

  renderViewer(state.selectedEmail);
}

async function deleteEmail() {
  if (!state.selectedEmailId) return;
  try {
    await api(`api/email/${encodeURIComponent(state.selectedEmailId)}`, { method: 'DELETE' });
    toast('🗑 Письмо удалено', 'success');
    state.selectedEmailId = null;
    state.selectedEmail = null;
    renderViewer(null);
    await refreshInbox();
  } catch (e) {
    toast('Ошибка: ' + e.message, 'error');
  }
}

async function clearInbox() {
  if (!state.selected) return;
  if (!confirm(`Очистить все письма в ${state.selected}?`)) return;
  try {
    await api(`api/emails/clear?email=${encodeURIComponent(state.selected)}`, { method: 'DELETE' });
    state.selectedEmailId = null;
    state.selectedEmail = null;
    renderViewer(null);
    toast('🧹 Inbox очищен', 'success');
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
