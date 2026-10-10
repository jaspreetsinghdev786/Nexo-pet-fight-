import type { PetState } from '../../../electron/shared'
import { JointPose, limbs } from './limbs'
import { Expression, ladderRung, pose, Pose } from './poses'

// Scenes with a second robot ("Bolt"): a play-fight, a chase up a ladder, and a rescue.
// Everything here is a pure timeline of t. Conventions:
//   Nexo pose: same as poses.ts (x/y fractions of Nexo's height, x toward Nexo's facing side).
//   Rival and props: world units, x measured toward Nexo's facing side, y up from the floor.
//   Rival lean: degrees, positive = leaning toward where the rival faces.

export type DuoState = 'fight' | 'chase' | 'rescue'
export const DUO_STATES: readonly PetState[] = ['fight', 'chase', 'rescue']
export const isDuo = (s: PetState): s is DuoState => DUO_STATES.includes(s)

export const RIVAL_SCALE = 0.85
/** Both robots are drawn smaller during Bolt scenes so the pair fits the window. */
export const DUO_SCALE = 0.62
const H = 3 // Nexo's height in world units (model HEIGHT)
const TAU = Math.PI * 2
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
const easeInOut = (v: number) => (v < 0.5 ? 4 * v ** 3 : 1 - (-2 * v + 2) ** 3 / 2)
const easeOut = (v: number) => 1 - (1 - v) ** 3
const bump = (t: number, a: number, b: number) => Math.sin(Math.PI * seg(t, a, b))
const lerp = (a: number, b: number, k: number) => a + (b - a) * k

export interface DuoCtx {
  arrive: number // chase: seconds into the state when Nexo caught up (Infinity while running)
  endless: boolean // fight: Bolt keeps getting back up until Nexo is told to stop
}

export interface RivalFrame {
  on: boolean
  x: number
  y: number
  z: number
  lean: number
  sx: number
  sy: number
  away: boolean // faces the same way as Nexo (running off, climbing) instead of toward it
  joints: JointPose
  expr: Expression
}

export interface DuoFrame {
  rival: RivalFrame
  ladder: { on: boolean; x: number; z: number; scale: number }
  bar: { on: boolean; y: number; x: number }
  impact: { k: number; x: number; y: number }
}

/** How long a scene lasts; the chase depends on when Nexo catches up. */
export function duoDuration(s: DuoState, ctx: DuoCtx) {
  if (s === 'fight') return ctx.endless ? Infinity : 10
  if (s === 'rescue') return 13
  return ctx.arrive + 7.8
}

export function mix(a: JointPose, b: JointPose, k: number): JointPose {
  if (k <= 0) return a
  const l = (x: number, y: number) => lerp(x, y, k)
  return {
    hipL: l(a.hipL, b.hipL),
    hipR: l(a.hipR, b.hipR),
    kneeL: l(a.kneeL, b.kneeL),
    kneeR: l(a.kneeR, b.kneeR),
    spread: l(a.spread, b.spread),
    shL: [l(a.shL[0], b.shL[0]), l(a.shL[1], b.shL[1])],
    shR: [l(a.shR[0], b.shR[0]), l(a.shR[1], b.shR[1])],
    elL: [l(a.elL[0], b.elL[0]), l(a.elL[1], b.elL[1])],
    elR: [l(a.elR[0], b.elR[0]), l(a.elR[1], b.elR[1])],
    head: [l(a.head[0], b.head[0]), l(a.head[1], b.head[1]), l(a.head[2], b.head[2])],
    drop: l(a.drop, b.drop),
    tilt: l(a.tilt, b.tilt),
    yaw: l(a.yaw, b.yaw),
    turn: l(a.turn, b.turn),
  }
}

// ---------- fighting moves (side-on, facing the opponent) ----------

const base = () => limbs('idle', 0, { fidget: -1, dragging: false })

