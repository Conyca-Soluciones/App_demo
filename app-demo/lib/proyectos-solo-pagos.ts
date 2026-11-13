// Importar proyectos "solo pagos" (los que siguen en Google, 20270101001300, o en
// SINCO, 20270101002800) desde un Excel: una fila por proyecto con su código,
// nombre (opcional: si falta se usa el código), empresa (razón social o NIT) y,
// opcional, el número (el de SINCO: 112, 115...; si falta, el siguiente libre).
// Con número, un código que empiece por él ("112-900-CS-CUND") se guarda sin él. Archivo plano: lo usan
// la pantalla de Admin (leer el Excel) y la action (emparejar la empresa).

export type FilaProyectoSoloPagos = { fila: number; codigo: string; nombre: string; empresa: string; numero?: number | null }
export type ResultadoImportacionProyecto = {
  fila: number
  codigo: string
  resultado: "creado" | "ya_existe" | "error"
  mensaje?: string
}

const sinTildes = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim()

const ENCABEZADOS = {
  codigo: ["CODIGO", "CODIGO DE PROYECTO", "PROYECTO", "CODIGO PROYECTO"],
  nombre: ["NOMBRE", "NOMBRE DEL PROYECTO", "DESCRIPCION"],
  empresa: ["EMPRESA", "GRUPO EMPRESARIAL", "NIT", "NIT EMPRESA", "CONSORCIO"],
  numero: ["NUMERO", "NO", "NO.", "N°", "NUMERO DEL PROYECTO", "NUMERO DE PROYECTO"],
} as const

/**
 * Lee las filas de la primera hoja (matriz de celdas, como la da XLSX con
 * header: 1). Busca la fila de encabezados en las primeras 10; sin columna de
 * código o de empresa devuelve el error.
 */
export function leerProyectosSoloPagos(matriz: unknown[][]): { filas: FilaProyectoSoloPagos[]; error: string | null } {
  let fila = -1
  let col: Record<keyof typeof ENCABEZADOS, number> = { codigo: -1, nombre: -1, empresa: -1, numero: -1 }
  for (let r = 0; r < Math.min(10, matriz.length) && fila < 0; r++) {
    const celdas = (matriz[r] ?? []).map((c) => sinTildes(String(c ?? "")))
    const buscar = (claves: readonly string[]) => celdas.findIndex((c) => (claves as readonly string[]).includes(c))
    const c = {
      codigo: buscar(ENCABEZADOS.codigo),
      nombre: buscar(ENCABEZADOS.nombre),
      empresa: buscar(ENCABEZADOS.empresa),
      numero: buscar(ENCABEZADOS.numero),
    }
    if (c.codigo >= 0 && c.empresa >= 0) {
      fila = r
      col = c
    }
  }
  if (fila < 0) return { filas: [], error: 'El Excel necesita las columnas "Código" y "Empresa" (y, si quieres, "Nombre").' }

  const filas: FilaProyectoSoloPagos[] = []
  for (let r = fila + 1; r < matriz.length; r++) {
    const celda = (i: number) => (i >= 0 ? String(matriz[r]?.[i] ?? "").trim() : "")
    let codigo = celda(col.codigo)
    const empresa = celda(col.empresa)
    if (!codigo && !empresa) continue
    const textoNumero = celda(col.numero)
    const numero = /^\d{1,3}$/.test(textoNumero) ? Number(textoNumero) : null
    if (numero != null) {
      const prefijo = new RegExp(`^0*${numero}-`)
      if (prefijo.test(codigo)) codigo = codigo.replace(prefijo, "")
    }
    filas.push({ fila: r + 1, codigo, nombre: celda(col.nombre) || codigo, empresa, numero })
  }
  return { filas, error: filas.length === 0 ? "El Excel no tiene filas con proyectos." : null }
}

/** La empresa de la fila: por NIT (solo los dígitos, con o sin DV) o por razón social. */
export function emparejarEmpresa<E extends { id: string; nit: string | null; razonSocial: string }>(texto: string, empresas: E[]): E | null {
  const digitos = texto.replace(/\D/g, "")
  if (digitos.length >= 6) {
    const porNit = empresas.find((e) => {
      const nit = (e.nit ?? "").replace(/\D/g, "")
      return nit === digitos || nit.slice(0, -1) === digitos || nit === digitos.slice(0, -1)
    })
    if (porNit) return porNit
  }
  const nombre = sinTildes(texto)
  return empresas.find((e) => sinTildes(e.razonSocial) === nombre) ?? null
}
