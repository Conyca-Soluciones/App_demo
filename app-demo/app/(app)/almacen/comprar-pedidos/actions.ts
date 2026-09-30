// // // "use server"

// // // import { createClient } from "@/lib/supabase/server"
// // // import { requerirScope, requerirAdmin } from "@/lib/permisos"

// // // // ---------------------------------------------------------------------------
// // // // Compras -- cola de pedidos aprobados listos para generar orden de compra
// // // // ---------------------------------------------------------------------------

// // // export type ProyectoSugerido = { id: string; codigo: string | null; nombre: string }

// // // export async function listarProyectosCompras(): Promise<ProyectoSugerido[]> {
// // //   await requerirScope("rol_compras")
// // //   const supabase = await createClient()

// // //   const { data, error } = await supabase
// // //     .from("proyectos")
// // //     .select("id, codigo, nombre")
// // //     .order("codigo", { ascending: false, nullsFirst: false })

// // //   if (error) throw new Error(error.message)
// // //   return data ?? []
// // // }

// // // export type InsumoSugerido = { id: string; codigo: number; descripcion: string; u_m: string | null }

// // // export async function buscarInsumosCompras(termino: string): Promise<InsumoSugerido[]> {
// // //   if (!termino || termino.trim().length < 2) return []
// // //   const supabase = await createClient()

// // //   const { data, error } = await supabase
// // //     .from("maestro_insumos")
// // //     .select("id, codigo, descripcion, u_m")
// // //     .ilike("descripcion", `%${termino.trim()}%`)
// // //     .order("descripcion")
// // //     .limit(15)

// // //   if (error) throw new Error(error.message)
// // //   return data ?? []
// // // }

// // // export type UsuarioSugerido = { id: string; nombre: string }

// // // export async function buscarUsuarios(termino: string): Promise<UsuarioSugerido[]> {
// // //   if (!termino || termino.trim().length < 2) return []
// // //   const supabase = await createClient()

// // //   const { data, error } = await supabase
// // //     .from("perfiles")
// // //     .select("id, nombre")
// // //     .ilike("nombre", `%${termino.trim()}%`)
// // //     .order("nombre")
// // //     .limit(15)

// // //   if (error) throw new Error(error.message)
// // //   return data ?? []
// // // }

// // // export type FiltrosPedidosCompra = {
// // //   proyectoId: string
// // //   usuarioId?: string | null
// // //   insumoId?: string | null
// // //   observacion?: string | null
// // //   fechaPedidoInicio?: string | null
// // //   fechaPedidoFin?: string | null
// // //   fechaRequerimientoInicio?: string | null
// // //   fechaRequerimientoFin?: string | null
// // //   fechaAprobacionInicio?: string | null
// // //   fechaAprobacionFin?: string | null
// // //   soloUrgentes?: boolean
// // // }

// // // export type PedidoParaComprar = {
// // //   id: string
// // //   insumoId: string
// // //   insumoCodigo: number
// // //   insumoDescripcion: string
// // //   um: string | null
// // //   cantidad: number
// // //   cantidadPendiente: number
// // //   valorUnitarioProyectado: number | null
// // //   fechaPedido: string
// // //   fechaRequerida: string
// // //   urgente: boolean
// // //   observaciones: string | null
// // //   soporteUrl: string | null
// // //   solicitadoPorNombre: string | null
// // //   resueltoAt: string | null
// // // }

// // // const SELECT_PEDIDO_PARA_COMPRAR = `
// // //   id, cantidad, fecha_requerida, urgente, observaciones, soporte_url, created_at, resuelto_at,
// // //   insumo:maestro_insumos!pedidos_insumos_insumo_id_fkey(id, codigo, descripcion, u_m, vr_unitario),
// // //   solicitante:perfiles!pedidos_insumos_solicitado_por_fkey(nombre),
// // //   compras:ordenes_compra_items!ordenes_compra_items_pedido_insumo_id_fkey(cantidad)
// // // `

// // // function mapPedidoParaComprar(f: any): PedidoParaComprar {
// // //   const yaComprado = (f.compras ?? []).reduce((acc: number, c: any) => acc + Number(c.cantidad), 0)
// // //   return {
// // //     id: f.id,
// // //     insumoId: f.insumo?.id,
// // //     insumoCodigo: f.insumo?.codigo,
// // //     insumoDescripcion: f.insumo?.descripcion ?? "(insumo eliminado)",
// // //     um: f.insumo?.u_m ?? null,
// // //     cantidad: Number(f.cantidad),
// // //     cantidadPendiente: Number(f.cantidad) - yaComprado,
// // //     valorUnitarioProyectado: f.insumo?.vr_unitario ?? null,
// // //     fechaPedido: f.created_at,
// // //     fechaRequerida: f.fecha_requerida,
// // //     urgente: f.urgente,
// // //     observaciones: f.observaciones,
// // //     soporteUrl: f.soporte_url,
// // //     solicitadoPorNombre: f.solicitante?.nombre ?? null,
// // //     resueltoAt: f.resuelto_at,
// // //   }
// // // }

// // // export async function listarPedidosParaComprar(
// // //   filtros: FiltrosPedidosCompra
// // // ): Promise<PedidoParaComprar[]> {
// // //   await requerirScope("rol_compras")
// // //   const supabase = await createClient()

// // //   let query = supabase
// // //     .from("pedidos_insumos")
// // //     .select(SELECT_PEDIDO_PARA_COMPRAR)
// // //     .eq("proyecto_id", filtros.proyectoId)
// // //     .eq("estado", "aprobado")
// // //     .is("rechazado_compras_at", null)
// // //     .order("urgente", { ascending: false })
// // //     .order("fecha_requerida", { ascending: true })

// // //   if (filtros.usuarioId) query = query.eq("solicitado_por", filtros.usuarioId)
// // //   if (filtros.insumoId) query = query.eq("insumo_id", filtros.insumoId)
// // //   if (filtros.observacion?.trim()) query = query.ilike("observaciones", `%${filtros.observacion.trim()}%`)
// // //   if (filtros.soloUrgentes) query = query.eq("urgente", true)

// // //   if (filtros.fechaPedidoInicio) query = query.gte("created_at", filtros.fechaPedidoInicio)
// // //   if (filtros.fechaPedidoFin) query = query.lte("created_at", `${filtros.fechaPedidoFin}T23:59:59`)
// // //   if (filtros.fechaRequerimientoInicio) query = query.gte("fecha_requerida", filtros.fechaRequerimientoInicio)
// // //   if (filtros.fechaRequerimientoFin) query = query.lte("fecha_requerida", filtros.fechaRequerimientoFin)
// // //   if (filtros.fechaAprobacionInicio) query = query.gte("resuelto_at", filtros.fechaAprobacionInicio)
// // //   if (filtros.fechaAprobacionFin) query = query.lte("resuelto_at", `${filtros.fechaAprobacionFin}T23:59:59`)

// // //   const { data, error } = await query
// // //   if (error) throw new Error(error.message)

// // //   return (data ?? []).map(mapPedidoParaComprar).filter((p) => p.cantidadPendiente > 0)
// // // }

// // // export async function obtenerPedidosPorId(ids: string[]): Promise<PedidoParaComprar[]> {
// // //   await requerirScope("rol_compras")
// // //   if (ids.length === 0) return []
// // //   const supabase = await createClient()

// // //   const { data, error } = await supabase
// // //     .from("pedidos_insumos")
// // //     .select(SELECT_PEDIDO_PARA_COMPRAR)
// // //     .in("id", ids)
// // //     .eq("estado", "aprobado")
// // //     .is("rechazado_compras_at", null)

// // //   if (error) throw new Error(error.message)

// // //   return (data ?? []).map(mapPedidoParaComprar).filter((p) => p.cantidadPendiente > 0)
// // // }

// // // export async function rechazarPedidoCompras(pedidoId: string, motivo: string): Promise<void> {
// // //   await requerirScope("rol_compras")
// // //   const supabase = await createClient()

// // //   const {
// // //     data: { user },
// // //   } = await supabase.auth.getUser()

// // //   const { error } = await supabase
// // //     .from("pedidos_insumos")
// // //     .update({
// // //       rechazado_compras_at: new Date().toISOString(),
// // //       rechazado_compras_por: user?.id ?? null,
// // //       observaciones_compras: motivo,
// // //     })
// // //     .eq("id", pedidoId)

// // //   if (error) throw new Error(error.message)
// // // }

// // // // ---------------------------------------------------------------------------
// // // // Generar OC
// // // // ---------------------------------------------------------------------------

// // // export type ProveedorSugerido = {
// // //   id: string
// // //   nombre: string
// // //   idProv: string | null
// // //   tipoProveedor: string | null
// // // }

// // // export async function buscarProveedores(termino: string): Promise<ProveedorSugerido[]> {
// // //   await requerirScope("rol_compras")
// // //   if (!termino || termino.trim().length < 2) return []
// // //   const supabase = await createClient()

// // //   const { data, error } = await supabase
// // //     .from("proveedores")
// // //     .select("unique_id, nombre, id_prov, tipo_proveedor")
// // //     .eq("estado", "ACTIVO")
// // //     .ilike("nombre", `%${termino.trim()}%`)
// // //     .order("nombre")
// // //     .limit(15)

// // //   if (error) throw new Error(error.message)
// // //   return (data ?? []).map((p) => ({
// // //     id: p.unique_id,
// // //     nombre: p.nombre,
// // //     idProv: p.id_prov,
// // //     tipoProveedor: p.tipo_proveedor,
// // //   }))
// // // }

// // // export type InformacionBancariaProveedor = {
// // //   titular: string | null
// // //   entidadBancaria: string | null
// // //   tipoCuenta: string | null
// // //   noCuenta: string | null
// // // }

// // // export type ProveedorDetalle = {
// // //   id: string
// // //   nombre: string
// // //   nombreContacto: string | null
// // //   telefono: string | null
// // //   correo: string | null
// // //   ciudad: string | null
// // //   direccion: string | null
// // //   informacionBancaria: InformacionBancariaProveedor | null
// // // }

// // // export async function obtenerProveedorDetalle(proveedorId: string): Promise<ProveedorDetalle> {
// // //   await requerirScope("rol_compras")
// // //   const supabase = await createClient()

// // //   const { data, error } = await supabase
// // //     .from("proveedores")
// // //     .select(
// // //       `
// // //       unique_id, nombre, nombre_contacto, telefono, correo, ciudad, direccion,
// // //       informacion_bancaria!informacion_bancaria_id_fkey(titular, entidad_bancaria, tipo_cuenta, no_cuenta)
// // //     `
// // //     )
// // //     .eq("unique_id", proveedorId)
// // //     .single()

// // //   if (error) throw new Error(error.message)

// // //   const d = data as any
// // //   const banco = Array.isArray(d.informacion_bancaria) ? d.informacion_bancaria[0] : d.informacion_bancaria

// // //   return {
// // //     id: d.unique_id,
// // //     nombre: d.nombre,
// // //     nombreContacto: d.nombre_contacto,
// // //     telefono: d.telefono,
// // //     correo: d.correo,
// // //     ciudad: d.ciudad,
// // //     direccion: d.direccion,
// // //     informacionBancaria: banco
// // //       ? {
// // //           titular: banco.titular,
// // //           entidadBancaria: banco.entidad_bancaria,
// // //           tipoCuenta: banco.tipo_cuenta,
// // //           noCuenta: banco.no_cuenta,
// // //         }
// // //       : null,
// // //   }
// // // }

// // // export type LineaOrdenCompra = {
// // //   pedidoId: string
// // //   cantidadComprar: number
// // //   precioUnitario: number
// // //   porcentajeDescuento: number
// // //   porcentajeIva: number
// // // }

// // // export type DatosOrdenCompra = {
// // //   proyectoId: string
// // //   proveedorId: string
// // //   sitioEntrega?: string | null
// // //   fechaEntrega?: string | null
// // //   contactoNombre?: string | null
// // //   telefono?: string | null
// // //   ciudad?: string | null
// // //   email?: string | null
// // //   condicionesPago?: string | null
// // //   observaciones?: string | null
// // //   lineas: LineaOrdenCompra[]
// // // }

// // // export async function crearOrdenCompra(datos: DatosOrdenCompra): Promise<string> {
// // //   await requerirScope("rol_compras")

// // //   if (datos.lineas.length === 0) {
// // //     throw new Error("Selecciona al menos un insumo para la orden de compra.")
// // //   }

// // //   const supabase = await createClient()

// // //     const { data, error } = await supabase.rpc("crear_orden_compra", {
// // //     p_proyecto_id: datos.proyectoId,
// // //     p_proveedor_id: datos.proveedorId,
// // //     p_sitio_entrega: datos.sitioEntrega ?? null,
// // //     p_fecha_entrega: datos.fechaEntrega ?? null,
// // //     p_contacto_nombre: datos.contactoNombre ?? null,
// // //     p_telefono: datos.telefono ?? null,
// // //     p_ciudad: datos.ciudad ?? null,
// // //     p_email: datos.email ?? null,
// // //     p_condiciones_pago: datos.condicionesPago ?? null,
// // //     p_observaciones: datos.observaciones ?? null,
// // //     p_lineas: datos.lineas.map((l) => ({
// // //       pedido_id: l.pedidoId,
// // //       cantidad_comprar: l.cantidadComprar,
// // //       precio_unitario: l.precioUnitario,
// // //       porcentaje_descuento: l.porcentajeDescuento,
// // //       porcentaje_iva: l.porcentajeIva,
// // //     })),
// // //   })

// // //   if (error) throw new Error(error.message)
// // //   return data as string
// // // }

// // // // ---------------------------------------------------------------------------
// // // // Aprobación de OC + pantalla de detalle
// // // // ---------------------------------------------------------------------------

// // // export type PermisosOrdenCompra = { esAdmin: boolean; rolCompras: boolean }

// // // export async function obtenerPermisosOrdenCompra(): Promise<PermisosOrdenCompra> {
// // //   const supabase = await createClient()
// // //   const {
// // //     data: { user },
// // //   } = await supabase.auth.getUser()
// // //   if (!user) return { esAdmin: false, rolCompras: false }

// // //   const { data, error } = await supabase
// // //     .from("perfiles")
// // //     .select("es_admin, rol_compras")
// // //     .eq("id", user.id)
// // //     .single()

// // //   if (error) throw new Error(error.message)
// // //   return { esAdmin: data.es_admin, rolCompras: data.rol_compras }
// // // }

// // // export type OrdenCompraResumen = {
// // //   id: string
// // //   numero: number
// // //   proyectoCodigo: string | null
// // //   proyectoNombre: string | null
// // //   proveedorNombre: string
// // //   creadaPorNombre: string | null
// // //   createdAt: string
// // //   totalLineas: number
// // // }

// // // export async function listarOrdenesCompraPendientes(): Promise<OrdenCompraResumen[]> {
// // //   await requerirAdmin()
// // //   const supabase = await createClient()

// // //   const { data, error } = await supabase
// // //     .from("ordenes_compra")
// // //     .select(
// // //       `
// // //       id, numero, created_at,
// // //       proyecto:proyectos!ordenes_compra_proyecto_id_fkey(codigo, nombre),
// // //       proveedor:proveedores!ordenes_compra_proveedor_id_fkey(nombre),
// // //       creado_por:perfiles!ordenes_compra_created_by_fkey(nombre),
// // //       lineas:ordenes_compra_items!ordenes_compra_items_orden_compra_id_fkey(id)
// // //     `
// // //     )
// // //     .eq("estado", "pendiente_aprobacion")
// // //     .order("created_at", { ascending: true })

// // //   if (error) throw new Error(error.message)

// // //   return (data ?? []).map((o: any) => ({
// // //     id: o.id,
// // //     numero: o.numero,
// // //     proyectoCodigo: o.proyecto?.codigo ?? null,
// // //     proyectoNombre: o.proyecto?.nombre ?? null,
// // //     proveedorNombre: o.proveedor?.nombre ?? "(proveedor eliminado)",
// // //     creadaPorNombre: o.creado_por?.nombre ?? null,
// // //     createdAt: o.created_at,
// // //     totalLineas: (o.lineas ?? []).length,
// // //   }))
// // // }

// // // export type OrdenCompraEstado = "pendiente_aprobacion" | "aprobada" | "rechazada"

// // // export type LineaOrdenCompraDetalle = {
// // //   id: string
// // //   insumoCodigo: number
// // //   insumoDescripcion: string
// // //   um: string | null
// // //   cantidad: number
// // //   precioUnitario: number
// // //   porcentajeDescuento: number
// // //   porcentajeIva: number
// // // }

// // // export type OrdenCompraDetalle = {
// // //   id: string
// // //   numero: number
// // //   estado: OrdenCompraEstado
// // //   proyectoCodigo: string | null
// // //   proyectoNombre: string | null
// // //   proyectoCiudad: string | null
// // //   empresaNombre: string | null
// // //   empresaNit: string | null
// // //   proveedorNombre: string
// // //   proveedorNit: string | null
// // //   proveedorDireccion: string | null
// // //   proveedorCiudad: string | null
// // //   proveedorTelefono: string | null
// // //   proveedorEmail: string | null
// // //   proveedorContacto: string | null
// // //   sitioEntrega: string | null
// // //   fechaEntrega: string | null
// // //   contactoNombre: string | null
// // //   telefono: string | null
// // //   ciudad: string | null
// // //   email: string | null
// // //   condicionesPago: string | null
// // //   observaciones: string | null
// // //   enviada: boolean
// // //   creadaPorNombre: string | null
// // //   createdAt: string
// // //   aprobadaPorNombre: string | null
// // //   aprobadaAt: string | null
// // //   motivoRechazo: string | null
// // //   lineas: LineaOrdenCompraDetalle[]
// // // }
// // // export async function obtenerOrdenCompraDetalle(ordenId: string): Promise<OrdenCompraDetalle> {
// // //   const supabase = await createClient()
// // //   const {
// // //     data: { user },
// // //   } = await supabase.auth.getUser()
// // //   if (!user) throw new Error("No autenticado.")

// // //   const { data, error } = await supabase
// // //     .from("ordenes_compra")
// // //     .select(
// // //       `
// // //       id, numero, estado, sitio_entrega, fecha_entrega, contacto_nombre, telefono, ciudad, email,
// // //       condiciones_pago, observaciones, enviada, created_at, aprobada_at, motivo_rechazo,
// // //       proyecto:proyectos!ordenes_compra_proyecto_id_fkey(codigo, nombre, ciudad, empresa:empresas(nit, razon_social)),
// // //       proveedor:proveedores!ordenes_compra_proveedor_id_fkey(
// // //         nombre, numero_documento, digito_verificacion, direccion, ciudad, telefono, correo, nombre_contacto
// // //       ),
// // //       creado_por:perfiles!ordenes_compra_created_by_fkey(nombre),
// // //       aprobada_por_perfil:perfiles!ordenes_compra_aprobada_por_fkey(nombre),
// // //       lineas:ordenes_compra_items!ordenes_compra_items_orden_compra_id_fkey(
// // //         id, cantidad, precio_unitario, porcentaje_descuento, porcentaje_iva,
// // //         pedido:pedidos_insumos!ordenes_compra_items_pedido_insumo_id_fkey(
// // //           insumo:maestro_insumos!pedidos_insumos_insumo_id_fkey(codigo, descripcion, u_m)
// // //         )
// // //       )
// // //     `
// // //     )
// // //     .eq("id", ordenId)
// // //     .single()

// // //   if (error) throw new Error(error.message)

// // //   const d = data as any
// // //   const nitProveedor = d.proveedor?.numero_documento
// // //     ? `${d.proveedor.numero_documento}${d.proveedor.digito_verificacion ? `-${d.proveedor.digito_verificacion}` : ""}`
// // //     : null

