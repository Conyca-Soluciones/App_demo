# Revisión — Compras (Líder Compras)
Método: app en navegador (panel de ~570 px de ancho, que ya se comporta como móvil) + lectura puntual de código/SQL para confirmar permisos  ·  Alcance: Requisiciones por comprar, Generar OC, Saldos pendientes, Registro de OC (lista y detalle), Aprobación de OC, Proveedores (lista y formulario "Nuevo proveedor"), Maestra de insumos, Inventario, menú A&F. Prueba en 375 px (preset mobile) y reseteo a desktop.
No pude probar sin guardar: crear OC, crear proveedor, cerrar saldo, aprobar/rechazar/retirar OC, descargas de Excel/PDF de OC (no las ejecuté), edición de celdas de proveedor. Llené Generar OC (proveedor, precio, cantidad parcial) y abandoné sin generar; abrí "Nuevo proveedor" y lo cancelé. Sesión nunca se cayó.

## Resumen
La app cubre bien lo básico: cola de requisiciones aprobadas, generar OC con presentación de compra y anticipo, compras parciales con "saldos pendientes", alerta de precio sospechoso. No existe nada de cotización, ni historial de precios por insumo, ni documentos vigentes del proveedor, ni soportes de pago. Lo más importante: (1) no hay cotizaciones ni "por qué elegí este proveedor"; (2) mi rol puede crear Y aprobar la OC, lo que contradice el contexto ("la OC se aprueba con el pago") y es un riesgo de control; (3) no veo el estado de pago/recibido de mis OC ni puedo adjuntar soportes.

