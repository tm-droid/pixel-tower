import { expect, test } from 'claude-code/testing'
import { parseTail, describeTool, clean, Feed } from '../hooks/feed'
import type { Io } from '../hooks/feed'
import { renderCells, renderSvg, SVG_LIMIT } from '../hooks/render'
import { activityOf, toolKind, verbOf } from '../hooks/world'
import type { Floor, Tower } from '../hooks/world'
import { earned } from '../hooks/trophies'

const NOW = Date.UTC(2026, 10, 24, 15, 0, 0)
const floor = (id: string, extra: Partial<Floor> = {}): Floor => ({
  id, name: id, entry: 'claude-desktop', status: 'busy', bornAt: 0, statusSince: NOW - 1000, interns: [], isSelf: false, ...extra,
})
const tower = (floors: Floor[]): Tower => ({ floors, now: NOW, trophies: [], elevator: { from: -1, to: -1, at: 0 } })

test('tools map to animations and statuses to activities', async () => {
  expect(toolKind('Edit')).toBe('type')
  expect(toolKind('Grep')).toBe('read')
  expect(toolKind('Bash')).toBe('bash')
  expect(toolKind('WebSearch')).toBe('web')
  expect(toolKind('Agent')).toBe('delegate')
  expect(toolKind(undefined)).toBe('think')
  expect(activityOf(floor('a', { status: 'waiting' }), NOW)).toBe('wait')
  expect(activityOf(floor('a', { status: 'idle', doneAt: NOW - 1000 }), NOW)).toBe('done')
  expect(activityOf(floor('a', { status: 'idle', statusSince: NOW - 3600000 }), NOW)).toBe('sleep')
  expect(activityOf(floor('a', { status: 'off' }), NOW)).toBe('off')
})

test('a transcript tail gives the open tool, context, errors and compaction', async () => {
  const lines = [
    '{"partial line cut by the offset',
    JSON.stringify({ type: 'assistant', timestamp: '2026-11-24T15:00:00Z', message: { usage: { input_tokens: 10, cache_read_input_tokens: 90000, cache_creation_input_tokens: 10000 }, content: [{ type: 'tool_use', id: 't1', name: 'Read' }] } }),
    JSON.stringify({ type: 'user', timestamp: '2026-11-24T15:00:01Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true }] } }),
    JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: '2026-11-24T15:00:02Z' }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-11-24T15:00:03Z', message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash' }] } }),
  ]
  const r = parseTail(lines.join('\n'), true)
  expect(r.tool).toBe('Bash')
  expect(r.ctxTokens).toBe(100010)
  expect(r.errorAt).toBe(Date.parse('2026-11-24T15:00:01Z'))
  expect(r.compactAt).toBe(Date.parse('2026-11-24T15:00:02Z'))
})

test('tool calls are described in a few words', async () => {
  expect(describeTool('Read', { file_path: '/a/b/scene.ts' })).toBe('scene.ts')
  expect(describeTool('Bash', { command: 'npm test\nls', description: 'Run the tests' })).toBe('Run the tests')
  expect(describeTool('Bash', { command: 'npm test\nls' })).toBe('npm test')
  expect(describeTool('WebFetch', { url: 'https://www.example.com/x?y' })).toBe('example.com')
  expect(describeTool('Agent', { description: 'Map mod data', prompt: 'long' })).toBe('Map mod data')
  expect(describeTool('TodoWrite', { todos: [{ content: 'a', status: 'done' }, { content: 'Build it', status: 'in_progress' }] })).toBe('Build it')
  expect(describeTool('mcp__srv__do_thing', { query: 'q' })).toBe('q')
  expect(describeTool('Grep', {})).toBe(undefined)
  expect(clean('a\u0007b\u001b[31m  c', 40)).toBe('a b [31m c')
  expect(clean('x'.repeat(50), 10)!.length).toBe(10)
  expect(verbOf('Edit')).toBe('EDIT')
  expect(verbOf('mcp__Claude_Browser__navigate')).toBe('NAVIGATE')
})

