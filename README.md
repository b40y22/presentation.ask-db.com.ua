# Презентації Ask DB

Вихідники (10 слайдів 1280×720, палітра з лендінгу):

- `ask-db.uk.html` — для прямих клієнтів (пілот: 3 міс. Pro, 1000 питань/міс.);
- `ask-db.en.html` — те саме англійською;
- `ask-db.en.share.html` — для передачі далі: пілот без цифр («Free pilot, terms agreed individually»).

Тарифи — окремий аркуш (1 слайд), щоб зміна цін не чіпала презентації: `pricing.uk.html`, `pricing.en.html`.
Ціни в доларах (рішення 2026-10-02: гривня падає, AI-провайдери рахують у $). Цифри мають збігатися з таблицею `plans`.

Скриншоти — справжні з проду: `shots/` (uk), `shots-en/` (en). На них не має бути пошти користувача.

Зібрати PDF:

    for f in ask-db.*.html; do
      chromium --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="${f%.html}.pdf" "file://$PWD/$f"
    done

Chromium — snap: вихідники мають лежати в `~`, не в `/tmp`. PDF у git не кладемо — копії у vault `Projects/ai/ai-db-assistant/`.

## Відео (`video/`)

Два ролики: `main` (дефолт) і `connect` — як підключити базу; обирає змінна `VIDEO`. На кожен —
`narration-<ролик>.mjs` (текст диктора) і `scenes-<ролик>.mjs` (що робить Playwright), результат — `out/<ролик>/`.
Сценарій і рішення основного — `video/SCRIPT.md`. Ключ ElevenLabs — `video/.env`
(`ELEVENLABS_API_KEY=...`, у git не йде). Музика — поклади трек у `video/music/`, інакше — синтезована заглушка.

    cd video && npm ci && npx playwright install chromium
    npm run narrate                                   # озвучка (кеш у audio/cache — незмінений текст не платний)
    INVITE_URL=<запрошення в Demo-Book> VIDEO_EMAIL=video-NN@ask-db.com.ua \
      BASE_URL=https://app.ask-db.com.ua npm run record   # запис; без BASE_URL — локальний dev
    npm run build                                     # out/main/ask-db-uk.mp4

Кожен запис реєструє нового користувача — запрошення з кількома використаннями, пошта щоразу нова.
Після реєстрації застосунок відкриває сторінку компанії з поштою учасників — запис ріже її (позначка `cut`).

### Ролик «Як підключити базу» (`VIDEO=connect`)

MySQL напряму + PostgreSQL через конектор, далі питання в чаті. Знімається лише на dev — конектор
запускається локально (`docker run`), а в кадрі команда підмінена на прод-вигляд: токен і пароль — крапками,
шлюз `wss://connect.ask-db.com.ua`, образ `askdb/connector:latest`.

Підготовка dev (один раз): компанія «Книгарня «Сторінка»» на тарифі internal, у ній верифікований
користувач `VIDEO_EMAIL`; MySQL і PostgreSQL з базою `bookstore` і користувачем лише на читання `bookstore_ro`,
обидві під іменем `db.storinka.ua` в docker-мережі `askdb-video` (`CONNECTOR_NETWORK`); образ `adb-connector:dev`.

    VIDEO=connect npm run narrate
    VIDEO=connect VIDEO_EMAIL=... VIDEO_PASSWORD=... MYSQL_PASSWORD=... \
      PG_DSN='postgres://bookstore_ro:...@db.storinka.ua:5432/bookstore' npm run record
    VIDEO=connect npm run build                       # out/connect/ask-db-connect-uk.mp4

Підключення попереднього дубля запис переносить у компанію `video-archive` (з `#id` у назві) — не видаляє.
