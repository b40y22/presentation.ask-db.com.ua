// Ролик «Як підключити базу»: типи БД → MySQL напряму → PostgreSQL через конектор → питання → титр.
// Знімається лише на локальному dev: конектор запускається тут же, в docker, до dev-шлюзу.
//
// Підготовка dev (разова, див. README):
//   - користувач VIDEO_EMAIL з підтвердженою поштою, власник компанії на тарифі internal
//     (особисті підключення завжди на free — там дозволене лише одне);
//   - MySQL bookstore з read-only користувачем, досяжна з php-контейнера як MYSQL_HOST;
//   - PostgreSQL bookstore з read-only користувачем у docker-мережі CONNECTOR_NETWORK.
//
//   VIDEO=connect VIDEO_EMAIL=video-connect@ask-db.com.ua VIDEO_PASSWORD=... \
//     MYSQL_PASSWORD=... PG_DSN='postgres://bookstore_ro:...@db.storinka.ua:5432/bookstore' npm run record
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { script } from './video.mjs'

const { QUESTIONS } = script

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback
  if (value === undefined) throw new Error(`${name} обов'язковий`)
  return value
}
const PASSWORD = env('VIDEO_PASSWORD')
const ORGANIZATION = env('VIDEO_ORGANIZATION', 'Книгарня «Сторінка»')
const MYSQL = {
  host: env('MYSQL_HOST', 'db.storinka.ua'),
  database: env('MYSQL_DATABASE', 'bookstore'),
  user: env('MYSQL_USER', 'bookstore_ro'),
  password: env('MYSQL_PASSWORD'),
}
const PG_DSN = env('PG_DSN')
const CONNECTOR_NETWORK = env('CONNECTOR_NETWORK', 'askdb-video')
const CONNECTOR_NAME = 'askdb-video-connector'
// Інфра-репо з docker-compose dev-стеку (архівування — через artisan tinker)
const DEV_DIR = env('DEV_DIR', resolve('../../..'))
// У кадрі — команда такою, як її бачить клієнт на проді: без dev-рядків і з прихованим токеном
const SHOWN_GATEWAY = env('SHOWN_GATEWAY', 'wss://connect.ask-db.com.ua/v1/connect')
const SHOWN_IMAGE = 'askdb/connector:latest'
// Що клієнт вписує в DB_DSN на своєму сервері — пароль у кадрі зірочками
const SHOWN_DSN = PG_DSN.replace(/:\/\/([^:]+):[^@]*@/, '://$1:••••••••@')

function publicCommand(command) {
  return command
    .replace(/(CONNECTOR_TOKEN=)\S+/, '$1••••••••••••••••')
    .replace(/(GATEWAY_URL=)\S+/, `$1${SHOWN_GATEWAY}`)
    .replace(/ \\\n\s*--add-host \S+/, '')
    .replace(/ \\\n\s*-e CONNECTOR_INSECURE_TLS=\S+/, '')
    .replace(/\S+$/, SHOWN_IMAGE)
}

// Справжній запуск: токен і шлюз — з команди майстра, DSN — наш; секрети йдуть через env, не в аргументах
function runConnector(command) {
  const token = command.match(/CONNECTOR_TOKEN=(\S+)/)[1]
  const gateway = command.match(/GATEWAY_URL=(\S+)/)[1]
  const hosts = [...command.matchAll(/--add-host (\S+)/g)].flatMap((m) => ['--add-host', m[1]])
  const insecure = /CONNECTOR_INSECURE_TLS=true/.test(command) ? ['-e', 'CONNECTOR_INSECURE_TLS=true'] : []
  const image = command.trim().split(/\s+/).at(-1)
  execFileSync('docker', ['rm', '-f', CONNECTOR_NAME], { stdio: 'ignore' })
  execFileSync('docker', ['run', '-d', '--name', CONNECTOR_NAME, '--network', CONNECTOR_NETWORK, ...hosts, ...insecure,
    '-e', 'CONNECTOR_TOKEN', '-e', 'GATEWAY_URL', '-e', 'DB_DSN', image],
  { stdio: 'ignore', env: { ...process.env, CONNECTOR_TOKEN: token, GATEWAY_URL: gateway, DB_DSN: PG_DSN } })
}

