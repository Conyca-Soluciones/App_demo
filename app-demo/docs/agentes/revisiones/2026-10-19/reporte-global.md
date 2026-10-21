# Reporte global — Revisión por roles (19 de octubre de 2026)

**Cómo se hizo.** Diez agentes, uno por cargo, revisaron la app en http://localhost:3000. Cada uno entró con su propio usuario de prueba y con los permisos de su rol. Financiera y Tesorería usaron el mismo usuario, porque en la app son un solo rol. Subgerencia no tiene agente. La base es la de producción, así que **nadie guardó nada**: los agentes abrieron los formularios, los llenaron para ver las validaciones y los cerraron sin guardar. Por eso quedaron sin probar: subir un presupuesto, crear requisiciones, órdenes de compra, contratistas y actas, aprobar y rechazar. Los informes de cada rol están en esta misma carpeta (ver índice al final).

Lo que dice **"Confirmado en la base"** lo verifiqué con consultas de solo lectura a Supabase. El resto es lo que vieron los agentes en pantalla o en el código.

---

## 1. Resumen

- **Lo que ya funciona bien:** el flujo de obra (presupuesto con APU, requisiciones con tope, compras con presentación y saldos, entradas y salidas, contratos con 6 minutas, actas con descuentos y PDF) y **Control del proyecto**, que todos los que lo vieron elogian, también en celular. Los permisos por pestaña bloquean bien las rutas ajenas.
- **Lo que más duele, en todos los roles:**
  1. **Faltan permisos de lectura en la base** que dañan varias pantallas a la vez: "Solicitado por —" y "(proveedor eliminado)". Son errores, no datos de prueba, y se arreglan rápido (sección 2).
  2. **Nadie se entera de lo que le toca.** La campanita estaba vacía con pagos, una OC y una solicitud de contrato esperando desde hace días. No hay una bandeja de "pendientes míos".
  3. **El ciclo del dinero termina en "aprobado".** No existen "liquidado", "en dispersión" ni "pagado", ni soportes visibles en el pago, ni ingresos o saldos bancarios. Gerencia, Financiera, Tesorería, Contabilidad y Compras no pueden cerrar su trabajo en la app.
  4. **El celular falla en las tablas** (registro de requisiciones, salidas, recepción, actas, OC). Los formularios sí funcionan.
  5. **Hay controles débiles donde se mueve plata:** la misma persona crea y aprueba OC, crea y verifica cuentas bancarias, y cambia el tercero o la cuenta de un pago aprobado sin dar un motivo.
- **Roles que hoy no tienen nada que hacer en la app:** RRHH (entra a "Sin acceso") y Auxiliar administrativo (solo ve requisiciones de obra). Financiera y Contabilidad solo consultan.

---

## 2. Errores para arreglar ya

