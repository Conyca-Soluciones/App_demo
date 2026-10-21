# Revisión — Tesorería (usuario "Financiera", proyecto Estuario Casa)
Método: app en navegador (localhost:3000) más lectura puntual de la migración `app-demo/supabase/migrations/20261017000000_ayf_pagos.sql` para confirmar estados y reglas. Probé en el ancho del panel (unos 570 px, que ya muestra la vista en tarjetas) y en 375 px, y terminé en desktop. Sesión estable.  ·  Alcance: Inicio, notificaciones, A&F › Consolidado de pagos (filtros, tarjetas, diálogo "Tercero y cuenta del pago"), A&F › Terceros (lista, filtros, "Ver", "Agregar cuenta", "Nuevo tercero").

No pude probar sin guardar: elegir otro tercero o cuenta para un pago, verificar o inactivar cuentas, crear terceros, y cualquier validación que solo salga al pulsar Guardar o Crear. Cerré todos los diálogos con Cancelar o con la X. No hay descargas que probar: el consolidado no tiene exportar. Pude repetir, y por eso no repito, lo que ya dice `financiera.md` (cifras del consolidado, total que suma anulados, "Sin tercero" en pagos de actas).

## Resumen (máx. 5 líneas)
Hoy la app me sirve para ver los pagos ya aprobados y asignarles tercero y cuenta. De mi trabajo real (confirmar soportes, armar el consolidado para Contabilidad, dispersores, ejecutar y marcar pagado) solo existe una parte pequeña. Lo que más importa:
1. No veo ningún soporte en el pago, ni una confirmación mía. Una vez aprobado, el pago ya tiene ITEM y queda en el consolidado.
2. No puedo marcar un pago como rechazado por el banco ni reprogramarlo. Tampoco veo a quién va a salir la plata por banco.
3. Los datos del tercero son escasos para pagar sin errores: sin titular de la cuenta, sin certificación bancaria, sin contacto.

## Escenarios probados
| Escenario | Resultado | Nota |
|---|---|---|
| 1. Tomar los pagos aprobados de la semana, revisar soportes y armar el consolidado | Logrado con fricción (parcial) | La app arma el consolidado y numera el ITEM sola al aprobar. No hay soportes ni botón de "confirmar" que sea mío. Tengo que quitar la semana y pulsar "Consultar" para ver algo (semana 43 sale vacía). |
| 2. Liquidación de Contabilidad y dispersores (Bancolombia y Banco de Bogotá) | No existe aún | El modelo prevé "liquidado", "en_dispersion" y "dispersado" ("migración futura", según el comentario del SQL). Ninguna pantalla lo muestra. No hay filtro de banco en el consolidado. |
| 3. Registrar pago rechazado por el banco y reprogramarlo | No existe aún | El estado "rechazado" del sistema es el de Gerencia, no el del banco. El modelo no tiene un estado "devuelto por el banco". La "novedad" sirve solo para faltantes previos al pago. |
| 4. Meter en un consolidado un pago ya pagado | Logrado (por diseño, solo para OC) | Leído en SQL, no probado en pantalla: hay un índice único que impide dos pagos vivos del mismo tipo para una misma OC, y el ITEM no se repite. Para actas no vi la regla equivalente (la migración limita `fuente` a 'orden_compra'; asumo que otra migración la amplió). No hay ningún estado "pagado" real aún, así que el riesgo de doble pago hoy depende de Excel. |
| 5. Resumen de lo pagado en un rango de fechas, por proyecto y por tercero | No existe aún | El consolidado solo filtra por año y semana. No tiene fechas, rango, filtro de proyecto ni totales por proyecto o tercero. Además mide "aprobado", no "pagado". |
| Ver tercero y "Agregar cuenta" (sin guardar) | Logrado | La cuenta pide banco, tipo, número y etiqueta opcional. |
| 375 px | Logrado con fricción | Ver "Mejorar". |

