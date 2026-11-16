import { atom, read, update } from 'claude-code'
import type { Register, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import type { Meter } from '../types'

const EMPTY: Meter = { contextWindow: 0 }

const ALERT_PERCENT = 80
const WARN_PERCENT = 60

export const meterColor = (percent = 0) =>
  percent > ALERT_PERCENT ? 'red' : percent > WARN_PERCENT ? 'yellow' : 'green'

const meter = atom({ plugin: 'session-meter', key: 'meter' } as const, EMPTY)

const MINUTE = 60_000

// The rate-limit windows shown, in order, with their labels.
const LIMITS = [
  { kind: 'five_hour', name: '5h', hasCountdown: true },
  { kind: 'seven_day', name: '7d', hasCountdown: false },
] as const

const BAR_CELLS = 4

export const countdown = (ms: number) => {
  const minutes = Math.max(0, Math.round(ms / MINUTE))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60

  return days > 0 ? `${days}d${hours}h` : hours > 0 ? `${hours}h${mins}m` : `${mins}m`
}

// The meter as pieces: labels, separators, countdowns and the cost drawn plain;
// each bar's filled cells and its percentage coloured by its own figure.
export type Segment = { text: string; color?: string }

// `name ▓░░░ 23%`, or an empty bar and `–` before the figure is known.
const gauge = (name: string, percent: number | undefined): Segment[] => {
  const color = meterColor(percent)
  const filled = percent === undefined ? 0 : Math.min(BAR_CELLS, Math.max(0, Math.round((percent / 100) * BAR_CELLS)))

  return [
    { text: `${name} ` },
    { text: '▓'.repeat(filled), color },
    { text: '░'.repeat(BAR_CELLS - filled) },
    { text: ' ' },
    percent === undefined ? { text: '–' } : { text: `${percent}%`, color },
  ].filter(s => s.text !== '')
}

export const segments = (m: Meter): Segment[] => {
  const groups: Segment[][] = []

  if (m.contextWindow > 0) {
    groups.push(gauge('ctx', m.contextPercent))
  }

  for (const { kind, name, hasCountdown } of LIMITS) {
    const limit = m.limits?.find(l => l.kind === kind)
    if (limit === undefined) continue
    const group = gauge(name, limit.percent)
    if (hasCountdown && limit.resetsAt !== undefined && m.now !== undefined) {
      group.push({ text: ` ${countdown(limit.resetsAt - m.now)}` })
    }
    groups.push(group)
  }

  if (m.usd !== undefined) {
    // No threshold applies to cost, so it stays plain.
    groups.push([{ text: `$${m.usd.toFixed(m.usd < 1 ? 3 : 2)}` }])
  }

  return groups.flatMap((group, i) => (i === 0 ? group : [{ text: ' │ ' }, ...group]))
}

export const label = (m: Meter) => segments(m).map(s => s.text).join('')

const withFigures = (
  m: Meter,
  context: SessionContextUsage,
  rateLimits: readonly SessionRateLimit[],
  cost: SessionCost | undefined,
  now: number,
): Meter => ({
  ...m,
  contextTokens: context.tokens,
  contextWindow: context.window,
  contextPercent: context.percent,
  usd: cost?.usd ?? m.usd,
  limits: rateLimits.map(r => {
    const resetsAt = r.resetsAt === undefined ? NaN : Date.parse(r.resetsAt)

    return { kind: r.kind, percent: r.percentUsed, resetsAt: Number.isFinite(resetsAt) ? resetsAt : undefined }
  }),
  now,
})

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const { context, rateLimits, cost } = await $.session.usage()
    const now = await $.clock.now()
    await update($, meter, m => withFigures(m ?? EMPTY, context, rateLimits, cost, now))

    // Keep the reset countdowns moving between turns.
    $.clock.every(MINUTE, () => {
      void $.clock.now().then(t => update($, meter, m => ({ ...(m ?? EMPTY), now: t })))
    })

    return result
  })

  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, meter, m => withFigures(m ?? EMPTY, e.context, e.rateLimits, e.cost, now))

    return next(e)
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const m = await read($, meter)

    // Draw the footer's labels ourselves so the meter can carry colours.
    const { Text } = $.ui.resolve(e)
    const others = e.props.modes.join(' & ')

    return (
      <Text>
        {others && <Text dimColor>{others} & </Text>}
        {segments(m).map(s => (s.color ? <Text color={s.color}>{s.text}</Text> : <Text>{s.text}</Text>))}
      </Text>
    )
  })
}
