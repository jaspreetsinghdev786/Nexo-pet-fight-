import type { PetState } from '../../../electron/shared'

// Whole-body motion (hop, lean, squash and stretch) layered on top of the joint animation
// in limbs.ts. Offsets are fractions of the pet's height; rot is degrees, positive = leaning
// toward the direction Nexo faces.

export type Expression = 'normal' | 'blink' | 'happy' | 'wink' | 'sleep' | 'surprised' | 'focused' | 'yawn'

export interface Pose {
  x: number
  y: number
  rot: number
  sx: number
  sy: number
  shadow: number // ground-shadow scale, shrinks while airborne
}

export interface PoseCtx {
  fidget: number // 0..1 progress of an idle fidget, or -1
  dragRot: number // swing while being carried
  land: number // seconds since landing, or -1
}

const TAU = Math.PI * 2
/** Height of Nexo's raised hands, as a fraction of its height (rope grip point). */
export const ROPE_HANDS = 0.47
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const easeOut = (v: number) => 1 - (1 - v) ** 3
const easeInOut = (v: number) => (v < 0.5 ? 4 * v ** 3 : 1 - (-2 * v + 2) ** 3 / 2)

/** One-shot states and how long they last, in seconds. Missing = loops until changed. */
export const DURATION: Partial<Record<PetState, number>> = {
  jumping: 1.1,
  waving: 2.6,
  spinning: 1.2,
  happy: 1.6,
  surprised: 1.0,
  stretching: 3.4,
  exercising: 4.2,
  thinking: 4.6,
  cornering: 0.9,
  chairDance: 6.5,
  watering: 7,
  drinking: 4.5,
  eating: 5,
  reading: 9,
  laptop: 9,
  meditating: 9,
  brushing: 5,
  eyeRest: 4.5,
  dancing: 6.4,
  swimming: 9.8,
  ladder: 9.6,
}

/** Ladder: rungs are 0.1 of Nexo's height apart. Times in seconds. */
export const LADDER = { rungs: 4, rung: 0.1, up: [0.7, 4.3], down: [6.3, 9.0] } as const

/** Swim: hop in, crawl strokes, a wave from the water, hop out. Times in seconds. */
export const SWIM = { hopIn: [0.15, 0.85], swim: [1.1, 7.5], hopOut: [8.7, 9.4], strokes: 0.75 } as const

/** Breaststroke sweep, 0 = arms out front, 1 = swept wide. */
export const swimSweep = (t: number) => (1 - Math.cos(Math.PI * 2 * t * SWIM.strokes)) / 2

/** How many rungs Nexo has climbed (eased per rung) and the continuous step phase for the limbs. */
export function ladderRung(t: number) {
  const { rungs, up, down } = LADDER
  let p = 0
  if (t >= up[0] && t < up[1]) p = ((t - up[0]) / (up[1] - up[0])) * rungs
  else if (t >= up[1] && t < down[0]) p = rungs
  else if (t >= down[0] && t < down[1]) p = rungs * (1 - (t - down[0]) / (down[1] - down[0]))
  const n = Math.floor(p)
  // Each rung is a quick pull-up followed by a short settle.
  const rung = Math.min(rungs, n + easeInOut(clamp01((p - n) * 1.6)))
  return { rung, step: p }
}

/** 0..1..0 hop arc between two times. */
export const arc = (t: number, [a, b]: readonly [number, number]) => {
  const u = clamp01((t - a) / (b - a))
  return 4 * u * (1 - u)
}

