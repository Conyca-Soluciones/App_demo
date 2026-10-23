import type { createClient } from "@/lib/supabase/server"
import { datosTipoDesdeBase, type SolicitudContratoDetalle, type SolicitudContratoFila } from "@/lib/contratos"

export type { SolicitudContratoDetalle, SolicitudContratoFila }

// ---------------------------------------------------------------------------
// Consultas de contratos compartidas por Solicitud de contratos,
// Pre-aprobación y Aprobación de minutas. Va FUERA de los actions.ts porque
// un archivo "use server" solo puede exportar funciones asíncronas que el cliente puede invocar --
// esto es ayuda interna del servidor (mismo patrón que requisiciones-lineas.ts).
// ---------------------------------------------------------------------------

export const SELECT_FILA_CONTRATO = `
  id, numero, proyecto_id, tipo, estado, objeto, valor, plazo_tipo, fecha_inicio, fecha_fin, duracion_cantidad,
  duracion_unidad, created_at, enviado_at, motivo_resolucion, resuelto_at,
  minuta_estado, minuta_enviada_at, minuta_resuelta_at, minuta_motivo, numero_contrato,
  clase, tipo_detalle, referencia, retencion_garantia_pct, retencion_anticipo_pct, retencion_fic_pct, liquidado_at, otrosis_aprobados, poliza_estado,
  minuta_enviador:perfiles!contratos_minuta_enviada_por_fkey(nombre),
  minuta_resolutor:perfiles!contratos_minuta_resuelta_por_fkey(nombre),
  proyecto:proyectos!contratos_proyecto_id_fkey(codigo, nombre),
  contratista:contratistas!contratos_contratista_id_fkey(id, nombre, tipo_documento, numero_documento, digito_verificacion, correo),
  solicitante:perfiles!contratos_solicitado_por_fkey(nombre),
  resolutor:perfiles!contratos_resuelto_por_fkey(nombre)
`

export function mapFilaContrato(f: any): SolicitudContratoFila {
  const c = f.contratista
  return {
    id: f.id,
    numero: Number(f.numero),
    proyectoId: f.proyecto_id,
    proyectoCodigo: f.proyecto?.codigo ?? null,
    proyectoNombre: f.proyecto?.nombre ?? null,
    tipo: f.tipo,
    estado: f.estado,
    contratistaNombre: c?.nombre ?? "(contratista eliminado)",
    contratistaDocumento: c
      ? c.tipo_documento === "NIT"
        ? `NIT ${c.numero_documento}-${c.digito_verificacion ?? ""}`
        : `${c.tipo_documento} ${c.numero_documento}`
      : "",
    objeto: f.objeto,
    valor: Number(f.valor),
    plazoTipo: f.plazo_tipo,
    fechaInicio: f.fecha_inicio,
    fechaFin: f.fecha_fin,
    duracionCantidad: f.duracion_cantidad,
    duracionUnidad: f.duracion_unidad,
    solicitadoPorNombre: f.solicitante?.nombre ?? null,
    createdAt: f.created_at,
    enviadoAt: f.enviado_at,
    motivoResolucion: f.motivo_resolucion,
    resueltoPorNombre: f.resolutor?.nombre ?? null,
    resueltoAt: f.resuelto_at,
    minutaEstado: f.minuta_estado ?? null,
    minutaEnviadaAt: f.minuta_enviada_at ?? null,
    minutaEnviadaPorNombre: f.minuta_enviador?.nombre ?? null,
    minutaResueltaAt: f.minuta_resuelta_at ?? null,
    minutaResueltaPorNombre: f.minuta_resolutor?.nombre ?? null,
    minutaMotivo: f.minuta_motivo ?? null,
    numeroContrato: f.numero_contrato ?? null,
    clase: f.clase === "general" ? "general" : "grupo",
    tipoDetalle: f.tipo_detalle ?? null,
    referencia: f.referencia ?? null,
    retencionGarantiaPct: Number(f.retencion_garantia_pct ?? 0),
    retencionAnticipoPct: Number(f.retencion_anticipo_pct ?? 0),
    retencionFicPct: Number(f.retencion_fic_pct ?? 0),
    liquidadoAt: f.liquidado_at ?? null,
    otrosisAprobados: Number(f.otrosis_aprobados ?? 0),
    polizaEstado:
      f.poliza_estado === "pendiente" || f.poliza_estado === "recibida" || f.poliza_estado === "aprobada" || f.poliza_estado === "no_aplica"
        ? f.poliza_estado
        : null,
  }
}

