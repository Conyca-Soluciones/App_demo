"use server"

import { createClient } from "@/lib/supabase/server"
import { obtenerUsuarioId, requerirPestana } from "@/lib/permisos"
import { TAMANO_PAGINA, cortarPagina } from "@/lib/paginacion"
import { limiteBusqueda } from "@/lib/busqueda"
import { documentoFormateado } from "@/lib/terceros"
import {
  itemParaGuardar,
  mapDetalleReqAdmin,
  mapFilaReqAdmin,
  mapOpciones,
  validarRequisicionAdmin,
  metodoDelCuadro,
  type CuentaReqAdmin,
  type EstadoReqAdmin,
  type ItemFormReqAdmin,
  type OpcionesReqAdmin,
  type RequisicionAdminDetalle,
  type RequisicionAdminFila,
} from "@/lib/requisiciones-admin"

// Requisiciones administrativas: las hace cualquier usuario con sesión (no hay
// pestaña ni acción en la matriz). Todo pasa por funciones de la base
// (20261202000000), que vuelven a validar y exigen la sesión.

async function clienteConSesion() {
  if (!(await obtenerUsuarioId())) throw new Error("Inicia sesión.")
  return createClient()
}

// Los cuadros de pagos: pestaña ayf.pagos_administrativos de la matriz de
// Roles (20270101001400). El buscador de terceros y las cuentas siguen solo con
// sesión: también los usan Generar OC, actas y contratistas.
async function clienteConPestana() {
  await requerirPestana("ayf.pagos_administrativos")
  return createClient()
}

export async function opcionesRequisicionAdmin(): Promise<OpcionesReqAdmin> {
  const supabase = await clienteConPestana()
  const { data, error } = await supabase.rpc("opciones_requisicion_admin")
  if (error) throw new Error(error.message)
  return mapOpciones(data)
}

// Terceros inscritos (transferencia): por nombre o documento.
export async function buscarTercerosRequisicionAdmin(
  termino: string
): Promise<{ id: string; etiqueta: string; subetiqueta: string }[]> {
  const supabase = await clienteConSesion()
  const { data, error } = await supabase.rpc("buscar_terceros_requisicion_admin", {
    p_q: termino,
    p_limite: limiteBusqueda(termino),
  })
  if (error) throw new Error(error.message)
  return ((data ?? []) as any[]).map((t) => ({
    id: t.id,
    etiqueta: t.razon_social,
    subetiqueta: `${t.tipo_documento} ${documentoFormateado({ tipoDocumento: t.tipo_documento, numeroDocumento: t.numero_documento, dv: t.dv })}`,
  }))
}

export async function cuentasTerceroRequisicionAdmin(terceroId: string): Promise<CuentaReqAdmin[]> {
  const supabase = await clienteConSesion()
  const { data, error } = await supabase.rpc("cuentas_tercero_requisicion_admin", { p_tercero_id: terceroId })
  if (error) throw new Error(error.message)
  return ((data ?? []) as any[]).map((c) => ({
    id: c.id,
    banco: c.banco,
    tipoCuenta: c.tipo_cuenta,
    numeroCuenta: c.numero_cuenta,
    verificada: Boolean(c.verificada),
  }))
}

// Cada ítem lleva su método (transferencia o PSE); el del cuadro es el de sus
// ítems o "mixto" (la base lo vuelve a calcular).
function revisar(items: ItemFormReqAdmin[]) {
  const errores = validarRequisicionAdmin(items)
  if (errores.length > 0) {
    const e = errores[0]
    throw new Error(e.indice >= 0 ? `Ítem ${e.indice + 1}: ${e.mensaje}` : e.mensaje)
  }
  return { metodo: metodoDelCuadro(items), payload: items.map((it) => itemParaGuardar(it)) }
}

export async function crearRequisicionAdmin(items: ItemFormReqAdmin[]): Promise<string> {
  const { metodo, payload } = revisar(items)
  const supabase = await clienteConPestana()
  const { data, error } = await supabase.rpc("crear_requisicion_admin", { p_metodo: metodo, p_items: payload })
  if (error) throw new Error(error.message)
  return data as string
}

// Por aprobar: la modifica. Rechazada: la corrige y vuelve a A&F (mismo número).
export async function modificarRequisicionAdmin(id: string, items: ItemFormReqAdmin[]): Promise<void> {
  const { metodo, payload } = revisar(items)
  const supabase = await clienteConPestana()
  const { error } = await supabase.rpc("modificar_requisicion_admin", { p_id: id, p_metodo: metodo, p_items: payload })
  if (error) throw new Error(error.message)
}

export async function cancelarRequisicionAdmin(id: string, motivo: string): Promise<void> {
  if (!motivo.trim()) throw new Error("El motivo es obligatorio.")
  const supabase = await clienteConPestana()
  const { error } = await supabase.rpc("cancelar_requisicion_admin", { p_id: id, p_motivo: motivo.trim() })
  if (error) throw new Error(error.message)
}

// Mis requisiciones, una página de 50 (la más reciente primero).
export async function listarMisRequisicionesAdmin(
  filtros: { estado?: EstadoReqAdmin; numero?: number; codigo?: string } = {},
  pagina = 0
): Promise<{ filas: RequisicionAdminFila[]; hayMas: boolean }> {
  const supabase = await clienteConPestana()
  // Por código de un pago (PA-001-0001): el cuadro al que pertenece.
  let numero = filtros.numero ?? null
  const codigo = filtros.codigo?.trim().toUpperCase()
  if (codigo) {
    const { data: item, error: e } = await supabase
      .from("requisicion_admin_items")
      .select("cuadro:requisiciones_admin!inner(numero)")
      .eq("codigo", codigo)
      .maybeSingle()
    if (e) throw new Error(e.message)
    const n = (item as { cuadro: { numero: number | null } | null } | null)?.cuadro?.numero
    if (n == null) return { filas: [], hayMas: false }
    numero = n
  }
  const { data, error } = await supabase.rpc("listar_requisiciones_admin", {
    p_mias: true,
    p_estado: filtros.estado ?? null,
    p_numero: numero,
    p_offset: pagina * TAMANO_PAGINA,
    p_limite: TAMANO_PAGINA + 1,
  })
  if (error) throw new Error(error.message)
  const { filas, hayMas } = cortarPagina((data ?? []) as any[])
  return { filas: filas.map(mapFilaReqAdmin), hayMas }
}

// Quien la hizo o A&F / Gerencia (la base lo revisa).
export async function obtenerRequisicionAdmin(id: string): Promise<RequisicionAdminDetalle> {
  const supabase = await clienteConPestana()
  const { data, error } = await supabase.rpc("detalle_requisicion_admin", { p_id: id })
  if (error) throw new Error(error.message)
  return mapDetalleReqAdmin(data)
}
