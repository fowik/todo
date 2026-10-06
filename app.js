const $ = s => document.querySelector(s);
let filter = 'today';
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
function personalDate(task) { return `${task.task_date}T${task.task_time || '23:59:00'}`; }
function lessonEnded(event) { return Boolean(event.ends_at && new Date(event.ends_at).getTime() <= Date.now()); }
const priorityLabels = { high: 'Важная', normal: 'Обычная', low: 'Без спешки' };

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
    ...tasks.map(t => ({...t, type:'task', date:personalDate(t)})),
    ...studyTasks.map(s => ({...s, type:'study', date:s.due_at}))
  ];

  items = items.filter(x => {
    const d = startDay(new Date(x.date));
    if (filter === 'today') return x.type === 'pair' ? d.getTime() === today.getTime() : d <= today;
    if (filter === 'week') return d >= today && d < limit;
    if (filter === 'tasks') return x.type === 'task' || (x.type === 'pair' && d.getTime() === today.getTime());
    if (filter === 'estudijas') return x.type === 'study' || (x.type === 'pair' && d.getTime() === today.getTime());
    return true;
  }).sort((a,b) => new Date(a.date) - new Date(b.date));

  $('#list').innerHTML = '';
  const schedule = document.createElement('section');
  const assignments = document.createElement('section');
  const completed = document.createElement('details');
  schedule.className = assignments.className = 'agenda-section';
  completed.className = 'completed-tasks';
  const heading = (section, text) => { const h = document.createElement('h2'); h.className = 'agenda-heading'; h.textContent = text; section.append(h); };
  heading(schedule, ['today','tasks','estudijas'].includes(filter) ? 'Расписание сегодня' : filter === 'week' ? 'Расписание · 7 дней' : 'Расписание');
  heading(assignments, filter === 'today' ? 'Задачи · сегодня и раньше' : filter === 'estudijas' ? 'Задания e-studijas' : filter === 'tasks' ? 'Личные задачи' : 'Задачи');
  $('#list').append(schedule, assignments);
  if (filter === 'today') {
    items.sort((a,b) => Number(Boolean(a.done)) - Number(Boolean(b.done)) || new Date(a.date) - new Date(b.date) || ({high:0,normal:1,low:2}[a.priority] ?? 1) - ({high:0,normal:1,low:2}[b.priority] ?? 1));
  }
  const doneItems = items.filter(x => x.type !== 'pair' && x.done);
  const summary = document.createElement('summary');
  summary.textContent = `Выполнено · ${doneItems.length}`;
  completed.append(summary);
  const lastDays = { pair: '', assignment: '' };
  for (const x of items) {
    const k = dayKey(x.date);
    const group = x.type === 'pair' ? 'pair' : 'assignment';
    if (filter !== 'today' && !x.done && k !== lastDays[group]) {
      lastDays[group] = k;
      const h = document.createElement('div');
      h.className = 'day';
      h.textContent = new Date(x.date).toLocaleDateString('ru-RU', {weekday:'long', day:'numeric', month:'long'});
      (x.type === 'pair' ? schedule : assignments).append(h);
    }

    const row = document.createElement('div');
    row.className = `item item-${x.type} ${x.done ? 'done' : ''} ${x.type === 'task' ? `priority-${x.priority || 'normal'}` : ''} ${x.type === 'pair' && lessonEnded(x) ? 'elapsed' : ''}`;
    let time = 'Задача', meta = '', badge = 'TODO';
    if (x.type === 'pair') {
      const clock = value => new Date(value).toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit', timeZone:'Europe/Riga'});
      time = clock(x.starts_at) + (x.ends_at ? `–${clock(x.ends_at)}` : '');
      meta = [x.location, x.description].filter(Boolean).join(' · ');
      badge = 'ORTUS';
    } else if (x.type === 'study') {
      time = '';
      const due = new Date(x.due_at);
      meta = Number.isNaN(due.getTime()) ? 'Срок не указан' : `Сдать до ${due.toLocaleDateString('ru-RU', {day:'numeric', month:'long', year:'numeric', timeZone:'Europe/Riga'})}, ${due.toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'Europe/Riga'})} · Рига`;

      badge = 'E-STUDIJAS';
    } else {
      time = x.task_time ? x.task_time.slice(0, 5) : 'Без времени';
      meta = 'Личная задача';
      badge = priorityLabels[x.priority] || priorityLabels.normal;
    }

    row.innerHTML = `${x.type !== 'pair' ? `<input class="check" type="checkbox" ${x.done?'checked':''}>` : ''}
      <div class="time">${time}</div>
      <div class="info"><div class="course"></div><div class="title"></div><div class="meta"></div><div class="task-actions"></div></div>
      <span class="badge">${badge}</span>
      ${x.type === 'task' ? '<button class="delete" title="Удалить">✕</button>' : ''}`;

    const titleEl = row.querySelector('.title');
    if (x.type === 'pair' && x.ends_at && new Date(x.starts_at) <= now && new Date(x.ends_at) > now) row.classList.add('in-progress');
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
      titleEl.textContent = x.type === 'pair' && x.location ? x.title.replace(/\s*\([^()]*\)\s*$/, '') : x.title;
    }
    row.querySelector('.meta').textContent = meta;
    if (filter === 'today' && x.type !== 'pair' && !x.done && startDay(new Date(x.date)) < today) {
      row.classList.add('overdue');
      row.querySelector('.meta').textContent += ` · Просрочено: ${new Date(x.date).toLocaleDateString('ru-RU', {day:'numeric', month:'short'})}`;
    }

    if (x.type === 'task') {
      const edit = document.createElement('button');
      edit.type = 'button'; edit.className = 'task-edit-title'; edit.textContent = x.title;
      edit.title = 'Изменить задачу'; edit.onclick = () => openTaskEditor(x);
      titleEl.replaceChildren(edit);
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
    if (x.done && x.type !== 'pair') completed.append(row);
    else (x.type === 'pair' ? schedule : assignments).append(row);
  }
  {
    for (const [section, text] of [[schedule,'В этом периоде пар нет.'],[assignments,'Невыполненных задач в этом фильтре нет.']]) {
      if (section.children.length === 1) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = text; section.append(p); }
    }
  }
  if (doneItems.length) assignments.append(completed);

  $('#empty').style.display = 'none';
  const todayLessons = events.filter(event => startDay(new Date(event.starts_at)).getTime() === today.getTime());
  const pendingTasks = [
    ...tasks.map(task => ({...task,date:personalDate(task)})),
    ...studyTasks.map(task => ({...task,date:task.due_at}))
  ].filter(task => !task.done && startDay(new Date(task.date)) <= today);
  const overdueCount = pendingTasks.filter(task => startDay(new Date(task.date)) < today).length;
  $('#todayCount').textContent = todayLessons.length;
  $('#todayCountHint').textContent = `Осталось: ${todayLessons.filter(event => !lessonEnded(event)).length} · по расписанию ORTUS`;
  $('#weekCount').textContent = pendingTasks.length;
  $('#weekCountHint').textContent = `Сегодня: ${pendingTasks.length - overdueCount} · просрочено: ${overdueCount}`;
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
    .sort((a, b) => Number(a.done) - Number(b.done) || new Date(a.starts_at || a.due_at || personalDate(a)) - new Date(b.starts_at || b.due_at || personalDate(b)));
  if (!selected.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'На этот день пар и задач нет.';
    detail.append(empty);
  }
  for (const task of selected) {
    const row = document.createElement('div');
    row.className = `calendar-task calendar-task-${task.calendarType} ${task.done ? 'done' : ''} ${task.calendarType === 'personal' ? `priority-${task.priority || 'normal'}` : ''} ${task.calendarType === 'pair' && lessonEnded(task) ? 'elapsed' : ''}`;
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
    if (task.calendarType === 'personal') meta.textContent += ` · ${task.task_time ? task.task_time.slice(0, 5) : 'Без времени'} · ${priorityLabels[task.priority] || priorityLabels.normal}`;
    const title = document.createElement(task.task_url ? 'a' : 'div');
    title.className = 'title';
    title.textContent = task.title;
    if (task.calendarType === 'personal') {
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'task-edit-title'; edit.textContent = task.title;
      edit.onclick = () => openTaskEditor(task); title.replaceChildren(edit);
    }
    if (task.task_url) { title.href = task.task_url; title.target = '_blank'; title.rel = 'noopener noreferrer'; }
    const content = document.createElement('div');
    content.className = 'calendar-task-content';
    content.append(meta, title);
    if (task.calendarType !== 'pair') {
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'check';
      check.checked = Boolean(task.done);
      check.setAttribute('aria-label', `Выполнено: ${task.title}`);
      check.onchange = async () => {
        const checked = check.checked;
        check.disabled = true;
        try {
          const table = task.calendarType === 'study' ? 'study_tasks' : 'tasks';
          const {error} = await db.from(table).update({done:checked}).eq('id', task.id);
          if (error) throw error;
          const original = (task.calendarType === 'study' ? studyTasks : tasks).find(item => item.id === task.id);
          if (original) original.done = checked;
          render();
        } catch (error) {
          check.checked = !checked;
          check.disabled = false;
          toast(error.message || 'Не удалось сохранить выполнение задачи', true);
        }
      };
      row.append(check);
    }
    row.append(content);
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
let editingTaskId = null;
function openTaskEditor(task) {
  editingTaskId = task.id;
  $('#editTaskTitle').value = task.title;
  $('#editTaskDate').value = task.task_date;
  $('#editTaskTime').value = (task.task_time || '').slice(0,5);
  $('#editTaskPriority').value = task.priority || 'normal';
  $('#editTaskPriority').refreshPicker();
  $('#editTaskDate').refreshPicker();
  $('#editTaskTime').refreshPicker();
  $('#editTaskDialog').showModal();
}
$('#editTaskClose').onclick = () => $('#editTaskDialog').close();
$('#editTaskForm').onsubmit = async event => {
  event.preventDefault();
  const changes = {title:$('#editTaskTitle').value.trim(),task_date:$('#editTaskDate').value,task_time:$('#editTaskTime').value || null,priority:$('#editTaskPriority').value};
  if (!changes.title) return;
  $('#editTaskSave').disabled = true;
  try {
    const {error} = await db.from('tasks').update(changes).eq('id', editingTaskId);
    if (error) throw error;
    const task = tasks.find(item => item.id === editingTaskId);
    if (task) Object.assign(task, changes);
    $('#editTaskDialog').close(); render(); toast('Задача обновлена');
  } catch(error) { toast(error.message, true); }
  finally { $('#editTaskSave').disabled = false; }
};
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
  const task_time = $('#taskTime').value || null;
  if (!title || !task_date) return toast('Введи задачу и дату', true);
  const {data,error} = await db.from('tasks').insert({user_id:currentUser.id,title,task_date,task_time,priority}).select().single();
  if (error && /task_time/i.test(error.message)) return toast('Для сохранения времени выполни миграцию tasks-time.sql в Supabase.', true);
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
function applyConnectionSettings() {
  $('.rtu-connect').classList.toggle('hidden', !$('#showRtu').checked);
  $('.ortus-connect').classList.toggle('hidden', !$('#showOrtus').checked);
  $('.toolbar .upload').classList.toggle('hidden', !$('#showOrtus').checked);
  $('#clearCalendar').classList.toggle('hidden', !$('#showOrtus').checked);
}
for (const [id, key] of [['showRtu', 'show-rtu'], ['showOrtus', 'show-ortus']]) {
  $("#" + id).checked = localStorage.getItem(key) !== '0';
  $("#" + id).onchange = event => { localStorage.setItem(key, event.target.checked ? '1' : '0'); applyConnectionSettings(); };
}
function toggleSettings(open) {
  const panel = $('#settingsPanel');
  if (open && !panel.open) panel.showModal();
  if (!open && panel.open) panel.close();
  $('#settingsToggle').setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('settings-open', open);
}
$('#settingsToggle').onclick = () => toggleSettings(!$('#settingsPanel').open);
$('#settingsClose').onclick = () => toggleSettings(false);
$('#settingsPanel').addEventListener('close', () => {
  $('#settingsToggle').setAttribute('aria-expanded', 'false');
  document.body.classList.remove('settings-open');
});
$('#settingsPanel').addEventListener('click', event => {
  if (event.target !== $('#settingsPanel')) return;
  const rect = event.target.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) toggleSettings(false);
});
applyConnectionSettings();
setInterval(() => { if (currentUser) render(); }, 30000);
$('#taskDate').value = dayKey(new Date());

