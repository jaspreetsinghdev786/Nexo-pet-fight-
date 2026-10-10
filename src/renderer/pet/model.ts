import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { cloudGeometry, frontZ, sideX } from './cloud'
import { FaceScreen } from './faceTexture'
import { buildProps, Props } from './props'

// Nexo, built procedurally to match the reference art (assets/nexo-reference.png):
// glossy cloud head (body colour is a setting, orange by default), dark rounded face screen with cyan rim, ring "ears",
// rounded torso with a glowing ">" chevron, dark joints, mitten hands with dark
// fingers and a cyan palm light, chunky boots with a cyan stripe.
// Units: Nexo stands ~3 tall with feet at y = 0, facing +z.

export interface Rig {
  root: THREE.Group // world position + yaw
  lean: THREE.Group // lean + squash, pivots at the feet
  body: THREE.Group // vertical offset (sitting) + bob
  head: THREE.Group
  shoulderL: THREE.Group
  shoulderR: THREE.Group
  elbowL: THREE.Group
  elbowR: THREE.Group
  hipL: THREE.Group
  hipR: THREE.Group
  kneeL: THREE.Group
  kneeR: THREE.Group
  face: FaceScreen
  chair: THREE.Group // pops in under Nexo for seated states
  handR: THREE.Group
  handL: THREE.Group
  props: Props
  hitMeshes: THREE.Object3D[]
  setColor(base: string, emissive: string): void
  dispose(): void
}

export const HEIGHT = 3.0

const CYAN = new THREE.Color('#40e6ff')

function materials() {
  const blue = new THREE.MeshPhysicalMaterial({
    color: '#ff7a1a',
    roughness: 0.32,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    emissive: new THREE.Color('#c2410c'),
    emissiveIntensity: 0.16,
  })
  const dark = new THREE.MeshPhysicalMaterial({
    color: '#11162a',
    roughness: 0.3,
    clearcoat: 0.8,
    clearcoatRoughness: 0.15,
  })
  const screen = new THREE.MeshPhysicalMaterial({
    color: '#060a1a',
    roughness: 0.12,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
  })
  const glow = new THREE.MeshBasicMaterial({ color: CYAN, toneMapped: false })
  const cushion = new THREE.MeshPhysicalMaterial({
    color: '#27314f',
    roughness: 0.55,
    clearcoat: 0.3,
  })
  return { blue, dark, screen, glow, cushion }
}

/** Small lounge chair sized for Nexo's seated pose (hips at y = 0.36). */
function buildChair(m: ReturnType<typeof materials>) {
  const chair = new THREE.Group()
  const seat = new THREE.Mesh(new RoundedBoxGeometry(1.3, 0.1, 0.62, 4, 0.04), m.cushion)
  seat.position.set(0, 0.16, -0.04)
  const back = new THREE.Mesh(new RoundedBoxGeometry(1.3, 0.95, 0.1, 4, 0.05), m.cushion)
  back.position.set(0, 0.66, -0.42)
  back.rotation.x = -0.1
  const frame = new THREE.Mesh(new RoundedBoxGeometry(1.36, 0.05, 0.66, 3, 0.02), m.dark)
  frame.position.set(0, 0.1, -0.04)
  const leg = new THREE.CylinderGeometry(0.035, 0.03, 0.1, 12)
  for (const [x, z] of [
    [-0.6, 0.22],
    [0.6, 0.22],
    [-0.6, -0.3],
    [0.6, -0.3],
  ]) {
    const l = new THREE.Mesh(leg, m.dark)
    l.position.set(x, 0.05, z)
    chair.add(l)
  }
  // Cyan trim along the seat front and the top of the backrest, matching Nexo's lights.
  const trim = new THREE.CapsuleGeometry(0.014, 1.16, 4, 8)
  const front = new THREE.Mesh(trim, m.glow)
  front.rotation.z = Math.PI / 2
  front.position.set(0, 0.16, 0.28)
  const top = new THREE.Mesh(trim, m.glow)
  top.rotation.z = Math.PI / 2
  top.position.set(0, 1.13, -0.47)
  // Armrests on both sides so the chair reads even when Nexo sits in front of it.
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.1, 0.6, 3, 0.04), m.dark)
    arm.position.set(side * 0.6, 0.48, -0.08)
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.28, 10), m.dark)
    post.position.set(side * 0.6, 0.31, 0.12)
    const light = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.42, 4, 8), m.glow)
    light.rotation.x = Math.PI / 2
    light.position.set(side * 0.6, 0.535, -0.08)
    chair.add(arm, post, light)
  }
  chair.add(seat, back, frame, front, top)
  chair.scale.setScalar(0.001)
  chair.visible = false
  return chair
}

