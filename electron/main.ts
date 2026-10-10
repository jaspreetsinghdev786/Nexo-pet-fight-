import { app, BrowserWindow, ipcMain, Menu, nativeImage, powerMonitor, screen, shell, Tray } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ACTIONS, PetBounds, PetState, Rect, Rope, Settings, SIZE_MAX, SIZE_MIN, windowSizeFor } from './shared.js'
import { BUILT_IN, loadUserQuotes, Quote } from './quotes.js'
import { loadSettings, saveSettings } from './store.js'

const DEV_URL = process.env.VITE_DEV_SERVER_URL
const DIST = join(__dirname, '../dist')

let settings: Settings
let pet: BrowserWindow | null = null
let settingsWin: BrowserWindow | null = null
let tray: Tray | null = null
let ropeWin: BrowserWindow | null = null

const ROPE_PAD = 8
// The rope is one rotated strip from the anchor (top) to Nexo's hand (bottom).
const ROPE_HTML = `<html><body style="margin:0;background:transparent;overflow:hidden">
<div id="r" style="position:absolute;width:4px;margin-left:-2px;border-radius:2px;transform-origin:50% 0;
background:linear-gradient(90deg,#1690c8,#c9f8ff 50%,#1690c8);box-shadow:0 0 4px #38dcff"></div>
<script>function draw(ax, ex, h) {
  const r = document.getElementById('r'), dx = ex - ax
  r.style.left = ax + 'px'; r.style.top = '0px'
  r.style.height = Math.hypot(dx, h) + 'px'
  r.style.transform = 'rotate(' + (-Math.atan2(dx, h)) + 'rad)'
}</script></body></html>`
let ropeReady = false
let ropeLast: Rope | null = null

/** The rope lives in its own click-through window so it can reach the top of the screen. */
function setRope(rope: Rope | null) {
  if (!rope || rope.bottom - rope.top < 4 || !pet?.isVisible()) {
    ropeWin?.hide()
    return
  }
  if (!ropeWin) {
    ropeWin = new BrowserWindow({
      show: false,
      transparent: true,
      frame: false,
      resizable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      alwaysOnTop: settings.alwaysOnTop,
    })
    ropeWin.setIgnoreMouseEvents(true)
    ropeWin.on('closed', () => {
      ropeWin = null
      ropeReady = false
    })
    ropeWin.webContents.once('did-finish-load', () => {
      ropeReady = true
      if (ropeLast) setRope(ropeLast)
    })
    ropeWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(ROPE_HTML))
  }
  ropeLast = rope
  const left = Math.round(Math.min(rope.x, rope.xEnd) - ROPE_PAD)
  const right = Math.round(Math.max(rope.x, rope.xEnd) + ROPE_PAD)
  const height = Math.round(rope.bottom - rope.top)
  ropeWin.setBounds({ x: left, y: Math.round(rope.top), width: right - left, height })
  if (process.env.NEXO_ROPE_DEBUG) console.log('ROPEWIN want', left, Math.round(rope.top), right - left, height, 'got', JSON.stringify(ropeWin.getBounds()))
  if (ropeReady) void ropeWin.webContents.executeJavaScript(`draw(${rope.x - left}, ${rope.xEnd - left}, ${height})`)
  if (!ropeWin.isVisible()) {
    ropeWin.setAlwaysOnTop(settings.alwaysOnTop, 'floating')
    ropeWin.showInactive()
    ropeWin.moveTop() // rope in front, so its end meets the gripping hand
  }
}

// Stay on the integrated GPU on hybrid-graphics laptops: waking the dedicated one (NVIDIA/AMD)
// for a desktop pet heats the machine. Must be set before the app is ready.
app.commandLine.appendSwitch('force_low_power_gpu')

// Snapshot runs are isolated test instances: own settings, no single-instance lock.
if (process.env.NEXO_SNAPSHOT_DIR) app.setPath('userData', join(process.env.NEXO_SNAPSHOT_DIR, 'userdata'))
else if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => showPet())

