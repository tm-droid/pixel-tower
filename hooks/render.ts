// Turns scene frames into a desktop SVG (pure vector, SMIL + CSS motion) or terminal half-block cells.
import { PALETTE, Pix } from './gfx'
import { base64, encodePng } from './png'
import { drawScene, VIEW_W, W } from './scene'
import type { Actor, Hit } from './scene'
import type { Tower } from './world'

export const FRAMES = 8
export const FRAME_MS = 250
export const SVG_LIMIT = 131072

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`

/**
 * Each colour's pixels as paths: runs stacked on consecutive rows become one
 * filled rectangle, single-row runs a 1 px stroke. Moves are relative to keep it short.
 */
function paths(img: ArrayLike<number>, w: number, h: number, skip: number): string {
  type R = { x: number; y: number; w: number; c: number; k: number }
  const rects: R[] = []
  let open = new Map<number, R>()
  for (let y = 0; y < h; y++) {
    const next = new Map<number, R>()
    for (let x = 0; x < w;) {
      const c = img[y * w + x]!
      let e = x + 1
      while (e < w && img[y * w + e] === c) e++
      if (c !== skip) {
        const key = (x * 2048 + (e - x)) * 256 + c
        const o = open.get(key)
        if (o) { o.k++; next.set(key, o) } else { const r = { x, y, w: e - x, c, k: 1 }; rects.push(r); next.set(key, r) }
      }
      x = e
    }
    open = next
  }
  const by = new Map<number, R[]>()
  for (const r of rects) { let a = by.get(r.c); if (!a) by.set(r.c, a = []); a.push(r) }
  let fills = '', strokes = ''
  for (const [c, a] of by) {
    const col = hex(PALETTE[c]!)
    let f = '', s = '', fx = 0, fy = 0, sx = 0, sy = 0
    for (const r of a) {
      if (r.k > 1) { f += `m${r.x - fx} ${r.y - fy}h${r.w}v${r.k}h-${r.w}z`; fx = r.x; fy = r.y }
      else { s += `m${r.x - sx} ${r.y - sy}h${r.w}`; sx = r.x + r.w; sy = r.y }
    }
    if (f) fills += `<path fill="${col}" d="${f}"/>`
    if (s) strokes += `<path stroke="${col}" d="${s}"/>`
  }
  return fills + (strokes ? `<g transform="translate(0 .5)" fill="none" stroke-width="1">${strokes}</g>` : '')
}

/** Text for a `<title>`: escaped, without the control characters or lone surrogates the engine or XML would refuse, and kept short. */
const esc = (s: string) => s
  .slice(0, 160)
  .replace(/[\u0000-\u001f\u007f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const pct = (x: number) => +(x * 100).toFixed(3)
/** Room left of x = 0 on an actor's canvas, for clouds parked off to the left. */
const MARGIN = 400

/** Where an actor stands at loop fraction u (its resting place without animation). */
function posAt(a: Actor, u: number): [number, number] {
  const p = a.path
  for (let i = 0; i + 1 < p.length; i++) {
    const [t0, x0, y0] = p[i]!, [t1, x1, y1] = p[i + 1]!
    if (u >= t0 && u < t1) { const k = (u - t0) / (t1 - t0); return [Math.round(x0 + (x1 - x0) * k), Math.round(y0 + (y1 - y0) * k)] }
  }
  const l = p[p.length - 1]!
  return [l[1], l[2]]
}

/** One actor as markup plus its CSS: a moving group holding its poses. */
function actorSvg(a: Actor, ai: number, h: number): { css: string; svg: string } {
  const delay = `animation-delay:-${a.phase.toFixed(2)}s`
  let kf = ''
  a.path.forEach(([tt, x, y], i) => {
    const nx = a.path[i + 1]
    // two points at one time: hold the first until just before it, then jump
    if (nx && nx[0] === tt) { kf += `${Math.max(0, +(pct(tt) - 0.001).toFixed(3))}%{transform:translate(${x}px,${y}px);animation-timing-function:steps(1,end)}`; return }
    const n = nx ? Math.max(1, Math.round(Math.max(Math.abs(nx[1] - x), Math.abs(nx[2] - y)))) : 0
    kf += `${pct(tt)}%{transform:translate(${x}px,${y}px)${nx ? `;animation-timing-function:steps(${n},end)` : ''}}`
  })
  const u = a.phase / a.period
  const [rx, ry] = posAt(a, u)
  let css = `@keyframes m${ai}{${kf}}.m${ai}{transform:translate(${rx}px,${ry}px);animation:m${ai} ${a.period}s infinite;${delay}}`
  let body = ''
  a.poses.forEach((pose, j) => {
    const q = new Pix(W + 2 * MARGIN, h, MARGIN)
    q.track()
    pose.draw(q)
    const comp = q.composite()
    const layer = new Int16Array(comp.length)
    for (let i = 0; i < comp.length; i++) layer[i] = q.front![i] ? comp[i]! : -1
    let g = `<g transform="translate(-${MARGIN} 0)">${paths(layer, W + 2 * MARGIN, h, -1)}</g>`
    if (pose.legs !== undefined) g = `<g class="w${pose.legs ? 'b' : 'a'}">${g}</g>`
    if (pose.from !== undefined || pose.to !== undefined) {
      const from = pose.from ?? 0, to = pose.to ?? 1
      const on = u >= from && u < to
      const name = `p${ai}_${j}`
      const k = `0%{opacity:${from <= 0 ? 1 : 0}}${from > 0 ? `${pct(from)}%{opacity:1}` : ''}${to < 1 ? `${pct(to)}%{opacity:0}` : ''}100%{opacity:${to >= 1 ? 1 : 0}}`
      css += `@keyframes ${name}{${k}}.${name}{opacity:${on ? 1 : 0};animation:${name} ${a.period}s step-end infinite;${delay}}`
      g = `<g class="${name}">${g}</g>`
    }
    body += g
  })
  return { css, svg: `<g class="m${ai}">${body}</g>` }
}

/**
 * Pure vector (the engine refuses `<image>`), in layers: the sky, the actors
 * behind the building (clouds, birds), the building, the actors in front
 * (the cat, coffee walks, a car), then a hover title per floor.
 * Short loops (typing, LEDs, the sign) are eight frames 250 ms apart: frame 0
 * is drawn whole and each later frame adds only the pixels that differ,
 * shown in its own eighth of a 2 s SMIL loop. Long walks are CSS `steps()`
 * moves whose phase comes from real time, so a redraw never makes them jump.
 */
export function renderSvg(tower: Tower, t0: number, width = VIEW_W * 3, minH = 0): { svg: string; h: number; width: number; height: number } {
  const frames: Uint8Array[] = [], fronts: Uint8Array[] = []
  const actors: Actor[] = [], hits: Hit[] = []
  let h = 0
  for (let k = 0; k < FRAMES; k++) {
    const p = drawScene(tower, t0 + k * FRAME_MS, { minH, svg: true, actors: k ? undefined : actors, hits: k ? undefined : hits })
    h = p.h
    frames.push(p.composite())
    fronts.push(p.front!)
  }
  const n = W * h
  const bg = frames[0]!, f0 = fronts[0]!
  const height = Math.round((width * h) / VIEW_W)
  const count = new Map<number, number>()
  for (let i = 0; i < n; i++) if (!f0[i]) count.set(bg[i]!, (count.get(bg[i]!) ?? 0) + 1)
  const base = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? bg[0]!
  const back = new Int16Array(n), front = new Int16Array(n)
  for (let i = 0; i < n; i++) { back[i] = f0[i] ? base : bg[i]!; front[i] = f0[i] ? bg[i]! : -1 }
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${VIEW_W} ${h}" preserveAspectRatio="xMidYMin meet" shape-rendering="crispEdges">`
  let css = '@keyframes w{0%{visibility:visible}50%{visibility:hidden}}.wa,.wb{animation:w .5s step-end infinite}.wb{visibility:hidden;animation-delay:-.25s}.hv{fill:#fff;opacity:0}.hv:hover{opacity:.12}@media (prefers-reduced-motion:reduce){*{animation:none!important}}'
  const sky = `<rect width="${W}" height="${h}" fill="${hex(PALETTE[base]!)}"/>${paths(back, W, h, base)}`
  const bldg = paths(front, W, h, -1)
  const hover = hits.map(r => `<rect class="hv" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"><title>${esc(r.title)}</title></rect>`).join('')
  let size = head.length + css.length + sky.length + bldg.length + hover.length + 40
  // actors first (they carry the life), then as many short-loop frames as still fit
  const backA: string[] = [], frontA: string[] = []
  actors.forEach((a, ai) => {
    const r = actorSvg(a, ai, h)
    if (size + r.css.length + r.svg.length >= SVG_LIMIT) return
    size += r.css.length + r.svg.length
    css += r.css
    ;(a.back ? backA : frontA).push(r.svg)
  })
  const backF: string[] = [], frontF: string[] = []
  const lb = new Int16Array(n), lf = new Int16Array(n)
  const dur = `${(FRAMES * FRAME_MS) / 1000}s`
  for (let k = 1; k < FRAMES; k++) {
    const fr = frames[k]!, fk = fronts[k]!
    let nb = 0, nf = 0
    for (let i = 0; i < n; i++) {
      lb[i] = -1; lf[i] = -1
      if (fr[i] === bg[i] && fk[i] === f0[i]) continue
      if (fk[i] || f0[i]) { lf[i] = fr[i]!; nf++ } else { lb[i] = fr[i]!; nb++ }
    }
    const values = Array.from({ length: FRAMES }, (_, j) => (j === k ? 'visible' : 'hidden')).join(';')
    const wrap = (body: string) => `<g visibility="hidden"><animate attributeName="visibility" values="${values}" calcMode="discrete" dur="${dur}" repeatCount="indefinite"/>${body}</g>`
    const gb = nb ? wrap(paths(lb, W, h, -1)) : '', gf = nf ? wrap(paths(lf, W, h, -1)) : ''
    // a frame that would push the markup past the limit is left out, never the picture
    if (size + gb.length + gf.length >= SVG_LIMIT) continue
    size += gb.length + gf.length
    if (gb) backF.push(gb)
    if (gf) frontF.push(gf)
  }
  const svg = `${head}<style>${css}</style>${sky}${backF.join('')}${backA.join('')}${bldg}${frontF.join('')}${frontA.join('')}${hover}</svg>`
  return { svg, h, width, height }
}

