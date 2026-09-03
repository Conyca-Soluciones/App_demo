# CONYCA — App de presupuestos de construcción

## Stack
Next.js + TypeScript, Supabase (Postgres) como base de datos, Server Actions
para todo el acceso a datos (sin API routes separadas). UI con shadcn/ui
(sobre Base UI, no Radix). Excel import/export client-side con `xlsx` (leer)
y `ExcelJS` (escribir, para poder darle estilos).

### Convención: anotar tipos en `.then()`/callbacks que consumen server actions
Se observó más de una vez que un callback como
`listarVersiones(id).then((lista) => ...)` cae a `lista: any` (TS7006) aunque
la función ya declare `Promise<VersionPresupuesto[]>` -- pasa cuando el
archivo de la llamada no tiene, en ese momento, visibilidad completa del
tipo de retorno (por ejemplo, mientras se edita `actions.ts` en paralelo y
queda una versión parcial/incompleta en el editor, o por cómo Next.js
compila el boundary cliente/servidor de `"use server"` en algunos casos).
Cuando pase, el arreglo rápido y confiable es anotar explícitamente en el
sitio de la llamada (`.then((lista: VersionPresupuesto[]) => ...)`,
`.find((v: VersionPresupuesto) => ...)`) en vez de depender de que la
inferencia viaje sola -- no hace daño dejarlo anotado incluso después de
confirmar que `actions.ts` está completo.

## Estructura de archivos

```
app/presupuestos/
  page.tsx              -- página principal: import Excel, tabla, export
  actions.ts             -- TODAS las server actions (presupuestos, APU, insumos)
  categorias-apu.ts      -- constante CATEGORIAS_APU (separada de actions.ts
                             porque "use server" solo permite exportar funciones
                             async, no constantes)
app/almacen/
  page.tsx               -- landing de Almacen: hoy es directamente "Pedidos"
                             (selección de proyecto + botón "Crear pedido");
                             otras pestañas de Almacén se añaden después
  actions.ts              -- verProyectos, buscarPresupuestoActivo,
                             buscarInsumos, crearPedido
  types.ts                -- InsumoAgrupado, ItemSeleccionable, PresupuestoActivo
app/admin-tecnico/
  page.tsx                -- panel de aprobación de pedidos de insumos,
                             tabla tipo Excel agrupada por proyecto
  actions.ts               -- verPedidosPendientes, resolverPedido
components/
  presupuesto-table.tsx        -- tabla jerárquica del presupuesto (incluye
                                   botón de eliminar fila por ítem, con
                                   cascada a sub-ítems)
  apu-editor-dialog.tsx        -- editor de APU (buscar insumos, cantidades)
  agregar-item-manual-dialog.tsx -- agregar ítem que no vino del Excel
  dropdown-flotante.tsx        -- portal a document.body para dropdowns
                                   dentro de contenedores con overflow-scroll
  dialogue-nuevo-pedido.tsx    -- diálogo de "Crear pedido" en Almacén
                                   (un solo componente, todos los imports
                                   juntos -- decisión explícita del usuario,
                                   no dividir en subcomponentes)
lib/
  similitud-texto.ts     -- motor de matching de texto (TF-IDF + coseno +
                             Jaccard + Levenshtein), reemplaza al matching
                             por Levenshtein puro en SQL
  calcular-nivel.ts       -- deriva el Nivel de un ítem de presupuesto desde
                             su Código (ver "Import de Excel" abajo)
supabase/migrations/     -- en orden de ejecución, ver abajo
```

## Modelo de datos (Postgres / Supabase)

```
maestro_insumos
  id, codigo (int, unique), descripcion, tipo, u_m, agrupacion,
  vr_unitario, iva_porcentaje, vr_neto, iva_descontable, excluye_iva,
  usuario_modificacion, fecha_modificacion, created_at
  -- Maestro limpio y deduplicado (~5.270 filas), precios promedio de compras.

presupuesto_items
  id, presupuesto_id, padre_id (self-ref, FK a sí misma),
  nivel (int), codigo (text), descripcion, unidad,
  cantidad, valor_unitario, valor_total,
  apu_id (FK -> apu.id, nullable), version_id (FK -> presupuesto_versiones.id)
  -- Jerarquía capítulo -> ítem -> (sub-ítem) por padre_id + nivel.

presupuestos
  id, proyecto_id (UNIQUE), nombre, monto_total, estado, created_at,
  version_actual_id (FK -> presupuesto_versiones.id)
  -- proyecto_id es UNIQUE: un proyecto tiene, como mucho, UN presupuesto
  -- (constraint presupuestos_proyecto_id_unique) -- ver "Presupuesto único
  -- por proyecto" más abajo para por qué se simplificó así.

apu
  id, codigo, descripcion, created_at, updated_at, version
  -- Reutilizable: muchos presupuesto_items pueden apuntar al mismo apu_id
  -- (aunque el flujo normal de la UI copia en vez de compartir -- ver
  -- "Reutilización de APU" más abajo).

item_apu
  id, apu_id (FK), insumo_id (FK -> maestro_insumos.id), cantidad, tipo,
  rendimiento (numeric, default 1)
  -- Una fila por insumo dentro de un APU. `cantidad` es la cantidad de ese
  -- insumo NECESARIA POR UNIDAD del ítem que usa el APU (ej. 0.98 bultos de
  -- cemento por m2 de pañete). `rendimiento` es un multiplicador libre
  -- (ver "Rendimientos" abajo) usado sobre todo para mano de obra y
  -- maquinaria -- NO participa en el cálculo de "cuánto material pedir"
  -- en pedidos_insumos (ver esa tabla abajo): ese cálculo es puramente
  -- cantidad × cantidad del ítem, sin rendimiento.

solicitudes_insumos
  id, descripcion, tipo, u_m, agrupacion, vr_unitario_propuesto,
  solicitado_por (FK -> auth.users, NO migrada a perfiles -- ver nota),
  presupuesto_item_id, estado ('pendiente'|'aprobado'|'rechazado'),
  codigo_maestro_asignado, created_at, resuelto_at, resuelto_por
  -- Cuando alguien agrega un insumo manual que no existe en el maestro
  -- (ni exacto ni similar), queda pendiente de aprobación aquí. Aprobar
  -- fija el precio y lo agrega al maestro; el APU/ítem que lo generó se
  -- actualiza solo. UI de aprobación: implementada (ver "Solicitudes de
  -- insumos" abajo).

pedidos_insumos
  id, grupo_pedido_id (uuid), presupuesto_item_id (FK), insumo_id (FK),
  item_apu_id (FK, nullable), cantidad, fecha_requerida, urgente,
  observaciones, soporte_url, estado ('pendiente'|'aprobado'|'rechazado'),
  solicitado_por (FK -> perfiles.id), created_at,
  resuelto_por (FK -> perfiles.id), resuelto_at, comentario_resolucion
  -- Pedidos de insumos de almacén hechos por un ingeniero contra un
  -- presupuesto. Ver "Pedidos de insumos" abajo para el diseño completo
  -- (por qué grupo_pedido_id, por qué el tope de cantidad, etc.)

perfiles
  id (FK -> auth.users.id), nombre, es_admin, admin_insumos,
  admin_proyectos, admin_usuarios, created_at
  -- Espejo en public de auth.users con nombre y flags de rol. Usarlo como
  -- destino de FK (en vez de auth.users directo) cuando la tabla nueva
  -- necesita mostrar "quién hizo esto" -- ver nota de convención abajo.

proyectos
  id, nombre, cliente, created_at, codigo

grupos, grupo_proyectos, usuario_grupos, usuario_proyectos
  -- Permisos: un grupo puede "ver_todos_proyectos" o tener proyectos
  -- puntuales asignados (grupo_proyectos, con puede_editar); un usuario
  -- puede tener acceso directo (usuario_proyectos) o heredado por grupo
  -- (usuario_grupos -> grupos -> grupo_proyectos). Ver "Login y permisos".
```

