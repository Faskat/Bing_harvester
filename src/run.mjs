// Один запуск — из окна, Планировщика или консоли.
//   node src/run.mjs              — собрать баллы (настройки из data/settings.json)
//   node src/run.mjs --login      — войти в аккаунт Microsoft (окно Edge закроется само)
//   node src/run.mjs --check      — проверить вход и баланс
// Флаги поверх настроек: --show --headless --speed=slow --lang=uk
//   --no-search --no-daily --no-more --no-quiz --no-clicks --no-claim
// Коды выхода: 0 готово, 1 ошибка, 2 нужен вход, 3 остановлено, 4 уже идёт другой запуск

import { launch, log, sleep, LoginRequired } from './lib.mjs';
import { loadSettings, sanitize, saveAccount, addHistory, acquireLock, releaseLock, TOGGLES } from './store.mjs';
import { ROOT_URL, openPage, readBalance, signInVisible } from './dashboard.mjs';
import { runBot } from './bot.mjs';

const args = process.argv.slice(2);
const has = flag => args.includes(flag);
const value = name => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];

const LOGIN_TIMEOUT = 15 * 60_000;

function settingsFromArgs() {
  const s = loadSettings();
  if (has('--show')) s.showBrowser = true;
  if (has('--headless')) s.showBrowser = false;
  for (const k of TOGGLES) if (has(`--no-${k}`)) s[k] = false;
  s.speed = value('speed') ?? s.speed;
  s.lang = value('lang') ?? s.lang;
  return sanitize(s);
}

// Окно слушает события через IPC; из консоли и Планировщика их просто некому получать
const emit = ev => process.send?.(ev);

const stop = new AbortController();
process.on('message', m => m === 'stop' && stop.abort());
process.on('SIGINT', () => (stop.signal.aborted ? process.exit(3) : stop.abort()));

async function run() {
  const settings = settingsFromArgs();
  const trigger = has('--scheduled') ? 'schedule' : process.send ? 'app' : 'cli';
  log(`=== Старт${trigger === 'schedule' ? ' по расписанию' : ''}: скорость ${settings.speed} ===`);

  const rec = await runBot(settings, { emit, signal: stop.signal });
  addHistory({ ...rec, trigger });
  if (rec.result === 'ok') saveAccount({ loggedIn: true, balance: rec.balanceAfter ?? rec.balanceBefore });
  if (rec.result === 'login') {
    saveAccount({ loggedIn: false });
    log(`${rec.error}. Войдите заново: откройте Bing Harvester и нажмите «Войти в Microsoft»`);
  }
  return { ok: 0, error: 1, login: 2, stopped: 3 }[rec.result];
}

async function check() {
  const { lang } = loadSettings();
  const { context, page } = await launch({ headless: true, lang });
  try {
    await openPage(page, ROOT_URL);
    const balance = await readBalance(page);
    saveAccount({ loggedIn: true, balance });
    log(`Вход есть, баланс: ${balance ?? '?'}`);
    return 0;
  } catch (e) {
    if (!(e instanceof LoginRequired)) throw e;
    saveAccount({ loggedIn: false });
    log('Входа в аккаунт Microsoft нет');
    return 2;
  } finally {
    await context.close().catch(() => {});
  }
}

// Вход засчитываем, когда на rewards.bing.com нет кнопки «Войти», а баланс читается
async function signedInBalance(context) {
  for (const page of context.pages()) {
    if (!page.url().startsWith('https://rewards.bing.com')) continue;
    if (await signInVisible(page)) continue;
    const balance = await readBalance(page);
    if (balance !== null) return balance;
  }
  return null;
}

async function login() {
  const { lang } = loadSettings();
  const { context, page } = await launch({ headless: false, lang });
  let closed = false;
  context.on('close', () => (closed = true));
  stop.signal.addEventListener('abort', () => context.close().catch(() => {}), { once: true });

  await page.goto(ROOT_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
  log('Войдите в аккаунт Microsoft в окне Edge и отметьте «Оставаться в системе» — окно закроется само');
  emit({ type: 'login', status: 'waiting' });

  // Два совпадения подряд — чтобы не принять за вход страницу, которая ещё грузится
  let hits = 0;
  for (const deadline = Date.now() + LOGIN_TIMEOUT; !closed && Date.now() < deadline;) {
    await sleep(2500);
    const balance = await signedInBalance(context).catch(() => null);
    hits = balance === null ? 0 : hits + 1;
    if (hits >= 2) {
      saveAccount({ loggedIn: true, balance });
      log(`Вход выполнен, баланс: ${balance}`);
      emit({ type: 'login', status: 'ok', balance });
      await sleep(1500);
      await context.close().catch(() => {});
      return 0;
    }
  }

  if (!closed) await context.close().catch(() => {});
  if (stop.signal.aborted) {
    log('Вход отменён');
    return 3;
  }
  // Окно закрыли вручную или вышло время — проверим без окна, получилось ли
  return check();
}

const mode = has('--login') ? 'login' : has('--check') ? 'check' : 'run';
const busy = acquireLock(mode);
if (busy) {
  log(`Уже идёт другой запуск (${busy.kind}, pid ${busy.pid}) — пропускаю`);
  process.exit(4);
}

let code = 1;
try {
  code = await { run, login, check }[mode]();
} catch (e) {
  log(`Ошибка: ${e.stack ?? e}`);
} finally {
  releaseLock();
}
// Даём последним IPC-сообщениям уйти в окно
setTimeout(() => process.exit(code), 200);
