// Indexed-colour PNG encoder with a small LZ77 + fixed-Huffman deflate.
// No Node, no DOM: runs in the mod's sandbox.

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(b: Uint8Array, from: number, to: number): number {
  let c = 0xffffffff
  for (let i = from; i < to; i++) c = CRC[(c ^ b[i]!) & 255]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const LCODE = new Uint8Array(259)
for (let i = 0; i < 29; i++) for (let l = LBASE[i]!; l < (i < 28 ? LBASE[i + 1]! : 259); l++) LCODE[l] = i
LCODE[258] = 28
const DCODE = new Uint8Array(32769)
for (let i = 0; i < 30; i++) for (let d = DBASE[i]!; d < (i < 29 ? DBASE[i + 1]! : 32769); d++) DCODE[d] = i

class Bits {
  buf: Uint8Array
  pos = 0
  bit = 0
  cur = 0
  constructor(n: number) { this.buf = new Uint8Array(Math.max(64, n)) }
  byte(b: number) {
    if (this.pos >= this.buf.length) { const nb = new Uint8Array(this.buf.length * 2); nb.set(this.buf); this.buf = nb }
    this.buf[this.pos++] = b
  }
  put(v: number, n: number) {
    for (let i = 0; i < n; i++) {
      this.cur |= ((v >>> i) & 1) << this.bit
      if (++this.bit === 8) { this.byte(this.cur); this.cur = 0; this.bit = 0 }
    }
  }
  huff(code: number, len: number) {
    let r = 0
    for (let i = 0; i < len; i++) r = (r << 1) | ((code >>> i) & 1)
    this.put(r, len)
  }
  lit(v: number) {
    if (v < 144) this.huff(0x30 + v, 8)
    else if (v < 256) this.huff(0x190 + v - 144, 9)
    else if (v < 280) this.huff(v - 256, 7)
    else this.huff(0xc0 + v - 280, 8)
  }
  done(): Uint8Array { if (this.bit) { this.byte(this.cur); this.cur = 0; this.bit = 0 } return this.buf.subarray(0, this.pos) }
}

/** zlib stream (RFC 1950) of one fixed-Huffman deflate block. */
export function zlib(raw: Uint8Array): Uint8Array {
  const n = raw.length
  const w = new Bits(n / 4 + 64)
  w.byte(0x78); w.byte(0x01)
  w.put(1, 1); w.put(1, 2)
  const HB = 15, HS = 1 << HB
  const head = new Int32Array(HS).fill(-1)
  const prev = new Int32Array(n)
  const hash = (i: number) => ((raw[i]! << 10) ^ (raw[i + 1]! << 5) ^ raw[i + 2]!) & (HS - 1)
  let i = 0
  while (i < n) {
    let bestLen = 0, bestDist = 0
    if (i + 2 < n) {
      const h = hash(i)
      let j = head[h]!, chain = 48
      const max = Math.min(258, n - i)
      while (j >= 0 && i - j <= 32768 && chain-- > 0) {
        if (raw[j + bestLen] === raw[i + bestLen]) {
          let l = 0
          while (l < max && raw[j + l] === raw[i + l]) l++
          if (l > bestLen) { bestLen = l; bestDist = i - j; if (l === max) break }
        }
        j = prev[j]!
      }
      prev[i] = head[h]!; head[h] = i
    }
    if (bestLen >= 3) {
      const lc = LCODE[bestLen]!
      w.lit(257 + lc); w.put(bestLen - LBASE[lc]!, LEXT[lc]!)
      const dc = DCODE[bestDist]!
      w.huff(dc, 5); w.put(bestDist - DBASE[dc]!, DEXT[dc]!)
      for (let k = 1; k < bestLen; k++) {
        const p = i + k
        if (p + 2 < n) { const h = hash(p); prev[p] = head[h]!; head[h] = p }
      }
      i += bestLen
    } else {
      w.lit(raw[i]!); i++
    }
  }
  w.lit(256)
  const out = w.done()
  let a = 1, b = 0
  for (let k = 0; k < n; k++) { a = (a + raw[k]!) % 65521; b = (b + a) % 65521 }
  const res = new Uint8Array(out.length + 4)
  res.set(out)
  new DataView(res.buffer).setUint32(out.length, ((b << 16) | a) >>> 0)
  return res
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const o = new Uint8Array(12 + data.length)
  const dv = new DataView(o.buffer)
  dv.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) o[4 + i] = type.charCodeAt(i)
  o.set(data, 8)
  dv.setUint32(8 + data.length, crc32(o, 4, 8 + data.length))
  return o
}

/**
 * Encodes an 8-bit indexed image. `palette` is 0xRRGGBB per index; with
 * `transparent0` index 0 is fully transparent.
 */
export function encodePng(w: number, h: number, px: Uint8Array, palette: number[], transparent0 = false): Uint8Array {
  const raw = new Uint8Array((w + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0
    raw.set(px.subarray(y * w, y * w + w), y * (w + 1) + 1)
  }
  const ih = new Uint8Array(13)
  const dv = new DataView(ih.buffer)
  dv.setUint32(0, w); dv.setUint32(4, h); ih[8] = 8; ih[9] = 3
  const pl = new Uint8Array(palette.length * 3)
  palette.forEach((c, i) => { pl[i * 3] = (c >> 16) & 255; pl[i * 3 + 1] = (c >> 8) & 255; pl[i * 3 + 2] = c & 255 })
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('PLTE', pl)]
  if (transparent0) parts.push(chunk('tRNS', new Uint8Array([0])))
  parts.push(chunk('IDAT', zlib(raw)), chunk('IEND', new Uint8Array(0)))
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
export function base64(b: Uint8Array): string {
  let s = ''
  let i = 0
  for (; i + 2 < b.length; i += 3) {
    const n = (b[i]! << 16) | (b[i + 1]! << 8) | b[i + 2]!
    s += B64[n >> 18]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!
  }
  if (i < b.length) {
    const n = (b[i]! << 16) | ((b[i + 1] ?? 0) << 8)
    s += B64[n >> 18]! + B64[(n >> 12) & 63]! + (i + 1 < b.length ? B64[(n >> 6) & 63]! : '=') + '='
  }
  return s
}

export function pngDataUri(w: number, h: number, px: Uint8Array, palette: number[], transparent0 = false): string {
  return 'data:image/png;base64,' + base64(encodePng(w, h, px, palette, transparent0))
}
