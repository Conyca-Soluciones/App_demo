"use server"

import { unidadesDeCompra } from "@/lib/unidades"
import { conversionValida, type PresentacionLinea } from "@/lib/presentacion-compra"
import { esCantidadEnteraPositiva } from "@/lib/numeros"
import { hoyColombia } from "@/lib/fechas"
import { calcularLinea } from "@/lib/ordenes-compra-calculos"
import type { SoporteGuardado, SoporteSubidoArchivo, TipoSoporteOrden } from "@/lib/soportes"
import type { CuentasProveedorOC, MetodoPagoOC } from "@/lib/metodo-pago-oc"
import type { TipoPagoOC } from "@/lib/tipo-pago-oc"

import { createClient } from "@/lib/supabase/server"
import { traerTodo } from "@/lib/supabase/traer-todo"
import { puedeBuscar, limiteBusqueda } from "@/lib/busqueda"
import { cortarPagina, rangoPagina, TAMANO_PAGINA } from "@/lib/paginacion"
import { requerirScope, requerirAccion, requerirPestana, obtenerPermisosRol, obtenerUsuarioId } from "@/lib/permisos"
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
    .eq("solo_pagos", false)
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
  // null = todos los proyectos que la persona ve (la RLS decide cuáles).
  proyectoId: string | null
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
  // Requisición administrativa (FUNCIONAMIENTO, 20261231900000): sin presupuesto
  // ni aprobación, la pidió alguien de la empresa.
  administrativa: boolean
  requisicionCodigo: string | null
  // Dónde se entrega (Paquete A); las requisiciones de antes no la tienen.
  direccionEntrega: string | null
  insumoId: string
  insumoCodigo: number
  insumoDescripcion: string
  // Ítem del presupuesto de la línea (el mismo insumo puede venir de varios ítems).
  itemCodigo: string | null
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
  // Precio promedio de compra del insumo (precios_efectivos_insumos: últimos 6
  // meses, si no todo el histórico, si no el maestro), sin IVA. Solo lo trae
  // Generar OC (obtenerPedidosPorId / obtenerOrdenParaModificar) para avisar
  // de un precio más de 10 % por encima; en las listas va null.
  precioPromedio: number | null
  fechaPedido: string
  fechaRequerida: string
  urgente: boolean
  observaciones: string | null
  soporteUrl: string | null
  solicitadoPorNombre: string | null
  proyectoId: string
  // Proyecto de la requisición: "001 · ZZ-PRUEBA" (número y código).
  proyectoTexto: string | null
  resueltoAt: string | null
}

const SELECT_PEDIDO_PARA_COMPRAR = `
  id, grupo_pedido_id, proyecto_id, cantidad, unidad, factor_unidad, fecha_requerida, urgente, observaciones, soporte_url, created_at, resuelto_at,
  requisicion:requisiciones!pedidos_insumos_requisicion_fkey(numero, codigo, administrativa, direccion_entrega),
  item:presupuesto_items!pedidos_insumos_presupuesto_item_id_fkey(codigo),
  insumo:maestro_insumos!pedidos_insumos_insumo_id_fkey(id, codigo, descripcion, u_m, vr_unitario),
  solicitante:perfiles!pedidos_insumos_solicitado_por_fkey(nombre),
  proyecto:proyectos!pedidos_insumos_proyecto_id_fkey(numero, codigo, nombre),
  compras:ordenes_compra_items!ordenes_compra_items_pedido_insumo_id_fkey(
    cantidad,
    factor_unidad,
    orden:ordenes_compra!ordenes_compra_items_orden_compra_id_fkey(id, estado)
  )
`

// "Solo pendientes por comprar": el mismo select, pero solo líneas de
// requisiciones con algo por comprar (requisiciones.estado_compra = 'pendiente',
// que guarda la base: alguna línea aprobada con comprado < pedido). Así no se
// trae todo el histórico del proyecto; el filtro por línea de abajo sigue
// quitando las líneas ya completas de esas requisiciones.
const SELECT_PENDIENTES_POR_COMPRAR = SELECT_PEDIDO_PARA_COMPRAR.replace(
  "requisicion:requisiciones!pedidos_insumos_requisicion_fkey(numero, codigo, administrativa, direccion_entrega)",
  "requisicion:requisiciones!pedidos_insumos_requisicion_fkey!inner(numero, codigo, administrativa, direccion_entrega, estado_compra)"
)

// Órdenes cuyas líneas NO comprometen la cantidad de la requisición.
const ESTADOS_OC_SIN_COMPROMISO = new Set(["cancelada", "rechazada"])

// excluirOrdenId: al modificar una orden, lo que ESA orden compra no cuenta
// (sus líneas se reemplazan), así lo pendiente es lo que se le puede poner.
function mapPedidoParaComprar(f: any, excluirOrdenId?: string): PedidoParaComprar {
  // Las líneas de órdenes CANCELADAS o RECHAZADAS no cuentan como comprado:
  // esa cantidad vuelve a la cola (mismo criterio que crear_orden_compra,
  // desaprobar_pedido y cancelar_pedido en la base, migración
  // 20261006100000_liberar_ordenes_rechazadas.sql). Antes las rechazadas
  // seguían contando y la cantidad quedaba bloqueada para siempre.
  // Ya comprado, en la unidad de la requisición: cada línea de orden con su
  // propia conversión (mismo cálculo que _comprado_pedido en la base).
  const yaCompradoUso = (f.compras ?? [])
    .filter((c: any) => !ESTADOS_OC_SIN_COMPROMISO.has(c.orden?.estado) && (!excluirOrdenId || c.orden?.id !== excluirOrdenId))
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
    administrativa: Boolean(f.requisicion?.administrativa),
    requisicionCodigo: f.requisicion?.codigo ?? null,
    direccionEntrega: f.requisicion?.direccion_entrega ?? null,
    insumoId: f.insumo?.id,
    insumoCodigo: f.insumo?.codigo,
    insumoDescripcion: f.insumo?.descripcion ?? "(insumo eliminado)",
    itemCodigo: f.item?.codigo ?? null,
    um: f.insumo?.u_m ?? null,
    cantidad: cantidadCompra,
    cantidadPendiente: pendienteUso > 0 ? unidadesDeCompra(pendienteUso, factor) : 0,
    cantidadUso: Number(f.cantidad),
    pendienteUso,
    unidadUso: f.unidad ?? f.insumo?.u_m ?? null,
    factor,
    valorUnitarioProyectado: f.insumo?.vr_unitario ?? null,
    precioPromedio: null,
    fechaPedido: f.created_at,
    fechaRequerida: f.fecha_requerida,
    urgente: f.urgente,
    observaciones: f.observaciones,
    soporteUrl: f.soporte_url,
    solicitadoPorNombre: f.solicitante?.nombre ?? null,
    proyectoId: f.proyecto_id,
    proyectoTexto: f.proyecto
      ? [f.proyecto.numero != null ? String(f.proyecto.numero).padStart(3, "0") : null, f.proyecto.codigo ?? f.proyecto.nombre]
          .filter(Boolean)
          .join(" · ")
      : null,
    resueltoAt: f.resuelto_at,
  }
}

