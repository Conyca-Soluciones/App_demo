# Revisión — Recursos Humanos
Método: ambos. App en navegador (usuario "RRHH", Estuario Casa, ancho de panel ~570 px, 375 px y desktop) + lectura de código y migraciones (`lib/pestanas.ts`, `20261016000000_ayf_terceros.sql`, `20261017000000_ayf_pagos.sql`, `20261112000000_actas_sobre_contrato.sql`, `supabase/esquema/01_tablas.sql`) + informes de hoy de Financiera, Tesorería y Contabilidad.  ·  Alcance: Inicio, selección de proyecto, menú lateral (AdPro y A&F), 10 rutas por URL, pantalla "Sin acceso". La sesión no se cayó ni la toqué (no cerré sesión, no cambié clave). No guardé nada ni subí archivos. Lo único que hice fue elegir el proyecto Estuario Casa (cambia la cookie de proyecto actual). Dejé el navegador en desktop.

Marco: lo que sigue a "Qué vi en la app" es lo observado. Todo lo de "Falta", "Propuesta de módulo RRHH" y "Cómo se conecta" son propuestas desde mi cargo, no cosas que existan.

## Resumen (máx. 5 líneas)
Con mi rol la app hoy no me sirve para nada: entro, elijo proyecto y me manda a "Sin acceso: todavía no tienes pestañas asignadas". El módulo de RRHH no existe: no hay empleados, ni nómina, ni seguridad social, ni costo de nómina por obra. Esto es lo que importa:
1. Nada de lo que hago está en la app: ni la base de empleados (empresa, proyecto, cuenta, EPS, fondo) ni las solicitudes de pago de nómina y seguridad social.
2. El motor de pagos de A&F sirve de base (aprobación de Gerencia, ITEM, consolidado, terceros con cuenta verificada), pero hoy solo acepta pagos de OC y actas, y los pagos nacen de a uno. Nómina es masiva (decenas de pagos por quincena).
3. Lo más delicado es el control: salarios y datos personales. Si se conecta mal al consolidado, cualquiera con esa pestaña vería sueldos de todos.

## Qué vi en la app
- **Inicio**: me pide elegir proyecto (solo aparece Estuario Casa). Al elegirlo tardó unos 15 s (la app estaba compilando) y terminó en `/sin-acceso`.
- **Menú lateral** (desde `/inicio`): módulos AdPro y A&F. Los dos dicen "Próximamente: este módulo todavía no tiene herramientas" (para mi rol, aunque A&F sí tiene herramientas para otros roles). No aparece Admin.
- **Rutas por URL**:
  - `/ayf/aprobacion-pagos`, `/ayf/consolidado`, `/ayf/terceros`, `/presupuestos`, `/contratos/contratistas`, `/admin/accesos`, `/admin/visualizacion`: me devuelven a `/inicio?error=no-autorizado` con el aviso "No tienes permiso para abrir esa sección". El control de acceso funciona y no filtra datos.
  - `/empleados`, `/rrhh`, `/ayf/pagos`: 404, no existen.
- **375 px**: sin desborde horizontal (ancho de página = 375). En `/sin-acceso` toqué el botón de menú y no se abrió ningún panel (un solo intento): para un usuario sin pestañas el botón no hace nada visible.
- **Datos de contexto**: la tabla `perfiles` (usuarios de la app) no tiene cédula, cargo, empresa ni salario, y `proyectos` tiene una sola `empresa_id`. No hay ninguna tabla de empleados.

## Escenarios probados
| Escenario | Resultado | Nota |
|---|---|---|
| 1. Registrar empleado nuevo asignado a obra y empresa | No existe aún | No hay pantalla, ruta ni tabla de empleados. |
| 2. Registrar el retiro de un empleado | No existe aún | Tampoco hay historial de ingresos/retiros. |
| 3. Solicitud de pago de nómina de la quincena y de seguridad social | No existe aún | `pagos.fuente` solo admite `orden_compra` y `acta`; mi rol no tiene la pestaña de aprobación ni de consolidado. |
| 4. Ver el costo de nómina de un proyecto | No existe aún | "Control del proyecto" suma solo OC y actas aprobadas; la nómina no entra. Además mi rol no tiene esa pestaña. |
| 5. Qué roles ven datos personales y salarios | Logrado (con lo que hay) | Hoy no hay datos personales de empleados que ver. Lo que sí existe como patrón: datos bancarios de contratistas solo con la acción `ver_datos_bancarios`. |
| Acceso por URL a pantallas ajenas | Logrado | Redirige a Inicio con aviso. |
| 375 px | Logrado con fricción | Sin desborde; el botón de menú no hace nada en "Sin acceso". |

