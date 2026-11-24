// Descarga de Requisiciones por comprar a Excel (decisión del usuario, 2026-11-24): una
// fila por insumo de lo consultado (lo mismo que se ve en la tabla) y, si la requisición
// tiene anexos, un enlace fijo para verlos (/almacen/comprar-pedidos/anexos/<id>, pide la
// sesión). Se arma en el navegador con ExcelJS.

import { hoyColombia } from "@/lib/fechas"
import { abreviaturaUnidad } from "@/lib/unidades"
import { AZUL_MARCA_CONYCA, agregarEncabezadoMarca, obtenerBufferLogoConyca } from "@/lib/marca-conyca"
import { diaColombia, formatoCantidadExcel } from "@/lib/exportar-requisiciones"
import type { PedidoParaComprar } from "@/app/(app)/almacen/comprar-pedidos/actions"

// A y B juntas tienen que ser más anchas que el logo del encabezado (si no, el logo
// tapa el título): por eso REF y Proyecto van primero.
export const COLUMNAS_EXCEL_COMPRAS = [
  { titulo: "REF", ancho: 18 },
  { titulo: "Proyecto", ancho: 28 },
  { titulo: "Urgente", ancho: 9 },
  { titulo: "Ítem del presupuesto", ancho: 14 },
  { titulo: "Código insumo", ancho: 10 },
  { titulo: "Insumo", ancho: 48 },
  { titulo: "UM", ancho: 8 },
  { titulo: "Cantidad por comprar", ancho: 12 },
  { titulo: "Cantidad pedida", ancho: 12 },
  { titulo: "Vr. unitario proyectado", ancho: 16 },
  { titulo: "Solicitante", ancho: 22 },
  { titulo: "Fecha de requisición", ancho: 13 },
  { titulo: "Fecha requerida", ancho: 13 },
  { titulo: "Dirección de entrega", ancho: 30 },
  { titulo: "Observaciones", ancho: 40 },
  { titulo: "Anexos", ancho: 14 },
] as const

// "AAAA-MM-DD" -> fecha de Excel (medianoche UTC: así el día no se corre).
function fechaExcel(ymd: string | null): Date | null {
  if (!ymd) return null
  const [a, m, d] = ymd.slice(0, 10).split("-").map(Number)
  return new Date(Date.UTC(a, m - 1, d))
}

/** Lo que va en cada celda (sin estilos): separado para poder probarlo. */
export function valoresFilaCompras(p: PedidoParaComprar, anexos: number) {
  return {
    ref: p.requisicionCodigo ?? (p.requisicionNumero != null ? String(p.requisicionNumero) : ""),
    urgente: p.urgente ? "Sí" : "",
    proyecto: p.proyectoTexto ?? "",
    item: p.itemCodigo ?? "",
    codigo: p.insumoCodigo ?? null,
    insumo: p.insumoDescripcion,
    um: abreviaturaUnidad(p.um),
    porComprar: p.cantidadPendiente,
    pedida: p.cantidad,
    valor: p.valorUnitarioProyectado,
    solicitante: p.solicitadoPorNombre ?? "",
    fechaPedido: fechaExcel(diaColombia(p.fechaPedido)),
    fechaRequerida: fechaExcel(p.fechaRequerida),
    direccion: p.direccionEntrega ?? "",
    observaciones: p.observaciones ?? "",
    anexos: anexos > 0 ? (anexos === 1 ? "Ver anexo" : `Ver anexos (${anexos})`) : "",
  }
}

export async function descargarExcelCompras(pedidos: PedidoParaComprar[], anexosPorRequisicion: Record<string, number>, origenUrl: string) {
  const ExcelJS = (await import("exceljs")).default
  const libro = new ExcelJS.Workbook()
  const hoja = libro.addWorksheet("Requisiciones por comprar")
  const n = COLUMNAS_EXCEL_COMPRAS.length

  const primera = agregarEncabezadoMarca(libro, hoja, {
    titulo: "Requisiciones por comprar",
    numColumnas: n,
    bufferLogo: await obtenerBufferLogoConyca(),
  })

  COLUMNAS_EXCEL_COMPRAS.forEach((c, i) => (hoja.getColumn(i + 1).width = c.ancho))
  const encabezado = hoja.getRow(primera)
  COLUMNAS_EXCEL_COMPRAS.forEach((c, i) => {
    const celda = encabezado.getCell(i + 1)
    celda.value = c.titulo
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } }
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL_MARCA_CONYCA } }
    celda.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
  })
  encabezado.height = 30

  pedidos.forEach((p, i) => {
    const fila = hoja.getRow(primera + 1 + i)
    const anexos = anexosPorRequisicion[p.requisicionId] ?? 0
    const v = valoresFilaCompras(p, anexos)
    const valores = [
      v.ref, v.proyecto, v.urgente, v.item, v.codigo, v.insumo, v.um, v.porComprar, v.pedida, v.valor,
      v.solicitante, v.fechaPedido, v.fechaRequerida, v.direccion, v.observaciones,
    ]
    valores.forEach((x, k) => (fila.getCell(k + 1).value = x as never))
    fila.getCell(6).alignment = { wrapText: true, vertical: "top" }
    fila.getCell(15).alignment = { wrapText: true, vertical: "top" }
    fila.getCell(8).numFmt = formatoCantidadExcel(v.porComprar)
    fila.getCell(9).numFmt = formatoCantidadExcel(v.pedida)
    if (v.urgente) fila.getCell(3).font = { bold: true, color: { argb: "FFC0392B" } }
    if (anexos > 0) {
      const celda = fila.getCell(16)
      celda.value = { text: v.anexos, hyperlink: `${origenUrl}/almacen/comprar-pedidos/anexos/${p.requisicionId}` }
      celda.font = { color: { argb: "FF1F5FBF" }, underline: true }
    }
  })
  hoja.getColumn(10).numFmt = "$ #,##0"
  hoja.getColumn(12).numFmt = "dd/mm/yyyy"
  hoja.getColumn(13).numFmt = "dd/mm/yyyy"

  hoja.views = [{ state: "frozen", ySplit: primera }]
  hoja.autoFilter = { from: { row: primera, column: 1 }, to: { row: primera + Math.max(pedidos.length, 1), column: n } }

  const buffer = await libro.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `requisiciones-por-comprar-${hoyColombia()}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
