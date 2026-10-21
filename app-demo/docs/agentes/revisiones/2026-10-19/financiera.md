# Revisión — Financiera
Método: app en navegador (usuario "Financiera", Estuario Casa, desktop y 375 px). Lectura puntual de migraciones SQL del repo solo para confirmar columnas. No pude consultar la base por SQL: la herramienta de Supabase fue negada por el permiso automático.  ·  Alcance: Inicio, menú AdPro, A&F › Pagos › Consolidado de pagos, A&F › Terceros (lista y filtros), acceso directo a rutas fuera del menú.

No probé sin guardar: abrir un tercero con "Ver" ni el diálogo "Tercero" de pagos sin tercero, ni "Nuevo tercero". Tampoco hay descargas que probar: el consolidado no tiene botón de exportar. Sesión estable, no se cayó. Terminé en desktop.

## Resumen
Hoy la app me sirve para ver egresos ya aprobados de la semana (consolidado con ITEM, tercero y cuenta). No hay nada de ingresos, saldos bancarios ni flujo de caja, y mi menú no tiene ninguna vista por proyecto: AdPro dice "Próximamente: este módulo todavía no tiene herramientas". Puntos que más importan:
1. El consolidado solo muestra pagos ya aprobados, sin fechas, sin filtro de proyecto y con un total que suma pagos anulados.
2. No existe ningún dato de ingresos ni de saldos, así que Excel sigue siendo el flujo de caja.
3. Para el flujo de caja de un proyecto no tengo ni presupuesto, ni "Control del proyecto".

## Escenarios probados
| Escenario | Resultado | Nota |
|---|---|---|
| 1. Pagos de las próximas 4 semanas (comprometido) | Bloqueado | El consolidado se consulta por una semana (año/semana). Solo trae aprobados ya numerados con ITEM. No hay vista de OC aprobadas sin pagar, actas en trámite ni nómina. |
| 1b. Lo que espero recibir | No existe aún | No hay pantalla ni tabla de ingresos o cobros a entidades. |
| 2. Registrar que una entidad pagó un acta de cobro | No existe aún | Ver "Falta": se necesitan unos 6 datos mínimos. |
| 3. Flujo de caja de un proyecto (presupuesto, cobrado, pagado, por pagar) | No existe aún | El menú AdPro está vacío para mi rol. /presupuestos me devuelve "no autorizado". No hay "cobrado". |
| 4. Saldos por banco y por empresa | No existe aún | Existen las cuentas bancarias de las empresas en base de datos, pero ninguna pantalla las muestra. Terceros solo trae terceros que se pagan. Buscar "Conyca" no devolvió nada. |
| Consolidado de pagos, semana actual (43/2026) | Logrado con fricción | Sale "Ningún pago coincide". Hay que quitar el número de semana para ver algo. |
| Consolidado de pagos, todas las semanas | Logrado con fricción | 4 filas, 3 aprobadas y 1 anulada. Total de página $ 4.081.700. |
| Terceros: buscar "AL" | Logrado | Lista con documento, nombre, nº de cuentas, estado "Verificada" o "Sin cuentas". |
| 375 px | Logrado | Los filtros se pliegan al consultar y la tabla se desplaza. |

## Falta
- [P1] Ingresos de las entidades (cobros) — Evidencia: en el menú solo hay Pagos y Terceros; Inicio no tiene tablero; no hay tabla ni pantalla de cobros. Tampoco está en el roadmap (solo planea "liquidación y dispersión" y RRHH). — Impacto: no puedo responder "¿nos alcanza la plata?"; el flujo de caja queda en Excel.
- [P1] Alcance mínimo propuesto de ingresos, un "cobro" por proyecto con: proyecto, entidad, acta o factura (referencia y número), valor facturado, fecha esperada de pago, fecha real de pago, valor recibido y cuenta bancaria de la empresa donde entró (más estado: por facturar, facturado, pagado). Con eso se calcula "por cobrar", "cobrado" y las entradas de las próximas 4 semanas. No pido facturación completa ni retenciones al cliente en esta etapa.
- [P1] Saldos y movimientos bancarios — Evidencia: ninguna pantalla muestra saldos. Por las migraciones, existe `cuentas_empresa` (banco, tipo, número, NIT, apodo) sin saldo. — Impacto: no sé con qué caja cuento por banco y por empresa. Propuesta mínima: saldo manual con fecha por cuenta de empresa (captura diaria o semanal), no conciliación bancaria.
- [P1] Pagos comprometidos a futuro — Evidencia: el consolidado solo trae pagos aprobados con ITEM; el estado "programado" y la `fecha_programada` existen en el modelo (migración 20261017) pero no se ven en la pantalla. — Impacto: no puedo ver OC aprobadas sin pagar, saldos por fecha ni actas en trámite. Propuesta: una vista "Por pagar" con horizonte de 4 semanas por fecha, proyecto y empresa.
- [P1] Flujo de caja por proyecto — Evidencia: AdPro vacío para mi rol; no hay vista que junte presupuesto, cobrado, pagado y por pagar. — Impacto: no puedo ver qué proyecto financia a cuál. Esto depende de los ingresos de arriba.
- [P2] Vista por empresa del conglomerado — Evidencia: el consolidado agrupa por "Consolidado" (Bogotá, Vanur, Otros) y tiene la columna "Grupo empresarial", pero no resumen ni totales por empresa. — Impacto: unir empresas sigue siendo manual.

