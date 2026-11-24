// Achievements: each a test over the tower and this session's counters.
import type { Tower } from './world'

export type Counters = { bash: number; lastTurnMs?: number; lastTurnTools?: number; compacted?: boolean }

export const TROPHIES: { name: string; hint: string; test: (t: Tower, c: Counters) => boolean }[] = [
  { name: 'FIRST FLOOR', hint: 'Open the tower', test: t => t.floors.length > 0 },
  { name: 'BUSY BEES', hint: '3 floors working at once', test: t => t.floors.filter(f => f.status === 'busy').length >= 3 },
  { name: 'HIGH RISE', hint: '5 sessions open at once', test: t => (t.live ?? t.floors.filter(f => f.status !== 'off').length) >= 5 },
  { name: 'SKYSCRAPER', hint: '10 sessions open at once', test: t => (t.live ?? t.floors.filter(f => f.status !== 'off').length) >= 10 },
  { name: 'INTERN ARMY', hint: '5 subagents working at once', test: t => t.floors.reduce((s, f) => s + f.interns.filter(i => !i.done).length, 0) >= 5 },
  { name: 'NIGHT OWL', hint: 'A floor working between 2 and 5 am', test: t => { const h = new Date(t.now).getHours(); return h >= 2 && h < 5 && t.floors.some(f => f.status === 'busy') } },
  { name: 'BASH WIZARD', hint: '100 Bash calls here', test: (_, c) => c.bash >= 100 },
  { name: 'SPEEDRUN', hint: 'A turn with tools in under 10 s', test: (_, c) => c.lastTurnMs !== undefined && c.lastTurnMs < 10000 && (c.lastTurnTools ?? 0) > 0 },
  { name: 'MARATHON', hint: 'A turn over 30 minutes', test: (_, c) => (c.lastTurnMs ?? 0) > 30 * 60 * 1000 },
  { name: 'JANITOR', hint: 'Compact a context', test: (_, c) => !!c.compacted },
  { name: 'RED ZONE', hint: 'A floor over 90% context', test: t => t.floors.some(f => (f.ctxPct ?? 0) >= 90 && f.status !== 'off') },
]

/** Names newly earned, in list order. */
export function earned(tower: Tower, c: Counters, have: readonly string[]): string[] {
  return TROPHIES.filter(x => !have.includes(x.name) && x.test(tower, c)).map(x => x.name)
}
