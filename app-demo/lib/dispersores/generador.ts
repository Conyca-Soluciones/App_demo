// Port EXACTO de nucleo/generador.py de la consola de dispersores (Python):
// los archivos de cada banco.
//
//   Banco de Bogotá  plano de 250 caracteres  +  planilla para la plantilla
//   Bancolombia      plano PAB de 264         +  planilla para el conversor
//   Itaú             Excel que se sube al portal
//   Davivienda       Excel que se sube al portal
//
// El plano de Banco de Bogotá está verificado byte a byte contra un archivo
// real de Dispersion_Version_2.jar (tests/dispersores-regresion.test.ts).
// Los planos van en latin-1 con CRLF, igual que en Python. Los Excel tienen
// las mismas hojas, columnas, valores, formatos y anchos que los de openpyxl.
// NO cambiar posiciones, anchos ni rellenos.

import type ExcelJS from "exceljs"
import { BANCOLOMBIA, BOGOTA, DAVIVIENDA, ITAU, codigoDestino, tipoTransaccion } from "@/lib/dispersores/catalogos"
import { digitos, paraBanco } from "@/lib/dispersores/textos"

export class ErrorGeneracion extends Error {}

// ------------------------------------------------------------------ helpers

export function ceros(valor: unknown, ancho: number): string {
  const s = valor == null ? "" : String(valor).trim()
  if (s.length > ancho) throw new ErrorGeneracion(`'${s}' no cabe en ${ancho} posiciones`)
  return s.padStart(ancho, "0")
}

/** Alfanumérico. Los nombres se recortan (el recorte es cosmético). Los números NO pasan por aquí. */
export function blancos(valor: unknown, ancho: number): string {
  const s = valor == null ? "" : String(valor).trim()
  return s.slice(0, ancho).padEnd(ancho, " ")
}

/** Los dígitos tal cual, pero falla si no caben: recortar una cuenta manda la plata a otro lado. */
export function cabe(valor: unknown, ancho: number, campo: string, item = ""): string {
  const s = String(valor ?? "").replace(/\D/g, "")
  if (s.length > ancho) {
    const donde = item ? `item ${item}: ` : ""
    throw new ErrorGeneracion(
      `${donde}${campo} tiene ${s.length} digitos y el banco solo acepta ${ancho}. Valor: ${s}. ` +
        `Hay que corregirlo en la base, no lo puedo recortar sin cambiar a donde va la plata.`
    )
  }
  return s
}

/** Numérico con ceros a la izquierda. */
export function numero(valor: unknown, ancho: number, campo: string, item = ""): string {
  return cabe(valor, ancho, campo, item).padStart(ancho, "0")
}

/** Los valores ya vienen truncados a pesos: los centavos son 00. */
export function centavos(pesosEnteros: number, ancho: number): string {
  return ceros(`${Math.trunc(pesosEnteros)}00`, ancho)
}

export type CuentaDebitar = {
  apodo: string
  diminutivo: string
  banco: string
  tipoCuenta: string // AHORROS | CORRIENTE | ROTATIVO
  cuenta: string
  nit: string
  dv: string
  razonSocial: string
  correoItau: string
}

/** Lo que necesita un registro, independiente del banco. */
export type Renglon = {
  item: string
  documento: string
  tipoDoc: string
  dv: string // dígito de verificación, solo para NIT
  nombre: string
  nombres: string
  apellidos: string
  bancoDestino: string
  tipoCuenta: string
  cuenta: string
  valor: number
  referencia: string
  empresa: string
  proyecto: string
}

export type ClasePago = "PROVEEDORES" | "NOMINA" | "TRANSFERENCIAS" | "TERCEROS"

export type Tanda = {
  cuenta: CuentaDebitar
  renglones: Renglon[]
  semana: number | null
  clasePago: ClasePago
  secuencia: string
  fecha: string // AAAAMMDD
  esNomina: boolean
  truncado: string // centavos que se pierden al truncar a pesos ("" si nada)
}

export const totalTanda = (t: Tanda) => t.renglones.reduce((a, r) => a + r.valor, 0)

export function nombreBase(t: Pick<Tanda, "cuenta" | "semana" | "esNomina">): string {
  const s = t.semana ? `${t.cuenta.diminutivo}_SEM${t.semana}` : t.cuenta.diminutivo
  return s + (t.esNomina ? "_NOM" : "")
}