## Mejorar
- [P1] El total de la página incluye pagos anulados — Evidencia: filas $1.574.100 + $1.909.600 + $586.000 + $12.000 (anulado, OC 46) = $4.081.700, que es exactamente el "Total de la página". Sin anulado serían $4.069.700. — Propuesta: excluir anulados y rechazados del total, o mostrar total por estado.
- [P1] Consolidado sin fecha ni rango — Evidencia: columnas ITEM, Consolidado, Grupo, Tercero, Cuenta, Concepto, Proyecto, Pago, Valor, Estado, Novedad, Acciones: ninguna fecha. Solo filtros por año y semana. — Propuesta: mostrar fecha de aprobación y fecha programada, y permitir un rango de semanas ("próximas 4").
- [P2] El filtro de proyecto no existe aunque hay columna "Proyecto" — Evidencia: filtros: Consolidado, Año, Semana, Estado, Tercero, Solo con novedad, Sin ITEM. Los pagos salen sin importar el proyecto seleccionado arriba. — Propuesta: filtro y total por proyecto. Además, aclarar si el selector de proyecto de la barra superior afecta esta pantalla.
- [P2] Entrada por defecto vacía — Evidencia: al abrir, hay que pulsar "Consultar"; con la semana actual (43) sale "Ningún pago coincide". — Propuesta: que cargue la última semana con pagos o muestre las próximas semanas.
- [P2] Sin exportar a Excel — Evidencia: no hay botón de descarga en el consolidado. — Propuesta: descarga a Excel para mi cuadro actual mientras no exista el flujo en la app.
- [P3] Numeración de ITEM con saltos (1, 2, 4, 6) en la vista de un solo proyecto — Evidencia: la lista muestra 4 filas con ITEM 1, 2, 4, 6 (los 3 y 5 no aparecen). Suposición: son de otro filtro o estado; confirmar que no se esconden pagos.

## Sobra o es demasiado complejo
- Para mi rol, A&F > Pagos solo tiene "Consolidado": la aprobación de pagos no la veo (ruta /ayf/aprobacion-pagos me manda a "no autorizado"). Correcto para el permiso, pero entonces no veo qué falta por aprobar, que es lo que más mueve mi flujo.
- El menú AdPro se muestra con "Próximamente" y sin herramientas. Si un rol no tiene nada ahí, mejor ocultarlo para no confundir.
- Pestaña Terceros: "Nuevo tercero" y verificar cuentas son tareas de Tesorería/Contabilidad; para mí es solo consulta.

## Traspasos con otros roles
- Gerencia → Financiera: la aprobación de pagos define cuándo sale la plata, pero no llega con fecha de pago esperada; propongo que al aprobar se fije la fecha programada.
- Contabilidad/Tesorería → Financiera: "en dispersión" y "pagado" son los estados que me importan; la app mide "aprobado", no "pagado" (hallazgo ya confirmado), así que mis egresos reales seguirían en Excel. Me afecta directamente.
- Pagos de actas sin tercero (ya confirmado): me afecta, 2 de 3 pagos aprobados vistos están "Sin tercero" ($3.483.700 de $4.069.700), no puedo saber a quién ni a qué banco salen.
- Compras/Director de obra → Financiera: las OC con anticipo y saldo deberían llegar con fecha del saldo; el modelo tiene `fecha_programada`, pero no la veo.
- Hallazgos ya confirmados de proveedores y perfiles: no me afectaron en lo que probé.

## Riesgos de control
- Total del consolidado engañoso (incluye anulados): puede llevar a sobrestimar el flujo de salida de la semana.
- Nada de ingresos registrado en la app: el seguimiento de cobros depende de Excel de una persona, sin historial ni auditoría.
- Financiera puede ver todos los pagos de todos los proyectos en el consolidado aunque el proyecto asignado es uno solo. Supuesto: es intencional por el rol Financiera/Tesorería; confirmar.

## Preguntas para Luis
- ¿Un cobro se asocia al acta de la entidad o a la factura? ¿Una factura puede cubrir varias actas o proyectos?
- ¿Las entidades pagan a una cuenta específica por proyecto, o a cualquier cuenta de la empresa?
- ¿Con qué frecuencia necesito el saldo de cada banco: diario, semanal? ¿Alcanza con captura manual?
- ¿Se necesita cobrar anticipos y retenciones en garantía de la entidad en esta etapa o solo el pago neto?
- ¿"Financiera y Tesorería" como un solo rol es lo definitivo? Si sí, ¿debería ver también "Aprobación de pagos" para conocer lo que está por salir?
- ¿"Sin tercero" en pagos de actas es un estado esperado o error de carga de datos? Lo veo en los 2 pagos de CJ-17.
- ¿El "Proyecto financia a otro" (préstamos entre proyectos) debe registrarse como movimiento, o basta una vista que compare saldos?

Archivos relevantes (solo lectura): `app-demo/app/(app)/ayf/consolidado/actions.ts`, `app-demo/supabase/migrations/20261017000000_ayf_pagos.sql`, `app-demo/supabase/migrations/20261016000000_ayf_terceros.sql`.
