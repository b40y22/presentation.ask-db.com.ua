// Спільне для обох роликів. Який саме збираємо — VIDEO: main (дефолт, основний) або connect (підключення бази).
// У кожного свій текст (narration-<ролик>.mjs), сценарій запису (scenes-<ролик>.mjs), теки out/<ролик> і audio/<ролик>.

export const VIDEOS = ['main', 'connect']
export const VIDEO = process.env.VIDEO ?? 'main'
if (!VIDEOS.includes(VIDEO)) throw new Error(`VIDEO=${VIDEO}: відомі ролики — ${VIDEOS.join(', ')}`)

export const OUT = `out/${VIDEO}`
export const AUDIO = `audio/${VIDEO}`
export const OUTPUT = `${OUT}/ask-db-${VIDEO === 'main' ? '' : `${VIDEO}-`}uk.mp4`

// SCENES, QUESTIONS, VOICE_QUESTION (питання голосом або null)
export const script = await import(`./narration-${VIDEO}.mjs`)

export const NARRATOR = { voice: 'JBFqnCBsd6RMkjVDRZzb', name: 'George' }
export const ASKER = { voice: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah' }
export const MODEL = 'eleven_v3'
export const SEED = 42

// Скільки «Обробляю запит…» лишається в кадрі перед відповіддю, мс; решта очікування AI вирізається
export const LOADING_KEEP = 1200

export const sayText = (scene) => scene.phrases.map((p) => p.say ?? p.sub).join(' ')