## Falta
- [P1] Base de empleados del conglomerado — Evidencia: sin ruta (404) ni tabla en el esquema; `perfiles` solo guarda cuentas de la app. — Impacto: mi trabajo principal sigue en Excel; no sé en tiempo real quién está activo, en qué empresa ni en qué obra.
- [P1] Solicitud de pago de nómina y de seguridad social — Evidencia: `pagos.fuente` solo `orden_compra` y `acta`. — Impacto: no puedo originar ningún pago desde la app, así que Gerencia, Tesorería y Contabilidad no ven nómina en el consolidado. Contabilidad ya dijo que "dos de sus cinco tipos de pago no existen".
- [P1] Costo de nómina por proyecto — Evidencia: `control_proyecto` solo suma OC y actas aprobadas; un empleado no está ligado a un proyecto con porcentajes. — Impacto: la nómina no se carga a la obra y Gerencia ve un costo del proyecto incompleto.
- [P1] Control de quién ve salarios y datos personales — Evidencia: no existe la pestaña ni la acción. Ojo con el diseño futuro: la RLS de `pagos` deja ver todos los pagos a quien tenga la pestaña de Aprobación o Consolidado (`pagos_select`). — Impacto: si nómina entra como un pago por empleado, Financiera, Tesorería y Contabilidad verían el neto de cada trabajador.
- [P2] Historial de ingresos, retiros y traslados entre obras — Evidencia: no existe. — Impacto: en obra la gente entra y sale cada pocas semanas; sin fechas no se puede cargar el costo a la obra correcta ni calcular liquidación.
- [P2] Alerta de personal que ya es contratista (o al revés) — Evidencia: `contratistas` y `terceros` están separados y comparten documento; no hay nada que avise. — Impacto: riesgo laboral (alguien pagado como contratista que es empleado) y doble pago.
- [P3] Menú sin pestañas: "Sin acceso" no dice qué hacer ni abre el menú. Bajo costo y solo mientras no exista el módulo.

## Propuesta de módulo RRHH (alcance mínimo, 200 empleados)
Todo es propuesta. Lo que sobra: no pido selección, evaluaciones, vacaciones ni portal del empleado.

**1. Empleados** (una sola lista para todas las empresas del conglomerado)
- Datos: tipo y número de documento, nombres, fecha de nacimiento, correo y celular, dirección, cargo, **empresa contratante** (de la tabla `empresas`), tipo de contrato, fecha de ingreso, fecha de retiro y motivo, salario base y auxilios, EPS, fondo de pensiones, ARL, caja de compensación, y cuenta bancaria.
- Estado: activo / retirado. Filtros por empresa, proyecto y estado. Descargar a Excel.
- **Cuenta bancaria**: no duplicarla. Que el empleado sea un `tercero` (documento CC, ya existe ese tipo) y su cuenta use `terceros_cuentas`. Así reuso la verificación de cuenta pendiente a activa que ya hizo Financiera, y se evita pagar a una cuenta cambiada.
- Documentos (contrato, afiliaciones, certificación bancaria): bucket privado, igual que el de contratistas.

**2. Asignaciones a obra** (cuánto vive cada empleado en cada proyecto)
- Una fila por empleado, proyecto, fecha desde y fecha hasta, y porcentaje (cuando está en dos obras). Traslado = cerrar una fila y abrir otra.
- Es lo que permite cargar el costo a la obra correcta. La empresa se toma del contrato del empleado, no del proyecto (un proyecto tiene una sola `empresa_id`; un empleado puede ser de otra empresa del conglomerado).

