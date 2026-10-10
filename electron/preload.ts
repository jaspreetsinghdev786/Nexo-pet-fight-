import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type { BattleInit, NexoApi, NoticeData, PetState, Settings } from './shared.js'

function listen<T>(channel: string, cb: (v: T) => void) {
  const fn = (_e: IpcRendererEvent, v: T) => cb(v)
  ipcRenderer.on(channel, fn)
  return () => {
    ipcRenderer.removeListener(channel, fn)
  }
}

const api: NexoApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  isPackaged: () => ipcRenderer.invoke('app:packaged'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  onSettings: (cb) => listen<Settings>('settings:changed', cb),
  getBounds: () => ipcRenderer.invoke('pet:bounds'),
  move: (x, y) => ipcRenderer.send('pet:move', x, y),
  dragEnd: () => ipcRenderer.invoke('pet:drag-end'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('pet:ignore-mouse', ignore),
  getIdleSeconds: () => ipcRenderer.invoke('pet:idle'),
  showMenu: () => ipcRenderer.send('pet:menu'),
  openSettings: () => ipcRenderer.send('app:settings'),
  setRope: (rope) => ipcRenderer.send('pet:rope', rope),
  command: (state) => ipcRenderer.send('pet:command', state),
  onCommand: (cb) => listen<PetState>('pet:command', cb),
  testReminder: () => ipcRenderer.send('pet:test-reminder'),
  quoteNow: () => ipcRenderer.send('app:quote-now'),
  openQuotesFile: () => ipcRenderer.send('app:open-quotes'),
  onNotice: (cb) => listen<NoticeData>('notice:show', cb),
  noticeSize: (h) => ipcRenderer.send('notice:size', h),
  noticeClose: () => ipcRenderer.send('notice:close'),
  onTestReminder: (cb) => listen<void>('pet:test-reminder', () => cb()),
  startBattle: (feetX) => ipcRenderer.send('battle:start', feetX),
  onBattleInit: (cb) => listen<BattleInit>('battle:init', cb),
  battleDone: (feetX) => ipcRenderer.send('battle:done', feetX),
  onBattleStop: (cb) => listen<void>('battle:stop', () => cb()),
  onBattleEnded: (cb) => listen<void>('battle:ended', () => cb()),
}

contextBridge.exposeInMainWorld('nexo', api)
