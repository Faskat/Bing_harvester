// Паузы «как у человека»: обычно в диапазоне, иногда быстрее, изредка — отвлёкся.
// Скорость — множитель всех пауз, задаётся setSpeed() из настроек.

const SPEEDS = { fast: 0.6, normal: 1, slow: 3, stealth: 6 };
export const SPEED_NAMES = Object.keys(SPEEDS);

let speed = 1;
export function setSpeed(name) {
  speed = SPEEDS[name] ?? 1;
}

// Секунды [от, до] при обычной скорости
export const T = {
  page: [6, 10],          // побыть на странице
  beforeSearch: [3, 6],   // осмотреться на bing.com перед вводом
  betweenSearches: [4, 8],
  afterCardClick: [1.5, 4],
  quizRead: [2.5, 6],     // «прочитать вопрос»
  claimSettle: [2, 4.5],
  resultDwell: [2, 6],    // после перехода на найденный сайт
};

const tri = (lo, hi) => lo + ((Math.random() + Math.random()) / 2) * (hi - lo);

export function humanMs([min, max], { scaled = true } = {}) {
  const p = Math.random();
  const s = p < 0.8 ? tri(min, max)            // 80% — обычно
    : p < 0.95 ? tri(min * 0.3, min * 0.7)     // 15% — быстро
    : tri(max, max * 2);                       // 5% — отвлёкся
  return Math.round(s * 1000 * (scaled ? speed : 1));
}

export const wait = (range, opts) => new Promise(r => setTimeout(r, humanMs(range, opts)));
