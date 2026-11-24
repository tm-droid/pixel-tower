// Draws one frame of the tower at absolute time `t` (ms). Pure: same input, same pixels.
import { Pix, C, noise, hashStr, textWidth } from './gfx'
import { activityOf, toolKind, verbOf } from './world'
import type { Tower, Floor, Activity } from './world'

export const W = 320
const ROOF = 34
/** The LED ticker band hung under each floor's ceiling. */
const TK = 7
export const FH = 26 + TK
const LOBBY = 30
const GROUND = 16
const BX0 = 52
const BX1 = 268
/** Right edge of what the desktop pane shows: the tower, not the empty sky past it. */
export const VIEW_W = BX1 + 8
const SHAFT = 14
const IX0 = BX0 + 2 + SHAFT + 2
const IX1 = BX1 - 2
export const MAX_FLOORS = 12

export function sceneHeight(n: number): number {
  return Math.max(180, ROOF + Math.max(1, Math.min(n, MAX_FLOORS)) * FH + LOBBY + GROUND)
}

// ---------- sprites (7x10; H hair, S skin, E eye, T shirt, P pants, B shoes, W page, K spine) ----------
const STAND = ['..HHH..', '.HHHHH.', '.HESEH.', '.SSSSS.', '..SSS..', '.TTTTT.', 'S.TTT.S', '..PPP..', '..P.P..', '..B.B..']
const CHEER = ['S.HHH.S', 'SHHHHHS', '.HESEH.', '.SSSSS.', '..SSS..', '.TTTTT.', '..TTT..', '..PPP..', '..P.P..', '..B.B..']
const SIDE_A = ['..HHH..', '.HHHHH.', '.HHSES.', '.HSSSS.', '..SSS..', '..TTT..', '..TTS..', '..PPP..', '.P...P.', 'BB...BB']
const SIDE_B = ['..HHH..', '.HHHHH.', '.HHSES.', '.HSSSS.', '..SSS..', '..TTT..', '..TST..', '..PPP..', '..PP...', '..BBB..']
const SIT_A = ['..HHH..', '.HHHHH.', '.HHSES.', '.HSSSS.', '..SSS..', '..TTT..', '..TTTSS', '..PPPPP', '..P....', '..BB...']
const SIT_B = ['..HHH..', '.HHHHH.', '.HHSES.', '.HSSSS.', '..SSS..', '..TTT..', '..TTSS.', '..PPPPP', '..P....', '..BB...']
const SLEEP = ['.......', '.......', '..HHHH.', '.HHHHHS', '..TTTSS', '..TTT..', '..TTT..', '..PPPPP', '..P....', '..BB...']
const READ_A = ['..HHH..', '.HHHHH.', '.HESEH.', '.SSSSS.', '..SSS..', '.TWWWT.', 'STWKWTS', '..PPP..', '..P.P..', '..B.B..']
const READ_B = ['..HHH..', '.HHHHH.', '.HESEH.', '.SSSSS.', '..SSS..', '.TWWKT.', 'STWWWTS', '..PPP..', '..P.P..', '..B.B..']
const CAT_A = ['K...K..', 'KK.KK..', 'KKKKK..', '.KKKKKK', '.K.K.K.']
const CAT_B = ['K...K..', 'KK.KK..', 'KKKKK.K', '.KKKKK.', 'K.K..K.']
const CAT_NAP = ['.......', '.......', 'K...K..', 'KKKKKKK', 'KKKKKKK']
const BROOM = ['..K', '..K', '..K', '.KK', 'YYY']

type Look = { H: number; S: number; T: number; P: number; E: number; B: number; W: number; K: number }
const HAIR = [C.brownD, C.brown, C.ink, C.amber, C.rust, C.orange, C.purple, C.grey, C.yellow, C.redD]
const SKIN = [C.peach, C.skin, C.skinD, C.tan, C.sand, C.brown]
const SHIRT = [C.red, C.blue, C.green, C.pink, C.amber, C.cyan, C.purple, C.clay, C.greenD, C.blueD, C.hot, C.salmon]
const PANTS = [C.navy, C.slate, C.blueD, C.brownD, C.greyD, C.ink]

export function lookOf(id: string): Look {
  const h = hashStr(id)
  return {
    H: HAIR[h % HAIR.length]!, S: SKIN[(h >>> 4) % SKIN.length]!, T: SHIRT[(h >>> 8) % SHIRT.length]!,
    P: PANTS[(h >>> 12) % PANTS.length]!, E: C.ink, B: C.brownD, W: C.white, K: C.brown,
  }
}

// ---------- activity icons (5x5) and colours, shared by the ticker, the pips and intern bubbles ----------
const ICON: Record<Activity, readonly string[]> = {
  type: ['...XX', '..XXX', '.XXX.', 'XXX..', 'X....'],
  read: ['.XX..', 'X..X.', 'X..X.', '.XXX.', '....X'],
  bash: ['X....', '.X...', 'X....', '.....', '..XXX'],
  web: ['.XXX.', 'X.X.X', 'XXXXX', 'X.X.X', '.XXX.'],
  delegate: ['.X...', 'XXX..', '.X..X', 'X.XXX', '....X'],
  think: ['.....', '.....', 'X.X.X', '.....', '.....'],
  wait: ['..X..', '..X..', '..X..', '.....', '..X..'],
  done: ['....X', '...X.', 'X.X..', '.X...', '.....'],
  error: ['X...X', '.X.X.', '..X..', '.X.X.', 'X...X'],
  idle: ['X.X..', '.....', 'XXXX.', 'XXX.X', 'XXXX.'],
  sleep: ['XXXX.', '..X..', '.X...', 'XXXX.', '.....'],
  off: ['.....', '.....', 'XXXXX', '.....', '.....'],
}
const KIND_COL: Record<Activity, number> = {
  type: C.cyan, read: C.green, bash: C.amber, web: C.blue, delegate: C.pink, think: C.salmon,
  wait: C.yellow, done: C.green, error: C.red, idle: C.greyL, sleep: C.grey, off: C.greyD,
}
const VERB_OF: Partial<Record<Activity, string>> = { wait: 'NEEDS YOU', done: 'DONE', error: 'ERROR', idle: 'IDLE', sleep: 'ASLEEP', off: 'CLOSED' }

/** Minutes or hours since `ms`, or nothing under a minute (so the picture changes at most once a minute). */
function ago(ms: number): string {
  const m = Math.floor(ms / 60000)
  return m < 1 ? '' : m < 60 ? `${m}M` : `${Math.floor(m / 60)}H`
}

/** `s` cut to fit `w` pixels of the 3x5 font. */
function fit(s: string, w: number): string {
  const n = Math.max(0, Math.floor((w + 1) / 4))
  const u = s.replace(/…/g, '.')
  return u.length > n ? `${u.slice(0, Math.max(0, n - 1))}.` : u
}

/** What the session is on, in words: the tool's target, the prompt it is thinking about, or its last words. */
export function floorLine(fl: Floor, act: Activity): { verb: string; detail?: string } {
  const busy = fl.status === 'busy'
  if (act === 'wait') return { verb: 'NEEDS YOU', detail: fl.waitingFor ?? (fl.tool ? verbOf(fl.tool) : undefined) }
  if (busy && fl.tool && act !== 'error') return { verb: verbOf(fl.tool), detail: fl.detail }
  if (act === 'think') return { verb: 'THINK', detail: fl.ask && `"${fl.ask}"` }
  if (act === 'error') return { verb: 'ERROR', detail: fl.tool ? `${verbOf(fl.tool)} ${fl.detail ?? ''}`.trim() : undefined }
  return { verb: VERB_OF[act] ?? 'IDLE', detail: act === 'off' ? undefined : fl.say }
}