**3. Solicitudes de pago de RRHH** (cabecera + líneas)
- Tipos: nómina (quincena), seguridad social (PILA), prestaciones/relacionados (primas, cesantías, liquidación final, dotación, etc.).
- **Crear en lote**: un botón "Generar nómina de la quincena" que arma una línea por empleado activo (según salario y asignaciones), me deja editar novedades (horas extra, incapacidades, descuentos, bonos) y la envía a aprobación completa. Hoy A&F crea los pagos de a uno, y esto no se puede hacer así a mano.
- Cada línea lleva empleado, proyecto(s) con porcentaje, concepto y valor. De ahí sale el costo por obra.
- Seguridad social es un solo pago al operador de PILA por empresa, con el desglose por empleado adentro (salud, pensión, ARL, caja, parafiscales).

**4. Costo de nómina por proyecto**: vista para RRHH y Gerencia, con total por proyecto, empresa y quincena, sin sueldos individuales para Gerencia.

## Cómo se conecta con lo que existe
- **Aprobación de pagos (A&F)**: la solicitud de nómina llega a Gerencia como un solo pago por empresa y concepto (ej. "Nómina 1ª quincena octubre, Conyca Soluciones SAS, $X, 47 empleados"). Gerencia aprueba el total; yo no muestro el detalle por empleado.
- **Consolidado de pagos**: Tesorería lo ve con ITEM por empresa/consolidado. Cada empresa ya apunta a un consolidado (`empresas.consolidado_id`), así que la nómina de cada empresa cae en el consolidado que le toca. Al dispersor irá un archivo con una línea por empleado y cuenta; mientras no exista, Tesorería necesita el listado.
- **Terceros**: empleado = tercero con cuenta verificada. Una cuenta de empleado nueva o cambiada queda pendiente hasta que Financiera la verifique (control que ya existe). Al salir un empleado, su cuenta no se borra, se inactiva.
- **Proyectos y empresas**: las asignaciones apuntan a `proyectos`; la empresa del empleado, a `empresas`. Falta definir qué pasa si el empleado es de una empresa y trabaja para un proyecto de otra (¿se paga igual y se carga a la obra, o hay cruce entre empresas?).
- **Control del proyecto**: sumarle una línea "Nómina" calculada desde las líneas aprobadas y las asignaciones (hoy solo OC y actas).
- **Permisos** (siguiendo `lib/pestanas.ts`): pestañas `rrhh.empleados`, `rrhh.nomina`, `rrhh.costo_proyecto`; acciones `editar_empleados`, `ver_salarios`, `solicitar_pagos_rrhh`. `ver_salarios` solo para RRHH, Gerencia y Contabilidad (confirmar), con el mismo mecanismo que `ver_datos_bancarios` (muestra "Restringido" si no se tiene).

## Mejorar
- [P1] Que el pago de nómina NO exponga sueldos individuales en el consolidado — Evidencia: `pagos_select` deja ver todos los pagos a quien tenga la pestaña; cada pago es de un tercero. — Propuesta: una línea por empresa y concepto en el consolidado y el detalle por empleado en una tabla aparte con permiso propio.
- [P2] Mensaje para quien no tiene pestañas — Evidencia: `/sin-acceso` dice "Pídele a un administrador" pero el botón de menú no responde. — Propuesta: ocultarlo o decir qué falta.
- [P3] El menú muestra "AdPro / A&F: Próximamente" cuando el módulo sí tiene herramientas para otros — Propuesta: ocultar los módulos sin pestañas visibles para el rol (también lo pidió Financiera y Contabilidad).

## Sobra o es demasiado complejo
- No hace falta un "ERP de nómina". El cálculo fino (deducciones de ley, PILA) puede quedar en el software actual; la app solo necesita recibir la solicitud (por línea o por Excel) y dar el costo por obra. Si calcular nómina en la app es mucho, empezar con "cargar el Excel de nómina y convertirlo en solicitud".
- No duplicar datos bancarios: usar `terceros_cuentas`, no una cuenta de banco propia en la ficha del empleado.
- Evitar un flujo de aprobación propio en RRHH: ya aprueba Gerencia en A&F.