function asset(name: string) {
  const built = join(DIST, 'assets', name)
  return existsSync(built) ? built : join(__dirname, '../src/renderer/public/assets', name)
}

function loadPage(win: BrowserWindow, page: 'index' | 'settings' | 'notice' | 'arena') {
  if (DEV_URL) win.loadURL(`${DEV_URL}/${page}.html`)
  else win.loadFile(join(DIST, `${page}.html`), process.env.NEXO_ROPE_DEBUG ? { query: { debug: '1' } } : undefined)
}

// ---------- geometry ----------

function contains(r: Rect, x: number, y: number) {
  return x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height
}

/** Clamp a window rect into the work area of the display nearest its centre. */
function clampToDisplay(x: number, y: number, w: number, h: number) {
  const centre = { x: Math.round(x + w / 2), y: Math.round(y + h / 2) }
  const wa = screen.getDisplayNearestPoint(centre).workArea
  return {
    x: Math.min(Math.max(x, wa.x), wa.x + wa.width - w),
    y: Math.min(Math.max(y, wa.y), wa.y + wa.height - h),
  }
}

function initialPosition(w: number, h: number) {
  const p = settings.position
  if (p && screen.getAllDisplays().some((d) => contains(d.workArea, p.x + w / 2, p.y + h / 2))) {
    return clampToDisplay(p.x, p.y, w, h)
  }
  const wa = screen.getPrimaryDisplay().workArea
  return { x: wa.x + wa.width - w - 120, y: wa.y + wa.height - h }
}

/** The display the pet is on plus every display joined to it side by side, left to right. */
function roamAreas(b: Rect): Rect[] {
  const home = screen.getDisplayMatching(b)
  const overlapsY = (a: Rect, c: Rect) => a.y < c.y + c.height && c.y < a.y + a.height
  const row = screen
    .getAllDisplays()
    .filter((d) => d.id === home.id || overlapsY(d.bounds, home.bounds))
    .sort((a, c) => a.bounds.x - c.bounds.x)
  // Mixed scaling can leave the DIP rects a few pixels apart; anything wider is a real gap.
  const joined = (l: Rect, r: Rect) => Math.abs(r.x - (l.x + l.width)) <= 16
  const at = row.findIndex((d) => d.id === home.id)
  let from = at
  let to = at
  while (from > 0 && joined(row[from - 1].bounds, row[from].bounds)) from--
  while (to < row.length - 1 && joined(row[to].bounds, row[to + 1].bounds)) to++
  return row.slice(from, to + 1).map((d) => d.workArea)
}

function bounds(): PetBounds {
  const b = { ...pet!.getBounds(), ...windowSizeFor(settings.size) }
  return { window: b, areas: roamAreas(b) }
}

// ---------- windows ----------

