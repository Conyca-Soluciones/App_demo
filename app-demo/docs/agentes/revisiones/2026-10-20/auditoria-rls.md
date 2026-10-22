# Auditoría de RLS: acceso mínimo a las tablas (2026-10-20)

Regla del usuario: **"dar acceso a las tablas únicamente a las personas que lo necesitan"**.

Método: políticas vivas (`pg_policies`, MCP de solo lectura) + matriz `roles` / `rol_permisos` + usuarios de prueba (`*@prueba.com`, `usuario_proyectos`). Lo que dicen `tiene_pestana`, `tiene_accion`, `rol_compras` y `proyectos_visibles` se calculó a mano a partir de `rol_permisos`, porque el MCP no puede ejecutar esas funciones. Después se cruzó con lo que lee cada pantalla: `lib/pestanas.ts`, las server actions de `app/` y `lib/`, y las funciones SECURITY INVOKER (esas aplican la RLS de quien las llama). Las funciones SECURITY DEFINER no necesitan la tabla abierta.

**No se aplicó nada en la base.** Las migraciones nuevas, en orden:

1. `20261118400000_rls_minima_compras_almacen.sql`: órdenes de compra, sus líneas, requisiciones, salidas e histórico de precios.
2. `20261118410000_rls_minima_presupuestos_apu.sql`: presupuestos, APU, maestra de insumos, solicitudes y catálogos de MO/equipo.
3. `20261118420000_rls_minima_ayf_empresas.sql`: consolidados y cuentas bancarias de las empresas.
4. `20261118430000_tablas_sin_anon.sql`: sin sesión no se llega a ninguna tabla de `public` (defensa adicional).

Van después de `20261118300000_proveedores_lectura_minima.sql`, que **tampoco está aplicada** en la base viva (`proveedores_select` sigue siendo la versión vieja). Las cuatro pasan pglast. Además se ejecutaron en la base las partes de cada política que no usan funciones de permiso (subconsultas, columnas), para confirmar que los nombres existen.

## 1. Lo que estaba abierto

| Tabla | Política de lectura vigente | Quién lee hoy por la API |
|---|---|---|
| `ordenes_compra` | `ordenes_compra_select_proyecto`: el proyecto, nada más | Todos los que tienen el proyecto: RRHH, Auxiliar administrativo, Contabilidad, Jurídica, Subgerencia y Financiera ven las 3 OC de Estuario Casa |
| `ordenes_compra_items` (precios) | igual, a través de la orden | igual: precio, descuento e IVA de cada línea |
| `pedidos_insumos` → `requisiciones`, `requisiciones_vista` | aprobadores + proyecto (a través del presupuesto) | todos los que tienen el proyecto |
| `salidas_insumos` | el proyecto | todos los que tienen el proyecto (ninguna pantalla la lee directo) |
| `presupuestos` → `presupuesto_items`, `presupuesto_versiones` | el proyecto | todos los que tienen el proyecto: el presupuesto completo con valores |
| `apu`, `item_apu`, `apu_import_revision`, `transporte_precios` | `auth.uid() is not null` | **cualquiera con sesión, de todos los proyectos** |
| `maestro_insumos` (precios) | cualquiera con sesión (`to public`) | todos |
| `historico_precios_compra` | cualquiera con sesión | todos (ninguna pantalla la lee directo) |
| `solicitudes_insumos`, `_mano_obra`, `_equipo` | cualquiera con sesión | todos |
| `mano_obra_categorias`, `equipo_categorias` (tarifas) | `true` | todos |
| `consolidados` | `true` | todos |
| `empresas_cuentas_bancarias` | cualquiera con sesión | **todos leen los bancos y las cuentas de las empresas** |
| Casi todas las tablas | permisos de tabla | `anon` tiene SELECT/INSERT/UPDATE/DELETE; solo lo frena que la política pida `auth.uid()` |

Lo que ya estaba bien y no se tocó: contratos y sus tablas hijas, actas y sus hijas, contratistas y sus documentos, pagos, terceros, `informacion_bancaria`, `cuentas_empresa`, notificaciones, usuarios, grupos y proyectos (lectura). Entradas, `historial_eventos`, `rol_permisos` y `pagos_contadores` no tienen políticas, así que nadie las lee directo (todo pasa por funciones SECURITY DEFINER).

## 2. Política nueva, tabla por tabla

