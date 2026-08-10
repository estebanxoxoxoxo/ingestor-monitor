/// <reference types="vite/client" />

import type { RendererApi } from '@shared/types'

declare global {
  interface Window {
    /** Lo que expone src/preload/index.ts vía contextBridge. */
    api: RendererApi
  }
}
