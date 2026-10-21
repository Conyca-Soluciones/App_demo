# Revisión — Almacenista
Método: app en navegador (Estuario Casa y Malecón, 375 px y pantalla del panel) + lectura de `components/entradas-view.tsx` para lo que no se pudo ver sin guardar  ·  Alcance: Entradas, Salidas (nueva y registradas), Inventario, Registro de órdenes de compra, menú y cambio de proyecto.

No pude probar sin guardar: el formulario real de "Recibir ahora" (la OC 45 está completa, la 48 está pendiente de aprobar y Malecón no tiene OC), los mensajes de tope al registrar y que el mensaje de error de una salida pasada de stock. No subí archivos. Dejé la sesión en el proyecto "maleon" (antes estaba en Estuario Casa). Vuelvo el panel a desktop.

## Resumen
La app cubre lo básico: entrada parcial contra la OC con tope por lo pendiente, botón "Todo", editar y anular con motivo, salidas por insumo, inventario. Pero está pensada para escritorio y para quien confía en la memoria. Lo que más pesa:
1. **No hay foto de la remisión.** Solo un texto opcional de N° de remisión (no hay ningún campo de archivo en Entradas).
2. **La salida no dice a qué ítem/actividad va ni quién recibió** (campo "¿Quién retira?" opcional y sin ítem), y gerencia mide avance con esos datos.
3. **A 375 px el flujo de salidas no se puede hacer a primera vista**: la columna "Cantidad a sacar" queda fuera de pantalla. Tampoco hay modo sin conexión.

## Escenarios probados
| Escenario | Resultado | Nota |
|---|---|---|
| 1. Entrada parcial 80 de 100 bultos con foto de remisión | Logrado con fricción (parcial) / No existe aún (foto) | Lectura de código: se escribe cantidad por línea, "Todo", remisión en texto y la OC queda "Entrega Parcial". No hay foto. Sin OC con saldo no pude abrir el formulario real. |
| 2. Material que no coincide con la OC (otra marca, de más, dañado) | No existe aún | Solo deja recibir hasta lo pendiente ("no puedes recibir más de lo pendiente"). No hay forma de marcar otra marca, dañado, rechazado ni de registrar lo que llegó de más. Solo "Observaciones" libres. |
| 2b. Camión sin saber la OC | Logrado con fricción | Hay que buscar por N° de OC o proveedor; y el proveedor sale mal (ver Mejorar). |
| 3. Salida de varilla para un ítem de obra | Bloqueado en lo importante | Se puede sacar el insumo y la cantidad, pero no existe campo de ítem/actividad. Solo el insumo, la cantidad, "quién retira" (opcional) y observaciones. |
| 4. Consultar inventario | Logrado | Estuario: ALAMBRE #12, entradas 586, salidas 500, disponible 86. Filtro por insumo, sin contar a mano. |
| 5. Todo desde el celular (375 px) | Logrado con fricción / Bloqueado en salidas | Detalle abajo. |
| Devolución a proveedor / traslado entre obras | No existe aún | No hay pantalla ni opción. |
| Trabajo sin conexión | No existe aún | No hay modo offline ni instalación como app (no encontré service worker ni manifest en el código). |

