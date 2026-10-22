"use server"

import { createClient } from "@/lib/supabase/server"
import { obtenerPermisosRol, requerirAccion, requerirPestana } from "@/lib/permisos"
import { puedeBuscar } from "@/lib/busqueda"
import type {
  ActaDetalle,
  ActaResumen,
  ContratistaParaActa,
  ContratoParaActa,
  DatosActa,
  InfoContratoActa,
  TipoSoporte,
} from "@/lib/actas"

// ---------------------------------------------------------------------------
// Actas por grupos: buscar el contrato (o el contratista y luego su contrato),
// ver sus actas y crear o editar una. Todo pasa por funciones de la base que
// revisan la pestaña contratos.cortes, el acceso al proyecto y, para crear o
// editar, la acción elaborar_actas (20261112000000_actas_sobre_contrato.sql).
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any -- filas crudas de Supabase */
const mapContrato = (f: any): ContratoParaActa => ({
  id: f.contrato_id,
  numeroContrato: f.numero_contrato ?? `Solicitud N° ${f.numero}`,
  numero: Number(f.numero),
  tipo: f.tipo,
  objeto: f.objeto,
  valor: Number(f.valor),
  proyectoCodigo: f.proyecto_codigo,
  proyectoNombre: f.proyecto_nombre,
  contratistaId: f.contratista_id,
  contratistaNombre: f.contratista_nombre,
  contratistaDocumento: f.contratista_documento,
  actas: Number(f.actas),
})

const num = (x: unknown) => (x == null ? null : Number(x))

export async function buscarContratosParaActa(texto: string): Promise<ContratoParaActa[]> {
  await requerirPestana("contratos.cortes")
  if (!puedeBuscar(texto)) return []
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("buscar_contratos_para_acta", { p_texto: texto.trim() })
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapContrato)
}

export async function contratosDeContratista(contratistaId: string): Promise<ContratoParaActa[]> {
  await requerirPestana("contratos.cortes")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("buscar_contratos_para_acta", { p_texto: null, p_contratista_id: contratistaId })
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapContrato)
}

export async function buscarContratistasParaActa(texto: string): Promise<ContratistaParaActa[]> {
  await requerirPestana("contratos.cortes")
  if (!puedeBuscar(texto)) return []
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("buscar_contratistas_para_acta", { p_texto: texto.trim() })
  if (error) throw new Error(error.message)
  return (data ?? []).map((f: any) => ({
    id: f.contratista_id,
    nombre: f.nombre,
    documento: f.documento,
    contratos: Number(f.contratos),
  }))
}

export async function listarActasDeContrato(contratoId: string): Promise<ActaResumen[]> {
  await requerirPestana("contratos.cortes")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("actas_de_contrato", { p_contrato_id: contratoId })
  if (error) throw new Error(error.message)
  return (data ?? []).map((f: any) => ({
    id: f.acta_id,
    numero: Number(f.numero),
    tipo: f.tipo,
    estado: f.estado,
    valorBruto: Number(f.valor_bruto),
    neto: Number(f.neto),
    periodoDesde: f.periodo_desde ?? null,
    periodoHasta: f.periodo_hasta ?? null,
    createdAt: f.created_at,
    creadoPorNombre: f.creado_por_nombre ?? null,
    esMio: Boolean(f.es_mio),
  }))
}

