# Reporte de cambios y rendimiento — CONYCA

Rama `spr` · 30 de septiembre de 2026

Este documento reúne **todo lo que se cambió** en esta sesión, lo que se
**aplicó en la base de datos**, y los **errores y riesgos encontrados**,
sobre todo los que van a aparecer cuando crezcan los datos o los usuarios.
Al final hay una lista priorizada de lo que falta y que toca backend
(no se cambió por decisión explícita: "no cambies nada de backend").

---

## 1. Resumen

| | |
|---|---|
| Commits en `spr` | 9 (más el merge de `lcpr`) |
| Líneas | +6.368 / −35.904 (casi todo es código comentado que se borró) |
| Migraciones aplicadas en Supabase | 3 (políticas de proveedores + 24 índices) |
| Páginas nuevas | `/inicio` (proyectos), `/almacen/proveedores` |
| Páginas rediseñadas | Maestro de insumos, Catálogo de MO/equipo, Inventario, Salidas |
| Búsqueda de insumos por similitud | 93 ms → 5 ms (índice GiST) |
| Ciclos O(n²) corregidos en pantallas | 4 |
| Riesgos de backend reportados (sin tocar) | 12 (sección 5) |

---

## 2. Cambios, commit por commit

### 2.1 `ece230b` — Eliminar código comentado y módulos sin uso
- Se borraron ~33.800 líneas de **versiones anteriores comentadas** que
  estaban pegadas al inicio de 12 archivos (ej. `presupuestos/actions.ts`
  pasó de 22.617 a 4.406 líneas). Git conserva esas versiones.
- Código muerto eliminado: `buscarApusSimilares`, `lib/matching-apu-import.ts`,
  `components/revision-import-apu-dialog.tsx`, `GRUPO_POR_TIPO`.

### 2.2 `e25a647` — Recalcular valores en lote al guardar
- Antes: al guardar un presupuesto, cada ítem con APU se recalculaba **uno
  por uno en serie** (1 server action + 3 viajes a la base por ítem).
- Ahora: `recalcularValoresItemsDesdeApu(ids[])` — 1 consulta, 1 RPC por
  APU único (de a 15 en paralelo), 1 consulta final y un solo re-render.
  50 ítems: ~150 viajes en serie → ~4 viajes.

### 2.3 `5856620` — Merge de `origin/lcpr` en `spr`
- Trae Entradas, Inventario, Salidas, Roles y permisos, historial, etc.
- Un conflicto resuelto (`orden-compra-detalle-view.tsx`: bloque comentado
  viejo que `lcpr` había editado y `spr` había borrado).

### 2.4 `e66f122` — Landing de proyectos y selector en el encabezado
- Al iniciar sesión se llega a `/inicio`: tarjetas de proyectos, búsqueda,
  el último usado primero.
- El proyecto queda guardado en una cookie (`proyecto_actual`, 30 días) y
  lo comparten todas las páginas con `ProyectoActualProvider`.
- Presupuestos y Pedidos ya no tienen su propio selector: usan el del
  encabezado (`SelectorProyecto`).
- **Efecto en carga**: la lista de proyectos se pide **una vez por sesión**
  en vez de una vez por cada página que se abría.

### 2.5 `8a6efe9` — Página de Proveedores
- `/almacen/proveedores`: tabla tipo Excel con edición en línea (clic,
  Enter guarda, Esc cancela), validación, filtros, orden, columnas fijas.
- En pantallas angostas se vuelve tarjetas (según el espacio real de la
  página, no el tamaño de pantalla).
- Migración `20261004000000_proveedores_editar.sql` (**aplicada**): política
  `proveedores_update` (compras o admin).

### 2.6 `1f01fc8` — Nuevo proveedor
- Botón "Nuevo proveedor" con formulario validado.
- El ID se asigna solo (siguiente: `PV0395`). Si dos personas crean a la
  vez, el índice único hace fallar al segundo y la acción reintenta.
- Bloquea crear un proveedor con un número de documento que ya existe.
- Migración `20261004100000_proveedores_crear.sql` (**aplicada**): política
  `proveedores_insert` + índice único en `id_prov`.

### 2.7 `197de2b` — Inventario y Salidas con encabezado estándar
- Nuevo `components/encabezado-pagina.tsx` (menú, título, subtítulo y
  selector de proyecto).
