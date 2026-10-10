import { block, cheer, fall, guard, hook, hurt, jab, jump, mix, run, sitDizzy, spinKick, wave } from '../pet/duo'
import { JointPose, limbs } from '../pet/limbs'
import type { Expression } from '../pet/poses'

// Full-screen battle between Nexo and Bolt, as a pure timeline of t (seconds).
// World units are screen pixels of the work area, y up from its bottom edge.
// An actor stands on a surface: its holder rotates so the feet touch the floor (0),
// the right wall (PI/2), the ceiling (PI) or the left wall (-PI/2).

export interface Actor {
  on: boolean
  x: number
  y: number
  rot: number // holder rotation about the feet
  facing: 1 | -1 // in the actor's own frame (after rot)
  joints: JointPose
  lean: number // degrees toward facing
  sx: number
  sy: number
  expr: Expression
}

export interface Orb {
  who: 'n' | 'b'
  phase: 'charge' | 'fly'
  k: number // charge 0..1, or flight progress 0..1
  to: { x: number; y: number }
}

export interface BattleFrame {
  n: Actor
  b: Actor
  rope: { anchor: { x: number; y: number }; k: number } | null
  orb: Orb | null
  beam: { k: number; clash: { x: number; y: number } } | null
  charge: { who: 'n' | 'b'; k: number }[]
}

export type FxKind = 'tpOut' | 'tpIn' | 'hit' | 'bigHit' | 'boom' | 'land' | 'wall' | 'clash' | 'power'

export interface BattleEvent {
  t: number
  fx?: { kind: FxKind; at: (f: BattleFrame) => { x: number; y: number }; who?: 'n' | 'b' }
  hp?: { who: 'n' | 'b'; amount: number }
  banner?: string
  shake?: number
  flash?: number
}

export interface Setup {
  W: number
  H: number
  S: number // Nexo's height in px
  nx: number // Nexo's starting feet x
  bx: number | null // Bolt's feet x when it is already on screen (later rounds)
  round: number
}

export const BOLT_SCALE = 0.92
/** One round: ends in a draw, with both back on their feet for the next. */
export const ROUND_END = 20.2
export const COLORS = { n: '#5ff0ff', b: '#ff5fd2' }

export const TAU = Math.PI * 2
export const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
export const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k
export const easeInOut = (v: number) => (v < 0.5 ? 4 * v ** 3 : 1 - (-2 * v + 2) ** 3 / 2)
export const easeOut = (v: number) => 1 - (1 - v) ** 3
export const easeIn = (v: number) => v * v
export const bump = (t: number, a: number, b: number) => Math.sin(Math.PI * seg(t, a, b))
const ctx = { fidget: -1, dragging: false }

/** Which way an actor faces on its surface to head along screen direction (dx, dy). */
export const faceTo = (rot: number, dx: number, dy: number): 1 | -1 => (dx * Math.cos(rot) + dy * Math.sin(rot) >= 0 ? 1 : -1)

/** Teleport squash: stretch thin and tall, then gone (out), or the reverse (in). */
export function tp(a: Actor, t: number, out: number | null, inAt: number | null) {
  if (out !== null && t >= out) {
    const k = seg(t, out, out + 0.22)
    a.sx *= 1 - k
    a.sy *= 1 + 2.2 * k
    if (k >= 1) a.on = false
  }
  if (inAt !== null && t < inAt + 0.22) {
    if (t < inAt) a.on = false
    const k = 1 - seg(t, inAt, inAt + 0.22)
    a.sx *= 1 - k
    a.sy *= 1 + 2.2 * k
  }
}

/** Crouched, both arms thrust forward: firing a beam or an orb. */
export function blast(t: number, k: number, oneArm = false): JointPose {
  const j = guard(t)
  j.shR = [-1.5 + 0.1 * Math.sin(TAU * t * 9) * k, 0.1]
  j.elR = [-0.05, 0]
  if (!oneArm) {
    j.shL = [-1.5, -0.1]
    j.elL = [-0.05, 0]
  }
  j.hipL = -0.55 * k
  j.hipR = 0.2 * k
  j.kneeL = 0.8 * k
  j.kneeR = 0.5 * k
  j.drop = -0.12 * k
  j.turn = 0.75
  return j
}

