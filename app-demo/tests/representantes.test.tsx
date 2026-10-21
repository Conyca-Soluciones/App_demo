import { describe, expect, it } from "vitest"
import path from "path"
import { renderToBuffer } from "@react-pdf/renderer"
import {
  mapEmpresasRepresentantes,
  mapFirmaRepresentante,
  origenFirmaRepresentante,
  principalActivo,
  textoFirmaRepresentante,
  validarRepresentante,
} from "@/lib/representantes"
import { minutaObraVacia } from "@/lib/minuta-obra"
import { MinutaObraPDF } from "@/components/minuta-obra-pdf"
import { MinutaArrendamientoPDF } from "@/components/minuta-arrendamiento-pdf"
import { minutaArrendamientoVacia } from "@/lib/minuta-arrendamiento"

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
const LOGO = path.join(process.cwd(), "public", "logo-conyca.png")

const crudo = [
  {
    id: "e1",
    razon_social: "CONYCA SAS",
    nit: "900",
    representantes: [
      { id: "r1", empresa_id: "e1", tipo: "principal", nombre: "Ana", tipo_documento: "CC", numero_documento: "123", activo: false, tiene_imagen: true },
      { id: "r2", empresa_id: "e1", tipo: "principal", nombre: "Carla", tipo_documento: "XX", numero_documento: "999", activo: true, perfil_id: "u1", firma_de_usuario: true },
      { id: "r3", empresa_id: "e1", tipo: "suplente", nombre: "Beto", numero_documento: "777", activo: true, perfil_id: "u2", firma_de_usuario: false },
    ],
  },
]

describe("representantes legales", () => {
  it("lee las empresas y elige el principal activo", () => {
    const [e] = mapEmpresasRepresentantes(crudo)
    expect(e.representantes).toHaveLength(3)
    expect(e.representantes[1].tipoDocumento).toBe("CC") // un tipo desconocido cae a CC
    expect(principalActivo(e.representantes)?.nombre).toBe("Carla")
    expect(origenFirmaRepresentante(e.representantes[1])).toBe("usuario")
    expect(origenFirmaRepresentante(e.representantes[0])).toBe("subida")
    expect(origenFirmaRepresentante(e.representantes[2])).toBeNull() // usa la app pero sin Mi firma ni firma subida
    expect(mapEmpresasRepresentantes(null)).toEqual([])
  })
  it("valida nombre y documento", () => {
    const base = { tipo: "principal" as const, nombre: "Ana Pérez", tipoDocumento: "CC" as const, numeroDocumento: "1.234.567", expedidaEn: "", perfilId: null }
    expect(validarRepresentante(base)).toBeNull()
    expect(validarRepresentante({ ...base, nombre: "A" })).toMatch(/nombre/)
    expect(validarRepresentante({ ...base, numeroDocumento: "12" })).toMatch(/documento/)
  })
  it("dice a Subgerencia quién firma o qué falta", () => {
    expect(textoFirmaRepresentante(mapFirmaRepresentante({ estado: "ok", nombre: "Ana", tipo: "principal", empresa: "CONYCA" }))).toMatchObject({ bloquea: false })
    expect(textoFirmaRepresentante(mapFirmaRepresentante({ estado: "sin_firma", nombre: "Ana", empresa: "CONYCA" })).bloquea).toBe(true)
    const nc = textoFirmaRepresentante(mapFirmaRepresentante({ estado: "no_coincide", empresa: "CONYCA", minuta_nombre: "Pedro", minuta_documento: "55" }))
    expect(nc.bloquea).toBe(true)
    expect(nc.texto).toMatch(/Pedro, C\.C\. 55/)
    expect(textoFirmaRepresentante(mapFirmaRepresentante({ estado: "sin_registro" })).bloquea).toBe(false)
    expect(mapFirmaRepresentante(null).estado).toBe("sin_registro")
  })
})

describe("minuta con la firma del representante legal", () => {
  const firma = { papel: "representante_legal" as const, nombre: "Carla", cargo: "Representante legal", imagen: PNG, codigo: "ABCDABCDABCD", firmadoAt: "2026-10-21T20:00:00Z" }
  it("obra y mano de obra (versión 04)", async () => {
    for (const variante of ["obra", "mano_obra"] as const) {
      const m = { ...minutaObraVacia(), variante, contratanteRepresentante: "Carla", contratanteRepresentanteCedula: "999" }
      const pdf = await renderToBuffer(<MinutaObraPDF minuta={m} numero={20} logo={LOGO} firmaContratante={firma} />)
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF")
    }
  })
  it("arrendamiento (la empresa es el arrendatario)", async () => {
    const m = { ...minutaArrendamientoVacia(), arrendatarioRepresentante: "Carla", arrendatarioCedula: "999" }
    const pdf = await renderToBuffer(<MinutaArrendamientoPDF minuta={m} numero={22} logo={LOGO} firmaContratante={firma} />)
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF")
  })
})
