// Port de pruebas/test_regresion.py de la consola de dispersores (Python).
// La primera prueba es la única que demuestra que el formato es CORRECTO (y no
// solo consistente): el plano de Banco de Bogotá tiene que reproducir byte a
// byte el archivo real que produjo Dispersion_Version_2.jar. Los archivos de
// oro tienen datos reales: viven en referencias/dispersores/oro (fuera de git);
// sin ellos esas pruebas se saltan, igual que en Python.

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import * as XLSX from "xlsx"
import ExcelJS from "exceljs"
import { BANCOLOMBIA, BOGOTA, DAVIVIENDA, ITAU, codigoDestino, tipoTransaccion } from "@/lib/dispersores/catalogos"
import {
  aLatin1,
  avisosDispersor,
  excelDavivienda,
  excelItau,
  generarArchivos,
  nombreBase,
  planillaBancolombia,
  planillaBogota,
  planoBancolombia,
  planoBogota,
  totalTanda,
  type CuentaDebitar,
  type Renglon,
  type Tanda,
} from "@/lib/dispersores/generador"
import { aPesos, enLetras, paraBanco, pesos } from "@/lib/dispersores/textos"

const ORO = path.join(process.cwd(), "referencias", "dispersores", "oro")
const XLSM = path.join(ORO, "BONOS_ADM_CONYCA.xlsm")
const TXT = path.join(ORO, "BONOS_CONYCA_AD.txt")
const hayOro = existsSync(XLSM) && existsSync(TXT)

function casoBogota(): { tanda: Tanda; esperado: string } {
  const libro = XLSX.read(readFileSync(XLSM), { type: "buffer" })
  const ws = libro.Sheets["PlantillaDispersion"]
  const v = (r: number, c: number) => ws[XLSX.utils.encode_cell({ r: r - 1, c: c - 1 })]?.v
  const nit = String(v(7, 6))
  const cuenta: CuentaDebitar = {
    apodo: "oro", diminutivo: "ORO", banco: BOGOTA,
    tipoCuenta: String(v(7, 7)), cuenta: String(v(7, 8)),
    nit: nit.slice(0, -1), dv: nit.slice(-1), razonSocial: String(v(7, 4)), correoItau: "",
  }
  const renglones: Renglon[] = []
  for (let r = 9; v(r, 2); r++) {
    renglones.push({
      item: String(r), documento: String(v(r, 4)), dv: "", tipoDoc: "CC",
      nombre: String(v(r, 2)), nombres: "", apellidos: "",
      bancoDestino: String(v(r, 7)), // '023-BANCO DE OCCIDENTE'
      tipoCuenta: String(v(r, 5)), cuenta: String(v(r, 6)),
      valor: Math.trunc(Number(v(r, 8))), referencia: "", empresa: "", proyecto: "",
    })
  }
  const tanda: Tanda = {
    cuenta, renglones, semana: null, clasePago: "PROVEEDORES", secuencia: "A1",
    fecha: "20260804", esNomina: false, truncado: "",
  }
  // latin-1, sin traducir saltos de línea (newline="")
  return { tanda, esperado: readFileSync(TXT).toString("latin1") }
}

describe.skipIf(!hayOro)("Banco de Bogotá contra el archivo real del banco", () => {
  it("reproduce byte a byte el archivo del banco", () => {
    const { tanda, esperado } = casoBogota()
    const obtenido = planoBogota(tanda)
    expect(obtenido.length).toBe(esperado.length)
    const a = obtenido.split("\r\n")
    const b = esperado.split("\r\n")
    a.forEach((linea, n) => {
      if (linea === b[n]) return
      for (let col = 0; col < linea.length; col++) {
        if (linea[col] !== b[n][col]) {
          throw new Error(`linea ${n + 1}, columna ${col + 1}: esperaba ${JSON.stringify(b[n][col])} y salio ${JSON.stringify(linea[col])}`)
        }
      }
      throw new Error(`linea ${n + 1} difiere en longitud`)
    })
    // y en bytes (latin-1) también
    expect(Buffer.from(aLatin1(obtenido)).equals(readFileSync(TXT))).toBe(true)
  })

  it("todo registro mide 250", () => {
    const { tanda } = casoBogota()
    for (const l of planoBogota(tanda).split("\r\n").slice(0, -1)) expect(l.length).toBe(250)
  })

  it("el total de la cabecera es la suma", () => {
    const { tanda } = casoBogota()
    const lineas = planoBogota(tanda).split("\r\n").slice(0, -1)
    const total = Number(lineas[0].slice(14, 32))
    const suma = lineas.filter((l) => l[0] === "2").reduce((s, l) => s + Number(l.slice(72, 90)), 0)
    expect(total).toBe(suma)
    expect(total).toBe(totalTanda(tanda) * 100)
    expect(Number(lineas[0].slice(9, 14))).toBe(tanda.renglones.length)
  })
})

