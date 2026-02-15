---
name: chatgpt-auto-register
description: Автоматическая регистрация ChatGPT аккаунтов через временную почту + авто-замена при лимитах
metadata:
  openclaw:
    emoji: 🤖
    os: [linux]
    requires:
      bins: [curl, jq, tmux, openssl]
---

# ChatGPT Auto-Register + Auto-Rotate

Полностью автоматизированная система для:
1. **Регистрации ChatGPT аккаунтов** через self-hosted временную почту
2. **OAuth подключения** к OpenClaw
3. **Авто-замены аккаунтов** при достижении лимитов

## Быстрый старт

### 1. Зарегистрировать один аккаунт вручную

```bash
./scripts/register_chatgpt.sh
```

**Время:** ~15-20 секунд (оптимизированная версия)

### 2. Настроить авто-замену при лимитах

```bash
# Добавить cron job (проверка каждые 6 часов)
openclaw cron add \
  --name "ChatGPT Account Auto-Rotate" \
  --schedule-kind every \
  --every-ms $((6 * 60 * 60 * 1000)) \
  --session-target isolated \
  --payload-kind agentTurn \
  --message "Run scripts/auto_rotate_accounts.sh to check Codex limits" \
  --delivery-mode announce
```

### 3. Проверить статус

```bash
# Текущее состояние ротации
cat data/rotation-state.json | jq

# Все аккаунты
cat data/accounts.json | jq

# OpenClaw status
openclaw models status | grep openai-codex
```

## Архитектура

### Компоненты

1. **register_chatgpt.sh** - Основной скрипт регистрации
   - Генерирует временный email через self-hosted mail API
   - Автоматизирует браузер для регистрации
   - Получает верификационный код из почты
   - Подключает OAuth к OpenClaw

2. **auto_rotate_accounts.sh** - Мониторинг лимитов и авто-замена
   - Проверяет cooldown/disable статус
   - Считает errorCount
   - Создаёт новый аккаунт при превышении лимитов
   - Уведомляет пользователя в Telegram

3. **Cron Job** - Автоматическая проверка каждые 6 часов

### Workflow регистрации

```
1. Генерация email (self-hosted mail API)
   ↓
2. Генерация пароля (openssl rand)
   ↓
3. Открытие ChatGPT signup (browser automation)
   ↓
4. Ввод email + пароль
   ↓
5. Получение кода верификации (SMTP сервер)
   ↓
6. Ввод кода
   ↓
7. Заполнение профиля (имя + дата рождения)
   ↓
8. Пропуск onboarding
   ↓
9. OAuth авторизация в OpenClaw
   ↓
10. Сохранение в accounts.json
```

### Workflow авто-замены

```
Cron (каждые 6 часов)
   ↓
Проверка лимитов (openclaw models status)
   ↓
Лимиты превышены?
   ↓ Да
Уведомление пользователя
   ↓
Создание нового аккаунта (register_chatgpt.sh)
   ↓
OAuth подключение
   ↓
Обновление rotation-state.json
   ↓
Уведомление об успехе
```

## Файлы

### Скрипты

- `scripts/register_chatgpt.sh` - Регистрация + OAuth
- `scripts/auto_rotate_accounts.sh` - Авто-замена при лимитах
- `scripts/get_temp_email.sh` - Получение временного email (утилита)

### Данные

- `data/accounts.json` - База всех созданных аккаунтов
- `data/rotation-state.json` - Текущее состояние ротации

### Документация

- `FULL_WORKFLOW.md` - Полный пошаговый workflow
- `CRON_SETUP.md` - Инструкции по настройке cron
- `USAGE.md` - Примеры использования

## Технические детали

### Временная почта (self-hosted)

**API:**
- URL: configured via `TEMP_MAIL_URL` env var
- Auth: HTTP Basic (configured via `TEMP_MAIL_USER` / `TEMP_MAIL_PASS`)
- Endpoints:
  - `POST /api/generate-email` - Создать email
  - `GET /api/emails?email=<email>` - Получить письма

**SMTP:**
- Port 25 (redirected to 2525 via iptables)
- TLS: STARTTLS enabled
- Certificates: Let's Encrypt

### OAuth Flow

**OpenClaw onboard через tmux:**

