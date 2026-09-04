"use server"

import { createClient } from "@/lib/supabase/server"
import { buscarSimilares } from "@/lib/similitud-texto"
import { obtenerPermisosUsuario } from "@/lib/permisos"
import { requerirScope } from "@/lib/permisos"
import { combinarBloquesConResoluciones } from "@/lib/apu-import-types"
import type {
  BloqueApuInput,
  ResolucionInsumo,
  BloqueConResolucion,
  FilaRevisionImport,
  CandidatoInsumo,
  CategoriaManoObra,
  ResolucionManoObra,
} from "@/lib/apu-import-types"

//Aprobado

export async function crearPresupuesto(proyectoId: string, nombre: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("presupuestos")
    .insert({ proyecto_id: proyectoId, nombre })
    .select()
    .single()

  if (error) {
    if (error.code === "23505") {
      throw new Error(
        "Este proyecto ya tiene un presupuesto. Usa 'Crear versión nueva' en vez de crear uno nuevo."
      )
    }
    throw new Error(error.message)
  }

  return data
}

export async function verProyectos() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error("No autenticado.")
  }

  const permisos = await obtenerPermisosUsuario(user.id)

  if (permisos.veTodosProyectos) {
    const { data, error } = await supabase
      .from("proyectos")
      .select("id, codigo, nombre")
      .order("codigo", { ascending: false, nullsFirst: false })

    if (error) {
      throw new Error(error.message)
    }

    return data
  }

  const idsPermitidos = Array.from(permisos.proyectos.keys())

  if (idsPermitidos.length === 0) {
    return []
  }

  const { data, error } = await supabase
    .from("proyectos")
    .select("id, codigo, nombre")
    .in("id", idsPermitidos)
    .order("codigo", { ascending: false, nullsFirst: false })

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export type PresupuestoExistente = {
  id: string
  nombre: string
  estado: string
  created_at: string
}