/** Boxing guard: fists up by the face, knees soft, bouncing on the toes. */
export function guard(t: number): JointPose {
  const j = base()
  const b = Math.sin(TAU * t * 2.2)
  j.shL = [-0.95, -0.3]
  j.shR = [-0.95, 0.3]
  j.elL = [-1.85, 0.2]
  j.elR = [-1.85, -0.2]
  j.hipL = -0.3 - 0.05 * b
  j.hipR = 0.1 - 0.05 * b
  j.kneeL = j.kneeR = 0.4 + 0.08 * b
  j.head = [0.12, 0, 0]
  j.turn = 0.6 // three-quarter view so the punches read
  return j
}

export function jab(t: number): JointPose {
  const j = guard(t)
  j.shR = [-1.6, 0.12]
  j.elR = [-0.05, 0]
  j.head = [0.05, 0, -0.08]
  return j
}

export function hook(t: number): JointPose {
  const j = guard(t)
  j.shR = [-1.35, 1.05]
  j.elR = [-1.1, -0.6]
  j.head = [0.08, -0.15, 0]
  return j
}

export function block(t: number): JointPose {
  const j = guard(t)
  j.shL = [-1.5, -0.12]
  j.shR = [-1.5, 0.12]
  j.elL = [-1.95, 0.35]
  j.elR = [-1.95, -0.35]
  j.head = [0.3, 0, 0]
  return j
}

export function hurt(t: number): JointPose {
  const j = guard(t)
  j.shL = [0.45, -1.1]
  j.shR = [0.45, 1.1]
  j.elL = [-0.3, 0]
  j.elR = [-0.3, 0]
  j.head = [-0.35, 0, 0.15]
  j.hipL = 0.25
  j.kneeL = 0.5
  return j
}

export function spinKick(t: number, k: number): JointPose {
  const j = guard(t)
  j.yaw = TAU * easeInOut(k)
  const out = Math.sin(Math.PI * k)
  j.shL = [0, -0.3 - 1.2 * out]
  j.shR = [0, 0.3 + 1.2 * out]
  j.elL = j.elR = [-0.2, 0]
  j.hipR = -1.5 * out
  j.kneeR = 0.4 * (1 - out)
  return j
}

export const cheer = (t: number) => limbs('happy', t % 1.6, { fidget: -1, dragging: false })
export const run = (t: number) => limbs('running', t, { fidget: -1, dragging: false })
export const wave = (t: number) => limbs('waving', 0.5 + (t % 1.5), { fidget: -1, dragging: false })
export const fall = (t: number) => limbs('falling', t, { fidget: -1, dragging: false })
export const hang = (t: number) => limbs('clinging', t, { fidget: -1, dragging: false })
export const jump = (t: number) => limbs('jumping', t % 1.1, { fidget: -1, dragging: false })
export const sitDizzy = (t: number) => {
  const j = limbs('sitting', t, { fidget: -1, dragging: false })
  j.head = [0.1 * Math.sin(TAU * t * 1.4), 0.25 * Math.sin(TAU * t * 0.9), 0.2 * Math.cos(TAU * t * 1.4)]
  return j
}

/** Who swings when, and how the other one reacts. */
const BOUTS: { t: number; by: 'n' | 'r'; move: 'jab' | 'hook'; res: 'block' | 'dodge' | 'hit' }[] = [
  { t: 1.8, by: 'n', move: 'jab', res: 'block' },
  { t: 2.5, by: 'r', move: 'jab', res: 'dodge' },
  { t: 3.2, by: 'n', move: 'jab', res: 'hit' },
  { t: 3.9, by: 'r', move: 'hook', res: 'hit' },
  { t: 4.6, by: 'n', move: 'jab', res: 'block' },
  { t: 5.2, by: 'r', move: 'jab', res: 'block' },
  { t: 5.8, by: 'n', move: 'hook', res: 'hit' },
]
const KICK = [6.3, 6.9] as const
const RIVAL_HOME = 1.3
const NEXO_HOME = -0.26

