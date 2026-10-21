// Plantilla de Excel de las requisiciones administrativas por PSE (cuando son
// muchos pagos): se descarga, se llena (máximo 50 filas) y se sube; cada fila
// es un ítem. Columnas del formato GF-F-018 que aplican a PSE: B-G, L-N y
// observaciones (sin banco, tipo ni número de cuenta).
//
// leerFilasReqAdminPse es lógica pura (pruebas en
// tests/requisiciones-admin.test.ts); descargarPlantillaReqAdminPse arma el
// archivo en el navegador.

import { leerNumero } from "@/lib/contratos"
import { ZONA_HORARIA } from "@/lib/fechas"
import { AZUL_MARCA_CONYCA, agregarEncabezadoMarca, obtenerBufferLogoConyca } from "@/lib/marca-conyca"
import {
  MAX_ITEMS_REQ_ADMIN,
  TIPOS_DOCUMENTO_PSE,
  itemVacio,
  limpiarNit,
  type ItemFormReqAdmin,
  type OpcionesReqAdmin,
  type ProyectoOpcion,
} from "@/lib/requisiciones-admin"

export const COLUMNAS_REQ_ADMIN_PSE = {
  grupo: "Grupo empresarial",
  factura: "Empresa que factura",
  nit: "NIT de la empresa que factura",
  titular: "Titular de la cuenta",
  tipoDocumento: "Tipo de documento",
  documento: "NIT o CC titular de la cuenta",
  concepto: "Concepto de la factura",
  proyecto: "Código de proyecto",
  valor: "Valor documento",
  observaciones: "Observaciones",
} as const

type Clave = keyof typeof COLUMNAS_REQ_ADMIN_PSE

const ORDEN: { clave: Clave; ancho: number }[] = [
  { clave: "grupo", ancho: 36 },
  { clave: "factura", ancho: 32 },
  { clave: "nit", ancho: 18 },
  { clave: "titular", ancho: 32 },
  { clave: "tipoDocumento", ancho: 12 },
  { clave: "documento", ancho: 18 },
  { clave: "concepto", ancho: 40 },
  { clave: "proyecto", ancho: 26 },
  { clave: "valor", ancho: 18 },
  { clave: "observaciones", ancho: 36 },
]

const normal = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")

const texto = (v: unknown) => (v == null ? "" : String(v).trim())

// En la lista del Excel cada proyecto sale por su código (o su nombre si no
// tiene).
export const codigoListaProyecto = (p: Pick<ProyectoOpcion, "codigo" | "nombre">) => p.codigo || p.nombre

export type ErrorFilaReqAdmin = { fila: number; mensaje: string }

/**
 * Lee las filas del Excel (como las da XLSX con `header: 1`). Busca la fila de
 * encabezados por "Grupo empresarial" y las columnas por nombre. Las filas
 * vacías se saltan; las demás tienen que venir completas.
 */
