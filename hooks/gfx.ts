// Palette (Endesga 32), an indexed pixel canvas, a 3x5 pixel font and a seeded RNG.

export const BASE = [
  0xbe4a2f, 0xd77643, 0xead4aa, 0xe4a672, 0xb86f50, 0x733e39, 0x3e2731, 0xa22633,
  0xe43b44, 0xf77622, 0xfeae34, 0xfee761, 0x63c74d, 0x3e8948, 0x265c42, 0x193c3e,
  0x124e89, 0x0099db, 0x2ce8f5, 0xffffff, 0xc0cbdc, 0x8b9bb4, 0x5a6988, 0x3a4466,
  0x262b44, 0x181425, 0xff0044, 0x68386c, 0xb55088, 0xf6757a, 0xe8b796, 0xc28569,
]

// Named palette indices.
export const C = {
  rust: 0, clay: 1, sand: 2, skin: 3, skinD: 4, brown: 5, brownD: 6, redD: 7,
  red: 8, orange: 9, amber: 10, yellow: 11, green: 12, greenD: 13, greenDD: 14, teal: 15,
  blueD: 16, blue: 17, cyan: 18, white: 19, greyL: 20, grey: 21, greyD: 22, slate: 23,
  navy: 24, ink: 25, hot: 26, purple: 27, pink: 28, salmon: 29, peach: 30, tan: 31,
} as const