### Convención: FKs hacia usuario deben apuntar a `perfiles(id)`, no `auth.users(id)`

`perfiles.id` ya es 1:1 con `auth.users.id` (misma FK), pero vive en el
schema `public` -- PostgREST **sí** puede resolver un embed automático
contra ella (`solicitante:perfiles!mi_fkey(nombre)`), cosa que no puede
hacer contra `auth.users` directamente (no está en su schema cache; el
error típico es `Could not find a relationship between 'x' and
'solicitado_por' in the schema cache`).

`pedidos_insumos.solicitado_por`/`resuelto_por` ya se migraron a
`perfiles(id)`. **`solicitudes_insumos.solicitado_por`/`resuelto_por`
siguen apuntando a `auth.users(id)`** -- decisión explícita del usuario de
no migrar esa tabla todavía, para no tocar dos cosas a la vez. Cualquier
tabla **nueva** que necesite "quién hizo esto" debería apuntar a
`perfiles(id)` desde el diseño inicial, no a `auth.users`.

### RPC de Postgres
- `recalcular_valor_apu(p_apu_id uuid) returns numeric` — suma
  `item_apu.cantidad * item_apu.rendimiento * maestro_insumos.vr_unitario`
  de todo el APU, y propaga ese valor a **todos** los `presupuesto_items`
  que usan ese `apu_id` (multiplicando también por la `cantidad` del ítem
  si existe, para el `valor_total`).
- `buscar_insumos_presupuesto(p_version_id uuid, p_query text, p_limite int)`
  — usada por Pedidos de insumos (ver esa sección). Busca por código de
  insumo, código de ítem, o descripción (substring, índices trigram) dentro
  de la VERSIÓN VIGENTE de un presupuesto, y devuelve por cada
  combinación (ítem × insumo) su `cantidad_disponible` ya calculada:
  `(item_apu.cantidad × presupuesto_items.cantidad) − SUM(pedidos_insumos.cantidad
  WHERE estado IN ('pendiente','aprobado'))`, nunca negativo -- descuenta
  pendiente+aprobado, no solo aprobado (ver "Riesgos resueltos" en
  Pedidos de insumos). Requiere `DROP FUNCTION` antes de recrearla si
  cambian las columnas de retorno (`CREATE OR REPLACE` no puede cambiar
  el tipo `TABLE(...)` de una función existente).
- `disponible_insumo_item(p_presupuesto_item_id uuid, p_insumo_id uuid)
  returns numeric` — misma fórmula que arriba pero para UN insumo en UN
  ítem puntual, sin el JOIN de descubrimiento completo. La usa
  `crearPedido` para revalidar el tope server-side sin traer cientos de
  filas irrelevantes solo para filtrar una en JS.
- `obtener_permisos_usuario(p_usuario_id uuid) returns jsonb` — reemplaza
  los 4 round-trips que hacía `obtenerPermisosUsuario()` en TypeScript
  (perfil → grupos → grupo_proyectos + usuario_proyectos) por un solo
  `.rpc()`. Ver "Rendimiento de permisos y protección de rutas".

### Migraciones (orden de ejecución)
1. `20250810000000_create_maestro_insumos.sql`
2. `20250810100000_solicitudes_insumos_y_similitud.sql` — crea
   `solicitudes_insumos` y la función SQL `buscar_insumos_similares`
   (Levenshtein, **YA NO SE USA** — reemplazada por TS, ver abajo)
3. `20250810110000_apu_por_item_y_maestro_insumos.sql` — versión vieja donde
   `apu` tenía `presupuesto_item_id` único (1 APU = 1 ítem, no reutilizable)
4. `20250811000000_apu_reutilizable.sql` — **FALLÓ en Supabase** (dependía
   de la función `levenshtein()` sin tener la extensión correcta activa)
5. `20250811010000_apu_reutilizable_sin_levenshtein.sql` — la que corrió
   bien, repite el trabajo de la anterior de forma segura (`IF NOT EXISTS`
   en todo), agrega `presupuesto_items.apu_id`, crea `recalcular_valor_apu`,
   y borra las funciones SQL de matching por Levenshtein que ya no se usan.
6. `20250814000000_rendimiento_apu.sql` — agrega `item_apu.rendimiento`.
7. Versiones de presupuesto — agrega `presupuesto_versiones`,
   `presupuesto_items.version_id`, `presupuestos.version_actual_id`, y el
   `check` `not valid` sobre `presupuestos.estado`.
8. Pedidos de insumos — crea `pedidos_insumos` con sus índices y RLS, y la
   función `buscar_insumos_presupuesto`. **Ojo**: en este proyecto la
   primera corrida del `CREATE TABLE` con constraints se aplicó sin
   ninguna FK (causa exacta sin confirmar -- posible fallo silencioso a
   mitad del script); las FKs se agregaron después con `ALTER TABLE ...
   ADD CONSTRAINT` uno por uno. Si se recrea esta tabla desde cero en otro
   entorno, verificar con `pg_constraint` (no `information_schema` --
   da falsos "no rows" con JOINs de varias FKs en la misma tabla) que las
   5 FKs quedaron creadas antes de asumir que todo salió bien.
9. `migracion_presupuesto_unico.sql` — agrega
   `presupuestos_proyecto_id_unique` (UNIQUE sobre `proyecto_id`). Incluye
   una consulta defensiva (`GROUP BY proyecto_id HAVING COUNT(*) > 1`)
   antes del `ALTER TABLE`, para detectar si algún proyecto ya tenía más
   de un presupuesto -- confirmado que no era el caso al aplicarla, pero
   si se vuelve a correr en otro entorno hay que revisar esa consulta
   primero.

## Motor de similitud de texto (`lib/similitud-texto.ts`)

Reemplaza el matching por Levenshtein puro en SQL (que no distinguía bien
"columna 0.25x0.25" de "columna 0.30x0.30" — texto casi idéntico, medida
distinta). Pipeline:

```
normalización → tokenización → stopwords → extraerNumeros
  (solo decimales de 1-2 dígitos, excluye "X.000" para no confundir miles)
  → similitud = TF-IDF+coseno (45%) + Jaccard overlap (30%) + Levenshtein (25%)
  → penalización suave 0.85x si la medida numérica difiere
  → penalización suave 0.85x si la unidad difiere
  (NO filtra resultados, solo baja el ranking -- el usuario los sigue viendo,
   marcados con un badge)
  → top 6 resultados, umbral 0.4
```

Se usa en dos funciones (`actions.ts`):
- `buscarInsumosSimilares` — contra el maestro completo (~5.270 insumos),
  filtra por `tipo` si se especifica.
- `buscarApusSimilares` — contra `presupuesto_items` que ya tienen `apu_id`,
  deduplica por "firma de contenido" (combinación de insumos) del APU.
