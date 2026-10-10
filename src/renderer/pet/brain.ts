import type { PetBounds, PetState, Rect, Settings } from '../../../electron/shared'
import { usePet } from '../store'
import { duo, DuoFrame, duoDuration, isDuo } from './duo'
import type { JointPose } from './limbs'
import { DURATION, pose, Pose, ROPE_HANDS } from './poses'

// The behaviour engine. Two layers:
//   surface: where Nexo is (floor, a wall, the ceiling, or in the air)
//   state:   what Nexo is doing there (walking, climbing, dancing...)
// Every surface has a way back to the floor, so no state is a dead end:
//   floor   -> walk/run anywhere, climb a wall, float to the middle of the screen
//   wall    -> climb up, hang and drop, or round the top corner onto the ceiling
//   ceiling -> walk upside down, hang, abseil on a rope, climb down the far wall or drop
//   rope    -> lower down, swing, then climb back up or let go
//   air     -> fall (gravity) or float, landing back on the floor

export type Surface = 'floor' | 'wall' | 'ceiling' | 'rope' | 'air'

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]
const easeInOut = (v: number) => (v < 0.5 ? 2 * v * v : 1 - (-2 * v + 2) ** 2 / 2)
const GRAVITY = 2600 // px/s^2
const ACTIVITY_SCALE = { calm: 1.7, normal: 1, lively: 0.55 } as const
const CORNER_TIME = DURATION.cornering ?? 0.9

/** Healthy-habit reminders: how often (minutes of active PC use), what Nexo does, what it says. */
const HABITS = [
  { key: 'eyes', every: 10, state: 'eyeRest', text: 'Rest your eyes 👀 Look far away for 20 seconds.' },
  { key: 'water', every: 20, state: 'drinking', text: 'Time for a sip of water 💧' },
  { key: 'stretch', every: 30, state: 'stretching', text: 'Stand up and stretch! 🙆' },
  { key: 'move', every: 45, state: 'exercising', text: 'Take a short walk 🚶' },
] as const satisfies readonly { key: string; every: number; state: PetState; text: string }[]

export interface Frame {
  pose: Pose
  state: PetState
  t: number // seconds in current state
  facing: 1 | -1
  fidget: number
  dragging: boolean
  surface: Surface
  /** Rope visible: `top` is the anchor y, `k` how far it has shot up (0..1). */
  rope: { top: number; k: number } | null
  win: { x: number; y: number }
  /** Scenes with Bolt, the second robot: its frame, and Nexo's scripted joints. */
  duo: DuoFrame | null
  joints: JointPose | null
}

type Plan = 'none' | 'toCeiling' | 'crossCeiling' | 'rope' | 'ropeDown'

export class Brain {
  state: PetState = 'idle'
  t = 0
  facing: 1 | -1 = 1
  surface: Surface = 'floor'

  private win: Rect
  private areas: Rect[] // every screen Nexo can roam, left to right
  private area: Rect // the screen Nexo was on last frame
  private settling = false // just crossed onto another screen: stepping to its floor or ceiling
  private settings: Settings
  private queue: PetState[] = []
  private holdFor = Infinity // sitting, clinging, hovering, commanded sleep
  private autoSleep = false // asleep because the PC is idle (wakes on PC activity)

  private wallSide: 1 | -1 = 1
  private climbTargetY = 0
  private climbDir: 1 | -1 = -1 // -1 up, 1 down
  private plan: Plan = 'none'
  private viaWall = false // this climb goes up a screen edge instead of a rope
  private corner = { fromX: 0, fromY: 0, toX: 0, toY: 0, toSurface: 'ceiling' as Surface }
  private float = { phase: 'up' as 'up' | 'hover' | 'down', x: 0, y: 0 }
  private rope = { phase: 'down' as 'down' | 'swing' | 'up', y: 0, toFloor: false }

  private targetX: number | null = null
  private speed = 0
  private vy = 0
  private land = -1
  private fidget = -1

  private dragging = false
  private dragOffset = { x: 0, y: 0 }
  private dragRot = 0
  private lastDrag = { x: 0, t: 0, vx: 0 }