/** Cells for a Raster: the scene box-filtered to `columns` x `rows*2` pixels, two per `▀` cell. */
export function renderCells(tower: Tower, t: number, columns: number, rows: number): { cells: string; columns: number; rows: number } {
  const p = drawScene(tower, t)
  const img = p.composite()
  const s = Math.min(1, columns / W, (rows * 2) / p.h)
  const cw = Math.max(1, Math.min(512, Math.floor(W * s)))
  const ph = Math.max(2, Math.floor(p.h * s))
  const ch = Math.max(1, Math.min(256, ph >> 1))
  const words = new Uint32Array(cw * ch * 3)
  const sample = (cx: number, py: number) => {
    const x0 = Math.floor((cx * W) / cw), x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * W) / cw))
    const y0 = Math.floor((py * p.h) / (ch * 2)), y1 = Math.max(y0 + 1, Math.floor(((py + 1) * p.h) / (ch * 2)))
    let r = 0, g = 0, b = 0, c = 0
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const v = PALETTE[img[y * W + x]!]!
      r += (v >> 16) & 255; g += (v >> 8) & 255; b += v & 255; c++
    }
    return ((Math.round(r / c) << 16) | (Math.round(g / c) << 8) | Math.round(b / c)) >>> 0
  }
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const o = (y * cw + x) * 3
    words[o] = 0x2580
    words[o + 1] = sample(x, y * 2)
    words[o + 2] = sample(x, y * 2 + 1)
  }
  return { cells: base64(new Uint8Array(words.buffer)), columns: cw, rows: ch }
}

/** One frame as a base64 PNG, for the terminal's Image element (kitty / Ghostty graphics). */
export function renderPng(tower: Tower, t: number): { png: string; h: number } {
  const p = drawScene(tower, t)
  return { png: base64(encodePng(W, p.h, p.composite(), PALETTE)), h: p.h }
}
