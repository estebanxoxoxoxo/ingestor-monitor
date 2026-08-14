# Config — la guardia y los remedios

Dice si el ingestor está vivo, cuánto se está usando la plataforma y deja
disparar la reparación del índice. **El semáforo** abre un socket TCP al
host del ingest cada 5 minutos: si conecta, hay instancia levantada y
proceso escuchando — no manda ni un byte de datos, sólo mide y cierra.
**Las dos tarjetas de uso** hacen una consulta HTTP por métrica a la API de
Cloud Monitoring, firmadas con un token de la misma service account de
Firebase: **una vez al abrir la app y después sólo con el botón**; cada
valor se compara contra su capa gratuita para mostrar el porcentaje, y la
fila del almacenado del lake no consulta nada — sale de la foto que el
ingest monitor ya tiene en memoria. **El Full sync** se dispara desde acá
pero lo ejecuta el ingest monitor, que es el dueño del índice. Y los dos
botones de consola no hacen red: le pasan la URL al navegador del sistema,
donde la sesión de Google ya existe.