// El contrato con sus actividades y acumulados, para llenar o editar un acta
// (excluirActa: la que se edita no cuenta contra sí misma).
export async function obtenerContratoParaActa(contratoId: string, excluirActa?: string): Promise<InfoContratoActa> {
  await requerirPestana("contratos.cortes")
  const supabase = await createClient()
  const { data: d, error } = await supabase.rpc("contrato_para_acta", {
    p_contrato_id: contratoId,
    p_excluir_acta: excluirActa ?? null,
  })
  if (error) throw new Error(error.message)
  return {
    valor: Number(d.valor),
    valorInicial: Number(d.valor_inicial ?? d.valor),
    anexoTipo: d.anexo_tipo,
    anticipoPorcentaje: num(d.anticipo_porcentaje),
    retencionPorcentaje: num(d.retencion_porcentaje),
    fechaFin: d.fecha_fin ?? null,
    vencido: Boolean(d.vencido),
    liquidado: Boolean(d.liquidado),
    listoParaActas: Boolean(d.listo_para_actas),
    tieneFinal: Boolean(d.tiene_final),
    tieneLiquidacion: Boolean(d.tiene_liquidacion),
    actasPorAprobar: Number(d.actas_por_aprobar),
    brutoOtras: Number(d.bruto_otras),
    avanceOtras: Number(d.avance_otras),
    amortizadoOtras: Number(d.amortizado_otras),
    amortizadoAprobado: Number(d.amortizado_aprobado),
    retenidoAprobado: Number(d.retenido_aprobado),
    actividades: (d.actividades ?? []).map((a: any) => ({
      id: a.id,
      orden: Number(a.orden),
      actividad: a.actividad,
      unidad: a.unidad,
      cantidad: Number(a.cantidad),
      valorUnitario: Number(a.valor_unitario),
      acumulado: Number(a.acumulado),
    })),
  }
}

// Detalle de un acta: lo usan Actas por grupos, Aprobación de actas y el PDF
// (la base revisa cualquiera de las dos pestañas y el acceso al proyecto).
export async function obtenerActa(id: string): Promise<ActaDetalle> {
  const permisos = await obtenerPermisosRol()
  const ok =
    permisos?.esAdministrador ||
    (!permisos?.sinRol &&
      (permisos?.pestanas.includes("contratos.cortes") ||
        permisos?.pestanas.includes("contratos.aprobar_actas") ||
        // Desde su pago (A&F): detalle_acta solo deja ver el acta si se ve el pago.
        permisos?.pestanas.includes("ayf.aprobacion_pagos") ||
        permisos?.pestanas.some((p) => p.startsWith("ayf.consolidado_"))))
  if (!ok) throw new Error("No tienes permiso para ver actas.")
  const supabase = await createClient()
  const { data: d, error } = await supabase.rpc("detalle_acta", { p_acta_id: id })
  if (error) throw new Error(error.message)
  return mapActaDetalle(d)
}