test('a tail gives the open tool detail, recent calls, the last prompt and the last words', async () => {
  const lines = [
    JSON.stringify({ type: 'user', timestamp: '2026-11-24T14:00:00Z', message: { content: 'make it super good' } }),
    JSON.stringify({ type: 'user', isMeta: true, message: { content: 'meta note' } }),
    JSON.stringify({ type: 'user', message: { content: '<command-name>/tower</command-name>' } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-11-24T14:00:01Z', message: { content: [{ type: 'text', text: 'Reading the feed.\nmore' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x/feed.ts' } }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true }] } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-11-24T14:00:02Z', message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } }] } }),
  ]
  const r = parseTail(lines.join('\n'), false)
  expect(r.tool).toBe('Bash')
  expect(r.detail).toBe('npm test')
  expect(r.ask).toBe('make it super good')
  expect(r.say).toBe('Reading the feed.')
  expect(r.recent).toEqual([{ kind: 'read', err: true }, { kind: 'bash' }])
  expect(r.tools).toBe(2)
})

test('running interns get their task, open tool and start time from their transcripts', async () => {
  const sub = '/h/.claude/projects/-w-alpha/s1/subagents'
  const log = [
    JSON.stringify({ type: 'user', isSidechain: true, timestamp: '2026-11-24T14:58:00Z', message: { content: 'go' } }),
    JSON.stringify({ type: 'assistant', isSidechain: true, timestamp: '2026-11-24T14:59:00Z', message: { content: [{ type: 'tool_use', id: 'u1', name: 'Grep', input: { pattern: 'activityOf' } }] } }),
  ].join('\n')
  const files: Record<string, string> = {
    '/h/.claude/sessions/1.json': JSON.stringify({ sessionId: 's1', cwd: '/w/alpha', status: 'busy', startedAt: 1 }),
    [`${sub}/agent-a1.meta.json`]: JSON.stringify({ agentType: 'Explore', description: 'Map mod data' }),
    [`${sub}/agent-a1.jsonl`]: log,
  }
  const opened: string[] = []
  const io: Io = {
    list: async p => {
      if (p === '/h/.claude/sessions') return [{ name: '1.json', kind: 'file', size: 1, mtimeMs: 0 }]
      if (p === sub) return [{ name: 'agent-a1.meta.json', kind: 'file', size: 9, mtimeMs: NOW }, { name: 'agent-a1.jsonl', kind: 'file', size: log.length, mtimeMs: NOW }]
      throw new Error('missing')
    },
    read: async (p, o) => { opened.push(p); const f = files[p]; if (f === undefined) throw new Error('missing'); return o?.offset ? f.slice(o.offset) : f },
    stat: async () => { throw new Error('missing') },
  }
  const feed = new Feed()
  await feed.poll(io, '/h', NOW, { id: 's1', subs: new Map([['a1', { tool: 'Edit', detail: 'scene.ts', toolSince: NOW }]]) })
  const it = feed.tower(NOW, { trophies: [] }).floors[0]!.interns[0]!
  expect(it.kind).toBe('Explore')
  expect(it.desc).toBe('Map mod data')
  expect(it.startedAt).toBe(Date.parse('2026-11-24T14:58:00Z'))
  expect(it.tools).toBe(1)
  // this session's own hook beats the transcript
  expect(it.tool).toBe('Edit')
  expect(it.detail).toBe('scene.ts')
  await feed.poll(io, '/h', NOW, { id: 's1', subs: new Map() })
  expect(feed.tower(NOW, { trophies: [] }).floors[0]!.interns[0]!.tool).toBe('Edit')
  expect(opened.some(p => p.endsWith('.key'))).toBe(false)
})