  private timers = { blink: 3, fidget: 6, walk: 12, dance: 70, misc: 30, roam: 10, idleCheck: 2 }
  private blinkLeft = 0
  private habitLeft: Record<string, number> = Object.fromEntries(HABITS.map((h) => [h.key, h.every * 60]))
  private bubbleTimer = 0
  private chase = { target: 0, arrive: Infinity }
  private endlessFight = false // fights picked from the menu go on until Nexo is clicked
  private sentPos = { x: NaN, y: NaN }

  constructor(
    settings: Settings,
    bounds: PetBounds,
    private move: (x: number, y: number) => void,
    private getIdleSeconds: () => Promise<number>,
  ) {
    this.settings = settings
    this.win = { ...bounds.window }
    this.areas = bounds.areas
    this.area = this.wa
    this.sentPos = { x: this.win.x, y: this.win.y }
    this.resetTimers()
    if (settings.gravity && !this.onFloor()) this.play('falling')
  }

  // ---------- external inputs ----------

  setSettings(s: Settings) {
    const resumed = this.settings.paused && !s.paused
    this.settings = s
    if (!s.walkAround && (this.state === 'walking' || this.state === 'running') && this.surface === 'floor') this.play('idle')
    if (!s.climb && (this.surface === 'wall' || this.surface === 'ceiling')) this.leaveSurface()
    if (resumed) this.resetTimers()
  }

  setBounds(b: PetBounds) {
    this.win = { ...b.window }
    this.areas = b.areas
    this.area = this.wa
    this.settling = false
    this.sentPos = { x: this.win.x, y: this.win.y }
  }

  /** Commands from the tray / settings window. */
  command(state: PetState) {
    if (this.dragging) return
    if (state === 'falling') {
      if (this.surface === 'floor' && this.settings.gravity && !this.onFloor()) this.play('falling')
      return
    }
    this.queue = []
    this.plan = 'none'
    // Floor-only actions requested while up on a wall or the ceiling: come down first.
    const up = this.surface === 'ceiling' || this.surface === 'rope' || this.surface === 'wall'
    if ((state === 'climbing' || state === 'ropeClimb') && up) return // already up
    // Mid-air (floating): come down first, then do it.
    const travel = this.surface !== 'air' && (state === 'climbing' || state === 'floating' || state === 'roping' || state === 'ropeClimb')
    if (this.surface !== 'floor' && !travel) {
      this.queue = [state]
      return this.leaveSurface()
    }
    if (state === 'sleeping') {
      this.autoSleep = false
      this.holdFor = 120
    }
    this.play(state)
    if (state === 'fight') this.endlessFight = true
  }

  click() {
    if (this.state === 'sleeping') return this.wake()
    if (this.surface === 'floor') this.play(pick<PetState>(['happy', 'waving', 'happy', 'spinning']))
    else if (this.surface !== 'air') this.leaveSurface()
  }

  doubleClick() {
    if (this.state === 'sleeping') return this.wake()
    if (this.surface === 'floor') this.play('jumping')
  }

  dragStart(screenX: number, screenY: number) {
    this.dragging = true
    this.dragOffset = { x: screenX - this.win.x, y: screenY - this.win.y }
    this.lastDrag = { x: screenX, t: performance.now(), vx: 0 }
    this.queue = []
    this.plan = 'none'
    this.viaWall = false
    this.surface = 'air'
    this.play('surprised')
  }

  dragMove(screenX: number, screenY: number) {
    if (!this.dragging) return
    const now = performance.now()
    const dt = Math.max(1, now - this.lastDrag.t) / 1000
    const vx = (screenX - this.lastDrag.x) / dt
    this.lastDrag = { x: screenX, t: now, vx: this.lastDrag.vx * 0.7 + vx * 0.3 }
    this.win.x = screenX - this.dragOffset.x
    this.win.y = screenY - this.dragOffset.y
    this.sendPos()
  }

  dragEnd(b: PetBounds) {
    this.dragging = false
    this.setBounds(b)
    if (this.settings.gravity && !this.onFloor()) this.play('falling')
    else {
      // Without gravity Nexo stays where it was dropped and treats that height as its floor.
      this.surface = 'floor'
      this.land = 0
      this.play('happy')
    }
  }