function attachTaskPicker(id, mode) {
  const input = $('#' + id);
  input.type = 'hidden';
  const wrapper = document.createElement('div'); wrapper.className = 'task-picker';
  input.before(wrapper); wrapper.append(input);
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'month-toggle';
  toggle.setAttribute('aria-label', mode === 'date' ? 'Выбрать дату задачи' : 'Выбрать время задачи');
  toggle.setAttribute('aria-expanded', 'false');
  const popup = document.createElement('div'); popup.className = 'month-popup task-picker-popup hidden';
  popup.setAttribute('role','group'); popup.setAttribute('aria-label',mode === 'date' ? 'Дата задачи' : 'Время задачи');
  wrapper.append(toggle,popup);
  let month;
  function close(){ popup.classList.add('hidden'); toggle.setAttribute('aria-expanded','false'); }
  function update(){
    toggle.textContent = (mode === 'date' ? '▦  ' : '◷  ') + (input.value ? mode === 'date' ? new Date(input.value+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric'}) : input.value.slice(0,5) : 'Без времени');
  }
  function pick(value){ input.value=value; update(); close(); toggle.focus(); }
  function button(text,action,cls='month-option'){
    const b=document.createElement('button'); b.type='button'; b.className=cls; b.textContent=text; b.onclick=action; return b;
  }
  function drawDate(){
    popup.replaceChildren();
    const head=document.createElement('div'); head.className='month-year-row';
    const label=document.createElement('strong'); label.textContent=month.toLocaleDateString('ru-RU',{month:'long',year:'numeric'});
    const prev=button('‹',()=>{month.setMonth(month.getMonth()-1);drawDate()},'month-year-arrow'); prev.setAttribute('aria-label','Предыдущий месяц');
    const next=button('›',()=>{month.setMonth(month.getMonth()+1);drawDate()},'month-year-arrow'); next.setAttribute('aria-label','Следующий месяц');
    head.append(prev,label,next); popup.append(head);
    const grid=document.createElement('div');grid.className='task-date-grid';
    for(const weekday of ['Пн','Вт','Ср','Чт','Пт','Сб','Вс']){const el=document.createElement('span');el.textContent=weekday;el.className='picker-weekday';grid.append(el)}
    const first=new Date(month);first.setDate(1-((first.getDay()+6)%7));
    for(let i=0;i<42;i++){
      const date=new Date(first);date.setDate(first.getDate()+i);const key=dayKey(date);
      const b=button(String(date.getDate()),()=>pick(key));
      b.classList.toggle('selected',key===input.value);b.classList.toggle('outside-month',date.getMonth()!==month.getMonth());
      b.setAttribute('aria-label',date.toLocaleDateString('ru-RU'));b.setAttribute('aria-pressed',String(key===input.value));grid.append(b);
    }
    popup.append(grid,button('Сегодня',()=>pick(dayKey(new Date())),'month-current'));
  }
  function drawTime(){
    popup.replaceChildren();
    const label=document.createElement('strong');label.textContent='Время задачи';popup.append(label);
    const field=document.createElement('input');field.type='text';field.inputMode='numeric';field.placeholder='Например, 18:30';field.value=input.value.slice(0,5);field.className='picker-time-input';field.setAttribute('aria-label','Время в формате ЧЧ:ММ');
    const hint=document.createElement('p');hint.className='muted small';hint.textContent='24-часовой формат · можно ввести вручную';
    const apply=()=>{const value=field.value.trim();if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)){field.setCustomValidity('Введи время от 00:00 до 23:59');field.reportValidity();return}pick(value)};
    field.oninput=()=>field.setCustomValidity('');field.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();apply()}};
    const grid=document.createElement('div');grid.className='picker-time-presets';
    for(const value of ['08:00','10:00','12:00','14:00','16:00','18:00'])grid.append(button(value,()=>{field.value=value;field.setCustomValidity('')}));
    popup.append(field,hint,grid,button('Применить',apply,'picker-time-apply'),button('Без времени',()=>pick(''),'month-current'));
  }
  toggle.onclick=()=>{
    if(!popup.classList.contains('hidden'))return close();
    document.querySelectorAll('.task-picker-popup').forEach(el=>el.classList.add('hidden'));
    document.querySelectorAll('.task-picker .month-toggle').forEach(el=>el.setAttribute('aria-expanded','false'));
    month=new Date((input.value&&mode==='date'?input.value:dayKey(new Date()))+'T12:00:00');month.setDate(1);
    mode==='date'?drawDate():drawTime();popup.classList.remove('hidden');toggle.setAttribute('aria-expanded','true');
  };
  document.addEventListener('click',event=>{if(!wrapper.contains(event.target))close()});
  wrapper.addEventListener('keydown',event=>{if(event.key==='Escape'&&!popup.classList.contains('hidden')){event.preventDefault();event.stopPropagation();close();toggle.focus()}});
  input.refreshPicker=update;update();
}
for(const id of ['taskDate','editTaskDate'])attachTaskPicker(id,'date');
for(const id of ['taskTime','editTaskTime'])attachTaskPicker(id,'time');
function attachPriorityPicker(id) {
  const select = $('#' + id);
  select.hidden = true;
  const wrapper = document.createElement('div'); wrapper.className = 'task-picker priority-picker';
  select.before(wrapper); wrapper.append(select);
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'month-toggle priority-toggle';
  toggle.setAttribute('aria-label', 'Выбрать важность задачи'); toggle.setAttribute('aria-expanded','false');
  const menu = document.createElement('div'); menu.className = 'month-popup priority-popup hidden';
  function close(){menu.classList.add('hidden');toggle.setAttribute('aria-expanded','false')}
  function update(){
    toggle.replaceChildren();
    const dot=document.createElement('span'); dot.className=`priority-dot priority-${select.value}`;
    const text=document.createElement('span'); text.textContent=priorityLabels[select.value];
    const arrow=document.createElement('span'); arrow.className='month-chevron';
    toggle.append(dot,text,arrow);
    menu.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.value===select.value)));
  }
  for(const value of ['normal','high','low']){
    const button=document.createElement('button');button.type='button';button.className='priority-option';button.dataset.value=value;
    const dot=document.createElement('span');dot.className=`priority-dot priority-${value}`;
    const text=document.createElement('span');text.textContent=priorityLabels[value];button.append(dot,text);
    button.onclick=()=>{select.value=value;update();close();toggle.focus()};menu.append(button);
  }
  toggle.onclick=()=>{const open=menu.classList.contains('hidden');menu.classList.toggle('hidden',!open);toggle.setAttribute('aria-expanded',String(open))};
  document.addEventListener('click',event=>{if(!wrapper.contains(event.target))close()});
  wrapper.addEventListener('keydown',event=>{if(event.key==='Escape'&&!menu.classList.contains('hidden')){event.preventDefault();event.stopPropagation();close();toggle.focus()}});
  wrapper.append(toggle,menu);select.refreshPicker=update;update();
}
for(const id of ['taskPriority','editTaskPriority'])attachPriorityPicker(id);

if (db) {
  db.auth.getSession().then(({data}) => setSession(data.session?.user || null));
  db.auth.onAuthStateChange((_event, session) => setSession(session?.user || null));
}