function createPet() {
  const { width, height } = windowSizeFor(settings.size)
  const { x, y } = initialPosition(width, height)
  pet = new BrowserWindow({
    x,
    y,
    width,
    height,
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    backgroundColor: '#00000000',
    alwaysOnTop: settings.alwaysOnTop,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  pet.setAlwaysOnTop(settings.alwaysOnTop, 'floating')
  // Transparent pixels pass clicks through; the renderer re-enables input over the robot itself.
  pet.setIgnoreMouseEvents(true, { forward: true })
  pet.on('closed', () => (pet = null))
  loadPage(pet, 'index')
}

function openSettings() {
  if (settingsWin) return settingsWin.focus()
  settingsWin = new BrowserWindow({
    width: 380,
    height: 640,
    resizable: false,
    maximizable: false,
    title: 'Nexo Settings',
    icon: asset('icon.png'),
    backgroundColor: '#0b1226',
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true },
  })
  settingsWin.on('closed', () => (settingsWin = null))
  loadPage(settingsWin, 'settings')
}

function showPet() {
  if (!pet) createPet()
  pet!.showInactive()
  rebuildTray()
}

function hidePet() {
  pet?.hide()
  ropeWin?.hide()
  rebuildTray()
}

function sendCommand(state: PetState) {
  if (arenaWins.length) return // mid-battle: Nexo is busy
  if (!pet?.isVisible()) showPet()
  pet?.webContents.send('pet:command', state)
}

// ---------- full-screen battle ----------

// One arena window per screen: a single transparent window cannot span screens with different scaling.
let arenaWins: BrowserWindow[] = []
let arenaAreas: Rect[] = []

/** Nexo leaves its window and fights Bolt across every screen it can roam. */
function startBattle(feetX: number) {
  if (!pet || arenaWins.length) return
  const areas = roamAreas(pet.getBounds())
  const left = areas[0].x
  const last = areas[areas.length - 1]
  const world = { width: last.x + last.width - left, height: Math.max(...areas.map((a) => a.height)) }
  let loading = areas.length
  const wins = areas.map((wa) => {
    const win = new BrowserWindow({
      ...wa,
      show: false,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true },
    })
    win.setIgnoreMouseEvents(true)
    win.setAlwaysOnTop(true, 'floating')
    win.on('closed', () => {
      arenaWins = arenaWins.filter((w) => w !== win)
    })
    // Never leave Nexo stranded if the arena crashes.
    win.webContents.on('render-process-gone', () => endBattle(feetX - left))
    win.webContents.once('did-finish-load', () => {
      if (--loading || arenaWins !== wins) return
      // Every window is ready: start them on the same clock.
      const t0 = Date.now() + 150
      wins.forEach((w, i) => {
        const a = areas[i]
        w.setBounds(a) // transparent windows can be created a pixel off
        const view = { x: a.x - left, width: a.width, height: a.height }
        w.webContents.send('battle:init', { world, view, t0, feetX: feetX - left, size: settings.size, color: settings.color })
        w.showInactive()
      })
      pet?.hide()
      ropeWin?.hide()
      rebuildTray()
    })
    loadPage(win, 'arena')
    return win
  })
  arenaWins = wins
  arenaAreas = areas
}

/** Ask the arena to wrap up; it answers with battle:done and Nexo's position. */
function stopBattle() {
  for (const w of arenaWins) w.webContents.send('battle:stop')
}

function endBattle(feetX: number) {
  const wins = arenaWins
  if (!wins.length) return // every arena window reports in; the first one ends it
  arenaWins = []
  if (pet) {
    const x = arenaAreas[0].x + feetX
    const wa = arenaAreas.find((a) => x >= a.x && x < a.x + a.width) ?? arenaAreas[0]
    const { width, height } = windowSizeFor(settings.size)
    const p = clampToDisplay(Math.round(x - width / 2), wa.y + wa.height - height, width, height)
    pet.setBounds({ ...p, width, height })
    pet.showInactive()
    pet.webContents.send('battle:ended')
  }
  for (const w of wins) w.close()
  rebuildTray()
}

ipcMain.on('battle:start', (_e, feetX: number) => startBattle(feetX))
ipcMain.on('battle:done', (_e, feetX: number) => endBattle(feetX))

// ---------- quote / shayari notices ----------

const NOTICE_W = 340
let noticeWin: BrowserWindow | null = null
let noticeH = 170
let lastQuoteAt = Date.now()
let lastQuote = ''
const quotesFile = () => join(app.getPath('userData'), 'my-quotes.txt')

/** Place the notice above Nexo (or below when Nexo is near the top), inside the screen. */
function placeNotice() {
  if (!noticeWin || !pet) return
  const b = pet.getBounds()
  const wa = screen.getDisplayMatching(b).workArea
  let x = Math.round(b.x + b.width / 2 - NOTICE_W / 2)
  let y = b.y - noticeH + 10
  if (y < wa.y) y = b.y + b.height - 10
  x = Math.min(Math.max(x, wa.x + 4), wa.x + wa.width - NOTICE_W - 4)
  y = Math.min(Math.max(y, wa.y + 4), wa.y + wa.height - noticeH - 4)
  noticeWin.setBounds({ x, y, width: NOTICE_W, height: noticeH })
}