function mapActaDetalle(d: any): ActaDetalle {
  return {
    id: d.id,
    numero: Number(d.numero),
    tipo: d.tipo,
    estado: d.estado,
    periodoDesde: d.periodo_desde ?? null,
    periodoHasta: d.periodo_hasta ?? null,
    observaciones: d.observaciones ?? null,
    porcentajeAvance: num(d.porcentaje_avance),
    valorBruto: Number(d.valor_bruto),
    amortizacion: Number(d.amortizacion),
    retencion: Number(d.retencion),
    devolucionRetencion: Number(d.devolucion_retencion),
    otrosDescuentos: Number(d.otros_descuentos),
    neto: Number(d.neto),
    anticipoPorcentaje: num(d.anticipo_porcentaje),
    retencionPorcentaje: num(d.retencion_porcentaje),
    createdAt: d.created_at,
    creadoPorNombre: d.creado_por_nombre ?? null,
    resueltoAt: d.resuelto_at ?? null,
    resueltoPorNombre: d.resuelto_por_nombre ?? null,
    motivoResolucion: d.motivo_resolucion ?? null,
    editadaAt: d.editada_at ?? null,
    editadaPorNombre: d.editada_por_nombre ?? null,
    esMio: Boolean(d.es_mio),
    contratoId: d.contrato_id,
    numeroContrato: d.numero_contrato,
    contratoValor: Number(d.contrato_valor),
    objeto: d.objeto,
    tipoContrato: d.tipo_contrato,
    anexoTipo: d.anexo_tipo,
    proyectoCodigo: d.proyecto_codigo,
    proyectoNombre: d.proyecto_nombre,
    proyectoCiudad: d.proyecto_ciudad ?? null,
    empresaNombre: d.empresa_nombre ?? null,
    empresaNit: d.empresa_nit ?? null,
    contratistaId: d.contratista_id,
    contratistaNombre: d.contratista_nombre,
    contratistaTipoPersona: d.contratista_tipo_persona ?? null,
    contratistaDocumento: d.contratista_documento,
    contratistaRepresentante: d.contratista_representante ?? null,
    otrasActas: Number(d.otras_actas),
    avanceAnterior: Number(d.avance_anterior),
    actividades: (d.actividades ?? []).map((a: any) => ({
      id: a.id,
      orden: Number(a.orden),
      actividad: a.actividad,
      unidad: a.unidad,
      cantidadContratada: Number(a.cantidad_contratada),
      valorUnitario: Number(a.valor_unitario),
      acumuladoAnterior: Number(a.acumulado_anterior),
      cantidad: num(a.cantidad),
      valor: num(a.valor),
    })),
    descuentos: (d.descuentos ?? []).map((x: any) => ({ concepto: x.concepto, valor: Number(x.valor) })),
    soportes: (d.soportes ?? []).map((s: any) => ({
      id: s.id,
      tipo: s.tipo,
      ruta: s.ruta,
      nombreArchivo: s.nombre_archivo,
      tamano: num(s.tamano),
      mime: s.mime ?? null,
    })),
    pago: d.pago
      ? {
          id: d.pago.id,
          estado: d.pago.estado,
          valor: Number(d.pago.valor),
          anio: num(d.pago.anio),
          semana: num(d.pago.semana),
          item: num(d.pago.item),
          novedad: d.pago.novedad ?? null,
        }
      : null,
    lineasAnteriores: (d.lineas_anteriores ?? []).map((l: any) => ({
      orden: Number(l.orden),
      itemCodigo: l.item_codigo ?? null,
      itemDescripcion: l.item_descripcion ?? null,
      insumoDescripcion: l.insumo_descripcion,
      unidad: l.unidad ?? null,
      cantidad: Number(l.cantidad),
      precio: Number(l.precio),
      total: Number(l.total),
    })),
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export type SoporteSubido = { tipo: TipoSoporte; ruta: string; nombreArchivo: string; tamano: number; mime: string }

const soportesParaBase = (s: SoporteSubido[]) =>
  s.map((x) => ({ tipo: x.tipo, ruta: x.ruta, nombre_archivo: x.nombreArchivo, tamano: x.tamano, mime: x.mime }))

// El id del acta lo genera el navegador (los soportes ya se subieron a <id>/).
export async function guardarActa(
  actaId: string,
  contratoId: string,
  datos: DatosActa,
  soportes: SoporteSubido[]
): Promise<{ id: string; numero: number }> {
  await requerirAccion("elaborar_actas")
  for (const s of soportes) if (!s.ruta.startsWith(`${actaId}/`)) throw new Error("La ruta de un soporte no corresponde al acta.")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("crear_acta", {
    p_acta_id: actaId,
    p_contrato_id: contratoId,
    p_datos: datos,
    p_soportes: soportesParaBase(soportes),
  })
  if (error) throw new Error(error.message)
  return { id: data.id, numero: Number(data.numero) }
}

// Corrige un acta que no está aprobada (solo quien la creó): vuelve a "por
// aprobar" con el mismo número. Devuelve las rutas de los soportes quitados.
export async function editarActa(
  actaId: string,
  datos: DatosActa,
  soportesNuevos: SoporteSubido[],
  soportesQuitar: string[]
): Promise<{ id: string; numero: number; rutasQuitadas: string[] }> {
  await requerirAccion("elaborar_actas")
  for (const s of soportesNuevos) if (!s.ruta.startsWith(`${actaId}/`)) throw new Error("La ruta de un soporte no corresponde al acta.")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("editar_acta", {
    p_acta_id: actaId,
    p_datos: datos,
    p_soportes_nuevos: soportesParaBase(soportesNuevos),
    p_soportes_quitar: soportesQuitar,
  })
  if (error) throw new Error(error.message)
  return { id: data.id, numero: Number(data.numero), rutasQuitadas: (data.rutas_quitadas ?? []) as string[] }
}

// Enlace firmado de 2 minutos para ver un soporte (la política del bucket
// exige poder ver el acta).
export async function enlaceSoporteActa(ruta: string): Promise<string> {
  const supabase = await createClient()
  const { data, error } = await supabase.storage.from("actas").createSignedUrl(ruta, 120)
  if (error || !data) throw new Error(error?.message ?? "No se pudo abrir el soporte.")
  return data.signedUrl
}
