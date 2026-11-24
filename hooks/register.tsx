// Pixel Tower: a live pixel-art cutaway tower of every running Claude Code session.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import { Feed } from './feed'
import type { Io, SelfInfo } from './feed'
import { renderCells, renderPng, renderSvg } from './render'
import { VIEW_W, W, sceneHeight } from './scene'
import { activityOf } from './world'
import type { Tower } from './world'
import { TROPHIES, earned } from './trophies'
import type { Counters } from './trophies'

const PANE = 'pixel-tower'
const TITLE = 'Pixel Tower'
const POLL_MS = 2000
const TERM_MS = 250
const tick = atom({ plugin: 'pixel-tower', key: 'tick' } as const, 0, { shape: 'tick-1' })

// Module state: rebuilt from the files on every load, so nothing here needs to persist.
const feed = new Feed()
const self: SelfInfo = { id: '' }
const counters: Counters = { bash: 0 }
let home = ''
let trophies: string[] = []
let newTrophy: Tower['newTrophy']
let energyPct: number | undefined
let sound = true
let graphics = false
let turnTools = 0
let lastBump = 0
let polled = false
let polling = false
const lastStatus = new Map<string, string>()
let term: { columns: number; rows: number; image: boolean } | undefined
let termTimer: { cancel: () => void } | undefined
/** The desktop pane's cell, CSS px: width measured, row height kept on the low side so the picture never scrolls. */
/** The street's dark ground, painted under the pane so any space below the picture blends in. */
const GROUND_BG = '#181425'
const CELL_W = 8.6
const CELL_H = 20
let svgCache: { key: string; at: number; svg: string; width: number; height: number } | undefined

const LABEL: Record<string, string> = {
  type: 'writing code', read: 'reading', bash: 'running commands', web: 'on the web', think: 'thinking',
  delegate: 'delegating', wait: 'waiting for you', done: 'just finished', idle: 'on a coffee break',
  sleep: 'asleep', off: 'closed', error: 'hit an error',
}

const towerNow = (now: number): Tower => feed.tower(now, { energyPct, trophies, newTrophy })

function summary(t: Tower): string {
  const live = t.floors.filter(f => f.status !== 'off')
  const working = live.filter(f => f.status === 'busy').length
  const waiting = live.filter(f => f.status === 'waiting').length
  const n = t.live ?? live.length
  return `${n} floor${n === 1 ? '' : 's'} · ${working} working · ${waiting} waiting${t.hidden ? ` · ${t.hidden} not shown` : ''}`
}

function altText(t: Tower): string {
  if (!t.floors.length) return 'Pixel Tower: no sessions yet.'
  return 'Pixel Tower. ' + t.floors.map((f, i) => `${i + 1}F ${f.name}: ${LABEL[activityOf(f, t.now)]}`).join('. ') + '.'
}

function io($: EngineInterface): Io {
  return {
    list: p => $.fs.list(p),
    read: (p, o) => $.fs.read(p, { as: 'text', ...o }),
    stat: p => $.fs.stat(p),
  }
}

function play($: EngineInterface, name: string) {
  if (sound) void $.audio.play({ asset: `sounds/${name}.wav` }).catch(() => {})
}

async function bump($: EngineInterface, force = false) {
  const now = Date.now()
  if (!force && now - lastBump < 1000) return
  lastBump = now
  await update($, tick, n => n + 1)
}