test('a quiet intern comes back when it writes again, and a broken meta file is skipped', async () => {
  const sub = '/h/.claude/projects/-w-alpha/s1/subagents'
  // a long task prompt pushes the first timestamp well past 4 KB
  let log = JSON.stringify({ type: 'user', isSidechain: true, message: { content: 'x'.repeat(9000) }, timestamp: '2026-11-24T14:58:00Z' })
  let mt = NOW - 11 * 60000
  const files: Record<string, string> = {
    '/h/.claude/sessions/1.json': JSON.stringify({ sessionId: 's1', cwd: '/w/alpha', status: 'busy', startedAt: 1 }),
    [`${sub}/agent-a1.meta.json`]: JSON.stringify({ agentType: 'Explore', description: 'Long test run' }),
    [`${sub}/agent-b2.meta.json`]: 'null',
  }
  const io: Io = {
    list: async p => {
      if (p === '/h/.claude/sessions') return [{ name: '1.json', kind: 'file', size: 1, mtimeMs: 0 }]
      if (p === sub) return [
        { name: 'agent-b2.meta.json', kind: 'file', size: 4, mtimeMs: NOW },
        { name: 'agent-a1.meta.json', kind: 'file', size: 9, mtimeMs: NOW },
        { name: 'agent-a1.jsonl', kind: 'file', size: log.length, mtimeMs: mt },
      ]
      throw new Error('missing')
    },
    read: async (p, o) => {
      const f = p.endsWith('agent-a1.jsonl') ? log : files[p]
      if (f === undefined) throw new Error('missing')
      return f.slice(o?.offset ?? 0, o?.length === undefined ? undefined : (o.offset ?? 0) + o.length)
    },
    stat: async () => { throw new Error('missing') },
  }
  const feed = new Feed()
  await feed.poll(io, '/h', NOW - 60000)
  await feed.poll(io, '/h', NOW)
  // quiet for 11 minutes: it looks finished
  expect(feed.tower(NOW, { trophies: [] }).floors[0]!.interns.map(i => i.done)).toEqual([true])
  // its 12-minute command ends and it writes again
  log += '\n' + JSON.stringify({ type: 'assistant', isSidechain: true, timestamp: '2026-11-24T15:10:00Z', message: { content: [{ type: 'tool_use', id: 'u1', name: 'Read', input: { file_path: '/w/alpha/feed.ts' } }] } })
  mt = NOW + 1000
  await feed.poll(io, '/h', NOW + 2000)
  const it = feed.tower(NOW + 2000, { trophies: [] }).floors[0]!.interns[0]!
  expect(it.done).toBe(false)
  expect(it.desc).toBe('Long test run')
  expect(it.detail).toBe('feed.ts')
  expect(it.startedAt).toBe(Date.parse('2026-11-24T14:58:00Z'))
})

test('the feed reads only session json, never the key files', async () => {
  const opened: string[] = []
  const files: Record<string, string> = {
    '/h/.claude/sessions/1.json': JSON.stringify({ sessionId: 's1', cwd: '/w/alpha', status: 'busy', entrypoint: 'cli', startedAt: 1 }),
    '/h/.claude/sessions/2.json': JSON.stringify({ sessionId: 's2', cwd: '/w/beta', status: 'waiting', startedAt: 2 }),
    '/h/.claude/sessions/1.key': 'secret',
  }
  const io: Io = {
    list: async p => {
      if (p === '/h/.claude/sessions') return ['1.json', '2.json', '1.key'].map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0 }))
      throw new Error('missing')
    },
    read: async p => { opened.push(p); const f = files[p]; if (f === undefined) throw new Error('missing'); return f },
    stat: async () => { throw new Error('missing') },
  }
  const feed = new Feed()
  await feed.poll(io, '/h', NOW)
  const t = feed.tower(NOW, { trophies: [] })
  expect(t.floors.map(f => f.name)).toEqual(['alpha', 'beta'])
  expect(t.floors[1]?.status).toBe('waiting')
  expect(opened.some(p => p.endsWith('.key'))).toBe(false)
})

