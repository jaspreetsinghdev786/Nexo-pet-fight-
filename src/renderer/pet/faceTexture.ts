import * as THREE from 'three'
import type { Expression } from './poses'

// The face screen: one curved panel laid flush on the front of the cloud head.
// Two canvas textures: `base` paints the dark glass and the cyan rim (alpha cuts the rounded
// corners), `glow` is the emissive layer with the rim and the facial features.
// Features are authored in a 100 x 60 "screen space" matching the reference art: eyes high
// and wide apart, small smile, "///" blush marks on happy faces.

const CORE = '#d2faff'
const GLOW = '#38dcff'
const EYES = { l: 27, r: 73, y: 27 }
const PX = 5.12 // canvas pixels per screen unit
const RIM = 2.6 // rim thickness, screen units
const PAD = 4 // margin around the screen inside the canvas for the glow halo

export class FaceScreen {
  readonly mesh: THREE.Mesh
  private base = document.createElement('canvas')
  private glow = document.createElement('canvas')
  private glowTex: THREE.CanvasTexture
  private current: Expression | null = null

  /** surfaceZ(x, y) gives the head's front surface depth in the panel's parent space. */
  constructor(width: number, height: number, cx: number, cy: number, surfaceZ: (x: number, y: number) => number) {
    for (const c of [this.base, this.glow]) {
      c.width = (100 + PAD * 2) * PX
      c.height = (60 + PAD * 2) * PX
    }
    // Panel covers screen + padding; bend every vertex onto the head surface.
    const sx = width / 100
    const sy = height / 60
    const geo = new THREE.PlaneGeometry((100 + PAD * 2) * sx, (60 + PAD * 2) * sy, 64, 40)
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cx
      const y = pos.getY(i) + cy
      pos.setXYZ(i, x, y, surfaceZ(x, y) + 0.012)
    }
    geo.computeVertexNormals()

    this.paintBase()
    const baseTex = new THREE.CanvasTexture(this.base)
    baseTex.colorSpace = THREE.SRGBColorSpace
    this.glowTex = new THREE.CanvasTexture(this.glow)
    this.glowTex.colorSpace = THREE.SRGBColorSpace
    for (const t of [baseTex, this.glowTex]) t.anisotropy = 4

    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshPhysicalMaterial({
        map: baseTex,
        emissiveMap: this.glowTex,
        emissive: new THREE.Color('#ffffff'),
        emissiveIntensity: 1.5,
        roughness: 0.2,
        metalness: 0,
        clearcoat: 0.6,
        clearcoatRoughness: 0.12,
        envMapIntensity: 0.3, // keep studio reflections from reading as extra eyes
        transparent: true,
        alphaTest: 0.02,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    )
    this.set('normal')
  }

  private screenSpace(c: CanvasRenderingContext2D) {
    c.setTransform(PX, 0, 0, PX, PAD * PX, PAD * PX)
  }

  private paintBase() {
    const c = this.base.getContext('2d')!
    this.screenSpace(c)
    c.fillStyle = GLOW
    c.beginPath()
    c.roundRect(0, 0, 100, 60, 15)
    c.fill()
    const g = c.createLinearGradient(0, 0, 0, 60)
    g.addColorStop(0, '#0c1430')
    g.addColorStop(1, '#050817')
    c.fillStyle = g
    c.beginPath()
    c.roundRect(RIM, RIM, 100 - RIM * 2, 60 - RIM * 2, 13)
    c.fill()
  }

  set(expr: Expression) {
    if (expr === this.current) return
    this.current = expr
    const c = this.glow.getContext('2d')!
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.fillStyle = '#000'
    c.fillRect(0, 0, this.glow.width, this.glow.height)
    this.screenSpace(c)
    // Rim glow.
    c.strokeStyle = GLOW
    c.lineWidth = RIM * 0.9
    c.shadowColor = GLOW
    c.shadowBlur = 10
    c.beginPath()
    c.roundRect(RIM / 2, RIM / 2, 100 - RIM, 60 - RIM, 14)
    c.stroke()

    c.lineCap = 'round'
    c.lineJoin = 'round'
    c.strokeStyle = CORE
    c.fillStyle = CORE
    // Paint twice: the first pass builds up the glow halo, the second keeps the core crisp.
    for (let pass = 0; pass < 2; pass++) {
      c.shadowBlur = pass === 0 ? 22 : 8
      draw(c, expr)
    }
    this.glowTex.needsUpdate = true
  }

