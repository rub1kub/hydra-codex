# 🐍 Hydra Codex

> Cut one head off, two more grow back.

Autonomous ChatGPT Codex account rotation for AI agents. When one account hits its usage limits, Hydra automatically switches to the next — zero downtime, no human intervention.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22+-green)](https://nodejs.org)

## The Problem

ChatGPT Codex has usage limits per account. When your AI agent hits the cap mid-task, everything stops. Manually switching accounts wastes time and breaks workflows.

## The Solution

Hydra monitors usage across **multiple Codex accounts** and auto-rotates to the best available one — like a load balancer, but for AI compute.

```
Account 1: 94% used  → skip
Account 2: 23% used  → ✅ active
Account 3: 67% used  → standby
Account 4: 100% used → skip
```

## Features

- 📊 **Usage monitoring** — polls `wham/usage` API across all accounts every 20 minutes
- 🔄 **Auto-rotation** — switches active account when primary hits threshold (95%) or secondary hits 90%
- 🔑 **OAuth profile management** — reads from OpenClaw `auth-profiles.json`
- 🤫 **Silent by default** — only notifies when switch happens or all accounts blocked
- 📈 **Reset tracking** — shows when each account's usage window resets

## How It Works

```bash
# Check current pool status
bash scripts/codex_pool_status.sh

# Output example:
# [PRIMARY] admin@company.com — 24% used, resets in 2h
# [STANDBY] user2@company.com — 67% used, resets in 4d
# [BLOCKED] user3@company.com — 100% (limit reached)
# → No switch needed
```

## Setup

1. Configure OAuth profiles in OpenClaw (`auth-profiles.json`)
2. Add accounts to the rotation pool
3. Schedule `codex_pool_status.sh` via cron (every 20 min)
4. Get notified only when action is needed

## Also Includes

- **Hydra Mail** — disposable email service for account creation
  - SQLite WAL + incremental sync
  - SSE real-time updates
  - OTP extraction + preview text
  - Retention settings + backup

## Tech Stack

- Node.js / Bash
- SQLite WAL mode
- Server-Sent Events (SSE)
- OpenClaw OAuth integration

---

Built by [@rub1kub](https://github.com/rub1kub) · Used in production for autonomous AI agent workflows