export const EXPRESSION: Record<PetState, Expression> = {
  idle: 'normal',
  walking: 'normal',
  running: 'focused',
  dancing: 'happy',
  jumping: 'wink',
  sleeping: 'sleep',
  waving: 'wink',
  sitting: 'normal',
  spinning: 'happy',
  happy: 'happy',
  surprised: 'surprised',
  falling: 'surprised',
  climbing: 'focused',
  clinging: 'wink',
  stretching: 'yawn',
  exercising: 'focused',
  thinking: 'normal',
  cornering: 'focused',
  floating: 'happy',
  roping: 'wink',
  ropeShoot: 'focused',
  ropeClimb: 'focused',
  chairDance: 'happy',
  watering: 'happy',
  drinking: 'normal',
  eating: 'happy',
  reading: 'normal',
  laptop: 'focused',
  meditating: 'sleep',
  brushing: 'focused',
  eyeRest: 'sleep',
  swimming: 'happy',
  ladder: 'happy',
  fight: 'focused',
  chase: 'happy',
  rescue: 'focused',
  battle: 'focused',
}

function breathe(t: number, period: number, amount: number) {
  const b = Math.sin((TAU * t) / period)
  return { sy: 1 + amount * b, sx: 1 - amount * 0.6 * b }
}

/** Sitting is done by the legs (limbs.ts); the body only settles a touch. */
function sitDown(t: number) {
  const k = easeOut(clamp01(t / 0.7))
  return { y: 0, sy: 1 - 0.02 * k, sx: 1 + 0.01 * k, k }
}

