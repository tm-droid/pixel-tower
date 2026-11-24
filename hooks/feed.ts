// Reads every running session from ~/.claude and keeps the tower's floors current.
// Only `sessions/*.json` are opened there; the `*.key` files beside them are secrets.
import type { Floor, Intern, Status, Tower } from './world'
import { MAX_FLOORS } from './scene'

export type Io = {
  list(path: string): Promise<{ name: string; kind: string; size: number; mtimeMs: number }[]>
  read(path: string, opts?: { offset?: number; length?: number }): Promise<string>
  stat(path: string): Promise<{ size: number; mtimeMs: number }>
}

/** What this session's own hooks know exactly; it beats what the files say. */
export type SelfInfo = { id: string; tool?: string; toolSince?: number; busy?: boolean; errorAt?: number; compactAt?: number; doneAt?: number; ctxPct?: number; costUsd?: number }

const TAIL = 96 * 1024
const TAIL_MAX = 4 * 1024 * 1024
const OFF_KEEP_MS = 10 * 60 * 1000
const INTERN_STALE_MS = 10 * 60 * 1000

type Track = {
  floor: Floor
  startedAt: number
  file: string
  dir: string
  tailSize: number
  goneAt?: number
  metas: Map<string, Intern>
}

export const projectDir = (home: string, cwd: string) => `${home}/.claude/projects/${cwd.replace(/[^a-zA-Z0-9]/g, '-')}`

/** Parses a transcript tail: the open tool, context tokens, last error and compaction. */
export function parseTail(text: string, cut: boolean) {
  const lines = text.split('\n')
  if (cut) lines.shift()
  const open = new Map<string, { name: string; at: number }>()
  let messages = 0
  let ctxTokens: number | undefined, errorAt: number | undefined, compactAt: number | undefined, turnEndAt: number | undefined
  for (const line of lines) {
    if (!line || line[0] !== '{') continue
    let j: any
    try { j = JSON.parse(line) } catch { continue }
    const at = j.timestamp ? Date.parse(j.timestamp) : 0
    if (j.type === 'assistant' && j.message) {
      messages++
      const u = j.message.usage
      if (u && !j.isSidechain) ctxTokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
      if (Array.isArray(j.message.content)) for (const b of j.message.content) if (b?.type === 'tool_use') open.set(b.id, { name: b.name, at })
    } else if (j.type === 'user' && Array.isArray(j.message?.content)) {
      messages++
      for (const b of j.message.content) if (b?.type === 'tool_result') {
        open.delete(b.tool_use_id)
        if (b.is_error) errorAt = at
      }
    } else if (j.type === 'system') {
      if (j.subtype === 'compact_boundary') compactAt = at
      if (j.subtype === 'turn_duration') { turnEndAt = at; open.clear() }
    }
  }
  const last = [...open.values()].pop()
  return { tool: last?.name, toolSince: last?.at, ctxTokens, errorAt, compactAt, turnEndAt, messages }
}

export class Feed {
  tracks = new Map<string, Track>()
  elevator: { at: number; id?: string } = { at: 0 }
  /** Context window for other sessions' batteries: this session's own, when known. */
  window = 200000
  private first = true
  private byFile = new Map<string, string>()

  async poll(io: Io, home: string, now: number, self?: SelfInfo) {
    const dir = `${home}/.claude/sessions`
    let entries: Awaited<ReturnType<Io['list']>> = []
    try { entries = await io.list(dir) } catch { return }
    const seen = new Set<string>()
    for (const e of entries) {
      if (e.kind !== 'file' || !e.name.endsWith('.json')) continue
      let j: any
      try { j = JSON.parse(await io.read(`${dir}/${e.name}`)) } catch { const id = this.byFile.get(e.name); if (id) seen.add(id); continue }
      if (!j?.sessionId || !j.cwd) continue
      this.byFile.set(e.name, j.sessionId)
      seen.add(j.sessionId)
      const status: Status = j.status === 'busy' || j.status === 'waiting' ? j.status : 'idle'
      const base = String(j.cwd).split('/').filter(Boolean).pop() ?? 'home'
      const name = j.cwd === home ? (j.name || 'home') : base
      let tr = this.tracks.get(j.sessionId)
      if (!tr) {
        const pd = projectDir(home, j.cwd)
        tr = {
          startedAt: j.startedAt ?? now, file: `${pd}/${j.sessionId}.jsonl`, dir: `${pd}/${j.sessionId}/subagents`, tailSize: -1, metas: new Map(),
          floor: { id: j.sessionId, name, entry: j.entrypoint ?? '', status, bornAt: this.first ? now - 1e6 : now, statusSince: j.statusUpdatedAt ?? now, interns: [], isSelf: false },
        }
        this.tracks.set(j.sessionId, tr)
        if (!this.first) this.elevator = { at: now, id: j.sessionId }
      }
      const f = tr.floor
      tr.goneAt = undefined
      if (f.status === 'busy' && status === 'idle' && !this.first) f.doneAt = now
      if (f.status !== status) f.statusSince = j.statusUpdatedAt ?? now
      f.status = status
      f.waitingFor = j.waitingFor ?? null
      f.name = name
      await this.readTail(io, tr)
      await this.readInterns(io, tr, now)
    }
    for (const [id, tr] of this.tracks) {
      if (seen.has(id)) continue
      if (!tr.goneAt) { tr.goneAt = now; tr.floor.status = 'off'; tr.floor.tool = undefined }
      if (now - tr.goneAt > OFF_KEEP_MS) this.tracks.delete(id)
    }
    const names = new Set(entries.map(e => e.name))
    for (const n of this.byFile.keys()) if (!names.has(n)) this.byFile.delete(n)
    if (self) this.applySelf(self, now)
    this.first = false
  }

