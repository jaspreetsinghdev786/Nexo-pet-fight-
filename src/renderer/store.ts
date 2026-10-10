import { create } from 'zustand'
import type { PetState, Settings } from '../../electron/shared'

// React-facing state. Per-frame motion bypasses React (brain.ts writes transforms directly);
// only things that change a few times a second or less live here.
interface PetStore {
  settings: Settings | null
  state: PetState
  facing: 1 | -1
  blink: boolean
  bubble: string | null // speech bubble text (habit reminders)
  set: (patch: Partial<Omit<PetStore, 'set'>>) => void
}

export const usePet = create<PetStore>((set) => ({
  settings: null,
  state: 'idle',
  facing: 1,
  blink: false,
  bubble: null,
  set: (patch) => set(patch),
}))
