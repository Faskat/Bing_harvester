// Чтение новой (2026) панели rewards.bing.com: React + react-aria + Tailwind.
// JSON API больше не отвечает, поэтому всё берём из DOM.
// Надёжные якоря — только section#id (не переводятся); подписи кнопок проверяем на русском, украинском и английском.

import { LoginRequired, sleep } from './lib.mjs';
import { wait, T } from './timing.mjs';

export const ROOT_URL = 'https://rewards.bing.com/';
export const EARN_URL = 'https://rewards.bing.com/earn';

export const SECTION = {
  dailySet: { id: 'dailyset', url: ROOT_URL },
  explore: { id: 'exploreonbing', url: EARN_URL },
  more: { id: 'moreactivities', url: EARN_URL },
};

const RE = {
  signIn: /^(войти|увійти|sign in)$/i,
  claimCard: /готово к получению|готово до отримання|ready to claim/i,
  claimButton: /^\s*(получить|отримати|claim)/i,
  showMore: /показать (ещё|еще|больше)|показати (ще|більше)|(show|see|view) more/i,
};

const PROFILE_BUTTON = ['Просмотреть профиль', 'Переглянути профіль', 'View profile']
  .map(label => `button[aria-expanded][aria-label="${label}"]`).join(', ');

const normPath = p => (p.replace(/\/+$/, '') || '/').replace(/^\/dashboard$/, '/');

function samePage(a, b) {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.host === y.host && normPath(x.pathname) === normPath(y.pathname);
  } catch {
    return false;
  }
}

// Открыть страницу Rewards и убедиться, что вход есть
export async function openPage(page, url, { reload = false } = {}) {
  if (reload || !samePage(page.url(), url)) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

  if (!page.url().startsWith('https://rewards.bing.com')) {
    // Тихий вход через login.live.com сначала уводит со страницы, а потом возвращает скриптом
    await page.waitForURL(/^https:\/\/rewards\.bing\.com/, { timeout: 8_000 }).catch(() => {});
    if (!page.url().startsWith('https://rewards.bing.com')) throw new LoginRequired(page.url());
  }

  if (await signInVisible(page)) throw new LoginRequired(page.url());
}

// Видна кнопка «Войти» — значит, аккаунт не вошёл
export function signInVisible(page) {
  return page.evaluate(src => {
    const re = new RegExp(src, 'i');
    return [...document.querySelectorAll('a, button, p, span')]
      .some(el => re.test((el.textContent ?? '').replace(/\s+/g, ' ').trim()) && el.getClientRects().length > 0);
  }, RE.signIn.source);
}

export async function readBalance(page) {
  // В потоке Next.js JSON лежит внутри строки, поэтому кавычки экранированы: \"balance\":8104
  const m = (await page.content()).match(/\\?"balance\\?":(\d+)/);
  if (m) return Number(m[1]);
  // Запасной путь: кнопка профиля в шапке — «8 107ОС»
  const text = await page.locator(PROFILE_BUTTON).first().textContent({ timeout: 3_000 }).catch(() => '');
  const digits = (text ?? '').match(/^[\d\s ,]+/)?.[0].replace(/\D/g, '');
  return digits ? Number(digits) : null;
}

// ---------- Разделы и карточки ----------

async function expandSection(page, id) {
  const section = page.locator(`section#${id}`);
  const title = ((await section.locator('h2').first().textContent().catch(() => '')) ?? '')
    .replace(/\s+/g, ' ').trim();

  // Свой переключатель раздела подписан как заголовок; «Сведения о …» — это всплывашка-подсказка
  const toggles = section.locator('button[aria-expanded]');
  for (let i = 0, n = await toggles.count(); i < n; i++) {
    const b = toggles.nth(i);
    if ((await b.getAttribute('aria-label')) !== title) continue;
    if ((await b.getAttribute('aria-expanded')) === 'false') {
      await b.click();
      await sleep(1500);
    }
    break;
  }

  for (let i = 0; i < 10; i++) {
    const more = section.locator('button').filter({ hasText: RE.showMore }).first();
    if (!(await more.isVisible().catch(() => false))) break;
    await more.click();
    await sleep(1200);
  }
}

// false — раздела на странице нет (у аккаунта его может просто не быть)
export async function openSection(page, section, opts) {
  await openPage(page, section.url, opts);
  if (!(await page.locator(`section#${section.id}`).count())) return false;
  await expandSection(page, section.id);
  await page.locator(`section#${section.id} a[href]`).first().waitFor({ timeout: 4_000 }).catch(() => {});
  return true;
}

