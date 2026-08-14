# Live — quién está en el sitio ahora mismo

Las sesiones abiertas en este momento.

**1. Suscripción a las sesiones** · `activeSessions` en la Realtime
Database — queda abierta

- Trae: las sesiones vivas, y cada cambio apenas ocurre. El cliente escribe
  su entrada al conectarse; Firebase la borra al desconectarse.
- Emite: como mucho una actualización cada 400 ms, siempre con el último
  estado — con varias sesiones son muchos avisos por segundo.
- Usa: el planisferio, la lista de sesiones, el detalle de eventos.

**2. Catálogo de eventos** · `schemas/event-types.json` del lake

- Trae: qué eventos existen, con su label y su grupo. Lo publica la suite
  desde sus propios enums.
- Cae a: la última lista guardada en Firestore, si el archivo no está.
- Cachea: toda la corrida de la app.
- Usa: los nombres y los grupos del picker de relevantes.

**3. Preferencias** · `settings/data-analizer` en Firestore

- Trae y guarda: los eventos marcados como relevantes.
- Usa: la línea de relevantes. Vive en la base, no en disco, para que la
  elección aparezca igual al abrir la app en otra máquina.
