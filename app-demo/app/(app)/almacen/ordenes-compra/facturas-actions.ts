"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirAccion } from "@/lib/permisos"
import type { FacturaOrden } from "@/lib/facturas-oc"
import type { SoporteSubidoArchivo } from "@/lib/soportes"

// ---------------------------------------------------------------------------
// Facturas de la orden de compra (Paquete C, entrega 1;
// 20261231999100_facturas_orden_compra.sql). Las ve quien ve la orden (RLS:
// Compras, Registro de OC, Control del proyecto y A&F desde el pago). Las
// registra y anula Compras; la base valida todo otra vez.
// ---------------------------------------------------------------------------

// null = la base todavía no tiene la migración (la sección no se muestra).
export async function listarFacturasOrden(ordenId: string): Promise<FacturaOrden[] | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("orden_compra_facturas")
    .select(
      `id, parcial, fecha, subtotal, iva, total, observaciones, nombre_archivo, created_at, anulada_at, motivo_anulacion,
       subida:perfiles!orden_compra_facturas_subida_por_fkey(nombre),
       items:orden_compra_factura_items(orden_compra_item_id, cantidad)`
    )
    .eq("orden_compra_id", ordenId)
    .order("fecha", { ascending: true })
    .order("created_at", { ascending: true })
  if (error) {
    // Tabla que no existe (migración sin correr): PostgREST da PGRST205 / 42P01.
    if (error.code === "PGRST205" || error.code === "42P01") return null
    throw new Error(error.message)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((f: any) => ({
    id: f.id,
    parcial: f.parcial,
    fecha: f.fecha,
    subtotal: Number(f.subtotal),
    iva: Number(f.iva),
    total: Number(f.total),
    observaciones: f.observaciones ?? null,
    nombreArchivo: f.nombre_archivo,
    subidaPorNombre: f.subida?.nombre ?? null,
    createdAt: f.created_at,
    anulada: f.anulada_at != null,
    motivoAnulacion: f.motivo_anulacion ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items: (f.items ?? []).map((i: any) => ({ lineaId: i.orden_compra_item_id, cantidad: Number(i.cantidad) })),
  }))
}

export type DatosFacturaOrden = {
  parcial: boolean
  fecha: string
  subtotal: number
  iva: number
  observaciones: string | null
  items: { lineaId: string; cantidad: number }[]
  archivo: SoporteSubidoArchivo
}

export async function registrarFacturaOrden(ordenId: string, datos: DatosFacturaOrden): Promise<string> {
  await requerirAccion("comprar")
  if (!datos.archivo?.ruta) throw new Error("Adjunta el archivo de la factura.")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("registrar_factura_orden", {
    p_orden_id: ordenId,
    p_datos: {
      parcial: datos.parcial,
      fecha: datos.fecha,
      subtotal: datos.subtotal,
      iva: datos.iva,
      observaciones: datos.observaciones,
      ruta: datos.archivo.ruta,
      nombre_archivo: datos.archivo.nombreArchivo,
      tamano: datos.archivo.tamano,
      mime: datos.archivo.mime,
      items: datos.parcial ? datos.items.map((i) => ({ orden_compra_item_id: i.lineaId, cantidad: i.cantidad })) : [],
    },
  })
  if (error) throw new Error(error.message)
  return data as string
}

export async function anularFacturaOrden(facturaId: string, motivo: string): Promise<void> {
  await requerirAccion("comprar")
  if (!motivo.trim()) throw new Error("Escribe el motivo de la anulación.")
  const supabase = await createClient()
  const { error } = await supabase.rpc("anular_factura_orden", { p_factura_id: facturaId, p_motivo: motivo.trim() })
  if (error) throw new Error(error.message)
}

// Enlace firmado de 2 minutos (la política del bucket deja leer el archivo de
// una factura a quien ve la factura).
export async function enlaceFacturaOrden(facturaId: string): Promise<string> {
  const supabase = await createClient()
  const { data: f, error } = await supabase.from("orden_compra_facturas").select("ruta").eq("id", facturaId).single()
  if (error || !f) throw new Error("No se encontró la factura.")
  const { data, error: e } = await supabase.storage.from("ordenes_compra").createSignedUrl(f.ruta, 120)
  if (e || !data) throw new Error("No se pudo abrir la factura.")
  return data.signedUrl
}