// // //   return {
// // //     id: d.id,
// // //     numero: d.numero,
// // //     estado: d.estado,
// // //     proyectoCodigo: d.proyecto?.codigo ?? null,
// // //     proyectoNombre: d.proyecto?.nombre ?? null,
// // //     proyectoCiudad: d.proyecto?.ciudad ?? null,
// // //     empresaNombre: d.proyecto?.empresa?.razon_social ?? null,
// // //     empresaNit: d.proyecto?.empresa?.nit ?? null,
// // //     proveedorNombre: d.proveedor?.nombre ?? "(proveedor eliminado)",
// // //     proveedorNit: nitProveedor,
// // //     proveedorDireccion: d.proveedor?.direccion ?? null,
// // //     proveedorCiudad: d.proveedor?.ciudad ?? null,
// // //     proveedorTelefono: d.proveedor?.telefono ?? null,
// // //     proveedorEmail: d.proveedor?.correo ?? null,
// // //     proveedorContacto: d.proveedor?.nombre_contacto ?? null,
// // //     sitioEntrega: d.sitio_entrega,
// // //     fechaEntrega: d.fecha_entrega,
// // //     contactoNombre: d.contacto_nombre,
// // //     telefono: d.telefono,
// // //     ciudad: d.ciudad,
// // //     email: d.email,
// // //     condicionesPago: d.condiciones_pago,
// // //     observaciones: d.observaciones,
// // //     enviada: d.enviada,
// // //     creadaPorNombre: d.creado_por?.nombre ?? null,
// // //     createdAt: d.created_at,
// // //     aprobadaPorNombre: d.aprobada_por_perfil?.nombre ?? null,
// // //     aprobadaAt: d.aprobada_at,
// // //     motivoRechazo: d.motivo_rechazo,
// // //     lineas: (d.lineas ?? []).map((l: any) => ({
// // //       id: l.id,
// // //       insumoCodigo: l.pedido?.insumo?.codigo,
// // //       insumoDescripcion: l.pedido?.insumo?.descripcion ?? "(insumo eliminado)",
// // //       um: l.pedido?.insumo?.u_m ?? null,
// // //       cantidad: Number(l.cantidad),
// // //       precioUnitario: Number(l.precio_unitario),
// // //       porcentajeDescuento: Number(l.porcentaje_descuento),
// // //       porcentajeIva: Number(l.porcentaje_iva),
// // //     })),
// // //   }
// // // }

// // // export async function aprobarOrdenCompra(ordenId: string): Promise<void> {
// // //   await requerirAdmin()
// // //   const supabase = await createClient()
// // //   const { error } = await supabase.rpc("aprobar_orden_compra", { p_orden_id: ordenId })
// // //   if (error) throw new Error(error.message)
// // // }

// // // export async function rechazarOrdenCompra(ordenId: string, motivo: string): Promise<void> {
// // //   await requerirAdmin()
// // //   if (!motivo.trim()) throw new Error("El motivo de rechazo es obligatorio.")
// // //   const supabase = await createClient()
// // //   const { error } = await supabase.rpc("rechazar_orden_compra", {
// // //     p_orden_id: ordenId,
// // //     p_motivo: motivo.trim(),
// // //   })
// // //   if (error) throw new Error(error.message)
// // // }

// // // export async function marcarOrdenEnviada(ordenId: string): Promise<void> {
// // //   await requerirScope("rol_compras")
// // //   const supabase = await createClient()
// // //   const { error } = await supabase.rpc("marcar_orden_enviada", { p_orden_id: ordenId })
// // //   if (error) throw new Error(error.message)
// // // }

// // // export type OrdenCompraListado = {
// // //   id: string
// // //   numero: number
// // //   estado: OrdenCompraEstado
// // //   enviada: boolean
// // //   proyectoCodigo: string | null
// // //   proyectoNombre: string | null
// // //   proveedorNombre: string
// // //   creadaPorNombre: string | null
// // //   createdAt: string
// // // }

// // // // Sin requerirScope a propósito -- la RLS (ordenes_compra_select_proyecto +
// // // // ordenes_compra_select para rol_compras/admin) ya decide qué filas ve cada
// // // // quien. Un ingeniero ve las OC de sus proyectos, Compras/admin las ve todas.
// // // export async function listarTodasLasOrdenesCompra(): Promise<OrdenCompraListado[]> {
// // //   const supabase = await createClient()
// // //   const {
// // //     data: { user },
// // //   } = await supabase.auth.getUser()
// // //   if (!user) throw new Error("No autenticado.")

// // //   const { data, error } = await supabase
// // //     .from("ordenes_compra")
// // //     .select(
// // //       `
// // //       id, numero, estado, enviada, created_at,
// // //       proyecto:proyectos!ordenes_compra_proyecto_id_fkey(codigo, nombre),
// // //       proveedor:proveedores!ordenes_compra_proveedor_id_fkey(nombre),
// // //       creado_por:perfiles!ordenes_compra_created_by_fkey(nombre)
// // //     `
// // //     )
// // //     .order("created_at", { ascending: false })

// // //   if (error) throw new Error(error.message)

// // //   return (data ?? []).map((o: any) => ({
// // //     id: o.id,
// // //     numero: o.numero,
// // //     estado: o.estado,
// // //     enviada: o.enviada,
// // //     proyectoCodigo: o.proyecto?.codigo ?? null,
// // //     proyectoNombre: o.proyecto?.nombre ?? null,
// // //     proveedorNombre: o.proveedor?.nombre ?? "(proveedor eliminado)",
// // //     creadaPorNombre: o.creado_por?.nombre ?? null,
// // //     createdAt: o.created_at,
// // //   }))
// // // }

// // // // ---------------------------------------------------------------------------
// // // // Notificaciones
// // // // ---------------------------------------------------------------------------

// // // export type NotificacionTipo = "pedido_rechazado" | "orden_compra_rechazada"
// // // export type NotificacionEntidadTipo = "pedido_insumo" | "orden_compra"

// // // export type Notificacion = {
// // //   id: string
// // //   tipo: NotificacionTipo
// // //   entidadTipo: NotificacionEntidadTipo
// // //   entidadId: string
// // //   titulo: string
// // //   mensaje: string
// // //   leida: boolean
// // //   createdAt: string
// // // }

// // // // Sin requerirScope -- la RLS (notificaciones_select_propias) ya limita el
// // // // resultado a usuario_id = auth.uid(). Sin paginación por ahora, igual que
// // // // el resto del módulo: revisar si el volumen crece.
// // // export async function listarNotificaciones(): Promise<Notificacion[]> {
// // //   const supabase = await createClient()
// // //   const {
// // //     data: { user },
// // //   } = await supabase.auth.getUser()
// // //   if (!user) throw new Error("No autenticado.")

// // //   const { data, error } = await supabase
// // //     .from("notificaciones")
// // //     .select("id, tipo, entidad_tipo, entidad_id, titulo, mensaje, leida, created_at")
// // //     .order("created_at", { ascending: false })
// // //     .limit(20)

// // //   if (error) throw new Error(error.message)

// // //   return (data ?? []).map((n) => ({
// // //     id: n.id,
// // //     tipo: n.tipo,
// // //     entidadTipo: n.entidad_tipo,
// // //     entidadId: n.entidad_id,
// // //     titulo: n.titulo,
// // //     mensaje: n.mensaje,
// // //     leida: n.leida,
// // //     createdAt: n.created_at,
// // //   }))
// // // }

// // // // El .eq("id", id) es defensivo, no de seguridad -- la policy
// // // // notificaciones_update_propias (usuario_id = auth.uid()) ya impide que
// // // // alguien marque como leída una notificación que no es suya, aunque
// // // // adivine el id.
// // // export async function marcarNotificacionLeida(id: string): Promise<void> {
// // //   const supabase = await createClient()
// // //   const { error } = await supabase.from("notificaciones").update({ leida: true }).eq("id", id)
// // //   if (error) throw new Error(error.message)
// // // }

// // "use server"

// // import { createClient } from "@/lib/supabase/server"
// // import { requerirScope, requerirAdmin } from "@/lib/permisos"

// // // ---------------------------------------------------------------------------
// // // Compras -- cola de pedidos aprobados listos para generar orden de compra
// // // ---------------------------------------------------------------------------

// // export type ProyectoSugerido = { id: string; codigo: string | null; nombre: string }

// // export async function listarProyectosCompras(): Promise<ProyectoSugerido[]> {
// //   await requerirScope("rol_compras")
// //   const supabase = await createClient()

// //   const { data, error } = await supabase
// //     .from("proyectos")
// //     .select("id, codigo, nombre")
// //     .order("codigo", { ascending: false, nullsFirst: false })

// //   if (error) throw new Error(error.message)
// //   return data ?? []
// // }

// // export type InsumoSugerido = { id: string; codigo: number; descripcion: string; u_m: string | null }

// // export async function buscarInsumosCompras(termino: string): Promise<InsumoSugerido[]> {
// //   if (!termino || termino.trim().length < 2) return []
// //   const supabase = await createClient()

// //   const { data, error } = await supabase
// //     .from("maestro_insumos")
// //     .select("id, codigo, descripcion, u_m")
// //     .ilike("descripcion", `%${termino.trim()}%`)
// //     .order("descripcion")
// //     .limit(15)

// //   if (error) throw new Error(error.message)
// //   return data ?? []
// // }

// // export type UsuarioSugerido = { id: string; nombre: string }

// // export async function buscarUsuarios(termino: string): Promise<UsuarioSugerido[]> {
// //   if (!termino || termino.trim().length < 2) return []
// //   const supabase = await createClient()

// //   const { data, error } = await supabase
// //     .from("perfiles")
// //     .select("id, nombre")
// //     .ilike("nombre", `%${termino.trim()}%`)
// //     .order("nombre")
// //     .limit(15)

// //   if (error) throw new Error(error.message)
// //   return data ?? []
// // }

// // export type FiltrosPedidosCompra = {
// //   proyectoId: string
// //   usuarioId?: string | null
// //   insumoId?: string | null
// //   observacion?: string | null
// //   fechaPedidoInicio?: string | null
// //   fechaPedidoFin?: string | null
// //   fechaRequerimientoInicio?: string | null
// //   fechaRequerimientoFin?: string | null
// //   fechaAprobacionInicio?: string | null
// //   fechaAprobacionFin?: string | null
// //   soloUrgentes?: boolean
// // }

// // export type PedidoParaComprar = {
// //   id: string
// //   insumoId: string
// //   insumoCodigo: number
// //   insumoDescripcion: string
// //   um: string | null
// //   cantidad: number
// //   cantidadPendiente: number
// //   valorUnitarioProyectado: number | null
// //   fechaPedido: string
// //   fechaRequerida: string
// //   urgente: boolean
// //   observaciones: string | null
// //   soporteUrl: string | null
// //   solicitadoPorNombre: string | null
// //   resueltoAt: string | null
// // }

// // const SELECT_PEDIDO_PARA_COMPRAR = `
// //   id, cantidad, fecha_requerida, urgente, observaciones, soporte_url, created_at, resuelto_at,
// //   insumo:maestro_insumos!pedidos_insumos_insumo_id_fkey(id, codigo, descripcion, u_m, vr_unitario),
// //   solicitante:perfiles!pedidos_insumos_solicitado_por_fkey(nombre),
// //   compras:ordenes_compra_items!ordenes_compra_items_pedido_insumo_id_fkey(cantidad)
// // `

// // function mapPedidoParaComprar(f: any): PedidoParaComprar {
// //   const yaComprado = (f.compras ?? []).reduce((acc: number, c: any) => acc + Number(c.cantidad), 0)
// //   return {
// //     id: f.id,
// //     insumoId: f.insumo?.id,
// //     insumoCodigo: f.insumo?.codigo,
// //     insumoDescripcion: f.insumo?.descripcion ?? "(insumo eliminado)",
// //     um: f.insumo?.u_m ?? null,
// //     cantidad: Number(f.cantidad),
// //     cantidadPendiente: Number(f.cantidad) - yaComprado,
// //     valorUnitarioProyectado: f.insumo?.vr_unitario ?? null,
// //     fechaPedido: f.created_at,
// //     fechaRequerida: f.fecha_requerida,
// //     urgente: f.urgente,
// //     observaciones: f.observaciones,
// //     soporteUrl: f.soporte_url,
// //     solicitadoPorNombre: f.solicitante?.nombre ?? null,
// //     resueltoAt: f.resuelto_at,
// //   }
// // }

// // export async function listarPedidosParaComprar(
// //   filtros: FiltrosPedidosCompra
// // ): Promise<PedidoParaComprar[]> {
// //   await requerirScope("rol_compras")
// //   const supabase = await createClient()

// //   let query = supabase
// //     .from("pedidos_insumos")
// //     .select(SELECT_PEDIDO_PARA_COMPRAR)
// //     .eq("proyecto_id", filtros.proyectoId)
// //     .eq("estado", "aprobado")
// //     .is("rechazado_compras_at", null)
// //     .order("urgente", { ascending: false })
// //     .order("fecha_requerida", { ascending: true })

// //   if (filtros.usuarioId) query = query.eq("solicitado_por", filtros.usuarioId)
// //   if (filtros.insumoId) query = query.eq("insumo_id", filtros.insumoId)
// //   if (filtros.observacion?.trim()) query = query.ilike("observaciones", `%${filtros.observacion.trim()}%`)
// //   if (filtros.soloUrgentes) query = query.eq("urgente", true)

// //   if (filtros.fechaPedidoInicio) query = query.gte("created_at", filtros.fechaPedidoInicio)
// //   if (filtros.fechaPedidoFin) query = query.lte("created_at", `${filtros.fechaPedidoFin}T23:59:59`)
// //   if (filtros.fechaRequerimientoInicio) query = query.gte("fecha_requerida", filtros.fechaRequerimientoInicio)
// //   if (filtros.fechaRequerimientoFin) query = query.lte("fecha_requerida", filtros.fechaRequerimientoFin)
// //   if (filtros.fechaAprobacionInicio) query = query.gte("resuelto_at", filtros.fechaAprobacionInicio)
// //   if (filtros.fechaAprobacionFin) query = query.lte("resuelto_at", `${filtros.fechaAprobacionFin}T23:59:59`)

// //   const { data, error } = await query
// //   if (error) throw new Error(error.message)

// //   return (data ?? []).map(mapPedidoParaComprar).filter((p) => p.cantidadPendiente > 0)
// // }

// // export async function obtenerPedidosPorId(ids: string[]): Promise<PedidoParaComprar[]> {
// //   await requerirScope("rol_compras")
// //   if (ids.length === 0) return []
// //   const supabase = await createClient()

// //   const { data, error } = await supabase
// //     .from("pedidos_insumos")
// //     .select(SELECT_PEDIDO_PARA_COMPRAR)
// //     .in("id", ids)
// //     .eq("estado", "aprobado")
// //     .is("rechazado_compras_at", null)

// //   if (error) throw new Error(error.message)

// //   return (data ?? []).map(mapPedidoParaComprar).filter((p) => p.cantidadPendiente > 0)
// // }

// // export async function rechazarPedidoCompras(pedidoId: string, motivo: string): Promise<void> {
// //   await requerirScope("rol_compras")
// //   const supabase = await createClient()

// //   const {
// //     data: { user },
// //   } = await supabase.auth.getUser()

// //   const { error } = await supabase
// //     .from("pedidos_insumos")
// //     .update({
// //       rechazado_compras_at: new Date().toISOString(),
// //       rechazado_compras_por: user?.id ?? null,
// //       observaciones_compras: motivo,
// //     })
// //     .eq("id", pedidoId)

// //   if (error) throw new Error(error.message)
// // }

// // // ---------------------------------------------------------------------------
// // // Generar OC
// // // ---------------------------------------------------------------------------

// // export type ProveedorSugerido = {
// //   id: string
// //   nombre: string
// //   idProv: string | null
// //   tipoProveedor: string | null
// // }

// // export async function buscarProveedores(termino: string): Promise<ProveedorSugerido[]> {
// //   await requerirScope("rol_compras")
// //   if (!termino || termino.trim().length < 2) return []
// //   const supabase = await createClient()

// //   const { data, error } = await supabase
// //     .from("proveedores")
// //     .select("unique_id, nombre, id_prov, tipo_proveedor")
// //     .eq("estado", "ACTIVO")
// //     .ilike("nombre", `%${termino.trim()}%`)
// //     .order("nombre")
// //     .limit(15)

// //   if (error) throw new Error(error.message)
// //   return (data ?? []).map((p) => ({
// //     id: p.unique_id,
// //     nombre: p.nombre,
// //     idProv: p.id_prov,
// //     tipoProveedor: p.tipo_proveedor,
// //   }))
// // }

// // export type InformacionBancariaProveedor = {
// //   titular: string | null
// //   entidadBancaria: string | null
// //   tipoCuenta: string | null
// //   noCuenta: string | null
// // }

// // export type ProveedorDetalle = {
// //   id: string
// //   nombre: string
// //   nombreContacto: string | null
// //   telefono: string | null
// //   correo: string | null
// //   ciudad: string | null
// //   direccion: string | null
// //   informacionBancaria: InformacionBancariaProveedor | null
// // }

// // export async function obtenerProveedorDetalle(proveedorId: string): Promise<ProveedorDetalle> {
// //   await requerirScope("rol_compras")
// //   const supabase = await createClient()

// //   const { data, error } = await supabase
// //     .from("proveedores")
// //     .select(
// //       `
// //       unique_id, nombre, nombre_contacto, telefono, correo, ciudad, direccion,
// //       informacion_bancaria!informacion_bancaria_id_fkey(titular, entidad_bancaria, tipo_cuenta, no_cuenta)
// //     `
// //     )
// //     .eq("unique_id", proveedorId)
// //     .single()

// //   if (error) throw new Error(error.message)

// //   const d = data as any
// //   const banco = Array.isArray(d.informacion_bancaria) ? d.informacion_bancaria[0] : d.informacion_bancaria

// //   return {
// //     id: d.unique_id,
// //     nombre: d.nombre,
// //     nombreContacto: d.nombre_contacto,
// //     telefono: d.telefono,
// //     correo: d.correo,
// //     ciudad: d.ciudad,
// //     direccion: d.direccion,
// //     informacionBancaria: banco
// //       ? {
// //           titular: banco.titular,
// //           entidadBancaria: banco.entidad_bancaria,
// //           tipoCuenta: banco.tipo_cuenta,
// //           noCuenta: banco.no_cuenta,
// //         }
// //       : null,
// //   }
// // }

// // export type LineaOrdenCompra = {
// //   pedidoId: string
// //   cantidadComprar: number
// //   precioUnitario: number
// //   porcentajeDescuento: number
// //   porcentajeIva: number
// // }

// // export type DatosOrdenCompra = {
// //   proyectoId: string
// //   proveedorId: string
// //   sitioEntrega?: string | null
// //   fechaEntrega?: string | null
// //   contactoNombre?: string | null
// //   telefono?: string | null
// //   ciudad?: string | null
// //   email?: string | null
// //   condicionesPago?: string | null
// //   observaciones?: string | null
// //   lineas: LineaOrdenCompra[]
// // }

// // export async function crearOrdenCompra(datos: DatosOrdenCompra): Promise<string> {
// //   await requerirScope("rol_compras")

// //   if (datos.lineas.length === 0) {
// //     throw new Error("Selecciona al menos un insumo para la orden de compra.")
// //   }

// //   const supabase = await createClient()

