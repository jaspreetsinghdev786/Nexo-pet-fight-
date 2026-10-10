import * as THREE from 'three'

// Nexo's cloud head as one smooth surface: a smooth union of lobes (signed distance field),
// sampled by shooting rays from the head centre through a dense sphere. One mesh means one
// continuous glossy highlight, like the reference render, instead of a cluster of bubbles.

type Lobe = { c: [number, number, number]; r: [number, number, number] }

const LOBES: Lobe[] = [
  { c: [0, 0.6, 0], r: [0.8, 0.6, 0.56] }, // core
  { c: [0, 0.3, 0.02], r: [0.74, 0.32, 0.5] }, // chin
  { c: [-0.4, 1.02, -0.03], r: [0.39, 0.39, 0.39] }, // top puffs
  { c: [0.1, 1.14, -0.05], r: [0.43, 0.43, 0.43] },
  { c: [0.56, 0.95, -0.03], r: [0.36, 0.36, 0.36] },
  { c: [-0.8, 0.7, -0.02], r: [0.31, 0.31, 0.31] }, // side puffs
  { c: [0.82, 0.66, -0.02], r: [0.31, 0.31, 0.31] },
  { c: [-0.74, 0.36, 0], r: [0.27, 0.27, 0.27] },
  { c: [0.76, 0.34, 0], r: [0.27, 0.27, 0.27] },
]
const SMOOTH = 0.07
export const HEAD_CENTRE = new THREE.Vector3(0, 0.62, 0)

function ellipsoid(px: number, py: number, pz: number, l: Lobe) {
  const x = (px - l.c[0]) / l.r[0]
  const y = (py - l.c[1]) / l.r[1]
  const z = (pz - l.c[2]) / l.r[2]
  return (Math.sqrt(x * x + y * y + z * z) - 1) * Math.min(l.r[0], l.r[1], l.r[2])
}

function smin(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

export function cloudSdf(x: number, y: number, z: number) {
  let d = Infinity
  for (const l of LOBES) d = d === Infinity ? ellipsoid(x, y, z, l) : smin(d, ellipsoid(x, y, z, l), SMOOTH)
  return d
}

/** Distance from `origin` along unit `dir` to the surface (origin must be inside). */
function surfaceAlong(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) {
  let lo = 0
  let hi = 2.5
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2
    if (cloudSdf(ox + dx * mid, oy + dy * mid, oz + dz * mid) < 0) lo = mid
    else hi = mid
  }
  return lo
}

export function cloudGeometry() {
  const geo = new THREE.SphereGeometry(1, 128, 96)
  const pos = geo.attributes.position
  const c = HEAD_CENTRE
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i)
    const dy = pos.getY(i)
    const dz = pos.getZ(i)
    const t = surfaceAlong(c.x, c.y, c.z, dx, dy, dz)
    pos.setXYZ(i, c.x + dx * t, c.y + dy * t, c.z + dz * t)
  }
  geo.computeVertexNormals()
  return geo
}

/** z of the head's front surface at (x, y), for laying the face screen flush on it. */
export function frontZ(x: number, y: number) {
  let lo = 0
  let hi = 1.5
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2
    if (cloudSdf(x, y, mid) < 0) lo = mid
    else hi = mid
  }
  return lo
}

/** x of the head's side surface at height y (positive side). */
export function sideX(y: number, z = 0) {
  return surfaceAlong(0, y, z, 1, 0, 0)
}
