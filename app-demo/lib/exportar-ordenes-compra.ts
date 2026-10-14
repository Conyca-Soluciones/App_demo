// Descarga de Órdenes de compra a Excel, en la misma vista que se ve en
// pantalla: resumida (una fila por orden, con su valor total) o detallada (una
// fila por insumo de cada orden, con precios y valor). Trae TODAS las órdenes de
// la consulta (exportarOrdenesCompra en comprar-pedidos/actions.ts), no solo la
// página en pantalla.

import { ZONA_HORARIA } from "@/lib/fechas"
import { AZUL_MARCA_CONYCA, agregarEncabezadoMarca, obtenerBufferLogoConyca } from "@/lib/marca-conyca"
import { ESTADO_VISIBLE_BADGE, type EstadoOrdenVisible } from "@/lib/ordenes-compra-estado"
import { diaColombia, formatoCantidadExcel } from "@/lib/exportar-requisiciones"

export type VistaOrdenes = "resumida" | "detallada"

// Lo que el Excel necesita de cada orden (mismo contenido que OrdenCompraListado;
// no se importa de actions.ts, ver CLAUDE.md "boundary cliente/servidor").
export type OrdenExcel = {
  numero: number
  estadoVisible: EstadoOrdenVisible
  proyectoCodigo: string | null
  proyectoNombre: string | null
  proveedorNombre: string
  creadaPorNombre: string | null
  createdAt: string
  valorTotal: number
  lineas: {
    insumoCodigo: number | null
    insumoDescripcion: string
    um: string | null
    cantidad: number
    precioUnitario: number
    porcentajeDescuento: number
    porcentajeIva: number
    total: number
  }[]
}

type Columna = { titulo: string; ancho: number; formato?: string }

const MONEDA = '"$" #,##0;[Red]-"$" #,##0'
const PORCENTAJE = '0.##"%"'

const COLUMNAS_ORDEN: Columna[] = [
  { titulo: "N° orden", ancho: 10 },
  { titulo: "Proyecto", ancho: 34 },
  { titulo: "Proveedor", ancho: 36 },
  { titulo: "Estado", ancho: 12 },
  { titulo: "Creada por", ancho: 24 },
  { titulo: "Fecha", ancho: 12, formato: "dd/mm/yyyy" },
]

export const COLUMNAS_EXCEL_RESUMIDA: Columna[] = [...COLUMNAS_ORDEN, { titulo: "Valor total", ancho: 18, formato: MONEDA }]

export const COLUMNAS_EXCEL_DETALLADA: Columna[] = [
  ...COLUMNAS_ORDEN,
  { titulo: "Insumo", ancho: 48 },
  { titulo: "UM", ancho: 12 },
  { titulo: "Cantidad", ancho: 12 },
  { titulo: "Precio unitario", ancho: 16, formato: MONEDA },
  { titulo: "Descuento", ancho: 10, formato: PORCENTAJE },
  { titulo: "IVA", ancho: 8, formato: PORCENTAJE },
  { titulo: "Valor total", ancho: 18, formato: MONEDA },
]

// "AAAA-MM-DD" -> fecha de Excel a medianoche UTC (Excel no tiene zona horaria).
function fechaExcel(iso: string): Date {
  const [a, m, d] = diaColombia(iso).split("-").map(Number)
  return new Date(Date.UTC(a, m - 1, d))
}

function datosOrden(o: OrdenExcel): (string | number | Date)[] {
  return [
    o.numero,
    [o.proyectoCodigo, o.proyectoNombre].filter(Boolean).join(" — "),
    o.proveedorNombre,
    ESTADO_VISIBLE_BADGE[o.estadoVisible].label,
    o.creadaPorNombre ?? "",
    fechaExcel(o.createdAt),
  ]
}

// Filas de la hoja en el orden de las columnas de la vista. La detallada pone
// una fila por insumo (una orden sin líneas sale una vez, sin insumo).
export function filasExcelOrdenes(ordenes: OrdenExcel[], vista: VistaOrdenes): (string | number | Date | null)[][] {
  const filas: (string | number | Date | null)[][] = []
  for (const o of ordenes) {
    if (vista === "resumida") {
      filas.push([...datosOrden(o), o.valorTotal])
      continue
    }
    if (o.lineas.length === 0) {
      filas.push([...datosOrden(o), null, null, null, null, null, null, null])
      continue
    }
    for (const l of o.lineas) {
      filas.push([
        ...datosOrden(o),
        l.insumoCodigo != null ? `${l.insumoCodigo} - ${l.insumoDescripcion}` : l.insumoDescripcion,
        l.um ?? "",
        l.cantidad,
        l.precioUnitario,
        l.porcentajeDescuento,
        l.porcentajeIva,
        l.total,
      ])
    }
  }
  return filas
}

export async function descargarExcelOrdenes(ordenes: OrdenExcel[], vista: VistaOrdenes) {
  const ExcelJS = (await import("exceljs")).default
  const libro = new ExcelJS.Workbook()
  const hoja = libro.addWorksheet("Órdenes de compra")
  const columnas = vista === "resumida" ? COLUMNAS_EXCEL_RESUMIDA : COLUMNAS_EXCEL_DETALLADA
  const n = columnas.length

  const primera = agregarEncabezadoMarca(libro, hoja, {
    titulo: vista === "resumida" ? "Órdenes de compra (resumida)" : "Órdenes de compra (detallada)",
    numColumnas: n,
    bufferLogo: await obtenerBufferLogoConyca(),
  })

  const encabezado = hoja.getRow(primera)
  columnas.forEach((c, i) => {
    hoja.getColumn(i + 1).width = c.ancho
    const celda = encabezado.getCell(i + 1)
    celda.value = c.titulo
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } }
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL_MARCA_CONYCA } }
    celda.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
  })
  encabezado.height = 30

  const iCantidad = columnas.findIndex((c) => c.titulo === "Cantidad")
  const filas = filasExcelOrdenes(ordenes, vista)
  filas.forEach((valores, i) => {
    const fila = hoja.getRow(primera + 1 + i)
    valores.forEach((v, k) => {
      const celda = fila.getCell(k + 1)
      celda.value = v
      const formato = columnas[k].formato
      if (formato) celda.numFmt = formato
    })
    // Cantidad sin punto si es entera ("96"), con decimales si no (como requisiciones).
    const cantidad = iCantidad >= 0 ? valores[iCantidad] : null
    if (typeof cantidad === "number") fila.getCell(iCantidad + 1).numFmt = formatoCantidadExcel(cantidad)
  })

  // Encabezados fijos al bajar y filtro de Excel sobre la tabla.
  hoja.views = [{ state: "frozen", ySplit: primera }]
  hoja.autoFilter = { from: { row: primera, column: 1 }, to: { row: primera + Math.max(filas.length, 1), column: n } }

  const buffer = await libro.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `ordenes-compra-${vista}-${new Date().toLocaleDateString("en-CA", { timeZone: ZONA_HORARIA })}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