- En **Pedidos de insumos** (módulo distinto, ver abajo) la búsqueda usa
  una vía diferente (`buscar_insumos_presupuesto` en SQL, con índices
  trigram) porque ahí el universo de búsqueda ya está acotado a un solo
  presupuesto -- no hace falta el motor TF-IDF completo.

## Reutilización de APU

Un `apu` puede en teoría ser usado por muchos `presupuesto_items` (ver
`apu_id` arriba), pero el flujo normal de la UI **copia** el APU en vez de
compartirlo (`copiarApuParaItem`, `copiarApuStandalone`) — así, si alguien
edita el APU de un ítem, no rompe silenciosamente el precio de otro ítem que
por casualidad usaba el mismo `apu_id`. Compartir explícitamente (mismo
`apu_id` a propósito) existe como opción (`vincularApuExistente`), pero no es
el default.

### Flujo de "APU antes de guardar" (ítems que aún no están en la base)
Si el ítem del presupuesto todavía no se guardó (`guardado === false`) y el
usuario abre el editor de APU, la app usa `crearApuStandalone` /
`copiarApuStandalone`: crea el APU real en la base de inmediato (sin
enlazarlo todavía a ningún `presupuesto_item`), y guarda el `apuId` en el
estado local del ítem. Al hacer clic en "Guardar en base de datos", el
INSERT del ítem incluye `apu_id: item.apuId`, enlazando de una vez. La tabla
muestra un badge azul "listo" para estos ítems.

### APUs recomendados
Al abrir el editor de APU para un ítem, se sugieren APUs ya existentes
(usados antes en otros proyectos) que se parezcan al ítem actual, vía
`buscarApusSimilares` (el motor TF-IDF de arriba). El usuario puede aplicar
la recomendación (copia sus insumos/cantidades al ítem actual, sin afectar
el APU original) o armar el suyo desde cero.

## Import / Export de Excel

**Import** (`page.tsx`, `procesarOrdenPresupuesto`): el Excel debe traer 4
columnas -- **Código, Descripción, Unidad, Cantidad** (reconocidas por
alias: Item/Ítem/Cod para Código, Actividad/Concepto/Detalle para
Descripción, UM/UN/U/"Unidad de medida" para Unidad, Cant/"Cant." para
Cantidad). **Ya NO se lee una columna "Nivel"** -- se deriva del propio
Código con `lib/calcular-nivel.ts`, que acepta dos formatos, mezclables en
el mismo archivo:

- **Con puntos o comas** (`1`, `1.1`, `4.1.1.1`, `5,1`=`5.1`): nivel =
  cantidad de segmentos. Sin ambigüedad, cualquier longitud de capítulo.
- **Dígitos seguidos, sin puntos** (`1`, `101`, `10101`, o `10`, `1001`
  para capítulos de 2+ dígitos): se resuelve **por contexto**, procesando
  las filas en orden y manteniendo un stack de qué código está "abierto"
  en cada nivel -- un código es descendiente del ancestro más profundo
  posible del stack si empieza con él y le sobran dígitos en pares (2, 4,
  6...). Esto permite que un capítulo salte directo a un ítem sin
  subcapítulo intermedio (`2` → `20101`, 4 dígitos extra = nivel 3) y evita
  la ambigüedad de longitud fija que rompía con más de 9 capítulos.

Filas sin Código pero con Descripción que empiece con "total", "subtotal",
"costo directo" o "costo indirecto" (en Código O Descripción, sin importar
mayúsculas/tildes) se ignoran en silencio. Cualquier otra fila con Código
en un formato no reconocido **corta toda la importación** (no se sube
nada) y muestra fila + motivo, para corregir el Excel y volver a subir --
decisión explícita: no adivinar ni dejar pasar filas dudosas. Cantidad
faltante se completa como `0` (no queda vacía). Los valores de Cantidad se
parsean tolerando formato colombiano (`11.720,00` y `1436,45` ambos dan el
número correcto).

El botón "Eliminar fila" en `presupuesto-table.tsx` borra un ítem (y sus
sub-ítems en cascada) del estado local -- si el ítem ya estaba guardado en
la base, esto NO lo borra ahí, solo lo saca de pantalla.

**Export** (`obtenerApusParaExportar` en `actions.ts` + `page.tsx`): genera
un Excel con 2 hojas —
- **MATRIZ**: N°, DESCRIPCIÓN, UN, COSTO DIRECTO (una fila por ítem).
- **APU**: un bloque por cada APU usado (no una tabla plana) — título con
  código+descripción+qué ítems lo usan, encabezado, filas de insumos, fila
  de PRECIO UNITARIO total.

## Categorías de insumo (`categorias-apu.ts`)

```
Materiales           -> MATERIAL-M, CONSUMIBLES-C
Mano de Obra         -> HONORARIOS-H, NOMINA-N, SUBCONTRATO-S
Equipo y Herramienta -> EQUIPO-E, MAQUINARIA-B
Transporte           -> TRANSPORTE-T
Otros                -> DOTACION-D, SERVICIOS-Q, SEÑALIZACIÓN-Ñ, ...
```

## Árbol de navegación (`components/presupuesto-tree.tsx`)

Sidebar con buscador, construido 100% desde `presupuesto: ItemPresupuesto[]`
(el mismo estado del cliente que ya usa `PresupuestoTable`) — no hace
ninguna llamada nueva a la base de datos ni al servidor, porque `nivel` y
`padreId` ya alcanzan para reconstruir el árbol completo. Al clickear un
nodo, hace scroll hasta esa fila en la tabla (`id="item-{id}"` en cada
`<TableRow>`) y la resalta un momento (`idResaltado` en
`PresupuestoTable`). La búsqueda filtra por descripción/código y expande
automáticamente el camino hasta cada coincidencia, sin depender del estado
de colapsado/expandido normal del árbol.

## Rendimientos (implementado)

`item_apu.rendimiento numeric(18,4) not null default 1` (migración
`20250814000000_rendimiento_apu.sql`). Confirmado contra una captura real de
Sinco: **no** es "1/productividad" como dice la teoría de libro de texto —
es un multiplicador libre, sin restricción de tipo de insumo:

```
Valor Parcial = Cantidad × Rendimiento × Valor Unitario
```

Con `rendimiento = 1` (el default), el cálculo da exactamente igual que
antes de esta migración — por eso fue seguro correrla sobre datos
existentes sin recalcular nada a mano. `recalcular_valor_apu()` ya
multiplica por `rendimiento`; `copiarApuParaItem`/`copiarApuStandalone`
copian el campo junto con la cantidad al duplicar un APU. Editable con
doble-click en `apu-editor-dialog.tsx` (mismo componente `CantidadEditable`
que ya existía), y expuesto en `obtenerApusParaExportar`/`LineaApuExport`
para el Excel.

`rendimiento` **no** participa en el cálculo de `cantidad_disponible` de
Pedidos de insumos (ver abajo) -- ahí solo importa cuánto material físico
hace falta, y el rendimiento es un multiplicador de mano de obra/maquinaria,
no de cantidad de material.

## Presupuesto único por proyecto (implementado)