/** A fighter's joints, lunge (fraction of its height) and lean (degrees) at time t. */
function fighter(who: 'n' | 'r', t: number) {
  let j = guard(t)
  let lunge = 0
  let lean = 0
  for (const b of BOUTS) {
    if (b.by === who) {
      const k = bump(t, b.t, b.t + 0.35)
      if (k > 0) {
        j = mix(j, b.move === 'jab' ? jab(t) : hook(t), k)
        lunge += 0.07 * k
        lean += 10 * k
      }
    } else {
      const k = b.res === 'hit' ? bump(t, b.t + 0.12, b.t + 0.6) : bump(t, b.t, b.t + 0.4)
      if (k <= 0) continue
      if (b.res === 'block') j = mix(j, block(t), k)
      if (b.res === 'dodge') {
        lean -= 22 * k
        lunge -= 0.04 * k
      }
      if (b.res === 'hit') {
        j = mix(j, hurt(t), k)
        lean -= 16 * k
        lunge -= 0.06 * k
      }
    }
  }
  return { j, lunge, lean }
}

/** Impact flash at the moment a punch lands. */
function impactAt(t: number) {
  for (const b of BOUTS) {
    if (b.res !== 'hit') continue
    const k = bump(t, b.t + 0.12, b.t + 0.38)
    if (k > 0) return { k, x: b.by === 'n' ? 0.75 : 0.05, y: b.move === 'hook' ? 2.1 : 1.8 }
  }
  const k = bump(t, KICK[0] + 0.35, KICK[0] + 0.6)
  return { k, x: 0.7, y: 1.4 }
}

const hidden = (): RivalFrame => ({ on: false, x: 0, y: 0, z: 0, lean: 0, sx: 1, sy: 1, away: false, joints: base(), expr: 'normal' })
const noProps = () => ({
  ladder: { on: false, x: 0, z: 0, scale: 1 },
  bar: { on: false, y: 0, x: 0 },
  impact: { k: 0, x: 0, y: 0 },
})

/** Drop in from above the window, landing at x with a squash. */
function dropIn(r: RivalFrame, t: number, x: number) {
  const u = seg(t, 0, 0.7)
  r.on = true
  r.x = x
  r.y = 3.2 * (1 - u * u)
  r.joints = u < 1 ? fall(t) : r.joints
  r.expr = 'surprised'
  const sq = 0.16 * bump(t, 0.7, 1.05)
  r.sy = 1 - sq
  r.sx = 1 + sq * 0.7
}

// ---------- scenes ----------

/** Endless fight: after the knock-back Bolt walks back in, then the bouts start over. */
const LOOP = { from: 1, back: 8.6, to: 9.4 }