- Inventario y Salidas toman el proyecto del encabezado; se quitó su
  selector propio y su llamada a `verProyectos()`.

### 2.8 `fb9a276` — Maestro de insumos y catálogo de MO/equipo
- Nuevo `components/tabla-excel.tsx`: el mismo diseño de Proveedores como
  componente reutilizable (ancho fijo, textos truncados sin montarse,
  encabezado y primeras columnas fijas, tarjetas en pantallas angostas).
- Maestro de insumos y Catálogo (mano de obra / equipo) lo usan. **La carga
  de datos no cambió**, solo la presentación.
- Catálogo: además del doble clic, botón "Editar" visible (el doble clic
  no existe en pantallas táctiles).

### 2.9 `efcdca2` — Rendimiento
- 24 índices (sección 3).
- 4 ciclos del cliente pasados de O(n²) (o peor) a O(n) (sección 4).

---

## 3. Base de datos: qué consume más y qué se hizo

Datos de `pg_stat_statements` y `pg_stat_user_tables` al momento de la
revisión (acumulados desde el último reinicio de estadísticas).

### 3.1 Lo que más consume (consultas de la app)

| # | Consulta | Llamadas | Promedio | Total |
|---|---|---|---|---|
| 1 | `recalcular_valor_apu` (RPC) | 9.830 | 24 ms | **237 s** |
| 2 | `DELETE FROM presupuestos` | 39 | 185 ms – **3,9 s** | 12 s |
| 3 | Listado de `maestro_insumos` (orden + paginado) | 116 | 52–92 ms | 9 s |

> Las consultas más pesadas de toda la lista (`pg_available_extensions`,
> `pg_timezone_names`, introspección de esquema) vienen del **panel de
> Supabase / herramientas**, no de la app.

### 3.2 Tablas leídas completas una y otra vez (seq scans)

| Tabla | Filas | Lecturas completas | Filas leídas en total |
|---|---|---|---|
| `apu_import_revision` | 86 | 21.733 | **40,4 M** |
| `maestro_insumos` | 1.794 | 16.028 | **29,0 M** |
| `presupuesto_items` | 28 | 58.056 | 14,5 M |
| `solicitudes_insumos` | 4 | 198.109 | 3,0 M |

Con pocos datos esto todavía es rápido. **Con un presupuesto real de miles
de ítems, cada una de esas lecturas crece en proporción**, y varias ocurren
por cada fila procesada → costo cuadrático.

### 3.3 Causas y arreglos aplicados (`20261004200000_indices_rendimiento.sql`)

1. **Búsqueda por similitud sin índice usable.** `buscar_insumos_candidatos`,
   `buscar_items_apu_candidatos`, `buscar_mano_obra_candidatos` y
   `buscar_equipo_candidatos` ordenan con `columna <-> término LIMIT n`.
   Ese orden **solo** lo resuelve un índice **GiST** de trigramas; los que
   existían eran GIN (sirven para `ILIKE`, no para ordenar). Resultado:
   cada búsqueda leía y ordenaba la tabla completa.
   **Arreglo**: 4 índices GiST. Medido: **93 ms → 5 ms** (Index Scan).
   Es la búsqueda que usa el import de APU por cada descripción única, así
   que el ahorro se multiplica por el tamaño del Excel.
2. **`recalcular_valor_apu` hace `UPDATE presupuesto_items WHERE apu_id = ?`**
   y `apu_id` no tenía índice → lectura completa de `presupuesto_items` en
   cada una de las 9.830 llamadas. **Arreglo**: índice en `apu_id`.
3. **Llaves foráneas sin índice.** Al borrar una fila padre (un APU, un
   insumo, un presupuesto en cascada), Postgres revisa la tabla hija
   **completa por cada fila borrada** → O(padres × hijos). Explica los
   `DELETE presupuestos` de hasta 3,9 s y las 40 M filas leídas de
   `apu_import_revision`. **Arreglo**: índices en `presupuesto_items.padre_id`,
   las 4 FKs de `item_apu` hacia catálogos, 7 FKs de `apu_import_revision`,
   `pedidos_insumos.item_apu_id`, `salidas_insumos.insumo_id`.
4. **Permisos**: las PK de `usuario_proyectos`, `grupo_proyectos` y
   `usuario_grupos` empiezan por la otra columna; se agregaron índices por
   `proyecto_id` / `grupo_id`.