Todas son `to authenticated` y siguen las convenciones de CLAUDE.md: las funciones de permiso van envueltas en `(select ...)` (se evalúan una vez por consulta), "ver el proyecto" se escribe `proyecto_id in (select proyectos_visibles(...))` y las tablas hijas usan `exists` sobre el padre. Ninguna política llama una función de permiso por fila. Las escrituras no cambian.

| Tabla | Quién puede leer (además del proyecto, donde aplica) | Por qué / quién lo usa |
|---|---|---|
| `ordenes_compra` | 1) Comprar: todas. 2) Registro de OC, Aprobación de OC o Control del proyecto: las de sus proyectos. 3) **Aprobación de pagos / Consolidado: solo la cabecera de las OC que tienen un pago que la persona ve** | 2: listado, detalle y PDF (`comprar-pedidos/actions.ts`), "Órdenes del período" (`visualizacion/actions.ts`). 3: `lib/pagos-db.ts` muestra `orden:ordenes_compra(numero)` en A&F |
| `ordenes_compra_items` | Comprar; o Registro de OC, Aprobación de OC o Control del proyecto, con la orden de sus proyectos. **Las pestañas van escritas en la política**, no se heredan de la orden | Así la cabecera que ve A&F por sus pagos no deja ver los precios |
| `pedidos_insumos` (y por herencia `requisiciones`, `requisiciones_vista`) | 1) Aprobar insumos / aprobar requisiciones: todas (igual que antes). 2) Comprar: todas. 3) Elaboración, Registro o Aprobación de requisiciones: las de sus proyectos. 4) **Registro de OC, Aprobación de OC o Control del proyecto: solo las líneas que están en una orden que la persona ve** | 4: el insumo de cada línea de la orden (embed `pedido:pedidos_insumos` en el listado y el detalle de OC) |
| `salidas_insumos` | Salidas o Inventario + el proyecto | Hoy todo va por funciones DEFINER; se deja abierta solo a quien ya ve esos datos en pantalla |
| `historico_precios_compra` | Comprar o Aprobar insumos | Nadie la lee directo (`precios_efectivos_insumos` es DEFINER) |
| `presupuestos` (y por herencia `presupuesto_items`, `presupuesto_versiones`) | Elaboración de presupuestos o una pestaña de Requisiciones (Elaboración, Registro o Aprobación) + el proyecto | Requisiciones lee el presupuesto vigente y el ítem de cada línea (`almacen/actions.ts`, `lib/requisiciones-lineas.ts`, RPC INVOKER `buscar_insumos_presupuesto`, `insumos_presupuesto_por_ids`, `disponible_insumos_items`) |
| `presupuesto_items`, otra política | **Pestañas de Contratos o Control: solo los ítems que están en el anexo de un contrato que la persona ve** | `lib/contratos-db.ts` muestra `presupuesto_item:presupuesto_items(codigo)` en el anexo |
| `apu` | Elaboración, Aprobación de insumos o Aprobación de MO y equipos | Sin filtro de proyecto (los APU recomendados vienen de otros proyectos; la opción B sigue pendiente) |
| `item_apu` | Lo mismo + las pestañas de Requisiciones | Las RPC INVOKER de requisiciones leen `item_apu` |
| `apu_import_revision`, `transporte_precios` | Elaboración, Aprobación de insumos o Aprobación de MO y equipos | Import y revisión (`estado_apu_items` es INVOKER, la llama `cargar_presupuesto`) |
| `maestro_insumos` | Comprar, o cualquier pestaña de Presupuestos, Requisiciones, Compras, Almacén o Control | Quedan fuera A&F, Contratos y RRHH |
| `solicitudes_insumos` | Las propias, Elaboración o Aprobar insumos | `presupuestos/actions.ts` (crear y aprobar). El insert hace `.select()`: lo cubre "las propias" |
| `solicitudes_mano_obra`, `solicitudes_equipo` | Las propias, Elaboración o Aprobar mano de obra | igual |
| `mano_obra_categorias`, `equipo_categorias` | Elaboración, Aprobación de insumos o Aprobación de MO y equipos | Editor de APU, import (`buscar_mano_obra_candidatos` es INVOKER), página `admin-mo` |
| `consolidados` | Consolidado de pagos (el Administrador la tiene siempre) | `ayf/consolidado/actions.ts`, `admin/actions.ts` |
| `empresas_cuentas_bancarias` | Solo Administrador | Ninguna pantalla la lee |
| Todas (`anon`) | `revoke all` a tablas, vistas y secuencias, también para las tablas nuevas | Ninguna pantalla lee sin sesión |

## 3. Antes / después por rol