  /** Back from the full-screen arena: the pet window was moved to where Nexo ended up. */
  battleEnded(b: PetBounds) {
    this.setBounds(b)
    this.surface = 'floor'
    this.land = 0
    this.queue = []
    this.play('happy')
    this.say('Victory! 🏆')
  }

  get isDragging() {
    return this.dragging
  }

  // ---------- state machine ----------

  play(state: PetState): void {
    if (state === 'roping') {
      if (this.surface === 'floor') {
        // Get up to the ceiling first: climb a wall, then abseil from the top.
        this.plan = 'rope'
        state = this.startClimb()
      } else if (this.surface === 'ceiling') this.startRope(false)
      else if (this.surface !== 'rope') return this.leaveSurface()
    }
    if ((state === 'climbing' || state === 'ropeClimb') && this.surface === 'floor') state = this.startClimb()
    if (state === 'ropeShoot') this.surface = 'rope'
    if (state === 'floating') this.startFloat()
    if (state === 'clinging') this.holdFor = rand(3, 7)
    if (state === 'falling') this.surface = 'air'
    if (state === 'walking' || state === 'running') {
      if (this.targetX === null) this.pickWalkTarget(state === 'running')
    } else {
      this.targetX = null
    }
    if (state === 'sitting') this.holdFor = rand(8, 20)
    if (state === 'battle') window.nexo.startBattle(this.win.x + this.win.width / 2)
    this.endlessFight = false
    if (state === 'fight') this.say('Bring it on, Bolt! (click me to stop)')
    if (state === 'rescue') this.say('Hold on, I’m coming!')
    if (state === 'chase') {
      this.startChase()
      this.say('Come back here!')
    }
    if (state !== 'sleeping') this.autoSleep = false
    this.speed = 0
    this.state = state
    this.t = 0
    usePet.getState().set({ state })
  }

  /**
   * Floor -> up. Mostly Spider-Man style: shoot a rope to the top edge right here and climb it.
   * Sometimes walk to a screen edge and climb the wall instead. Returns the state to enter now.
   */
  private startClimb(): PetState {
    if (!this.viaWall) {
      if (Math.random() >= 0.4) {
        if (this.plan === 'none') this.plan = 'toCeiling'
        return 'ropeShoot'
      }
      this.viaWall = true
    }
    const side: 1 | -1 = this.win.x - this.wallX(-1) < this.wallX(1) - this.win.x ? -1 : 1
    const wallX = this.wallX(side)
    this.wallSide = side
    this.facing = side
    if (Math.abs(this.win.x - wallX) > 2) {
      this.targetX = wallX
      this.queue = ['climbing']
      return Math.abs(this.win.x - wallX) > 400 ? 'running' : 'walking'
    }
    this.win.x = wallX
    this.viaWall = false
    this.surface = 'wall'
    this.climbDir = -1
    // Half the time Nexo goes all the way up and over onto the ceiling.
    this.plan = this.plan === 'none' && Math.random() < 0.75 ? 'toCeiling' : this.plan
    const up = this.plan === 'toCeiling' || this.plan === 'rope'
    this.climbTargetY = up ? this.wallTopY() : this.wa.y + this.wa.height * rand(0.15, 0.55)
    return 'climbing'
  }

  /** Chase Bolt toward the side of the screen with more room, leaving space for Bolt ahead. */
  private startChase() {
    const room = this.settings.size * 0.6
    const min = this.wallX(-1) + room
    const max = this.wallX(1) - room
    const dir: 1 | -1 = max - this.win.x > this.win.x - min ? 1 : -1
    this.facing = dir
    const reach = dir > 0 ? max - this.win.x : this.win.x - min
    this.chase = { target: this.win.x + dir * Math.max(0, Math.min(reach, rand(350, 750))), arrive: Infinity }
  }

  /** Abseil from the ceiling: part-way for a swing, or all the way down to the floor. */
  private startRope(toFloor: boolean) {
    this.surface = 'rope'
    this.plan = 'none'
    this.rope = { phase: 'down', y: this.wa.y + this.wa.height * rand(0.2, 0.5) - this.win.height / 2, toFloor }
  }

