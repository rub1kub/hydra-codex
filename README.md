# 🐍 Hydra Codex

> Cut one head off, two more grow back.

Autonomous ChatGPT Codex account rotation for AI agents. When an account hits its usage limits, Hydra automatically spins up a new one — no human intervention needed.

## The Problem

ChatGPT Codex has usage limits. When your AI agent hits them, it stops working. You have to manually create a new account, verify the email, log in, connect OAuth... every single time.

## The Solution

Hydra Codex does it all automatically:

1. **Monitors** usage limits in real-time via ChatGPT's internal API
2. **Detects** when limits are close to exhaustion
3. **Creates** a new account through a self-hosted temp mail service
4. **Verifies** the email automatically (SMTP server catches the code)
5. **Connects** the new account via OAuth
6. **Notifies** you that the rotation happened

Your agents never stop. The accounts rotate themselves.

## How It Works

```
                     ┌─────────────────────┐
                     │   Your AI Agent      │
                     │   (OpenClaw, etc.)   │
                     └──────────┬──────────┘
                                │ uses Codex
                                ▼
┌──────────────┐    ┌─────────────────────┐
│  Hydra       │───▶│   ChatGPT Codex     │
│  Monitor     │    │   Account Pool      │
│  (cron/API)  │    │                     │
└──────┬───────┘    │  account-1 [85%] ✓  │
       │            │  account-2 [dead]   │
       │ limit < 10%│  account-3 [new] ←──┤
       ▼            └─────────────────────┘
┌──────────────┐              ▲
│  Auto-Create │              │ OAuth
│  ┌─────────┐ │    ┌────────┴────────┐
│  │Temp Mail│ │    │  Browser Auto   │
│  │ Server  │◀├───▶│  Registration   │
│  └─────────┘ │    └─────────────────┘
└──────────────┘
```

## Components

### 🔍 Usage Monitor (`get_codex_usage.js`)

Connects to a running Chrome instance via CDP (Chrome DevTools Protocol), grabs a session token, and calls ChatGPT's internal `backend-api/wham/usage` endpoint for exact usage data.

```bash
./scripts/get_codex_usage.sh --json --quiet
```

```json
{
  "ok": true,
  "account": { "email": "abc123@yourdomain.com", "plan": "free" },
  "limit_reached": false,
  "cards": [
    { "label": "Weekly usage limit", "remaining_pct": 76, "reset_at": "2026-02-22T17:28:21Z" },
    { "label": "Code review", "remaining_pct": 100 }
  ]
}
```

### 🔄 Auto-Rotate (`auto_rotate_accounts.sh`)

Checks usage → rotates if below threshold. Run it on a cron schedule.

```bash
# Check and rotate if needed (threshold: 10% remaining)
./scripts/auto_rotate_accounts.sh

# Custom threshold
ROTATE_THRESHOLD=20 ./scripts/auto_rotate_accounts.sh
```

### 📧 Temp Mail Service

Self-hosted email service that catches verification codes. No external dependencies, no third-party temp mail services that might go down.

- **SMTP server** on port 2525 — receives real emails
- **REST API** — create addresses, check inbox, get verification codes
- **Web UI** — dark-themed three-panel email client at `/mail/`
- **Auto-cleanup** — emails deleted after 24 hours
- **SQLite storage** — zero configuration

### 🤖 Auto-Registration (`register_chatgpt.sh`)

Browser-automated ChatGPT signup:
1. Generates a temp email address
2. Opens ChatGPT signup in headless Chrome
3. Fills in email, password, name, birthday
4. Catches the verification code via SMTP
5. Completes registration (~15-20 seconds)

## Setup

### Prerequisites