export function leerFilasReqAdminPse(
  filas: unknown[][],
  opciones: OpcionesReqAdmin
): { items: ItemFormReqAdmin[]; errores: ErrorFilaReqAdmin[] } {
  const iEncabezado = filas.findIndex((f) => (f ?? []).some((c) => normal(c) === normal(COLUMNAS_REQ_ADMIN_PSE.grupo)))
  if (iEncabezado < 0) {
    throw new Error('No se encontró la columna "Grupo empresarial". Usa la plantilla descargada desde la app.')
  }
  const encabezado = filas[iEncabezado].map(normal)
  const indices = Object.fromEntries(
    (Object.keys(COLUMNAS_REQ_ADMIN_PSE) as Clave[]).map((k) => [k, encabezado.indexOf(normal(COLUMNAS_REQ_ADMIN_PSE[k]))])
  ) as Record<Clave, number>
  const faltan = (Object.keys(COLUMNAS_REQ_ADMIN_PSE) as Clave[])
    .filter((k) => k !== "observaciones" && indices[k] < 0)
    .map((k) => `"${COLUMNAS_REQ_ADMIN_PSE[k]}"`)
  if (faltan.length > 0) throw new Error(`Faltan las columnas ${faltan.join(", ")}. Usa la plantilla de la app.`)

  const empresaPorNombre = new Map(opciones.empresas.map((e) => [normal(e.razonSocial), e.id]))
  const proyectoPorCodigo = new Map<string, string>()
  for (const p of opciones.proyectos) {
    proyectoPorCodigo.set(normal(codigoListaProyecto(p)), p.id)
    if (p.codigo) proyectoPorCodigo.set(normal(p.nombre), p.id)
  }
  const tipos = new Set<string>(TIPOS_DOCUMENTO_PSE)
  const celda = (f: unknown[], k: Clave) => (indices[k] >= 0 ? f[indices[k]] : undefined)

  const items: ItemFormReqAdmin[] = []
  const errores: ErrorFilaReqAdmin[] = []
  for (let i = iEncabezado + 1; i < filas.length; i++) {
    const f = filas[i] ?? []
    if (ORDEN.every((c) => texto(celda(f, c.clave)) === "")) continue
    const fila = i + 1
    const error = (mensaje: string) => errores.push({ fila, mensaje })

    const empresaId = empresaPorNombre.get(normal(celda(f, "grupo")))
    if (!empresaId) {
      error("Elige el grupo empresarial de la lista.")
      continue
    }
    const proyectoId = proyectoPorCodigo.get(normal(celda(f, "proyecto")))
    if (!proyectoId) {
      error("Elige el código de proyecto de la lista.")
      continue
    }
    const tipo = texto(celda(f, "tipoDocumento")).toUpperCase()
    if (!tipos.has(tipo)) {
      error("El tipo de documento debe ser CC, NIT, PPT o CE.")
      continue
    }
    const crudo = celda(f, "valor")
    const valor = typeof crudo === "number" ? crudo : leerNumero(texto(crudo))
    if (valor == null || !Number.isFinite(valor) || valor <= 0) {
      error("El valor debe ser un número mayor que cero.")
      continue
    }
    const nit = limpiarNit(texto(celda(f, "nit")))
    if (!/^[0-9]+(-[0-9])?$/.test(nit)) {
      error("El NIT de la empresa que factura solo lleva números (y el dígito de verificación después de un guion).")
      continue
    }
    const documento = texto(celda(f, "documento")).replace(/\D/g, "")
    const faltante = !texto(celda(f, "factura"))
      ? "la empresa que factura"
      : !texto(celda(f, "titular"))
        ? "el titular de la cuenta"
        : !documento
          ? "el NIT o CC del titular"
          : !texto(celda(f, "concepto"))
            ? "el concepto de la factura"
            : null
    if (faltante) {
      error(`Falta ${faltante}.`)
      continue
    }

    items.push({
      ...itemVacio(),
      empresaId,
      facturaNombre: texto(celda(f, "factura")),
      facturaNit: nit,
      titularNombre: texto(celda(f, "titular")),
      titularTipoDocumento: tipo,
      titularDocumento: documento,
      concepto: texto(celda(f, "concepto")),
      proyectoId,
      valor: String(Math.round(valor * 100) / 100).replace(".", ","),
      observaciones: texto(celda(f, "observaciones")),
    })
  }
  return { items, errores }
}

/** El libro de la plantilla (sin descargarlo): separado para poder probarlo. */
export async function construirPlantillaReqAdminPse(opciones: OpcionesReqAdmin, bufferLogo: ArrayBuffer | null) {
  const ExcelJS = (await import("exceljs")).default
  const libro = new ExcelJS.Workbook()
  const hoja = libro.addWorksheet("Pagos PSE")
  const n = ORDEN.length

  const primera = agregarEncabezadoMarca(libro, hoja, {
    titulo: "Requisición administrativa · PSE",
    numColumnas: n,
    bufferLogo,
  })

  // Listas de los desplegables en una hoja oculta.
  const hojaListas = libro.addWorksheet("Listas", { state: "veryHidden" })
  const listas: string[][] = [
    opciones.empresas.map((e) => e.razonSocial),
    [...TIPOS_DOCUMENTO_PSE],
    opciones.proyectos.map(codigoListaProyecto),
  ]
  listas.forEach((valores, c) => valores.forEach((v, r) => (hojaListas.getRow(r + 1).getCell(c + 1).value = v)))
  const rango = (c: number) => {
    const letra = String.fromCharCode(65 + c)
    return `Listas!$${letra}$1:$${letra}$${Math.max(listas[c].length, 1)}`
  }
  const listaDe: Partial<Record<Clave, string>> = { grupo: rango(0), tipoDocumento: rango(1), proyecto: rango(2) }

  ORDEN.forEach((c, i) => (hoja.getColumn(i + 1).width = c.ancho))
  const encabezado = hoja.getRow(primera)
  ORDEN.forEach((c, i) => {
    const celda = encabezado.getCell(i + 1)
    celda.value = COLUMNAS_REQ_ADMIN_PSE[c.clave]
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } }
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL_MARCA_CONYCA } }
    celda.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
  })
  encabezado.height = 32

  for (let k = 0; k < MAX_ITEMS_REQ_ADMIN; k++) {
    const fila = hoja.getRow(primera + 1 + k)
    ORDEN.forEach((c, i) => {
      const celda = fila.getCell(i + 1)
      const lista = listaDe[c.clave]
      if (lista) celda.dataValidation = { type: "list", allowBlank: true, formulae: [lista] }
      if (c.clave === "valor") celda.numFmt = "#,##0.00"
      if (c.clave === "nit" || c.clave === "documento") celda.numFmt = "@"
    })
  }
  hoja.views = [{ state: "frozen", ySplit: primera }]
  return libro
}

export async function descargarPlantillaReqAdminPse(opciones: OpcionesReqAdmin) {
  const libro = await construirPlantillaReqAdminPse(opciones, await obtenerBufferLogoConyca())
  const buffer = await libro.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `requisicion-administrativa-pse-${new Date().toLocaleDateString("en-CA", { timeZone: ZONA_HORARIA })}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