// //     const { data, error } = await supabase.rpc("crear_orden_compra", {
// //     p_proyecto_id: datos.proyectoId,
// //     p_proveedor_id: datos.proveedorId,
// //     p_sitio_entrega: datos.sitioEntrega ?? null,
// //     p_fecha_entrega: datos.fechaEntrega ?? null,
// //     p_contacto_nombre: datos.contactoNombre ?? null,
// //     p_telefono: datos.telefono ?? null,
// //     p_ciudad: datos.ciudad ?? null,
// //     p_email: datos.email ?? null,
// //     p_condiciones_pago: datos.condicionesPago ?? null,
// //     p_observaciones: datos.observaciones ?? null,
// //     p_lineas: datos.lineas.map((l) => ({
// //       pedido_id: l.pedidoId,
// //       cantidad_comprar: l.cantidadComprar,
// //       precio_unitario: l.precioUnitario,
// //       porcentaje_descuento: l.porcentajeDescuento,
// //       porcentaje_iva: l.porcentajeIva,
// //     })),
// //   })

// //   if (error) throw new Error(error.message)
// //   return data as string
// // }

// // // ---------------------------------------------------------------------------
// // // Aprobación de OC + pantalla de detalle
// // // ---------------------------------------------------------------------------

// // export type PermisosOrdenCompra = { esAdmin: boolean; rolCompras: boolean }

// // export async function obtenerPermisosOrdenCompra(): Promise<PermisosOrdenCompra> {
// //   const supabase = await createClient()
// //   const {
// //     data: { user },
// //   } = await supabase.auth.getUser()
// //   if (!user) return { esAdmin: false, rolCompras: false }

// //   const { data, error } = await supabase
// //     .from("perfiles")
// //     .select("es_admin, rol_compras")
// //     .eq("id", user.id)
// //     .single()

// //   if (error) throw new Error(error.message)
// //   return { esAdmin: data.es_admin, rolCompras: data.rol_compras }
// // }

// // export type OrdenCompraResumen = {
// //   id: string
// //   numero: number
// //   proyectoCodigo: string | null
// //   proyectoNombre: string | null
// //   proveedorNombre: string
// //   creadaPorNombre: string | null
// //   createdAt: string
// //   totalLineas: number
// // }

// // export async function listarOrdenesCompraPendientes(): Promise<OrdenCompraResumen[]> {
// //   await requerirAdmin()
// //   const supabase = await createClient()

// //   const { data, error } = await supabase
// //     .from("ordenes_compra")
// //     .select(
// //       `
// //       id, numero, created_at,
// //       proyecto:proyectos!ordenes_compra_proyecto_id_fkey(codigo, nombre),
// //       proveedor:proveedores!ordenes_compra_proveedor_id_fkey(nombre),
// //       creado_por:perfiles!ordenes_compra_created_by_fkey(nombre),
// //       lineas:ordenes_compra_items!ordenes_compra_items_orden_compra_id_fkey(id)
// //     `
// //     )
// //     .eq("estado", "pendiente_aprobacion")
// //     .order("created_at", { ascending: true })

// //   if (error) throw new Error(error.message)

// //   return (data ?? []).map((o: any) => ({
// //     id: o.id,
// //     numero: o.numero,
// //     proyectoCodigo: o.proyecto?.codigo ?? null,
// //     proyectoNombre: o.proyecto?.nombre ?? null,
// //     proveedorNombre: o.proveedor?.nombre ?? "(proveedor eliminado)",
// //     creadaPorNombre: o.creado_por?.nombre ?? null,
// //     createdAt: o.created_at,
// //     totalLineas: (o.lineas ?? []).length,
// //   }))
// // }

// // export type OrdenCompraEstado = "pendiente_aprobacion" | "aprobada" | "rechazada"

// // export type LineaOrdenCompraDetalle = {
// //   id: string
// //   insumoCodigo: number
// //   insumoDescripcion: string
// //   um: string | null
// //   cantidad: number
// //   precioUnitario: number
// //   porcentajeDescuento: number
// //   porcentajeIva: number
// // }

// // export type OrdenCompraDetalle = {
// //   id: string
// //   numero: number
// //   estado: OrdenCompraEstado
// //   proyectoCodigo: string | null
// //   proyectoNombre: string | null
// //   proyectoCiudad: string | null
// //   empresaNombre: string | null
// //   empresaNit: string | null
// //   proveedorNombre: string
// //   proveedorNit: string | null
// //   proveedorDireccion: string | null
// //   proveedorCiudad: string | null
// //   proveedorTelefono: string | null
// //   proveedorEmail: string | null
// //   proveedorContacto: string | null
// //   sitioEntrega: string | null
// //   fechaEntrega: string | null
// //   contactoNombre: string | null
// //   telefono: string | null
// //   ciudad: string | null
// //   email: string | null
// //   condicionesPago: string | null
// //   observaciones: string | null
// //   enviada: boolean
// //   creadaPorNombre: string | null
// //   createdAt: string
// //   aprobadaPorNombre: string | null
// //   aprobadaAt: string | null
// //   motivoRechazo: string | null
// //   lineas: LineaOrdenCompraDetalle[]
// // }
// // export async function obtenerOrdenCompraDetalle(ordenId: string): Promise<OrdenCompraDetalle> {
// //   const supabase = await createClient()
// //   const {
// //     data: { user },
// //   } = await supabase.auth.getUser()
// //   if (!user) throw new Error("No autenticado.")

// //   const { data, error } = await supabase
// //     .from("ordenes_compra")
// //     .select(
// //       `
// //       id, numero, estado, sitio_entrega, fecha_entrega, contacto_nombre, telefono, ciudad, email,
// //       condiciones_pago, observaciones, enviada, created_at, aprobada_at, motivo_rechazo,
// //       proyecto:proyectos!ordenes_compra_proyecto_id_fkey(codigo, nombre, ciudad, empresa:empresas(nit, razon_social)),
// //       proveedor:proveedores!ordenes_compra_proveedor_id_fkey(
// //         nombre, numero_documento, digito_verificacion, direccion, ciudad, telefono, correo, nombre_contacto
// //       ),
// //       creado_por:perfiles!ordenes_compra_created_by_fkey(nombre),
// //       aprobada_por_perfil:perfiles!ordenes_compra_aprobada_por_fkey(nombre),
// //       lineas:ordenes_compra_items!ordenes_compra_items_orden_compra_id_fkey(
// //         id, cantidad, precio_unitario, porcentaje_descuento, porcentaje_iva,
// //         pedido:pedidos_insumos!ordenes_compra_items_pedido_insumo_id_fkey(
// //           insumo:maestro_insumos!pedidos_insumos_insumo_id_fkey(codigo, descripcion, u_m)
// //         )
// //       )
// //     `
// //     )
// //     .eq("id", ordenId)
// //     .single()

// //   if (error) throw new Error(error.message)

// //   const d = data as any
// //   const nitProveedor = d.proveedor?.numero_documento
// //     ? `${d.proveedor.numero_documento}${d.proveedor.digito_verificacion ? `-${d.proveedor.digito_verificacion}` : ""}`
// //     : null

// //   return {
// //     id: d.id,
// //     numero: d.numero,
// //     estado: d.estado,
// //     proyectoCodigo: d.proyecto?.codigo ?? null,
// //     proyectoNombre: d.proyecto?.nombre ?? null,
// //     proyectoCiudad: d.proyecto?.ciudad ?? null,
// //     empresaNombre: d.proyecto?.empresa?.razon_social ?? null,
// //     empresaNit: d.proyecto?.empresa?.nit ?? null,
// //     proveedorNombre: d.proveedor?.nombre ?? "(proveedor eliminado)",
// //     proveedorNit: nitProveedor,
// //     proveedorDireccion: d.proveedor?.direccion ?? null,
// //     proveedorCiudad: d.proveedor?.ciudad ?? null,
// //     proveedorTelefono: d.proveedor?.telefono ?? null,
// //     proveedorEmail: d.proveedor?.correo ?? null,
// //     proveedorContacto: d.proveedor?.nombre_contacto ?? null,
// //     sitioEntrega: d.sitio_entrega,
// //     fechaEntrega: d.fecha_entrega,
// //     contactoNombre: d.contacto_nombre,
// //     telefono: d.telefono,
// //     ciudad: d.ciudad,
// //     email: d.email,
// //     condicionesPago: d.condiciones_pago,
// //     observaciones: d.observaciones,
// //     enviada: d.enviada,
// //     creadaPorNombre: d.creado_por?.nombre ?? null,
// //     createdAt: d.created_at,
// //     aprobadaPorNombre: d.aprobada_por_perfil?.nombre ?? null,
// //     aprobadaAt: d.aprobada_at,
// //     motivoRechazo: d.motivo_rechazo,
// //     lineas: (d.lineas ?? []).map((l: any) => ({
// //       id: l.id,
// //       insumoCodigo: l.pedido?.insumo?.codigo,
// //       insumoDescripcion: l.pedido?.insumo?.descripcion ?? "(insumo eliminado)",
// //       um: l.pedido?.insumo?.u_m ?? null,
// //       cantidad: Number(l.cantidad),
// //       precioUnitario: Number(l.precio_unitario),
// //       porcentajeDescuento: Number(l.porcentaje_descuento),
// //       porcentajeIva: Number(l.porcentaje_iva),
// //     })),
// //   }
// // }

// // export async function aprobarOrdenCompra(ordenId: string): Promise<void> {
// //   await requerirAdmin()
// //   const supabase = await createClient()
// //   const { error } = await supabase.rpc("aprobar_orden_compra", { p_orden_id: ordenId })
// //   if (error) throw new Error(error.message)
// // }

// // export async function rechazarOrdenCompra(ordenId: string, motivo: string): Promise<void> {
// //   await requerirAdmin()
// //   if (!motivo.trim()) throw new Error("El motivo de rechazo es obligatorio.")
// //   const supabase = await createClient()
// //   const { error } = await supabase.rpc("rechazar_orden_compra", {
// //     p_orden_id: ordenId,
// //     p_motivo: motivo.trim(),
// //   })
// //   if (error) throw new Error(error.message)
// // }

// // export async function marcarOrdenEnviada(ordenId: string): Promise<void> {
// //   await requerirScope("rol_compras")
// //   const supabase = await createClient()
// //   const { error } = await supabase.rpc("marcar_orden_enviada", { p_orden_id: ordenId })
// //   if (error) throw new Error(error.message)
// // }

// // export type OrdenCompraListado = {
// //   id: string
// //   numero: number
// //   estado: OrdenCompraEstado
// //   enviada: boolean
// //   proyectoCodigo: string | null
// //   proyectoNombre: string | null
// //   proveedorNombre: string
// //   creadaPorNombre: string | null
// //   createdAt: string
// // }

// // // Sin requerirScope a propósito -- la RLS (ordenes_compra_select_proyecto +
// // // ordenes_compra_select para rol_compras/admin) ya decide qué filas ve cada
// // // quien. Un ingeniero ve las OC de sus proyectos, Compras/admin las ve todas.
// // export async function listarTodasLasOrdenesCompra(): Promise<OrdenCompraListado[]> {
// //   const supabase = await createClient()
// //   const {
// //     data: { user },
// //   } = await supabase.auth.getUser()
// //   if (!user) throw new Error("No autenticado.")

// //   const { data, error } = await supabase
// //     .from("ordenes_compra")
// //     .select(
// //       `
// //       id, numero, estado, enviada, created_at,
// //       proyecto:proyectos!ordenes_compra_proyecto_id_fkey(codigo, nombre),
// //       proveedor:proveedores!ordenes_compra_proveedor_id_fkey(nombre),
// //       creado_por:perfiles!ordenes_compra_created_by_fkey(nombre)
// //     `
// //     )
// //     .order("created_at", { ascending: false })

// //   if (error) throw new Error(error.message)

// //   return (data ?? []).map((o: any) => ({
// //     id: o.id,
// //     numero: o.numero,
// //     estado: o.estado,
// //     enviada: o.enviada,
// //     proyectoCodigo: o.proyecto?.codigo ?? null,
// //     proyectoNombre: o.proyecto?.nombre ?? null,
// //     proveedorNombre: o.proveedor?.nombre ?? "(proveedor eliminado)",
// //     creadaPorNombre: o.creado_por?.nombre ?? null,
// //     createdAt: o.created_at,
// //   }))
// // }

// // // ---------------------------------------------------------------------------
// // // Notificaciones
// // // ---------------------------------------------------------------------------

// // export type NotificacionTipo = "pedido_rechazado" | "orden_compra_rechazada" | "insumo_sobre_presupuesto"
// // export type NotificacionEntidadTipo = "pedido_insumo" | "orden_compra"

// // export type Notificacion = {
// //   id: string
// //   tipo: NotificacionTipo
// //   entidadTipo: NotificacionEntidadTipo
// //   entidadId: string
// //   titulo: string
// //   mensaje: string
// //   leida: boolean
// //   createdAt: string
// // }

// // // Sin requerirScope -- la RLS (notificaciones_select_propias) ya limita el
// // // resultado a usuario_id = auth.uid(). Sin paginación por ahora, igual que
// // // el resto del módulo: revisar si el volumen crece.
// // export async function listarNotificaciones(): Promise<Notificacion[]> {
// //   const supabase = await createClient()
// //   const {
// //     data: { user },
// //   } = await supabase.auth.getUser()
// //   if (!user) throw new Error("No autenticado.")

// //   const { data, error } = await supabase
// //     .from("notificaciones")
// //     .select("id, tipo, entidad_tipo, entidad_id, titulo, mensaje, leida, created_at")
// //     .order("created_at", { ascending: false })
// //     .limit(20)

// //   if (error) throw new Error(error.message)

// //   return (data ?? []).map((n) => ({
// //     id: n.id,
// //     tipo: n.tipo,
// //     entidadTipo: n.entidad_tipo,
// //     entidadId: n.entidad_id,
// //     titulo: n.titulo,
// //     mensaje: n.mensaje,
// //     leida: n.leida,
// //     createdAt: n.created_at,
// //   }))
// // }

// // // El .eq("id", id) es defensivo, no de seguridad -- la policy
// // // notificaciones_update_propias (usuario_id = auth.uid()) ya impide que
// // // alguien marque como leída una notificación que no es suya, aunque
// // // adivine el id.
// // export async function marcarNotificacionLeida(id: string): Promise<void> {
// //   const supabase = await createClient()
// //   const { error } = await supabase.from("notificaciones").update({ leida: true }).eq("id", id)
// //   if (error) throw new Error(error.message)
// // }

// // "use server"

// // import { createClient } from "@/lib/supabase/server"
// // import { requerirScope, requerirAdmin } from "@/lib/permisos"

// // // ---------------------------------------------------------------------------
// // // Compras -- cola de pedidos aprobados listos para generar orden de compra
// // // ---------------------------------------------------------------------------

// // export type ProyectoSugerido = { id: string; codigo: string | null; nombre: string }

// // export async function listarProyectosCompras(): Promise<ProyectoSugerido[]> {
// //   await requerirScope("rol_compras")
// //   const supabase = await createClient()

// //   const { data, error } = await supabase
// //     .from("proyectos")
// //     .select("id, codigo, nombre")
// //     .order("codigo", { ascending: false, nullsFirst: false })

// //   if (error) throw new Error(error.message)
// //   return data ?? []
// // }

// // export type InsumoSugerido = { id: string; codigo: number; descripcion: string; u_m: string | null }

// // export async function buscarInsumosCompras(termino: string): Promise<InsumoSugerido[]> {
// //   if (!termino || termino.trim().length < 2) return []
// //   const supabase = await createClient()

// //   const { data, error } = await supabase
// //     .from("maestro_insumos")
// //     .select("id, codigo, descripcion, u_m")
// //     .ilike("descripcion", `%${termino.trim()}%`)
// //     .order("descripcion")
// //     .limit(15)

// //   if (error) throw new Error(error.message)
// //   return data ?? []
// // }

// // export type UsuarioSugerido = { id: string; nombre: string }

// // export async function buscarUsuarios(termino: string): Promise<UsuarioSugerido[]> {
// //   if (!termino || termino.trim().length < 2) return []
// //   const supabase = await createClient()

// //   const { data, error } = await supabase
// //     .from("perfiles")
// //     .select("id, nombre")
// //     .ilike("nombre", `%${termino.trim()}%`)
// //     .order("nombre")
// //     .limit(15)

// //   if (error) throw new Error(error.message)
// //   return data ?? []
// // }

// // export type FiltrosPedidosCompra = {
// //   proyectoId: string
// //   usuarioId?: string | null
// //   insumoId?: string | null
// //   observacion?: string | null
// //   fechaPedidoInicio?: string | null
// //   fechaPedidoFin?: string | null
// //   fechaRequerimientoInicio?: string | null
// //   fechaRequerimientoFin?: string | null
// //   fechaAprobacionInicio?: string | null
// //   fechaAprobacionFin?: string | null
// //   soloUrgentes?: boolean
// // }

// // export type PedidoParaComprar = {
// //   id: string
// //   insumoId: string
// //   insumoCodigo: number
// //   insumoDescripcion: string
// //   um: string | null
// //   cantidad: number
// //   cantidadPendiente: number
// //   valorUnitarioProyectado: number | null
// //   fechaPedido: string
// //   fechaRequerida: string
// //   urgente: boolean
// //   observaciones: string | null
// //   soporteUrl: string | null
// //   solicitadoPorNombre: string | null
// //   resueltoAt: string | null
// // }

// // const SELECT_PEDIDO_PARA_COMPRAR = `
// //   id, cantidad, fecha_requerida, urgente, observaciones, soporte_url, created_at, resuelto_at,
// //   insumo:maestro_insumos!pedidos_insumos_insumo_id_fkey(id, codigo, descripcion, u_m, vr_unitario),
// //   solicitante:perfiles!pedidos_insumos_solicitado_por_fkey(nombre),
// //   compras:ordenes_compra_items!ordenes_compra_items_pedido_insumo_id_fkey(cantidad)
// // `

// // function mapPedidoParaComprar(f: any): PedidoParaComprar {
// //   const yaComprado = (f.compras ?? []).reduce((acc: number, c: any) => acc + Number(c.cantidad), 0)
// //   return {
// //     id: f.id,
// //     insumoId: f.insumo?.id,
// //     insumoCodigo: f.insumo?.codigo,
// //     insumoDescripcion: f.insumo?.descripcion ?? "(insumo eliminado)",
// //     um: f.insumo?.u_m ?? null,
// //     cantidad: Number(f.cantidad),
// //     cantidadPendiente: Number(f.cantidad) - yaComprado,
// //     valorUnitarioProyectado: f.insumo?.vr_unitario ?? null,
// //     fechaPedido: f.created_at,
// //     fechaRequerida: f.fecha_requerida,
// //     urgente: f.urgente,
// //     observaciones: f.observaciones,
// //     soporteUrl: f.soporte_url,
// //     solicitadoPorNombre: f.solicitante?.nombre ?? null,
// //     resueltoAt: f.resuelto_at,
// //   }
// // }

// // export async function listarPedidosParaComprar(
// //   filtros: FiltrosPedidosCompra
// // ): Promise<PedidoParaComprar[]> {
// //   await requerirScope("rol_compras")
// //   const supabase = await createClient()

// //   let query = supabase
// //     .from("pedidos_insumos")
// //     .select(SELECT_PEDIDO_PARA_COMPRAR)
// //     .eq("proyecto_id", filtros.proyectoId)
// //     .eq("estado", "aprobado")
// //     .is("rechazado_compras_at", null)
// //     .order("urgente", { ascending: false })
// //     .order("fecha_requerida", { ascending: true })

// //   if (filtros.usuarioId) query = query.eq("solicitado_por", filtros.usuarioId)
// //   if (filtros.insumoId) query = query.eq("insumo_id", filtros.insumoId)
// //   if (filtros.observacion?.trim()) query = query.ilike("observaciones", `%${filtros.observacion.trim()}%`)
// //   if (filtros.soloUrgentes) query = query.eq("urgente", true)

