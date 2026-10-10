import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { windowSizeFor } from '../../../electron/shared'
import type { Frame } from './brain'
import { JointPose, limbs } from './limbs'
import { DUO_SCALE, DuoFrame, RIVAL_SCALE } from './duo'
import { buildNexo, HEIGHT, Rig } from './model'
import { EXPRESSION, SWIM } from './poses'

// Transparent WebGL stage for the 3D Nexo. Camera framing keeps the same layout as the
// window: Nexo's feet sit 6% of the pet size above the window bottom and its height is
// ~the pet size, leaving headroom for jumps.

const FEET_MARGIN = 0.1 // of pet size
const FOV_DISTANCE = 12
const DEG = Math.PI / 180

/** Ease every joint toward its target: smooth blends between states for free. */
function easeJoints(j: JointPose, target: JointPose, k: number) {
  const ease = (a: number, b: number) => a + (b - a) * k
  j.hipL = ease(j.hipL, target.hipL)
  j.hipR = ease(j.hipR, target.hipR)
  j.kneeL = ease(j.kneeL, target.kneeL)
  j.kneeR = ease(j.kneeR, target.kneeR)
  j.spread = ease(j.spread, target.spread)
  for (const key of ['shL', 'shR', 'elL', 'elR'] as const) {
    j[key] = [ease(j[key][0], target[key][0]), ease(j[key][1], target[key][1])]
  }
  j.head = [ease(j.head[0], target.head[0]), ease(j.head[1], target.head[1]), ease(j.head[2], target.head[2])]
  j.drop = ease(j.drop, target.drop)
  j.tilt = ease(j.tilt, target.tilt)
  j.turn = ease(j.turn, target.turn)
}