describe("tipo de transacción", () => {
  it.each([
    [BOGOTA, "AHORROS", "BANCOLOMBIA", "02"],
    [BOGOTA, "CORRIENTE", "BANCOLOMBIA", "01"],
    [BANCOLOMBIA, "AHORROS", "NEQUI", "37"],
    [BANCOLOMBIA, "CORRIENTE", "BBVA", "27"],
    [ITAU, "AHORROS", "BANCOLOMBIA", "AHO"],
    [ITAU, "CORRIENTE", "BANCOLOMBIA", "CTE"],
    [DAVIVIENDA, "AHORROS", "BANCOLOMBIA", "CA"],
    [DAVIVIENDA, "CORRIENTE", "BANCOLOMBIA", "CC"],
    // la única excepción: Davivienda usa DP para DaviPlata
    [DAVIVIENDA, "AHORROS", "DAVIPLATA", "DP"],
    [DAVIVIENDA, "CORRIENTE", "DAVIPLATA", "DP"],
    [BOGOTA, "AHORROS", "DAVIPLATA", "02"],
  ])("%s %s %s -> %s", (pagador, tipo, destino, esperado) => {
    expect(tipoTransaccion(pagador, tipo, destino)[0]).toBe(esperado)
  })
})

describe("código del banco destino", () => {
  it.each([
    [BOGOTA, "BANCOLOMBIA", "007"],
    [BANCOLOMBIA, "BANCOLOMBIA", "000001007"],
    [DAVIVIENDA, "BANCOLOMBIA", "7"],
    [ITAU, "BANCOLOMBIA", "007"],
    // Itaú se llama a sí mismo 6 y a los demás les dice 14
    [ITAU, "ITAU", "006"],
    [BOGOTA, "ITAU", "014"],
    [BANCOLOMBIA, "NU BANK", "000001809"],
  ])("%s %s -> %s", (pagador, destino, esperado) => {
    expect(codigoDestino(pagador, destino)).toBe(esperado)
  })

  it("combinaciones sin código avisan", () => {
    expect(codigoDestino(ITAU, "DAVIPLATA")).toBeNull()
    expect(codigoDestino(ITAU, "CONFIAR COOPERATIVA FINANCIERA")).toBeNull()
  })

  it.each([[BOGOTA, "070"], [BANCOLOMBIA, "000001070"], [ITAU, "070"], [DAVIVIENDA, "70"]])("Lulo Bank en %s es %s", (p, e) => {
    expect(codigoDestino(p, "LULO BANK")).toBe(e)
  })

  it.each([[BOGOTA, "809"], [BANCOLOMBIA, "000001809"], [ITAU, "809"], [DAVIVIENDA, "809"]])("Nu Bank en %s es %s", (p, e) => {
    expect(codigoDestino(p, "NU BANK")).toBe(e)
    expect(codigoDestino(p, "NU")).toBe(e)
  })

  it("aguanta '023-BANCO DE OCCIDENTE' y un código que no está en el catálogo", () => {
    expect(codigoDestino(BOGOTA, "023-BANCO DE OCCIDENTE")).toBe("023")
    expect(codigoDestino(BANCOLOMBIA, "999-OTRO")).toBe("000001999")
    expect(codigoDestino(DAVIVIENDA, "045-OTRO")).toBe("45")
    expect(codigoDestino(BOGOTA, "constructor")).toBeNull()
  })

  it("Nequi y DaviPlata del mismo número dan códigos distintos", () => {
    expect(codigoDestino(ITAU, "NEQUI")).toBe("507")
    expect(codigoDestino(ITAU, "DAVIPLATA")).toBeNull()
  })
})

