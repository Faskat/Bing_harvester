// Один проход по Microsoft Rewards: поиск для серии → ежедневный набор → доп. задания → получение баллов.
// Не бросает исключений: итог (ok / login / stopped / error) возвращается записью для истории.

import { launch, log, dismissBanners, LoginRequired } from './lib.mjs';
import { setSpeed, wait, T } from './timing.mjs';
import {
  ROOT_URL, SECTION, openPage, openSection, readCards, matchCard, isCardDone, claimPoints, readBalance,
} from './dashboard.mjs';
import { answerQuiz } from './quiz.mjs';
import { performSearch, browse, searchOptions } from './search.mjs';
import { getQueries } from './queries.mjs';

// Для дневной серии хватает одного поиска («Поиск: 1/1»). До лимита в 60 баллов не добиваем:
// 20 однотипных запросов в день — самое заметное для Microsoft и может урезать бонус Bing Star
const STREAK_SEARCHES = 2;
// Люди открывают какой-то результат примерно в трети поисков
const RESULT_CLICK_CHANCE = 0.35;
// Плитки «Продолжить зарабатывать», которые одним кликом не выполнить
const MORE_IGNORE = /пазл|puzzle|викторин|quiz|тест|test|установ|install|расширени|extension|приложени|bing app|игра|play|поделит|share|приглас|refer|друз|цель|goal|по умолчанию|set bing/i;
// «Выполните поиск в Bing, чтобы …» — оставляем только суть запроса
const EXPLORE_BOILERPLATE = /^(выполните поиск в bing|найдите в bing|поищите в bing|ищите в bing|search on bing|search using bing|search bing|use bing|bing search)[,:]?\s*(чтобы|to|for)?\s*/i;

const firstLine = e => String(e?.message ?? e).split('\n')[0];

function exploreQuery(card) {
  const q = (card.description ?? '').replace(EXPLORE_BOILERPLATE, '').trim();
  return (q.length >= 8 ? q : card.title).slice(0, 80);
}

// Засчитывается только настоящий клик по плитке — поэтому кликаем её, а не открываем ссылку
async function clickCard(context, rewards, section, card, handleTab) {
  await openSection(rewards, section);
  const hit = matchCard(await readCards(rewards, section), card);
  if (!hit) {
    log('  карточка пропала со страницы');
    return false;
  }
  const tile = rewards.locator(`section#${section.id} a[href]`).nth(hit.index);
  await tile.scrollIntoViewIfNeeded().catch(() => {});
  await wait(T.afterCardClick);

  const [tab] = await Promise.all([
    context.waitForEvent('page', { timeout: 15_000 }).catch(() => null),
    tile.click(),
  ]);
  if (!tab) {
    log('  карточка не открыла вкладку');
    return false;
  }
  try {
    await tab.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
    await dismissBanners(tab);
    await handleTab(tab, card);
  } finally {
    await tab.close().catch(() => {});
  }
  return true;
}

async function runCards(context, rewards, section, r, { filter = () => true, attempts = 1, handleTab }) {
  if (!(await openSection(rewards, section))) {
    r.skipped = true;
    r.note = 'раздела нет на этом аккаунте';
    return log(`  ${r.note}`);
  }
  const cards = (await readCards(rewards, section)).filter(c => c.points !== null);
  const todo = cards.filter(c => !c.done && filter(c));
  log(`  выполнено ${cards.filter(c => c.done).length}/${cards.length}, к работе ${todo.length}`);
  if (!cards.length) {
    r.skipped = true;
    r.note = 'заданий с баллами нет';
  } else if (!todo.length) {
    r.note = 'всё уже выполнено';
  }

  for (const card of todo) {
    log(`  «${card.title}» (+${card.points})`);
    let credited = false;
    for (let attempt = 1; attempt <= attempts && !credited; attempt++) {
      if (attempt > 1) log('  не засчитано — ещё попытка');
      if (await clickCard(context, rewards, section, card, handleTab)) {
        credited = await isCardDone(rewards, section, card);
      }
    }
    if (credited) r.ok++;
    else r.failed++;
    log(credited ? '  ✓ засчитано' : '  ✗ не засчитано');
    await wait(T.betweenSearches);
  }
}

async function claim(rewards, r) {
  const res = await claimPoints(rewards);
  r.note = {
    'no-card': 'карточки «Готово к получению» нет',
    nothing: 'получать нечего',
    'no-button': `не нашёл кнопку подтверждения (${res.points} ждут)`,
    claimed: `получено ${res.points}`,
    unconfirmed: `нажал, но не подтвердилось (${res.points})`,
  }[res.status];
  if (res.status === 'claimed') r.ok++;
  if (res.status === 'no-button' || res.status === 'unconfirmed') r.failed++;
  if (res.status === 'no-card' || res.status === 'nothing') r.skipped = true;
  log(`  ${r.note}`);
}