| # | Error | Quién lo vio | Causa | Estado |
|---|---|---|---|---|
| E1 | **"Solicitado por —" / "Creada por —"** en requisiciones, solicitudes de contrato y órdenes de compra | Director, Jurídica, Gerencia, Almacenista, Aux. administrativo | La política RLS de `perfiles` solo deja leer el propio perfil, o todos si se es Administrador o se tiene la acción `comprar`. | **Confirmado en la base.** No son datos de prueba. |
| E2 | **"(proveedor eliminado)"** en Registro y Aprobación de OC | Almacenista, Gerencia | `proveedores_select` solo deja leer con `comprar` o Administrador. Gerencia aprueba OC sin ver a quién le compra. Entradas sí muestra el nombre porque lee los datos por otra función. | **Confirmado en la base.** |
| E3 | **Compras ve todos los proyectos** (COMFIAR incluido) aunque solo tiene 2 asignados | Compras | La política `proyectos_select_compras` da todos los proyectos a quien tenga `comprar`. | **Confirmado en la base y en pantalla.** Puede ser a propósito: hay que decidirlo (pregunta D3). |
| E4 | **El total del Consolidado de pagos suma los anulados** ($4.081.700 = 3 aprobados + 1 anulado de $12.000) | Financiera, Tesorería, Contabilidad | Cálculo del total de la página. | Visto en pantalla (las cifras cuadran exactas). |
| E5 | **Pagos de actas "Sin tercero"** (Actas de CJ-14 y CJ-17): Gerencia los puede aprobar y Tesorería los recibe sin beneficiario | Gerencia, Financiera, Tesorería, Contabilidad, Director | Según el código, el tercero sale del documento del contratista. Probablemente el contratista no existe como tercero en A&F. | Visto en pantalla. **Causa por confirmar.** |
| E6 | **"Avance anterior" equivocado en el acta por %** (CJ-14: dice 0 % y 25 % con $694.058 ya cobrados; con 50 % deja guardar $1.000.000 aunque el saldo es $805.941) | Director, Gerencia | El Acta 1 no tiene % ni período (¿dato viejo?) y la pantalla no compara contra el saldo. | Visto en pantalla. **Falta saber si la base lo frena** al guardar. |
| E7 | **Control del proyecto suma las actas en bruto y A&F las muestra en neto**, sin decirlo (CJ-17: $4,5 M frente a $3,48 M) | Gerencia | Cada pantalla usa un valor distinto. | Visto. Basta con nombrar bien cada cifra o elegir una sola. |
| E8 | **Buscar un insumo que existe pero está pendiente** en el presupuesto no devuelve nada ni explica por qué (en Malecón, "cemento") | Director, Aux. administrativo | Solo se pueden pedir los insumos resueltos; el buscador no da ningún mensaje. | Visto. |
| E9 | **La fecha requerida acepta fechas pasadas** (01/01/2020), y sin fecha el botón queda gris con un mensaje que no corresponde ("Marca al menos un ítem…") | Aux. administrativo, Director | `puedeGuardar` solo revisa que haya fecha. | Visto. No se probó si el servidor la rechaza. |
| E10 | **Los insumos con precio de $1.000** siguen saliendo como "100 %" de similitud en la revisión de APU | Director | Precios de prueba que siguen en la maestra. | Visto (teja, tela verde, puntilla, alambre). |

Detalles menores que vieron varios roles: las fechas salen en mm/dd/aaaa en los campos y en dd/mm/aaaa en las listas; "requisiciónes" con tilde mal puesta; "Distribucion" sin tilde; el ITEM del consolidado salta números (1, 2, 4, 6) sin explicar por qué; "Nombre para el banco" se corta en 20 caracteres.

---

## 3. Temas que se repiten en varios roles

### T1. Avisos y bandeja de pendientes — 6 roles
Director, Jurídica, Gerencia, Compras, Tesorería y Almacenista. La campanita no avisó de la solicitud N° 18 (pendiente desde el 14/10), del pago del acta de $500.000, de la OC 48 (desde el 06/10) ni de la requisición 34, que está aprobada y vencida.
**Propuesta común:** una pantalla de entrada por rol con sus pendientes, cuántos días llevan y quién los tiene; avisos cuando algo le llega a alguien; y que cada rol aterrice ahí al elegir proyecto. Gerencia hoy cae en Presupuestos y el Almacenista en Registro de OC.

### T2. "Presiona Consultar" sin resultados al abrir — 6 roles
Registro de requisiciones, Entradas, Aprobación de pagos, Consolidado (la semana actual sale vacía) y Requisiciones por comprar. Piden que la pantalla abra ya filtrada en lo pendiente del usuario.

### T3. El ciclo del pago después de "aprobado" — 5 roles
Gerencia, Financiera, Tesorería, Contabilidad y Compras.
- No hay estados liquidado, en dispersión, pagado, devuelto por el banco ni reprogramado. El modelo ya los prevé, pero ninguna pantalla los usa.
- No hay liquidación de retenciones, ni valor neto, ni datos tributarios del tercero (RUT, régimen, ZOMAC, ICA).
- No hay dispersor por banco (Bancolombia y Banco de Bogotá), ni cuenta de la empresa desde donde se paga, ni conciliación con el extracto.
- No se puede exportar el consolidado a Excel.
- **Riesgo de descontar dos veces:** el director puede escribir retefuente o ICA como "otros descuentos" del acta, y después Contabilidad liquida otra vez.

### T4. Soportes y documentos — 6 roles
- No hay soportes visibles en el pago, ni para Tesorería ni para Contabilidad.
- Compras no tiene dónde adjuntar las cotizaciones ni los soportes del pago.
- El almacenista no tiene dónde subir la foto de la remisión.
- El auxiliar no tiene dónde subir la factura de energía o del arriendo.
- **No hay vigencias:** los documentos del contratista, del proveedor y la certificación bancaria no tienen fecha de expedición ni de vencimiento, ni alertas. Las pólizas no tienen dónde registrarse (Jurídica).

