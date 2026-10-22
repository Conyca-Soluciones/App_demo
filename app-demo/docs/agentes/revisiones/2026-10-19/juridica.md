# Revisión — Jurídica
Método: app en navegador (usuario "Juridica", proyecto Estuario Casa) más lectura puntual de código y migraciones para confirmar reglas que la pantalla no muestra  ·  Alcance: Contratistas, Contratos por grupos, Contratos generales, Pre aprobación (solicitud N° 18 y las aprobadas N° 14, 17 y 19, con su pestaña Minuta en solo lectura), Actas por grupos (CJ-17), Informes, notificaciones y vista a 375 px.

Qué NO pude probar sin guardar (producción): devolver con observación, pre-aprobar, editar y guardar una minuta pendiente, y el historial de cambios de la minuta. Tampoco hay ninguna solicitud de mano de obra "por revisar": la única pendiente es la N° 18, que es un contrato general. Por eso la edición de minuta solo la vi en solo lectura (CJ-17 aprobada). El PDF de la hoja de la N° 18 sí se generó (tarda unos 15 s). No descargué ningún archivo. Se restauró el viewport a desktop.

## Resumen (máx. 5 líneas)
La app ya me da una cola de revisión clara, minutas con plantilla por tipo y un historial de quién hizo qué. Pero revisar es leer a ojo: no hay checklist, no hay fechas de vigencia de los documentos del contratista, y el sistema deja pre-aprobar una minuta con campos "Falta" sin llenar (CJ-17 llegó aprobada con esas rayas). Lo que más importa:
1. Vigencia de documentos, pólizas y alertas: no existen.
2. Nada impide pre-aprobar una minuta incompleta.
3. Otrosí no existe, aunque la app ya lo menciona.

## Escenarios probados
| Escenario | Resultado | Nota |
|---|---|---|
| 1. Revisar solicitud nueva, detectar documento faltante y devolver con observación | Logrado con fricción (parcial) | Vi la N° 18 y el cuadro de Devolver (motivo obligatorio, texto libre), pero no devolví. La N° 18 (general) no muestra ningún documento del contratista, así que no puedo detectar faltantes ahí. |
| 2. Ajustar minuta y aprobar | Bloqueado (para probar) | No hay solicitud pendiente con minuta. En CJ-17 vi el editor con origen por colores (Plantilla / Solicitud / Falta). Los contratos generales no tienen pestaña Minuta, solo "Hoja en PDF". |
| 3. Otrosí que aumenta valor | No existe aún | No hay botón ni pantalla. El aviso del contrato vencido CJ-19 dice "hará falta un otrosí". El roadmap lo lista como faltante. |
| 4. Contratistas con documentos por vencer | No existe aún | Los documentos solo muestran "Adjunto" y la insignia "6/6" o "4/4". No hay fecha de vigencia ni alerta. El roadmap lo lista como faltante. |
| 5. Acta parcial de contrato no aprobado | Logrado (la app lo impide) | Actas por grupos solo lista los 3 contratos aprobados; la N° 18 no aparece. La regla está también en la base: "Solo se hacen actas de contratos con la minuta aprobada por Subgerencia" (`supabase/migrations/20261112000000_actas_sobre_contrato.sql`, línea 375). Jurídica además solo ve actas, no las crea. Los contratos generales aún no tienen actas (roadmap). |