## Traspasos con otros roles
- **RRHH → Gerencia**: entrego nómina como un pago total por empresa, con detalle por centro de costo (proyecto) para que apruebe sabiendo en qué obras se gasta.
- **RRHH → Tesorería**: Tesorería necesita la lista pagadera (empleado, banco, cuenta, neto) por empresa. Hoy ese insumo no existe. Si hay retiros, deben salir antes de que lleguen al lote.
- **RRHH → Contabilidad**: la liquidación de nómina y retenciones es mía y de Contabilidad; hay que decidir quién calcula. Contabilidad ya pidió bruto/neto separados y no tener doble descuento (el mismo problema que con las actas).
- **Directores de obra → RRHH**: avisan ingresos y retiros por WhatsApp o llamada. Propuesta mínima: que el director solicite "ingreso de personal" desde la obra (nombre, documento, cargo, fecha) y yo lo completo y apruebo. A discutir si aplica a todo el personal.
- **Contratos/Jurídica → RRHH**: los contratistas (personas naturales) están en otra tabla; la alerta de empleado que también es contratista debe llegar a mí y a Jurídica.
- **Financiera → RRHH**: verifica las cuentas de empleados. Ojo: Tesorería y Financiera son hoy el mismo rol según el informe de Tesorería.

## Riesgos de control
- **Salarios visibles de más** — pasaría si nómina entra como un pago por empleado: `pagos_select` lo muestra a quien tenga la pestaña de Aprobación o Consolidado (Tesorería, Contabilidad, Financiera, quizá más).
- **Empleado fantasma / pago a cuenta cambiada** — si RRHH da de alta un empleado y su cuenta, y la misma persona la verifica. Mantener la separación: RRHH crea, Financiera verifica la cuenta (existe en terceros).
- **Retirado que sigue cobrando** — si la lista de nómina no depende del estado activo y de la fecha de retiro.
- **Doble pago** — la regla actual de índice único por orden de compra y tipo (`pagos_orden_tipo_vivo`) no cubre nómina; se necesitaría una equivalente por empresa, concepto y quincena.
- **Cambiar tercero/cuenta de un pago aprobado sin motivo** (ya reportado por Tesorería): con nómina, el impacto es mayor.
- **Datos personales y de salud** (EPS, fondo, incapacidades, cuentas): son datos sensibles bajo habeas data (Ley 1581). Documentos en bucket privado, acceso por acción, y registro de quién consultó o cambió (como `historial_eventos`). No pude verificar qué exige la ley para el caso de CONYCA.
- **Contratista con riesgo laboral** — personas pagadas como contratistas que cumplen horario; fuera de la app no se ve.
- **Datos reales**: hoy el módulo no existe, así que no hay riesgo de producción todavía. Cuando se cargue, hacerlo en un entorno de prueba con datos ficticios.

## Preguntas para Luis
- ¿RRHH calcula la nómina en otro software (cuál?) o la liquida a mano? ¿Basta con que la app reciba el Excel de nómina de la quincena y lo convierta en solicitud de pago, o quieres calcularla en la app?
- ¿La nómina se paga con un solo archivo del banco por empresa, o por obra? ¿Cada empresa paga desde sus propias cuentas?
- ¿La seguridad social (PILA) es un pago por empresa a un operador? ¿O hay pagos separados por EPS, fondo y caja?
- ¿Quién puede ver salarios: solo RRHH y Gerencia, o también Contabilidad y Tesorería? ¿Gerencia debe ver sueldo por persona o solo el costo por obra?
- ¿Un empleado puede trabajar en más de una obra y en más de una empresa a la vez? ¿Cómo se reparte su costo hoy?
- ¿Los empleados de oficina (administrativos) se cargan a un proyecto o a gastos de la empresa? Eso define si hay un "proyecto" administrativo por empresa.
- ¿Hay nómina de personal de obra pagada por jornal o por contratista? ¿Cómo se distingue en la práctica de un subcontratista?
- ¿Los directores deben poder avisar ingresos y retiros desde la app?
- ¿Cuántos empleados activos y cuántos ingresos y retiros por mes? (Para dimensionar; si son pocos retiros, el flujo puede ser simple.)

Archivos relevantes (solo lectura): `app-demo/lib/pestanas.ts`, `app-demo/supabase/migrations/20261016000000_ayf_terceros.sql`, `app-demo/supabase/migrations/20261017000000_ayf_pagos.sql`, `app-demo/supabase/migrations/20261112000000_actas_sobre_contrato.sql`, `app-demo/supabase/esquema/01_tablas.sql`, `app-demo/app/(app)/ayf/`.