5. `solicitudes_equipo`: índices en `estado` y `presupuesto_item_id`
   (mano de obra ya los tenía; equipo no).

Todos con `IF NOT EXISTS`; ninguno cambia datos, funciones ni políticas.

---

## 4. Complejidad del código (objetivo: nada peor que O(n²), ideal O(n))

### 4.1 Corregido en pantallas (frontend)

| Dónde | Antes | Ahora |
|---|---|---|
| `presupuesto-table.tsx` — total por capítulo | Re-recolecta el subárbol de cada capítulo copiando arreglos en cada nivel (≈ O(n·profundidad²)), **y se recalculaba en cada render** (cada tecla) | Un recorrido memoizado **O(n)**, y `useMemo`: solo cuando cambian los datos |
| `presupuestos/page.tsx` — eliminar ítem en cascada | Pasadas completas repetidas hasta no encontrar hijos: **O(n²)** con ítems en orden inverso | Mapa padre→hijos + recorrido: **O(n)** |
| `entradas-view.tsx` — validar edición | `.find()` sobre las líneas de la orden por cada línea: O(n·m) | `Map` por id: O(n + m) |
| `admin/page.tsx` — nombres de grupo por usuario | `grupos.find()` por cada grupo de cada usuario | `Map` por id |

El resto de búsquedas dentro de ciclos que marcó el análisis son sobre
listas **constantes** (5 categorías de APU, ~20 pestañas) o cadenas de
`.map().filter()` que no están anidadas: O(n) en la práctica.

### 4.2 Pendiente en backend (reportado, no cambiado) — ver sección 5

---

## 5. Errores y riesgos cuando la carga sea alta

Ordenados por prioridad. Ninguno se cambió porque es backend; cada uno trae
el arreglo propuesto.

### 🔴 Alta

**5.1 Cualquier usuario con sesión puede modificar catálogos y precios.**
Políticas RLS actuales:
- `maestro_insumos`: `UPDATE` permitido a `auth.uid() IS NOT NULL`.
- `mano_obra_categorias` y `equipo_categorias`: **todas** las operaciones
  (incluido `DELETE`) para cualquier autenticado.

Como estas tablas se editan desde el navegador, un ingeniero con sesión
puede cambiar precios o borrar categorías saltándose la pantalla. Afecta
directo los valores de todos los APU. **Arreglo**: exigir
`tiene_accion(auth.uid(), 'aprobar_insumos')` / `'aprobar_mano_obra'` en
UPDATE/INSERT/DELETE (lectura puede seguir abierta).

**5.2 El middleware hace 2 viajes de red en CADA request.**
`auth.getUser()` (llamada real a Supabase Auth) + RPC `permisos_rol_usuario`,
en cada navegación, cada server action y cada prefetch. Con 50 usuarios
activos son cientos de llamadas por minuto solo en autenticación, y suma
latencia fija (~200–400 ms medidos antes) a todo.
**Arreglo**: validar el JWT localmente (`getClaims()` / verificación con la
clave pública) en el middleware, y cachear los permisos por usuario unos
segundos (o guardarlos como claims personalizados en el token).

**5.3 `recalcular_valor_apu` recorre `item_apu` 5 veces por llamada y se
llama desde JS una vez por ítem.**
Hace 5 `SELECT ... WHERE apu_id = ?` separados (mano de obra, insumos,
equipo, transporte, herramienta menor). Con el índice ya es barato por
consulta, pero el import de APU la invoca por cada ítem (cientos de
llamadas por Excel). **Arreglo**: una sola consulta con `SUM(...) FILTER`
y una versión en lote `recalcular_valor_apus(uuid[])`.

### 🟠 Media

**5.4 Import de APU: 2 viajes por cada descripción única.**
`matchearInsumosApuImport` llama `buscar_insumos_candidatos` y luego
`precios_efectivos_insumos` por cada descripción (de a 15 en paralelo).
Un Excel con 800 descripciones únicas = 1.600 viajes. **Arreglo**: que el
RPC de candidatos devuelva ya el precio efectivo (un JOIN), o un RPC que
reciba el arreglo de descripciones.

