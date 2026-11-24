// The tower's world model: plain data, no `$`.

export type Status = 'busy' | 'idle' | 'waiting' | 'off'
export type Activity = 'type' | 'read' | 'bash' | 'web' | 'think' | 'delegate' | 'wait' | 'done' | 'idle' | 'sleep' | 'off' | 'error'

export type Intern = { id: string; kind: string; done: boolean; since: number }

export type Floor = {
  id: string
  name: string
  entry: string
  status: Status
  bornAt: number
  waitingFor?: string | null
  tool?: string
  toolSince?: number
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