function fightScene(time: number, endless: boolean): { nexo: Pose; joints: JointPose; duo: DuoFrame } {
  const looped = endless && time >= LOOP.to
  const t = looped ? LOOP.from + ((time - LOOP.from) % (LOOP.to - LOOP.from)) : time
  const duo: DuoFrame = { rival: hidden(), ...noProps() }
  const r = duo.rival
  const enter = easeInOut(seg(t, 0.2, 0.9))
  const nexo: Pose = { x: NEXO_HOME * enter, y: 0, rot: 0, sx: 1, sy: 1, shadow: 1 }
  let joints = guard(t)

  // Nexo
  if (t < 1) {
    joints = mix(limbs('surprised', t, { fidget: -1, dragging: false }), guard(t), seg(t, 0.6, 1))
  } else if (t < KICK[0]) {
    const f = fighter('n', t)
    joints = f.j
    nexo.x += f.lunge
    nexo.rot = f.lean
    nexo.y = -0.015 * Math.abs(Math.sin(TAU * t * 2.2))
  } else if (t < KICK[1]) {
    joints = spinKick(t, seg(t, KICK[0], KICK[1]))
    nexo.x += 0.06 * bump(t, KICK[0], KICK[1])
    nexo.y = -0.06 * bump(t, KICK[0], KICK[1])
  } else if (t < 8.6) {
    joints = cheer(t)
    const hop = Math.abs(Math.sin(TAU * t * 0.625) * Math.sin(Math.PI * t * 1.25))
    nexo.y = -0.08 * hop
  } else if (endless) {
    // Back on guard for the next round.
    joints = mix(cheer(t), guard(t), seg(t, LOOP.back, LOOP.back + 0.4))
  } else {
    joints = wave(t)
    joints.turn = 0.4
    nexo.x = NEXO_HOME * (1 - seg(t, 8.6, 9.6))
  }

  // Rival
  dropIn(r, t, RIVAL_HOME)
  if (looped) {
    r.sx = r.sy = 1 // already here: no landing squash on later rounds
    r.expr = 'focused'
  }
  if (t >= 0.7 && t < KICK[0] + 0.35) {
    const f = fighter('r', t)
    r.joints = t < 1 ? mix(r.joints, f.j, seg(t, 0.7, 1)) : f.j
    r.x = RIVAL_HOME - f.lunge * H * RIVAL_SCALE
    r.lean = f.lean
    r.y = 0.04 * Math.abs(Math.sin(TAU * t * 2.2 + 1))
    r.expr = 'focused'
  } else if (t >= KICK[0] + 0.35 && t < 7.6) {
    // Knocked back: flies, tumbles, lands on its bottom.
    const u = seg(t, KICK[0] + 0.35, 7.3)
    r.x = lerp(RIVAL_HOME, 2.05, easeOut(u))
    r.y = 0.9 * 4 * u * (1 - u)
    r.lean = -55 * Math.sin(Math.PI * u)
    r.joints = u < 1 ? hurt(t) : sitDizzy(t)
    r.expr = 'surprised'
  } else if (t >= 7.6) {
    r.x = 2.05
    r.joints = sitDizzy(t)
    r.expr = 'sleep'
    if (t > LOOP.back && endless) {
      // Gets up and charges back in for more.
      const u = seg(t, LOOP.back, LOOP.to - 0.15)
      r.joints = mix(run(t), guard(t), seg(t, LOOP.to - 0.3, LOOP.to))
      r.x = lerp(2.05, RIVAL_HOME, easeInOut(u))
      r.lean = 12 * (1 - u)
      r.expr = 'focused'
    } else if (t > 8.6) {
      // Gets up and runs off the side of the window.
      const u = seg(t, 8.8, 9.9)
      r.joints = run(t)
      r.away = true
      r.x = lerp(2.05, 4.6, u * u)
      r.expr = 'wink'
    }
  }
  duo.impact = impactAt(t)
  return { nexo, joints, duo }
}

const CHASE_TAUNT = 1.6
const CHASE_LADDER_X = 1.45
const RUNG = 0.3 * RIVAL_SCALE