/** One knee and one fist on the ground. */
export function heroLanding(): JointPose {
  const j = guard(0)
  j.hipL = -1.5
  j.kneeL = 1.9
  j.hipR = 0.4
  j.kneeR = 1.1
  j.drop = -0.32
  j.shR = [-0.35, 0.35]
  j.elR = [-0.1, 0]
  j.shL = [0.6, -0.9]
  j.elL = [-0.2, 0]
  j.head = [-0.1, 0, 0]
  j.turn = 0.5
  return j
}

export function uppercut(t: number, k: number): JointPose {
  const j = guard(t)
  j.shR = [-1.2 - 1.7 * k, 0.2]
  j.elR = [-0.6 * (1 - k), 0]
  j.hipL = j.hipR = -0.4 * (1 - k)
  j.kneeL = j.kneeR = 0.8 * (1 - k)
  j.head = [-0.3 * k, 0, 0]
  return j
}

export function makeBattle(s: Setup) {
  const { W, H, S } = s
  const cx = W / 2
  const dir: 1 | -1 = s.nx < cx ? 1 : -1 // Nexo starts on the left when dir = 1
  const inX = (x: number) => Math.min(W - S * 0.7, Math.max(S * 0.7, x))
  const wallX = (side: 1 | -1) => (side > 0 ? W : 0)
  const wallRot = (side: 1 | -1) => (side > 0 ? Math.PI / 2 : -Math.PI / 2)
  const ceilRot = dir > 0 ? Math.PI : -Math.PI

  // Key spots.
  const bStart = s.bx ?? inX(cx + dir * W * 0.28)
  const fresh = s.bx === null // Bolt teleports in only for the first round
  const fightN = cx - dir * 0.42 * S
  const fightB = cx + dir * 0.42 * S
  const L = H * 0.5 // rope length
  const anchor = { x: fightN - dir * 0.1 * S, y: H }
  const swingEnd = 1.2
  const bStop = anchor.x + dir * L * Math.sin(swingEnd)
  const swingEndPos = { x: bStop, y: H - L * Math.cos(swingEnd) }
  const nLand = inX(bStop - dir * 0.95 * S)
  const bBehind = inX(nLand - dir * 0.75 * S)
  const nKnocked = inX(nLand + dir * 0.22 * W)
  const cornerA = { side: dir, y: H * 0.8 }
  const cornerB = { side: (-dir) as 1 | -1, y: H * 0.74 }
  const finN = inX(cx + dir * 0.22 * W)
  const finB = inX(cx - dir * 0.22 * W)
  // The final clash blows both apart toward their own side.
  const blownN = inX(finN + dir * 0.18 * W)
  const blownB = inX(finB - dir * 0.18 * W)

  // Exchange of blows in the flurry: index i swings at 2.4 + 0.32 i.
  const FLURRY = { start: 2.4, beat: 0.32, count: 8 }
  const flurryHit = (i: number) => i % 3 !== 1 // every third blow is blocked

  function base(): Actor {
    return { on: true, x: 0, y: 0, rot: 0, facing: 1, joints: guard(0), lean: 0, sx: 1, sy: 1, expr: 'focused' }
  }

  function flurry(t: number, who: 'n' | 'b', a: Actor) {
    const i = Math.floor((t - FLURRY.start) / FLURRY.beat)
    const u = (t - FLURRY.start) / FLURRY.beat - i
    const attacker = i % 2 === 0 ? 'n' : 'b'
    a.joints = guard(t)
    a.joints.turn = 0.75
    if (i < 0 || i >= FLURRY.count) return 0
    if (attacker === who) {
      const k = Math.sin(Math.PI * clamp01(u * 1.3))
      a.joints = mix(a.joints, i % 4 < 2 ? jab(t) : hook(t), k)
      a.lean = 12 * k
      return 0.12 * S * k
    }
    const k = Math.sin(Math.PI * clamp01((u - 0.3) * 1.4))
    if (flurryHit(i)) {
      a.joints = mix(a.joints, hurt(t), k)
      a.lean = -16 * k
      a.expr = 'surprised'
      return -0.12 * S * k
    }
    a.joints = mix(a.joints, block(t), k)
    return -0.04 * S * k
  }

  // ---------- Nexo ----------
  function nexo(t: number): Actor {
    const a = base()
    a.joints.turn = 0.75
    if (t < 1.6) {
      a.x = s.nx
      a.facing = s.nx < bStart ? 1 : -1
      const startled = fresh && t < 1 // only when Bolt first shows up
      a.joints = startled ? limbs('surprised', Math.min(t, 0.6), ctx) : guard(t)
      a.expr = startled ? 'surprised' : 'focused'
    } else if (t < 2.4) {
      const u = seg(t, 1.6, 2.4)
      a.x = lerp(s.nx, fightN, easeInOut(u))
      a.facing = dir
      a.joints = run(t)
      a.lean = 16
    } else if (t < 5.0) {
      a.facing = dir
      a.x = fightN + dir * flurry(t, 'n', a)
    } else if (t < 5.6) {
      const k = seg(t, 5.0, 5.25)
      a.facing = dir
      a.x = fightN
      a.joints = uppercut(t, k)
      a.y = 0.35 * S * bump(t, 5.15, 5.6)
      a.lean = 8
    } else if (t < 6.1) {
      a.facing = dir
      a.x = fightN
      a.joints = guard(t)
      a.expr = 'wink'
    } else if (t < 6.35) {
      // Shoot the rope up to the ceiling.
      a.facing = dir
      a.x = fightN
      a.joints = limbs('ropeShoot', (t - 6.1) * 1.6, ctx)
    } else if (t < 7.3) {
      // Zip up the rope.
      const u = easeInOut(seg(t, 6.35, 7.3))
      a.facing = dir
      a.x = lerp(fightN, anchor.x, u)
      a.y = lerp(0, H - L, u)
      a.joints = limbs('ropeClimb', t, ctx)
      a.joints.tilt = 0
    } else if (t < 8.45) {
      // Swing back, then forward into a flying kick at Bolt on the ceiling.
      const back = -0.8 * easeOut(seg(t, 7.3, 7.6))
      const fwd = lerp(-0.8, swingEnd, easeInOut(seg(t, 7.6, 8.3)))
      const th = dir * (t < 7.6 ? back : fwd)
      a.x = anchor.x + L * Math.sin(th)
      a.y = H - L * Math.cos(th)
      a.rot = th
      a.facing = dir
      a.joints = limbs('roping', t, ctx)
      a.joints.tilt = 0
      const kick = bump(t, 8.1, 8.45)
      a.joints.hipL = lerp(a.joints.hipL, -1.6, kick)
      a.joints.kneeL = lerp(a.joints.kneeL, 0.05, kick)
      a.expr = kick > 0.2 ? 'focused' : 'happy'
    } else if (t < 9.2) {
      // Let go, flip, drop.
      const u = seg(t, 8.45, 9.2)
      const e = easeInOut(u)
      a.x = lerp(swingEndPos.x, nLand, e)
      a.y = swingEndPos.y * (1 - easeIn(u)) + 0.08 * H * Math.sin(Math.PI * u)
      a.rot = lerp(dir * swingEnd, -dir * TAU, e)
      a.facing = dir
      a.joints = jump(0.5)
    } else if (t < 10.5) {
      a.x = nLand
      a.facing = dir
      a.joints = t < 9.8 ? heroLanding() : guard(t)
      a.expr = 'focused'
    } else if (t < 11.4) {
      // Kicked from behind: flies forward, rolls.
      const u = seg(t, 10.5, 11.1)
      a.x = lerp(nLand, nKnocked, easeOut(u))
      a.y = 0.25 * H * 4 * u * (1 - u)
      a.rot = -dir * TAU * easeOut(seg(t, 10.5, 11.4))
      a.facing = dir
      a.joints = hurt(t)
      a.expr = 'surprised'
    } else if (t < 11.7) {
      a.x = nKnocked
      a.facing = (-dir) as 1 | -1
      a.joints = guard(t)
      tp(a, t, 11.5, null)
    } else if (t < 14.6) {
      // Teleported to a high corner, standing on the wall: charge and fire an orb.
      a.x = wallX(cornerA.side)
      a.y = cornerA.y
      a.rot = wallRot(cornerA.side)
      a.facing = faceTo(a.rot, 0, -1)
      const k = seg(t, 11.9, 12.5)
      a.joints = t < 12.6 ? blast(t, k, true) : guard(t)
      a.expr = t > 13 && t < 13.4 ? 'wink' : 'focused'
      tp(a, t, 14.3, 11.7)
    } else if (t < 15.5) {
      a.x = finN
      a.facing = (-dir) as 1 | -1
      a.joints = guard(t)
      tp(a, t, null, 14.6)
    } else if (t < 18.6) {
      // Beam clash.
      a.x = finN
      a.facing = (-dir) as 1 | -1
      const k = seg(t, 15.5, 16.3)
      a.joints = blast(t, k)
      a.lean = 6 * k
      a.x += dir * 0.05 * S * bump(t, 17.0, 17.7) // pushed back for a moment
      a.expr = t > 17.6 && t < 18.4 ? 'yawn' : 'focused' // battle cry
    } else if (t < 19.1) {
      const u = seg(t, 18.6, 19.1)
      a.x = lerp(finN, blownN, easeOut(u))
      a.y = 0.15 * H * 4 * u * (1 - u)
      a.rot = dir * TAU * easeOut(u)
      a.facing = (-dir) as 1 | -1
      a.joints = hurt(t)
      a.expr = 'surprised'
    } else {
      a.x = blownN
      a.facing = (-dir) as 1 | -1
      a.joints = t < 19.6 ? heroLanding() : mix(guard(t), cheer(t), 0.3 * bump(t, 19.6, 20.2))
      a.expr = t < 19.6 ? 'focused' : 'wink'
    }
    return a
  }

  // ---------- Bolt ----------
  function bolt(t: number): Actor {
    const a = base()
    a.joints.turn = 0.75
    a.facing = (-dir) as 1 | -1
    if (t < 1.6) {
      a.x = bStart
      a.joints = t < 1.1 ? limbs('waving', t, ctx) : guard(t)
      a.expr = 'wink'
      if (fresh) tp(a, t, null, 0.5)
    } else if (t < 2.4) {
      a.x = lerp(bStart, fightB, easeInOut(seg(t, 1.6, 2.4)))
      a.joints = run(t)
      a.lean = 16
    } else if (t < 5.25) {
      a.x = fightB - dir * flurry(t, 'b', a)
      if (t > 5.0) {
        a.joints = hurt(t)
        a.expr = 'surprised'
      }
    } else if (t < 6.0) {
      // Uppercut: launched into the wall.
      const u = seg(t, 5.25, 6.0)
      const e = easeOut(u)
      a.x = lerp(fightB, wallX(dir), e)
      a.y = lerp(0, H * 0.45, e) + 0.18 * H * Math.sin(Math.PI * u)
      a.rot = lerp(-dir * TAU * 1.5, wallRot(dir), e)
      a.joints = hurt(t)
      a.expr = 'surprised'
    } else if (t < 7.0) {
      // Shakes it off and runs up the wall.
      a.x = wallX(dir)
      a.rot = wallRot(dir)
      const u = seg(t, 6.4, 7.0)
      a.y = lerp(H * 0.45, H, u)
      a.facing = faceTo(a.rot, 0, 1)
      a.joints = t < 6.4 ? hurt(t) : run(t)
      a.lean = t < 6.4 ? 0 : 14
    } else if (t < 7.3) {
      // Round the top corner onto the ceiling.
      const u = easeInOut(seg(t, 7.0, 7.3))
      a.x = lerp(wallX(dir), wallX(dir) - dir * 0.3 * S, u)
      a.y = H
      a.rot = lerp(wallRot(dir), ceilRot, u)
      a.facing = faceTo(a.rot, -dir, 0)
      a.joints = run(t)
    } else if (t < 8.3) {
      a.x = lerp(wallX(dir) - dir * 0.3 * S, bStop, easeInOut(seg(t, 7.3, 7.9)))
      a.y = H
      a.rot = ceilRot
      a.facing = faceTo(a.rot, -dir, 0)
      a.joints = t < 7.9 ? run(t) : wave(t)
      a.expr = t < 7.9 ? 'focused' : 'wink'
    } else if (t < 9.0) {
      // Kicked off the ceiling.
      const u = seg(t, 8.3, 9.0)
      a.x = bStop
      a.y = H * (1 - easeIn(u))
      a.rot = ceilRot * (1 - easeInOut(u))
      a.joints = fall(t)
      a.expr = 'surprised'
    } else if (t < 9.9) {
      a.x = bStop
      a.joints = t < 9.5 ? sitDizzy(t) : guard(t)
      a.expr = t < 9.5 ? 'sleep' : 'focused'
      tp(a, t, 9.9, null)
    } else if (t < 11.6) {
      // Teleports behind Nexo and spin-kicks it.
      a.x = bBehind
      a.facing = dir
      a.joints = t < 10.3 ? guard(t) : spinKick(t, seg(t, 10.3, 10.75))
      a.expr = 'wink'
      tp(a, t, 12.9, 10.15)
    } else if (t < 13.2) {
      a.x = bBehind
      a.facing = dir
      a.joints = guard(t)
      a.expr = t > 12.5 ? 'surprised' : 'focused'
      tp(a, t, 12.9, null)
    } else if (t < 14.6) {
      a.x = wallX(cornerB.side)
      a.y = cornerB.y
      a.rot = wallRot(cornerB.side)
      a.facing = faceTo(a.rot, 0, -1)
      const k = seg(t, 13.35, 13.9)
      a.joints = t < 14.0 ? blast(t, k, true) : guard(t)
      tp(a, t, null, 13.2)
    } else if (t < 15.3) {
      // Leap down from the corner to face Nexo.
      const u = seg(t, 14.6, 15.3)
      a.x = lerp(wallX(cornerB.side), finB, easeOut(u))
      a.y = cornerB.y * (1 - easeIn(u)) + 0.1 * H * Math.sin(Math.PI * u)
      a.rot = wallRot(cornerB.side) * (1 - easeInOut(u))
      a.facing = dir
      a.joints = jump(0.5)
    } else if (t < 18.4) {
      a.x = finB
      a.facing = dir
      const k = seg(t, 15.5, 16.3)
      a.joints = blast(t, k)
      a.lean = 6 * k
      a.x -= dir * 0.04 * S * bump(t, 17.9, 18.4)
    } else if (t < 19.1) {
      // Draw: the clash blows up between them and throws both back.
      const u = seg(t, 18.6, 19.1)
      a.x = lerp(finB, blownB, easeOut(u))
      a.y = 0.15 * H * 4 * u * (1 - u)
      a.rot = -dir * TAU * easeOut(u)
      a.facing = dir
      a.joints = hurt(t)
      a.expr = 'surprised'
    } else {
      a.x = blownB
      a.facing = dir
      a.joints = t < 19.7 ? sitDizzy(t) : guard(t)
      a.expr = t < 19.7 ? 'sleep' : 'focused'
    }
    return a
  }

  function frame(t: number): BattleFrame {
    const n = nexo(t)
    const b = bolt(t)
    const f: BattleFrame = { n, b, rope: null, orb: null, beam: null, charge: [] }
    if (t >= 6.2 && t < 8.45) f.rope = { anchor, k: easeOut(seg(t, 6.2, 6.4)) }
    if (t >= 11.9 && t < 12.5) f.orb = { who: 'n', phase: 'charge', k: seg(t, 11.9, 12.5), to: { x: 0, y: 0 } }
    if (t >= 12.5 && t < 13.05) f.orb = { who: 'n', phase: 'fly', k: seg(t, 12.5, 13.05), to: { x: bBehind, y: 0.3 * S } }
    if (t >= 13.35 && t < 13.9) f.orb = { who: 'b', phase: 'charge', k: seg(t, 13.35, 13.9), to: { x: 0, y: 0 } }
    if (t >= 13.9 && t < 14.45) f.orb = { who: 'b', phase: 'fly', k: seg(t, 13.9, 14.45), to: { x: wallX(cornerA.side) - cornerA.side * 0.35 * S, y: cornerA.y } }
    if (t >= 15.5 && t < 18.6) {
      f.charge.push({ who: 'n', k: seg(t, 15.5, 16.3) * (t > 17.6 ? 1.8 : 1) }, { who: 'b', k: seg(t, 15.5, 16.3) })
    }
    if (t >= 16.3 && t < 18.6) {
      // Clash point: wobbles, Bolt gains, then Nexo powers up and drives it home.
      const mid = (finN + finB) / 2
      let x = mid + Math.sin(TAU * 1.4 * (t - 16.5)) * 0.03 * W * seg(t, 16.5, 16.9)
      x += dir * 0.12 * W * bump(t, 16.9, 17.9) * 0.8
      x -= dir * 0.1 * W * bump(t, 17.9, 18.6) * 0.8 // Nexo pushes back: even again
      f.beam = { k: easeOut(seg(t, 16.3, 16.55)), clash: { x, y: 0.5 * S } }
    }
    return f
  }

  const at = (who: 'n' | 'b', dy = 0.5) => (f: BattleFrame) => ({ x: f[who].x, y: f[who].y + S * dy })
  const events: BattleEvent[] = [
    ...(fresh ? [{ t: 0.5, fx: { kind: 'tpIn' as const, at: at('b', 0), who: 'b' as const } }] : []),
    { t: 2.4, fx: { kind: 'clash', at: () => ({ x: cx, y: 0.55 * S }) }, shake: 7, flash: 0.25 },
    ...Array.from({ length: FLURRY.count }, (_, i): BattleEvent => {
      const hit = flurryHit(i)
      const by = i % 2 === 0 ? 'n' : 'b'
      return {
        t: FLURRY.start + FLURRY.beat * (i + 0.45),
        fx: { kind: 'hit', at: () => ({ x: cx + (by === 'n' ? dir : -dir) * 0.1 * S, y: (i % 4 < 2 ? 0.62 : 0.72) * S }) },
        hp: { who: by === 'n' ? 'b' : 'n', amount: hit ? 5 : 1 },
        shake: hit ? 4 : 2,
      }
    }),
    { t: 5.22, fx: { kind: 'bigHit', at: () => ({ x: fightN + dir * 0.45 * S, y: 0.8 * S }) }, hp: { who: 'b', amount: 12 }, shake: 11, flash: 0.3 },
    { t: 6.0, fx: { kind: 'wall', at: () => ({ x: wallX(dir), y: H * 0.45 }) }, hp: { who: 'b', amount: 5 }, shake: 9 },
    { t: 6.25, fx: { kind: 'power', at: at('n', 0.9), who: 'n' } },
    { t: 8.3, fx: { kind: 'bigHit', at: () => ({ x: bStop, y: H - 0.45 * S }) }, hp: { who: 'b', amount: 14 }, shake: 12, flash: 0.35 },
    { t: 9.0, fx: { kind: 'land', at: at('b', 0) }, hp: { who: 'b', amount: 6 }, shake: 13 },
    { t: 9.2, fx: { kind: 'land', at: at('n', 0) }, shake: 9 },
    { t: 9.9, fx: { kind: 'tpOut', at: at('b'), who: 'b' } },
    { t: 10.15, fx: { kind: 'tpIn', at: at('b', 0), who: 'b' } },
    { t: 10.5, fx: { kind: 'bigHit', at: () => ({ x: nLand - dir * 0.3 * S, y: 0.6 * S }) }, hp: { who: 'n', amount: 12 }, shake: 10, flash: 0.25 },
    { t: 11.5, fx: { kind: 'tpOut', at: at('n'), who: 'n' } },
    { t: 11.7, fx: { kind: 'tpIn', at: (f) => ({ x: f.n.x, y: f.n.y }), who: 'n' } },
    { t: 12.9, fx: { kind: 'tpOut', at: at('b'), who: 'b' } },
    { t: 13.05, fx: { kind: 'boom', at: () => ({ x: bBehind, y: 0.3 * S }) }, shake: 15, flash: 0.45 },
    { t: 13.2, fx: { kind: 'tpIn', at: (f) => ({ x: f.b.x, y: f.b.y }), who: 'b' } },
    { t: 14.3, fx: { kind: 'tpOut', at: (f) => ({ x: f.n.x - cornerA.side * 0.4 * S, y: f.n.y }), who: 'n' } },
    { t: 14.45, fx: { kind: 'boom', at: () => ({ x: wallX(cornerA.side) - cornerA.side * 0.3 * S, y: cornerA.y }) }, shake: 12, flash: 0.35 },
    { t: 14.6, fx: { kind: 'tpIn', at: at('n', 0), who: 'n' } },
    { t: 15.3, fx: { kind: 'land', at: at('b', 0) }, shake: 8 },
    { t: 16.3, shake: 6, flash: 0.2 },
    { t: 17.6, fx: { kind: 'power', at: at('n', 0.6), who: 'n' }, shake: 8, flash: 0.2 },
    { t: 18.6, fx: { kind: 'boom', at: (f) => (f.beam ? f.beam.clash : { x: cx, y: 0.5 * S }) }, hp: { who: 'b', amount: 15 }, shake: 20, flash: 0.6 },
    { t: 18.6, hp: { who: 'n', amount: 15 } },
    { t: 19.1, fx: { kind: 'land', at: at('n', 0) }, shake: 7 },
    { t: 19.1, fx: { kind: 'land', at: at('b', 0) } },
  ]
  events.sort((p, q) => p.t - q.t)

  return { frame, events, endN: blownN, endB: blownB }
}