export async function verPresupuestoDeProyecto(
  proyectoId: string
): Promise<PresupuestoExistente | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("presupuestos")
    .select("id, nombre, estado, created_at")
    .eq("proyecto_id", proyectoId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function cargarItemsDePresupuesto(
  presupuestoId: string
): Promise<ItemPresupuesto[]> {
  const supabase = await createClient()

  const { data: presupuesto, error: errorPresupuesto } = await supabase
    .from("presupuestos")
    .select("version_actual_id")
    .eq("id", presupuestoId)
    .single()

  if (errorPresupuesto) {
    throw new Error(errorPresupuesto.message)
  }

  if (!presupuesto.version_actual_id) {
    return []
  }

  return cargarVersion(presupuesto.version_actual_id)
}

function ordenarJerarquicamente(items: ItemPresupuesto[]): ItemPresupuesto[] {
  const hijosPorPadre = new Map<string | null, ItemPresupuesto[]>()

  for (const item of items) {
    const lista = hijosPorPadre.get(item.padreId) ?? []
    lista.push(item)
    hijosPorPadre.set(item.padreId, lista)
  }

  for (const lista of hijosPorPadre.values()) {
    lista.sort((a, b) => a.codigo.localeCompare(b.codigo, "es", { numeric: true }))
  }

  const resultado: ItemPresupuesto[] = []

  function visitar(padreId: string | null) {
    for (const item of hijosPorPadre.get(padreId) ?? []) {
      resultado.push(item)
      visitar(item.id)
    }
  }

  visitar(null)

  const idsIncluidos = new Set(resultado.map((i) => i.id))
  for (const item of items) {
    if (!idsIncluidos.has(item.id)) {
      resultado.push(item)
    }
  }

  return resultado
}

export type ItemPresupuestoInput = {
  id: string
  padreId: string | null
  nivel: number
  codigo: string
  descripcion: string
  unidad: string | null
  cantidad?: number | null
  valorUnitario?: number | null
  valorTotal?: number | null
  apuId?: string | null
  precioOriginal: number | null
}

export type ItemPresupuesto = ItemPresupuestoInput & {
  guardado: boolean
  pendienteAprobacion?: boolean
}

async function obtenerOCrearVersionActual(
  supabase: Awaited<ReturnType<typeof createClient>>,
  presupuestoId: string
): Promise<string> {
  const { data: presupuesto, error: errorLectura } = await supabase
    .from("presupuestos")
    .select("version_actual_id")
    .eq("id", presupuestoId)
    .single()

  if (errorLectura) {
    throw new Error(errorLectura.message)
  }

  if (presupuesto.version_actual_id) {
    return presupuesto.version_actual_id
  }

  const { data: nuevaVersion, error: errorCreacion } = await supabase
    .from("presupuesto_versiones")
    .insert({ presupuesto_id: presupuestoId, numero: 1, nombre: "Versión inicial" })
    .select("id")
    .single()

  if (errorCreacion) {
    throw new Error(errorCreacion.message)
  }

  const { error: errorLink } = await supabase
    .from("presupuestos")
    .update({ version_actual_id: nuevaVersion.id })
    .eq("id", presupuestoId)

  if (errorLink) {
    throw new Error(errorLink.message)
  }

  return nuevaVersion.id
}

export type VersionPresupuesto = {
  id: string
  numero: number
  nombre: string
  creadoEn: string
  esActual: boolean
}

export async function listarVersiones(presupuestoId: string): Promise<VersionPresupuesto[]> {
  const supabase = await createClient()

  const { data: presupuesto, error: errorPresupuesto } = await supabase
    .from("presupuestos")
    .select("version_actual_id")
    .eq("id", presupuestoId)
    .single()

  if (errorPresupuesto) {
    throw new Error(errorPresupuesto.message)
  }

  const { data, error } = await supabase
    .from("presupuesto_versiones")
    .select("id, numero, nombre, creado_en")
    .eq("presupuesto_id", presupuestoId)
    .order("numero", { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map((v) => ({
    id: v.id,
    numero: v.numero,
    nombre: v.nombre,
    creadoEn: v.creado_en,
    esActual: v.id === presupuesto.version_actual_id,
  }))
}

export async function crearVersionVacia(
  presupuestoId: string,
  nombre: string
): Promise<VersionPresupuesto> {
  const supabase = await createClient()

  const { data: ultimaVersion, error: errorUltima } = await supabase
    .from("presupuesto_versiones")
    .select("numero")
    .eq("presupuesto_id", presupuestoId)
    .order("numero", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (errorUltima) {
    throw new Error(errorUltima.message)
  }

  const siguienteNumero = (ultimaVersion?.numero ?? 0) + 1

  const { data: nuevaVersion, error: errorCreacion } = await supabase
    .from("presupuesto_versiones")
    .insert({ presupuesto_id: presupuestoId, numero: siguienteNumero, nombre })
    .select("id, numero, nombre, creado_en")
    .single()

  if (errorCreacion) {
    throw new Error(errorCreacion.message)
  }

  const { error: errorLink } = await supabase
    .from("presupuestos")
    .update({ version_actual_id: nuevaVersion.id })
    .eq("id", presupuestoId)

  if (errorLink) {
    throw new Error(errorLink.message)
  }

  return {
    id: nuevaVersion.id,
    numero: nuevaVersion.numero,
    nombre: nuevaVersion.nombre,
    creadoEn: nuevaVersion.creado_en,
    esActual: true,
  }
}

export async function crearNuevaVersion(
  presupuestoId: string,
  nombre: string
): Promise<VersionPresupuesto> {
  const supabase = await createClient()

  const versionActualId = await obtenerOCrearVersionActual(supabase, presupuestoId)

  const { data: itemsActuales, error: errorItems } = await supabase
    .from("presupuesto_items")
    .select("id, padre_id, nivel, codigo, descripcion, unidad, cantidad, valor_unitario, valor_total, apu_id, precio_original")
    .eq("presupuesto_id", presupuestoId)
    .eq("version_id", versionActualId)

  if (errorItems) {
    throw new Error(errorItems.message)
  }

  const { data: ultimaVersion, error: errorUltima } = await supabase
    .from("presupuesto_versiones")
    .select("numero")
    .eq("presupuesto_id", presupuestoId)
    .order("numero", { ascending: false })
    .limit(1)
    .single()

  if (errorUltima) {
    throw new Error(errorUltima.message)
  }

  const { data: nuevaVersion, error: errorCreacion } = await supabase
    .from("presupuesto_versiones")
    .insert({
      presupuesto_id: presupuestoId,
      numero: ultimaVersion.numero + 1,
      nombre,
    })
    .select("id, numero, nombre, creado_en")
    .single()

  if (errorCreacion) {
    throw new Error(errorCreacion.message)
  }

  const idNuevoDe = new Map<string, string>()
  for (const item of itemsActuales ?? []) {
    idNuevoDe.set(item.id, crypto.randomUUID())
  }

  const apuIdsUnicos = Array.from(
    new Set((itemsActuales ?? []).map((item) => item.apu_id).filter((id): id is string => Boolean(id)))
  )

  const apuNuevoDe = new Map<string, string>()

  if (apuIdsUnicos.length > 0) {
    // ver seleccionarEnLotesPorIds -- con un presupuesto grande,
    // apuIdsUnicos puede tener cientos de valores.
    const apusOrigen = await seleccionarEnLotesPorIds<any>(apuIdsUnicos, 200, async (lote) => {
      const { data, error } = await supabase
        .from("apu")
        .select("id, codigo, descripcion, item_apu(insumo_id, cantidad, rendimiento, tipo)")
        .in("id", lote)
      if (error) throw new Error(error.message)
      return data ?? []
    })

    const filasApuNuevas = (apusOrigen ?? []).map((apu) => {
      const nuevoId = crypto.randomUUID()
      apuNuevoDe.set(apu.id, nuevoId)
      return { id: nuevoId, codigo: apu.codigo, descripcion: apu.descripcion }
    })

    const { error: errorInsertApus } = await supabase.from("apu").insert(filasApuNuevas)
    if (errorInsertApus) {
      throw new Error(errorInsertApus.message)
    }

    const todasLasLineasNuevas = (apusOrigen ?? []).flatMap((apu) =>
      (apu.item_apu ?? []).map((linea: any) => ({
        apu_id: apuNuevoDe.get(apu.id),
        insumo_id: linea.insumo_id,
        cantidad: linea.cantidad,
        rendimiento: linea.rendimiento ?? 1,
        tipo: linea.tipo,
      }))
    )

    if (todasLasLineasNuevas.length > 0) {
      const { error: errorInsertLineas } = await supabase.from("item_apu").insert(todasLasLineasNuevas)
      if (errorInsertLineas) {
        throw new Error(errorInsertLineas.message)
      }
    }
  }

  const filasNuevas = (itemsActuales ?? []).map((item) => ({
    id: idNuevoDe.get(item.id),
    presupuesto_id: presupuestoId,
    version_id: nuevaVersion.id,
    padre_id: item.padre_id ? idNuevoDe.get(item.padre_id) ?? null : null,
    nivel: item.nivel,
    codigo: item.codigo,
    descripcion: item.descripcion,
    unidad: item.unidad,
    cantidad: item.cantidad,
    valor_unitario: item.valor_unitario,
    valor_total: item.valor_total,
    apu_id: item.apu_id ? apuNuevoDe.get(item.apu_id) ?? null : null,
    precio_original: item.precio_original,
  }))

  if (filasNuevas.length > 0) {
    const { error: errorInsertItems } = await supabase
      .from("presupuesto_items")
      .insert(filasNuevas)

    if (errorInsertItems) {
      throw new Error(errorInsertItems.message)
    }
  }

  const { error: errorActualizarActual } = await supabase
    .from("presupuestos")
    .update({ version_actual_id: nuevaVersion.id })
    .eq("id", presupuestoId)

  if (errorActualizarActual) {
    throw new Error(errorActualizarActual.message)
  }

  return {
    id: nuevaVersion.id,
    numero: nuevaVersion.numero,
    nombre: nuevaVersion.nombre,
    creadoEn: nuevaVersion.creado_en,
    esActual: true,
  }
}
//Funcion para borrar presupuesto en descartar
export async function EliminarPresupuesto(presupuestoId: string){
  const supabase = await createClient()

  //const versionActualId = await obtenerOCrearVersionActual(supabase, presupuestoId)

  const {error: errorBorrar}=await supabase
    .from("presupuestos")
    .delete()
    .eq("id",presupuestoId)

  if (errorBorrar) {
    throw new Error(errorBorrar.message)
  }




}
export async function actualizarEstadoPresupuesto(
  presupuestoId: string,
  nuevoEstado: "Borrador" | "En ejecucion" | "Con movimientos"
) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("presupuestos")
    .update({ estado: nuevoEstado })
    .eq("id", presupuestoId)

  if (error) {
    throw new Error(error.message)
  }
}

export async function cargarVersion(versionId: string): Promise<ItemPresupuesto[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("presupuesto_items")
    .select(
      "id, padre_id, nivel, codigo, descripcion, unidad, cantidad, valor_unitario, valor_total, apu_id, precio_original"
    )
    .eq("version_id", versionId)

  if (error) {
    throw new Error(error.message)
  }

  const items: ItemPresupuesto[] = (data ?? []).map((r) => ({
    id: r.id,
    padreId: r.padre_id,
    nivel: r.nivel,
    codigo: r.codigo,
    descripcion: r.descripcion,
    unidad: r.unidad,
    cantidad: r.cantidad,
    valorUnitario: r.valor_unitario,
    valorTotal: r.valor_total,
    apuId: r.apu_id,
    precioOriginal: r.precio_original,
    guardado: true,
  }))

  return ordenarJerarquicamente(items)
}

export async function AñadirItemPresuouesto(
  presupuestoId: string,
  items: ItemPresupuestoInput[]
) {
  const supabase = await createClient()

  const versionActualId = await obtenerOCrearVersionActual(supabase, presupuestoId)

  const filas = items.map((item) => ({
    id: item.id,
    presupuesto_id: presupuestoId,
    version_id: versionActualId,
    padre_id: item.padreId,
    nivel: item.nivel,
    codigo: item.codigo,
    descripcion: item.descripcion,
    unidad: item.unidad,
    cantidad: item.cantidad ?? null,
    valor_unitario: item.valorUnitario ?? null,
    valor_total:
      item.cantidad != null && item.valorUnitario != null
        ? item.cantidad * item.valorUnitario
        : null,
    apu_id: item.apuId ?? null,
    precio_original: item.precioOriginal ?? null,
  }))

  const { error } = await supabase.from("presupuesto_items").insert(filas)

  if (error) {
    throw new Error(error.message)
  }

  return filas.length
}

export async function actualizarCantidadPresupuestoItem(
  id: string,
  nuevaCantidad: number
): Promise<{ cantidad: number; valorTotal: number | null }> {
  const supabase = await createClient()

  const { data: actual, error: errorLectura } = await supabase
    .from("presupuesto_items")
    .select("valor_unitario")
    .eq("id", id)
    .single()

  if (errorLectura) {
    throw new Error(errorLectura.message)
  }

  const valorTotal =
    actual.valor_unitario != null ? nuevaCantidad * actual.valor_unitario : null

  const { error } = await supabase
    .from("presupuesto_items")
    .update({ cantidad: nuevaCantidad, valor_total: valorTotal })
    .eq("id", id)

  if (error) {
    throw new Error(error.message)
  }

  return { cantidad: nuevaCantidad, valorTotal }
}

export type InsumoSugerido = {
  id: string
  codigo: number
  descripcion: string
  u_m: string | null
  tipo: string | null
  vr_unitario: number | null
}

export async function buscarInsumos(
  termino: string,
  tipos?: string[]
): Promise<InsumoSugerido[]> {
  if (!termino || termino.trim().length < 2) return []

  const supabase = await createClient()

  let query = supabase
    .from("maestro_insumos")
    .select("id, codigo, descripcion, u_m, tipo, vr_unitario")
    .ilike("descripcion", `%${termino.trim()}%`)
    .order("descripcion")
    .limit(15)

  if (tipos && tipos.length > 0) {
    query = query.in("tipo", tipos)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
}

export type InsumoSimilar = InsumoSugerido & {
  similitud: number
  medidaDistinta: boolean
  unidadDistinta: boolean
}

export async function buscarInsumosSimilares(
  termino: string,
  umbral = 0.4,
  tipos?: string[]
): Promise<InsumoSimilar[]> {
  if (!termino || termino.trim().length < 2) return []

  const supabase = await createClient()

  const { data, error } = await supabase.rpc("buscar_insumos_candidatos", {
    p_termino: termino.trim(),
    p_tipos: tipos && tipos.length > 0 ? tipos : null,
    // Antes 300 -- el RPC ya ordena por distancia de trigram
    // (order by descripcion <-> p_termino), así que el candidato
    // correcto virtualmente siempre está entre los primeros 50. Bajar
    // esto corta ~6x el trabajo de buscarSimilares() más abajo (TF-IDF +
    // Jaccard + Levenshtein sobre CADA candidato) -- ese cálculo es puro
    // JavaScript en un solo hilo, y era el cuello de botella real en
    // presupuestos grandes (import lento incluso después de optimizar
    // las idas y vueltas a la base de datos).
    p_limite: 50,
  })

  if (error) {
    throw new Error(error.message)
  }

  const filas: any[] = data ?? []
  const candidatos = filas.map((f: any) => ({ id: f.id, texto: f.descripcion, unidad: f.u_m }))

  const resultados = buscarSimilares(termino, null, candidatos, { top: 5, umbral })

  const porId = new Map(filas.map((f: any) => [f.id, f]))
  return resultados
    .map((r) => {
      const fila = porId.get(r.candidato.id)
      return fila
        ? {
            ...fila,
            similitud: r.score,
            medidaDistinta: r.detalle.medidaDistinta,
            unidadDistinta: r.detalle.unidadDistinta,
          }
        : null
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
}

export type SolicitudInsumoInput = {
  descripcion: string
  tipo?: string | null
  uM?: string | null
  agrupacion?: string | null
  presupuestoItemId?: string | null
}

/**
 * Busca CATEGORÍAS de mano de obra parecidas al nombre de un ÍTEM del
 * presupuesto -- NO se usa para líneas de insumo/equipo/transporte, ni
 * la consulta es el texto de la línea de mano de obra del Excel
 * ("Cuadrilla AA-4"). Reusa el mismo motor de similitud
 * (buscarSimilares) contra un catálogo distinto (mano_obra_categorias
 * en vez de maestro_insumos).
 */
export async function buscarManoObraSimilares(nombreItem: string): Promise<CategoriaManoObra[]> {
  if (!nombreItem || nombreItem.trim().length < 2) return []

  const supabase = await createClient()

  const { data, error } = await supabase.rpc("buscar_mano_obra_candidatos", {
    p_termino: nombreItem.trim(),
    p_limite: 50,
  })

  if (error) {
    throw new Error(error.message)
  }

  const filas: any[] = data ?? []
  const candidatos = filas.map((f: any) => ({ id: f.id, texto: f.categoria, unidad: f.unidad }))

  // umbral más bajo que el de insumos (0.4) A PROPÓSITO -- acá NUNCA hay
  // auto_match (decisión de negocio), así que no hay riesgo de asignar
  // algo mal solo. Con un umbral más laxo se le muestran al ingeniero
  // más opciones "en el vecindario" para elegir, en vez de arriesgarse a
  // devolver 0 candidatos en categorías nuevas/poco pobladas del
  // catálogo (que es chico -- ~74 categorías vs. ~5.270 insumos).
  const resultados = buscarSimilares(nombreItem, null, candidatos, { top: 8, umbral: 0.25 })

  const porId = new Map(filas.map((f: any) => [f.id, f]))
  return resultados
    .map((r) => {
      const fila = porId.get(r.candidato.id)
      return fila
        ? {
            id: fila.id,
            grupo: fila.grupo,
            categoria: fila.categoria,
            unidad: fila.unidad,
            valorUnitario: fila.valor_unitario,
            similitud: r.score,
          }
        : null
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
}

export async function crearSolicitudInsumo(input: SolicitudInsumoInput) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from("solicitudes_insumos")
    .insert({
      descripcion: input.descripcion,
      tipo: input.tipo ?? null,
      u_m: input.uM ?? null,
      agrupacion: input.agrupacion ?? null,
      solicitado_por: user?.id ?? null,
      presupuesto_item_id: input.presupuestoItemId ?? null,
      estado: "pendiente",
    })
    .select()
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export type SolicitudInsumo = {
  id: string
  descripcion: string
  tipo: string | null
  uM: string | null
  agrupacion: string | null
  solicitadoPor: string | null
  solicitadoPorNombre: string | null
  presupuestoItemId: string | null
  itemCodigo: string | null
  itemDescripcion: string | null
  proyectoNombre: string | null
  estado: "pendiente" | "aprobado" | "rechazado"
  createdAt: string
  codigoMaestroAsignado: number | null
  resueltoAt: string | null
  resueltoPor: string | null
  resueltoPorNombre: string | null
  motivoRechazo: string | null
}

export async function listarSolicitudesInsumos(
  estado: "pendiente" | "aprobado" | "rechazado" = "pendiente"
): Promise<SolicitudInsumo[]> {
  await requerirScope("admin_insumos")
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("solicitudes_insumos")
    .select(
      `
      id, descripcion, tipo, u_m, agrupacion, solicitado_por,
      presupuesto_item_id, estado, created_at,
      codigo_maestro_asignado, resuelto_at, resuelto_por, motivo_rechazo,
      presupuesto_items:presupuesto_item_id (
        codigo, descripcion,
        presupuestos:presupuesto_id (
          proyectos:proyecto_id (nombre)
        )
      )
    `
    )
    .eq("estado", estado)
    .order("created_at", { ascending: estado === "pendiente" })

  if (error) {
    throw new Error(error.message)
  }

  const filas = data ?? []

  const idsPersonas = [
    ...new Set(
      filas
        .flatMap((f) => [f.solicitado_por, f.resuelto_por])
        .filter((id): id is string => Boolean(id))
    ),
  ]

  const nombrePorId = new Map<string, string>()
  if (idsPersonas.length > 0) {
    const { data: perfiles, error: errorPerfiles } = await supabase
      .from("perfiles")
      .select("id, nombre")
      .in("id", idsPersonas)

    if (errorPerfiles) {
      throw new Error(errorPerfiles.message)
    }

    for (const p of perfiles ?? []) {
      nombrePorId.set(p.id, p.nombre)
    }
  }

  return filas.map((r: any) => ({
    id: r.id,
    descripcion: r.descripcion,
    tipo: r.tipo,
    uM: r.u_m,
    agrupacion: r.agrupacion,
    solicitadoPor: r.solicitado_por,
    solicitadoPorNombre: r.solicitado_por ? nombrePorId.get(r.solicitado_por) ?? null : null,
    presupuestoItemId: r.presupuesto_item_id,
    itemCodigo: r.presupuesto_items?.codigo ?? null,
    itemDescripcion: r.presupuesto_items?.descripcion ?? null,
    proyectoNombre: r.presupuesto_items?.presupuestos?.proyectos?.nombre ?? null,
    estado: r.estado,
    createdAt: r.created_at,
    codigoMaestroAsignado: r.codigo_maestro_asignado,
    resueltoAt: r.resuelto_at,
    resueltoPor: r.resuelto_por,
    resueltoPorNombre: r.resuelto_por ? nombrePorId.get(r.resuelto_por) ?? null : null,
    motivoRechazo: r.motivo_rechazo ?? null,
  }))
}

export type AprobarSolicitudInput = {
  solicitudId: string
  vrUnitario: number
  tipo?: string
  uM?: string | null
  agrupacion?: string | null
}

export async function aprobarSolicitudInsumo(
  input: AprobarSolicitudInput
): Promise<InsumoSugerido> {
  await requerirScope("admin_insumos")
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (input.vrUnitario == null || PRECIOS_PLACEHOLDER.includes(input.vrUnitario) || input.vrUnitario <= 0) {
    throw new Error("La solicitud necesita un precio real -- no puede quedar en 0 ni vacío.")
  }

  const { data: solicitud, error: errorLectura } = await supabase
    .from("solicitudes_insumos")
    .select("id, descripcion, tipo, u_m, agrupacion, presupuesto_item_id, estado")
    .eq("id", input.solicitudId)
    .single()

  if (errorLectura) {
    throw new Error(errorLectura.message)
  }

  if (solicitud.estado !== "pendiente") {
    throw new Error("Esta solicitud ya fue resuelta.")
  }

  const tipoFinal = input.tipo ?? solicitud.tipo
  if (!tipoFinal) {
    throw new Error("Falta el tipo del insumo -- elígelo antes de aprobar.")
  }

  const { data: insumoNuevo, error: errorInsumo } = await supabase
    .from("maestro_insumos")
    .insert({
      descripcion: solicitud.descripcion,
      tipo: tipoFinal,
      vr_unitario: input.vrUnitario,
      vr_neto: input.vrUnitario,
      u_m: input.uM ?? solicitud.u_m,
      agrupacion: input.agrupacion ?? solicitud.agrupacion,
    })
    .select("id, codigo, descripcion, u_m, tipo, vr_unitario")
    .single()

  if (errorInsumo) {
    throw new Error(errorInsumo.message)
  }

  const { error: errorUpdate } = await supabase
    .from("solicitudes_insumos")
    .update({
      estado: "aprobado",
      codigo_maestro_asignado: insumoNuevo.codigo,
      resuelto_at: new Date().toISOString(),
      resuelto_por: user?.id ?? null,
    })
    .eq("id", input.solicitudId)

  if (errorUpdate) {
    throw new Error(errorUpdate.message)
  }

  // El UPDATE de arriba ya disparó el trigger sincronizar_apu_import_revision
  // -- si esta solicitud vino de un import (tiene alguna fila en
  // apu_import_revision), el trigger YA agregó el insumo a item_apu con
  // la CANTIDAD REAL del import y recalculó el valor. No hay que
  // duplicarlo acá con el 1 fijo -- ese 1 fijo solo aplica al flujo
  // manual de siempre (solicitud creada desde el editor de APU, sin
  // pasar por un import).
  const { data: filasDeImport } = await supabase
    .from("apu_import_revision")
    .select("id")
    .eq("solicitud_id", input.solicitudId)
    .limit(1)

  const vieneDeImport = (filasDeImport?.length ?? 0) > 0

  if (!vieneDeImport && solicitud.presupuesto_item_id) {
    const { data: item, error: errorItem } = await supabase
      .from("presupuesto_items")
      .select("apu_id")
      .eq("id", solicitud.presupuesto_item_id)
      .maybeSingle()

    if (!errorItem && item?.apu_id) {
      await supabase.from("item_apu").insert({
        apu_id: item.apu_id,
        insumo_id: insumoNuevo.id,
        cantidad: 1,
        rendimiento: 1,
        tipo: tipoFinal,
      })

      await supabase.rpc("recalcular_valor_apu", { p_apu_id: item.apu_id })
    }
  }

  return insumoNuevo
}

export async function rechazarSolicitudInsumo(solicitudId: string, motivo?: string) {
  await requerirScope("admin_insumos")
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Antes este `motivo` se recibía pero nunca se guardaba en ningún lado
  // -- ahora sí, en solicitudes_insumos.motivo_rechazo. La tabla del
  // presupuesto lo muestra para los ítems en rojo (rechazado), para que
  // el ingeniero sepa qué corregir sin tener que ir a /admin-insumos a
  // buscarlo.
  const { error } = await supabase
    .from("solicitudes_insumos")
    .update({
      estado: "rechazado",
      motivo_rechazo: motivo ?? null,
      resuelto_at: new Date().toISOString(),
      resuelto_por: user?.id ?? null,
    })
    .eq("id", solicitudId)

  if (error) {
    throw new Error(error.message)
  }
}

const PRECIOS_PLACEHOLDER = [0, 1]

export type ItemApu = {
  id: string
  insumoId: string | null
  manoObraCategoriaId: string | null
  codigo: number | null
  descripcion: string
  uM: string | null
  vrUnitario: number | null
  cantidad: number
  rendimiento: number
  tipo: string | null
}

export type ApuDeItem = {
  id: string
  codigo: string | null
  descripcion: string | null
  items: ItemApu[]
  usos: number
}

function mapearApu(fila: any, usos: number): ApuDeItem {
  const itemsCrudos: any[] = fila.item_apu ?? []

  // Necesario ANTES del map principal -- "Herramienta menor X%" se
  // calcula sobre el subtotal de mano de obra del MISMO apu (mismo
  // criterio que recalcular_valor_apu en la base), así que hay que
  // sumar las líneas de mano de obra primero para poder mostrarle un
  // valor real a las líneas de herramienta menor.
  //
  // OJO: mano de obra NO multiplica por nada de item_apu -- el valor de
  // la categoría YA ES el precio por unidad del ÍTEM del presupuesto
  // (ej. $15.816 por lavaplatos desmontado), no algo que haya que
  // escalar por la cantidad/rendimiento que traía la línea vieja del
  // Excel detallado. Mismo criterio que recalcular_valor_apu.
  const subtotalManoObra = itemsCrudos.reduce((acc, it) => {
    if (!it.mano_obra_categoria_id || !it.mano_obra_categorias) return acc
    return acc + Number(it.mano_obra_categorias.valor_unitario ?? 0)
  }, 0)

  return {
    id: fila.id,
    codigo: fila.codigo,
    descripcion: fila.descripcion,
    usos,
    items: itemsCrudos.map((it: any) => {
      // Una línea es de insumo, de mano de obra, O de "herramienta
      // menor" (% de mano de obra) -- nunca dos de las tres (mismo
      // check constraint de la base). "categoria" hace de descripción
      // para mano de obra; para herramienta menor no hay fila de
      // catálogo, se arma la descripción con el porcentaje guardado.
      const insumo = it.maestro_insumos
      const manoObra = it.mano_obra_categorias

      if (it.porcentaje_mano_obra != null) {
        const valorLinea = (Number(it.porcentaje_mano_obra) / 100) * subtotalManoObra
        return {
          id: it.id,
          insumoId: null,
          manoObraCategoriaId: null,
          codigo: null,
          descripcion: `Herramienta menor (${it.porcentaje_mano_obra}% de mano de obra)`,
          uM: null,
          // cantidad/rendimiento se muestran en 1 a propósito -- el
          // valor real NO depende de la cantidad/rendimiento originales
          // del Excel (se ignoran, ver recalcular_valor_apu), así que
          // 1×1×valorLinea reproduce el total correcto en cualquier UI
          // genérica que multiplique esas 3 columnas, sin necesitar un
          // caso especial en la pantalla del editor.
          vrUnitario: valorLinea,
          cantidad: 1,
          rendimiento: 1,
          tipo: it.tipo ?? "EQUIPO",
        }
      }

      return {
        id: it.id,
        insumoId: it.insumo_id,
        manoObraCategoriaId: it.mano_obra_categoria_id,
        codigo: insumo?.codigo ?? null,
        descripcion: insumo?.descripcion ?? manoObra?.categoria ?? "",
        uM: insumo?.u_m ?? manoObra?.unidad ?? null,
        vrUnitario: insumo?.vr_unitario ?? manoObra?.valor_unitario ?? null,
        // Para mano de obra, cantidad/rendimiento se muestran en 1 --
        // igual que arriba con herramienta menor, el valor real NO
        // depende de la cantidad/rendimiento que traía la línea vieja
        // del Excel detallado (se ignoran, ver recalcular_valor_apu).
        // Mostrar el 1.22 original ahí sería engañoso -- parecería que
        // participa en el cálculo cuando no es así.
        cantidad: manoObra ? 1 : Number(it.cantidad),
        rendimiento: manoObra ? 1 : Number(it.rendimiento ?? 1),
        tipo: insumo?.tipo ?? it.tipo ?? null,
      }
    }),
  }
}

const SELECT_APU =
  "id, codigo, descripcion, item_apu(id, insumo_id, mano_obra_categoria_id, porcentaje_mano_obra, cantidad, rendimiento, tipo, maestro_insumos(codigo, descripcion, u_m, tipo, vr_unitario), mano_obra_categorias(categoria, grupo, unidad, valor_unitario))"

async function contarUsosDeApu(apuId: string): Promise<number> {
  const supabase = await createClient()
  const { count, error } = await supabase
    .from("presupuesto_items")
    .select("id", { count: "exact", head: true })
    .eq("apu_id", apuId)

  if (error) {
    throw new Error(error.message)
  }
  return count ?? 0
}

export async function previsualizarApu(apuId: string): Promise<ApuDeItem> {
  const supabase = await createClient()

  const { data: apuRow, error } = await supabase
    .from("apu")
    .select(SELECT_APU)
    .eq("id", apuId)
    .single()

  if (error) {
    throw new Error(error.message)
  }

  const usos = await contarUsosDeApu(apuId)
  return mapearApu(apuRow, usos)
}

export type LineaApuExport = {
  itemApuId: string
  tipo: string | null
  codigoInsumo: number
  descripcionInsumo: string
  unidad: string | null
  cantidad: number
  rendimiento: number
  valorUnitario: number | null
  parcial: number
}

export type ApuExport = {
  apuId: string
  codigoApu: string | null
  descripcionApu: string | null
  lineas: LineaApuExport[]
  precioUnitario: number
}

export async function obtenerApusParaExportar(apuIds: string[]): Promise<ApuExport[]> {
  if (apuIds.length === 0) return []

  const supabase = await createClient()

  // ver seleccionarEnLotesPorIds -- con un presupuesto grande, apuIds
  // puede tener cientos de valores.
  const data = await seleccionarEnLotesPorIds(apuIds, 200, async (lote) => {
    const { data, error } = await supabase
      .from("apu")
      .select(
        `
      id,
      codigo,
      descripcion,
      item_apu(
        id,
        cantidad,
        rendimiento,
        tipo,
        insumo_id,
        mano_obra_categoria_id,
        porcentaje_mano_obra,
        maestro_insumos(codigo, descripcion, u_m, vr_unitario, tipo),
        mano_obra_categorias(categoria, grupo, unidad, valor_unitario)
      )
    `
      )
      .in("id", lote)

    if (error) throw new Error(error.message)
    return data ?? []
  })

  return (data ?? []).map((apu: any) => {
    const itemsCrudos: any[] = apu.item_apu ?? []

    // Igual que en mapearApu -- "Herramienta menor X%" necesita el
    // subtotal de mano de obra del mismo apu calculado ANTES, para
    // poder mostrar un valor real en el Excel exportado. El valor de la
    // categoría YA ES el precio por unidad del ítem -- no se multiplica
    // por nada de item_apu, mismo criterio que recalcular_valor_apu.
    const subtotalManoObra = itemsCrudos.reduce((acc, it) => {
      if (!it.mano_obra_categoria_id || !it.mano_obra_categorias) return acc
      return acc + Number(it.mano_obra_categorias.valor_unitario ?? 0)
    }, 0)

    const lineas: LineaApuExport[] = itemsCrudos.map((item: any) => {
      const insumo = item.maestro_insumos
      const manoObra = item.mano_obra_categorias

      if (item.porcentaje_mano_obra != null) {
        const valorLinea = (Number(item.porcentaje_mano_obra) / 100) * subtotalManoObra
        return {
          itemApuId: item.id,
          tipo: item.tipo ?? "EQUIPO",
          codigoInsumo: 0,
          descripcionInsumo: `Herramienta menor (${item.porcentaje_mano_obra}% de mano de obra)`,
          unidad: null,
          cantidad: 1,
          rendimiento: 1,
          valorUnitario: valorLinea,
          parcial: valorLinea,
        }
      }

      // Mano de obra: cantidad/rendimiento se exportan en 1 -- el valor
      // real no depende de lo que traía la línea vieja del Excel
      // detallado, mostrar ese número ahí sería engañoso.
      const cantidad = manoObra ? 1 : Number(item.cantidad ?? 0)
      const rendimiento = manoObra ? 1 : Number(item.rendimiento ?? 1)
      const valorUnitario =
        insumo?.vr_unitario != null
          ? Number(insumo.vr_unitario)
          : manoObra?.valor_unitario != null
            ? Number(manoObra.valor_unitario)
            : null

      return {
        itemApuId: item.id,
        tipo: insumo?.tipo ?? item.tipo ?? null,
        codigoInsumo: Number(insumo?.codigo ?? 0),
        descripcionInsumo: insumo?.descripcion ?? manoObra?.categoria ?? "",
        unidad: insumo?.u_m ?? manoObra?.unidad ?? null,
        cantidad,
        rendimiento,
        valorUnitario,
        parcial: valorUnitario != null ? cantidad * rendimiento * valorUnitario : 0,
      }
    })

    return {
      apuId: apu.id,
      codigoApu: apu.codigo,
      descripcionApu: apu.descripcion,
      lineas,
      precioUnitario: lineas.reduce((acc, l) => acc + l.parcial, 0),
    }
  })
}

export async function obtenerApuDeItem(presupuestoItemId: string): Promise<ApuDeItem | null> {
  const supabase = await createClient()

  const { data: item, error: errorItem } = await supabase
    .from("presupuesto_items")
    .select("apu_id")
    .eq("id", presupuestoItemId)
    .single()

  if (errorItem) {
    throw new Error(errorItem.message)
  }

  if (!item.apu_id) {
    return null
  }

  const { data: apuRow, error } = await supabase
    .from("apu")
    .select(SELECT_APU)
    .eq("id", item.apu_id)
    .single()

  if (error) {
    throw new Error(error.message)
  }

  const usos = await contarUsosDeApu(item.apu_id)
  return mapearApu(apuRow, usos)
}

export async function crearApuParaItem(
  presupuestoItemId: string,
  codigo: string,
  descripcion: string
): Promise<ApuDeItem> {
  const supabase = await createClient()

  const { data: creado, error: errorCreacion } = await supabase
    .from("apu")
    .insert({ codigo, descripcion })
    .select(SELECT_APU)
    .single()

  if (errorCreacion) {
    throw new Error(errorCreacion.message)
  }

  const { error: errorLink } = await supabase
    .from("presupuesto_items")
    .update({ apu_id: creado.id })
    .eq("id", presupuestoItemId)

  if (errorLink) {
    throw new Error(errorLink.message)
  }

  return mapearApu(creado, 1)
}

export async function copiarApuParaItem(
  apuOrigenId: string,
  presupuestoItemId: string,
  codigo: string,
  descripcion: string
): Promise<ApuDeItem> {
  const supabase = await createClient()

  const { data: origen, error: errorOrigen } = await supabase
    .from("apu")
    .select("item_apu(insumo_id, cantidad, rendimiento, tipo)")
    .eq("id", apuOrigenId)
    .single()

  if (errorOrigen) {
    throw new Error(errorOrigen.message)
  }

  const { data: nuevoApu, error: errorCreacion } = await supabase
    .from("apu")
    .insert({ codigo, descripcion })
    .select("id")
    .single()

  if (errorCreacion) {
    throw new Error(errorCreacion.message)
  }

  const lineasOrigen = origen.item_apu ?? []
  if (lineasOrigen.length > 0) {
    const copias = lineasOrigen.map((it: any) => ({
      apu_id: nuevoApu.id,
      insumo_id: it.insumo_id,
      cantidad: it.cantidad,
      rendimiento: it.rendimiento ?? 1,
      tipo: it.tipo,
    }))

    const { error: errorCopia } = await supabase.from("item_apu").insert(copias)
    if (errorCopia) {
      throw new Error(errorCopia.message)
    }
  }

  const { error: errorLink } = await supabase
    .from("presupuesto_items")
    .update({ apu_id: nuevoApu.id })
    .eq("id", presupuestoItemId)

  if (errorLink) {
    throw new Error(errorLink.message)
  }

  await recalcularValorItemDesdeApu(presupuestoItemId)

  const apu = await obtenerApuDeItem(presupuestoItemId)
  if (!apu) {
    throw new Error("No se pudo copiar el APU.")
  }
  return apu
}

export async function crearApuStandalone(codigo: string, descripcion: string): Promise<ApuDeItem> {
  const supabase = await createClient()

  const { data: creado, error } = await supabase
    .from("apu")
    .insert({ codigo, descripcion })
    .select(SELECT_APU)
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return mapearApu(creado, 0)
}

export async function copiarApuStandalone(
  apuOrigenId: string,
  codigo: string,
  descripcion: string
): Promise<ApuDeItem> {
  const supabase = await createClient()

  const { data: origen, error: errorOrigen } = await supabase
    .from("apu")
    .select("item_apu(insumo_id, cantidad, rendimiento, tipo)")
    .eq("id", apuOrigenId)
    .single()

  if (errorOrigen) {
    throw new Error(errorOrigen.message)
  }

  const { data: nuevoApu, error: errorCreacion } = await supabase
    .from("apu")
    .insert({ codigo, descripcion })
    .select(SELECT_APU)
    .single()

  if (errorCreacion) {
    throw new Error(errorCreacion.message)
  }

  const lineasOrigen = origen.item_apu ?? []
  if (lineasOrigen.length > 0) {
    const copias = lineasOrigen.map((it: any) => ({
      apu_id: nuevoApu.id,
      insumo_id: it.insumo_id,
      cantidad: it.cantidad,
      rendimiento: it.rendimiento ?? 1,
      tipo: it.tipo,
    }))

    const { error: errorCopia } = await supabase.from("item_apu").insert(copias)
    if (errorCopia) {
      throw new Error(errorCopia.message)
    }
  }

  return previsualizarApu(nuevoApu.id)
}

export type ApuSimilar = {
  apuId: string
  descripcion: string
  codigo: string
  usos: number
  valorUnitario: number | null
  similitud: number
  medidaDistinta: boolean
  unidadDistinta: boolean
  copiasIdenticas: number
}

export async function buscarApusSimilares(
  descripcion: string,
  excluirItemId: string,
  umbral = 0.4
): Promise<ApuSimilar[]> {
  if (!descripcion || descripcion.trim().length < 2) return []

  const supabase = await createClient()

  const { data, error } = await supabase.rpc("buscar_items_apu_candidatos", {
    p_termino: descripcion.trim(),
    p_limite: 300,
  })

  if (error) {
    throw new Error(error.message)
  }

  const filas = (data ?? []).filter((r: any) => r.id !== excluirItemId && r.apu_id)

  const porApu = new Map<string, (typeof filas)[number][]>()
  for (const fila of filas) {
    const lista = porApu.get(fila.apu_id as string) ?? []
    lista.push(fila)
    porApu.set(fila.apu_id as string, lista)
  }

  const apuIds = [...porApu.keys()]

  const { data: lineasTodas, error: errorLineas } = await supabase
    .from("item_apu")
    .select("apu_id, insumo_id, cantidad")
    .in("apu_id", apuIds)

  if (errorLineas) {
    throw new Error(errorLineas.message)
  }

  const lineasPorApu = new Map<string, { insumo_id: string; cantidad: number }[]>()
  for (const linea of lineasTodas ?? []) {
    const lista = lineasPorApu.get(linea.apu_id) ?? []
    lista.push({ insumo_id: linea.insumo_id, cantidad: Number(linea.cantidad) })
    lineasPorApu.set(linea.apu_id, lista)
  }

  function firmaContenido(apuId: string): string {
    const lineas = lineasPorApu.get(apuId) ?? []
    return lineas
      .map((l) => `${l.insumo_id}:${l.cantidad}`)
      .sort()
      .join("|")
  }

  const porFirma = new Map<string, string[]>()
  for (const apuId of apuIds) {
    const firma = firmaContenido(apuId)
    const lista = porFirma.get(firma) ?? []
    lista.push(apuId)
    porFirma.set(firma, lista)
  }

  const candidatos: {
    id: string
    texto: string
    unidad: string | null
    usos: number
    codigo: string
    valorUnitario: number | null
    copiasIdenticas: number
  }[] = []

  for (const [, gruposApuIds] of porFirma) {
    const ordenados = [...gruposApuIds].sort(
      (a, b) => (porApu.get(b)?.length ?? 0) - (porApu.get(a)?.length ?? 0)
    )
    const representanteId = ordenados[0]
    const items = porApu.get(representanteId)!
    const usosTotales = gruposApuIds.reduce((acc, id) => acc + (porApu.get(id)?.length ?? 0), 0)

    candidatos.push({
      id: representanteId,
      texto: items[0].descripcion,
      unidad: items[0].unidad,
      usos: usosTotales,
      codigo: items[0].codigo,
      valorUnitario: items[0].valor_unitario,
      copiasIdenticas: gruposApuIds.length,
    })
  }

  const resultados = buscarSimilares(descripcion, null, candidatos, { top: 5, umbral })

  return resultados.map((r) => ({
    apuId: r.candidato.id,
    descripcion: r.candidato.texto,
    codigo: r.candidato.codigo,
    usos: r.candidato.usos,
    valorUnitario: r.candidato.valorUnitario,
    similitud: r.score,
    medidaDistinta: r.detalle.medidaDistinta,
    unidadDistinta: r.detalle.unidadDistinta,
    copiasIdenticas: r.candidato.copiasIdenticas,
  }))
}

export async function agregarInsumoApu(input: {
  apuId: string
  insumoId: string
  cantidad: number
  rendimiento?: number
}) {
  const supabase = await createClient()

  const { data: insumo, error: errorInsumo } = await supabase
    .from("maestro_insumos")
    .select("vr_unitario, tipo")
    .eq("id", input.insumoId)
    .single()

  if (errorInsumo) {
    throw new Error(errorInsumo.message)
  }

  if (insumo.vr_unitario == null || PRECIOS_PLACEHOLDER.includes(insumo.vr_unitario)) {
    throw new Error(
      "Este insumo todavía no tiene precio real -- ingresa el precio antes de agregarlo."
    )
  }

  const { error } = await supabase.from("item_apu").insert({
    apu_id: input.apuId,
    insumo_id: input.insumoId,
    cantidad: input.cantidad,
    rendimiento: input.rendimiento ?? 1,
    tipo: insumo.tipo,
  })

  if (error) {
    throw new Error(error.message)
  }
}

/**
 * Análoga a agregarInsumoApu, pero para una línea de mano de obra --
 * inserta con mano_obra_categoria_id en vez de insumo_id. Valida que la
 * categoría ya tenga precio definido (mismo criterio que el precio
 * placeholder de insumos: una categoría sin precio no se puede asignar
 * todavía).
 */
export async function agregarManoObraApu(input: {
  apuId: string
  manoObraCategoriaId: string
  cantidad: number
  rendimiento?: number
}) {
  const supabase = await createClient()

  const { data: categoria, error: errorCategoria } = await supabase
    .from("mano_obra_categorias")
    .select("valor_unitario")
    .eq("id", input.manoObraCategoriaId)
    .single()

  if (errorCategoria) {
    throw new Error(errorCategoria.message)
  }

  if (categoria.valor_unitario == null) {
    throw new Error(
      "Esta categoría de mano de obra todavía no tiene precio definido -- ingresa el valor en el catálogo antes de asignarla."
    )
  }

  const { error: errorInsert } = await supabase.from("item_apu").insert({
    apu_id: input.apuId,
    mano_obra_categoria_id: input.manoObraCategoriaId,
    cantidad: input.cantidad,
    rendimiento: input.rendimiento ?? 1,
    tipo: "MO",
  })

  if (errorInsert) {
    throw new Error(errorInsert.message)
  }
}

// ---------------------------------------------------------------------------
// Solicitudes de CATEGORÍA de mano de obra nueva -- mismo patrón que las
// solicitudes de insumo (crear/listar/aprobar/rechazar), pero contra
// mano_obra_categorias en vez de maestro_insumos, y resuelto por el
// scope admin_mano_obra (distinto de admin_insumos, a propósito).
// ---------------------------------------------------------------------------

export type SolicitudManoObraInput = {
  descripcion: string
  grupoSugerido?: string | null
  valorPropuesto?: number | null
  presupuestoItemId?: string | null
}

export async function crearSolicitudManoObra(input: SolicitudManoObraInput) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from("solicitudes_mano_obra")
    .insert({
      descripcion: input.descripcion,
      grupo_sugerido: input.grupoSugerido ?? null,
      valor_propuesto: input.valorPropuesto ?? null,
      solicitado_por: user?.id ?? null,
      presupuesto_item_id: input.presupuestoItemId ?? null,
      estado: "pendiente",
    })
    .select()
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export type SolicitudManoObra = {
  id: string
  descripcion: string
  grupoSugerido: string | null
  valorPropuesto: number | null
  solicitadoPor: string | null
  solicitadoPorNombre: string | null
  presupuestoItemId: string | null
  itemCodigo: string | null
  itemDescripcion: string | null
  proyectoNombre: string | null
  estado: "pendiente" | "aprobado" | "rechazado"
  createdAt: string
  categoriaAsignadaId: string | null
  resueltoAt: string | null
  resueltoPor: string | null
  resueltoPorNombre: string | null
  motivoRechazo: string | null
}

export async function listarSolicitudesManoObra(
  estado: "pendiente" | "aprobado" | "rechazado" = "pendiente"
): Promise<SolicitudManoObra[]> {
  await requerirScope("admin_mano_obra")
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("solicitudes_mano_obra")
    .select(
      `
      id, descripcion, grupo_sugerido, valor_propuesto, solicitado_por,
      presupuesto_item_id, estado, created_at,
      categoria_asignada_id, resuelto_at, resuelto_por, motivo_rechazo,
      presupuesto_items:presupuesto_item_id (
        codigo, descripcion,
        presupuestos:presupuesto_id (
          proyectos:proyecto_id (nombre)
        )
      )
    `
    )
    .eq("estado", estado)
    .order("created_at", { ascending: estado === "pendiente" })

  if (error) {
    throw new Error(error.message)
  }

  const filas = data ?? []

  const idsPersonas = [
    ...new Set(
      filas
        .flatMap((f: any) => [f.solicitado_por, f.resuelto_por])
        .filter((id): id is string => Boolean(id))
    ),
  ]

  const nombrePorId = new Map<string, string>()
  if (idsPersonas.length > 0) {
    const { data: perfiles, error: errorPerfiles } = await supabase
      .from("perfiles")
      .select("id, nombre")
      .in("id", idsPersonas)

    if (errorPerfiles) {
      throw new Error(errorPerfiles.message)
    }

    for (const p of perfiles ?? []) {
      nombrePorId.set(p.id, p.nombre)
    }
  }

  return filas.map((r: any) => ({
    id: r.id,
    descripcion: r.descripcion,
    grupoSugerido: r.grupo_sugerido,
    valorPropuesto: r.valor_propuesto,
    solicitadoPor: r.solicitado_por,
    solicitadoPorNombre: r.solicitado_por ? nombrePorId.get(r.solicitado_por) ?? null : null,
    presupuestoItemId: r.presupuesto_item_id,
    itemCodigo: r.presupuesto_items?.codigo ?? null,
    itemDescripcion: r.presupuesto_items?.descripcion ?? null,
    proyectoNombre: r.presupuesto_items?.presupuestos?.proyectos?.nombre ?? null,
    estado: r.estado,
    createdAt: r.created_at,
    categoriaAsignadaId: r.categoria_asignada_id,
    resueltoAt: r.resuelto_at,
    resueltoPor: r.resuelto_por,
    resueltoPorNombre: r.resuelto_por ? nombrePorId.get(r.resuelto_por) ?? null : null,
    motivoRechazo: r.motivo_rechazo ?? null,
  }))
}

export type AprobarSolicitudManoObraInput = {
  solicitudId: string
  valorUnitario: number
  grupo?: string | null
  unidad: string
}

export async function aprobarSolicitudManoObra(
  input: AprobarSolicitudManoObraInput
): Promise<{ id: string; categoria: string; grupo: string | null; valorUnitario: number; unidad: string }> {
  await requerirScope("admin_mano_obra")
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (input.valorUnitario == null || input.valorUnitario <= 0) {
    throw new Error("La solicitud necesita un valor real -- no puede quedar en 0 ni vacío.")
  }
  if (!input.unidad || !input.unidad.trim()) {
    throw new Error("Falta la unidad (M2, UN, ML...) -- es importante para saber cómo aplicar el valor.")
  }

  const { data: solicitud, error: errorLectura } = await supabase
    .from("solicitudes_mano_obra")
    .select("id, descripcion, grupo_sugerido, estado")
    .eq("id", input.solicitudId)
    .single()

  if (errorLectura) {
    throw new Error(errorLectura.message)
  }

  if (solicitud.estado !== "pendiente") {
    throw new Error("Esta solicitud ya fue resuelta.")
  }

  const { data: categoriaNueva, error: errorCategoria } = await supabase
    .from("mano_obra_categorias")
    .insert({
      categoria: solicitud.descripcion,
      grupo: input.grupo ?? solicitud.grupo_sugerido,
      valor_unitario: input.valorUnitario,
      unidad: input.unidad,
    })
    .select("id, categoria, grupo, valor_unitario, unidad")
    .single()

  if (errorCategoria) {
    throw new Error(errorCategoria.message)
  }

  const { error: errorUpdate } = await supabase
    .from("solicitudes_mano_obra")
    .update({
      estado: "aprobado",
      categoria_asignada_id: categoriaNueva.id,
      resuelto_at: new Date().toISOString(),
      resuelto_por: user?.id ?? null,
    })
    .eq("id", input.solicitudId)

  if (errorUpdate) {
    throw new Error(errorUpdate.message)
  }

  // El UPDATE de arriba ya disparó el trigger
  // sincronizar_apu_import_revision_mano_obra -- si esta solicitud vino
  // de un import, el trigger YA agregó la línea a item_apu y recalculó.
  // Si vino del flujo manual (editor de APU, sin import de por medio),
  // acá no hay nada más que hacer -- a diferencia de insumos, mano de
  // obra no tiene un flujo manual de "agregar directo" todavía (todo
  // pasa por el import o por esta solicitud).

  // categoriaNueva viene DIRECTO de Supabase, con el nombre de columna
  // tal cual (valor_unitario, snake_case) -- hay que mapearlo a la forma
  // que la función promete devolver (valorUnitario, camelCase), igual
  // que se hace en el resto del archivo. Devolver categoriaNueva tal
  // cual no calzaba con el tipo declarado.
  return {
    id: categoriaNueva.id,
    categoria: categoriaNueva.categoria,
    grupo: categoriaNueva.grupo,
    valorUnitario: categoriaNueva.valor_unitario,
    unidad: categoriaNueva.unidad,
  }
}

export async function rechazarSolicitudManoObra(solicitudId: string, motivo?: string) {
  await requerirScope("admin_mano_obra")
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { error } = await supabase
    .from("solicitudes_mano_obra")
    .update({
      estado: "rechazado",
      motivo_rechazo: motivo ?? null,
      resuelto_at: new Date().toISOString(),
      resuelto_por: user?.id ?? null,
    })
    .eq("id", solicitudId)

  if (error) {
    throw new Error(error.message)
  }
}

export async function eliminarInsumoApu(itemApuId: string) {
  const supabase = await createClient()
  const { error } = await supabase.from("item_apu").delete().eq("id", itemApuId)

  if (error) {
    throw new Error(error.message)
  }
}

export async function actualizarCantidadItemApu(itemApuId: string, nuevaCantidad: number) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("item_apu")
    .update({ cantidad: nuevaCantidad })
    .eq("id", itemApuId)

  if (error) {
    throw new Error(error.message)
  }
}

export async function actualizarRendimientoItemApu(
  itemApuId: string,
  nuevoRendimiento: number
) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("item_apu")
    .update({ rendimiento: nuevoRendimiento })
    .eq("id", itemApuId)

  if (error) {
    throw new Error(error.message)
  }
}

export type ValorRecalculado = { valorUnitario: number; valorTotal: number | null }

export async function recalcularValorItemDesdeApu(
  presupuestoItemId: string
): Promise<ValorRecalculado> {
  const supabase = await createClient()

  const { data: item, error: errorItem } = await supabase
    .from("presupuesto_items")
    .select("apu_id")
    .eq("id", presupuestoItemId)
    .single()

  if (errorItem) {
    throw new Error(errorItem.message)
  }

  if (!item.apu_id) {
    return { valorUnitario: 0, valorTotal: null }
  }

  const { error: errorRpc } = await supabase.rpc("recalcular_valor_apu", {
    p_apu_id: item.apu_id,
  })

  if (errorRpc) {
    throw new Error(errorRpc.message)
  }

  const { data: actualizado, error: errorLectura } = await supabase
    .from("presupuesto_items")
    .select("valor_unitario, valor_total")
    .eq("id", presupuestoItemId)
    .single()

  if (errorLectura) {
    throw new Error(errorLectura.message)
  }

  return {
    valorUnitario: actualizado.valor_unitario ?? 0,
    valorTotal: actualizado.valor_total,
  }
}
// ---------------------------------------------------------------------------
// Import de APU desde Excel (hoja "APU" de la plantilla) -- agregar esto al
// final de actions.ts. NO se reimplementa nada que ya exista: reusa
// crearApuParaItem, agregarInsumoApu, crearSolicitudInsumo y
// recalcularValorItemDesdeApu tal cual están arriba.
//
// IMPORTANTE (decisión de negocio, no técnica): este flujo YA NO
// recomienda APUs completos de otros ítems/proyectos. Se decidió que un
// APU "parecido" puede ser engañoso -- dos ítems con descripción casi
// idéntica pueden necesitar insumos de marca/especificación distinta
// según la entidad (ej. un "bombillo" puede exigir una marca puntual en
// un contrato y otra en otro). Por eso TODO se arma por matching de
// INSUMO individual contra el maestro, ítem por ítem, sin atajos de
// "copiar un APU entero". buscarApusSimilares/previsualizarApu (arriba)
// siguen existiendo para el editor manual de APU, pero este import ya no
// los llama para nada.
//
// Flujo:
//   1. matchearInsumosApuImport -- dedup + matching en lote de TODAS las
//      líneas de insumo de TODOS los ítems del Excel (no hay paso previo
//      de "¿hay un ítem parecido?").
//   2. El usuario revisa/aprueba los matches ambiguos.
//   3. Guardar: para cada ítem, crearApuParaItem + agregarInsumoApu por
//      línea (o crearSolicitudInsumo si no matcheó) +
//      recalcularValorItemDesdeApu -- desde el CLIENTE (page.tsx), sin
//      una mega-función "confirmarImportApu" que reimplemente inserts.
// ---------------------------------------------------------------------------

// LineaApuExcelInput, BloqueApuInput, ResolucionInsumo viven en
// lib/apu-import-types.ts (importados arriba) -- NO se declaran acá para
// que los archivos de cliente puedan importarlos sin arrastrar este
// archivo (y next/headers) a su bundle.

/**
 * Procesa `items` con concurrencia LIMITADA (máximo `tamanoLote` promesas
 * en vuelo a la vez) en vez de lanzar Promise.all sobre TODO de una.
 *
 * Por qué hace falta: con presupuestos grandes (600+ ítems, miles de
 * líneas de insumo), Promise.all sin límite agota el pool de conexiones
 * de Supabase de un solo golpe -- pasó en producción con un presupuesto
 * real ("Timed out acquiring connection from connection pool"), y cuando
 * eso pasa toda la función se cae, dejando cientos de líneas sin resolver
 * sin que el usuario se entere hasta guardar.
 */
async function procesarEnLotes<T, R>(
  items: T[],
  tamanoLote: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const resultados: R[] = []
  for (let i = 0; i < items.length; i += tamanoLote) {
    const lote = items.slice(i, i + tamanoLote)
    const resultadosLote = await Promise.all(lote.map(fn))
    resultados.push(...resultadosLote)
  }
  return resultados
}

/**
 * Para queries con `.in("columna", ids)` donde `ids` puede tener cientos
 * de valores (presupuestos grandes) -- un solo .in() con todo genera una
 * URL demasiado larga y Supabase la rechaza con "Bad Request" (pasó de
 * verdad con 712 ids). Corre la query en tandas SECUENCIALES (no en
 * paralelo como procesarEnLotes -- acá cada tanda ya es una sola query,
 * no hace falta paralelizar) y junta los resultados.
 */
async function seleccionarEnLotesPorIds<T>(
  ids: string[],
  tamanoLote: number,
  fn: (loteIds: string[]) => Promise<T[]>
): Promise<T[]> {
  const resultados: T[] = []
  for (let i = 0; i < ids.length; i += tamanoLote) {
    const lote = ids.slice(i, i + tamanoLote)
    resultados.push(...(await fn(lote)))
  }
  return resultados
}

const UMBRAL_AUTO_MATCH = 80 // 0-100, sobre el score de buscarInsumosSimilares

// "Herramienta menor X% M.O." NO es un insumo de catálogo -- es un cargo
// calculado como X% del subtotal de MANO DE OBRA del mismo APU (ya
// confirmado con la math real: 1.22 × $7.026 = $8.572, y $85.721 (mano
// de obra) × 10% = $8.572 -- exacto). Se detecta por texto, se extrae el
// porcentaje, y se guarda en item_apu.porcentaje_mano_obra -- la
// columna y el cálculo en recalcular_valor_apu YA estaban en la base
// antes de este cambio de código, solo faltaba que el import supiera
// reconocer la línea y usarla en vez de buscarla como insumo.
const REGEX_HERRAMIENTA_MENOR = /herramienta\s*menor/i
const REGEX_PORCENTAJE = /(\d+(?:[.,]\d+)?)\s*%/

function extraerPorcentajeHerramientaMenor(descripcion: string): number | null {
  if (!REGEX_HERRAMIENTA_MENOR.test(descripcion)) return null
  const match = descripcion.match(REGEX_PORCENTAJE)
  if (match) {
    const numero = parseFloat(match[1].replace(",", "."))
    if (!Number.isNaN(numero)) return numero
  }
  // "Herramienta menor" casi siempre es 10% en obras colombianas -- si
  // el texto no trae el número explícito (raro, pero pasa con typos del
  // Excel original), se asume 10 en vez de tratarla como un insumo
  // desconocido.
  return 10
}

/**
 * Dedup + matching en lote de TODAS las líneas de insumo de TODOS los
 * ítems del Excel -- ya no hay paso previo de "¿está en auto-escaneo?",
 * cada ítem con bloque de APU pasa por acá directo. Reusa
 * buscarInsumosSimilares (arriba) -- el motor de similitud real, no uno
 * nuevo.
 *
 * El Tipo del Excel (INSUMO/MO/EQUIPO/TRANSPORTE) YA NO se usa como
 * filtro de categoría -- se decidió que pesa demasiado (un Tipo mal
 * puesto en el Excel, o un insumo mal categorizado en el maestro,
 * dejaba la búsqueda sin candidatos). Se busca siempre en todo el
 * maestro por texto solamente.
 *
 * El dedup importa: la misma descripción de insumo puede repetirse en
 * decenas de ítems (ej. "Herramienta menor" en un capítulo típico
 * aparece 60+ veces) -- sin deduplicar, se llamaría a
 * buscarInsumosSimilares una vez POR LÍNEA, no una vez por descripción
 * única, multiplicando queries sin necesidad.
 *
 * Corre en lotes de 15 descripciones únicas a la vez (ver
 * procesarEnLotes) -- con presupuestos grandes puede haber miles de
 * descripciones únicas, y lanzarlas todas de una agota el pool de
 * conexiones (esto pasó de verdad, ver el comentario en procesarEnLotes).
 */
export async function matchearInsumosApuImport(
  bloques: BloqueApuInput[]
): Promise<ResolucionInsumo[]> {
  const unicas = new Map<string, string>() // clave normalizada -> descripción original
  for (const bloque of bloques) {
    for (const linea of bloque.lineas) {
      // Mano de obra NO pasa por acá -- se busca aparte, contra
      // mano_obra_categorias, usando el nombre del ÍTEM (no el texto de
      // esta línea) -- ver matchearManoDeObraApuImport más abajo.
      if (linea.tipo === "MO") continue
      // "Herramienta menor X%" tampoco -- no es un insumo, es un cargo
      // calculado como % de la mano de obra del mismo ítem (ver
      // extraerPorcentajeHerramientaMenor arriba). Buscarla en el
      // maestro no tiene sentido y podría auto-matchear mal contra un
      // insumo real que se llame parecido.
      if (extraerPorcentajeHerramientaMenor(linea.descripcion) !== null) continue
      const clave = linea.descripcion.trim().toLowerCase()
      if (!unicas.has(clave)) {
        unicas.set(clave, linea.descripcion)
      }
    }
  }

  return procesarEnLotes(Array.from(unicas.values()), 15, async (original) => {
    const candidatos = await buscarInsumosSimilares(original, 0.3)

    const mejor = candidatos[0]
    const tienePlaceholder =
      !!mejor && (mejor.vr_unitario == null || PRECIOS_PLACEHOLDER.includes(mejor.vr_unitario))
    const score = mejor ? Math.round(mejor.similitud * 100) : 0
    const esAutoMatch = !!mejor && score >= UMBRAL_AUTO_MATCH && !tienePlaceholder

    return {
      descripcionOriginal: original,
      estado: esAutoMatch ? "auto_match" : "requiere_revision",
      insumoIdAsignado: esAutoMatch ? mejor!.id : null,
      candidatosSugeridos: candidatos,
      precioPlaceholder: tienePlaceholder,
    }
  })
}

/**
 * Matching de mano de obra -- UNA búsqueda por ÍTEM (no por línea, no
 * por descripción única de línea) -- decisión de negocio: la mano de
 * obra se subcontrata por actividad, así que lo que importa es qué
 * ACTIVIDAD es el ítem completo, no el texto de "Cuadrilla AA-4". NUNCA
 * hay auto_match acá -- toda línea de mano de obra queda pendiente de
 * que el ingeniero confirme la categoría, sin excepción.
 */
export async function matchearManoDeObraApuImport(
  bloques: BloqueApuInput[]
): Promise<ResolucionManoObra[]> {
  const bloquesConManoObra = bloques.filter((b) => b.lineas.some((l) => l.tipo === "MO"))

  return procesarEnLotes(bloquesConManoObra, 15, async (bloque) => {
    const candidatosSugeridos = await buscarManoObraSimilares(bloque.nombreItem)
    return { codigoItem: bloque.codigoItem, candidatosSugeridos }
  })
}

// ---------------------------------------------------------------------------
// Guardado inmediato + revisión en pestaña aparte (decisión de negocio:
// ver conversación de diseño). En vez de esperar a que el usuario
// resuelva TODO antes de guardar nada, ahora:
//   1. Se guarda el presupuesto/ítems/APU de una vez, con lo que ya
//      matcheó automático agregado real a item_apu.
//   2. Lo ambiguo NO se agrega a item_apu todavía -- queda registrado en
//      apu_import_revision (estado 'pendiente'), agrupado por
//      lote_import_id, para resolverlo después en una pestaña aparte.
//   3. La tabla del presupuesto pinta de rojo/amarillo los ítems con
//      algo pendiente (ver obtenerItemsConPendientes) -- verde/"LISTO
//      PARA GUARDAR" cuando no les falta nada.
// ---------------------------------------------------------------------------

export type ResultadoGuardarImportApu = {
  loteImportId: string
  itemsConApu: number
  lineasAutoMatch: number
  lineasPendientes: number
}

/**
 * Hace el matching Y guarda todo de una vez, en UNA sola llamada de
 * servidor -- antes eran dos llamadas separadas (matchearInsumosApuImport
 * en el cliente, después guardarImportApuConRevision con el resultado
 * de esa), y eso obligaba a mandar los CANDIDATOS de cada línea (hasta 6
 * por línea, con descripción/precio/similitud) de vuelta al servidor
 * dentro del body de la segunda llamada. Con presupuestos grandes (700+
 * ítems) eso pasaba el límite de 1 MB que Next.js le pone al body de un
 * Server Action ("Body exceeded 1 MB limit"), y tronaba a mitad de
 * guardado. Acá el matching corre y se consume del lado del servidor sin
 * que los candidatos vuelvan a pisar el navegador -- lo único que sube
 * es `bloques` (código/tipo/unidad/cantidad, sin candidatos) y lo único
 * que baja es el resumen (`ResultadoGuardarImportApu`), liviano siempre
 * sin importar el tamaño del presupuesto.
 *
 * `loteImportId` lo genera el CLIENTE (page.tsx) -- así puede abrir la
 * pestaña/diálogo de revisión apuntando a ese id desde el principio.
 * `presupuestoItemIdPorCodigo` lo arma el cliente después de guardar los
 * ítems (AñadirItemPresuouesto) -- ya tiene los ids reales.
 */
export async function matchearYGuardarImportApu(
  loteImportId: string,
  presupuestoItemIdPorCodigo: Record<string, string>,
  bloques: BloqueApuInput[]
): Promise<ResultadoGuardarImportApu> {
  const [resoluciones, resolucionesManoObra] = await Promise.all([
    matchearInsumosApuImport(bloques),
    matchearManoDeObraApuImport(bloques),
  ])
  const bloquesConResolucion = combinarBloquesConResoluciones(bloques, resoluciones, resolucionesManoObra)
  return guardarImportApuConRevision(loteImportId, presupuestoItemIdPorCodigo, bloquesConResolucion)
}

/**
 * Guarda el APU de cada bloque de una vez -- reusa crearApuParaItem y
 * agregarInsumoApu (arriba) para lo que sí matcheó, y registra en
 * apu_import_revision TODA línea (auto_match y pendiente) para que el
 * diálogo de revisión pueda mostrar y editar ambas, no solo lo ambiguo.
 * Uso interno (ver matchearYGuardarImportApu arriba) -- ya no se llama
 * directo desde el cliente porque `bloques` acá SÍ trae los candidatos
 * completos, y ese es justo el payload que no queremos que cruce la red
 * dos veces.
 */
async function guardarImportApuConRevision(
  loteImportId: string,
  presupuestoItemIdPorCodigo: Record<string, string>,
  bloques: BloqueConResolucion[]
): Promise<ResultadoGuardarImportApu> {
  const supabase = await createClient()

  const bloquesValidos = bloques.filter((b) => {
    const existe = !!presupuestoItemIdPorCodigo[b.codigoItem]
    if (!existe) console.error(`Falta el id guardado del ítem "${b.codigoItem}" -- se omite su APU.`)
    return existe
  })

  if (bloquesValidos.length === 0) {
    return { loteImportId, itemsConApu: 0, lineasAutoMatch: 0, lineasPendientes: 0 }
  }

  // ---- 1. Crear TODOS los apu de una sola vez (1 insert, no 1 por ítem) ----
  const apuRows = bloquesValidos.map((b) => ({ codigo: b.codigoItem, descripcion: b.nombreItem }))
  const { data: apusCreados, error: errorApus } = await supabase.from("apu").insert(apuRows).select("id")
  if (errorApus) throw new Error(errorApus.message)
  if (!apusCreados || apusCreados.length !== bloquesValidos.length) {
    throw new Error("No se crearon todos los APU esperados en el insert masivo.")
  }

  // El RETURNING de un solo INSERT multi-fila respeta el orden de los
  // VALUES insertados -- se puede hacer zip por índice con confianza,
  // sin tener que volver a consultar por código.
  const apuIdPorCodigoItem = new Map<string, string>()
  bloquesValidos.forEach((b, i) => apuIdPorCodigoItem.set(b.codigoItem, apusCreados[i].id))

  // ---- 2. Vincular apu_id -> presupuesto_items, TODO de una sola llamada (RPC) ----
  const vinculos = bloquesValidos.map((b) => ({
    item_id: presupuestoItemIdPorCodigo[b.codigoItem],
    apu_id: apuIdPorCodigoItem.get(b.codigoItem),
  }))
  const { error: errorVinculo } = await supabase.rpc("vincular_apus_masivo", { vinculos })
  if (errorVinculo) throw new Error(errorVinculo.message)

  // ---- 3. Insertar TODAS las líneas auto_match de una sola vez ----
  type LineaCandidata = {
    apuId: string
    insumoId: string
    cantidad: number
  }
  const candidatasAutoMatch: LineaCandidata[] = []
  for (const b of bloquesValidos) {
    const apuId = apuIdPorCodigoItem.get(b.codigoItem)!
    for (const linea of b.lineas) {
      if (linea.estado === "auto_match" && linea.insumoIdAsignado) {
        candidatasAutoMatch.push({ apuId, insumoId: linea.insumoIdAsignado, cantidad: linea.cantidad })
      }
    }
  }

  // precio real + tipo real (de maestro_insumos, NO del Excel -- mismo
  // criterio que ya usaba agregarInsumoApu) de todos los insumos
  // candidatos, en tandas de 200 -- ver seleccionarEnLotesPorIds.
  const insumoIdsUnicos = Array.from(new Set(candidatasAutoMatch.map((c) => c.insumoId)))
  const infoInsumoPorId = new Map<string, { vr_unitario: number | null; tipo: string | null }>()

  for (let i = 0; i < insumoIdsUnicos.length; i += 200) {
    const lote = insumoIdsUnicos.slice(i, i + 200)
    const { data, error } = await supabase
      .from("maestro_insumos")
      .select("id, vr_unitario, tipo")
      .in("id", lote)
    if (error) throw new Error(error.message)
    for (const row of data ?? []) infoInsumoPorId.set(row.id, { vr_unitario: row.vr_unitario, tipo: row.tipo })
  }

  const clave = (apuId: string, insumoId: string) => `${apuId}::${insumoId}`
  const candidatasValidas: (LineaCandidata & { tipoReal: string | null })[] = []
  const clavesConPrecioPlaceholder = new Set<string>() // esas líneas caen a "pendiente" en vez de auto_match

  for (const c of candidatasAutoMatch) {
    const info = infoInsumoPorId.get(c.insumoId)
    const tienePlaceholder = !info || info.vr_unitario == null || PRECIOS_PLACEHOLDER.includes(info.vr_unitario)
    if (tienePlaceholder) {
      clavesConPrecioPlaceholder.add(clave(c.apuId, c.insumoId))
      continue
    }
    candidatasValidas.push({ ...c, tipoReal: info!.tipo })
  }

  // Insert masivo de item_apu, en tandas de 500 filas (margen prudente
  // de tamaño de payload) -- con .select() se traen los ids insertados
  // DE UNA, sin necesitar un select aparte por línea después (así era
  // antes: 1 insert + 1 select POR LÍNEA).
  const itemApuIdPorClave = new Map<string, string>()
  const TAMANO_LOTE_ITEM_APU = 500

  for (let i = 0; i < candidatasValidas.length; i += TAMANO_LOTE_ITEM_APU) {
    const lote = candidatasValidas.slice(i, i + TAMANO_LOTE_ITEM_APU)
    const filas = lote.map((c) => ({
      apu_id: c.apuId,
      insumo_id: c.insumoId,
      cantidad: c.cantidad,
      rendimiento: 1,
      tipo: c.tipoReal,
    }))
    const { data: insertadas, error } = await supabase
      .from("item_apu")
      .insert(filas)
      .select("id, apu_id, insumo_id")
    if (error) throw new Error(error.message)
    for (const fila of insertadas ?? []) {
      itemApuIdPorClave.set(clave(fila.apu_id, fila.insumo_id), fila.id)
    }
  }

  // ---- 3b. Insertar TODAS las líneas de "Herramienta menor X%" de una vez ----
  // Nunca necesitan revisión -- no son insumo ni mano de obra, son un
  // cargo calculado (ver extraerPorcentajeHerramientaMenor arriba). Se
  // guardan igual que un auto_match, directo a item_apu, sin pasar por
  // apu_import_revision como pendientes.
  type LineaHerramientaMenor = { apuId: string; porcentaje: number; cantidad: number }
  const candidatasHerramientaMenor: LineaHerramientaMenor[] = []
  for (const b of bloquesValidos) {
    const apuId = apuIdPorCodigoItem.get(b.codigoItem)!
    for (const linea of b.lineas) {
      const porcentaje = extraerPorcentajeHerramientaMenor(linea.descripcion)
      if (porcentaje !== null) {
        candidatasHerramientaMenor.push({ apuId, porcentaje, cantidad: linea.cantidad })
      }
    }
  }

  // Un solo INSERT multi-fila -- el RETURNING respeta el orden de los
  // VALUES (misma garantía que se usó arriba para el insert de `apu`),
  // así que se puede hacer zip por índice sin tener que inventar una
  // clave de búsqueda (acá no hay insumo_id/mano_obra_categoria_id que
  // sirva de clave, a diferencia de las otras dos tandas de arriba).
  const itemApuIdsHerramientaMenor: string[] = []
  const TAMANO_LOTE_HERRAMIENTA_MENOR = 500
  for (let i = 0; i < candidatasHerramientaMenor.length; i += TAMANO_LOTE_HERRAMIENTA_MENOR) {
    const lote = candidatasHerramientaMenor.slice(i, i + TAMANO_LOTE_HERRAMIENTA_MENOR)
    const filas = lote.map((c) => ({
      apu_id: c.apuId,
      cantidad: c.cantidad,
      rendimiento: 1,
      porcentaje_mano_obra: c.porcentaje,
      tipo: "EQUIPO", // "Herramienta menor" se categoriza como equipo en el Excel de origen
    }))
    const { data: insertadas, error } = await supabase.from("item_apu").insert(filas).select("id")
    if (error) throw new Error(error.message)
    for (const fila of insertadas ?? []) itemApuIdsHerramientaMenor.push(fila.id)
  }
  let cursorHerramientaMenor = 0

  // ---- 4. Armar y guardar TODAS las filas de apu_import_revision de una vez ----
  let lineasAutoMatch = 0
  let lineasPendientes = 0
  const filasRevision: Record<string, unknown>[] = []

  for (const b of bloquesValidos) {
    const apuId = apuIdPorCodigoItem.get(b.codigoItem)!
    const presupuestoItemId = presupuestoItemIdPorCodigo[b.codigoItem]

    for (const linea of b.lineas) {
      let itemApuId: string | null = null
      let estado: "auto_match" | "pendiente" = "pendiente"
      let insumoIdGuardado: string | null = null

      if (linea.tipo === "MO") {
        // Mano de obra NUNCA auto-matchea (decisión de negocio) -- queda
        // pendiente siempre, con los candidatos de CATEGORÍA (calculados
        // por ítem, no por línea) en vez de los candidatos de insumo.
        lineasPendientes++
        filasRevision.push({
          lote_import_id: loteImportId,
          presupuesto_item_id: presupuestoItemId,
          apu_id: apuId,
          descripcion_original: linea.descripcion,
          tipo: linea.tipo,
          unidad: linea.unidad,
          cantidad: linea.cantidad,
          candidatos: b.resolucionManoObra?.candidatosSugeridos ?? [],
          estado: "pendiente",
          insumo_id_asignado: null,
          mano_obra_categoria_id_asignado: null,
          item_apu_id: null,
        })
        continue
      }

      const porcentajeHerramientaMenor = extraerPorcentajeHerramientaMenor(linea.descripcion)
      if (porcentajeHerramientaMenor !== null) {
        // Nunca pendiente -- es un cargo calculado (% de la mano de obra
        // del mismo APU), no algo que el ingeniero tenga que elegir. Ya
        // se insertó en item_apu en el paso 3b, acá solo se deja el
        // registro en apu_import_revision (como "auto_match", igual que
        // un insumo que sí matcheó solo) para que quede trazabilidad.
        const itemApuIdHerramienta = itemApuIdsHerramientaMenor[cursorHerramientaMenor++] ?? null
        lineasAutoMatch++
        filasRevision.push({
          lote_import_id: loteImportId,
          presupuesto_item_id: presupuestoItemId,
          apu_id: apuId,
          descripcion_original: linea.descripcion,
          tipo: linea.tipo,
          unidad: linea.unidad,
          cantidad: linea.cantidad,
          candidatos: [],
          estado: "auto_match",
          insumo_id_asignado: null,
          mano_obra_categoria_id_asignado: null,
          item_apu_id: itemApuIdHerramienta,
        })
        continue
      }

      if (linea.estado === "auto_match" && linea.insumoIdAsignado) {
        const claveLinea = clave(apuId, linea.insumoIdAsignado)
        const idInsertado = itemApuIdPorClave.get(claveLinea)
        if (idInsertado && !clavesConPrecioPlaceholder.has(claveLinea)) {
          itemApuId = idInsertado
          estado = "auto_match"
          insumoIdGuardado = linea.insumoIdAsignado
        }
      }

      if (estado === "auto_match") lineasAutoMatch++
      else lineasPendientes++

      filasRevision.push({
        lote_import_id: loteImportId,
        presupuesto_item_id: presupuestoItemId,
        apu_id: apuId,
        descripcion_original: linea.descripcion,
        tipo: linea.tipo,
        unidad: linea.unidad,
        cantidad: linea.cantidad,
        candidatos: linea.candidatosSugeridos,
        estado,
        insumo_id_asignado: insumoIdGuardado,
        mano_obra_categoria_id_asignado: null,
        item_apu_id: itemApuId,
      })
    }
  }

  const TAMANO_LOTE_REVISION = 500
  for (let i = 0; i < filasRevision.length; i += TAMANO_LOTE_REVISION) {
    const lote = filasRevision.slice(i, i + TAMANO_LOTE_REVISION)
    const { error } = await supabase.from("apu_import_revision").insert(lote)
    if (error) throw new Error(`Error guardando revisión: ${error.message}`)
  }

  // ---- 5. Recalcular el valor de cada ítem, EN PARALELO (no uno por uno) ----
  const itemIdsAfectados = bloquesValidos.map((b) => presupuestoItemIdPorCodigo[b.codigoItem])
  await procesarEnLotes(itemIdsAfectados, 20, async (itemId) => {
    try {
      await recalcularValorItemDesdeApu(itemId)
    } catch (e) {
      console.error(`No se pudo recalcular el ítem ${itemId}:`, e)
    }
  })

  return {
    loteImportId,
    itemsConApu: bloquesValidos.length,
    lineasAutoMatch,
    lineasPendientes,
  }
}

// ---------- Pestaña de revisión: leer y resolver ----------

function mapearFilaRevision(fila: any): FilaRevisionImport {
  return {
    id: fila.id,
    loteImportId: fila.lote_import_id,
    presupuestoItemId: fila.presupuesto_item_id,
    apuId: fila.apu_id,
    descripcionOriginal: fila.descripcion_original,
    tipo: fila.tipo,
    unidad: fila.unidad,
    cantidad: Number(fila.cantidad),
    // "MO" trae CategoriaManoObra[] en candidatos, cualquier otro tipo
    // trae CandidatoInsumo[] -- ver el discriminador en FilaRevisionImport.
    candidatos: (fila.candidatos ?? []) as CandidatoInsumo[] | CategoriaManoObra[],
    estado: fila.estado,
    insumoIdAsignado: fila.insumo_id_asignado,
    manoObraCategoriaIdAsignado: fila.mano_obra_categoria_id_asignado,
    itemApuId: fila.item_apu_id,
    motivoRechazo: fila.solicitudes_insumos?.motivo_rechazo ?? fila.solicitudes_mano_obra?.motivo_rechazo ?? null,
  }
}

export type LoteRevisionInfo = {
  filas: FilaRevisionImport[]
  // código + descripción del ítem, para mostrar contexto en la pestaña
  // (una fila de apu_import_revision no trae esto directo)
  itemsPorId: Record<string, { codigo: string; descripcion: string }>
}

const SELECT_REVISION_CON_MOTIVO =
  "id, lote_import_id, presupuesto_item_id, apu_id, descripcion_original, tipo, unidad, cantidad, candidatos, estado, insumo_id_asignado, mano_obra_categoria_id_asignado, item_apu_id, presupuesto_items(codigo, descripcion), solicitudes_insumos(motivo_rechazo), solicitudes_mano_obra(motivo_rechazo)"

export async function listarRevisionLote(loteImportId: string): Promise<LoteRevisionInfo> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("apu_import_revision")
    .select(SELECT_REVISION_CON_MOTIVO)
    .eq("lote_import_id", loteImportId)
    .order("created_at", { ascending: true })

  if (error) throw new Error(error.message)

  return mapearFilasConItems(data ?? [])
}

/**
 * Igual que listarRevisionLote, pero por ÍTEMS en vez de por lote de
 * import -- así sirve tanto para el diálogo que se abre justo después de
 * importar como para REABRIRLO más tarde sobre lo que haya quedado
 * pendiente/rechazado (ya no depende de recordar un loteImportId de una
 * sesión anterior).
 */
export async function listarRevisionPorItems(presupuestoItemIds: string[]): Promise<LoteRevisionInfo> {
  if (presupuestoItemIds.length === 0) return { filas: [], itemsPorId: {} }

  const supabase = await createClient()

  const TAMANO_LOTE = 200
  const todasLasFilas: any[] = []

  for (let i = 0; i < presupuestoItemIds.length; i += TAMANO_LOTE) {
    const lote = presupuestoItemIds.slice(i, i + TAMANO_LOTE)
    const { data, error } = await supabase
      .from("apu_import_revision")
      .select(SELECT_REVISION_CON_MOTIVO)
      .in("presupuesto_item_id", lote)
      .order("created_at", { ascending: true })

    if (error) throw new Error(error.message)
    todasLasFilas.push(...(data ?? []))
  }

  return mapearFilasConItems(todasLasFilas)
}

function mapearFilasConItems(data: any[]): LoteRevisionInfo {
  const filas = data.map(mapearFilaRevision)

  const itemsPorId: Record<string, { codigo: string; descripcion: string }> = {}
  for (const fila of data) {
    const item = fila.presupuesto_items
    if (item) itemsPorId[fila.presupuesto_item_id] = { codigo: item.codigo, descripcion: item.descripcion }
  }

  return { filas, itemsPorId }
}

/**
 * Resuelve una línea PENDIENTE (accion "maestro" agrega el insumo real a
 * item_apu; "solicitud" crea la solicitud de aprobación). Recalcula el
 * valor del ítem al final -- reusa agregarInsumoApu/crearSolicitudInsumo/
 * recalcularValorItemDesdeApu, no reimplementa nada.
 */
export async function resolverLineaRevision(input: {
  revisionId: string
  accion: "maestro" | "solicitud" | "mano_obra" | "solicitud_mano_obra"
  insumoId?: string
  manoObraCategoriaId?: string
}): Promise<void> {
  const supabase = await createClient()

  const { data: fila, error: errorLectura } = await supabase
    .from("apu_import_revision")
    .select(
      "apu_id, presupuesto_item_id, descripcion_original, tipo, unidad, cantidad, estado, presupuesto_items(descripcion)"
    )
    .eq("id", input.revisionId)
    .single()

  if (errorLectura) throw new Error(errorLectura.message)
  if (fila.estado === "resuelto") return // ya se resolvió, no repetir

  if (input.accion === "mano_obra") {
    if (!input.manoObraCategoriaId) throw new Error("Falta la categoría elegida.")

    await agregarManoObraApu({
      apuId: fila.apu_id,
      manoObraCategoriaId: input.manoObraCategoriaId,
      cantidad: Number(fila.cantidad),
    })

    const { data: filaInsertada } = await supabase
      .from("item_apu")
      .select("id")
      .eq("apu_id", fila.apu_id)
      .eq("mano_obra_categoria_id", input.manoObraCategoriaId)
      .maybeSingle()

    const { error: errorUpdate } = await supabase
      .from("apu_import_revision")
      .update({
        estado: "resuelto",
        mano_obra_categoria_id_asignado: input.manoObraCategoriaId,
        item_apu_id: filaInsertada?.id ?? null,
      })
      .eq("id", input.revisionId)
    if (errorUpdate) throw new Error(errorUpdate.message)
  } else if (input.accion === "solicitud_mano_obra") {
    // La descripción de la solicitud es el nombre del ÍTEM (lo que de
    // verdad define la categoría de actividad), no descripcion_original
    // (que para mano de obra es el texto de la línea del Excel, ej.
    // "Cuadrilla AA-4" -- no dice nada sobre qué actividad es).
    const nombreItem = (fila as any).presupuesto_items?.descripcion ?? fila.descripcion_original

    const solicitud = await crearSolicitudManoObra({
      descripcion: nombreItem,
      presupuestoItemId: fila.presupuesto_item_id,
    })

    const { error: errorUpdate } = await supabase
      .from("apu_import_revision")
      .update({ estado: "solicitud_pendiente", solicitud_mano_obra_id: solicitud.id })
      .eq("id", input.revisionId)
    if (errorUpdate) throw new Error(errorUpdate.message)
  } else if (input.accion === "maestro") {
    if (!input.insumoId) throw new Error("Falta el insumo elegido.")

    await agregarInsumoApu({ apuId: fila.apu_id, insumoId: input.insumoId, cantidad: Number(fila.cantidad) })

    const { data: filaInsertada } = await supabase
      .from("item_apu")
      .select("id")
      .eq("apu_id", fila.apu_id)
      .eq("insumo_id", input.insumoId)
      .maybeSingle()

    const { error: errorUpdate } = await supabase
      .from("apu_import_revision")
      .update({ estado: "resuelto", insumo_id_asignado: input.insumoId, item_apu_id: filaInsertada?.id ?? null })
      .eq("id", input.revisionId)
    if (errorUpdate) throw new Error(errorUpdate.message)
  } else {
    // Se captura el id de la solicitud creada -- el trigger
    // sincronizar_apu_import_revision lo usa para encontrar esta misma
    // fila cuando el admin la apruebe/rechace en /admin-insumos, y
    // agregar el insumo real con la CANTIDAD REAL del import (no el 1
    // fijo que usa el flujo manual de aprobarSolicitudInsumo).
    const solicitud = await crearSolicitudInsumo({
      descripcion: fila.descripcion_original,
      tipo: fila.tipo,
      uM: fila.unidad,
      presupuestoItemId: fila.presupuesto_item_id,
    })

    const { error: errorUpdate } = await supabase
      .from("apu_import_revision")
      .update({ estado: "solicitud_pendiente", solicitud_id: solicitud.id })
      .eq("id", input.revisionId)
    if (errorUpdate) throw new Error(errorUpdate.message)
  }

  await recalcularValorItemDesdeApu(fila.presupuesto_item_id)
}

/**
 * Versión en LOTE de resolverLineaRevision -- resuelve varias líneas de
 * una sola llamada al servidor, en vez de una llamada por línea desde el
 * cliente. Esto era el cuello de botella real del botón "Guardar
 * seleccionados" (~40s con 30-40 líneas): cada resolverLineaRevision ya
 * son 4-5 idas y vueltas a Supabase, y encima el cliente las disparaba
 * una por una, secuenciales. Acá:
 *   1. Una sola lectura inicial (.in) para TODAS las filas.
 *   2. El trabajo por línea corre en paralelo (procesarEnLotes, 15 a la
 *      vez) en vez de secuencial.
 *   3. recalcularValorItemDesdeApu se llama UNA VEZ POR APU AFECTADO, no
 *      una vez por línea -- si 5 insumos pendientes son del mismo ítem,
 *      antes se recalculaba el mismo APU 5 veces seguidas.
 * "Mejor esfuerzo": si una línea falla, no aborta las demás -- se
 * devuelven los errores puntuales para que el diálogo los muestre.
 */
export async function resolverLineasRevisionEnLote(
  resoluciones: {
    revisionId: string
    accion: "maestro" | "solicitud" | "mano_obra" | "solicitud_mano_obra"
    insumoId?: string
    manoObraCategoriaId?: string
  }[]
): Promise<{ errores: { revisionId: string; mensaje: string }[] }> {
  if (resoluciones.length === 0) return { errores: [] }

  const supabase = await createClient()

  const ids = resoluciones.map((r) => r.revisionId)
  const { data: filas, error: errorLectura } = await supabase
    .from("apu_import_revision")
    .select(
      "id, apu_id, presupuesto_item_id, descripcion_original, tipo, unidad, cantidad, estado, presupuesto_items(descripcion)"
    )
    .in("id", ids)

  if (errorLectura) throw new Error(errorLectura.message)

  const filaPorId = new Map((filas ?? []).map((f) => [f.id, f]))
  const errores: { revisionId: string; mensaje: string }[] = []
  // presupuesto_item_id afectado por resolución exitosa -- clave del
  // dedup para el recalculo (un mismo ítem puede tener varias líneas).
  const itemsAfectados = new Set<string>()

  // ---- resoluciones "maestro" (elegir un insumo existente) ----
  // cada una es independiente -- cada línea pertenece a un apu distinto,
  // necesita su propia fila en item_apu.
  const resolucionesMaestro = resoluciones.filter((r) => r.accion === "maestro")

  await procesarEnLotes(resolucionesMaestro, 15, async (r) => {
    const fila = filaPorId.get(r.revisionId)
    if (!fila) {
      errores.push({ revisionId: r.revisionId, mensaje: "No se encontró esa línea de revisión." })
      return
    }
    if (fila.estado === "resuelto") return // ya resuelta, no repetir

    try {
      if (!r.insumoId) throw new Error("Falta el insumo elegido.")

      await agregarInsumoApu({ apuId: fila.apu_id, insumoId: r.insumoId, cantidad: Number(fila.cantidad) })

      const { data: filaInsertada } = await supabase
        .from("item_apu")
        .select("id")
        .eq("apu_id", fila.apu_id)
        .eq("insumo_id", r.insumoId)
        .maybeSingle()

      const { error: errorUpdate } = await supabase
        .from("apu_import_revision")
        .update({ estado: "resuelto", insumo_id_asignado: r.insumoId, item_apu_id: filaInsertada?.id ?? null })
        .eq("id", r.revisionId)
      if (errorUpdate) throw new Error(errorUpdate.message)

      itemsAfectados.add(fila.presupuesto_item_id)
    } catch (e) {
      errores.push({
        revisionId: r.revisionId,
        mensaje: e instanceof Error ? e.message : "No se pudo guardar esta línea.",
      })
    }
  })

  // ---- resoluciones "mano_obra" (elegir categoría) ----
  // Igual que "maestro" -- cada línea es independiente, un apu distinto
  // cada una. Nunca hace falta deduplicar como con "solicitud" porque ya
  // es UNA línea de mano de obra por bloque (ver matchearManoDeObraApuImport).
  const resolucionesManoObra = resoluciones.filter((r) => r.accion === "mano_obra")

  await procesarEnLotes(resolucionesManoObra, 15, async (r) => {
    const fila = filaPorId.get(r.revisionId)
    if (!fila) {
      errores.push({ revisionId: r.revisionId, mensaje: "No se encontró esa línea de revisión." })
      return
    }
    if (fila.estado === "resuelto") return

    try {
      if (!r.manoObraCategoriaId) throw new Error("Falta la categoría elegida.")

      await agregarManoObraApu({
        apuId: fila.apu_id,
        manoObraCategoriaId: r.manoObraCategoriaId,
        cantidad: Number(fila.cantidad),
      })

      const { data: filaInsertada } = await supabase
        .from("item_apu")
        .select("id")
        .eq("apu_id", fila.apu_id)
        .eq("mano_obra_categoria_id", r.manoObraCategoriaId)
        .maybeSingle()

      const { error: errorUpdate } = await supabase
        .from("apu_import_revision")
        .update({
          estado: "resuelto",
          mano_obra_categoria_id_asignado: r.manoObraCategoriaId,
          item_apu_id: filaInsertada?.id ?? null,
        })
        .eq("id", r.revisionId)
      if (errorUpdate) throw new Error(errorUpdate.message)

      itemsAfectados.add(fila.presupuesto_item_id)
    } catch (e) {
      errores.push({
        revisionId: r.revisionId,
        mensaje: e instanceof Error ? e.message : "No se pudo guardar esta línea.",
      })
    }
  })

  // ---- resoluciones "solicitud_mano_obra" (pedir categoría nueva) ----
  // Cada una independiente -- no hace falta deduplicar como la solicitud
  // de insumo, porque ya es una línea de mano de obra por bloque.
  const resolucionesSolicitudManoObra = resoluciones.filter((r) => r.accion === "solicitud_mano_obra")

  await procesarEnLotes(resolucionesSolicitudManoObra, 15, async (r) => {
    const fila = filaPorId.get(r.revisionId)
    if (!fila) {
      errores.push({ revisionId: r.revisionId, mensaje: "No se encontró esa línea de revisión." })
      return
    }
    if (fila.estado === "resuelto") return

    try {
      const nombreItem = (fila as any).presupuesto_items?.descripcion ?? fila.descripcion_original
      const solicitud = await crearSolicitudManoObra({
        descripcion: nombreItem,
        presupuestoItemId: fila.presupuesto_item_id,
      })

      const { error: errorUpdate } = await supabase
        .from("apu_import_revision")
        .update({ estado: "solicitud_pendiente", solicitud_mano_obra_id: solicitud.id })
        .eq("id", r.revisionId)
      if (errorUpdate) throw new Error(errorUpdate.message)
    } catch (e) {
      errores.push({
        revisionId: r.revisionId,
        mensaje: e instanceof Error ? e.message : "No se pudo crear la solicitud.",
      })
    }
  })

  // ---- resoluciones "solicitud" (pedir insumo nuevo) ----
  // DEDUPLICADAS por descripción -- si el mismo insumo aparece en 20
  // ítems y los 20 se marcan "no existe", antes se creaban 20
  // solicitudes idénticas (20 aprobaciones manuales para lo mismo). Acá
  // se crea UNA sola solicitud por descripción única, y esa misma
  // solicitud_id se reparte a TODAS las filas de apu_import_revision que
  // comparten esa descripción -- el trigger sincronizar_apu_import_revision
  // ya resuelve TODAS las filas con ese solicitud_id de una vez cuando
  // se apruebe, así que esto no rompe nada más adelante.
  const resolucionesSolicitud = resoluciones.filter((r) => r.accion === "solicitud")
  const gruposPorDescripcion = new Map<string, typeof resolucionesSolicitud>()

  for (const r of resolucionesSolicitud) {
    const fila = filaPorId.get(r.revisionId)
    if (!fila || fila.estado === "resuelto") continue
    const clave = fila.descripcion_original.trim().toLowerCase()
    const grupo = gruposPorDescripcion.get(clave) ?? []
    grupo.push(r)
    gruposPorDescripcion.set(clave, grupo)
  }

  await procesarEnLotes(Array.from(gruposPorDescripcion.values()), 15, async (grupo) => {
    const primeraFila = filaPorId.get(grupo[0].revisionId)!
    try {
      const solicitud = await crearSolicitudInsumo({
        descripcion: primeraFila.descripcion_original,
        tipo: primeraFila.tipo,
        uM: primeraFila.unidad,
        presupuestoItemId: primeraFila.presupuesto_item_id,
      })

      const idsDelGrupo = grupo.map((r) => r.revisionId)
      const { error: errorUpdate } = await supabase
        .from("apu_import_revision")
        .update({ estado: "solicitud_pendiente", solicitud_id: solicitud.id })
        .in("id", idsDelGrupo)
      if (errorUpdate) throw new Error(errorUpdate.message)

      for (const r of grupo) {
        const fila = filaPorId.get(r.revisionId)
        if (fila) itemsAfectados.add(fila.presupuesto_item_id)
      }
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : "No se pudo crear la solicitud para este grupo."
      for (const r of grupo) errores.push({ revisionId: r.revisionId, mensaje })
    }
  })

  await procesarEnLotes(Array.from(itemsAfectados), 15, async (presupuestoItemId) => {
    try {
      await recalcularValorItemDesdeApu(presupuestoItemId)
    } catch (e) {
      console.error(`No se pudo recalcular el ítem ${presupuestoItemId}:`, e)
    }
  })

  return { errores }
}

/**
 * Cambia el insumo de una línea que YA quedó en auto_match -- para
 * cuando el usuario revisa el automático y decide que no es el correcto
 * (pedido explícito: "mostrar también el automático para asegurarnos
 * que esté bien"). Borra la línea vieja de item_apu y agrega la nueva.
 */
export async function editarLineaAutoMatch(input: {
  revisionId: string
  nuevoInsumoId: string
}): Promise<void> {
  const supabase = await createClient()

  const { data: fila, error: errorLectura } = await supabase
    .from("apu_import_revision")
    .select("apu_id, presupuesto_item_id, cantidad, item_apu_id")
    .eq("id", input.revisionId)
    .single()

  if (errorLectura) throw new Error(errorLectura.message)

  const itemApuIdViejo = fila.item_apu_id

  // 1. Insertar la línea NUEVA primero.
  await agregarInsumoApu({ apuId: fila.apu_id, insumoId: input.nuevoInsumoId, cantidad: Number(fila.cantidad) })

  const { data: filaInsertada } = await supabase
    .from("item_apu")
    .select("id")
    .eq("apu_id", fila.apu_id)
    .eq("insumo_id", input.nuevoInsumoId)
    .maybeSingle()

  // 2. Mover la referencia de apu_import_revision a la línea nueva ANTES
  // de borrar la vieja -- si no, Postgres rechaza el DELETE con
  // "violates foreign key constraint apu_import_revision_item_apu_id_fkey"
  // porque esta misma fila todavía apunta a la vieja.
  const { error: errorUpdate } = await supabase
    .from("apu_import_revision")
    .update({ insumo_id_asignado: input.nuevoInsumoId, item_apu_id: filaInsertada?.id ?? null })
    .eq("id", input.revisionId)
  if (errorUpdate) throw new Error(errorUpdate.message)

  // 3. Ahora sí se puede borrar la línea vieja -- ya nada la referencia.
  if (itemApuIdViejo) {
    await eliminarInsumoApu(itemApuIdViejo)
  }

  await recalcularValorItemDesdeApu(fila.presupuesto_item_id)
}

/**
 * Para pintar la tabla del presupuesto: qué ítems tienen alguna línea de
 * apu_import_revision sin resolver todavía (estado 'pendiente' o
 * 'solicitud_pendiente'). Un ítem SIN ninguna fila acá, o con todas sus
 * filas en 'auto_match'/'resuelto', está completo.
 */
/**
 * Estado de APU de un ítem, para pintar la tabla del presupuesto -- 3
 * estados (reemplaza el viejo "pendiente sí/no"):
 *   - "rechazado": al menos una línea de apu_import_revision quedó
 *     rechazada (un admin rechazó la solicitud en /admin-insumos) --
 *     rojo, necesita que el ingeniero la revise.
 *   - "pendiente": no hay rechazados, pero al menos una línea sigue sin
 *     resolver (pendiente o solicitud_pendiente, esperando aprobación).
 *   - "listo": todas las líneas de este ítem están en auto_match o
 *     resuelto -- verde, "LISTO PARA SUBIR".
 * Un ítem sin ninguna fila en apu_import_revision no aparece en el mapa
 * de retorno (ni rojo, ni amarillo, ni verde -- no vino de un import).
 */
export type EstadoApuItem = "rechazado" | "pendiente" | "listo"

export type MotivoRechazoPorItem = { descripcion: string; motivo: string | null }

/**
 * Trae valor_unitario/valor_total ya recalculados de un grupo de ítems --
 * resolver algo en el diálogo de revisión (o cerrarlo) sí dispara
 * recalcularValorItemDesdeApu del lado del servidor (confirmado: el
 * valor en la base queda bien), pero el cliente nunca volvía a pedir ese
 * valor -- solo refrescaba los colores (obtenerEstadoApuPorItem), así
 * que la tabla se quedaba mostrando el precio VIEJO hasta recargar toda
 * la página. Se usa junto con obtenerEstadoApuPorItem, no en vez de.
 */
export async function obtenerValoresItems(
  presupuestoItemIds: string[]
): Promise<Record<string, { valorUnitario: number | null; valorTotal: number | null; apuId: string | null }>> {
  if (presupuestoItemIds.length === 0) return {}

  const supabase = await createClient()
  const resultado: Record<string, { valorUnitario: number | null; valorTotal: number | null; apuId: string | null }> = {}

  const TAMANO_LOTE = 200
  for (let i = 0; i < presupuestoItemIds.length; i += TAMANO_LOTE) {
    const lote = presupuestoItemIds.slice(i, i + TAMANO_LOTE)
    const { data, error } = await supabase
      .from("presupuesto_items")
      .select("id, valor_unitario, valor_total, apu_id")
      .in("id", lote)
    if (error) throw new Error(error.message)
    for (const fila of data ?? []) {
      resultado[fila.id] = { valorUnitario: fila.valor_unitario, valorTotal: fila.valor_total, apuId: fila.apu_id }
    }
  }

  return resultado
}

export async function obtenerEstadoApuPorItem(
  presupuestoItemIds: string[]
): Promise<{ estados: Record<string, EstadoApuItem>; motivosRechazo: Record<string, MotivoRechazoPorItem[]> }> {
  if (presupuestoItemIds.length === 0) return { estados: {}, motivosRechazo: {} }

  const supabase = await createClient()

  // Ver nota de TAMANO_LOTE en versiones anteriores de esta función --
  // presupuestos grandes (700+ ítems) necesitan esto partido en tandas,
  // un solo .in() con todos los ids genera "Bad Request".
  const TAMANO_LOTE = 200
  const filasPorItem = new Map<string, { estado: string; descripcion: string; solicitudId: string | null }[]>()

  for (let i = 0; i < presupuestoItemIds.length; i += TAMANO_LOTE) {
    const lote = presupuestoItemIds.slice(i, i + TAMANO_LOTE)
    const { data, error } = await supabase
      .from("apu_import_revision")
      .select("presupuesto_item_id, estado, descripcion_original, solicitud_id")
      .in("presupuesto_item_id", lote)

    if (error) throw new Error(error.message)

    for (const fila of data ?? []) {
      const lista = filasPorItem.get(fila.presupuesto_item_id) ?? []
      lista.push({ estado: fila.estado, descripcion: fila.descripcion_original, solicitudId: fila.solicitud_id })
      filasPorItem.set(fila.presupuesto_item_id, lista)
    }
  }

  // Motivos de rechazo -- se traen aparte porque viven en
  // solicitudes_insumos.motivo_rechazo, no en apu_import_revision.
  const solicitudIdsRechazadas = Array.from(filasPorItem.values())
    .flat()
    .filter((f) => f.estado === "rechazado" && f.solicitudId)
    .map((f) => f.solicitudId as string)

  const motivoPorSolicitud = new Map<string, string | null>()
  if (solicitudIdsRechazadas.length > 0) {
    const { data: solicitudes, error: errorSolicitudes } = await supabase
      .from("solicitudes_insumos")
      .select("id, motivo_rechazo")
      .in("id", solicitudIdsRechazadas)
    if (errorSolicitudes) throw new Error(errorSolicitudes.message)
    for (const s of solicitudes ?? []) motivoPorSolicitud.set(s.id, s.motivo_rechazo)
  }

  const estados: Record<string, EstadoApuItem> = {}
  const motivosRechazo: Record<string, MotivoRechazoPorItem[]> = {}

  for (const [itemId, filas] of filasPorItem) {
    const rechazadas = filas.filter((f) => f.estado === "rechazado")
    if (rechazadas.length > 0) {
      estados[itemId] = "rechazado"
      motivosRechazo[itemId] = rechazadas.map((f) => ({
        descripcion: f.descripcion,
        motivo: f.solicitudId ? motivoPorSolicitud.get(f.solicitudId) ?? null : null,
      }))
      continue
    }
    const sinResolver = filas.some((f) => f.estado === "pendiente" || f.estado === "solicitud_pendiente")
    estados[itemId] = sinResolver ? "pendiente" : "listo"
  }

  return { estados, motivosRechazo }
}

// ---------------------------------------------------------------------------
// Versiones combinadas -- traen los ítems Y su estado de APU en UNA sola
// llamada de servidor, en vez de dos llamadas secuenciales desde el
// cliente (cargarItemsDePresupuesto, después obtenerEstadoApuPorItem).
// Antes eso causaba un salto visible: la tabla aparecía sin colores, y
// los colores llegaban un momento después en un segundo render. Con esto,
// el cliente recibe todo junto y pinta la tabla YA con sus colores desde
// el primer render.
// ---------------------------------------------------------------------------

export type ItemsConEstadoApu = {
  items: ItemPresupuesto[]
  estados: Record<string, EstadoApuItem>
  motivosRechazo: Record<string, MotivoRechazoPorItem[]>
}

export async function cargarItemsConEstadoApu(presupuestoId: string): Promise<ItemsConEstadoApu> {
  const items = await cargarItemsDePresupuesto(presupuestoId)
  const { estados, motivosRechazo } = await obtenerEstadoApuPorItem(items.map((i) => i.id))
  return { items, estados, motivosRechazo }
}

export async function cargarVersionConEstadoApu(versionId: string): Promise<ItemsConEstadoApu> {
  const items = await cargarVersion(versionId)
  const { estados, motivosRechazo } = await obtenerEstadoApuPorItem(items.map((i) => i.id))
  return { items, estados, motivosRechazo }
}