- Node.js 18+
- Chrome/Chromium (for CDP)
- A domain with MX record pointing to your server
- SSL certificates (Let's Encrypt)

### 1. Clone & Configure

```bash
git clone https://github.com/rub1kub/hydra-codex.git
cd hydra-codex
cp .env.example .env
# Edit .env with your values
```

### 2. Install & Start the Mail Service

```bash
npm install

# The mail service runs as a separate process:
# See the server setup section below
```

### 3. DNS Setup

```
MX    yourdomain.com       → mail.yourdomain.com (priority 10)
A     mail.yourdomain.com  → YOUR_SERVER_IP
```

### 4. Server Setup

**systemd service:**
```ini
[Unit]
Description=Hydra Codex Mail Service
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/hydra-codex
ExecStart=/usr/bin/node server.js
Restart=always
Environment=PORT=3333
Environment=SMTP_PORT=2525

[Install]
WantedBy=multi-user.target
```

**Apache reverse proxy (optional, for web UI):**
```apache
<Location /mail>
    AuthType Basic
    AuthName "Hydra"
    AuthUserFile /etc/apache2/.htpasswd
    Require valid-user
</Location>
ProxyPass /mail/ http://127.0.0.1:3333/
ProxyPassReverse /mail/ http://127.0.0.1:3333/
```

### 5. Schedule Auto-Rotation

```bash
# Cron: check every 6 hours
0 */6 * * * cd /path/to/hydra-codex && ./scripts/auto_rotate_accounts.sh
```

Or with OpenClaw:
```bash
openclaw cron add \
  --name "Hydra Codex Auto-Rotate" \
  --schedule-kind every \
  --every-ms 21600000 \
  --session-target isolated \
  --payload-kind agentTurn \
  --message "Run: ~/.../hydra-codex/scripts/auto_rotate_accounts.sh"
```

## For AI Agent Developers

### Integration with OpenClaw

Your agent can check its own Codex limits and self-rotate:

```bash
# In your agent's skill or heartbeat:
USAGE=$(node /path/to/hydra-codex/scripts/get_codex_usage.js --json --quiet)
REMAINING=$(echo "$USAGE" | jq -r '.cards[0].remaining_pct // 100')

if [ "$REMAINING" -lt 15 ]; then
  # Rotate account
  /path/to/hydra-codex/scripts/auto_rotate_accounts.sh
fi
```

### Agent Instructions Template

Add this to your agent's system prompt or SKILL.md:

```markdown
## Codex Limit Self-Healing

When you detect Codex errors (rate limits, 429s, or "limit reached"):
1. Run: `~/.../hydra-codex/scripts/get_codex_usage.sh --json --quiet`
2. If remaining_pct < 10% or limit_reached is true:
   - Run: `~/.../hydra-codex/scripts/auto_rotate_accounts.sh`
   - Wait 30 seconds for OAuth to complete
   - Retry the Codex request
3. Notify the user that rotation happened
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TEMP_MAIL_URL` | Your mail service URL | — |
| `TEMP_MAIL_USER` | HTTP Basic Auth user | `admin` |
| `TEMP_MAIL_PASS` | HTTP Basic Auth password | — |
| `TEMP_MAIL_AUTH` | Combined `user:pass` for scripts | — |
| `CDP_PORT` | Chrome DevTools Protocol port | `18800` |
| `ROTATE_THRESHOLD` | Rotate when remaining < this % | `10` |

## Project Structure

```
hydra-codex/
├── scripts/
│   ├── get_codex_usage.js       # Monitor: extract usage via CDP/API
│   ├── get_codex_usage.sh       # Monitor: bash wrapper
│   ├── auto_rotate_accounts.sh  # Rotate: check limits + create new account
│   ├── register_chatgpt.sh      # Register: browser-automated signup
│   ├── get_temp_email.sh        # Util: generate email, check inbox
│   ├── mail_ui_server.js        # Standalone mail UI server
│   └── mail_ui.sh               # Quick-start mail UI
├── ui/mail/
│   ├── index.html               # Web UI
│   ├── styles.css               # Dark theme
│   └── app.js                   # Frontend
├── .env.example                 # Config template
└── README.md
```

## License

MIT
