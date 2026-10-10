import { useEffect, useState } from 'react'
import { ACTIONS, Activity, BODY_COLORS, BodyColor, Settings, SIZE_MAX, SIZE_MIN } from '../../../electron/shared'

const nexo = window.nexo

function Toggle({ label, hint, checked, onChange, disabled }: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className={`row flex items-center justify-between gap-4 py-3 ${disabled ? 'opacity-45' : 'cursor-pointer'}`}>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-[11.5px] leading-snug text-(--text-dim)">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="switch"
      />
    </label>
  )
}

function Section({ title, index, children }: { title: string; index: number; children: React.ReactNode }) {
  return (
    <section className="panel" style={{ '--i': index } as React.CSSProperties}>
      <h2 className="panel-title">{title}</h2>
      {children}
    </section>
  )
}

function SelectRow<T extends number>({ label, value, options, format, onChange }: {
  label: string
  value: T
  options: T[]
  format: (v: T) => string
  onChange: (v: T) => void
}) {
  return (
    <label className="row flex items-center justify-between gap-4 py-3">
      <span className="text-[13.5px] font-medium">{label}</span>
      <select value={value} onChange={(e) => onChange(Number(e.target.value) as T)} className="select">
        {options.map((m) => (
          <option key={m} value={m}>
            {format(m)}
          </option>
        ))}
      </select>
    </label>
  )
}

const ACTIVITY: { value: Activity; label: string }[] = [
  { value: 'calm', label: 'Calm' },
  { value: 'normal', label: 'Normal' },
  { value: 'lively', label: 'Lively' },
]

const SLEEP = [0, 1, 3, 5, 10, 30]
const QUOTE_EVERY = [0, 5, 10, 15, 30, 60]