Un proyecto tiene, como mucho, **un** presupuesto -- constraint
`presupuestos_proyecto_id_unique` sobre `presupuestos.proyecto_id`. Antes
de esto, un proyecto podía tener varios presupuestos independientes
(pensado para el caso "presupuesto totalmente aparte" al importar un
Excel sobre un proyecto que ya tenía uno), y cada presupuesto a su vez
tenía sus propias `presupuesto_versiones` -- dos niveles de "historial"
superpuestos. Confirmado con el usuario que el caso de presupuestos
paralelos **nunca se usó en la práctica**: todo cambio real era una
evolución del mismo presupuesto, que ya cubre `presupuesto_versiones`.
Se colapsó a un solo nivel: proyecto 1:1 presupuesto 1:N versiones.

Por qué importa para lo que sigue: la **versión actual del único
presupuesto de un proyecto** es ahora una cadena de referencia sin
ambigüedad (`proyecto → presupuesto → version_actual_id`), lo cual es
el ancla natural para comparar contra ejecución cuando exista ese módulo
(ver "Gráfica de composición" y "Pedidos de insumos" -- ambos ya asumían
implícitamente "la versión vigente del presupuesto del proyecto", así
que quedan más simples y más correctos con esta simplificación, no solo
más cortos).

Efectos en código:
- `verPresupuestosDeProyecto` (plural, devolvía una lista) →
  **reemplazada** por `verPresupuestoDeProyecto` (singular), devuelve
  `PresupuestoExistente | null` con `.maybeSingle()`.
- `crearPresupuesto` ahora detecta `error.code === "23505"`
  (unique_violation) y lanza un mensaje claro ("Este proyecto ya tiene un
  presupuesto. Usa 'Crear versión nueva'...") en vez del texto crudo de
  Postgres -- cubre la carrera entre dos pestañas o una llamada directa
  al server action que se salte la UI normal.
- En `page.tsx`, el flujo de "subir Excel a un proyecto que ya tiene
  presupuesto" se simplificó: ya no pregunta "¿es una versión nueva de
  uno de estos, o un presupuesto aparte?" (esa pregunta no tiene sentido
  con 1:1) -- ahora solo pide el nombre de la versión nueva. Se
  eliminaron los estados `presupuestosExistentes` (lista),
  `cargandoExistentes`, `avisoDescartado`, `presupuestoDestinoElegido`,
  y las funciones `handleConfirmarVersionDesdeImport` /
  `handleConfirmarPresupuestoAparte` -- reemplazados por
  `presupuestoExistente: PresupuestoExistente | null` y una sola
  `handleConfirmarNombreVersion`.
- `buscarPresupuestoActivo` (en `app/almacen/actions.ts`) ya no necesita
  `order("created_at desc").limit(1)` -- ese `order/limit` era una
  cobertura defensiva para "podría haber varios"; con la constraint,
  `.maybeSingle()` directo alcanza.

## Versiones y estado (implementado)

Tabla dedicada `presupuesto_versiones` (id, presupuesto_id, numero, nombre,
creado_en) — no un simple contador entero, porque el usuario necesita ver
versiones anteriores **con su nombre**, no solo un número.
`presupuesto_items.version_id` marca a qué versión pertenece cada fila;
`presupuestos.version_actual_id` marca cuál es la versión "viva" (editable)
ahora mismo. Las demás versiones quedan de solo lectura.

`crearNuevaVersion(presupuestoId, nombre)` duplica **todos** los ítems de
la versión actual, y copia el APU de cada uno a un `apu_id` nuevo (mismo
patrón "copiar, no compartir" que ya usa `copiarApuParaItem`) — así la
versión vieja queda como una foto congelada de verdad: si más adelante se
edita un precio en el maestro y se recalcula el APU de la versión nueva,
la vieja no se mueve, porque tiene su propio `apu_id` independiente.

`obtenerOCrearVersionActual` (interna) crea la "Versión inicial" (numero=1)
la primera vez que se guarda algo en un presupuesto nuevo — así un
presupuesto recién creado no necesita un paso aparte para tener versión.

`presupuestos.estado` ya existía (columna de texto libre, sin restricción)
antes de esta sesión — se le agregó un `check` **sin validar filas
existentes** (`not valid`) para no romper datos viejos con un valor
desconocido, exigiendo `borrador` / `en_ejecucion` / `con_movimientos`
solo de acá en adelante.

`components/presupuesto-table.tsx` tiene un prop `soloLectura` que fuerza
el modo de solo-lectura en todas las filas (sin importar `item.guardado`)
cuando se está viendo una versión vieja -- si no, la celda de cantidad
dejaría "editar" visualmente sin que el cambio se guarde en ningún lado.

**Pedidos de insumos filtra por la versión VIGENTE**
(`presupuestos.version_actual_id` → `presupuesto_items.version_id`), no
por `presupuesto_id` directo -- así un pedido nunca se hace contra ítems de
una versión histórica congelada. Ver "Pedidos de insumos" abajo.

## Gráfica de composición (`components/composicion-chart.tsx`)

Barras horizontales (sin librería de gráficas -- por si el proyecto no
tiene recharts/d3 instalado) mostrando qué % del presupuesto es cada
capítulo (ej. "Demolición 20%"). Se calcula 100% en el cliente desde
`presupuesto: ItemPresupuesto[]`, subiendo por `padreId` desde cada ítem
con `valorTotal` hasta encontrar su capítulo ancestro (nivel 2) -- cero
llamadas nuevas al servidor.

**Pendiente real, no solo de UI**: "presupuesto actual vs ejecución" (que
el usuario también pidió) necesita una fuente de gasto real -- compras,
avance de obra -- que hoy no existe en ningún lado del schema. Sería un
módulo aparte (como "Ejecución"/"Control" en Sinco). Cuando exista esa
fuente de datos, la comparación es una extensión directa de esta misma
gráfica (dos series en vez de una). **Pedidos de insumos (ver abajo) es un
primer paso hacia esto** -- una vez existan pedidos aprobados con cantidad,
ya hay una fuente parcial de "consumo real" por ítem, aunque todavía no
está conectada a esta gráfica ni a compras.

## Login y permisos (implementado)

- Login con **email + contraseña**, sin auto-registro -- el admin crea la
  cuenta desde `/admin` y le entrega las credenciales al ingeniero.
- Permisos **granulares por proyecto**, en dos capas:
  - Directo: `usuario_proyectos` (usuario_id, proyecto_id, puede_editar).
  - Por grupo: `usuario_grupos` → `grupos` (con `ve_todos_proyectos` y
    `puede_editar_todos`) → `grupo_proyectos` (proyectos puntuales del
    grupo, con `puede_editar` propio).
- `perfiles` (id, nombre, es_admin, admin_insumos, admin_proyectos,
  admin_usuarios) es el espejo público de `auth.users` -- ver convención
  de FKs arriba.
- El maestro de insumos es de solo lectura para todos salvo
  `admin_insumos`/`es_admin` -- la única vía de edición para el resto es
  el flujo de `solicitudes_insumos` (aprobación).
- Panel `/admin`: crear usuario, asignar proyectos/permisos, activar
  `admin_insumos` para quien deba aprobar solicitudes/pedidos.

## Rendimiento de permisos y protección de rutas (implementado)

Diagnóstico real hecho en sesión: `verProyectos()` tardaba ~900ms solo en
la parte de permisos, porque `obtenerPermisosUsuario()` hacía **4
round-trips secuenciales/paralelos** a Supabase (`perfil` → `grupos` →
`grupo_proyectos` + `usuario_proyectos`), cada uno pagando ~200-430ms de
latencia de red fija -- el trabajo real en Postgres es instantáneo, el
costo estaba en repetir el viaje de ida y vuelta.