function showNotice(q: Quote) {
  if (!noticeWin) {
    noticeWin = new BrowserWindow({
      show: false,
      width: NOTICE_W,
      height: noticeH,
      transparent: true,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true },
    })
    noticeWin.setAlwaysOnTop(true, 'floating')
    noticeWin.on('closed', () => (noticeWin = null))
    loadPage(noticeWin, 'notice')
    noticeWin.webContents.once('did-finish-load', () => showNotice(q))
    return
  }
  placeNotice()
  noticeWin.webContents.send('notice:show', { kind: q.kind, text: q.text, author: q.author })
  noticeWin.showInactive()
}

function showQuote() {
  if (!pet?.isVisible()) return
  let user: Quote[] = []
  try {
    user = loadUserQuotes(quotesFile())
  } catch {
    // Unreadable file: fall back to the built-in set.
  }
  // The user's own lines come up twice as often as the built-in ones.
  const pool = [...BUILT_IN, ...user, ...user].filter((q) => q.text !== lastQuote)
  const q = pool[Math.floor(Math.random() * pool.length)] ?? BUILT_IN[0]
  lastQuote = q.text
  lastQuoteAt = Date.now()
  sendCommand('thinking')
  showNotice(q)
}

// Every 30 s: time for the next quote? Only while the user is at the PC.
setInterval(() => {
  if (!app.isReady() || !settings || settings.paused || !settings.quoteEveryMin) return
  if (powerMonitor.getSystemIdleTime() > 120) return
  if (Date.now() - lastQuoteAt >= settings.quoteEveryMin * 60_000) showQuote()
}, 30_000)

ipcMain.on('notice:size', (_e, h: number) => {
  noticeH = Math.min(420, Math.max(110, Math.round(h)))
  placeNotice()
})
ipcMain.on('notice:close', () => noticeWin?.hide())
ipcMain.on('app:quote-now', () => showQuote())
ipcMain.on('app:open-quotes', () => {
  loadUserQuotes(quotesFile()) // creates the file with instructions on first use
  void shell.openPath(quotesFile())
})

// ---------- settings ----------

function applySettings(patch: Partial<Settings>) {
  const prev = settings
  if (patch.size !== undefined) patch.size = Math.round(Math.min(SIZE_MAX, Math.max(SIZE_MIN, patch.size)))
  settings = { ...settings, ...patch }
  saveSettings(settings)

  if (pet && patch.size !== undefined && patch.size !== prev.size) {
    // Resize around the pet's feet so it does not jump around the screen.
    const b = pet.getBounds()
    const { width, height } = windowSizeFor(settings.size)
    const p = clampToDisplay(Math.round(b.x + b.width / 2 - width / 2), b.y + b.height - height, width, height)
    pet.setBounds({ ...p, width, height })
  }
  if (pet && patch.alwaysOnTop !== undefined) pet.setAlwaysOnTop(settings.alwaysOnTop, 'floating')
  if (patch.autoStart !== undefined && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: settings.autoStart, args: ['--hidden-start'] })
  }

  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('settings:changed', settings)
  rebuildTray()
  return settings
}

// ---------- tray ----------