  /** Window y at which the hands of a hanging Nexo reach the top edge. */
  private ropeTopY() {
    return this.wa.y - (this.win.height - this.settings.size * (0.1 + ROPE_HANDS)) + 6
  }

  private startFloat() {
    this.surface = 'air'
    const wa = pick(this.areas) // any screen: floating is how Nexo flies between them
    this.float = {
      phase: 'up',
      x: wa.x + wa.width / 2 - this.win.width / 2 + rand(-0.35, 0.35) * wa.width,
      y: wa.y + wa.height * rand(0.3, 0.45) - this.win.height / 2,
    }
    this.facing = this.float.x >= this.win.x ? 1 : -1
  }

  /** Get down: from the ceiling or a rope always by rope (Spider-Man style); walls drop or climb down. */
  private leaveSurface(): void {
    this.plan = 'none'
    if (this.surface === 'ceiling') {
      this.startRope(true)
      return this.play('roping')
    }
    if (this.surface === 'rope') {
      if (this.state === 'ropeShoot' || this.state === 'ropeClimb') {
        this.rope = { phase: 'down', y: this.floorY(), toFloor: true }
        return this.play('roping')
      }
      this.rope.toFloor = true
      this.rope.phase = 'down'
      return
    }
    if (this.settings.gravity || this.surface === 'air') return this.play('falling')
    this.climbDir = 1
    this.play('climbing')
  }

  private wake() {
    this.autoSleep = false
    this.queue = ['waving']
    this.play('surprised')
  }

  private finish() {
    this.play(this.queue.shift() ?? 'idle')
  }

  private pickWalkTarget(run: boolean) {
    const min = this.wallX(-1)
    const max = this.wallX(1)
    if (Math.random() < 0.3) {
      // Visit a corner: all the way to the left or right edge of the screen.
      this.targetX = this.win.x - min > max - this.win.x ? min : max
    } else {
      const dist = run ? rand(260, 600) : rand(80, 340)
      let dir: 1 | -1 = Math.random() < 0.5 ? -1 : 1
      if (this.win.x + dir * dist > max || this.win.x + dir * dist < min) dir = (-dir) as 1 | -1
      this.targetX = Math.min(max, Math.max(min, this.win.x + dir * dist))
    }
    this.facing = this.targetX >= this.win.x ? 1 : -1
  }

  // ---------- geometry (window positions in screen DIPs) ----------

  /** The screen under Nexo: floors and ceilings can sit at different heights on each one. */
  private get wa(): Rect {
    const cx = this.win.x + this.win.width / 2
    const off = (a: Rect) => Math.max(a.x - cx, cx - (a.x + a.width), 0)
    return this.areas.reduce((best, a) => (off(a) < off(best) ? a : best))
  }

  /** Window x that puts Nexo's hands against the outer left (-1) or right (1) edge of the screens. */
  private wallX(side: 1 | -1) {
    const inset = this.win.width / 2 - this.settings.size * 0.38
    const last = this.areas[this.areas.length - 1]
    return side < 0 ? this.areas[0].x - inset : last.x + last.width - this.win.width + inset
  }

  private floorY() {
    return this.wa.y + this.wa.height - this.win.height
  }

  /** Upright Nexo's head touching the top edge. */
  private wallTopY() {
    return this.wa.y - (this.win.height - this.settings.size * 1.2)
  }

  /** Upside-down Nexo's feet touching the top edge. */
  private ceilingY() {
    return this.wa.y - this.settings.size * 0.1
  }

  private onFloor() {
    return this.win.y >= this.floorY() - 2
  }

  private resetTimers() {
    const k = ACTIVITY_SCALE[this.settings.activity]
    this.timers.walk = rand(20, 45) * k
    this.timers.dance = rand(60, 180) * k
    this.timers.misc = rand(25, 60) * k
    this.timers.roam = rand(8, 15) * k // first trip around the screen comes early
    this.timers.fidget = rand(5, 12)
  }

  private sendPos() {
    const x = Math.round(this.win.x)
    const y = Math.round(this.win.y)
    if (x === this.sentPos.x && y === this.sentPos.y) return
    this.sentPos = { x, y }
    this.move(x, y)
  }

  // ---------- autonomous behaviour ----------

