# Презентації Ask DB

Вихідники (10 слайдів 1280×720, палітра з лендінгу):

- `ask-db.uk.html` — для прямих клієнтів (пілот: 3 міс. Pro, 1000 питань/міс.);
- `ask-db.en.html` — те саме англійською;
- `ask-db.en.share.html` — для передачі далі: пілот без цифр («Free pilot, terms agreed individually»).

Скриншоти — справжні з проду: `shots/` (uk), `shots-en/` (en). На них не має бути пошти користувача.

Зібрати PDF:

    for f in ask-db.*.html; do
      chromium --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="${f%.html}.pdf" "file://$PWD/$f"
    done

Chromium — snap: вихідники мають лежати в `~`, не в `/tmp`. PDF у git не кладемо — копії у vault `Projects/ai/ai-db-assistant/`.

## Відео (`video/`)

Сценарій і рішення — `video/SCRIPT.md`, текст диктора — `video/narration.mjs`. Ключ ElevenLabs — `video/.env`
(`ELEVENLABS_API_KEY=...`, у git не йде). Музика — поклади трек у `video/music/`, інакше — синтезована заглушка.

    cd video && npm ci && npx playwright install chromium
    npm run narrate                                   # озвучка (кеш у audio/cache — незмінений текст не платний)
    INVITE_URL=<запрошення в Demo-Book> VIDEO_EMAIL=video-NN@ask-db.com.ua \
      BASE_URL=https://app.ask-db.com.ua npm run record   # запис; без BASE_URL — локальний dev
    npm run build                                     # out/ask-db-uk.mp4

Кожен запис реєструє нового користувача — запрошення з кількома використаннями, пошта щоразу нова.
Після реєстрації застосунок відкриває сторінку компанії з поштою учасників — запис ріже її (позначка `cut`).