function menuTemplate(): Electron.MenuItemConstructorOptions[] {
  const visible = !!pet?.isVisible()
  const autoBattle: Electron.MenuItemConstructorOptions = {
    label: 'Fight Bolt on start',
    type: 'checkbox',
    checked: settings.autoBattle,
    click: (i) => applySettings({ autoBattle: i.checked }),
  }
  if (arenaWins.length) return [{ label: 'Stop battle', click: stopBattle }, autoBattle, { type: 'separator' }, { label: 'Quit Nexo', click: () => app.quit() }]
  return [
    { label: visible ? 'Hide Nexo' : 'Show Nexo', click: () => (visible ? hidePet() : showPet()) },
    {
      label: 'Actions',
      submenu: ACTIONS.map((a) => ({ label: a.label, click: () => sendCommand(a.state) })),
    },
    { type: 'separator' },
    autoBattle,
    {
      label: 'Pause activities',
      type: 'checkbox',
      checked: settings.paused,
      click: (i) => applySettings({ paused: i.checked }),
    },
    {
      label: 'Walk around',
      type: 'checkbox',
      checked: settings.walkAround,
      click: (i) => applySettings({ walkAround: i.checked }),
    },
    {
      label: 'Climb & rope',
      type: 'checkbox',
      checked: settings.climb,
      click: (i) => applySettings({ climb: i.checked }),
    },
    {
      label: 'Always on top',
      type: 'checkbox',
      checked: settings.alwaysOnTop,
      click: (i) => applySettings({ alwaysOnTop: i.checked }),
    },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: settings.autoStart,
      enabled: app.isPackaged,
      click: (i) => applySettings({ autoStart: i.checked }),
    },
    {
      label: 'Size',
      submenu: [
        ['Small', 72],
        ['Medium', 110],
        ['Large', 140],
        ['Extra large', 160],
      ].map(([label, size]) => ({
        label: label as string,
        type: 'radio' as const,
        checked: settings.size === size,
        click: () => applySettings({ size: size as number }),
      })),
    },
    { label: 'Show a quote', click: showQuote },
    { label: 'Reset position', click: resetPosition },
    { type: 'separator' },
    { label: 'Settings…', click: openSettings },
    { label: 'Quit Nexo', role: 'quit' },
  ]
}

function rebuildTray() {
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(asset('tray.png')))
    tray.setToolTip('Nexo')
    tray.on('click', () => (pet?.isVisible() ? sendCommand('waving') : showPet()))
    tray.on('double-click', openSettings)
  }
  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()))
}

function resetPosition() {
  if (!pet) return
  const b = pet.getBounds()
  const wa = screen.getPrimaryDisplay().workArea
  pet.setPosition(wa.x + wa.width - b.width - 120, wa.y + wa.height - b.height)
  applySettings({ position: { x: pet.getBounds().x, y: pet.getBounds().y } })
}

// ---------- IPC ----------

ipcMain.handle('settings:get', () => settings)
ipcMain.handle('app:packaged', () => app.isPackaged)
ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => applySettings(patch))
ipcMain.handle('pet:bounds', () => bounds())
ipcMain.handle('pet:idle', () => powerMonitor.getSystemIdleTime())
ipcMain.on('pet:move', (_e, x: number, y: number) => {
  // Always pass the canonical size: on fractional scaling (125%, 150%) getBounds() comes back
  // rounded, and feeding it into setBounds shrinks the window a pixel per move.
  pet?.setBounds({ x: Math.round(x), y: Math.round(y), ...windowSizeFor(settings.size) })
})
ipcMain.handle('pet:drag-end', () => {
  const b = pet!.getBounds()
  const size = windowSizeFor(settings.size)
  const p = clampToDisplay(b.x, b.y, size.width, size.height)
  pet!.setBounds({ ...p, ...size })
  settings = { ...settings, position: p }
  saveSettings(settings)
  return bounds()
})
ipcMain.on('pet:ignore-mouse', (_e, ignore: boolean) => pet?.setIgnoreMouseEvents(ignore, { forward: true }))
ipcMain.on('pet:menu', () => {
  if (pet) Menu.buildFromTemplate(menuTemplate()).popup({ window: pet })
})
ipcMain.on('app:settings', openSettings)
ipcMain.on('pet:rope', (_e, rope: Rope | null) => {
  if (process.env.NEXO_ROPE_DEBUG && rope) console.log('ROPE', JSON.stringify(rope), JSON.stringify(pet?.getBounds()))
  setRope(rope)
})
ipcMain.on('pet:command', (_e, state: PetState) => sendCommand(state))
ipcMain.on('pet:test-reminder', () => {
  if (!pet?.isVisible()) showPet()
  pet?.webContents.send('pet:test-reminder')
})

// ---------- lifecycle ----------

