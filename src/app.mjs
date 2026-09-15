// Окно Bing Harvester: локальный сервер только на 127.0.0.1 + Edge в режиме приложения.
// Сам бот запускается отдельным процессом (src/run.mjs) — точно так же, как из Планировщика.
//   node src/app.mjs              — открыть окно
//   node src/app.mjs --no-window  — только сервер (для разработки), адрес в консоли

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fork, spawn } from 'node:child_process';
import { ROOT, DATA_DIR, LOG_DIR } from './lib.mjs';
import { loadSettings, saveSettings, sanitize, loadAccount, loadHistory, readLock } from './store.mjs';
import { scheduleStatus, installSchedule, removeSchedule } from './scheduler.mjs';
import { isWindows, findEdge } from './win.mjs';

const PORT = Number(process.env.BH_PORT) || 47615;
const BASE = `http://127.0.0.1:${PORT}`;
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const UI_FILES = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/icon.png': 'icon.png' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
const RUNNER = path.join(ROOT, 'src', 'run.mjs');
const JOB_ARGS = { run: [], login: ['--login'], check: ['--check'] };
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const withWindow = !process.argv.includes('--no-window');

// ---------- Окна-подписчики (Server-Sent Events) ----------

const clients = new Set();
const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const broadcast = (event, data) => clients.forEach(c => send(c, event, data));

let pushTimer = null;
function pushState() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => broadcast('state', snapshot()), 50);
}

// ---------- Запуски ----------

let job = null; // идёт сейчас
let lastJob = null; // закончился последним — окно показывает его журнал
let schedule = { supported: isWindows, installed: false };

function pushLine(j, line) {
  j.lines.push(line);
  if (j.lines.length > 400) j.lines.shift();
  if (j === job) broadcast('log', line);
}

function startJob(kind) {
  if (job) return 'Уже выполняется';
  if (readLock()) return 'Сейчас идёт другой запуск (например, по расписанию) — дождитесь конца';

  const child = fork(RUNNER, JOB_ARGS[kind], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  const j = {
    kind, child, startedAt: new Date().toISOString(), finishedAt: null, exitCode: null,
    stopping: false, plan: [], phases: {}, login: null, lines: [],
  };
  job = j;

  for (const stream of [child.stdout, child.stderr]) {
    let rest = '';
    stream.setEncoding('utf8');
    stream.on('data', chunk => {
      const parts = (rest + chunk).split(/\r?\n/);
      rest = parts.pop();
      for (const line of parts) if (line.trim()) pushLine(j, line);
    });
  }
  child.on('message', ev => {
    if (ev.type === 'plan') j.plan = ev.phases;
    if (ev.type === 'phase') j.phases[ev.name] = ev;
    if (ev.type === 'login') j.login = ev.status;
    pushState();
  });
  child.on('error', e => pushLine(j, `Не удалось запустить: ${e.message}`));
  child.on('exit', code => {
    j.exitCode = code;
    j.finishedAt = new Date().toISOString();
    if (job === j) {
      job = null;
      lastJob = j;
    }
    pushState();
    idleCheck();
  });
  pushState();
  return null;
}

function stopJob() {
  if (!job) return 'Нечего останавливать';
  const j = job;
  j.stopping = true;
  j.child.send('stop');
  // Если бот завис намертво — добиваем
  setTimeout(() => j.finishedAt || j.child.kill(), 20_000);
  pushState();
  return null;
}

function publicJob(j) {
  if (!j) return null;
  const { child, ...rest } = j;
  return { ...rest, lines: j.lines.slice(-200) };
}

function snapshot() {
  const settings = loadSettings();
  // Источник правды для расписания — сама задача в Планировщике
  if (schedule.supported && !schedule.error) {
    settings.schedule = { enabled: !!schedule.installed, time: schedule.time ?? settings.schedule.time };
  }
  return {
    version,
    settings,
    account: loadAccount(),
    history: loadHistory().slice(0, 15),
    job: publicJob(job ?? lastJob),
    running: !!job,
    // Запуск не из окна (Планировщик или консоль) — кнопки запуска блокируем
    external: job ? null : readLock(),
    schedule,
  };
}

// ---------- Настройки и расписание ----------

async function refreshSchedule() {
  if (!isWindows) return;
  try {
    schedule = await scheduleStatus();
  } catch (e) {
    schedule = { supported: true, installed: false, error: e.message };
  }
  pushState();
}

async function updateSettings(body) {
  const prev = loadSettings();
  saveSettings({ ...prev, ...body, schedule: { ...prev.schedule, ...body.schedule } });
  if (!body.schedule || !isWindows) return null;

  const next = loadSettings().schedule;
  try {
    if (next.enabled) await installSchedule(next.time);
    else await removeSchedule();
    return null;
  } catch (e) {
    return `Планировщик: ${e.message}`;
  } finally {
    await refreshSchedule();
  }
}

// ---------- HTTP ----------

function json(res, status, data) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 16_384) req.destroy(new Error('too big'));
      else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function openEvents(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  clients.add(res);
  send(res, 'state', snapshot());
  req.on('close', () => {
    clients.delete(res);
    idleCheck();
  });
}