// Підключення попереднього дубля переносимо в архівну компанію з #id у назві (не видаляємо): назви унікальні в межах автора,
// а в списку баз у чаті — зайві рядки. Архівна компанія без учасників, створюється за потреби.
function archiveConnections() {
  const php = `
    $org = \\App\\Models\\Organization::where("name", getenv("VIDEO_ORGANIZATION"))->whereHas("users", fn ($q) => $q->where("email", getenv("VIDEO_EMAIL")))->firstOrFail();
    $archive = \\App\\Models\\Organization::firstOrCreate(["slug" => "video-archive"], ["name" => "video-archive", "is_active" => false]);
    echo \\App\\Models\\DatabaseConnection::whereIn("organization_id", [$org->id, $archive->id])->where("name", "not like", "% #%")->update(["organization_id" => $archive->id, "name" => \\DB::raw("CONCAT(name, ' #', id)")]), " archived", PHP_EOL;`
  const out = execFileSync('docker', ['compose', 'exec', '-T', '-e', 'VIDEO_ORGANIZATION', '-e', 'VIDEO_EMAIL', 'php', 'php', 'artisan', 'tinker', `--execute=${php}`],
    { cwd: DEV_DIR, encoding: 'utf8', env: { ...process.env, VIDEO_ORGANIZATION: ORGANIZATION } })
  console.log(`підключень попереднього дубля: ${out.trim().split('\n').at(-1)}`)
}

// Термінал поверх майстра: «клієнт» вставляє команду на своєму сервері
async function showTerminal(page, command, typeMs) {
  const shown = publicCommand(command).replace(/DB_DSN='[^']*'/, `DB_DSN='${SHOWN_DSN}'`)
  await page.evaluate(({ shown, typeMs }) => new Promise((done) => {
    const box = document.createElement('div')
    box.id = 'video-terminal'
    box.style.cssText = 'position:fixed;left:50%;bottom:48px;transform:translate(-50%,24px);width:980px;opacity:0;' +
      'transition:opacity .35s,transform .35s;background:#0f172a;border-radius:14px;box-shadow:0 24px 60px rgba(15,23,42,.45);' +
      'font:15px/1.6 "JetBrains Mono","DejaVu Sans Mono",monospace;color:#e2e8f0;z-index:99999;overflow:hidden'
    box.innerHTML = '<div style="display:flex;gap:8px;align-items:center;padding:10px 14px;background:#1e293b;color:#94a3b8;font-size:13px">' +
      '<span style="width:12px;height:12px;border-radius:50%;background:#ef4444"></span>' +
      '<span style="width:12px;height:12px;border-radius:50%;background:#f59e0b"></span>' +
      '<span style="width:12px;height:12px;border-radius:50%;background:#22c55e"></span>' +
      '<span style="margin-left:10px">olena@db-server: ~</span></div>' +
      '<pre style="margin:0;padding:16px 20px 20px;white-space:pre-wrap"><span style="color:#22c55e">$ </span><span id="video-terminal-text"></span><span id="video-terminal-cursor">▋</span></pre>'
    document.body.append(box)
    requestAnimationFrame(() => { box.style.opacity = '1'; box.style.transform = 'translate(-50%,0)' })
    const text = box.querySelector('#video-terminal-text')
    const step = Math.max(1, Math.round(shown.length / (typeMs / 16)))
    let i = 0
    const tick = () => {
      i = Math.min(shown.length, i + step)
      text.textContent = shown.slice(0, i)
      if (i < shown.length) requestAnimationFrame(tick)
      else setTimeout(() => {
        text.insertAdjacentHTML('afterend', '\n<span style="color:#94a3b8">3f9c1e27b04d5a61c8e2f7a9d3b5c0e4f1a6b8d2c9e7f3a5b1c4d6e8f0a2b3c5</span>\n<span style="color:#22c55e">$ </span>')
        done()
      }, 350)
    }
    setTimeout(tick, 400)
  }), { shown, typeMs })
}

async function hideTerminal(page) {
  await page.evaluate(() => {
    const box = document.getElementById('video-terminal')
    box.style.opacity = '0'
    box.style.transform = 'translate(-50%,24px)'
    setTimeout(() => box.remove(), 400)
  })
}