  /** Activities Nexo starts on its own, only ever from idle on the floor. */
  private autonomous(dt: number) {
    const s = this.settings
    const k = ACTIVITY_SCALE[s.activity]
    const tm = this.timers
    tm.fidget -= dt
    tm.walk -= dt
    tm.dance -= dt
    tm.misc -= dt
    tm.roam -= dt

    if (tm.fidget <= 0) {
      tm.fidget = rand(5, 12)
      this.fidget = 0
      if (Math.random() < 0.3) this.facing = (-this.facing) as 1 | -1
    }
    if (tm.dance <= 0) {
      tm.dance = rand(60, 180) * k
      return this.play('dancing')
    }
    if (tm.roam <= 0 && s.walkAround) {
      // Bigger adventures: climb a wall (maybe onto the ceiling) or float to the middle.
      tm.roam = rand(15, 35) * k
      const options: PetState[] = ['floating']
      if (s.climb) options.push('climbing', 'climbing', 'climbing', 'roping', 'roping')
      return this.play(pick(options))
    }
    if (tm.walk <= 0 && s.walkAround) {
      tm.walk = rand(20, 45) * k
      return this.play(Math.random() < 0.2 ? 'running' : 'walking')
    }
    if (tm.misc <= 0) {
      tm.misc = rand(25, 60) * k
      const next = pick<PetState>([
        'jumping', 'waving', 'spinning', 'sitting', 'happy', 'stretching', 'exercising', 'thinking',
        'chairDance', 'chairDance', 'watering', 'watering', 'reading', 'laptop', 'eating', 'drinking',
        'meditating', 'brushing', 'dancing', 'swimming', 'swimming', 'ladder', 'ladder',
        'fight', 'chase', 'rescue', 'battle',
      ])
      // The chase and the battle use the whole screen, so they need walking enabled.
      return this.play((next === 'chase' || next === 'battle') && !s.walkAround ? 'fight' : next)
    }
  }

  /** What to do once Nexo has reached the ceiling or finished a stretch of it. */
  private ceilingNext() {
    const roll = Math.random()
    const other = (-this.wallSide) as 1 | -1
    // Anywhere along the top, edge to edge; ropes favour the outer thirds so the sides get used.
    const min = this.wallX(-1)
    const max = this.wallX(1)
    const spot = () => (Math.random() < 0.5 ? rand(min, min + (max - min) * 0.35) : rand(max - (max - min) * 0.35, max))
    if (this.plan === 'toCeiling') this.plan = 'none'
    if (this.plan === 'rope' || (this.plan === 'none' && roll < 0.3)) {
      this.plan = 'rope' // abseil part-way, swing, climb back up
      this.targetX = spot()
    } else if (this.plan === 'ropeDown' || (this.plan === 'none' && roll < 0.7)) {
      this.plan = 'ropeDown' // walk along the top, then rope all the way down
      this.targetX = Math.random() < 0.5 ? spot() : rand(min, max)
    } else if (this.plan === 'crossCeiling' || roll < 0.85) {
      this.plan = 'crossCeiling' // to the far corner, down the wall
      this.wallSide = other
      this.targetX = this.wallX(other)
    } else {
      this.plan = 'none' // hang around up here for a bit
      this.targetX = spot()
    }
    this.facing = this.targetX >= this.win.x ? 1 : -1
    this.play('walking')
  }

  private beginCorner(toSurface: Surface) {
    const side = this.wallSide
    if (toSurface === 'ceiling' && this.surface === 'rope') {
      // Back up the rope: pull up onto the ceiling right where the rope hangs.
      this.corner = { fromX: this.win.x, fromY: this.win.y, toX: this.win.x, toY: this.ceilingY(), toSurface }
    } else if (toSurface === 'ceiling') {
      this.corner = { fromX: this.win.x, fromY: this.win.y, toX: this.win.x - side * this.settings.size * 0.25, toY: this.ceilingY(), toSurface }
    } else {
      this.corner = { fromX: this.win.x, fromY: this.win.y, toX: this.wallX(side), toY: this.wallTopY(), toSurface }
    }
    // The renderer eases the rotation; switching surface here starts the flip.
    this.surface = toSurface
    this.play('cornering')
  }

