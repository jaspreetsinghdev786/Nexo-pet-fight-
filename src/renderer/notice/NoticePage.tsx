import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { NoticeData } from '../../../electron/shared'

const nexo = window.nexo
const SHOW_MS = 16000

/** The quote / shayari card Nexo pops up next to itself. */
export function NoticePage() {
  const [n, setN] = useState<NoticeData | null>(null)
  const [left, setLeft] = useState(SHOW_MS)
  const card = useRef<HTMLDivElement>(null)
  const hovered = useRef(false)

  useEffect(
    () =>
      nexo.onNotice((data) => {
        setN(data)
        setLeft(SHOW_MS)
      }),
    [],
  )

  // Tell the main process how tall the card is so the window fits it.
  useLayoutEffect(() => {
    if (n && card.current) nexo.noticeSize(Math.ceil(card.current.getBoundingClientRect().height) + 16)
  }, [n])

  // Auto-hide; hovering pauses the countdown so long shayari can be read.
  useEffect(() => {
    if (!n) return
    const id = window.setInterval(() => {
      if (hovered.current) return
      setLeft((l) => {
        if (l <= 100) {
          nexo.noticeClose()
          setN(null)
          return 0
        }
        return l - 100
      })
    }, 100)
    return () => window.clearInterval(id)
  }, [n])

  if (!n) return null
  return (
    <div className="p-2">
      <div
        ref={card}
        key={n.text}
        className="notice-card relative overflow-hidden rounded-[18px] px-4.5 pt-3.5 pb-4"
        onMouseEnter={() => (hovered.current = true)}
        onMouseLeave={() => (hovered.current = false)}
      >
        <div className="mb-2.5 flex items-center gap-2">
          <img src="./assets/icon.png" alt="" className="h-5 w-5" />
          <span className="notice-kind capitalize">{n.kind}</span>
          <button
            aria-label="Close"
            onClick={() => {
              nexo.noticeClose()
              setN(null)
            }}
            className="notice-close"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <p className="notice-text whitespace-pre-line">{n.text}</p>
        {n.author && <p className="notice-author mt-3 text-right">{n.author}</p>}
        <div
          className="notice-progress absolute bottom-0 left-0"
          style={{ width: `${(left / SHOW_MS) * 100}%`, transition: 'width 100ms linear' }}
        />
      </div>
    </div>
  )
}
