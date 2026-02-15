#!/bin/bash
# Get temporary email address from self-hosted mail API

BASE_URL="${TEMP_MAIL_URL:?Set TEMP_MAIL_URL env var or create .env}"
MAIL_USER="${TEMP_MAIL_USER:-admin}"
# Auto-load .env if exists
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$SCRIPT_DIR/../.env" ] && set -a && source "$SCRIPT_DIR/../.env" && set +a

MAIL_PASS="${TEMP_MAIL_PASS:?Set TEMP_MAIL_PASS env var or create .env}"

# Generate random email
generate_email() {
    curl -s -u "${MAIL_USER}:${MAIL_PASS}" "${BASE_URL}/api/generate-email" | jq -r '.data.email'
}

# Generate email with custom prefix
generate_email_with_prefix() {
    local prefix="$1"
    curl -s -u "${MAIL_USER}:${MAIL_PASS}" \
        -X POST "${BASE_URL}/api/generate-email" \
        -H "Content-Type: application/json" \
        -d "{\"prefix\":\"${prefix}\"}" | jq -r '.data.email'
}

# List emails for address
list_emails() {
    local email="$1"
    curl -s -u "${MAIL_USER}:${MAIL_PASS}" "${BASE_URL}/api/emails?email=${email}"
}

# Get single email by ID
get_email() {
    local email_id="$1"
    curl -s -u "${MAIL_USER}:${MAIL_PASS}" "${BASE_URL}/api/email/${email_id}"
}

# Wait for verification email and extract code/link
wait_for_verification() {
    local email="$1"
    local max_attempts="${2:-30}"  # 30 attempts = 1 minute with 2s delay
    local attempt=0
    
    echo "Waiting for verification email to ${email}..." >&2
    
    while [ $attempt -lt $max_attempts ]; do
        local response=$(list_emails "$email")
        local count=$(echo "$response" | jq -r '.data.count // 0')
        
        if [ "$count" -gt 0 ]; then
            # Found email(s)
            local email_id=$(echo "$response" | jq -r '.data.emails[0].id')
            local subject=$(echo "$response" | jq -r '.data.emails[0].subject')
            local content=$(echo "$response" | jq -r '.data.emails[0].content')
            
            echo "✅ Email received: ${subject}" >&2
            
            # Try to extract verification link
            local verify_link=$(echo "$content" | grep -oP 'https://chatgpt\.com/[^\s]+' | head -1)
            if [ -n "$verify_link" ]; then
                echo "$verify_link"
                return 0
            fi
            
            # Try to extract verification code
            local verify_code=$(echo "$content" | grep -oP '\b[0-9]{6}\b' | head -1)
            if [ -n "$verify_code" ]; then
                echo "$verify_code"
                return 0
            fi
            
            # Return full content if no link/code found
            echo "$content"
            return 0
        fi
        
        attempt=$((attempt + 1))
        sleep 2
    done
    
    echo "❌ Timeout waiting for email" >&2
    return 1
}

# Main
case "${1:-generate}" in
    generate)
        generate_email
        ;;
    generate-prefix)
        generate_email_with_prefix "$2"
        ;;
    list)
        list_emails "$2"
        ;;
    get)
        get_email "$2"
        ;;
    wait-verify)
        wait_for_verification "$2" "$3"
        ;;
    *)
        echo "Usage: $0 {generate|generate-prefix <prefix>|list <email>|get <id>|wait-verify <email> [max_attempts]}"
        exit 1
        ;;
esac