### T5. Trazabilidad — 5 roles
Además de E1:
- La minuta no guarda versiones, así que no se sabe qué cambió entre la plantilla, Jurídica y Subgerencia.
- El documento reemplazado de un contratista se pierde.
- A&F no marca si un acta se editó después de pedir el pago.
- El tercero o la cuenta de un pago aprobado se cambian sin motivo y sin dejar rastro.

### T6. Celular — 8 roles
- **Funciona:** Control del proyecto, el formulario de requisición, la solicitud de contrato y el acta en tarjetas.
- **Falla:** las tablas.
  - Salidas: la columna "Cantidad a sacar" queda fuera de la pantalla, y es justo donde el almacenista trabaja con el celular.
  - Recepción de entradas, Registro de requisiciones y lista de actas: hay que deslizar de lado.
  - Aprobación de OC: el botón Rechazar queda cortado.
  - Presupuesto: no se puede usar.
  - El menú de 3 columnas se corta.
  - El panel de filtros abre desplegado y aplasta los resultados.

### T7. Módulos vacíos en el menú — 5 roles
A&F y AdPro dicen "Próximamente" para Financiera, Contabilidad, RRHH, el Auxiliar y el Almacenista, y RRHH cae en "Sin acceso" sin explicación. Además, Informes y Actas generales salen en el menú de Jurídica sin tener página. **Propuesta:** ocultar lo que el rol no puede usar.

---

## 4. Riesgos de control, por gravedad

1. **El mismo usuario crea y aprueba OC** (Líder Compras tiene `comprar` y `aprobar_oc`; `aprobar_orden_compra` no revisa quién la creó). Como la OC aprobada ya aprueba su pago o anticipo, Compras puede comprometer plata sin que Gerencia lo vea.
2. **Cuentas bancarias:** Financiera y Tesorería son un solo rol, así que **la misma persona crea y verifica** la cuenta de un tercero. Tampoco se registra el titular de la cuenta ni se adjunta la certificación. Es el camino típico para desviar un pago.
3. **Cambiar el tercero o la cuenta de un pago ya aprobado** con "Guardar", sin motivo ni segunda persona.
4. **Aprobar pagos de actas sin ver el acta.** La tarjeta solo muestra el valor y la fecha; el detalle está en otra pantalla. Además, A&F no avisa si el acta se editó después.
5. **Minutas con campos "Falta" aprobadas** (CJ-17 y CJ-19 sin representante legal ni plazos). Ninguna validación lo impide.
6. **Acta por % de avance sin respaldo de cantidades:** un porcentaje inflado sube el pago. Se suma E6.
7. **Salidas de almacén sin responsable** ("¿Quién retira?" es opcional) y sin ítem de obra. Gerencia mide el avance con esas salidas.
8. **Proveedores duplicados con el mismo NIT** (PV021 y PV0266), y edición en línea de los datos del proveedor sin historial.
9. **Futuro módulo de nómina:** si cada empleado entra como un pago, `pagos_select` muestra los sueldos a todos los que ven el consolidado.

---

## 5. Lo que falta por construir (según los roles)

| Tema | Roles que lo piden | ¿Está en el roadmap? |
|---|---|---|
| Pedir más de lo presupuestado (adicional o ampliación de cupo) | Director, Aux. | **No** |
| Otrosí (ampliar plazo o valor) | Director, Jurídica | Sí |
| Retención en garantía en mano de obra | Director, Jurídica | Sí |
| Cotizaciones y motivo de la elección del proveedor | Compras, Gerencia | Sí |
| Ver el estado de pago y de recepción de mis OC y requisiciones (requisición → OC → entrada) | Compras, Director, Almacén, Aux. | Parcial |
| Liquidación, dispersión y conciliación | Tesorería, Contabilidad, Financiera | Sí (liquidación y dispersión) |
| Ingresos, saldos bancarios y flujo de caja | Financiera | **No** |
| Módulo de RRHH (empleados, nómina, PILA, costo por obra) | RRHH, Contabilidad | Sí |
| Gastos y pagos administrativos (con recurrentes) | Aux., Contabilidad | **No** |
| Devoluciones a proveedor, traslados entre obras, material no conforme | Almacenista | **No** |
| Modo sin conexión en bodega | Almacenista | **No** |
| Borradores en la solicitud de contrato | Director | Sí |
| Mano de obra agrupada en la revisión del APU (498 decisiones una por una en Malecón) | Director | **No** |