/** Todos los bancos piden el NIT del beneficiario CON dígito de verificación, menos Bancolombia. */
export function documentoDe(r: Renglon, pagador: string): string {
  const doc = digitos(r.documento)
  if (pagador === BANCOLOMBIA) return doc
  return r.dv ? doc + digitos(r.dv) : doc
}

// ---------------------------------------------------------- Banco de Bogotá
// Layout sacado del código de Dispersion_Version_2.jar.

const TIPO_ID_BOGOTA: Record<string, string | null> = { CC: "C", CE: "E", NIT: "N", PPT: null, PA: "P", TI: "T", RC: "R" }

const de = <T,>(tabla: Record<string, T>, clave: string): T | undefined => (Object.hasOwn(tabla, clave) ? tabla[clave] : undefined)

export function planoBogota(t: Tanda): string {
  const c = t.cuenta
  const tidEmp = de(TIPO_ID_BOGOTA, "NIT") ?? "N"
  const clase = de({ PROVEEDORES: "002", NOMINA: "001", TRANSFERENCIAS: "003" } as Record<string, string>, t.clasePago)
  const tipoCtaDisp = de({ CORRIENTE: "01", AHORROS: "02", ROTATIVO: "05" } as Record<string, string>, c.tipoCuenta)
  if (clase == null) throw new ErrorGeneracion(`clase de pago '${t.clasePago}' no válida para Banco de Bogota`)
  if (tipoCtaDisp == null) throw new ErrorGeneracion(`tipo de cuenta '${c.tipoCuenta}' no válido para Banco de Bogota`)

  const cab =
    "1" +
    ceros(t.fecha, 8) +
    ceros(t.renglones.length, 5) +
    centavos(totalTanda(t), 18) +
    tipoCtaDisp +
    ceros(numero(c.cuenta, tipoCtaDisp !== "05" ? 9 : 11, `la cuenta a debitar ${c.apodo}`), 17) +
    blancos(paraBanco(c.razonSocial), 40) +
    // Banco de Bogotá pide el NIT CON dígito de verificación (Bancolombia sin él).
    numero(c.nit + c.dv, 11, `el NIT de ${c.apodo}`) +
    clase +
    "0000" +
    ceros(t.fecha, 8) +
    "000" +
    tidEmp +
    " ".repeat(29) + " ".repeat(18) + " " + " " + " ".repeat(80)

  const lineas = [cab]
  for (const r of t.renglones) {
    const tid = de(TIPO_ID_BOGOTA, r.tipoDoc)
    if (tid == null) throw new ErrorGeneracion(`item ${r.item}: Banco de Bogota no acepta el tipo de documento '${r.tipoDoc}'`)
    const cod = codigoDestino(BOGOTA, r.bancoDestino)
    if (cod == null) throw new ErrorGeneracion(`item ${r.item}: no conozco el codigo de ${r.bancoDestino} para Banco de Bogota`)
    const [tt] = tipoTransaccion(BOGOTA, r.tipoCuenta, r.bancoDestino)
    if (tt == null) throw new ErrorGeneracion(`item ${r.item}: no pude resolver el tipo de transaccion`)
    lineas.push(
      "2" +
        tid +
        numero(documentoDe(r, BOGOTA), 11, "el documento", r.item) +
        blancos(paraBanco(r.nombre), 40) +
        tt +
        blancos(cabe(r.cuenta, 17, "la cuenta", r.item), 17) +
        centavos(r.valor, 18) +
        "A" +
        "000" +
        ceros(cod, 3) +
        "0001" +
        blancos(paraBanco(r.referencia), 80) +
        "0" +
        ceros("", 10) +
        "N" +
        " ".repeat(8) + " ".repeat(18) + " ".repeat(11) + " ".repeat(11) +
        "N" +
        " ".repeat(8)
    )
  }
  lineas.forEach((l, i) => {
    if (l.length !== 250) throw new ErrorGeneracion(`linea ${i + 1} quedo en ${l.length} caracteres, no 250`)
  })
  return lineas.join("\r\n") + "\r\n"
}