const sphere = new THREE.SphereGeometry(1, 48, 32)

function ball(mat: THREE.Material, r: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(sphere, mat)
  m.position.set(x, y, z)
  m.scale.set(r * sx, r * sy, r * sz)
  return m
}

/** Capsule hanging down from its group origin. */
function limb(mat: THREE.Material, radius: number, length: number) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 8, 24), mat)
  m.position.y = -length / 2 - radius * 0.4
  return m
}

function chevron(mat: THREE.Material, size: number, thickness: number) {
  // ">" made of two rounded bars.
  const g = new THREE.Group()
  const bar = new THREE.CapsuleGeometry(thickness, size, 4, 12)
  for (const dir of [1, -1]) {
    const m = new THREE.Mesh(bar, mat)
    m.rotation.z = dir * (Math.PI / 2 - 0.75)
    m.position.set(0, (dir * size) / 2.9, 0)
    g.add(m)
  }
  return g
}

function buildHead(m: ReturnType<typeof materials>, face: FaceScreen) {
  const head = new THREE.Group()
  head.add(new THREE.Mesh(cloudGeometry(), m.blue))
  head.add(face.mesh)

  // Ear rings: dark disc with a cyan ring, seated on each side of the head.
  for (const side of [-1, 1]) {
    const ear = new THREE.Group()
    ear.position.set(side * (sideX(0.52) - 0.02), 0.52, 0)
    ear.rotation.y = side * (Math.PI / 2)
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 40), m.dark)
    disc.rotation.x = Math.PI / 2
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.028, 12, 48), m.glow)
    ring.position.z = 0.075
    ear.add(disc, ring)
    head.add(ear)
  }
  return head
}

function buildArm(m: ReturnType<typeof materials>, side: 1 | -1) {
  const shoulder = new THREE.Group()
  shoulder.add(ball(m.dark, 0.15))
  shoulder.add(limb(m.blue, 0.13, 0.09))
  const elbow = new THREE.Group()
  elbow.position.y = -0.26
  elbow.add(ball(m.dark, 0.11))
  elbow.add(limb(m.blue, 0.125, 0.07))
  shoulder.add(elbow)

  // Mitten hand: blue palm, cyan light, chunky dark fingers.
  const hand = new THREE.Group()
  hand.position.y = -0.3
  hand.add(ball(m.blue, 0.16, 0, -0.04, 0, 1, 1.05, 0.82))
  hand.add(ball(m.glow, 0.05, 0, -0.04, 0.125, 1, 1, 0.4))
  const fingers: [number, number][] = [
    [-0.095, -0.18],
    [-0.032, -0.215],
    [0.032, -0.215],
    [0.095, -0.18],
  ]
  for (const [fx, fy] of fingers) hand.add(ball(m.dark, 0.06, fx, fy, 0.02, 1, 1.25, 1))
  hand.add(ball(m.dark, 0.062, side * -0.14, -0.04, 0.06, 1, 1.2, 1)) // thumb toward the body
  elbow.add(hand)
  return { shoulder, elbow, hand }
}

function buildLeg(m: ReturnType<typeof materials>) {
  const hip = new THREE.Group()
  hip.add(ball(m.dark, 0.13))
  hip.add(limb(m.blue, 0.145, 0.06))
  const knee = new THREE.Group()
  knee.position.y = -0.22
  knee.add(ball(m.dark, 0.125))
  knee.add(limb(m.blue, 0.14, 0.03))

  // Boot: rounded blue shell, dark sole, cyan stripe around the toe.
  const boot = new THREE.Group()
  boot.position.y = -0.2
  const shell = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.24, 0.46, 5, 0.1), m.blue)
  shell.position.set(0, -0.04, 0.06)
  const sole = new THREE.Mesh(new RoundedBoxGeometry(0.35, 0.07, 0.47, 4, 0.03), m.dark)
  sole.position.set(0, -0.15, 0.06)
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.016, 8, 32, Math.PI), m.glow)
  stripe.rotation.x = -Math.PI / 2
  stripe.position.set(0, -0.1, 0.15)
  stripe.scale.set(1.1, 1.08, 1)
  boot.add(shell, sole, stripe)
  knee.add(boot)
  hip.add(knee)
  return { hip, knee }
}