  private say(text: string) {
    usePet.getState().set({ bubble: text })
    this.bubbleTimer = 6
  }

  /** Count down habit timers while the user is actively at the PC; act one out when due. */
  private nextTest = 0

  /** Settings "Test reminder": act out the next habit right now. */
  testReminder() {
    const h = HABITS[this.nextTest++ % HABITS.length]
    this.say(h.text)
    this.command(h.state)
  }

  private habits(idle: number) {
    if (!this.settings.habits || idle > 60) return
    for (const h of HABITS) {
      this.habitLeft[h.key] -= 5
      if (this.habitLeft[h.key] > 0) continue
      const busy = this.dragging || this.state === 'sleeping' || this.state === 'falling'
      if (busy) continue
      this.habitLeft[h.key] = h.every * 60
      this.say(h.text)
      this.command(h.state)
      return // one reminder at a time
    }
  }

  private async checkIdle() {
    const s = this.settings
    if (this.dragging) return
    if (this.state === 'battle') return
    const idle = await this.getIdleSeconds()
    this.habits(idle)
    if (s.paused || s.sleepAfterMin <= 0) return
    if (this.state === 'sleeping' && this.autoSleep && idle < 3) return this.wake()
    if (this.state === 'sleeping' || idle < s.sleepAfterMin * 60) return
    if (this.surface !== 'floor') {
      // Tired: come down first, sleep on the next check.
      if (this.state !== 'falling' && this.state !== 'climbing') this.leaveSurface()
      return
    }
    this.queue = []
    this.play('sleeping')
    this.autoSleep = true
    this.holdFor = Infinity
  }

  private blink(dt: number) {
    const store = usePet.getState()
    if (this.blinkLeft > 0) {
      this.blinkLeft -= dt
      if (this.blinkLeft <= 0) store.set({ blink: false })
      return
    }
    this.timers.blink -= dt
    if (this.timers.blink <= 0) {
      // Occasional double blink feels more alive than a metronome.
      this.timers.blink = Math.random() < 0.2 ? 0.28 : rand(2.5, 6)
      this.blinkLeft = 0.13
      store.set({ blink: true })
    }
  }

  // ---------- per-frame update ----------

  update(dt: number): Frame {
    dt = Math.min(dt, 0.1) // after a stall, do not teleport
    this.t += dt
    if (this.land >= 0) this.land += dt
    if (this.fidget >= 0) {
      this.fidget += dt / 0.9
      if (this.fidget >= 1) this.fidget = -1
    }
    this.blink(dt)
    if (this.bubbleTimer > 0) {
      this.bubbleTimer -= dt
      if (this.bubbleTimer <= 0) usePet.getState().set({ bubble: null })
    }

    this.timers.idleCheck -= dt
    if (this.timers.idleCheck <= 0) {
      this.timers.idleCheck = 5
      void this.checkIdle()
    }

    if (this.dragging) {
      // Swing opposite to the carry direction, like something dangling from a hand.
      const target = Math.max(-28, Math.min(28, -this.lastDrag.vx * 0.03)) * this.facing
      this.dragRot += (target - this.dragRot) * Math.min(1, dt * 10)
      this.lastDrag.vx *= Math.pow(0.02, dt)
    } else {
      this.dragRot = 0
      this.timeouts(dt)
      this.locomotion(dt)
    }

    const scene = isDuo(this.state) && !this.dragging ? duo(this.state, this.t, this.facing, { arrive: this.chase.arrive, endless: this.endlessFight }) : null
    const p = scene
      ? scene.nexo
      : pose(this.state, this.t, {
          fidget: this.state === 'idle' ? this.fidget : -1,
          dragRot: this.dragging ? this.dragRot || 0.001 : 0,
          land: this.land,
        })
    return {
      pose: p,
      state: this.state,
      t: this.t,
      facing: this.facing,
      fidget: this.state === 'idle' ? this.fidget : -1,
      dragging: this.dragging,
      surface: this.surface,
      rope: this.ropeFrame(),
      win: { x: this.win.x, y: this.win.y },
      duo: scene?.duo ?? null,
      joints: scene?.joints ?? null,
    }
  }