  private async readTail(io: Io, tr: Track) {
    let st
    try { st = await io.stat(tr.file) } catch { return }
    const f = tr.floor
    if (f.status !== 'busy') f.tool = undefined
    if (st.size === tr.tailSize) return
    // A huge line can fill the whole tail; widen until a message is found
    let r = parseTail("", false)
    for (let len = TAIL; ; len *= 4) {
      const offset = Math.max(0, st.size - len)
      let text: string
      try { text = await io.read(tr.file, { offset, length: st.size - offset }) } catch { return }
      r = parseTail(text, offset > 0)
      if (r.messages || offset === 0 || len >= TAIL_MAX) break
    }
    tr.tailSize = st.size
    if (f.status === 'busy') { f.tool = r.tool; f.toolSince = r.toolSince } else f.tool = undefined
    if (r.ctxTokens !== undefined) f.ctxPct = Math.min(100, (r.ctxTokens / (r.ctxTokens > this.window ? 1000000 : this.window)) * 100)
    if (r.errorAt) f.errorAt = r.errorAt
    if (r.compactAt) f.compactAt = r.compactAt
  }

  private async readInterns(io: Io, tr: Track, now: number) {
    let list
    try { list = await io.list(tr.dir) } catch { tr.floor.interns = []; return }
    const mtime = new Map(list.map(e => [e.name, e.mtimeMs]))
    for (const id of tr.metas.keys()) if (!mtime.has(`${id}.meta.json`)) tr.metas.delete(id)
    for (const e of list) {
      if (!e.name.endsWith('.meta.json')) continue
      const id = e.name.slice(0, -'.meta.json'.length)
      const old = tr.metas.get(id)
      if (old?.done) continue
      const log = mtime.get(`${id}.jsonl`) ?? e.mtimeMs
      if (!old && now - log > INTERN_STALE_MS) { tr.metas.set(id, { id, kind: '', done: true, since: 0 }); continue }
      let m: any
      try { m = JSON.parse(await io.read(`${tr.dir}/${e.name}`)) } catch { continue }
      const done = !!m.finished || now - log > INTERN_STALE_MS
      if (!old) {
        tr.metas.set(id, { id, kind: m.agentType ?? 'agent', done, since: this.first ? now - 60000 : now })
        if (!done && !this.first) this.elevator = { at: now, id: tr.floor.id }
      } else if (done) tr.metas.set(id, { ...old, done: true, since: now })
    }
    tr.floor.interns = [...tr.metas.values()].filter(i => !i.done || now - i.since < 15000)
  }

  private applySelf(s: SelfInfo, now: number) {
    for (const tr of this.tracks.values()) tr.floor.isSelf = tr.floor.id === s.id
    const tr = this.tracks.get(s.id)
    if (!tr) return
    const f = tr.floor
    if (s.busy !== undefined && f.status !== 'waiting' && f.status !== 'off') {
      if (s.busy && f.status !== 'busy') f.statusSince = now
      f.status = s.busy ? 'busy' : 'idle'
    }
    if (s.busy) { f.tool = s.tool; f.toolSince = s.toolSince }
    for (const k of ['errorAt', 'compactAt', 'doneAt', 'ctxPct', 'costUsd'] as const) if (s[k] !== undefined) (f as any)[k] = s[k]
  }

  /** The floors, oldest at the bottom, the most recently active kept when over the cap. */
  tower(now: number, extra: Pick<Tower, 'energyPct' | 'trophies' | 'newTrophy'>): Tower {
    let trs = [...this.tracks.values()]
    const live = trs.filter(t => t.floor.status !== 'off').length
    const all = trs.length
    if (trs.length > MAX_FLOORS) {
      const rank = (t: Track) => (t.floor.status === 'off' ? 0 : t.floor.status === 'idle' ? 1 : 2) * 1e13 + t.floor.statusSince
      trs = trs.sort((a, b) => rank(b) - rank(a)).slice(0, MAX_FLOORS)
    }
    trs.sort((a, b) => a.startedAt - b.startedAt)
    const floors = trs.map(t => t.floor)
    const e = this.elevator
    const to = e.id ? floors.findIndex(f => f.id === e.id) : -1
    return { floors, now, live, hidden: all - floors.length, ...extra, elevator: { from: -1, to, at: e.at } }
  }
}
