import type { createClient } from "@/lib/supabase/server"
import { traerTodo } from "@/lib/supabase/traer-todo"

// Líneas de requisiciones (cada una = un insumo en un ítem del presupuesto).
// Va FUERA de actions.ts porque lo usan dos pantallas (detalle y aprobación) y
// un archivo "use server" solo puede exportar funciones asíncronas que el
// cliente puede invocar -- esto es solo ayuda interna del servidor.

export type EstadoRequisicion = "pendiente" | "aprobada" | "rechazada" | "cancelada"
export type EstadoCompra = "completa" | "pendiente" | "rechazada_compras" | null

export type RequisicionResumen = {
  id: string
  numero: number
  proyectoId: string | null
  proyectoCodigo: string | null
  proyectoNombre: string | null
  solicitanteId: string | null
  solicitanteNombre: string | null
  fechaRequerida: string | null
  urgente: boolean
  observaciones: string | null
  soporteUrl: string | null
  createdAt: string
  nLineas: number
  estado: EstadoRequisicion
  estadoCompra: EstadoCompra
}

export type LineaRequisicion = {
  id: string
  insumoId: string
  insumoCodigo: number
  insumoDescripcion: string
  insumoUm: string | null
  presupuestoItemId: string
  presupuestoId: string | null
  itemCodigo: string
  itemDescripcion: string
  cantidad: number
  comprado: number
  estado: "pendiente" | "aprobado" | "rechazado" | "cancelado"
  rechazadaPorCompras: boolean
  motivoRechazoCompras: string | null
}

export type LineaConResolucion = LineaRequisicion & {
  _resolutor: string | null
  _resueltoAt: string | null
  _comentario: string | null
  _motivoCancelacion: string | null
}

// Filtro "requisiciones que tienen este insumo": se hace en la misma consulta a
// requisiciones_vista con un embed !inner sobre sus líneas, y se filtra con
// .eq("filtro_insumo.insumo_id", id). Antes se traían los ids de las líneas
// (hasta 5000, pero la API corta en 1000) y se mandaban de vuelta en un
// .in("id", [...]) dentro de la URL, que falla cuando la lista es larga.
export const SELECT_REQUISICIONES = "*"
export const SELECT_REQUISICIONES_CON_INSUMO =
  "*, filtro_insumo:pedidos_insumos!pedidos_insumos_requisicion_fkey!inner(insumo_id)"

// Ids por tanda en .in(...): van dentro de la URL, que tiene límite de tamaño.
const TANDA_IDS = 100

// Líneas de varias requisiciones (con cuánto de cada una ya está en órdenes de
// compra vigentes). Compartido por el detalle y por la pantalla de aprobación.
export async function cargarLineas(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[]
): Promise<Map<string, LineaConResolucion[]>> {
  const porRequisicion = new Map<string, any[]>()
  if (ids.length === 0) return porRequisicion

  // Por tandas de ids (la URL tiene límite) y paginado dentro de cada tanda
  // (la API corta cada respuesta en 1000 filas sin avisar: con 500
  // requisiciones en Aprobación se perdían líneas).
  const tandas: string[][] = []
  for (let i = 0; i < ids.length; i += TANDA_IDS) tandas.push(ids.slice(i, i + TANDA_IDS))
  const lineas = (
    await Promise.all(
      tandas.map((tanda) =>
        traerTodo<any>((desde, hasta) =>
          supabase
            .from("pedidos_insumos")
            .select(`
              id, grupo_pedido_id, cantidad, estado, resuelto_at, comentario_resolucion, motivo_cancelacion,
              rechazado_compras_at, observaciones_compras, presupuesto_item_id,
              insumo:maestro_insumos(id, codigo, descripcion, u_m),
              presupuesto_item:presupuesto_items(codigo, descripcion, presupuesto_id),
              resolutor:perfiles!pedidos_insumos_resuelto_por_fkey(nombre)
            `)
            .in("grupo_pedido_id", tanda)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(desde, hasta)
        )
      )
    )
  ).flat()

  // comprado_pedidos devuelve una fila por línea: también se corta en 1000.
  // Los ids van en el cuerpo (RPC), así que la tanda puede ser grande.
  const compradoPorId = new Map<string, number>()
  const idsLineas = lineas.map((l) => l.id as string)
  const tandasLineas: string[][] = []
  for (let i = 0; i < idsLineas.length; i += 500) tandasLineas.push(idsLineas.slice(i, i + 500))
  await Promise.all(
    tandasLineas.map(async (tanda) => {
      const { data: comprados, error: errorComprados } = await supabase.rpc("comprado_pedidos", { p_ids: tanda })
      if (errorComprados) throw new Error(errorComprados.message)
      for (const c of (comprados ?? []) as { pedido_id: string; comprado: number }[]) {
        compradoPorId.set(c.pedido_id, Number(c.comprado))
      }
    })
  )

  for (const l of lineas) {
    const arr = porRequisicion.get(l.grupo_pedido_id) ?? []
    arr.push({
      id: l.id,
      insumoId: l.insumo?.id,
      insumoCodigo: l.insumo?.codigo,
      insumoDescripcion: l.insumo?.descripcion ?? "(insumo eliminado)",
      insumoUm: l.insumo?.u_m ?? null,
      presupuestoItemId: l.presupuesto_item_id,
      presupuestoId: l.presupuesto_item?.presupuesto_id ?? null,
      itemCodigo: l.presupuesto_item?.codigo ?? "",
      itemDescripcion: l.presupuesto_item?.descripcion ?? "",
      cantidad: Number(l.cantidad),
      comprado: compradoPorId.get(l.id) ?? 0,
      estado: l.estado,
      rechazadaPorCompras: l.rechazado_compras_at !== null,
      motivoRechazoCompras: l.observaciones_compras ?? null,
      _resolutor: l.resolutor?.nombre ?? null,
      _resueltoAt: l.resuelto_at,
      _comentario: l.comentario_resolucion,
      _motivoCancelacion: l.motivo_cancelacion,
    })
    porRequisicion.set(l.grupo_pedido_id, arr)
  }
  return porRequisicion
}

export function mapResumen(r: any): RequisicionResumen {
  return {
    id: r.id,
    numero: Number(r.numero),
    proyectoId: r.proyecto_id,
    proyectoCodigo: r.proyecto_codigo,
    proyectoNombre: r.proyecto_nombre,
    solicitanteId: r.solicitado_por,
    solicitanteNombre: r.solicitante_nombre,
    fechaRequerida: r.fecha_requerida,
    urgente: r.urgente,
    observaciones: r.observaciones,
    soporteUrl: r.soporte_url,
    createdAt: r.created_at,
    nLineas: r.n_lineas,
    estado: r.estado,
    estadoCompra: r.estado_compra,
  }
}

