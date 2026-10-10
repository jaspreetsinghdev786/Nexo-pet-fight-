import { useEffect, useRef, useState } from 'react'
import { BattleInit, BODY_COLORS } from '../../../electron/shared'
import { BattleFrame, makeBattle, ROUND_END } from './battle'
import { makeBrawl } from './brawl'
import { ArenaStage } from './stage'

const nexo = window.nexo

/** Bolt wears blue, or orange when Nexo itself is blue. */
const boltColor = (c: BattleInit['color']) => (c === 'blue' ? BODY_COLORS.orange : BODY_COLORS.blue)

export function Arena() {
  const [init, setInit] = useState<BattleInit | null>(null)
  useEffect(() => nexo.onBattleInit(setInit), [])
  return init ? <Battle init={init} /> : null
}

function Battle({ init }: { init: BattleInit }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const flash = useRef<HTMLDivElement>(null)
  const [banner, setBanner] = useState<{ text: string; key: number } | null>(null)

  useEffect(() => {
    const { width: W, height: H } = init.world
    const view = init.view
    // Smaller than on the desktop: tiny fighters, lots of room to move.
    const S = Math.round(init.size * 0.8)
    const stage = new ArenaStage(canvas.current!, view.width, view.height, S, { n: BODY_COLORS[init.color] ?? BODY_COLORS.orange, b: boltColor(init.color) })
    // Battlefield -> this window. Screens differ in height: the floor stays put and the
    // ceiling is pulled to this screen's top edge.
    const pt = (p: { x: number; y: number }) => ({ x: p.x - view.x, y: p.y - (H - view.height) * (p.y / H) ** 2 })
    const toView = (f: BattleFrame): BattleFrame => ({
      ...f,
      n: { ...f.n, ...pt(f.n) },
      b: { ...f.b, ...pt(f.b) },
      rope: f.rope && { ...f.rope, anchor: pt(f.rope.anchor) },
      orb: f.orb && { ...f.orb, to: pt(f.orb.to) },
      beam: f.beam && { ...f.beam, clash: pt(f.beam.clash) },
    })
    // Every arena window reads the same clock, so they all show the same moment of the fight.
    const clock = () => performance.timeOrigin + performance.now()
    let round = 1
    // Two round scripts, played in turn.
    const make = (r: number, nx: number, bx: number | null) => (r % 2 ? makeBattle : makeBrawl)({ W, H, S, nx, bx, round: r })
    let battle = make(round, init.feetX, null)
    let roundStart = 0
    let next = 0
    let last = clock()
    let raf = 0
    let flashK = 0
    let done = false
    let stopping = false
    let nexoX = init.feetX
    const offStop = nexo.onBattleStop(() => (stopping = true))

    // Easy on the GPU: at most ~60 fps, and a screen with nothing on it is not redrawn.
    const inView = (x: number, margin: number) => x > -margin && x < view.width + margin
    let drawn = true
    const tick = () => {
      const now = clock()
      if (now - last < 1000 / 65) {
        raf = requestAnimationFrame(tick)
        return
      }
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now
      const elapsed = Math.max(0, (now - init.t0) / 1000)
      while (elapsed >= roundStart + ROUND_END) {
        // Next round: carry on from where both fighters stand.
        round++
        battle = make(round, battle.endN, battle.endB)
        roundStart += ROUND_END
        next = 0
      }
      const t = elapsed - roundStart
      const f = battle.frame(t)
      if (f.n.on && f.n.rot === 0 && f.n.y === 0) nexoX = f.n.x
      while (next < battle.events.length && battle.events[next].t <= t) {
        const e = battle.events[next++]
        if (e.fx) {
          const p = pt(e.fx.at(f))
          if (inView(p.x, 6 * S)) stage.fx(e.fx.kind, p.x, p.y, e.fx.who)
        }
        if (e.shake) stage.shake(e.shake)
        if (e.flash) flashK = Math.max(flashK, e.flash)
        if (e.banner) setBanner({ text: e.banner, key: e.t })
      }
      const v = toView(f)
      const live = (v.n.on && inView(v.n.x, 2 * S)) || (v.b.on && inView(v.b.x, 2 * S)) || !!v.rope || !!v.orb || !!v.beam || stage.busy
      // One more frame after the last thing leaves, to wipe the canvas.
      if (live || drawn) stage.render(v, dt)
      drawn = live
      flashK *= Math.exp(-dt * 9)
      if (flash.current) flash.current.style.opacity = String(flashK)
      if (stopping && !done) {
        done = true
        // Hand Nexo back where it last stood on the floor.
        nexo.battleDone(nexoX)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      offStop()
      cancelAnimationFrame(raf)
      stage.dispose()
    }
  }, [init])

  return (
    <div className="arena">
      <canvas ref={canvas} className="arena-canvas" />
      <div ref={flash} className="arena-flash" />
      {banner && (
        <div key={banner.key} className={`arena-banner ${banner.text.length > 8 ? 'is-long' : ''}`}>
          {banner.text}
        </div>
      )}
    </div>
  )
}
