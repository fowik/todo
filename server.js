const express = require('express');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const { loadConfig, createAuth } = require('./hosting-auth');
const { chromium } = require('playwright');

const app = express();
const PORT = Number(process.env.PORT || 8000);
const UPCOMING_URL = 'https://estudijas.rtu.lv/calendar/view.php?view=upcoming';
const ORTUS_URL = 'https://ortus.rtu.lv/f/u108l1s329/p/schedulep.u108l1n154322/max/render.uP?pCp';
const PROFILE_DIR = process.env.RTU_PROFILE_DIR || path.join(__dirname, '.rtu-session');
const config = loadConfig();

app.use(express.json({ limit: '1mb' }));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/config.js', (_req, res) => res.type('application/javascript').send(`window.RTU_CONFIG = ${JSON.stringify(config)};`));
const publicFiles = new Set(['/', '/index.html', '/app.js', '/style.css']);
app.use((req, res, next) => {
  if (!publicFiles.has(req.path)) return next();
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, req.path === '/' ? 'index.html' : req.path.slice(1)));
});
app.use('/api', createAuth(config));

const jobs = new Map();
const browserSessions = new Map();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function update(job, patch) { Object.assign(job, patch, { updatedAt: Date.now() }); }

async function updateDiagnostics(job, p) {
  try {
    const currentUrl = p.url();
    const pageTitle = await p.title().catch(() => '');
    update(job, { currentUrl, pageTitle });
  } catch {}
}

async function clickSavedAccountIfPresent(job, p, email) {
  const exact = `[data-test-id="${email}"]`;
  const candidates = [
    exact,
    `[role="button"][data-test-id="${email}"]`,
    `div.table[data-test-id="${email}"]`
  ];
  for (const sel of candidates) {
    try {
      const loc = p.locator(sel).first();
      if (await loc.count() && await loc.isVisible({ timeout: 800 }).catch(() => false)) {
        update(job, { message: `Нашёл сохранённый аккаунт ${email}. Нажимаю…`, stage: 'account_picker' });
        await loc.click({ timeout: 5000 });
        await p.waitForTimeout(1200);
        await updateDiagnostics(job, p);
        return true;
      }
    } catch {}
  }
  return false;
}

async function fillEmailIfPresent(job, p, email) {
  const selectors = ['#i0116', 'input[name="loginfmt"]', 'input[type="email"]'];
  for (const sel of selectors) {
    try {
      const loc = p.locator(sel).first();
      if (await loc.count() && await loc.isVisible({ timeout: 800 }).catch(() => false)) {
        update(job, { message: `Нашёл поле email. Ввожу ${email}…`, stage: 'email' });
        await loc.fill(email, { timeout: 5000 });
        await p.waitForTimeout(300);
        const val = await loc.inputValue().catch(() => '');
        if (!val || val.toLowerCase() != email.toLowerCase()) {
          throw new Error(`Поле email найдено, но значение не установилось. Сейчас в поле: "${val}"`);
        }
        const next = p.locator('#idSIButton9').first();
        if (await next.count() && await next.isVisible({ timeout: 1500 }).catch(() => false)) {
          update(job, { message: 'Email введён. Нажимаю Next…', stage: 'email_next' });
          await next.click({ timeout: 5000 });
        } else {
          await loc.press('Enter').catch(() => {});
        }
        await p.waitForTimeout(1200);
        await updateDiagnostics(job, p);
        return true;
      }
    } catch (e) {
      update(job, { message: `Ошибка на шаге email: ${e.message}`, stage: 'email_error' });
      throw e;
    }
  }
  return false;
}


async function getBrowserPage(ownerId, email) {
  const key = createHash('sha256').update(`${ownerId}:${email.toLowerCase()}`).digest('hex');
  let session = browserSessions.get(key);
  if (!session) {
    const headless = String(process.env.RTU_HEADLESS || 'true').toLowerCase() !== 'false';
    const context = await chromium.launchPersistentContext(path.join(PROFILE_DIR, key), {
      headless,
      slowMo: headless ? 0 : 120,
      viewport: { width: 1280, height: 900 },
      locale: 'en-US',
      args: ['--disable-blink-features=AutomationControlled', '--disable-features=Translate,TranslateUI']
    });
    session = { context, ownerId };
    browserSessions.set(key, session);
    context.on('close', () => { browserSessions.delete(key); });
  }
  return session.context.pages()[0] || await session.context.newPage();
}

