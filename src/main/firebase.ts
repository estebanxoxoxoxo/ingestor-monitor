import { cert, getApps, initializeApp } from 'firebase-admin/app'
import type { App } from 'firebase-admin/app'
import { loadEnv } from './env'

let app: App | null = null

/**
 * Una sola instancia del Admin SDK para Firestore y para la Realtime Database.
 * El `databaseURL` tiene que estar en la inicialización: si se omite, cualquier
 * uso de la RTDB falla aunque las credenciales sean correctas.
 */
export function firebaseApp(): App {
  if (app) return app
  const { firebase } = loadEnv()
  app =
    getApps()[0] ??
    initializeApp({
      credential: cert({
        projectId: firebase.projectId,
        clientEmail: firebase.clientEmail,
        privateKey: firebase.privateKey,
      }),
      databaseURL: firebase.databaseUrl,
    })
  return app
}