// Llena precioPromedio con precios_efectivos_insumos (mismo precio contra el
// que avisa trg_notificar_precio_sobre_efectivo_oc_item), una llamada por
// tanda de insumos distintos.
async function conPrecioPromedio(pedidos: PedidoParaComprar[]): Promise<PedidoParaComprar[]> {
  const ids = [...new Set(pedidos.map((p) => p.insumoId).filter(Boolean))]
  if (ids.length === 0) return pedidos
  const supabase = await createClient()
  const precios = new Map<string, number>()
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await supabase.rpc("precios_efectivos_insumos", { p_insumo_ids: ids.slice(i, i + 500) })
    if (error) throw new Error(error.message)
    for (const f of (data ?? []) as any[]) {
      if (f.precio_efectivo != null) precios.set(f.insumo_id, Number(f.precio_efectivo))
    }
  }
  return pedidos.map((p) => ({ ...p, precioPromedio: precios.get(p.insumoId) ?? null }))
}

export async function listarPedidosParaComprar(
  filtros: FiltrosPedidosCompra
): Promise<PedidoParaComprar[]> {
  await requerirScope("rol_compras")
  const supabase = await createClient()

  // Paginado (la API corta cada respuesta en 1000 filas sin avisar). Con "Solo
  // pendientes" la base ya descarta las requisiciones compradas completas.
  const soloPendientes = filtros.soloPendientes !== false
  const consulta = (desde: number, hasta: number) => {
    let query = supabase
      .from("pedidos_insumos")
      .select(soloPendientes ? SELECT_PENDIENTES_POR_COMPRAR : SELECT_PEDIDO_PARA_COMPRAR)
      .eq("estado", "aprobado")
      .is("rechazado_compras_at", null)
      .order("urgente", { ascending: false })
      .order("fecha_requerida", { ascending: true })
      .order("id", { ascending: true })

    if (filtros.proyectoId) query = query.eq("proyecto_id", filtros.proyectoId)
    // "por comprar" = nada comprado todavía o compra parcial
    if (soloPendientes) query = query.in("requisicion.estado_compra", ["pendiente", "parcial"])
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
    .map((f) => mapPedidoParaComprar(f))
    .filter((p) => !soloPendientes || p.cantidadPendiente > 0)
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
  return conPrecioPromedio(data.map((f) => mapPedidoParaComprar(f)).filter((p) => p.cantidadPendiente > 0))
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

// Cierra el SALDO de una requisición comprada a medias (se compraron 8 de 10):
// lo que falta se libera del cupo del presupuesto, la requisición queda en lo
// comprado y se avisa a quien la pidió. Exige que ya haya compras; si no se va
// a comprar nada, se rechaza.
export async function cerrarSaldoPedido(pedidoId: string, motivo: string): Promise<void> {
  await requerirScope("rol_compras")
  if (!motivo.trim()) throw new Error("El motivo es obligatorio.")
  const supabase = await createClient()
  const { error } = await supabase.rpc("cerrar_saldo_pedido", { p_pedido_id: pedidoId, p_motivo: motivo.trim() })
  if (error) throw new Error(error.message)
}

export type SaldoPendiente = {
  pedidoId: string
  requisicionId: string
  requisicionNumero: number | null
  requisicionCodigo: string | null
  proyectoId: string
  proyectoCodigo: string | null
  proyectoNombre: string
  insumoCodigo: number
  insumoDescripcion: string
  // Unidad de la requisición (la del APU): en ella van las tres cantidades.
  unidad: string | null
  cantidad: number
  comprado: number
  pendiente: number
  ultimaCompra: string
  diasSinCompra: number
  solicitante: string | null
  fechaRequerida: string
}

// Requisiciones aprobadas con compra parcial que Compras no ha cerrado, las más
// antiguas primero. Una página de 50 (se pide una de más para saber si hay otra).
export async function listarSaldosPendientes(
  proyectoId: string | undefined,
  pagina = 0
): Promise<{ saldos: SaldoPendiente[]; hayMas: boolean }> {
  await requerirPestana("compras.saldos_pendientes")
  const supabase = await createClient()
  const [desde] = rangoPagina(pagina)
  const { data, error } = await supabase.rpc("listar_saldos_pendientes", {
    p_proyecto_id: proyectoId ?? null,
    p_limite: TAMANO_PAGINA + 1,
    p_offset: desde,
  })
  if (error) throw new Error(error.message)
  const { filas, hayMas } = cortarPagina((data ?? []) as any[])
  // Código de cada requisición (RQ-001-0001): una consulta por página (≤ 51 ids).
  const ids = [...new Set(filas.map((f: any) => f.requisicion_id).filter(Boolean))] as string[]
  const codigos = new Map<string, string>()
  if (ids.length > 0) {
    const { data: rq, error: e } = await supabase.from("requisiciones").select("id, codigo").in("id", ids)
    if (e) throw new Error(e.message)
    for (const r of (rq ?? []) as { id: string; codigo: string }[]) codigos.set(r.id, r.codigo)
  }
  return {
    saldos: filas.map((f: any) => ({
      pedidoId: f.pedido_id,
      requisicionId: f.requisicion_id,
      requisicionNumero: f.requisicion_numero != null ? Number(f.requisicion_numero) : null,
      requisicionCodigo: codigos.get(f.requisicion_id) ?? null,
      proyectoId: f.proyecto_id,
      proyectoCodigo: f.proyecto_codigo,
      proyectoNombre: f.proyecto_nombre,
      insumoCodigo: f.insumo_codigo,
      insumoDescripcion: f.insumo_descripcion,
      unidad: f.unidad,
      cantidad: Number(f.cantidad),
      comprado: Number(f.comprado),
      pendiente: Number(f.pendiente),
      ultimaCompra: f.ultima_compra,
      diasSinCompra: Number(f.dias_sin_compra),
      solicitante: f.solicitante,
      fechaRequerida: f.fecha_requerida,
    })),
    hayMas,
  }
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
}

export async function obtenerProveedorDetalle(proveedorId: string): Promise<ProveedorDetalle> {
  await requerirScope("rol_compras")
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("proveedores")
    .select(
      `
      unique_id, nombre, nombre_contacto, telefono, correo, ciudad, direccion,
      tipo_documento, numero_documento, digito_verificacion
    `
    )
    .eq("unique_id", proveedorId)
    .single()

  if (error) throw new Error(error.message)

  const d = data as any

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
  }
}

// Cuentas del proveedor en Terceros para pagarle por transferencia (las que
// verifica Financiera; números enmascarados). Compras no lee Terceros por RLS:
// cuentas_proveedor_oc le da solo esto.
export async function cuentasProveedorOC(proveedorId: string): Promise<CuentasProveedorOC> {
  await requerirScope("rol_compras")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("cuentas_proveedor_oc", { p_proveedor_id: proveedorId })
  if (error) throw new Error(error.message)
  const d = (data ?? {}) as any
  return {
    terceroId: d.tercero_id ?? null,
    razonSocial: d.razon_social ?? null,
    cuentas: ((d.cuentas ?? []) as any[]).map((c) => ({
      id: String(c.id),
      banco: String(c.banco ?? ""),
      tipoCuenta: String(c.tipo_cuenta ?? ""),
      numero: String(c.numero ?? ""),
      verificada: Boolean(c.verificada),
    })),
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
  // "UM disponible": si Compras compra en otra presentación (cajas), acá va lo
  // comprado. Entonces cantidadComprar/precioUnitario/factor se ignoran: la
  // base deriva la cantidad y el precio por unidad del insumo.
  presentacion?: PresentacionLinea
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
  // Titular de la cuenta cuando no es el proveedor (20261214000000): el pago
  // se consigna en esa cuenta. null = la del proveedor.
  titular?: { tercero_id: string; cuenta_id: string } | null
  // Método de pago (pagoOCParaGuardar en lib/metodo-pago-oc.ts).
  pago: { metodo: MetodoPagoOC } & Record<string, unknown>
  // Tipo de pago, aparte del método (20261228400000, lib/tipo-pago-oc.ts).
  tipoPago: TipoPagoOC
  fechaPagoCredito?: string | null // YYYY-MM-DD, solo con crédito
  lineas: LineaOrdenCompra[]
  // Saldo a favor del proveedor que Compras decide usar (Paquete C, entrega 3):
  // se descuenta de los pagos de la orden. Solo al crear.
  saldoFavor?: number | null
  // Empresa que factura (Paquete A, 20261231999400): la elige Compras al crear;
  // por omisión, la del proyecto. Al modificar se conserva la de la orden.
  empresaId?: string | null
}

// Validaciones comunes de crear y modificar (la base las vuelve a hacer).
// Devuelve los parámetros del anticipo: solo se mandan si hay anticipo, así una
// orden sin anticipo llama a la función exactamente como antes.
function validarDatosOrden(datos: DatosOrdenCompra) {
  // Obligatoria (decisión del usuario, 2026-11-09): el Registro de
  // requisiciones la muestra como fecha estimada de entrega.
  if (!datos.fechaEntrega || !/^\d{4}-\d{2}-\d{2}$/.test(datos.fechaEntrega)) {
    throw new Error("Escribe la fecha estimada de entrega.")
  }
  if (datos.pago?.metodo !== "transferencia" && datos.pago?.metodo !== "pse") {
    throw new Error("Elige cómo se paga la orden: Transferencia o PSE.")
  }

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
  for (const l of datos.lineas) {
    const pr = l.presentacion
    if (!pr) continue
    if (!pr.umCompra.trim()) throw new Error("Escoge la UM disponible de cada línea que se compra en otra presentación.")
    if (!conversionValida(pr.conversionCompra)) {
      throw new Error("La conversión debe ser un número mayor que cero con máximo 4 decimales.")
    }
    if (!esCantidadEnteraPositiva(pr.cantidadCompra)) {
      throw new Error("La cantidad a comprar debe ser un número entero mayor que cero.")
    }
    if (!Number.isFinite(pr.precioCompra) || pr.precioCompra < 0) throw new Error("El precio no puede ser negativo.")
  }

  // Anticipo
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
  return anticipo
}

function lineasParaGuardar(lineas: LineaOrdenCompra[]) {
  return lineas.map((l) =>
    l.presentacion
      ? {
          pedido_id: l.pedidoId,
          um_compra: l.presentacion.umCompra.trim().toUpperCase(),
          conversion_compra: l.presentacion.conversionCompra,
          cantidad_compra: l.presentacion.cantidadCompra,
          precio_compra: l.presentacion.precioCompra,
          porcentaje_descuento: l.porcentajeDescuento,
          porcentaje_iva: l.porcentajeIva,
        }
      : {
          pedido_id: l.pedidoId,
          cantidad_comprar: l.cantidadComprar,
          factor: l.factor,
          precio_unitario: l.precioUnitario,
          porcentaje_descuento: l.porcentajeDescuento,
          porcentaje_iva: l.porcentajeIva,
        }
  )
}

// La orden se crea con su soporte (cotización, cuenta de cobro o factura),
// obligatorio: el archivo ya está en el bucket `ordenes_compra` y la base lo
// registra en la misma transacción (crear_orden_compra_con_soporte).
export async function crearOrdenCompra(
  datos: DatosOrdenCompra,
  soporte: SoporteSubidoArchivo & { tipo: TipoSoporteOrden }
): Promise<string> {
  await requerirScope("rol_compras")
  if (!soporte?.ruta) throw new Error("Adjunta el soporte de la orden (cotización, cuenta de cobro o factura).")
  const anticipo = validarDatosOrden(datos)
  if (datos.fechaEntrega! < hoyColombia()) throw new Error("La fecha estimada de entrega no puede ser anterior a hoy.")

  if (!datos.empresaId) throw new Error("Elige la empresa que factura.")

  const supabase = await createClient()

  // Empresa que factura y, si se usa, el saldo a favor: en la misma
  // transacción que la orden (crear_orden_compra_empresa, 20261231999400).
  const usaSaldo = (datos.saldoFavor ?? 0) > 0
  const { data, error } = await supabase.rpc("crear_orden_compra_empresa", {
    p_empresa_id: datos.empresaId,
    ...(usaSaldo ? { p_saldo_favor: datos.saldoFavor } : {}),
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
    p_soporte: {
      tipo: soporte.tipo,
      ruta: soporte.ruta,
      nombre_archivo: soporte.nombreArchivo,
      tamano: soporte.tamano,
      mime: soporte.mime,
    },
    ...(anticipo ?? {}),
    // Solo se manda si hay titular aparte (igual que el anticipo).
    ...(datos.titular ? { p_titular: datos.titular } : {}),
    p_pago: datos.pago,
    p_tipo_pago: datos.tipoPago,
    p_fecha_pago_credito: datos.tipoPago === "credito" ? (datos.fechaPagoCredito ?? null) : null,
    p_lineas: lineasParaGuardar(datos.lineas),
  })

  if (error) throw new Error(error.message)
  return data as string
}

// Empresas a las que se puede facturar una orden y la del proyecto (la que
// viene por omisión). Todas las empresas (decisión del usuario: todas tienen
// consolidado).
export type EmpresaFactura = { id: string; razonSocial: string; nit: string | null }
export async function opcionesEmpresaFactura(
  proyectoId: string
): Promise<{ empresas: EmpresaFactura[]; empresaProyectoId: string | null }> {
  await requerirScope("rol_compras")
  const supabase = await createClient()
  const [empresas, proyecto] = await Promise.all([
    supabase.from("empresas").select("id, razon_social, nit").order("razon_social"),
    supabase.from("proyectos").select("empresa_id").eq("id", proyectoId).maybeSingle(),
  ])
  if (empresas.error) throw new Error(empresas.error.message)
  return {
    empresas: (empresas.data ?? []).map((e: { id: string; razon_social: string; nit: string | null }) => ({
      id: e.id,
      razonSocial: e.razon_social,
      nit: e.nit,
    })),
    empresaProyectoId: (proyecto.data as { empresa_id: string | null } | null)?.empresa_id ?? null,
  }
}

// Soportes de una orden (quien ve la orden los ve: RLS). Aparte del detalle
// para que una base sin la migración de soportes no rompa el detalle.
export async function listarSoportesOrden(ordenId: string): Promise<SoporteGuardado[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("orden_compra_soportes")
    .select("id, tipo, nombre_archivo, mime")
    .eq("orden_compra_id", ordenId)
    .order("created_at", { ascending: true })
  if (error) return []
  return (data ?? []).map((s: { id: string; tipo: string; nombre_archivo: string; mime: string | null }) => ({
    id: s.id,
    tipo: s.tipo,
    nombreArchivo: s.nombre_archivo,
    mime: s.mime,
  }))
}

// Enlace firmado de 2 minutos para ver un soporte (la política del bucket
// exige ver la orden).
export async function enlaceSoporteOrden(soporteId: string): Promise<string> {
  const supabase = await createClient()
  const { data: s, error } = await supabase.from("orden_compra_soportes").select("ruta").eq("id", soporteId).single()
  if (error || !s) throw new Error("No se encontró el soporte.")
  const { data, error: e } = await supabase.storage.from("ordenes_compra").createSignedUrl(s.ruta, 120)
  if (e || !data) throw new Error("No se pudo abrir el soporte.")
  return data.signedUrl
}

// ---------------------------------------------------------------------------
// Detalle de la orden de compra
// ---------------------------------------------------------------------------

// Qué puede hacer el usuario con las órdenes de compra (lo decide su rol; ver
// Roles y permisos). rolCompras = puede comprar (crear la orden). La OC no se
// aprueba aquí: se aprueba con su pago en A&F › Aprobación de pagos.
export type PermisosOrdenCompra = {
  rolCompras: boolean
  puedeCancelar: boolean
  puedeCambiarFechaCredito: boolean
  // Para saber si la orden es propia (retirar una pendiente).
  usuarioId: string | null
}

export async function obtenerPermisosOrdenCompra(): Promise<PermisosOrdenCompra> {
  const permisos = await obtenerPermisosRol()
  if (!permisos) {
    return { rolCompras: false, puedeCancelar: false, puedeCambiarFechaCredito: false, usuarioId: null }
  }

  const puede = (accion: string) => permisos.esAdministrador || permisos.acciones.includes(accion)
  return {
    rolCompras: puede("comprar"),
    puedeCancelar: puede("cancelar_oc"),
    puedeCambiarFechaCredito: puede("cambiar_fecha_credito"),
    usuarioId: await obtenerUsuarioId(),
  }
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
  // "UM disponible": si la línea se compró en otra presentación (cajas), lo
  // comprado de verdad; cantidad y precioUnitario siguen en la unidad del
  // insumo (de ahí cuelgan Entradas, inventario y precios promedio).
  presentacion: PresentacionLinea | null
  // Requisición de donde salió la línea (null si quien consulta no la puede ver).
  requisicion: RequisicionDeOrden | null
  // Ítem del presupuesto (el mismo insumo puede venir de varios ítems).
  itemCodigo: string | null
  // Orden cerrada con faltante (Paquete C): lo que se había pedido, en la
  // unidad que muestra la orden. null = la línea no cambió.
  pedidoOriginal: number | null
}

export type RequisicionDeOrden = { id: string; numero: number; codigo: string; solicitante: string | null }

export type OrdenCompraDetalle = {
  id: string
  numero: number
  codigo: string // OC-001-0001 (20261230000000)
  estado: OrdenCompraEstado
  estadoEntrega: EstadoEntregaOrden
  estadoVisible: EstadoOrdenVisible
  proyectoCodigo: string | null
  proyectoNombre: string | null
  proyectoCiudad: string | null
  empresaNombre: string | null
  empresaNit: string | null
  empresaLogoUrl: string | null
  // Correo y ciudad de la empresa (Admin › Empresas, 20270101000000): van en el
  // encabezado de la OC. Sin ciudad de la empresa, la del proyecto.
  empresaCorreo: string | null
  empresaCiudad: string | null
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
  tipoPago: string | null
  fechaPagoCredito: string | null
  observaciones: string | null
  creadaPorNombre: string | null
  creadaPorId: string | null
  createdAt: string
  aprobadaPorNombre: string | null
  aprobadaAt: string | null
  motivoRechazo: string | null
  motivoDesaprobacion: string | null
  // Devuelta a Compras por Gerencia (20270101003300): hasta que Compras la modifique.
  devueltaCompras: { en: string; motivo: string } | null
  motivoCancelacion: string | null
  canceladaAt: string | null
  // Anticipo (A&F): null si la orden no tiene.
  anticipoPorcentaje: number | null
  saldoModo: "entrega" | "fecha" | null
  saldoFecha: string | null
  // Cómo se paga (20261219000000). pseTitular null = el proveedor.
  metodoPago: MetodoPagoOC
  pagoObservaciones: string | null
  pseTitular: { nombre: string; tipoDocumento: string; documento: string } | null
  // Pago inmediato (urgente, 20270101000000).
  pagoInmediato: boolean
  lineas: LineaOrdenCompraDetalle[]
  // A crédito: el pago ya pasó a pago (aprobado o dispersado): la fecha ya no se cambia.
  creditoPagado: boolean
  // Cerrada con faltante (Paquete C, entrega 2). null = no.
  cierreFaltante: {
    at: string
    porNombre: string | null
    motivo: string | null
    valorFaltante: number
    pagosReducidos: number
    saldoFavorGenerado: number
  } | null
  // Saldo a favor usado en esta orden (descontado de sus pagos).
  saldoFavorAplicado: number
}
export async function obtenerOrdenCompraDetalle(ordenId: string): Promise<OrdenCompraDetalle> {
  const supabase = await createClient()
  const userId = await obtenerUsuarioId()
  if (!userId) throw new Error("No autenticado.")

  const { data, error } = await supabase
    .from("ordenes_compra")
    .select(
      `
      id, numero, codigo, estado, estado_entrega, sitio_entrega, fecha_entrega, contacto_nombre, telefono, ciudad, email,
      condiciones_pago, tipo_pago, fecha_pago_credito, pago_inmediato, observaciones, created_at, aprobada_at, motivo_rechazo,
      motivo_desaprobacion, motivo_cancelacion, cancelada_at, devuelta_compras_at, devuelta_compras_motivo,
      anticipo_porcentaje, saldo_modo, saldo_fecha,
      metodo_pago, pago_observaciones, pse_titular_nombre, pse_titular_tipo_documento, pse_titular_documento,
      cerrada_faltante_at, motivo_cierre_faltante, valor_faltante, pagos_reducidos, saldo_favor_generado, saldo_favor_aplicado,
      cerrada_por:perfiles!ordenes_compra_cerrada_faltante_por_fkey(nombre),
      proyecto:proyectos!ordenes_compra_proyecto_id_fkey(codigo, nombre, ciudad, empresa:empresas(nit, razon_social, logo_url, correo, ciudad)),
      empresa_factura:empresas!ordenes_compra_empresa_id_fkey(nit, razon_social, logo_url, correo, ciudad),
      proveedor:proveedores!ordenes_compra_proveedor_id_fkey(
        nombre, numero_documento, digito_verificacion, direccion, ciudad, telefono, correo, nombre_contacto
      ),
      created_by,
      creado_por:perfiles!ordenes_compra_created_by_fkey(nombre),
      aprobada_por_perfil:perfiles!ordenes_compra_aprobada_por_fkey(nombre),
      lineas:ordenes_compra_items!ordenes_compra_items_orden_compra_id_fkey(
        id, cantidad, precio_unitario, porcentaje_descuento, porcentaje_iva,
        um_compra, conversion_compra, cantidad_compra, precio_compra, pedido_original,
        pedido:pedidos_insumos!ordenes_compra_items_pedido_insumo_id_fkey(
          unidad,
          item:presupuesto_items!pedidos_insumos_presupuesto_item_id_fkey(codigo),
          insumo:maestro_insumos!pedidos_insumos_insumo_id_fkey(codigo, descripcion, u_m),
          requisicion:requisiciones!pedidos_insumos_requisicion_fkey(
            id, numero, codigo, solicitante:perfiles!requisiciones_solicitado_por_fkey(nombre)
          )
        )
      )
    `
    )
    .eq("id", ordenId)
    .single()

  if (error) throw new Error(error.message)

  const d = data as any
  // Lo mismo que valida cambiar_fecha_credito_oc. Si la RLS no deja ver el
  // pago, queda en false y la base sigue bloqueando el cambio.
  let creditoPagado = false
  if (d.tipo_pago === "credito") {
    const { data: pagos } = await supabase
      .from("pagos")
      .select("estado")
      .eq("orden_compra_id", ordenId)
      .in("estado", ["aprobado", "dispersado"])
      .limit(1)
    creditoPagado = (pagos?.length ?? 0) > 0
  }
  const nitProveedor = d.proveedor?.numero_documento
    ? `${d.proveedor.numero_documento}${d.proveedor.digito_verificacion ? `-${d.proveedor.digito_verificacion}` : ""}`
    : null

  return {
    id: d.id,
    numero: d.numero,
    codigo: d.codigo,
    estado: d.estado,
    estadoEntrega: d.estado_entrega,
    estadoVisible: calcularEstadoVisible(d.estado, d.estado_entrega),
    proyectoCodigo: d.proyecto?.codigo ?? null,
    proyectoNombre: d.proyecto?.nombre ?? null,
    proyectoCiudad: d.proyecto?.ciudad ?? null,
    // Empresa que factura (Paquete A); las órdenes de antes, la del proyecto.
    empresaNombre: (d.empresa_factura ?? d.proyecto?.empresa)?.razon_social ?? null,
    empresaNit: (d.empresa_factura ?? d.proyecto?.empresa)?.nit ?? null,
    empresaLogoUrl: (d.empresa_factura ?? d.proyecto?.empresa)?.logo_url ?? null,
    empresaCorreo: (d.empresa_factura ?? d.proyecto?.empresa)?.correo ?? null,
    empresaCiudad: (d.empresa_factura ?? d.proyecto?.empresa)?.ciudad ?? null,
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
    tipoPago: d.tipo_pago ?? null,
    pagoInmediato: Boolean(d.pago_inmediato),
    fechaPagoCredito: d.fecha_pago_credito ?? null,
    creditoPagado,
    cierreFaltante: d.cerrada_faltante_at
      ? {
          at: d.cerrada_faltante_at,
          porNombre: d.cerrada_por?.nombre ?? null,
          motivo: d.motivo_cierre_faltante ?? null,
          valorFaltante: Number(d.valor_faltante ?? 0),
          pagosReducidos: Number(d.pagos_reducidos ?? 0),
          saldoFavorGenerado: Number(d.saldo_favor_generado ?? 0),
        }
      : null,
    saldoFavorAplicado: Number(d.saldo_favor_aplicado ?? 0),
    observaciones: d.observaciones,
    creadaPorNombre: d.creado_por?.nombre ?? null,
    creadaPorId: d.created_by ?? null,
    createdAt: d.created_at,
    aprobadaPorNombre: d.aprobada_por_perfil?.nombre ?? null,
    aprobadaAt: d.aprobada_at,
    motivoRechazo: d.motivo_rechazo,
    motivoDesaprobacion: d.motivo_desaprobacion,
    devueltaCompras: d.devuelta_compras_at ? { en: d.devuelta_compras_at, motivo: d.devuelta_compras_motivo ?? "" } : null,
    motivoCancelacion: d.motivo_cancelacion,
    canceladaAt: d.cancelada_at,
    anticipoPorcentaje: d.anticipo_porcentaje != null ? Number(d.anticipo_porcentaje) : null,
    saldoModo: d.saldo_modo ?? null,
    saldoFecha: d.saldo_fecha ?? null,
    metodoPago: d.metodo_pago === "pse" ? "pse" : "transferencia",
    pagoObservaciones: d.pago_observaciones ?? null,
    pseTitular: d.pse_titular_nombre
      ? { nombre: d.pse_titular_nombre, tipoDocumento: d.pse_titular_tipo_documento ?? "", documento: d.pse_titular_documento ?? "" }
      : null,
    lineas: (d.lineas ?? []).map((l: any) => ({
      id: l.id,
      insumoCodigo: l.pedido?.insumo?.codigo,
      insumoDescripcion: l.pedido?.insumo?.descripcion ?? "(insumo eliminado)",
      um: l.pedido?.insumo?.u_m ?? null,
      cantidad: Number(l.cantidad),
      precioUnitario: Number(l.precio_unitario),
      porcentajeDescuento: Number(l.porcentaje_descuento),
      porcentajeIva: Number(l.porcentaje_iva),
      presentacion: l.um_compra
        ? {
            umCompra: l.um_compra,
            conversionCompra: Number(l.conversion_compra),
            cantidadCompra: Number(l.cantidad_compra),
            precioCompra: Number(l.precio_compra),
            unidadConversion: l.pedido?.unidad ?? l.pedido?.insumo?.u_m ?? null,
          }
        : null,
      requisicion: l.pedido?.requisicion
        ? {
            id: l.pedido.requisicion.id,
            numero: l.pedido.requisicion.numero,
            codigo: l.pedido.requisicion.codigo ?? `N° ${l.pedido.requisicion.numero}`,
            solicitante: l.pedido.requisicion.solicitante?.nombre ?? null,
          }
        : null,
      itemCodigo: l.pedido?.item?.codigo ?? null,
      pedidoOriginal: l.pedido_original
        ? Number(l.pedido_original.um_compra ? l.pedido_original.cantidad_compra : l.pedido_original.cantidad)
        : null,
    })),
  }
}

// Devuelve una orden aprobada a "pendiente de aprobación": sus pagos se anulan
// y vuelve a Aprobación de pagos (A&F) con un pago nuevo. Solo si no tiene
// material recibido (sin entradas de almacén; lo valida la base).
// Mueve la fecha de pago de una OC a crédito (20261229000000). La base valida
// que el pago no haya pasado a pago y, si la fecha nueva ya está en esta
// semana, el pago en espera pasa de una vez.
export async function cambiarFechaCreditoOC(ordenId: string, fecha: string): Promise<void> {
  await requerirAccion("cambiar_fecha_credito")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error("Escribe la fecha de pago.")
  const supabase = await createClient()
  const { error } = await supabase.rpc("cambiar_fecha_credito_oc", { p_orden_id: ordenId, p_fecha: fecha })
  if (error) throw new Error(error.message)
}

// Cancela una orden aprobada. No se puede si tiene material recibido (entrega
// parcial o entregada). Sus pedidos vuelven a la cola de "Comprar pedidos".
// Aprobada: exige cancelar_oc. Pendiente: también quien la creó (retirarla).
// La base valida cuál aplica (cancelar_orden_compra).
// ---------------------------------------------------------------------------
// Modificar una orden de compra (20261231400000): mientras A&F no haya enviado
// su pago a liquidar. Vuelve a quedar por aprobar y su pago se reemplaza.
// ---------------------------------------------------------------------------

// null = se puede modificar; si no, el motivo (lo dice la base).
export async function ordenCompraModificable(ordenId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("orden_compra_modificable", { p_orden_id: ordenId })
  if (error) throw new Error(error.message)
  return (data as string | null) ?? null
}

export type LineaOrdenParaModificar = {
  pedidoId: string
  factor: number
  cantidad: number
  precioUnitario: number
  porcentajeDescuento: number
  porcentajeIva: number
  presentacion: PresentacionLinea | null
}

export type OrdenParaModificar = {
  id: string
  codigo: string
  estado: OrdenCompraEstado
  proyectoId: string
  proveedor: { id: string; nombre: string; idProv: string | null }
  sitioEntrega: string | null
  fechaEntrega: string | null
  contactoNombre: string | null
  condicionesPago: string | null
  observaciones: string | null
  anticipoPorcentaje: number | null
  saldoModo: "entrega" | "fecha" | null
  saldoFecha: string | null
  tipoPago: TipoPagoOC | null
  fechaPagoCredito: string | null
  pagoInmediato: boolean
  metodoPago: MetodoPagoOC
  cuentaTerceroId: string | null
  pagoObservaciones: string | null
  pseTitular: { nombre: string; tipoDocumento: string; documento: string } | null
  // Titular aparte (titular_de_orden), tal como lo devuelve la base.
  titular: unknown
  lineas: LineaOrdenParaModificar[]
  // Las líneas de la orden y las demás de sus requisiciones con algo por
  // comprar; lo pendiente no cuenta lo que compra esta orden.
  pedidos: PedidoParaComprar[]
}

export async function obtenerOrdenParaModificar(ordenId: string): Promise<OrdenParaModificar> {
  await requerirScope("rol_compras")
  const motivo = await ordenCompraModificable(ordenId)
  if (motivo) throw new Error(motivo)
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("ordenes_compra")
    .select(
      `id, codigo, estado, proyecto_id, sitio_entrega, fecha_entrega, contacto_nombre, condiciones_pago, observaciones,
       anticipo_porcentaje, saldo_modo, saldo_fecha, tipo_pago, fecha_pago_credito, pago_inmediato, titular_tercero_id, cuenta_tercero_id,
       metodo_pago, pago_observaciones, pse_titular_nombre, pse_titular_tipo_documento, pse_titular_documento,
       proveedor:proveedores!ordenes_compra_proveedor_id_fkey(unique_id, nombre, id_prov),
       lineas:ordenes_compra_items!ordenes_compra_items_orden_compra_id_fkey(
         pedido_insumo_id, cantidad, factor_unidad, precio_unitario, porcentaje_descuento, porcentaje_iva,
         um_compra, conversion_compra, cantidad_compra, precio_compra,
         pedido:pedidos_insumos!ordenes_compra_items_pedido_insumo_id_fkey(grupo_pedido_id)
       )`
    )
    .eq("id", ordenId)
    .single()
  if (error) throw new Error(error.message)
  const d = data as any

  // Todas las líneas de las requisiciones de la orden (las de la orden siempre;
  // las demás si les falta algo por comprar).
  const requisiciones = [...new Set<string>((d.lineas ?? []).map((l: any) => l.pedido?.grupo_pedido_id).filter(Boolean))]
  const enOrden = new Set<string>((d.lineas ?? []).map((l: any) => l.pedido_insumo_id))
  const filas: any[] = []
  for (let i = 0; i < requisiciones.length; i += 100) {
    const { data: ps, error: e } = await supabase
      .from("pedidos_insumos")
      .select(`${SELECT_PEDIDO_PARA_COMPRAR}, rechazado_compras_at`)
      .in("grupo_pedido_id", requisiciones.slice(i, i + 100))
      .eq("estado", "aprobado")
      .order("id", { ascending: true })
    if (e) throw new Error(e.message)
    filas.push(...(ps ?? []))
  }
  // Las de la orden salen siempre, aunque Compras les haya cerrado el saldo o
  // rechazado lo que faltaba (rechazado_compras_at); las demás, solo si se
  // pueden comprar.
  const rechazadas = new Set<string>(filas.filter((f) => f.rechazado_compras_at).map((f) => f.id))
  // Con el saldo cerrado no se compra más de lo que ya traía la orden (la base
  // lo vuelve a revisar en modificar_orden_compra).
  const usoEnOrden = new Map<string, number>(
    (d.lineas ?? []).map((l: any) => [l.pedido_insumo_id, Number(l.cantidad) * (Number(l.factor_unidad ?? 1) || 1)])
  )
  const pedidos = filas
    .map((f) => {
      const p = mapPedidoParaComprar(f, ordenId)
      if (!rechazadas.has(p.id)) return p
      const pendienteUso = Math.min(p.pendienteUso, usoEnOrden.get(p.id) ?? 0)
      return { ...p, pendienteUso, cantidadPendiente: pendienteUso > 0 ? unidadesDeCompra(pendienteUso, p.factor) : 0 }
    })
    .filter((p) => enOrden.has(p.id) || (!rechazadas.has(p.id) && p.cantidadPendiente > 0))
    // Primero las de la orden, en el orden de la requisición.
    .sort((a, b) => Number(enOrden.has(b.id)) - Number(enOrden.has(a.id)))

  let titular: unknown = null
  if (d.titular_tercero_id) {
    const { data: t, error: et } = await supabase.rpc("titular_de_orden", { p_orden_id: ordenId })
    if (et) throw new Error(et.message)
    titular = t
  }

  return {
    id: d.id,
    codigo: d.codigo,
    estado: d.estado,
    proyectoId: d.proyecto_id,
    proveedor: {
      id: d.proveedor?.unique_id,
      nombre: d.proveedor?.nombre ?? "(proveedor eliminado)",
      idProv: d.proveedor?.id_prov ?? null,
    },
    sitioEntrega: d.sitio_entrega,
    fechaEntrega: d.fecha_entrega,
    contactoNombre: d.contacto_nombre,
    condicionesPago: d.condiciones_pago,
    observaciones: d.observaciones,
    anticipoPorcentaje: d.anticipo_porcentaje != null ? Number(d.anticipo_porcentaje) : null,
    saldoModo: d.saldo_modo ?? null,
    saldoFecha: d.saldo_fecha ?? null,
    tipoPago: d.tipo_pago === "contado" || d.tipo_pago === "credito" || d.tipo_pago === "fiducia" ? d.tipo_pago : null,
    pagoInmediato: Boolean(d.pago_inmediato),
    fechaPagoCredito: d.fecha_pago_credito ?? null,
    metodoPago: d.metodo_pago === "pse" ? "pse" : "transferencia",
    cuentaTerceroId: d.titular_tercero_id ? null : (d.cuenta_tercero_id ?? null),
    pagoObservaciones: d.pago_observaciones ?? null,
    pseTitular: d.pse_titular_nombre
      ? { nombre: d.pse_titular_nombre, tipoDocumento: d.pse_titular_tipo_documento ?? "", documento: d.pse_titular_documento ?? "" }
      : null,
    titular,
    lineas: (d.lineas ?? []).map((l: any) => ({
      pedidoId: l.pedido_insumo_id,
      factor: Number(l.factor_unidad ?? 1) || 1,
      cantidad: Number(l.cantidad),
      precioUnitario: Number(l.precio_unitario),
      porcentajeDescuento: Number(l.porcentaje_descuento ?? 0),
      porcentajeIva: Number(l.porcentaje_iva ?? 0),
      presentacion: l.um_compra
        ? {
            umCompra: l.um_compra,
            conversionCompra: Number(l.conversion_compra),
            cantidadCompra: Number(l.cantidad_compra),
            precioCompra: Number(l.precio_compra),
          }
        : null,
    })),
    pedidos: await conPrecioPromedio(pedidos),
  }
}

// Soporte nuevo obligatorio (la cotización o factura con lo que cambió); los de
// antes se conservan.
export async function modificarOrdenCompra(
  ordenId: string,
  datos: Omit<DatosOrdenCompra, "proyectoId">,
  soporte: SoporteSubidoArchivo & { tipo: TipoSoporteOrden }
): Promise<void> {
  await requerirScope("rol_compras")
  if (!soporte?.ruta) throw new Error("Adjunta el soporte de la modificación (cotización, cuenta de cobro o factura).")
  const anticipo = validarDatosOrden({ ...datos, proyectoId: "" })
  const supabase = await createClient()
  const { error } = await supabase.rpc("modificar_orden_compra", {
    p_orden_id: ordenId,
    p_proveedor_id: datos.proveedorId,
    p_sitio_entrega: datos.sitioEntrega ?? null,
    p_fecha_entrega: datos.fechaEntrega ?? null,
    p_contacto_nombre: datos.contactoNombre ?? null,
    p_telefono: datos.telefono ?? null,
    p_ciudad: datos.ciudad ?? null,
    p_email: datos.email ?? null,
    p_condiciones_pago: datos.condicionesPago ?? null,
    p_observaciones: datos.observaciones ?? null,
    p_lineas: lineasParaGuardar(datos.lineas),
    p_pago: datos.pago,
    p_tipo_pago: datos.tipoPago,
    p_fecha_pago_credito: datos.tipoPago === "credito" ? (datos.fechaPagoCredito ?? null) : null,
    ...(anticipo ?? {}),
    p_titular: datos.titular ?? null,
    p_soporte: {
      tipo: soporte.tipo,
      ruta: soporte.ruta,
      nombre_archivo: soporte.nombreArchivo,
      tamano: soporte.tamano,
      mime: soporte.mime,
    },
  })
  if (error) throw new Error(error.message)
}

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

// Un insumo de la orden en el listado detallado. Cantidad, UM y precio van en
// la presentación de compra si la línea la tiene (como en el PDF); el total de
// la línea sale de la unidad del insumo (calcularLinea, igual que el detalle).
export type LineaOrdenListado = {
  id: string
  insumoCodigo: number | null
  insumoDescripcion: string
  um: string | null
  cantidad: number
  precioUnitario: number
  porcentajeDescuento: number
  porcentajeIva: number
  total: number
}

export type OrdenCompraListado = {
  id: string
  numero: number
  codigo: string
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
  // Suma de las líneas (descuento e IVA incluidos), como el total del PDF.
  valorTotal: number
  lineas: LineaOrdenListado[]
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

// La consulta del listado con los filtros, sin paginar (la usan la lista, por
// páginas, y la descarga a Excel, completa). Trae las líneas de cada orden en
// el mismo viaje: de ahí salen el valor total y el detalle de insumos.
function consultaOrdenesCompra(supabase: Awaited<ReturnType<typeof createClient>>, filtros: FiltrosOrdenesCompra) {
  // Proveedor por nombre: se filtra con un join (!inner) dentro de la misma
  // consulta. Antes se traían sus ids y se mandaban en un IN dentro de la URL,
  // que falla con muchos proveedores o corta el resultado.
  const proveedor = filtros.proveedor?.trim()

  // Dos formas del select (literales, para que el cliente infiera bien): con
  // el join !inner a proveedores solo cuando se filtra por proveedor.
  let query = (proveedor
    ? supabase
        .from("ordenes_compra")
        .select(
          `
      id, numero, codigo, estado, estado_entrega, created_at, proyecto_id,
      proyecto:proyectos!ordenes_compra_proyecto_id_fkey(codigo, nombre),
      proveedor:proveedores!ordenes_compra_proveedor_id_fkey!inner(nombre),
      created_by,
      creado_por:perfiles!ordenes_compra_created_by_fkey(nombre),
      lineas:ordenes_compra_items!ordenes_compra_items_orden_compra_id_fkey(
        id, created_at, cantidad, precio_unitario, porcentaje_descuento, porcentaje_iva,
        um_compra, cantidad_compra, precio_compra,
        pedido:pedidos_insumos!ordenes_compra_items_pedido_insumo_id_fkey(
          insumo:maestro_insumos!pedidos_insumos_insumo_id_fkey(codigo, descripcion, u_m)
        )
      )
    `
        )
        .ilike("proveedor.nombre", `%${proveedor}%`)
    : supabase
        .from("ordenes_compra")
        .select(
          `
      id, numero, codigo, estado, estado_entrega, created_at, proyecto_id,
      proyecto:proyectos!ordenes_compra_proyecto_id_fkey(codigo, nombre),
      proveedor:proveedores!ordenes_compra_proveedor_id_fkey(nombre),
      created_by,
      creado_por:perfiles!ordenes_compra_created_by_fkey(nombre),
      lineas:ordenes_compra_items!ordenes_compra_items_orden_compra_id_fkey(
        id, created_at, cantidad, precio_unitario, porcentaje_descuento, porcentaje_iva,
        um_compra, cantidad_compra, precio_compra,
        pedido:pedidos_insumos!ordenes_compra_items_pedido_insumo_id_fkey(
          insumo:maestro_insumos!pedidos_insumos_insumo_id_fkey(codigo, descripcion, u_m)
        )
      )
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
  return query
}

function mapOrdenListado(o: any): Omit<OrdenCompraListado, "tieneSobrecostoPrecio"> {
  // Líneas en el orden en que se agregaron (el embebido no garantiza orden).
  const crudas = [...(o.lineas ?? [])].sort((a: any, b: any) =>
    a.created_at === b.created_at ? (a.id < b.id ? -1 : 1) : a.created_at < b.created_at ? -1 : 1
  )
  const lineas: LineaOrdenListado[] = crudas.map((l: any) => {
    const base = {
      cantidad: Number(l.cantidad),
      precioUnitario: Number(l.precio_unitario),
      porcentajeDescuento: Number(l.porcentaje_descuento),
      porcentajeIva: Number(l.porcentaje_iva),
    }
    const conPresentacion = Boolean(l.um_compra)
    return {
      id: l.id,
      insumoCodigo: l.pedido?.insumo?.codigo ?? null,
      insumoDescripcion: l.pedido?.insumo?.descripcion ?? "(insumo eliminado)",
      um: conPresentacion ? l.um_compra : (l.pedido?.insumo?.u_m ?? null),
      cantidad: conPresentacion ? Number(l.cantidad_compra) : base.cantidad,
      precioUnitario: conPresentacion ? Number(l.precio_compra) : base.precioUnitario,
      porcentajeDescuento: base.porcentajeDescuento,
      porcentajeIva: base.porcentajeIva,
      total: calcularLinea(base).total,
    }
  })
  return {
    id: o.id,
    numero: o.numero,
    codigo: o.codigo,
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
    valorTotal: lineas.reduce((acc, l) => acc + l.total, 0),
    lineas,
  }
}

export async function listarTodasLasOrdenesCompra(
  filtros: FiltrosOrdenesCompra = {},
  pagina = 0
): Promise<{ ordenes: OrdenCompraListado[]; hayMas: boolean }> {
  if (!(await obtenerUsuarioId())) throw new Error("No autenticado.")
  const supabase = await createClient()
  const { data: filasPagina, error } = await consultaOrdenesCompra(supabase, filtros).range(...rangoPagina(pagina))
  if (error) throw new Error(error.message)
  const { filas: data, hayMas } = cortarPagina((filasPagina ?? []) as any[])
  return { ordenes: await conSobrecostoPrecio((data ?? []).map(mapOrdenListado)), hayMas }
}

// Descarga a Excel: TODAS las órdenes que cumplen los filtros (todas las
// páginas), con sus líneas. Sin la marca de sobrecosto (no va en el Excel).
export async function exportarOrdenesCompra(
  filtros: FiltrosOrdenesCompra = {}
): Promise<Omit<OrdenCompraListado, "tieneSobrecostoPrecio">[]> {
  if (!(await obtenerUsuarioId())) throw new Error("No autenticado.")
  const supabase = await createClient()
  // Una consulta nueva por página (el constructor de supabase-js no se reutiliza).
  const filas = await traerTodo<any>((desde, hasta) => consultaOrdenesCompra(supabase, filtros).range(desde, hasta))
  return filas.map(mapOrdenListado)
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
  | "acta_aprobada"
  | "acta_rechazada"
  | "minuta_por_revisar"
  | "minuta_aprobada"
  | "minuta_devuelta"
  | "contrato_vencido"
  | "contrato_vencido_juridica"
  | "insumo_rechazado"
  | "insumo_por_convertir"
  | "otrosi_por_revisar"
  | "otrosi_por_aprobar"
  | "otrosi_devuelto"
  | "otrosi_rechazado"
  | "otrosi_aprobado"
  | "otrosi_devuelto_subgerencia"
  | "poliza_pendiente"
  | "poliza_por_revisar"
  | "poliza_aprobada"
  | "poliza_devuelta"
  | "requisicion_admin_aprobada"
  | "requisicion_admin_rechazada"
  | "requisicion_extraordinaria"
  | "requisicion_administrativa"
  | "requisicion_administrativa_por_aprobar"
  | "requisicion_administrativa_aprobada"
  | "requisicion_administrativa_rechazada"
  | "insumo_aprobado"
  | "autorizacion_tercero_por_revisar"
  | "autorizacion_tercero_aprobada"
  | "autorizacion_tercero_rechazada"
  // Al aprobarse la OC, a quien pidió la requisición (20270101002300).
  | "requisicion_comprada"
  // Cuadro de SINCO cargado: adjuntar los soportes (20270101002800).
  | "cuadro_sinco_soportes"
  // Gerencia devolvió la OC a Compras para modificarla (20270101003300).
  | "orden_compra_devuelta"
export type NotificacionEntidadTipo =
  | "pedido_insumo"
  | "orden_compra"
  | "requisicion"
  | "contrato"
  | "acta"
  | "presupuesto"
  | "otrosi"
  | "requisicion_admin"
  | "cuadro_sinco"

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
    // No leídas arriba, leídas al final; cada grupo de la más nueva a la más
    // vieja (índice idx_notificaciones_usuario_leida_fecha, 20261231100000).
    .order("leida", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(30)

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
// Borrar: una notificación o todas las leídas. La policy
// notificaciones_delete_propias (20261231100000) solo deja borrar las propias.
export async function borrarNotificacion(id: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from("notificaciones").delete().eq("id", id)
  if (error) throw new Error(error.message)
}

export async function borrarNotificacionesLeidas(): Promise<void> {
  const supabase = await createClient()
  const userId = await obtenerUsuarioId()
  if (!userId) throw new Error("No autenticado.")
  const { error } = await supabase.from("notificaciones").delete().eq("usuario_id", userId).eq("leida", true)
  if (error) throw new Error(error.message)
}

// Todas las no leídas de quien está en sesión (la RLS deja tocar solo las propias).
export async function marcarTodasNotificacionesLeidas(): Promise<void> {
  const supabase = await createClient()
  const userId = await obtenerUsuarioId()
  if (!userId) throw new Error("No autenticado.")
  const { error } = await supabase.from("notificaciones").update({ leida: true }).eq("usuario_id", userId).eq("leida", false)
  if (error) throw new Error(error.message)
}

export async function marcarNotificacionLeida(id: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from("notificaciones").update({ leida: true }).eq("id", id)
  if (error) throw new Error(error.message)
}