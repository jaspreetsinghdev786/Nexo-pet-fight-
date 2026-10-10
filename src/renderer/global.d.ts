import type { NexoApi } from '../../electron/shared'

declare global {
  interface Window {
    nexo: NexoApi
  }
}