async function poll($: EngineInterface) {
  const now = Date.now()
  try {
    const u = await $.session.usage()
    if (u.context?.percent !== undefined) self.ctxPct = u.context.percent
    if (u.context?.window) feed.window = u.context.window
    if (u.cost) self.costUsd = u.cost.usd
    energyPct = u.rateLimits?.find((r: { kind: string }) => r.kind === 'five_hour')?.percentUsed
  } catch { /* usage is optional */ }
  await feed.poll(io($), home, now, self)
  const t = towerNow(now)
  for (const f of t.floors) {
    const was = lastStatus.get(f.id)
    if (polled) {
      if (was === undefined) play($, 'ding')
      else if (f.status === 'waiting' && was !== 'waiting') play($, 'alert')
      else if (was === 'busy' && f.status === 'idle') play($, 'done')
    }
    lastStatus.set(f.id, f.status)
  }
  for (const id of lastStatus.keys()) if (!feed.tracks.has(id)) lastStatus.delete(id)
  polled = true
  const got = earned(t, counters, trophies)
  if (got.length) {
    trophies = [...trophies, ...got]
    newTrophy = { name: got[got.length - 1]!, at: now }
    await $.store.set('trophies', trophies)
    for (const g of got) $.ui.toast(`Trophy unlocked: ${g}. ${TROPHIES.find(x => x.name === g)?.hint ?? ''}`)
    play($, 'trophy')
  }
  $.ui.status(`🏢 ${summary(t)}`)
  await bump($, true)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    self.id = await $.session.id()
    home = (await $.env.get('HOME')) ?? ''
    const tp = ((await $.env.get('TERM_PROGRAM')) ?? '').toLowerCase()
    graphics = /ghostty|kitty|wezterm|iterm/.test(tp) || !!(await $.env.get('KITTY_WINDOW_ID'))
    trophies = ((await $.store.get('trophies')) as string[] | undefined) ?? []
    counters.bash = Number((await $.store.get('bash')) ?? 0)
    sound = (await $.store.get('sound')) !== false
    await $.command.register({ name: 'tower', description: 'Open Pixel Tower. Args: sound (toggle sound), auto (toggle auto-open), trophies' })
    if ((await $.store.get('autoOpen')) !== false) void $.ui.open({ id: PANE, title: TITLE, backgroundColor: GROUND_BG }).catch(() => {})
    await poll($).catch(() => {})
    $.clock.every(POLL_MS, () => {
      if (polling) return
      polling = true
      void poll($).catch(() => {}).finally(() => { polling = false })
    })
    return next(e)
  })

  on('command.run', { command: 'tower' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'sound') {
      sound = !sound
      await $.store.set('sound', sound)
      return { text: `Pixel Tower sound ${sound ? 'on' : 'off'}.` }
    }
    if (arg === 'auto') {
      const auto = (await $.store.get('autoOpen')) === false
      await $.store.set('autoOpen', auto)
      return { text: `Pixel Tower ${auto ? 'opens' : 'no longer opens'} when a session starts.` }
    }
    if (arg === 'trophies') {
      return { text: TROPHIES.map(x => `${trophies.includes(x.name) ? '[x]' : '[ ]'} ${x.name}: ${x.hint}`).join('\n') }
    }
    await $.ui.open({ id: PANE, title: TITLE, backgroundColor: GROUND_BG })
    return { text: 'Pixel Tower opened.' }
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) { self.busy = true; self.tool = undefined; turnTools = 0; void bump($).catch(() => {}) }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId) return next(e)
    self.busy = true
    self.tool = e.tool
    self.toolSince = Date.now()
    turnTools++
    if (e.tool === 'Bash') { counters.bash++; void $.store.set('bash', counters.bash).catch(() => {}) }
    void bump($).catch(() => {})
    const r = await next(e)
    if ((r as { isError?: boolean } | undefined)?.isError) self.errorAt = Date.now()
    self.tool = undefined
    return r
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      self.busy = false
      self.tool = undefined
      self.doneAt = Date.now()
      counters.lastTurnMs = e.durationMs
      counters.lastTurnTools = turnTools
      void bump($, true).catch(() => {})
    }
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && e.trigger !== 'precompute' && !r.skip) {
      self.compactAt = Date.now()
      counters.compacted = true
    }
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await read($, tick)
    const now = Date.now()
    const t = towerNow(now)
    const ui = $.ui.resolve(e)
    const line = `${summary(t)}${energyPct !== undefined ? ` · 5h limit ${Math.round(energyPct)}% used` : ''}${self.costUsd !== undefined ? ` · this session ~$${self.costUsd.toFixed(2)} (estimate)` : ''}`

    if (e.surface === 'terminal') {
      const { Box, Text, Image, Raster } = ui as any
      const vc = Math.max(20, e.viewport?.columns ?? 80)
      const vr = Math.max(8, (e.viewport?.rows ?? 24) - 2)
      if (graphics) {
        // a cell is about twice as tall as it is wide
        const h = sceneHeight(t.floors.length)
        let columns = vc, rows = Math.round((columns * h) / W / 2)
        if (rows > vr) { rows = vr; columns = Math.round((rows * 2 * W) / h) }
        columns = Math.max(1, Math.min(255, columns)); rows = Math.max(1, Math.min(255, rows))
        term = { columns, rows, image: true }
      } else term = { columns: vc, rows: vr, image: false }
      if (!termTimer) termTimer = $.clock.every(TERM_MS, () => {
        if (!term) return
        const tt = towerNow(Date.now())
        const blit = term.image
          ? $.ui.blit({ requestId: PANE, key: 'tower', source: { png: renderPng(tt, Date.now()).png } })
          : $.ui.blit({ requestId: PANE, key: 'tower', cells: renderCells(tt, Date.now(), term.columns, term.rows).cells })
        void blit.then(r => { if (r.deny) { termTimer?.cancel(); termTimer = undefined } }, () => { termTimer?.cancel(); termTimer = undefined })
      })
      if (term.image) {
        return (
          <Box flexDirection="column">
            <Image key="tower" source={{ png: renderPng(t, now).png }} columns={term.columns} rows={term.rows} alt={altText(t)} />
            <Text dimColor>{line}</Text>
          </Box>
        )
      }
      const c = renderCells(t, now, term.columns, term.rows)
      term = { ...term, columns: c.columns, rows: c.rows }
      return (
        <Box flexDirection="column">
          <Raster key="tower" columns={c.columns} rows={c.rows} cells={c.cells} />
          <Text dimColor>{line}</Text>
        </Box>
      )
    }

    const { Box, Text, Svg, Button } = ui as any
    let agents: { id: string; type: string; description: string; status: string }[] = []
    try { agents = (await $.agent.list()).filter(a => a.status === 'running' || a.status === 'waiting' || a.status === 'pending') } catch { agents = [] }
    // a new source restarts the frame, so the SVG changes only with what it shows;
    // long walks run on real time, so a redraw never makes them jump
    const moving = now - t.elevator.at < 10000 ? Math.floor(now / 2000) : 0
    const key = JSON.stringify([
      t.floors.map(f => [f.id, f.name, activityOf(f, now), f.tool, f.interns.filter(i => !i.done || now - i.since < 15000).map(i => (i.done ? 'd' : 'w') + i.id).join(), Math.round(f.ctxPct ?? 0), f.isSelf, f.costUsd?.toFixed(2), f.compactAt && now - f.compactAt < 9000 ? Math.floor((now - f.compactAt) / 1500) : -1, now - f.bornAt < 1800]),
      t.hidden, moving, t.newTrophy?.name, t.trophies.length, Math.round(t.energyPct ?? -1),
    ])
    // crisp pixels: a whole or half-step scale (whole device pixels at 2x), as big
    // as the pane's width allows; the picture grows taller to fill the pane
    const cols = e.props.bodyColumns || 80
    const scale = Math.max(1, Math.min(6, Math.floor(((cols * CELL_W) / VIEW_W) * 2) / 2))
    const rows = e.props.scroll?.bodyRows || 0
    const free = rows - 3 - Math.min(6, agents.length) * 2
    const minH = Math.floor((free * CELL_H) / scale)
    const ckey = `${scale}|${minH}|${key}`
    if (!svgCache || svgCache.key !== ckey || now - svgCache.at >= 60000) {
      const r = renderSvg(t, now, VIEW_W * scale, minH)
      svgCache = { key: ckey, at: now, svg: r.svg, width: r.width, height: r.height }
    }
    const svg = svgCache.svg
    return (
      <Box flexDirection="column" gap={1}>
        <Svg source={svg} alt={altText(t)} width={svgCache.width} height={svgCache.height} isInteractive />
        <Text dimColor>{line}</Text>
        {agents.slice(0, 6).map(a => (
          <Button key={a.id} onPress={() => $.ui.view({ agentId: a.id })}>
            View intern: {a.type} · {a.description.slice(0, 48)}
          </Button>
        ))}
      </Box>
    )
  })
}