export async function cargarDetalleContrato(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string
): Promise<SolicitudContratoDetalle> {
  const { data: f, error } = await supabase
    .from("contratos")
    .select(`
      ${SELECT_FILA_CONTRATO},
      anexo_tipo, valor_mensual, tiene_anticipo, anticipo_porcentaje, forma_pago, metodo_pago, pago_observaciones,
      correo_notificacion, observaciones,
      domicilio_departamento, datos_tipo, requiere_poliza,
      contratista_completo:contratistas!contratos_contratista_id_fkey(
        tipo_persona, documentos:contratista_documentos(id, tipo, nombre_archivo, mime)
      ),
      obligaciones:contrato_obligaciones(orden, texto),
      entregables:contrato_entregables(orden, texto),
      items:contrato_anexo_items(orden, presupuesto_item_id, actividad, unidad, cantidad, valor_unitario, sin_mano_obra, otrosi_id, presupuesto_item:presupuesto_items(codigo)),
      documentos:contrato_documentos(id, tipo, nombre_archivo, mime, ruta, tamano)
    `)
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!f) throw new Error("La solicitud no existe o no tienes acceso.")

  const x = f as any
  const porOrden = (a: { orden: number }, b: { orden: number }) => a.orden - b.orden
  return {
    ...mapFilaContrato(x),
    contratistaId: x.contratista?.id,
    contratistaCorreo: x.contratista?.correo ?? "",
    contratistaTipoPersona: x.contratista_completo?.tipo_persona ?? "natural",
    contratistaDocumentos: (x.contratista_completo?.documentos ?? []).map((d: any) => ({
      id: d.id,
      tipo: d.tipo,
      nombreArchivo: d.nombre_archivo,
      mime: d.mime,
    })),
    anexoTipo: x.anexo_tipo,
    valorMensual: x.valor_mensual === null || x.valor_mensual === undefined ? null : Number(x.valor_mensual),
    tieneAnticipo: x.tiene_anticipo,
    anticipoPorcentaje: x.anticipo_porcentaje === null ? null : Number(x.anticipo_porcentaje),
    requierePoliza: x.requiere_poliza !== false,
    formaPago: x.forma_pago,
    metodoPago: x.metodo_pago === "pse" ? "pse" : "transferencia",
    pagoObservaciones: x.pago_observaciones ?? null,
    correoNotificacion: x.correo_notificacion,
    observaciones: x.observaciones,
    domicilioDepartamento: x.domicilio_departamento ?? null,
    datosTipo: datosTipoDesdeBase(x.datos_tipo),
    obligaciones: [...(x.obligaciones ?? [])].sort(porOrden).map((o: any) => o.texto),
    entregables: [...(x.entregables ?? [])].sort(porOrden).map((e: any) => e.texto),
    // Solo el anexo del contrato firmado: las actividades de otrosí van aparte.
    items: [...(x.items ?? [])].filter((i: any) => !i.otrosi_id).sort(porOrden).map((i: any) => ({
      presupuestoItemId: i.presupuesto_item_id,
      codigo: i.presupuesto_item?.codigo ?? null,
      actividad: i.actividad,
      unidad: i.unidad,
      cantidad: Number(i.cantidad),
      valorUnitario: Number(i.valor_unitario),
      sinManoObra: Boolean(i.sin_mano_obra),
    })),
    documentos: (x.documentos ?? []).map((d: any) => ({
      id: d.id,
      tipo: d.tipo,
      nombreArchivo: d.nombre_archivo,
      mime: d.mime,
      ruta: d.ruta,
      tamano: Number(d.tamano),
    })),
  }
}
