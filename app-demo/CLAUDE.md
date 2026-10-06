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

## Pruebas y CI

- **Vitest** (`npm test`, `npm run test:watch`): pruebas de la lógica pura en
  `tests/*.test.ts` (sin base de datos ni navegador). Cubren `lib/contratos`,
  `minuta-mano-obra`, `numero-a-letras`, `calcular-nivel`, `numeros`,
  `ordenes-compra-calculos`, `similitud-texto`, `parse-apu-excel`, fechas,
  búsqueda y paginación. Al tocar una regla de esos archivos, agregar o
  ajustar su prueba. `npm run typecheck` también revisa las pruebas.
- **CI** (`.github/workflows/ci.yml`, en la raíz del repo): en cada push y PR
  corre tipos, pruebas y build (con variables de Supabase de relleno). El
  lint corre pero NO bloquea: hay ~140 errores heredados (sobre todo `any`);
  quitar `continue-on-error` cuando se limpien.
- **Falta**: pruebas de la base (pgTAP: RLS, funciones SECURITY DEFINER,
  topes) -- primero hace falta un volcado del esquema real, porque las
  migraciones no construyen la base desde cero; y pruebas de punta a punta
  (Playwright) contra un Supabase de pruebas.

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

## Selector de proyecto en el encabezado

La landing, la cookie y el provider son los de "Landing de proyecto y menú
reorganizado" (más abajo). Además del botón del sidebar, las páginas que
trabajan sobre un proyecto (Presupuestos, Requisiciones, Inventario, Salidas, Entradas)
tienen `SelectorProyecto` en su encabezado (`components/selector-proyecto.tsx`,
también dentro de `components/encabezado-pagina.tsx`): usa el mismo
mecanismo (`seleccionarProyecto` + `router.refresh()`), es solo un atajo.
Al hacer el merge con `lcpr` se descartó la landing propia de `spr`
(`proyecto-actual-provider.tsx`, `inicio-view.tsx`).

## Proveedores `/almacen/proveedores` (implementado)

Tabla tipo Excel sobre `proveedores` (~400 filas, se traen todas y se
filtran/ordenan en el cliente) con edición en línea por celda
(`components/proveedores-view.tsx`, validación compartida en
`lib/proveedores.ts`, usada en cliente y otra vez en el servidor).

- Sin textos montados: `table-fixed` + ancho fijo por columna + `truncate`
  con el texto completo en `title`. ID y Proveedor fijos al hacer scroll.
- Tabla o tarjetas se decide con **container query** (`@container` /
  `@3xl:`), no con breakpoint de pantalla: con el sidebar abierto en una
  tablet quedan ~460px y la tabla no sirve.
- Si un valor no valida y el usuario hace clic afuera, se descarta (no se
  retiene el foco -- eso "atrapaba" la celda). El foco tras error se da en
  un efecto porque el input sigue `disabled` justo después del await.
- Permisos: ver = pestaña `almacen.proveedores`; crear y editar = acción
  `editar_proveedores` (o Administrador), en la matriz de Roles; por defecto
  la tiene Líder Compras. Políticas RLS `proveedores_update` /
  `proveedores_insert` con la misma regla
  (`20261006000000_accion_editar_proveedores.sql`). RLS no da error al
  bloquear un UPDATE (0 filas), por eso las actions revisan que vuelva la fila.
- También se editan desde la tarjeta del proveedor en **Generar orden de
  compra** (`components/tarjeta-proveedor-oc.tsx`, action
  `actualizarDatosProveedor`: varios campos en un UPDATE, valida todo antes
  de escribir). Guarda en `proveedores` y actualiza la tarjeta, de donde la
  orden en curso toma teléfono/ciudad/correo; el PDF lee NIT, dirección y
  contacto de `proveedores`. Datos bancarios: solo lectura.
- Sin borrado de proveedores.
- Ojo con los datos: hay nombres con tildes/eñes mal codificados en la base
  (ej. `FERRETERÃA`, `ACUÃ‘A`) -- vienen así de la carga original.

## Tablas tipo Excel y encabezado estándar (implementado)

- `components/tabla-excel.tsx` (`TablaExcel`, `PaginacionExcel`): diseño de
  Proveedores como componente de SOLO presentación (el filtrado/orden/
  paginación los hace cada página). Lo usan Maestro de insumos y el Catálogo
  de MO/equipo (`admin-mo`). Proveedores todavía tiene su propia copia (con
  edición en línea) -- pendiente unificar.
- `components/encabezado-pagina.tsx`: menú + título + subtítulo + (opcional)
  `SelectorProyecto`. Inventario y Salidas ya usan el proyecto del header.
- Nuevo proveedor: `crearProveedor` asigna `PV####` (siguiente número) y
  reintenta si choca con `proveedores_id_prov_key` (UNIQUE, aplicado).

## Rendimiento: índices y hallazgos (2026-09-30)

Detalle completo en `REPORTE-cambios-y-rendimiento.md`. Lo no obvio:
- `ORDER BY col <-> término LIMIT n` (todas las `buscar_*_candidatos`) solo
  usa índices **GiST** de trigramas; los GIN no sirven para ordenar. Se
  agregaron (93 ms -> 5 ms). Cualquier búsqueda nueva por similitud con
  ORDER BY necesita GiST.
- FKs sin índice hacían que borrar en cascada fuera O(padres × hijos); se
  indexaron (`20261004200000_indices_rendimiento.sql`, aplicada).
- Catálogos (resuelto, `20261005100000_seguridad_catalogos.sql`):
  `maestro_insumos` UPDATE exige `aprobar_insumos`; `mano_obra_categorias` /
  `equipo_categorias` se leen con sesión y se escriben con
  `aprobar_mano_obra`. Siguen abiertas a cualquier autenticado: `apu`,
  `item_apu`, `apu_import_revision`, `transporte_precios`.
- Ninguna función de `public` es ejecutable sin sesión
  (`20261005200000_funciones_sin_anon.sql`); las nuevas tampoco (default
  privileges). `test_fase1_compras` (prueba que inserta datos) sin permiso
  para nadie -- pendiente decidir si se borra.
- Permisos fallan CERRADO: si `permisos_rol_usuario` falla, el middleware
  niega el acceso (solo rutas libres) y no lo guarda en su caché de 30 s.
- Middleware usa `getClaims()` (JWT ES256 validado localmente), no
  `getUser()`. Las server actions leen el usuario con `obtenerUsuarioId()`.
- **Políticas RLS: nada de funciones de permiso por fila.** Lo que no depende
  de la fila va envuelto en `(select f(...))` (se evalúa una vez por consulta)
  y "¿puede ver el proyecto?" se escribe
  `proyecto_id in (select public.proyectos_visibles((select auth.uid())))`, no
  `usuario_puede_ver_proyecto(uid, proyecto_id)` (misma respuesta, verificado).
  Tablas hijas: `exists (select 1 from padre where padre.id = padre_id)` (la
  subconsulta ya aplica la política del padre). "¿Puede editar el proyecto?":
  `proyecto_id in (select public.proyectos_editables((select auth.uid())))`.
  Si la columna admite null (`presupuestos.proyecto_id`), el caso null se
  agrega con la función vieja envuelta: `(select f((select auth.uid()), null::uuid))`.
  Ya no queda ninguna política por fila en `public` ni `storage`:
  Contratos (`20261012100000_rendimiento_rls_contratos.sql`, 2.000 solicitudes
  2.122 ms -> 8 ms) y todo lo demás (`20261012200000_rendimiento_rls_resto.sql`).
  Medido con 2.000 requisiciones / 6.000 líneas, 1.000 OC, 3.000 salidas
  (admin / usuario con rol de un solo proyecto): `requisiciones_vista` 500
  filas 2,9 s / 12,5 s -> 52 / 70 ms; `pedidos_insumos` 2,3 s / 12 s -> 73 /
  20 ms; órdenes de compra 0,9 s -> 22 / 6 ms; líneas de OC 2,1 s -> 5 ms;
  salidas 1,4 s -> 3 ms. Las mismas filas antes y después, y 1.292
  comparaciones de lectura, UPDATE e INSERT para 19 usuarios reales y
  simulados sin diferencias. `usuario_tiene_acceso_a_item`,
  `usuario_puede_ver_proyecto` y `usuario_puede_editar_proyecto` siguen
  existiendo (las usan RPC como `crear_requisicion` o `inventario_proyecto`, y
  el caso null de presupuestos), pero ninguna política las llama por fila.
