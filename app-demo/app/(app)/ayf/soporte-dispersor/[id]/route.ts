import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Enlace FIJO al soporte individual del dispersor en que salió un pago (GET),
// como /ayf/soporte-pago. Pide la sesión; la RLS de dispersion_pagos y del
// bucket `dispersores` decide (quien ve el pago ve su dispersor). Redirige a
// un enlace firmado de 5 min.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: "Pago no válido." }, { status: 400 })
  const supabase = await createClient()

  const { data, error } = await supabase.from("dispersion_pagos").select("soporte_ruta").eq("pago_id", id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: "Este pago no se ha dispersado o no tienes acceso." }, { status: 404 })

  const { data: firmado, error: errorFirma } = await supabase.storage.from("dispersores").createSignedUrl(data.soporte_ruta, 300)
  if (errorFirma || !firmado) {
    return NextResponse.json({ error: "No se pudo abrir el soporte del dispersor (sin acceso al archivo)." }, { status: 404 })
  }
  return NextResponse.redirect(firmado.signedUrl, { headers: { "Cache-Control": "no-store" } })
}