Usuarios de prueba: Almacenista (Malecón, Estuario), Auxiliar administrativo (Estuario), Contabilidad (Estuario), Director de obra (Malecón, Estuario), Financiera (Estuario), Gerencia (Estuario, Malecón), Jurídica = rol Legal (Estuario), Compras = Líder Compras (Malecón, Estuario), RRHH (Estuario), Subgerencia (Estuario, Malecón). Administrador: todo, antes y después.

Leyenda: **P** = las de sus proyectos · **T** = todas · **—** = nada · **OC** = solo las ligadas a órdenes que ve · **Pago** = solo las que tienen un pago que ve · **Anexo** = solo los ítems del anexo de sus contratos · **Propias** = las que pidió la persona. Cuando no cambia, la celda dice "igual".

### Compras y almacén

| Rol | OC (cabecera) | Líneas de OC (precios) | Requisiciones | Salidas |
|---|---|---|---|---|
| Almacenista | igual (P) | igual (P) | P → **OC** | igual (P) |
| Auxiliar administrativo | P → **—** | P → **—** | igual (P) | P → **—** |
| Contabilidad | P → **Pago** | P → **—** | P → **—** | P → **—** |
| Director de obra | igual (P) | igual (P) | igual (P) | igual (P) |
| Financiera | P → **Pago** | P → **—** | P → **—** | P → **—** |
| Gerencia | igual (P), + Pago | igual (P) | P → **OC** | igual (P) |
| Jurídica (Legal) | P → **—** | P → **—** | P → **—** | P → **—** |
| Líder Compras / Compras | igual (T) | igual (T) | igual (T) | igual (P) |
| RRHH | P → **—** | P → **—** | P → **—** | P → **—** |
| Subgerencia | P → **—** | P → **—** | igual (T) | P → **—** |

### Presupuestos y catálogos

| Rol | Presupuesto / ítems / versiones | APU | Líneas de APU | Maestra de insumos | Solicitudes | Tarifas MO/equipo | Histórico de precios |
|---|---|---|---|---|---|---|---|
| Almacenista | P → **—** | T → **—** | T → **—** | igual (T) | T → **Propias** | T → **—** | T → **—** |
| Auxiliar administrativo | igual (P) | T → **—** | igual (T) | igual (T) | T → **Propias** | T → **—** | T → **—** |
| Contabilidad | P → **—** | T → **—** | T → **—** | T → **—** | T → **Propias** | T → **—** | T → **—** |
| Director de obra | igual (P) | igual (T) | igual (T) | igual (T) | igual (T) | igual (T) | T → **—** |
| Financiera | P → **—** | T → **—** | T → **—** | T → **—** | T → **Propias** | T → **—** | T → **—** |
| Gerencia | igual (P) | igual (T) | igual (T) | igual (T) | igual (T) | igual (T) | T → **—** |
| Jurídica (Legal) | P → **Anexo** (solo ítems) | T → **—** | T → **—** | T → **—** | T → **Propias** | T → **—** | T → **—** |
| Líder Compras / Compras | P → **—** | T → **—** | T → **—** | igual (T) | T → **Propias** | T → **—** | igual (T) |
| RRHH | P → **—** | T → **—** | T → **—** | T → **—** | T → **Propias** | T → **—** | T → **—** |
| Subgerencia | igual (P) | T → **—** | igual (T) | igual (T) | T → **Propias** | T → **—** | T → **—** |

Área Técnica y Líder Técnico (sin usuario de prueba) conservan todo lo de esta tabla, porque tienen Elaboración y las aprobaciones; el Líder Técnico conserva además el histórico de precios (por Aprobar insumos). Líder Legal queda igual que Legal.

### A&F

| Rol | Consolidados | Cuentas bancarias de las empresas |
|---|---|---|
| Contabilidad, Financiera | igual (T) | T → **—** |
| Todos los demás roles | T → **—** | T → **—** |
| Administrador | igual (T) | igual (T) |

## 4. Qué pantalla podría romperse (probar antes de dar por bueno)

Ninguna pantalla debería perder datos. Estos son los puntos donde puede pasar, en orden de riesgo:

1. **Registro y detalle de OC del Almacenista y de Gerencia**: el insumo de cada línea llega por `pedidos_insumos_select_de_ordenes`. Si en el detalle sale "(insumo eliminado)", esa política no está funcionando. Probar con almacenista@ y gerencia@: listado resumido y detallado, Excel, detalle y PDF.
2. **Consolidado y Aprobación de pagos** (contabilidad@, financiera@): la columna Origen debe seguir mostrando "OC 26". Si sale vacía, revisar `ordenes_compra_select_de_pagos`.
3. **Detalle del contrato en Pre-aprobación / Aprobación de contratos** (juridica@, subgerencia@) y "Contratos › Ver" en Control: el código de ítem del anexo llega por `presupuesto_items_select_de_contratos`.
4. **Requisiciones** del Auxiliar administrativo y del Director: buscador de insumos, cupo disponible, modificar una requisición y detalle. Las RPC son INVOKER y necesitan `item_apu`, `presupuesto_items` y `maestro_insumos`.
5. **Presupuestos** (Director, Gerencia): cargar el presupuesto, el editor de APU, el import con hoja APU, Revisar pendientes, transporte, gráficas. Gerencia no tiene `editar_presupuestos`, así que no escribe.
6. **Aprobación de insumos y de MO/equipo**: listas de solicitudes, aprobar (lee y escribe `item_apu` y `apu_import_revision`) y el banner de Excel.
7. **Compras** (compras@): Requisiciones por comprar y Generar OC leen `pedidos_insumos`, `maestro_insumos` y las líneas de OC con Comprar. Compras ya no lee presupuestos; no se encontró ninguna pantalla de Compras que los lea.
8. **Usuarios sin rol** (`rol_id` null y sin `es_admin`): `tiene_pestana` les devuelve falso y se quedan sin estas tablas. Hoy no hay ninguno en la base.
9. **anon**: si algo lee una tabla sin sesión (no se encontró nada), dejará de funcionar. El login usa Supabase Auth, que no pasa por estas tablas.

Funciones SECURITY DEFINER que no se ven afectadas (siguen funcionando aunque la tabla quede cerrada): `control_proyecto`, `inventario_proyecto_completo`, `listar_ordenes_para_entrada`, `listar_ordenes_entradas`, `detalle_orden_para_entrada`, `listar_salidas_registradas`, `listar_saldos_pendientes`, `ordenes_compra_con_sobrecosto_precio`, `precios_efectivos_insumos`, `_comprado_pedido`, `_comprometido_insumo_item`, `historial_entidad`, `items_presupuesto_para_contrato`, actas y contratos.

## 5. Lo que queda abierto (para decidir)

- **La RLS no restringe columnas.** Quien puede leer una fila la lee completa:
  - El Auxiliar administrativo y la Subgerencia ven los valores del presupuesto de sus proyectos (`presupuesto_items.valor_unitario`, `valor_total`), porque Requisiciones necesita el ítem.
  - Todos los que tienen la maestra ven `vr_unitario`.
  - A&F ve la cabecera completa de las OC con pago (condiciones de pago, anticipo, contacto).

  Si eso sobra, la salida es permiso por columna (como en `perfiles` y `contratistas`) o mover esas lecturas a funciones DEFINER que devuelvan solo lo necesario.
- **`presupuestos` no se puede cerrar más sin tocar `pedidos_insumos`.** Su política llega al proyecto pasando por `presupuesto_items` → `presupuestos`. Si se cambia para usar `pedidos_insumos.proyecto_id` directo (la columna ya existe y la llena un disparador), el presupuesto podría quedar solo para Elaboración, y Registro/Aprobación de requisiciones recibirían el código del ítem por otra vía.
- **Hueco que ya existe hoy (falta acceso, no sobra):** en Consolidado / Aprobación de pagos, Contabilidad y Financiera no ven el número del acta ni el del contrato de los pagos de actas (`acta:actas(numero, contrato:...)`): la política de `actas` pide pestañas de Contratos. Hay 4 pagos de actas en Estuario Casa. Si se abre como se hizo con las OC, las tablas hijas (`acta_lineas`, `acta_actividades`...) heredarían la apertura por su `exists` sobre `actas`. Por eso conviene una función DEFINER que devuelva solo el número, o reescribir las hijas con las pestañas explícitas.
- **Escrituras que siguen amplias:**
  - `solicitudes_insumos` deja insertar a cualquiera con sesión sin exigir `solicitado_por = auth.uid()`.
  - `empresas`, `grupos`, `maestro_insumos`, `solicitudes_*` y otras siguen con políticas `to public`; con la migración 4, anon igual queda sin permisos de tabla.
- `empresas` (NIT, razón social, logo) y `bancos` siguen legibles para todos con sesión: los usan muchos embeds (PDF de OC, pagos, minutas).
- `pedidos_insumos_select` deja ver TODAS las requisiciones a quien tiene Aprobar insumos (Líder Técnico), además de Aprobar requisiciones. Así estaba antes; no se cambió.
