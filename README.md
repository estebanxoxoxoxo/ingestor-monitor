# Ingestor Monitor

El monitor del pipeline: quién está en el sitio ahora mismo y qué hay en el
lake. Lo persistente vive en db y el bucket se toca
sólo para ver un archivo. La transformación (bronze → silver → gold) vive en
BigQuery.


## Pestañas

| | Qué muestra |
| --- | --- |
| **Vivo ●** | Las pestañas abiertas ahora mismo: planisferio, lista y detalle de eventos. Sale de la Realtime Database, en vivo. |
| **Raw** | La capa cruda del lake: arriba el log de hoy, abajo el árbol de días. |
| **Bronze** | Lo mismo sobre la capa ya parseada, donde cada archivo trae una fila por evento. |
| **Config** | El semáforo del ingestor, el uso de Firebase y Google Cloud, y el remedio del índice. |

## Conceptos

- **Capa** — raw (como llegó) y bronze (parseado, en parquet).
- **Índice** — el espejo del bucket en Firestore. La app lee esto, nunca el bucket.
- **Árbol** — los días de una capa, con cuántos archivos y cuánto pesan.
- **Log** — los últimos archivos que aterrizaron hoy, en vivo.
- **Frescura** — el punto de cada pestaña: verde hoy · naranja 1-6 días · violeta ≥7 · negro nunca.
- **Viewer** — click en un archivo: se baja, DuckDB lo muestra, se borra.
- **Personas** y **Mirando** — pestañas agrupadas por persona, y las que tienen la página al frente.
- **Regenerate tree in DB** — reconstruir el índice desde el bucket. El remedio, no la rutina.
- **Día UTC** — todo se corta ahí.

## El código

- [`src/main/live/`](src/main/live) — Vivo.
- [`src/main/ingestor-monitor/`](src/main/ingestor-monitor) — Raw y Bronze
- [`src/main/config/`](src/main/config) — Config.
  ([README](src/main/ingestor-monitor/README.md) ·
  [glosario](src/main/ingestor-monitor/GLOSARIO.md)).
- `src/renderer/` — todo lo que dibuja.
- La raíz de `src/main` es sólo lo compartido: el `.env`, Firebase, el lake,
  el IPC y el arranque de Electron.

## Arranque

`setup` habilita pnpm, instala y trae el DuckDB CLI, que es con lo que el viewer abre cada archivo; va con npm porque en un clon nuevo pnpm todavía no existe. El `.env` lo copia y completa cada dev a mano: son secretos.

```bash
pnpm test
pnpm typecheck
```

Las dependencias se instalan con **al menos 60 días de publicadas**
(`minimumReleaseAge` en `pnpm-workspace.yaml`): el tiempo en que se descubre
un paquete comprometido se mide en días, así que esperamos a que lo
encuentren otros. Y los scripts de postinstall están bloqueados salvo los
tres habilitados uno por uno en `allowBuilds`.

---

