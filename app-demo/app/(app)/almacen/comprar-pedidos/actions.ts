"use server"

import { unidadesDeCompra } from "@/lib/unidades"
import { esCantidadEnteraPositiva } from "@/lib/numeros"

import { createClient } from "@/lib/supabase/server"
import { traerTodo } from "@/lib/supabase/traer-todo"
import { puedeBuscar, limiteBusqueda } from "@/lib/busqueda"
import { cortarPagina, rangoPagina } from "@/lib/paginacion"
import { requerirScope, requerirAccion, obtenerPermisosRol, obtenerUsuarioId } from "@/lib/permisos"
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
  if (!puedeBuscar(termino)) return []
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("maestro_insumos")
    .select("id, codigo, descripcion, u_m")
    .ilike("descripcion", `%${termino.trim()}%`)
    .order("descripcion")
    .limit(limiteBusqueda(termino))

  if (error) throw new Error(error.message)
  return data ?? []
}

export type UsuarioSugerido = { id: string; nombre: string }

export async function buscarUsuarios(termino: string): Promise<UsuarioSugerido[]> {
  if (!puedeBuscar(termino)) return []
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("perfiles")
    .select("id, nombre")
    .ilike("nombre", `%${termino.trim()}%`)
    .order("nombre")
    .limit(limiteBusqueda(termino))

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
  // true (por defecto): solo lo que todavía falta comprar. false: también las
  // líneas que ya quedaron completas en órdenes de compra.
  soloPendientes?: boolean
}

