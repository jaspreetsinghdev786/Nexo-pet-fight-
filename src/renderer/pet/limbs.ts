import type { PetState } from '../../../electron/shared'
import { ladderRung, LADDER, SWIM, swimSweep } from './poses'

// Joint angles (radians) for every state. The renderer eases toward these each frame,
// which is what makes transitions between states smooth.
// Conventions (model faces +z):
//   hip/knee/shoulder/elbow .x: negative swings the limb forward
//   shoulder .z: left arm raises with negative z, right arm with positive z
//   head [x, y, z]: x positive nods forward

export interface JointPose {
  hipL: number
  hipR: number
  kneeL: number
  kneeR: number
  spread: number // legs apart sideways (jumping jacks)
  shL: [number, number]
  shR: [number, number]
  elL: [number, number]
  elR: [number, number]
  head: [number, number, number]
  drop: number // lower the body (sitting), in model units
  tilt: number // extra screen-plane lean (radians, counter-clockwise), e.g. hanging from one hand
  yaw: number // extra turn on top of facing (spins)
  turn: number // how far Nexo turns toward its facing direction, 0..1
}

export interface LimbCtx {
  fidget: number
  dragging: boolean
}

const TAU = Math.PI * 2
// Rope grip: right arm raised up, out and a little forward so the hand sits beside the head
// (outside its silhouette) where the rope can reach it. The rope is drawn to this hand.
const GRIP_SH: [number, number] = [0.3, 1.75]
const GRIP_EL = 0.15
const ROPE_TILT = 0.45 // body hangs from the raised hand: tilt so that side rides higher
const ROPE_TURN = 0.12 // nearly face-on, so the gripping hand is not hidden behind the head
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const easeInOut = (v: number) => (v < 0.5 ? 4 * v ** 3 : 1 - (-2 * v + 2) ** 3 / 2)

const rest = (): JointPose => ({
  hipL: 0,
  hipR: 0,
  kneeL: 0.05,
  kneeR: 0.05,
  spread: 0,
  shL: [0.05, -0.14],
  shR: [0.05, 0.14],
  elL: [-0.2, 0],
  elR: [-0.2, 0],
  head: [0, 0, 0],
  drop: 0,
  tilt: 0,
  yaw: 0,
  turn: 0.5,
})

/** Low seat: thighs forward, shins down, feet on the floor, hands on the knees. */
function seated(j: JointPose, t: number) {
  const k = easeInOut(clamp01(t / 0.7))
  j.hipL = j.hipR = -1.4 * k
  j.kneeL = j.kneeR = 1.4 * k
  j.drop = -0.24 * k
  j.shL = [-0.55 * k, -0.22]
  j.shR = [-0.55 * k, 0.22]
  j.elL = [-0.45 * k, 0]
  j.elR = [-0.45 * k, 0]
  j.turn = 0.35
  return k
}

