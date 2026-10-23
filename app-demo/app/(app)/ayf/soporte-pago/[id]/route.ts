import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { BUCKET_SOPORTE, buscarSoportesDePagos } from "@/lib/soportes-pagos-db"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Enlace FIJO al soporte original de un pago (GET): lo usan la pantalla y el
// Excel de liquidación (un enlace por fila). No caduca y pide la sesión: el
// middleware deja entrar a las pestañas de pagos (lib/pestanas.ts) y la RLS
// decide si se ve el pago y su archivo. Redirige a un enlace firmado de 5 min.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: "Pago no válido." }, { status: 400 })
  const supabase = await createClient()

  const { data: pago, error } = await supabase
    .from("pagos")
    .select("id, orden_compra_id, acta_id, requisicion_admin_item_id")
    .eq("id", id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!pago) return NextResponse.json({ error: "El pago no existe o no tienes acceso." }, { status: 404 })

  const soportes = await buscarSoportesDePagos(supabase, [
    {
      id: pago.id,
      ordenCompraId: pago.orden_compra_id,
      actaId: pago.acta_id,
      requisicionAdminItemId: pago.requisicion_admin_item_id,
    },
  ])
  const s = soportes[pago.id]
  if (!s) return NextResponse.json({ error: "Este pago no tiene soporte." }, { status: 404 })

  const { data: firmado, error: errorFirma } = await supabase.storage.from(BUCKET_SOPORTE[s.origen]).createSignedUrl(s.ruta, 300)
  if (errorFirma || !firmado) {
    return NextResponse.json({ error: "No se pudo abrir el soporte (sin acceso al archivo)." }, { status: 404 })
  }
  return NextResponse.redirect(firmado.signedUrl, { headers: { "Cache-Control": "no-store" } })
}