const COLUMNAS_BOGOTA = [
  "Nombre Beneficiario", "Tipo Identificacion", "Numero Identificacion",
  "Tipo Producto", "Numero Producto", "Codigo Compensacion",
  "Valor A Abonar", "Adenda Concepto De Pago", "Comprobante/Nro Factura",
  "Medio De Notificacion", "Celular", "Correo Electronico",
  "Comentarios Adicionales", "Tipo Movimiento",
]
const TIPO_ID_LARGO: Record<string, string> = {
  CC: "CEDULA_DE_CIUDADANIA", CE: "CEDULA_DE_EXTRANJERIA", NIT: "NIT_JURIDICO",
  PA: "PASAPORTE", TI: "TARJETA_DE_IDENTIDAD", RC: "REGISTRO_CIVIL",
}
const NOMBRE_CUENTA: Record<string, string> = { AHORROS: "AHORROS", CORRIENTE: "CORRIENTE" }

type ExcelJSModulo = typeof ExcelJS

function encabezados(ws: ExcelJS.Worksheet, fila: number, nombres: string[], anchoMinimo: number) {
  nombres.forEach((n, i) => {
    const c = ws.getCell(fila, i + 1)
    c.value = n
    c.font = { bold: true }
    ws.getColumn(i + 1).width = Math.max(anchoMinimo, n.length + 2)
  })
}

/** Las columnas B a P de PlantillaDispersion, para pegar en el .xlsm. */
export function planillaBogota(E: ExcelJSModulo, t: Tanda): ExcelJS.Workbook {
  const wb = new E.Workbook()
  const ws = wb.addWorksheet("PlantillaDispersion")
  encabezados(ws, 1, COLUMNAS_BOGOTA, 16)
  t.renglones.forEach((r, k) => {
    const j = k + 2
    const cod = codigoDestino(BOGOTA, r.bancoDestino) ?? ""
    const fila: (string | number)[] = [
      paraBanco(r.nombre).slice(0, 40), de(TIPO_ID_LARGO, r.tipoDoc) ?? "",
      documentoDe(r, BOGOTA), de(NOMBRE_CUENTA, r.tipoCuenta) ?? r.tipoCuenta,
      r.cuenta, cod, r.valor, paraBanco(r.referencia).slice(0, 80), "",
      "NO SE ENVIA INFORMACION", "", "", "", "A",
    ]
    fila.forEach((v, i) => {
      const cc = ws.getCell(j, i + 1)
      cc.value = v
      if ([3, 5, 6].includes(i + 1)) cc.numFmt = "@"
      if (i + 1 === 7) cc.numFmt = "0"
    })
  })
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 1, topLeftCell: "A2" }]
  return wb
}

// -------------------------------------------------------------- Bancolombia
// Layout deducido de un archivo real; por eso se genera también la planilla.

const TIPO_ID_PAB: Record<string, string> = { CC: "1", CE: "2", NIT: "3", TI: "4", PA: "5", PPT: "6" }
const CLASE_PAB: Record<string, string> = { PROVEEDORES: "220", NOMINA: "225", TERCEROS: "238" }
const TIPO_CTA_PAB: Record<string, string> = { AHORROS: "S", CORRIENTE: "D" }

export function planoBancolombia(t: Tanda): string {
  const c = t.cuenta
  const clase = de(CLASE_PAB, t.clasePago)
  const tipoCta = de(TIPO_CTA_PAB, c.tipoCuenta)
  if (clase == null) throw new ErrorGeneracion(`clase de pago '${t.clasePago}' no válida para Bancolombia`)
  if (tipoCta == null) throw new ErrorGeneracion(`tipo de cuenta '${c.tipoCuenta}' no válido para Bancolombia`)
  const desc = t.semana ? `${c.diminutivo} SEM${t.semana}` : c.diminutivo

  const cab =
    "1" +
    numero(c.nit, 15, `el NIT de ${c.apodo}`) +
    "I" + // aplicación inmediata
    " ".repeat(15) +
    ceros(clase, 3) +
    blancos(desc.slice(0, 10), 10) +
    ceros(t.fecha, 8) +
    blancos(t.secuencia.slice(0, 2), 2) +
    ceros(t.fecha, 8) +
    ceros(t.renglones.length, 6) +
    ceros("", 17) +
    centavos(totalTanda(t), 17) +
    numero(c.cuenta, 11, `la cuenta a debitar ${c.apodo}`) +
    tipoCta +
    " ".repeat(149)

  const lineas = [cab]
  for (const r of t.renglones) {
    const cod = codigoDestino(BANCOLOMBIA, r.bancoDestino)
    if (cod == null) throw new ErrorGeneracion(`item ${r.item}: no conozco el codigo de ${r.bancoDestino} para Bancolombia`)
    const [tt] = tipoTransaccion(BANCOLOMBIA, r.tipoCuenta, r.bancoDestino)
    if (tt == null) throw new ErrorGeneracion(`item ${r.item}: no pude resolver el tipo de transaccion`)
    const tid = de(TIPO_ID_PAB, r.tipoDoc)
    if (tid == null) throw new ErrorGeneracion(`item ${r.item}: Bancolombia no acepta el tipo de documento '${r.tipoDoc}'`)
    lineas.push(
      "6" +
        blancos(cabe(documentoDe(r, BANCOLOMBIA), 15, "el documento", r.item), 15) +
        blancos(paraBanco(r.nombre), 30) +
        ceros(cod, 9) +
        blancos(cabe(r.cuenta, 17, "la cuenta", r.item), 17) +
        "S" +
        tt +
        centavos(r.valor, 17) +
        ceros(t.fecha, 8) +
        blancos(paraBanco(r.referencia), 21) +
        tid +
        "00000" +
        " ".repeat(137)
    )
  }
  lineas.forEach((l, i) => {
    if (l.length !== 264) throw new ErrorGeneracion(`linea ${i + 1} quedo en ${l.length} caracteres, no 264`)
  })
  return lineas.join("\r\n") + "\r\n"
}