export function pose(state: PetState, t: number, ctx: PoseCtx): Pose {
  let p: Pose = { x: 0, y: 0, rot: 0, sx: 1, sy: 1, shadow: 1 }

  switch (state) {
    case 'idle': {
      const b = breathe(t, 3.2, 0.014)
      p = { ...p, ...b, rot: 1.2 * Math.sin((TAU * t) / 7) }
      if (ctx.fidget >= 0) {
        // Small curious head tilt with a tiny hop.
        const f = Math.sin(Math.PI * ctx.fidget)
        p.rot += 7 * f * Math.sin(TAU * ctx.fidget)
        p.y -= 0.025 * f
      }
      break
    }
    case 'walking':
    case 'running': {
      const run = state === 'running'
      const steps = run ? 3.4 : 1.9 // footsteps per second
      const s = Math.sin(Math.PI * steps * t)
      const contact = 1 - Math.abs(s)
      p.y = -(run ? 0.06 : 0.035) * Math.abs(s)
      p.rot = (run ? 9 : 3) + (run ? 3 : 4.5) * s
      p.sy = 1 - (run ? 0.05 : 0.03) * contact
      p.sx = 1 + (run ? 0.035 : 0.02) * contact
      p.shadow = 1 - 1.5 * -p.y
      break
    }
    case 'dancing': {
      const beat = t * 2 // 120 bpm
      const sway = Math.sin(Math.PI * beat)
      const hop = Math.abs(Math.sin(Math.PI * beat))
      p.x = 0.07 * sway
      p.y = -0.05 * hop
      p.rot = 11 * sway
      p.sy = 1 - 0.05 * (1 - hop)
      p.sx = 1 + 0.035 * (1 - hop)
      p.shadow = 1 - 0.3 * hop
      break
    }
    case 'jumping': {
      if (t < 0.22) {
        const k = easeOut(t / 0.22) // crouch
        p.sy = 1 - 0.16 * k
        p.sx = 1 + 0.11 * k
      } else if (t < 0.8) {
        const u = (t - 0.22) / 0.58 // airborne parabola
        p.y = -0.42 * 4 * u * (1 - u)
        const stretch = 0.1 * Math.max(0, 1 - u * 2.2)
        p.sy = 1 + stretch
        p.sx = 1 - stretch * 0.6
        p.rot = -4 * Math.sin(Math.PI * u)
        p.shadow = 1 + p.y * 1.6
      } else {
        const k = clamp01((t - 0.8) / 0.3) // land squash then recover
        const sq = 0.14 * Math.sin(Math.PI * Math.min(1, k * 1.4)) * (1 - k * 0.4)
        p.sy = 1 - sq
        p.sx = 1 + sq * 0.7
      }
      break
    }
    case 'sitting':
    case 'sleeping': {
      const sit = sitDown(t)
      const sleep = state === 'sleeping'
      const b = breathe(t, sleep ? 4.2 : 3.4, sleep ? 0.02 : 0.012)
      p.y = sit.y
      p.sy = sit.sy * b.sy
      p.sx = sit.sx * b.sx
      p.rot = (sleep ? -6 : -2.5) * sit.k + (sleep ? 1.5 * Math.sin((TAU * t) / 8.4) : 0)
      p.shadow = 1.12
      break
    }
    case 'waving': {
      const k = clamp01(t / 0.25)
      const fade = clamp01((2.6 - t) / 0.4)
      p.rot = 7 * Math.sin(TAU * 1.7 * t) * k * fade
      p.y = -0.03 * Math.abs(Math.sin(TAU * 1.7 * t)) * k * fade
      p.sy = 1 + 0.015 * Math.sin(TAU * 3.4 * t)
      break
    }
    case 'spinning': {
      const e = easeInOut(clamp01(t / 1.2))
      p.y = -0.09 * Math.sin(Math.PI * e)
      p.sy = 1 + 0.04 * Math.sin(Math.PI * e)
      p.shadow = 1 + p.y * 1.5
      break
    }
    case 'happy': {
      const hop = Math.abs(Math.sin((TAU * t) / 1.6) * Math.sin((Math.PI * t) / 0.8))
      p.y = -0.11 * hop
      const squash = 1 - hop
      p.sy = 1 + 0.06 * hop - 0.05 * squash * clamp01(t * 4)
      p.sx = 1 / p.sy
      p.rot = 3 * Math.sin(TAU * t * 1.25)
      p.shadow = 1 + p.y * 1.6
      break
    }
    case 'surprised': {
      const jolt = t < 0.12 ? easeOut(t / 0.12) : Math.exp(-(t - 0.12) * 3.2)
      p.x = -0.07 * jolt
      p.y = -0.05 * jolt
      p.rot = -12 * jolt
      p.sy = 1 + 0.06 * jolt
      p.sx = 1 - 0.04 * jolt
      break
    }
    case 'climbing': {
      const s = Math.sin(Math.PI * 2.4 * t)
      p.y = -0.015 * Math.abs(s)
      p.rot = 6 + 2 * s
      p.shadow = 0
      break
    }
    case 'clinging': {
      p.rot = 4 * Math.sin((TAU * t) / 2.4)
      p.shadow = 0
      break
    }
    case 'stretching': {
      // Rise onto the toes, then lean side to side, then settle.
      const up = Math.sin(Math.PI * clamp01(t / 3.4))
      p.y = -0.03 * up
      p.sy = 1 + 0.06 * up
      p.sx = 1 - 0.03 * up
      p.rot = t > 1.2 && t < 2.8 ? 9 * Math.sin((Math.PI * (t - 1.2)) / 0.8) : 0
      break
    }
    case 'exercising': {
      const hop = Math.abs(Math.sin((Math.PI * t) / 0.42))
      p.y = -0.07 * hop
      p.sy = 1 - 0.05 * (1 - hop)
      p.sx = 1 + 0.03 * (1 - hop)
      p.shadow = 1 + p.y * 1.6
      break
    }
    case 'cornering': {
      p.rot = 10 * Math.sin(Math.PI * clamp01(t / 0.9))
      p.shadow = 0
      break
    }
    case 'ropeShoot': {
      // Brace, then fire the rope straight up.
      const k = clamp01(t / 0.15)
      p.sy = 1 - 0.05 * k + 0.07 * clamp01((t - 0.15) / 0.2)
      p.y = -0.02 * clamp01((t - 0.15) / 0.2)
      break
    }
    case 'ropeClimb': {
      // Being reeled up: slight sway, the rope follows the hand.
      p.rot = 3 * Math.sin(Math.PI * 2.2 * t)
      p.shadow = 0
      break
    }
    case 'reading':
    case 'laptop': {
      const sit = sitDown(t)
      const b = breathe(t, 3.4, 0.01)
      p.sy = sit.sy * b.sy
      p.sx = sit.sx * b.sx
      p.rot = 2
      p.shadow = 1.12
      break
    }
    case 'meditating': {
      // Settle down, then hover a hair above the floor, breathing slowly.
      const k = clamp01((t - 1.2) / 1.5)
      p.y = -0.03 * k - 0.01 * k * Math.sin((TAU * t) / 4)
      const b = breathe(t, 4.5, 0.02)
      p.sy = b.sy
      p.sx = b.sx
      p.shadow = 1 - 0.3 * k
      break
    }
    case 'watering':
    case 'drinking':
    case 'eating':
    case 'brushing':
    case 'eyeRest': {
      const b = breathe(t, 3.2, 0.012)
      p.sy = b.sy
      p.sx = b.sx
      if (state === 'eating') p.y = -0.01 * Math.abs(Math.sin(TAU * t * 2.5)) // chewing bob
      break
    }
    case 'chairDance': {
      const beat = t * 2
      const sit = sitDown(t)
      p.sy = sit.sy * (1 + 0.03 * Math.abs(Math.sin(Math.PI * beat)))
      p.sx = sit.sx
      p.rot = 6 * Math.sin(Math.PI * beat)
      p.shadow = 1.12
      break
    }
    case 'roping': {
      // Swing: the rope is drawn from a fixed anchor to the hand, so it angles with the body.
      const env = Math.min(1, t / 2.5)
      p.rot = (2 + 7 * env) * Math.sin((TAU * t) / 1.9)
      p.shadow = 0
      break
    }
    case 'floating': {
      p.y = -0.03 * Math.sin((TAU * t) / 2.2)
      p.rot = 3 * Math.sin((TAU * t) / 3.1)
      p.shadow = 0
      break
    }
    case 'thinking': {
      p.rot = -2 + 1.5 * Math.sin((TAU * t) / 3)
      break
    }
    case 'swimming': {
      // Hop over the rim, lean into the strokes, bob on the water, hop back out.
      const swim = clamp01((t - SWIM.swim[0]) / 0.5) * clamp01((SWIM.swim[1] - t) / 0.5)
      const wet = t > SWIM.hopIn[1] && t < SWIM.hopOut[0] ? 1 : 0
      // Each sweep lifts Nexo a little out of the water, then it glides back down.
      p.y = -0.22 * arc(t, SWIM.hopIn) - 0.22 * arc(t, SWIM.hopOut) - wet * (0.01 + 0.03 * swimSweep(t) * swim)
      p.rot = 8 * swim + 4 * Math.sin(TAU * t * SWIM.strokes) * swim
      p.shadow = 1.2
      break
    }
    case 'ladder': {
      const { rung } = ladderRung(t)
      p.y = -LADDER.rung * rung
      p.rot = 1.5 * Math.sin(TAU * t * 0.8) * clamp01(rung)
      p.shadow = 1 - 0.18 * rung
      break
    }
    case 'falling': {
      p.sy = 1.06
      p.sx = 0.96
      p.rot = 6 * Math.sin(TAU * t * 3)
      p.shadow = 0.6
      break
    }
  }

  if (ctx.dragRot !== 0) {
    p.rot = ctx.dragRot
    p.sy = 1.05
    p.sx = 0.97
  }
  if (ctx.land >= 0 && ctx.land < 0.35) {
    const k = 1 - ctx.land / 0.35
    const sq = 0.16 * Math.sin(Math.PI * (1 - k)) + 0.1 * k
    p.sy *= 1 - sq
    p.sx *= 1 + sq * 0.7
  }
  p.shadow = p.shadow === 0 ? 0 : Math.max(0.35, Math.min(1.2, p.shadow))
  return p
}
