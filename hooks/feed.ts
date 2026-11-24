// Reads every running session from ~/.claude and keeps the tower's floors current.
// Only `sessions/*.json` are opened there; the `*.key` files beside them are secrets.
import { toolKind } from './world'
import type { Floor, Intern, Recent, Status, Tower } from './world'
import { MAX_FLOORS } from './scene'

export type Io = {
  list(path: string): Promise<{ name: string; kind: string; size: number; mtimeMs: number }[]>
  read(path: string, opts?: { offset?: number; length?: number }): Promise<string>
  stat(path: string): Promise<{ size: number; mtimeMs: number }>
}

/** What this session's own hooks know exactly; it beats what the files say. */
export type Live = { tool?: string; detail?: string; toolSince?: number; call?: string }
export type SelfInfo = { id: string; tool?: string; call?: string; detail?: string; toolSince?: number; subs?: Map<string, Live>; busy?: boolean; errorAt?: number; compactAt?: number; doneAt?: number; ctxPct?: number; costUsd?: number }

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
  /** Each running intern's transcript size when last read. */
  sizes: Map<string, number>
}

export const projectDir = (home: string, cwd: string) => `${home}/.claude/projects/${cwd.replace(/[^a-zA-Z0-9]/g, '-')}`

/** One line of text, control characters gone, at most `n` characters. */
export function clean(s: unknown, n: number): string | undefined {
  if (typeof s !== 'string') return undefined
  const t = s.split('\n').find(l => l.trim()) ?? ''
  const u = t.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!u) return undefined
  return u.length > n ? u.slice(0, n - 1).trimEnd() + '…' : u
}