async function handle(req, res) {
  // Отвечаем только своему окну: чужие страницы не должны управлять ботом через localhost (и через DNS rebinding)
  if (!HOSTS.has(req.headers.host ?? '')) return json(res, 403, { error: 'forbidden' });
  const { pathname } = new URL(req.url, BASE);

  if (req.method === 'GET') {
    if (pathname === '/api/ping') return json(res, 200, { app: 'bing-harvester', version });
    if (pathname === '/api/state') return json(res, 200, snapshot());
    if (pathname === '/api/events') return openEvents(req, res);
    const file = UI_FILES[pathname];
    if (!file) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)], 'Cache-Control': 'no-store' });
    return fs.createReadStream(path.join(ROOT, 'ui', file)).pipe(res);
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
  // Свой заголовок чужой сайт без разрешения CORS не отправит, а разрешений сервер не выдаёт
  const origin = (req.headers.origin ?? '').replace(/^https?:\/\//, '');
  if (req.headers['x-harvester'] !== '1' || (origin && !HOSTS.has(origin))) return json(res, 403, { error: 'forbidden' });

  const body = await readBody(req).catch(() => null);
  if (body === null || typeof body !== 'object') return json(res, 400, { error: 'Плохой запрос' });

  let error = null;
  switch (pathname) {
    case '/api/run':
    case '/api/login':
    case '/api/check':
      error = startJob(pathname.slice('/api/'.length));
      break;
    case '/api/stop':
      error = stopJob();
      break;
    case '/api/settings':
      error = await updateSettings(body);
      break;
    case '/api/open-logs':
      fs.mkdirSync(LOG_DIR, { recursive: true });
      spawn(isWindows ? 'explorer.exe' : 'xdg-open', [LOG_DIR], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
      break;
    default:
      return json(res, 404, { error: 'not found' });
  }
  return json(res, error ? 409 : 200, { error, state: snapshot() });
}

// ---------- Жизненный цикл ----------

// Окно закрыли и ничего не выполняется — сервер больше не нужен (расписание работает без него)
let idleTimer = null;
function idleCheck(delay = 15_000) {
  if (!withWindow) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!clients.size && !job) process.exit(0);
  }, delay);
}

function openWindow() {
  const edge = isWindows ? findEdge() : null;
  const url = `${BASE}/`;
  if (edge) {
    // Свой профиль для окна: не смешивается с обычным Edge и открывается отдельным приложением
    spawn(edge, [`--app=${url}`, `--user-data-dir=${path.join(DATA_DIR, 'app-window')}`, '--window-size=520,880',
      '--no-first-run', '--no-default-browser-check'], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  const [cmd, cmdArgs] = isWindows ? ['cmd', ['/c', 'start', '', url]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
  spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

async function alreadyRunning() {
  try {
    const res = await fetch(`${BASE}/api/ping`, { signal: AbortSignal.timeout(1500) });
    return (await res.json()).app === 'bing-harvester';
  } catch {
    return false;
  }
}

if (await alreadyRunning()) {
  if (withWindow) openWindow();
  process.exit(0);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(e => json(res, 500, { error: e.message }));
});
server.on('error', e => {
  console.error(`Не удалось занять порт ${PORT}: ${e.message}`);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Bing Harvester ${version}: ${BASE}/`);
  if (withWindow) openWindow();
  idleCheck(90_000);
});

setInterval(() => clients.forEach(c => c.write(': ping\n\n')), 25_000).unref();

// Запуск по расписанию стартовал или закончился — обновим окно
let lastLock = 'null';
setInterval(() => {
  const lock = JSON.stringify(readLock());
  if (lock !== lastLock) {
    lastLock = lock;
    pushState();
  }
}, 4_000).unref();

refreshSchedule();
