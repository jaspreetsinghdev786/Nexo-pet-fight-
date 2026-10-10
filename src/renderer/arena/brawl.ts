import { block, cheer, guard, hook, hurt, jab, jump, mix, run, sitDizzy, spinKick, wave } from '../pet/duo'
import { Actor, BattleEvent, BattleFrame, blast, bump, easeIn, easeInOut, easeOut, faceTo, heroLanding, lerp, seg, Setup, TAU, tp, uppercut } from './battle'

// The second round script, played in turn with the one in battle.ts and just as long (ROUND_END).
// Same rules: a pure timeline of t, world units are pixels of the battlefield, y up from the floor.
//   dash clash -> uppercut, air kick into the far wall -> dive slam (dodged) -> orb barrage
//   -> orb from the ceiling -> teleport exchange all over the screens -> cross dash, both down.

export function makeBrawl(s: Setup) {
  const { W, H, S } = s
  const cx = W / 2
  const dir: 1 | -1 = s.nx < cx ? 1 : -1 // Nexo starts on the left when dir = 1
  const back = (-dir) as 1 | -1
  const inX = (x: number) => Math.min(W - S * 0.7, Math.max(S * 0.7, x))
  const wallX = (side: 1 | -1) => (side > 0 ? W : 0)
  const wallRot = (side: 1 | -1) => (side > 0 ? Math.PI / 2 : -Math.PI / 2)
  const ceilRot = dir > 0 ? Math.PI : -Math.PI

  // Key spots.
  const bStart = s.bx ?? inX(cx + dir * W * 0.28)
  const fN = cx - dir * 0.42 * S
  const fB = cx + dir * 0.42 * S
  const rN = fN - dir * 0.5 * S // thrown back by the clash
  const rB = fB + dir * 0.5 * S
  const nUp = rB - dir * 0.85 * S // Nexo right under Bolt's chin
  const airY = 0.55 * H
  const nFar = inX(nUp - dir * 0.3 * W)
  const bBlown = inX(nUp + dir * 0.6 * S + dir * 0.22 * W)
  const nW = inX(wallX(back))
  const eN = inX(cx - dir * 0.3 * W)
  const eB = inX(cx + dir * 0.3 * W)
  // The cross dash carries each past the other: they end the round on swapped sides.
  const xN2 = inX(cx + dir * 0.12 * W)
  const xB2 = inX(cx - dir * 0.12 * W)

  // Orb barrage: orb i charges at start + beat i, flies, and lands 0.9 s later.
  const ORB = { start: 6.8, beat: 0.95, charge: 0.45, count: 3 }
  const impact = (i: number) => ORB.start + ORB.beat * i + 0.9
  const orbTarget = (i: number) => ({ x: nUp + dir * 0.3 * S * i, y: 0.5 * S })

  // Teleport exchange: both blink in at a spot, trade one blow, blink out.
  const TP = { start: 14.4, beat: 0.6, end: 16.68 }
  const SPOTS = [
    { x: inX(W * 0.2), y: 0 },
    { x: inX(W * 0.75), y: 0.45 * H },
    { x: inX(W * 0.45), y: 0 },
    { x: inX(W * 0.62), y: 0.3 * H },
  ]

  function base(): Actor {
    return { on: true, x: 0, y: 0, rot: 0, facing: 1, joints: guard(0), lean: 0, sx: 1, sy: 1, expr: 'focused' }
  }

  function exchange(t: number, who: 'n' | 'b', a: Actor) {
    const i = Math.floor((t - (TP.start - 0.12)) / TP.beat)
    if (i < 0 || i >= SPOTS.length) {
      a.on = false
      return
    }
    const T = TP.start + TP.beat * i
    const side = who === 'n' ? back : dir
    const k = bump(t, T, T + 0.24)
    a.x = SPOTS[i].x + side * 0.4 * S
    a.y = SPOTS[i].y
    a.facing = (-side) as 1 | -1
    if ((i % 2 === 0 ? 'n' : 'b') === who) {
      a.joints = i < 2 ? mix(guard(t), i ? hook(t) : jab(t), k) : spinKick(t, seg(t, T, T + 0.2))
      a.lean = 14 * k
    } else {
      a.joints = mix(guard(t), hurt(t), k)
      a.lean = -16 * k
      a.x += side * 0.15 * S * k
      a.expr = 'surprised'
    }
    tp(a, t, T + 0.24, T - 0.12)
  }

  /** Gathering power before the last dash. */
  function crouch(t: number): Actor['joints'] {
    return mix(guard(t), heroLanding(), 0.5 * seg(t, 16.9, 17.6))
  }

  // ---------- Nexo ----------
  function nexo(t: number): Actor {
    const a = base()
    a.joints.turn = 0.75
    a.facing = dir
    if (t < 0.8) {
      a.x = s.nx
      a.facing = s.nx < bStart ? 1 : -1
      a.joints = guard(t)
      a.expr = 'wink'
    } else if (t < 1.6) {
      // Both charge in and meet in the middle.
      a.x = lerp(s.nx, fN, easeIn(seg(t, 0.8, 1.6)))
      a.joints = run(t)
      a.lean = 22
    } else if (t < 2.0) {
      const u = seg(t, 1.6, 2.0)
      a.x = lerp(fN, rN, easeOut(u))
      a.joints = mix(guard(t), hurt(t), 1 - u)
    } else if (t < 2.5) {
      a.x = lerp(rN, nUp, easeInOut(seg(t, 2.0, 2.5)))
      a.joints = run(t)
      a.lean = 16
    } else if (t < 2.9) {
      a.x = nUp
      a.joints = uppercut(t, seg(t, 2.5, 2.75))
      a.y = 0.2 * S * bump(t, 2.65, 2.9)
    } else if (t < 3.5) {
      // Leaps after the launched Bolt.
      a.x = nUp
      a.y = lerp(0, airY - 0.1 * S, easeOut(seg(t, 2.9, 3.5)))
      a.joints = jump(0.5)
    } else if (t < 3.9) {
      a.x = nUp
      a.y = airY - 0.1 * S
      a.joints = spinKick(t, seg(t, 3.5, 3.85))
    } else if (t < 4.5) {
      a.x = nUp
      a.y = (airY - 0.1 * S) * (1 - easeIn(seg(t, 3.9, 4.5)))
      a.joints = jump(0.5)
    } else if (t < 5.0) {
      a.x = nUp
      a.joints = heroLanding()
    } else if (t < 6.6) {
      // Bolt is gone from the wall... and dropping from above. Blink away just in time.
      a.x = nUp
      a.joints = guard(t)
      a.expr = t > 5.6 ? 'surprised' : 'focused'
      tp(a, t, 6.2, null)
    } else if (t < ORB.start) {
      a.x = nFar
      a.joints = guard(t)
      tp(a, t, null, 6.6)
    } else if (t < 9.65) {
      // Three orbs in a row from a safe distance.
      const u = (t - ORB.start) % ORB.beat
      a.x = nFar
      a.joints = blast(t, seg(u, 0, ORB.charge) * (1 - seg(u, 0.6, 0.9)), true)
    } else if (t < 11.2) {
      a.x = nFar
      a.joints = mix(guard(t), cheer(t), bump(t, 9.8, 11.0))
      a.expr = 'happy'
    } else if (t < 12.45) {
      // Where did Bolt go? Looks left and right.
      a.x = nFar
      a.facing = Math.sin(t * 9) > 0 ? 1 : -1
      a.joints = guard(t)
      a.expr = 'surprised'
    } else if (t < 13.1) {
      // Blasted from above into its own wall.
      const u = seg(t, 12.45, 13.1)
      a.x = lerp(nFar, wallX(back), easeOut(u))
      a.y = lerp(0, 0.4 * H, easeOut(u)) + 0.1 * H * Math.sin(Math.PI * u)
      a.rot = lerp(dir * TAU, wallRot(back), easeOut(u))
      a.joints = hurt(t)
      a.expr = 'surprised'
    } else if (t < 13.6) {
      const u = seg(t, 13.1, 13.6)
      a.x = lerp(wallX(back), nW, easeOut(u))
      a.y = 0.4 * H * (1 - easeIn(u))
      a.rot = wallRot(back) * (1 - easeInOut(u))
      a.joints = jump(0.5)
    } else if (t < TP.start - 0.12) {
      a.x = nW
      a.joints = heroLanding()
      tp(a, t, 14.05, null)
    } else if (t < TP.end) {
      exchange(t, 'n', a)
    } else if (t < 17.9) {
      a.x = eN
      a.joints = crouch(t)
      tp(a, t, null, 16.7)
    } else if (t < 18.25) {
      a.x = lerp(eN, xN2, easeInOut(seg(t, 17.9, 18.25)))
      a.joints = jab(t)
      a.lean = 24
    } else if (t < 19.0) {
      // Both hold the pose, back to back.
      a.x = xN2
      a.joints = heroLanding()
    } else if (t < 19.7) {
      a.x = xN2
      a.joints = sitDizzy(t)
      a.expr = 'sleep'
    } else {
      a.x = xN2
      a.facing = back
      a.joints = mix(guard(t), cheer(t), 0.3 * bump(t, 19.7, 20.2))
      a.expr = 'wink'
    }
    return a
  }

  // ---------- Bolt ----------
  function bolt(t: number): Actor {
    const a = base()
    a.joints.turn = 0.75
    a.facing = back
    if (t < 0.8) {
      a.x = bStart
      a.facing = bStart < s.nx ? 1 : -1
      a.joints = wave(t)
      a.expr = 'wink'
    } else if (t < 1.6) {
      a.x = lerp(bStart, fB, easeIn(seg(t, 0.8, 1.6)))
      a.joints = run(t)
      a.lean = 22
    } else if (t < 2.0) {
      const u = seg(t, 1.6, 2.0)
      a.x = lerp(fB, rB, easeOut(u))
      a.joints = mix(guard(t), hurt(t), 1 - u)
    } else if (t < 2.72) {
      a.x = rB
      a.joints = guard(t)
      a.expr = t > 2.55 ? 'surprised' : 'focused'
    } else if (t < 3.7) {
      // Uppercut: launched straight up, tumbling.
      const u = easeOut(seg(t, 2.72, 3.3))
      a.x = rB
      a.y = airY * u
      a.rot = back * TAU * u
      a.joints = hurt(t)
      a.expr = 'surprised'
    } else if (t < 4.5) {
      // Kicked out of the air: all the way across to the far wall.
      const u = seg(t, 3.7, 4.5)
      a.x = lerp(rB, wallX(dir), easeOut(u))
      a.y = lerp(airY, 0.5 * H, u) + 0.08 * H * Math.sin(Math.PI * u)
      a.rot = lerp(back * TAU, wallRot(dir), easeOut(u))
      a.joints = hurt(t)
      a.expr = 'surprised'
    } else if (t < 5.8) {
      a.x = wallX(dir)
      a.y = 0.5 * H
      a.rot = wallRot(dir)
      a.facing = faceTo(a.rot, 0, -1)
      a.joints = t < 5.0 ? hurt(t) : guard(t)
      tp(a, t, 5.4, null)
    } else if (t < 6.5) {
      // Blinks in high above Nexo and dives.
      a.x = nUp
      a.y = 0.8 * H * (1 - easeIn(seg(t, 5.8, 6.5)))
      a.joints = jump(0.5)
      tp(a, t, null, 5.8)
    } else if (t < 7.1) {
      a.x = nUp
      a.joints = heroLanding()
    } else if (t < impact(2)) {
      // Blocks the first two orbs, sliding back a step each time.
      a.x = nUp + dir * 0.3 * S * (easeOut(seg(t, impact(0), impact(0) + 0.25)) + easeOut(seg(t, impact(1), impact(1) + 0.25)))
      const k = Math.max(bump(t, impact(0) - 0.15, impact(0) + 0.3), bump(t, impact(1) - 0.15, impact(1) + 0.3))
      a.joints = mix(guard(t), block(t), k)
    } else if (t < 10.4) {
      // The third one gets through.
      const u = seg(t, impact(2), 10.4)
      a.x = lerp(nUp + dir * 0.6 * S, bBlown, easeOut(u))
      a.y = 0.22 * H * 4 * u * (1 - u)
      a.rot = dir * TAU * easeOut(u)
      a.joints = hurt(t)
      a.expr = 'surprised'
    } else if (t < 11.4) {
      a.x = bBlown
      a.joints = t < 10.9 ? sitDizzy(t) : guard(t)
      a.expr = t < 10.9 ? 'sleep' : 'focused'
      tp(a, t, 11.0, null)
    } else if (t < 13.3) {
      // Standing on the ceiling right above Nexo: an orb straight down.
      a.x = nFar
      a.y = H
      a.rot = ceilRot
      a.facing = faceTo(a.rot, dir, 0)
      a.joints = t < 12.05 ? blast(t, seg(t, 11.5, 12.0), true) : wave(t)
      a.expr = t < 12.45 ? 'focused' : 'wink'
      tp(a, t, null, 11.4)
    } else if (t < 14.0) {
      const u = seg(t, 13.3, 14.0)
      a.x = nFar
      a.y = H * (1 - easeIn(u))
      a.rot = ceilRot * (1 - easeInOut(u))
      a.joints = jump(0.5)
    } else if (t < TP.start - 0.12) {
      a.x = nFar
      a.joints = guard(t)
      tp(a, t, 14.05, null)
    } else if (t < TP.end) {
      exchange(t, 'b', a)
    } else if (t < 17.9) {
      a.x = eB
      a.joints = crouch(t)
      tp(a, t, null, 16.7)
    } else if (t < 18.25) {
      a.x = lerp(eB, xB2, easeInOut(seg(t, 17.9, 18.25)))
      a.joints = jab(t)
      a.lean = 24
    } else if (t < 19.0) {
      a.x = xB2
      a.joints = heroLanding()
    } else if (t < 19.7) {
      a.x = xB2
      a.joints = sitDizzy(t)
      a.expr = 'sleep'
    } else {
      a.x = xB2
      a.facing = dir
      a.joints = guard(t)
    }
    return a
  }

  function frame(t: number): BattleFrame {
    const f: BattleFrame = { n: nexo(t), b: bolt(t), rope: null, orb: null, beam: null, charge: [] }
    for (let i = 0; i < ORB.count; i++) {
      const c = ORB.start + ORB.beat * i
      if (t >= c && t < c + ORB.charge) f.orb = { who: 'n', phase: 'charge', k: seg(t, c, c + ORB.charge), to: { x: 0, y: 0 } }
      if (t >= c + ORB.charge && t < impact(i)) f.orb = { who: 'n', phase: 'fly', k: seg(t, c + ORB.charge, impact(i)), to: orbTarget(i) }
    }
    if (t >= 11.5 && t < 12.0) f.orb = { who: 'b', phase: 'charge', k: seg(t, 11.5, 12.0), to: { x: 0, y: 0 } }
    if (t >= 12.0 && t < 12.45) f.orb = { who: 'b', phase: 'fly', k: seg(t, 12.0, 12.45), to: { x: nFar, y: 0.4 * S } }
    if (t >= 16.9 && t < 17.9) f.charge.push({ who: 'n', k: seg(t, 16.9, 17.6) }, { who: 'b', k: seg(t, 16.9, 17.6) })
    return f
  }

  const at = (who: 'n' | 'b', dy = 0.5) => (f: BattleFrame) => ({ x: f[who].x, y: f[who].y + S * dy })
  const both = (t: number, kind: 'tpIn' | 'tpOut' | 'land' | 'power', dy: number): BattleEvent[] =>
    (['n', 'b'] as const).map((who) => ({ t, fx: { kind, at: at(who, dy), who } }))
  const events: BattleEvent[] = [
    { t: 1.6, fx: { kind: 'clash', at: () => ({ x: cx, y: 0.55 * S }) }, shake: 9, flash: 0.3 },
    { t: 2.72, fx: { kind: 'bigHit', at: () => ({ x: rB - dir * 0.3 * S, y: 0.8 * S }) }, hp: { who: 'b', amount: 10 }, shake: 10, flash: 0.25 },
    { t: 3.7, fx: { kind: 'bigHit', at: at('b') }, hp: { who: 'b', amount: 12 }, shake: 12, flash: 0.35 },
    { t: 4.5, fx: { kind: 'wall', at: () => ({ x: wallX(dir), y: 0.5 * H }) }, hp: { who: 'b', amount: 5 }, shake: 10 },
    { t: 4.5, fx: { kind: 'land', at: at('n', 0) } },
    { t: 5.4, fx: { kind: 'tpOut', at: (f) => ({ x: f.b.x - dir * 0.4 * S, y: f.b.y }), who: 'b' } },
    { t: 5.8, fx: { kind: 'tpIn', at: at('b', 0), who: 'b' } },
    { t: 6.2, fx: { kind: 'tpOut', at: at('n'), who: 'n' } },
    { t: 6.5, fx: { kind: 'land', at: at('b', 0) }, shake: 14, flash: 0.3 },
    { t: 6.6, fx: { kind: 'tpIn', at: at('n', 0), who: 'n' } },
    { t: impact(0), fx: { kind: 'hit', at: () => orbTarget(0) }, hp: { who: 'b', amount: 2 }, shake: 5 },
    { t: impact(1), fx: { kind: 'hit', at: () => orbTarget(1) }, hp: { who: 'b', amount: 2 }, shake: 5 },
    { t: impact(2), fx: { kind: 'boom', at: () => orbTarget(2) }, hp: { who: 'b', amount: 14 }, shake: 15, flash: 0.45 },
    { t: 10.4, fx: { kind: 'land', at: at('b', 0) }, shake: 8 },
    { t: 11.0, fx: { kind: 'tpOut', at: at('b'), who: 'b' } },
    { t: 11.4, fx: { kind: 'tpIn', at: (f) => ({ x: f.b.x, y: f.b.y - 0.8 * S }), who: 'b' } },
    { t: 12.45, fx: { kind: 'boom', at: () => ({ x: nFar, y: 0.4 * S }) }, hp: { who: 'n', amount: 14 }, shake: 15, flash: 0.45 },
    { t: 13.1, fx: { kind: 'wall', at: () => ({ x: wallX(back), y: 0.4 * H }) }, hp: { who: 'n', amount: 5 }, shake: 9 },
    { t: 13.6, fx: { kind: 'land', at: at('n', 0) }, shake: 7 },
    { t: 14.0, fx: { kind: 'land', at: at('b', 0) }, shake: 7 },
    ...both(14.05, 'tpOut', 0.5),
    ...SPOTS.flatMap((p, i): BattleEvent[] => {
      const T = TP.start + TP.beat * i
      return [
        ...both(T - 0.12, 'tpIn', 0),
        {
          t: T + 0.14,
          fx: { kind: i < 2 ? 'hit' : 'bigHit', at: () => ({ x: p.x, y: p.y + 0.6 * S }) },
          hp: { who: i % 2 === 0 ? 'b' : 'n', amount: 6 },
          shake: i < 2 ? 6 : 10,
          flash: 0.15,
        },
      ]
    }),
    ...both(16.7, 'tpIn', 0),
    ...both(16.95, 'power', 0.6),
    { t: 18.08, fx: { kind: 'clash', at: () => ({ x: cx, y: 0.55 * S }) }, hp: { who: 'b', amount: 15 }, shake: 18, flash: 0.6 },
    { t: 18.08, fx: { kind: 'bigHit', at: () => ({ x: cx, y: 0.55 * S }) }, hp: { who: 'n', amount: 15 } },
    ...both(19.0, 'land', 0),
  ]
  events.sort((p, q) => p.t - q.t)

  return { frame, events, endN: xN2, endB: xB2 }
}