## Falta
- [P1] Estado real del pago frente al banco: "pagado" y "rechazado por el banco" — Evidencia: el SQL define `dispersado` ("el dinero salió") pero ninguna pantalla lo usa; el consolidado solo lista aprobados — Impacto: es el riesgo que más me preocupa (marcar como pagado lo que el banco rechazó, o no saber qué quedó pendiente al cierre del día). Propuesta: estados "en dispersión", "pagado", "devuelto por el banco" (con motivo) y "reprogramado", visibles en el consolidado.
- [P1] Soportes visibles y confirmación de Tesorería — Evidencia: en las tarjetas del consolidado y en el diálogo del pago no aparece ningún soporte (factura, cuenta de cobro) ni indicación de si falta o es ilegible. Solo "Novedad" para tercero y cuenta — Impacto: no puedo cumplir "revisar y confirmar pagos y soportes". Hoy el pago aprobado con soporte faltante igual llega a Contabilidad. Propuesta: lista de soportes en el pago, marca "soporte completo / devolver al origen con motivo".
- [P1] Generación del dispersor por banco (Bancolombia y Banco de Bogotá) — Evidencia: no hay pantalla de lotes. Sí está en el roadmap ("archivos de dispersión bancaria") — Impacto: sigo armando los archivos a mano. Lo que necesito de la app: elegir el banco y la empresa pagadora, ver el total del lote y descargar el archivo en el formato del portal. No pido hablar con el banco desde la app.
- [P1] Empresa y cuenta desde donde se paga — Evidencia: cada pago muestra "ITEM n · Conyca Soluciones SAS" como consolidado, pero no la cuenta bancaria de la empresa de la que sale. Las cuentas de la empresa solo existen en la base de datos (según el informe de Financiera) — Impacto: error de dinero (pagar desde la cuenta equivocada). Propuesta: al armar el dispersor, elegir la cuenta de la empresa y que la app avise si el tercero es de otro banco (costo por transferencia entre bancos).
- [P2] Titular de la cuenta del tercero — Evidencia: el formulario de cuenta (diálogo "Agregar cuenta") pide banco, tipo, número y etiqueta. No pide titular ni documento del titular. En "Nuevo tercero" hay "Nombre para el banco" opcional (el existente aparece cortado a 20 caracteres: "ACCESORIOS MODULARES PARA LA C") — Impacto: pagar a una cuenta de un tercero distinto es un fraude clásico y el banco lo valida contra el documento. Propuesta: titular y documento del titular, que se verifiquen contra la certificación bancaria.
- [P2] Certificación bancaria del tercero — Evidencia: ni "Ver" tercero ni "Agregar cuenta" tienen dónde adjuntarla. La verificación de cuenta quedó solo con "Verificada por Luis Perez el 14/08/2026" — Impacto: no hay evidencia de en qué se basó la verificación. Suposición: Luis la hace con un documento aparte.
- [P2] Vista de "qué se pagó, qué quedó pendiente y por qué" al final del día — Evidencia: el consolidado solo filtra por estado/novedad/semana; no hay fecha de pago ni resumen — Impacto: lo armo en Excel todos los días.

## Mejorar
- [P1] Consolidado sin totales por banco, por empresa ni por estado — Evidencia: solo "4 pagos en esta página · Total de la página" (ya confirmado que incluye el anulado) — Propuesta: totales por banco/empresa y por estado; así sé cuánto debo tener en cada cuenta antes de pagar.
- [P1] Pagos de actas "Sin tercero" quedan en el consolidado como aprobados — Evidencia: ITEM 1 y 2 (CJ-17) con "Aprobado", cuenta "—" y novedad "No hay un tercero registrado para este pago." — Propuesta: que no puedan salir a Contabilidad ni al dispersor mientras tengan novedad. Hoy el pago de acta, que es el de mano de obra, se queda sin dueño hasta que alguien lo asigne en el diálogo "Tercero". Pregunta abierta: ¿debería heredar el contratista del contrato?
- [P2] Filtro "Estado de las cuentas" en Terceros incompleto — Evidencia: opciones: Todos / pendientes de verificar / verificadas / inactivas. No hay "sin cuentas", y en la lista aparecen muchos con "Sin cuentas" (A.M.Q, Aceros del Caribe, Acosta Guevara, Acosta Rey, Adoquines, Aercargo, Agroindustriales, AIMCOP, Alba Fuentes, Alejandro Joya...) — Propuesta: agregar "Sin cuentas" para pedirles los datos. Además, al elegir "pendientes de verificar" y consultar, la lista siguió igual (con "Verificada" y "Sin cuentas"); no estoy seguro de que el filtro se haya aplicado. Sospecha, a confirmar.
- [P2] La lista de terceros mezcla personas con "NIT" — Evidencia: "ACOSTA GUEVARA LUIS DIONEL — NIT 1.118.565.706-5" (también Acosta Rey y Alba Fuentes), contra "CC" en otras personas naturales — Propuesta: revisar el tipo de documento; es dato para Contabilidad (retenciones) y para el archivo bancario.
- [P2] Dos ruedas para el mismo dato — Evidencia: el diálogo "Tercero y cuenta del pago" y la ficha del tercero muestran la misma cuenta, pero la ficha dice "Verificada por... el..." y el diálogo no — Propuesta: mostrar en el diálogo quién verificó la cuenta y cuándo, para decidir con confianza.
- [P3] En 375 px el panel de filtros se abre por defecto y deja los resultados en una franja angosta a la derecha — Evidencia: /ayf/consolidado en 375 px; al plegarlo, las tarjetas se ven bien — Propuesta: filtros plegados por defecto en pantallas angostas. Sin desborde horizontal (ancho de página igual a la pantalla).
- [P3] Cerrar diálogos con Escape tarda o no responde a la primera — Evidencia: Escape no cerró "Ver tercero" ni "Nuevo tercero" de inmediato; la X y "Cancelar" sí.