export function limbs(state: PetState, t: number, ctx: LimbCtx): JointPose {
  const j = rest()

  if (ctx.dragging) {
    // Held up: arms raised, legs dangling and kicking a little.
    const s = Math.sin(TAU * t * 1.3)
    j.shL = [0, -2.7]
    j.shR = [0, 2.7]
    j.elL = [-0.3, 0]
    j.elR = [-0.3, 0]
    j.hipL = 0.25 * s
    j.hipR = -0.25 * s
    j.kneeL = 0.35 + 0.2 * s
    j.kneeR = 0.35 - 0.2 * s
    j.head = [-0.15, 0, 0]
    j.turn = 0.2
    return j
  }

  switch (state) {
    case 'idle': {
      const sway = Math.sin((TAU * t) / 3.2)
      j.shL[1] -= 0.04 * sway
      j.shR[1] += 0.04 * sway
      j.head = [0.03 * sway, 0, 0.04 * Math.sin((TAU * t) / 7)]
      if (ctx.fidget >= 0) {
        // Curious look around: head tilts and turns.
        const f = Math.sin(Math.PI * ctx.fidget)
        j.head = [-0.1 * f, 0.45 * f * Math.sin(TAU * ctx.fidget), 0.25 * f]
      }
      break
    }
    case 'walking':
    case 'running': {
      const run = state === 'running'
      const steps = run ? 3.4 : 1.9
      const ph = Math.PI * steps * t
      const s = Math.sin(ph)
      const amp = run ? 0.85 : 0.5
      j.hipL = -amp * s
      j.hipR = amp * s
      // Knee bends while the leg swings back and passes under the body.
      j.kneeL = 0.12 + (run ? 1.1 : 0.55) * Math.max(0, Math.sin(ph - 0.6))
      j.kneeR = 0.12 + (run ? 1.1 : 0.55) * Math.max(0, -Math.sin(ph - 0.6))
      j.shL = [(run ? 0.9 : 0.55) * s, -0.16]
      j.shR = [-(run ? 0.9 : 0.55) * s, 0.16]
      j.elL = [run ? -1.3 : -0.35, 0]
      j.elR = [run ? -1.3 : -0.35, 0]
      j.head = [run ? 0.12 : 0.02, 0, 0.05 * s]
      j.turn = 1
      break
    }
    case 'dancing': {
      const beat = t * 2 // 120 bpm
      const s = Math.sin(Math.PI * beat)
      const pump = Math.abs(s)
      // Both hands up, pumping to the beat.
      j.shL = [0.1 * s, -2.55 - 0.25 * pump]
      j.shR = [-0.1 * s, 2.55 + 0.25 * pump]
      j.elL = [-0.2, -0.5 * pump]
      j.elR = [-0.2, 0.5 * pump]
      // Alternating little foot taps.
      j.hipL = -0.35 * Math.max(0, s)
      j.hipR = -0.35 * Math.max(0, -s)
      j.kneeL = 0.1 + 0.6 * Math.max(0, s)
      j.kneeR = 0.1 + 0.6 * Math.max(0, -s)
      j.head = [0.05, 0.15 * s, 0.18 * s]
      // Every eighth beat: a quick full turn.
      const bar = beat % 8
      if (bar > 7) j.yaw = TAU * easeInOut(bar - 7)
      j.turn = 0.25
      break
    }
    case 'jumping': {
      if (t < 0.22) {
        const k = t / 0.22 // crouch, arms swing back
        j.hipL = j.hipR = -0.55 * k
        j.kneeL = j.kneeR = 1.0 * k
        j.drop = -0.18 * k
        j.shL = [0.7 * k, -0.2]
        j.shR = [0.7 * k, 0.2]
      } else if (t < 0.8) {
        const u = (t - 0.22) / 0.58 // airborne: arms fling up, legs tuck
        const up = Math.sin(Math.PI * Math.min(1, u * 1.6))
        j.shL = [-0.2, -2.6 * up - 0.14]
        j.shR = [-0.2, 2.6 * up + 0.14]
        j.hipL = j.hipR = -0.4 * Math.sin(Math.PI * u)
        j.kneeL = j.kneeR = 0.7 * Math.sin(Math.PI * u)
      } else {
        const k = 1 - clamp01((t - 0.8) / 0.3) // absorb the landing
        j.hipL = j.hipR = -0.45 * k
        j.kneeL = j.kneeR = 0.85 * k
        j.drop = -0.14 * k
        j.shL = [-0.3 * k, -0.6 * k - 0.14]
        j.shR = [-0.3 * k, 0.6 * k + 0.14]
      }
      j.turn = 0.4
      break
    }
    case 'sitting': {
      const k = seated(j, t)
      const swing = Math.sin((TAU * t) / 2.6)
      j.kneeL += 0.12 * k * Math.max(0, swing)
      j.kneeR += 0.12 * k * Math.max(0, -swing)
      j.head = [0.04, 0.1 * Math.sin((TAU * t) / 9), 0.06]
      break
    }
    case 'sleeping': {
      const k = seated(j, t)
      const breath = Math.sin((TAU * t) / 4.2)
      j.head = [0.32 * k + 0.03 * breath, 0, 0.2 * k]
      j.shL = [-0.3 * k, -0.12]
      j.shR = [-0.3 * k, 0.12]
      j.elL = [-0.9 * k, 0]
      j.elR = [-0.9 * k, 0]
      break
    }
    case 'waving': {
      const k = clamp01(t / 0.3) * clamp01((2.6 - t) / 0.35)
      const wave = Math.sin(TAU * 2.2 * t)
      j.shR = [-0.25 * k, 0.14 + 2.35 * k]
      j.elR = [-0.15, (0.5 + 0.55 * wave) * k]
      j.shL = [0.1, -0.2 * k - 0.14]
      j.head = [0, 0.12 * k, -0.1 * k]
      j.turn = 0.35
      break
    }
    case 'spinning': {
      const e = easeInOut(clamp01(t / 1.2))
      const out = Math.sin(Math.PI * e)
      j.yaw = TAU * e
      j.shL = [0, -0.14 - 1.3 * out]
      j.shR = [0, 0.14 + 1.3 * out]
      j.kneeL = j.kneeR = 0.15
      j.turn = 0.3
      break
    }
    case 'happy': {
      const hop = Math.abs(Math.sin((TAU * t) / 1.6) * Math.sin((Math.PI * t) / 0.8))
      j.shL = [-0.2, -2.2 - 0.3 * hop]
      j.shR = [-0.2, 2.2 + 0.3 * hop]
      j.elL = [-0.3, -0.3]
      j.elR = [-0.3, 0.3]
      j.kneeL = j.kneeR = 0.4 * (1 - hop)
      j.hipL = j.hipR = -0.2 * (1 - hop)
      j.head = [-0.08, 0, 0.12 * Math.sin(TAU * t * 1.25)]
      j.turn = 0.2
      break
    }
    case 'surprised': {
      const jolt = t < 0.12 ? t / 0.12 : Math.exp(-(t - 0.12) * 2.5)
      j.shL = [-0.4 * jolt, -0.14 - 1.5 * jolt]
      j.shR = [-0.4 * jolt, 0.14 + 1.5 * jolt]
      j.elL = [-1.0 * jolt, 0]
      j.elR = [-1.0 * jolt, 0]
      j.head = [-0.25 * jolt, 0, 0]
      j.hipL = 0.2 * jolt
      j.kneeL = 0.3 * jolt
      j.turn = 0.15
      break
    }
    case 'climbing': {
      // Hand over hand up the wall: arms reach alternately, legs push alternately.
      const s = Math.sin(Math.PI * 2.4 * t)
      j.shL = [-2.5 - 0.45 * s, -0.25]
      j.shR = [-2.5 + 0.45 * s, 0.25]
      j.elL = [-0.35 - 0.35 * Math.max(0, s), 0]
      j.elR = [-0.35 - 0.35 * Math.max(0, -s), 0]
      j.hipL = -0.55 - 0.45 * s
      j.hipR = -0.55 + 0.45 * s
      j.kneeL = 0.9 + 0.5 * s
      j.kneeR = 0.9 - 0.5 * s
      j.head = [-0.25, 0, 0]
      j.turn = 1.12 // face the wall
      break
    }
    case 'clinging': {
      // Hanging by the hands, legs swinging, looking back at the user.
      const s = Math.sin((TAU * t) / 2.4)
      j.shL = [-2.75, -0.3]
      j.shR = [-2.75, 0.3]
      j.elL = [-0.25, 0]
      j.elR = [-0.25, 0]
      j.hipL = 0.3 * s
      j.hipR = -0.3 * s
      j.kneeL = 0.3 + 0.2 * s
      j.kneeR = 0.3 - 0.2 * s
      j.head = [0.05, 0, 0.1 * s]
      j.turn = 0.75
      break
    }
    case 'cornering': {
      // Swinging over the corner: reach with both hands, legs tucked.
      j.shL = [-2.7, -0.35]
      j.shR = [-2.7, 0.35]
      j.elL = [-0.3, 0]
      j.elR = [-0.3, 0]
      j.hipL = j.hipR = -0.8
      j.kneeL = j.kneeR = 1.0
      j.turn = 1
      break
    }
    case 'ropeShoot': {
      // Spider-style rope shot: right arm snaps up and out beside the head (Nexo's arms
      // cannot reach above its big head), left hand on the hip, eyes on the target.
      const k = clamp01((t - 0.1) / 0.15)
      j.shR = [GRIP_SH[0] * k, 0.14 + (GRIP_SH[1] - 0.14) * k]
      j.elR = [0, GRIP_EL * k]
      j.shL = [0.2, -0.5]
      j.elL = [-1.2, 0]
      j.hipL = j.hipR = -0.25 * (1 - k)
      j.kneeL = j.kneeR = 0.45 * (1 - k)
      j.head = [-0.3 * k, 0, -0.12 * k]
      j.tilt = ROPE_TILT * k * 0.5
      j.turn = ROPE_TURN
      break
    }
    case 'ropeClimb': {
      // Web-zip: hanging from the right hand, pulled up the rope, legs tucked, free arm out.
      const s = Math.sin(Math.PI * 2.2 * t)
      j.shR = [GRIP_SH[0], GRIP_SH[1]]
      j.elR = [0, GRIP_EL]
      j.shL = [-0.4, -1.25 - 0.15 * s]
      j.elL = [-0.5, -0.3]
      j.hipL = -0.9 - 0.15 * s
      j.hipR = -0.75 + 0.15 * s
      j.kneeL = 1.4
      j.kneeR = 1.2
      j.head = [-0.28, 0, -0.1]
      j.tilt = ROPE_TILT
      j.turn = ROPE_TURN
      break
    }
    case 'watering': {
      // Right arm out front holding the can over the plant, sweeping gently while it pours.
      const pour = clamp01((t - 1) / 0.5) * clamp01((6.4 - t) / 0.5)
      j.shR = [-1.15, 0.3 + 0.12 * Math.sin(TAU * t * 0.6) * pour]
      j.elR = [-0.2, 0]
      j.shL = [0.15, -0.35]
      j.elL = [-0.9, 0]
      j.head = [0.3, 0.25, 0.05]
      j.turn = 0.7
      break
    }
    case 'drinking':
    case 'eating': {
      // Bring the hand to the mouth: one long sip, or three bites.
      const bites = state === 'eating' ? [0.6, 2.0, 3.4] : [0.5]
      const hold = state === 'eating' ? 0.7 : 3.2
      let up = 0
      for (const b of bites) up = Math.max(up, clamp01((t - b) / 0.35) * clamp01((b + hold - t) / 0.35))
      // The head is far bigger than the arms are long, so the hand comes up in front of the
      // chin and Nexo bows its face down to it.
      j.shR = [-0.9 - 0.6 * up, 0.25 - 0.65 * up]
      j.elR = [-1.3 + 0.45 * up, 0]
      j.shL = [0.1, -0.2]
      j.head = [0.3 * up, 0, 0]
      j.turn = 0.02 // face the viewer: the right hand would otherwise hide behind the head
      break
    }
    case 'brushing': {
      const k = clamp01(t / 0.4) * clamp01((5 - t) / 0.4)
      j.shR = [-1.5 * k, 0.14 - 0.54 * k + 0.12 * k * Math.sin(TAU * t * 5)]
      j.elR = [-0.85 * k, 0]
      j.head = [0.3 * k, 0, 0]
      j.shL = [0.1, -0.25]
      j.turn = 0.02
      break
    }
    case 'eyeRest': {
      // Palming: both hands cover the face screen.
      const k = clamp01(t / 0.4) * clamp01((4.5 - t) / 0.4)
      // Arms are short next to the big head, so Nexo bows into its palms.
      j.shL = [-2.3 * k, -0.14 + 0.5 * k]
      j.shR = [-2.3 * k, 0.14 - 0.5 * k]
      j.elL = [-0.7 * k, 0.3 * k]
      j.elR = [-0.7 * k, -0.3 * k]
      j.head = [0.5 * k, 0, 0]
      j.turn = 0.3
      break
    }
    case 'reading': {
      const k = seated(j, t)
      // Book held in both hands; every few seconds the right hand turns a page.
      const flip = Math.max(0, Math.sin(Math.PI * ((t % 3) - 2.4) / 0.6)) * (t % 3 > 2.4 ? 1 : 0)
      j.shL = [-1.0 * k, -0.05]
      j.shR = [-1.0 * k, 0.05 + 0.4 * flip]
      j.elL = [-1.15 * k, 0.35]
      j.elR = [-1.15 * k, -0.35 - 0.3 * flip]
      j.head = [0.32 * k, 0, 0.05]
      break
    }
    case 'laptop': {
      const k = seated(j, t)
      const tap = Math.sin(TAU * t * 4)
      j.shL = [-0.85 * k, -0.08]
      j.shR = [-0.85 * k, 0.08]
      j.elL = [-0.75 * k + 0.08 * tap, 0.25]
      j.elR = [-0.75 * k - 0.08 * tap, -0.25]
      j.head = [0.28 * k, 0, 0]
      break
    }
    case 'meditating': {
      // Cross-legged on the floor, hands resting on the knees.
      const k = easeInOut(clamp01(t / 1.0))
      j.hipL = j.hipR = -1.35 * k
      j.kneeL = j.kneeR = 1.9 * k
      j.spread = 0.55 * k
      j.drop = -0.42 * k
      j.shL = [-0.45 * k, -0.45]
      j.shR = [-0.45 * k, 0.45]
      j.elL = [-0.5 * k, 0]
      j.elR = [-0.5 * k, 0]
      j.head = [0.08, 0, 0]
      j.turn = 0.2
      break
    }
    case 'chairDance': {
      // Seated groove: arms pump up in turn, feet tap, head bobs.
      const k = seated(j, t)
      const beat = t * 2
      const s = Math.sin(Math.PI * beat)
      j.shL = [-0.3, -0.3 - 2.2 * Math.max(0, s) * k]
      j.shR = [-0.3, 0.3 + 2.2 * Math.max(0, -s) * k]
      j.elL = [-0.4, -0.4 * Math.max(0, s)]
      j.elR = [-0.4, 0.4 * Math.max(0, -s)]
      j.kneeL += 0.25 * Math.max(0, s) * k
      j.kneeR += 0.25 * Math.max(0, -s) * k
      j.head = [0.1 * Math.abs(s), 0.12 * s, 0.15 * s]
      j.turn = 0.3
      break
    }
    case 'roping': {
      // Hanging one-handed from the rope, Spider-Man style: free arm out for balance,
      // one knee up, legs trailing the swing.
      const s = Math.sin((TAU * t) / 1.9 - 0.6)
      j.shR = [GRIP_SH[0], GRIP_SH[1]]
      j.elR = [0, GRIP_EL]
      j.shL = [-0.3 + 0.15 * s, -1.35 - 0.12 * s]
      j.elL = [-0.45, -0.25]
      j.hipL = -0.6 + 0.2 * s
      j.hipR = 0.1 + 0.2 * s
      j.kneeL = 1.1
      j.kneeR = 0.25 - 0.1 * s
      j.head = [-0.08, 0, -0.1 + 0.05 * s]
      j.tilt = ROPE_TILT
      j.turn = ROPE_TURN
      break
    }
    case 'floating': {
      // Weightless: arms out like wings, legs together, gentle paddling.
      const s = Math.sin((TAU * t) / 2.2)
      j.shL = [0.1, -1.25 - 0.15 * s]
      j.shR = [0.1, 1.25 + 0.15 * s]
      j.elL = [-0.2, -0.2]
      j.elR = [-0.2, 0.2]
      j.hipL = -0.15 + 0.12 * s
      j.hipR = -0.15 - 0.12 * s
      j.kneeL = j.kneeR = 0.35
      j.head = [-0.05, 0, 0.08 * s]
      j.turn = 0.3
      break
    }
    case 'stretching': {
      const up = Math.sin(Math.PI * clamp01(t / 3.4))
      j.shL = [-0.2 * up, -0.14 - 2.85 * up]
      j.shR = [-0.2 * up, 0.14 + 2.85 * up]
      j.elL = [-0.1, -0.2 * up]
      j.elR = [-0.1, 0.2 * up]
      j.head = [-0.3 * up, 0, 0]
      j.turn = 0.3
      break
    }
    case 'exercising': {
      // Jumping jacks: arms and legs open and close in time with the hop.
      const open = Math.abs(Math.sin((Math.PI * t) / 0.42))
      j.shL = [0, -0.14 - 2.7 * open]
      j.shR = [0, 0.14 + 2.7 * open]
      j.elL = [-0.1, 0]
      j.elR = [-0.1, 0]
      j.spread = 0.38 * open
      j.kneeL = j.kneeR = 0.25 * (1 - open)
      j.turn = 0.1
      break
    }
    case 'thinking': {
      // Hand on chin, other arm across the belly, head tilted.
      const tap = Math.sin(TAU * t * 1.5)
      j.shR = [-1.25, 0.35]
      j.elR = [-2.15 + 0.06 * tap, -0.4]
      j.shL = [-0.55, -0.1]
      j.elL = [-1.35, 0.6]
      j.head = [-0.08, 0.22, 0.16 + 0.03 * Math.sin((TAU * t) / 3)]
      j.turn = 0.45
      break
    }
    case 'ladder': {
      // Turn to the ladder (back to the viewer), climb hand over hand, turn round at the top
      // to wave, turn back, climb down, face the viewer again.
      const turn = (a: number) => easeInOut(clamp01((t - a) / 0.6))
      j.yaw = Math.PI * (turn(0) + turn(LADDER.up[1]) + turn(LADDER.down[0] - 0.6) + turn(LADDER.down[1]))
      j.turn = 0
      const atTop = clamp01((t - LADDER.up[1] - 0.4) / 0.3) * clamp01((LADDER.down[0] - 0.4 - t) / 0.3)
      const { step } = ladderRung(t)
      const s = Math.sin(Math.PI * step)
      const climbing = t > 0.5 && t < LADDER.down[1] + 0.2 ? 1 - atTop : 0
      // Hands up on the rails, alternating; feet push up in turn.
      j.shL = [-2.35 - 0.4 * s * climbing, -0.3]
      j.shR = [-2.35 + 0.4 * s * climbing, 0.3]
      j.elL = [-0.35 - 0.3 * Math.max(0, s), 0]
      j.elR = [-0.35 - 0.3 * Math.max(0, -s), 0]
      j.hipL = -0.25 - 0.6 * Math.max(0, s) * climbing
      j.hipR = -0.25 - 0.6 * Math.max(0, -s) * climbing
      j.kneeL = 0.3 + 0.9 * Math.max(0, s) * climbing
      j.kneeR = 0.3 + 0.9 * Math.max(0, -s) * climbing
      j.head = [-0.25 * climbing, 0, 0]
      if (atTop > 0) {
        // Facing out at the top: left hand holds the rail behind, right hand waves.
        const wave = Math.sin(TAU * 2.2 * t)
        j.shL = [0.55, -0.35]
        j.elL = [-0.6, 0]
        j.shR = [-0.25, 0.14 + 2.35 * atTop]
        j.elR = [-0.15, (0.5 + 0.55 * wave) * atTop]
        j.head = [-0.1, 0.1, -0.1 * atTop]
      }
      break
    }
    case 'swimming': {
      const wet = t > SWIM.hopIn[0] + 0.55 && t < SWIM.hopOut[0] ? 1 : 0
      const swim = clamp01((t - SWIM.swim[0]) / 0.5) * clamp01((SWIM.swim[1] - t) / 0.5)
      const ph = TAU * t * SWIM.strokes
      j.drop = -0.45 * wet
      if (!wet) {
        // Hopping over the rim: arms up, knees tucked.
        const hop = Math.max(...[SWIM.hopIn, SWIM.hopOut].map(([a, b]) => Math.sin(Math.PI * clamp01((t - a) / (b - a)))))
        j.shL = [-0.2, -0.14 - 2.2 * hop]
        j.shR = [-0.2, 0.14 + 2.2 * hop]
        j.hipL = j.hipR = -0.5 * hop
        j.kneeL = j.kneeR = 0.9 * hop
        j.turn = 0.4
        break
      }
      if (swim > 0) {
        // Breaststroke, facing the viewer: reach forward, sweep wide along the water, frog-kick.
        const w = swimSweep(t)
        j.shL = [-1.5 + 0.9 * w, -0.35 - 1.25 * w]
        j.shR = [-1.5 + 0.9 * w, 0.35 + 1.25 * w]
        j.elL = [-0.35 + 0.2 * w, -0.2 * w]
        j.elR = [-0.35 + 0.2 * w, 0.2 * w]
        j.hipL = j.hipR = -0.3 * (1 - w)
        j.kneeL = j.kneeR = 0.3 + 0.8 * (1 - w)
        j.spread = 0.3 * w
        j.head = [-0.12 * w, 0.08 * Math.sin(ph / 2), 0]
        j.turn = 0.3
      } else {
        // Treading water and waving at the viewer.
        const wave = Math.sin(TAU * 2.2 * t)
        j.shR = [-0.25, 2.4]
        j.elR = [-0.15, 0.5 + 0.55 * wave]
        j.shL = [-0.3, -1.1 - 0.2 * Math.sin(TAU * t)]
        j.hipL = 0.3 * Math.sin(TAU * t * 1.5)
        j.hipR = -0.3 * Math.sin(TAU * t * 1.5)
        j.head = [0, 0.1, -0.08]
        j.turn = 0.1
      }
      break
    }
    case 'falling': {
      const s = Math.sin(TAU * t * 3)
      j.shL = [0.2 * s, -2.5 - 0.3 * s]
      j.shR = [-0.2 * s, 2.5 + 0.3 * s]
      j.hipL = 0.4 * s
      j.hipR = -0.4 * s
      j.kneeL = j.kneeR = 0.5
      j.head = [-0.2, 0, 0]
      j.turn = 0.2
      break
    }
  }
  return j
}
