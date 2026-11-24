// The tower's world model: plain data, no `$`.

export type Status = 'busy' | 'idle' | 'waiting' | 'off'
export type Activity = 'type' | 'read' | 'bash' | 'web' | 'think' | 'delegate' | 'wait' | 'done' | 'idle' | 'sleep' | 'off' | 'error'

/** One recent tool call: its kind, and whether it failed. */
export type Recent = { kind: Activity; err?: boolean }

export type Intern = {
  id: string
  kind: string
  done: boolean
  since: number
  /** What it was asked to do (the Agent call's description). */
  desc?: string
  tool?: string
  /** The open tool's target: a file name, command, pattern, host or query. */
  detail?: string
  toolSince?: number
  /** When its transcript began. */
  startedAt?: number
  /** Tool calls seen in its transcript tail. */
  tools?: number
  recent?: Recent[]
  /** First line of its last message. */
  say?: string
  /** Set when it went quiet without finishing: its transcript's mtime then, so new writes bring it back. */
  stale?: number
}

export type Floor = {
  id: string
  name: string
  entry: string
  status: Status
  bornAt: number
  waitingFor?: string | null
  tool?: string
  toolSince?: number
  /** The open tool's target: a file name, command, pattern, host or query. */
  detail?: string
  /** The last few tool calls, oldest first. */
  recent?: Recent[]
  /** First line of the session's last message. */
  say?: string
  /** The person's last prompt. */
  ask?: string
  statusSince: number
  doneAt?: number
  errorAt?: number
  compactAt?: number
  interns: Intern[]
  ctxPct?: number
  costUsd?: number
  isSelf: boolean
}

export type Tower = {
  floors: Floor[]
  /** Sessions open, counted before the floor cap. */
  live?: number
  /** Floors left out by the cap. */
  hidden?: number
  now: number
  energyPct?: number
  trophies: string[]
  newTrophy?: { name: string; at: number }
  elevator: { from: number; to: number; at: number }
}

export function toolKind(tool?: string): Activity {
  if (!tool) return 'think'
  const t = tool.toLowerCase()
  if (/^(read|grep|glob|ls|notebookread|toolsearch)$/.test(t) || t.includes('search_') || t.includes('read')) return 'read'
  if (/^(edit|write|multiedit|notebookedit)$/.test(t)) return 'type'
  if (/^(bash|bashoutput|killshell|monitor|powershell)$/.test(t) || t.includes('execute')) return 'bash'
  if (/^(webfetch|websearch)$/.test(t) || t.includes('browser') || t.includes('fetch') || t.includes('navigate')) return 'web'
  if (/^(agent|task|workflow|sendmessage)$/.test(t)) return 'delegate'
  if (/^(askuserquestion|exitplanmode)$/.test(t)) return 'wait'
  return 'type'
}

const VERB: Record<string, string> = {
  read: 'READ', notebookread: 'READ', edit: 'EDIT', multiedit: 'EDIT', notebookedit: 'EDIT', write: 'WRITE',
  bash: 'RUN', powershell: 'RUN', bashoutput: 'WATCH', monitor: 'WATCH', killshell: 'STOP', grep: 'GREP', glob: 'FIND',
  webfetch: 'FETCH', websearch: 'SEARCH', agent: 'SPAWN', task: 'SPAWN', skill: 'SKILL', todowrite: 'PLAN',
  toolsearch: 'TOOLS', askuserquestion: 'ASK', exitplanmode: 'PLAN', sendmessage: 'MSG', workflow: 'FLOW',
}

/** A short upper-case verb for a tool: READ, EDIT, RUN, or an MCP tool's own name. */
export function verbOf(tool?: string): string {
  if (!tool) return 'THINK'
  const v = VERB[tool.toLowerCase()]
  if (v) return v
  const name = tool.startsWith('mcp__') ? tool.split('__').slice(2).join(' ') : tool
  return name.replace(/[_-]+/g, ' ').trim().toUpperCase().slice(0, 10) || 'TOOL'
}

export const DONE_MS = 9000
export const SLEEP_MS = 12 * 60 * 1000
export const ERROR_MS = 4000

export function activityOf(f: Floor, now: number): Activity {
  if (f.status === 'off') return 'off'
  if (f.status === 'waiting') return 'wait'
  if (f.status === 'busy') {
    if (f.errorAt && now - f.errorAt < ERROR_MS) return 'error'
    return toolKind(f.tool)
  }
  if (f.doneAt && now - f.doneAt < DONE_MS) return 'done'
  if (now - f.statusSince > SLEEP_MS) return 'sleep'
  return 'idle'
}

export function emptyTower(now: number): Tower {
  return { floors: [], now, trophies: [], elevator: { from: 0, to: 0, at: now } }
}
