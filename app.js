const $ = s => document.querySelector(s);
let filter = 'all';
let tasks = [];
let events = [];
let studyTasks = [];
let currentUser = null;
let db = null;
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calendarSelectedDay = dayKey(new Date());

const cfg = window.RTU_CONFIG || {};
const configured = cfg.SUPABASE_URL && cfg.SUPABASE_KEY && !cfg.SUPABASE_URL.includes('PASTE_') && !cfg.SUPABASE_KEY.includes('PASTE_');

if (configured && window.supabase) {
  db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
} else {
  $('#setupCard').classList.remove('hidden');
  $('#authHint').textContent = 'Сначала заполни config.js.';
  $('#login').disabled = true;
  $('#signup').disabled = true;
}

function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3200);
}

function unfold(s) { return s.replace(/\r?\n[ \t]/g, ''); }
function val(block, key) {
  const m = block.match(new RegExp('^' + key + '(?:;[^:]*)?:(.*)$', 'mi'));
  return m ? m[1].trim() : '';
}
function parseDate(v) {
  if (!v) return null;
  if (/^\d{8}$/.test(v)) return new Date(+v.slice(0,4), +v.slice(4,6)-1, +v.slice(6,8));
  const m = v.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?/);
  if (!m) return null;
  return m[7]
    ? new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +(m[6]||0)))
    : new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +(m[6]||0));
}
function clean(s) { return (s || '').replace(/\\n/g, ' · ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\'); }
function parseICS(text) {
  const blocks = unfold(text).match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  return blocks.map((b, i) => {
    const start = parseDate(val(b, 'DTSTART'));
    const end = parseDate(val(b, 'DTEND'));
    if (!start) return null;
    const uid = val(b, 'UID') || `event-${i}-${start.getTime()}`;
    return {
      external_id: `${uid}-${start.getTime()}`,
      title: clean(val(b, 'SUMMARY') || 'Занятие'),
      starts_at: start.toISOString(),
      ends_at: end ? end.toISOString() : null,
      location: clean(val(b, 'LOCATION')),
      description: clean(val(b, 'DESCRIPTION'))
    };
  }).filter(Boolean);
}
function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
}
function startDay(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

async function loadData(showToast = false) {
  if (!db || !currentUser) return;
  $('#refresh').disabled = true;
  const [tasksRes, eventsRes, studyRes] = await Promise.all([
    db.from('tasks').select('*').order('task_date', {ascending:true}).order('created_at', {ascending:true}),
    db.from('calendar_events').select('*').order('starts_at', {ascending:true}),
    db.from('study_tasks').select('*').order('due_at', {ascending:true})
  ]);
  $('#refresh').disabled = false;
  const err = tasksRes.error || eventsRes.error || studyRes.error;
  if (err) return toast(`Ошибка загрузки: ${err.message}`, true);
  tasks = tasksRes.data || [];
  events = eventsRes.data || [];
  studyTasks = studyRes.data || [];
  render();
  if (showToast) toast('Синхронизировано');
}

function render() {
  renderTaskCalendar();
  const now = new Date();
  const today = startDay(now);
  const limit = new Date(today); limit.setDate(limit.getDate() + 7);

  let items = [
    ...events.map(e => ({...e, type:'pair', date:e.starts_at})),
    ...tasks.map(t => ({...t, type:'task', date:t.task_date + 'T12:00:00'})),
    ...studyTasks.map(s => ({...s, type:'study', date:s.due_at}))
  ];

  items = items.filter(x => {
    const d = startDay(new Date(x.date));
    if (filter === 'today') return d.getTime() === today.getTime();
    if (filter === 'week') return d >= today && d < limit;
    if (filter === 'tasks') return x.type === 'task';
    if (filter === 'estudijas') return x.type === 'study';
    return true;
  }).sort((a,b) => new Date(a.date) - new Date(b.date));

  $('#list').innerHTML = '';
  let last = '';
  for (const x of items) {
    const k = dayKey(x.date);
    if (k !== last) {
      last = k;
      const h = document.createElement('div');
      h.className = 'day';
      h.textContent = new Date(x.date).toLocaleDateString('ru-RU', {weekday:'long', day:'numeric', month:'long'});
      $('#list').append(h);
    }

    const row = document.createElement('div');
    row.className = `item item-${x.type} ${x.done ? 'done' : ''} ${x.priority === 'high' ? 'priority-high' : ''}`;
    let time = 'Задача', meta = '', badge = 'TODO';
    if (x.type === 'pair') {
      time = new Date(x.starts_at).toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'});
      meta = [x.location, x.description].filter(Boolean).join(' · ');
      badge = 'ORTUS';
    } else if (x.type === 'study') {
      time = '';
      const due = new Date(x.due_at);
      meta = Number.isNaN(due.getTime()) ? 'Срок не указан' : `Сдать до ${due.toLocaleDateString('ru-RU', {day:'numeric', month:'long', year:'numeric', timeZone:'Europe/Riga'})}, ${due.toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'Europe/Riga'})} · Рига`;

      badge = 'E-STUDIJAS';
    } else {
      meta = ({high:'Важная задача', low:'Низкий приоритет', normal:'Личная задача'}[x.priority] || 'Личная задача');
      badge = x.priority === 'high' ? 'ВАЖНО' : 'TODO';
    }

    row.innerHTML = `${x.type !== 'pair' ? `<input class="check" type="checkbox" ${x.done?'checked':''}>` : ''}
      <div class="time">${time}</div>
      <div class="info"><div class="course"></div><div class="title"></div><div class="meta"></div><div class="task-actions"></div></div>
      <span class="badge">${badge}</span>
      ${x.type === 'task' ? '<button class="delete" title="Удалить">✕</button>' : ''}`;

    const titleEl = row.querySelector('.title');
    titleEl.textContent = x.title;
    const courseEl = row.querySelector('.course');
    courseEl.textContent = x.type === 'study' ? (x.course_name || 'e-studijas') : '';
    courseEl.hidden = x.type !== 'study';
    if (x.type === 'study' && x.task_url) {
      const a = document.createElement('a');
      a.href = x.task_url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = 'Открыть задание ↗';
      a.className = 'task-link';
      const titleLink = a.cloneNode(false);
      titleLink.textContent = x.title;
      titleEl.textContent = '';
      titleEl.appendChild(titleLink);

    } else {
      titleEl.textContent = x.title;
    }
    row.querySelector('.meta').textContent = meta;

    if (x.type === 'task') {
      row.querySelector('.check').onchange = async e => {
        const checked = e.target.checked;
        const {error} = await db.from('tasks').update({done:checked}).eq('id', x.id);
        if (error) { e.target.checked = !checked; return toast(error.message, true); }
        const t = tasks.find(v => v.id === x.id); if (t) t.done = checked;
        render();
      };
      row.querySelector('.delete').onclick = async () => {
        const {error} = await db.from('tasks').delete().eq('id', x.id);
        if (error) return toast(error.message, true);
        tasks = tasks.filter(t => t.id !== x.id); render();
      };
    }

    if (x.type === 'study') {
      row.querySelector('.check').onchange = async e => {
        const checked = e.target.checked;
        const {error} = await db.from('study_tasks').update({done:checked, updated_at:new Date().toISOString()}).eq('id', x.id);
        if (error) { e.target.checked = !checked; return toast(error.message, true); }
        const t = studyTasks.find(v => v.id === x.id); if (t) t.done = checked;
        render();
      };
    }
    $('#list').append(row);
  }

  $('#empty').style.display = items.length ? 'none' : 'block';
  const allDates = [
    ...events.map(e => new Date(e.starts_at)),
    ...tasks.map(t => new Date(t.task_date + 'T12:00:00')),
    ...studyTasks.map(t => new Date(t.due_at))
  ];
  $('#todayCount').textContent = allDates.filter(d => startDay(d).getTime() === today.getTime()).length;
  $('#weekCount').textContent = allDates.filter(d => d >= today && d < limit).length;
  $('#doneCount').textContent = tasks.filter(t => t.done).length + studyTasks.filter(t => t.done).length;
}

function calendarTasks() {
  return [
    ...events.map(t => ({ ...t, calendarDay: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Riga', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(t.starts_at)), kind: 'Пара · ORTUS', calendarType: 'pair' })),
    ...tasks.map(t => ({ ...t, calendarDay: t.task_date, kind: 'Личная задача', calendarType: 'personal' })),
    ...studyTasks.map(t => ({ ...t, calendarDay: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Riga', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(t.due_at)), kind: t.course_name || 'e-studijas', calendarType: 'study' }))
  ];
}

function renderTaskCalendar() {
  const entries = calendarTasks();
  $('#calendarMonth').textContent = calendarMonth.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  const grid = $('#calendarGrid');
  grid.replaceChildren();
  const first = new Date(calendarMonth);
  first.setDate(1 - ((first.getDay() + 6) % 7));
  for (let i = 0; i < 42; i++) {
    const date = new Date(first);
    date.setDate(first.getDate() + i);
    const key = dayKey(date);
    const dayTasks = entries.filter(t => t.calendarDay === key);
    const button = document.createElement('button');
    button.className = 'calendar-cell';
    button.classList.toggle('other-month', date.getMonth() !== calendarMonth.getMonth());
    button.classList.toggle('today', key === dayKey(new Date()));
    button.classList.toggle('selected', key === calendarSelectedDay);
    button.classList.toggle('has-study', dayTasks.some(t => t.calendarType === 'study' && !t.done));
    button.setAttribute('aria-pressed', String(key === calendarSelectedDay));
    const lessons = dayTasks.filter(t => t.calendarType === 'pair');
    const assignments = dayTasks.filter(t => t.calendarType !== 'pair');
    button.setAttribute('aria-label', `${date.toLocaleDateString('ru-RU')}, задач: ${assignments.length}, пар: ${lessons.length}`);
    const number = document.createElement('strong');
    number.textContent = date.getDate();
    button.append(number);
    if (assignments.length) {
      const count = document.createElement('span');
      count.className = 'calendar-count';
      count.textContent = `${assignments.filter(t => !t.done).length}/${assignments.length}`;
      count.title = 'Невыполненные / все задачи';
      button.append(count);
    }
    if (lessons.length) {
      const count = document.createElement('span');
      count.className = 'calendar-lesson-count';
      count.textContent = `Пары: ${lessons.length}`;
      button.append(count);
    }
    button.onclick = () => { calendarSelectedDay = key; renderTaskCalendar(); };
    grid.append(button);
  }
  $('#calendarDayTitle').textContent = new Date(calendarSelectedDay + 'T12:00:00').toLocaleDateString('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long'
  });
  const detail = $('#calendarDayTasks');
  detail.replaceChildren();
  const selected = entries.filter(t => t.calendarDay === calendarSelectedDay)
    .sort((a, b) => Number(a.done) - Number(b.done) || (a.starts_at || a.due_at || `${a.task_date}T12:00:00`).localeCompare(b.starts_at || b.due_at || `${b.task_date}T12:00:00`));
  if (!selected.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'На этот день пар и задач нет.';
    detail.append(empty);
  }
  for (const task of selected) {
    const row = document.createElement('div');
    row.className = `calendar-task calendar-task-${task.calendarType} ${task.done ? 'done' : ''}`;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = task.kind + (task.due_at ? ` · до ${new Date(task.due_at).toLocaleTimeString('ru-RU', {
      timeZone: 'Europe/Riga', hour: '2-digit', minute: '2-digit', hour12: false
    })} (Рига)` : '') + (task.done ? ' · выполнено' : '');
    if (task.calendarType === 'pair') {
      const time = value => new Date(value).toLocaleTimeString('ru-RU', {
        timeZone: 'Europe/Riga', hour: '2-digit', minute: '2-digit', hour12: false
      });
      meta.textContent = `${task.kind} · ${time(task.starts_at)}${task.ends_at ? `–${time(task.ends_at)}` : ''} (Рига)${task.location ? ` · ${task.location}` : ''}`;
    }
    const title = document.createElement(task.task_url ? 'a' : 'div');
    title.className = 'title';
    title.textContent = task.title;
    if (task.task_url) { title.href = task.task_url; title.target = '_blank'; title.rel = 'noopener noreferrer'; }
    row.append(meta, title);
    detail.append(row);
  }
}

function setTaskView(calendar) {
  $('#taskCalendar').classList.toggle('hidden', !calendar);
  $('#listFilters').classList.toggle('hidden', calendar);
  $('#list').classList.toggle('hidden', calendar);
  $('#empty').classList.toggle('hidden', calendar);
  for (const [id, active] of [['listTab', !calendar], ['calendarTab', calendar]]) {
    $( '#' + id).classList.toggle('active', active);
    $( '#' + id).setAttribute('aria-pressed', String(active));
  }
  if (calendar) renderTaskCalendar();
}
$('#listTab').onclick = () => setTaskView(false);
$('#calendarTab').onclick = () => setTaskView(true);
$('#calendarPrev').onclick = () => { calendarMonth.setMonth(calendarMonth.getMonth() - 1); renderTaskCalendar(); };
$('#calendarNext').onclick = () => { calendarMonth.setMonth(calendarMonth.getMonth() + 1); renderTaskCalendar(); };
$('#calendarToday').onclick = () => {
  calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  calendarSelectedDay = dayKey(new Date());
  renderTaskCalendar();
};

async function setSession(user) {
  currentUser = user || null;
  $('#authCard').classList.toggle('hidden', !!currentUser);
  $('#mainContent').classList.toggle('hidden', !currentUser);
  if (!currentUser) { tasks=[]; events=[]; studyTasks=[]; return; }
  $('#accountEmail').textContent = currentUser.email || 'Аккаунт';
  await loadData();
}

async function signIn() {
  const email = $('#email').value.trim();
  const password = $('#password').value;
  if (!email || !password) return toast('Введи email и пароль', true);
  const {error} = await db.auth.signInWithPassword({email,password});
  if (error) toast(error.message, true);
}
async function signUp() {
  const email = $('#email').value.trim();
  const password = $('#password').value;
  if (!email || password.length < 6) return toast('Введи email и пароль минимум из 6 символов', true);
  const {data,error} = await db.auth.signUp({email,password});
  if (error) return toast(error.message, true);
  toast(data.session ? 'Аккаунт создан' : 'Проверь почту и подтверди регистрацию');
}

$('#login').onclick = signIn;
$('#signup').onclick = signUp;
$('#password').addEventListener('keydown', e => { if (e.key === 'Enter' && db) signIn(); });
$('#logout').onclick = async () => { if (db) await db.auth.signOut(); };
$('#refresh').onclick = () => loadData(true);

function setRtuSyncUi(state, message = '', mfaNumber = null, source = 'estudijas') {
  const ortus = source === 'ortus';
  const badge = $(ortus ? '#ortusStatusBadge' : '#rtuStatusBadge');
  const progress = $(ortus ? '#ortusProgress' : '#rtuProgress');
  const progressText = $(ortus ? '#ortusProgressText' : '#rtuProgressText');
  const mfaBox = $(ortus ? '#ortusMfaBox' : '#mfaBox');
  const mfa = $(ortus ? '#ortusMfaNumber' : '#mfaNumber');

  badge.className = `rtu-status ${state}`;
  const labels = {
    idle: 'Не запущено',
    working: 'Подключение…',
    mfa: 'Нужно подтверждение',
    success: 'Обновлено',
    error: 'Ошибка'
  };
  badge.textContent = labels[state] || state;
  progress.classList.toggle('hidden', state === 'idle');
  progressText.textContent = message || '';
  const showMfa = !!mfaNumber;
  if (showMfa) badge.closest('details').open = true;
  mfaBox.classList.toggle('hidden', !showMfa);
  mfa.textContent = showMfa ? mfaNumber : '';
}

async function saveEstudijasTasks(incoming) {
  if (!currentUser) throw new Error('Сначала войди в RTU Todo');
  if (!Array.isArray(incoming) || !incoming.length) return 0;

  const existingDone = new Map(studyTasks.map(t => [t.external_id, !!t.done]));
  const rows = incoming.map(t => ({
    user_id: currentUser.id,
    external_id: String(t.external_id),
    course_id: String(t.course_id || ''),
    course_name: String(t.course_name || ''),
    title: String(t.title || 'Без названия').slice(0,1000),
    task_url: String(t.task_url || ''),
    due_at: t.due_at,
    component: String(t.component || ''),
    event_type: String(t.event_type || ''),
    done: existingDone.get(String(t.external_id)) || false,
    updated_at: new Date().toISOString()
  }));

  const {error} = await db.from('study_tasks').upsert(rows, {onConflict:'user_id,external_id'});
  if (error) throw new Error(`Ошибка сохранения: ${error.message}`);
  await loadData();
  return rows.length;
}

async function rtuFetch(url, options = {}) {
  const { data, error } = await db.auth.getSession();
  if (error || !data.session) throw new Error('Сначала войди в RTU Todo');
  return fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${data.session.access_token}` } });
}

async function pollRtuJob(jobId, source = 'estudijas') {
  const deadline = Date.now() + 190000;
  while (Date.now() < deadline) {
    const response = await rtuFetch(`/api/rtu/status/${encodeURIComponent(jobId)}`);
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Не удалось получить статус синхронизации');

    if (data.stage === 'mfa' && data.mfaNumber) {
      setRtuSyncUi('mfa', data.message, data.mfaNumber, source);
    } else if (data.stage === 'error') {
      const msg = data.error || data.message || 'Ошибка RTU авторизации';
      setRtuSyncUi('error', msg, null, source);
      $('#updateEstudijas').disabled = false;
      throw new Error(msg);
    } else if (data.done) {
      const count = source === 'ortus' ? await saveTimetableRows(data.events || []) : await saveEstudijasTasks(data.tasks || []);
      setRtuSyncUi('success', `Готово. Получено событий: ${count}`, null, source);
      if (source === 'ortus') $('#ortusStatus').textContent = `Расписание загружено: ${count} занятий.`;
      toast(`${source === 'ortus' ? 'ORTUS' : 'e-studijas'}: ${count} событий`);
      return;
    } else {
      setRtuSyncUi('working', data.message || 'Подключаюсь к RTU…', null, source);
    }
    await new Promise(r => setTimeout(r, 1200));
  }
  throw new Error('Синхронизация заняла слишком много времени');
}

$('#updateEstudijas').onclick = async () => {
  const email = $('#rtuEmail').value.trim();
  if (!currentUser) return toast('Сначала войди в RTU Todo', true);
  if (!/^[^@\s]+@edu\.rtu\.lv$/i.test(email)) return toast('Введи RTU email вида name@edu.rtu.lv', true);

  localStorage.setItem('rtuEmail', email);
  $('#updateEstudijas').disabled = true;
  setRtuSyncUi('working', 'Подключаюсь к RTU…');
  try {
    const response = await rtuFetch('/api/rtu/sync', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({email})
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Не удалось запустить синхронизацию');
    await pollRtuJob(data.jobId);
  } catch (e) {
    setRtuSyncUi('error', e.message || String(e));
    toast(e.message || String(e), true);
  } finally {
    $('#updateEstudijas').disabled = false;
  }
};

const savedRtuEmail = localStorage.getItem('rtuEmail');
if (savedRtuEmail) $('#rtuEmail').value = savedRtuEmail;

async function saveTimetable(text) {
  if (!currentUser) throw new Error('Сначала войди в RTU Todo');
  if (/^RRULE[;:]/mi.test(unfold(text))) throw new Error('Этот календарь содержит повторяющиеся занятия. Для него нужно подключить обработку повторений; пришли пример экспорта, чтобы импортировать все пары правильно.');
  const parsed = parseICS(text);
  if (!parsed.length) throw new Error('В календаре не найдено занятий');
  return saveTimetableRows(parsed);
}

async function saveTimetableRows(parsed) {
  if (!currentUser) throw new Error('Сначала войди в RTU Todo');
  if (!parsed.length) return 0;
  const rows = parsed.map(x => ({ ...x, user_id: currentUser.id }));
  const { error } = await db.from('calendar_events').upsert(rows, { onConflict: 'user_id,external_id' });
  if (error) throw new Error(`Импорт не удался: ${error.message}`);
  await loadData();
  return rows.length;
}

$('#updateOrtus').onclick = async () => {
  if (!currentUser) return toast('Сначала войди в RTU Todo', true);
  const email = $('#ortusEmail').value.trim();
  const month = $('#ortusMonth').value;
  if (!/^[^@\s]+@edu\.rtu\.lv$/i.test(email)) return toast('Введи RTU email вида name@edu.rtu.lv', true);
  if (!month) return toast('Выбери месяц расписания', true);
  $('#updateOrtus').disabled = true;
  $('#updateEstudijas').disabled = true;
  localStorage.setItem('ortusEmail', email);
  setRtuSyncUi('working', 'Открываю ORTUS…', null, 'ortus');
  $('#ortusStatus').textContent = 'Загружаю расписание…';
  try {
    const response = await rtuFetch('/api/rtu/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, month, source: 'ortus' })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Не удалось загрузить расписание');
    await pollRtuJob(data.jobId, 'ortus');
  } catch (error) {
    $('#ortusStatus').textContent = error.message;
    setRtuSyncUi('error', error.message, null, 'ortus');
    toast(error.message, true);
  } finally { $('#updateOrtus').disabled = false; $('#updateEstudijas').disabled = false; }
};
$('#ortusMonth').value = dayKey(new Date()).slice(0, 7);
let ortusPickerYear = new Date().getFullYear();
function renderOrtusMonthPicker() {
  const selected = $('#ortusMonth').value;
  const date = new Date(selected + '-01T12:00:00');
  $('#ortusMonthLabel').textContent = date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '');
  $('#ortusPickerYear').textContent = ortusPickerYear;
  $('#ortusYearPrev').disabled = ortusPickerYear <= 2000;
  $('#ortusYearNext').disabled = ortusPickerYear >= 2099;
  const grid = $('#ortusMonthGrid');
  grid.replaceChildren();
  for (let month = 0; month < 12; month++) {
    const value = `${ortusPickerYear}-${String(month + 1).padStart(2, '0')}`;
    const button = document.createElement('button');
    button.textContent = new Date(2026, month, 1).toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '');
    button.className = 'month-option';
    button.classList.toggle('selected', value === selected);
    button.setAttribute('aria-pressed', String(value === selected));
    button.onclick = () => {
      $('#ortusMonth').value = value;
      renderOrtusMonthPicker();
      closeOrtusMonthPicker();
    };
    grid.append(button);
  }
}
function closeOrtusMonthPicker() {
  $('#ortusMonthPopup').classList.add('hidden');
  $('#ortusMonthToggle').setAttribute('aria-expanded', 'false');
  $('#ortusMonthToggle').focus();
}
$('#ortusMonthToggle').onclick = () => {
  const open = $('#ortusMonthPopup').classList.contains('hidden');
  if (!open) return closeOrtusMonthPicker();
  ortusPickerYear = Number($('#ortusMonth').value.slice(0, 4));
  renderOrtusMonthPicker();
  $('#ortusMonthPopup').classList.remove('hidden');
  $('#ortusMonthToggle').setAttribute('aria-expanded', 'true');
  $('#ortusMonthGrid .selected').focus();
};
$('#ortusYearPrev').onclick = () => { ortusPickerYear--; renderOrtusMonthPicker(); };
$('#ortusYearNext').onclick = () => { ortusPickerYear++; renderOrtusMonthPicker(); };
$('#ortusCurrentMonth').onclick = () => {
  $('#ortusMonth').value = dayKey(new Date()).slice(0, 7);
  ortusPickerYear = new Date().getFullYear();
  renderOrtusMonthPicker();
  closeOrtusMonthPicker();
};
document.addEventListener('click', event => {
  if (!$('#ortusMonthPicker').contains(event.target)) {
    $('#ortusMonthPopup').classList.add('hidden');
    $('#ortusMonthToggle').setAttribute('aria-expanded', 'false');
  }
});
$('#ortusMonthPicker').addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); closeOrtusMonthPicker(); }
});
renderOrtusMonthPicker();
$('#ortusEmail').value = localStorage.getItem('ortusEmail') || savedRtuEmail || '';

$('#ics').onchange = async e => {
  const f = e.target.files[0];
  if (!f || !currentUser) return;
  try { toast(`Импортировано занятий: ${await saveTimetable(await f.text())}`); }
  catch (error) { toast(error.message, true); }
  finally { e.target.value = ''; }
};

$('#addTask').onclick = async () => {
  const title = $('#taskText').value.trim();
  const task_date = $('#taskDate').value;
  const priority = $('#taskPriority').value;
  if (!title || !task_date) return toast('Введи задачу и дату', true);
  const {data,error} = await db.from('tasks').insert({user_id:currentUser.id,title,task_date,priority}).select().single();
  if (error) return toast(error.message,true);
  tasks.push(data); $('#taskText').value=''; render();
};
$('#taskText').addEventListener('keydown', e => { if (e.key === 'Enter' && currentUser) $('#addTask').click(); });

$('#clearCalendar').onclick = async () => {
  if (!confirm('Удалить все импортированные пары из этого аккаунта?')) return;
  const {error} = await db.from('calendar_events').delete().eq('user_id', currentUser.id);
  if (error) return toast(error.message,true);
  events=[]; render(); toast('Календарь очищен');
};

document.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => {
  filter = b.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('active', x === b));
  render();
});
$('#theme').onclick = () => {
  document.documentElement.classList.toggle('dark');
  localStorage.setItem('dark', document.documentElement.classList.contains('dark') ? '1':'0');
};
if (localStorage.getItem('dark') === '1') document.documentElement.classList.add('dark');
$('#taskDate').value = dayKey(new Date());

if (db) {
  db.auth.getSession().then(({data}) => setSession(data.session?.user || null));
  db.auth.onAuthStateChange((_event, session) => setSession(session?.user || null));
}
