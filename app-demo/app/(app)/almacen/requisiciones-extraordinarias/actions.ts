"use server"

// app/(app)/almacen/requisiciones-extraordinarias/actions.ts
//
// Aprobación de requisiciones extraordinarias (Gerencia): requisiciones de uno
// o varios insumos por encima de lo que contempla el presupuesto. La lista sale
// de listar_requisiciones_extraordinarias (SECURITY DEFINER, exige la pestaña y
// los proyectos que ve quien consulta) con lo que ya se ha pedido de ese insumo.
// Aprobar y rechazar usan resolver_requisicion, que para estas exige la acción
// aprobar_requisiciones_extraordinarias
// (supabase/migrations/20261226000000_requisiciones_extraordinarias.sql).

import { createClient } from "@/lib/supabase/server"
import { requerirAccion, requerirPestana, obtenerPermisosRol } from "@/lib/permisos"
import { cortarPagina, TAMANO_PAGINA } from "@/lib/paginacion"
import type { EstadoRequisicion } from "@/lib/requisiciones-lineas"

// Una línea: un insumo en un ítem, con lo que Gerencia necesita para decidir.
export type LineaExtraordinaria = {
  id: string
  insumoCodigo: number | null
  insumoDescripcion: string
  insumoUm: string | null
  itemCodigo: string
  itemDescripcion: string
  cantidad: number
  // false = el insumo no está en el APU del ítem (material nuevo para el ítem).
  enApu: boolean
  // Lo que contempla el presupuesto para el insumo en el ítem (0 si no está en el APU).
  presupuestado: number
  // Requisiciones normales (pendientes o aprobadas) del insumo en el ítem.
  pedidoItem: number
  requisicionesItem: number
  // Otras extraordinarias (pendientes o aprobadas) del insumo en el ítem.
  extraPrevias: number
  extraPreviasCantidad: number
  // Todo lo pedido del insumo en el proyecto (cualquier ítem), sin contar esta requisición.
  pedidoProyecto: number
  requisicionesProyecto: number
}

export type RequisicionExtraordinaria = {
  id: string
  numero: number
  proyectoCodigo: string | null
  proyectoNombre: string | null
  solicitanteNombre: string | null
  createdAt: string
  fechaRequerida: string | null
  urgente: boolean
  estado: EstadoRequisicion
  justificacion: string | null
  motivoResolucion: string | null
  resueltoAt: string | null
  resueltoPorNombre: string | null
  lineas: LineaExtraordinaria[]
}

const mapLinea = (l: any): LineaExtraordinaria => ({
  id: l.id,
  insumoCodigo: l.insumo_codigo ?? null,
  insumoDescripcion: l.insumo_descripcion ?? "",
  insumoUm: l.insumo_um ?? null,
  itemCodigo: l.item_codigo ?? "",
  itemDescripcion: l.item_descripcion ?? "",
  cantidad: Number(l.cantidad),
  enApu: l.en_apu === true,
  presupuestado: Number(l.presupuestado ?? 0),
  pedidoItem: Number(l.pedido_item ?? 0),
  requisicionesItem: Number(l.requisiciones_item ?? 0),
  extraPrevias: Number(l.extra_previas ?? 0),
  extraPreviasCantidad: Number(l.extra_previas_cantidad ?? 0),
  pedidoProyecto: Number(l.pedido_proyecto ?? 0),
  requisicionesProyecto: Number(l.requisiciones_proyecto ?? 0),
})

export async function listarRequisicionesExtraordinarias(
  estado: EstadoRequisicion | null,
  pagina = 0
): Promise<{ filas: RequisicionExtraordinaria[]; hayMas: boolean }> {
  await requerirPestana("tecnico.aprobar_extraordinarias")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("listar_requisiciones_extraordinarias", {
    p_estado: estado,
    p_proyecto_id: null,
    p_offset: pagina * TAMANO_PAGINA,
    p_limite: TAMANO_PAGINA + 1,
  })
  if (error) throw new Error(error.message)

  const { filas, hayMas } = cortarPagina((data ?? []) as any[])
  return {
    hayMas,
    filas: filas.map((f) => ({
      id: f.id,
      numero: Number(f.numero),
      proyectoCodigo: f.proyecto_codigo,
      proyectoNombre: f.proyecto_nombre,
      solicitanteNombre: f.solicitante_nombre,
      createdAt: f.created_at,
      fechaRequerida: f.fecha_requerida,
      urgente: f.urgente === true,
      estado: f.estado,
      justificacion: f.justificacion,
      motivoResolucion: f.motivo_resolucion,
      resueltoAt: f.resuelto_at,
      resueltoPorNombre: f.resuelto_por_nombre,
      lineas: Array.isArray(f.lineas) ? f.lineas.map(mapLinea) : [],
    })),
  }
}

// Aprueba o rechaza (motivo obligatorio al rechazar). Al aprobarla pasa a
// Compras como cualquier requisición aprobada.
export async function resolverRequisicionExtraordinaria(
  id: string,
  estado: "aprobado" | "rechazado",
  comentario?: string
) {
  await requerirAccion("aprobar_requisiciones_extraordinarias")
  const motivo = comentario?.trim() || null
  if (estado === "rechazado" && !motivo) throw new Error("Escribe el motivo del rechazo.")

  const supabase = await createClient()
  const { error } = await supabase.rpc("resolver_requisicion", {
    p_id: id,
    p_estado: estado,
    p_comentario: motivo,
  })
  if (error) throw new Error(error.message)
}

export async function puedeAprobarExtraordinarias(): Promise<boolean> {
  const permisos = await obtenerPermisosRol()
  if (!permisos) return false
  return permisos.esAdministrador || permisos.acciones.includes("aprobar_requisiciones_extraordinarias")
}