export function buildNexo(): Rig {
  const m = materials()
  const face = new FaceScreen(1.16, 0.7, 0, 0.6, frontZ)

  const root = new THREE.Group()
  const lean = new THREE.Group()
  const body = new THREE.Group()
  root.add(lean)
  lean.add(body)

  // Torso: rounded egg with a dark waist and the glowing chevron on the chest.
  const torso = new THREE.Group()
  torso.position.y = 0.94
  torso.add(ball(m.blue, 0.42, 0, 0, 0, 1, 1, 0.84))
  const chest = chevron(m.glow, 0.14, 0.024)
  chest.position.set(0.03, 0.03, 0.345)
  chest.scale.setScalar(1)
  torso.add(chest)
  const waist = ball(m.dark, 0.32, 0, -0.3, 0, 1, 0.38, 0.84)
  torso.add(waist)
  const stripe = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.12, 4, 8), m.glow)
  stripe.position.set(-0.3, -0.05, 0.22)
  stripe.rotation.y = -0.6
  torso.add(stripe)
  // Back panel: dark battery pack with a cyan charge strip, so turns that show the back
  // still look finished.
  const pack = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.42, 0.14, 4, 0.06), m.dark)
  pack.position.set(0, 0.02, -0.3)
  const charge = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.2, 4, 8), m.glow)
  charge.position.set(0, 0.02, -0.375)
  torso.add(pack, charge)
  body.add(torso)

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.14, 32), m.dark)
  neck.position.y = 1.32
  body.add(neck)

  const head = buildHead(m, face)
  head.position.y = 1.3
  head.scale.setScalar(1.15) // the reference has a big, dominant head
  body.add(head)

  const armL = buildArm(m, -1)
  armL.shoulder.position.set(-0.44, 1.1, 0)
  const armR = buildArm(m, 1)
  armR.shoulder.position.set(0.44, 1.1, 0)
  body.add(armL.shoulder, armR.shoulder)

  const legL = buildLeg(m)
  legL.hip.position.set(-0.19, 0.6, 0)
  const legR = buildLeg(m)
  legR.hip.position.set(0.19, 0.6, 0)
  body.add(legL.hip, legR.hip)

  const hitMeshes: THREE.Object3D[] = []
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o !== face.mesh) hitMeshes.push(o)
  })

  // Added after collecting hit meshes: clicks on the chair pass through to the desktop.
  const chair = buildChair(m)
  root.add(chair)

  // Activity props: hand-held ones ride on the right hand, the rest sit in Nexo's space.
  const props = buildProps(m.glow)
  // Grip offsets are in the hand's own frame, which turns with the arm, so keep them small;
  // each prop's geometry is offset forward in its upright frame instead.
  props.can.position.set(0, -0.16, 0.04)
  for (const o of [props.can, props.cup, props.apple, props.brush]) armR.hand.add(o)
  for (const o of [props.cup, props.apple, props.brush]) o.position.set(0, -0.05, 0)
  props.book.position.set(0, 1.0, 0.52)
  props.book.rotation.x = -0.45
  props.book.scale.setScalar(1.45)
  props.laptop.position.set(0, 0.48, 0.42)
  body.add(props.book, props.laptop)
  props.plant.position.set(0.5, 0, 0.85)
  root.add(props.plant, ...props.droplets)

  return {
    root,
    lean,
    body,
    head,
    shoulderL: armL.shoulder,
    shoulderR: armR.shoulder,
    elbowL: armL.elbow,
    elbowR: armR.elbow,
    hipL: legL.hip,
    hipR: legR.hip,
    kneeL: legL.knee,
    kneeR: legR.knee,
    face,
    chair,
    handR: armR.hand,
    handL: armL.hand,
    props,
    hitMeshes,
    setColor(base, emissive) {
      m.blue.color.set(base)
      m.blue.emissive.set(emissive)
    },
    dispose() {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh) mesh.geometry.dispose()
      })
      Object.values(m).forEach((mat) => mat.dispose())
      face.dispose()
      props.dispose()
    },
  }
}
