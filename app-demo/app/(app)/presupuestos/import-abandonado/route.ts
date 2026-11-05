import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// La página de Presupuestos llama esto (fetch keepalive) cuando se cierra o
// recarga con un import corriendo: el latido queda vencido y, al volver a
// abrir el presupuesto, lo subido a medias se descarta de inmediato en vez de
// esperar el plazo de 2 minutos (20261229000000_import_abandonado_al_cerrar.sql).
export async function POST(req: NextRequest) {
  let presupuestoId: unknown
  try {
    presupuestoId = (await req.json())?.presupuestoId
  } catch {
    return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 })
  }
  if (typeof presupuestoId !== "string" || !UUID.test(presupuestoId)) {
    return NextResponse.json({ error: "Presupuesto no válido." }, { status: 400 })
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc("abandonar_import_presupuesto", { p_presupuesto_id: presupuestoId })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