export default async function ({ page, context, scene, mark, pause, holdUntil, spoken, answer, ask, type, current, BASE_URL, EMAIL, title }) {
  // Команда в майстрі — одразу в «продовому» вигляді: dev-рядки й токен не встигають відмалюватись
  await context.addInitScript(({ gateway, image }) => {
    const fix = (s) => s
      .replace(/(CONNECTOR_TOKEN=)\S+/, '$1••••••••••••••••')
      .replace(/(GATEWAY_URL=)\S+/, `$1${gateway}`)
      .replace(/ \\\n\s*--add-host \S+/, '')
      .replace(/ \\\n\s*-e CONNECTOR_INSECURE_TLS=\S+/, '')
      .replace(/adb-connector:dev/, image)
    const mask = (node) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.data.includes('CONNECTOR_TOKEN=') || n.data.includes('adb-connector:dev')) {
          const fixed = fix(n.data)
          if (fixed !== n.data) n.data = fixed
        }
      }
    }
    new MutationObserver((records) => records.forEach((r) => {
      if (r.type === 'characterData') mask(r.target.parentNode ?? r.target)
      r.addedNodes.forEach(mask)
    })).observe(document, { subtree: true, childList: true, characterData: true })
  }, { gateway: SHOWN_GATEWAY, image: SHOWN_IMAGE })

  // ---- Поза кадром: прибирання після попереднього дубля і вхід ----
  execFileSync('docker', ['rm', '-f', CONNECTOR_NAME], { stdio: 'ignore' })
  archiveConnections()
  await page.goto(BASE_URL + '/auth')
  const form = page.locator('form.auth-form')
  await form.locator('input[type=email]').fill(EMAIL)
  await form.locator('input[type=password]').fill(PASSWORD)
  await form.locator('button[type=submit]').click()
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'))

  const wizard = async () => {
    await page.goto(BASE_URL + '/connect')
    await page.locator('.db-card').first().waitFor()
    await pause(400)
  }
  const card = (name) => page.locator('.db-card', { hasText: name }).first()
  const footer = () => page.locator('.wizard-card__footer-right:visible')
  const params = () => page.locator('.connection-form:visible')

  await wizard()

  await scene(1, 'db-types', async () => {
    await pause(1200)
    await card('PostgreSQL').hover()
    await pause(900)
    await card('ClickHouse').hover()
    await pause(900)
    await card('MySQL').hover()
    await pause(300)
    await card('MySQL').click()
  })

  await scene(2, 'mysql-direct', async () => {
    await footer().locator('.btn--primary').click()
    const f = params()
    await f.locator('input').first().waitFor()
    await type(f.locator('input').first(), 'Книгарня — MySQL')
    // підпис опції залежить від перекладу — беремо ту, де є назва компанії
    const value = await f.locator('select option', { hasText: ORGANIZATION }).first().getAttribute('value')
    await f.locator('select').selectOption(value)
    await type(f.locator('input[placeholder]').nth(1), MYSQL.host)
    await type(f.locator('input[placeholder="my_database"]'), MYSQL.database)
    await type(f.locator('input[placeholder="root"]'), MYSQL.user)
    await type(f.locator('input[type=password]'), MYSQL.password, 12)
    await pause(300)
    await footer().locator('.btn--outline-accent').click()
    await page.locator('.connection-banner--success').waitFor({ timeout: 20_000 })
    await pause(1500)
  })
  // зберегти — поза кадром: далі чат з першим підключенням, у ролику він не потрібен
  await footer().locator('.btn--primary').click()
  await page.waitForURL((url) => !url.pathname.startsWith('/connect'), { timeout: 20_000 })

  await wizard()
  await card('PostgreSQL').click()
  await footer().locator('.btn--primary').click()
  await params().locator('input').first().waitFor()
  await pause(300)

  let command = null
  await scene(3, 'pg-connector', async () => {
    const f = params()
    await pause(600)
    await type(f.locator('input').first(), 'Книгарня — PostgreSQL')
    const value = await f.locator('select option', { hasText: ORGANIZATION }).first().getAttribute('value')
    await f.locator('select').selectOption(value)
    await holdUntil(current().at, spoken(3) - 1500)
    const issued = page.waitForResponse((r) => r.url().includes('/connector-token') && r.request().method() === 'POST')
    await footer().locator('.btn--primary').click()
    command = (await (await issued).json()).data.command
    await page.locator('.connector-setup__command').waitFor()
  })

  await scene(4, 'connector-run', async () => {
    await pause(500)
    await showTerminal(page, command, 3500)
    runConnector(command)
    await holdUntil(current().at, spoken(4) - 200)
    await hideTerminal(page)
  })

  await scene(5, 'connector-online', async () => {
    await page.locator('.connector-setup__found').waitFor({ timeout: 60_000 })
    await pause(300)
    await page.locator('.connector-setup__found').scrollIntoViewIfNeeded()
  })
  await footer().locator('.btn--primary').click()
  await page.waitForURL((url) => !url.pathname.startsWith('/connect'), { timeout: 20_000 })
  await page.locator('textarea').waitFor()
  // у чаті — щойно підключений PostgreSQL
  await page.locator('.db-selector').click()
  await page.locator('.db-dropdown li', { hasText: 'PostgreSQL' }).first().click()
  await page.locator('.connection-status', { hasText: /postgres/i }).waitFor({ timeout: 30_000 })
  await pause(600)

  await scene(6, 'question', () => ask(QUESTIONS[0]))
  await scene(7, 'answer', () => answer(0, spoken(7)))

  await scene(8, 'final', async () => {
    await page.goto(title)
  })
  execFileSync('docker', ['rm', '-f', CONNECTOR_NAME], { stdio: 'ignore' })
}