## Falta
- [P1] Vigencia de los documentos del contratista — Evidencia: contratistas > Construcciones Andinas y Carlos Andrés: cada documento solo tiene archivo y "Ver"; en la solicitud N° 17 el estado es "Adjunto". No hay fecha de expedición ni de vencimiento. — Impacto: no puedo saber si la planilla de seguridad social o el certificado de alturas están vigentes hoy, ni si se vencen en medio del contrato. El roadmap ya planea las alertas; falta que se guarden las fechas y que el contrato deje de depender de la memoria de alguien.
- [P1] Pólizas y garantías — Evidencia: ni el contratista ni la solicitud ni la minuta tienen dónde registrar póliza (número, aseguradora, vigencia). La minuta solo trae "Póliza de cumplimiento (% del valor)" como porcentaje. — Impacto: nada respalda que la póliza exista o esté vigente; es justo lo que Jurídica debe exigir antes de firmar.
- [P1] Validación antes de pre-aprobar — Evidencia: CJ-17 y CJ-19 llegaron a "Aprobado por Subgerencia" con la minuta con campos "Falta" en blanco: representante legal y cédula de CONYCA, "cédula expedida en" del contratista, y plazos de corrección de actividades que en el PDF salen como "__________". La advertencia "Falta llenarlo" es solo informativa; en el código de pre-aprobación no hay una validación server-side de esos campos. (Es dato de prueba, pero la regla igual no existe.) — Impacto: un contrato puede quedar firmado con espacios en blanco.
- [P1] Otrosí (prórroga, adición, ampliación de valor) — Evidencia: no existe en la app; CJ-19 vencido muestra un aviso que lo menciona y CJ-17 ya está liquidado. — Impacto: hoy cualquier cambio posterior iría por fuera de la app y no quedaría conectado al contrato original. El roadmap lo marca como faltante; hay que priorizarlo porque el valor y el plazo del contrato son decisiones legales.
- [P2] Comparación entre minuta inicial y final — Evidencia: en la pestaña Minuta solo hay "Guardada el 14/10/2026"; el historial solo registra "Pre-aprobada" y "Minuta enviada/aprobada". Sin migración ni tabla de versiones de minuta (se buscó). — Impacto: no puedo decir qué cambié respecto de la plantilla, ni qué cambió Subgerencia, ni se ve el motivo si luego hay una disputa.
- [P2] Qué documentos son obligatorios por tipo de contrato — Evidencia: en la solicitud N° 17 salen "Certificado de trabajo en alturas (si aplica)" y "Certificado de capacitación… (si aplica)" sin decir cuándo aplican. La solicitud N° 18 (servicios, persona natural) no muestra documentos. Los contratistas naturales no tienen "Consulta de Oficial de Cumplimiento" y los jurídicos sí. — Impacto: reviso a criterio propio cada vez y devuelvo solicitudes por cosas que el director no sabía que debía subir.
- [P2] Avisarme cuando llega una solicitud — Evidencia: la solicitud N° 18 lleva pendiente desde el 14/10 y la campana está vacía ("No tienes notificaciones"). — Impacto: depender de que el director me escriba por WhatsApp, justo lo que la app quiere reemplazar.
- [P3] Plantillas por tipo de contrato: la app ya trae 6 en PDF (mano de obra, obra, servicios, suministro, arrendamiento, vehículo), así que esa parte NO falta. Lo que no vi es dónde se edita la plantilla base (cláusulas "de la plantilla (18) — texto fijo"); si cambia un texto legal, hay que pedirlo a TI.

## Mejorar
- [P1] Quién es el solicitante — Evidencia: "Solicitado por —" en todas las tarjetas y en el detalle (N° 14, 17, 18, 19). El historial dice "Gestion ti" para todo. — Propuesta: mostrar el nombre del director que pidió y quién pre-aprobó (con rol). Si esto es solo por datos de prueba cargados con un usuario técnico, confirmar que con usuarios reales sí se llena. Sin esto no puedo "saber quién aprobó qué".
- [P2] Devolver con observación más útil — Evidencia: el cuadro de Devolver exige motivo (bien) pero es un solo texto libre, sin lista de causas ni marcar el campo o documento concreto. — Propuesta: lista corta de causas habituales ("Falta documento: …", "Valor no coincide…") y poder señalar el documento, para que el director no tenga que adivinar y devolverla varias veces.
- [P2] Contratos generales, ver lo mismo que en los de grupos — Evidencia: el detalle de la N° 18 no trae documentos del contratista ni documentos del contrato; trae "Retenciones: garantías 0 % · anticipo 0 % · FIC 0 %" y "Referencia 4" sin explicación. Tampoco se ve a quién se pagaría (datos bancarios) ni si el servicio es de una persona natural con seguridad social. — Propuesta: mostrar los mismos bloques de documentos y un aviso si el contrato es de más de cierto valor y garantías están en 0 %.
- [P2] Número de contrato en el buscador de actas — Evidencia: Actas por grupos, buscar "CJ" no devuelve nada aunque el placeholder dice "número de contrato u objeto"; buscar "Ejecutar" sí devuelve los tres. — Propuesta: que busque también por CJ-17 (no probé "CJ-17" completo; puede ser solo el prefijo).
- [P3] Cuando se edita un contratista queda "Última edición" pero no qué se cambió ni quién (visto en Carlos Andrés, "rut-actualizado-prueba.pdf"). En el código, subir un documento nuevo "reemplaza al anterior" (`20261109100000_editar_contratista.sql`): inferencia mía, que el anterior ya no se consulta.
- [P3] Cuenta bancaria del contratista visible sin diferenciar. Existe el permiso "Ver datos bancarios" y lo tengo; está bien, pero conviene que quede registro de quién la vio (ver Riesgos).
- [P3] En celular (375 px) la pre-aprobación se lee y no hay scroll lateral; el título del detalle choca un poco con la X de cerrar. Menor.

