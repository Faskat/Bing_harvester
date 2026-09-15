import { dismissBanners, rand, sleep } from './lib.mjs';
import { humanMs, wait, T } from './timing.mjs';

// Шанс открыть найденный сайт; задаёт bot.mjs из настроек
export const searchOptions = { clickChance: 0.35 };

// Побыть на странице: 2–3 прокрутки в случайные моменты, иногда немного назад вверх
export async function browse(page, range = T.page) {
  const total = humanMs(range);
  const down = rand(300, 900);
  const steps = rand(2, 3);
  const marks = Array.from({ length: steps }, () => total * (0.2 + Math.random() * 0.6)).sort((a, b) => a - b);

  let t = 0;
  for (const at of marks) {
    await sleep(at - t);
    t = at;
    await page.mouse.wheel(0, Math.round(down / steps)).catch(() => {});
  }
  if (Math.random() < 0.2 && total * 0.85 > t) {
    await sleep(total * 0.85 - t);
    t = total * 0.85;
    await page.mouse.wheel(0, -Math.round(down / 4)).catch(() => {});
  }
  await sleep(Math.max(0, total - t));
}

async function openResult(page) {
  const links = page.locator('#b_results .b_algo h2 a');
  const n = await links.count().catch(() => 0);
  if (!n) return;

  const link = links.nth(rand(0, Math.min(n, 3) - 1));
  await link.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(rand(500, 1500));
  const popup = page.context().waitForEvent('page', { timeout: 5_000 }).catch(() => null);
  await link.click({ timeout: 10_000 }).catch(() => {});
  const tab = await popup;
  await wait(T.resultDwell);
  if (tab) await tab.close().catch(() => {});
  else await page.goBack({ timeout: 15_000 }).catch(() => {});
}

// stay: вкладку уже открыла карточка задания — ищем прямо на ней
export async function performSearch(page, query, { stay = false } = {}) {
  if (!stay || !/bing\.com/.test(page.url())) {
    await page.goto('https://www.bing.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  }
  await dismissBanners(page);
  await wait(T.beforeSearch, { scaled: false });

  const box = page.locator('#sb_form_q, textarea[name="q"]').first();
  if (await box.isVisible().catch(() => false)) {
    await box.click();
    await box.fill('');
    for (const ch of query) {
      await page.keyboard.type(ch);
      await sleep(Math.random() < 0.05 ? rand(200, 400) : rand(40, 120));
    }
    await sleep(rand(150, 300));
    await page.keyboard.press('Enter');
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
  } else {
    await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(query)}&form=QBLH`,
      { waitUntil: 'domcontentloaded', timeout: 45_000 });
  }

  await browse(page);
  if (Math.random() < searchOptions.clickChance) await openResult(page);
}
