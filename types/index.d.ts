// Pixel Tower's state contract: one counter the drawing subscribes to.
declare module 'claude-code' {
  interface PluginState {
    'pixel-tower': { tick: Shaped<number> }
  }
}
export type Tick = number