## Sobra o es demasiado complejo
- El diálogo "Tercero y cuenta del pago" deja cambiar tercero y cuenta de un pago ya aprobado, con un botón "Guardar" sin motivo ni confirmación. Para mi trabajo (el último paso antes de que salga la plata) sobra la libertad: lo que yo necesito es corregir la cuenta con una razón escrita, no reasignar a otro tercero sin dejar rastro.
- Notificaciones: la campana dice "No tienes notificaciones". Sin avisos de "pago aprobado nuevo" o "pago con novedad", la campana no me sirve todavía. No lo pido como mejora grande; es un aviso sencillo.
- El menú AdPro sin herramientas para mi rol ya está en el informe de Financiera; no lo repito.

## Traspasos con otros roles
- Gerencia → Tesorería: llegan pagos aprobados sin tercero ni cuenta (actas) o con cuenta pendiente. Propongo que Gerencia no pueda aprobar sin tercero, o que quede visible como "aprobado con novedad" hasta resolverlo (hoy ya es así, pero sin bloqueo posterior).
- Origen del pago (director, Compras, RRHH, auxiliar) → Tesorería: los soportes deberían venir adjuntos en el pago y yo verlos. Hoy no los veo.
- Tesorería → Contabilidad: no existe pantalla ni estado "listo para liquidar". El consolidado semanal es la lista, pero no hay marca de "Tesorería ya revisó". Propongo un estado "confirmado por Tesorería" antes de "liquidado".
- Contabilidad → Tesorería: el estado "liquidado" con retenciones y valor final está en el modelo. En el dispersor debo usar el valor neto, no el valor aprobado; asegurar que el lote use siempre el neto.
- Tesorería → Contabilidad (conciliación): al marcar pagado, que quede fecha, banco, cuenta de origen y referencia del comprobante.

## Riesgos de control
- Cambiar tercero/cuenta de un pago aprobado sin motivo ni segunda persona (por quien tenga la acción "Gestionar pagos"), y verificar cuentas con el mismo rol que las crea: en "Nuevo tercero" la propia pantalla dice "Las cuentas nuevas quedan pendientes hasta que Financiera las verifique". Quien crea la cuenta y quien la verifica puede ser el mismo usuario, porque Tesorería y Financiera son un solo rol. Suposición: no probé si la app lo impide.
- Posible doble pago (suposición, no probado): para OC está cubierto con índice único; para actas no vi la regla. Además, sin estado "pagado", Excel es la única defensa.
- Cuenta de un tercero con titular distinto al tercero (no se captura el titular) y sin certificación bancaria adjunta.
- Pagos de cualquier proyecto visibles y editables desde un usuario con un solo proyecto asignado (ya mencionado por Financiera; confirmo que el consolidado trae pagos del proyecto 100-PP-CTG-LOTE68 y de otros sin filtro).
- Datos de producción: el consolidado muestra pagos de prueba (CJ-17 "(PRUEBA)") mezclados con una OC real (45 y 46) en el mismo total.

## Preguntas para Luis
- ¿Quién confirma los soportes hoy: Tesorería o Contabilidad? Si es Contabilidad, ¿para mí basta con ver que existan?
- ¿Qué pasa con un pago rechazado por el banco: se reprograma el mismo pago o se crea otro? Eso decide si hace falta el estado "devuelto".
- ¿Los dos formatos de dispersor (Bancolombia y Banco de Bogotá) se pueden pedir a Contabilidad y a los bancos como muestra, o los tiene Luis?
- ¿Cada empresa del conglomerado paga desde sus propias cuentas? ¿Hay cuenta predeterminada por empresa o por banco?
- ¿Con qué documento se verifica una cuenta (certificación del banco, RUT)? ¿Quién debería poder verificarla: la misma persona que la crea?
- ¿Las personas con "NIT" 1.118.565.706-5 son naturales con RUT? Es dato para el archivo del banco.
- ¿El ITEM debe llevar un máximo por día o semana (según el banco)? Lo pregunto porque el ITEM se numera por consolidado y semana, no por banco.

Archivos relevantes (solo lectura): `app-demo/supabase/migrations/20261017000000_ayf_pagos.sql`, `app-demo/app/(app)/ayf/consolidado/page.tsx`, `app-demo/app/(app)/ayf/terceros`.
