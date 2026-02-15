#!/bin/bash
# Auto-Rotate ChatGPT Accounts - Система авто-замены при лимитах
# Проверяет лимиты через API (wham/usage) и автоматически ротирует аккаунт

set -euo pipefail

SKILL_DIR="$HOME/.openclaw/workspace-tima/skills/chatgpt-auto-register"
ACCOUNTS_DB="$SKILL_DIR/data/accounts.json"
STATE_FILE="$SKILL_DIR/data/rotation-state.json"
USAGE_SCRIPT="$SKILL_DIR/scripts/get_codex_usage.js"

# Threshold: rotate when remaining < this %
ROTATE_THRESHOLD="${ROTATE_THRESHOLD:-10}"

log() { echo "[$(date +'%H:%M:%S')] $*" >&2; }
error() { log "ERROR: $*"; exit 1; }

# Check limits via get_codex_usage.js (API method)
check_limits() {
    log "Проверяю лимиты через API..."
    
    local usage
    usage=$(cd "$SKILL_DIR" && timeout 30 node "$USAGE_SCRIPT" --json --quiet 2>/dev/null) || {
        log "Не удалось получить данные о лимитах"
        return 2  # unknown
    }
    
    local ok=$(echo "$usage" | jq -r '.ok')
    if [ "$ok" != "true" ]; then
        local err=$(echo "$usage" | jq -r '.error // "unknown"')
        log "Ошибка API: $err"
        return 2
    fi
    
    local limit_reached=$(echo "$usage" | jq -r '.limit_reached // false')
    local email=$(echo "$usage" | jq -r '.account.email // "unknown"')
    local plan=$(echo "$usage" | jq -r '.account.plan // "unknown"')
    
    log "Аккаунт: $email ($plan)"
    
    # Check limit_reached flag
    if [ "$limit_reached" = "true" ]; then
        log "⚠️  API сообщает: limit_reached=true"
        return 1
    fi
    
    # Check each card
    local cards=$(echo "$usage" | jq -c '.cards[]' 2>/dev/null || true)
    local need_rotate=false
    
    while IFS= read -r card; do
        [ -z "$card" ] && continue
        local label=$(echo "$card" | jq -r '.label')
        local remaining=$(echo "$card" | jq -r '.remaining_pct // 100')
        local reset_at=$(echo "$card" | jq -r '.reset_at // "N/A"')
        
        log "  $label: ${remaining}% осталось (сброс: $reset_at)"
        
        if [ "$remaining" -lt "$ROTATE_THRESHOLD" ] 2>/dev/null; then
            log "  ⚠️  $label ниже порога ($remaining% < $ROTATE_THRESHOLD%)"
            need_rotate=true
        fi
    done <<< "$cards"
    
    if $need_rotate; then
        return 1
    fi
    
    log "✅ Все лимиты в норме"
    return 0
}

# Create new account
create_new_account() {
    log "Создаю новый ChatGPT аккаунт..."
    "$SKILL_DIR/scripts/register_chatgpt.sh"
}

# Update state file
update_state() {
    local email=$1
    local status=$2
    
    mkdir -p "$(dirname "$STATE_FILE")"
    jq -n \
        --arg email "$email" \
        --arg status "$status" \
        --arg timestamp "$(date -Iseconds)" \
        '{lastRotation: $timestamp, currentAccount: $email, status: $status}' \
        > "$STATE_FILE"
}

# Main logic
main() {
    log "=== Проверка лимитов OpenAI Codex ==="
    
    local check_result=0
    check_limits || check_result=$?
    
    case $check_result in
        0)
            log "Лимиты в норме, ничего не делаем"
            exit 0
            ;;
        2)
            log "Не удалось проверить лимиты, пропускаем ротацию"
            exit 0
            ;;
        1)
            log "🚨 Лимиты близки к исчерпанию! Создаю новый аккаунт..."
            ;;
    esac
    
    # Create new account
    local credentials
    credentials=$(create_new_account) || error "Не удалось создать аккаунт"
    local new_email=$(echo "$credentials" | cut -d: -f1)
    
    log "Новый аккаунт создан: $new_email"
    
    # Update state
    update_state "$new_email" "active"
    
    log "=== УСПЕХ! ==="
}

main "$@"
