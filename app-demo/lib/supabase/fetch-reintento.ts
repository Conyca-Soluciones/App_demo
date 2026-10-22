// Reintento ante cortes de red entre el servidor de la app y Supabase.
// "TypeError: fetch failed" = la conexión se cayó antes de la respuesta (pasó
// en el import de APU, 2026-10-22: Supabase no registró ningún error). Solo se
// repiten LECTURAS (GET y las RPC de búsqueda / precios): una escritura pudo
// haber llegado a guardarse antes del corte y repetirla la duplicaría.

const RPC_SOLO_LECTURA = ["buscar_", "precios_"]

export function esLecturaSegura(url: string, metodo: string): boolean {
  const m = metodo.toUpperCase()
  if (m === "GET" || m === "HEAD") return true
  if (m !== "POST") return false
  const i = url.indexOf("/rest/v1/rpc/")
  if (i < 0) return false
  const nombre = url.slice(i + "/rest/v1/rpc/".length)
  return RPC_SOLO_LECTURA.some((p) => nombre.startsWith(p))
}

export function fetchConReintento(
  base: typeof fetch = fetch,
  esperasMs: number[] = [300, 900],
  dormir: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const metodo = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")
    const reintentable = esLecturaSegura(url, metodo)
    for (let intento = 0; ; intento++) {
      try {
        return await base(input, init)
      } catch (e) {
        // Solo cortes de red (TypeError), nunca respuestas con error HTTP.
        if (!reintentable || !(e instanceof TypeError) || intento >= esperasMs.length) throw e
        await dormir(esperasMs[intento])
      }
    }
  }
}
