import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { JointPose } from '../pet/limbs'
import { buildNexo, HEIGHT, Rig } from '../pet/model'
import { Actor, BattleFrame, BOLT_SCALE, COLORS, FxKind } from './battle'

// Full-screen WebGL stage for the battle. Orthographic camera, 1 world unit = 1 CSS px,
// origin at the bottom-left of the work area, y up.

const DEG = Math.PI / 180

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

/** One robot on screen: a holder (position + surface rotation) around a Nexo rig. */
class Fighter {
  readonly holder = new THREE.Group()
  readonly rig: Rig
  private joints: JointPose | null = null
  private yaw = 0
  private expr = ''
  constructor(
    private px: number, // px per model unit
    private z: number, // depth, so the two never intersect
    color: { base: string; emissive: string },
  ) {
    this.rig = buildNexo()
    this.rig.setColor(color.base, color.emissive)
    this.holder.add(this.rig.root)
  }

  update(a: Actor, dt: number) {
    const r = this.rig
    this.holder.visible = a.on
    if (!a.on) return
    const j = (this.joints ??= structuredClone(a.joints))
    easeJoints(j, a.joints, 1 - Math.exp(-dt * 18))
    const want = a.facing * (0.12 + 1.1 * j.turn)
    this.yaw += (want - this.yaw) * (1 - Math.exp(-dt * 12))
    this.holder.position.set(a.x, a.y, this.z)
    this.holder.rotation.z = a.rot
    this.holder.scale.setScalar(this.px)
    r.root.rotation.y = this.yaw + a.joints.yaw
    r.lean.rotation.z = -a.lean * DEG * a.facing + j.tilt
    r.lean.scale.set(a.sx, a.sy, a.sx)
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
    if (a.expr !== this.expr) {
      this.expr = a.expr
      r.face.set(a.expr)
    }
  }

  hand(out: THREE.Vector3) {
    this.holder.updateMatrixWorld(true)
    return this.rig.handR.localToWorld(out.set(0, -0.08, 0.04))
  }

  dispose() {
    this.rig.dispose()
  }
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  g: number
  color: THREE.Color
}

interface Ring {
  mesh: THREE.Mesh
  life: number
  max: number
  from: number
  to: number
}

const MAX_PARTICLES = 700

export class ArenaStage {
  readonly renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.OrthographicCamera
  readonly n: Fighter
  readonly b: Fighter
  private W: number
  private H: number
  private S: number

  private particles: Particle[] = []
  private dots: THREE.InstancedMesh
  private rings: Ring[] = []
  private stars: { mesh: THREE.Group; life: number }[] = []
  private shakeAmp = 0
  private v = new THREE.Vector3()
  private v2 = new THREE.Vector3()
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private c = new THREE.Color()

  private rope: THREE.Mesh
  private orbCore: THREE.Mesh
  private orbHalo: THREE.Mesh
  private orbFrom = new THREE.Vector3()
  private beams: { core: THREE.Mesh; glow: THREE.Mesh }[]
  private clashBall: THREE.Mesh
  private disposables: { dispose(): void }[] = []

