# Ingest monitor — qué se está comiendo el lake

Inspecciona lo que el ingestor deja en el lake: las capas raw y bronze, sus
días, sus archivos y el contenido de cada uno. **Al abrir la app hace
cuatro pedidos por capa, en este orden**: (1) los marcadores de día de
`inventory/{capa}/days` en Firestore, que dicen qué días existen; (2) con
esa lista, una agregación `count + sum(size)` por cada día, que devuelve
los totales del árbol como números y no como documentos; (3) los archivos
del día más nuevo que no sea hoy, ordenados por nombre descendente y con
límite, caminando hacia atrás día por día hasta juntar diez — ese es el log
de últimos ingestados; y (4) una suscripción a los archivos de hoy, que
queda abierta y aporta el resto del log, el contador del día y el punto de
frescura. **Después de eso no consulta más**: cada archivo que aterriza
llega solo por (4), porque la Cloud Function del índice lo anota en
Firestore en segundos, con la app abierta o cerrada. El bucket se toca en
exactamente dos lugares: el **viewer**, que baja UN objeto a un temporal
que DuckDB lee y se borra enseguida, y el **Full sync**, que lista todo el
prefijo de la capa, lo compara contra Firestore y escribe sólo la
diferencia — sin borrar jamás nada nacido después de que arrancó el
escaneo.
