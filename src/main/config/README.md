# Config — la guardia y los remedios

Si el ingestor está vivo, cuánto se usa la plataforma, y la reparación del
índice.

**1. Semáforo** · socket TCP al host del ingest, cada 5 minutos

- Trae: si conecta y cuánto tardó. Conectar prueba que hay instancia
  levantada y proceso escuchando.
- No manda: ni un byte de datos. Abre, mide y cierra.
- Usa: el punto de la pestaña y la línea de estado.

**2. Uso de Firebase y de Google Cloud** · una consulta por métrica a Cloud
Monitoring

- Cuándo: una vez al abrir la app, después sólo con el botón.
- Trae: el valor de cada métrica en la misma ventana que su capa gratuita,
  para poder mostrar el porcentaje.
- Firma: un token de la misma service account de Firebase.
- Excepción: el almacenado del lake no consulta nada — sale del árbol
  mergeado que el ingestor monitor ya tiene en memoria.

**3. Regenerate tree in DB**

- Se dispara acá; la orden la escribe el ingestor monitor, que es el dueño
  del índice, y el trabajo lo hace una Cloud Function del lado de Google.

**4. Botones de consola**

- No hacen red: le pasan la URL al navegador del sistema, donde la sesión
  de Google ya existe.
