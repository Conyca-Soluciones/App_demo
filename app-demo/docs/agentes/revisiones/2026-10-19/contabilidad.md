# Revisión — Contabilidad (usuario "Contabilidad", proyecto Estuario Casa)
Método: app en navegador (localhost:3000, panel de unos 570 px que ya muestra tarjetas, más 375 px; terminé en desktop) y lectura puntual de `app-demo/supabase/migrations/20261017000000_ayf_pagos.sql` para ver qué datos guarda el pago. Sesión estable todo el tiempo.  ·  Alcance: Inicio, menú lateral (AdPro y A&F), A&F › Pagos › Consolidado (filtros, tarjetas, filtro Estado), A&F › Terceros (lista, búsqueda, ficha "Ver" de dos terceros), acceso directo por URL a Aprobación de pagos.

No pude probar: nada de guardar, porque mi rol es solo de ver. En el consolidado la columna "Acciones" sale vacía y en Terceros no hay "Nuevo tercero" ni "Agregar cuenta"; los campos de la ficha están bloqueados. Eso es correcto para mi rol. Tampoco pude probar liquidar, exportar, conciliar ni ver soportes, porque no existen en pantalla. No descargué nada, porque no hay botón de descarga. Lo ya confirmado en otras revisiones no lo repito (total que suma anulados, sin fechas ni filtro de proyecto, "Sin tercero" en actas, "NIT" en personas naturales, sin soportes visibles). Me afecta todo: lo uso como base de mi trabajo.

## Resumen (máx. 5 líneas)
Hoy la app me deja ver una lista de pagos aprobados con tercero y cuenta, pero no me deja hacer mi trabajo: no hay soportes, ni liquidación, ni exportación para mi software contable, ni conciliación. La información tributaria del tercero casi no existe (solo documento, nombre, banco y cuenta). Lo que más importa:
1. No puedo liquidar: faltan RUT, régimen y responsabilidades del tercero, y no hay dónde calcular retenciones ni guardar el valor neto.
2. El "Valor" del pago no dice qué incluye (IVA, descuentos). En actas ya trae descuentos que el director escribe a mano.
3. No hay salida para mi software contable ni forma de conciliar contra el extracto.

## Escenarios probados
| Escenario | Resultado | Nota |
|---|---|---|
| 1. Abrir el consolidado de la semana y liquidar 5 pagos de distinto tipo | No existe aún (liquidar). Ver el consolidado: Logrado con fricción | La semana 43 sale vacía ("Ningún pago coincide"). Tuve que borrar la semana y consultar para ver 4 pagos: 2 actas, 1 OC aprobada, 1 OC anulada. No vi ninguno de factura de proveedor con soporte, cuenta de cobro de contratista, nómina ni servicio público. Solo OC y actas. |
| 2. Encontrar un pago con soporte faltante y devolverlo con observación | No existe aún | No hay soportes en el pago ni botón de devolver. Lo único parecido es la "Novedad", y solo avisa de tercero o cuenta. |
| 3. Verificar que el tercero está completo para liquidar | Bloqueado | La ficha solo tiene razón social, nombre para el banco, observaciones y cuentas. No hay RUT, régimen, responsabilidades, ciudad (para ICA), correo ni documentos. |
| 4. Exportar lo liquidado para el software contable | No existe aún | No hay botón de exportar en Consolidado ni en Terceros. |
| 5. Conciliar los pagos de un día contra el extracto | No existe aún | No hay fecha de pago, ni estado "pagado", ni pantalla de extracto o conciliación. |
| 375 px | Logrado con fricción | Sin desborde horizontal (ancho 375 = pantalla). El panel de filtros abre desplegado y deja los resultados en una franja angosta. |