// //   if (filtros.fechaPedidoInicio) query = query.gte("created_at", filtros.fechaPedidoInicio)
// //   if (filtros.fechaPedidoFin) query = query.lte("created_at", `${filtros.fechaPedidoFin}T23:59:59`)
// //   if (filtros.fechaRequerimientoInicio) query = query.gte("fecha_requerida", filtros.fechaRequerimientoInicio)
// //   if (filtros.fechaRequerimientoFin) query = query.lte("fecha_requerida", filtros.fechaRequerimientoFin)
// //   if (filtros.fechaAprobacionInicio) query = query.gte("resuelto_at", filtros.fechaAprobacionInicio)
// //   if (filtros.fechaAprobacionFin) query = query.lte("resuelto_at", `${filtros.fechaAprobacionFin}T23:59:59`)

// //   const { data, error } = await query
// //   if (error) throw new Error(error.message)

// //   return (data ?? []).map(mapPedidoParaComprar).filter((p) => p.cantidadPendiente > 0)
// // }

// // export async function obtenerPedidosPorId(ids: string[]): Promise<PedidoParaComprar[]> {
// //   await requerirScope("rol_compras")
// //   if (ids.length === 0) return []
// //   const supabase = await createClient()

// //   const { data, error } = await supabase
// //     .from("pedidos_insumos")
// //     .select(SELECT_PEDIDO_PARA_COMPRAR)
// //     .in("id", ids)
// //     .eq("estado", "aprobado")
// //     .is("rechazado_compras_at", null)

// //   if (error) throw new Error(error.message)

// //   return (data ?? []).map(mapPedidoParaComprar).filter((p) => p.cantidadPendiente > 0)
// // }

// // export async function rechazarPedidoCompras(pedidoId: string, motivo: string): Promise<void> {
// //   await requerirScope("rol_compras")
// //   const supabase = await createClient()

// //   const {
// //     data: { user },
// //   } = await supabase.auth.getUser()

// //   const { error } = await supabase
// //     .from("pedidos_insumos")
// //     .update({
// //       rechazado_compras_at: new Date().toISOString(),
// //       rechazado_compras_por: user?.id ?? null,
// //       observaciones_compras: motivo,
// //     })
// //     .eq("id", pedidoId)

// //   if (error) throw new Error(error.message)
// // }

// // // ---------------------------------------------------------------------------
// // // Generar OC
// // // ---------------------------------------------------------------------------

// // export type ProveedorSugerido = {
// //   id: string
// //   nombre: string
// //   idProv: string | null
// //   tipoProveedor: string | null
// // }

// // export async function buscarProveedores(termino: string): Promise<ProveedorSugerido[]> {
// //   await requerirScope("rol_compras")
// //   if (!termino || termino.trim().length < 2) return []
// //   const supabase = await createClient()

// //   const { data, error } = await supabase
// //     .from("proveedores")
// //     .select("unique_id, nombre, id_prov, tipo_proveedor")
// //     .eq("estado", "ACTIVO")
// //     .ilike("nombre", `%${termino.trim()}%`)
// //     .order("nombre")
// //     .limit(15)

// //   if (error) throw new Error(error.message)
// //   return (data ?? []).map((p) => ({
// //     id: p.unique_id,
// //     nombre: p.nombre,
// //     idProv: p.id_prov,
// //     tipoProveedor: p.tipo_proveedor,
// //   }))
// // }

// // export type InformacionBancariaProveedor = {
// //   titular: string | null
// //   entidadBancaria: string | null
// //   tipoCuenta: string | null
// //   noCuenta: string | null
// // }

// // export type ProveedorDetalle = {
// //   id: string
// //   nombre: string
// //   nombreContacto: string | null
// //   telefono: string | null
// //   correo: string | null
// //   ciudad: string | null
// //   direccion: string | null
// //   informacionBancaria: InformacionBancariaProveedor | null
// // }

// // export async function obtenerProveedorDetalle(proveedorId: string): Promise<ProveedorDetalle> {
// //   await requerirScope("rol_compras")
// //   const supabase = await createClient()

// //   const { data, error } = await supabase
// //     .from("proveedores")
// //     .select(
// //       `
// //       unique_id, nombre, nombre_contacto, telefono, correo, ciudad, direccion,
// //       informacion_bancaria!informacion_bancaria_id_fkey(titular, entidad_bancaria, tipo_cuenta, no_cuenta)
// //     `
// //     )
// //     .eq("unique_id", proveedorId)
// //     .single()

// //   if (error) throw new Error(error.message)

// //   const d = data as any
// //   const banco = Array.isArray(d.informacion_bancaria) ? d.informacion_bancaria[0] : d.informacion_bancaria

// //   return {
// //     id: d.unique_id,
// //     nombre: d.nombre,
// //     nombreContacto: d.nombre_contacto,
// //     telefono: d.telefono,
// //     correo: d.correo,
// //     ciudad: d.ciudad,
// //     direccion: d.direccion,
// //     informacionBancaria: banco
// //       ? {
// //           titular: banco.titular,
// //           entidadBancaria: banco.entidad_bancaria,
// //           tipoCuenta: banco.tipo_cuenta,
// //           noCuenta: banco.no_cuenta,
// //         }
// //       : null,
// //   }
// // }

// // export type LineaOrdenCompra = {
// //   pedidoId: string
// //   cantidadComprar: number
// //   precioUnitario: number
// //   porcentajeDescuento: number
// //   porcentajeIva: number
// // }

// // export type DatosOrdenCompra = {
// //   proyectoId: string
// //   proveedorId: string
// //   sitioEntrega?: string | null
// //   fechaEntrega?: string | null
// //   contactoNombre?: string | null
// //   telefono?: string | null
// //   ciudad?: string | null
// //   email?: string | null
// //   condicionesPago?: string | null
// //   observaciones?: string | null
// //   lineas: LineaOrdenCompra[]
// // }

// // export async function crearOrdenCompra(datos: DatosOrdenCompra): Promise<string> {
// //   await requerirScope("rol_compras")

// //   if (datos.lineas.length === 0) {
// //     throw new Error("Selecciona al menos un insumo para la orden de compra.")
// //   }

// //   const supabase = await createClient()

// //     const { data, error } = await supabase.rpc("crear_orden_compra", {
// //     p_proyecto_id: datos.proyectoId,
// //     p_proveedor_id: datos.proveedorId,
// //     p_sitio_entrega: datos.sitioEntrega ?? null,
// //     p_fecha_entrega: datos.fechaEntrega ?? null,
// //     p_contacto_nombre: datos.contactoNombre ?? null,
// //     p_telefono: datos.telefono ?? null,
// //     p_ciudad: datos.ciudad ?? null,
// //     p_email: datos.email ?? null,
// //     p_condiciones_pago: datos.condicionesPago ?? null,
// //     p_observaciones: datos.observaciones ?? null,
// //     p_lineas: datos.lineas.map((l) => ({
// //       pedido_id: l.pedidoId,
// //       cantidad_comprar: l.cantidadComprar,
// //       precio_unitario: l.precioUnitario,
// //       porcentaje_descuento: l.porcentajeDescuento,
// //       porcentaje_iva: l.porcentajeIva,
// //     })),
// //   })

// //   if (error) throw new Error(error.message)
// //   return data as string
// // }

// // // ---------------------------------------------------------------------------
// // // Aprobación de OC + pantalla de detalle
// // // ---------------------------------------------------------------------------

// // export type PermisosOrdenCompra = { esAdmin: boolean; rolCompras: boolean }

// // export async function obtenerPermisosOrdenCompra(): Promise<PermisosOrdenCompra> {
// //   const supabase = await createClient()
// //   const {
// //     data: { user },
// //   } = await supabase.auth.getUser()
// //   if (!user) return { esAdmin: false, rolCompras: false }

// //   const { data, error } = await supabase
// //     .from("perfiles")
// //     .select("es_admin, rol_compras")
// //     .eq("id", user.id)
// //     .single()

// //   if (error) throw new Error(error.message)
// //   return { esAdmin: data.es_admin, rolCompras: data.rol_compras }
// // }

// // export type OrdenCompraResumen = {
// //   id: string
// //   numero: number
// //   proyectoCodigo: string | null
// //   proyectoNombre: string | null
// //   proveedorNombre: string
// //   creadaPorNombre: string | null
// //   createdAt: string
// //   totalLineas: number
// // }

// // export async function listarOrdenesCompraPendientes(): Promise<OrdenCompraResumen[]> {
// //   await requerirAdmin()
// //   const supabase = await createClient()

// //   const { data, error } = await supabase
// //     .from("ordenes_compra")
// //     .select(
// //       `
// //       id, numero, created_at,
// //       proyecto:proyectos!ordenes_compra_proyecto_id_fkey(codigo, nombre),
// //       proveedor:proveedores!ordenes_compra_proveedor_id_fkey(nombre),
// //       creado_por:perfiles!ordenes_compra_created_by_fkey(nombre),
// //       lineas:ordenes_compra_items!ordenes_compra_items_orden_compra_id_fkey(id)
// //     `
// //     )
// //     .eq("estado", "pendiente_aprobacion")
// //     .order("created_at", { ascending: true })

// //   if (error) throw new Error(error.message)

// //   return (data ?? []).map((o: any) => ({
// //     id: o.id,
// //     numero: o.numero,
// //     proyectoCodigo: o.proyecto?.codigo ?? null,
// //     proyectoNombre: o.proyecto?.nombre ?? null,
// //     proveedorNombre: o.proveedor?.nombre ?? "(proveedor eliminado)",
// //     creadaPorNombre: o.creado_por?.nombre ?? null,
// //     createdAt: o.created_at,
// //     totalLineas: (o.lineas ?? []).length,
// //   }))
// // }

// // export type OrdenCompraEstado = "pendiente_aprobacion" | "aprobada" | "rechazada"

// // export type LineaOrdenCompraDetalle = {
// //   id: string
// //   insumoCodigo: number
// //   insumoDescripcion: string
// //   um: string | null
// //   cantidad: number
// //   precioUnitario: number
// //   porcentajeDescuento: number
// //   porcentajeIva: number
// // }

// // export type OrdenCompraDetalle = {
// //   id: string
// //   numero: number
// //   estado: OrdenCompraEstado
// //   proyectoCodigo: string | null
// //   proyectoNombre: string | null
// //   proyectoCiudad: string | null
// //   empresaNombre: string | null
// //   empresaNit: string | null
// //   proveedorNombre: string
// //   proveedorNit: string | null
// //   proveedorDireccion: string | null
// //   proveedorCiudad: string | null
// //   proveedorTelefono: string | null
// //   proveedorEmail: string | null
// //   proveedorContacto: string | null
// //   sitioEntrega: string | null
// //   fechaEntrega: string | null
// //   contactoNombre: string | null
// //   telefono: string | null
// //   ciudad: string | null
// //   email: string | null
// //   condicionesPago: string | null
// //   observaciones: string | null
// //   enviada: boolean
// //   creadaPorNombre: string | null
// //   createdAt: string
// //   aprobadaPorNombre: string | null
// //   aprobadaAt: string | null
// //   motivoRechazo: string | null
// //   lineas: LineaOrdenCompraDetalle[]
// // }
// // export async function obtenerOrdenCompraDetalle(ordenId: string): Promise<OrdenCompraDetalle> {
// //   const supabase = await createClient()
// //   const {
// //     data: { user },
// //   } = await supabase.auth.getUser()
// //   if (!user) throw new Error("No autenticado.")

// //   const { data, error } = await supabase
// //     .from("ordenes_compra")
// //     .select(
// //       `
// //       id, numero, estado, sitio_entrega, fecha_entrega, contacto_nombre, telefono, ciudad, email,
// //       condiciones_pago, observaciones, enviada, created_at, aprobada_at, motivo_rechazo,
// //       proyecto:proyectos!ordenes_compra_proyecto_id_fkey(codigo, nombre, ciudad, empresa:empresas(nit, razon_social)),
// //       proveedor:proveedores!ordenes_compra_proveedor_id_fkey(
// //         nombre, numero_documento, digito_verificacion, direccion, ciudad, telefono, correo, nombre_contacto
// //       ),
// //       creado_por:perfiles!ordenes_compra_created_by_fkey(nombre),
// //       aprobada_por_perfil:perfiles!ordenes_compra_aprobada_por_fkey(nombre),
// //       lineas:ordenes_compra_items!ordenes_compra_items_orden_compra_id_fkey(
// //         id, cantidad, precio_unitario, porcentaje_descuento, porcentaje_iva,
// //         pedido:pedidos_insumos!ordenes_compra_items_pedido_insumo_id_fkey(
// //           insumo:maestro_insumos!pedidos_insumos_insumo_id_fkey(codigo, descripcion, u_m)
// //         )
// //       )
// //     `
// //     )
// //     .eq("id", ordenId)
// //     .single()

// //   if (error) throw new Error(error.message)

// //   const d = data as any
// //   const nitProveedor = d.proveedor?.numero_documento
// //     ? `${d.proveedor.numero_documento}${d.proveedor.digito_verificacion ? `-${d.proveedor.digito_verificacion}` : ""}`
// //     : null

// //   return {
// //     id: d.id,
// //     numero: d.numero,
// //     estado: d.estado,
// //     proyectoCodigo: d.proyecto?.codigo ?? null,
// //     proyectoNombre: d.proyecto?.nombre ?? null,
// //     proyectoCiudad: d.proyecto?.ciudad ?? null,
// //     empresaNombre: d.proyecto?.empresa?.razon_social ?? null,
// //     empresaNit: d.proyecto?.empresa?.nit ?? null,
// //     proveedorNombre: d.proveedor?.nombre ?? "(proveedor eliminado)",
// //     proveedorNit: nitProveedor,
// //     proveedorDireccion: d.proveedor?.direccion ?? null,
// //     proveedorCiudad: d.proveedor?.ciudad ?? null,
// //     proveedorTelefono: d.proveedor?.telefono ?? null,
// //     proveedorEmail: d.proveedor?.correo ?? null,
// //     proveedorContacto: d.proveedor?.nombre_contacto ?? null,
// //     sitioEntrega: d.sitio_entrega,
// //     fechaEntrega: d.fecha_entrega,
// //     contactoNombre: d.contacto_nombre,
// //     telefono: d.telefono,
// //     ciudad: d.ciudad,
// //     email: d.email,
// //     condicionesPago: d.condiciones_pago,
// //     observaciones: d.observaciones,
// //     enviada: d.enviada,
// //     creadaPorNombre: d.creado_por?.nombre ?? null,
// //     createdAt: d.created_at,
// //     aprobadaPorNombre: d.aprobada_por_perfil?.nombre ?? null,
// //     aprobadaAt: d.aprobada_at,
// //     motivoRechazo: d.motivo_rechazo,
// //     lineas: (d.lineas ?? []).map((l: any) => ({
// //       id: l.id,
// //       insumoCodigo: l.pedido?.insumo?.codigo,
// //       insumoDescripcion: l.pedido?.insumo?.descripcion ?? "(insumo eliminado)",
// //       um: l.pedido?.insumo?.u_m ?? null,
// //       cantidad: Number(l.cantidad),
// //       precioUnitario: Number(l.precio_unitario),
// //       porcentajeDescuento: Number(l.porcentaje_descuento),
// //       porcentajeIva: Number(l.porcentaje_iva),
// //     })),
// //   }
// // }

// // export async function aprobarOrdenCompra(ordenId: string): Promise<void> {
// //   await requerirAdmin()
// //   const supabase = await createClient()
// //   const { error } = await supabase.rpc("aprobar_orden_compra", { p_orden_id: ordenId })
// //   if (error) throw new Error(error.message)
// // }

// // export async function rechazarOrdenCompra(ordenId: string, motivo: string): Promise<void> {
// //   await requerirAdmin()
// //   if (!motivo.trim()) throw new Error("El motivo de rechazo es obligatorio.")
// //   const supabase = await createClient()
// //   const { error } = await supabase.rpc("rechazar_orden_compra", {
// //     p_orden_id: ordenId,
// //     p_motivo: motivo.trim(),
// //   })
// //   if (error) throw new Error(error.message)
// // }

// // export async function marcarOrdenEnviada(ordenId: string): Promise<void> {
// //   await requerirScope("rol_compras")
// //   const supabase = await createClient()
// //   const { error } = await supabase.rpc("marcar_orden_enviada", { p_orden_id: ordenId })
// //   if (error) throw new Error(error.message)
// // }

// // export type OrdenCompraListado = {
// //   id: string
// //   numero: number
// //   estado: OrdenCompraEstado
// //   enviada: boolean
// //   proyectoCodigo: string | null
// //   proyectoNombre: string | null
// //   proveedorNombre: string
// //   creadaPorNombre: string | null
// //   createdAt: string
// // }

// // // Sin requerirScope a propósito -- la RLS (ordenes_compra_select_proyecto +
// // // ordenes_compra_select para rol_compras/admin) ya decide qué filas ve cada
// // // quien. Un ingeniero ve las OC de sus proyectos, Compras/admin las ve todas.
// // export async function listarTodasLasOrdenesCompra(): Promise<OrdenCompraListado[]> {
// //   const supabase = await createClient()
// //   const {
// //     data: { user },
// //   } = await supabase.auth.getUser()
// //   if (!user) throw new Error("No autenticado.")

// //   const { data, error } = await supabase
// //     .from("ordenes_compra")
// //     .select(
// //       `
// //       id, numero, estado, enviada, created_at,
// //       proyecto:proyectos!ordenes_compra_proyecto_id_fkey(codigo, nombre),
// //       proveedor:proveedores!ordenes_compra_proveedor_id_fkey(nombre),
// //       creado_por:perfiles!ordenes_compra_created_by_fkey(nombre)
// //     `
// //     )
// //     .order("created_at", { ascending: false })

// //   if (error) throw new Error(error.message)

// //   return (data ?? []).map((o: any) => ({
// //     id: o.id,
// //     numero: o.numero,
// //     estado: o.estado,
// //     enviada: o.enviada,
// //     proyectoCodigo: o.proyecto?.codigo ?? null,
// //     proyectoNombre: o.proyecto?.nombre ?? null,
// //     proveedorNombre: o.proveedor?.nombre ?? "(proveedor eliminado)",
// //     creadaPorNombre: o.creado_por?.nombre ?? null,
// //     createdAt: o.created_at,
// //   }))
// // }

// // // ---------------------------------------------------------------------------
// // // Notificaciones
// // // ---------------------------------------------------------------------------

// // export type NotificacionTipo = "pedido_rechazado" | "orden_compra_rechazada"
// // export type NotificacionEntidadTipo = "pedido_insumo" | "orden_compra"

// // export type Notificacion = {
// //   id: string
// //   tipo: NotificacionTipo
// //   entidadTipo: NotificacionEntidadTipo
// //   entidadId: string
// //   titulo: string
// //   mensaje: string
// //   leida: boolean
// //   createdAt: string
// // }

// // // Sin requerirScope -- la RLS (notificaciones_select_propias) ya limita el
// // // resultado a usuario_id = auth.uid(). Sin paginación por ahora, igual que
// // // el resto del módulo: revisar si el volumen crece.
// // export async function listarNotificaciones(): Promise<Notificacion[]> {
// //   const supabase = await createClient()
// //   const {
// //     data: { user },
// //   } = await supabase.auth.getUser()
// //   if (!user) throw new Error("No autenticado.")

// //   const { data, error } = await supabase
// //     .from("notificaciones")
// //     .select("id, tipo, entidad_tipo, entidad_id, titulo, mensaje, leida, created_at")
// //     .order("created_at", { ascending: false })
// //     .limit(20)