/** The LED sign under the ceiling: icon, verb, target, then how long, then the last few tool calls as pips. */
function ticker(p: Pix, fl: Floor, act: Activity, x0: number, y: number, w: number, f: number, t: number, lite = 0) {
  const bg = act === 'wait' && f % 2 ? C.redD : C.ink
  p.rect(x0, y, w, TK, C.greyD)
  p.rect(x0 + 1, y, w - 2, TK - 1, bg)
  const col = KIND_COL[act]
  p.sprite(ICON[act], x0 + 3, y + 1, { X: col })
  let x = x0 + 10
  const recent = lite >= 2 ? [] : fl.recent ?? []
  const px = x0 + w - 3 - recent.length * 3 + 1
  recent.forEach((r, i) => p.rect(px + i * 3, y + 2, 2, 3, r.err ? C.red : KIND_COL[r.kind]))
  let right = recent.length ? px - 4 : x0 + w - 3
  const since = fl.status === 'busy' && fl.tool && fl.toolSince ? fl.toolSince : fl.statusSince
  const age = act === 'off' ? '' : ago(t - since)
  if (age) { right -= textWidth(age); p.text(age, right, y + 1, C.slate); right -= 5 }
  const { verb, detail } = floorLine(fl, act)
  p.text(verb, x, y + 1, col)
  x += textWidth(verb) + 4
  if (detail && lite < 2 && right - x > 6) p.text(fit(lite ? detail.slice(0, 14) : detail, right - x), x, y + 1, act === 'idle' || act === 'sleep' || act === 'off' ? C.grey : C.white)
}

function internBubble(p: Pix, x: number, y: number, kind: Activity) {
  p.rect(x, y, 7, 7, C.white)
  p.set(x + 3, y + 7, C.white)
  p.sprite(ICON[kind], x + 1, y + 1, { X: kind === 'think' ? C.purple : kind === 'done' ? C.greenD : KIND_COL[kind] === C.cyan ? C.blue : KIND_COL[kind] })
}

