// Synthesises the 8-bit sound effects into sounds/*.wav. Run: node build/bake.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RATE = 22050
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'sounds')
mkdirSync(out, { recursive: true })

const hz = n => 440 * 2 ** ((n - 69) / 12)
const N = { G4: 67, C5: 72, E5: 76, G5: 79, A5: 81, C6: 84, E6: 88, G6: 91 }

/** notes: [midi | 0 (rest), ms, duty?, slide?] */
function synth(notes, vol = 0.22) {
  const samples = []
  for (const [note, ms, duty = 0.5, slide = 0] of notes) {
    const len = Math.round((RATE * ms) / 1000)
    let ph = 0
    for (let i = 0; i < len; i++) {
      const u = i / len
      const env = Math.min(1, i / 60) * (1 - u) ** 1.4
      const f = note ? hz(note + slide * u) : 0
      ph = (ph + f / RATE) % 1
      samples.push(note ? (ph < duty ? 1 : -1) * env * vol : 0)
    }
  }
  const data = Buffer.alloc(samples.length)
  samples.forEach((s, i) => { data[i] = Math.max(0, Math.min(255, Math.round(128 + s * 127))) })
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE, 28); h.writeUInt16LE(1, 32); h.writeUInt16LE(8, 34)
  h.write('data', 36); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

const fx = {
  done: synth([[N.C5, 70], [N.E5, 70], [N.G5, 70], [N.C6, 220, 0.25]]),
  alert: synth([[N.A5, 110, 0.25], [0, 50], [N.E5, 110, 0.25], [0, 90], [N.A5, 110, 0.25], [0, 50], [N.E5, 160, 0.25]], 0.18),
  trophy: synth([[N.G4, 90], [N.C5, 90], [N.E5, 90], [N.G5, 90], [N.C6, 150, 0.25], [N.G5, 80], [N.C6, 90, 0.125], [N.E6, 90, 0.125], [N.G6, 380, 0.125]]),
  ding: synth([[N.E6, 160, 0.125], [N.C6, 380, 0.125]], 0.16),
  spawn: synth([[N.C5, 260, 0.5, 24]], 0.12),
}
for (const [name, buf] of Object.entries(fx)) {
  writeFileSync(join(out, `${name}.wav`), buf)
  console.log(`${name}.wav ${buf.length} bytes`)
}