const COLUMNAS_BANCOLOMBIA = [
  "Tipo Documento", "Documento Beneficiario", "Nombre Beneficiario",
  "Tipo Transaccion", "Codigo Banco", "Cuenta Beneficiario",
  "Email", "Documento Autorizado", "Referencia",
  "Celular Beneficiario", "Valor Transaccion", "Fecha Aplicacion",
]

/** Estructura del conversor PAB (se guarda como .xlsx; el portal pide .xls). */
export function planillaBancolombia(E: ExcelJSModulo, t: Tanda): ExcelJS.Workbook {
  const wb = new E.Workbook()
  const ws = wb.addWorksheet("Hoja1")
  const c = t.cuenta
  const filaUno: (string | number)[] = [
    "Nit Pagador", c.nit, "Tipo de pago", Number(de(CLASE_PAB, t.clasePago)),
    "Aplicacion", "I", "Secuencia", t.secuencia,
    "Cuenta a debitar", c.cuenta, "Tipo cuenta", de(TIPO_CTA_PAB, c.tipoCuenta) ?? "",
    // Sin semana Python escribía "SEMNone" (f-string de None): se conserva igual.
    "Descripcion", `${c.diminutivo} SEM${t.semana ?? "None"}`,
  ]
  filaUno.forEach((v, i) => (ws.getCell(1, i + 1).value = v))
  encabezados(ws, 3, COLUMNAS_BANCOLOMBIA, 15)
  t.renglones.forEach((r, k) => {
    const j = k + 4
    const [tt] = tipoTransaccion(BANCOLOMBIA, r.tipoCuenta, r.bancoDestino)
    const fila: (string | number | null)[] = [
      de(TIPO_ID_PAB, r.tipoDoc) ?? "", documentoDe(r, BANCOLOMBIA),
      paraBanco(r.nombre).slice(0, 30), tt,
      codigoDestino(BANCOLOMBIA, r.bancoDestino) ?? "",
      r.cuenta, "", "", paraBanco(r.referencia).slice(0, 21), "",
      r.valor, t.fecha,
    ]
    fila.forEach((v, i) => {
      const cc = ws.getCell(j, i + 1)
      cc.value = v
      if ([1, 2, 4, 5, 6, 12].includes(i + 1)) cc.numFmt = "@"
      if (i + 1 === 11) cc.numFmt = "0"
    })
  })
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 3, topLeftCell: "A4" }]
  return wb
}

// --------------------------------------------------------------------- Itaú

const TIPO_ID_ITAU: Record<string, string> = { CC: "1", CE: "2", NIT: "3", TI: "4", PA: "5", PPT: "26" }
const COLUMNAS_ITAU = [
  "Fecha de envio", "Tipo de Identificacion",
  "Numero de Identificacion del Proveedor/tercero", "Nombre del tercero",
  "Codigo del banco del tercero", "Tipo de cuenta del tercero",
  "Numero de cuenta del tercero", "Valor", "Referencia", "Observacion",
  "E-mail del tercero", "Tipo de Cuenta Origen del cliente",
  "Numero de Cuenta Origen del cliente",
]

