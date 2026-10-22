import { describe, expect, it, vi } from "vitest"
import { esLecturaSegura, fetchConReintento } from "@/lib/supabase/fetch-reintento"

const URL_BASE = "https://x.supabase.co/rest/v1"
const sinEspera = () => Promise.resolve()

describe("esLecturaSegura", () => {
  it("GET y las RPC de búsqueda o precios sí", () => {
    expect(esLecturaSegura(`${URL_BASE}/presupuesto_items?select=*`, "GET")).toBe(true)
    expect(esLecturaSegura(`${URL_BASE}/rpc/buscar_mano_obra_candidatos`, "POST")).toBe(true)
    expect(esLecturaSegura(`${URL_BASE}/rpc/precios_presupuesto_insumos`, "post")).toBe(true)
  })
  it("escrituras no", () => {
    expect(esLecturaSegura(`${URL_BASE}/item_apu`, "POST")).toBe(false)
    expect(esLecturaSegura(`${URL_BASE}/presupuesto_items?id=eq.1`, "PATCH")).toBe(false)
    expect(esLecturaSegura(`${URL_BASE}/rpc/crear_requisicion`, "POST")).toBe(false)
  })
})

describe("fetchConReintento", () => {
  const ok = new Response("[]", { status: 200 })

  it("repite una lectura que falla por red y devuelve la respuesta", async () => {
    const base = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(ok)
    const f = fetchConReintento(base as unknown as typeof fetch, [1, 1], sinEspera)
    const r = await f(`${URL_BASE}/rpc/buscar_mano_obra_candidatos`, { method: "POST" })
    expect(r.status).toBe(200)
    expect(base).toHaveBeenCalledTimes(2)
  })

  it("se rinde después de los reintentos", async () => {
    const base = vi.fn().mockRejectedValue(new TypeError("fetch failed"))
    const f = fetchConReintento(base as unknown as typeof fetch, [1, 1], sinEspera)
    await expect(f(`${URL_BASE}/apu?select=*`)).rejects.toThrow("fetch failed")
    expect(base).toHaveBeenCalledTimes(3)
  })

  it("nunca repite una escritura", async () => {
    const base = vi.fn().mockRejectedValue(new TypeError("fetch failed"))
    const f = fetchConReintento(base as unknown as typeof fetch, [1, 1], sinEspera)
    await expect(f(`${URL_BASE}/item_apu`, { method: "POST" })).rejects.toThrow()
    expect(base).toHaveBeenCalledTimes(1)
  })

  it("no repite errores que no son de red", async () => {
    const base = vi.fn().mockRejectedValue(new Error("otra cosa"))
    const f = fetchConReintento(base as unknown as typeof fetch, [1, 1], sinEspera)
    await expect(f(`${URL_BASE}/apu?select=*`)).rejects.toThrow("otra cosa")
    expect(base).toHaveBeenCalledTimes(1)
  })
})
