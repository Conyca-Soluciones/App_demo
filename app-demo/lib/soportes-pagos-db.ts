// El soporte original de cada pago (archivo plano del servidor: recibe el
// cliente de Supabase con la sesión, así la RLS decide qué se ve). Lo usan el
// Consolidado, el Consolidado Gerencia y el enlace fijo /ayf/soporte-pago/<id>.
// OC: el soporte de la orden (factura / cuenta de cobro antes que cotización);
// acta: su soporte de pago (factura o cuenta de cobro); requisición
// administrativa: el del ítem. Tres consultas por lote, sin importar cuántos pagos.

import type { SoportePago } from "@/lib/pagos"

export type PagoParaSoporte = {
  id: string
  ordenCompraId: string | null
  actaId: string | null
  requisicionAdminItemId: string | null
}

export const BUCKET_SOPORTE: Record<SoportePago["origen"], string> = {
  orden_compra: "ordenes_compra",
  acta: "actas",
  requisicion_admin: "requisiciones_admin",
}

const unicos = (lista: (string | null)[]) => [...new Set(lista.filter((x): x is string => Boolean(x)))]

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function buscarSoportesDePagos(supabase: any, pagos: PagoParaSoporte[]): Promise<Record<string, SoportePago>> {
  if (pagos.length > 200) throw new Error("Como mucho 200 pagos a la vez.")
  const ocs = unicos(pagos.map((p) => p.ordenCompraId))
  const actas = unicos(pagos.map((p) => p.actaId))
  const items = unicos(pagos.map((p) => p.requisicionAdminItemId))
  const vacio = Promise.resolve({ data: [], error: null })

  const [rOc, rActa, rItem] = await Promise.all([
    ocs.length
      ? supabase.from("orden_compra_soportes").select("id, orden_compra_id, tipo, ruta, nombre_archivo, created_at").in("orden_compra_id", ocs)
      : vacio,
    actas.length
      ? supabase
          .from("acta_soportes")
          .select("acta_id, tipo, ruta, nombre_archivo, created_at")
          .in("acta_id", actas)
          .in("tipo", ["factura", "cuenta_cobro"])
      : vacio,
    items.length
      ? supabase
          .from("requisicion_admin_items")
          .select("id, soporte_ruta, soporte_nombre, soporte_tipo")
          .in("id", items)
          .not("soporte_ruta", "is", null)
      : vacio,
  ])
  for (const r of [rOc, rActa, rItem]) if (r.error) throw new Error(r.error.message)

  // Uno por documento: el más reciente, y en las OC la factura o cuenta de
  // cobro antes que la cotización.
  const peso = (tipo: string) => (tipo === "cotizacion" ? 0 : 1)
  const porOc = new Map<string, any>()
  for (const s of (rOc.data ?? []) as any[]) {
    const previo = porOc.get(s.orden_compra_id)
    if (!previo || peso(s.tipo) > peso(previo.tipo) || (peso(s.tipo) === peso(previo.tipo) && s.created_at > previo.created_at)) {
      porOc.set(s.orden_compra_id, s)
    }
  }
  const porActa = new Map<string, any>()
  for (const s of (rActa.data ?? []) as any[]) {
    const previo = porActa.get(s.acta_id)
    if (!previo || s.created_at > previo.created_at) porActa.set(s.acta_id, s)
  }
  const porItem = new Map<string, any>(((rItem.data ?? []) as any[]).map((i) => [i.id, i]))

  const salida: Record<string, SoportePago> = {}
  for (const p of pagos) {
    const oc = p.ordenCompraId ? porOc.get(p.ordenCompraId) : null
    const acta = p.actaId ? porActa.get(p.actaId) : null
    const item = p.requisicionAdminItemId ? porItem.get(p.requisicionAdminItemId) : null
    if (oc) salida[p.id] = { origen: "orden_compra", id: oc.id, ruta: oc.ruta, nombre: oc.nombre_archivo, tipo: oc.tipo }
    else if (acta) salida[p.id] = { origen: "acta", ruta: acta.ruta, nombre: acta.nombre_archivo, tipo: acta.tipo }
    else if (item) salida[p.id] = { origen: "requisicion_admin", ruta: item.soporte_ruta, nombre: item.soporte_nombre, tipo: item.soporte_tipo }
  }
  return salida
}