const mins = (ms: number) => (ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))}s` : ms < 3600000 ? `${Math.round(ms / 60000)}m` : `${(ms / 3600000).toFixed(1)}h`)

// ---------- helpers ----------
function phaseOf(t: number): { level: number; kind: 'day' | 'dusk' | 'night'; hour: number } {
  const d = new Date(t)
  const h = d.getHours() + d.getMinutes() / 60
  if (h >= 7 && h < 18) return { level: 0, kind: 'day', hour: h }
  if ((h >= 5.5 && h < 7) || (h >= 18 && h < 20)) return { level: 1, kind: 'dusk', hour: h }
  return { level: 2, kind: 'night', hour: h }
}

function isRaining(t: number): boolean {
  const d = new Date(t)
  return noise(d.getFullYear() * 400 + d.getMonth() * 32 + d.getDate(), d.getHours(), 7) < 0.18
}

function bubble(p: Pix, x: number, y: number, icon: 'alert' | 'check' | 'dots' | 'x' | 'z', f: number) {
  const bg = icon === 'alert' ? (f % 2 ? C.white : C.amber) : C.white
  p.rect(x + 1, y, 7, 7, bg); p.rect(x, y + 1, 9, 5, bg)
  p.set(x + 2, y + 7, bg); p.set(x + 1, y + 8, bg)
  if (icon === 'alert') { p.rect(x + 4, y + 1, 1, 3, C.red); p.set(x + 4, y + 5, C.red) }
  if (icon === 'check') { p.set(x + 2, y + 3, C.green); p.set(x + 3, y + 4, C.green); p.set(x + 4, y + 3, C.green); p.set(x + 5, y + 2, C.green); p.set(x + 6, y + 1, C.green) }
  if (icon === 'dots') for (let i = 0; i < 3; i++) p.set(x + 2 + i * 2, y + 3, i <= f % 4 ? C.slate : C.greyL)
  if (icon === 'x') { for (let i = 0; i < 4; i++) { p.set(x + 3 + i, y + 1 + i, C.red); p.set(x + 6 - i, y + 1 + i, C.red) } }
  if (icon === 'z') { p.text('Z', x + 3, y + 1, C.blueD) }
}

function matrix(p: Pix, x: number, y: number, w: number, h: number, t: number, age: number) {
  for (let cx = 0; cx < w; cx++) {
    const head = ((t / 40 + noise(cx, x) * 50) | 0) % (h + 6)
    for (let k = 0; k < 5; k++) {
      const yy = head - k
      if (yy >= 0 && yy < h && noise(cx, yy, (t / 120) | 0) < 0.8 - age) p.set(x + cx, y + yy, k === 0 ? C.white : C.green)
    }
  }
}

// ---------- actors: sprites the desktop SVG moves with CSS, so long walks never snap back ----------
export type Pose = { draw: (p: Pix) => void; from?: number; to?: number; legs?: 0 | 1 }
export type Actor = {
  /** Loop length in seconds, and how far into it the scene's time `t` is. */
  period: number
  phase: number
  /** Drawn behind the building (sky things) instead of in front of everything. */
  back?: boolean
  /** Waypoints [time 0..1, x, y]; it moves between them one whole pixel at a time. */
  path: [number, number, number][]
  /** Shown in their time window [from, to) of the loop; with no window, always. */
  poses: Pose[]
}
export type Hit = { x: number; y: number; w: number; h: number; title: string }
/** `lite` trims detail when a crowded tower would not fit the SVG limit: 1 shorter ticker text, 2 no ticker text or pips, 3 no intern bubbles. */
export type SceneOpts = { minH?: number; svg?: boolean; actors?: Actor[]; hits?: Hit[]; lite?: number }

// ---------- sky ----------
type Phase = ReturnType<typeof phaseOf>
/** Flat bands, top to horizon (no dither). */
function skyBands(ph: Phase): number[] {
  if (ph.kind === 'day') return [C.blue, C.blue, C.cyan, C.greyL]
  if (ph.kind === 'dusk') return ph.hour < 12 ? [C.navy, C.slate, C.purple, C.salmon, C.peach] : [C.slate, C.purple, C.pink, C.salmon, C.amber]
  return [C.ink, C.navy, C.navy, C.slate]
}
function drawSky(p: Pix, groundY: number, ph: Phase, f: number) {
  const bands = skyBands(ph)
  const n = bands.length
  // even bands, the last (behind the skyline) half as tall, so every band shows above the city
  const total = 2 * n - 1
  let y = 0
  bands.forEach((c, i) => {
    const h = i === n - 1 ? groundY - y : Math.round((groundY * 2) / total)
    p.rect(0, y, W, h, c)
    y += h
  })
  // sun / moon on an arc across the sky
  const rise = Math.min(60, groundY * 0.4)
  const dayFrac = (ph.hour - 6) / 13
  const nightFrac = ((ph.hour + 24 - 19) % 24) / 11
  const arc = (fr: number) => ({ x: 14 + fr * (VIEW_W - 28), y: 10 + (1 - Math.sin(Math.PI * Math.min(1, Math.max(0, fr)))) * rise })
  if (ph.kind !== 'night' && dayFrac > 0 && dayFrac < 1) {
    const s = arc(dayFrac)
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) { const d = dx * dx + dy * dy; if (d <= 26) p.set(s.x + dx, s.y + dy, d <= 12 ? C.yellow : d <= 20 ? C.amber : bands[0] === C.blue ? C.cyan : C.salmon) }
  }
  if (ph.kind !== 'day') {
    const top = groundY * 0.75
    for (let i = 0; i < 26; i++) {
      const x = (noise(i, 1) * VIEW_W) | 0, y = 2 + ((noise(i, 2) * top) | 0)
      if (ph.kind !== 'night' && i % 3) continue
      if (i < 3) { p.set(x, y, C.white); p.set(x - 1, y, C.greyL); p.set(x + 1, y, C.greyL); p.set(x, y - 1, C.greyL); p.set(x, y + 1, C.greyL); continue }
      // a few twinkle: they dim for a beat now and then
      p.set(x, y, i % 5 === 0 && noise(i, f >> 1) < 0.3 ? C.grey : i % 4 ? C.white : C.yellow)
    }
    const m = arc(nightFrac)
    if (nightFrac > 0 && nightFrac < 1) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = dx * dx + dy * dy
      if (d <= 17 && (dx + 2) ** 2 + (dy - 1) ** 2 > 9) p.set(m.x + dx, m.y + dy, d >= 13 ? C.grey : C.white)
    }
  }
}

/** A flat-bottomed cumulus puff, `w` wide, its base at y. */
function cloud(p: Pix, x: number, y: number, w: number, top: number, under: number) {
  p.rect(x, y - 3, w, 3, top)
  p.rect(x + 2, y - 5, w - 4, 2, top)
  p.rect(x + ((w * 0.25) | 0), y - 7, (w * 0.3) | 0, 2, top)
  p.rect(x + ((w * 0.55) | 0), y - 6, (w * 0.25) | 0, 1, top)
  p.rect(x + 1, y, w - 2, 1, under)
}

function drawClouds(p: Pix, t: number, groundY: number, ph: Phase, opts: SceneOpts) {
  const top = ph.kind === 'night' ? C.slate : ph.kind === 'dusk' ? C.peach : C.white
  const under = ph.kind === 'night' ? C.navy : ph.kind === 'dusk' ? C.salmon : C.greyL
  const span = VIEW_W + 60
  const band = Math.max(30, groundY * 0.5)
  for (const [layer, count, secPerPx] of [[0, 3, 4], [1, 4, 2]] as const) {
    const items = Array.from({ length: count }, (_, i) => ({
      x: ((noise(i, 9 + layer) * span) | 0) - 30,
      y: 12 + ((noise(i, 3 + layer) * band) | 0) + (layer ? 8 : 0),
      w: (layer ? 18 : 12) + ((noise(i, 4 + layer) * (layer ? 16 : 10)) | 0),
    }))
    const far = layer === 0
    const ct = far ? under : top, cu = far ? (ph.kind === 'day' ? C.cyan : under) : under
    const period = span * secPerPx
    const off = (t / 1000 / secPerPx) % span
    if (opts.svg) {
      opts.actors?.push({
        period, phase: (t / 1000) % period, back: true, path: [[0, 0, 0], [1, span, 0]],
        poses: [{ draw: q => { for (const c of items) for (const k of [0, -span]) cloud(q, c.x + k, c.y, c.w, ct, cu) } }],
      })
    } else for (const c of items) cloud(p, ((c.x + off + 30) % span) - 30, c.y, c.w, ct, cu)
  }
  // a small flock crosses the sky now and then (desktop only)
  if (opts.svg && ph.kind !== 'night') {
    const by = 14 + ((noise(7, 7) * band) | 0)
    const flap = (q: Pix, up: boolean, dx: number, dy: number) => q.sprite(up ? ['K...K', '.K.K.', '..K..'] : ['.....', 'KK.KK', '..K..'], dx, by + dy, { K: C.ink })
    opts.actors?.push({
      period: 140, phase: (t / 1000) % 140, back: true, path: [[0, -24, 0], [0.4, VIEW_W + 8, -6], [1, VIEW_W + 8, -6]],
      poses: [0, 1].map(l => ({ legs: l as 0 | 1, draw: (q: Pix) => { flap(q, !l, 0, 0); flap(q, !!l, 8, 4); flap(q, !l, 15, 1) } })),
    })
  }
  // a jet high up, flying left with a contrail by day and a blinking beacon by night (desktop only)
  if (opts.svg) {
    const py = 6 + ((noise(8, 8) * 10) | 0)
    const night = ph.kind === 'night'
    const body = night ? C.slate : C.white, belly = night ? C.navy : C.greyL
    const trail = night ? -1 : ph.kind === 'dusk' ? C.peach : C.white
    opts.actors?.push({
      period: 75, phase: (t / 1000 + 31) % 75, back: true, path: [[0, VIEW_W + 40, py], [0.45, -40, py], [1, -40, py]],
      poses: [
        { draw: q => {
          q.sprite(['.......B.', 'BBBBBBBBB', '..UU.U...'], 0, 0, { B: body, U: belly })
          if (trail >= 0) for (let x = 10; x < 34; x++) if (x % 4 !== 3 && (x < 22 || x % 2 === 0)) q.set(x, 1, trail)
        } },
        { legs: 0, draw: q => q.set(7, -1, night ? C.red : body) },
        { legs: 1, draw: q => q.set(0, 1, night ? C.green : body) },
      ],
    })
  }
}

function drawSkyline(p: Pix, groundY: number, ph: Phase, f: number) {
  // far layer: taller, pale, tinted toward the sky, no windows
  const farC = ph.kind === 'day' ? C.greyL : ph.kind === 'dusk' ? C.purple : C.navy
  let x = -4, i = 0
  while (x < W) {
    const w = 14 + ((noise(i, 31) * 16) | 0)
    const h = 34 + ((noise(i, 32) * 40) | 0)
    p.rect(x, groundY - h, w, h, farC)
    if (noise(i, 33) < 0.4) p.rect(x + (w >> 1), groundY - h - 6, 1, 6, farC)
    x += w; i++
  }
  // near layer: two-tone blocks with lit windows at night
  x = 0; i = 0
  while (x < W) {
    const w = 10 + ((noise(i, 11) * 14) | 0)
    const h = 16 + ((noise(i, 12) * 36) | 0)
    const col = i % 2 ? C.slate : C.greyD
    p.rect(x, groundY - h, w, h, col)
    p.rect(x + w - 2, groundY - h, 2, h, i % 2 ? C.navy : C.slate)
    p.light(x, groundY - h, w, h, ph.level)
    for (let wy = groundY - h + 3; wy < groundY - 3; wy += 4) for (let wx = x + 2; wx < x + w - 3; wx += 3) {
      const on = noise(wx, wy, 3) < (ph.kind === 'day' ? 0.0 : 0.3)
      if (on) { p.set(wx, wy, noise(wx, wy, (f / 16) | 0) < 0.97 ? C.amber : C.yellow); p.light(wx, wy, 1, 1, 0) }
      else if (ph.kind === 'day' && (wx + wy) % 3 === 0) p.set(wx, wy, C.blueD)
    }
    x += w + 1; i++
  }
}

function drawRain(p: Pix, t: number, groundY: number) {
  for (let i = 0; i < 70; i++) {
    const x = (noise(i, 21) * (W + 20)) | 0
    const y = ((noise(i, 22) * groundY + t / 9) % (groundY + 8)) | 0
    p.set(x - (y >> 3), y, C.greyL); p.set(x - (y >> 3), y + 1, C.grey)
  }
}

const CAR = ['...RRRRR....', '..RCCRCCR...', 'RRRRRRRRRRRY', 'DRRRRRRRRRRR', '.KK.....KK..']
function drawGround(p: Pix, groundY: number, H: number, ph: ReturnType<typeof phaseOf>, t: number, rain: boolean, opts: SceneOpts) {
  // now and then a car drives down the street (desktop only)
  if (opts.svg) opts.actors?.push({
    period: 47, phase: (t / 1000) % 47, path: [[0, -16, groundY + 4], [0.3, W, groundY + 4], [1, W, groundY + 4]],
    poses: [{ draw: q => {
      q.sprite(CAR, 0, 0, { R: C.red, D: C.redD, C: ph.kind === 'day' ? C.cyan : C.slate, Y: ph.kind === 'day' ? C.amber : C.yellow, K: C.ink })
      q.light(0, 0, 12, 5, ph.level)
      if (ph.kind !== 'day') { q.light(11, 2, 1, 1, 0); q.set(12, 2, C.yellow); q.set(13, 2, C.amber); q.light(12, 2, 2, 1, 0) }
    } }],
  })
  p.rect(0, groundY, W, 3, C.greyL); p.rect(0, groundY + 3, W, 1, C.grey)
  p.rect(0, groundY + 4, W, H - groundY - 4, C.ink)
  for (let x = 0; x < W; x += 16) p.rect(x, groundY + 9, 7, 1, C.amber)
  p.light(0, groundY, W, H - groundY, ph.level)
  if (rain) for (let i = 0; i < 10; i++) { const x = (noise(i, (t / 300) | 0) * W) | 0; p.set(x, groundY + 2, C.white); p.set(x - 1, groundY + 1, C.greyL); p.set(x + 1, groundY + 1, C.greyL) }
  // trees
  for (const tx of [26, 296]) {
    p.lit(ph.level, () => {
      p.rect(tx, groundY - 7, 2, 7, C.brownD)
      for (let dy = -9; dy <= 0; dy++) for (let dx = -6; dx <= 6; dx++) if (dx * dx + (dy + 4) ** 2 * 1.4 < 34) p.set(tx + 1 + dx, groundY - 12 + dy + 4, noise(dx, dy, tx) < 0.3 ? C.greenD : C.green)
    })
  }
  // street lamps
  for (const lx of [8, 312]) {
    p.rect(lx, groundY - 20, 1, 20, C.greyD); p.rect(lx - 2, groundY - 21, 5, 1, C.greyD)
    p.set(lx - 1, groundY - 20, ph.kind === 'day' ? C.greyL : C.yellow); p.set(lx + 1, groundY - 20, ph.kind === 'day' ? C.greyL : C.yellow)
    if (ph.kind !== 'day') { p.glow(lx, groundY + 2, 14, 0, groundY); p.light(lx - 1, groundY - 21, 3, 2, 0) }
  }
}

// ---------- building ----------
function drawRoof(p: Pix, roofY: number, tower: Tower, ph: ReturnType<typeof phaseOf>, f: number, t: number) {
  const title = 'PIXEL TOWER'
  const tw = textWidth(title)
  const sx = ((BX0 + BX1) / 2 - tw / 2) | 0, sy = roofY - 17
  const ax = BX1 - 14
  const web = tower.floors.some(fl => activityOf(fl, t) === 'web')
  const dx = BX0 + 14, dy = roofY - 10
  // roof slab, sign posts, antenna and dish take the phase shade; the sky between them does not
  p.lit(ph.level, () => {
    p.rect(BX0 - 2, roofY - 3, BX1 - BX0 + 4, 3, C.greyD)
    p.rect(BX0 - 2, roofY - 4, BX1 - BX0 + 4, 1, C.grey)
    p.rect(sx, sy + 8, 1, 6, C.greyD); p.rect(sx + tw - 1, sy + 8, 1, 6, C.greyD)
    p.rect(ax, roofY - 26, 1, 22, C.grey); p.rect(ax - 2, roofY - 18, 5, 1, C.grey); p.rect(ax - 1, roofY - 12, 3, 1, C.grey)
    const ang = web ? f % 4 : 1
    const dish = [['.WWW.', 'W...W', '.WWW.'], ['..W..', '.W.W.', 'W...W'], ['W....', '.W...', '..WWW'], ['....W', '...W.', 'WWW..']][ang]!
    p.sprite(dish, dx, dy - 3, { W: C.greyL })
    p.rect(dx + 2, dy, 1, 6, C.grey); p.rect(dx, dy + 6, 5, 1, C.greyD)
  })
  // neon sign with chasing bulbs
  p.rect(sx - 4, sy - 3, tw + 8, 11, C.redD)
  p.rect(sx - 3, sy - 2, tw + 6, 9, C.ink)
  p.text(title, sx, sy, f % 8 === 0 ? C.salmon : C.hot)
  for (let i = 0; i < tw + 8; i += 2) {
    const on = ((i >> 1) + f) % 3 === 0
    p.set(sx - 4 + i, sy - 3, on ? C.yellow : C.amber)
    p.set(sx - 4 + i, sy + 7, on ? C.amber : C.yellow)
  }
  // antenna beacon blinks; the dish sparks while any floor is on the web
  if (f % 4 < 2) p.set(ax, roofY - 27, C.red)
  if (web && f % 2) { p.set(dx + 2, dy - 6, C.cyan); p.set(dx + 4, dy - 8, C.cyan); p.light(dx, dy - 9, 6, 4, 0) }
  // 5-hour energy meter on the roof
  if (tower.energyPct !== undefined) {
    const mx = BX1 - 48, my = roofY - 11
    const left = Math.max(0, 100 - tower.energyPct)
    p.rect(mx, my, 26, 7, C.ink); p.rect(mx + 26, my + 2, 1, 3, C.ink)
    const fill = Math.round((left / 100) * 24)
    p.rect(mx + 1, my + 1, fill, 5, left > 50 ? C.green : left > 20 ? C.amber : (f % 2 ? C.red : C.redD))
    p.text('5H', mx - 9, my + 1, C.white)
    p.light(mx - 10, my - 1, 38, 9, 0)
  }
}

function drawShaft(p: Pix, top: number, bottom: number, tower: Tower, n: number, roofY: number, lobbyTop: number, t: number) {
  const sx = BX0 + 2
  p.rect(sx, top, SHAFT, bottom - top, C.navy)
  p.rect(sx + 3, top, 1, bottom - top, C.slate); p.rect(sx + SHAFT - 4, top, 1, bottom - top, C.slate)
  const carH = 16
  const yOf = (k: number) => (k < 0 ? lobbyTop + LOBBY - carH - 2 : roofY + (n - 1 - k) * FH + FH - 2 - carH)
  const e = tower.elevator
  const u = Math.min(1, Math.max(0, (t - e.at) / 2500))
  const ease = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2
  const y = Math.round(yOf(e.from) + (yOf(Math.min(e.to, n - 1)) - yOf(e.from)) * ease)
  p.rect(sx + 7, top, 1, y - top, C.grey)
  p.rect(sx + 1, y, SHAFT - 2, carH, C.greyL)
  p.rect(sx + 2, y + 1, SHAFT - 4, carH - 2, C.grey)
  p.rect(sx + 6, y + 2, 1, carH - 3, C.greyD)
  p.set(sx + 3, y + 1, u < 1 ? C.amber : C.green)
  if (u < 1 && e.to >= 0) p.sprite(STAND.slice(0, 8), sx + 3, y + carH - 9, { H: C.amber, S: C.skin, E: C.ink, T: C.cyan, P: C.navy, B: C.brownD }, false, C.ink)
}

function drawMonitor(p: Pix, x: number, y: number, act: Activity, f: number, t: number) {
  p.rect(x, y, 11, 8, C.ink)
  p.rect(x + 5, y + 8, 1, 1, C.greyD); p.rect(x + 3, y + 9, 5, 1, C.greyD)
  const sx = x + 1, sy = y + 1, sw = 9, sh = 6
  const bg = act === 'web' ? C.blueD : act === 'wait' ? (f % 2 ? C.redD : C.red) : act === 'done' ? C.greenD : act === 'off' || act === 'sleep' ? C.ink : act === 'read' ? C.greyD : C.navy
  p.rect(sx, sy, sw, sh, bg)
  if (act === 'type' || act === 'bash' || act === 'delegate' || act === 'error') {
    const cols = act === 'bash' ? [C.green, C.green, C.greenD] : [C.green, C.amber, C.cyan, C.pink, C.white]
    const scroll = (t / (act === 'bash' ? 160 : 260)) | 0
    for (let r = 0; r < sh; r++) {
      const line = scroll + r
      const ind = (noise(line, 5) * 3) | 0
      const len = 2 + ((noise(line, 6) * (sw - 3)) | 0)
      p.rect(sx + ind, sy + r, Math.min(len, sw - ind), 1, cols[(noise(line, 7) * cols.length) | 0]!)
    }
    if (act === 'bash' && f % 2) p.set(sx + 1, sy + sh - 1, C.white)
  } else if (act === 'web') {
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
      if ((r - 2) ** 2 + (c - 2) ** 2 > 5) continue
      p.set(sx + 2 + c, sy + r, noise(c + f, r, 4) < 0.5 ? C.green : C.blue)
    }
  } else if (act === 'read') {
    for (let r = 1; r < sh; r += 2) p.rect(sx + 1, sy + r, 3 + (noise(r, (t / 900) | 0) * 5 | 0), 1, C.grey)
  } else if (act === 'think') {
    for (let i = 0; i < 3; i++) p.set(sx + 2 + i * 2, sy + 3, i <= f % 3 ? C.white : C.slate)
  } else if (act === 'wait') {
    p.rect(sx + 4, sy + 1, 1, 3, C.white); p.set(sx + 4, sy + 5, C.white)
  } else if (act === 'done') {
    p.set(sx + 2, sy + 3, C.white); p.set(sx + 3, sy + 4, C.white); p.set(sx + 4, sy + 3, C.white); p.set(sx + 5, sy + 2, C.white); p.set(sx + 6, sy + 1, C.white)
  } else if (act === 'idle') {
    const bx = Math.abs(((t / 300) | 0) % 16 - 8), by = Math.abs(((t / 420) | 0) % 10 - 5)
    p.set(sx + bx, sy + by, C.amber)
  } else if (act === 'sleep') {
    if (f % 4 === 0) p.set(sx + sw - 1, sy + sh - 1, C.green)
  }
}

/** Wall colour, its darker shade (trim, baseboard), and floor kind, all from the session id. */
const WALLS = [[C.sand, C.tan], [C.greyL, C.grey], [C.peach, C.skin], [C.tan, C.skinD], [C.grey, C.greyD], [C.salmon, C.pink]] as const

const ACT_LABEL: Record<Activity, string> = {
  type: 'editing', read: 'reading', bash: 'running a command', web: 'on the web', delegate: 'briefing an intern', think: 'thinking',
  wait: 'waiting for you', done: 'just finished', idle: 'on a coffee break', sleep: 'asleep', off: 'closed', error: 'hit an error',
}

function drawDecor(p: Pix, kind: number, x: number, y: number, t: number, wallD: number) {
  if (kind === 0) {
    // wall clock on real time
    p.rect(x + 1, y, 7, 9, C.ink); p.rect(x, y + 1, 9, 7, C.ink); p.rect(x + 1, y + 1, 7, 7, C.white)
    const d = new Date(t)
    const hand = (a: number, len: number, c: number) => { for (let r = 1; r <= len; r++) p.set(x + 4 + Math.round(Math.sin(a) * r), y + 4 - Math.round(Math.cos(a) * r), c) }
    hand(((d.getHours() % 12) + d.getMinutes() / 60) * (Math.PI / 6), 2, C.ink)
    hand(d.getMinutes() * (Math.PI / 30), 3, C.red)
  } else if (kind === 1) {
    // framed poster: a little mountain at sunset
    p.rect(x, y, 12, 10, C.brownD); p.rect(x + 1, y + 1, 10, 8, C.amber); p.rect(x + 1, y + 1, 10, 3, C.salmon)
    p.set(x + 7, y + 2, C.yellow)
    for (let i = 0; i < 4; i++) p.rect(x + 2 + i, y + 8 - i, 8 - i * 2, 1, C.purple)
  } else if (kind === 2) {
    // whiteboard with a chart
    p.rect(x, y, 16, 10, C.grey); p.rect(x + 1, y + 1, 14, 7, C.white); p.rect(x + 2, y + 9, 12, 1, C.greyD)
    for (const [bx, bh, c] of [[3, 2, C.blue], [6, 4, C.green], [9, 3, C.red], [12, 5, C.green]] as const) p.rect(x + bx, y + 7 - bh, 2, bh, c)
  } else {
    // pinned notes
    for (const [nx, ny, c] of [[0, 1, C.yellow], [5, 0, C.pink], [3, 5, C.cyan], [9, 3, C.yellow]] as const) { p.rect(x + nx, y + ny, 4, 4, c); p.set(x + nx + 1, y + ny, C.red) }
    p.set(x + 1, y + 3, wallD)
  }
}

function drawFloor(p: Pix, fl: Floor, idx: number, t0: number, tower: Tower, ph: ReturnType<typeof phaseOf>, f: number, t: number, opts: SceneOpts) {
  const act = activityOf(fl, t)
  const yb = t0 + FH - 2
  const off = act === 'off'
  const v = hashStr(fl.id)
  const [wall, wallD] = WALLS[v % WALLS.length]!
  const line = floorLine(fl, act)
  const say = fl.status === 'busy' && fl.ask ? ` · asked "${fl.ask}"` : fl.say ? ` · said "${fl.say}"` : ''
  opts.hits?.push({ x: IX0, y: t0, w: IX1 - IX0, h: FH, title: `${fl.name}: ${ACT_LABEL[act]} · ${line.verb}${line.detail ? ` ${line.detail}` : ''}${fl.ctxPct !== undefined ? ` · context ${Math.round(fl.ctxPct)}%` : ''}${fl.interns.length ? ` · ${fl.interns.length} intern${fl.interns.length > 1 ? 's' : ''}` : ''}${say}` })
  // structure
  p.rect(IX0, t0, IX1 - IX0, FH, wall)
  const trim = (v >>> 4) % 3
  if (trim === 1) for (let x = IX0 + 2; x < IX1; x += 5) p.rect(x, t0 + 3, 1, FH - 6, wallD)
  if (trim === 2) { p.rect(IX0, yb - 9, IX1 - IX0, 1, wallD); p.rect(IX0, yb - 8, IX1 - IX0, 6, wallD) }
  p.rect(IX0, t0, IX1 - IX0, 2, C.greyD)
  p.rect(IX0, t0 + 2, IX1 - IX0, 1, C.grey)
  const lite = opts.lite ?? 0
  ticker(p, fl, act, IX0 + 2, t0 + 3, IX1 - IX0 - 4, f, t, lite)
  // everything below hangs from under the ticker
  const top = t0 + TK
  p.rect(IX0, yb - 2, IX1 - IX0, 1, wallD)
  const floorKind = (v >>> 8) % 3
  if (floorKind === 0) {
    p.rect(IX0, yb - 1, IX1 - IX0, 1, C.brown); p.rect(IX0, yb, IX1 - IX0, 2, C.brownD)
    for (let x = IX0 + (idx % 3) * 2; x < IX1; x += 6) p.set(x, yb, C.brown)
  } else if (floorKind === 1) {
    p.rect(IX0, yb - 1, IX1 - IX0, 1, C.pink); p.rect(IX0, yb, IX1 - IX0, 2, C.purple)
  } else {
    p.rect(IX0, yb - 1, IX1 - IX0, 1, C.white); p.rect(IX0, yb, IX1 - IX0, 2, C.greyL)
    for (let x = IX0 + 3; x < IX1; x += 8) p.rect(x, yb - 1, 1, 3, C.grey)
  }
  drawDecor(p, (v >>> 12) % 4, IX0 + 76, top + 5, t, wallD)
  // back-wall window shows the sky
  const wx = IX0 + 130, wy = top + 5
  p.rect(wx - 1, wy - 1, 18, 11, C.greyD)
  for (let y = 0; y < 9; y++) for (let x = 0; x < 16; x++) {
    const sky = ph.kind === 'day' ? C.cyan : ph.kind === 'dusk' ? C.salmon : C.navy
    p.set(wx + x, wy + y, sky)
  }
  if (ph.kind === 'night' && noise(fl.id.length, idx) < 0.9) { p.set(wx + 3, wy + 2, C.white); p.set(wx + 11, wy + 5, C.white) }
  if (isRaining(t)) for (let i = 0; i < 6; i++) { const rx = (noise(i, idx, 31) * 16) | 0; const ry = ((noise(i, idx, 32) * 9 + t / 70) % 9) | 0; p.set(wx + rx, wy + ry, C.greyL) }
  p.rect(wx + 7, wy, 1, 9, C.greyD)
  // ceiling lamp (a siren while waiting)
  const lx = IX0 + 60
  p.rect(lx, top + 3, 5, 1, C.greyD)
  p.rect(lx + 1, top + 4, 3, 1, act === 'wait' ? (f % 2 ? C.red : C.hot) : off ? C.grey : C.yellow)
  // floor number tag inside; the project name hangs on a sign outside the wall
  const num = `${idx + 1}F`
  p.rect(IX0 + 2, top + 4, textWidth(num) + 4, 7, C.navy)
  p.text(num, IX0 + 4, top + 5, fl.isSelf ? C.cyan : C.white)
  if (fl.entry === 'cli') p.text('>_', IX0 + textWidth(num) + 8, top + 5, C.slate)
  const up = fl.name.toUpperCase()
  const name = up.length > 11 ? `${up.slice(0, 10)}.` : up
  const nw = textWidth(name)
  const sx = BX0 - 5 - nw - 4
  const signBg = act === 'wait' && f % 2 ? C.red : fl.isSelf ? C.blueD : C.navy
  p.rect(sx, top + 8, nw + 4, 9, C.greyD)
  p.rect(sx + 1, top + 9, nw + 2, 7, signBg)
  p.text(name, sx + 2, top + 10, off ? C.slate : fl.isSelf ? C.cyan : C.white)
  p.rect(BX0 - 5, top + 12, 3, 1, C.greyD)
  p.light(sx, top + 8, nw + 7, 9, off ? 2 : 0)
  // cost readout, on the wall by the window
  if (fl.costUsd !== undefined) p.text(`$${fl.costUsd.toFixed(2)}`, IX0 + 150, top + 4, C.greenD)
  // desk + monitor
  const dx = IX0 + 30
  p.rect(dx, yb - 8, 20, 2, C.clay); p.rect(dx + 1, yb - 6, 1, 6, C.brown); p.rect(dx + 18, yb - 6, 1, 6, C.brown)
  p.rect(dx + 12, yb - 6, 6, 5, C.brown); p.rect(dx + 13, yb - 5, 4, 1, C.tan); p.rect(dx + 13, yb - 3, 4, 1, C.tan)
  drawMonitor(p, dx + 4, yb - 18, act, f, t)
  // coffee mug on the desk
  p.rect(dx + 16, yb - 11, 3, 3, C.white); p.set(dx + 19, yb - 10, C.white)
  // chair
  const cx = IX0 + 20
  p.rect(cx, yb - 12, 2, 8, C.greyD); p.rect(cx, yb - 5, 7, 2, C.greyD); p.rect(cx + 3, yb - 3, 1, 3, C.grey)
  // bookshelf
  const bx = IX0 + 98
  p.rect(bx, yb - 17, 14, 17, C.brown)
  for (let s = 0; s < 3; s++) {
    p.rect(bx + 1, yb - 16 + s * 5, 12, 4, C.brownD)
    for (let b = 0; b < 12; b++) if (noise(b, s, idx) < 0.8) p.rect(bx + 1 + b, yb - 16 + s * 5 + (noise(b, s, 8) < 0.3 ? 1 : 0), 1, 4 - (noise(b, s, 8) < 0.3 ? 1 : 0), [C.red, C.blue, C.green, C.amber, C.purple, C.cyan][(noise(b, s, 9) * 6) | 0]!)
  }
  // server rack with flickering LEDs (sparks during Bash)
  const rx = IX0 + 116
  p.rect(rx, yb - 18, 8, 18, C.ink); p.rect(rx + 1, yb - 17, 6, 16, C.navy)
  const fast = act === 'bash' ? 1 : 3
  for (let r = 0; r < 7; r++) for (let c = 0; c < 3; c++) {
    const v = noise(r * 3 + c, idx, ((t / 125) | 0) / fast | 0)
    if (!off) p.set(rx + 2 + c * 2, yb - 16 + r * 2, v < 0.35 ? C.green : v < 0.5 ? C.amber : v < 0.55 ? C.red : C.greenDD)
  }
  if (act === 'bash') for (let i = 0; i < 5; i++) {
    const a = noise(i, f, idx)
    p.set(rx + 3 + Math.round((a - 0.5) * 12), yb - 19 - ((noise(i, f, 2) * 5) | 0), a < 0.5 ? C.yellow : C.amber)
  }
  // coffee counter + machine
  const kx = IX0 + 150
  p.rect(kx, yb - 6, 18, 6, C.greyD); p.rect(kx, yb - 7, 18, 1, C.grey)
  p.rect(kx + 3, yb - 15, 7, 8, C.ink); p.rect(kx + 4, yb - 14, 5, 2, C.red); p.rect(kx + 5, yb - 10, 3, 3, C.white)
  // plant (sways)
  const px0 = IX0 + 172
  p.rect(px0, yb - 5, 5, 5, C.clay)
  const sway = f % 4 < 2 ? 0 : 1
  for (const [lx2, ly, c2] of [[1, -9, C.green], [3, -11, C.greenD], [0, -7, C.greenD], [4, -8, C.green], [2, -13, C.green], [-1, -10, C.green], [5, -12, C.greenD]] as const) p.rect(px0 + lx2 + (ly < -10 ? sway : 0), yb + ly, 1, 4, c2)
  // context battery
  const ex = IX1 - 9
  p.rect(ex, top + 6, 6, 14, C.greyD); p.rect(ex + 2, top + 5, 2, 1, C.greyD)
  p.rect(ex + 1, top + 7, 4, 12, C.ink)
  if (fl.ctxPct !== undefined) {
    const h = Math.max(1, Math.round((Math.min(100, fl.ctxPct) / 100) * 12))
    const col = fl.ctxPct < 50 ? C.green : fl.ctxPct < 80 ? C.amber : (fl.ctxPct >= 90 && f % 2 ? C.redD : C.red)
    p.rect(ex + 1, top + 19 - h, 4, h, col)
  }
  // ---- characters ----
  const look = lookOf(fl.id)
  const deskX = cx
  const charY = yb - 10
  const coffeeX = kx + 10
  if (act === 'type' || act === 'bash' || act === 'web' || act === 'delegate' || act === 'think' || act === 'error') {
    p.sprite(act === 'think' ? SIT_A : f % 2 ? SIT_A : SIT_B, deskX, charY, look, false, C.ink)
    if (act === 'think') bubble(p, deskX + 2, charY - 10, 'dots', f)
    if (act === 'error') {
      bubble(p, deskX + 2, charY - 10, 'x', f)
      for (let i = 0; i < 6; i++) p.set(dx + 7 + ((noise(i, f) - 0.5) * 8 | 0), yb - 19 - ((noise(i, f, 1) * 6) | 0), C.grey)
    }
  } else if (act === 'read') {
    p.sprite(f % 4 < 2 ? READ_A : READ_B, bx - 8, charY, look, false, C.ink)
  } else if (act === 'wait') {
    const wxp = dx + 22
    p.sprite(f % 2 ? CHEER : STAND, wxp, charY - (f % 2), look, false, C.ink)
    bubble(p, wxp - 1, charY - 11, 'alert', f)
  } else if (act === 'done') {
    const hop = f % 2
    p.sprite(hop ? CHEER : STAND, dx + 22, charY - hop, look, false, C.ink)
    bubble(p, dx + 21, charY - 11, 'check', f)
  } else if (act === 'sleep') {
    p.sprite(SLEEP, deskX, charY, look, false, C.ink)
    const zy = ((t / 400) | 0) % 6
    p.text('Z', deskX + 6, charY - 2 - zy, C.blueD)
    if (zy > 2) p.text('Z', deskX + 9, charY - zy - 6, C.slate)
  } else if (act === 'idle') {
    // a 60 s routine: sit, walk to the coffee machine, sip, walk back
    const seed = (hashStr(fl.id) % 60000)
    const ph2 = ((t + seed) % 60000) / 1000
    const from = deskX + 6, to = coffeeX - 4
    const sip = (q: Pix, x: number, k: number) => {
      q.rect(x + 5, charY + 5, 2, 2, C.white)
      for (let j = 0; j < 3; j++) { const sy = (k * 2 + j * 3) % 8; q.set(x + 5 + (j % 2), charY + 4 - sy, C.greyL) }
    }
    if (opts.svg) {
      // the same routine, moved by the SVG one pixel at a time
      opts.actors?.push({
        period: 60, phase: ph2, path: [[0, deskX, 0], [20 / 60, deskX, 0], [20 / 60, from, 0], [30 / 60, to, 0], [42 / 60, to, 0], [52 / 60, from, 0], [52 / 60, deskX, 0], [1, deskX, 0]],
        poses: [
          { from: 0, to: 20 / 60, draw: q => q.sprite(SIT_A, 0, charY, look, false, C.ink) },
          ...[0, 1].map(l => ({ from: 20 / 60, to: 30 / 60, legs: l as 0 | 1, draw: (q: Pix) => q.sprite(l ? SIDE_B : SIDE_A, 0, charY, look, false, C.ink) })),
          ...[0, 1].map(l => ({ from: 30 / 60, to: 42 / 60, legs: l as 0 | 1, draw: (q: Pix) => { q.sprite(STAND, 0, charY, look, false, C.ink); sip(q, 0, l) } })),
          ...[0, 1].map(l => ({ from: 42 / 60, to: 52 / 60, legs: l as 0 | 1, draw: (q: Pix) => q.sprite(l ? SIDE_B : SIDE_A, 0, charY, look, true, C.ink) })),
          { from: 52 / 60, to: 1, draw: q => q.sprite(SIT_A, 0, charY, look, false, C.ink) },
        ],
      })
    } else {
      let x = deskX, pose = SIT_A, flip = false
      if (ph2 < 20) { x = deskX; pose = SIT_A }
      else if (ph2 < 30) { x = from + ((to - from) * (ph2 - 20)) / 10; pose = f % 2 ? SIDE_A : SIDE_B }
      else if (ph2 < 42) { x = to; pose = STAND }
      else if (ph2 < 52) { x = to - ((to - from) * (ph2 - 42)) / 10; pose = f % 2 ? SIDE_A : SIDE_B; flip = true }
      p.sprite(pose, Math.round(x), charY, look, flip, C.ink)
      if (ph2 >= 30 && ph2 < 42) sip(p, Math.round(x), (t / 300) | 0)
    }
  }
  // steam from the desk mug while working
  if (!off && act !== 'idle') for (let k = 0; k < 2; k++) { const sy = ((t / 200 + k * 4) % 7) | 0; p.set(dx + 17 + ((noise(k, sy, 3) * 2) | 0), yb - 12 - sy, C.white) }
  // interns (subagents)
  const interns = fl.interns.filter(i => !i.done || t - i.since < 15000).slice(0, 5)
  interns.forEach((it, k) => {
    const il = lookOf(it.id)
    const ix = IX0 + 56 + k * 9
    const ikind: Activity = it.done ? 'done' : it.tool ? toolKind(it.tool) : 'think'
    const run = it.startedAt ? ` · ${mins(Math.max(0, (it.done ? it.since : t) - it.startedAt))}` : ''
    if (lite < 1) opts.hits?.push({ x: ix, y: charY - 9, w: 8, h: 19, title: `${it.kind || 'agent'} intern${it.desc ? ` "${it.desc}"` : ''} · ${it.done ? 'done' : `${verbOf(it.tool)}${it.detail ? ` ${it.detail}` : ''}`}${run}${it.tools ? ` · ${it.tools} tool${it.tools > 1 ? 's' : ''}` : ''}${!it.done && it.say ? ` · said "${it.say}"` : ''}` })
    if (k < 2) { p.rect(ix + 4, yb - 7, 6, 1, C.greyD); p.rect(ix + 6, yb - 10, 4, 3, C.grey); p.set(ix + 7, yb - 9, f % 2 ? C.cyan : C.blue); p.rect(ix + 8, yb - 6, 1, 6, C.greyD) }
    const age = t - it.since
    if (it.done) { p.sprite(f % 2 ? CHEER : STAND, ix, charY - (f % 2), il, false, C.ink); if (lite < 3) internBubble(p, ix, charY - 9 - (f % 2), 'done'); return }
    p.sprite(k < 2 ? (f % 2 ? SIT_A : SIT_B) : f % 2 ? READ_A : READ_B, ix, charY, il, false, C.ink)
    // the cap is the parent session's colour, so you can see whose intern it is
    p.rect(ix + 1, charY - 1, 5, 1, look.T)
    if (lite < 3) internBubble(p, ix, charY - 9, ikind)
    if (age < 2500) matrix(p, ix - 1, charY - 6, 9, 16, t, age / 2500)
  })
  // janitor sweeps after a compaction
  if (fl.compactAt && t - fl.compactAt < 9000) {
    const u = (t - fl.compactAt) / 9000
    const jx = Math.round(IX0 + 10 + u * (IX1 - IX0 - 30))
    p.sprite(f % 2 ? SIDE_A : SIDE_B, jx, charY, { H: C.grey, S: C.skinD, E: C.ink, T: C.teal, P: C.teal, B: C.ink }, false, C.ink)
    p.sprite(BROOM, jx + 7, yb - 5, { K: C.brown, Y: C.amber })
    for (let i = 0; i < 4; i++) p.set(jx + 9 + i, yb - 1 - ((noise(i, f) * 2) | 0), C.tan)
  }
  // a new floor materialises out of green code rain
  const extra = fl.interns.filter(i => !i.done || t - i.since < 15000).length - interns.length
  if (extra > 0) p.text(`+${extra}`, IX0 + 56 + 5 * 9, charY - 7, C.ink)
  const age = t - fl.bornAt
  if (age < 1800) matrix(p, IX0, t0 + 3, IX1 - IX0, FH - 5, t, age / 1800)
  // lighting: offline floors go dark; a working ticker glows at night
  p.light(IX0, t0, IX1 - IX0, FH, off ? (ph.kind === 'day' ? 2 : 3) : act === 'sleep' && ph.kind !== 'day' ? 1 : 0)
  if (!off) p.light(IX0 + 2, t0 + 3, IX1 - IX0 - 4, TK, 0)
  if (act === 'wait' && f % 2) p.glow(lx + 2, top + 5, 10, 0)
}

function drawLobby(p: Pix, top: number, tower: Tower, ph: ReturnType<typeof phaseOf>, f: number, t: number, opts: SceneOpts) {
  const yb = top + LOBBY - 2
  p.rect(IX0, top, IX1 - IX0, LOBBY, C.sand)
  p.rect(IX0, top, IX1 - IX0, 2, C.greyD)
  for (let x = IX0; x < IX1; x++) for (let y = yb - 3; y < yb + 2; y++) p.set(x, y, ((x >> 2) + (y >> 2)) % 2 ? C.white : C.greyL)
  // revolving glass doors
  const gx = IX0 + 70
  p.rect(gx, top + 8, 26, yb - top - 8, C.greyD)
  p.rect(gx + 1, top + 9, 24, yb - top - 9, C.cyan)
  const spin = f % 4
  p.rect(gx + 12, top + 9, 1, yb - top - 9, C.greyD)
  p.rect(gx + 3 + spin * 2, top + 9, 1, yb - top - 9, C.white)
  p.text('LOBBY', gx + 3, top + 2, C.greyD)
  // reception desk + receptionist bot
  const rx = IX0 + 18
  p.sprite(f % 8 < 7 ? STAND.slice(0, 6) : CHEER.slice(0, 6), rx + 5, yb - 15, { H: C.greyL, S: C.grey, E: C.cyan, T: C.slate, P: C.slate, B: C.ink }, false, C.ink)
  p.rect(rx, yb - 9, 18, 9, C.clay); p.rect(rx, yb - 10, 18, 1, C.amber)
  // trophy case with achievements
  const tx = IX0 + 110
  p.rect(tx, top + 6, 64, yb - top - 6, C.brown)
  p.rect(tx + 2, top + 8, 60, yb - top - 10, C.navy)
  p.rect(tx + 2, top + 15, 60, 1, C.brown)
  tower.trophies.slice(0, 14).forEach((_, i) => {
    const x = tx + 4 + (i % 7) * 8, y = top + 9 + Math.floor(i / 7) * 7
    p.rect(x, y, 5, 2, C.amber); p.rect(x + 1, y + 2, 3, 1, C.amber); p.rect(x + 2, y + 3, 1, 1, C.yellow); p.rect(x + 1, y + 4, 3, 1, C.brown)
    const isNew = tower.newTrophy && t - tower.newTrophy.at < 12000 && i === tower.trophies.length - 1
    if (isNew || noise(i, f >> 1) < 0.08) { p.set(x + (f % 5), y - 1 + (f % 3), C.white) }
  })
  if (tower.trophies.length === 0) p.text('NO TROPHIES', tx + 9, top + 18, C.slate)
  p.light(IX0, top, IX1 - IX0, LOBBY, 0)
  // the office cat wanders the lobby
  const span = IX1 - IX0 - 30
  const cat = { K: C.orange, E: C.ink }
  if (opts.svg) {
    // a 72 s loop: walk right, nap, walk back, sit and wash
    const x0 = IX0 + 10, x1 = x0 + span
    opts.actors?.push({
      period: 72, phase: (t / 1000) % 72, path: [[0, x0, yb - 4], [0.36, x1, yb - 4], [0.5, x1, yb - 4], [0.86, x0, yb - 4], [1, x0, yb - 4]],
      poses: [
        ...[0, 1].map(l => ({ from: 0, to: 0.36, legs: l as 0 | 1, draw: (q: Pix) => q.sprite(l ? CAT_B : CAT_A, 0, 0, cat, true, C.ink) })),
        { from: 0.36, to: 0.5, draw: q => q.sprite(CAT_NAP, 0, 0, cat, false, C.ink) },
        ...[0, 1].map(l => ({ from: 0.5, to: 0.86, legs: l as 0 | 1, draw: (q: Pix) => q.sprite(l ? CAT_B : CAT_A, 0, 0, cat, false, C.ink) })),
        { from: 0.86, to: 1, draw: q => q.sprite(CAT_A, 0, 0, cat, false, C.ink) },
      ],
    })
  } else {
    const cyc = (t / 140) % (span * 2)
    const catX = IX0 + 10 + (cyc < span ? cyc : span * 2 - cyc)
    const nap = noise((t / 20000) | 0, 5) < 0.3
    p.sprite(nap ? CAT_NAP : f % 2 ? CAT_A : CAT_B, Math.round(nap ? IX0 + 50 : catX), yb - 4, cat, !nap && cyc >= span, C.ink)
  }
}

function drawShell(p: Pix, roofY: number, groundY: number, ph: ReturnType<typeof phaseOf>) {
  // outer walls (brick) on both sides of the cutaway
  for (const [x0, w] of [[BX0 - 2, 4], [BX1 - 2, 4]] as const) {
    for (let y = roofY; y < groundY; y++) for (let x = x0; x < x0 + w; x++) p.set(x, y, (y % 4 === 0 || (x + ((y >> 2) % 2) * 2) % 4 === 0) ? C.brownD : C.rust)
    p.light(x0, roofY, w, groundY - roofY, ph.level)
  }
  p.rect(BX0 + 2 + SHAFT, roofY, 2, groundY - roofY, C.greyD)
  p.light(BX0 + 2 + SHAFT, roofY, 2, groundY - roofY, ph.level)
}

/** Draws the whole scene for frame time t into a fresh Pix. */
export function drawScene(tower: Tower, t: number, opts: SceneOpts = {}): Pix {
  const floors = tower.floors.slice(0, MAX_FLOORS)
  const n = Math.max(1, floors.length)
  const H = Math.max(sceneHeight(floors.length), Math.min(1024, opts.minH ?? 0))
  const p = new Pix(W, H)
  const f = Math.floor(t / 250)
  const ph = phaseOf(t)
  const groundY = H - GROUND
  const lobbyTop = groundY - LOBBY
  const roofY = lobbyTop - n * FH
  const rain = isRaining(t)
  drawSky(p, groundY, ph, f)
  // what follows is drawn over the backdrop; the SVG slides clouds between the two
  if (opts.svg) p.track()
  drawClouds(p, t, groundY, ph, opts)
  drawSkyline(p, groundY, ph, f)
  if (rain) drawRain(p, t, groundY)
  drawGround(p, groundY, H, ph, t, rain, opts)
  drawRoof(p, roofY, tower, ph, f, t)
  drawShell(p, roofY, groundY, ph)
  if (floors.length === 0) {
    const top = roofY
    p.rect(IX0, top, IX1 - IX0, FH, C.greyD)
    p.text('FOR RENT - START A SESSION', IX0 + 40, top + 10, C.greyL)
    p.light(IX0, top, IX1 - IX0, FH, 0)
  }
  floors.forEach((fl, i) => drawFloor(p, fl, i, roofY + (n - 1 - i) * FH, tower, ph, f, t, opts))
  drawLobby(p, lobbyTop, tower, ph, f, t, opts)
  drawShaft(p, roofY, groundY, tower, n, roofY, lobbyTop, t)
  if (tower.hidden) p.text(`+${tower.hidden} MORE`, BX1 + 4, roofY + 2, C.white)
  return p
}
