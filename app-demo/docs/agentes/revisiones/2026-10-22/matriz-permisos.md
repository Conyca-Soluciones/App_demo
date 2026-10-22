# Matriz de permisos rol × acción — 22/10/2026

**Dónde se corrió:** una copia local del esquema de producción: las mismas 336 funciones,
comprobadas con md5 contra producción, y las mismas políticas, permisos y vistas. Tiene los
catálogos reales y datos de prueba ficticios. **Nada se escribió en producción**: a producción
solo se le hicieron consultas de lectura, para copiar el esquema y confirmar los hallazgos.

**Cómo se hizo:**
- Cada celda es una transacción que se revierte: se prepara el estado, se entra como el usuario
  de prueba del rol (sesión real, `auth.uid()`, RLS y permisos reales), se intenta la acción y se
  deshace.
- "anon" es una petición sin sesión.
- "dir_sin_proy" es un Director de obra sin proyectos asignados.
- Lo esperado sale de la matriz de Roles (`rol_permisos`); el Administrador siempre puede.

## Hallazgos

1. **Cualquier usuario con un proyecto asignado puede crear requisiciones de obra.** Le pasa a
   Compras, Financiera, Legal, Contabilidad, RRHH, Almacenista y otros. `crear_requisicion` solo
   revisa el acceso al proyecto, no la pestaña Elaboración de requisiciones
   (`tab.tecnico.pedidos`). La pantalla no los deja entrar, pero la API sí. Consume cupo del
   presupuesto. *Probado.*
2. **Un Director de obra SIN proyectos cambia cantidades del APU de Malecón** (UPDATE directo a
   `item_apu`). Es la "opción B" pendiente de Seguridad de APU: `editar_presupuestos` vale en
   todos los proyectos. *Probado.*
