import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Всё личное — вход в Microsoft, настройки, история, логи — лежит в data/ и не попадает в git
export const DATA_DIR = process.env.BH_DATA ? path.resolve(process.env.BH_DATA) : path.join(ROOT, 'data');
// Отдельный профиль Edge только для бота: основной профиль не трогаем
export const PROFILE_DIR = path.join(DATA_DIR, 'profile');
export const LOG_DIR = path.join(DATA_DIR, 'logs');

export const LOCALES = { ru: 'ru-RU', uk: 'uk-UA', en: 'en-US' };

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const rand = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];

export function log(...parts) {
  const d = new Date();
  const line = `[${d.toLocaleTimeString('ru-RU')}] ${parts.join(' ')}`;
  console.log(line);
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(path.join(LOG_DIR, `${d.toLocaleDateString('sv-SE')}.log`), line + '\n');
}

export class LoginRequired extends Error {
  constructor(url) { super(`Нет входа в аккаунт Microsoft (открылось ${url})`); }
}

export async function launch({ headless = false, lang = 'ru' } = {}) {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'msedge',
    headless,
    locale: LOCALES[lang] ?? LOCALES.ru,
    viewport: headless ? { width: 1366, height: 900 } : null,
  });
  context.setDefaultTimeout(30_000);
  const page = context.pages()[0] ?? await context.newPage();
  return { context, page };
}

// Баннер cookies в Bing: отказываемся от необязательных
export async function dismissBanners(page) {
  const reject = page.locator('#bnp_btn_reject');
  if (await reject.isVisible().catch(() => false)) await reject.click().catch(() => {});
}
