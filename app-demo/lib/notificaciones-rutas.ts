// A dónde lleva cada notificación: la campanita al hacer clic y el enlace
// "Abrir en 360" de los correos (/notificaciones/<id>). Archivo plano, sin
// dependencias: lo usan el componente y la ruta del servidor.

export type AvisoParaRuta = { tipo: string; entidadTipo: string; entidadId: string }

// A dónde navega cada tipo de notificación al hacer click: las órdenes de
// compra a su detalle, y las requisiciones al registro de requisiciones.
export function rutaNotificacion(n: AvisoParaRuta): string {
  if (n.entidadTipo === "orden_compra") return `/almacen/ordenes-compra/${n.entidadId}`
  // Insumo nuevo aprobado sin ítem (lo pidió una requisición administrativa).
  if (n.tipo === "insumo_aprobado" && n.entidadTipo !== "presupuesto") return "/ayf/requisiciones-administrativas"
  if (n.entidadTipo === "requisicion") {
    // A Subgerencia, su bandeja; a quien pidió una administrativa, sus requisiciones.
    if (n.tipo === "requisicion_administrativa_por_aprobar") return "/almacen/aprobacion-requisiciones-administrativas"
    if (n.tipo === "requisicion_administrativa_aprobada" || n.tipo === "requisicion_administrativa_rechazada")
      return `/ayf/requisiciones-administrativas?ver=${n.entidadId}`
    // A Gerencia, la bandeja de extraordinarias; lo demás, al detalle.
    return n.tipo === "requisicion_extraordinaria"
      ? "/almacen/requisiciones-extraordinarias"
      : n.tipo === "requisicion_administrativa"
        ? "/almacen/comprar-pedidos"
        : `/almacen/registro-requisiciones/${n.entidadId}`
  }
  // Contratos: a quien aprueba, a Pre-aprobación; a Gerencia, a Aprobación
  // de minutas; a Jurídica (minuta aprobada o devuelta), a Pre-aprobación; a
  // quien solicitó, a su lista. ?ver= abre el detalle de esa solicitud.
  if (n.entidadTipo === "contrato") {
    if (n.tipo === "minuta_por_revisar") return `/contratos/aprobacion-minutas?ver=${n.entidadId}`
    // Pólizas: a Jurídica, a Aprobación de pólizas; al ingeniero y al director, a Pólizas.
    if (n.tipo === "poliza_por_revisar") return `/contratos/aprobacion-polizas?ver=${n.entidadId}`
    if (n.tipo === "poliza_pendiente" || n.tipo === "poliza_aprobada" || n.tipo === "poliza_devuelta")
      return `/contratos/polizas?ver=${n.entidadId}`
    // Contrato vencido sin liquidar: a Jurídica, a Pre-aprobación; a quien lo pidió, a su lista.
    return n.tipo === "contrato_por_revisar" ||
      n.tipo === "minuta_aprobada" ||
      n.tipo === "minuta_devuelta" ||
      n.tipo === "contrato_vencido_juridica"
      ? `/contratos/pre-aprobacion?ver=${n.entidadId}`
      : `/contratos/solicitar?ver=${n.entidadId}`
  }
  // Actas aprobadas o rechazadas: a quien la hizo, a Elaboración de actas con el acta abierta.
  if (n.tipo === "autorizacion_tercero_por_revisar") return `/contratos/autorizaciones-terceros?ver=${n.entidadId}`
  if (n.entidadTipo === "acta") return `/contratos/actas?ver=${n.entidadId}`
  // Otrosí: a Jurídica (por revisar, devuelto por Gerencia) y a Gerencia
  // (por aprobar), a Aprobación de otrosí; al ingeniero (devuelto, rechazado,
  // aprobado), a Solicitud de otrosí. "Aprobado" también le llega a quien lo
  // envió desde Jurídica, que tiene las dos pestañas.
  if (n.entidadTipo === "otrosi") {
    const aJuridicaOGerencia =
      n.tipo === "otrosi_por_revisar" || n.tipo === "otrosi_por_aprobar" || n.tipo === "otrosi_devuelto_subgerencia"
    return aJuridicaOGerencia ? `/contratos/aprobacion-otrosi?ver=${n.entidadId}` : `/contratos/otrosi?ver=${n.entidadId}`
  }
  // Requisición administrativa aprobada o rechazada: a quien la hizo.
  if (n.entidadTipo === "requisicion_admin") return `/ayf/pagos-administrativos?ver=${n.entidadId}`
  // Insumo nuevo aprobado o rechazado: al presupuesto (del proyecto actual).
  // Aprobado en otra unidad: además abre Revisar pendientes ("Falta conversión").
  if (n.entidadTipo === "presupuesto")
    return n.tipo === "insumo_por_convertir" ? "/presupuestos?revisar=1" : "/presupuestos"
  return "/almacen/registro-requisiciones"
}
