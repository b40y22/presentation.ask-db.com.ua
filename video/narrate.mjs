// Озвучує диктора (по сцені — один запит з таймкодами) і питання 1 голосом «користувача».
// Кеш — audio/cache/<hash>.json: незмінений текст повторно не озвучується (кредити ElevenLabs).
// Пише audio/scene-NN.mp3, audio/q1.wav (для фейкового мікрофона) і out/narration.json.
//
//   npm run narrate
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { ASKER, MODEL, NARRATOR, QUESTIONS, SCENES, SEED, sayText } from './narration.mjs'

const KEY = process.env.ELEVENLABS_API_KEY
if (!KEY) {
  console.error('ELEVENLABS_API_KEY не задано (video/.env)')
  process.exit(1)
}

mkdirSync('audio/cache', { recursive: true })
mkdirSync('out', { recursive: true })

async function tts(voice, text) {
  const body = { text, model_id: MODEL, language_code: 'uk', seed: SEED }
  const hash = createHash('sha256').update(JSON.stringify({ voice, ...body })).digest('hex').slice(0, 16)
  const cached = `audio/cache/${hash}.json`
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, 'utf8'))

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`)
  const data = await res.json()
  console.log(`  озвучено ${text.length} симв.`)
  writeFileSync(cached, JSON.stringify(data))
  return data
}

function duration(file) {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString())
}

// Межі фраз у секундах: кінець останнього символу фрази за таймкодами TTS
function phraseTimes(scene, alignment) {
  const ends = alignment.character_end_times_seconds
  const starts = alignment.character_start_times_seconds
  let pos = 0
  return scene.phrases.map((p) => {
    const say = p.say ?? p.sub
    const from = pos
    const to = pos + say.length - 1
    pos = to + 2 // пробіл між фразами
    return { sub: p.sub, start: starts[Math.min(from, starts.length - 1)], end: ends[Math.min(to, ends.length - 1)] }
  })
}

const narration = {}
for (const scene of SCENES) {
  const text = sayText(scene)
  console.log(`${scene.id}. ${scene.name}`)
  const data = await tts(NARRATOR.voice, text)
  const file = `audio/scene-${String(scene.id).padStart(2, '0')}.mp3`
  writeFileSync(file, Buffer.from(data.audio_base64, 'base64'))
  narration[scene.id] = { file, duration: duration(file), phrases: phraseTimes(scene, data.alignment) }
}

console.log('q1 (голос користувача)')
const q1 = await tts(ASKER.voice, QUESTIONS[0])
writeFileSync('audio/q1.mp3', Buffer.from(q1.audio_base64, 'base64'))
// 0,5 с тиші на старті — мікрофон встигає відкритись; 48 кГц моно — формат фейкового пристрою Chromium
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', 'audio/q1.mp3', '-af', 'adelay=500|500,apad=pad_dur=1',
  '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', 'audio/q1.wav'])
narration.q1 = { file: 'audio/q1.wav', duration: duration('audio/q1.wav') }

writeFileSync('out/narration.json', JSON.stringify(narration, null, 2))
const total = SCENES.reduce((s, sc) => s + narration[sc.id].duration, 0)
console.log(`out/narration.json — диктор ${total.toFixed(1)} с`)