// Плитки раздела. points === null — плитка без значка, т.е. промо без баллов
export function readCards(page, section) {
  return page.evaluate(id => {
    const clean = s => (s ?? '').replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();
    const root = document.querySelector(`section#${CSS.escape(id)}`);
    if (!root) return [];

    return [...root.querySelectorAll('a[href]')].map((a, index) => {
      const ps = a.querySelectorAll('p');
      const metas = [...a.querySelectorAll('.text-metadata')].map(e => clean(e.textContent));
      const label = metas.find(t => t && !/^\+?\s*[\d\s,]+$/.test(t)) ?? '';

      const plus = clean(a.querySelector('p.text-statusInformativeTintFg')?.textContent).match(/^\+\s*(\d+)$/);
      const pill = clean(a.querySelector('.bg-statusSuccessRewardsBg p')?.textContent).match(/^(\d+)$/);
      const meta = metas.map(t => t.match(/^\+?\s*(\d+)$/)).find(Boolean);
      const points = plus ? +plus[1] : pill ? +pill[1] : meta ? +meta[1] : null;

      return {
        index,
        title: clean(a.querySelector('img')?.alt) || clean(a.querySelector('p.text-globalBody2Strong')?.textContent) || clean(ps[0]?.textContent),
        description: clean(a.querySelector('p.text-fgCtrlNeutralSecondaryRest')?.textContent) || clean(ps[1]?.textContent),
        points,
        // «Активировано» — клик принят, но баллы ещё не пришли; это НЕ выполнено
        done: !!a.querySelector('.bg-statusSuccessRewardsBg') || /выполнено|завершено|виконано|completed/i.test(label),
        label,
        href: a.href,
      };
    });
  }, section.id);
}

// Заголовки уникальны только внутри раздела; одинаковые различаем по ссылке
export function matchCard(cards, card) {
  const byTitle = cards.filter(c => card.title && c.title === card.title);
  if (byTitle.length) return byTitle.find(c => c.href === card.href) ?? byTitle[0];
  const byHref = cards.filter(c => c.href === card.href);
  return byHref.length === 1 ? byHref[0] : null;
}

// Засчитано ли: перечитываем плитку; начисление бывает с задержкой, поэтому две попытки
export async function isCardDone(page, section, card) {
  for (let i = 0; i < 2; i++) {
    await openSection(page, section, { reload: true });
    if (matchCard(await readCards(page, section), card)?.done) return true;
    if (i === 0) await wait([3, 5]);
  }
  return false;
}

// ---------- Всплывающие окна ----------

async function closeDialog(page) {
  const dialog = page.locator('[role="dialog"]').last();
  if (!(await dialog.isVisible().catch(() => false))) return;
  const close = dialog.locator('button[aria-label="Закрыть"], button[aria-label="Close"]').first();
  if (await close.isVisible().catch(() => false)) await close.click().catch(() => {});
  else await page.keyboard.press('Escape');
  await sleep(600);
}

// ---------- «Готово к получению» ----------

const claimCard = page => page.locator('button[aria-expanded]').filter({ hasText: RE.claimCard }).first();

async function readClaimable(page) {
  await openPage(page, ROOT_URL, { reload: true });
  const card = claimCard(page);
  if (!(await card.isVisible().catch(() => false))) return null;
  return card.evaluate(el => {
    for (const p of el.querySelectorAll('p')) {
      const t = (p.textContent ?? '').replace(/[\s ,]/g, '');
      if (/^\d+$/.test(t)) return Number(t);
    }
    return null;
  });
}

// Неполученные баллы через месяц сгорают
export async function claimPoints(page) {
  const before = await readClaimable(page);
  if (before === null) return { status: 'no-card', points: 0 };
  if (before === 0) return { status: 'nothing', points: 0 };

  await claimCard(page).click();
  const dialog = page.locator('[role="dialog"]').last();
  await dialog.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  // Заголовок окна и кнопка подтверждения подписаны одинаково — ищем только среди кнопок
  const confirm = dialog.locator('button:not([aria-expanded]):not([aria-label])')
    .filter({ hasText: RE.claimButton }).last();
  if (!(await confirm.isVisible().catch(() => false))) {
    await closeDialog(page);
    return { status: 'no-button', points: before };
  }

  await wait(T.afterCardClick);
  await confirm.click();
  await wait(T.claimSettle);
  await closeDialog(page);

  const after = await readClaimable(page);
  return after === null || after < before
    ? { status: 'claimed', points: before - (after ?? 0) }
    : { status: 'unconfirmed', points: before };
}