- **Pruebas de volumen en transacción revertida (`do $$ ... raise exception`
  con los tiempos): los contadores NO se revierten.** Insertar filas de prueba
  avanza las secuencias/identity aunque se haga rollback (pasó:
  `contratos.numero` saltó a 6001 y hubo que renumerar). Mejor dar `numero` /
  `codigo_consecutivo` explícitos (p. ej. desde 9.000.000) en `requisiciones`,
  `ordenes_compra`, `pedidos_insumos`, `contratos`, `entradas_almacen`; si no,
  guardar el valor de la secuencia y restaurarlo (`setval` / `restart with`).
  Al terminar, revisar que `last_value` = `max(numero)`. Para insertar sin
  disparar triggers ni FKs: `set local session_replication_role = replica`.
- **Límites de la API que fallan en silencio o con listas largas**: cada
  respuesta se corta en 1000 filas (también las RPC que devuelven filas): lo
  que pueda crecer se trae con `traerTodo` (orden que termine en `id`). Y
  `.in("col", ids)` va en la URL: con cientos de ids falla; partir en tandas
  de ~100, o mejor filtrar en la misma consulta (embed `!inner`, como el
  filtro por insumo de requisiciones, `SELECT_REQUISICIONES_CON_INSUMO`).
  Revisión de requisiciones agrupadas: `20261010100000_rendimiento_requisiciones.sql`.
- **Guardar en lote la revisión de APU** (`resolverLineasRevisionEnLote`):
  lecturas en tandas de 150 ids (con 650 en un `.in()` daba 400 y no se
  guardaba nada), precios y presentaciones una vez por insumo, `item_apu` en
  inserts de 300 con el id generado en el servidor (todas las filas con las
  mismas columnas: en un insert en bloque la clave que falta queda NULL y
  `factor_unidad` es NOT NULL), y el update de cada línea de revisión 25 a la
  vez. Prueba con cliente falso en `tests/resolver-revision-lote.test.ts`.

## Reglas transversales (auditoría de casos borde, 2026-10-01)

- **Fechas sin hora** (`date`: fecha_requerida, fecha_entrega...): mostrarlas
  con `formatearFechaSinHora` (`lib/fechas.ts`), nunca con
  `new Date("AAAA-MM-DD").toLocaleDateString()` (en Colombia, UTC-5, salía
  un día antes). "Hoy" = `hoyColombia()`, no `toISOString()`. En SQL la base
  corre en UTC: usar `(now() at time zone 'America/Bogota')::date`, no
  `current_date` (`20261006300000_fechas_colombia.sql`). Lo que se renderiza
  en el servidor (PDF de OC) necesita `timeZone: ZONA_HORARIA`.
- **Cantidades de requisiciones, órdenes de compra, entradas y salidas: solo
  enteros** (decisión del usuario). Todo el flujo igual, para que nunca
  quede un saldo decimal imposible de recibir o sacar. Campos de texto:
  `leerCantidadEntera` (`lib/numeros.ts`: "1.500" = 1500, "1,5" se rechaza);
  campos numéricos: `step="1"` + `Number.isInteger`. Las server actions lo
  revalidan con `esCantidadEnteraPositiva`. Precios y porcentajes sí admiten
  decimales. Las cantidades del APU (por unidad) también.