3. **19 funciones se pueden llamar sin sesión** (EXECUTE a PUBLIC/anon). Confirmado en
   producción con la misma lista:
   - aprobar/rechazar/desaprobar/cancelar_orden_compra
   - resolver_requisicion, desaprobar_requisicion, desaprobar_pedido
   - rechazar_pedido_compras, cerrar_saldo_pedido
   - listar_auditoria
   - 9 auxiliares

   En la prueba, las 48 acciones se negaron sin sesión porque las funciones revisan `auth.uid()`
   por dentro, así que **hoy no es explotable**. Pero contradice la regla de la app ("ninguna
   función ejecutable sin sesión") y basta un cambio en una de ellas para abrirla. Arreglo:
   `revoke execute ... from public, anon`.
4. Escrituras directas que pasan bien la prueba (nadie las logra salvo el Administrador donde
   corresponde): estado y valor de pagos, estado de OC y requisiciones, precio de líneas de OC,
   historial, notificaciones a otros, `rol_permisos`, ponerse Administrador.
5. Cuentas de terceros: solo Gerencia y Financiera las verifican y editan, como dice la matriz.
6. Sin hallazgos: ningún permiso para anon en tablas o vistas, ninguna tabla sin RLS, ninguna
   función SECURITY DEFINER sin `search_path` y ninguna política de escritura abierta.

Notas de lectura de la tabla:
- "Cancelar requisición (solo quien la hizo)": el Administrador no puede. Es así por diseño.
- Cerrar saldo con ⚠: el escenario no tenía saldo abierto. El permiso sí pasó.
- Lecturas: el número es cuántas filas ve cada rol. Que el Almacenista vea 1 requisición, y
  Financiera y Contabilidad la OC con pago, es lo esperado: la ven por su pestaña o por el pago.

✔ = lo hizo · 0 filas = la RLS no lo dejó · ✖ = negado con mensaje de permiso · ⚠ = error que no es de permiso · número = filas visibles · **!** = distinto de lo esperado · **?** = revisar el mensaje

| Prueba | compras | lider_compras | area_tecnica | lider_tecnico | director_obra | gerencia | subgerencia | financiera | administrador | legal | lider_legal | almacenista | contabilidad | aux_adm | rrhh | dir_sin_proy | anon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Crear requisición (Malecón) (`req.crear`) | ✔! | ✔! | ✔ | ✔ | ✔ | ✔ | ✔! | ✔! | ✔ | ✔! | ✔! | ✔! | ✔! | ✔ | ✔! | ✖ | ✖ |
| Aprobar requisición pendiente (`req.aprobar`) | ✖ | ✖ | ✖ | ✔ | ✖ | ✔ | ✔ | ✖ | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Rechazar requisición pendiente (`req.rechazar`) | ✖ | ✖ | ✖ | ✔ | ✖ | ✔ | ✔ | ✖ | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Desaprobar requisición aprobada sin OC (`req.desaprobar`) | ✖ | ✖ | ✖ | ✔ | ✖ | ✔ | ✖ | ✖ | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Cancelar requisición pendiente (solo quien la hizo) (`req.cancelar_ajena`) | ✖ | ✖ | ✖ | ✖ | ✔ | ✖ | ✖ | ✖ | ✖! | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Rechazar línea de requisición (Compras) (`compras.rechazar_linea`) | ✔ | ✔ | ✖ | ✖ | ✖ | ✔ | ✖ | ✖ | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Cerrar saldo de línea (`compras.cerrar_saldo`) | ⚠? | ⚠? | ✖ | ✖ | ✖ | ⚠? | ✖ | ✖ | ⚠? | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Crear OC con soporte (`oc.crear`) | ✔ | ✔ | ✖ | ✖ | ✖ | ✔ | ✖ | ✖ | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Aprobar OC pendiente (`oc.aprobar`) | ✖ | ✔ | ✖ | ✖ | ✖ | ✔ | ✖ | ✖ | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Rechazar OC pendiente (`oc.rechazar`) | ✖ | ✔ | ✖ | ✖ | ✖ | ✔ | ✖ | ✖ | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Desaprobar OC aprobada (`oc.desaprobar`) | ✖ | ✔ | ✖ | ✖ | ✖ | ✔ | ✖ | ✖ | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Cancelar OC aprobada (`oc.cancelar`) | ✖ | ✔ | ✖ | ✖ | ✖ | ✔ | ✖ | ✖ | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Retirar OC pendiente creada por Compras (`oc.retirar_ajena`) | ✔ | ✔ | ✖ | ✖ | ✖ | ✔ | ✖ | ✖ | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Registrar entrada de almacén (OC 1) (`alm.entrada`) | ✖ | ✖ | ✔ | ✔ | ✖ | ✔ | ✖ | ✖ | ✔ | ✖ | ✖ | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Crear requisición administrativa (`ra.crear`) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✖ |
| Aprobar requisición administrativa (A&F) (`ra.aprobar`) | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ | ✖ | ✖ | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Rechazar requisición administrativa (A&F) (`ra.rechazar`) | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ | ✖ | ✖ | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Cancelar requisición administrativa (solo quien la hizo) (`ra.cancelar_ajena`) | ⚠ | ⚠ | ⚠ | ⚠ | ⚠ | ⚠ | ⚠ | ⚠ | ⚠? | ⚠ | ⚠ | ⚠ | ⚠ | ✔ | ⚠ | ⚠ | ✖ |
| Aprobar un ítem suelto de req. admin. con aprobar_pago (`pago.aprobar_item_suelto`) | ✖ | ✖ | ✖ | ✖ | ✖ | ⚠ | ✖ | ✖ | ⚠ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Liquidar pago aprobado (`pago.liquidar`) | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ | ✖ | ✖ | ✖ | ✔ | ✖ | ✖ | ✖ | ✖ |
| Crear banco (Admin › Bancos) (`admin.banco`) | ⚠ | ⚠ | ⚠ | ⚠ | ⚠ | ⚠ | ⚠ | ⚠ | ✔ | ⚠ | ⚠ | ⚠ | ⚠ | ⚠ | ⚠ | ⚠ | ✖ |
| Ver Auditoría (`admin.auditoria`) | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| UPDATE perfiles: ponerse rol Administrador (`dml.escalar_rol`) | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | ✔ | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | ✖ |
| INSERT rol_permisos directo (la matriz va por funciones) (`dml.escalar_permiso`) | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| UPDATE perfiles: todos_los_proyectos (`dml.todos_proyectos`) | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | ✔ | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | ✖ |
| INSERT usuario_proyectos para sí mismo (`dml.asignarse_proyecto`) | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | 0 filas | ✖ |
| UPDATE pagos.estado directo (aprobar) (`dml.pago_estado`) | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | ✖ |
| UPDATE pagos.valor directo (`dml.pago_valor`) | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | ✖ |
| INSERT pago directo (`dml.pago_insert`) | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| UPDATE ordenes_compra.estado directo (`dml.oc_estado`) | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| UPDATE precio de línea de OC aprobada (`dml.oc_precio`) | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| UPDATE requisiciones.estado directo (`dml.req_estado`) | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| UPDATE requisiciones_admin.estado directo (`dml.ra_estado`) | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| UPDATE terceros_cuentas: ACTIVO (verificar) (`dml.cuenta_verificar`) | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | ✔ | 0 filas | ✔ | ✔ | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | ✖ |
| UPDATE terceros_cuentas.numero_cuenta (`dml.cuenta_numero`) | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | ✔ | 0 filas | ✔ | ✔ | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | ✖ |
| UPDATE maestro_insumos.vr_unitario (`dml.maestro_precio`) | 0 filas | 0 filas | 0 filas | ✔ | 0 filas | ✔ | 0 filas | 0 filas | ✔ | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | ✖ |
| UPDATE item_apu.cantidad (`dml.apu`) | 0 filas | 0 filas | ✔ | ✔ | ✔ | ✔ | 0 filas | 0 filas | ✔ | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | ✔! | ✖ |
| DELETE historial_eventos (`dml.historial_borrar`) | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | 0 filas | ✖ |
| INSERT notificación a otro usuario (`dml.notificar_otro`) | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| SELECT pagos (`leer.pagos`) | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 5 | 5 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | ✖ |
| SELECT terceros_cuentas.numero_cuenta (`leer.cuentas`) | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 3 | 3 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | ✖ |
| SELECT perfiles.email de otros (`leer.perfiles_correo`) | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| SELECT rut_extracciones (`leer.rut`) | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| SELECT requisiciones_admin de otros (`leer.req_admin_ajenas`) | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | ✖ |
| SELECT ordenes_compra (Malecón) (`leer.oc`) | 2 | 2 | 0 | 0 | 2 | 2 | 0 | 1 | 2 | 0 | 0 | 2 | 1 | 0 | 0 | 0 | ✖ |
| SELECT requisiciones_vista (vista sin security_invoker) (`leer.vista_requisiciones`) | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 0 | 2 | 0 | 0 | 1! | 0 | 2 | 0 | 0! | ✖ |
| SELECT v_ordenes_compra_items_costos (vista sin security_invoker) (`leer.vista_costos_oc`) | 2 | 2 | 0 | 0 | 2 | 2 | 0 | 0 | 2 | 0 | 0 | 2 | 0 | 0 | 0 | 0! | ✖ |
| SELECT proveedores (todos) (`leer.proveedores`) | 394 | 394 | 0 | 0 | 1 | 394 | 0 | 0 | 394 | 0 | 0 | 1 | 0 | 0 | 0 | 0! | ✖ |


## Revisión estática (copia local, confirmada en producción)
```
### Funciones ejecutables sin sesión (anon o PUBLIC)
_asignar_numero_contrato()
_avisar_poliza_pendiente() [SECURITY DEFINER]
_calcular_vr_neto_insumo()
_pesos_texto(p numeric)
_poliza_al_aprobar_minuta()
_semana_pago(p_instante timestamp with time zone)
_validar_acta_poliza(p_acta jsonb)
aprobar_orden_compra(p_orden_id uuid) [SECURITY DEFINER]
cancelar_orden_compra(p_orden_id uuid, p_motivo text) [SECURITY DEFINER]
cerrar_saldo_pedido(p_pedido_id uuid, p_motivo text) [SECURITY DEFINER]
desaprobar_orden_compra(p_orden_id uuid, p_motivo text) [SECURITY DEFINER]
desaprobar_pedido(p_pedido_id uuid, p_motivo text) [SECURITY DEFINER]
desaprobar_requisicion(p_id uuid, p_motivo text) [SECURITY DEFINER]
documentos_tipo_contrato(p_tipo text, OUT obligatorios text[], OUT permitidos text[])
dv_nit(p_nit text)
listar_auditoria(p_tipo text, p_usuario uuid, p_desde date, p_hasta date, p_offset integer, p_limite integer) [SECURITY DEFINER]
rechazar_orden_compra(p_orden_id uuid, p_motivo text) [SECURITY DEFINER]
rechazar_pedido_compras(p_pedido_id uuid, p_motivo text) [SECURITY DEFINER]
resolver_requisicion(p_id uuid, p_estado text, p_comentario text) [SECURITY DEFINER]
### Tablas o vistas con algún permiso para anon
### Tablas con permisos para usuarios pero SIN RLS
### Vistas leíbles por usuarios que NO usan security_invoker (saltan la RLS de sus tablas)
### SECURITY DEFINER sin search_path fijo
### Políticas de escritura abiertas (true) para usuarios
```