## Falta
- [P1] Foto/archivo de la remisión del proveedor — Evidencia: Entradas > OC 45 > Editar entrada y `components/entradas-view.tsx`: solo el campo de texto "N° de remisión / factura del proveedor (opcional)" y observaciones; ningún campo de archivo ni de cámara en Entradas. — Impacto: sin soporte, si Compras/Contabilidad discuten la entrega con el proveedor no hay prueba de lo que llegó; yo tendría que fotografiarla por WhatsApp.
- [P1] Salida sin ítem de obra ni receptor obligatorio — Evidencia: Salidas > Nueva salida: columnas Insumo, UM, Cantidad; debajo "¿Quién retira el material? (opcional)" y observaciones. En Salidas registradas la columna "Retira" muestra "—" en la única salida existente (500 de ALAMBRE #12). — Impacto: gerencia mide avance con las salidas (contexto-conyca.md), pero no se sabe a qué actividad se destinó cada material ni quién lo recibió; hoy el control de bodega queda al criterio de quien registra.
- [P1] Recepción que no coincide con la OC — Evidencia: lectura del código: el tope impide pasarse de lo pendiente; no hay marca de "dañado", "otra marca" ni línea no prevista. — Impacto: cuando llega una marca distinta o de más, tengo que o inventar la cantidad o dejar fuera lo que sí llegó, y compras/gerencia ven una recepción falsa.
- [P2] Sin conexión — Evidencia: en bodega a veces no hay señal; la app no tiene modo offline (sin service worker/manifest en `public/`). — Impacto: pierdo el registro o lo hago después de memoria.
- [P2] Devoluciones a proveedor y traslados entre obras — Evidencia: menú Almacén = solo Entradas, Salidas, Inventario. — Impacto: Se resuelven hoy en papel/WhatsApp y el inventario queda mal. Pregunta para Luis: ¿se hace en la realidad?
- [P3] Ver cuánto hay disponible mientras escribo la salida — Evidencia: Salidas > escribir ALAMBRE #12 y 99999: no muestra el stock ni avisa del exceso (solo se vería al registrar; no lo probé). — Impacto: tengo que ir a Inventario y volver.

## Mejorar
- [P1] Salidas en celular — Evidencia: a 375 px la tabla mide 526 px en una caja de 341 px: la columna "Cantidad a sacar" queda oculta, hay que deslizar de lado. Caja casi vacía enorme y botón "Registrar salida" abajo. — Propuesta: una tarjeta por línea (insumo, cantidad grande, stock disponible), botón fijo abajo.
- [P1] Pantalla de recepción en celular — Evidencia: Entradas > OC 45 a ~570 px: la tabla se corta en "Pendiente" y "Recibir ahora" queda fuera de la vista; en código el campo de cantidad va dentro de la tabla (w-24 + botón "Todo"). — Propuesta: lista de tarjetas con "Ordenado / Ya llegó / Falta" y un campo grande para "Llegó ahora".
- [P2] Inventario en celular — Evidencia: a 375 px el panel de Filtros ocupa todo el ancho abierto y el resultado queda empujado a un lado (solo se ve una franja); en Entradas el panel se minimiza al consultar, aquí no. — Propuesta: panel plegado por defecto en pantallas angostas.
- [P2] Proveedor mal mostrado en Registro de OC — Evidencia: Registro de órdenes de compra, OC 45 y 48 muestran "(proveedor eliminado)" y "Creada por" vacío, mientras en Entradas la OC 45 sí muestra "ACCESORIOS MODULARES PARA LA CONSTRUCCION SAS". Posiblemente mi rol no puede leer proveedores (suposición). — Propuesta: mostrar el nombre del proveedor; "eliminado" confunde y puede hacerme creer que la OC es inválida.
- [P2] La OC no me dice qué debe llegar ni dónde — Evidencia: detalle OC 48: "Sitio de entrega —", "Fecha de entrega —", contacto vacío; las columnas son Cód, Insumo, UM. — Propuesta: mostrar fecha esperada y sitio de entrega, y marca/referencia si Compras la definió, para validar el camión.
- [P2] Primer destino al elegir proyecto — Evidencia: al elegir "maleon" en /inicio me llevó a Registro de órdenes de compra (primera pestaña de mi rol), no a Entradas. — Propuesta: mi pantalla de inicio debería ser Entradas o un resumen "Órdenes por recibir".
- [P2] Menú en celular — Evidencia: a 375 px el menú de 3 columnas se corta (se ve "Registro de órd…" y hay que deslizar). — Propuesta: menú en una columna; para mi rol bastan 4 accesos.
- [P3] Mensajes y validación — Evidencia: Editar entrada #14 con 700 (la OC era de 586) no avisa hasta guardar (no lo guardé). — Propuesta: mostrar el máximo permitido al lado del campo.
- [P3] Buscador de insumo "_" — Evidencia: Salidas, el texto del campo dice "o _ para ver todo", pero al escribir "_" apareció "Sin resultados" (sí encontró "alambre"). Puede ser que mi teclado de prueba no escribió bien el guion bajo; lo reporto como suposición. — Propuesta: botón "ver todo" visible, útil con mano ocupada.
- [P3] Proyectos con nombre confuso — Evidencia: /inicio muestra "malecon", "maleon" (código "malecox") y "Yopal". — Propuesta: revisar nombres antes de que el almacenista los vea.

## Sobra o es demasiado complejo
- Filtros por "Persona que hizo la entrada" y rango de fechas en Entradas — Por qué: para recibir camiones necesito solo OC o proveedor y "Solo por Recibir". Es lo propio del jefe, no del bodeguero.
- Tener que pulsar "Consultar" antes de ver las órdenes pendientes — Por qué: con "Solo por Recibir" marcado por defecto, debería listar lo pendiente apenas abro, sin más clics.
- Menú A&F visible para mi rol — Por qué: el menú muestra "A&F" aunque no tengo permisos ahí (ya está anotado en CLAUDE.md como pendiente).
- Valores en pesos en Inventario ("Costo promedio", "Valor en bodega" $ 86.000) y precios en el Registro de OC — Por qué: precios y contabilidad no son mi tema. Costo promedio $1.000 para ALAMBRE #12, que parece valor de prueba. Pregunta para Luis: ¿el almacenista debe ver precios?

## Traspasos con otros roles
- De Compras a mí — La OC llega sin fecha ni sitio de entrega y sin marca/presentación esperada; propongo que Compras las llene y yo las vea al recibir.
- De mí a Compras/Contabilidad — Entrego una recepción sin foto de remisión ni estado del material (dañado, de más, otra marca); propongo que cada línea pueda llevar "Observación de calidad" y la foto, visible en la OC.
- De mí a Gerencia (avance de obra) — Mis salidas llegan sin ítem/actividad ni receptor, así que la medición de avance depende de datos pobres. Propongo ítem del presupuesto obligatorio o al menos "Actividad/Frente" y nombre de quien recibe.
- De mí al Director de obra — Si hay material sobrante o devolución a proveedor, no hay forma de avisar ni registrar.

## Riesgos de control
- Se puede registrar una salida sin indicar quién retiró ni para qué ítem ("Retira" opcional): facilita pérdidas de material sin responsable.
- Una entrada se puede editar (cantidad hasta lo ordenado, remisión, observaciones) y anular con un motivo libre, por quien tenga la acción Gestionar bodega; quedan marcadas "Editada/Anulada" y "(antes N)", lo cual es bueno, pero sin foto de remisión no hay soporte externo de la cantidad real recibida.
- Sin tope por insumo para entradas de un mismo camión: la validación es contra el pendiente de la OC, por lo que alguien podría registrar de más hasta completar la OC aunque el camión no haya traído todo (solo se detecta por la foto, que no existe).
- Datos de prueba: la OC 48 aparece en Registro con proveedor "eliminado" y la OC 46 no se ve para mi rol; no pude confirmar si es por estado o por permisos.

## Preguntas para Luis
- ¿Debo ver precios y valor del inventario, o solo cantidades?
- ¿Hoy se hacen devoluciones a proveedor y traslados entre obras con frecuencia suficiente como para pedirlos ya?
- ¿A qué se le llama "ítem" en una salida: ítem del presupuesto, frente de obra o actividad? ¿Siempre se conoce al sacar el material?
- ¿Qué pasa en la práctica cuando llega material distinto a la OC: se rechaza el camión o se recibe y se avisa a Compras?
- ¿Qué tan frecuente es no tener señal en bodega, y qué dispositivos reales usan (celulares Android, tablet)?
- ¿Por qué mi rol ve "(proveedor eliminado)" en el Registro de OC y no la OC 46 de Estuario Casa? Si es por permisos, ¿es lo que se quiere?

Archivos relevantes: `app-demo/components/entradas-view.tsx` (formulario de entradas, editar y anular), `app-demo/components/salidas-pagina.tsx` (pantalla de salidas).
