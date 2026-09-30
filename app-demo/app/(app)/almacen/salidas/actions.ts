"use server"

import { createClient } from "@/lib/supabase/server"

// ---------------------------------------------------------------------------
// Salidas de almacén -- material que sale de bodega hacia obra, para medir
// avance REAL de obra (comprado != usado). No hay chequeo de rol propio:
// cualquier usuario con acceso al proyecto (ingeniero o almacenista) puede
// ver y registrar salidas de ese proyecto -- la RLS de `salidas_insumos`
// (usuario_puede_ver_proyecto) ya decide quién puede hacer qué, igual que
// en listarTodasLasOrdenesCompra. El límite "no se puede sacar más de lo
// comprado" también vive en la base de datos (trigger
// verificar_salida_no_supera_disponible), no solo acá -- así queda
// protegido incluso si dos personas registran al mismo tiempo.
// ---------------------------------------------------------------------------

export type ProyectoParaSalidas = { id: string; codigo: string | null; nombre: string }

// Sin filtro explícito de permisos: la policy "ver proyectos permitidos"
// (usuario_puede_ver_proyecto) ya limita el resultado a los proyectos del
// usuario.
export async function listarProyectosParaSalidas(): Promise<ProyectoParaSalidas[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("proyectos")
    .select("id, codigo, nombre")
    .order("codigo", { ascending: false, nullsFirst: false })

  if (error) throw new Error(error.message)
  return data ?? []
}

export type InsumoDisponibleSalida = {
  insumoId: string
  insumoCodigo: number
  insumoDescripcion: string
  insumoUm: string | null
  cantidadComprada: number
  cantidadSalida: number
  cantidadDisponible: number
}

// Reutiliza resumen_ejecucion_proyecto (misma función que usa
// admin/visualizacion) en vez de duplicar el cruce compras/salidas acá.
export async function obtenerInsumosDisponiblesParaSalida(
  proyectoId: string
): Promise<InsumoDisponibleSalida[]> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("resumen_ejecucion_proyecto", {
    p_proyecto_id: proyectoId,
  })

  if (error) throw new Error(error.message)

  return (data ?? [])
    .filter((i: any) => Number(i.cantidad_comprada) > 0)
    .map((i: any) => {
      const cantidadComprada = Number(i.cantidad_comprada)
      const cantidadSalida = Number(i.cantidad_salida)
      return {
        insumoId: i.insumo_id,
        insumoCodigo: i.insumo_codigo,
        insumoDescripcion: i.insumo_descripcion,
        insumoUm: i.insumo_um,
        cantidadComprada,
        cantidadSalida,
        cantidadDisponible: Math.max(cantidadComprada - cantidadSalida, 0),
      }
    })
}

export type RegistrarSalidaInput = {
  proyectoId: string
  insumoId: string
  cantidad: number
  observaciones?: string | null
}

export async function registrarSalida(input: RegistrarSalidaInput): Promise<void> {
  if (!Number.isFinite(input.cantidad) || input.cantidad <= 0) {
    throw new Error("La cantidad debe ser mayor a cero.")
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado.")

  const { error } = await supabase.from("salidas_insumos").insert({
    proyecto_id: input.proyectoId,
    insumo_id: input.insumoId,
    cantidad: input.cantidad,
    registrado_por: user.id,
    observaciones: input.observaciones?.trim() || null,
  })

  if (error) throw new Error(error.message)
}

export type SalidaRegistrada = {
  id: string
  insumoCodigo: number
  insumoDescripcion: string
  insumoUm: string | null
  cantidad: number
  fecha: string
  registradoPorNombre: string | null
  registradoPorId: string
  observaciones: string | null
  createdAt: string
}

// Historial de salidas del proyecto, para poder revisar/anular. RLS ya
// filtra a los proyectos visibles por el usuario.
export async function listarSalidasDelProyecto(proyectoId: string): Promise<SalidaRegistrada[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("salidas_insumos")
    .select(
      `
      id, cantidad, fecha, observaciones, created_at, registrado_por,
      insumo:maestro_insumos!salidas_insumos_insumo_id_fkey(codigo, descripcion, u_m),
      registrado_por_perfil:perfiles!salidas_insumos_registrado_por_fkey(nombre)
    `
    )
    .eq("proyecto_id", proyectoId)
    .order("created_at", { ascending: false })

  if (error) throw new Error(error.message)

  return (data ?? []).map((s: any) => ({
    id: s.id,
    insumoCodigo: s.insumo?.codigo,
    insumoDescripcion: s.insumo?.descripcion ?? "(insumo eliminado)",
    insumoUm: s.insumo?.u_m ?? null,
    cantidad: Number(s.cantidad),
    fecha: s.fecha,
    registradoPorNombre: s.registrado_por_perfil?.nombre ?? null,
    registradoPorId: s.registrado_por,
    observaciones: s.observaciones,
    createdAt: s.created_at,
  }))
}

// RLS (salidas_insumos_delete: registrado_por = auth.uid() o admin) ya
// decide si el usuario puede anular esta fila -- si no puede, el delete
// simplemente no afecta filas y el usuario ve el error genérico de abajo.
export async function anularSalida(salidaId: string): Promise<void> {
  const supabase = await createClient()

  const { error, count } = await supabase
    .from("salidas_insumos")
    .delete({ count: "exact" })
    .eq("id", salidaId)

  if (error) throw new Error(error.message)
  if (!count) throw new Error("No se pudo anular la salida (no existe o no tienes permiso).")
}