function mix(a: number, b: number, t: number): number {
  const r = Math.round(((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t)
  const g = Math.round(((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t)
  const bl = Math.round((a & 255) * (1 - t) + (b & 255) * t)
  return (r << 16) | (g << 8) | bl
}

// Shade levels: 0 lit, 1 dusk (warm purple), 2 night (deep blue), 3 dark (offline at night).
export const SHADES = 4
export const PALETTE: number[] = [
  ...BASE,
  ...BASE.map(c => mix(c, 0x68386c, 0.38)),
  ...BASE.map(c => mix(c, 0x141a3a, 0.62)),
  ...BASE.map(c => mix(c, 0x0b0b18, 0.82)),
]

/** Palette for an image whose index 0 is transparent: every colour shifted up one. */
export const PALETTE_T: number[] = [0, ...PALETTE]

export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
export const bayer = (x: number, y: number) => BAYER4[(y & 3) * 4 + (x & 3)]! / 16

export class Pix {
  readonly px: Uint8Array
  readonly shade: Uint8Array
  /** `ox` shifts the origin right, so drawing can reach left of x = 0. */
  constructor(readonly w: number, readonly h: number, readonly ox = 0) {
    this.px = new Uint8Array(w * h)
    this.shade = new Uint8Array(w * h)
  }
  /** After `track()`, 1 where something was drawn over the backdrop. */
  front: Uint8Array | undefined
  track() { this.front = new Uint8Array(this.w * this.h) }
  set(x: number, y: number, c: number) {
    x = (x | 0) + this.ox; y |= 0
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    this.px[y * this.w + x] = c
    if (this.front) this.front[y * this.w + x] = 1
  }
  get(x: number, y: number) { return this.px[(y | 0) * this.w + (x | 0) + this.ox] }
  rect(x: number, y: number, w: number, h: number, c: number) {
    const x0 = Math.max(0, (x | 0) + this.ox), y0 = Math.max(0, y | 0)
    const x1 = Math.min(this.w, ((x + w) | 0) + this.ox), y1 = Math.min(this.h, (y + h) | 0)
    for (let yy = y0; yy < y1; yy++) {
      this.px.fill(c, yy * this.w + x0, yy * this.w + x1)
      this.front?.fill(1, yy * this.w + x0, yy * this.w + x1)
    }
  }
  /** Sets the shade level over a rectangle. */
  light(x: number, y: number, w: number, h: number, level: number) {
    const x0 = Math.max(0, (x | 0) + this.ox), y0 = Math.max(0, y | 0)
    const x1 = Math.min(this.w, ((x + w) | 0) + this.ox), y1 = Math.min(this.h, (y + h) | 0)
    for (let yy = y0; yy < y1; yy++) this.shade.fill(level, yy * this.w + x0, yy * this.w + x1)
  }
  /** Runs `draw`, then sets the shade level of only the pixels it drew (not the backdrop between them). */
  lit(level: number, draw: () => void) {
    const outer = this.front
    const mine = (this.front = new Uint8Array(this.w * this.h))
    try { draw() } finally { this.front = outer }
    for (let i = 0; i < mine.length; i++) if (mine[i]) { this.shade[i] = level; if (outer) outer[i] = 1 }
  }
  /** A pool of light: pixels inside radius r (and at or below minY) go to `level`, with a dithered rim. */
  glow(cx: number, cy: number, r: number, level: number, minY = 0) {
    for (let y = Math.max(minY, Math.floor(cy - r)); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (x + this.ox < 0 || y < 0 || x + this.ox >= this.w || y >= this.h) continue
      const d = Math.hypot(x - cx, (y - cy) * 1.3) / r
      if (d > 1) continue
      const i = y * this.w + x + this.ox
      if (this.shade[i]! <= level) continue
      if (d < 0.65 || bayer(x, y) > (d - 0.65) / 0.35) this.shade[i] = level
    }
  }
  /** Draws a sprite of strings; each char maps through `map` ('.' or absent = skip). */
  sprite(rows: readonly string[], x: number, y: number, map: Record<string, number>, flip = false, outline?: number) {
    const at = (r: number, c: number) => {
      const row = rows[r]
      if (!row || c < 0 || c >= row.length) return false
      return map[row[flip ? row.length - 1 - c : c]!] !== undefined
    }
    // a dark rim around the figure keeps it readable on any wall
    if (outline !== undefined) for (let r = -1; r <= rows.length; r++) for (let c = -1; c <= (rows[0]?.length ?? 0); c++) {
      if (!at(r, c) && (at(r - 1, c) || at(r + 1, c) || at(r, c - 1) || at(r, c + 1))) this.set(x + c, y + r, outline)
    }
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!
      for (let c = 0; c < row.length; c++) {
        const ch = row[flip ? row.length - 1 - c : c]!
        const col = map[ch]
        if (col !== undefined) this.set(x + c, y + r, col)
      }
    }
  }
  text(s: string, x: number, y: number, c: number): number {
    let cx = x
    for (const ch of s.toUpperCase()) {
      const g = FONT[ch] ?? FONT['?']!
      for (let r = 0; r < 5; r++) {
        const bits = g.charCodeAt(r) - 48
        for (let b = 0; b < 3; b++) if (bits & (4 >> b)) this.set(cx + b, y + r, c)
      }
      cx += 4
    }
    return cx - x
  }
  /** Final indices with shading applied: base index + 32 * shade. */
  composite(): Uint8Array {
    const out = new Uint8Array(this.px.length)
    for (let i = 0; i < out.length; i++) out[i] = this.px[i]! + 32 * this.shade[i]!
    return out
  }
}

export const textWidth = (s: string) => s.length * 4 - 1

// 3x5 font: five rows, each an octal digit (bit 4 = left column).
const FONT: Record<string, string> = {
  A: '25755', B: '65656', C: '34443', D: '65556', E: '74647', F: '74644', G: '34553', H: '55755',
  I: '72227', J: '11153', K: '55655', L: '44447', M: '57755', N: '65555', O: '25552', P: '65644',
  Q: '25563', R: '65655', S: '34216', T: '72222', U: '55557', V: '55552', W: '55775', X: '55255',
  Y: '55222', Z: '71247', '0': '75557', '1': '26227', '2': '61247', '3': '61616', '4': '55711',
  '5': '74616', '6': '34652', '7': '71222', '8': '25252', '9': '75711', '.': '00002', ':': '02020',
  '-': '00700', '$': '36236', '%': '51245', '!': '22202', '?': '61202', '/': '11244', ' ': '00000',
  '_': '00007', '+': '02720', '#': '57575', '>': '42124', '<': '12421', '(': '24442', ')': '42224',
  "'": '22000', ',': '00024', '=': '07070', '*': '05250', '&': '25657', '|': '22222', '[': '64446', ']': '31113',
  '"': '55000', ';': '02024', '@': '25743', '{': '32423', '}': '62126', '~': '00360', '^': '25000', '`': '42000', '\\': '44211',
}

export function hashStr(s: string): number {
  let h = 1779033703 ^ s.length
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19) }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^ (h >>> 16)) >>> 0
}

export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Deterministic noise in [0,1) from integers. */
export function noise(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
