import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Enlace FIJO a los anexos de una requisición (GET), para el Excel de Requisiciones por
// comprar (20270101006000). No caduca y pide la sesión: entra quien tiene la pestaña
// Requisiciones por comprar (está bajo su ruta) y la RLS decide si ve la requisición y
// sus archivos. Un anexo: redirige a un enlace firmado de 5 min. Varios: una página con
// la lista; `?n=<k>` abre el k-ésimo.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: "Requisición no válida." }, { status: 400 })
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("requisicion_anexos")
    .select("ruta, nombre_archivo, created_at")
    .eq("requisicion_id", id)
    .order("created_at", { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const anexos = (data ?? []) as { ruta: string; nombre_archivo: string }[]
  if (anexos.length === 0) {
    return NextResponse.json({ error: "La requisición no tiene anexos o no tienes acceso." }, { status: 404 })
  }

  const n = Number(req.nextUrl.searchParams.get("n"))
  if (anexos.length > 1 && !(Number.isInteger(n) && n >= 1 && n <= anexos.length)) {
    const { data: r } = await supabase.from("requisiciones").select("codigo").eq("id", id).maybeSingle()
    return new NextResponse(paginaAnexos(id, (r as { codigo: string | null } | null)?.codigo ?? null, anexos), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    })
  }
  const elegido = anexos.length > 1 ? anexos[n - 1] : anexos[0]
  const { data: firmado, error: e } = await supabase.storage.from("requisiciones").createSignedUrl(elegido.ruta, 300)
  if (e || !firmado) return NextResponse.json({ error: "No se pudo abrir el anexo (sin acceso al archivo)." }, { status: 404 })
  return NextResponse.redirect(firmado.signedUrl, { headers: { "Cache-Control": "no-store" } })
}

const escapar = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

function paginaAnexos(id: string, codigo: string | null, anexos: { nombre_archivo: string }[]): string {
  const filas = anexos
    .map(
      (a, i) =>
        `<li><span>${escapar(a.nombre_archivo)}</span>` +
        `<a href="/almacen/comprar-pedidos/anexos/${id}?n=${i + 1}" target="_blank" rel="noreferrer">Abrir</a></li>`
    )
    .join("")
  const titulo = `Anexos de la requisición${codigo ? ` ${escapar(codigo)}` : ""}`
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo} · CONYCA 360</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f9;color:#1f2937;margin:0;padding:24px 16px}
main{max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px}
h1{font-size:18px;margin:0 0 4px}p{color:#6b7280;font-size:13px;margin:0 0 16px}
ul{list-style:none;padding:0;margin:0}li{display:flex;gap:12px;align-items:center;justify-content:space-between;border-top:1px solid #eef0f3;padding:10px 0;font-size:14px}
li span{min-width:0;overflow-wrap:anywhere}a{flex-shrink:0;background:#3e70a1;color:#fff;text-decoration:none;border-radius:8px;padding:6px 12px;font-size:13px}
</style></head><body><main><h1>${titulo} (${anexos.length})</h1><p>Abre cada uno en una pestaña nueva.</p><ul>${filas}</ul></main></body></html>`
}