**5.5 Precio efectivo del maestro se recalcula completo cada vez que se
abre la página.**
El maestro pide `precios_efectivos_insumos` para los 1.794 insumos
(9 lotes en paralelo desde el navegador), y por cada insumo se evalúa
`precio_promedio_compra_insumo` (histórico + órdenes de compra). Crece con
insumos × compras. **Arreglo**: columna `precio_efectivo` mantenida por
trigger al registrar compras, o vista materializada que se refresca al
aprobar una OC.

**5.6 Transporte: un `UPDATE` por fila de revisión, en serie**
(`presupuestos/actions.ts`, paso 6 al guardar precios de transporte).
N filas = N viajes secuenciales. **Arreglo**: un `UPDATE ... FROM
(VALUES ...)` o `upsert` en lote.

**5.7 `crearPedido`: una consulta por insumo para detectar duplicados** (hasta
50, de a 10) y comparación anidada O(filas × ítems). **Arreglo**: una sola
consulta con `.in("insumo_id", ...)` y un `Set` de claves
`insumo|ítem|cantidad` → O(n).

**5.8 `buscarCategoriaExistentePorNombre` lee la tabla completa en cada
aprobación** de mano de obra/equipo para comparar un nombre. **Arreglo**:
índice único sobre el nombre normalizado (además evita duplicados por
aprobaciones simultáneas, que hoy sí pueden pasar).

**5.9 Import de APU sin transacción** (ya anotado en CLAUDE.md): si falla a
la mitad, queda un presupuesto a medio armar sin reporte de qué se guardó.
Con archivos grandes la probabilidad de un fallo intermedio (timeout,
límite de conexiones) sube.

### 🟡 Baja / a vigilar

**5.10 Límite de filas de la API.** Maestro, proveedores y catálogos se
cargan completos con un solo `select` (sin `.range()`). Hoy funciona
(1.794 filas llegan completas), pero si Supabase tiene un `max_rows`
configurado y el maestro lo supera, la página mostrará **menos insumos sin
avisar**. Verificar el valor en Settings → API, o paginar la carga.

**5.11 `crearProveedor` lee todos los `id_prov` para calcular el siguiente**
(O(n), bien hasta decenas de miles). Si crece mucho: secuencia en la base.

**5.12 Datos con problemas de calidad** (no rendimiento, pero salen en
pantalla):
- Nombres con codificación dañada: `FERRETERÃA`, `ACUÃ‘A`,
  `CAÃ‘AVERALEJO` (vienen así de la carga original de proveedores).
- En el maestro hay campos con el texto literal `null - X` / `null - null`
  (ej. código 0, "ACTIVIDAD A TODO COSTO").

---

## 6. Migraciones aplicadas en Supabase (en este orden)

| Archivo | Qué hace |
|---|---|
| `20261004000000_proveedores_editar.sql` | Política `proveedores_update` |
| `20261004100000_proveedores_crear.sql` | Política `proveedores_insert` + `UNIQUE(id_prov)` |
| `20261004200000_indices_rendimiento.sql` | 24 índices (sección 3.3) |

---

## 7. Qué se probó y qué no

**Probado en el navegador (con sesión real):**
- Landing de proyectos → Presupuestos y Pedidos toman el proyecto.
- Proveedores en escritorio, tablet y celular; edición con validación; Esc
  cancela; un valor inválido nunca se guarda.
- Nuevo proveedor: el formulario valida (no se creó ningún proveedor real).
- Maestro de insumos, Catálogo de MO, Inventario y Salidas con el diseño
  nuevo, en escritorio y celular.
- Presupuesto y Admin cargan igual que antes después de los cambios de
  complejidad. Sin errores en consola.
- `tsc` sin errores; `eslint` sin problemas nuevos (los que marca ya
  existían).

**No probado:**
- Guardar un cambio real en Proveedores y crear un proveedor real (para no
  alterar datos). Hacer una prueba con un dato conocido.
- Editar una entrada de almacén (el cambio es solo en la validación del
  máximo; lógica equivalente).
- Eliminar un ítem en cascada con un árbol grande.

---

## 8. Próximos pasos sugeridos

1. **5.1 (seguridad de catálogos)** — es lo más urgente.
2. **5.2 (middleware)** — el mayor costo fijo por request.
3. **5.3 + 5.4** — juntos hacen que el import de APU escale.
4. Pasar Proveedores a `TablaExcel` para que las 3 tablas compartan
   exactamente el mismo componente (hoy Proveedores tiene su propia copia
   del diseño, con edición en línea).
5. Limpiar los datos de 5.12.