function chaseScene(t: number, arrive: number): { nexo: Pose; joints: JointPose; duo: DuoFrame } {
  const duo: DuoFrame = { rival: hidden(), ...noProps() }
  const r = duo.rival
  const nexo: Pose = { x: NEXO_HOME * easeInOut(seg(t, 0.2, 0.9)), y: 0, rot: 0, sx: 1, sy: 1, shadow: 1 }
  let joints = base()
  const a = t - arrive // seconds since Nexo caught up

  // Rival drops in and taunts, then runs ahead of Nexo across the screen.
  dropIn(r, t, CHASE_LADDER_X)
  if (t >= 0.8 && t < CHASE_TAUNT) {
    r.joints = wave(t)
    r.joints.turn = 0.3
    r.expr = 'wink'
  } else if (t >= CHASE_TAUNT && a < 0) {
    r.joints = run(t)
    r.away = true
    r.y = 0.05 * Math.abs(Math.sin(Math.PI * 3.4 * t))
    r.lean = 9
    r.expr = 'happy'
  }

  if (t < CHASE_TAUNT) {
    joints = limbs('surprised', Math.min(t, 0.6), { fidget: -1, dragging: false })
    joints.turn = 1
  } else if (a < 0) {
    joints = run(t)
    Object.assign(nexo, pose('running', t, { fidget: -1, dragRot: 0, land: -1 }), { x: nexo.x })
  }

  if (a >= 0) {
    duo.ladder = { on: a < 6.2, x: CHASE_LADDER_X, z: -0.45, scale: RIVAL_SCALE }
    // Rival scrambles up the ladder (back to the viewer), then turns round to gloat.
    const climb = seg(a, 0.3, 2.1)
    const rung = Math.min(3, Math.floor(climb * 3) + easeInOut(clamp01((climb * 3 - Math.floor(climb * 3)) * 1.6)))
    if (a < 3.3) {
      r.y = rung * RUNG
      r.z = -0.15
      const lt = a < 2.1 ? 0.7 + climb * 3.6 * 0.75 : 4.6 + (a - 2.1)
      r.joints = limbs('ladder', lt, { fidget: -1, dragging: false })
      r.joints.turn = 0
      r.away = false
      r.lean = 0
      r.expr = a < 2.1 ? 'focused' : 'wink'
    }
    // Nexo steps up to the ladder and jumps for it, twice, then grabs.
    nexo.x = lerp(NEXO_HOME, 0, easeInOut(seg(a, 0, 0.6)))
    if (a < 0.6) joints = limbs('walking', t, { fidget: -1, dragging: false })
    else if (a < 3.8) {
      const jt = (a - 0.6) % 1.1
      joints = jump(jt)
      const p = pose('jumping', jt, { fidget: -1, dragRot: 0, land: -1 })
      nexo.y = p.y
      nexo.sx = p.sx
      nexo.sy = p.sy
      joints.turn = 0.8
    }
    if (a >= 3.3 && a < 5.4) {
      // Tagged! Rival tumbles off the ladder and Nexo catches it.
      const u = seg(a, 3.3, 3.9)
      r.x = lerp(CHASE_LADDER_X, 1.05, easeOut(u))
      r.y = lerp(3 * RUNG, 0.45, u) + 0.4 * 4 * u * (1 - u)
      r.z = 0.25
      r.lean = -40 * (1 - u)
      r.joints = u < 1 ? fall(a) : hang(a)
      r.joints.turn = 0.3
      r.expr = 'surprised'
      if (a >= 3.8) {
        joints = base()
        joints.shL = [-1.2, -0.2]
        joints.shR = [-1.2, 0.6]
        joints.elL = joints.elR = [-0.6, 0]
        joints.turn = 0.6
      }
      if (a >= 4.6) r.y = lerp(0.45, 0, seg(a, 4.6, 5.2))
    }
    if (a >= 5.4) {
      // Both laugh it off; Bolt runs away.
      joints = cheer(a)
      nexo.y = -0.06 * Math.abs(Math.sin(TAU * a * 0.625))
      r.x = 1.05
      r.y = 0
      r.z = 0
      r.lean = 0
      r.joints = cheer(a + 0.4)
      r.expr = 'happy'
      if (a >= 6.4) {
        const u = seg(a, 6.4, 7.6)
        r.joints = run(a)
        r.away = true
        r.x = lerp(1.05, 4.6, u * u)
        joints = wave(a)
      }
    }
  }
  return { nexo, joints, duo }
}

const BAR_Y = 3.76
const STUCK = { x: 1.35, y: 2.35 }