// //   if (error) throw new Error(error.message)

// //   return (data ?? []).map((n) => ({
// //     id: n.id,
// //     tipo: n.tipo,
// //     entidadTipo: n.entidad_tipo,
// //     entidadId: n.entidad_id,
// //     titulo: n.titulo,
// //     mensaje: n.mensaje,
// //     leida: n.leida,
// //     createdAt: n.created_at,
// //   }))
// // }

// // // El .eq("id", id) es defensivo, no de seguridad -- la policy
// // // notificaciones_update_propias (usuario_id = auth.uid()) ya impide que
// // // alguien marque como leída una notificación que no es suya, aunque
// // // adivine el id.
// // export async function marcarNotificacionLeida(id: string): Promise<void> {
// //   const supabase = await createClient()
// //   const { error } = await supabase.from("notificaciones").update({ leida: true }).eq("id", id)
// //   if (error) throw new Error(error.message)
// // }

// "use server"

// import { createClient } from "@/lib/supabase/server"
// import { requerirScope, requerirAdmin } from "@/lib/permisos"

// // ---------------------------------------------------------------------------
// // Compras -- cola de pedidos aprobados listos para generar orden de compra
// // ---------------------------------------------------------------------------

// export type ProyectoSugerido = { id: string; codigo: string | null; nombre: string }

// export async function listarProyectosCompras(): Promise<ProyectoSugerido[]> {
//   await requerirScope("rol_compras")
//   const supabase = await createClient()

//   const { data, error } = await supabase
//     .from("proyectos")
//     .select("id, codigo, nombre")
//     .order("codigo", { ascending: false, nullsFirst: false })

//   if (error) throw new Error(error.message)
//   return data ?? []
// }

// export type InsumoSugerido = { id: string; codigo: number; descripcion: string; u_m: string | null }

// export async function buscarInsumosCompras(termino: string): Promise<InsumoSugerido[]> {
//   if (!termino || termino.trim().length < 2) return []
//   const supabase = await createClient()

//   const { data, error } = await supabase
//     .from("maestro_insumos")
//     .select("id, codigo, descripcion, u_m")
//     .ilike("descripcion", `%${termino.trim()}%`)
//     .order("descripcion")
//     .limit(15)

//   if (error) throw new Error(error.message)
//   return data ?? []
// }

// export type UsuarioSugerido = { id: string; nombre: string }

// export async function buscarUsuarios(termino: string): Promise<UsuarioSugerido[]> {
//   if (!termino || termino.trim().length < 2) return []
//   const supabase = await createClient()

//   const { data, error } = await supabase
//     .from("perfiles")
//     .select("id, nombre")
//     .ilike("nombre", `%${termino.trim()}%`)
//     .order("nombre")
//     .limit(15)

//   if (error) throw new Error(error.message)
//   return data ?? []
// }

// export type FiltrosPedidosCompra = {
//   proyectoId: string
//   usuarioId?: string | null
//   insumoId?: string | null
//   observacion?: string | null
//   fechaPedidoInicio?: string | null
//   fechaPedidoFin?: string | null
//   fechaRequerimientoInicio?: string | null
//   fechaRequerimientoFin?: string | null
//   fechaAprobacionInicio?: string | null
//   fechaAprobacionFin?: string | null
//   soloUrgentes?: boolean
// }

// export type PedidoParaComprar = {
//   id: string
//   insumoId: string
//   insumoCodigo: number
//   insumoDescripcion: string
//   um: string | null
//   cantidad: number
//   cantidadPendiente: number
//   valorUnitarioProyectado: number | null
//   fechaPedido: string
//   fechaRequerida: string
//   urgente: boolean
//   observaciones: string | null
//   soporteUrl: string | null
//   solicitadoPorNombre: string | null
//   resueltoAt: string | null
// }

// const SELECT_PEDIDO_PARA_COMPRAR = `
//   id, cantidad, fecha_requerida, urgente, observaciones, soporte_url, created_at, resuelto_at,
//   insumo:maestro_insumos!pedidos_insumos_insumo_id_fkey(id, codigo, descripcion, u_m, vr_unitario),
//   solicitante:perfiles!pedidos_insumos_solicitado_por_fkey(nombre),
//   compras:ordenes_compra_items!ordenes_compra_items_pedido_insumo_id_fkey(cantidad)
// `

// function mapPedidoParaComprar(f: any): PedidoParaComprar {
//   const yaComprado = (f.compras ?? []).reduce((acc: number, c: any) => acc + Number(c.cantidad), 0)
//   return {
//     id: f.id,
//     insumoId: f.insumo?.id,
//     insumoCodigo: f.insumo?.codigo,
//     insumoDescripcion: f.insumo?.descripcion ?? "(insumo eliminado)",
//     um: f.insumo?.u_m ?? null,
//     cantidad: Number(f.cantidad),
//     cantidadPendiente: Number(f.cantidad) - yaComprado,
//     // Valor de respaldo -- se sobreescribe con el precio EFECTIVO (promedio
//     // de compra dinámico) en conPreciosEfectivosPedidos, más abajo. Se deja
//     // este fallback por si el RPC no trae el insumo por algún motivo.
//     valorUnitarioProyectado: f.insumo?.vr_unitario ?? null,
//     fechaPedido: f.created_at,
//     fechaRequerida: f.fecha_requerida,
//     urgente: f.urgente,
//     observaciones: f.observaciones,
//     soporteUrl: f.soporte_url,
//     solicitadoPorNombre: f.solicitante?.nombre ?? null,
//     resueltoAt: f.resuelto_at,
//   }
// }

// // Reemplaza valorUnitarioProyectado con el precio EFECTIVO de cada insumo
// // (precios_efectivos_insumos: promedio de compra dinámico si el insumo
// // tiene historial, o vr_unitario si no) -- mismo criterio que ya usa
// // conPreciosEfectivos en presupuestos/actions.ts y matchearYGuardarImportApu,
// // para que "cuánto se proyecta pagar" no dependa del campo fijo del
// // maestro cuando ya existe un promedio de compra real.
// async function conPreciosEfectivosPedidos(
//   pedidos: PedidoParaComprar[]
// ): Promise<PedidoParaComprar[]> {
//   if (pedidos.length === 0) return pedidos

//   const supabase = await createClient()
//   const insumoIds = Array.from(new Set(pedidos.map((p) => p.insumoId).filter(Boolean)))
//   if (insumoIds.length === 0) return pedidos

//   const { data: precios, error } = await supabase.rpc("precios_efectivos_insumos", {
//     p_insumo_ids: insumoIds,
//   })
//   if (error) throw new Error(error.message)

//   // Map tipado explícito -- sin esto, TS infiere el valor como `{}` (el
//   // tipo Json del RPC, no number), y el ?? de abajo deja de ser asignable
//   // a number | null.
//   const precioPorId = new Map<string, number | null>(
//     (precios ?? []).map((p: any) => [p.insumo_id as string, p.precio_efectivo as number | null])
//   )
//   return pedidos.map((p) => ({
//     ...p,
//     valorUnitarioProyectado: precioPorId.get(p.insumoId) ?? p.valorUnitarioProyectado,
//   }))
// }

// export async function listarPedidosParaComprar(
//   filtros: FiltrosPedidosCompra
// ): Promise<PedidoParaComprar[]> {
//   await requerirScope("rol_compras")
//   const supabase = await createClient()

//   let query = supabase
//     .from("pedidos_insumos")
//     .select(SELECT_PEDIDO_PARA_COMPRAR)
//     .eq("proyecto_id", filtros.proyectoId)
//     .eq("estado", "aprobado")
//     .is("rechazado_compras_at", null)
//     .order("urgente", { ascending: false })
//     .order("fecha_requerida", { ascending: true })

//   if (filtros.usuarioId) query = query.eq("solicitado_por", filtros.usuarioId)
//   if (filtros.insumoId) query = query.eq("insumo_id", filtros.insumoId)
//   if (filtros.observacion?.trim()) query = query.ilike("observaciones", `%${filtros.observacion.trim()}%`)
//   if (filtros.soloUrgentes) query = query.eq("urgente", true)

//   if (filtros.fechaPedidoInicio) query = query.gte("created_at", filtros.fechaPedidoInicio)
//   if (filtros.fechaPedidoFin) query = query.lte("created_at", `${filtros.fechaPedidoFin}T23:59:59`)
//   if (filtros.fechaRequerimientoInicio) query = query.gte("fecha_requerida", filtros.fechaRequerimientoInicio)
//   if (filtros.fechaRequerimientoFin) query = query.lte("fecha_requerida", filtros.fechaRequerimientoFin)
//   if (filtros.fechaAprobacionInicio) query = query.gte("resuelto_at", filtros.fechaAprobacionInicio)
//   if (filtros.fechaAprobacionFin) query = query.lte("resuelto_at", `${filtros.fechaAprobacionFin}T23:59:59`)

//   const { data, error } = await query
//   if (error) throw new Error(error.message)

//   const pedidos = (data ?? []).map(mapPedidoParaComprar).filter((p) => p.cantidadPendiente > 0)
//   return await conPreciosEfectivosPedidos(pedidos)
// }

// export async function obtenerPedidosPorId(ids: string[]): Promise<PedidoParaComprar[]> {
//   await requerirScope("rol_compras")
//   if (ids.length === 0) return []
//   const supabase = await createClient()

//   const { data, error } = await supabase
//     .from("pedidos_insumos")
//     .select(SELECT_PEDIDO_PARA_COMPRAR)
//     .in("id", ids)
//     .eq("estado", "aprobado")
//     .is("rechazado_compras_at", null)

//   if (error) throw new Error(error.message)

//   const pedidos = (data ?? []).map(mapPedidoParaComprar).filter((p) => p.cantidadPendiente > 0)
//   return await conPreciosEfectivosPedidos(pedidos)
// }

// export async function rechazarPedidoCompras(pedidoId: string, motivo: string): Promise<void> {
//   await requerirScope("rol_compras")
//   const supabase = await createClient()

//   const {
//     data: { user },
//   } = await supabase.auth.getUser()

//   const { error } = await supabase
//     .from("pedidos_insumos")
//     .update({
//       rechazado_compras_at: new Date().toISOString(),
//       rechazado_compras_por: user?.id ?? null,
//       observaciones_compras: motivo,
//     })
//     .eq("id", pedidoId)

//   if (error) throw new Error(error.message)
// }

// // ---------------------------------------------------------------------------
// // Generar OC
// // ---------------------------------------------------------------------------

// export type ProveedorSugerido = {
//   id: string
//   nombre: string
//   idProv: string | null
//   tipoProveedor: string | null
// }

// export async function buscarProveedores(termino: string): Promise<ProveedorSugerido[]> {
//   await requerirScope("rol_compras")
//   if (!termino || termino.trim().length < 2) return []
//   const supabase = await createClient()

//   const { data, error } = await supabase
//     .from("proveedores")
//     .select("unique_id, nombre, id_prov, tipo_proveedor")
//     .eq("estado", "ACTIVO")
//     .ilike("nombre", `%${termino.trim()}%`)
//     .order("nombre")
//     .limit(15)

//   if (error) throw new Error(error.message)
//   return (data ?? []).map((p) => ({
//     id: p.unique_id,
//     nombre: p.nombre,
//     idProv: p.id_prov,
//     tipoProveedor: p.tipo_proveedor,
//   }))
// }

// export type InformacionBancariaProveedor = {
//   titular: string | null
//   entidadBancaria: string | null
//   tipoCuenta: string | null
//   noCuenta: string | null
// }

// export type ProveedorDetalle = {
//   id: string
//   nombre: string
//   nombreContacto: string | null
//   telefono: string | null
//   correo: string | null
//   ciudad: string | null
//   direccion: string | null
//   informacionBancaria: InformacionBancariaProveedor | null
// }

// export async function obtenerProveedorDetalle(proveedorId: string): Promise<ProveedorDetalle> {
//   await requerirScope("rol_compras")
//   const supabase = await createClient()

//   const { data, error } = await supabase
//     .from("proveedores")
//     .select(
//       `
//       unique_id, nombre, nombre_contacto, telefono, correo, ciudad, direccion,
//       informacion_bancaria!informacion_bancaria_id_fkey(titular, entidad_bancaria, tipo_cuenta, no_cuenta)
//     `
//     )
//     .eq("unique_id", proveedorId)
//     .single()

//   if (error) throw new Error(error.message)

//   const d = data as any
//   const banco = Array.isArray(d.informacion_bancaria) ? d.informacion_bancaria[0] : d.informacion_bancaria

//   return {
//     id: d.unique_id,
//     nombre: d.nombre,
//     nombreContacto: d.nombre_contacto,
//     telefono: d.telefono,
//     correo: d.correo,
//     ciudad: d.ciudad,
//     direccion: d.direccion,
//     informacionBancaria: banco
//       ? {
//           titular: banco.titular,
//           entidadBancaria: banco.entidad_bancaria,
//           tipoCuenta: banco.tipo_cuenta,
//           noCuenta: banco.no_cuenta,
//         }
//       : null,
//   }
// }

// export type LineaOrdenCompra = {
//   pedidoId: string
//   cantidadComprar: number
//   precioUnitario: number
//   porcentajeDescuento: number
//   porcentajeIva: number
// }

// export type DatosOrdenCompra = {
//   proyectoId: string
//   proveedorId: string
//   sitioEntrega?: string | null
//   fechaEntrega?: string | null
//   contactoNombre?: string | null
//   telefono?: string | null
//   ciudad?: string | null
//   email?: string | null
//   condicionesPago?: string | null
//   observaciones?: string | null
//   lineas: LineaOrdenCompra[]
// }

// export async function crearOrdenCompra(datos: DatosOrdenCompra): Promise<string> {
//   await requerirScope("rol_compras")

//   if (datos.lineas.length === 0) {
//     throw new Error("Selecciona al menos un insumo para la orden de compra.")
//   }

//   const supabase = await createClient()

//     const { data, error } = await supabase.rpc("crear_orden_compra", {
//     p_proyecto_id: datos.proyectoId,
//     p_proveedor_id: datos.proveedorId,
//     p_sitio_entrega: datos.sitioEntrega ?? null,
//     p_fecha_entrega: datos.fechaEntrega ?? null,
//     p_contacto_nombre: datos.contactoNombre ?? null,
//     p_telefono: datos.telefono ?? null,
//     p_ciudad: datos.ciudad ?? null,
//     p_email: datos.email ?? null,
//     p_condiciones_pago: datos.condicionesPago ?? null,
//     p_observaciones: datos.observaciones ?? null,
//     p_lineas: datos.lineas.map((l) => ({
//       pedido_id: l.pedidoId,
//       cantidad_comprar: l.cantidadComprar,
//       precio_unitario: l.precioUnitario,
//       porcentaje_descuento: l.porcentajeDescuento,
//       porcentaje_iva: l.porcentajeIva,
//     })),
//   })

//   if (error) throw new Error(error.message)
//   return data as string
// }

// // ---------------------------------------------------------------------------
// // Aprobación de OC + pantalla de detalle
// // ---------------------------------------------------------------------------

// export type PermisosOrdenCompra = { esAdmin: boolean; rolCompras: boolean }

// export async function obtenerPermisosOrdenCompra(): Promise<PermisosOrdenCompra> {
//   const supabase = await createClient()
//   const {
//     data: { user },
//   } = await supabase.auth.getUser()
//   if (!user) return { esAdmin: false, rolCompras: false }

//   const { data, error } = await supabase
//     .from("perfiles")
//     .select("es_admin, rol_compras")
//     .eq("id", user.id)
//     .single()

//   if (error) throw new Error(error.message)
//   return { esAdmin: data.es_admin, rolCompras: data.rol_compras }
// }

// export type OrdenCompraResumen = {
//   id: string
//   numero: number
//   proyectoCodigo: string | null
//   proyectoNombre: string | null
//   proveedorNombre: string
//   creadaPorNombre: string | null
//   createdAt: string
//   totalLineas: number
// }

// export async function listarOrdenesCompraPendientes(): Promise<OrdenCompraResumen[]> {
//   await requerirAdmin()
//   const supabase = await createClient()

//   const { data, error } = await supabase
//     .from("ordenes_compra")
//     .select(
//       `
//       id, numero, created_at,
//       proyecto:proyectos!ordenes_compra_proyecto_id_fkey(codigo, nombre),
//       proveedor:proveedores!ordenes_compra_proveedor_id_fkey(nombre),
//       creado_por:perfiles!ordenes_compra_created_by_fkey(nombre),
//       lineas:ordenes_compra_items!ordenes_compra_items_orden_compra_id_fkey(id)
//     `
//     )
//     .eq("estado", "pendiente_aprobacion")
//     .order("created_at", { ascending: true })

//   if (error) throw new Error(error.message)

//   return (data ?? []).map((o: any) => ({
//     id: o.id,
//     numero: o.numero,
//     proyectoCodigo: o.proyecto?.codigo ?? null,
//     proyectoNombre: o.proyecto?.nombre ?? null,
//     proveedorNombre: o.proveedor?.nombre ?? "(proveedor eliminado)",
//     creadaPorNombre: o.creado_por?.nombre ?? null,
//     createdAt: o.created_at,
//     totalLineas: (o.lineas ?? []).length,
//   }))
// }

// export type OrdenCompraEstado = "pendiente_aprobacion" | "aprobada" | "rechazada"

// export type LineaOrdenCompraDetalle = {
//   id: string
//   insumoCodigo: number
//   insumoDescripcion: string
//   um: string | null
//   cantidad: number
//   precioUnitario: number
//   porcentajeDescuento: number
//   porcentajeIva: number
// }

// export type OrdenCompraDetalle = {
//   id: string
//   numero: number
//   estado: OrdenCompraEstado
//   proyectoCodigo: string | null
//   proyectoNombre: string | null
//   proyectoCiudad: string | null
//   empresaNombre: string | null
//   empresaNit: string | null
//   proveedorNombre: string
//   proveedorNit: string | null
//   proveedorDireccion: string | null
//   proveedorCiudad: string | null
//   proveedorTelefono: string | null
//   proveedorEmail: string | null
//   proveedorContacto: string | null
//   sitioEntrega: string | null
//   fechaEntrega: string | null
//   contactoNombre: string | null
//   telefono: string | null
//   ciudad: string | null
//   email: string | null
//   condicionesPago: string | null
//   observaciones: string | null
//   enviada: boolean
//   creadaPorNombre: string | null
//   createdAt: string
//   aprobadaPorNombre: string | null
//   aprobadaAt: string | null
//   motivoRechazo: string | null
//   lineas: LineaOrdenCompraDetalle[]
// }
// export async function obtenerOrdenCompraDetalle(ordenId: string): Promise<OrdenCompraDetalle> {
//   const supabase = await createClient()
//   const {
//     data: { user },
//   } = await supabase.auth.getUser()
//   if (!user) throw new Error("No autenticado.")

//   const { data, error } = await supabase
//     .from("ordenes_compra")
//     .select(
//       `
//       id, numero, estado, sitio_entrega, fecha_entrega, contacto_nombre, telefono, ciudad, email,
//       condiciones_pago, observaciones, enviada, created_at, aprobada_at, motivo_rechazo,
//       proyecto:proyectos!ordenes_compra_proyecto_id_fkey(codigo, nombre, ciudad, empresa:empresas(nit, razon_social)),
//       proveedor:proveedores!ordenes_compra_proveedor_id_fkey(
//         nombre, numero_documento, digito_verificacion, direccion, ciudad, telefono, correo, nombre_contacto
//       ),
//       creado_por:perfiles!ordenes_compra_created_by_fkey(nombre),
//       aprobada_por_perfil:perfiles!ordenes_compra_aprobada_por_fkey(nombre),
//       lineas:ordenes_compra_items!ordenes_compra_items_orden_compra_id_fkey(
//         id, cantidad, precio_unitario, porcentaje_descuento, porcentaje_iva,
//         pedido:pedidos_insumos!ordenes_compra_items_pedido_insumo_id_fkey(
//           insumo:maestro_insumos!pedidos_insumos_insumo_id_fkey(codigo, descripcion, u_m)
//         )
//       )
//     `
//     )
//     .eq("id", ordenId)
//     .single()