export function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null)
  const [packaged, setPackaged] = useState(true)

  useEffect(() => {
    nexo.getSettings().then(setS)
    nexo.isPackaged().then(setPackaged)
    return nexo.onSettings(setS)
  }, [])

  if (!s) return null
  const set = (patch: Partial<Settings>) => {
    setS({ ...s, ...patch })
    nexo.setSettings(patch)
  }
  const sizeFill = ((s.size - SIZE_MIN) / (SIZE_MAX - SIZE_MIN)) * 100
  const activityPos = Math.max(0, ACTIVITY.findIndex((a) => a.value === s.activity))

  return (
    <main className="settings-scroll flex h-full flex-col gap-3.5 overflow-y-auto px-4 pt-5 pb-4">
      <header className="flex items-center gap-3.5 px-1 pb-1">
        <div className="hero-icon">
          <img src="./assets/icon.png" alt="Nexo" className="h-10 w-10" />
        </div>
        <div className="min-w-0">
          <h1 className="hero-title">Nexo</h1>
          <p className="mt-1.5 flex items-center gap-2 text-[12px] text-(--text-dim)">
            <span className={`status-dot ${s.paused ? 'is-paused' : ''}`} />
            {s.paused ? 'Resting in place' : 'Awake and roaming'} · works offline
          </p>
        </div>
      </header>

      <Section title="Appearance" index={0}>
        <div className="row py-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[13.5px] font-medium">Colour</span>
            <span className="text-[12px] text-(--text-dim)">{BODY_COLORS[s.color].label}</span>
          </div>
          <div className="mt-3 flex gap-3" role="radiogroup" aria-label="Body colour">
            {(Object.keys(BODY_COLORS) as BodyColor[]).map((c) => (
              <button
                key={c}
                role="radio"
                aria-checked={s.color === c}
                aria-label={BODY_COLORS[c].label}
                title={BODY_COLORS[c].label}
                onClick={() => set({ color: c })}
                className="swatch"
                style={{
                  background: `radial-gradient(circle at 32% 28%, #ffffffb0, ${BODY_COLORS[c].base} 48%, ${BODY_COLORS[c].emissive})`,
                  '--glow': `${BODY_COLORS[c].base}88`,
                } as React.CSSProperties}
              />
            ))}
          </div>
        </div>
        <div className="row py-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[13.5px] font-medium">Size</span>
            <span className="text-[12px] tabular-nums text-(--text-dim)">{s.size}px</span>
          </div>
          <input
            type="range"
            aria-label="Size"
            min={SIZE_MIN}
            max={SIZE_MAX}
            step={2}
            value={s.size}
            onChange={(e) => set({ size: Number(e.target.value) })}
            className="range mt-2"
            style={{ '--fill': `${sizeFill}%` } as React.CSSProperties}
          />
        </div>
      </Section>

      <Section title="Behaviour" index={1}>
        <div className="row py-3">
          <span className="text-[13.5px] font-medium">Activity level</span>
          <div className="seg mt-2.5" role="radiogroup" aria-label="Activity level" style={{ '--pos': activityPos } as React.CSSProperties}>
            <span className="seg-thumb" aria-hidden />
            {ACTIVITY.map((a) => (
              <button key={a.value} role="radio" aria-checked={s.activity === a.value} onClick={() => set({ activity: a.value })}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
        <Toggle label="Walk around" hint="Strolls along the bottom of the screen" checked={s.walkAround} onChange={(v) => set({ walkAround: v })} />
        <Toggle label="Climb & rope" hint="Shoots a rope to the top edge, climbs it, abseils back down" checked={s.climb} disabled={!s.walkAround} onChange={(v) => set({ climb: v })} />
        <Toggle label="Gravity" hint="Falls to the taskbar when dropped" checked={s.gravity} onChange={(v) => set({ gravity: v })} />
        <Toggle label="Pause activities" hint="Stays put and only idles" checked={s.paused} onChange={(v) => set({ paused: v })} />
        <SelectRow
          label="Sleep when PC is idle"
          value={s.sleepAfterMin}
          options={SLEEP}
          format={(m) => (m === 0 ? 'Never' : `After ${m} min`)}
          onChange={(v) => set({ sleepAfterMin: v })}
        />
      </Section>

      <Section title="Wellbeing" index={2}>
        <Toggle
          label="Healthy habit reminders"
          hint="Eyes every 10 min · water 20 · stretch 30 · walk 45, only while you're active"
          checked={s.habits}
          onChange={(v) => set({ habits: v })}
        />
        <div className="pb-2.5">
          <button onClick={() => nexo.testReminder()} className="btn btn-accent w-full">
            Test a reminder
          </button>
        </div>
      </Section>

      <Section title="Quotes & shayari" index={3}>
        <SelectRow
          label="Show a notice"
          value={s.quoteEveryMin}
          options={QUOTE_EVERY}
          format={(m) => (m === 0 ? 'Never' : `Every ${m} min`)}
          onChange={(v) => set({ quoteEveryMin: v })}
        />
        <div className="grid grid-cols-2 gap-2 pb-2">
          <button onClick={() => nexo.quoteNow()} className="btn btn-accent">
            Show one now
          </button>
          <button onClick={() => nexo.openQuotesFile()} className="btn">
            Add my own…
          </button>
        </div>
        <p className="pb-2.5 text-[11.5px] leading-relaxed text-(--text-faint)" style={{ textWrap: 'pretty' }}>
          Built in: Ghalib, Mir, Iqbal, Kabir and more. Add your favourite poets, such as Jaun Elia, to your own list.
        </p>
      </Section>

      <Section title="System" index={4}>
        <Toggle
          label="Fight Bolt on start"
          hint="Bolt joins at launch and the full-screen battle runs until you stop it from the tray"
          checked={s.autoBattle}
          onChange={(v) => set({ autoBattle: v })}
        />
        <Toggle label="Always on top" checked={s.alwaysOnTop} onChange={(v) => set({ alwaysOnTop: v })} />
        <Toggle
          label="Start with Windows"
          hint={packaged ? undefined : 'Available in the installed app'}
          checked={s.autoStart}
          disabled={!packaged}
          onChange={(v) => set({ autoStart: v })}
        />
      </Section>

      <Section title="Play an animation" index={5}>
        <div className="grid grid-cols-3 gap-2 pt-1.5 pb-2.5">
          {ACTIONS.map((a) => (
            <button key={a.state} onClick={() => nexo.command(a.state)} className="btn">
              {a.label}
            </button>
          ))}
        </div>
      </Section>

      <footer className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 px-1 pt-1 text-[11px] text-(--text-faint)">
        <span><span className="kbd">Click</span> say hi</span>
        <span><span className="kbd">Double-click</span> jump</span>
        <span><span className="kbd">Drag</span> move</span>
        <span><span className="kbd">Right-click</span> menu</span>
      </footer>
    </main>
  )
}
