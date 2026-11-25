import type { createClient } from "@/lib/supabase/server"
import { calcularEstadoVisible } from "@/lib/ordenes-compra-estado"
import type { OrdenCompraDetalle } from "@/app/(app)/almacen/comprar-pedidos/actions"

// ---------------------------------------------------------------------------
// Detalle de una orden de compra con el cliente que se le pase (SOLO servidor).
// obtenerOrdenCompraDetalle lo usa con la sesión del usuario (la RLS decide qué
// ve); el PDF que se congela al aprobar el pago (congelarPdfOrdenCompra, para
// la copia en Drive) lo usa con la service role, para que no salga incompleto
// cuando quien aprueba no ve el proyecto.
// ---------------------------------------------------------------------------

type Supabase = Pick<Awaited<ReturnType<typeof createClient>>, "from">

export async function cargarOrdenCompraDetalle(supabase: Supabase, ordenId: string): Promise<OrdenCompraDetalle> {
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