export type PedidoParaComprar = {
  id: string
  // Requisición (agrupada) a la que pertenece esta línea.
  requisicionId: string
  requisicionNumero: number | null
  insumoId: string
  insumoCodigo: number
  insumoDescripcion: string
  // Unidad de COMPRA (la u_m del insumo): en esta unidad van `cantidad`,
  // `cantidadPendiente`, la orden de compra y su precio.
  um: string | null
  cantidad: number
  cantidadPendiente: number
  // Lo que pidió el ingeniero, en la unidad del APU (120 m), y lo que falta
  // por comprar en esa unidad. `factor` = conversión sugerida, la de la línea
  // del APU (1 rollo = 100 m); Compras la puede cambiar en la orden.
  cantidadUso: number
  pendienteUso: number
  unidadUso: string | null
  factor: number
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
  id, grupo_pedido_id, cantidad, unidad, factor_unidad, fecha_requerida, urgente, observaciones, soporte_url, created_at, resuelto_at,
  requisicion:requisiciones!pedidos_insumos_requisicion_fkey(numero),
  insumo:maestro_insumos!pedidos_insumos_insumo_id_fkey(id, codigo, descripcion, u_m, vr_unitario),
  solicitante:perfiles!pedidos_insumos_solicitado_por_fkey(nombre),
  compras:ordenes_compra_items!ordenes_compra_items_pedido_insumo_id_fkey(
    cantidad,
    factor_unidad,
    orden:ordenes_compra!ordenes_compra_items_orden_compra_id_fkey(estado)
  )
`

// Órdenes cuyas líneas NO comprometen la cantidad de la requisición.
const ESTADOS_OC_SIN_COMPROMISO = new Set(["cancelada", "rechazada"])

function mapPedidoParaComprar(f: any): PedidoParaComprar {
  // Las líneas de órdenes CANCELADAS o RECHAZADAS no cuentan como comprado:
  // esa cantidad vuelve a la cola (mismo criterio que crear_orden_compra,
  // desaprobar_pedido y cancelar_pedido en la base, migración
  // 20261006100000_liberar_ordenes_rechazadas.sql). Antes las rechazadas
  // seguían contando y la cantidad quedaba bloqueada para siempre.
  // Ya comprado, en la unidad de la requisición: cada línea de orden con su
  // propia conversión (mismo cálculo que _comprado_pedido en la base).
  const yaCompradoUso = (f.compras ?? [])
    .filter((c: any) => !ESTADOS_OC_SIN_COMPROMISO.has(c.orden?.estado))
    .reduce((acc: number, c: any) => acc + Number(c.cantidad) * (Number(c.factor_unidad ?? 1) || 1), 0)
  const pendienteUso = Math.max(Number(f.cantidad) - yaCompradoUso, 0)
  // Unidades de compra completas que cubren lo que falta, con la conversión
  // sugerida (20 kg con bultos de 50 kg = 1): mismo tope que crear_orden_compra.
  const factor = Number(f.factor_unidad ?? 1) || 1
  const cantidadCompra = unidadesDeCompra(Number(f.cantidad), factor)
  return {
    id: f.id,
    requisicionId: f.grupo_pedido_id,
    requisicionNumero: f.requisicion?.numero ?? null,
    insumoId: f.insumo?.id,
    insumoCodigo: f.insumo?.codigo,
    insumoDescripcion: f.insumo?.descripcion ?? "(insumo eliminado)",
    um: f.insumo?.u_m ?? null,
    cantidad: cantidadCompra,
    cantidadPendiente: pendienteUso > 0 ? unidadesDeCompra(pendienteUso, factor) : 0,
    cantidadUso: Number(f.cantidad),
    pendienteUso,
    unidadUso: f.unidad ?? f.insumo?.u_m ?? null,
    factor,
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

  // Paginado: trae TODAS las líneas aprobadas del proyecto (también las ya
  // compradas completas, que se descartan abajo); la API corta cada respuesta
  // en 1000 filas sin avisar y se perdían requisiciones por comprar.
  const consulta = (desde: number, hasta: number) => {
    let query = supabase
      .from("pedidos_insumos")
      .select(SELECT_PEDIDO_PARA_COMPRAR)
      .eq("proyecto_id", filtros.proyectoId)
      .eq("estado", "aprobado")
      .is("rechazado_compras_at", null)
      .order("urgente", { ascending: false })
      .order("fecha_requerida", { ascending: true })
      .order("id", { ascending: true })

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
    return query.range(desde, hasta)
  }
  const data = await traerTodo<any>(consulta)

  return (data ?? [])
    .map(mapPedidoParaComprar)
    .filter((p) => filtros.soloPendientes === false || p.cantidadPendiente > 0)
}

export async function obtenerPedidosPorId(ids: string[]): Promise<PedidoParaComprar[]> {
  await requerirScope("rol_compras")
  if (ids.length === 0) return []
  const supabase = await createClient()

  // Por tandas: los ids van en la URL, que tiene límite de tamaño.
  const tandas: string[][] = []
  for (let i = 0; i < ids.length; i += 100) tandas.push(ids.slice(i, i + 100))
  const data = (
    await Promise.all(
      tandas.map(async (tanda) => {
        const { data, error } = await supabase
          .from("pedidos_insumos")
          .select(SELECT_PEDIDO_PARA_COMPRAR)
          .in("id", tanda)
          .eq("estado", "aprobado")
          .is("rechazado_compras_at", null)
        if (error) throw new Error(error.message)
        return data ?? []
      })
    )
  ).flat()
  return data.map(mapPedidoParaComprar).filter((p) => p.cantidadPendiente > 0)
}

export async function rechazarPedidoCompras(pedidoId: string, motivo: string): Promise<void> {
  await requerirScope("rol_compras")
  const supabase = await createClient()

  // La función solo rechaza una vez y solo requisiciones aprobadas (con la
  // pantalla desactualizada se podía sobrescribir el motivo o rechazar una ya
  // cancelada/desaprobada). Los usuarios no escriben pedidos_insumos directo.
  const { error } = await supabase.rpc("rechazar_pedido_compras", {
    p_pedido_id: pedidoId,
    p_motivo: motivo,
  })
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
  if (!puedeBuscar(termino)) return []
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("proveedores")
    .select("unique_id, nombre, id_prov, tipo_proveedor")
    .eq("estado", "ACTIVO")
    .ilike("nombre", `%${termino.trim()}%`)
    .order("nombre")
    .limit(limiteBusqueda(termino))

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
  tipoDocumento: string | null
  numeroDocumento: number | null
  digitoVerificacion: number | null
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
      tipo_documento, numero_documento, digito_verificacion,
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
    tipoDocumento: d.tipo_documento,
    numeroDocumento: d.numero_documento,
    digitoVerificacion: d.digito_verificacion,
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
  // conversión de esta compra: 1 unidad de compra = factor unidades de la
  // requisición (la sugerida, o la que escribió Compras)
  factor: number
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
  // Anticipo (A&F): porcentaje del total que se paga al aprobar la orden, y
  // cuándo se paga el saldo: al quedar entregada o en una fecha.
  anticipoPorcentaje?: number | null
  saldoModo?: "entrega" | "fecha" | null
  saldoFecha?: string | null // YYYY-MM-DD
  lineas: LineaOrdenCompra[]
}

export async function crearOrdenCompra(datos: DatosOrdenCompra): Promise<string> {
  await requerirScope("rol_compras")

  if (datos.lineas.length === 0) {
    throw new Error("Selecciona al menos un insumo para la orden de compra.")
  }
  // Cantidades solo enteras (precio y porcentajes pueden tener decimales).
  if (!datos.lineas.every((l) => Number.isFinite(l.factor) && l.factor > 0)) {
    throw new Error("La conversión de cada línea tiene que ser un número mayor que cero.")
  }
  if (!datos.lineas.every((l) => esCantidadEnteraPositiva(l.cantidadComprar))) {
    throw new Error("Las cantidades de la orden deben ser números enteros mayores que cero.")
  }

  // Anticipo: se valida acá también (la base lo vuelve a validar). Los
  // parámetros solo se mandan si hay anticipo, así una orden sin anticipo
  // llama a la función exactamente como antes.
  let anticipo: { p_anticipo_porcentaje: number; p_saldo_modo: string; p_saldo_fecha: string | null } | null = null
  if (datos.anticipoPorcentaje != null && datos.anticipoPorcentaje !== 0) {
    const pct = datos.anticipoPorcentaje
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
      throw new Error("El porcentaje del anticipo debe ser mayor que 0 y menor que 100.")
    }
    if (datos.saldoModo !== "entrega" && datos.saldoModo !== "fecha") {
      throw new Error("Indica cuándo se paga el saldo: al ser entregado o en una fecha.")
    }
    if (datos.saldoModo === "fecha" && !/^\d{4}-\d{2}-\d{2}$/.test(datos.saldoFecha ?? "")) {
      throw new Error("Indica la fecha en que se paga el saldo.")
    }
    anticipo = {
      p_anticipo_porcentaje: Math.round(pct * 100) / 100,
      p_saldo_modo: datos.saldoModo,
      p_saldo_fecha: datos.saldoModo === "fecha" ? (datos.saldoFecha as string) : null,
    }
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
    ...(anticipo ?? {}),
    p_lineas: datos.lineas.map((l) => ({
      pedido_id: l.pedidoId,
      cantidad_comprar: l.cantidadComprar,
      factor: l.factor,
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
// comprar (crear la orden).
export type PermisosOrdenCompra = {
  esAdmin: boolean
  rolCompras: boolean
  puedeDesaprobar: boolean
  puedeCancelar: boolean
  // Para saber si la orden es propia (retirar una pendiente).
  usuarioId: string | null
}

export async function obtenerPermisosOrdenCompra(): Promise<PermisosOrdenCompra> {
  const permisos = await obtenerPermisosRol()
  if (!permisos) {
    return { esAdmin: false, rolCompras: false, puedeDesaprobar: false, puedeCancelar: false, usuarioId: null }
  }

  const puede = (accion: string) => permisos.esAdministrador || permisos.acciones.includes(accion)
  return {
    esAdmin: puede("aprobar_oc"),
    rolCompras: puede("comprar"),
    puedeDesaprobar: puede("desaprobar_oc"),
    puedeCancelar: puede("cancelar_oc"),
    usuarioId: await obtenerUsuarioId(),
  }
}

export type OrdenCompraResumen = {
  id: string
  numero: number
  proyectoCodigo: string | null
  proyectoNombre: string | null
  proveedorNombre: string
  creadaPorNombre: string | null
  creadaPorId: string | null
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
      created_by,
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
    creadaPorId: o.created_by ?? null,
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
  creadaPorNombre: string | null
  creadaPorId: string | null
  createdAt: string
  aprobadaPorNombre: string | null
  aprobadaAt: string | null
  motivoRechazo: string | null
  motivoDesaprobacion: string | null
  motivoCancelacion: string | null
  canceladaAt: string | null
  // Anticipo (A&F): null si la orden no tiene.
  anticipoPorcentaje: number | null
  saldoModo: "entrega" | "fecha" | null
  saldoFecha: string | null
  lineas: LineaOrdenCompraDetalle[]
}
export async function obtenerOrdenCompraDetalle(ordenId: string): Promise<OrdenCompraDetalle> {
  const supabase = await createClient()
  const userId = await obtenerUsuarioId()
  if (!userId) throw new Error("No autenticado.")

  const { data, error } = await supabase
    .from("ordenes_compra")
    .select(
      `
      id, numero, estado, estado_entrega, sitio_entrega, fecha_entrega, contacto_nombre, telefono, ciudad, email,
      condiciones_pago, observaciones, created_at, aprobada_at, motivo_rechazo,
      motivo_desaprobacion, motivo_cancelacion, cancelada_at,
      anticipo_porcentaje, saldo_modo, saldo_fecha,
      proyecto:proyectos!ordenes_compra_proyecto_id_fkey(codigo, nombre, ciudad, empresa:empresas(nit, razon_social, logo_url)),
      proveedor:proveedores!ordenes_compra_proveedor_id_fkey(
        nombre, numero_documento, digito_verificacion, direccion, ciudad, telefono, correo, nombre_contacto
      ),
      created_by,
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
    creadaPorNombre: d.creado_por?.nombre ?? null,
    creadaPorId: d.created_by ?? null,
    createdAt: d.created_at,
    aprobadaPorNombre: d.aprobada_por_perfil?.nombre ?? null,
    aprobadaAt: d.aprobada_at,
    motivoRechazo: d.motivo_rechazo,
    motivoDesaprobacion: d.motivo_desaprobacion,
    motivoCancelacion: d.motivo_cancelacion,
    canceladaAt: d.cancelada_at,
    anticipoPorcentaje: d.anticipo_porcentaje != null ? Number(d.anticipo_porcentaje) : null,
    saldoModo: d.saldo_modo ?? null,
    saldoFecha: d.saldo_fecha ?? null,
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

// Devuelve una orden aprobada a "pendiente de aprobación". Solo si no tiene
// material recibido (sin entradas de almacén; lo valida la base).
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
// Aprobada: exige cancelar_oc. Pendiente: también quien la creó (retirarla).
// La base valida cuál aplica (cancelar_orden_compra).
export async function cancelarOrdenCompra(ordenId: string, motivo: string): Promise<void> {
  if (!(await obtenerUsuarioId())) throw new Error("No autenticado.")
  if (!motivo.trim()) throw new Error("El motivo de cancelación es obligatorio.")
  const supabase = await createClient()
  const { error } = await supabase.rpc("cancelar_orden_compra", {
    p_orden_id: ordenId,
    p_motivo: motivo.trim(),
  })
  if (error) throw new Error(error.message)
}

export type OrdenCompraListado = {
  id: string
  numero: number
  estado: OrdenCompraEstado
  estadoEntrega: EstadoEntregaOrden
  estadoVisible: EstadoOrdenVisible
  proyectoId: string | null
  proyectoCodigo: string | null
  proyectoNombre: string | null
  proveedorNombre: string
  creadaPorNombre: string | null
  creadaPorId: string | null
  createdAt: string
  tieneSobrecostoPrecio: boolean
}

// Sin requerirScope a propósito -- la RLS (ordenes_compra_select_proyecto +
// ordenes_compra_select para rol_compras/admin) ya decide qué filas ve cada
// quien. Un ingeniero ve las OC de sus proyectos, Compras/admin las ve todas.
// Filtros del listado de órdenes de compra (todos opcionales). Se aplican en el
// servidor, así que con mucho volumen no se trae todo para filtrar en el cliente.
export type FiltrosOrdenesCompra = {
  numero?: number
  proyectoId?: string
  proveedor?: string // parte del nombre
  estado?: EstadoOrdenVisible
  creadaPorId?: string
  // false = no traer las canceladas (salvo que el filtro Estado sea Cancelada).
  // Por defecto se traen todas.
  incluirCanceladas?: boolean
  desde?: string // YYYY-MM-DD, fecha de creación
  hasta?: string // YYYY-MM-DD, inclusive
}

export async function listarTodasLasOrdenesCompra(
  filtros: FiltrosOrdenesCompra = {},
  pagina = 0
): Promise<{ ordenes: OrdenCompraListado[]; hayMas: boolean }> {
  const supabase = await createClient()
  const userId = await obtenerUsuarioId()
  if (!userId) throw new Error("No autenticado.")

  // Proveedor por nombre: se filtra con un join (!inner) dentro de la misma
  // consulta. Antes se traían sus ids y se mandaban en un IN dentro de la URL,
  // que falla con muchos proveedores o corta el resultado.
  const proveedor = filtros.proveedor?.trim()

  const consulta = () => {
    // Dos formas del select (literales, para que el cliente infiera bien): con
    // el join !inner a proveedores solo cuando se filtra por proveedor.
    let query = (proveedor
      ? supabase
          .from("ordenes_compra")
          .select(
            `
        id, numero, estado, estado_entrega, created_at, proyecto_id,
        proyecto:proyectos!ordenes_compra_proyecto_id_fkey(codigo, nombre),
        proveedor:proveedores!ordenes_compra_proveedor_id_fkey!inner(nombre),
        created_by,
        creado_por:perfiles!ordenes_compra_created_by_fkey(nombre)
      `
          )
          .ilike("proveedor.nombre", `%${proveedor}%`)
      : supabase
          .from("ordenes_compra")
          .select(
            `
        id, numero, estado, estado_entrega, created_at, proyecto_id,
        proyecto:proyectos!ordenes_compra_proyecto_id_fkey(codigo, nombre),
        proveedor:proveedores!ordenes_compra_proveedor_id_fkey(nombre),
        created_by,
        creado_por:perfiles!ordenes_compra_created_by_fkey(nombre)
      `
          )
    )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })

    if (filtros.numero !== undefined) query = query.eq("numero", filtros.numero)
    if (filtros.proyectoId) query = query.eq("proyecto_id", filtros.proyectoId)
    if (filtros.creadaPorId) query = query.eq("created_by", filtros.creadaPorId)
    // Colombia es UTC-5 todo el año: así "hasta" incluye el día completo.
    if (filtros.desde) query = query.gte("created_at", `${filtros.desde}T00:00:00-05:00`)
    if (filtros.hasta) query = query.lte("created_at", `${filtros.hasta}T23:59:59.999-05:00`)

    // El estado visible de una orden es solo el de aprobación (ver
    // lib/ordenes-compra-estado.ts).
    if (filtros.estado) query = query.eq("estado", filtros.estado)
    else if (filtros.incluirCanceladas === false) query = query.neq("estado", "cancelada")
    return query.range(...rangoPagina(pagina))
  }

  const { data: filasPagina, error } = await consulta()
  if (error) throw new Error(error.message)
  const { filas: data, hayMas } = cortarPagina((filasPagina ?? []) as any[])

  const ordenes = (data ?? []).map((o: any) => ({
    id: o.id,
    numero: o.numero,
    estado: o.estado,
    estadoEntrega: o.estado_entrega,
    estadoVisible: calcularEstadoVisible(o.estado, o.estado_entrega),
    proyectoId: o.proyecto_id ?? null,
    proyectoCodigo: o.proyecto?.codigo ?? null,
    proyectoNombre: o.proyecto?.nombre ?? null,
    proveedorNombre: o.proveedor?.nombre ?? "(proveedor eliminado)",
    creadaPorNombre: o.creado_por?.nombre ?? null,
    creadaPorId: o.created_by ?? null,
    createdAt: o.created_at,
  }))

  return { ordenes: await conSobrecostoPrecio(ordenes), hayMas }
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
  | "pedido_aprobado"
  | "orden_compra_rechazada"
  | "orden_compra_aprobada"
  | "insumo_sobre_presupuesto"
  | "orden_compra_precio_sobre_efectivo"
  | "contrato_por_revisar"
  | "contrato_aprobado"
  | "contrato_devuelto"
  | "contrato_rechazado"
export type NotificacionEntidadTipo = "pedido_insumo" | "orden_compra" | "requisicion" | "contrato"

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
  const userId = await obtenerUsuarioId()
  if (!userId) throw new Error("No autenticado.")

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