function buildPlan(settings) {
  const dailyTab = async tab => {
    const quiz = settings.quiz ? await answerQuiz(tab) : 'none';
    if (quiz === 'already') log('  викторина уже пройдена');
    if (quiz === 'unknown') log('  викторина незнакомого вида — ответить не смог');
    if (quiz === 'none' || quiz === 'unknown') await browse(tab);
  };

  return [
    {
      name: 'Поиск для серии',
      enabled: settings.search,
      run: async (r, { bing }) => {
        for (const q of await getQueries(bing, STREAK_SEARCHES, settings.lang)) {
          log(`  поиск: «${q}»`);
          await performSearch(bing, q);
          r.ok++;
          await wait(T.betweenSearches);
        }
      },
    },
    {
      name: 'Ежедневный набор',
      enabled: settings.daily,
      run: (r, { context, rewards }) => runCards(context, rewards, SECTION.dailySet, r, { handleTab: dailyTab }),
    },
    {
      name: 'Explore on Bing',
      enabled: settings.more,
      run: (r, { context, rewards }) => runCards(context, rewards, SECTION.explore, r, {
        attempts: 2,
        handleTab: (tab, card) => performSearch(tab, exploreQuery(card), { stay: true }),
      }),
    },
    {
      name: 'Продолжить зарабатывать',
      enabled: settings.more,
      run: (r, { context, rewards }) => runCards(context, rewards, SECTION.more, r, {
        attempts: 2,
        filter: c => !MORE_IGNORE.test(`${c.title} ${c.description}`),
        handleTab: tab => browse(tab),
      }),
    },
    {
      name: 'Получение баллов',
      enabled: settings.claim,
      run: (r, { rewards }) => claim(rewards, r),
    },
  ].filter(p => p.enabled);
}

const RESULT_TEXT = { ok: 'готово', login: 'нужен вход', stopped: 'остановлено', error: 'ошибка' };

function report(rec) {
  const s = Math.round((Date.parse(rec.finishedAt) - Date.parse(rec.startedAt)) / 1000);
  log(`=== Итог (${RESULT_TEXT[rec.result]}) за ${Math.floor(s / 60)} мин ${s % 60} с ===`);
  for (const r of rec.phases) {
    const parts = [r.ok && `готово ${r.ok}`, r.failed && `не вышло ${r.failed}`, r.note].filter(Boolean);
    log(`  ${r.name}: ${parts.join(', ') || 'делать нечего'}`);
  }
  if (rec.balanceBefore !== null && rec.balanceAfter !== null) {
    log(`  Баланс: ${rec.balanceBefore} → ${rec.balanceAfter} (+${rec.balanceAfter - rec.balanceBefore})`);
  }
}

// emit — события для окна (plan / balance / phase); signal — остановка
export async function runBot(settings, { emit = () => {}, signal } = {}) {
  setSpeed(settings.speed);
  searchOptions.clickChance = settings.clicks ? RESULT_CLICK_CHANCE : 0;

  const plan = buildPlan(settings);
  const record = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: 'ok',
    error: null,
    balanceBefore: null,
    balanceAfter: null,
    phases: [],
  };
  emit({ type: 'plan', phases: plan.map(p => p.name) });

  let context = null;
  // Закрытый браузер обрывает текущее действие — дальше всё сворачивается само
  const onAbort = () => {
    log('Останавливаю…');
    context?.close().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const launched = await launch({ headless: !settings.showBrowser, lang: settings.lang });
    context = launched.context;
    if (signal?.aborted) throw new Error('stopped');

    const rewards = launched.page;
    await openPage(rewards, ROOT_URL);
    record.balanceBefore = await readBalance(rewards);
    log(`Баланс: ${record.balanceBefore ?? '?'}`);
    emit({ type: 'balance', value: record.balanceBefore });
    const bing = await context.newPage();

    for (const p of plan) {
      if (signal?.aborted) break;
      log(`— ${p.name} —`);
      emit({ type: 'phase', name: p.name, status: 'running' });
      const r = { name: p.name, status: 'done', ok: 0, failed: 0, note: '' };
      try {
        await p.run(r, { context, rewards, bing });
      } catch (e) {
        if (e instanceof LoginRequired || signal?.aborted) throw e;
        r.error = true;
        r.note = `ошибка: ${firstLine(e)}`;
        log(`  ${r.note}`);
      }
      r.status = r.error ? 'error' : r.skipped ? 'skip' : r.failed ? 'warn' : 'done';
      delete r.error;
      delete r.skipped;
      record.phases.push(r);
      emit({ type: 'phase', ...r });
    }

    if (!signal?.aborted) {
      await openPage(rewards, ROOT_URL, { reload: true });
      record.balanceAfter = await readBalance(rewards);
    }
  } catch (e) {
    if (signal?.aborted) {
      // ниже станет stopped
    } else if (e instanceof LoginRequired) {
      record.result = 'login';
      record.error = e.message;
    } else {
      record.result = 'error';
      record.error = firstLine(e);
      log(`Ошибка: ${e.stack ?? e}`);
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await context?.close().catch(() => {});
  }

  if (signal?.aborted) record.result = 'stopped';
  record.finishedAt = new Date().toISOString();
  report(record);
  return record;
}