---

## 6. Decisiones que necesito de ti

- **D1. ¿Quién aprueba la OC?** Hoy la aprueba Compras en su propia pantalla. El documento de contexto dice que se aprueba con el pago, en Gerencia. (Compras y Gerencia)
- **D2. Permisos de lectura (E1 y E2):** ¿todos los roles deben ver el nombre de quien pidió algo? ¿Todos los que ven OC deben ver al proveedor? Mi recomendación es que sí en ambos casos.
- **D3. ¿Compras debe ver todos los proyectos** (política `proyectos_select_compras`) o solo los asignados?
- **D4. ¿Separar Financiera y Tesorería** para que quien crea una cuenta no sea quien la verifica?
- **D5. ¿Qué es "pagado"?** ¿El pago aprobado o el que salió del banco? ¿El Control debe mostrar el acta en bruto o en neto?
- **D6. ¿Las cantidades enteras se mantienen?** El "Disponible" sale con decimales y el saldo nunca se puede pedir completo.
- **D7. ¿Cómo se maneja un adicional de obra** y quién lo autoriza?
- **D8. Retenciones:** ¿las calcula solo Contabilidad, o el director las sigue descontando en el acta?
- **D9. Gastos administrativos:** ¿se cargan a la oficina (centro de costo) o a un proyecto? ¿Quién los aprueba?
- **D10. ¿El almacenista debe ver precios** y el valor del inventario?
- **D11. Nómina:** ¿se calcula en la app o se sube el Excel de nómina? ¿Quién puede ver salarios?
- **D12. Datos de prueba en producción:** ¿qué hacer con los precios de $1.000, el Acta 1 de CJ-14 sin %, los pagos "(PRUEBA)" mezclados con OC reales y los proyectos "malecon / maleon"?

---

## 7. Orden sugerido

1. **Arreglos rápidos sin decisiones:** E4 (total sin anulados), E8 (mensaje cuando el insumo está pendiente), E9 (fecha pasada y mensaje del botón), nombrar bruto y neto (E7), y ocultar módulos y pestañas vacías (T7).
2. **Con D2 y D3:** políticas RLS de `perfiles` y `proveedores` (E1 y E2) y revisar `proyectos_select_compras` (E3).
3. **Control del dinero:** el tercero del pago de acta (E5), el tope de saldo en el acta por % (E6), pedir motivo al cambiar el tercero o la cuenta de un pago, separar quien crea y quien aprueba OC (D1) y quien crea y verifica cuentas (D4), y validar los campos "Falta" antes de pre-aprobar.
4. **Bandeja de pendientes y avisos** (T1 y T2): es lo que más roles piden.
5. **Celular en tablas** (T6): empezar por Salidas y Entradas, que son de bodega.
6. **Módulos grandes**, según las decisiones: ciclo de pago y soportes (T3 y T4), adicionales, otrosí, cotizaciones, gastos administrativos, RRHH.

---

## Índice de informes (2026-10-19)

| Rol | Archivo | Usuario de prueba |
|---|---|---|
| Director de obra | [director-obra.md](director-obra.md) (y el de solo código: [../2026-10-16/director-obra.md](../2026-10-16/director-obra.md)) | Director |
| Compras | [compras.md](compras.md) | Compras (Líder Compras) |
| Almacenista | [almacenista.md](almacenista.md) | Almacenista |
| Jurídica | [juridica.md](juridica.md) | Juridica (Legal) |
| Gerencia | [gerencia.md](gerencia.md) | Gerencia |
| Financiera | [financiera.md](financiera.md) | Financiera |
| Tesorería | [tesoreria.md](tesoreria.md) | Financiera (mismo rol) |
| Contabilidad | [contabilidad.md](contabilidad.md) | Contabilidad |
| Recursos Humanos | [rrhh.md](rrhh.md) | RRHH |
| Auxiliar administrativo | [auxiliar-administrativo.md](auxiliar-administrativo.md) | Aux Admin |
