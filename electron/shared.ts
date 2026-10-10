// Types and constants shared by the main process, preload and renderer.

export type PetState =
  | 'idle'
  | 'walking'
  | 'running'
  | 'dancing'
  | 'jumping'
  | 'sleeping'
  | 'waving'
  | 'sitting'
  | 'spinning'
  | 'happy'
  | 'surprised'
  | 'falling'
  | 'climbing'
  | 'clinging'
  | 'stretching'
  | 'exercising'
  | 'thinking'
  | 'cornering'
  | 'floating'
  | 'roping'
  | 'ropeShoot'
  | 'ropeClimb'
  | 'chairDance'
  | 'watering'
  | 'drinking'
  | 'eating'
  | 'reading'
  | 'laptop'
  | 'meditating'
  | 'brushing'
  | 'eyeRest'
  | 'swimming'
  | 'ladder'
  | 'fight'
  | 'chase'
  | 'rescue'
  | 'battle'

export const ACTIONS: { state: PetState; label: string }[] = [
  { state: 'waving', label: 'Wave' },
  { state: 'dancing', label: 'Dance' },
  { state: 'jumping', label: 'Jump' },
  { state: 'spinning', label: 'Spin' },
  { state: 'happy', label: 'Happy' },
  { state: 'sitting', label: 'Sit' },
  { state: 'sleeping', label: 'Sleep' },
  { state: 'walking', label: 'Walk' },
  { state: 'running', label: 'Run' },
  { state: 'surprised', label: 'Surprise' },
  { state: 'climbing', label: 'Rope climb' },
  { state: 'ladder', label: 'Ladder climb' },
  { state: 'swimming', label: 'Swim' },
  { state: 'fight', label: 'Play-fight Bolt' },
  { state: 'chase', label: 'Chase Bolt' },
  { state: 'rescue', label: 'Rescue Bolt' },
  { state: 'battle', label: 'Epic battle (full screen)' },
  { state: 'floating', label: 'Float' },
  { state: 'roping', label: 'Rope swing' },
  { state: 'chairDance', label: 'Chair dance' },
  { state: 'watering', label: 'Water plant' },
  { state: 'drinking', label: 'Drink water' },
  { state: 'eating', label: 'Eat apple' },
  { state: 'reading', label: 'Read' },
  { state: 'laptop', label: 'Laptop' },
  { state: 'brushing', label: 'Brush teeth' },
  { state: 'meditating', label: 'Meditate' },
  { state: 'eyeRest', label: 'Rest eyes' },
  { state: 'stretching', label: 'Stretch' },
  { state: 'exercising', label: 'Exercise' },
  { state: 'thinking', label: 'Think' },
]

export type Activity = 'calm' | 'normal' | 'lively'

export type BodyColor = 'orange' | 'blue' | 'pink' | 'green' | 'purple'

/** Body paint per colour: base, emissive tint (keeps the glossy toy look), swatch for the UI. */
export const BODY_COLORS: Record<BodyColor, { base: string; emissive: string; label: string }> = {
  orange: { base: '#ff7a1a', emissive: '#c2410c', label: 'Orange' },
  blue: { base: '#2a8cff', emissive: '#0a5ae6', label: 'Blue' },
  pink: { base: '#ff5fa8', emissive: '#be185d', label: 'Pink' },
  green: { base: '#2fcf78', emissive: '#047857', label: 'Green' },
  purple: { base: '#8d5cff', emissive: '#5b21b6', label: 'Purple' },
}

export interface Settings {
  size: number // pet visual size in DIPs, 64-160
  alwaysOnTop: boolean
  autoStart: boolean
  paused: boolean // freeze automatic activities (pet still idles)
  walkAround: boolean
  climb: boolean // climbs the sides of the screen
  gravity: boolean // dropped pet falls to the bottom of the screen
  habits: boolean // healthy-habit reminders acted out with a speech bubble
  autoBattle: boolean // Bolt shows up at launch and the endless full-screen battle starts
  quoteEveryMin: number // quote / shayari notice interval, 0 = off
  activity: Activity
  color: BodyColor
  sleepAfterMin: number // sleep when the PC has been idle this long
  position: { x: number; y: number } | null
}

export const DEFAULT_SETTINGS: Settings = {
  size: 110,
  alwaysOnTop: true,
  autoStart: false,
  paused: false,
  walkAround: true,
  climb: true,
  gravity: true,
  habits: true,
  autoBattle: true,
  quoteEveryMin: 15,
  activity: 'normal',
  color: 'orange',
  sleepAfterMin: 3,
  position: null,
}

export const SIZE_MIN = 64
export const SIZE_MAX = 160

// Window is larger than the pet so jumps, spins and the Zzz bubble are not clipped.
export const windowSizeFor = (size: number) => ({
  width: Math.round(size * 1.5),
  height: Math.round(size * 1.7),
})

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface PetBounds {
  window: Rect
  // Work areas (taskbar excluded) of the pet's display and the displays side by side with it,
  // left to right. Nexo roams across all of them.
  areas: Rect[]
}

/** Rope from an anchor at the top of the screen (x, top) down to Nexo's hand (xEnd, bottom), in screen DIPs. */
export interface Rope {
  x: number
  top: number
  xEnd: number
  bottom: number
}

/** Sent to each arena window (one per screen) when a battle starts. */
export interface BattleInit {
  world: { width: number; height: number } // the whole battlefield: every screen side by side
  view: { x: number; width: number; height: number } // the slice of it this window shows
  t0: number // epoch ms the battle starts at, so every window plays the same moment
  feetX: number // Nexo's feet, relative to the battlefield
  size: number
  color: BodyColor
}

export interface NoticeData {
  kind: string
  text: string
  author: string
}

export interface NexoApi {
  getSettings(): Promise<Settings>
  isPackaged(): Promise<boolean>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  onSettings(cb: (s: Settings) => void): () => void
  getBounds(): Promise<PetBounds>
  move(x: number, y: number): void
  dragEnd(): Promise<PetBounds>
  setIgnoreMouse(ignore: boolean): void
  getIdleSeconds(): Promise<number>
  showMenu(): void
  openSettings(): void
  setRope(rope: Rope | null): void
  command(state: PetState): void
  onCommand(cb: (state: PetState) => void): () => void
  testReminder(): void
  quoteNow(): void
  openQuotesFile(): void
  onNotice(cb: (n: NoticeData) => void): () => void
  noticeSize(height: number): void
  noticeClose(): void
  onTestReminder(cb: () => void): () => void
  /** Pet: hand Nexo over to the full-screen arena (feet x in screen DIPs). */
  startBattle(feetX: number): void
  /** Arena: battle setup. */
  onBattleInit(cb: (b: BattleInit) => void): () => void
  /** Arena: finished; Nexo's feet x relative to the work area. */
  battleDone(feetX: number): void
  /** Arena: the user asked to stop (tray menu or pause). */
  onBattleStop(cb: () => void): () => void
  /** Pet: the arena closed and the pet window is back. */
  onBattleEnded(cb: () => void): () => void
}