//   if (error) throw new Error(error.message)

//   const d = data as any
//   const nitProveedor = d.proveedor?.numero_documento
//     ? `${d.proveedor.numero_documento}${d.proveedor.digito_verificacion ? `-${d.proveedor.digito_verificacion}` : ""}`
//     : null

//   return {
//     id: d.id,
//     numero: d.numero,
//     estado: d.estado,
//     proyectoCodigo: d.proyecto?.codigo ?? null,
//     proyectoNombre: d.proyecto?.nombre ?? null,
//     proyectoCiudad: d.proyecto?.ciudad ?? null,
//     empresaNombre: d.proyecto?.empresa?.razon_social ?? null,
//     empresaNit: d.proyecto?.empresa?.nit ?? null,
//     proveedorNombre: d.proveedor?.nombre ?? "(proveedor eliminado)",
//     proveedorNit: nitProveedor,
//     proveedorDireccion: d.proveedor?.direccion ?? null,
//     proveedorCiudad: d.proveedor?.ciudad ?? null,
//     proveedorTelefono: d.proveedor?.telefono ?? null,
//     proveedorEmail: d.proveedor?.correo ?? null,
//     proveedorContacto: d.proveedor?.nombre_contacto ?? null,
//     sitioEntrega: d.sitio_entrega,
//     fechaEntrega: d.fecha_entrega,
//     contactoNombre: d.contacto_nombre,
//     telefono: d.telefono,
//     ciudad: d.ciudad,
//     email: d.email,
//     condicionesPago: d.condiciones_pago,
//     observaciones: d.observaciones,
//     enviada: d.enviada,
//     creadaPorNombre: d.creado_por?.nombre ?? null,
//     createdAt: d.created_at,
//     aprobadaPorNombre: d.aprobada_por_perfil?.nombre ?? null,
//     aprobadaAt: d.aprobada_at,
//     motivoRechazo: d.motivo_rechazo,
//     lineas: (d.lineas ?? []).map((l: any) => ({
//       id: l.id,
//       insumoCodigo: l.pedido?.insumo?.codigo,
//       insumoDescripcion: l.pedido?.insumo?.descripcion ?? "(insumo eliminado)",
//       um: l.pedido?.insumo?.u_m ?? null,
//       cantidad: Number(l.cantidad),
//       precioUnitario: Number(l.precio_unitario),
//       porcentajeDescuento: Number(l.porcentaje_descuento),
//       porcentajeIva: Number(l.porcentaje_iva),
//     })),
//   }
// }

// export async function aprobarOrdenCompra(ordenId: string): Promise<void> {
//   await requerirAdmin()
//   const supabase = await createClient()
//   const { error } = await supabase.rpc("aprobar_orden_compra", { p_orden_id: ordenId })
//   if (error) throw new Error(error.message)
// }

// export async function rechazarOrdenCompra(ordenId: string, motivo: string): Promise<void> {
//   await requerirAdmin()
//   if (!motivo.trim()) throw new Error("El motivo de rechazo es obligatorio.")
//   const supabase = await createClient()
//   const { error } = await supabase.rpc("rechazar_orden_compra", {
//     p_orden_id: ordenId,
//     p_motivo: motivo.trim(),
//   })
//   if (error) throw new Error(error.message)
// }

// export async function marcarOrdenEnviada(ordenId: string): Promise<void> {
//   await requerirScope("rol_compras")
//   const supabase = await createClient()
//   const { error } = await supabase.rpc("marcar_orden_enviada", { p_orden_id: ordenId })
//   if (error) throw new Error(error.message)
// }

// export type OrdenCompraListado = {
//   id: string
//   numero: number
//   estado: OrdenCompraEstado
//   enviada: boolean
//   proyectoCodigo: string | null
//   proyectoNombre: string | null
//   proveedorNombre: string
//   creadaPorNombre: string | null
//   createdAt: string
// }

// // Sin requerirScope a propósito -- la RLS (ordenes_compra_select_proyecto +
// // ordenes_compra_select para rol_compras/admin) ya decide qué filas ve cada
// // quien. Un ingeniero ve las OC de sus proyectos, Compras/admin las ve todas.
// export async function listarTodasLasOrdenesCompra(): Promise<OrdenCompraListado[]> {
//   const supabase = await createClient()
//   const {
//     data: { user },
//   } = await supabase.auth.getUser()
//   if (!user) throw new Error("No autenticado.")

//   const { data, error } = await supabase
//     .from("ordenes_compra")
//     .select(
//       `
//       id, numero, estado, enviada, created_at,
//       proyecto:proyectos!ordenes_compra_proyecto_id_fkey(codigo, nombre),
//       proveedor:proveedores!ordenes_compra_proveedor_id_fkey(nombre),
//       creado_por:perfiles!ordenes_compra_created_by_fkey(nombre)
//     `
//     )
//     .order("created_at", { ascending: false })

//   if (error) throw new Error(error.message)

//   return (data ?? []).map((o: any) => ({
//     id: o.id,
//     numero: o.numero,
//     estado: o.estado,
//     enviada: o.enviada,
//     proyectoCodigo: o.proyecto?.codigo ?? null,
//     proyectoNombre: o.proyecto?.nombre ?? null,
//     proveedorNombre: o.proveedor?.nombre ?? "(proveedor eliminado)",
//     creadaPorNombre: o.creado_por?.nombre ?? null,
//     createdAt: o.created_at,
//   }))
// }

// // ---------------------------------------------------------------------------
// // Notificaciones
// // ---------------------------------------------------------------------------

// export type NotificacionTipo = "pedido_rechazado" | "orden_compra_rechazada" | "insumo_sobre_presupuesto"
// export type NotificacionEntidadTipo = "pedido_insumo" | "orden_compra"

// export type Notificacion = {
//   id: string
//   tipo: NotificacionTipo
//   entidadTipo: NotificacionEntidadTipo
//   entidadId: string
//   titulo: string
//   mensaje: string
//   leida: boolean
//   createdAt: string
// }

// // Sin requerirScope -- la RLS (notificaciones_select_propias) ya limita el
// // resultado a usuario_id = auth.uid(). Sin paginación por ahora, igual que
// // el resto del módulo: revisar si el volumen crece.
// export async function listarNotificaciones(): Promise<Notificacion[]> {
//   const supabase = await createClient()
//   const {
//     data: { user },
//   } = await supabase.auth.getUser()
//   if (!user) throw new Error("No autenticado.")

//   const { data, error } = await supabase
//     .from("notificaciones")
//     .select("id, tipo, entidad_tipo, entidad_id, titulo, mensaje, leida, created_at")
//     .order("created_at", { ascending: false })
//     .limit(20)

//   if (error) throw new Error(error.message)

//   return (data ?? []).map((n) => ({
//     id: n.id,
//     tipo: n.tipo,
//     entidadTipo: n.entidad_tipo,
//     entidadId: n.entidad_id,
//     titulo: n.titulo,
//     mensaje: n.mensaje,
//     leida: n.leida,
//     createdAt: n.created_at,
//   }))
// }

// // El .eq("id", id) es defensivo, no de seguridad -- la policy
// // notificaciones_update_propias (usuario_id = auth.uid()) ya impide que
// // alguien marque como leída una notificación que no es suya, aunque
// // adivine el id.
// export async function marcarNotificacionLeida(id: string): Promise<void> {
//   const supabase = await createClient()
//   const { error } = await supabase.from("notificaciones").update({ leida: true }).eq("id", id)
//   if (error) throw new Error(error.message)
// }

// "use server"

// import { createClient } from "@/lib/supabase/server"
// import { requerirScope, requerirAdmin } from "@/lib/permisos"

// // ---------------------------------------------------------------------------
// // Compras -- cola de pedidos aprobados listos para generar orden de compra
// // ---------------------------------------------------------------------------

// export type ProyectoSugerido = { id: string; codigo: string | null; nombre: string }

// export async function listarProyectosCompras(): Promise<ProyectoSugerido[]> {
//   await requerirScope("rol_compras")
//   const supabase = await createClient()

//   const { data, error } = await supabase
//     .from("proyectos")
//     .select("id, codigo, nombre")
//     .order("codigo", { ascending: false, nullsFirst: false })

//   if (error) throw new Error(error.message)
//   return data ?? []
// }

// export type InsumoSugerido = { id: string; codigo: number; descripcion: string; u_m: string | null }

// export async function buscarInsumosCompras(termino: string): Promise<InsumoSugerido[]> {
//   if (!termino || termino.trim().length < 2) return []
//   const supabase = await createClient()

//   const { data, error } = await supabase
//     .from("maestro_insumos")
//     .select("id, codigo, descripcion, u_m")
//     .ilike("descripcion", `%${termino.trim()}%`)
//     .order("descripcion")
//     .limit(15)

//   if (error) throw new Error(error.message)
//   return data ?? []
// }

// export type UsuarioSugerido = { id: string; nombre: string }

// export async function buscarUsuarios(termino: string): Promise<UsuarioSugerido[]> {
//   if (!termino || termino.trim().length < 2) return []
//   const supabase = await createClient()

//   const { data, error } = await supabase
//     .from("perfiles")
//     .select("id, nombre")
//     .ilike("nombre", `%${termino.trim()}%`)
//     .order("nombre")
//     .limit(15)

//   if (error) throw new Error(error.message)
//   return data ?? []
// }

// export type FiltrosPedidosCompra = {
//   proyectoId: string
//   usuarioId?: string | null
//   insumoId?: string | null
//   observacion?: string | null
//   fechaPedidoInicio?: string | null
//   fechaPedidoFin?: string | null
//   fechaRequerimientoInicio?: string | null
//   fechaRequerimientoFin?: string | null
//   fechaAprobacionInicio?: string | null
//   fechaAprobacionFin?: string | null
//   soloUrgentes?: boolean
// }

// export type PedidoParaComprar = {
//   id: string
//   insumoId: string
//   insumoCodigo: number
//   insumoDescripcion: string
//   um: string | null
//   cantidad: number
//   cantidadPendiente: number
//   valorUnitarioProyectado: number | null
//   fechaPedido: string
//   fechaRequerida: string
//   urgente: boolean
//   observaciones: string | null
//   soporteUrl: string | null
//   solicitadoPorNombre: string | null
//   resueltoAt: string | null
// }

// const SELECT_PEDIDO_PARA_COMPRAR = `
//   id, cantidad, fecha_requerida, urgente, observaciones, soporte_url, created_at, resuelto_at,
//   insumo:maestro_insumos!pedidos_insumos_insumo_id_fkey(id, codigo, descripcion, u_m, vr_unitario),
//   solicitante:perfiles!pedidos_insumos_solicitado_por_fkey(nombre),
//   compras:ordenes_compra_items!ordenes_compra_items_pedido_insumo_id_fkey(cantidad)
// `

// function mapPedidoParaComprar(f: any): PedidoParaComprar {
//   const yaComprado = (f.compras ?? []).reduce((acc: number, c: any) => acc + Number(c.cantidad), 0)
//   return {
//     id: f.id,
//     insumoId: f.insumo?.id,
//     insumoCodigo: f.insumo?.codigo,
//     insumoDescripcion: f.insumo?.descripcion ?? "(insumo eliminado)",
//     um: f.insumo?.u_m ?? null,
//     cantidad: Number(f.cantidad),
//     cantidadPendiente: Number(f.cantidad) - yaComprado,
//     valorUnitarioProyectado: f.insumo?.vr_unitario ?? null,
//     fechaPedido: f.created_at,
//     fechaRequerida: f.fecha_requerida,
//     urgente: f.urgente,
//     observaciones: f.observaciones,
//     soporteUrl: f.soporte_url,
//     solicitadoPorNombre: f.solicitante?.nombre ?? null,
//     resueltoAt: f.resuelto_at,
//   }
// }

// export async function listarPedidosParaComprar(
//   filtros: FiltrosPedidosCompra
// ): Promise<PedidoParaComprar[]> {
//   await requerirScope("rol_compras")
//   const supabase = await createClient()

//   let query = supabase
//     .from("pedidos_insumos")
//     .select(SELECT_PEDIDO_PARA_COMPRAR)
//     .eq("proyecto_id", filtros.proyectoId)
//     .eq("estado", "aprobado")
//     .is("rechazado_compras_at", null)
//     .order("urgente", { ascending: false })
//     .order("fecha_requerida", { ascending: true })

//   if (filtros.usuarioId) query = query.eq("solicitado_por", filtros.usuarioId)
//   if (filtros.insumoId) query = query.eq("insumo_id", filtros.insumoId)
//   if (filtros.observacion?.trim()) query = query.ilike("observaciones", `%${filtros.observacion.trim()}%`)
//   if (filtros.soloUrgentes) query = query.eq("urgente", true)

//   if (filtros.fechaPedidoInicio) query = query.gte("created_at", filtros.fechaPedidoInicio)
//   if (filtros.fechaPedidoFin) query = query.lte("created_at", `${filtros.fechaPedidoFin}T23:59:59`)
//   if (filtros.fechaRequerimientoInicio) query = query.gte("fecha_requerida", filtros.fechaRequerimientoInicio)
//   if (filtros.fechaRequerimientoFin) query = query.lte("fecha_requerida", filtros.fechaRequerimientoFin)
//   if (filtros.fechaAprobacionInicio) query = query.gte("resuelto_at", filtros.fechaAprobacionInicio)
//   if (filtros.fechaAprobacionFin) query = query.lte("resuelto_at", `${filtros.fechaAprobacionFin}T23:59:59`)

//   const { data, error } = await query
//   if (error) throw new Error(error.message)

//   return (data ?? []).map(mapPedidoParaComprar).filter((p) => p.cantidadPendiente > 0)
// }

// export async function obtenerPedidosPorId(ids: string[]): Promise<PedidoParaComprar[]> {
//   await requerirScope("rol_compras")
//   if (ids.length === 0) return []
//   const supabase = await createClient()

//   const { data, error } = await supabase
//     .from("pedidos_insumos")
//     .select(SELECT_PEDIDO_PARA_COMPRAR)
//     .in("id", ids)
//     .eq("estado", "aprobado")
//     .is("rechazado_compras_at", null)

//   if (error) throw new Error(error.message)

//   return (data ?? []).map(mapPedidoParaComprar).filter((p) => p.cantidadPendiente > 0)
// }

// export async function rechazarPedidoCompras(pedidoId: string, motivo: string): Promise<void> {
//   await requerirScope("rol_compras")
//   const supabase = await createClient()

//   const {
//     data: { user },
//   } = await supabase.auth.getUser()

//   const { error } = await supabase
//     .from("pedidos_insumos")
//     .update({
//       rechazado_compras_at: new Date().toISOString(),
//       rechazado_compras_por: user?.id ?? null,
//       observaciones_compras: motivo,
//     })
//     .eq("id", pedidoId)

//   if (error) throw new Error(error.message)
// }

// // ---------------------------------------------------------------------------
// // Generar OC
// // ---------------------------------------------------------------------------

// export type ProveedorSugerido = {
//   id: string
//   nombre: string
//   idProv: string | null
//   tipoProveedor: string | null
// }

// export async function buscarProveedores(termino: string): Promise<ProveedorSugerido[]> {
//   await requerirScope("rol_compras")
//   if (!termino || termino.trim().length < 2) return []
//   const supabase = await createClient()

//   const { data, error } = await supabase
//     .from("proveedores")
//     .select("unique_id, nombre, id_prov, tipo_proveedor")
//     .eq("estado", "ACTIVO")
//     .ilike("nombre", `%${termino.trim()}%`)
//     .order("nombre")
//     .limit(15)

//   if (error) throw new Error(error.message)
//   return (data ?? []).map((p) => ({
//     id: p.unique_id,
//     nombre: p.nombre,
//     idProv: p.id_prov,
//     tipoProveedor: p.tipo_proveedor,
//   }))
// }

// export type InformacionBancariaProveedor = {
//   titular: string | null
//   entidadBancaria: string | null
//   tipoCuenta: string | null
//   noCuenta: string | null
// }

// export type ProveedorDetalle = {
//   id: string
//   nombre: string
//   nombreContacto: string | null
//   telefono: string | null
//   correo: string | null
//   ciudad: string | null
//   direccion: string | null
//   informacionBancaria: InformacionBancariaProveedor | null
// }

// export async function obtenerProveedorDetalle(proveedorId: string): Promise<ProveedorDetalle> {
//   await requerirScope("rol_compras")
//   const supabase = await createClient()

//   const { data, error } = await supabase
//     .from("proveedores")
//     .select(
//       `
//       unique_id, nombre, nombre_contacto, telefono, correo, ciudad, direccion,
//       informacion_bancaria!informacion_bancaria_id_fkey(titular, entidad_bancaria, tipo_cuenta, no_cuenta)
//     `
//     )
//     .eq("unique_id", proveedorId)
//     .single()

//   if (error) throw new Error(error.message)

//   const d = data as any
//   const banco = Array.isArray(d.informacion_bancaria) ? d.informacion_bancaria[0] : d.informacion_bancaria

//   return {
//     id: d.unique_id,
//     nombre: d.nombre,
//     nombreContacto: d.nombre_contacto,
//     telefono: d.telefono,
//     correo: d.correo,
//     ciudad: d.ciudad,
//     direccion: d.direccion,
//     informacionBancaria: banco
//       ? {
//           titular: banco.titular,
//           entidadBancaria: banco.entidad_bancaria,
//           tipoCuenta: banco.tipo_cuenta,
//           noCuenta: banco.no_cuenta,
//         }
//       : null,
//   }
// }

// export type LineaOrdenCompra = {
//   pedidoId: string
//   cantidadComprar: number
//   precioUnitario: number
//   porcentajeDescuento: number
//   porcentajeIva: number
// }

// export type DatosOrdenCompra = {
//   proyectoId: string
//   proveedorId: string
//   sitioEntrega?: string | null
//   fechaEntrega?: string | null
//   contactoNombre?: string | null
//   telefono?: string | null
//   ciudad?: string | null
//   email?: string | null
//   condicionesPago?: string | null
//   observaciones?: string | null
//   lineas: LineaOrdenCompra[]
// }

// export async function crearOrdenCompra(datos: DatosOrdenCompra): Promise<string> {
//   await requerirScope("rol_compras")

//   if (datos.lineas.length === 0) {
//     throw new Error("Selecciona al menos un insumo para la orden de compra.")
//   }

//   const supabase = await createClient()

//     const { data, error } = await supabase.rpc("crear_orden_compra", {
//     p_proyecto_id: datos.proyectoId,
//     p_proveedor_id: datos.proveedorId,
//     p_sitio_entrega: datos.sitioEntrega ?? null,
//     p_fecha_entrega: datos.fechaEntrega ?? null,
//     p_contacto_nombre: datos.contactoNombre ?? null,
//     p_telefono: datos.telefono ?? null,
//     p_ciudad: datos.ciudad ?? null,
//     p_email: datos.email ?? null,
//     p_condiciones_pago: datos.condicionesPago ?? null,
//     p_observaciones: datos.observaciones ?? null,
//     p_lineas: datos.lineas.map((l) => ({
//       pedido_id: l.pedidoId,
//       cantidad_comprar: l.cantidadComprar,
//       precio_unitario: l.precioUnitario,
//       porcentaje_descuento: l.porcentajeDescuento,
//       porcentaje_iva: l.porcentajeIva,
//     })),
//   })