  private ropeFrame(): Frame['rope'] {
    const s = this.state
    if (this.dragging || (s !== 'roping' && s !== 'ropeClimb' && s !== 'ropeShoot')) return null
    if (s !== 'ropeShoot') return { top: this.wa.y, k: 1 }
    // The rope zips up from the hand to the top edge.
    const k = Math.min(1, Math.max(0, (this.t - 0.25) / 0.3))
    return k <= 0 ? null : { top: this.wa.y, k: 1 - (1 - k) ** 3 }
  }

  /** Ends of timed states. */
  private timeouts(dt: number) {
    const dur = DURATION[this.state]
    const s = this.state
    if (s === 'cornering') {
      if (this.t >= CORNER_TIME) {
        this.win.x = this.corner.toX
        this.win.y = this.corner.toY
        this.sendPos()
        if (this.corner.toSurface === 'ceiling') this.ceilingNext()
        else {
          this.climbDir = 1
          this.play('climbing')
        }
      }
      return
    }
    if (s === 'ropeShoot' && this.t >= 0.6) return this.play('ropeClimb')
    if (isDuo(s) && this.t >= duoDuration(s, { arrive: this.chase.arrive, endless: this.endlessFight })) return this.finish()
    if (dur !== undefined && this.t >= dur) return this.finish()
    if ((s === 'sitting' || s === 'sleeping') && this.t >= this.holdFor) return this.finish()
    if (s === 'clinging' && this.t >= this.holdFor) return this.leaveSurface()
    if (s === 'idle' && this.surface === 'ceiling' && this.t >= this.holdFor) return this.ceilingNext()
    if (s === 'idle' && this.surface === 'floor' && !this.settings.paused) this.autonomous(dt)
  }