### RPC `obtener_permisos_usuario` (un solo round-trip)
Reemplaza toda la lógica de `obtenerPermisosUsuario()` por una función
`plpgsql` que hace los mismos joins **dentro** de Postgres y devuelve un
solo `jsonb`: `{ esAdmin, veTodosProyectos, puedeEditarTodos, proyectos:
{ [proyecto_id]: puede_editar } }`. Mantiene los mismos atajos que la
versión en TS (si `es_admin`, no calcula nada más; si algún grupo tiene
`ve_todos_proyectos`, tampoco arma el mapa de proyectos). El lado
TypeScript queda en una sola llamada `.rpc(...)`, parseando el jsonb de
vuelta al `Map<string, boolean>` que ya esperaba el resto del código.

### `auth.getUser()` se paga varias veces por navegación -- por diseño de Next.js
`auth.getUser()` no lee la cookie directo: hace una llamada de red real a
Supabase Auth para validar el token, cada vez que se invoca. Como
`requerirAdmin()`/`requerirScope()` se llaman al inicio de cada Server
Action, y las páginas de admin llaman varias Server Actions por carga
(ej. `/admin` llama `listarUsuarios`, `listarGrupos`,
`listarProyectosAdmin` desde el cliente, cada una su propio `POST`,
osea su propio request HTTP), se pagaba `auth.getUser()` una vez por
cada una de esas llamadas -- y ADEMÁS otra vez en el middleware, que
también lo necesita para las redirecciones de sesión/rutas protegidas.
`React.cache()` **no ayuda acá**: memoiza dentro de un mismo request de
React, pero estas son Server Actions invocadas desde el cliente vía
`useEffect` -- cada una es su propio request HTTP independiente, no
comparten memoria entre sí.

### Patrón de headers: el middleware verifica una vez, las Server Actions reutilizan
El middleware YA hace `auth.getUser()` (y, en rutas protegidas, la
consulta a `perfiles`) en cada request -- antes de eso, la Server Action
volvía a hacer exactamente lo mismo por su cuenta. Ahora el middleware
inyecta el resultado como headers en el **request** que sigue hacia el
handler (`NextResponse.next({ request: { headers } })`, no
`response.headers.set(...)` -- ese último nunca llega al handler,
diferencia real que costó un bug durante el desarrollo de esto):

- `x-user-id`: el id del usuario autenticado, siempre que haya sesión.
- `x-es-admin`: `"true"` si `perfiles.es_admin`, solo se setea en rutas
  bajo `/admin` o en `RUTAS_POR_SCOPE` (ver abajo).
- `x-scope-{scope}`: `"true"` si el usuario tiene ese scope específico
  (`admin_insumos`, `admin_proyectos`, `admin_usuarios`), en la ruta que
  lo requiera.

`requerirAdmin()`/`requerirScope()` leen estos headers primero (`next/
headers`); si vienen, no hacen ninguna llamada de red -- solo si no
vinieran (una invocación que no pasó por el middleware, ej. un test)
caen al fallback que valida desde cero contra Supabase, exactamente
como antes.

**Detalle de tipos que costó un error real**: un `.select()` con
template string dinámico (`` `es_admin${scope ? `, ${scope}` : ""}` ``)
rompe la inferencia de tipos de Supabase (`ParserError<...>`), porque el
generador de tipos analiza el string literal del `.select()` en tiempo
de compilación y no puede resolver una interpolación de variable. Se
resolvió pidiendo siempre las 4 columnas fijas
(`es_admin, admin_insumos, admin_proyectos, admin_usuarios`) y
decidiendo cuál mirar en JS después (`perfil?.[scope]`), nunca variando
el string del `.select()` en sí.

### Protección de rutas por scope (además de `/admin`)
`middleware.ts` ya redirigía `/admin` a `/presupuestos` si el usuario no
era `es_admin`. Se extendió con un mapa `RUTAS_POR_SCOPE` para rutas que
exigen un scope específico en vez de `es_admin` general:

```ts
const RUTAS_POR_SCOPE = {
  "/admin-tecnico": "admin_proyectos", // TODO: migrar a admin_tecnica cuando exista ese scope
  "/presupuestos/admin-insumos": "admin_insumos",
}
```

Dos cosas no obvias de este mapa:
- Las claves son **rutas exactas tal como aparecen en la URL real**, no
  nombres de página -- `/presupuestos/admin-insumos` está anidada bajo
  `/presupuestos`, NO bajo `/admin`, así que el chequeo de scope no
  puede depender solo de `pathname.startsWith("/admin")` (ese `if`
  nunca se habría disparado para esta ruta). La condición real cubre
  AMBOS casos: rutas que empiezan con `/admin` (siguen exigiendo
  `es_admin` salvo que además tengan scope propio en el mapa), Y
  cualquier ruta que esté en el mapa sin importar su prefijo.
- Sin esta protección, un usuario sin permiso SÍ entraba a la página
  (el middleware no la bloqueaba), y recién ahí el `useEffect` disparaba
  la Server Action, que tardaba (su propio `auth.getUser()` +
  `perfiles`) y fallaba con un 500 -- visible como error crudo en
  pantalla, y percibido como "lentitud" antes de fallar. Ahora
  redirige a `/presupuestos?error=no-autorizado` antes de que la
  página cargue nada.

**Pendiente**: el `?error=no-autorizado` en la URL de redirección
todavía no tiene un banner que lo muestre en `/presupuestos` -- se
documentó el patrón (leer el query param, mostrar aviso, limpiar la URL
con `router.replace`) pero no se aplicó porque no se tenía el `page.tsx`
de esa ruta a mano en la sesión. Ver "Pendientes generales".

## Pedidos de insumos (implementado)

Módulo nuevo, separado de Presupuestos: un ingeniero pide insumos de
almacén contra un ítem específico del presupuesto de su proyecto. **Por
ahora solo cubre el pedido en sí -- todavía no está conectado a Compras.**

### Modelo (`pedidos_insumos`, ver tabla arriba)
Un pedido que el ingeniero ve como "una sola acción" (ej. "necesito
cemento, repártelo entre estos 3 ítems") se guarda como **una fila por
cada (insumo, presupuesto_item)**, todas compartiendo un `grupo_pedido_id`
para que la UI las reagrupe visualmente. El **estado vive en cada fila, no
en el grupo** -- decisión explícita: el admin puede aprobar una línea del
grupo y rechazar otra por separado.

### Tope de cantidad
No se puede pedir más de lo que el presupuesto contempla para ese
insumo+ítem:

```
cantidad_maxima       = item_apu.cantidad × presupuesto_items.cantidad
cantidad_comprometida = SUM(pedidos_insumos.cantidad) en estado
                         PENDIENTE o APROBADO, para ese mismo insumo + ítem
cantidad_disponible   = GREATEST(cantidad_maxima − cantidad_comprometida, 0)
```

Calculado en `buscar_insumos_presupuesto` (ver RPC arriba) con un
`LEFT JOIN LATERAL` indexado
(`idx_pedidos_insumos_item_insumo_comprometido`, parcial
`WHERE estado IN ('pendiente','aprobado')`) para que sea barato aunque
haya miles de pedidos históricos. **Se descuenta pendiente + aprobado, no
solo aprobado** (cambio hecho después de la auditoría inicial -- ver
"Riesgos resueltos" más abajo, era la forma de cerrar el race condition
sin necesitar un lock transaccional). El diálogo bloquea el botón "Crear
pedido" si cualquier línea excede su disponible, y `crearPedido` (server
action) revalida con una consulta **puntual**
(`disponible_insumo_item(p_presupuesto_item_id, p_insumo_id)`, un insumo
y un ítem a la vez) antes de insertar -- ya no trae `p_limite: 1000` de
`buscar_insumos_presupuesto` solo para filtrar una fila en JS.

