# Reporte de cambios, rendimiento y seguridad

Rama `lcpr`. Las mediciones se hicieron en un PostgreSQL 16 local con datos sintéticos (60 000 líneas de pedido), no contra el Supabase real. Los números absolutos cambiarán en producción; el orden de magnitud y las causas deberían mantenerse.

## 1. Cambios entregados

| Área | Resumen | Migración |
|---|---|---|
| Entradas | Recepción contra OC, entrega parcial/total, edición | `20260930000000` |
| Inventario | Existencias por proyecto (RPC) | `20260930100000` |
| Salidas | Salidas de almacén, edición, anulación | `20260930200000`, `20260930300000` |
| Roles y permisos | Roles, matriz pestañas/acciones, acceso a todos los proyectos | `20261001000000`, `20261001100000` |
| Desaprobar/cancelar OC | Estado visible único de OC | `20261002000000` |
| Historial | Auditoría por triggers, desaprobar/cancelar/modificar requisiciones | `20261003000000` |
| UI | Landing de proyectos, menú por registro, Requisiciones, Admin simplificado | — |

Total aproximado: 3 100 líneas de SQL, 60 funciones, 5 tablas nuevas. Todo se aplicó sin errores en el sandbox y pasó más de 60 aserciones de comportamiento.

## 2. Rendimiento

### 2.1 Crítico

**R1. Faltan índices en claves foráneas usadas en joins (peor que O(n²) en la práctica).**
`ordenes_compra_items(pedido_insumo_id)` y otras FK sin índice obligan a un seq scan por cada fila exterior. Medido: 8 141 ms sin índice contra 14 ms con índice. Con volumen de estrés se vuelve cuadrático (filas × filas).
Arreglo: migración idempotente de índices, creados solo si no existe ya uno con esa columna inicial. Candidatos: `ordenes_compra_items(pedido_insumo_id)`, `pedidos_insumos(proyecto_id, estado)`, `pedidos_insumos(presupuesto_item_id)`, `salidas_insumos(proyecto_id)`, `entradas_almacen_items(orden_compra_item_id)`.

**R2. RLS con funciones por fila.**
`usuario_tiene_acceso_a_item` se evalúa por cada fila. Con 60 000 filas, un ingeniero tarda 53 s con mi versión contra 12,5 s con la original. Admin 8,1 s. Sin RLS 4 ms. **Es una regresión introducida por mis cambios** (4× más lenta para ingenieros).
Arreglo diseñado, no probado:
- `mis_proyectos()` STABLE devuelve el conjunto de proyectos visibles del usuario.
- Políticas reescritas como `proyecto_id in (select mis_proyectos())` y `(select auth.uid())`, para que Postgres las evalúe una vez (InitPlan).
- Verificar que admin, ingeniero, compras, técnico y sin-acceso ven exactamente las mismas filas antes y después.
Esto requiere un sandbox estable; el mío se cayó durante esa comparación.

### 2.2 Alto

**R3. Truncamiento silencioso de PostgREST (`max_rows`, 1000 por defecto).** Listados sin paginación devuelven solo 1000 filas sin avisar. Con estrés, los totales, inventario y colas de compras quedan mal sin ningún error. Arreglo: paginación con `range()`, orden determinista y totales por RPC.

**R4. Guardado de presupuesto en bucle.** Cada fila genera su propia petición, con coste de red lineal y overhead cuadrático en la revalidación. Arreglo: guardado en lote con un único RPC y subir `serverActions.bodySizeLimit` si hace falta.

**R5. `crearPedido` no es atómico.** Valida en lotes de 10 y luego inserta desde el servidor. Dos usuarios concurrentes pueden superar la cantidad disponible. Arreglo: un único RPC con `for update` o advisory lock.

### 2.3 Medio

- `historial_eventos` crece sin límite y sin índice temporal compuesto; conviene `(entidad, entidad_id, creado_en desc)` y retención.
- Consultas sin `order by` estable con paginación pueden duplicar u omitir filas.
- El middleware llama a `getUser` más el RPC de permisos en cada petición; es aceptable, pero añadir caché corta por sesión si la latencia sube.

## 3. Seguridad

| # | Riesgo | Severidad | Acción |
|---|---|---|---|
| S1 | Next 16.2.12 tiene avisos en `npm audit`; subir a 16.3.8 | Alta | Actualizar y volver a correr `npm audit` |
| S2 | Fallback legado cuando `rol_id` es nulo: si el RPC de permisos falla, el comportamiento puede ser permisivo | Alta | Fallar cerrado (denegar) |
| S3 | Tablas con RLS abierta heredada (`using (true)`) | Alta | Revisar y restringir por proyecto/rol |
| S4 | `xlsx` tiene vulnerabilidades conocidas (prototype pollution, ReDoS) | Media | Reemplazar por `exceljs` o limitar a entrada de confianza |
| S5 | Sin cabeceras de seguridad (CSP, HSTS, X-Frame-Options, Referrer-Policy) | Media | Configurar en `next.config` |
| S6 | `shadcn` está en `dependencies`, no en devDependencies | Baja | Moverlo |
| S7 | Sin rate limiting en login ni Server Actions sensibles (crear usuario, cambiar contraseña) | Media | Rate limit en edge o Supabase |
| S8 | Cookie `proyecto_actual` validada contra RLS, y `x-permisos` eliminada si viene del cliente | OK | Sin acción |
| S9 | Funciones SECURITY DEFINER con `set search_path` | OK | Sin acción |

## 4. Problemas esperables en producción bajo estrés

1. **Mensajes de error ocultos.** Next en producción omite el mensaje de los errores lanzados desde Server Actions (solo queda el digest); verificado empíricamente. Toda validación que hoy hace `throw new Error("…")` se ve como error genérico. Arreglo: devolver `{ ok, error }` desde las actions.
2. **Cuadrático por datos:** R1 (joins sin índice) y R4 (guardado en bucle).
3. **Truncamiento silencioso:** R3.
4. **Concurrencia:** R5; las RPC de entradas/salidas sí usan bloqueos.
5. **Pool de conexiones:** el middleware añade una ida extra a Supabase por petición; con muchas peticiones simultáneas puede saturar el pooler.

## 5. Orden recomendado

1. Migración de índices (R1): bajo riesgo, mayor ganancia.
2. Subir Next (S1) y fallar cerrado (S2).
3. Errores visibles en actions (§4.1).
4. Migración RLS optimizada (R2), probada con comparación de filas visibles.
5. Paginación (R3), guardado en lote (R4), `crearPedido` atómico (R5).
6. S3, S4, S5, S7.

## 6. Limitaciones

- Mediciones sobre PG16 local con datos sintéticos.
- La reescritura RLS (R2) es un diseño no validado.
- No se probó carga HTTP real (por ejemplo k6) contra la app desplegada.