function setJoints(r: Rig, j: JointPose) {
  r.body.position.y = j.drop
  r.hipL.rotation.set(j.hipL, 0, -j.spread)
  r.hipR.rotation.set(j.hipR, 0, j.spread)
  r.kneeL.rotation.x = j.kneeL
  r.kneeR.rotation.x = j.kneeR
  r.shoulderL.rotation.set(j.shL[0], 0, j.shL[1])
  r.shoulderR.rotation.set(j.shR[0], 0, j.shR[1])
  r.elbowL.rotation.set(j.elL[0], 0, j.elL[1])
  r.elbowR.rotation.set(j.elR[0], 0, j.elR[1])
  r.head.rotation.set(j.head[0], j.head[1], j.head[2])
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(20, 1, 0.1, 50)
  private rig: Rig
  private joints: JointPose | null = null
  private world = new THREE.Group() // flips Nexo upside down for the ceiling
  private flip = 0
  private centreY = 0
  private yaw = 0
  private chairScale = 0
  private plantScale = 0
  private sceneScale = { pool: 0, ladder: 0, disco: 0, bar: 0 }
  private ladderAt = { x: 0, z: -0.62, scale: 1 }
  private discoTop = 0
  private q = new THREE.Quaternion()
  private q2 = new THREE.Quaternion()
  private v = new THREE.Vector3()
  private yawOffset = 0 // +-2PI while a turn goes the long way, through Nexo's back
  private lastFacing: 1 | -1 = 1
  private raycaster = new THREE.Raycaster()
  // Bolt, the second robot, built on first use.
  private rival: Rig | null = null
  private rivalJoints: JointPose | null = null
  private rivalYaw = 0
  private rivalColor = ''
  private rivalExpr = ''
  private nexoColor = ''
  private duoScale = 1

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      powerPreference: 'low-power', // stay off the dedicated GPU: it heats the laptop
    })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1.08
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    // Studio reflections give the glossy, toy-like highlights of the reference render.
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.5
    pmrem.dispose()

    this.scene.add(new THREE.HemisphereLight('#d6ecff', '#0b2a66', 0.9))
    const key = new THREE.DirectionalLight('#ffffff', 2.4)
    key.position.set(3, 6, 7)
    const rim = new THREE.DirectionalLight('#59b4ff', 3.2)
    rim.position.set(-5, 3, -6)
    const rim2 = new THREE.DirectionalLight('#6fd8ff', 2.0)
    rim2.position.set(5, 1, -4)
    this.scene.add(key, rim, rim2)

    this.rig = buildNexo()
    this.world.add(this.rig.root)
    // Floor props live in world space so they stay put while Nexo turns and moves.
    const { pool, ladder, disco, bar, impact } = this.rig.props
    this.world.add(pool, ladder, disco, bar, impact)
    this.scene.add(this.world)
  }

  /** Match the canvas to the window and frame the camera for the pet size. */
  resize(size: number) {
    const { width, height } = windowSizeFor(size)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(width, height, false)
    const unitsPerPx = HEIGHT / size
    const visible = height * unitsPerPx
    this.camera.aspect = width / height
    this.camera.fov = 2 * Math.atan(visible / 2 / FOV_DISTANCE) / DEG
    const centreY = -FEET_MARGIN * HEIGHT + visible / 2
    this.centreY = centreY
    this.discoTop = centreY + visible / 2
    this.camera.position.set(0, centreY, FOV_DISTANCE)
    this.camera.lookAt(0, centreY, 0)
    this.camera.updateProjectionMatrix()
  }

  private grip = new THREE.Vector3()

  /** Window-space CSS px of the right hand's grip point (where the rope attaches). */
  private gripPoint() {
    const el = this.renderer.domElement
    this.rig.root.updateMatrixWorld(true)
    this.rig.handR.localToWorld(this.grip.set(0, -0.06, 0.02))
    this.grip.project(this.camera)
    return { x: ((this.grip.x + 1) / 2) * el.clientWidth, y: ((1 - this.grip.y) / 2) * el.clientHeight }
  }

  /** Renders a frame; returns the rope grip point when a rope is out. */
  render(f: Frame, dt: number): { x: number; y: number } | null {
    const r = this.rig
    const { pose } = f
    const target = f.joints ?? limbs(f.state, f.t, { fidget: f.fidget, dragging: f.dragging })
    const j = (this.joints ??= structuredClone(target))
    easeJoints(j, target, 1 - Math.exp(-dt * 14))

    // Ceiling: rotate the whole world 180 degrees about the frame centre, so the feet land
    // where the window top is. Eased, so rounding a corner reads as a flip.
    const flipTarget = f.surface === 'ceiling' ? Math.PI : 0
    this.flip += (flipTarget - this.flip) * (1 - Math.exp(-dt * (f.surface === 'air' ? 5 : 8)))
    this.world.rotation.z = this.flip
    // Shrink everything about the feet while Bolt is on screen.
    const duoTarget = f.duo && !f.dragging ? DUO_SCALE : 1
    this.duoScale += (duoTarget - this.duoScale) * (1 - Math.exp(-dt * 5))
    this.world.scale.setScalar(this.duoScale)
    this.world.position.set(this.centreY * Math.sin(this.flip), this.centreY * (1 - Math.cos(this.flip)), 0)
    // Upside down, screen-left and screen-right swap.
    const facing = (Math.cos(this.flip) < 0 ? -f.facing : f.facing) as 1 | -1

    // Turning to face the walking direction is eased separately so direction changes read
    // as Nexo turning around. About half of the turns go the long way, showing the back.
    if (facing !== this.lastFacing) {
      if (Math.random() < 0.5 && this.yawOffset === 0) this.yawOffset = facing < 0 ? 2 * Math.PI : -2 * Math.PI
      this.lastFacing = facing
    }
    const facingYaw = facing * (0.12 + 1.1 * j.turn) + this.yawOffset
    this.yaw += (facingYaw - this.yaw) * (1 - Math.exp(-dt * 6))
    if (this.yawOffset !== 0 && Math.abs(facingYaw - this.yaw) < 0.02) {
      this.yaw -= this.yawOffset
      this.yawOffset = 0
    }
    // Chair pops in (with a little overshoot) for seated states and shrinks away after.
    const seated = ['sitting', 'sleeping', 'chairDance', 'reading', 'laptop'].includes(f.state)
    const chairTarget = seated && !f.dragging ? 1 : 0
    this.chairScale += (chairTarget - this.chairScale) * (1 - Math.exp(-dt * (chairTarget ? 9 : 14)))
    const pop = chairTarget ? 1 + 0.12 * Math.sin(Math.min(1, this.chairScale) * Math.PI) : 1
    r.chair.visible = this.chairScale > 0.02
    r.chair.scale.setScalar(Math.max(0.001, this.chairScale * pop))
    // The chair stays put while Nexo bobs; undo the spin yaw so it does not twirl.
    r.chair.rotation.y = -target.yaw

    r.root.rotation.y = this.yaw + target.yaw
    r.root.position.set(pose.x * HEIGHT * facing, -pose.y * HEIGHT, 0)
    r.lean.rotation.z = -pose.rot * DEG * facing + j.tilt
    r.lean.scale.set(pose.sx, pose.sy, pose.sx)
    setJoints(r, j)
    this.renderRival(f.dragging ? null : f.duo, facing, dt)

    this.updateProps(f, dt, facing)
    this.renderer.render(this.scene, this.camera)
    return f.rope ? this.gripPoint() : null
  }

  /** Show the prop for the current activity; keep hand props upright and animate watering. */
  /** Bolt: placed relative to Nexo's facing side, turned toward Nexo unless running off. */
  private renderRival(d: DuoFrame | null, facing: 1 | -1, dt: number) {
    const on = !!d?.rival.on
    if (!on && !this.rival?.root.visible) return
    if (!this.rival) {
      this.rival = buildNexo()
      this.world.add(this.rival.root)
      this.syncRivalColor()
    }
    const r = this.rival
    r.root.visible = on
    if (!d || !on) {
      this.rivalJoints = null
      return
    }
    const b = d.rival
    const j = (this.rivalJoints ??= structuredClone(b.joints))
    easeJoints(j, b.joints, 1 - Math.exp(-dt * 16))
    const rf = b.away ? facing : -facing
    const want = rf * (0.12 + 1.1 * j.turn)
    this.rivalYaw += (want - this.rivalYaw) * (1 - Math.exp(-dt * 8))
    r.root.rotation.y = this.rivalYaw + b.joints.yaw
    r.root.position.set(b.x * facing, b.y, b.z)
    r.root.scale.setScalar(RIVAL_SCALE)
    r.lean.rotation.z = -b.lean * DEG * rf + j.tilt
    r.lean.scale.set(b.sx, b.sy, b.sx)
    setJoints(r, j)
    if (b.expr !== this.rivalExpr) {
      this.rivalExpr = b.expr
      r.face.set(b.expr)
    }
  }

  /** Bolt wears blue, or orange when Nexo itself is blue. */
  private syncRivalColor() {
    if (!this.rival) return
    const c = this.nexoColor === 'blue' ? { base: '#ff7a1a', emissive: '#c2410c' } : { base: '#2a8cff', emissive: '#0a5ae6' }
    if (c.base === this.rivalColor) return
    this.rivalColor = c.base
    this.rival.setColor(c.base, c.emissive)
  }

  private updateProps(f: Frame, dt: number, facing: 1 | -1) {
    const p = this.rig.props
    const s = f.dragging ? 'idle' : f.state
    const after = (sec: number) => f.t > sec // props appear once the hand has moved into place
    const held: Partial<Record<string, THREE.Object3D>> = {
      watering: p.can,
      drinking: p.cup,
      eating: p.apple,
      brushing: p.brush,
    }
    for (const o of p.all) o.visible = false
    const hand = held[s]
    if (hand && after(0.25)) hand.visible = true
    if (s === 'reading' && after(0.5)) p.book.visible = true
    if (s === 'laptop' && after(0.5)) p.laptop.visible = true

    // Plant pops in for watering and grows while it is watered.
    const plantOn = s === 'watering'
    this.plantScale += ((plantOn ? 1 : 0) - this.plantScale) * (1 - Math.exp(-dt * 8))
    p.plant.visible = this.plantScale > 0.02
    p.plant.scale.setScalar(Math.max(0.001, this.plantScale))
    if (plantOn) {
      const grow = Math.min(1, Math.max(0, (f.t - 1.5) / 4.5))
      p.plantGrowth.scale.setScalar(0.75 + 0.45 * grow * grow * (3 - 2 * grow))
    }

    // Keep hand props upright in Nexo's frame, tilted for pouring / sipping.
    if (hand && hand.visible) {
      this.rig.root.updateMatrixWorld(true)
      let tilt = 0
      if (s === 'watering') tilt = 0.75 * Math.min(1, Math.max(0, (f.t - 1) / 0.5)) * Math.min(1, Math.max(0, (6.4 - f.t) / 0.5))
      if (s === 'drinking') tilt = -0.35 * Math.min(1, Math.max(0, (f.t - 0.9) / 0.4)) * Math.min(1, Math.max(0, (3.7 - f.t) / 0.4))
      hand.parent!.getWorldQuaternion(this.q).invert()
      this.rig.root.getWorldQuaternion(this.q2)
      hand.quaternion.copy(this.q.multiply(this.q2)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt))
    }

    this.updateSceneProps(f, dt, facing)

    // Water droplets: arc from the spout to the plant while pouring.
    const pouring = s === 'watering' && f.t > 1.4 && f.t < 6.2
    if (pouring) {
      this.rig.root.updateMatrixWorld(true)
      p.spoutTip.getWorldPosition(this.v)
      this.rig.root.worldToLocal(this.v)
    }
    p.droplets.forEach((d, i) => {
      d.visible = pouring
      if (!pouring) return
      const life = (f.t * 1.6 + i / p.droplets.length) % 1
      d.position.set(this.v.x + 0.03 * Math.sin(i * 7.1), this.v.y - 1.1 * life * life - 0.15 * life, this.v.z + 0.12 * life)
      d.visible = d.position.y > 0.45
      d.scale.set(1, 1.5, 1)
    })

    // Swimming splashes: little fountains around Nexo on each stroke and on the jump in.
    const splash = s === 'swimming' && f.t > SWIM.hopIn[1] - 0.1 && f.t < SWIM.swim[1]
    if (splash) {
      p.droplets.forEach((d, i) => {
        const life = (f.t * 1.3 + i / p.droplets.length) % 1
        const a = i * 2.4
        const r = 0.35 + 0.55 * life
        d.position.set(Math.cos(a) * (r + 0.3), 0.55 + 1.2 * life - 1.6 * life * life, Math.sin(a) * r * 0.5 + 0.35)
        d.scale.set(2, 2.6, 2)
        d.visible = d.position.y > 0.62
      })
    }
  }

  /** Pool, ladder and disco ball: pop in with a small overshoot, shrink away after. */
  private updateSceneProps(f: Frame, dt: number, facing: 1 | -1) {
    const p = this.rig.props
    const s = f.dragging ? 'idle' : f.state
    const d = f.dragging ? null : f.duo
    const want = {
      pool: s === 'swimming' && f.t < SWIM.hopOut[1] + 0.1,
      ladder: (s === 'ladder' && f.t < 9.2) || !!d?.ladder.on,
      disco: s === 'dancing',
      bar: !!d?.bar.on,
    }
    // Where the ladder stands: behind Nexo, or wherever a scene puts it.
    if (d?.ladder.on) this.ladderAt = { x: d.ladder.x * facing, z: d.ladder.z, scale: d.ladder.scale }
    else if (s === 'ladder') this.ladderAt = { x: 0, z: -0.62, scale: 1 }
    p.ladder.position.set(this.ladderAt.x, 0, this.ladderAt.z)
    if (d?.bar.on) p.bar.position.set(d.bar.x * facing, d.bar.y, -0.1)
    for (const key of ['pool', 'ladder', 'disco', 'bar'] as const) {
      const on = want[key] ? 1 : 0
      this.sceneScale[key] += (on - this.sceneScale[key]) * (1 - Math.exp(-dt * (on ? 9 : 12)))
      const v = this.sceneScale[key]
      const pop = on ? 1 + 0.1 * Math.sin(Math.min(1, v) * Math.PI) : 1
      p[key].visible = v > 0.02
      p[key].scale.setScalar(Math.max(0.001, v * pop * (key === 'ladder' ? this.ladderAt.scale : 1)))
    }

    // Comic "pow" where a punch lands.
    const hit = d?.impact.k ?? 0
    p.impact.visible = hit > 0.02
    if (p.impact.visible && d) {
      p.impact.position.set(d.impact.x * facing, d.impact.y, 0.6)
      p.impact.scale.setScalar(0.4 + 0.9 * hit)
      p.impact.rotation.z = hit * 0.6
    }

    // Ripples spread from Nexo and fade.
    p.ripples.forEach((r, i) => {
      const life = (f.t * 0.7 + i / p.ripples.length) % 1
      r.scale.setScalar(0.25 + 0.6 * life)
      ;(r.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - life)
    })

    // Disco ball drops from the top of the window and spins.
    if (p.disco.visible) {
      const drop = Math.min(1, f.t / 0.6)
      p.disco.position.set(0, this.discoTop - 0.15 - 0.45 * (1 - (1 - drop) ** 3), -0.4)
      p.discoBall.rotation.y = f.t * 1.6
    }
  }

  setColor(base: string, emissive: string) {
    this.rig.setColor(base, emissive)
    this.nexoColor = base === '#2a8cff' ? 'blue' : base
    this.syncRivalColor()
  }

  setExpression(state: Frame['state'], blink: boolean) {
    const e = EXPRESSION[state]
    this.rig.face.set(e === 'normal' && blink ? 'blink' : e)
  }

  /** Is the window-space point over Nexo's body? Used for click-through. */
  hit(clientX: number, clientY: number) {
    const el = this.renderer.domElement
    const ndc = new THREE.Vector2((clientX / el.clientWidth) * 2 - 1, -(clientY / el.clientHeight) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.camera)
    return this.raycaster.intersectObjects(this.rig.hitMeshes, false).length > 0
  }

  dispose() {
    this.rig.dispose()
    this.rival?.dispose()
    this.scene.environment?.dispose()
    this.renderer.dispose()
  }
}