## Falta
- [P1] Liquidación (retenciones y valor neto a pagar) — Evidencia: en Consolidado no hay botón ni columna de retefuente, reteIVA, reteICA ni neto. En el SQL, `pagos.valor` es "con IVA, antes de retenciones" y no hay columnas de retención ni de valor neto. Está en el roadmap como "planeado". — Impacto: es mi trabajo central y hoy sigo liquidando fuera de la app. Lo mínimo que necesito: base, tarifa y valor de cada retención por pago, valor neto, quién liquidó y cuándo.
- [P1] Datos tributarios del tercero — Evidencia: ficha de ACCESORIOS MODULARES y de ACOSTA GUEVARA: solo razón social, nombre para el banco, observaciones y cuentas. — Impacto: sin RUT adjunto, régimen (simple, ordinario, gran contribuyente, autorretenedor, no responsable de IVA), responsabilidades, actividad económica y ciudad (ICA), no puedo calcular retenciones bien. Suposición: eso vive hoy en mi software contable; la app debería al menos tener el RUT y la fecha de actualización.
- [P1] Soportes del pago — Evidencia: tarjetas del consolidado sin ningún soporte, ni indicación de si falta o si es factura electrónica; el pago guarda `numero_factura` pero no se muestra. — Impacto: no puedo cumplir mi parte ante la DIAN y la revisoría ("todo pago con soporte"). En actas el soporte sí se sube al crearla (la factura es obligatoria), pero yo no lo veo desde el pago.
- [P1] Exportar el consolidado y lo liquidado — Evidencia: no hay botón de descarga. — Impacto: tengo que digitar a mano en el software contable. Necesito Excel o CSV con: ITEM, fecha, proyecto, empresa, tercero con documento, concepto, número de factura, base, retenciones, neto, banco y cuenta.
- [P1] Estado "pagado" y conciliación — Evidencia: el filtro Estado ofrece Aprobado, Liquidado, En dispersión, Pagado y Anulado, pero ninguna acción de la app lleva un pago a esos estados (consulté "Liquidado" y no salió nada), y no hay fecha de pago. — Impacto: no puedo cruzar lo pagado con el extracto. Necesito fecha de pago, banco y cuenta de origen y referencia del comprobante.
- [P2] Mecanismo de devolución con observación — Evidencia: no hay botón ni campo. — Impacto: hoy un pago con soporte malo llega igual a mi bandeja. Propuesta: "devolver al origen" con motivo, que le llegue a quien lo originó y que el pago vuelva a "con novedad".
- [P2] Nómina y servicios públicos — Evidencia: los únicos orígenes que veo son OC y actas (SQL: `fuente` solo 'orden_compra' en la migración leída; las actas las agregó otra migración). — Impacto: dos de mis cinco tipos de pago no existen en la app. RRHH está en el roadmap como planeado, y servicios públicos no aparece en ninguna parte (pregunta abajo).
- [P2] Anticipos y amortizaciones — Evidencia: en las tarjetas de actas el concepto dice "ACTA N° 1" y "ACTA FINAL N° 2", pero el valor mostrado no dice cuánto es bruto, cuánto se amortizó de anticipo ni cuánto se retuvo en garantía. — Impacto: tengo que abrir otra pantalla (Actas, que no es mía) para entender el valor. Propuesta: mostrar bruto, amortización, retención y neto del acta dentro del pago.
- [P2] Empresas del conglomerado — Evidencia: cada tarjeta dice "ITEM n · Conyca Soluciones SAS", pero no hay filtro por empresa; el filtro "Consolidado" está en Todos. — Impacto: cuando haya más de una empresa, mi contabilidad se mezcla. Hoy solo veo una empresa, así que es riesgo futuro.

## Mejorar
- [P1] Una sola definición clara de "Valor" — Evidencia: el SQL dice que el valor es con IVA y antes de retenciones, pero la pantalla solo dice "Valor". En actas, el pago nace del neto del acta, que ya descontó anticipo, retención en garantía y "otros descuentos" que escribe el director (la propia documentación del proyecto cita retefuente e ICA como ejemplo). — Propuesta: mostrar al lado del valor "bruto / descuentos del acta / valor del pago", y que las retenciones de ley las calcule solo Contabilidad, no el director. Si el director ya descontó retefuente a mano, yo la descontaría dos veces.
- [P1] Numeración de ITEM con saltos — Evidencia: los ITEM visibles son 1, 2, 4 y 6; faltan el 3 y el 5. Con el filtro por estado no los vi (probablemente rechazados o de otro consolidado, suposición). — Propuesta: que se pueda ver por qué falta cada número; para un auditor un consecutivo con huecos sin explicación es una pregunta.
- [P2] Nombre del tercero lleva datos tributarios como texto — Evidencia: razones sociales con "ZOMAC" (CEMENTO DEL ORIENTE S.A.S. ZOMAC, CASAIN SAS ZOMAC, CIBER TRON SAS ZOMAC, ALUMUEBLES JJM S A S ZOMAC...) y "EN REORGANIZACION" (ALFAGRES SA, BAMOCOL SA). — Propuesta: campos aparte para régimen especial (ZOMAC afecta tarifas de renta) y para si está en reorganización. Suposición: el nombre se copió del RUT o de la factura.
- [P2] Terceros "Sin cuentas" en lista corta de búsqueda — Evidencia: ACEROS DEL CARIBE, ACOSTA GUEVARA, ACOSTA REY, ALBA FUENTES, CEMENTO DEL ORIENTE, ASOCIACION DE VOLQUETEROS DEL VALLE DEL GUAMUEZ aparecen sin cuentas (la ficha dice "no se le puede pagar por transferencia"). — Propuesta: avisar a Compras o Tesorería antes de que ese tercero llegue a un pago; hoy solo se ve cuando ya está en el consolidado.
- [P2] La ficha del tercero tarda en abrir (unos 2 segundos, a veces hay que repetir el clic) — Evidencia: "Ver" en Terceros desde el panel de 570 px. — Propuesta: mostrar un indicador de carga; parece que no pasó nada.
- [P3] Semana por omisión vacía — Evidencia: al entrar y pulsar Consultar con "2026 / 43" sale "Ningún pago coincide". — Propuesta: si la semana actual no tiene nada, mostrar la última con pagos o un mensaje que sugiera quitar el filtro de semana.
- [P3] En 375 px el panel de filtros abre desplegado y deja los resultados casi sin ancho — Evidencia: /ayf/consolidado en 375 px. — Propuesta: abrir plegado en pantallas angostas.

