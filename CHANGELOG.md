# Changelog

## 2026-02-28

### Added
- Mailbox deletion from sidebar (`DELETE /api/mailboxes/:email`) with local archive cleanup.
- Local archive retention in `mail_ui_server.js` so inbox can show remote + archived messages.
- Theme switcher in UI (`Dark / Light / Auto`) with persisted preference.
- OTP quick-copy from inbox list and from message viewer.
- Inline email delete action in inbox list.
- Read/unread state with unread counters and manual toggle.

### Changed
- Time formatting in UI is now fixed to **Europe/Moscow (MSK)**.
- Replaced non-mailbox emojis in controls with text/SVG icons.
- Viewer and inbox controls cleaned up for consistent icon-based UI.

### Notes
- Mailbox emojis (logo/empty states) were intentionally kept.
