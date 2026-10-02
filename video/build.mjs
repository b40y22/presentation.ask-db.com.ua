// Монтаж: out/<ролик>/raw.webm + timeline + озвучка → out/<ролик>/ask-db-*uk.mp4 (1920×1080, вшиті субтитри, музика).
// Очікування відповіді AI вирізається, запис застосунку — у рамці на тлі лендінгу, субтитри — у смузі під нею.
// Музика — music/*.mp3 (перший за абеткою); якщо теки нема — тихий синтезований пад-заглушка.
//
//   npm run build                 # основний ролик
//   VIDEO=connect npm run build   # підключення бази
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { ASKER, LOADING_KEEP, OUT, OUTPUT, script } from './video.mjs'

const { SCENES, VOICE_QUESTION } = script

const W = 1920
const H = 1080
const APP = { w: 1728, h: 972, x: 96, y: 18 } // 1600×900 × 1,08
const LEAD = 0.25 // диктор вступає через 0,25 с після початку сцени
const Q1_LEAD = 0.65 // голос питання: ~0,15 с — відкривається мікрофон, + 0,5 с тиші на початку q1.wav
const MUSIC_VOLUME = 0.16
const FPS = 30

const timeline = JSON.parse(readFileSync(`${OUT}/timeline.json`, 'utf8'))
const narration = JSON.parse(readFileSync(`${OUT}/narration.json`, 'utf8'))

// ---- Відрізки сирого відео (с) і їхнє місце у фінальному ----
// Годинник скрипта і кадри Playwright розходяться (на dev і проді — навіть у різні боки); зсуваємо всі
// позначки так, щоб кінець чорного кадру з record.mjs збігся з позначкою sync
// (інакше кадр «після cut» просочується в монтаж)
const rawDuration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `${OUT}/raw.webm`]))
const sync = timeline.find((s) => s.id === 'sync')
if (!sync) throw new Error('у таймлайні нема позначки sync — перезапиши відео свіжим record.mjs')
// blackdetect пише в stderr
const black = spawnSync('ffmpeg', ['-i', `${OUT}/raw.webm`, '-t', '5', '-vf', 'blackdetect=d=0.3:pix_th=0.1', '-an', '-f', 'null', '-'],
  { encoding: 'utf8' }).stderr
let blackEnd = Number(black.match(/black_end:([\d.]+)/)?.[1])

// Запасний шлях: нова збірка Chromium іноді не записує чорний кадр (запис стартує з білого, далі одразу перша сторінка).
// Тоді точкою синхронізації вважаємо момент, коли яскравість уперше помітно змінюється відносно стартової білої.
// Похибка — час відмальовування першої сторінки (десятки мс); у запасі лишається TAIL
if (!blackEnd) {
  const luma = (t) => Number(spawnSync('ffmpeg', ['-hide_banner', '-ss', String(t), '-i', `${OUT}/raw.webm`, '-frames:v', '1', '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-f', 'null', '-'],
    { encoding: 'utf8' }).stderr.match(/YAVG=([\d.]+)/)?.[1])
  const base = luma(0)
  for (let t = 0.04; t <= 3; t += 0.04) {
    if (Math.abs(luma(t) - base) > 8) { blackEnd = t; break }
  }
  if (!blackEnd) throw new Error('не знайшов ні чорний кадр синхронізації, ні перший перехід від білого на початку raw.webm')
  console.warn(`чорного кадру нема — синхронізація за першим переходом від білого: ${blackEnd.toFixed(2)} с`)
}
const skew = sync.at - blackEnd * 1000
const shifted = (ms) => ms && ms - skew
const scenes = timeline.filter((s) => s.id !== 'end' && s.id !== 'sync')
  .map((s) => ({ ...s, at: Math.max(0, shifted(s.at)), ready: shifted(s.ready), mic: shifted(s.mic), cut: shifted(s.cut), done: shifted(s.done) }))
const endAt = Math.min(rawDuration * 1000, shifted(timeline.at(-1).at)) // після close() Playwright дописує хвіст
let out = 0
const segments = scenes.map((s, i) => {
  // cut — сцена обривається раніше за початок наступної (після неї в кадрі те, чого показувати не можна);
  // done — кінець сцени: далі до наступної йде підготовка поза кадром
  const next = s.cut ?? s.done ?? scenes[i + 1]?.at ?? endAt
  const from = s.ready ? Math.max(s.at, s.ready - LOADING_KEEP) : s.at
  const seg = { id: s.id, from: from / 1000, to: next / 1000, out, mic: s.mic && (s.mic - from) / 1000 }
  out += seg.to - seg.from
  return seg
})
const total = out
if (segments.length !== SCENES.length) throw new Error(`у таймлайні ${segments.length} сцен з ${SCENES.length} — запис обірвався?`)

