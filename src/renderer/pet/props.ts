import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

// Hand-held and floor props for everyday activities. Same toy-like finish as Nexo:
// glossy clearcoat, rounded shapes, cyan accent lights. Hand props are authored around a
// grip point at their origin, with +y up and +z pointing away from Nexo (the renderer keeps
// them upright in Nexo's frame whatever the arm is doing).

const gloss = (color: string, extra: Partial<THREE.MeshPhysicalMaterialParameters> = {}) =>
  new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.1, ...extra })

export interface Props {
  plant: THREE.Group // floor, in front of Nexo
  plantGrowth: THREE.Group // scaled as it is watered
  can: THREE.Group
  spoutTip: THREE.Object3D
  cup: THREE.Group
  apple: THREE.Group
  brush: THREE.Group
  book: THREE.Group
  laptop: THREE.Group
  droplets: THREE.Mesh[]
  /** Scene-level props: stand on the floor in world space, popped in and out by the renderer. */
  pool: THREE.Group
  ripples: THREE.Mesh[]
  ladder: THREE.Group
  disco: THREE.Group
  discoBall: THREE.Mesh
  bar: THREE.Group // hanging bar Bolt gets stuck on in the rescue
  impact: THREE.Group // comic "pow" star when a punch lands
  all: THREE.Object3D[]
  dispose(): void
}

