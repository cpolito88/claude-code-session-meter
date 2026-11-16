export type Limit = {
  /** `five_hour` or `seven_day`. */
  kind: string
  percent: number
  /** When the window resets, epoch ms. */
  resetsAt?: number
}

export type Meter = {
  contextTokens?: number
  contextWindow: number
  contextPercent?: number
  usd?: number
  limits?: Limit[]
  /** The time the countdowns are drawn against, epoch ms; ticked each minute. */
  now?: number
}

declare module 'claude-code' {
  interface PluginState {
    'session-meter': { meter: Meter }
  }
}
