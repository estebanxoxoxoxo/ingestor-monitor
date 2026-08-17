# Live — quién está en el sitio ahora mismo

Las **pestañas** abiertas en este momento. No hay noción de sesión: cada
pestaña abierta es una entrada, y desaparece sola cuando se cierra.

**1. Suscripción a las pestañas** · `activeSessions` en la Realtime
Database — queda abierta

- Trae: las pestañas vivas, y cada cambio apenas ocurre. El cliente escribe
  su entrada al conectarse; Firebase la borra al desconectarse, del lado del
  servidor. El nodo se sigue llamando `activeSessions` por herencia: cada
  hijo es una pestaña.
- Emite: como mucho una actualización cada 400 ms, siempre con el último
  estado — con varias pestañas son muchos avisos por segundo.
- Deriva dos números que la entrada no trae: **personas** = pestañas
  distintas por `anonymous_id` (dos pestañas de la misma persona cuentan
  una), y **mirando** = las que tienen `visible`. Sin ese campo se asume
  que está al frente.
- Usa: el planisferio, la lista de pestañas, el detalle de eventos.

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