export function buildProps(glow: THREE.Material): Props {
  const mats: THREE.Material[] = []
  const mat = <T extends THREE.Material>(m: T) => (mats.push(m), m)
  const navy = mat(gloss('#26304d'))
  const white = mat(gloss('#eef4ff', { roughness: 0.25 }))
  const leaf = mat(gloss('#3ccf6b', { roughness: 0.45, clearcoat: 0.4 }))
  const stem = mat(gloss('#2a9d4f', { roughness: 0.6, clearcoat: 0 }))
  const soil = mat(new THREE.MeshStandardMaterial({ color: '#3b2a20', roughness: 1 }))
  const teal = mat(gloss('#2ec4d6'))
  const red = mat(gloss('#e5483c', { roughness: 0.25 }))
  const water = mat(new THREE.MeshPhysicalMaterial({ color: '#8fe3ff', roughness: 0.05, transmission: 0.2, clearcoat: 1 }))
  const screen = mat(new THREE.MeshBasicMaterial({ color: '#8fe9ff', toneMapped: false }))

  // ---- potted plant ----
  const plant = new THREE.Group()
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.26, 32), navy)
  pot.position.y = 0.13
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.022, 10, 40), glow)
  rim.rotation.x = Math.PI / 2
  rim.position.y = 0.26
  const dirt = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.02, 24), soil)
  dirt.position.y = 0.25
  const plantGrowth = new THREE.Group()
  plantGrowth.position.y = 0.26
  const leafGeo = new THREE.SphereGeometry(1, 20, 12)
  for (const [x, h, tilt, turn] of [
    [0, 0.34, 0, 0],
    [-0.05, 0.24, 0.5, 2.2],
    [0.06, 0.27, -0.45, -0.9],
  ]) {
    const s = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, h, 4, 8), stem)
    s.position.set(x, h / 2, 0)
    s.rotation.z = tilt * 0.4
    plantGrowth.add(s)
    const l = new THREE.Mesh(leafGeo, leaf)
    l.scale.set(0.11, 0.03, 0.06)
    l.position.set(x + Math.sin(tilt) * 0.08, h, 0)
    l.rotation.set(0, turn, tilt)
    plantGrowth.add(l)
  }
  const bud = new THREE.Mesh(leafGeo, mat(gloss('#ff7ab8')))
  bud.scale.setScalar(0.05)
  bud.position.y = 0.4
  plantGrowth.add(bud)
  plant.add(pot, rim, dirt, plantGrowth)

  // ---- watering can (grip = handle) ----
  const can = new THREE.Group()
  const canBody = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.2, 28), teal)
  canBody.position.set(0, -0.08, 0.15)
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.02, 10, 24, Math.PI * 1.3), navy)
  handle.position.set(0, -0.02, 0.03)
  handle.rotation.y = Math.PI / 2
  const spout = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.26, 4, 10), teal)
  spout.position.set(0, -0.02, 0.33)
  spout.rotation.x = Math.PI / 2 - 0.75
  const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.02, 0.05, 16), navy)
  rose.position.set(0, 0.07, 0.43)
  rose.rotation.x = Math.PI / 2 - 0.75
  const spoutTip = new THREE.Object3D()
  spoutTip.position.set(0, 0.09, 0.46)
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.012, 8, 32), glow)
  band.rotation.x = Math.PI / 2
  band.position.set(0, -0.08, 0.15)
  can.add(canBody, handle, spout, rose, band, spoutTip)

  // ---- cup of water ----
  const cup = new THREE.Group()
  const cupBody = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.062, 0.17, 24), white)
  cupBody.position.set(0, -0.02, 0.19)
  const surface = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.01, 24), water)
  surface.position.set(0, 0.05, 0.19)
  const cupBand = new THREE.Mesh(new THREE.TorusGeometry(0.073, 0.01, 8, 28), glow)
  cupBand.rotation.x = Math.PI / 2
  cupBand.position.set(0, -0.04, 0.19)
  cup.add(cupBody, surface, cupBand)

  // ---- apple ----
  const apple = new THREE.Group()
  const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.095, 24, 16), red)
  fruit.scale.set(1, 0.9, 1)
  fruit.position.set(0, 0, 0.17)
  const appleStem = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.04, 4, 6), stem)
  appleStem.position.set(0, 0.1, 0.17)
  const appleLeaf = new THREE.Mesh(leafGeo, leaf)
  appleLeaf.scale.set(0.04, 0.012, 0.022)
  appleLeaf.position.set(0.03, 0.11, 0.17)
  apple.add(fruit, appleStem, appleLeaf)

  // ---- toothbrush (points toward Nexo's mouth) ----
  const brush = new THREE.Group()
  const shaft = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.26, 4, 8), white)
  shaft.rotation.z = Math.PI / 2
  shaft.position.set(-0.1, 0, 0.17)
  const head = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.04, 0.035, 2, 0.01), teal)
  head.position.set(-0.25, 0.025, 0.17)
  const bristles = new THREE.Mesh(new RoundedBoxGeometry(0.065, 0.035, 0.03, 2, 0.008), white)
  bristles.position.set(-0.25, 0.06, 0.17)
  brush.add(shaft, head, bristles)

  // ---- open book (held in front of the chest) ----
  const book = new THREE.Group()
  for (const side of [-1, 1]) {
    const cover = new THREE.Mesh(new RoundedBoxGeometry(0.27, 0.36, 0.02, 2, 0.008), navy)
    cover.position.set(side * 0.13, 0, 0)
    cover.rotation.y = side * -0.25
    const pages = new THREE.Mesh(new RoundedBoxGeometry(0.25, 0.33, 0.02, 2, 0.006), white)
    pages.position.set(side * 0.125, 0, -0.018)
    pages.rotation.y = side * -0.25
    book.add(cover, pages)
  }
  const spine = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.32, 4, 8), glow)
  spine.position.z = 0.01
  book.add(spine)

  // ---- laptop (on the lap; lid faces Nexo) ----
  const laptop = new THREE.Group()
  const base = new THREE.Mesh(new RoundedBoxGeometry(0.56, 0.035, 0.38, 3, 0.012), navy)
  const lid = new THREE.Group()
  lid.position.set(0, 0.015, 0.19)
  lid.rotation.x = 0.35
  const lidShell = new THREE.Mesh(new RoundedBoxGeometry(0.56, 0.37, 0.025, 3, 0.012), navy)
  lidShell.position.y = 0.185
  const display = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.31), screen)
  display.position.set(0, 0.185, -0.014)
  display.rotation.y = Math.PI
  const logo = new THREE.Mesh(new THREE.CapsuleGeometry(0.01, 0.06, 4, 6), glow)
  logo.position.set(0, 0.19, 0.014)
  logo.rotation.z = 0.7
  lid.add(lidShell, display, logo)
  laptop.add(base, lid)

  // ---- water droplets ----
  const dropGeo = new THREE.SphereGeometry(0.022, 10, 8)
  const droplets = Array.from({ length: 10 }, () => {
    const d = new THREE.Mesh(dropGeo, glow)
    d.scale.set(1, 1.5, 1)
    d.visible = false
    return d
  })

  // ---- inflatable pool (Nexo stands in the middle; the front ring hides its legs) ----
  const pool = new THREE.Group()
  const ringBlue = mat(gloss('#2f8fff', { roughness: 0.2 }))
  const ringWhite = mat(gloss('#f2f7ff', { roughness: 0.2 }))
  for (const [y, m] of [
    [0.19, ringBlue],
    [0.5, ringWhite],
  ] as const) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.2, 18, 72), m)
    ring.rotation.x = Math.PI / 2
    ring.position.y = y
    pool.add(ring)
  }
  const poolTrim = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.022, 8, 72), glow)
  poolTrim.rotation.x = Math.PI / 2
  poolTrim.position.y = 0.71
  const poolFloor = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.04, 48), ringBlue)
  poolFloor.position.y = 0.02
  const poolWater = mat(
    new THREE.MeshPhysicalMaterial({ color: '#57d2f2', roughness: 0.08, clearcoat: 1, transparent: true, opacity: 0.82, depthWrite: false }),
  )
  const waterTop = new THREE.Mesh(new THREE.CircleGeometry(1.18, 48), poolWater)
  waterTop.rotation.x = -Math.PI / 2
  waterTop.position.y = 0.6
  waterTop.renderOrder = 1
  pool.add(poolTrim, poolFloor, waterTop)
  const rippleMat = mat(new THREE.MeshBasicMaterial({ color: '#c9f6ff', transparent: true, depthWrite: false, toneMapped: false }))
  const ripples = Array.from({ length: 2 }, () => {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), rippleMat.clone())
    mats.push(r.material as THREE.Material)
    r.rotation.x = -Math.PI / 2
    r.position.y = 0.61
    r.renderOrder = 2
    pool.add(r)
    return r
  })

  // ---- ladder (behind Nexo; rungs 0.3 apart = one climbing step) ----
  const ladder = new THREE.Group()
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new RoundedBoxGeometry(0.1, 2.95, 0.1, 3, 0.04), navy)
    rail.position.set(side * 0.62, 1.47, 0)
    const strip = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 2.6, 4, 8), glow)
    strip.position.set(side * 0.62, 1.47, 0.052)
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.06, 16), navy)
    foot.position.set(side * 0.62, 0.03, 0)
    ladder.add(rail, strip, foot)
  }
  const rungGeo = new THREE.CylinderGeometry(0.038, 0.038, 1.2, 14)
  for (let i = 1; i <= 9; i++) {
    const rung = new THREE.Mesh(rungGeo, white)
    rung.rotation.z = Math.PI / 2
    rung.position.y = i * 0.3
    ladder.add(rung)
  }

  // ---- disco ball (hangs from the top of the window while Nexo dances) ----
  const disco = new THREE.Group()
  const mirror = mat(new THREE.MeshStandardMaterial({ color: '#dfe9ff', metalness: 1, roughness: 0.15, flatShading: true }))
  const discoBall = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 2), mirror)
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.6, 6), navy)
  cord.position.y = 0.6
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.07, 12), glow)
  cap.position.y = 0.35
  disco.add(discoBall, cord, cap)

  // ---- hanging bar ----
  const bar = new THREE.Group()
  const pole = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 1.3, 4, 12), navy)
  pole.rotation.z = Math.PI / 2
  const poleLight = new THREE.Mesh(new THREE.CapsuleGeometry(0.015, 1.2, 4, 8), glow)
  poleLight.rotation.z = Math.PI / 2
  poleLight.position.z = 0.05
  bar.add(pole, poleLight)
  for (const side of [-1, 1]) {
    const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.4, 6), navy)
    hanger.position.set(side * 0.6, 0.7, 0)
    bar.add(hanger)
  }

  // ---- impact star ----
  const impact = new THREE.Group()
  const pow = mat(new THREE.MeshBasicMaterial({ color: '#ffe066', toneMapped: false }))
  const powCore = mat(new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }))
  for (let i = 0; i < 8; i++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, i % 2 ? 0.28 : 0.42, 4), pow)
    const a = (i / 8) * Math.PI * 2
    spike.position.set(Math.sin(a) * 0.14, Math.cos(a) * 0.14, 0)
    spike.rotation.z = -a
    impact.add(spike)
  }
  impact.add(new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), powCore))

  const all = [plant, can, cup, apple, brush, book, laptop]
  for (const o of all) o.visible = false
  for (const o of [pool, ladder, disco, bar, impact]) {
    o.visible = false
    o.scale.setScalar(0.001)
  }

  return {
    plant,
    plantGrowth,
    can,
    spoutTip,
    cup,
    apple,
    brush,
    book,
    laptop,
    droplets,
    pool,
    ripples,
    ladder,
    disco,
    discoBall,
    bar,
    impact,
    all,
    dispose() {
      for (const o of [...all, ...droplets, pool, ladder, disco, bar, impact]) {
        o.traverse((c) => {
          const mesh = c as THREE.Mesh
          if (mesh.isMesh) mesh.geometry.dispose()
        })
      }
      mats.forEach((m) => m.dispose())
    },
  }
}