export function excelItau(E: ExcelJSModulo, t: Tanda): ExcelJS.Workbook {
  const wb = new E.Workbook()
  const ws = wb.addWorksheet("Hoja1")
  encabezados(ws, 1, COLUMNAS_ITAU, 16)
  const cd = t.cuenta
  const fecha = `${t.fecha.slice(6, 8)}/${t.fecha.slice(4, 6)}/${t.fecha.slice(0, 4)}`
  const tipoOrigen = de({ AHORROS: "AHO", CORRIENTE: "CTE" } as Record<string, string>, cd.tipoCuenta)
  if (tipoOrigen == null) throw new ErrorGeneracion(`tipo de cuenta '${cd.tipoCuenta}' no válido para Itau`)
  t.renglones.forEach((r, k) => {
    const j = k + 2
    const tid = de(TIPO_ID_ITAU, r.tipoDoc)
    if (tid == null) throw new ErrorGeneracion(`item ${r.item}: Itau no acepta el tipo de documento '${r.tipoDoc}'`)
    const cod = codigoDestino(ITAU, r.bancoDestino)
    if (cod == null) throw new ErrorGeneracion(`item ${r.item}: no conozco el codigo de ${r.bancoDestino} para Itau`)
    const [tt] = tipoTransaccion(ITAU, r.tipoCuenta, r.bancoDestino)
    const fila: (string | number | null)[] = [
      fecha, tid, documentoDe(r, ITAU), paraBanco(r.nombre).slice(0, 22), cod, tt,
      r.cuenta, r.valor, paraBanco(r.referencia).slice(0, 20), "",
      cd.correoItau, tipoOrigen, cd.cuenta,
    ]
    fila.forEach((v, i) => {
      const c = ws.getCell(j, i + 1)
      c.value = v
      if ([3, 5, 7, 13].includes(i + 1)) {
        c.numFmt = "@"
        c.alignment = { horizontal: "left" }
      }
      if (i + 1 === 8) c.numFmt = "0"
    })
  })
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 1, topLeftCell: "A2" }]
  return wb
}

// --------------------------------------------------------------- Davivienda

const TIPO_ID_DAVI: Record<string, string> = { CC: "01", CE: "02", NIT: "03", TI: "04", PA: "05" }
const COLUMNAS_DAVIVIENDA = [
  "Tipo de identificacion", "Numero de identificacion", "Nombre",
  "Apellido", "Codigo del Banco", "Tipo de Producto o Servicio",
  "Numero del Producto o Servicio", "Valor del pago o de la recarga",
  "Rreferencia", "Correo Electronico", "Descripcion o Detalle",
]

/** La referencia de Davivienda es numérica de 16: ITEM X SEMANA XX va en Descripción o Detalle. */
export function excelDavivienda(E: ExcelJSModulo, t: Tanda): ExcelJS.Workbook {
  const wb = new E.Workbook()
  const ws = wb.addWorksheet("Hoja1")
  encabezados(ws, 1, COLUMNAS_DAVIVIENDA, 16)
  t.renglones.forEach((r, k) => {
    const j = k + 2
    const tid = de(TIPO_ID_DAVI, r.tipoDoc)
    if (tid == null) throw new ErrorGeneracion(`item ${r.item}: Davivienda no acepta el tipo de documento '${r.tipoDoc}'`)
    const cod = codigoDestino(DAVIVIENDA, r.bancoDestino)
    if (cod == null) throw new ErrorGeneracion(`item ${r.item}: no conozco el codigo de ${r.bancoDestino} para Davivienda`)
    const [tt] = tipoTransaccion(DAVIVIENDA, r.tipoCuenta, r.bancoDestino)
    const nombres = r.nombres || paraBanco(r.nombre).slice(0, 40)
    const fila: (string | number | null)[] = [
      tid, documentoDe(r, DAVIVIENDA), nombres.slice(0, 40), (r.apellidos || "").slice(0, 40),
      cod, tt, r.cuenta, r.valor, "", "",
      paraBanco(r.referencia).slice(0, 40),
    ]
    fila.forEach((v, i) => {
      const c = ws.getCell(j, i + 1)
      c.value = v
      if ([1, 2, 5, 7].includes(i + 1)) {
        c.numFmt = "@"
        c.alignment = { horizontal: "left" }
      }
      if (i + 1 === 8) c.numFmt = "0"
    })
  })
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 1, topLeftCell: "A2" }]
  return wb
}

