// Викторины и опросы ежедневного набора. Они открываются обычной выдачей Bing,
// а семейств разметки у Bing несколько — поэтому описаны таблицей.

import { log, rand } from './lib.mjs';
import { wait, T } from './timing.mjs';

const MODULES = [
  // Викторина ежедневного набора: .btom_card, прогресс «1/3»
  { kind: 'quiz', card: '.btom_card', options: '.btom_opts', progress: '.btq_lbl', finished: null },
  // «Bing news quiz»: после ответа показывает разбор и ждёт «Далее», в конце — итог .btq_sumP
  { kind: 'quiz', card: '.btq_main', options: '.btq_opts', progress: '.btq_lbl', finished: '.btq_sumP' },
  // Опрос: один вопрос, после голоса — проценты
  { kind: 'poll', card: '.btp_card', options: '.btp_choices', progress: null, finished: '.btp_voted, .btp_percentage, .btp_selected' },
];
const MAX_ROUNDS = 15;

// Что сейчас на странице. Нажимаемые элементы помечаем атрибутами, чтобы кликнуть их настоящим кликом
function inspect(page) {
  return page.evaluate(modules => {
    const shown = el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      // Между вопросами следующая карточка уже в DOM, но спрятана — её варианты трогать нельзя
      return el.checkVisibility?.({ checkVisibilityCSS: true, visibilityProperty: true }) !== false;
    };
    const enabled = el => {
      for (let n = el, d = 0; n && d < 3; n = n.parentElement, d++) {
        if (n.getAttribute('aria-disabled') === 'true' || n.hasAttribute('disabled')) return false;
      }
      return true;
    };
    document.querySelectorAll('[data-rb-opt], [data-rb-next]').forEach(el => {
      el.removeAttribute('data-rb-opt');
      el.removeAttribute('data-rb-next');
    });

    for (const m of modules) {
      const card = document.querySelector(m.card);
      if (!card) continue;

      const finished = !!m.finished && [...card.querySelectorAll(m.finished)].some(shown);
      const scope = card.querySelector(m.options);
      let options = [];
      if (scope && !finished) {
        for (const sel of ['.btom_opt a[href], .btq_opt a[href], .btp_choice a[href]', 'a[href]', '[role="button"], button']) {
          options = [...scope.querySelectorAll(sel)].filter(el => shown(el) && enabled(el));
          if (options.length) break;
        }
      }
      options.forEach((el, i) => el.setAttribute('data-rb-opt', String(i)));

      let next = false;
      if (m.kind === 'quiz' && !options.length && !finished) {
        const el = [...card.querySelectorAll('.btq_nxtQues button, .btq_nxtQues a[href]')].find(e => shown(e) && enabled(e))
          ?? [...card.querySelectorAll('button, [role="button"], a[href]')].find(e => shown(e) && enabled(e)
            && [e.getAttribute('title'), e.getAttribute('aria-label'), e.textContent]
              .some(l => /^(next|далее|следующий вопрос|далі|наступне запитання)$/i.test((l ?? '').replace(/\s+/g, ' ').trim())));
        if (el) {
          el.setAttribute('data-rb-next', '1');
          next = true;
        }
      }

      const lbl = m.progress ? card.querySelector(m.progress)?.textContent ?? '' : '';
      const p = lbl.match(/(\d+)\s*\/\s*(\d+)/);
      return {
        kind: m.kind,
        options: options.length,
        next,
        finished,
        progress: p ? { current: +p[1], total: +p[2] } : null,
      };
    }
    return null;
  }, MODULES);
}

// 'none' — это не викторина; 'done' — отвечено; 'already' — уже пройдена; 'unknown' — разметка не разобрана
export async function answerQuiz(page) {
  let rounds = 0;
  let advances = 0;
  let absent = 0;
  let stale = 0;
  let answered = null;

  while (rounds < MAX_ROUNDS && advances < MAX_ROUNDS) {
    await wait(T.quizRead);
    const s = await inspect(page).catch(() => undefined); // undefined — страница как раз переходит
    if (s === undefined) continue;

    const touched = rounds > 0 || advances > 0;
    if (s === null) {
      if (!touched) return 'none';
      // После последнего ответа Bing подменяет выдачу обычной — два пустых чтения подряд значат конец
      if (++absent >= 2) return 'done';
      continue;
    }
    absent = 0;

    if (s.finished) return touched ? 'done' : 'already';

    if (s.options > 0) {
      // Прочитали страницу до перехода — это ещё тот вопрос, на который уже ответили
      if (answered && s.progress && s.progress.current === answered.current && stale++ < 5) continue;
      stale = 0;

      await page.locator(`[data-rb-opt="${rand(0, s.options - 1)}"]`).click({ timeout: 10_000 }).catch(() => {});
      rounds++;
      log(`  ${s.kind === 'poll' ? 'опрос: голос отдан' : `викторина: ответ ${s.progress ? `${s.progress.current}/${s.progress.total}` : rounds}`}`);
      if (s.kind === 'poll') return 'done';
      if (s.progress && s.progress.current >= s.progress.total) return 'done';
      answered = s.progress;
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      continue;
    }

    if (s.next) {
      await page.locator('[data-rb-next]').first().click({ timeout: 10_000 }).catch(() => {});
      advances++;
      // Разбор уже подписан номером следующего вопроса — сравнивать не с чем
      answered = null;
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      continue;
    }

    return touched ? 'done' : 'unknown';
  }
  return 'done';
}
