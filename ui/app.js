const $ = id => document.getElementById(id);

// Маленький помощник: элементы без innerHTML, текст всегда через textContent
function h(tag, props = {}, ...children) {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children.filter(c => c !== null && c !== undefined && c !== false));
  return el;
}

const fmtNum = n => (n === null || n === undefined ? '—' : Number(n).toLocaleString('ru-RU'));

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((new Date(new Date().toDateString()) - new Date(d.toDateString())) / 864e5);
  if (days === 0) return `сегодня в ${time}`;
  if (days === 1) return `вчера в ${time}`;
  if (days === -1) return `завтра в ${time}`;
  return `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} в ${time}`;
}

const RESULT = {
  ok: ['Готово', 'ok'],
  login: ['Нужно войти заново', 'error'],
  stopped: ['Остановлено', 'warn'],
  error: ['Запуск завершился ошибкой', 'error'],
};
const STEP_ICON = { done: '✓', warn: '!', error: '✕', skip: '–' };

const gained = rec => (rec.balanceBefore != null && rec.balanceAfter != null ? rec.balanceAfter - rec.balanceBefore : null);
const pointsText = n => `+${fmtNum(n)} ${plural(n, 'балл', 'балла', 'баллов')}`;

// ---------- Сервер ----------

async function api(name, body = {}) {
  try {
    const res = await fetch(`api/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Harvester': '1' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.state) render(data.state);
    if (data.error) toast(data.error);
    return data;
  } catch {
    toast('Приложение не отвечает — откройте его заново');
    return {};
  }
}

let toastTimer = null;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 5000);
}

// ---------- Отрисовка ----------

let state = null;

function render(s) {
  state = s;
  $('version').textContent = `v${s.version}`;
  renderAccount(s);
  renderOnboarding(s);
  renderRun(s);
  renderSchedule(s);
  renderSettings(s.settings);
  renderHistory(s.history);
  renderLog(s.job?.lines ?? []);
}

function renderAccount({ account }) {
  const el = $('account');
  if (account.loggedIn) {
    el.className = 'account on';
    el.textContent = fmtNum(account.balance);
    el.title = `Баланс, проверено ${fmtWhen(account.checkedAt)}`;
  } else {
    el.className = `account ${account.loggedIn === false ? 'off' : ''}`;
    el.textContent = account.loggedIn === false ? 'Нет входа' : 'Не проверено';
    el.title = account.checkedAt ? `Проверено ${fmtWhen(account.checkedAt)}` : '';
  }
}

function renderOnboarding({ account, history, running, job }) {
  const loggingIn = running && job.kind === 'login';
  const needLogin = account.loggedIn === false || (account.loggedIn == null && !history.length);
  $('onboarding').hidden = !(needLogin || loggingIn);
  $('loginBtn').disabled = running;
  $('loginBtn').textContent = loggingIn ? 'Жду входа в окне Edge…' : 'Войти в Microsoft';
  $('cancelLoginBtn').hidden = !loggingIn;
}

function renderRun(s) {
  const { job, running, external, history, account } = s;
  const btn = $('runBtn');
  let title;
  let sub = '';
  let steps = null;

  btn.className = 'primary big';
  btn.dataset.action = 'run';
  btn.textContent = 'Собрать баллы';
  btn.disabled = running || !!external || account.loggedIn === false;

  if (external) {
    title = external.kind === 'run' ? 'Идёт запуск по расписанию' : 'Идёт другой запуск';
    sub = `Начался ${fmtWhen(external.startedAt)} — окно обновится, когда он закончится`;
  } else if (running && job.kind === 'run') {
    title = job.stopping ? 'Останавливаю…' : 'Собираю баллы…';
    sub = `Начал ${fmtWhen(job.startedAt)}. Окно можно закрыть — работа продолжится`;
    btn.className = 'danger big';
    btn.dataset.action = 'stop';
    btn.textContent = 'Остановить';
    btn.disabled = job.stopping;
    steps = job.plan.map(name => job.phases[name] ?? { name, status: 'pending' });
  } else if (running) {
    title = job.kind === 'login' ? 'Жду входа в окне Edge…' : 'Проверяю вход…';
    sub = job.kind === 'login' ? 'Окно закроется само, когда вход получится' : 'Пара секунд';
  } else if (history[0]) {
    const rec = history[0];
    const g = gained(rec);
    title = (RESULT[rec.result] ?? RESULT.error)[0];
    sub = [
      fmtWhen(rec.finishedAt),
      g !== null && pointsText(g),
      rec.trigger === 'schedule' && 'по расписанию',
      rec.result === 'error' && rec.error,
    ].filter(Boolean).join(' · ');
    steps = rec.phases;
  } else {
    title = 'Готов к работе';
    sub = 'Бот пройдёт ежедневный набор, сделает пару поисков и заберёт баллы';
  }

  $('runTitle').textContent = title;
  $('runSub').textContent = sub;
  renderSteps(steps);
}

function stepNote(st) {
  if (st.status === 'running') return 'выполняется…';
  if (st.status === 'pending') return '';
  return [st.ok && `готово ${st.ok}`, st.failed && `не вышло ${st.failed}`, st.note].filter(Boolean).join(', ');
}

function renderSteps(steps) {
  const ol = $('steps');
  ol.hidden = !steps?.length;
  ol.replaceChildren(...(steps ?? []).map(st => h('li', { className: `step ${st.status}` },
    h('span', { className: 'icon', textContent: STEP_ICON[st.status] ?? '' }),
    h('span', { className: 'name', textContent: st.name }),
    stepNote(st) && h('span', { className: 'note', textContent: stepNote(st) }))));
}

let scheduleBusy = false;

function renderSchedule({ schedule, settings }) {
  const on = $('scheduleOn');
  const time = $('scheduleTime');
  const sub = $('scheduleSub');

  if (!schedule.supported) {
    on.disabled = time.disabled = true;
    sub.textContent = 'Расписание есть только в Windows';
    return;
  }
  on.disabled = time.disabled = scheduleBusy;
  on.checked = settings.schedule.enabled;
  if (document.activeElement !== time) time.value = settings.schedule.time;

  if (scheduleBusy) sub.textContent = 'Сохраняю…';
  else if (schedule.error) sub.textContent = `Не удалось прочитать задачу: ${schedule.error}`;
  else if (!settings.schedule.enabled) sub.textContent = 'Выключено — запускайте вручную';
  else if (schedule.next) sub.textContent = `Следующий запуск ${fmtWhen(schedule.next)} (± ${schedule.randomDelay ?? 30} мин). Окно для этого не нужно`;
  else sub.textContent = 'Включено';
}

function renderSettings(settings) {
  for (const el of document.querySelectorAll('[data-setting]')) {
    if (el === document.activeElement && el.tagName === 'SELECT') continue;
    const v = settings[el.dataset.setting];
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
  }
}

function renderHistory(history) {
  const ul = $('history');
  if (!history.length) {
    ul.replaceChildren(h('li', { className: 'empty muted', textContent: 'Запусков ещё не было' }));
    return;
  }
  ul.replaceChildren(...history.map(rec => {
    const [text, tone] = RESULT[rec.result] ?? RESULT.error;
    const g = gained(rec);
    return h('li', { className: tone, title: rec.error ?? '' },
      h('span', { className: 'dot' }),
      h('span', { textContent: fmtWhen(rec.startedAt) }),
      h('span', { className: 'muted', textContent: rec.trigger === 'schedule' ? 'расписание' : 'вручную' }),
      h('b', { textContent: rec.result === 'ok' && g !== null ? `+${fmtNum(g)}` : text }));
  }));
}

function renderLog(lines) {
  const pre = $('log');
  const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 30;
  pre.textContent = lines.join('\n');
  if (atBottom) pre.scrollTop = pre.scrollHeight;
}

function appendLog(line) {
  if (!state?.job) return;
  state.job.lines.push(line);
  renderLog(state.job.lines);
}

// ---------- Действия ----------

$('runBtn').addEventListener('click', e => api(e.currentTarget.dataset.action));
$('loginBtn').addEventListener('click', () => api('login'));
$('reloginBtn').addEventListener('click', () => api('login'));
$('cancelLoginBtn').addEventListener('click', () => api('stop'));
$('checkBtn').addEventListener('click', () => api('check'));
$('logsBtn').addEventListener('click', () => api('open-logs'));

for (const el of document.querySelectorAll('[data-setting]')) {
  el.addEventListener('change', () =>
    api('settings', { [el.dataset.setting]: el.type === 'checkbox' ? el.checked : el.value }));
}

async function saveSchedule(patch) {
  scheduleBusy = true;
  if (state) renderSchedule(state);
  await api('settings', { schedule: patch });
  scheduleBusy = false;
  if (state) renderSchedule(state);
}

$('scheduleOn').addEventListener('change', e => saveSchedule({ enabled: e.target.checked, time: $('scheduleTime').value }));
$('scheduleTime').addEventListener('change', e => {
  if (/^\d{2}:\d{2}$/.test(e.target.value)) saveSchedule({ time: e.target.value });
});

// ---------- Живые обновления ----------

const events = new EventSource('api/events');
events.addEventListener('state', e => {
  $('offline').hidden = true;
  render(JSON.parse(e.data));
});
events.addEventListener('log', e => appendLog(JSON.parse(e.data)));
events.onerror = () => ($('offline').hidden = false);

// «Сегодня/вчера» и время следующего запуска устаревают сами по себе
setInterval(() => state && render(state), 60_000);