// ---------------------------------------------------------------- archivos

/** El texto en latin-1 (como `write_text(..., encoding="latin-1")`). Falla si hay un carácter que no cabe. */
export function aLatin1(texto: string): Uint8Array {
  const bytes = new Uint8Array(texto.length)
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i)
    if (c > 0xff) throw new ErrorGeneracion(`el carácter '${texto[i]}' no se puede escribir en latin-1`)
    bytes[i] = c
  }
  return bytes
}

export type ArchivoGenerado = { nombre: string; contenido: Uint8Array; tipo: string }

const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

/** Valida la tanda sin escribir nada (el "todo o nada" de api_generar). */
export function validarTanda(E: ExcelJSModulo, t: Tanda): void {
  const b = t.cuenta.banco
  if (b === BOGOTA) planoBogota(t)
  else if (b === BANCOLOMBIA) planoBancolombia(t)
  else if (b === ITAU) excelItau(E, t)
  else if (b === DAVIVIENDA) excelDavivienda(E, t)
  else throw new ErrorGeneracion(`no se generar archivos para ${b}`)
}

/** Los archivos de esa tanda, con los mismos nombres que la consola. */
export async function generarArchivos(E: ExcelJSModulo, t: Tanda): Promise<ArchivoGenerado[]> {
  const banco = t.cuenta.banco
  const base = nombreBase(t)
  const xlsx = async (wb: ExcelJS.Workbook) => new Uint8Array(await wb.xlsx.writeBuffer())
  if (banco === BOGOTA) {
    return [
      { nombre: `${base}.txt`, contenido: aLatin1(planoBogota(t)), tipo: "text/plain" },
      { nombre: `${base}_plantilla.xlsx`, contenido: await xlsx(planillaBogota(E, t)), tipo: TIPO_XLSX },
    ]
  }
  if (banco === BANCOLOMBIA) {
    return [
      { nombre: `${base}.txt`, contenido: aLatin1(planoBancolombia(t)), tipo: "text/plain" },
      { nombre: `${base}_conversor.xlsx`, contenido: await xlsx(planillaBancolombia(E, t)), tipo: TIPO_XLSX },
    ]
  }
  if (banco === ITAU) return [{ nombre: `${base}.xlsx`, contenido: await xlsx(excelItau(E, t)), tipo: TIPO_XLSX }]
  if (banco === DAVIVIENDA) return [{ nombre: `${base}.xlsx`, contenido: await xlsx(excelDavivienda(E, t)), tipo: TIPO_XLSX }]
  throw new ErrorGeneracion(`no se generar archivos para ${banco}`)
}

// ------------------------------------------------- avisos antes de generar

// Tope de los nombres por banco (servidor.py, dispersores()).
const TOPE: Record<string, number> = { [BOGOTA]: 40, [BANCOLOMBIA]: 30, [ITAU]: 22, [DAVIVIENDA]: 40 }

/** Los avisos de la tarjeta de cada dispersor en "Confirmar y generar". */
export function avisosDispersor(cuenta: CuentaDebitar, renglones: Renglon[]): string[] {
  const avisos: string[] = []
  const tope = de(TOPE, cuenta.banco) ?? 40
  if (cuenta.razonSocial.length > tope) {
    avisos.push(`el nombre del pagador se recorta a ${tope}: '${cuenta.razonSocial.slice(0, tope)}'`)
  }
  const largos = renglones.filter((r) => r.nombre.length > tope)
  if (largos.length) {
    avisos.push(`${largos.length} nombres se recortan a ${tope} caracteres, por ejemplo '${largos[0].nombre.slice(0, tope)}'`)
  }
  for (const r of renglones) {
    if (codigoDestino(cuenta.banco, r.bancoDestino) == null) {
      avisos.push(`item ${r.item}: no conozco el codigo de ${r.bancoDestino} para pagar desde ${cuenta.banco}`)
    }
    const [cod, motivo] = tipoTransaccion(cuenta.banco, r.tipoCuenta, r.bancoDestino)
    if (cod == null && motivo) avisos.push(`item ${r.item}: ${motivo}`)
  }
  return avisos
}
