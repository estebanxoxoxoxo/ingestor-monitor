# Live — quién está en el sitio ahora mismo

Muestra las sesiones abiertas en este momento. **Se suscribe una sola vez**
al nodo `activeSessions` de la Realtime Database y esa suscripción queda
abierta para siempre: los clientes escriben su entrada al conectarse y
Firebase la borra al desconectarse, así que cada cambio llega empujado —
como con varias sesiones eso son muchos avisos por segundo, se emite como
mucho uno cada 400 ms, siempre con el último estado. Para poder nombrar y
agrupar los eventos hace **una lectura más, una sola vez por corrida de la
app**: el catálogo `schemas/event-types.json` del lake, que la suite
publica desde sus propios enums; si ese archivo no está, cae a la última
lista guardada en Firestore. Y los eventos marcados como relevantes se leen
y se escriben en el documento `settings/data-analizer` de Firestore, para
que la elección aparezca igual al abrir la app en otra máquina.