const base = (p: unknown) => (typeof p === 'string' ? p.split('/').filter(Boolean).pop() : undefined)
const host = (u: unknown) => (typeof u === 'string' ? /^[a-z][a-z0-9+.-]*:\/\/(?:www\.)?([^/?#:]+)/i.exec(u)?.[1] : undefined)

/** What a tool call is about, in a few words: a file name, a command, a pattern, a host or a query. */
export function describeTool(name: string, input: unknown): string | undefined {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, any>
  const t = String(name).toLowerCase()
  let s: unknown
  switch (t) {
    case 'read': case 'edit': case 'multiedit': case 'write': case 'notebookedit': case 'notebookread':
      s = base(i.file_path ?? i.notebook_path ?? i.path); break
    case 'bash': case 'powershell': s = i.description ?? i.command; break
    case 'grep': case 'glob': s = i.pattern; break
    case 'webfetch': s = host(i.url); break
    case 'websearch': case 'toolsearch': s = i.query; break
    case 'agent': case 'task': s = i.description ?? i.subagent_type; break
    case 'skill': s = i.skill; break
    case 'todowrite': {
      const d = Array.isArray(i.todos) ? i.todos.find((x: any) => x?.status === 'in_progress') : undefined
      s = d?.activeForm ?? d?.content; break
    }
    case 'sendmessage': s = i.to ? `to ${i.to}` : undefined; break
    case 'askuserquestion': s = i.questions?.[0]?.header ?? i.questions?.[0]?.question; break
    default:
      s = i.description ?? base(i.file_path ?? i.path) ?? host(i.url) ?? i.query ?? i.pattern ?? i.command
  }
  return clean(s, 40)
}

/** A real prompt the person typed, not a tool result, command echo or system note. */
function promptText(j: any): string | undefined {
  if (j.isMeta || j.isSidechain || j.isCompactSummary) return undefined
  const c = j.message?.content
  const text = typeof c === 'string' ? c : Array.isArray(c) && !c.some((b: any) => b?.type === 'tool_result')
    ? c.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join(' ') : undefined
  if (!text || /^\s*[<\[]/.test(text) || text.startsWith('Caveat:')) return undefined
  return clean(text, 60)
}

/** Parses a transcript tail: the open tool, recent calls, last words, context tokens, last error and compaction. */
export function parseTail(text: string, cut: boolean) {
  const lines = text.split('\n')
  if (cut) lines.shift()
  const open = new Map<string, { name: string; at: number; detail?: string }>()
  const calls: (Recent & { id: string })[] = []
  let messages = 0
  let say: string | undefined, ask: string | undefined
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
      if (Array.isArray(j.message.content)) for (const b of j.message.content) {
        if (b?.type === 'tool_use') {
          open.set(b.id, { name: b.name, at, detail: describeTool(b.name, b.input) })
          calls.push({ id: b.id, kind: toolKind(b.name) })
        } else if (b?.type === 'text') say = clean(b.text, 60) ?? say
      }
    } else if (j.type === 'user' && j.message) {
      messages++
      ask = promptText(j) ?? ask
      if (Array.isArray(j.message.content)) for (const b of j.message.content) if (b?.type === 'tool_result') {
        open.delete(b.tool_use_id)
        if (b.is_error) {
          errorAt = at
          for (let k = calls.length - 1; k >= 0; k--) if (calls[k]!.id === b.tool_use_id) { calls[k]!.err = true; break }
        }
      }
    } else if (j.type === 'system') {
      if (j.subtype === 'compact_boundary') compactAt = at
      if (j.subtype === 'turn_duration') { turnEndAt = at; open.clear() }
    }
  }
  const last = [...open.values()].pop()
  const recent: Recent[] = calls.slice(-8).map(c => (c.err ? { kind: c.kind, err: true } : { kind: c.kind }))
  return { tool: last?.name, toolSince: last?.at, detail: last?.detail, recent, tools: calls.length, say, ask, ctxTokens, errorAt, compactAt, turnEndAt, messages }
}

/** Reads a transcript's tail and parses it, widening when one huge line fills it. */
async function tail(io: Io, file: string, size: number) {
  let r = parseTail('', false)
  for (let len = TAIL; ; len *= 4) {
    const offset = Math.max(0, size - len)
    let text: string
    try { text = await io.read(file, { offset, length: size - offset }) } catch { return undefined }
    r = parseTail(text, offset > 0)
    if (r.messages || offset === 0 || len >= TAIL_MAX) return r
  }
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
          startedAt: j.startedAt ?? now, file: `${pd}/${j.sessionId}.jsonl`, dir: `${pd}/${j.sessionId}/subagents`, tailSize: -1, metas: new Map(), sizes: new Map(),
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
      if (!tr.goneAt) { tr.goneAt = now; tr.floor.status = 'off'; tr.floor.tool = undefined; tr.floor.detail = undefined }
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
    if (f.status !== 'busy') { f.tool = undefined; f.detail = undefined }
    if (st.size === tr.tailSize) return
    const r = await tail(io, tr.file, st.size)
    if (!r) return
    tr.tailSize = st.size
    if (f.status === 'busy') { f.tool = r.tool; f.toolSince = r.toolSince; f.detail = r.detail } else { f.tool = undefined; f.detail = undefined }
    f.recent = r.recent
    if (r.say) f.say = r.say
    if (r.ask) f.ask = r.ask
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
      let old = tr.metas.get(id)
      const log = mtime.get(`${id}.jsonl`) ?? e.mtimeMs
      if (old?.done) {
        // a finished intern stays finished; one that only went quiet comes back when it writes again
        if (old.stale === undefined || log <= old.stale) continue
        old = undefined
      }
      if (!old && now - log > INTERN_STALE_MS) { tr.metas.set(id, { id, kind: '', done: true, since: 0, stale: log }); continue }
      let m: any
      try { m = JSON.parse(await io.read(`${tr.dir}/${e.name}`)) } catch { continue }
      if (!m || typeof m !== 'object') continue
      const done = !!m.finished || now - log > INTERN_STALE_MS
      const stale = done && !m.finished ? log : undefined
      let it: Intern
      if (!old) {
        it = { id, kind: m.agentType ?? 'agent', desc: clean(m.description, 60), done, since: this.first ? now - 60000 : now, stale }
        if (!done && !this.first) this.elevator = { at: now, id: tr.floor.id }
      } else it = done ? { ...old, done: true, since: now, tool: undefined, detail: undefined, stale } : { ...old }
      tr.metas.set(id, it)
      if (done) { tr.sizes.delete(id); continue }
      const file = `${tr.dir}/${id}.jsonl`
      const size = list.find(x => x.name === `${id}.jsonl`)?.size
      if (size === undefined || size === tr.sizes.get(id)) continue
      if (it.startedAt === undefined) {
        try {
          // the first line holds the whole task prompt before its timestamp, so read well past it
          const head = await io.read(file, { offset: 0, length: Math.min(size, 65536) })
          const ts = /"timestamp":"([^"]+)"/.exec(head)?.[1]
          it.startedAt = ts ? Date.parse(ts) : now
        } catch { it.startedAt = now }
      }
      const r = await tail(io, file, size)
      if (!r) continue
      tr.sizes.set(id, size)
      Object.assign(it, { tool: r.tool, detail: r.detail, toolSince: r.toolSince, recent: r.recent, tools: Math.max(it.tools ?? 0, r.tools) })
      if (r.say) it.say = r.say
    }
    for (const id of tr.sizes.keys()) if (!tr.metas.has(id)) tr.sizes.delete(id)
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
    if (s.busy) { f.tool = s.tool; f.toolSince = s.toolSince; f.detail = s.tool ? s.detail : undefined }
    // this session's own subagents: their tool.call hooks are exact and instant
    if (s.subs) for (const it of f.interns) {
      const l = !it.done ? s.subs.get(it.id.replace(/^agent-/, '')) : undefined
      if (l?.tool) { it.tool = l.tool; it.detail = l.detail; it.toolSince = l.toolSince }
    }
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
