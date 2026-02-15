# Auto-Rotate Cron Setup

## Автоматическая проверка лимитов каждые 6 часов

```bash
# Добавить через OpenClaw cron
openclaw cron add \
  --name "ChatGPT Account Auto-Rotate" \
  --schedule-kind every \
  --every-ms $((6 * 60 * 60 * 1000)) \
  --session-target isolated \
  --payload-kind agentTurn \
  --message "Run scripts/auto_rotate_accounts.sh to check Codex limits" \
  --delivery-mode announce
```

## Ручная проверка

```bash
./scripts/auto_rotate_accounts.sh
```

## Проверка текущего состояния

```bash
cat data/rotation-state.json
```

## Список всех аккаунтов

```bash
cat data/accounts.json | jq
```