//   if (error) throw new Error(error.message)
//   return data as string
// }

// // ---------------------------------------------------------------------------
// // Aprobación de OC + pantalla de detalle
// // ---------------------------------------------------------------------------

// export type PermisosOrdenCompra = { esAdmin: boolean; rolCompras: boolean }

// export async function obtenerPermisosOrdenCompra(): Promise<PermisosOrdenCompra> {
//   const supabase = await createClient()
//   const {
//     data: { user },
//   } = await supabase.auth.getUser()
//   if (!user) return { esAdmin: false, rolCompras: false }

//   const { data, error } = await supabase
//     .from("perfiles")
//     .select("es_admin, rol_compras")
//     .eq("id", user.id)
//     .single()

//   if (error) throw new Error(error.message)
//   return { esAdmin: data.es_admin, rolCompras: data.rol_compras }
// }

// export type OrdenCompraResumen = {
//   id: string
//   numero: number
//   proyectoCodigo: string | null
//   proyectoNombre: string | null
//   proveedorNombre: string
//   creadaPorNombre: string | null
//   createdAt: string
//   totalLineas: number
// }

// export async function listarOrdenesCompraPendientes(): Promise<OrdenCompraResumen[]> {
//   await requerirAdmin()
//   const supabase = await createClient()

//   const { data, error } = await supabase
//     .from("ordenes_compra")
//     .select(
//       `
//       id, numero, created_at,
//       proyecto:proyectos!ordenes_compra_proyecto_id_fkey(codigo, nombre),
//       proveedor:proveedores!ordenes_compra_proveedor_id_fkey(nombre),
//       creado_por:perfiles!ordenes_compra_created_by_fkey(nombre),
//       lineas:ordenes_compra_items!ordenes_compra_items_orden_compra_id_fkey(id)
//     `
//     )
//     .eq("estado", "pendiente_aprobacion")
//     .order("created_at", { ascending: true })

//   if (error) throw new Error(error.message)

//   return (data ?? []).map((o: any) => ({
//     id: o.id,
//     numero: o.numero,
//     proyectoCodigo: o.proyecto?.codigo ?? null,
//     proyectoNombre: o.proyecto?.nombre ?? null,
//     proveedorNombre: o.proveedor?.nombre ?? "(proveedor eliminado)",
//     creadaPorNombre: o.creado_por?.nombre ?? null,
//     createdAt: o.created_at,
//     totalLineas: (o.lineas ?? []).length,
//   }))
// }

// export type OrdenCompraEstado = "pendiente_aprobacion" | "aprobada" | "rechazada"

// export type LineaOrdenCompraDetalle = {
//   id: string
//   insumoCodigo: number
//   insumoDescripcion: string
//   um: string | null
//   cantidad: number
//   precioUnitario: number
//   porcentajeDescuento: number
//   porcentajeIva: number
// }

// export type OrdenCompraDetalle = {
//   id: string
//   numero: number
//   estado: OrdenCompraEstado
//   proyectoCodigo: string | null
//   proyectoNombre: string | null
//   proyectoCiudad: string | null
//   empresaNombre: string | null
//   empresaNit: string | null
//   proveedorNombre: string
//   proveedorNit: string | null
//   proveedorDireccion: string | null
//   proveedorCiudad: string | null
//   proveedorTelefono: string | null
//   proveedorEmail: string | null
//   proveedorContacto: string | null
//   sitioEntrega: string | null
//   fechaEntrega: string | null
//   contactoNombre: string | null
//   telefono: string | null
//   ciudad: string | null
//   email: string | null
//   condicionesPago: string | null
//   observaciones: string | null
//   enviada: boolean
//   creadaPorNombre: string | null
//   createdAt: string
//   aprobadaPorNombre: string | null
//   aprobadaAt: string | null
//   motivoRechazo: string | null
//   lineas: LineaOrdenCompraDetalle[]
// }
// export async function obtenerOrdenCompraDetalle(ordenId: string): Promise<OrdenCompraDetalle> {
//   const supabase = await createClient()
//   const {
//     data: { user },
//   } = await supabase.auth.getUser()
//   if (!user) throw new Error("No autenticado.")

//   const { data, error } = await supabase
//     .from("ordenes_compra")
//     .select(
//       `
//       id, numero, estado, sitio_entrega, fecha_entrega, contacto_nombre, telefono, ciudad, email,
//       condiciones_pago, observaciones, enviada, created_at, aprobada_at, motivo_rechazo,
//       proyecto:proyectos!ordenes_compra_proyecto_id_fkey(codigo, nombre, ciudad, empresa:empresas(nit, razon_social)),
//       proveedor:proveedores!ordenes_compra_proveedor_id_fkey(
//         nombre, numero_documento, digito_verificacion, direccion, ciudad, telefono, correo, nombre_contacto
//       ),
//       creado_por:perfiles!ordenes_compra_created_by_fkey(nombre),
//       aprobada_por_perfil:perfiles!ordenes_compra_aprobada_por_fkey(nombre),
//       lineas:ordenes_compra_items!ordenes_compra_items_orden_compra_id_fkey(
//         id, cantidad, precio_unitario, porcentaje_descuento, porcentaje_iva,
//         pedido:pedidos_insumos!ordenes_compra_items_pedido_insumo_id_fkey(
//           insumo:maestro_insumos!pedidos_insumos_insumo_id_fkey(codigo, descripcion, u_m)
//         )
//       )
//     `
//     )
//     .eq("id", ordenId)
//     .single()

//   if (error) throw new Error(error.message)

//   const d = data as any
//   const nitProveedor = d.proveedor?.numero_documento
//     ? `${d.proveedor.numero_documento}${d.proveedor.digito_verificacion ? `-${d.proveedor.digito_verificacion}` : ""}`
//     : null

//   return {
//     id: d.id,
//     numero: d.numero,
//     estado: d.estado,
//     proyectoCodigo: d.proyecto?.codigo ?? null,
//     proyectoNombre: d.proyecto?.nombre ?? null,
//     proyectoCiudad: d.proyecto?.ciudad ?? null,
//     empresaNombre: d.proyecto?.empresa?.razon_social ?? null,
//     empresaNit: d.proyecto?.empresa?.nit ?? null,
//     proveedorNombre: d.proveedor?.nombre ?? "(proveedor eliminado)",
//     proveedorNit: nitProveedor,
//     proveedorDireccion: d.proveedor?.direccion ?? null,
//     proveedorCiudad: d.proveedor?.ciudad ?? null,
//     proveedorTelefono: d.proveedor?.telefono ?? null,
//     proveedorEmail: d.proveedor?.correo ?? null,
//     proveedorContacto: d.proveedor?.nombre_contacto ?? null,
//     sitioEntrega: d.sitio_entrega,
//     fechaEntrega: d.fecha_entrega,
//     contactoNombre: d.contacto_nombre,
//     telefono: d.telefono,
//     ciudad: d.ciudad,
//     email: d.email,
//     condicionesPago: d.condiciones_pago,
//     observaciones: d.observaciones,
//     enviada: d.enviada,
//     creadaPorNombre: d.creado_por?.nombre ?? null,
//     createdAt: d.created_at,
//     aprobadaPorNombre: d.aprobada_por_perfil?.nombre ?? null,
//     aprobadaAt: d.aprobada_at,
//     motivoRechazo: d.motivo_rechazo,
//     lineas: (d.lineas ?? []).map((l: any) => ({
//       id: l.id,
//       insumoCodigo: l.pedido?.insumo?.codigo,
//       insumoDescripcion: l.pedido?.insumo?.descripcion ?? "(insumo eliminado)",
//       um: l.pedido?.insumo?.u_m ?? null,
//       cantidad: Number(l.cantidad),
//       precioUnitario: Number(l.precio_unitario),
//       porcentajeDescuento: Number(l.porcentaje_descuento),
//       porcentajeIva: Number(l.porcentaje_iva),
//     })),
//   }
// }

// export async function aprobarOrdenCompra(ordenId: string): Promise<void> {
//   await requerirAdmin()
//   const supabase = await createClient()
//   const { error } = await supabase.rpc("aprobar_orden_compra", { p_orden_id: ordenId })
//   if (error) throw new Error(error.message)
// }

// export async function rechazarOrdenCompra(ordenId: string, motivo: string): Promise<void> {
//   await requerirAdmin()
//   if (!motivo.trim()) throw new Error("El motivo de rechazo es obligatorio.")
//   const supabase = await createClient()
//   const { error } = await supabase.rpc("rechazar_orden_compra", {
//     p_orden_id: ordenId,
//     p_motivo: motivo.trim(),
//   })
//   if (error) throw new Error(error.message)
// }

// export async function marcarOrdenEnviada(ordenId: string): Promise<void> {
//   await requerirScope("rol_compras")
//   const supabase = await createClient()
//   const { error } = await supabase.rpc("marcar_orden_enviada", { p_orden_id: ordenId })
//   if (error) throw new Error(error.message)
// }

// export type OrdenCompraListado = {
//   id: string
//   numero: number
//   estado: OrdenCompraEstado
//   enviada: boolean
//   proyectoCodigo: string | null
//   proyectoNombre: string | null
//   proveedorNombre: string
//   creadaPorNombre: string | null
//   createdAt: string
// }

// // Sin requerirScope a propósito -- la RLS (ordenes_compra_select_proyecto +
// // ordenes_compra_select para rol_compras/admin) ya decide qué filas ve cada
// // quien. Un ingeniero ve las OC de sus proyectos, Compras/admin las ve todas.
// export async function listarTodasLasOrdenesCompra(): Promise<OrdenCompraListado[]> {
//   const supabase = await createClient()
//   const {
//     data: { user },
//   } = await supabase.auth.getUser()
//   if (!user) throw new Error("No autenticado.")

//   const { data, error } = await supabase
//     .from("ordenes_compra")
//     .select(
//       `
//       id, numero, estado, enviada, created_at,
//       proyecto:proyectos!ordenes_compra_proyecto_id_fkey(codigo, nombre),
//       proveedor:proveedores!ordenes_compra_proveedor_id_fkey(nombre),
//       creado_por:perfiles!ordenes_compra_created_by_fkey(nombre)
//     `
//     )
//     .order("created_at", { ascending: false })

//   if (error) throw new Error(error.message)

//   return (data ?? []).map((o: any) => ({
//     id: o.id,
//     numero: o.numero,
//     estado: o.estado,
//     enviada: o.enviada,
//     proyectoCodigo: o.proyecto?.codigo ?? null,
//     proyectoNombre: o.proyecto?.nombre ?? null,
//     proveedorNombre: o.proveedor?.nombre ?? "(proveedor eliminado)",
//     creadaPorNombre: o.creado_por?.nombre ?? null,
//     createdAt: o.created_at,
//   }))
// }

// // ---------------------------------------------------------------------------
// // Notificaciones
// // ---------------------------------------------------------------------------

// export type NotificacionTipo = "pedido_rechazado" | "orden_compra_rechazada"
// export type NotificacionEntidadTipo = "pedido_insumo" | "orden_compra"

// export type Notificacion = {
//   id: string
//   tipo: NotificacionTipo
//   entidadTipo: NotificacionEntidadTipo
//   entidadId: string
//   titulo: string
//   mensaje: string
//   leida: boolean
//   createdAt: string
// }

// // Sin requerirScope -- la RLS (notificaciones_select_propias) ya limita el
// // resultado a usuario_id = auth.uid(). Sin paginación por ahora, igual que
// // el resto del módulo: revisar si el volumen crece.
// export async function listarNotificaciones(): Promise<Notificacion[]> {
//   const supabase = await createClient()
//   const {
//     data: { user },
//   } = await supabase.auth.getUser()
//   if (!user) throw new Error("No autenticado.")

//   const { data, error } = await supabase
//     .from("notificaciones")
//     .select("id, tipo, entidad_tipo, entidad_id, titulo, mensaje, leida, created_at")
//     .order("created_at", { ascending: false })
//     .limit(20)

//   if (error) throw new Error(error.message)

//   return (data ?? []).map((n) => ({
//     id: n.id,
//     tipo: n.tipo,
//     entidadTipo: n.entidad_tipo,
//     entidadId: n.entidad_id,
//     titulo: n.titulo,
//     mensaje: n.mensaje,
//     leida: n.leida,
//     createdAt: n.created_at,
//   }))
// }

// // El .eq("id", id) es defensivo, no de seguridad -- la policy
// // notificaciones_update_propias (usuario_id = auth.uid()) ya impide que
// // alguien marque como leída una notificación que no es suya, aunque
// // adivine el id.
// export async function marcarNotificacionLeida(id: string): Promise<void> {
//   const supabase = await createClient()
//   const { error } = await supabase.from("notificaciones").update({ leida: true }).eq("id", id)
//   if (error) throw new Error(error.message)
// }

"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirScope, requerirAccion, obtenerPermisosRol } from "@/lib/permisos"
import {
  calcularEstadoVisible,
  type EstadoEntregaOrden,
  type EstadoOrdenVisible,
} from "@/lib/ordenes-compra-estado"

// ---------------------------------------------------------------------------
// Compras -- cola de pedidos aprobados listos para generar orden de compra
// ---------------------------------------------------------------------------

export type ProyectoSugerido = { id: string; codigo: string | null; nombre: string }

export async function listarProyectosCompras(): Promise<ProyectoSugerido[]> {
  await requerirScope("rol_compras")
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("proyectos")
    .select("id, codigo, nombre")
    .order("codigo", { ascending: false, nullsFirst: false })

  if (error) throw new Error(error.message)
  return data ?? []
}

export type InsumoSugerido = { id: string; codigo: number; descripcion: string; u_m: string | null }

export async function buscarInsumosCompras(termino: string): Promise<InsumoSugerido[]> {
  if (!termino || termino.trim().length < 2) return []
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("maestro_insumos")
    .select("id, codigo, descripcion, u_m")
    .ilike("descripcion", `%${termino.trim()}%`)
    .order("descripcion")
    .limit(15)

  if (error) throw new Error(error.message)
  return data ?? []
}

export type UsuarioSugerido = { id: string; nombre: string }

export async function buscarUsuarios(termino: string): Promise<UsuarioSugerido[]> {
  if (!termino || termino.trim().length < 2) return []
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("perfiles")
    .select("id, nombre")
    .ilike("nombre", `%${termino.trim()}%`)
    .order("nombre")
    .limit(15)

  if (error) throw new Error(error.message)
  return data ?? []
}

export type FiltrosPedidosCompra = {
  proyectoId: string
  usuarioId?: string | null
  insumoId?: string | null
  observacion?: string | null
  fechaPedidoInicio?: string | null
  fechaPedidoFin?: string | null
  fechaRequerimientoInicio?: string | null
  fechaRequerimientoFin?: string | null
  fechaAprobacionInicio?: string | null
  fechaAprobacionFin?: string | null
  soloUrgentes?: boolean
}

export type PedidoParaComprar = {
  id: string
  insumoId: string
  insumoCodigo: number
  insumoDescripcion: string
  um: string | null
  cantidad: number
  cantidadPendiente: number
  valorUnitarioProyectado: number | null
  fechaPedido: string
  fechaRequerida: string
  urgente: boolean
  observaciones: string | null
  soporteUrl: string | null
  solicitadoPorNombre: string | null
  resueltoAt: string | null
}

const SELECT_PEDIDO_PARA_COMPRAR = `
  id, cantidad, fecha_requerida, urgente, observaciones, soporte_url, created_at, resuelto_at,
  insumo:maestro_insumos!pedidos_insumos_insumo_id_fkey(id, codigo, descripcion, u_m, vr_unitario),
  solicitante:perfiles!pedidos_insumos_solicitado_por_fkey(nombre),
  compras:ordenes_compra_items!ordenes_compra_items_pedido_insumo_id_fkey(
    cantidad,
    orden:ordenes_compra!ordenes_compra_items_orden_compra_id_fkey(estado)
  )
`

function mapPedidoParaComprar(f: any): PedidoParaComprar {
  // Las líneas de órdenes CANCELADAS ya no cuentan como comprado: esos pedidos
  // vuelven a la cola (igual que valida crear_orden_compra en la base).
  const yaComprado = (f.compras ?? [])
    .filter((c: any) => c.orden?.estado !== "cancelada")
    .reduce((acc: number, c: any) => acc + Number(c.cantidad), 0)
  return {
    id: f.id,
    insumoId: f.insumo?.id,
    insumoCodigo: f.insumo?.codigo,
    insumoDescripcion: f.insumo?.descripcion ?? "(insumo eliminado)",
    um: f.insumo?.u_m ?? null,
    cantidad: Number(f.cantidad),
    cantidadPendiente: Number(f.cantidad) - yaComprado,
    valorUnitarioProyectado: f.insumo?.vr_unitario ?? null,
    fechaPedido: f.created_at,
    fechaRequerida: f.fecha_requerida,
    urgente: f.urgente,
    observaciones: f.observaciones,
    soporteUrl: f.soporte_url,
    solicitadoPorNombre: f.solicitante?.nombre ?? null,
    resueltoAt: f.resuelto_at,
  }
}

export async function listarPedidosParaComprar(
  filtros: FiltrosPedidosCompra
): Promise<PedidoParaComprar[]> {
  await requerirScope("rol_compras")
  const supabase = await createClient()

  let query = supabase
    .from("pedidos_insumos")
    .select(SELECT_PEDIDO_PARA_COMPRAR)
    .eq("proyecto_id", filtros.proyectoId)
    .eq("estado", "aprobado")
    .is("rechazado_compras_at", null)
    .order("urgente", { ascending: false })
    .order("fecha_requerida", { ascending: true })

  if (filtros.usuarioId) query = query.eq("solicitado_por", filtros.usuarioId)
  if (filtros.insumoId) query = query.eq("insumo_id", filtros.insumoId)
  if (filtros.observacion?.trim()) query = query.ilike("observaciones", `%${filtros.observacion.trim()}%`)
  if (filtros.soloUrgentes) query = query.eq("urgente", true)

  if (filtros.fechaPedidoInicio) query = query.gte("created_at", filtros.fechaPedidoInicio)
  if (filtros.fechaPedidoFin) query = query.lte("created_at", `${filtros.fechaPedidoFin}T23:59:59`)
  if (filtros.fechaRequerimientoInicio) query = query.gte("fecha_requerida", filtros.fechaRequerimientoInicio)
  if (filtros.fechaRequerimientoFin) query = query.lte("fecha_requerida", filtros.fechaRequerimientoFin)
  if (filtros.fechaAprobacionInicio) query = query.gte("resuelto_at", filtros.fechaAprobacionInicio)
  if (filtros.fechaAprobacionFin) query = query.lte("resuelto_at", `${filtros.fechaAprobacionFin}T23:59:59`)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  return (data ?? []).map(mapPedidoParaComprar).filter((p) => p.cantidadPendiente > 0)
}

export async function obtenerPedidosPorId(ids: string[]): Promise<PedidoParaComprar[]> {
  await requerirScope("rol_compras")
  if (ids.length === 0) return []
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("pedidos_insumos")
    .select(SELECT_PEDIDO_PARA_COMPRAR)
    .in("id", ids)
    .eq("estado", "aprobado")
    .is("rechazado_compras_at", null)

  if (error) throw new Error(error.message)

  return (data ?? []).map(mapPedidoParaComprar).filter((p) => p.cantidadPendiente > 0)
}

export async function rechazarPedidoCompras(pedidoId: string, motivo: string): Promise<void> {
  await requerirScope("rol_compras")
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { error } = await supabase
    .from("pedidos_insumos")
    .update({
      rechazado_compras_at: new Date().toISOString(),
      rechazado_compras_por: user?.id ?? null,
      observaciones_compras: motivo,
    })
    .eq("id", pedidoId)

  if (error) throw new Error(error.message)
}