## Sobra o es demasiado complejo
- El módulo AdPro aparece en el menú y dice "Próximamente: este módulo todavía no tiene herramientas" para mi rol. Es un clic más y confunde. No me aporta.
- "Nombre para el banco" cortado a 20 caracteres en la ficha (ya lo vio Tesorería): para mí es ruido. Lo que me importa es la razón social completa como sale en el RUT.
- La pantalla "Aprobados sin ITEM (empresa sin consolidado)" es de Tesorería; para Contabilidad no aporta nada.

## Traspasos con otros roles
- Tesorería → Contabilidad: llega una lista de pagos aprobados sin marca de "soportes revisados por Tesorería". Propongo un estado "confirmado por Tesorería" antes de que yo liquide, y que los pagos con "Novedad" (sin tercero, sin cuenta) no lleguen a mi bandeja hasta resolverla.
- Director de obra → Contabilidad (actas): las actas de CJ-17 llegan sin tercero, con valor neto que ya incluye descuentos. Necesito que el contratista del contrato pase solo al pago y ver el desglose (bruto, anticipo, garantía, otros) con el soporte.
- Compras → Contabilidad (OC): la OC trae la factura que Compras adjunta; yo no la veo desde el pago. Necesito factura, número y verificar si es electrónica.
- Contabilidad → Tesorería: cuando exista "liquidado", el dispersor debe usar el neto, no el valor aprobado. Hay que dejar claro cuál valor lleva el archivo bancario.
- Contabilidad → software contable: no hay salida. Sin exportación, el trabajo se rehace a mano.
- Gerencia → Contabilidad: Gerencia aprueba pagos con un solo valor; si luego yo liquido y el neto cambia (retenciones), hay que dejar visible bruto y neto para que no parezca que se pagó menos de lo aprobado.

## Riesgos de control
- Descuento doble o faltante de retenciones — Se daría si el director escribe retefuente o ICA como "otros descuentos" en el acta (la documentación lo menciona como ejemplo) y yo vuelvo a liquidar al revisar el pago; o al revés, que nadie las calcule.
- Pago liberado sin soporte — El pago se aprueba y entra al consolidado aunque Contabilidad no haya visto el soporte; el control real (revisión previa a la dispersión) hoy no se ve en la app.
- Terceros sin RUT ni datos tributarios — Se podría pagar a un tercero con régimen, tarifa o actividad desactualizados, sin que quede registro de qué documento se usó.
- Tercero de persona natural con "NIT" (ya reportado) — Afecta tarifas de retefuente por tipo de persona; si el tipo de documento define la retención, se liquidaría mal.
- Datos de producción mezclados — El total y la lista mezclan actas "(PRUEBA)" de CJ-17 con una OC real (45) y una anulada; si alguien exporta o concilia desde esto, contamina la contabilidad.
- Visibilidad de pagos de otros proyectos — Tengo asignado solo Estuario Casa, y el consolidado no tiene filtro de proyecto; hoy todos los pagos visibles son del 100-PP-CTG-LOTE68, así que no pude confirmar si veo los de otros.
- Aprobación de pagos protegida — Sí hay control: entrar por URL a /ayf/aprobacion-pagos me redirigió a Inicio con "no autorizado". La acción de editar o verificar no aparece para mi rol.

## Preguntas para Luis
- ¿Qué datos tributarios mínimos del tercero necesitas que quede en la app (RUT adjunto y fecha, régimen, responsabilidades, ciudad para ICA, autorretenedor)? ¿Hoy los llevas en tu software contable?
- ¿Qué software contable usas y qué columnas o formato pide para importar (Excel, CSV, plano)? ¿Tienes un ejemplo de archivo?
- ¿Las retenciones las calcula Contabilidad pagando por pago, o hay reglas por tercero y concepto que puedan sugerirse automáticamente?
- ¿Las actas deben mostrar retefuente e ICA que descuenta el director, o eso debe quedar solo en Contabilidad?
- ¿Cómo manejas hoy nómina y servicios públicos: entran como pago por la app o los liquidas por fuera? ¿Quién origina el servicio público?
- ¿Cuál es el extracto bancario que concilias (PDF, Excel del banco) y con qué frecuencia?
- ¿Los ITEM 3 y 5 de la semana (huecos en la numeración) son pagos rechazados o de otra empresa?
- ¿La factura electrónica (CUFE) debería validarse en la app o solo adjuntarse?
