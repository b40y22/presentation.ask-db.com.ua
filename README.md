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