  dispose() {
    const m = this.mesh.material as THREE.MeshPhysicalMaterial
    m.map?.dispose()
    this.glowTex.dispose()
    m.dispose()
    this.mesh.geometry.dispose()
  }
}

function stroke(c: CanvasRenderingContext2D, width: number, path: (c: CanvasRenderingContext2D) => void) {
  c.lineWidth = width
  c.beginPath()
  path(c)
  c.stroke()
}

function fill(c: CanvasRenderingContext2D, path: (c: CanvasRenderingContext2D) => void) {
  c.beginPath()
  path(c)
  c.fill()
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  fill(c, (c) => c.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2)))
}

function arcEye(c: CanvasRenderingContext2D, cx: number) {
  stroke(c, 4.4, (c) => {
    c.moveTo(cx - 8, EYES.y + 4)
    c.quadraticCurveTo(cx, EYES.y - 9, cx + 8, EYES.y + 4)
  })
}

function openSmile(c: CanvasRenderingContext2D) {
  fill(c, (c) => {
    c.moveTo(41, 42)
    c.quadraticCurveTo(50, 56, 59, 42)
    c.closePath()
  })
}

function blush(c: CanvasRenderingContext2D) {
  c.save()
  c.globalAlpha = 0.7
  c.strokeStyle = GLOW
  for (const x0 of [11, 79]) {
    for (let i = 0; i < 3; i++) {
      const x = x0 + i * 4.2
      stroke(c, 1.8, (c) => {
        c.moveTo(x, 47)
        c.lineTo(x + 2.4, 43)
      })
    }
  }
  c.restore()
}

function draw(c: CanvasRenderingContext2D, expr: Expression) {
  switch (expr) {
    case 'normal':
    case 'blink':
    case 'focused': {
      const h = expr === 'blink' ? 2.4 : expr === 'focused' ? 9 : 15
      for (const cx of [EYES.l, EYES.r]) roundRect(c, cx - 5.5, EYES.y - h / 2, 11, h, 5.5)
      if (expr === 'focused') {
        stroke(c, 3.2, (c) => {
          c.moveTo(44, 46)
          c.lineTo(56, 46)
        })
      } else {
        stroke(c, 3.4, (c) => {
          c.moveTo(42, 43)
          c.quadraticCurveTo(50, 51, 58, 43)
        })
      }
      break
    }
    case 'happy':
      arcEye(c, EYES.l)
      arcEye(c, EYES.r)
      openSmile(c)
      blush(c)
      break
    case 'wink':
      // Nexo's signature look from the reference: ">" eye, arched eye, open smile.
      stroke(c, 4.6, (c) => {
        c.moveTo(EYES.l - 7, EYES.y - 8)
        c.lineTo(EYES.l + 7, EYES.y)
        c.lineTo(EYES.l - 7, EYES.y + 8)
      })
      arcEye(c, EYES.r)
      openSmile(c)
      blush(c)
      break
    case 'sleep':
      for (const cx of [EYES.l, EYES.r]) {
        stroke(c, 3.4, (c) => {
          c.moveTo(cx - 8, EYES.y + 1)
          c.quadraticCurveTo(cx, EYES.y + 8, cx + 8, EYES.y + 1)
        })
      }
      fill(c, (c) => c.ellipse(50, 45, 2.6, 2, 0, 0, Math.PI * 2))
      break
    case 'yawn':
      for (const cx of [EYES.l, EYES.r]) {
        stroke(c, 3.4, (c) => {
          c.moveTo(cx - 8, EYES.y + 1)
          c.quadraticCurveTo(cx, EYES.y + 7, cx + 8, EYES.y + 1)
        })
      }
      fill(c, (c) => c.ellipse(50, 46, 5, 6.5, 0, 0, Math.PI * 2))
      break
    case 'surprised':
      for (const cx of [EYES.l, EYES.r]) {
        stroke(c, 3.2, (c) => c.arc(cx, EYES.y, 9, 0, Math.PI * 2))
        fill(c, (c) => c.arc(cx, EYES.y, 3.4, 0, Math.PI * 2))
      }
      stroke(c, 3, (c) => c.ellipse(50, 46, 4, 5, 0, 0, Math.PI * 2))
      break
  }
}
