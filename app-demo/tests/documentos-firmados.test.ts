import { beforeEach, describe, expect, it, vi } from "vitest"

// Storage y tabla falsos de la service role.
const archivos = new Map<string, Uint8Array>()
const registros: Record<string, unknown>[] = []
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        download: async (ruta: string) => {
          const a = archivos.get(ruta)
          return a ? { data: new Blob([a as BlobPart]), error: null } : { data: null, error: { message: "not found" } }
        },
        upload: async (ruta: string, datos: Uint8Array) => {
          if (archivos.has(ruta)) return { error: { message: "The resource already exists" } }
          archivos.set(ruta, datos)
          return { error: null }
        },
      }),
    },
    from: () => ({
      upsert: async (fila: Record<string, unknown>) => {
        const i = registros.findIndex((r) => r.entidad === fila.entidad && r.entidad_id === fila.entidad_id)
        if (i >= 0) registros[i] = fila
        else registros.push(fila)
        return { error: null }
      },
    }),
  }),
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }))
vi.mock("@/app/(app)/contratos/actas/actions", () => ({ obtenerActa: async () => ({}) }))
vi.mock("@/app/(app)/almacen/comprar-pedidos/actions", () => ({ obtenerOrdenCompraDetalle: async () => ({}) }))

const { pdfCongelado, sha256Hex } = await import("@/lib/documentos-firmados")

const bytes = (t: string) => new TextEncoder().encode(t)

describe("PDF congelado", () => {
  beforeEach(() => {
    archivos.clear()
    registros.length = 0
    process.env.SUPABASE_SERVICE_ROLE_KEY = "x"
  })

  it("la primera vez lo genera, lo guarda y registra su huella; después sale el guardado", async () => {
    const generar = vi.fn(async () => bytes("%PDF uno"))
    const a = await pdfCongelado("acta", "a1", "V1", null, generar)
    expect(a.sha256).toBe(sha256Hex(bytes("%PDF uno")))
    expect(registros).toEqual([{ entidad: "acta", entidad_id: "a1", ruta: "acta/a1-V1.pdf", sha256: a.sha256, tamano: 8 }])
    const b = await pdfCongelado("acta", "a1", "V1", { ruta: "acta/a1-V1.pdf", sha256: a.sha256!, createdAt: "" }, async () => bytes("%PDF otro"))
    expect(new TextDecoder().decode(b.pdf)).toBe("%PDF uno")
    expect(generar).toHaveBeenCalledTimes(1)
  })

  it("si otro pedido lo congeló al mismo tiempo, vale el guardado", async () => {
    archivos.set("poliza/p1-V1.pdf", bytes("%PDF ganador"))
    const r = await pdfCongelado("poliza", "p1", "V1", null, async () => bytes("%PDF perdedor"))
    expect(new TextDecoder().decode(r.pdf)).toBe("%PDF ganador")
    expect(registros[0].sha256).toBe(sha256Hex(bytes("%PDF ganador")))
  })

  it("un archivo guardado que no coincide con su huella no se entrega", async () => {
    archivos.set("acta/a2-V1.pdf", bytes("%PDF cambiado"))
    await expect(pdfCongelado("acta", "a2", "V1", { ruta: "acta/a2-V1.pdf", sha256: "0".repeat(64), createdAt: "" }, async () => bytes("x"))).rejects.toThrow(/huella/)
  })

  it("una aprobación nueva (otra versión) se congela otra vez y reemplaza el registro", async () => {
    const a = await pdfCongelado("orden_compra", "o1", "V1", null, async () => bytes("%PDF v1"))
    const b = await pdfCongelado("orden_compra", "o1", "V2", { ruta: "orden_compra/o1-V1.pdf", sha256: a.sha256!, createdAt: "" }, async () => bytes("%PDF v2"))
    expect(new TextDecoder().decode(b.pdf)).toBe("%PDF v2")
    expect(registros).toHaveLength(1)
    expect(registros[0]).toMatchObject({ ruta: "orden_compra/o1-V2.pdf", sha256: sha256Hex(bytes("%PDF v2")) })
  })

  it("sin service role no congela (sale el PDF generado)", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const r = await pdfCongelado("acta", "a3", "V1", null, async () => bytes("%PDF"))
    expect(r.sha256).toBeNull()
    expect(archivos.size).toBe(0)
  })
})
