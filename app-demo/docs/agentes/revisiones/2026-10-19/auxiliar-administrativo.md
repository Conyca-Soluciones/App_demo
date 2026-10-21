# Revisión — Auxiliar Administrativo
Método: app en navegador (http://localhost:3000, usuario "Aux Admin", proyecto Estuario Casa) + una consulta puntual al código (`components/dialogue-nuevo-pedido.tsx`)  ·  Alcance: Inicio, menú lateral (AdPro > Requisiciones: Elaboración y Registro; módulo A&F), formulario de nueva requisición (sin crear), Registro de requisiciones con detalle, mensaje de acceso denegado, y todo lo anterior en 375 px (vuelto a desktop al terminar).

No pude probar sin guardar: el envío real del formulario (qué mensaje sale al pulsar Crear con una fecha pasada, si el servidor la rechaza), el estado de una solicitud mía (no hay ninguna mía: todas salen "Solicitado por —"), y adjuntar soportes (no existe el campo). Nunca pulsé Crear/Guardar/Cancelar ni subí archivos. La sesión no se cayó. Salí de la prueba con la requisición sin guardar.

## Resumen (máx. 5 líneas)
Para mi trabajo real (pedir papelería, aseo, cafetería y pedir el pago de la energía o el arriendo con su factura) la app no sirve: solo existe "Requisiciones", que es un pedido de materiales de obra contra el presupuesto. No hay nada para gastos de oficina ni para pedir pagos ni para adjuntar soportes. El único módulo que parece mío (A&F, "Administrativo y Financiero") dice "Próximamente". Lo que sí existe está bastante claro (mensajes "Solo números enteros", "Supera lo disponible", motivo del rechazo visible), pero está pensado para otra persona.

## Escenarios probados
| Escenario | Resultado | Nota |
|---|---|---|
| 1. Pedir una compra de papelería sin ayuda | No existe aún | Busqué "papel": el desplegable se cierra sin decir nada. Con "_" aparecen solo 4 insumos de obra (alambre, amarre de teja, lámina de PVC, puntillas), todos atados a un "ítem del presupuesto". |
| 2. Solicitar el pago de la factura de energía con su soporte | No existe aún | Ni en el menú de AdPro ni en A&F hay pagos. Nada para adjuntar soportes. |
| 3. Saber el estado de mi solicitud de la semana pasada | Logrado con fricción | El Registro muestra Estado (Aprobada/Rechazada) y Compra (Pendiente/Completa), pero hay que pulsar Consultar, la columna "Solicitado por" sale "—" (no sé cuál es mía) y ningún estado dice "pagada". |
| 4. Equivocarme a propósito en un campo | Logrado con fricción | Cantidad 2.5 -> "Solo números enteros"; 999 -> "Supera lo disponible" (claros). Fecha requerida de 2020 -> la app la acepta y deja crear, sin aviso. Sin fecha -> botón gris sin explicación (ya conocido). |

## Falta
- [P1] Pedir compras de gastos administrativos (papelería, aseo, cafetería, equipos de oficina) — Evidencia: Elaboración de requisiciones; buscar "papel" no devuelve nada y la lista completa trae 4 insumos de obra; todo insumo exige "Ítem del presupuesto al que aplica" — Impacto: la parte principal de mi trabajo no se puede hacer en la app; sigo con Excel/WhatsApp. (Coincide con hallazgo ya confirmado: sin camino para pedir algo fuera del presupuesto.)
- [P1] Solicitar pagos de gastos administrativos (energía, arriendo, mantenimientos) — Evidencia: no hay entrada en el menú; A&F muestra "Próximamente: este módulo todavía no tiene herramientas." — Impacto: no puedo iniciar ningún pago; la persona de Gerencia/Tesorería no recibe nada por la app.
- [P1] Adjuntar soportes (factura de energía, cotización) — Evidencia: el formulario de requisición solo tiene fechas, insumos, urgente y observaciones; no hay campo de archivo — Impacto: sin soporte no hay conciliación contable; hoy habría que mandar la factura por correo/WhatsApp.
- [P2] Pagos recurrentes (energía, arriendo, internet) sin tener que crearlos de cero cada mes — Evidencia: no hay ninguna pantalla de pagos; suposición: seguirá el mismo problema cuando se construya. Impacto: trabajo repetido cada mes. Pregunta abierta: ver "Preguntas para Luis".
- [P2] Ver "mis solicitudes" — Evidencia: Registro de requisiciones lista las de todos los proyectos a los que tengo acceso y "Solicitado por" sale "—" en las 4 (ya confirmado) — Impacto: no puedo saber cuáles hice yo.
- [P3] Aviso de que el cantidad disponible es cero antes de elegir el insumo — Evidencia: ALAMBRE #12 aparece en la lista y recién al elegirlo dice en rojo "Sin cantidad disponible en el presupuesto" — Impacto: pierdo un paso para descubrir que no se puede.

## Mejorar
- [P2] Buscador de insumos sin mensaje cuando no encuentra — Evidencia: escribí "papel" y "papell": aparece "Buscando..." y el desplegable desaparece, sin "No encontré nada" — Propuesta: mostrar "No hay insumos con ese nombre en el presupuesto de este proyecto. Si es un gasto de oficina, usa [opción de gastos]".
- [P2] Pista "_ lista todo" no se ve — Evidencia: la lista completa solo aparece escribiendo "_" (lo dice la documentación, no la pantalla) — Propuesta: mostrar los insumos disponibles apenas se toca el campo.
- [P2] Mensaje de acceso denegado engañoso — Evidencia: abrí /almacen/ordenes-compra y me devolvió a Inicio con "No tienes permiso para abrir esa sección. Elige un proyecto para continuar." — Propuesta: decir "Esta sección no es de tu cargo. Si la necesitas, pídesela al administrador"; hoy "Elige un proyecto" confunde porque ya hay uno elegido.
- [P2] Botón de crear requisición cuenta insumos que no se pueden pedir — Evidencia: con ALAMBRE (sin cupo) + AMARRE TEJA, el botón gris decía "Crear requisición (2 insumos)" sin decir qué falta — Propuesta: contar solo los completos y decir bajo el botón qué falta (la fecha, o quitar el insumo sin cupo). (Parte del hallazgo "botón gris sin decir por qué" ya conocido.)
- [P2] Fecha requerida acepta fechas pasadas — Evidencia: puse 01/01/2020 con cantidad 3 y el botón quedó activo, sin advertencia; en el código (`dialogue-nuevo-pedido.tsx`, `puedeGuardar = !!fechaRequerida && lineasListas && !guardando`) solo se revisa que haya fecha; no probé si el servidor la rechaza — Propuesta: avisar "La fecha requerida ya pasó".
- [P2] Formato de fecha mezclado — Evidencia: los campos de fecha muestran mm/dd/yyyy (formato de EE. UU.) mientras el Registro muestra 14/10/2026 y 6/10/2026 (sin cero) junto a 07/10/2026 (con cero) — Propuesta: siempre dd/mm/aaaa; fácil equivocarse entre 05/10 y 10/05.
- [P2] "Aprobada" + "Compra: Pendiente" no dice qué sigue — Evidencia: Requisiciones 30 y 34, aprobadas el 6 y 14 de octubre, siguen en "Pendiente"; no sé si es porque falta el pago, la cotización o si nadie la ha visto — Propuesta: un texto claro del tipo "Aprobada, esperando que Compras la pida".
- [P3] Jerga de obra en el detalle — Evidencia: columnas "Cod", "UM", "Ítem del presupuesto", "Insumo" en el detalle de la Requisición 28; "Requisición" como nombre — Propuesta: para mi cargo, "Pedido de compra" y "Unidad" serían más entendibles.
- [P3] Menú lateral cortado en pantalla angosta — Evidencia: con la ventana a ~570 px el tercer nivel (Elaboración / Registro) queda tapado por la capa oscura y aparece una barra de desplazamiento horizontal; el menú sigue abierto sin contenido después de entrar a la página — Propuesta: que se cierre solo al elegir una opción.
- [P3] En celular (375 px) el Registro se sale de la pantalla — Evidencia: antes de pulsar Consultar la página mide 459 px de ancho; los botones de usuario y "Cerrar sesión" de la barra superior quedan fuera de la pantalla; tras Consultar la tabla cabe pero Estado y Compra quedan a la derecha, ocultos — Propuesta: acomodar el panel de filtros en una sola columna en el celular y mostrar Estado junto al número. (El formulario de Elaboración sí cabe bien en 375 px.)

## Sobra o es demasiado complejo
- Módulo A&F visible con "Próximamente" — Por qué: para mí es el lugar obvio de mis tareas y está vacío; parece una promesa rota. Mejor ocultarlo hasta que tenga algo, o decir cuándo y qué tendrá.
- Selector de proyecto obligatorio en Inicio — Por qué: mis gastos son de la empresa, no de una obra; pedir que "elijas un proyecto" antes de cualquier cosa no tiene sentido para papelería y arriendos. (Suposición: viene del diseño por obra.)
- Fecha de la requisición como campo visible — Por qué: es siempre la de hoy y no se puede cambiar; ocupa un lugar en el formulario sin servirme.
- "Marcar como urgente" sin explicación — Por qué: no sé a quién se le avisa ni qué cambia; sin guía cualquiera la marca.

## Traspasos con otros roles
- Yo -> Gerencia/Tesorería/Contabilidad (pagos administrativos): hoy no entrego nada por la app. Propongo: un formulario de "Solicitar pago" corto (qué se paga, a quién, valor, fecha límite, factura adjunta) que llegue directo a Gerencia, como describe el contexto.
- Yo -> Compras (compras administrativas): las requisiciones atadas al presupuesto llegan a Compras como si fueran de obra. Propongo que los gastos de oficina vayan por un camino separado, con centro de costo "Administración", no mezclados con los materiales de Estuario Casa.
- Director de obra -> Subgerencia/Compras: veo en el Registro las 4 requisiciones de la obra ("Solicitado por —"). Si yo pidiera algo, no se distinguiría de lo del director. Hace falta que el nombre de quien pide se vea.

## Riesgos de control
- Ver el Registro de "todos los proyectos a los que tienes acceso" mostrando solicitudes sin dueño ("Solicitado por —") — se podría atribuir o reclamar una solicitud ajena sin rastro visible; (ya confirmado por otros; me afecta porque no puedo comprobar cuáles son mías).
- Si el aux. administrativo tuviera que pedir papelería a través del presupuesto de obra (por no existir otro camino), el gasto de oficina quedaría cargado a una obra — cómo se daría: el único insumo "parecido" que acepte el sistema consume cupo del proyecto. Hoy la app no lo permite, así que el riesgo real es el desvío a WhatsApp/Excel sin control ni soporte.
- Fecha requerida pasada aceptada en pantalla (por confirmar en servidor) — se podrían crear pedidos con fechas absurdas que ensucien los reportes de urgencia.
- Pagos y soportes fuera de la app — sin registro ni aprobación de Gerencia en la plataforma: riesgo de pagar facturas dos veces o sin soporte.

## Preguntas para Luis
- Papelería, aseo y cafetería: ¿se piden hoy siempre contra un proyecto o contra "la oficina"? ¿Quién los aprueba (Gerencia o Subgerencia)? Define si necesitan centro de costo y no proyecto.
- Pagos recurrentes (energía, agua, arriendo, internet): ¿cuántos por mes y varían de valor? Para saber si basta un botón "Repetir el del mes pasado".
- ¿Qué soporte lleva cada tipo de pago (factura, cuenta de cobro, recibo)? ¿Ya lleva el valor o lo escribe el aux.?
- ¿Se espera que el aux. administrativo vea las requisiciones de obra del Registro, o solo las suyas? Hoy ve las de la obra pero sin saber de quién son.
- ¿El módulo A&F será donde vivan mis pagos? Si sí, decirlo en el aviso "Próximamente".
- ¿Un aux. debería poder crear requisiciones de obra? Hoy su único permiso real es para algo que no es su trabajo diario.

Rutas y archivos relevantes: formulario en `app-demo/components/dialogue-nuevo-pedido.tsx`; páginas `/almacen` y `/almacen/registro-requisiciones`.
