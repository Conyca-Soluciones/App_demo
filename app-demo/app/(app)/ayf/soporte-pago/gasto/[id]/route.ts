import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Enlace FIJO al soporte de un gasto de caja menor (20270101007600): lo usan las
// filas de gasto del Consolidado y del Excel de liquidación. Vive bajo
// /ayf/soporte-pago para que entren las mismas pestañas que ven los pagos; pide
// la sesión y la RLS de los gastos y del bucket cajas_menores decide. Redirige a
// un enlace firmado de 5 minutos.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: "Gasto no válido." }, { status: 400 })
  const supabase = await createClient()
  const { data: gasto, error } = await supabase.from("caja_menor_gastos").select("soporte_ruta").eq("id", id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!gasto?.soporte_ruta) return NextResponse.json({ error: "El gasto no existe o no tienes acceso." }, { status: 404 })
  const { data: firmado, error: errorFirma } = await supabase.storage.from("cajas_menores").createSignedUrl(gasto.soporte_ruta, 300)
  if (errorFirma || !firmado) {
    return NextResponse.json({ error: "No se pudo abrir el soporte (sin acceso al archivo)." }, { status: 404 })
  }
  return NextResponse.redirect(firmado.signedUrl, { headers: { "Cache-Control": "no-store" } })
}
