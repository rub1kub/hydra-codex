# ChatGPT Auto-Registration - Complete Workflow

## Проверенный рабочий процесс

### Шаг 1: Генерация временного email

```bash
# Через self-hosted mail API
curl -u $TEMP_MAIL_USER:$TEMP_MAIL_PASS -s $TEMP_MAIL_URL/api/generate-email | jq -r '.data.email'

# Пример результата: abc123def456@yourdomain.com
```

### Шаг 2: Открытие ChatGPT signup

```javascript
await browser({ action: "start" });
await browser({ action: "open", targetUrl: "https://chatgpt.com" });
await new Promise(r => setTimeout(r, 2000));
```

### Шаг 3: Клик "Sign up for free"

```javascript
const snapshot = await browser({ action: "snapshot", compact: true });
// Найти кнопку "Sign up for free"
await browser({ 
  action: "act", 
  request: { kind: "click", ref: "<ref для Sign up>" } 
});
await new Promise(r => setTimeout(r, 2000));
```

### Шаг 4: Ввод email

```javascript
// Форма появляется в модальном окне
await browser({ 
  action: "act", 
  request: { 
    kind: "type", 
    ref: "<ref для Email address textbox>",
    text: "abc123def456@yourdomain.com" 
  } 
});

await browser({ 
  action: "act", 
  request: { kind: "click", ref: "<ref для Continue>" } 
});
await new Promise(r => setTimeout(r, 3000));
```

### Шаг 5: Создание пароля

```javascript
// ChatGPT принимает email и просит пароль
const password = crypto.randomBytes(20).toString('base64');

await browser({ 
  action: "act", 
  request: { 
    kind: "type", 
    ref: "<ref для Password textbox>",
    text: password 
  } 
});

await browser({ 
  action: "act", 
  request: { kind: "click", ref: "<ref для Continue>" } 
});
await new Promise(r => setTimeout(r, 3000));
```

### Шаг 6: Ожидание письма с кодом

```javascript
// ChatGPT отправляет письмо с 6-значным кодом на SMTP сервер
// Мониторинг почты через API
let code = null;
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 3000));
  
  const response = await fetch(
    `${TEMP_MAIL_URL}/api/emails?email=${encodeURIComponent(email)}`,
    { headers: { 'Authorization': 'Basic ' + btoa(`${TEMP_MAIL_USER}:${TEMP_MAIL_PASS}`) } }
  );
  const data = await response.json();
  
  if (data.data.count > 0) {
    const content = data.data.emails[0].content;
    const match = content.match(/\b([0-9]{6})\b/);
    if (match) {
      code = match[1];
      break;
    }
  }
}

console.log(`Verification code: ${code}`);
```

### Шаг 7: Ввод кода верификации

```javascript
await browser({ 
  action: "act", 
  request: { 
    kind: "type", 
    ref: "<ref для Code textbox>",
    text: code 
  } 
});

await browser({ 
  action: "act", 
  request: { kind: "click", ref: "<ref для Continue>" } 
});
await new Promise(r => setTimeout(r, 3000));
```

### Шаг 8: Заполнение профиля

```javascript
// Имя
await browser({ 
  action: "act", 
  request: { 
    kind: "type", 
    ref: "<ref для Full name>",
    text: "Test User" 
  } 
});

// Дата рождения (3 поля: month, day, year)
await browser({ 
  action: "act", 
  request: { kind: "type", ref: "<ref для month>", text: "01" } 
});

await browser({ 
  action: "act", 
  request: { kind: "type", ref: "<ref для day>", text: "01" } 
});

await browser({ 
  action: "act", 
  request: { kind: "type", ref: "<ref для year>", text: "1990" } 
});

await browser({ 
  action: "act", 
  request: { kind: "click", ref: "<ref для Continue>" } 
});
await new Promise(r => setTimeout(r, 3000));
```

### Шаг 9: Пропуск onboarding

```javascript
// "What brings you to ChatGPT?" - Skip
await browser({ 
  action: "act", 
  request: { kind: "click", ref: "<ref для Skip>" } 
});
await new Promise(r => setTimeout(r, 2000));

// "What do you want to do with ChatGPT?" - Skip
await browser({ 
  action: "act", 
  request: { kind: "click", ref: "<ref для Skip>" } 
});
await new Promise(r => setTimeout(r, 2000));
```

### Шаг 10: Готово!

Аккаунт создан и залогинен в ChatGPT.

---

## Полный пример кода

```javascript
const crypto = require('crypto');
const fetch = require('node-fetch');

async function registerChatGPT() {
  const MAIL_URL = process.env.TEMP_MAIL_URL;
  const MAIL_AUTH = Buffer.from(process.env.TEMP_MAIL_AUTH).toString('base64');

  // 1. Генерация email
  const emailResp = await fetch(`${MAIL_URL}/api/generate-email`, {
    headers: { 'Authorization': `Basic ${MAIL_AUTH}` }
  });
  const emailData = await emailResp.json();
  const email = emailData.data.email;
  
  console.log(`Email: ${email}`);
  
  // 2. Генерация пароля
  const password = crypto.randomBytes(20).toString('base64');
  console.log(`Password: ${password}`);
  
  // 3. Браузер automation (см. выше шаги 2-9)
  // ...
  
  // Результат
  return {
    email,
    password,
    success: true
  };
}
```

---

## Проверенные параметры

**Пример успешной регистрации:**
- Email: `<random>@yourdomain.com`
- Password: `<random base64 string>`
- Name: `Test User`
- DOB: `01/01/1990`
- Verification code: received via SMTP (~3 seconds)

**Время выполнения:**
- Генерация email: <1 сек
- Заполнение формы: ~15 сек
- Получение кода: ~3 сек
- Завершение регистрации: ~10 сек
- **Общее время: ~30 секунд**

---

## Требования системы

### SMTP сервер должен поддерживать:
✅ STARTTLS (OpenAI требует TLS)  
✅ Порт 25 (или redirect)  
✅ Валидные SSL сертификаты  
✅ DNS MX записи  

### Ваш сервер:
- Node.js SMTP server (smtp-server npm package)
- Let's Encrypt SSL
- iptables redirect 25→2525
- DNS: MX mail.yourdomain.com → YOUR_SERVER_IP

---

## Возможные проблемы

### 1. SMTP без TLS
**Симптом:** Письмо не приходит, SMTP падает с ошибкой TLS  
**Решение:** Добавить STARTTLS с валидным сертификатом

### 2. DNS не настроен
**Симптом:** OpenAI не может отправить письмо (timeout)  
**Решение:** Настроить MX и A записи

### 3. CAPTCHA
**Симптом:** ChatGPT показывает CAPTCHA  
**Решение:** Ручное решение или использование anti-captcha сервисов

### 4. Rate limiting
**Симптом:** "Too many requests"  
**Решение:** Ждать ~10-15 минут между регистрациями с одного IP

---

## Оптимизация скорости

**Текущее время:** ~30 секунд  
**Можно ускорить до:** ~15-20 секунд

**Как:**
1. Параллельная генерация email + открытие браузера
2. Уменьшить `setTimeout` до минимума (100-500ms)
3. Использовать headless браузер
4. Заполнять поля без задержек
5. Пропускать все опциональные шаги (onboarding)
