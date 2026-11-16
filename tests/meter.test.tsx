import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// Stands in for the engine beneath the plugin: answers session.measure and
// draws the footer's mode labels joined, as it does.
const engine = (on: On) => {
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text dimColor>{e.props.modes.join(' & ')}</Text>
  })
}

test('footer shows bars for context and both limits, the 5-hour countdown and cost', async ($, on) => {
  const start = Date.parse('2026-10-02T09:00:00Z')
  mock.clock(on, { now: start })
  engine(on)

  await $.session.measure({
    context: { tokens: 45000, window: 200000, percent: 23 },
    rateLimits: [
      { kind: 'seven_day', percentUsed: 34, resetsAt: new Date(start + (53 * 60 + 30) * 60_000).toISOString() },
      { kind: 'five_hour', percentUsed: 12, resetsAt: new Date(start + (3 * 60 + 10) * 60_000).toISOString() },
    ],
    cost: { usd: 0.4567 },
    changed: ['context', 'rateLimits', 'cost'],
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'session-meter', surface, component: 'SessionMode', props: { modes: [] } })
    const shown = await ui.find({ text: /ctx ▓░░░ 23%/ })
    expect(shown?.text).toContain('ctx ▓░░░ 23% │ 5h ░░░░ 12% 3h10m │ 7d ▓░░░ 34% │ $0.457')
    expect(shown?.text).not.toContain('📥')
    expect(shown?.text).not.toContain('📤')
    expect(shown?.text).not.toContain('200.0k')
    expect(shown?.text).not.toContain('45.0k')
    await ui.unmount()
  }
})

test('context is green to 60%, yellow to 80%, red above; labels and cost plain, nothing bold', async ($, on) => {
  mock.clock(on)
  engine(on)

  for (const [percent, color] of [[60, 'green'], [61, 'yellow'], [80, 'yellow'], [81, 'red']] as const) {
    await $.session.measure({
      context: { tokens: percent * 2000, window: 200000, percent },
      rateLimits: [],
      cost: { usd: 1 },
      changed: ['context'],
    })

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'session-meter', surface, component: 'SessionMode', props: { modes: ['focus'] } })
      const texts = await ui.findAll({ type: 'Text' })
      const percentText = texts.find(t => t.text === `${percent}%`)
      expect(percentText?.props.color).toBe(color)
      expect(percentText?.props.bold).toBeUndefined()
      for (const plainText of ['ctx ', '$1.00']) {
        const found = texts.find(t => t.text === plainText)
        expect(found).toBeDefined()
        expect(found?.props.color).toBeUndefined()
        expect(found?.props.bold).toBeUndefined()
      }
      expect(await ui.find({ text: /focus/ })).toBeDefined()
      await ui.unmount()
    }
  }
})

test('each limit is coloured by its own percent, its countdown plain', async ($, on) => {
  const start = Date.parse('2026-10-02T09:00:00Z')
  mock.clock(on, { now: start })
  engine(on)

  await $.session.measure({
    context: { tokens: 20000, window: 200000, percent: 10 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 91.5, resetsAt: new Date(start + 45 * 60_000).toISOString() },
      { kind: 'seven_day', percentUsed: 65, resetsAt: new Date(start + 2 * 24 * 60 * 60_000).toISOString() },
    ],
    cost: { usd: 1 },
    changed: ['rateLimits'],
  })

  const ui = await $.ui.mount({ plugin: 'session-meter', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  const texts = await ui.findAll({ type: 'Text' })
  expect(texts.find(t => t.text === '91.5%')?.props.color).toBe('red')
  expect(texts.find(t => t.text === '65%')?.props.color).toBe('yellow')
  expect(texts.find(t => t.text === '10%')?.props.color).toBe('green')
  expect(texts.find(t => t.text === ' 45m')?.props.color).toBeUndefined()
  // The weekly window shows no countdown, even with a reset time reported.
  expect(texts.filter(t => /^ \d+(d|h|m)/.test(t.text)).length).toBe(1)
  await ui.unmount()
})

test('bars fill in quarters, coloured cells only, and clamp past 100%', async ($, on) => {
  mock.clock(on)
  engine(on)

  for (const [percent, filled, color] of [[0, 0, 'green'], [50, 2, 'green'], [75, 3, 'yellow'], [100, 4, 'red'], [130, 4, 'red']] as const) {
    await $.session.measure({
      context: { tokens: 1000, window: 200000, percent },
      rateLimits: [],
      changed: ['context'],
    })

    const ui = await $.ui.mount({ plugin: 'session-meter', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
    const texts = await ui.findAll({ type: 'Text' })
    const full = texts.find(t => /^▓+$/.test(t.text))
    const empty = texts.find(t => /^░+$/.test(t.text))
    expect(full?.text.length ?? 0).toBe(filled)
    expect(empty?.text.length ?? 0).toBe(4 - filled)
    if (full) expect(full.props.color).toBe(color)
    expect(empty?.props.color).toBeUndefined()
    await ui.unmount()
  }
})
