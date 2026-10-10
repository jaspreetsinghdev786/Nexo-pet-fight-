import { useEffect, useRef } from 'react'
import { BODY_COLORS, Rope, Settings } from '../../../electron/shared'
import { usePet } from '../store'
import { Brain } from './brain'
import { Stage } from './scene'

const nexo = window.nexo
const DRAG_THRESHOLD = 4
const DOUBLE_CLICK_MS = 280
const DEBUG = new URLSearchParams(location.search).has('debug')

export function Pet({ initial }: { initial: Settings }) {
  const settings = usePet((s) => s.settings) ?? initial
  const state = usePet((s) => s.state)
  const bubble = usePet((s) => s.bubble)
  const S = settings.size

  const canvas = useRef<HTMLCanvasElement>(null)
  const shadow = useRef<HTMLDivElement>(null)
  const dot = useRef<HTMLDivElement>(null)
  const brain = useRef<Brain | null>(null)
  const stage = useRef<Stage | null>(null)

  // Boot: 3D stage, bounds, behaviour engine, then the frame loop.
  useEffect(() => {
    let raf = 0
    let alive = true
    const offs: (() => void)[] = []
    const st = new Stage(canvas.current!)
    stage.current = st
    st.resize(initial.size)
    const paint = (s: Settings) => {
      const c = BODY_COLORS[s.color] ?? BODY_COLORS.orange
      st.setColor(c.base, c.emissive)
    }
    paint(initial)

    ;(async () => {
      const bounds = await nexo.getBounds()
      if (!alive) return
      const b = new Brain(initial, bounds, nexo.move, nexo.getIdleSeconds)
      brain.current = b
      // Two robots from the start: Bolt arrives and the endless battle begins.
      if (initial.autoBattle && !initial.paused) {
        const id = window.setTimeout(() => b.command('battle'), 2500)
        offs.push(() => window.clearTimeout(id))
      }

      offs.push(
        nexo.onCommand(async (s) => {
          // 'falling' is what the main process sends after the monitors changed: re-read the screens.
          if (s === 'falling') b.setBounds(await nexo.getBounds())
          b.command(s)
        }),
        nexo.onTestReminder(() => b.testReminder()),
        nexo.onBattleEnded(async () => b.battleEnded(await nexo.getBounds())),
        nexo.onSettings(async (s) => {
          const prev = usePet.getState().settings
          usePet.getState().set({ settings: s })
          b.setSettings(s)
          paint(s)
          if (prev?.size !== s.size) {
            st.resize(s.size)
            // The main process resized the window around Nexo's feet; re-read where we are.
            b.setBounds(await nexo.getBounds())
          }
        }),
        usePet.subscribe((s, p) => {
          if (s.state !== p.state || s.blink !== p.blink) st.setExpression(s.state, s.blink)
        }),
      )

      let ropeKey = ''
      let anchorX: number | null = null
      let last = performance.now()
      const tick = (now: number) => {
        const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
        last = now
        const f = b.update(dt)
        const hand = st.render(f, dt)
        let rope: Rope | null = null
        if (f.rope && hand) {
          const ex = f.win.x + hand.x
          const ey = f.win.y + hand.y
          // The rope hangs from where it was first thrown: up and out past the hand, so the
          // line clears Nexo's big head.
          const outward = Math.sign(hand.x - window.innerWidth / 2) || 1
          const target = ex + outward * (usePet.getState().settings?.size ?? initial.size) * 0.45
          // Follow slowly: the top of the rope drifts, the bottom stays in the hand.
          anchorX = anchorX === null ? target : anchorX + (target - anchorX) * Math.min(1, dt * 1.5)
          if (DEBUG && dot.current) dot.current.style.transform = `translate(${hand.x - 3}px, ${hand.y - 3}px)`
          rope = { x: anchorX + (ex - anchorX) * (1 - f.rope.k), top: ey + (f.rope.top - ey) * f.rope.k, xEnd: ex, bottom: ey }
        } else anchorX = null
        const key = rope ? [rope.x, rope.top, rope.xEnd, rope.bottom].map(Math.round).join(',') : ''
        if (key !== ropeKey) {
          ropeKey = key
          nexo.setRope(rope)
        }
        if (shadow.current) {
          const size = usePet.getState().settings?.size ?? initial.size
          const x = f.pose.x * size * f.facing
          shadow.current.style.transform = `translateX(calc(-50% + ${x}px)) scaleX(${f.pose.shadow})`
          shadow.current.style.opacity = f.pose.shadow === 0 || f.surface === 'ceiling' || f.surface === 'wall' ? '0' : String(0.25 + 0.3 * Math.min(1, f.pose.shadow))
        }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    })()

    return () => {
      nexo.setRope(null)
      alive = false
      cancelAnimationFrame(raf)
      offs.forEach((off) => off())
      st.dispose()
    }
  }, [initial])

  // Click-through everywhere except Nexo's body.
  useEffect(() => {
    let ignoring = true
    const setIgnore = (v: boolean) => {
      if (v === ignoring) return
      ignoring = v
      nexo.setIgnoreMouse(v)
    }
    const onMove = (e: MouseEvent) => {
      if (brain.current?.isDragging) return setIgnore(false)
      setIgnore(!stage.current?.hit(e.clientX, e.clientY))
    }
    const onLeave = () => {
      if (!brain.current?.isDragging) setIgnore(true)
    }
    window.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  // Click / double-click / drag.
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null)
  const clickTimer = useRef<number>(0)
  const lastClick = useRef(0)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return nexo.showMenu()
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    press.current = { x: e.screenX, y: e.screenY, dragging: false }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const p = press.current
    const b = brain.current
    if (!p || !b) return
    if (!p.dragging && Math.hypot(e.screenX - p.x, e.screenY - p.y) > DRAG_THRESHOLD) {
      p.dragging = true
      b.dragStart(p.x, p.y)
    }
    if (p.dragging) b.dragMove(e.screenX, e.screenY)
  }

  const onPointerUp = async (e: React.PointerEvent) => {
    const p = press.current
    press.current = null
    const b = brain.current
    if (!p || !b) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (p.dragging) return b.dragEnd(await nexo.dragEnd())

    const now = performance.now()
    if (now - lastClick.current < DOUBLE_CLICK_MS) {
      window.clearTimeout(clickTimer.current)
      lastClick.current = 0
      b.doubleClick()
    } else {
      lastClick.current = now
      clickTimer.current = window.setTimeout(() => b.click(), DOUBLE_CLICK_MS)
    }
  }

  return (
    <div
      className="relative h-screen w-screen select-none overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={shadow}
        className="pet-shadow absolute left-1/2"
        style={{ bottom: S * 0.025, width: S * 0.62, height: S * 0.08 }}
      />
      <canvas ref={canvas} className="pet-canvas absolute inset-0 h-full w-full" />
      {DEBUG && <div ref={dot} className="pointer-events-none absolute top-0 left-0 h-1.5 w-1.5 rounded-full bg-red-600" />}
      {(state === 'floating' || state === 'meditating') && <div className="hover-glow absolute left-1/2" style={{ bottom: S * 0.02, width: S * 0.5, height: S * 0.12 }} />}
      {bubble && (
        <div className="speech absolute left-1/2 top-1" style={{ fontSize: Math.max(10, S * 0.095), maxWidth: S * 1.45 }}>
          {bubble}
        </div>
      )}
      {state === 'thinking' && (
        <div className="think absolute" style={{ left: '64%', bottom: S * 1.05, fontSize: S * 0.1 }}>
          <span />
          <span />
          <span />
        </div>
      )}
      {state === 'sleeping' && (
        <div className="zzz absolute" style={{ left: '62%', bottom: S * 1.0, fontSize: S * 0.16 }}>
          <span>Z</span>
          <span>z</span>
          <span>z</span>
        </div>
      )}
    </div>
  )
}