// ---- Субтитри (ASS: стиль, шрифт і позиція в одному файлі) ----
const t = (sec) => {
  const cs = Math.round(sec * 100)
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}
const cues = []
for (const seg of segments) {
  for (const p of narration[seg.id].phrases) {
    cues.push({ start: seg.out + LEAD + p.start, end: seg.out + LEAD + p.end + 0.35, text: p.sub, style: 'Narrator' })
  }
  if (seg.mic != null) {
    const start = seg.out + seg.mic + Q1_LEAD
    const q1 = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', narration.q1.voice]))
    cues.push({ start, end: start + q1 + 0.3, text: `«${VOICE_QUESTION}»`, style: 'Asker' })
  }
}
// субтитр не заходить на наступний
cues.sort((a, b) => a.start - b.start).forEach((c, i) => { if (cues[i + 1]) c.end = Math.min(c.end, cues[i + 1].start - 0.05) })

const subY = H - (H - APP.y - APP.h) / 2 // центр смуги під рамкою
writeFileSync(`${OUT}/subs.ass`, `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Narrator,Noto Sans,40,&H003B291E,&H00000000,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,60,60,0,1
Style: Asker,Noto Sans,40,&H00E5464F,&H00000000,&H00000000,&H00000000,-1,-1,0,0,100,100,0,0,1,0,0,5,60,60,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${cues.map((c) => `Dialogue: 0,${t(c.start)},${t(c.end)},${c.style},,0,0,0,,{\\pos(${W / 2},${subY})}${c.text}`).join('\n')}
`)
console.log(`зсув відео ${(skew / 1000).toFixed(2)} с; ${segments.length} сцен, ${total.toFixed(1)} с, ${cues.length} субтитрів${VOICE_QUESTION ? ` (голос питання — ${ASKER.name})` : ''}`)

// ---- Музика ----
const tracks = existsSync('music') ? readdirSync('music').filter((f) => /\.(mp3|wav|ogg|m4a|flac)$/i.test(f)).sort() : []
const music = tracks.length
  ? ['-stream_loop', '-1', '-i', `music/${tracks[0]}`]
  // Заглушка: м'який акорд Am9 з повільною «хвилею» гучності
  : ['-f', 'lavfi', '-i', `aevalsrc='0.25*(sin(2*PI*110*t)+0.7*sin(2*PI*164.81*t)+0.6*sin(2*PI*261.63*t)+0.5*sin(2*PI*246.94*t)+0.4*sin(2*PI*329.63*t))*(0.75+0.25*sin(2*PI*0.08*t))':s=44100:d=${total.toFixed(2)}`]
console.log(tracks.length ? `музика: music/${tracks[0]}` : 'музика: синтезована заглушка (поклади трек у video/music/)')

// ---- ffmpeg ----
const inputs = ['-i', `${OUT}/raw.webm`, ...music]
const voice = [] // [файл, старт у фіналі]
for (const seg of segments) {
  voice.push([narration[seg.id].file, seg.out + LEAD])
  if (seg.mic != null) voice.push([narration.q1.voice, seg.out + seg.mic + Q1_LEAD])
}
voice.forEach(([file]) => inputs.push('-i', file))

const f = []
segments.forEach((s, i) => f.push(`[0:v]trim=start=${s.from.toFixed(3)}:end=${s.to.toFixed(3)},setpts=PTS-STARTPTS[s${i}]`))
f.push(`${segments.map((_, i) => `[s${i}]`).join('')}concat=n=${segments.length}:v=1:a=0,fps=${FPS},scale=${APP.w}:${APP.h}:flags=lanczos[app]`)
f.push(`gradients=s=${W}x${H}:c0=0xeef2ff:c1=0xe8e0f0:c2=0xdbeafe:nb_colors=3:x0=0:y0=0:x1=${W}:y1=${H}:r=${FPS}:d=${total.toFixed(2)}:speed=0.00001[bg]`)
f.push(`[bg][app]overlay=${APP.x}:${APP.y}:shortest=1,subtitles=${OUT}/subs.ass,fade=t=in:d=0.6,fade=t=out:st=${(total - 1).toFixed(2)}:d=1,format=yuv420p[v]`)
voice.forEach(([, at], i) => {
  const ms = Math.round(at * 1000)
  f.push(`[${i + 2}:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[a${i}]`)
})
f.push(`${voice.map((_, i) => `[a${i}]`).join('')}amix=inputs=${voice.length}:normalize=0,apad,atrim=0:${total.toFixed(2)},asplit[voice][key]`)
// музика тихішає, коли говорять (sidechain від голосу)
f.push(`[1:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:${total.toFixed(2)},volume=${MUSIC_VOLUME},afade=t=in:d=2,afade=t=out:st=${(total - 3).toFixed(2)}:d=3[bed]`)
f.push(`[bed][key]sidechaincompress=threshold=0.02:ratio=6:attack=80:release=600[duck]`)
f.push(`[voice][duck]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100[a]`)

execFileSync('ffmpeg', ['-loglevel', 'error', '-stats', '-y', ...inputs,
  '-filter_complex', f.join(';'), '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
  OUTPUT], { stdio: 'inherit' })
console.log(OUTPUT)