async function maybeFillMicrosoftEmail(p, email, job) {
  const url = p.url();
  if (!/login\.microsoftonline\.com|login\.live\.com/i.test(url)) return false;

  // Only fill when the actual Microsoft username textbox exists.
  const input = p.locator('#i0116').first();
  if (await input.count() && await input.isVisible().catch(() => false)) {
    update(job, { stage: 'login', message: `Ввожу ${email}…` });
    await input.fill(email);
    const next = p.locator('#idSIButton9').first();
    if (await next.count() && await next.isVisible().catch(() => false)) {
      await next.click();
    } else {
      await input.press('Enter').catch(() => {});
    }
    update(job, { stage: 'login', message: `Email введён. Продолжаю вход…` });
    return true;
  }

  // Only click a saved account tile that has Microsoft's data-test-id attribute.
  // Do NOT use getByText(email): the MFA page also shows the email in its identity banner.
  const accountTile = p.locator(`[data-test-id="${email}"]`).first();
  if (await accountTile.count() && await accountTile.isVisible().catch(() => false)) {
    await accountTile.click();
    update(job, { stage: 'login', message: 'Выбрал сохранённый RTU аккаунт…' });
    return true;
  }

  return false;
}

async function detectMfaNumber(p) {
  // Search every open page because Microsoft can move the auth UI between pages/tabs.
  const pages = p.context().pages();
  const selectors = [
    '#idRemoteNGC_DisplaySign',
    'div#idRemoteNGC_DisplaySign',
    '.display-sign-container #idRemoteNGC_DisplaySign',
    '.displaySign',
    '[id*="RemoteNGC_DisplaySign"]'
  ];

  for (const page of pages) {
    if (!page || page.isClosed()) continue;
    if (!/^https:\/\/(login\.microsoftonline\.com|login\.live\.com)\//i.test(page.url())) continue;

    for (const selector of selectors) {
      try {
        const el = page.locator(selector).first();
        if (await el.count()) {
          // textContent is used intentionally: Microsoft may render the element before Playwright
          // considers it "visible", but the number is already present in the DOM.
          const text = ((await el.textContent().catch(() => '')) || '').trim();
          const m = text.match(/\b(\d{2,3})\b/);
          if (m) return m[1];
        }
      } catch {}
    }

    // DOM fallback: grab the exact node directly in the page.
    try {
      const raw = await page.evaluate(() => {
        const el = document.getElementById('idRemoteNGC_DisplaySign');
        return el ? (el.textContent || '').trim() : '';
      });
      const m = String(raw || '').match(/\b(\d{2,3})\b/);
      if (m) return m[1];
    } catch {}

    const bodyText = await readPresentText(page, 'body');
    if (!bodyText) continue;

    const normalized = bodyText.replace(/\s+/g, ' ');
    const challengeWords = /approve|authenticator|number|matching|enter the number|type the number|ievad|apstiprin|числ|подтверд|утверждение входа/i;
    if (!challengeWords.test(normalized)) continue;

    const patterns = [
      /(?:number|code|число|kods?)\D{0,30}(\d{2,3})/i,
      /(?:enter|type|ievad\w*|введите)\D{0,40}(\d{2,3})/i,
      /\b(\d{2})\b/
    ];
    for (const re of patterns) {
      const m = normalized.match(re);
      if (m) return m[1];
    }
  }
  return null;
}


async function readPresentText(p, selector) {
  const el = p.locator(selector).first();
  if (!(await el.count())) return '';
  return el.innerText({ timeout: 500 }).catch(() => '');
}

async function detectAuthProblem(p) {
  // Microsoft can render the MFA/error UI on another page in the persistent context.
  // Check every open page so a denied request is detected immediately.
  const pages = p.context().pages();

  for (const page of pages) {
    if (!page || page.isClosed()) continue;
    if (!/^https:\/\/(login\.microsoftonline\.com|login\.live\.com)\//i.test(page.url())) continue;

    const title = ((await readPresentText(page, '#loginHeader')) || '').trim();
    const desc = ((await readPresentText(page, '#idDiv_RemoteNGC_PageDescription')) || '').trim();
    const desc2 = ((await readPresentText(page, '#idDiv_RemoteNGC_PageDescription2')) || '').trim();
    const body = ((await readPresentText(page, 'body')) || '').replace(/\s+/g, ' ').trim();
    const text = [title, desc, desc2, body].filter(Boolean).join(' | ');

    if (/request denied|you denied|запрос отклонен|запрос отклонён|authentication request.*denied|noraid/i.test(text)) {
      return {
        code: 'mfa_denied',
        message: 'Запрос в Microsoft Authenticator был отклонён. Попробуй заново.'
      };
    }

    if (/request timed out|timed out|время.*истек|время.*истекло|истёк|истек срок|session.*expired|срок.*истек/i.test(text)) {
      return {
        code: 'mfa_timeout',
        message: 'Время подтверждения входа истекло. Нажми «Обновить задания» и попробуй ещё раз.'
      };
    }

    if (/too many requests|слишком много запросов|temporarily unavailable|временно недоступ/i.test(text)) {
      return {
        code: 'rate_limited',
        message: 'Microsoft временно ограничил попытки входа. Подожди немного и попробуй снова.'
      };
    }

    if (/account.*locked|учетн.*заблок|аккаунт.*заблок/i.test(text)) {
      return {
        code: 'account_locked',
        message: 'RTU/Microsoft аккаунт заблокирован или требует дополнительной проверки.'
      };
    }

    if (/incorrect|неверн|ошибка входа|sign-in error|we couldn.t sign you in|не удалось войти/i.test(text)) {
      return {
        code: 'login_error',
        message: desc || title || 'Microsoft сообщил об ошибке входа.'
      };
    }
  }

  return null;
}

async function parseUpcoming(p) {
  await p.waitForSelector('.eventlist .event[data-type="event"], .eventlist', { timeout: 20000 });
  return await p.evaluate(() => {
    function absoluteUrl(href) {
      if (!href) return '';
      try { return new URL(href, location.href).href; } catch { return href; }
    }
    return [...document.querySelectorAll('.eventlist .event[data-type="event"]')]
      .map(card => {
        const tsEl = card.querySelector('.date[data-timestamp]');
        const timestamp = Number(tsEl?.dataset.timestamp || 0);
        const courseLink = card.querySelector('a[href*="/course/view.php?id="]');
        const actionLink = card.querySelector('.card-footer a.card-link');
        const titleEl = card.querySelector('h3.name');
        return {
          external_id: card.dataset.eventId || '',
          course_id: card.dataset.courseId || '',
          course_name: (courseLink?.textContent || '').trim(),
          title: (titleEl?.textContent || card.dataset.eventTitle || '').trim(),
          task_url: absoluteUrl(actionLink?.getAttribute('href') || ''),
          due_at: timestamp ? new Date(timestamp * 1000).toISOString() : '',
          component: card.dataset.eventComponent || '',
          event_type: card.dataset.eventEventtype || ''
        };
      })
      .filter(x => x.external_id && x.title && x.due_at);
  });
}

function rigaTimeToIso(day, time) {
  const [year, month, date] = day.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const target = Date.UTC(year, month - 1, date, hour, minute);
  let timestamp = target;
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Riga',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(timestamp).map(p => [p.type, p.value]));
    const shown = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    timestamp += target - shown;
  }
  return new Date(timestamp).toISOString();
}

async function parseOrtus(p, month) {
  await p.locator('#calendar .fc-listMonth-button').click({ timeout: 20000 });
  const months = ['janvāris', 'februāris', 'marts', 'aprīlis', 'maijs', 'jūnijs', 'jūlijs', 'augusts', 'septembris', 'oktobris', 'novembris', 'decembris'];
  const [year, monthNumber] = month.split('-').map(Number);
  const wanted = year * 12 + monthNumber - 1;
  let ready = false;
  for (let step = 0; step < 25; step++) {
    const title = await p.locator('#calendar .fc-toolbar-title').innerText({ timeout: 5000 });
    const currentYear = Number(title.match(/\d{4}/)?.[0]);
    const currentMonth = months.findIndex(name => title.toLowerCase().includes(name));
    if (!currentYear || currentMonth < 0) throw new Error('Не удалось определить месяц календаря ORTUS.');
    const current = currentYear * 12 + currentMonth;
    if (current === wanted) { ready = true; break; }
    const direction = current < wanted ? 'next' : 'prev';
    await p.locator(`#calendar .fc-${direction}-button`).click();
    await p.waitForFunction(previous => document.querySelector('#calendar .fc-toolbar-title')?.textContent !== previous, title);
  }
  if (!ready) throw new Error('Выбранный месяц слишком далеко от текущего календаря.');
  await p.waitForSelector('#calendar .fc-list-table, #calendar .fc-list-empty', { timeout: 20000 });
  // FullCalendar creates its table before the asynchronous events arrive.
  await p.waitForSelector('#calendar .fc-list-event', { timeout: 15000 }).catch(async error => {
    if (!(await p.locator('#calendar .fc-list-empty').count())) throw error;
  });
  const rows = await p.evaluate(() => {
    let day = '';
    const rows = [];
    for (const row of document.querySelectorAll('#calendar tr')) {
      if (row.dataset.date) day = row.dataset.date;
      if (!row.classList.contains('fc-list-event')) continue;
      const time = row.querySelector('.fc-list-event-time')?.textContent || '';
      const match = time.match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
      const titleElement = row.querySelector('.fc-list-event-title')?.cloneNode(true);
      titleElement?.querySelectorAll('.fc-event-description').forEach(element => element.remove());
      const title = titleElement?.textContent?.trim() || '';
      const description = row.querySelector('.fc-event-description')?.textContent?.trim() || '';
      if (!day || !match || !title) throw new Error(`Не удалось прочитать занятие ORTUS: дата «${day}», время «${time.trim()}», название «${title}».`);
      rows.push({ day, start: match[1], end: match[2], title, description });
    }
    return rows;
  });
  return rows.map(row => ({
    external_id: `ortus-${row.day}-${row.start}-${row.title}`,
    title: row.title, description: row.description,
    location: '', starts_at: rigaTimeToIso(row.day, row.start), ends_at: rigaTimeToIso(row.day, row.end)
  }));
}

async function runSync(job, email) {
  let p;
  try {
    const ortus = job.source === 'ortus';
    const targetUrl = ortus ? ORTUS_URL : UPCOMING_URL;
    update(job, { stage: 'opening', message: ortus ? 'Открываю расписание ORTUS…' : 'Открываю e-studijas…', mfaNumber: null });
    p = await getBrowserPage(job.ownerId, email);
    await p.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const deadline = Date.now() + 90000;
    let emailAttempted = false;

    while (Date.now() < deadline) {
      await updateDiagnostics(job, p);
      const url = p.url();

      if (ortus && new URL(url).origin === 'https://ortus.rtu.lv') {
        if (await p.locator('#semesterAll').count()) {
          update(job, { stage: 'parsing', message: 'Вход выполнен. Читаю расписание ORTUS…', mfaNumber: null });
          const events = await parseOrtus(p, job.month);
          update(job, { stage: 'done', message: `ORTUS: найдено ${events.length} занятий.`, done: true, events, mfaNumber: null });
          return;
        }
        if (await p.locator('a[href="/Logout"]').count()) {
          await p.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
          continue;
        }
        const login = p.locator('button#login');
        if (await login.isVisible().catch(() => false)) { await login.click(); await sleep(700); continue; }
      }

      const rtuUrl = new URL(url);
      const onCalendar = rtuUrl.origin === 'https://estudijas.rtu.lv' && rtuUrl.pathname === '/calendar/view.php';
      const signedIn = rtuUrl.origin === 'https://estudijas.rtu.lv' &&
        await p.locator('a[href*="/login/logout.php"], [data-region="user-menu"]').count() > 0;
      if (!ortus && (onCalendar || signedIn)) {
        if (!onCalendar || rtuUrl.searchParams.get('view') !== 'upcoming') {
          update(job, { stage: 'calendar', message: 'Вход выполнен. Открываю календарь…', mfaNumber: null });
          await p.goto(UPCOMING_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await updateDiagnostics(job, p);
          if (!p.url().startsWith('https://estudijas.rtu.lv/calendar/view.php')) continue;
        }
        update(job, { stage: 'parsing', message: 'Вход выполнен. Читаю Gaidāmie notikumi…', mfaNumber: null });
        const tasks = await parseUpcoming(p);
        update(job, {
          stage: 'done',
          message: `Готово: найдено ${tasks.length} событий.`,
          done: true,
          tasks
        });
        return;
      }

      // Terminal errors take priority over a stale MFA number.
      const authProblemEarly = await detectAuthProblem(p);
      if (authProblemEarly) {
        update(job, {
          stage: 'error',
          errorCode: authProblemEarly.code,
          error: authProblemEarly.message,
          message: authProblemEarly.message,
          done: true,
          mfaNumber: null
        });
        return;
      }

      // Read MFA before interacting with account/email controls.
      // Microsoft keeps the user's email visible on the MFA page, so account/email detection
      // must never run before this check.
      const mfaNumberEarly = await detectMfaNumber(p);
      if (mfaNumberEarly) {
        update(job, {
          stage: 'mfa',
          mfaNumber: mfaNumberEarly,
          message: `Подтверди число ${mfaNumberEarly} в Microsoft Authenticator.`,
          debugMfaSelector: '#idRemoteNGC_DisplaySign',
          debugMfaValue: mfaNumberEarly
        });
        await sleep(700);
        continue;
      }

      if (/login\.microsoftonline\.com|login\.live\.com/i.test(url)) {
        const clicked = await clickSavedAccountIfPresent(job, p, email).catch(() => false);
        if (clicked) {
          emailAttempted = true;
          await sleep(900);
          continue;
        }

        const filled = await fillEmailIfPresent(job, p, email);
        if (filled) {
          emailAttempted = true;
          await sleep(900);
          continue;
        }
      }

      if (job.stage === 'mfa') {
        update(job, { stage: 'waiting', message: 'Код исчез со страницы. Жду результат подтверждения…', mfaNumber: null });
      } else {
        const elapsed = Date.now() - job.createdAt;
        const hint = elapsed > 45000
          ? 'Microsoft ещё не показал номер. Если на телефоне уже есть запрос, проверь окно Authenticator или отклони запрос и запусти синхронизацию заново.'
          : 'Жду Microsoft/RTU авторизацию…';
        update(job, { stage: 'waiting', message: hint });
      }

      await sleep(1200);
    }
    throw new Error('Вход не был завершён за 90 секунд. Проверь запрос Microsoft Authenticator и повтори синхронизацию.');
  } catch (err) {
    update(job, {
      stage: 'error',
      message: err?.message || String(err),
      error: err?.message || String(err),
      done: true,
      mfaNumber: null
    });
  } finally {
    if (p) await p.context().close().catch(() => {});
  }
}

app.post('/api/rtu/sync', async (req, res) => {
  const email = String(req.body?.email || '').trim();
  if (!/^[^@\s]+@edu\.rtu\.lv$/i.test(email)) {
    return res.status(400).json({ ok: false, error: 'Введи RTU email вида name@edu.rtu.lv' });
  }
  const source = req.body?.source === 'ortus' ? 'ortus' : 'estudijas';
  const month = String(req.body?.month || '');
  if (source === 'ortus' && !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) {
    return res.status(400).json({ ok: false, error: 'Выбери месяц расписания.' });
  }
  const active = [...jobs.values()].filter(job => !job.done);
  if (active.some(job => job.ownerId === req.userId)) return res.status(409).json({ ok: false, error: 'Дождись завершения своей синхронизации RTU.' });
  if (active.length >= Number(process.env.MAX_RTU_JOBS || 1)) return res.status(429).json({ ok: false, error: 'Сервер занят загрузкой RTU. Попробуй через минуту.' });
  for (const [id, previous] of jobs) if (previous.done && Date.now() - previous.updatedAt > 600000) jobs.delete(id);
  const id = randomUUID();
  const job = {
    id,
    ownerId: req.userId,
    source,
    month,
    stage: 'queued',
    message: 'Запускаю синхронизацию…',
    mfaNumber: null,
    done: false,
    error: null,
    tasks: null,
    currentUrl: '',
    pageTitle: '',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  jobs.set(id, job);
  runSync(job, email);
  res.json({ ok: true, jobId: id });
});

app.get('/api/rtu/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.ownerId !== req.userId) return res.status(404).json({ ok: false, error: 'Задача синхронизации не найдена' });
  const { ownerId, ...status } = job;
  res.json({ ok: true, ...status });
  if (job.done && Date.now() - job.updatedAt > 10 * 60 * 1000) jobs.delete(job.id);
});

app.post('/api/rtu/reset-session', async (req, res) => {
  try {
    for (const session of browserSessions.values()) {
      if (session.ownerId === req.userId) await session.context.close();
    }
    res.json({ ok: true, message: 'RTU browser session closed. Delete .rtu-session manually if you need a full reset.' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`RTU Todo v4.8: http://localhost:${PORT}`);
  console.log('RTU browser runs in the background. Set RTU_HEADLESS=false only for debugging.\nRTU session is stored locally in .rtu-session/ and should never be uploaded to hosting.');
});
