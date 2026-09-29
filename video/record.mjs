// Записує ролик за scenes-<ролик>.mjs; кожна сцена триває не менше за свою озвучку (спершу `npm run narrate`).
// Пише out/<ролик>/raw.webm, timeline.json (межі сцен і позначки ready/mic/cut, мс) і shots/NN-*.png.
//
//   INVITE_URL=... VIDEO_EMAIL=video-01@ask-db.com.ua npm run record                  # основний
//   VIDEO=connect VIDEO_EMAIL=... VIDEO_PASSWORD=... ... npm run record              # підключення, див. scenes-connect.mjs
//
// BASE_URL — застосунок (дефолт — локальний dev), LANDING_URL — лендінг (дефолт — прод).
import { chromium } from 'playwright'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { LOADING_KEEP, OUT, VIDEO } from './video.mjs'

const BASE_URL = process.env.BASE_URL ?? 'http://ai-db-assistant.local'
const LANDING_URL = process.env.LANDING_URL ?? 'https://ask-db.com.ua'
const EMAIL = process.env.VIDEO_EMAIL

const SIZE = { width: 1600, height: 900 }
const TYPE_DELAY = 45 // мс на символ — людський темп друку
const ANSWER_TIMEOUT = 120_000
const TAIL = 700 // запас після озвучки сцени, мс

if (!EMAIL) {
  console.error('VIDEO_EMAIL обов\'язковий — пошта користувача, від якого знімаємо (лише її видно в кадрі)')
  process.exit(1)
}

const { default: scenes } = await import(`./scenes-${VIDEO}.mjs`)
const narration = JSON.parse(readFileSync(`${OUT}/narration.json`, 'utf8'))
const spoken = (id) => narration[id].duration * 1000

rmSync(`${OUT}/shots`, { recursive: true, force: true })
mkdirSync(`${OUT}/shots`, { recursive: true })

const browser = await chromium.launch({
  // повний Chromium: headless shell ігнорує --unsafely-treat-insecure-origin-as-secure, і мікрофона на dev нема
  channel: 'chromium',
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    // %noloop — файл грає один раз, далі тиша, а не повтор питання
    ...(narration.q1 ? [`--use-file-for-fake-audio-capture=${resolve(narration.q1.file)}%noloop`] : []),
    // мікрофон фронт показує лише на HTTPS/localhost, dev — на http://*.local
    `--unsafely-treat-insecure-origin-as-secure=${BASE_URL}`,
  ],
})
const context = await browser.newContext({
  viewport: SIZE,
  locale: 'uk-UA',
  recordVideo: { dir: `${OUT}/video`, size: SIZE },
})
// Будь-яка пошта, крім VIDEO_EMAIL, у кадр не потрапляє: текст підміняється ще до відмальовування
// (страховка поверх cut — на випадок, якщо застосунок покаже учасників деінде)
await context.addInitScript((keep) => {
  const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g
  const mask = (node) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      // присвоювати лише змінений текст: навіть той самий породжує мутацію — і observer крутиться вічно
      const masked = n.data.replace(EMAIL, (m) => (m === keep ? m : '•••@•••'))
      if (masked !== n.data) n.data = masked
    }
  }
  new MutationObserver((records) => records.forEach((r) => {
    if (r.type === 'characterData') mask(r.target.parentNode ?? r.target)
    r.addedNodes.forEach(mask)
  })).observe(document, { subtree: true, childList: true, characterData: true })
}, EMAIL)
// Кнопка Vue DevTools з dev-збірки — не частина продукту (лише на сторінках застосунку: чорний кадр sync не чіпаємо)
await context.addInitScript(() => location.protocol.startsWith('http') && document.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style')
  style.textContent = '#__vue-devtools-container__, .vue-devtools__anchor { display: none !important }'
  document.head.append(style)
}))
const page = await context.newPage()

const started = Date.now()
const now = () => Date.now() - started
const timeline = []
let current = null

const pause = (ms) => page.waitForTimeout(ms)

// Добиває сцену до потрібної тривалості, рахуючи від anchor (мс від старту запису)
async function holdUntil(anchor, ms) {
  const left = anchor + ms - now()
  if (left > 0) await pause(left)
}

function mark(name) {
  current[name] = now()
}

async function scene(id, name, fn) {
  current = { id, name, at: now() }
  timeline.push(current)
  console.log(`[${(current.at / 1000).toFixed(1)}s] ${id}. ${name}`)
  await fn()
  // Відповіді монтуються від ready − LOADING_KEEP (очікування AI вирізається) — від цієї точки й рахуємо
  const anchor = current.ready ? current.ready - LOADING_KEEP : current.at
  await holdUntil(anchor, spoken(id) + TAIL)
  mark('done')
  await page.screenshot({ path: `${OUT}/shots/${String(id).padStart(2, '0')}-${name}.png` })
}

async function smoothScroll(selector, block) {
  await page.locator(selector).last().evaluate((el, block) => el.scrollIntoView({ behavior: 'smooth', block }), block)
}

// Чекає index-ту таблицю результатів, позначає ready і плавно прокручує відповідь: початок → кінець
async function answer(index, holdMs) {
  await page.locator('.results-wrap').nth(index).waitFor({ timeout: ANSWER_TIMEOUT })
  mark('ready')
  await pause(300)
  await smoothScroll('.message-ai', 'start')
  // друга половина озвучки — докручуємо до кінця таблиці
  await pause(holdMs / 2)
  await smoothScroll('.message-ai', 'end')
}

async function ask(text) {
  await page.locator('textarea').pressSequentially(text, { delay: TYPE_DELAY })
  await pause(600)
  await page.locator('.send-btn').click()
}

async function type(locator, text, delay = TYPE_DELAY) {
  await locator.pressSequentially(text, { delay })
}

// Синхронізація відео з таймлайном: секунда чорного, потім білий. Монтаж шукає кінець чорного
// (blackdetect) і зіставляє з позначкою sync — зсув між записом кадрів і годинником скрипта
// не сталий (dev/прод відрізнялись знаком), а хвіст після close() ще й різної довжини
await page.setContent('<body style="margin:0;background:#000"></body>')
await pause(1000)
await page.evaluate(() => new Promise((done) => {
  document.body.style.background = '#fff'
  requestAnimationFrame(() => requestAnimationFrame(done))
}))
timeline.push({ id: 'sync', at: now() })

try {
  // Усе, що сценарій робить до першої scene(), у монтаж не потрапляє (вхід, підготовка)
  await scenes({
    page, context, scene, mark, pause, holdUntil, spoken, narration, answer, ask, type, smoothScroll,
    current: () => current, BASE_URL, LANDING_URL, EMAIL, TYPE_DELAY, title: 'file://' + resolve('title.html'),
  })
} catch (e) {
  console.error('Зупинився:', e.message)
  await page.screenshot({ path: `${OUT}/shots/error.png` })
  process.exitCode = 1
} finally {
  timeline.push({ id: 'end', at: now() })
  writeFileSync(`${OUT}/timeline.json`, JSON.stringify(timeline, null, 2))
  const video = page.video()
  await context.close()
  await browser.close()
  renameSync(await video.path(), `${OUT}/raw.webm`)
  rmSync(`${OUT}/video`, { recursive: true, force: true })
  console.log(`${OUT}/raw.webm, ${OUT}/timeline.json`)
}
