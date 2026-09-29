// Записує відео за сценарієм SCRIPT.md: реєстрація за запрошенням → питання голосом → два текстом → титр.
// Кожна сцена триває не менше за свою озвучку (out/narration.json — спершу `npm run narrate`).
// Пише out/raw.webm, out/timeline.json (межі сцен і позначки ready/mic, мс) і out/shots/NN-*.png.
//
//   INVITE_URL=... VIDEO_EMAIL=video-01@ask-db.com.ua npm run record
//
// BASE_URL — застосунок (дефолт — локальний dev), LANDING_URL — лендінг (дефолт — прод).
import { chromium } from 'playwright'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { LOADING_KEEP, QUESTIONS } from './narration.mjs'

const BASE_URL = process.env.BASE_URL ?? 'http://ai-db-assistant.local'
const LANDING_URL = process.env.LANDING_URL ?? 'https://ask-db.com.ua'
const INVITE_URL = process.env.INVITE_URL
const EMAIL = process.env.VIDEO_EMAIL
const NAME = process.env.VIDEO_NAME ?? 'Олена'
// Пароль одноразового користувача відео — нікому не потрібен, в кадрі він під зірочками
const PASSWORD = randomBytes(12).toString('base64url')

const SIZE = { width: 1600, height: 900 }
const TYPE_DELAY = 45 // мс на символ — людський темп друку
const ANSWER_TIMEOUT = 120_000
const TAIL = 700 // запас після озвучки сцени, мс

if (!INVITE_URL || !EMAIL) {
  console.error('INVITE_URL і VIDEO_EMAIL обов\'язкові')
  process.exit(1)
}

const narration = JSON.parse(readFileSync('out/narration.json', 'utf8'))
const spoken = (id) => narration[id].duration * 1000

rmSync('out/shots', { recursive: true, force: true })
mkdirSync('out/shots', { recursive: true })

const browser = await chromium.launch({
  // повний Chromium: headless shell ігнорує --unsafely-treat-insecure-origin-as-secure, і мікрофона на dev нема
  channel: 'chromium',
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    // %noloop — файл грає один раз, далі тиша, а не повтор питання
    `--use-file-for-fake-audio-capture=${resolve(narration.q1.file)}%noloop`,
    // мікрофон фронт показує лише на HTTPS/localhost, dev — на http://*.local
    `--unsafely-treat-insecure-origin-as-secure=${BASE_URL}`,
  ],
})
const context = await browser.newContext({
  viewport: SIZE,
  locale: 'uk-UA',
  recordVideo: { dir: 'out/video', size: SIZE },
})
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
  await page.screenshot({ path: `out/shots/${String(id).padStart(2, '0')}-${name}.png` })
}

async function smoothScroll(selector, block) {
  await page.locator(selector).last().evaluate((el, block) => el.scrollIntoView({ behavior: 'smooth', block }), block)
}

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

try {
  await scene(1, 'landing', async () => {
    await page.goto(LANDING_URL)
    await pause(1500)
    await page.evaluate(() => window.scrollTo({ top: 520, behavior: 'smooth' }))
  })

  await scene(2, 'invite', async () => {
    await page.goto(INVITE_URL)
    await page.locator('form.auth-form').waitFor()
  })

  await scene(3, 'register', async () => {
    const form = page.locator('form.auth-form')
    await form.locator('input[type=text]').pressSequentially(NAME, { delay: TYPE_DELAY })
    await form.locator('input[type=email]').pressSequentially(EMAIL, { delay: TYPE_DELAY })
    const passwords = form.locator('input[type=password]')
    await passwords.nth(0).pressSequentially(PASSWORD, { delay: 25 })
    await passwords.nth(1).fill(PASSWORD)
    // спершу договорює диктор, а тоді клік: після реєстрації відкривається сторінка компанії
    // зі списком учасників і їхньою поштою — у відео її не має бути, монтаж ріже сцену на позначці cut
    await holdUntil(current.at, spoken(3) + TAIL)
    await form.locator('button[type=submit]').click()
    mark('cut')
    await page.waitForURL(/\/organizations\//)
    await page.goto(BASE_URL + '/')
    await page.locator('textarea').waitFor()
    await pause(300)
  })

  await scene(4, 'chat-empty', async () => {})

  await scene(5, 'voice-question', async () => {
    // спершу диктор договорює, потім «користувач» питає голосом
    await pause(spoken(5) + 300)
    await page.locator('.mic-btn').click()
    mark('mic')
    await pause(narration.q1.duration * 1000 + 200)
    await page.locator('.mic-btn').click()
    await page.waitForFunction(() => document.querySelector('textarea')?.value.trim().length > 0, null, { timeout: 30_000 })
    await pause(1500)
    await page.locator('.send-btn').click()
  })

  await scene(6, 'answer-1', () => answer(0, spoken(6)))
  await scene(7, 'question-2', () => ask(QUESTIONS[1]))
  await scene(8, 'answer-2', () => answer(1, spoken(8)))
  await scene(9, 'question-3', () => ask(QUESTIONS[2]))
  await scene(10, 'answer-3', () => answer(2, spoken(10)))

  await scene(11, 'final', async () => {
    await page.goto('file://' + resolve('title.html'))
  })
} catch (e) {
  console.error('Зупинився:', e.message)
  await page.screenshot({ path: 'out/shots/error.png' })
  process.exitCode = 1
} finally {
  timeline.push({ id: 'end', at: now() })
  writeFileSync('out/timeline.json', JSON.stringify(timeline, null, 2))
  const video = page.video()
  await context.close()
  await browser.close()
  renameSync(await video.path(), 'out/raw.webm')
  rmSync('out/video', { recursive: true, force: true })
  console.log('out/raw.webm, out/timeline.json')
}