function rescueScene(t: number, facing: 1 | -1): { nexo: Pose; joints: JointPose; duo: DuoFrame } {
  const duo: DuoFrame = { rival: hidden(), ...noProps() }
  const r = duo.rival
  const nexo: Pose = { x: NEXO_HOME * easeInOut(seg(t, 0.2, 0.9)), y: 0, rot: 0, sx: 1, sy: 1, shadow: 1 }
  duo.bar = { on: t < 6.6, y: BAR_Y, x: STUCK.x }
  duo.ladder = { on: t > 0.6 && t < 9.6, x: NEXO_HOME * H, z: -0.62, scale: 1 }

  // Nexo climbs the ladder (timeline of the ladder action, shifted), reaches out at the top,
  // climbs down with Bolt hanging from its hand.
  const lt = t - 0.8
  const up = t < 5.1 ? ladderRung(Math.max(0, lt)).rung : t < 6.5 ? 4 : 4 * (1 - easeInOut(seg(t, 6.5, 9.3)))
  nexo.y = -0.1 * up
  let joints = t < 0.8 ? limbs('surprised', Math.min(t, 0.6), { fidget: -1, dragging: false }) : limbs('ladder', Math.min(lt, 4.3), { fidget: -1, dragging: false })
  // Arm toward Bolt: Nexo's right arm is on world +x, so pick the arm on Bolt's side.
  const reach = t >= 5.1 && t < 9.6 ? clamp01((t - 5.1) / 0.4) : 0
  if (t >= 5.1 && t < 9.6) {
    joints = limbs('ladder', t < 6.5 ? 3.9 : 0.7 + (3.6 * (t - 6.5)) / 2.8, { fidget: -1, dragging: false })
    joints.yaw = Math.PI
    const arm: [number, number] = [0.15, 1.95 * reach]
    if (facing > 0) {
      // Facing the ladder flips sides: the left arm points to world +x.
      joints.shL = [arm[0], -arm[1]]
      joints.elL = [0, 0]
    } else {
      joints.shR = arm
      joints.elR = [0, 0]
    }
  }
  if (t >= 9.3) {
    joints = mix(joints, cheer(t), seg(t, 9.6, 10))
    joints.yaw = Math.PI * (1 + easeInOut(seg(t, 9.3, 9.9))) // turn back to the viewer
  }
  if (t >= 10.5) joints = wave(t)

  // Bolt
  r.on = true
  r.expr = 'surprised'
  const pop = easeOut(seg(t, 0, 0.5))
  r.sx = r.sy = pop
  if (t < 5.5) {
    r.x = STUCK.x
    r.y = STUCK.y
    r.joints = hang(t * 2.2) // legs kicking in panic
  } else if (t < 9.3) {
    // Grabs Nexo's hand and hangs from it on the way down.
    // Nexo's hand is ~1.32 above its feet; Bolt's raised hands are ~1.41 above its own.
    const handY = Math.max(0, H * 0.1 * up - 0.09)
    const u = easeInOut(seg(t, 5.5, 6.4))
    r.x = lerp(STUCK.x, 0.8, u)
    r.y = lerp(STUCK.y, handY, u)
    r.joints = hang(t)
    r.expr = t < 6.4 ? 'surprised' : 'focused'
  } else {
    r.x = 0.8 + 0.25 * seg(t, 9.3, 9.8)
    r.y = 0.4 * bump(t, 9.3, 9.8)
    r.joints = cheer(t + 0.3)
    r.expr = 'happy'
    if (t >= 10.5) {
      const u = seg(t, 10.7, 12)
      r.joints = t < 10.7 ? wave(t) : run(t)
      r.away = t >= 10.7
      r.x = lerp(1.05, 4.6, u * u)
    }
  }
  return { nexo, joints, duo }
}

export function duo(state: DuoState, t: number, facing: 1 | -1, ctx: DuoCtx) {
  if (state === 'fight') return fightScene(t, ctx.endless)
  if (state === 'chase') return chaseScene(t, ctx.arrive)
  return rescueScene(t, facing)
}