### Cancelar pedido
El propio solicitante puede cancelar (DELETE) su pedido mientras siga
`pendiente` -- una vez aprobado o rechazado, ya no se puede (queda como
registro histórico, igual que antes). Cubierto en dos capas: la server
action `cancelarPedido(id)` valida `solicitado_por === usuario actual` y
`estado === 'pendiente'` antes de borrar, y la policy RLS
`pedidos_insumos_delete_propio_pendiente` hace cumplir exactamente lo
mismo del lado de la base de datos (no solo confía en la validación de
la action). Se decidió explícitamente NO permitir editar (cambiar
cantidad/fecha/etc.) un pedido pendiente -- solo cancelar y volver a
crear uno correcto.

### Duplicado exacto
Antes de insertar, `crearPedido` también revisa si ya existe un pedido
**pendiente** con el mismo insumo + mismo ítem + misma cantidad + misma
`fecha_requerida` -- si lo hay, bloquea con un mensaje claro en vez de
crear un duplicado. Pensado para el caso de doble clic o refresh
accidental, no para prevenir pedidos legítimamente parecidos (cambiar
cualquiera de esos 4 campos ya no cuenta como duplicado).

### Búsqueda de insumo
Por código de insumo, código de ítem, o descripción -- las tres como
substring (`ILIKE '%texto%'`), con índices trigram (`pg_trgm`) en los tres
campos para que no degrade a sequential scan. Acotada a la **versión
vigente** del presupuesto del proyecto seleccionado (nunca a versiones
históricas).

### Flujo del ingeniero (`app/almacen/`)
1. Selecciona proyecto (query simple sobre `usuario_proyectos`/grupos, ya
   existente como patrón en `verProyectos`).
2. Se resuelve el `presupuesto_id` + `version_actual_id` del proyecto
   (`buscarPresupuestoActivo`) -- si no hay presupuesto cargado, el botón
   "Crear pedido" queda deshabilitado con un aviso.
3. En el diálogo: busca insumo, marca a qué ítem(s) aplica (si el insumo
   aparece en varios, se preselecciona solo si aparece en uno), cantidad
   por ítem respetando el tope, fecha requerida, urgente, observaciones.
4. `crearPedido` inserta todas las filas del grupo en un solo `.insert()`.
5. Debajo del formulario, **registro de pedidos del proyecto**
   (`verPedidosDeProyecto`): todos los pedidos de todos los solicitantes
   del proyecto seleccionado (no solo los propios -- decisión explícita,
   para coordinar entre varios ingenieros del mismo proyecto), con
   pestañas de filtro por estado. Cada fila propia y pendiente tiene el
   botón "Cancelar".

### Panel de aprobación (`app/admin-tecnico/`)
Tabla tipo Excel, agrupada por proyecto (admin-técnico ve todos los
proyectos, sin restricción de `usuario_proyectos`). Columnas: código
insumo, insumo, UM, cantidad, fecha pedido, fecha requerida, observaciones,
soporte (link), urgente (badge), ítem (link a
`/presupuestos?presupuestoId=X`, sin resaltar el ítem exacto todavía --
pendiente decidir cómo), solicitado por, aprobar/rechazar. Aprobar/rechazar
actúa sobre **una fila**, no sobre todo el grupo. Actualización optimista
(la fila desaparece de la lista al resolver, sin esperar recarga).

### RLS
`pedidos_insumos` tiene RLS con una función helper
(`usuario_tiene_acceso_a_item`) que reutiliza las mismas tablas de
permisos que el resto de la app. INSERT exige que `solicitado_por` sea el
usuario autenticado. UPDATE (aprobar/rechazar) exige `admin_insumos` o
`es_admin`. DELETE está permitido SOLO para el propio solicitante y solo
mientras `estado = 'pendiente'` (ver "Cancelar pedido" arriba) -- fuera de
eso, un pedido resuelto se conserva como registro histórico, sin DELETE
posible.

### Riesgos resueltos (auditoría original, ver historial de esta sesión)
La auditoría inicial identificó 5 riesgos; el usuario decidió cómo
resolver los primeros 3 juntos con un solo cambio de diseño:

- ✅ **Race condition del tope de cantidad**: resuelto descontando
  pendiente+aprobado del disponible (ver "Tope de cantidad" arriba), no
  con un lock transaccional -- en cuanto un pedido entra como pendiente,
  el disponible baja para todos de inmediato. Sigue existiendo una
  ventana teórica de milisegundos si dos INSERTs llegan exactamente
  simultáneos (no es 100% atómico), aceptada explícitamente como
  suficiente.
- ✅ **`resolverPedido` no re-chequeaba el tope al aprobar**: ya no hace
  falta -- si el disponible siempre descontó lo pendiente, dos
  pendientes nunca pudieron sumar más del tope en primer lugar.
- ✅ **`crearPedido` traía hasta 1000 filas para revalidar**: reemplazado
  por `disponible_insumo_item`, consulta puntual (un insumo, un ítem).
- ⚠️ **`crearPedido` solo valida la versión del primer ítem del pedido**
  (`input.items[0].presupuestoItemId`) -- sigue sin resolver, bajo
  riesgo real porque la UI actual nunca genera pedidos mezclando
  versiones/presupuestos distintos.
- ✅ **"No hay forma de cancelar/editar un pedido pendiente"**: resuelto
  con cancelar (no editar, decisión explícita -- ver "Cancelar pedido").

## Identidad visual y UI (implementado)

Rediseño con tono azul de marca (extraído del logo real de CONYCA,
`#3E70A1`, convertido a OKLCH porque el tema usa Tailwind v4 con
`@theme inline` sobre variables OKLCH en `globals.css`):

- `:root`/`.dark` en `globals.css`: `--primary`, `--ring`, `--accent`,
  `--sidebar-primary`, `--sidebar-accent` pasaron de gris puro
  (`oklch(x 0 0)`, cero saturación) a variantes del azul de marca. Se
  propaga solo, sin tocar componente por componente, a botones, focus
  rings, e ítems activos del sidebar en toda la app.
- Logo (`public/logo-conyca.png` completo,
  `public/logo-conyca-icono.png` solo el triángulo) en el header del
  sidebar -- alterna entre logo completo y solo ícono según
  `group-data-[collapsible=icon]`, mismo patrón que ya usaba el sidebar
  para el chevron de los grupos.
- Botón de cerrar sesión: ya no vive suelto arriba del sidebar --
  `handleLogout` se extrajo de `LogoutButton` a una función standalone
  (usa `window.location.href` en vez de `router.push`+`router.refresh`
  porque una función fuera de un componente no tiene acceso al hook
  `useRouter`) e integrado como ícono con tooltip junto al nombre del
  usuario, en el footer del sidebar.