1. Запуск `openclaw onboard --auth-choice openai-codex`
2. Автоматические ответы через tmux send-keys
3. Получение OAuth URL
4. Браузер: login + consent
5. Получение redirect URL с authorization code
6. Ввод redirect URL в onboard
7. Обмен code на access/refresh tokens
8. Сохранение в `auth-profiles.json`

### Проверка лимитов

**Индикаторы:**
- `cooldownUntil` в usageStats
- `disabledUntil` в usageStats
- `errorCount > 5` для openai-codex:default

**Действия при лимите:**
1. Создание нового аккаунта
2. OAuth подключение
3. Старый аккаунт остаётся в базе (status: inactive)
4. Новый аккаунт становится default

## Оптимизация скорости

### Текущее время: ~15-20 секунд

**Ускорения:**
1. Headless браузер (`HEADLESS=true`)
2. Параллельная генерация email + открытие браузера
3. Минимальные задержки (100-500ms вместо 2-3s)
4. Пропуск всех опциональных шагов
5. Прямой API вызов вместо UI взаимодействия где возможно

### Дальнейшие улучшения

- [ ] Использовать Playwright вместо tmux для браузера
- [ ] Кэшировать cookies для пропуска логина
- [ ] Батч-регистрация (5-10 аккаунтов за раз)
- [ ] Прокси-ротация для избежания rate limits
- [ ] Captcha решение (если появится)

## Безопасность

### Хранение credentials

**Безопасно:**
- `auth-profiles.json` - права 600, только владелец
- `accounts.json` - локальный файл, не в git
- Пароли генерируются криптографически стойко (openssl rand)

**Риски:**
- Temporary email — может быть прочитан администратором сервиса
- OAuth tokens имеют expiry (10 дней для Codex)
- Rate limiting от OpenAI при частых регистрациях

### Рекомендации

1. Не регистрировать >10 аккаунтов в день с одного IP
2. Использовать разные прокси для батч-регистрации
3. Хранить `accounts.json` зашифрованным (gpg)
4. Ротировать аккаунты только при реальной необходимости

## Примеры использования

### Регистрация одного аккаунта

```bash
cd /path/to/hydra-codex
./scripts/register_chatgpt.sh

# Вывод:
# Email: abc123@yourdomain.com
# Password: <random base64>
```

### Проверка лимитов вручную

```bash
./scripts/auto_rotate_accounts.sh

# Если лимиты в норме: выход 0
# Если лимит превышен: создаёт новый аккаунт
```

### Просмотр истории

```bash
# Все аккаунты (с датой создания)
jq '.accounts[] | {email, created, status}' data/accounts.json

# Текущий активный аккаунт
jq '.currentAccount' data/rotation-state.json
```

## Troubleshooting

### Письмо не приходит

**Причины:**
- SMTP сервер недоступен
- DNS записи не настроены
- OpenAI блокирует ваш домен

**Решение:**
1. Проверить статус SMTP: `sudo systemctl status temp-mail`
2. Проверить DNS: `dig MX mail.yourdomain.com`
3. Использовать другой временный email сервис

### OAuth не работает

**Причины:**
- Старый authorization code (1 раз использования)
- Неверный code_verifier/code_challenge
- Tmux сессия завершилась раньше времени

**Решение:**
1. Запустить onboard заново
2. Получить свежий OAuth URL
3. Использовать новый redirect URL

### Аккаунт забанен

**Причины:**
- Слишком частые регистрации с одного IP
- Подозрительная активность (ботоподобное поведение)
- Нарушение ToS OpenAI

**Решение:**
1. Использовать прокси
2. Добавить delay между регистрациями (1-2 часа)
3. Варьировать user-agent и fingerprint браузера

## Мониторинг

### Логи

```bash
# Логи cron job
openclaw cron runs --job-id <job_id>

# Логи SMTP сервиса
sudo journalctl -u temp-mail -f

# Логи браузера (если используется OpenClaw browser)
ls -lhtr ~/.openclaw/browser/*/logs/
```

### Метрики

- Количество созданных аккаунтов: `jq '.accounts | length' data/accounts.json`
- Частота ротации: `jq '.lastRotation' data/rotation-state.json`
- Текущие лимиты: `openclaw models status | grep openai-codex`

## Лицензия

MIT

## Автор

Создано в рамках OpenClaw workflow automation.
