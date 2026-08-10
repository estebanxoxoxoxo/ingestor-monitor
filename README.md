# Data Analizer Ops

**LA aplicación** del Analizer en el escritorio: sesiones en vivo, espejos
locales de raw y bronze, y la guardia del pipeline y de la cuenta. La
transformación (bronze → silver → gold) vive en BigQuery — acá no se
transforma nada: se mira, se espeja y se vigila.

(Los proyectos `data-analizer-app` y `data-analizer-studio` fueron los
donantes de código de esta app y quedan para retirar.)

## Pestañas

**Vivo ●** — las sesiones abiertas ahora mismo (Realtime Database):
planisferio, sesiones, detalle de eventos. El punto rojo titila porque es
una transmisión.

**Raw** y **Bronze** — cada capa del bucket con su espejo local: botón de
sync (reglas de la casa: ventana desde la última corrida, el día en curso
se rehace entero, los días cerrados no se borran nunca, marca de agua en
Firestore que sólo avanza si nada falló) e inventario por partición diaria.
Bronze se espeja a `bronze-local-cache/` con los contratos (`schemas/`)
incluidos; raw a `raw-local-cache/`.

**Status** — la guardia:

- **El log de ingestados**: un vigía en main lista la partición de HOY
  (UTC) cada minuto y de ese único listado salen las dos caras de la
  misma ventana — el contador del header (número) y el log (detalle),
  ordenado por el aterrizaje real en S3. **Sin persistencia**: se rearma
  fresco en cada pasada; el bucket es la única fuente de verdad. Lo
  anterior a hoy se mira en los espejos de Raw y Bronze.
- **Facturación AWS**: total del mes en curso (UTC) con desglose por
  servicio, vía Cost Explorer. Cada consulta cuesta US$ 0,01 — se cachea
  y se re-consulta sólo con el botón.

## Permisos IAM (estado real)

El usuario `data-analizer-reader` hoy puede listar **sólo**
`bronze/v=1/*` y `schemas/*` (verificado contra el bucket). Para
completar Ops hay que extenderle la política:

- **Raw**: `s3:ListBucket` (condición de prefijo `raw/*`) y
  `s3:GetObject` sobre `arn:aws:s3:::ingest-bucket-1985/raw/*`.
- **Facturación**: la acción `ce:GetCostAndUsage` (y Cost Explorer
  habilitado en la cuenta).

Hasta entonces, la pestaña Raw y la tarjeta de facturación muestran el
motivo exacto en pantalla; Bronze, Vivo y el vigía de bronze andan hoy.

## Arranque

```bash
npm install
copy .env.example .env   # o copiar el .env de la ETL y agregar S3_RAW_PREFIX
npm run dev
```

## Tests

```bash
npm test        # diff del vigía, parseo de la RTDB, catálogo, fechas
npm run typecheck
```