- `SidebarInset` necesitaba `min-w-0` -- sin eso, cualquier página con
  contenido ancho (ej. `PresupuestoTable`) empujaba el layout ENTERO
  fuera del viewport en vez de generar scroll horizontal contenido
  dentro de la página misma (síntoma: "toca cerrar el sidebar para que
  quepa la tabla"). Complementado con `overflow-x-auto` (antes
  `overflow-hidden`) en el wrapper de `PresupuestoTable`.
- `presupuesto-table.tsx`: encabezado pasó de `bg-muted/50` (gris) a
  `bg-primary text-primary-foreground` (azul de marca), igual
  tratamiento que `admin-tecnico`/`admin-insumos`. Acentos hardcodeados
  (`bg-amber-100`, `bg-blue-100`) migrados a variables del tema
  (`bg-accent`) donde tenía sentido -- el badge ámbar de "Pendiente de
  aprobación" se dejó tal cual, porque ámbar-como-advertencia es una
  convención de color independiente del azul de marca.
- `admin-insumos` (`app/(app)/presupuestos/admin-insumos/page.tsx`)
  rediseñada como tabla tipo Excel, mismo patrón visual que
  `admin-tecnico`: pestañas de filtro (Pendientes / Aprobadas /
  Rechazadas) en vez de mostrar solo pendientes fijo. Para
  aprobadas/rechazadas, tabla de solo lectura con trazabilidad: código
  de insumo asignado en el maestro (`codigo_maestro_asignado`), quién
  resolvió (`resuelto_por`, cruzado a mano contra `perfiles` -- misma
  razón que con `solicitado_por`: son FKs paralelas hacia `auth.users`,
  no hay FK directa `solicitudes_insumos → perfiles`) y cuándo
  (`resuelto_at`).
- Proyecto en presupuestos ahora **auto-carga** su presupuesto único al
  seleccionarse (usa "Presupuesto único por proyecto", así que no hay
  ambigüedad de "cuál") -- se eliminó el popup/tarjeta que antes pedía
  clic en "Continuar".

## Pendientes generales

- ~~Cerrar la race condition del tope de cantidad en Pedidos de
  insumos~~ -- **resuelto** (ver "Riesgos resueltos" en Pedidos de
  insumos: se descuenta pendiente+aprobado del disponible).
- **Separar "quién aprueba" de "quién pone el precio"** en solicitudes
  de insumos -- discusión iniciada, en pausa. El problema real: hoy
  `aprobarSolicitudInsumo` exige que quien tiene `admin_insumos` (que
  decide si el insumo es válido) sea también quien conoce el precio real
  de mercado -- pero esas dos cosas las suele saber gente distinta
  (técnico vs. almacén/compras). Quedó sin decidir cuál de 3 enfoques
  usar: (a) dos roles separados, admin_insumos aprueba y alguien de
  compras pone el precio en un paso aparte; (b) un rol nuevo
  (`admin_compras`) que reemplaza a admin_insumos para este flujo
  específico; (c) un solo aprobador que puede dejar "aprobado sin
  precio" hasta que compras lo complete, y el insumo no entra al
  maestro hasta tener precio. Retomar cuando se decida el enfoque.
- Mostrar el banner de `?error=no-autorizado` en `/presupuestos` --
  patrón documentado (leer query param, mostrar aviso, `router.replace`
  para limpiar la URL) pero no aplicado, faltó tener el `page.tsx` a
  mano en la sesión donde se hizo la protección de rutas.
- **`crearPedido` solo valida la versión del primer ítem del pedido**
  (`input.items[0].presupuestoItemId`) -- riesgo bajo hoy (la UI nunca
  mezcla versiones/presupuestos en un pedido), pero sigue siendo una
  asunción implícita sin validar explícitamente.
- Investigar latencia intermitente al cargar presupuesto/APU (reportada
  por el usuario, "a veces se demora, pocas veces") -- nunca se llegó a
  revisar con logs reales, a diferencia de `/admin` y `verProyectos` que
  sí se diagnosticaron y resolvieron.
- Combinar `listarUsuarios`/`listarGrupos`/`listarProyectosAdmin` (las 3
  llamadas de carga inicial de `/admin`) en una sola Server Action --
  identificado como mejora válida (evitaría pagar `auth.getUser()` 3
  veces en una sola carga de página), el usuario decidió posponerlo
  explícitamente, no es un error.
- Conectar `pedidos_insumos` con Compras (fuera de alcance de esta ronda,
  a propósito).
- Subida de `soporte_url` a Supabase Storage en el diálogo de pedido --
  hoy el campo existe en la tabla pero el flujo de subida no está
  implementado (queda en `null`).
- Resaltar el ítem exacto al navegar desde el link "Ítem" del panel de
  aprobación hacia `/presupuestos` (hoy solo pasa `presupuestoId`).
- Migrar `solicitudes_insumos.solicitado_por`/`resuelto_por` a
  `perfiles(id)` -- decidido no hacerlo todavía, solo `pedidos_insumos` se
  migró.
- Definir si `vr_unitario` en `maestro_insumos` es con IVA o sin IVA (no
  confirmado con el usuario todavía).
- Revisar si la tabla vieja `recurso` (que `item_apu` usaba antes de
  apuntar a `maestro_insumos`) sigue teniendo algún uso o se puede eliminar.
- "Presupuesto actual vs ejecución" -- necesita módulo de ejecución real
  (ver "Gráfica de composición" arriba); Pedidos de insumos es un primer
  paso hacia esa fuente de datos, todavía no conectado.


## Import masivo de APU desde Excel (implementado, pendiente de probar a fondo)

Nueva capacidad en `/presupuestos`: si el Excel subido trae una segunda hoja
llamada **"APU"** (además de la hoja de presupuesto de siempre), la app
intenta armar el APU de cada ítem automáticamente en vez de que el
ingeniero lo haga a mano ítem por ítem.

### Flujo (confirmado con el usuario, implementado tal cual)

1. Se parsean las 2 hojas del Excel: la de presupuesto (como siempre) y la
   hoja "APU" (bloques por ítem: capítulo → ítem → líneas de insumo con
   `Tipo` = INSUMO/MO/EQUIPO/TRANSPORTE).
2. **Validación de códigos** (nueva, agregada después de un bug real):
   antes de mostrar cualquier diálogo, se valida que TODO código de la
   hoja APU exista tal cual (string idéntico) en la hoja de presupuesto.
   Si no, se corta ahí con un mensaje claro -- antes esto fallaba en
   silencio (`console.error`) y el ítem simplemente se quedaba sin APU sin
   que el ingeniero se enterara.
3. **Por cada ítem**, se busca primero si hay un APU recomendado ya en la
   base (reusa `buscarApusSimilares`, umbral bajado a **25%** -- antes
   40% por default, se subió la sensibilidad porque el usuario quería ver
   más candidatos posibles). El usuario elige: usar / usar y editar /
   ninguno me sirve.
4. Si no hay recomendado (o el usuario lo rechaza), elige entre
   **auto-escaneo** (matchear los insumos del Excel contra el maestro) o
   **manual** (se deja el ítem sin APU, como si nunca hubiera traído
   desglose).