  constructor(canvas: HTMLCanvasElement, W: number, H: number, size: number, colors: { n: { base: string; emissive: string }; b: { base: string; emissive: string } }) {
    this.W = W
    this.H = H
    this.S = size
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'low-power' })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.setSize(W, H, false)
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1.08
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

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

    this.camera = new THREE.OrthographicCamera(0, W, H, 0, 1, 4000)
    this.camera.position.set(0, 0, 2000)

    const px = size / HEIGHT
    this.n = new Fighter(px, 0, colors.n)
    this.b = new Fighter(px * BOLT_SCALE, -200, colors.b)
    this.scene.add(this.n.holder, this.b.holder)

    // Particles: one instanced mesh of glowing beads that shrink as they die.
    const dotGeo = new THREE.IcosahedronGeometry(1, 1)
    const dotMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false })
    this.dots = new THREE.InstancedMesh(dotGeo, dotMat, MAX_PARTICLES)
    this.dots.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.dots.count = 0
    this.dots.frustumCulled = false
    this.dots.position.z = 600
    this.scene.add(this.dots)
    this.disposables.push(dotGeo, dotMat)

    const glow = (color: string, opacity = 1) => {
      const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: opacity < 1, opacity, depthWrite: opacity === 1 })
      this.disposables.push(mat)
      return mat
    }
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true)
    const ball = new THREE.SphereGeometry(1, 24, 16)
    this.disposables.push(cyl, ball)

    this.rope = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10), glow('#c9f8ff'))
    this.rope.visible = false
    this.orbCore = new THREE.Mesh(ball, glow('#ffffff'))
    this.orbHalo = new THREE.Mesh(ball, glow(COLORS.n, 0.45))
    this.orbCore.visible = this.orbHalo.visible = false
    this.beams = (['n', 'b'] as const).map((w) => ({
      core: new THREE.Mesh(cyl, glow('#ffffff')),
      glow: new THREE.Mesh(cyl, glow(COLORS[w], 0.5)),
    }))
    this.clashBall = new THREE.Mesh(ball, glow('#fff6c8'))
    this.clashBall.visible = false
    this.scene.add(this.rope, this.orbCore, this.orbHalo, this.clashBall)
    for (const bm of this.beams) {
      bm.core.visible = bm.glow.visible = false
      this.scene.add(bm.core, bm.glow)
    }
    for (const o of [this.rope, this.orbCore, this.orbHalo, this.clashBall]) o.position.z = 500
  }

  // ---------- effects ----------

  private spawn(x: number, y: number, n: number, opts: { speed: [number, number]; size: [number, number]; life: [number, number]; colors: string[]; g?: number; up?: boolean; spread?: number }) {
    const r = (a: number, b: number) => a + Math.random() * (b - a)
    for (let i = 0; i < n && this.particles.length < MAX_PARTICLES; i++) {
      const a = opts.up ? Math.PI / 2 + r(-1, 1) * (opts.spread ?? 0.5) : r(0, Math.PI * 2)
      const sp = r(...opts.speed) * (this.S / 110)
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0,
        max: r(...opts.life),
        size: r(...opts.size) * (this.S / 110),
        g: (opts.g ?? 0) * (this.S / 110),
        color: new THREE.Color(opts.colors[i % opts.colors.length]),
      })
    }
  }

  private ring(x: number, y: number, color: string, to: number, life = 0.45, width = 0.12) {
    const geo = new THREE.RingGeometry(1 - width, 1, 64)
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, toneMapped: false, depthWrite: false })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, y, 550)
    this.scene.add(mesh)
    this.rings.push({ mesh, life: 0, max: life, from: this.S * 0.1, to: this.S * to })
  }

  private star(x: number, y: number, scale: number) {
    const g = new THREE.Group()
    const pow = new THREE.MeshBasicMaterial({ color: '#ffe066', toneMapped: false })
    const core = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false })
    for (let i = 0; i < 10; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, i % 2 ? 0.32 : 0.5, 4), pow)
      const a = (i / 10) * Math.PI * 2
      spike.position.set(Math.sin(a) * 0.16, Math.cos(a) * 0.16, 0)
      spike.rotation.z = -a
      g.add(spike)
    }
    g.add(new THREE.Mesh(new THREE.CircleGeometry(0.14, 16), core))
    g.position.set(x, y, 650)
    g.rotation.z = Math.random()
    g.scale.setScalar((this.S / 3) * scale)
    g.userData.scale = (this.S / 3) * scale
    this.scene.add(g)
    this.stars.push({ mesh: g, life: 0 })
  }

  fx(kind: FxKind, x: number, y: number, who?: 'n' | 'b') {
    const col = who ? COLORS[who] : '#ffffff'
    switch (kind) {
      case 'tpOut':
      case 'tpIn':
        this.ring(x, y + this.S * 0.4, col, 1.1, 0.4, 0.1)
        this.ring(x, y + this.S * 0.4, '#ffffff', 0.6, 0.3, 0.2)
        this.spawn(x, y + this.S * 0.4, 40, { speed: [120, 420], size: [2, 5], life: [0.3, 0.7], colors: [col, '#ffffff'] })
        this.spawn(x, y, 24, { speed: [200, 600], size: [2, 4], life: [0.4, 0.8], colors: [col], up: true, spread: 0.25 })
        break
      case 'hit':
        this.star(x, y, 0.55)
        this.spawn(x, y, 18, { speed: [200, 600], size: [2, 4], life: [0.15, 0.35], colors: ['#ffe066', '#ffffff', '#ff9a3c'], g: -900 })
        break
      case 'bigHit':
        this.star(x, y, 1.0)
        this.ring(x, y, '#ffe066', 1.4, 0.4)
        this.spawn(x, y, 50, { speed: [300, 900], size: [2, 6], life: [0.2, 0.5], colors: ['#ffe066', '#ffffff', '#ff9a3c'], g: -900 })
        break
      case 'clash':
        this.star(x, y, 1.1)
        this.ring(x, y, '#ffffff', 2.2, 0.5, 0.06)
        this.ring(x, y, COLORS.n, 1.5, 0.4)
        this.spawn(x, y, 60, { speed: [300, 1000], size: [2, 5], life: [0.2, 0.5], colors: ['#ffffff', COLORS.n, COLORS.b] })
        break
      case 'boom':
        this.ring(x, y, '#ffffff', 3.2, 0.6, 0.05)
        this.ring(x, y, '#ffb347', 2.4, 0.55, 0.15)
        this.ring(x, y, '#ff5f3c', 1.6, 0.5, 0.3)
        this.spawn(x, y, 140, { speed: [200, 1300], size: [3, 9], life: [0.3, 0.9], colors: ['#ffffff', '#ffe066', '#ff9a3c', '#ff5f3c'], g: -500 })
        break
      case 'land':
        this.ring(x, y + 4, '#c9f6ff', 1.6, 0.45, 0.08)
        this.spawn(x, y + 4, 40, { speed: [150, 500], size: [3, 7], life: [0.3, 0.7], colors: ['#c8d3e6', '#8fa3c4', '#ffffff'], up: true, spread: 1.3, g: -1200 })
        break
      case 'wall':
        this.ring(x, y, '#ffffff', 1.8, 0.45, 0.08)
        this.spawn(x, y, 50, { speed: [200, 700], size: [2, 6], life: [0.3, 0.7], colors: ['#ffe066', '#c8d3e6', '#ffffff'], g: -1200 })
        break
      case 'power':
        this.ring(x, y, col, 1.8, 0.5, 0.08)
        this.spawn(x, y, 60, { speed: [100, 500], size: [2, 5], life: [0.4, 0.9], colors: [col, '#ffffff'], up: true, spread: 1.2 })
        break
    }
  }

  /** Effects still playing out: keep rendering even with no fighter in view. */
  get busy() {
    return this.particles.length > 0 || this.rings.length > 0 || this.stars.length > 0
  }

  shake(amount: number) {
    this.shakeAmp = Math.max(this.shakeAmp, amount)
  }

  // ---------- frame ----------

  render(f: BattleFrame, dt: number) {
    this.n.update(f.n, dt)
    this.b.update(f.b, dt)

    // Rope from the anchor to Nexo's hand.
    this.rope.visible = !!f.rope && f.n.on
    if (f.rope && this.rope.visible) {
      const hand = this.n.hand(this.v)
      const top = this.v2.set(f.rope.anchor.x, f.rope.anchor.y, 500)
      top.lerpVectors(hand, top, f.rope.k)
      this.placeBetween(this.rope, hand, top, this.S * 0.012)
    }

    // Energy orb: grows in the hand, then flies to its target.
    const orb = f.orb
    this.orbCore.visible = this.orbHalo.visible = !!orb
    if (orb) {
      const fighter = orb.who === 'n' ? this.n : this.b
      ;(this.orbHalo.material as THREE.MeshBasicMaterial).color.set(COLORS[orb.who])
      const pulse = 1 + 0.12 * Math.sin(performance.now() / 40)
      if (orb.phase === 'charge') {
        fighter.hand(this.orbFrom)
        this.orbCore.position.set(this.orbFrom.x, this.orbFrom.y, 500)
        const r = this.S * (0.05 + 0.12 * orb.k) * pulse
        this.orbCore.scale.setScalar(r * 0.55)
        this.orbHalo.scale.setScalar(r)
        if (Math.random() < 0.7) {
          const a = Math.random() * Math.PI * 2
          const d = this.S * 0.5
          this.spawn(this.orbFrom.x + Math.cos(a) * d, this.orbFrom.y + Math.sin(a) * d, 1, { speed: [10, 30], size: [2, 3], life: [0.2, 0.3], colors: [COLORS[orb.who]] })
        }
      } else {
        const x = this.orbFrom.x + (orb.to.x - this.orbFrom.x) * orb.k
        const y = this.orbFrom.y + (orb.to.y - this.orbFrom.y) * orb.k
        this.orbCore.position.set(x, y, 500)
        const r = this.S * 0.17 * pulse
        this.orbCore.scale.setScalar(r * 0.55)
        this.orbHalo.scale.setScalar(r)
        this.spawn(x, y, 3, { speed: [20, 80], size: [3, 7], life: [0.2, 0.4], colors: [COLORS[orb.who], '#ffffff'] })
      }
      this.orbHalo.position.copy(this.orbCore.position)
    }

    // Beams from both fighters' hands, meeting at the clash point.
    this.clashBall.visible = !!f.beam
    for (const [i, who] of (['n', 'b'] as const).entries()) {
      const bm = this.beams[i]
      bm.core.visible = bm.glow.visible = !!f.beam
      if (!f.beam) continue
      const from = (who === 'n' ? this.n : this.b).hand(this.v)
      const to = this.v2.set(f.beam.clash.x, f.beam.clash.y, 500)
      to.lerpVectors(from, to, f.beam.k)
      const flicker = 1 + 0.15 * Math.sin(performance.now() / 23 + i)
      this.placeBetween(bm.core, from, to, this.S * 0.045 * flicker)
      this.placeBetween(bm.glow, from, to, this.S * 0.11 * flicker)
      bm.core.position.z = 510 // bright core in front of the glow
    }
    if (f.beam) {
      const { x, y } = f.beam.clash
      this.clashBall.position.set(x, y, 520)
      this.clashBall.scale.setScalar(this.S * (0.14 + 0.05 * Math.sin(performance.now() / 30)) * f.beam.k)
      if (f.beam.k > 0.9) this.spawn(x, y, 6, { speed: [300, 900], size: [2, 5], life: [0.15, 0.35], colors: ['#ffffff', COLORS.n, COLORS.b, '#ffe066'] })
      this.shake(3)
    }

    // Charging aura: sparks rising around the fighter.
    for (const c of f.charge) {
      const a = c.who === 'n' ? f.n : f.b
      if (!a.on || Math.random() > 0.8) continue
      const n = Math.ceil(2 * c.k)
      for (let i = 0; i < n; i++) {
        const ox = (Math.random() - 0.5) * this.S * 0.8
        this.spawn(a.x + ox, a.y + Math.random() * this.S * 0.3, 1, { speed: [150, 400], size: [2, 4], life: [0.3, 0.6], colors: [COLORS[c.who], '#ffffff'], up: true, spread: 0.15 })
      }
    }

    this.updateFx(dt)

    // Screen shake: jitter the camera, decaying fast.
    this.shakeAmp *= Math.exp(-dt * 7)
    const s = this.shakeAmp * (this.S / 110)
    this.camera.position.set((Math.random() - 0.5) * 2 * s, (Math.random() - 0.5) * 2 * s, 2000)
    this.renderer.render(this.scene, this.camera)
  }

  /** Stretch a unit cylinder between two points. */
  private placeBetween(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, radius: number) {
    // Effects live on one flat layer: measure in the screen plane only.
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, 500)
    this.q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(b.x - a.x, b.y - a.y, 0).normalize())
    mesh.quaternion.copy(this.q)
    mesh.scale.set(radius, Math.max(0.001, len), radius)
  }

  private updateFx(dt: number) {
    // Particles
    let alive = 0
    for (const p of this.particles) {
      p.life += dt
      if (p.life >= p.max) continue
      p.vy += p.g * dt
      p.vx *= Math.exp(-dt * 2)
      p.vy *= Math.exp(-dt * 1)
      p.x += p.vx * dt
      p.y += p.vy * dt
      this.particles[alive++] = p
    }
    this.particles.length = alive
    for (let i = 0; i < alive; i++) {
      const p = this.particles[i]
      const k = 1 - p.life / p.max
      this.m.makeScale(p.size * k, p.size * k, p.size * k).setPosition(p.x, p.y, 0)
      this.dots.setMatrixAt(i, this.m)
      this.dots.setColorAt(i, this.c.copy(p.color))
    }
    this.dots.count = alive
    this.dots.instanceMatrix.needsUpdate = true
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true

    // Shockwave rings
    this.rings = this.rings.filter((r) => {
      r.life += dt
      const k = r.life / r.max
      if (k >= 1) {
        this.scene.remove(r.mesh)
        r.mesh.geometry.dispose()
        ;(r.mesh.material as THREE.Material).dispose()
        return false
      }
      r.mesh.scale.setScalar(r.from + (r.to - r.from) * (1 - (1 - k) ** 3))
      ;(r.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k
      return true
    })

    // Impact stars pop and vanish.
    this.stars = this.stars.filter((s) => {
      s.life += dt
      const k = s.life / 0.28
      if (k >= 1) {
        this.scene.remove(s.mesh)
        s.mesh.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (mesh.isMesh) {
            mesh.geometry.dispose()
            ;(mesh.material as THREE.Material).dispose()
          }
        })
        return false
      }
      s.mesh.scale.setScalar(s.mesh.userData.scale * (0.6 + 0.8 * Math.sin(Math.PI * Math.min(1, k * 1.4))))
      return true
    })
  }

  dispose() {
    this.n.dispose()
    this.b.dispose()
    this.rope.geometry.dispose()
    this.disposables.forEach((d) => d.dispose())
    this.scene.environment?.dispose()
    this.renderer.dispose()
  }
}
