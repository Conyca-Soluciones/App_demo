import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { rutaNotificacion } from "@/lib/notificaciones-rutas"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Enlace "Abrir en 360" de los correos (20270101001600): marca el aviso como
// leído y lleva a la misma pantalla que la campanita. Pide la sesión (el
// middleware manda al login); la RLS solo deja leer los avisos propios.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const inicio = new URL("/pendientes", req.url)
  if (!UUID.test(id)) return NextResponse.redirect(inicio)
  const supabase = await createClient()
  const { data } = await supabase
    .from("notificaciones")
    .select("id, tipo, entidad_tipo, entidad_id")
    .eq("id", id)
    .maybeSingle()
  if (!data) return NextResponse.redirect(inicio)
  await supabase.from("notificaciones").update({ leida: true }).eq("id", id)
  const destino = rutaNotificacion({ tipo: data.tipo, entidadTipo: data.entidad_tipo, entidadId: data.entidad_id })
  return NextResponse.redirect(new URL(destino, req.url), { headers: { "Cache-Control": "no-store" } })
}