5. Los ítems en auto-escaneo pasan por matching en lote: se deduplican
   las descripciones de insumo (la misma línea puede repetirse en decenas
   de ítems -- ej. "Herramienta menor"), y cada descripción única se
   busca **una sola vez** contra el maestro (`buscarInsumosSimilares`,
   filtrado por categoría según el `Tipo` del Excel). Umbral de
   auto-match: **80%** (se bajó de 90% a pedido del usuario). Si el
   filtro por categoría no encuentra nada (Tipo mal puesto en el Excel o
   insumo mal categorizado), cae a buscar en todo el maestro sin el
   filtro -- pero en ese caso **nunca** hace auto-match, siempre manda a
   revisión.
6. Insumos con precio placeholder en el maestro (`vr_unitario` en `[0,
   1]`) nunca se auto-aprueban, aunque el score sea altísimo -- van a
   revisión con una advertencia visible.
7. Al confirmar: se guarda el presupuesto/versión/ítems con el flujo
   normal (`AñadirItemPresuouesto`, sin reinventar nada), y después, por
   cada ítem según su decisión, se llama a `copiarApuParaItem` (para
   recomendados) o `crearApuParaItem` + `agregarInsumoApu` por línea +
   `recalcularValorItemDesdeApu` (para auto-escaneo) -- todas funciones
   que ya existían, no se duplicó ninguna lógica de guardado.

### Archivos nuevos

```
lib/parse-apu-excel.ts       -- parser de la hoja "APU" (bloques capítulo/ítem/insumo)
lib/apu-item-flow.ts          -- tipos y helpers de la decisión por ítem (recomendado/manual/auto-escaneo)
lib/apu-import-types.ts       -- tipos compartidos (ApuRecomendado, ResolucionInsumo, etc.)
components/revision-import-apu-dialog.tsx  -- diálogo de 2 fases (decisión por ítem, luego por insumo)
```

`app/presupuestos/actions.ts` y `app/presupuestos/page.tsx` se
extendieron (no se reescribieron desde cero) con las funciones nuevas
`buscarApusRecomendadosParaItems` y `matchearInsumosApuImport`, y la
orquestación del flujo en `handleFileSelected` /
`handleConfirmarNombreVersion` / `handleConfirmarApu`.

### Bug de arquitectura ya encontrado y arreglado: boundary cliente/servidor

`lib/apu-item-flow.ts` y el diálogo importaban tipos (`import type`)
directo desde `actions.ts` (archivo `"use server"`). Con Next 16 +
Turbopack, esto terminó arrastrando `lib/supabase/server.ts` (que usa
`next/headers`) al bundle de cliente, tumbando la página completa con
`Compiling...` sin terminar nunca. **Regla que hay que mantener**:
ningún archivo sin `"use client"`/`"use server"` debe importar NADA
--ni siquiera tipos-- directo de `actions.ts`. Los tipos compartidos van
en `lib/apu-import-types.ts`, que no importa nada de `actions.ts` (los
tipos que se solapan, como `InsumoSimilar`, están duplicados ahí a
propósito en vez de importados).

### 🔴 Elementos que necesitan testing fuerte (no probados a fondo todavía)

- **Umbrales (25% recomendado de APU, 80% auto-match de insumo)**: son
  valores puestos a ojo en una sesión de diseño, no calibrados contra
  datos reales de varios proyectos. Alto riesgo de falsos positivos
  (auto-match de algo que no es) o falsos negativos (manda a revisión
  todo, cero ahorro de tiempo). Probar con un presupuesto real completo,
  no solo 2 ítems de ejemplo.
- **`CATEGORIAS_REALES_POR_TIPO`** (mapeo INSUMO/MO/EQUIPO/TRANSPORTE →
  categorías reales del maestro tipo `MATERIAL-M`, `NOMINA-N`, etc.): es
  una suposición mía basada en el CLAUDE.md viejo, **nunca confirmada
  contra `categorias-apu.ts` real**. Si los códigos no coinciden, el
  filtro por tipo siempre cae al fallback sin filtro, y el auto-match de
  insumos NUNCA se activa (todo va a revisión) -- fallaría en silencio
  como "funciona pero nunca auto-matchea nada".
- **Sin transaccionalidad en el guardado** (`handleConfirmarApu`): si
  falla a la mitad de la lista de ítems (ej. ítem 12 de 20), los primeros
  11 ya quedaron con `apu_id` creado en la base, pero no hay rollback.
  Queda un presupuesto a medio armar sin aviso claro de cuáles ítems sí
  y cuáles no se alcanzaron a procesar.
- **Rendimiento con presupuestos grandes**: `buscarApusRecomendadosParaItems`
  hace ~3 queries por ítem (aunque en paralelo con `Promise.all`) --
  nunca se probó con un presupuesto de 100+ ítems real, solo con 15-70 de
  prueba. Puede sentirse lento o incluso golpear límites de conexiones
  concurrentes de Supabase.
- **Validación de códigos duplicados dentro de la misma hoja APU**: si
  dos bloques de la hoja APU tienen el mismo código (no debería pasar,
  pero ya vimos casos reales de esto exacto en los archivos de capítulos
  -- ver el hallazgo de códigos duplicados en Cap 5/8/13), no hay
  chequeo explícito acá -- probablemente el segundo bloque simplemente
  sobreescribe el `apu_id` del ítem sin avisar.
- **Flujo completo de "usar y editar recomendado"**: la UI ya distingue
  "usar" de "usar y editar", pero el guardado hace exactamente lo mismo
  para ambos (copia el APU) -- el "abrir el editor después de guardar"
  para el caso "editar" **no está conectado todavía**. Falta enganchar
  eso con `ApuEditorDialog`.
- **Interacción con el bug preexistente de `{error}` oculto** (el
  `<p>{error}</p>` que solo se muestra si `presupuesto.length > 0`): se
  evitó para el caso de códigos que no cuadran (los ítems ya están en el
  estado antes de validar), pero no se arregló de raíz -- sigue latente
  para otros casos de error tempranos.

### Riesgos generales a tener en cuenta

- El "Tipo" que trae el Excel es información no confiable (typos,
  mayúsculas raras, y en la práctica alguien puede poner cualquier cosa)
  -- el fallback sin filtro ayuda, pero no hay ninguna validación de que
  el `Tipo` escrito sea uno de los 4 válidos antes de llegar al matching.
- Mezclar "cantidad de líneas procesadas exitosamente" vs "cantidad de
  líneas que fallaron" no se reporta al usuario al final -- si algo falla
  silenciosamente en el loop de `handleConfirmarApu` (try/catch por
  ítem no implementado, solo hay try/catch alrededor de TODO el loop),
  un solo error tumba el resto del guardado sin decir cuáles ítems sí se
  alcanzaron a guardar.
- No se ha probado el camino de "solicitud de insumo" end-to-end dentro
  de este flujo nuevo (se creó la solicitud, pero no se confirmó que el
  ítem quede en un estado visualmente coherente en la tabla mientras la
  solicitud sigue pendiente).

### Pendientes para la próxima sesión

- Explicar a fondo cómo queda armado todo el flujo (pedido explícito del
  usuario) y ver juntos qué optimizar.
- Confirmar `categorias-apu.ts` real para corregir
  `CATEGORIAS_REALES_POR_TIPO` si hace falta.
- Probar con un presupuesto real completo (no solo el capítulo 11 de
  prueba) para calibrar los umbrales con casos reales.
- Decidir si vale la pena envolver `handleConfirmarApu` en algo más
  transaccional, o si un reporte claro de "qué se guardó y qué no" al
  final del proceso es suficiente por ahora.