  private locomotion(dt: number) {
    const size = this.settings.size / 110
    const s = this.state

    // Walked onto another screen: step up or down to its floor (or ceiling).
    const wa = this.wa
    const grounded = this.surface === 'floor' || this.surface === 'ceiling'
    if (wa !== this.area) {
      this.area = wa
      this.settling = grounded
    }
    if (this.settling) {
      const dy = (this.surface === 'floor' ? this.floorY() : this.ceilingY()) - this.win.y
      this.win.y += Math.sign(dy) * Math.min(Math.abs(dy), 900 * size * dt)
      if (!grounded || Math.abs(dy) < 0.5) this.settling = false
      this.sendPos()
    }

    if ((s === 'walking' || s === 'running') && this.targetX !== null) {
      const run = s === 'running'
      const max = (run ? 170 : 62) * size * (this.surface === 'ceiling' ? 0.8 : 1)
      this.speed = Math.min(max, this.speed + max * dt * (run ? 2.2 : 4)) // ease in
      const left = this.targetX - this.win.x
      this.win.x += Math.sign(left) * Math.min(Math.abs(left), this.speed * dt)
      if (Math.abs(left) < 0.5) {
        this.targetX = null
        this.arrived()
      }
      this.sendPos()
    }

    if (s === 'chase' && this.t > 1.6 && this.chase.arrive === Infinity) {
      const max = 170 * size
      this.speed = Math.min(max, this.speed + max * dt * 2.2)
      const left = this.chase.target - this.win.x
      this.win.x += Math.sign(left) * Math.min(Math.abs(left), this.speed * dt)
      if (Math.abs(left) < 0.5) this.chase.arrive = this.t
      this.sendPos()
    }

    if (s === 'climbing') {
      const speed = 70 * size * (this.climbDir < 0 ? 1 : 1.4)
      this.win.y += this.climbDir * speed * dt
      if (this.climbDir < 0 && this.win.y <= this.climbTargetY) {
        this.win.y = this.climbTargetY
        if (this.plan === 'toCeiling' || this.plan === 'rope') this.beginCorner('ceiling')
        else this.play('clinging')
      } else if (this.climbDir > 0 && this.win.y >= this.floorY()) {
        this.win.y = this.floorY()
        this.climbDir = -1
        this.surface = 'floor'
        this.plan = 'none'
        this.land = 0
        this.finish()
      }
      this.sendPos()
    }

    if (s === 'ropeClimb') {
      this.win.y -= 150 * size * Math.min(1, this.t * 2.5) * dt // web-zip
      if (this.win.y <= this.ropeTopY()) {
        this.win.y = this.ropeTopY()
        this.sendPos()
        return this.beginCorner('ceiling')
      }
      this.sendPos()
    }

    if (s === 'roping') {
      const r = this.rope
      if (r.phase === 'down') {
        const target = r.toFloor ? this.floorY() : r.y
        this.win.y = Math.min(target, this.win.y + (r.toFloor ? 120 : 95) * size * Math.min(1, this.t * 1.5) * dt)
        if (this.win.y >= target) {
          if (r.toFloor) {
            this.surface = 'floor'
            this.land = 0
            this.sendPos()
            return this.finish()
          }
          r.phase = 'swing'
          this.holdFor = this.t + rand(4, 7)
        }
      } else if (r.phase === 'swing') {
        if (this.t >= this.holdFor) {
          // Spider-Man rules: never just let go. Climb back up or slide on down.
          if (Math.random() < 0.5) r.phase = 'up'
          else {
            r.toFloor = true
            r.phase = 'down'
          }
        }
      } else {
        this.win.y -= 75 * size * dt
        if (this.win.y <= this.ropeTopY()) {
          this.win.y = this.ropeTopY()
          this.sendPos()
          return this.beginCorner('ceiling')
        }
      }
      this.sendPos()
    }

    if (s === 'cornering') {
      const k = easeInOut(Math.min(1, this.t / CORNER_TIME))
      this.win.x = this.corner.fromX + (this.corner.toX - this.corner.fromX) * k
      this.win.y = this.corner.fromY + (this.corner.toY - this.corner.fromY) * k
      this.sendPos()
    }

    if (s === 'floating') {
      const f = this.float
      if (f.phase === 'up' || f.phase === 'down') {
        const ty = f.phase === 'up' ? f.y : this.floorY()
        const tx = f.phase === 'up' ? f.x : this.win.x
        const k = 1 - Math.exp(-dt * 1.1)
        this.win.x += (tx - this.win.x) * k
        // Constant-ish rise with an eased arrival.
        const dy = ty - this.win.y
        this.win.y += Math.sign(dy) * Math.min(Math.abs(dy), Math.max(25 * size, Math.abs(dy) * 1.2) * dt)
        if (Math.abs(dy) < 1 && Math.abs(tx - this.win.x) < 2) {
          if (f.phase === 'up') {
            f.phase = 'hover'
            this.holdFor = this.t + rand(4, 8)
          } else {
            this.surface = 'floor'
            this.land = 0
            this.finish()
          }
        }
        this.sendPos()
      } else if (this.t >= this.holdFor) {
        if (this.settings.gravity) this.play('falling')
        else f.phase = 'down'
      }
    }

    if (s === 'falling') {
      this.vy += GRAVITY * dt
      this.win.y += this.vy * dt
      if (this.win.y >= this.floorY()) {
        this.win.y = this.floorY()
        this.vy = 0
        this.land = 0
        this.surface = 'floor'
        // Off-screen after dropping from a wall: step back into view.
        const min = this.wallX(-1)
        const max = this.wallX(1)
        if (this.win.x < min || this.win.x > max) {
          this.targetX = Math.min(max, Math.max(min, this.win.x))
          this.facing = this.targetX > this.win.x ? 1 : -1
          this.queue.unshift('walking')
        }
        this.finish()
      }
      this.sendPos()
    } else {
      this.vy = 0
    }
  }

  /** Reached a walking target. */
  private arrived() {
    if (this.surface === 'ceiling') {
      if (this.plan === 'crossCeiling') return this.beginCorner('wall')
      if (this.plan === 'rope' || this.plan === 'ropeDown') {
        this.startRope(this.plan === 'ropeDown')
        return this.play('roping')
      }
      this.play('idle')
      this.holdFor = rand(2.5, 5)
      return
    }
    if (!this.queue.length && Math.random() < 0.25) this.queue = ['sitting']
    const next = this.queue.shift() ?? 'idle'
    if (next === 'walking' || next === 'running') this.targetX = null
    this.play(next)
  }
}