describe("textos", () => {
  it("para el banco: sin tildes, conserva la Ñ, sin caracteres raros", () => {
    expect(paraBanco("  José  Peña_Ríos / Ltda.  ")).toBe("JOSE PEÑA RIOS   LTDA.")
    expect(paraBanco("Ü ñandú")).toBe("U ÑANDU")
  })
  it("pesos y truncado", () => {
    expect(pesos(1234567)).toBe("1.234.567")
    expect(aPesos(3501.8)).toBe(3501)
  })
  it("total en letras como el soporte de Python", () => {
    expect(enLetras(0)).toBe("CERO PESOS")
    expect(enLetras(1)).toBe("UN PESOS")
    expect(enLetras(21)).toBe("VEINTIUN PESOS")
    expect(enLetras(1_000_000)).toBe("UN MILLON PESOS")
    expect(enLetras(2_501_100)).toBe("DOS MILLONES QUINIENTOS UN MIL CIEN PESOS")
    expect(enLetras(1_500_000_000)).toBe("MIL QUINIENTOS MILLONES PESOS")
  })
})

// ------------------------------------------------------ tandas de prueba

const CUENTAS: Record<string, CuentaDebitar> = {
  [BOGOTA]: { apodo: "PRUEBA BOGOTA", diminutivo: "PRBB", banco: BOGOTA, tipoCuenta: "CORRIENTE", cuenta: "123456789", nit: "900000001", dv: "1", razonSocial: "EMPRESA DE PRUEBAS", correoItau: "" },
  [BANCOLOMBIA]: { apodo: "PRUEBA BANCOLOMBIA", diminutivo: "PRBC", banco: BANCOLOMBIA, tipoCuenta: "CORRIENTE", cuenta: "12345678901", nit: "900000001", dv: "1", razonSocial: "EMPRESA DE PRUEBAS", correoItau: "" },
  [ITAU]: { apodo: "PRUEBA ITAU", diminutivo: "PRIT", banco: ITAU, tipoCuenta: "CORRIENTE", cuenta: "123456789", nit: "900000001", dv: "1", razonSocial: "EMPRESA DE PRUEBAS", correoItau: "tesoreria@prueba.co" },
  [DAVIVIENDA]: { apodo: "PRUEBA DAVIVIENDA", diminutivo: "PRDA", banco: DAVIVIENDA, tipoCuenta: "AHORROS", cuenta: "123456789012", nit: "900000001", dv: "1", razonSocial: "EMPRESA DE PRUEBAS", correoItau: "" },
}

const renglon = (p: Partial<Renglon>): Renglon => ({
  item: "1", documento: "111", tipoDoc: "CC", dv: "", nombre: "ANA PEREZ", nombres: "", apellidos: "",
  bancoDestino: "BANCOLOMBIA", tipoCuenta: "AHORROS", cuenta: "1", valor: 100000, referencia: "ITEM 1 SEMANA 43",
  empresa: "CONSORCIO A", proyecto: "100-PP-UNO", ...p,
})

const tanda = (banco: string, renglones: Renglon[]): Tanda => ({
  cuenta: CUENTAS[banco], renglones, semana: 43, clasePago: "PROVEEDORES", secuencia: "A1",
  fecha: "20261023", esNomina: false, truncado: "",
})

describe("Bancolombia PAB", () => {
  it("cada línea mide 264 y la cabecera trae el total y la secuencia", () => {
    const t = tanda(BANCOLOMBIA, [renglon({}), renglon({ item: "2", documento: "860032550", tipoDoc: "NIT", dv: "7", valor: 250000 })])
    const lineas = planoBancolombia(t).split("\r\n").slice(0, -1)
    for (const l of lineas) expect(l.length).toBe(264)
    expect(lineas[0].slice(0, 17)).toBe("1000000900000001I")
    expect(lineas[0].slice(53, 55)).toBe("A1")
    expect(Number(lineas[0].slice(86, 103))).toBe(35000000)
    // Bancolombia: el NIT del beneficiario SIN dígito de verificación
    expect(lineas[2].slice(1, 16)).toBe("860032550      ")
  })
})

describe("NIT con dígito de verificación", () => {
  it("Bogotá sí lo pega", () => {
    const t = tanda(BOGOTA, [renglon({ documento: "860032550", tipoDoc: "NIT", dv: "7" })])
    expect(planoBogota(t).split("\r\n")[1].slice(2, 13)).toBe("08600325507")
  })
})