## Escenarios probados
| Escenario | Resultado | Nota |
|---|---|---|
| 1. Requisiciones pendientes de la semana, decidir qué cotizar, cotizar 1 insumo con 3 proveedores | No existe aún (cotizar); Logrado con fricción (ver cola) | La cola es por proyecto (hay que cambiar de proyecto y consultar uno a uno). En Estuario salen 3 filas (req. 30 y 34; el insumo 3913 aparece en dos requisiciones). No hay forma de cotizar ni de comparar proveedores; está en el roadmap como planeado. |
| 2. Registrar proveedor nuevo y generarle OC | Logrado con fricción | "Nuevo proveedor" solo exige el nombre; no pide RUT, cámara de comercio, certificación bancaria ni condiciones. Al elegir proveedor en Generar OC se ve contacto/teléfono/banco/cuenta y marca "Contacto: Falta". No pude guardar. |
| 3. OC por cantidad menor a la requisición | Logrado con fricción | Se permite (cantidad 20 de 50 muestra "faltan 30"). El faltante queda en "Saldos pendientes" (req. #30: pedido 12, comprado 10, falta 2, "13 días", botón Cerrar saldo). No hay campo de motivo ni fecha prometida del resto. |
| 4. Cambiar proveedor/precio de una OC creada | Bloqueado | Ni en el detalle ni en la lista hay "Editar". Solo: PDF, Retirar (pendiente), desaprobar/cancelar (aprobada sin material recibido). Hay que cancelar y rehacer. Los motivos de desaprobar/cancelar sí se piden; el historial del detalle muestra solicitada/aprobada. |
| 5. Ver estado de mis OC (pago, pagada, recibida) | Bloqueado | El Estado solo es Pendiente/Aprobada/Rechazada/Cancelada (código: lib/ordenes-compra-estado.ts dice que la recepción "se ve en Entradas"). No veo pago aprobado, pagada ni recibida. El menú A&F para mi rol dice "Próximamente: este módulo todavía no tiene herramientas". |
| 6. OC a proveedor a crédito: ¿cuándo queda aprobada? | No existe aún / contradice el contexto | En la app hay una pantalla "Aprobación de órdenes de compra" y la OC se aprueba por sí sola (botón "Aprobar orden"), antes y aparte del pago. Sin anticipo no hay flujo distinto "crédito". Con anticipo: "al aprobar la orden se aprueba el pago del anticipo; el saldo llega a Gerencia cuando quede entregada o 3 días antes de una fecha". |

## Falta
- [P1] Cotizaciones y justificación de la elección de proveedor — Evidencia: Generar OC solo pide proveedor, precio, % dto, % IVA por línea; no hay cotizaciones adjuntas, ni comparativo, ni campo "por qué este proveedor" (búsqueda en el código: "cotiz" solo aparece en minutas) — Impacto: sin respaldo para gerencia/auditoría, y yo sigo en Excel/WhatsApp. Está planeado en el roadmap: ojo que debería poder ser mínimo (3 precios + proveedor elegido + motivo si no es el más barato), no un módulo grande.
- [P1] Ver el estado de pago y de recepción de mis OC — Evidencia: lista y detalle de OC solo muestran Pendiente/Aprobada; A&F vacío para mi usuario — Impacto: tengo que llamar a tesorería/almacén para saber si pagaron o llegó el material, y no sé cuándo confirmar al proveedor.
- [P1] Adjuntar soportes del pago — Evidencia: no hay ninguna pantalla ni botón de soportes en mi menú (solo AdPro; A&F "Próximamente") — Impacto: parte central de mi función según Luis; hoy no se puede hacer.
- [P2] Historial de precios del insumo — Evidencia: Maestra de insumos solo muestra "Valor unitario" (promedio), la tarjeta no se abre; en Generar OC solo veo "N veces el precio de referencia ($274)" — Impacto: no sé qué pagué antes ni a quién para negociar.
- [P2] Documentos del proveedor con vigencia — Evidencia: "Nuevo proveedor" tiene solo nombre, tipo, estado, documento, contacto, teléfono, correo, ciudad, dirección; no hay RUT, cámara de comercio, certificación bancaria, fechas de vencimiento ni alerta. Los datos bancarios aparecen en Generar OC pero no en el formulario ni en la tabla de proveedores — Impacto: vuelvo a pedir los mismos papeles y no sé qué está vencido.
- [P2] Comprar en volumen entre obras — Evidencia: la cola exige elegir un proyecto en la barra de arriba; el filtro "Proyecto" no tiene "todos". Una OC es de un solo proyecto. Dos requisiciones del mismo insumo (3913 en req. 30 y 34) salen como dos líneas separadas — Impacto: pierdo descuento por volumen y tiempo cambiando de obra.
- [P2] Avisarme de requisiciones nuevas/urgentes — Evidencia: la cola hay que consultarla manualmente ("Elige un proyecto y presiona Consultar"); columna "Urgente" existe pero no vi aviso ni ordenamiento por urgencia — Impacto: no sé qué llegó hoy.
- [P3] Diferencias entre lo pedido y lo conseguible (otra marca/presentación) — Evidencia: sí existe "UM disponible/Conversión" (cajas, bultos) pero no hay campo de marca/referencia/nota por línea — Impacto: la obra no sabe qué le van a mandar.

## Mejorar
- [P1] Cambiar proveedor/precio de una OC creada sin cancelar — Evidencia: solo Retirar/Desaprobar/Cancelar — Propuesta: permitir editar mientras esté Pendiente y dejar registro de qué cambió y quién.
- [P2] "Saldos pendientes" — Evidencia: muestra pedido/comprado/falta/días y "Cerrar saldo", pero no a qué OC corresponde, ni proveedor, ni fecha esperada del resto, ni aviso — Propuesta: agregar proveedor/OC, fecha prometida y motivo; filtro por antigüedad. Además "lo que falta sigue descontado del presupuesto": está bien, pero confirmar que se entiende (cerrar saldo libera cupo).
- [P2] Confirmación al proveedor — Evidencia: la OC pasa a "Aprobada" desde la propia app; el PDF se descarga solo cuando está aprobada (Pendiente sin PDF en la lista) — Propuesta: definir y mostrar claramente "OC aprobada = puedo confirmar al proveedor"; si el pago es el que aprueba, mostrar ese estado.
- [P2] Proveedores: tipo "DIRECTO / DIRECTO PRECIO / DIRECTO CREDITO / NO DIRECTO" — Evidencia: filtro y campo existen; solo lo vi como etiqueta (en el código solo está en lib/proveedores.ts, no influye en la OC) — Propuesta: usar el tipo para decidir anticipo vs crédito en Generar OC, o explicar qué significa cada uno.
- [P2] Datos de proveedores sucios — Evidencia: mismo NIT 13.222.429-6 en PV021 y PV0266 (Argemiro Alvarez, "CRA 19" y "CRA 21"); personas naturales con "Tipo documento NIT" y cédula; 87 inactivos y algunos sin estado (PV0240 con todo en "—"); contacto faltante en el proveedor que busqué (PV0230). El formulario nuevo sí avisa duplicados por documento (actions.ts), pero lo viejo quedó — Propuesta: depurar duplicados y obligar contacto/teléfono/correo al crear.
- [P3] Móvil (375 px) — Evidencia: en Requisiciones por comprar el panel de filtros llena la pantalla y la tabla queda cortada atrás; al colapsar filtros desaparece el botón Consultar (hay que reabrir). En Generar OC la tabla de líneas es muy ancha con scroll horizontal — Propuesta: tarjetas por línea en móvil. (El panel de pruebas ya era angosto ~570 px, así que se vio igual en desktop.)
- [P3] Texto — "2 requisiciónes seleccionadas" (sin tilde en "requisiciones") en la cola; en Generar OC "2 unidad de 12 pedidos" es confuso (parece ser lo pedido en total vs lo pendiente).
- [P3] Maestra: 1.040 insumos en pantalla vs "~870" del roadmap; hay casi duplicados (ACERO CORRUGADO DE 60000 PSI vs ACERO DE REFUERZO 60.000 PSI) — Propuesta: revisar cuál dato del roadmap está vigente y depurar.

## Sobra o es demasiado complejo
- "Aprobación de órdenes de compra" como pantalla propia dentro de Compras — Por qué: según el contexto la OC no tiene aprobación propia; aquí existe y la puede usar mi mismo rol. O el contexto está desactualizado o la pantalla duplica la aprobación de gerencia en pagos.
- Tres vistas (Registro, Aprobación, y desaprobar/cancelar/retirar) con acciones parecidas — Por qué: mismo listado con filtros distintos; Registro y Aprobación podrían ser una sola lista con filtro de estado.
- Selector de proyecto en la barra y en el filtro de cada pantalla — Por qué: obliga a elegir dos veces el mismo dato (barra arriba y filtro "Proyecto").

## Traspasos con otros roles
- De Subgerencia técnica / Director de obra → Compras: recibo requisiciones con cantidad y valor proyectado, pero sin especificaciones (marca, referencia) ni prioridad real; la columna "Urgente" aparece vacía ("—") en las tres que vi. Propongo comentario obligatorio cuando sea urgente.
- Compras → Gerencia/A&F: la OC va con total y proveedor, pero sin cotizaciones ni motivo de elección; gerencia aprueba "a ciegas". Propongo adjuntar las cotizaciones a la OC.
- Compras → Almacén: la OC aprobada es lo único que le sirve a almacén; no hay aviso a almacén cuando se aprueba ni a mí cuando almacén recibe. Propongo estado visible "recibida parcial/total" en mi lista de OC.
- Almacén → Compras (pago): confirmado que el pago del saldo depende de la entrega completa ("cuando la orden quede entregada por completo"), pero no veo ni la entrega ni el pago desde mi rol.
- Compras → Tesorería/Contabilidad: no existen soportes; el proveedor (con banco y cuenta) se ve en Generar OC, pero la cuenta se edita en el proveedor sin trazabilidad visible.

## Riesgos de control
- Un mismo usuario con rol Líder Compras puede crear OC (accion.comprar) y aprobarla (accion.aprobar_oc), además desaprobar y cancelar — Evidencia: supabase/migrations/20261001000000_roles_permisos.sql líneas 75-77; la función aprobar_orden_compra (02a_funciones.sql) solo valida el permiso, no que quien aprueba sea distinto de quien creó. En pruebas vi los botones "Aprobar orden / Rechazar orden" en la OC #48 (creada por otro usuario, "Gestion ti"); no probé aprobar propias, es lectura de código.
- Comprometer con proveedores antes de que gerencia vea algo — Cómo: como la OC queda aprobada por Compras, podría confirmarse al proveedor sin que gerencia haya aprobado el pago; si luego se rechaza el pago queda el compromiso.
- Edición libre de proveedores (datos de pago) — "Haz clic en una celda para editarla. Enter guarda": cambiar cuenta bancaria/correo directo en la tabla, sin historial visible ni doble control. No lo probé; leí la pantalla. Riesgo de desvío de pagos.
- Proveedores duplicados con el mismo NIT (PV021/PV0266) — se podría pagar dos veces o dividir compras para evadir topes.
- Precio sospechoso: hay alerta ("3 veces el precio de referencia", confirmación antes de crear), pero es un aviso, no un bloqueo ni requiere justificación; en la OC #48 la lista dice "Precio +10%" mientras el precio unitario es muy distinto (suposición: la etiqueta puede estar calculada sobre otra base; revisar).
- Alcance de proyectos: el selector me ofrece 3 proyectos (incluye COMFIAR) aunque Luis dijo que mi usuario solo tiene Estuario Casa y Malecón. Verificar permisos por proyecto.
- Diferencias de proyecto en saldos: lo que falta de una compra parcial sigue descontado del presupuesto y solo se libera con "Cerrar saldo"; cualquiera con rol puede cerrarlo (no lo probé).

## Preguntas para Luis
- ¿Quién debe aprobar la OC: Compras (como hoy en la app) o Gerencia con el pago (como dice contexto-conyca.md)? Si es lo segundo, la pantalla "Aprobación de órdenes de compra" y las acciones de aprobar/desaprobar de Líder Compras sobran o deben ser de Gerencia.
- ¿Los proveedores "DIRECTO CREDITO" y "DIRECTO PRECIO" deben cambiar el flujo (crédito/anticipo)? Hoy solo es etiqueta.
- ¿Cuántas cotizaciones exige CONYCA por compra y a partir de qué monto?
- ¿La confirmación al proveedor se hace con la OC aprobada por Compras o después de que gerencia apruebe el pago?
- ¿El dato "~870 insumos" del roadmap es antiguo? La maestra muestra 1.040.
- ¿Debe el usuario de Compras ver todos los proyectos (COMFIAR incluido)?
