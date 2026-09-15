// Настройки, аккаунт, история и блокировка запуска — простые JSON в data/.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, LOCALES } from './lib.mjs';
import { SPEED_NAMES } from './timing.mjs';

const file = name => path.join(DATA_DIR, name);

export const TOGGLES = ['search', 'daily', 'more', 'quiz', 'clicks', 'claim'];

export const DEFAULTS = {
  lang: 'ru',
  speed: 'normal',
  showBrowser: false,
  search: true,
  daily: true,
  more: true,
  quiz: true,
  clicks: true,
  claim: true,
  schedule: { enabled: false, time: '10:00' },
};

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    return fallback;
  }
}

// Через временный файл: окно и запуск по расписанию могут писать одновременно
function writeJson(name, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const target = file(name);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, target);
}

// Всё, что пришло извне (файл, окно), приводим к допустимым значениям
export function sanitize(s = {}) {
  const bool = (v, d) => (typeof v === 'boolean' ? v : d);
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(s.schedule?.time) ? s.schedule.time : DEFAULTS.schedule.time;
  return {
    lang: s.lang in LOCALES ? s.lang : DEFAULTS.lang,
    speed: SPEED_NAMES.includes(s.speed) ? s.speed : DEFAULTS.speed,
    showBrowser: bool(s.showBrowser, DEFAULTS.showBrowser),
    ...Object.fromEntries(TOGGLES.map(k => [k, bool(s[k], DEFAULTS[k])])),
    schedule: { enabled: bool(s.schedule?.enabled, DEFAULTS.schedule.enabled), time },
  };
}

export const loadSettings = () => sanitize(readJson('settings.json', {}));
export const saveSettings = s => writeJson('settings.json', sanitize(s));

export const loadAccount = () => readJson('account.json', { loggedIn: null, balance: null, checkedAt: null });

export function saveAccount(patch) {
  const account = { ...loadAccount(), ...patch, checkedAt: new Date().toISOString() };
  writeJson('account.json', account);
  return account;
}

const HISTORY_MAX = 60;
export const loadHistory = () => readJson('history.json', []);
export const addHistory = rec => writeJson('history.json', [rec, ...loadHistory()].slice(0, HISTORY_MAX));

// ---------- Один запуск за раз: два Edge на одном профиле не уживаются ----------

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

export function readLock() {
  const lock = readJson('run.lock', null);
  return lock && alive(lock.pid) ? lock : null;
}

// null — блокировка взята; иначе — чужая блокировка
export function acquireLock(kind) {
  const current = readLock();
  if (current && current.pid !== process.pid) return current;
  writeJson('run.lock', { pid: process.pid, kind, startedAt: new Date().toISOString() });
  return null;
}

export function releaseLock() {
  if (readJson('run.lock', null)?.pid === process.pid) fs.rmSync(file('run.lock'), { force: true });
}
