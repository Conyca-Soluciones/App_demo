"use server"

import { createClient } from "@/lib/supabase/server"
import { obtenerPermisosRol, requerirAccion, requerirPestana } from "@/lib/permisos"
import { puedeBuscar } from "@/lib/busqueda"
import {
  validarActa,
  type ActaDetalle,
  type ActaResumen,
  type ContratistaParaActa,
  type ContratoParaActa,
  type InsumoParaActa,
  type ItemParaActa,
  type LineaActaForm,
} from "@/lib/actas"

// ---------------------------------------------------------------------------
// Elaboración de actas: buscar el contrato (o el contratista y luego su
// contrato), ver sus actas y crear una nueva. Todo pasa por funciones de la
// base que revisan la pestaña contratos.cortes, el acceso al proyecto y, para
// crear, la acción elaborar_actas (20261110000000_actas_contratos.sql).
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
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
    estado: f.estado,
    total: Number(f.total),
    createdAt: f.created_at,
    creadoPorNombre: f.creado_por_nombre ?? null,
    lineas: Number(f.lineas),
  }))
}

export async function buscarItemsParaActa(contratoId: string, texto: string): Promise<ItemParaActa[]> {
  await requerirPestana("contratos.cortes")
  if (!puedeBuscar(texto)) return []
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("items_para_acta", { p_contrato_id: contratoId, p_texto: texto.trim() })
  if (error) throw new Error(error.message)
  return (data ?? []).map((f: any) => ({
    id: f.presupuesto_item_id,
    codigo: f.codigo ?? "",
    descripcion: f.descripcion ?? "",
    unidad: f.unidad ?? null,
  }))
}

export async function insumosDeItemParaActa(contratoId: string, itemId: string): Promise<InsumoParaActa[]> {
  await requerirPestana("contratos.cortes")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("insumos_item_para_acta", { p_contrato_id: contratoId, p_item_id: itemId })
  if (error) throw new Error(error.message)
  return (data ?? []).map((f: any) => ({
    itemApuId: f.item_apu_id,
    insumoCodigo: f.insumo_codigo ?? null,
    descripcion: f.descripcion,
    unidad: f.unidad ?? null,
    precio: f.precio == null ? null : Number(f.precio),
    ivaPorcentaje: Number(f.iva_porcentaje ?? 0),
  }))
}
// Detalle de un acta: lo usan Elaboración y Aprobación de actas (la base
// revisa cualquiera de las dos pestañas y el acceso al proyecto).
export async function obtenerActa(id: string): Promise<ActaDetalle> {
  const permisos = await obtenerPermisosRol()
  const ok =
    permisos?.esAdministrador ||
    (!permisos?.sinRol && (permisos?.pestanas.includes("contratos.cortes") || permisos?.pestanas.includes("contratos.aprobar_actas")))
  if (!ok) throw new Error("No tienes permiso para ver actas.")
  const supabase = await createClient()
  const { data: d, error } = await supabase.rpc("detalle_acta", { p_acta_id: id })
  if (error) throw new Error(error.message)
  return {
    id: d.id,
    numero: Number(d.numero),
    estado: d.estado,
    total: Number(d.total),
    createdAt: d.created_at,
    creadoPorNombre: d.creado_por_nombre ?? null,
    resueltoAt: d.resuelto_at ?? null,
    resueltoPorNombre: d.resuelto_por_nombre ?? null,
    motivoResolucion: d.motivo_resolucion ?? null,
    editadaAt: d.editada_at ?? null,
    editadaPorNombre: d.editada_por_nombre ?? null,
    contratoId: d.contrato_id,
    numeroContrato: d.numero_contrato,
    contratoValor: Number(d.contrato_valor),
    objeto: d.objeto,
    tipo: d.tipo,
    proyectoCodigo: d.proyecto_codigo,
    proyectoNombre: d.proyecto_nombre,
    contratistaId: d.contratista_id,
    contratistaNombre: d.contratista_nombre,
    contratistaDocumento: d.contratista_documento,
    otrasActas: Number(d.otras_actas),
    lineas: (d.lineas ?? []).map((l: any) => ({
      orden: Number(l.orden),
      presupuestoItemId: l.presupuesto_item_id ?? null,
      itemApuId: l.item_apu_id ?? null,
      itemCodigo: l.item_codigo ?? null,
      itemDescripcion: l.item_descripcion ?? null,
      insumoCodigo: l.insumo_codigo ?? null,
      insumoDescripcion: l.insumo_descripcion,
      unidad: l.unidad ?? null,
      cantidad: Number(l.cantidad),
      precio: Number(l.precio),
      ivaPorcentaje: Number(l.iva_porcentaje),
      baseIva: Number(l.base_iva),
      iva: Number(l.iva),
      total: Number(l.total),
    })),
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function guardarActa(contratoId: string, lineas: LineaActaForm[]): Promise<{ id: string; numero: number }> {
  await requerirAccion("elaborar_actas")
  const r = validarActa(lineas)
  if (!r.ok) throw new Error(r.error)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("crear_acta", {
    p_contrato_id: contratoId,
    p_lineas: r.lineas.map((l) => ({
      presupuesto_item_id: l.presupuestoItemId,
      item_apu_id: l.itemApuId,
      cantidad: l.cantidad,
    })),
  })
  if (error) throw new Error(error.message)
  return { id: data.id, numero: Number(data.numero) }
}

// Corrige un acta que no está aprobada: reemplaza sus líneas y vuelve a
// "por aprobar" con el mismo número (editar_acta revisa estado y cupo).
export async function editarActa(actaId: string, lineas: LineaActaForm[]): Promise<{ id: string; numero: number }> {
  await requerirAccion("elaborar_actas")
  const r = validarActa(lineas)
  if (!r.ok) throw new Error(r.error)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("editar_acta", {
    p_acta_id: actaId,
    p_lineas: r.lineas.map((l) => ({
      presupuesto_item_id: l.presupuestoItemId,
      item_apu_id: l.itemApuId,
      cantidad: l.cantidad,
    })),
  })
  if (error) throw new Error(error.message)
  return { id: data.id, numero: Number(data.numero) }
}