test('a full tower fits the SVG limit and the terminal grid', async () => {
  const many = Array.from({ length: 12 }, (_, i) => floor(`session-${i}`, { tool: ['Edit', 'Bash', 'Read', 'WebSearch'][i % 4], ctxPct: i * 8 }))
  const { svg } = renderSvg(tower(many), NOW)
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg.length < SVG_LIMIT).toBe(true)
  // the engine refuses embedded pictures in an Svg: pure vector only
  expect(/<image|data:|href/.test(svg)).toBe(false)
  expect(svg.includes('<animate')).toBe(true)
  // long walks are CSS moves; the cat and the clouds are always there
  expect(svg.includes('@keyframes m0')).toBe(true)
  const c = renderCells(tower(many), NOW, 100, 40)
  expect(c.columns <= 100 && c.rows <= 40).toBe(true)
  expect(c.cells.length).toBe(Math.ceil((c.columns * c.rows * 12) / 3) * 4)
})

test('trophies unlock once', async () => {
  const t = tower([floor('a'), floor('b'), floor('c')])
  expect(earned(t, { bash: 0 }, [])).toEqual(['FIRST FLOOR', 'BUSY BEES'])
  expect(earned(t, { bash: 0 }, ['FIRST FLOOR', 'BUSY BEES'])).toEqual([])
})

const PANE = {
  plugin: 'pixel-tower', component: 'Pane', requestId: 'pixel-tower',
  props: { title: 'Pixel Tower', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('the pane draws every session as a floor', async ($, on) => {
  on('command.register', () => ({ value: { command: 'tower' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('env.get', (_, e) => ({ value: (e as { name?: string }).name === 'HOME' ? '/h' : undefined }))
  on('fs.list', (_, e) => {
    if ((e as { path?: string }).path === '/h/.claude/sessions') return { value: [{ name: '1.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }
    throw new Error('missing')
  })
  on('fs.read', () => ({ value: JSON.stringify({ sessionId: 's1', cwd: '/w/alpha', status: 'busy', startedAt: 1 }) }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svg = await ui.find({ type: 'Svg' })
  expect(String(svg?.props.alt)).toContain('1F alpha')
  expect(String(svg?.props.source).length < SVG_LIMIT).toBe(true)
  // 80 columns of about 8.6 px fit a crisp 2x scale; 30 rows make the sky taller than the bare tower
  expect(svg?.props.width).toBe(552)
  expect(Number(svg?.props.height) > 360).toBe(true)
  expect(String(svg?.props.source)).toContain('<title>alpha: ')
  expect((await ui.find({ type: 'Text', text: /1 floor/ }))?.text).toContain('1 working')
  // the roster names the session in words beside the picture
  expect((await ui.find({ type: 'Text', text: /alpha \(this one\)/ }))?.text).toBe('alpha (this one)')
  await ui.unmount()

  // a terminal without a graphics protocol gets the half-block grid
  const tui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const r = await tui.find({ type: 'Raster' })
  const cols = Number(r?.props.columns), rows = Number(r?.props.rows)
  expect(cols > 0 && cols <= 512 && rows > 0 && rows <= 256).toBe(true)
  expect(String(r?.props.cells).length).toBe(Math.ceil((cols * rows * 12) / 3) * 4)
  await tui.unmount()
})

test('past 12 floors the tower counts every session and says how many are hidden', async () => {
  const names = Array.from({ length: 14 }, (_, i) => `${i}.json`)
  const io: Io = {
    list: async p => { if (p === '/h/.claude/sessions') return names.map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0 })); throw new Error('missing') },
    read: async p => { const i = Number(p.split('/').pop()!.split('.')[0]); return JSON.stringify({ sessionId: `s${i}`, cwd: `/w/p${i}`, status: 'busy', startedAt: i }) },
    stat: async () => { throw new Error('missing') },
  }
  const feed = new Feed()
  await feed.poll(io, '/h', NOW)
  const t = feed.tower(NOW, { trophies: [] })
  expect(t.floors.length).toBe(12)
  expect(t.live).toBe(14)
  expect(t.hidden).toBe(2)
  expect(earned(t, { bash: 0 }, []).includes('SKYSCRAPER')).toBe(true)
})