- **Generar OC avisa precios sospechosos**: 3 veces o más por encima o por
  debajo del `vr_unitario` del maestro (no del precio efectivo, que ya puede
  estar contaminado). Un precio malo en una orden aprobada entra al promedio
  de `precios_efectivos_insumos` (caso real: Amarre teja valorado a $8.000
  con referencia $325, por la OC #26).
- **Retirar una OC pendiente**: `cancelar_orden_compra` acepta órdenes
  pendientes de quien las creó o de quien tenga `cancelar_oc`
  (`20261006400000_retirar_oc_pendiente.sql`); en pantalla el botón dice
  "Retirar". Las aprobadas siguen exigiendo `cancelar_oc` y sin entregas.
- **Cambios de estado**: toda acción que resuelve algo (aprobar/rechazar
  requisiciones, rechazo de Compras, rechazar solicitudes de insumo/MO/
  equipo) filtra por el estado esperado en el mismo UPDATE
  (`.eq("estado", "pendiente")`) y revisa que vuelva la fila. Si no, una
  pantalla abierta un rato podía aprobar algo ya cancelado o rechazar algo ya
  aprobado y en uso.
- **"Descartar y cargar otro"** en Presupuestos borra el presupuesto completo:
  pide confirmación, espera el resultado, y `EliminarPresupuesto` se niega si
  hay requisiciones.

## Auditoría de producción (2026-10-02)

- **Corregido**: `cargarVersion` y `crearNuevaVersion` traían solo 1000 ítems
  (presupuestos grandes se veían incompletos y la versión nueva perdía
  ítems); ahora usan `traerTodo`. Igual `listarRevisionLote` y
  `listarRevisionPorItems`.
- **Corregido**: copiar un APU (`crearNuevaVersion`, `copiarApuParaItem`,
  `copiarApuStandalone`) solo copiaba las columnas de insumo: se perdían las
  líneas de mano de obra, equipo, transporte y herramienta menor. Ahora
  copian `COLUMNAS_COPIA_ITEM_APU`.
- **Corregido** (lo encontraron las pruebas): valores en letras. "UNO PESO",
  "VEINTIUNO MIL", "TREINTA Y UNO MILLONES" -> UN / VEINTIÚN / TREINTA Y UN;
  "veintidos/veintitres/veintiseis" sin tilde; desde mil millones salía
  "UNDEFINED MILLONES"; 1,996 daba "100 centavos".
- **Corregido** (`20261017000001_acceso_proyecto_funciones.sql`):
  `resumen_ejecucion_proyecto` y `registrar_salida_almacen` (SECURITY
  DEFINER) no revisaban acceso al proyecto. Envoltura con el nombre de
  siempre + original renombrada con "_" (sin EXECUTE para usuarios).
- **Abierto**: `apu`, `item_apu`, `apu_import_revision` y
  `transporte_precios` aceptan escritura de cualquier usuario con sesión
  (cualquiera puede cambiar o borrar líneas de un APU por la API, y eso
  mueve los topes de requisiciones). `crearNuevaVersion` no es
  transaccional (si falla a mitad deja una versión vacía y APUs huérfanos).

## Unidades: presentación de insumos y conversión (2026-10-05)

Problema: el maestro tiene "CEMENTO X 50 KG" con u_m UND y precio del bulto;
un APU con "cemento 8,5 kg" enlazado a ese insumo costaba 8,5 bultos. Y Compras
no podía distinguir 50 m de 50 rollos.

- **Presentación** (`maestro_insumos.unidad_uso` + `contenido`): 1 u_m trae
  `contenido` de `unidad_uso` (1 bulto = 50 KG). u_m sigue siendo la unidad de
  compra y del precio. La define quien aprueba insumos: Maestra de insumos
  (columna, filtro, editor, "Revisar sugerencias" leídas del nombre con
  `sugerirPresentacion`) y Aprobación de insumos (campos "trae").
- **`lib/unidades.ts`**: `normalizarUnidad` ("UNIDAD - UND", "und", "ML",
  "m²"...), `compararUnidad(unidadLinea, insumo)` -> igual / conversion
  (factor = contenido) / distinta / sin_dato, `unidadesDeCompra` (redondea
  hacia arriba). Con pruebas en `tests/unidades.test.ts`.
- **Línea de APU** (`item_apu.unidad`, `factor_unidad`): el precio del insumo
  se divide por el factor; `precio_unitario_congelado` ya se guarda dividido
  (en la unidad de la línea). Todo insumo entra por `agregarInsumoApu`
  (`unidadLinea`, `confirmarUnidad`) o por el insert masivo del import; los
  dos usan `compararUnidad`. Unidad **distinta** = no se guarda: el automático
  queda pendiente y en la revisión el candidato sale "no cuadra" con casilla de
  confirmación ("la cantidad ya está en <u_m>", factor 1). Cambiar la
  presentación después NO toca líneas existentes (como el precio congelado).
- **Aviso de líneas** (`presupuesto_items.lineas_apu_oficial`): cuántas líneas
  traía el bloque del ítem en la hoja APU. Si el APU guardado (sin pendientes)
  tiene otra cantidad: banner ámbar + etiqueta "N de M líneas". No bloquea.
- **Conversión manual en el APU**: si la unidad no cuadra y el maestro no
  tiene presentación, en la revisión se escribe "1 caja = 1,44 m²"
  (`conversion` en `agregarInsumoApu` y resolvedores) y, si quien la escribe
  aprueba insumos, se puede guardar también en el maestro. En el editor de
  APU, "conversión" en cada línea de insumo (`actualizarConversionLineaApu`,
  recalcula el precio congelado con el factor nuevo).
- **Requisiciones y compras** (`20261026000000_unidades_compras.sql`): la
  requisición va en la unidad del presupuesto (ahí vive el cupo); de la OC en
  adelante (proveedor, precio, entradas, inventario, salidas, pagos) todo en
  unidad de compra. `pedidos_insumos.factor_unidad` (trigger, desde la línea
  del APU) es la conversión SUGERIDA; `ordenes_compra_items.factor_unidad` es
  la conversión REAL de cada compra, que Compras puede cambiar en Generar OC
  (columnas Solicitado / Conversión / Cantidad / UM / Equivale a).
  `_comprado_pedido` = Σ cantidad × factor de cada línea de orden (en la
  unidad de la requisición). Del presupuesto se descuenta
  `greatest(pedido, comprado)` (`_comprometido_insumo_item`): se piden 20 kg,
  se compra 1 bulto de 50, cuentan 50 kg. `crear_orden_compra` deja comprar
  hasta `ceil(pendiente / factor)` unidades y rechaza una línea ya completa.
  Completa = comprado ≥ pedido. Sin ampliación de cupo por ahora: si el
  redondeo agota el cupo, se usa lo de bodega o una versión nueva.
  `_resumen_ejecucion_proyecto_base` reporta todo en unidad de compra.
- **Maestro estandarizado al aprobar** (`aprobarSolicitudInsumo`): tipo del
  catálogo (`CATEGORIAS_APU`), u_m con el texto estándar (`unidadMaestro` /
  `UNIDADES_MAESTRO`: "m³" -> "METRO CUBICO - M3"), agrupación obligatoria
  (de las que ya existen, `listarAgrupacionesInsumos`) e IVA 0/5/19
  (`vr_neto` = precio × (1 + IVA)); `vr_unitario` es SIN IVA. Antes entraban
  "INSUMO", "m³", sin agrupación y $1.000 de prueba (19 insumos usados en 283
  líneas de APU). `sugerirPresentacion` ya no toma medidas ("1.22 X 2.44 M",
  "30 X 60 CM") ni días/horas como contenido.
- **Corregido de paso**: la versión de `crear_orden_compra` con anticipo
  (lcpr) volvía a contar órdenes RECHAZADAS como ya compradas (regresión de
  20261006100000); ahora no.

## UM disponible, excedentes de compras y las tres categorías de costo (2026-10-06)

- **UM disponible** (`generar-oc-view.tsx`, `lib/presentacion-compra.ts`,
  `20261029000000_oc_presentacion_compra.sql`): en cada línea de Generar OC,
  Compras elige una presentación (caja, rollo...) distinta de la unidad del insumo
  y escribe cuánto trae (1 caja = 2,08 m²); el sistema calcula las unidades
  completas (hacia arriba). La línea SIGUE guardando `cantidad` y `precio_unitario`
  en la unidad de compra del insumo (de ahí cuelgan Entradas, inventario, pagos y
  el precio promedio de los APU); la presentación va aparte en 5 columnas
  (`um_compra`, `conversion_compra`, `cantidad_compra`, `precio_compra`,
  `cantidad_por_um`). Entradas recibe en la presentación y la base convierte
  (`cantidad_compra` en `_registrar_entrada_almacen` / `_editar_entrada_almacen`).
  Se parchearon las versiones INTERNAS (`_...`): los envoltorios públicos llevan el
  permiso por proyecto (`_exigir_proyecto_almacen`) y no se tocan.
- **Se puede pasar de la requisición solo por el redondeo** a unidades completas
  (`crear_orden_compra`: máximo = ceil(pendiente / lo que trae cada unidad)).
- **Excedentes de compras** (`20261030000000_excedentes_de_compras.sql`): lo
  comprado de más NO se descuenta del cupo (`_comprometido_insumo_item` cuenta lo
  pedido, no `greatest(pedido, comprado)`). El costo se clasifica en tres
  categorías (para la futura pestaña de control y supervisión del proyecto), en
  la vista `v_ordenes_compra_items_costos`: **Compras** = lo pagado en la OC;
  **Requisiciones** = el costo de lo que salió en la requisición (10 m², no 11);
  **Excedentes de compras** = Compras − Requisiciones. Las líneas de un mismo
  pedido se recorren por fecha y cada una cubre lo que le falte al pedido; se
  calcula en el momento. Pago, OC e inventario no cambian (al proveedor se le paga
  todo).
- **Requisiciones compradas a medias** (`20261031000000_cerrar_saldo_requisicion.sql`):
  mientras una requisición esté abierta, el cupo cuenta lo PEDIDO completo (10),
  aunque solo se hayan comprado 8. **Cerrar saldo** (`cerrar_saldo_pedido`, botón
  en Compras > Requisiciones cuando ya hay compra parcial, y en la pestaña
  **Saldos pendientes** `/almacen/saldos-pendientes`) libera lo no comprado: reutiliza
  `rechazado_compras_at/por` (que ya hacen que el cupo cuente solo lo comprado) y
  marca `saldo_cerrado_at/por` para distinguirlo de un rechazo; avisa al ingeniero
  (notificación tipo `pedido_rechazado` con título "Saldo de requisición cerrado").
  `listar_saldos_pendientes` lista las compradas a medias con cuánto falta y los días
  desde la última compra (colores 15/30 días solo visuales; no hay cierre automático).
- **La base viva puede ir por delante de `lcpr`**: otra rama
  (`claude/tender-maxwell-iresrp`) aplica migraciones a Supabase. Antes de
  `create or replace` de una función, leer su `prosrc` vivo (MCP de solo lectura).

## Pendientes generales

### Revisión 2026-10-06 (rama `claude/tender-maxwell-iresrp`)
Hecho: limpieza del maestro aplicada en producción (unidades estándar, 18
insumos de $1.000 borrados, sus líneas volvieron a "Revisar pendientes");
`20261027000000_redondeo_valor_total.sql` (total = unitario redondeado ×
cantidad; había 31 ítems descuadrados). Pendiente:
- **Migraciones por correr**, en orden: `20261023000000_ayf_rls_initplan.sql`
  (A&F, solo reescribe políticas), `20261027000000_redondeo_valor_total.sql`,
  `20261028000000_contratos_rls_initplan.sql` y
  `20261028100000_pg_trgm_esquema_extensions.sql` (las dos últimas vienen de
  lcpr, renumeradas al mezclar: chocaban con 20261024/20261025 de esta rama).
  **No correr la versión de lcpr de la de pg_trgm**: mueve la extensión sin
  ajustar el search_path de las `buscar_*_candidatos`, que usan `<->` con
  `search_path = public`, y el import de APU falla ("operator does not exist").
  La de esta rama les agrega `extensions` al search_path en la misma corrida.
  `verificar_migraciones.sql` revisa todas.
- **Región**: Supabase está en us-west-2 (Oregón); cada consulta tarda ~180 ms
  (p50 medido en edge_logs) aunque sea trivial. Si la app está en Vercel,
  poner las funciones en `pdx1`. Es la mejora más grande y no es código.
- **Import de APU** (~3,5 min el Malecón, 18 tandas de ~6,5 s): mano de obra
  hace un RPC por ítem (catálogo de 264: traerlo una vez y comparar en
  memoria); `lineas_apu_oficial` se actualiza en serie (paralelo); precios,
  presentaciones e inserts de insumo/equipo/herramienta van en serie;
  `page.tsx` espera `refrescarEstadosApu` antes de la tanda siguiente.
- **Decisiones del usuario**: seguridad de `apu`/`item_apu`/
  `apu_import_revision`/`transporte_precios` (hoy cualquier sesión escribe);
  quién pone el precio al aprobar un insumo; ampliación de cupo.
- **Datos**: Guadua 6 m (código 5473) sigue a $1.000 (está en la requisición
  27 y en una OC, no se pudo borrar); 25 ítems nivel ≥ 3 sin APU (valen $0);
  4 pares de duplicados en el maestro (3104/4134, 4561/4564, 2367/3899,
  1581/1582); 125 presentaciones sugeridas por revisar en la Maestra.
- **Supabase**: activar "Leaked password protection" (Auth); políticas de
  presupuestos/ítems/versiones evalúan "ver" y "editar" en cada lectura
  (separar la de editar en insert/update/delete).
- Import y "Crear versión nueva" no son todo-o-nada (ver más abajo).

- **Seguridad APU** (auditoría 2026-10-02): `apu`, `item_apu`,
  `apu_import_revision` y `transporte_precios` aceptan escritura de cualquier
  usuario con sesión. Propuesta: exigir `editar_presupuestos` para escribir.
- **`crearNuevaVersion` atómica**: pasarla a una función SQL (hoy, si falla a
  mitad, deja una versión vacía y APUs huérfanos).
- **Resuelto en `20261024000000_requisiciones_y_almacen_por_proyecto.sql`
  (falta aplicarla en producción, junto con el deploy de la app)**:
  (1) usuarios sin INSERT/UPDATE/DELETE en `pedidos_insumos`,
  `ordenes_compra` y `ordenes_compra_items` (todo va por RPCs SECURITY
  DEFINER); el rechazo de Compras pasa a `rechazar_pedido_compras()`.
  (2) Almacén por proyecto: entradas, salidas, inventario y listados exigen
  ver el proyecto (`usuario_puede_ver_proyecto`/`proyectos_visibles`); quien
  tiene "todos los proyectos" los sigue viendo todos. Se borró el
  `listar_ordenes_entradas` viejo. Probada sobre `supabase/esquema/`.
- `crear_orden_compra` acepta líneas rechazadas por compras
  (`rechazado_compras_at`). Tabla sobrante `_tmp_auditoria_buscar` en
  producción. Las migraciones 15/16/17 están aplicadas pero no registradas
  en `schema_migrations`.
- **Esquema real**: `supabase/esquema/` tiene el volcado de producción
  (solo lectura, validado en Postgres 16). Usarlo como referencia en vez de
  las migraciones, que no cuadran con la base.

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
lib/apu-import-types.ts       -- tipos compartidos (ResolucionInsumo, FilaRevisionImport, etc.)
components/revision-apu-dialog.tsx  -- revisión de líneas pendientes del import
```

**Nota (2026-09-30)**: el flujo descrito en esta sección quedó
desactualizado -- hoy el matching y el guardado corren del lado del
servidor en `matchearYGuardarImportApu`, por tandas de 40 ítems desde
`page.tsx`. `lib/apu-item-flow.ts`, `lib/matching-apu-import.ts`,
`components/revision-import-apu-dialog.tsx` y `buscarApusSimilares` se
eliminaron (no se usaban).

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

## Roles y permisos (implementado)

Reemplaza el esquema de banderas en `perfiles` + grupos. Un usuario tiene
**un rol general** (`perfiles.rol_id`) y **una lista de proyectos**
(`usuario_proyectos`, o `perfiles.todos_los_proyectos`).

- **Tablas**: `roles` (clave, nombre, es_sistema, orden), `rol_permisos`
  (rol_id, permiso). El permiso es `'tab.<clave>'` (una pestaña del menú) o
  `'accion.<clave>'` (algo que se puede hacer dentro). El rol
  `administrador` siempre tiene todo y no se edita. Roles base: Compras,
  Líder Compras, Área Técnica, Líder Técnico, Gerencia, Administrador,
  Legal, Líder Legal; se pueden crear más desde la página.
- **`lib/pestanas.ts`**: única fuente de verdad de pestañas, rutas que cada
  una habilita y acciones. La matriz, el menú lateral y el middleware leen de
  ahí. Gana la ruta más específica (`/almacen/entradas` es de Entradas, no de
  Pedidos aunque `/almacen` sea prefijo). Agregar una pestaña = una entrada.
- **Páginas (solo Administrador)**: `/admin/roles` (matriz rol × permiso, se
  guarda al instante) y `/admin/accesos` (rol y proyectos de cada usuario).
- **Middleware** (`lib/supabase/middleware.ts`): en cada request llama UNA vez
  a `permisos_rol_usuario`, protege la ruta y deja los permisos en el header
  `x-permisos`. Las Server Actions (`requerirAdmin`, `requerirAccion`,
  `requerirPestana`, `requerirScope` en `lib/permisos.ts`) los leen de ahí.
  **Seguridad**: el middleware borra siempre `x-user-id`, `x-permisos`,
  `x-es-admin` y `x-scope-*` si vienen del cliente. Antes se copiaban y solo
  se sobrescribían en algunas rutas, así que un usuario con sesión podía
  mandar `x-es-admin: true` a una Server Action y pasar `requerirAdmin`
  (que además usa la llave de servicio).
- **Base de datos**: `tiene_accion(uid, accion)` decide las acciones. Las
  funciones de ayuda (`es_admin`, `rol_compras`, `admin_insumos`,
  `admin_proyectos`, `admin_usuarios`, `usuario_puede_ver_proyecto`,
  `usuario_puede_editar_proyecto`, `usuario_tiene_acceso_a_item`,
  `obtener_permisos_usuario`) conservan nombre y firma, así que las ~35
  políticas RLS que las usan no cambiaron. `rol_compras()` = acción
  `comprar`, `admin_insumos()` = `aprobar_insumos`, `admin_proyectos()` =
  `aprobar_pedidos`. Editar presupuesto es la acción `editar_presupuestos` +
  ver el proyecto (el proyecto asignado solo da acceso).
- **Compatibilidad**: un usuario con `rol_id` NULL sigue con las banderas
  anteriores y los grupos, idéntico a antes. `20261001100000_migrar_usuarios_a_roles.sql`
  (se corre aparte, cuando la matriz esté lista) asigna rol según las
  banderas: es_admin -> Administrador, rol_compras -> Compras,
  admin_insumos/admin_proyectos/admin_mano_obra -> Líder Técnico.
  Si `permisos_rol_usuario` falla, el middleware y `lib/permisos.ts` niegan el
  acceso (fallan cerrado); ya no caen a las banderas.
- **Acciones**: `editar_presupuestos`, `aprobar_pedidos`, `aprobar_mano_obra`,
  `aprobar_insumos`, `gestionar_almacen` (entradas/salidas),
  `comprar`, `aprobar_oc`, `desaprobar_oc`, `cancelar_oc`.
- **Pendiente**: siguen abiertas a cualquier usuario con sesión `apu`,
  `item_apu`, `transporte_precios` y `apu_import_revision` (la restricción por
  pestaña las oculta de la pantalla pero no de la API). `maestro_insumos` y
  los catálogos de MO/equipo ya se cerraron (ver "Rendimiento: índices y
  hallazgos").


## Desaprobar y cancelar órdenes de compra (implementado)

Migración `20261002000000_desaprobar_cancelar_oc.sql`. Acciones del rol
`desaprobar_oc` y `cancelar_oc` (se dan en Roles y permisos); la base valida el
permiso y las reglas, la pantalla solo decide si muestra el botón
(`sePuedeDesaprobar` / `sePuedeCancelar` en `lib/ordenes-compra-estado.ts`).

- **Desaprobar** (botón en Aprobación de órdenes de compra y en el detalle):
  aprobada -> pendiente_aprobacion. Solo si `enviada = false` y
  `estado_entrega = 'sin_entregar'`. Motivo obligatorio
  (`motivo_desaprobacion`); se limpian `aprobada_por/aprobada_at`.
- **Cancelar** (botón en Órdenes de compra y en el detalle): aprobada ->
  cancelada. Solo si `estado_entrega = 'sin_entregar'` y sin entradas vigentes
  (Entrega parcial y Entregada NO se cancelan). Puede estar enviada: el check
  `ordenes_compra_enviada_requiere_aprobada` ahora permite
  `enviada` con estado `aprobada` o `cancelada`, para conservar el dato de que
  ya se había enviado al proveedor. Motivo obligatorio (`motivo_cancelacion`).
- **`enviada`** es una casilla manual: Compras pulsa "Marcar como enviada"
  (`marcar_orden_enviada`). El sistema no envía nada ni guarda quién/cuándo.
- **Liberar requisiciones al cancelar o rechazar**: las líneas de órdenes
  **canceladas o rechazadas** no cuentan como "ya comprado" en
  `crear_orden_compra`, `desaprobar_pedido`, `cancelar_pedido` (SQL) ni en
  `mapPedidoParaComprar` (cola de Compras y Generar OC). Antes las rechazadas
  seguían contando y la cantidad quedaba bloqueada para siempre
  (`20261006100000_liberar_ordenes_rechazadas.sql`). Es seguro porque una
  orden rechazada no puede volver a activarse. Si se agrega un estado de
  orden nuevo, revisar estos 4 lugares.
- **Cantidad comprometida de una requisición** (tope del presupuesto): una
  sola función, `_comprometido_insumo_item`, la usan `disponible_insumo_item`
  y `buscar_insumos_presupuesto`
  (`20261006200000_cantidades_consistentes.sql`). Reglas:
  pendiente + aprobada; de una **rechazada por Compras** solo cuenta lo que
  ya está en órdenes vigentes; y se suman las requisiciones del **mismo ítem
  en cualquier versión** (mismo presupuesto + mismo código), porque
  `crearNuevaVersion` copia los ítems con ids nuevos. Si el código de un ítem
  cambia entre versiones, sus requisiciones viejas dejan de contar.
- `verificar_salida_no_supera_disponible` (trigger de salidas) ignora las
  salidas anuladas; antes las contaba y lo anulado no se podía volver a sacar.
- **Notificaciones de aprobación/rechazo** (campanita): las generan
  `trg_notificar_resolucion_pedido` y `trg_notificar_resolucion_oc`
  (`20261007000000`), con el motivo. Los triggers viejos que hacían lo mismo
  se quitaron (`20261007100000_quitar_notificaciones_duplicadas.sql`): cada
  rechazo llegaba dos veces. No agregar otro trigger de notificación sobre
  esas tablas sin revisar estos.
- `cancelar_pedido` en la base no coincidía con su migración (una versión
  aplicada a mano solo dejaba cancelar al solicitante con la requisición
  pendiente; el botón de los aprobadores fallaba siempre). La misma migración
  la restauró. Las migraciones de lcpr se aplicaron desde el editor SQL y no
  aparecen en el registro de Supabase: verificar contra la base, no solo
  contra los archivos.


## Historial y pedidos: desaprobar / cancelar / modificar (implementado)

Migración `20261003000000_historial_y_pedidos.sql`.

- **`historial_eventos`** (entidad_tipo `orden_compra`|`pedido`, entidad_id,
  evento, usuario_id, motivo, datos, created_at): registro **inmutable** de
  quién hizo qué y cuándo. Lo escriben DISPARADORES sobre `ordenes_compra`
  (`trg_historial_orden_compra`) y `pedidos_insumos` (`trg_historial_pedido`),
  así que cubre cualquier camino y no depende de las pantallas. Sin policies
  (nadie edita ni borra); se lee con `historial_entidad(tipo, id)`, que valida
  que quien pregunta pueda ver la orden/pedido. Eventos de órdenes: creada,
  aprobada, rechazada, desaprobada, cancelada, marcada_enviada,
  entrega_actualizada. De pedidos: creado, modificado (antes/después),
  aprobado, rechazado, desaprobado, cancelado, rechazado_por_compras. La
  historia previa a la migración se reconstruyó (creación y aprobación/rechazo,
  marcada `reconstruido`); lo que no se guardaba (quién marcó "enviada") no se
  pudo recuperar.
- **UI**: `components/historial-timeline.tsx` (línea de tiempo + diálogo). Se
  ve en el detalle de la orden de compra, en Pedidos (botón Historial) y en
  Aprobación de pedidos.
- **Pedidos**: nuevo estado `cancelado` (la cantidad vuelve a estar disponible
  porque `buscar_insumos_presupuesto`/`disponible_insumo_item` solo cuentan
  pendiente+aprobado). Cancelar ya **no borra** la fila (se quitó la policy
  `pedidos_insumos_delete_propio_pendiente`).
  - `modificar_pedido`: solo quien lo hizo, solo pendiente; cambia cantidad,
    fecha requerida, urgente y observaciones (no insumo ni ítem); el tope es
    lo disponible + la cantidad actual del mismo pedido.
  - `cancelar_pedido(id, motivo)`: solo quien lo hizo y solo pendiente
    (`20261006150000_cancelar_pedido_solo_propio.sql`, decisión de lcpr). La
    acción `cancelar_pedidos` ya no da nada en la base; el botón de
    aprobadores se quitó.
  - `desaprobar_pedido(id, motivo)`: acción `desaprobar_pedidos`; aprobado ->
    pendiente, mismas condiciones sobre órdenes de compra. Limpia
    `resuelto_*`; el rastro queda en el historial.
  - Aprobar / rechazar sigue siendo la acción `aprobar_pedidos`.
- **Acciones nuevas en la matriz**: `desaprobar_pedidos`, `cancelar_pedidos`
  (el Líder Técnico las recibe en la migración).
- Nota: el parser `pglast` no puede validar funciones de disparador (falla con
  cualquiera, incluso `return new;`): esas se revisan leyendo el SQL.


## Landing de proyecto y menú reorganizado (implementado)

- **El proyecto se elige UNA sola vez**, en `/inicio` (landing): a donde se llega
  al iniciar sesión (login, `/` y `/login` ya autenticado redirigen ahí) y a
  donde se manda a quien no puede ver la ruta que pidió
  (`?error=no-autorizado`). Es una ruta libre: no pertenece a ninguna pestaña.
  Al elegir un proyecto se va a la primera pestaña del rol
  (`rutaPrimeraPestana`).
- **Dónde vive**: cookie `proyecto_actual` (httpOnly, 30 días) que fija la
  acción `seleccionarProyecto` (`app/(app)/inicio/actions.ts`). No da acceso a
  nada: `layout.tsx` la valida contra `listarMisProyectos()` (RLS de
  `proyectos`) y la ignora si el proyecto ya no es accesible. El layout la
  entrega a las pantallas con `ProyectoProvider` /
  `useProyectoActual()` (`components/proyecto-provider.tsx`). Cambiar de
  proyecto = `seleccionarProyecto` + `router.refresh()`: las pantallas que
  dependen de `proyecto.id` se recargan solas. Sin proyecto elegido, las
  pantallas muestran `components/sin-proyecto.tsx` (enlace al landing).
- **Ya no hay selector de proyecto** en: Elaboración de requisiciones
  (`almacen/page.tsx`), Inventario, Salidas, Entradas, Compras > Requisiciones (panel de
  filtros), Elaboración de presupuestos y Visualización. El cambio se hace
  desde el botón "Cambiar proyecto" del menú lateral o, como atajo, desde el
  `SelectorProyecto` del encabezado de esas páginas.
- **No filtran por proyecto actual** (siguen viendo todos los proyectos que el
  usuario tiene): Aprobación de requisiciones, Órdenes de compra, Aprobación
  de órdenes de compra.
- **Entradas sí filtra por el proyecto actual** (selector en el encabezado,
  como Inventario y Salidas): `listar_ordenes_para_entrada(p_incluir_entregadas,
  p_proyecto_id)` filtra en la base y valida el acceso al proyecto
  (`20261010200000_entradas_por_proyecto.sql`). La vista se remonta con
  `key={proyectoId}` al cambiar de proyecto.
- **Menú** (`lib/pestanas.ts`): Presupuestos / Requisiciones / Almacén /
  Compras / Contratos / Control / Administrador. "Pedidos" pasó a llamarse
  **Requisiciones** en pantalla; las rutas (`/almacen`, `/admin-tecnico`,
  `/almacen/comprar-pedidos`...), las tablas (`pedidos_insumos`), las
  funciones SQL y las CLAVES de permisos (`tecnico.pedidos`,
  `compras.comprar_pedidos`, acciones `aprobar_pedidos`...) NO cambiaron, para
  no romper nada ni perder los permisos guardados. Solo cambian títulos y
  secciones. "Elaboración de actas" es la pestaña `contratos.cortes` (antes
  "Cortes de proyectos"); "Informes" se quitó del menú.
- Los mensajes de error que lanza la base (`raise exception '... pedido ...'`)
  todavía dicen "pedido": cambiarlos requiere recrear las funciones SQL.


## Control administrativo (simplificado)

`/admin` ahora solo tiene dos pestañas:
- **Proyectos**: crear y editar proyectos (código, nombre, empresa, ciudad),
  sin cambios respecto a antes.
- **Empresas**: crear, editar y eliminar (`crearEmpresa`, `editarEmpresa`,
  `eliminarEmpresa` en `admin/actions.ts`). Solo NIT y razón social. No se
  puede eliminar una empresa que tenga proyectos (se cuenta antes y se avisa)
  ni una con datos asociados (error 23503 -> mensaje legible); NIT repetido
  (23505) también tiene mensaje propio. La lista de empresas se comparte con
  la pestaña Proyectos: lo que se cambie se ve al instante en su dropdown.

Se quitaron las pestañas **Usuarios** y **Grupos** (las reemplazan Roles y
permisos y Usuarios y accesos) y las acciones que solo ellas usaban (banderas
de `perfiles`, grupos, asignación de proyectos por grupo). Las tablas
`grupos`, `grupo_proyectos`, `usuario_grupos` siguen en la base (las leen las
funciones de compatibilidad para usuarios sin rol) pero ya no hay pantalla
para editarlas.

**Crear usuarios y cambiar contraseñas** eran exclusivos de la pestaña
Usuarios: se pasaron a **Usuarios y accesos** (botón "Nuevo usuario" con rol
opcional, y el ícono de llave en cada fila). `crearUsuario` ahora recibe
`{ nombre, email, password, rolId? }`; usa la llave de servicio y sigue sin
haber auto-registro.

## Requisiciones agrupadas (implementado)

Una **requisición** es una cabecera con **número** (Requisición 1, 2...) que agrupa
cualquier cantidad de insumos, como las órdenes de compra. Migración
`20261008000000_requisiciones.sql`.

- Tabla `requisiciones` (id = `pedidos_insumos.grupo_pedido_id`, así lo que ya
  existía quedó agrupado sin tocar sus líneas). Las **líneas** siguen siendo las
  filas de `pedidos_insumos` (una por insumo + ítem): de ahí salen el cupo del
  presupuesto, las órdenes de compra, el inventario y la visualización.
- El **estado no se guarda**: la vista `requisiciones_vista` lo deriva de las
  líneas. `estado` = pendiente | aprobada | rechazada | cancelada;
  `estado_compra` (solo aprobadas) = completa (todas sus líneas ya en órdenes de
  compra vigentes) | pendiente | rechazada_compras.
- **Cupo**: sin cambios. Cada línea cuenta como comprometida mientras esté
  pendiente o aprobada (`_comprometido_insumo_item`); cancelar o rechazar la
  requisición pasa todas sus líneas a cancelado/rechazado y el cupo vuelve solo.
  `modificar_requisicion` revalida cada línea contra el cupo (disponible + lo que
  esa misma línea ya tenía reservado).
- **Funciones** (todas sobre la requisición entera): `crear_requisicion`,
  `resolver_requisicion` (aprobar/rechazar), `desaprobar_requisicion`,
  `cancelar_requisicion` y `modificar_requisicion` (solo quien la hizo, solo
  pendiente; agregar/quitar/cambiar insumos, cantidades, fecha, urgencia y
  observaciones). Registran eventos en `historial_eventos` con
  `entidad_tipo = 'requisicion'` y notifican una sola vez por requisición.
- **Compras** sigue comprando y rechazando **por línea**: la pantalla las agrupa
  por requisición (puede elegir solo algunos insumos de una requisición para una
  orden de compra y el resto para otra). Una requisición queda "Completa" cuando
  todas sus líneas están en órdenes de compra.
- Pantallas: Aprobación de requisiciones (por requisición), Registro de
  requisiciones (lista con filtros, incluido Número de requisición) y su detalle
  `/almacen/registro-requisiciones/[id]` (insumos, solicitante, fechas, proyecto,
  historial; Modificar y Cancelar si es el dueño y está pendiente).
- Las funciones por línea anteriores (`cancelar_pedido`, `modificar_pedido`,
  `desaprobar_pedido`) siguen en la base pero la app ya no las usa.

## Regla de rendimiento: todo en tiempo lineal

La app va a manejar mucho volumen, así que ningún cambio puede ser O(n²):
indexar con `Map`/`Set` antes de recorrer (nada de `.find()`/`.filter()`/
`.includes()` dentro de un bucle sobre colecciones grandes), agrupar en una
sola pasada, y en la base usar consultas por lotes (`in`, joins, RPC) en vez de
una consulta por fila; acotar los listados con filtros y `limit` del lado del
servidor.


## Contratistas `/contratos/contratistas` (implementado)

Primera pieza del módulo de Contratos (plan revisado con Jurídica). Directorio
de personas naturales y jurídicas con los **documentos generales** que exige
Jurídica para todo contrato; los que dependen del tipo de contrato (planilla de
seguridad social, SOAT, cotización...) van con el contrato, después.

- **Tablas** (`20261011000000_contratistas.sql`): `contratistas` (tipo de
  persona, documento + DV, nombre/razón social, representante legal si es
  jurídica, contacto, datos bancarios; `created_by` -> `perfiles`) y
  `contratista_documentos` (un documento vigente por tipo, con su ruta en
  Storage). Documento único por (tipo, número). Jurídica = NIT; el DV se valida
  con el algoritmo de la DIAN (`dv_nit` en la base, `calcularDvNit` en
  `lib/contratistas.ts`; probado contra 380 NIT de proveedores, 379 cuadran).
- **Obligatorio para crear**: todos los datos y los documentos obligatorios
  (catálogo en `DOCUMENTOS_POR_PERSONA`; hoja de vida es opcional). No hay
  contratista "a medias": `crear_contratista` (SECURITY DEFINER) valida todo,
  comprueba que cada archivo exista en Storage e inserta datos + documentos en
  una transacción.
- **Archivos**: primer uso de Supabase Storage en el proyecto. Bucket PRIVADO
  `contratistas` (PDF/JPG/PNG, 10 MB), ruta `<contratista_id>/<tipo>-<n>.<ext>`.
  El navegador sube con la sesión del usuario (políticas de `storage.objects`
  exigen la acción) y luego llama la Server Action; si algo falla, borra lo que
  subió (la política de DELETE solo deja borrar archivos que todavía no son
  documento de nadie). Para ver un documento: enlace firmado de 2 minutos
  (`enlaceDocumentoContratista`).
- **Permisos**: pestaña `contratos.contratistas` (ver) y acción
  `gestionar_contratistas` (crear). `tiene_pestana(uid, clave)` es nueva (la
  usan las políticas, igual que `tiene_accion`). Por defecto ven Gerencia,
  Legal, Líder Legal y Director de obra; crean Legal, Líder Legal y Director
  de obra.
- **Rol "Director de obra"** (`director_obra`, de sistema,
  `20261011100000_rol_director_obra.sql`): arranca solo con ver y crear
  contratistas; el resto se asigna en la matriz. El aviso de contrato vencido
  sin acta de liquidación lo va a buscar por esta clave.
- **Ver documentos**: se abren dentro del mismo diálogo de detalle
  (`components/visor-documento.tsx`: PDF en iframe, imagen en img, con "Abrir
  aparte"), igual en Solicitud de contratos. Funciona porque los enlaces
  firmados de Storage no traen X-Frame-Options ni `Content-Disposition:
  attachment` (revisado).
- **Pendiente**: editar datos, reemplazar o agregar documentos, y vencimientos
  (p. ej. certificación bancaria o cámara de comercio con más de 30 días).


## Solicitud de contratos `/contratos/solicitar` (implementado)

El director de obra arma la solicitud para el proyecto actual (selector del
encabezado) y la manda a **pre-aprobación**; la minuta se hará en "Elaboración
de contratos" (pestaña `contratos.contratos`, todavía sin página).

- **Formulario** (`components/solicitud-contrato-form.tsx`): tipo de contrato
  (define los documentos que se piden), contratista (buscador sobre el
  directorio; muestra sus datos y documentos generales y llena el correo de
  notificación, editable), objeto (debe empezar por verbo en infinitivo:
  `empiezaConVerbo` / CHECK en la base), valor y anexo (valor global, o tabla de
  valores unitarios cuyo total ES el valor), anticipo (casilla + %), forma y
  plazo de pago (texto libre por ahora), plazo (por fechas o por duración en
  días/meses con inicio estimado opcional), obligaciones específicas,
  entregables, observaciones y documentos del tipo.
- **Tipos y documentos** (tabla de Jurídica): `TIPOS_CONTRATO` en
  `lib/contratos.ts` y `documentos_tipo_contrato()` en la base -- cambiar los
  dos a la vez. Son 6 tipos (la imagen de Jurídica); "si aplica" = opcional.
- **Tablas** (`20261012000000_solicitud_contratos.sql`): `contratos`
  (`numero` identity, `estado` solo 'pre_aprobacion' por ahora),
  `contrato_obligaciones`, `contrato_entregables`, `contrato_anexo_items`,
  `contrato_documentos`. Bucket privado `contratos`, ruta
  `<contrato_id>/<tipo>.<ext>`. `crear_solicitud_contrato` guarda todo en una
  transacción, verifica archivos y documentos obligatorios, y con valores
  unitarios CALCULA el valor desde el anexo (no confía en la suma del navegador).
- **Valores unitarios = ítems del presupuesto vigente**
  (`20261013000000_contratos_anexo_presupuesto.sql`): cada actividad del anexo
  es un `presupuesto_item` (`contrato_anexo_items.presupuesto_item_id`); la
  descripción y la unidad se copian del presupuesto. Topes, revisados en el
  formulario y otra vez en `crear_solicitud_contrato` (con bloqueo de los
  ítems para que dos solicitudes simultáneas no pasen juntas): cantidad <=
  presupuestada menos lo ya contratado, y valor unitario <= el del
  presupuesto. Lo contratado se suma por presupuesto + código (como las
  requisiciones), así sigue contando en versiones nuevas. Hoy cuentan TODOS
  los contratos; cuando existan estados rechazado/anulado, excluirlos en
  `_contratado_item` e `items_presupuesto_para_contrato`. Un ítem del
  presupuesto con contratos no se puede borrar (FK).
- **Números** en formato colombiano con `leerNumero` (`lib/contratos.ts`):
  "1.250,5" = 1250,5; "38.500" = 38500; "2.5" = 2,5.
- **Permisos**: pestaña `contratos.solicitar` (ver las del proyecto) y acción
  `solicitar_contratos` (mandar). Ver = esa pestaña o la de Elaboración, y
  acceso al proyecto (`puede_ver_contrato`). Quien solicita también puede leer
  contratistas (para elegir uno). Por defecto: Director de obra solicita;
  Gerencia, Legal y Líder Legal ven.
- **Obligatorios extra** (`20261016000001_solicitud_valor_mensual.sql`, que
  recrea `_guardar_solicitud_contrato`; igual en `validarSolicitud`):
  obligaciones específicas y entregables, al menos uno cada uno (si no hay, se
  escribe "N/A" o "No aplica"; `esNoAplica` evita copiarlos a la minuta); y
  **valor de pago mensual** (`contratos.valor_mensual`, <= valor) en
  prestación de servicios, alquiler de vehículo y arrendamiento
  (`TIPOS_CON_PAGO_MENSUAL`). Sin CHECK en la tabla, para no romper las
  solicitudes viejas al aprobarlas. El anticipo y los valores se muestran
  también en letras (`anticipoEnLetras`, `pesosEnLetras`).
- **Pendiente**: borradores (hoy el formulario se pierde si se sale), pantalla
  de pre-aprobación/minutas, opciones fijas de forma/plazo de pago cuando
  Jurídica las defina, y el 7.º tipo de contrato si existe.


## Pre-aprobación de contratos `/contratos/pre-aprobacion` (implementado)

Jurídica revisa las solicitudes de TODOS los proyectos que puede ver (no usa el
proyecto actual; filtro por estado y proyecto) y las **pre-aprueba**,
**devuelve** con motivo o **rechaza** con motivo
(`20261014000000_preaprobacion_contratos.sql`).

- **Estados** de `contratos`: `pre_aprobacion` -> `aprobada` | `devuelta` |
  `rechazada`. Una **devuelta** la corrige el director: "Corregir y reenviar"
  abre el mismo formulario lleno (`edicion`), con los documentos actuales
  (se conservan o se cambian), y vuelve a `pre_aprobacion` con el MISMO número
  (`reenviar_solicitud_contrato`). Rechazada es definitiva.
- **Presupuesto**: devuelta sigue reservando su cantidad; rechazada deja de
  contar (`_contratado_item` e `items_presupuesto_para_contrato` excluyen
  `rechazada`). Al reenviar, la base borra las líneas propias ANTES de revisar
  topes, y el formulario suma lo propio al disponible (si no, la solicitud
  competiría contra sí misma).
- **Lógica común**: `_guardar_solicitud_contrato(..., p_existente)` hace crear
  y reenviar; `resolver_solicitud_contrato(id, accion, motivo)` resuelve
  (bloquea la fila y exige estado `pre_aprobacion`: dos personas no resuelven
  la misma).
- **Historial** (`historial_eventos`, entidad `contrato`): creada, reenviada,
  aprobada, devuelta, rechazada; se ve en el detalle (`HistorialTimeline
  tipo="contrato"`). **Notificaciones**: solo a usuarios con rol **Legal** o
  **Líder Legal** (que además tengan `aprobar_contratos` y vean el proyecto)
  cuando llega o vuelve una solicitud -- NO a los Administradores (decisión
  del usuario, `20261014100000_notificar_solo_legal.sql`); al solicitante
  cuando se resuelve. La campanita lleva a
  `?ver=<id>` en Pre-aprobación o en Solicitud de contratos.
- **Detalle compartido**: `components/detalle-solicitud-contrato.tsx` (datos,
  anexo, documentos del contrato y documentos generales del contratista con el
  visor, motivo y historial); cada pantalla pone sus botones. Consultas
  compartidas en `lib/contratos-db.ts` (servidor); los tipos van en
  `lib/contratos.ts` para que los componentes no importen nada que toque el
  servidor.
- **Permisos**: pestaña `contratos.preaprobacion` (Legal, Líder Legal,
  Gerencia) y acción `aprobar_contratos` (Legal, Líder Legal). Quien tiene la
  pestaña también ve contratistas y sus documentos.
- **Minuta** (pestaña "Minuta" del detalle, que en Pre-aprobación es un
  diálogo grande): plantilla GJ-F-003 de mano de obra. Todos los campos que la
  plantilla deja en "XXX" (partes, objeto, obligaciones, plazos, valor y forma
  de pago, domicilio, arbitramento, porcentajes, anexo N° 1) se editan en
  `components/minuta-mano-obra-editor.tsx`; vienen prellenados de la
  solicitud, el contratista y el proyecto (`minutaPorDefecto` en
  `lib/minuta-mano-obra.ts`). El texto fijo de las cláusulas vive en
  `components/minuta-mano-obra-pdf.tsx`. El PDF lo genera
  `POST /contratos/pre-aprobacion/[id]/minuta` con la minuta en pantalla (la
  vista previa y la descarga muestran cambios sin guardar). Guardar =
  `guardar_minuta_contrato` -> `contratos.minuta_datos` (jsonb, acción
  `aprobar_contratos`, no en rechazadas;
  `20261015000000_minuta_contratos.sql`). Al leer, lo guardado gana campo por
  campo sobre lo calculado (`mezclarMinuta`). Editar el anexo en la minuta NO
  cambia lo reservado del presupuesto. Otros tipos de contrato: sin plantilla
  todavía. El editor marca el origen de cada dato (`origenCampo` /
  `origenRenglon`): Plantilla (texto de la GJ-F-003), Solicitud (solicitud,
  contratista o proyecto), Falta (rojo); lo editado a mano queda sin color. Tiene vencimiento (sale en
  la tercera) y cláusulas adicionales (`clausulasAdicionales`, numeradas
  después de la décima octava con `ordinalClausula`).
- **Pendiente**: la pantalla de minutas para las `aprobada` (Elaboración de
  contratos) y las plantillas de los demás tipos.

---

# TRASPASO DE SESIÓN (2026-10-02) — leer esto primero

Resumen para quien (Claude o persona) retome el trabajo. Rama de trabajo: **`lcpr`**
(Sofia trabaja en paralelo en `spr` y se mezcla por pull request: antes de empezar,
`git fetch` y revisar si hay commits nuevos; las migraciones pueden chocar de número).

## Preferencias del usuario (Luis)
- **Español** en todo (UI, comentarios, mensajes de commit, respuestas).
- **Rendimiento lineal siempre**: nada O(n²). Indexar con `Map`/`Set` antes de
  recorrer, consultas por lotes (`in`, joins, RPC) en vez de una por fila, listados
  con filtros y paginación **en el servidor**. La app va a manejar mucho volumen.
- **Commit y push directos a `lcpr`** tras cada cambio (nunca a `main`). Las
  migraciones SQL las ejecuta él a mano en Supabase: avisarle cuáles faltan.
- Antes de dar por hecho un cambio: `npx tsc --noEmit`. No hay acceso a la base de
  datos desde aquí: decir siempre que no se probó contra Supabase.
- Quiere cambios **pedidos tal cual**, sin agregar extras; si hay una decisión de
  producto dudosa, la deja anotada al final de la respuesta, no la decide sola.

## Convenciones de interfaz (ya aplicadas en toda la app)
- **Encabezado estándar** de página: `EncabezadoPagina` / `MarcoPagina`
  (`components/encabezado-pagina.tsx`): botón del menú + título (+ subtítulo,
  + selector de proyecto). Misma altura y margen (`px-4 sm:px-6`) en todas.
- **Listados con panel de filtros a la izquierda** (`components/panel-filtros.tsx`;
  para requisiciones `filtros-requisiciones.tsx`): ningún filtro es obligatorio,
  **no se muestra nada hasta presionar Consultar**, el panel **se minimiza al
  consultar**, "Limpiar filtros" lo vacía. Casillas por defecto marcadas donde
  aplica ("Solo por Aprobar", "Solo por Recibir", "Solo pendientes por comprar").
- **Paginación de 50** (`lib/paginacion.ts` + `components/paginacion-simple.tsx`):
  se pide una fila de más para saber si hay página siguiente, sin conteo total.
- **Acciones de tabla**: botón **Ver** que abre el detalle en un diálogo encima de
  la lista (no al hacer clic en la fila); columna Acciones con dos casillas de
  ancho fijo (Ver + Aprobar/Rechazar/Desaprobar/Cancelar) para que quede alineada.
- **Buscadores**: `_` lista todas las opciones (`lib/busqueda.ts`), mínimo 2 letras.
- **Etiquetas de estado**: tamaño `h-6 px-3 text-xs`, centradas en la fila.
  Requisiciones: Pendiente (amarillo), Aprobada (verde), Rechazada (rojo),
  Cancelada (gris). Órdenes de compra: igual. Entradas: Entrega Pendiente (rojo),
  Entrega Parcial (amarillo), Entrega Completa (verde).
- **`Select`** (`components/ui/select.tsx`) arma solo las etiquetas desde los
  `SelectItem`: no mostrar el valor interno ("todos") en el botón.
- **Menú lateral por módulos** (`lib/pestanas.ts`: `MODULOS`, `construirModulos`):
  **AdPro** (todo lo existente) y **A&F** (nuevo, sin pestañas todavía). Tres
  columnas que se abren a la derecha (módulos → secciones → pestañas), se minimiza
  al elegir una pestaña, y una flecha en la orilla lo abre en la ruta actual.
  Para una pestaña nueva de A&F: entrada en `PESTANAS` con `modulo: "ayf"`.
- **Columnas de tablas en Aprobación**: sin columna de estado de compras.

## Reglas de negocio vigentes (resumen; el detalle está arriba en este archivo)
- Requisiciones agrupadas con número; aprobar/rechazar/cancelar/modificar actúan
  sobre la requisición completa; el cupo del presupuesto sale de las líneas
  (pendiente o aprobada = comprometida). Compras compra y rechaza **por línea**.
- Cancelar una requisición: solo quien la creó y solo si está pendiente.
- Órdenes de compra: estados visibles solo Pendiente/Aprobada/Rechazada/Cancelada;
  **ya no existe "enviada"** (columna `enviada` queda sin usar). Desaprobar o
  cancelar una orden: no se permite si ya hay entradas de almacén.
- Entradas/salidas: no se puede editar ni anular una entrada si el inventario del
  insumo quedaría negativo (lo valida la base, con candado por proyecto).
- Cantidades siempre **enteras**.

## Migraciones de la última sesión (orden de ejecución)
`20261004050000` logo de empresas · `20261006050000` pestaña Registro de
Requisiciones · `20261006150000` cancelar solo propio · `20261007000000`
notificaciones · `20261007100000` quitar duplicadas · `20261008000000`
requisiciones · `20261009000000` quitar enviada · `20261010000000` entradas por
orden · `20261010100000` rendimiento (Sofia) · `20261011000000` revisión de
seguridad/rendimiento · `20261012000000` lista de entradas en SQL.
**Para saber cuáles faltan: correr `supabase/verificar_migraciones.sql` en el SQL
Editor de Supabase** (solo consulta; `aplicada = true` en todas = nada pendiente).

## Pendientes conocidos (no hechos)
- El estado de compra de las requisiciones se calcula con una función por línea;
  con mucho volumen conviene guardarlo o calcularlo solo para la página.
- Funciones por línea antiguas siguen en la base sin uso: `cancelar_pedido`,
  `modificar_pedido`, `desaprobar_pedido` (decisión: dejarlas por ahora).
- La matriz de Roles y permisos no agrupa por módulo todavía.
- La sección "Administrador" quedó dentro de AdPro (administra toda la plataforma).
- A&F es visible para todos los usuarios aunque esté vacío.

## Notas de herramientas
- Desde Windows/Git Bash, los scripts de edición largos con comillas fallan en
  heredoc: escribir el script con el editor a un archivo `.py` y ejecutarlo.
- Un archivo `"use server"` solo puede exportar funciones async (ni constantes ni
  re-exportar tipos): los tipos/helpers compartidos van en `lib/`.
