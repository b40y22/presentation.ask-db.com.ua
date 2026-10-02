// Основний ролик: реєстрація за запрошенням → питання голосом → два текстом → титр (див. SCRIPT.md).
//
//   INVITE_URL=<запрошення в Demo-Book> VIDEO_EMAIL=video-NN@ask-db.com.ua npm run record
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { script } from './video.mjs'

const { QUESTIONS, EXCEL_QUESTION } = script

// Файл для сцен 11–13: 50 товарів × 20 колонок (артикул, ціни, залишки, дати, статус…)
const EXCEL_FILE = resolve('Товари.xlsx')

const INVITE_URL = process.env.INVITE_URL
const NAME = process.env.VIDEO_NAME ?? 'Олена'
// Пароль одноразового користувача відео — нікому не потрібен, в кадрі він під зірочками
const PASSWORD = randomBytes(12).toString('base64url')

export default async function ({ page, scene, mark, pause, holdUntil, spoken, narration, answer, ask, type, current, BASE_URL, LANDING_URL, EMAIL, title }) {
  if (!INVITE_URL) throw new Error('INVITE_URL обов\'язковий')

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
    await type(form.locator('input[type=text]'), NAME)
    await type(form.locator('input[type=email]'), EMAIL)
    const passwords = form.locator('input[type=password]')
    await type(passwords.nth(0), PASSWORD, 25)
    await passwords.nth(1).fill(PASSWORD)
    // спершу договорює диктор, а тоді клік: після реєстрації відкривається сторінка компанії
    // зі списком учасників і їхньою поштою — у відео її не має бути, монтаж ріже сцену на позначці cut
    await holdUntil(current().at, spoken(3) + 700)
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

  // Без бази: Excel-файл замість підключення. Файл розбирається у браузері, на сервер іде лише схема
  await scene(11, 'excel-pick', async () => {
    await page.goto(BASE_URL + '/connect')
    await page.locator('.db-card').first().waitFor()
    await pause(900)
    // картка «Excel / CSV» вибрана за замовчуванням
    await page.getByRole('button', { name: /Далі/ }).click()
    await pause(500)
    await page.locator('input[type=file]').setInputFiles(EXCEL_FILE)
    await page.locator('.lf-file').waitFor({ timeout: 30_000 })
  })

  await scene(12, 'excel-question', async () => {
    await page.getByRole('button', { name: /Створити підключення/ }).click()
    await page.waitForURL(BASE_URL + '/')
    await page.locator('textarea').waitFor()
    await pause(600)
    await ask(EXCEL_QUESTION)
  })

  await scene(13, 'excel-answer', () => answer(0, spoken(13)))

  await scene(14, 'final', async () => {
    await page.goto(title)
  })
}