## Sobra o es demasiado complejo
- Ítem de menú "Informes" — Por qué: apunta a la página de inicio y en el código dice "Todavía sin página". Un menú que no lleva a nada confunde; ocultarlo hasta que exista (la ruta /contratos/informes da 404).
- Dos pantallas para lo mismo con nombres parecidos ("Contratos por grupos" y "Contratos generales" en el menú de Jurídica) — Por qué: yo no creo solicitudes, solo reviso desde Pre aprobación. Si mi permiso es solo lectura, son vistas duplicadas de lo que ya veo en Pre aprobación (filtro "Todas"). Duda: pueden ser útiles para ver el estado, pero no aportaron datos nuevos.
- Dos filtros que cubren casi lo mismo: "Aprobados" y "En Subgerencia" para la pre-aprobación; no sobra, pero el estado "Aprobada" (pre-aprobada) y "Aprobado por Subgerencia" se pueden confundir en el listado.
- Para contratos generales, la "Hoja en PDF" tarda ~15 s en cargar la vista previa y se llama "hoja", no "minuta": parece que no existe minuta para generales (confirmar con Luis).

## Traspasos con otros roles
- Director de obra → Jurídica: llega la solicitud sin que yo sepa qué documentos faltaban por obligación; solo veo "Adjunto". Propongo checklist por tipo de contrato que el director vea y complete antes de enviar (y que la app no deje enviar si falta uno obligatorio).
- Jurídica → Subgerencia: envío la minuta guardada. Si hay campos "Falta", Subgerencia la aprueba igual (como CJ-17). Propongo que pre-aprobar bloquee o al menos pida confirmación explícita cuando queden "Falta".
- Jurídica → Director/Contratos (actas): CJ-17 muestra Acta 1 (01/10–15/10) y Acta 2 "final" (10/10–31/10) con períodos que se cruzan y la liquidación en $0. Es dato de prueba, pero la base solo valida que el fin no sea antes del inicio; no vi validación de traslape. Propongo avisar si se cruza un período, o ver si es intencional.
- Jurídica ← Director (contratistas): el contratista tiene un correo de notificación distinto en su ficha (juridica1@ejemplo.test) y en la solicitud/minuta (prueba@ejemplo.test). No sé cuál es el válido para notificaciones legales; la app debería indicar cuál prevalece.
- Jurídica → Gerencia/Pagos: la regla de no pagar actas de contratos no aprobados ya está protegida (escenario 5). Falta la misma protección cuando el contrato vence o queda sin póliza/seguridad social vigente.

## Riesgos de control
- Contratos con campos vacíos aprobados por Subgerencia (CJ-17 y CJ-19 con "Falta") — cualquier minuta se puede pre-aprobar con datos del contratante o plazos sin llenar.
- Solicitante y aprobador "—" / "Gestion ti" — no se puede rastrear quién pidió ni quién aprobó, y si todo lo carga un usuario técnico no hay responsabilidad individual (puede ser solo por datos de prueba).
- Sin versionado de minuta — se puede cambiar el texto del contrato entre pre-aprobación y firma sin dejar huella de qué cambió, salvo la fecha "Guardada el".
- Documentos del contratista reemplazables y sin historial (inferencia por código): se puede sustituir un RUT o un certificado y perder el anterior sin saber cuándo y por quién.
- Sin vigencia/pólizas, un contrato puede seguir recibiendo actas con seguridad social o póliza vencidas; solo se bloquea por vencimiento del plazo del contrato.
- Datos bancarios: tengo permiso "Ver datos bancarios" y vi banco y cuenta del contratista; no hay registro visible de quién consultó esos datos. Riesgo de fuga más que de fraude.

## Preguntas para Luis
- ¿Para un contrato general (servicios, suministro, etc.) Jurídica debe revisar una minuta, o solo la "hoja"? Hoy los generales no tienen pestaña Minuta.
- ¿Qué documentos son realmente obligatorios por tipo de contratista y de contrato (seguridad social, alturas, póliza, oficial de cumplimiento para personas naturales)? Así se puede armar el checklist.
- ¿Quién debe poder aprobar con campos "Falta" en blanco: nadie, o Jurídica con una justificación escrita?
- ¿"Solicitado por —" y el actor "Gestion ti" son solo por datos de prueba?
- ¿Un otrosí lo aprueba Jurídica sola, o pasa también por Subgerencia como el contrato original?
- ¿Cuántos días antes del vencimiento quieres la alerta de documentos (15, 30)?

Rutas relevantes: `app-demo/components/preaprobacion-contratos-view.tsx`, `app-demo/components/detalle-solicitud-contrato.tsx`, `app-demo/lib/pestanas.ts` (Informes sin página), `app-demo/supabase/migrations/20261112000000_actas_sobre_contrato.sql`.