app.whenReady().then(() => {
  app.setAppUserModelId('in.reachonpeak.nexo')
  settings = loadSettings()
  // Snapshot runs drive every animation themselves; no battle hijacking the captures.
  if (process.env.NEXO_SNAPSHOT_DIR) settings = { ...settings, autoBattle: false }
  createPet()
  rebuildTray()

  // Keep the pet on a visible display when monitors are unplugged or rearranged.
  const refit = () => {
    if (!pet) return
    const b = pet.getBounds()
    const size = windowSizeFor(settings.size)
    const p = clampToDisplay(b.x, b.y, size.width, size.height)
    if (p.x !== b.x || p.y !== b.y) pet.setBounds({ ...p, ...size })
    pet.webContents.send('pet:command', 'falling')
  }
  screen.on('display-added', refit)
  screen.on('display-removed', refit)
  screen.on('display-metrics-changed', refit)

  if (process.env.NEXO_SNAPSHOT_DIR) {
    app.getGPUInfo('complete').then((g: any) => {
      const active = g.gpuDevice?.find((d: any) => d.active) ?? g.gpuDevice?.[0]
      console.log('GPU', JSON.stringify({ active: active?.driverVendor ?? active?.vendorId, renderer: g.auxAttributes?.glRenderer }))
    })
    void snapshotStates(process.env.NEXO_SNAPSHOT_DIR)
  }
})

/** Dev aid: play every action and save mid-animation captures of the pet window. */
async function snapshotStates(dir: string) {
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  mkdirSync(dir, { recursive: true })
  await wait(2500)
  const only = process.env.NEXO_SNAPSHOT_STATES?.split(',')
  const shots: [string, number][] = only
    ? only.map((s) => [s, 0] as [string, number])
    : [['idle', 0], ...ACTIONS.map((a) => [a.state, 0] as [string, number]), ['idle', 1]]
  const gap = Number(process.env.NEXO_SNAPSHOT_GAP ?? 350)
  const frames = Number(process.env.NEXO_SNAPSHOT_FRAMES ?? 2)
  applySettings({ sleepAfterMin: 0, size: Number(process.env.NEXO_SNAPSHOT_SIZE ?? settings.size) }) // keep auto-sleep out of captures
  for (const shot of shots) {
    const [state] = shot
    if (state === 'reminder') pet!.webContents.send('pet:test-reminder')
    else if (state === 'quote') showQuote()
    else if (state !== 'idle') sendCommand(state as PetState)
    for (const ms of Array.from({ length: frames }, (_, i) => gap * (i + 1))) {
      await wait(gap)
      // Capture pet and rope together so a moving Nexo lines up with its rope.
      const [img, ropeImg] = await Promise.all([
        pet!.isVisible() ? pet!.webContents.capturePage() : Promise.resolve(null),
        ropeWin?.isVisible() ? ropeWin.webContents.capturePage() : Promise.resolve(null),
      ])
      for (const [i, w] of arenaWins.entries()) {
        if (!w.isVisible()) continue
        writeFileSync(join(dir, `${only ? shots.indexOf(shot) + '-' : ''}${state}-${ms}-arena${i}.png`), (await w.webContents.capturePage()).toPNG())
      }
      console.log(state, ms, JSON.stringify(pet!.getBounds()))
      if (noticeWin?.isVisible()) {
        writeFileSync(join(dir, `${only ? shots.indexOf(shot) + '-' : ''}${state}-${ms}-notice.png`), (await noticeWin.webContents.capturePage()).toPNG())
      }
      if (ropeImg && ropeWin) {
        const r = ropeImg
        const name = `${only ? shots.indexOf(shot) + '-' : ''}${state}-${ms}`
        writeFileSync(join(dir, `${name}-rope.png`), r.toPNG())
        writeFileSync(join(dir, `${name}-bounds.json`), JSON.stringify({ pet: pet!.getBounds(), rope: ropeWin.getBounds() }))
      }
      if (img) writeFileSync(join(dir, `${only ? shots.indexOf(shot) + "-" : ""}${state}${state === 'idle' && shots.indexOf(shot) > 0 ? '-end' : ''}-${ms}.png`), img.toPNG())
    }
    await wait(2200)
  }
  app.quit()
}

app.on('before-quit', () => {
  if (pet) saveSettings({ ...settings, position: { x: pet.getBounds().x, y: pet.getBounds().y } })
})

// Closing the settings window must not quit: the pet lives in the tray.
app.on('window-all-closed', () => {})
