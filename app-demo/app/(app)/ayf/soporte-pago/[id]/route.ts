import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { BUCKET_SOPORTE, buscarSoportesDePagos } from "@/lib/soportes-pagos-db"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Enlace FIJO al soporte original de un pago (GET): lo usan la pantalla y el
// Excel de liquidación (un enlace por fila). No caduca y pide la sesión: el
// middleware deja entrar a las pestañas de pagos (lib/pestanas.ts) y la RLS
// decide si se ve el pago y su archivo. Redirige a un enlace firmado de 5 min.
// Con varios soportes (una OC puede tener varios, 20270101005800) muestra una
// página con todos; `?n=<k>` abre el k-ésimo.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: "Pago no válido." }, { status: 400 })
  const supabase = await createClient()

  const { data: pago, error } = await supabase
    .from("pagos")
    .select("id, orden_compra_id, acta_id, requisicion_admin_item_id, sinco_fila_id")
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
      sincoFilaId: pago.sinco_fila_id,
    },
  ])
  const s = soportes[pago.id]
  if (!s) return NextResponse.json({ error: "Este pago no tiene soporte." }, { status: 404 })

  const todos = s.todos && s.todos.length > 0 ? s.todos : [{ ruta: s.ruta, nombre: s.nombre, tipo: s.tipo }]
  const n = Number(req.nextUrl.searchParams.get("n"))
  if (todos.length > 1 && !(Number.isInteger(n) && n >= 1 && n <= todos.length)) {
    return new NextResponse(paginaSoportes(pago.id, todos), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    })
  }
  const elegido = todos.length > 1 ? todos[n - 1] : todos[0]

  const { data: firmado, error: errorFirma } = await supabase.storage.from(BUCKET_SOPORTE[s.origen]).createSignedUrl(elegido.ruta, 300)
  if (errorFirma || !firmado) {
    return NextResponse.json({ error: "No se pudo abrir el soporte (sin acceso al archivo)." }, { status: 404 })
  }
  return NextResponse.redirect(firmado.signedUrl, { headers: { "Cache-Control": "no-store" } })
}

const TIPO: Record<string, string> = { cotizacion: "Cotización", cuenta_cobro: "Cuenta de cobro", factura: "Factura" }

const escapar = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

// Página sencilla con todos los soportes del pago: el navegador no deja abrir
// varias pestañas con un solo clic, así que se abren desde aquí.
function paginaSoportes(pagoId: string, todos: { nombre: string; tipo: string }[]): string {
  const filas = todos
    .map(
      (t, i) =>
        `<li><span><b>${escapar(TIPO[t.tipo] ?? t.tipo)}</b> · ${escapar(t.nombre)}</span>` +
        `<a href="/ayf/soporte-pago/${pagoId}?n=${i + 1}" target="_blank" rel="noreferrer">Abrir</a></li>`
    )
    .join("")
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Soportes del pago · CONYCA 360</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f9;color:#1f2937;margin:0;padding:24px 16px}
main{max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px}
h1{font-size:18px;margin:0 0 4px}p{color:#6b7280;font-size:13px;margin:0 0 16px}
ul{list-style:none;padding:0;margin:0}li{display:flex;gap:12px;align-items:center;justify-content:space-between;border-top:1px solid #eef0f3;padding:10px 0;font-size:14px}
li span{min-width:0;overflow-wrap:anywhere}a{flex-shrink:0;background:#3e70a1;color:#fff;text-decoration:none;border-radius:8px;padding:6px 12px;font-size:13px}
</style></head><body><main><h1>Soportes del pago (${todos.length})</h1><p>Abre cada uno en una pestaña nueva.</p><ul>${filas}</ul></main></body></html>`
}