// ---------------------------------------------------------------------------
// Generar OC
// ---------------------------------------------------------------------------

export type ProveedorSugerido = {
  id: string
  nombre: string
  idProv: string | null
  tipoProveedor: string | null
}

export async function buscarProveedores(termino: string): Promise<ProveedorSugerido[]> {
  await requerirScope("rol_compras")
  if (!termino || termino.trim().length < 2) return []
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("proveedores")
    .select("unique_id, nombre, id_prov, tipo_proveedor")
    .eq("estado", "ACTIVO")
    .ilike("nombre", `%${termino.trim()}%`)
    .order("nombre")
    .limit(15)

  if (error) throw new Error(error.message)
  return (data ?? []).map((p) => ({
    id: p.unique_id,
    nombre: p.nombre,
    idProv: p.id_prov,
    tipoProveedor: p.tipo_proveedor,
  }))
}

export type InformacionBancariaProveedor = {
  titular: string | null
  entidadBancaria: string | null
  tipoCuenta: string | null
  noCuenta: string | null
}

export type ProveedorDetalle = {
  id: string
  nombre: string
  nombreContacto: string | null
  telefono: string | null
  correo: string | null
  ciudad: string | null
  direccion: string | null
  informacionBancaria: InformacionBancariaProveedor | null
}

export async function obtenerProveedorDetalle(proveedorId: string): Promise<ProveedorDetalle> {
  await requerirScope("rol_compras")
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("proveedores")
    .select(
      `
      unique_id, nombre, nombre_contacto, telefono, correo, ciudad, direccion,
      informacion_bancaria!informacion_bancaria_id_fkey(titular, entidad_bancaria, tipo_cuenta, no_cuenta)
    `
    )
    .eq("unique_id", proveedorId)
    .single()

  if (error) throw new Error(error.message)

  const d = data as any
  const banco = Array.isArray(d.informacion_bancaria) ? d.informacion_bancaria[0] : d.informacion_bancaria

  return {
    id: d.unique_id,
    nombre: d.nombre,
    nombreContacto: d.nombre_contacto,
    telefono: d.telefono,
    correo: d.correo,
    ciudad: d.ciudad,
    direccion: d.direccion,
    informacionBancaria: banco
      ? {
          titular: banco.titular,
          entidadBancaria: banco.entidad_bancaria,
          tipoCuenta: banco.tipo_cuenta,
          noCuenta: banco.no_cuenta,
        }
      : null,
  }
}

export type LineaOrdenCompra = {
  pedidoId: string
  cantidadComprar: number
  precioUnitario: number
  porcentajeDescuento: number
  porcentajeIva: number
}

export type DatosOrdenCompra = {
  proyectoId: string
  proveedorId: string
  sitioEntrega?: string | null
  fechaEntrega?: string | null
  contactoNombre?: string | null
  telefono?: string | null
  ciudad?: string | null
  email?: string | null
  condicionesPago?: string | null
  observaciones?: string | null
  lineas: LineaOrdenCompra[]
}

export async function crearOrdenCompra(datos: DatosOrdenCompra): Promise<string> {
  await requerirScope("rol_compras")

  if (datos.lineas.length === 0) {
    throw new Error("Selecciona al menos un insumo para la orden de compra.")
  }

  const supabase = await createClient()

    const { data, error } = await supabase.rpc("crear_orden_compra", {
    p_proyecto_id: datos.proyectoId,
    p_proveedor_id: datos.proveedorId,
    p_sitio_entrega: datos.sitioEntrega ?? null,
    p_fecha_entrega: datos.fechaEntrega ?? null,
    p_contacto_nombre: datos.contactoNombre ?? null,
    p_telefono: datos.telefono ?? null,
    p_ciudad: datos.ciudad ?? null,
    p_email: datos.email ?? null,
    p_condiciones_pago: datos.condicionesPago ?? null,
    p_observaciones: datos.observaciones ?? null,
    p_lineas: datos.lineas.map((l) => ({
      pedido_id: l.pedidoId,
      cantidad_comprar: l.cantidadComprar,
      precio_unitario: l.precioUnitario,
      porcentaje_descuento: l.porcentajeDescuento,
      porcentaje_iva: l.porcentajeIva,
    })),
  })

  if (error) throw new Error(error.message)
  return data as string
}

// ---------------------------------------------------------------------------
// Aprobación de OC + pantalla de detalle
// ---------------------------------------------------------------------------

// Qué puede hacer el usuario con las órdenes de compra (lo decide su rol; ver
// Roles y permisos). Los nombres esAdmin / rolCompras se conservan porque las
// pantallas ya los usan: esAdmin = puede aprobar/rechazar, rolCompras = puede
// comprar (crear la orden, marcarla como enviada).
export type PermisosOrdenCompra = {
  esAdmin: boolean
  rolCompras: boolean
  puedeDesaprobar: boolean
  puedeCancelar: boolean
}

export async function obtenerPermisosOrdenCompra(): Promise<PermisosOrdenCompra> {
  const permisos = await obtenerPermisosRol()
  if (!permisos) {
    return { esAdmin: false, rolCompras: false, puedeDesaprobar: false, puedeCancelar: false }
  }

  const puede = (accion: string) => permisos.esAdministrador || permisos.acciones.includes(accion)
  return {
    esAdmin: puede("aprobar_oc"),
    rolCompras: puede("comprar"),
    puedeDesaprobar: puede("desaprobar_oc"),
    puedeCancelar: puede("cancelar_oc"),
  }
}

export type OrdenCompraResumen = {
  id: string
  numero: number
  proyectoCodigo: string | null
  proyectoNombre: string | null
  proveedorNombre: string
  creadaPorNombre: string | null
  createdAt: string
  totalLineas: number
}

export async function listarOrdenesCompraPendientes(): Promise<OrdenCompraResumen[]> {
  await requerirAccion("aprobar_oc")
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("ordenes_compra")
    .select(
      `
      id, numero, created_at,
      proyecto:proyectos!ordenes_compra_proyecto_id_fkey(codigo, nombre),
      proveedor:proveedores!ordenes_compra_proveedor_id_fkey(nombre),
      creado_por:perfiles!ordenes_compra_created_by_fkey(nombre),
      lineas:ordenes_compra_items!ordenes_compra_items_orden_compra_id_fkey(id)
    `
    )
    .eq("estado", "pendiente_aprobacion")
    .order("created_at", { ascending: true })

  if (error) throw new Error(error.message)

  return (data ?? []).map((o: any) => ({
    id: o.id,
    numero: o.numero,
    proyectoCodigo: o.proyecto?.codigo ?? null,
    proyectoNombre: o.proyecto?.nombre ?? null,
    proveedorNombre: o.proveedor?.nombre ?? "(proveedor eliminado)",
    creadaPorNombre: o.creado_por?.nombre ?? null,
    createdAt: o.created_at,
    totalLineas: (o.lineas ?? []).length,
  }))
}

export type OrdenCompraEstado = "pendiente_aprobacion" | "aprobada" | "rechazada" | "cancelada"

export type LineaOrdenCompraDetalle = {
  id: string
  insumoCodigo: number
  insumoDescripcion: string
  um: string | null
  cantidad: number
  precioUnitario: number
  porcentajeDescuento: number
  porcentajeIva: number
}

export type OrdenCompraDetalle = {
  id: string
  numero: number
  estado: OrdenCompraEstado
  estadoEntrega: EstadoEntregaOrden
  estadoVisible: EstadoOrdenVisible
  proyectoCodigo: string | null
  proyectoNombre: string | null
  proyectoCiudad: string | null
  empresaNombre: string | null
  empresaNit: string | null
  empresaLogoUrl: string | null
  proveedorNombre: string
  proveedorNit: string | null
  proveedorDireccion: string | null
  proveedorCiudad: string | null
  proveedorTelefono: string | null
  proveedorEmail: string | null
  proveedorContacto: string | null
  sitioEntrega: string | null
  fechaEntrega: string | null
  contactoNombre: string | null
  telefono: string | null
  ciudad: string | null
  email: string | null
  condicionesPago: string | null
  observaciones: string | null
  enviada: boolean
  creadaPorNombre: string | null
  createdAt: string
  aprobadaPorNombre: string | null
  aprobadaAt: string | null
  motivoRechazo: string | null
  motivoDesaprobacion: string | null
  motivoCancelacion: string | null
  canceladaAt: string | null
  lineas: LineaOrdenCompraDetalle[]
}
export async function obtenerOrdenCompraDetalle(ordenId: string): Promise<OrdenCompraDetalle> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado.")

  const { data, error } = await supabase
    .from("ordenes_compra")
    .select(
      `
      id, numero, estado, estado_entrega, sitio_entrega, fecha_entrega, contacto_nombre, telefono, ciudad, email,
      condiciones_pago, observaciones, enviada, created_at, aprobada_at, motivo_rechazo,
      motivo_desaprobacion, motivo_cancelacion, cancelada_at,
      proyecto:proyectos!ordenes_compra_proyecto_id_fkey(codigo, nombre, ciudad, empresa:empresas(nit, razon_social, logo_url)),
      proveedor:proveedores!ordenes_compra_proveedor_id_fkey(
        nombre, numero_documento, digito_verificacion, direccion, ciudad, telefono, correo, nombre_contacto
      ),
      creado_por:perfiles!ordenes_compra_created_by_fkey(nombre),
      aprobada_por_perfil:perfiles!ordenes_compra_aprobada_por_fkey(nombre),
      lineas:ordenes_compra_items!ordenes_compra_items_orden_compra_id_fkey(
        id, cantidad, precio_unitario, porcentaje_descuento, porcentaje_iva,
        pedido:pedidos_insumos!ordenes_compra_items_pedido_insumo_id_fkey(
          insumo:maestro_insumos!pedidos_insumos_insumo_id_fkey(codigo, descripcion, u_m)
        )
      )
    `
    )
    .eq("id", ordenId)
    .single()

  if (error) throw new Error(error.message)

  const d = data as any
  const nitProveedor = d.proveedor?.numero_documento
    ? `${d.proveedor.numero_documento}${d.proveedor.digito_verificacion ? `-${d.proveedor.digito_verificacion}` : ""}`
    : null

  return {
    id: d.id,
    numero: d.numero,
    estado: d.estado,
    estadoEntrega: d.estado_entrega,
    estadoVisible: calcularEstadoVisible(d.estado, d.estado_entrega),
    proyectoCodigo: d.proyecto?.codigo ?? null,
    proyectoNombre: d.proyecto?.nombre ?? null,
    proyectoCiudad: d.proyecto?.ciudad ?? null,
    empresaNombre: d.proyecto?.empresa?.razon_social ?? null,
    empresaNit: d.proyecto?.empresa?.nit ?? null,
    empresaLogoUrl: d.proyecto?.empresa?.logo_url ?? null,
    proveedorNombre: d.proveedor?.nombre ?? "(proveedor eliminado)",
    proveedorNit: nitProveedor,
    proveedorDireccion: d.proveedor?.direccion ?? null,
    proveedorCiudad: d.proveedor?.ciudad ?? null,
    proveedorTelefono: d.proveedor?.telefono ?? null,
    proveedorEmail: d.proveedor?.correo ?? null,
    proveedorContacto: d.proveedor?.nombre_contacto ?? null,
    sitioEntrega: d.sitio_entrega,
    fechaEntrega: d.fecha_entrega,
    contactoNombre: d.contacto_nombre,
    telefono: d.telefono,
    ciudad: d.ciudad,
    email: d.email,
    condicionesPago: d.condiciones_pago,
    observaciones: d.observaciones,
    enviada: d.enviada,
    creadaPorNombre: d.creado_por?.nombre ?? null,
    createdAt: d.created_at,
    aprobadaPorNombre: d.aprobada_por_perfil?.nombre ?? null,
    aprobadaAt: d.aprobada_at,
    motivoRechazo: d.motivo_rechazo,
    motivoDesaprobacion: d.motivo_desaprobacion,
    motivoCancelacion: d.motivo_cancelacion,
    canceladaAt: d.cancelada_at,
    lineas: (d.lineas ?? []).map((l: any) => ({
      id: l.id,
      insumoCodigo: l.pedido?.insumo?.codigo,
      insumoDescripcion: l.pedido?.insumo?.descripcion ?? "(insumo eliminado)",
      um: l.pedido?.insumo?.u_m ?? null,
      cantidad: Number(l.cantidad),
      precioUnitario: Number(l.precio_unitario),
      porcentajeDescuento: Number(l.porcentaje_descuento),
      porcentajeIva: Number(l.porcentaje_iva),
    })),
  }
}

export async function aprobarOrdenCompra(ordenId: string): Promise<void> {
  await requerirAccion("aprobar_oc")
  const supabase = await createClient()
  const { error } = await supabase.rpc("aprobar_orden_compra", { p_orden_id: ordenId })
  if (error) throw new Error(error.message)
}

export async function rechazarOrdenCompra(ordenId: string, motivo: string): Promise<void> {
  await requerirAccion("aprobar_oc")
  if (!motivo.trim()) throw new Error("El motivo de rechazo es obligatorio.")
  const supabase = await createClient()
  const { error } = await supabase.rpc("rechazar_orden_compra", {
    p_orden_id: ordenId,
    p_motivo: motivo.trim(),
  })
  if (error) throw new Error(error.message)
}

// Devuelve una orden aprobada a "pendiente de aprobación". Solo si no fue
// enviada al proveedor ni tiene material recibido (lo valida la base).
export async function desaprobarOrdenCompra(ordenId: string, motivo: string): Promise<void> {
  await requerirAccion("desaprobar_oc")
  if (!motivo.trim()) throw new Error("El motivo es obligatorio.")
  const supabase = await createClient()
  const { error } = await supabase.rpc("desaprobar_orden_compra", {
    p_orden_id: ordenId,
    p_motivo: motivo.trim(),
  })
  if (error) throw new Error(error.message)
}

// Cancela una orden aprobada. No se puede si tiene material recibido (entrega
// parcial o entregada). Sus pedidos vuelven a la cola de "Comprar pedidos".
export async function cancelarOrdenCompra(ordenId: string, motivo: string): Promise<void> {
  await requerirAccion("cancelar_oc")
  if (!motivo.trim()) throw new Error("El motivo de cancelación es obligatorio.")
  const supabase = await createClient()
  const { error } = await supabase.rpc("cancelar_orden_compra", {
    p_orden_id: ordenId,
    p_motivo: motivo.trim(),
  })
  if (error) throw new Error(error.message)
}

export async function marcarOrdenEnviada(ordenId: string): Promise<void> {
  await requerirScope("rol_compras")
  const supabase = await createClient()
  const { error } = await supabase.rpc("marcar_orden_enviada", { p_orden_id: ordenId })
  if (error) throw new Error(error.message)
}

export type OrdenCompraListado = {
  id: string
  numero: number
  estado: OrdenCompraEstado
  estadoEntrega: EstadoEntregaOrden
  estadoVisible: EstadoOrdenVisible
  enviada: boolean
  proyectoCodigo: string | null
  proyectoNombre: string | null
  proveedorNombre: string
  creadaPorNombre: string | null
  createdAt: string
  tieneSobrecostoPrecio: boolean
}

// Sin requerirScope a propósito -- la RLS (ordenes_compra_select_proyecto +
// ordenes_compra_select para rol_compras/admin) ya decide qué filas ve cada
// quien. Un ingeniero ve las OC de sus proyectos, Compras/admin las ve todas.
export async function listarTodasLasOrdenesCompra(): Promise<OrdenCompraListado[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado.")

  const { data, error } = await supabase
    .from("ordenes_compra")
    .select(
      `
      id, numero, estado, estado_entrega, enviada, created_at,
      proyecto:proyectos!ordenes_compra_proyecto_id_fkey(codigo, nombre),
      proveedor:proveedores!ordenes_compra_proveedor_id_fkey(nombre),
      creado_por:perfiles!ordenes_compra_created_by_fkey(nombre)
    `
    )
    .order("created_at", { ascending: false })

  if (error) throw new Error(error.message)

  const ordenes = (data ?? []).map((o: any) => ({
    id: o.id,
    numero: o.numero,
    estado: o.estado,
    estadoEntrega: o.estado_entrega,
    estadoVisible: calcularEstadoVisible(o.estado, o.estado_entrega),
    enviada: o.enviada,
    proyectoCodigo: o.proyecto?.codigo ?? null,
    proyectoNombre: o.proyecto?.nombre ?? null,
    proveedorNombre: o.proveedor?.nombre ?? "(proveedor eliminado)",
    creadaPorNombre: o.creado_por?.nombre ?? null,
    createdAt: o.created_at,
  }))

  return await conSobrecostoPrecio(ordenes)
}

// Marca, para cada orden, si alguna de sus líneas tiene precio_unitario por
// encima del +10% del precio EFECTIVO vigente del insumo (promedio de compra
// real, o vr_unitario de respaldo si no hay historial) -- mismo umbral que
// usa trg_notificar_precio_sobre_efectivo_oc_item al crear la orden. Se
// recalcula en vivo vía RPC (no se guarda una columna) para que el panel
// siempre refleje el precio efectivo actual, no el que había al crear la OC.
async function conSobrecostoPrecio<T extends { id: string }>(
  ordenes: T[]
): Promise<(T & { tieneSobrecostoPrecio: boolean })[]> {
  if (ordenes.length === 0) return []

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("ordenes_compra_con_sobrecosto_precio", {
    p_orden_ids: ordenes.map((o) => o.id),
  })
  if (error) throw new Error(error.message)

  const idsConSobrecosto = new Set((data ?? []).map((f: any) => f.orden_compra_id as string))
  return ordenes.map((o) => ({ ...o, tieneSobrecostoPrecio: idsConSobrecosto.has(o.id) }))
}

// ---------------------------------------------------------------------------
// Notificaciones
// ---------------------------------------------------------------------------

export type NotificacionTipo =
  | "pedido_rechazado"
  | "orden_compra_rechazada"
  | "insumo_sobre_presupuesto"
  | "orden_compra_precio_sobre_efectivo"
export type NotificacionEntidadTipo = "pedido_insumo" | "orden_compra"

export type Notificacion = {
  id: string
  tipo: NotificacionTipo
  entidadTipo: NotificacionEntidadTipo
  entidadId: string
  titulo: string
  mensaje: string
  leida: boolean
  createdAt: string
}

// Sin requerirScope -- la RLS (notificaciones_select_propias) ya limita el
// resultado a usuario_id = auth.uid(). Sin paginación por ahora, igual que
// el resto del módulo: revisar si el volumen crece.
export async function listarNotificaciones(): Promise<Notificacion[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado.")

  const { data, error } = await supabase
    .from("notificaciones")
    .select("id, tipo, entidad_tipo, entidad_id, titulo, mensaje, leida, created_at")
    .order("created_at", { ascending: false })
    .limit(20)

  if (error) throw new Error(error.message)

  return (data ?? []).map((n) => ({
    id: n.id,
    tipo: n.tipo,
    entidadTipo: n.entidad_tipo,
    entidadId: n.entidad_id,
    titulo: n.titulo,
    mensaje: n.mensaje,
    leida: n.leida,
    createdAt: n.created_at,
  }))
}

// El .eq("id", id) es defensivo, no de seguridad -- la policy
// notificaciones_update_propias (usuario_id = auth.uid()) ya impide que
// alguien marque como leída una notificación que no es suya, aunque
// adivine el id.
export async function marcarNotificacionLeida(id: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from("notificaciones").update({ leida: true }).eq("id", id)
  if (error) throw new Error(error.message)
}