describe("nunca se recorta una cuenta ni un documento", () => {
  it("una cuenta de 18 dígitos falla", () => {
    expect(() => planoBogota(tanda(BOGOTA, [renglon({ cuenta: "1".repeat(18) })]))).toThrow(/la cuenta tiene 18 digitos/)
  })
  it("Bogotá no acepta PPT", () => {
    expect(() => planoBogota(tanda(BOGOTA, [renglon({ tipoDoc: "PPT" })]))).toThrow(/no acepta el tipo de documento 'PPT'/)
  })
})

describe("Excel de los bancos", () => {
  it("Itaú: columnas, formato de texto y cuenta origen", () => {
    const ws = excelItau(ExcelJS, tanda(ITAU, [renglon({})])).getWorksheet("Hoja1")!
    expect(ws.getCell(1, 3).value).toBe("Numero de Identificacion del Proveedor/tercero")
    expect(ws.getCell(2, 1).value).toBe("23/10/2026")
    expect(ws.getCell(2, 5).value).toBe("007")
    expect(ws.getCell(2, 5).numFmt).toBe("@")
    expect(ws.getCell(2, 8).value).toBe(100000)
    expect(ws.getCell(2, 11).value).toBe("tesoreria@prueba.co")
    expect(ws.getCell(2, 12).value).toBe("CTE")
    expect(ws.getColumn(3).width).toBe("Numero de Identificacion del Proveedor/tercero".length + 2)
  })
  it("Davivienda: la referencia va en Descripción o Detalle", () => {
    const ws = excelDavivienda(ExcelJS, tanda(DAVIVIENDA, [renglon({ bancoDestino: "DAVIPLATA" })])).getWorksheet("Hoja1")!
    expect(ws.getCell(2, 1).value).toBe("01")
    expect(ws.getCell(2, 5).value).toBe("51")
    expect(ws.getCell(2, 6).value).toBe("DP")
    expect(ws.getCell(2, 11).value).toBe("ITEM 1 SEMANA 43")
  })
  it("planilla de Bogotá y conversor de Bancolombia", () => {
    const b = planillaBogota(ExcelJS, tanda(BOGOTA, [renglon({})])).getWorksheet("PlantillaDispersion")!
    expect(b.getCell(2, 2).value).toBe("CEDULA_DE_CIUDADANIA")
    expect(b.getCell(2, 10).value).toBe("NO SE ENVIA INFORMACION")
    const c = planillaBancolombia(ExcelJS, tanda(BANCOLOMBIA, [renglon({})])).getWorksheet("Hoja1")!
    expect(c.getCell(1, 4).value).toBe(220)
    expect(c.getCell(1, 14).value).toBe("PRBC SEM43")
    expect(c.getCell(4, 5).value).toBe("000001007")
  })
})

describe("archivos de una tanda", () => {
  it("mismos nombres que la consola", async () => {
    const nombres = async (b: string) => (await generarArchivos(ExcelJS, tanda(b, [renglon({})]))).map((a) => a.nombre)
    expect(await nombres(BOGOTA)).toEqual(["PRBB_SEM43.txt", "PRBB_SEM43_plantilla.xlsx"])
    expect(await nombres(BANCOLOMBIA)).toEqual(["PRBC_SEM43.txt", "PRBC_SEM43_conversor.xlsx"])
    expect(await nombres(ITAU)).toEqual(["PRIT_SEM43.xlsx"])
    expect(await nombres(DAVIVIENDA)).toEqual(["PRDA_SEM43.xlsx"])
    expect(nombreBase({ cuenta: CUENTAS[BOGOTA], semana: 43, esNomina: true })).toBe("PRBB_SEM43_NOM")
  })
  it("avisos de nombres recortados y bancos sin código", () => {
    const avisos = avisosDispersor(CUENTAS[ITAU], [renglon({ nombre: "A".repeat(30) }), renglon({ item: "2", bancoDestino: "DAVIPLATA" })])
    expect(avisos.some((a) => a.includes("se recortan a 22"))).toBe(true)
    expect(avisos.some((a) => a.includes("item 2: no conozco el codigo de DAVIPLATA"))).toBe(true)
  })
})
