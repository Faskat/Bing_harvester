import { pick } from './lib.mjs';

const cities = ['Москве', 'Киеве', 'Варшаве', 'Берлине', 'Праге', 'Риге', 'Вильнюсе', 'Тбилиси', 'Алматы',
  'Стамбуле', 'Токио', 'Лондоне', 'Париже', 'Барселоне', 'Вене', 'Хельсинки', 'Дубае', 'Сеуле'];
const dishes = ['борща', 'сырников', 'пасты карбонара', 'плова', 'шакшуки', 'рамена', 'тирамису', 'хачапури',
  'гречки с грибами', 'чизкейка', 'лазаньи', 'омлета', 'блинов на молоке', 'тыквенного супа', 'фалафеля'];
const howto = ['почистить клавиатуру', 'выбрать монитор', 'ускорить windows 11', 'научиться рисовать',
  'заварить пуэр', 'выучить японский', 'настроить роутер', 'убрать накипь в чайнике', 'начать бегать',
  'сделать резервную копию телефона', 'выбрать видеокарту', 'прокачать память', 'сварить кофе в турке'];
const things = ['наушники sony wh-1000xm6', 'механическая клавиатура', 'кресло для компьютера', 'робот пылесос',
  'электросамокат', 'игровая мышь', 'smart часы', 'аэрогриль', 'портативная колонка', 'графический планшет'];
const genres = ['фантастика', 'детектив', 'аниме', 'комедия', 'документальный фильм', 'сериал триллер', 'мультфильм'];
const topics = ['черные дыры', 'история римской империи', 'как работает gps', 'почему небо голубое',
  'самые высокие горы мира', 'как появилась луна', 'квантовый компьютер простыми словами', 'марианская впадина',
  'кто изобрел интернет', 'сколько живут черепахи', 'северное сияние', 'как спят дельфины', 'великая китайская стена'];
const games = ['minecraft', 'terraria', 'stardew valley', 'elden ring', 'factorio', 'hollow knight', 'baldurs gate 3',
  'cyberpunk 2077', 'satisfactory', 'rimworld', 'hades 2', 'dota 2'];
const foods = ['банане', 'авокадо', 'гречке', 'твороге', 'яблоке', 'орехах', 'рисе', 'курице', 'сыре', 'хумусе'];
const words = ['serendipity', 'ubiquitous', 'wanderlust', 'resilience', 'ephemeral', 'benevolent', 'quintessential'];

const templates = [
  () => `погода в ${pick(cities)} на выходные`,
  () => `рецепт ${pick(dishes)}`,
  () => `как ${pick(howto)}`,
  () => `${pick(things)} отзывы`,
  () => `${pick(genres)} что посмотреть`,
  () => pick(topics),
  () => `${pick(games)} гайд для новичков`,
  () => `сколько калорий в ${pick(foods)}`,
  () => `перевод слова ${pick(words)}`,
  () => `что посмотреть в ${pick(cities)}`,
  () => `${pick(games)} лучшие моды`,
];

const templatesEn = [
  () => `weather in ${pick(['London', 'New York', 'Tokyo', 'Berlin', 'Sydney', 'Toronto', 'Madrid'])} this weekend`,
  () => `${pick(['pancake', 'lasagna', 'ramen', 'banana bread', 'chili', 'shakshuka', 'tiramisu'])} recipe`,
  () => `how to ${pick(['clean a keyboard', 'speed up windows 11', 'learn japanese', 'start running', 'brew pour over coffee', 'choose a monitor'])}`,
  () => `${pick(games)} beginner guide`,
  () => `${pick(['sony wh-1000xm6', 'mechanical keyboard', 'robot vacuum', 'air fryer', 'drawing tablet'])} review`,
  () => pick(['how do black holes form', 'why is the sky blue', 'tallest mountains in the world', 'how does gps work',
    'how do dolphins sleep', 'northern lights forecast', 'who invented the internet']),
];

// Тренды Google берём для страны выбранного языка
const TRENDS_GEO = { ru: 'RU', uk: 'UA', en: 'US' };

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// Свежие тренды Google (если доступны) + сгенерированные запросы
export async function getQueries(page, count, lang = 'ru') {
  const out = new Set();
  const own = lang === 'en' ? templatesEn : templates;
  try {
    const res = await page.request.get(`https://trends.google.com/trending/rss?geo=${TRENDS_GEO[lang] ?? 'RU'}`, { timeout: 15_000 });
    if (res.ok()) {
      const xml = await res.text();
      for (const m of xml.matchAll(/<item>\s*<title>([^<]+)<\/title>/g)) out.add(decode(m[1]).trim());
    }
  } catch {}
  for (let tries = 0; out.size < count * 2 && tries < count * 20; tries++) out.add(pick(own)());

  const list = [...out];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, count);
}
