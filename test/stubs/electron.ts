/**
 * `electron` no se puede importar fuera de Electron. Los tests que tocan
 * módulos del proceso main lo reciben stubeado; si algún test llega a usarlo de
 * verdad, falla acá y no en silencio.
 */
export const app = {
  isPackaged: false,
  getPath: (name: string): string => {
    throw new Error(`Un test pidió app.getPath(${name}) — inyectá la ruta en vez de usar Electron`)
  },
  getAppPath: (): string => {
    throw new Error('Un test pidió app.getAppPath() — inyectá la ruta en vez de usar Electron')
  },
}
