import { describe, expect, it } from "vitest"
import {
  MAX_ITEMS_REQ_ADMIN,
  itemFormDesdeDetalle,
  itemParaGuardar,
  itemParaMetodo,
  itemVacio,
  limpiarNit,
  mapDetalleReqAdmin,
  totalItems,
  validarItemReqAdmin,
  validarRequisicionAdmin,
  valorItem,
  type ItemFormReqAdmin,
  type OpcionesReqAdmin,
} from "@/lib/requisiciones-admin"
import { COLUMNAS_REQ_ADMIN_PSE as C, leerFilasReqAdminPse } from "@/lib/excel-req-admin-pse"
import { construirModulos, evaluarRuta, type PermisosRol } from "@/lib/pestanas"
import { mapPago } from "@/lib/pagos-db"

const transferencia = (p: Partial<ItemFormReqAdmin> = {}): ItemFormReqAdmin => ({
  ...itemVacio(),
  empresaId: "e1",
  terceroFacturaId: "t1",
  facturaNombre: "FERRETERIA SAS",
  facturaNit: "800123456-7",
  titularNombre: "FERRETERIA SAS",
  titularTipoDocumento: "NIT",
  titularDocumento: "800123456",
  cuentaId: "c1",
  cuentaTexto: "BANCOLOMBIA · Ahorros · •••••8901",
  cuentaVerificada: true,
  concepto: "Papelería",
  proyectoId: "p1",
  valor: "1.250.000,50",
  ...p,
})

const pse = (p: Partial<ItemFormReqAdmin> = {}): ItemFormReqAdmin => ({
  ...itemVacio(),
  empresaId: "e1",
  facturaNombre: "Secretaría de Hacienda",
  facturaNit: "899.999.061-9",
  titularNombre: "Distrito",
  titularTipoDocumento: "NIT",
  titularDocumento: "899.999.061",
  concepto: "Predial",
  proyectoId: "p1",
  valor: "50000",
  ...p,
})

describe("validación de ítems", () => {
  it("transferencia completa no tiene errores y exige tercero y cuenta", () => {
    expect(validarItemReqAdmin(transferencia(), "transferencia")).toBeNull()
    expect(validarItemReqAdmin(transferencia({ terceroFacturaId: null }), "transferencia")).toMatch(/Terceros/)
    expect(validarItemReqAdmin(transferencia({ cuentaId: null }), "transferencia")).toMatch(/cuenta/)
  })

  it("PSE: datos escritos, sin cuenta; tipo de documento de la lista del formato", () => {
    expect(validarItemReqAdmin(pse(), "pse")).toBeNull()
    expect(validarItemReqAdmin(pse({ titularTipoDocumento: "PA" }), "pse")).toMatch(/CC, NIT, PPT o CE/)
    expect(validarItemReqAdmin(pse({ facturaNit: "abc" }), "pse")).toMatch(/NIT/)
    expect(validarItemReqAdmin(pse({ facturaNombre: " " }), "pse")).toMatch(/empresa que factura/)
  })

  it("comunes: grupo, concepto, proyecto y valor > 0", () => {
    expect(validarItemReqAdmin(pse({ empresaId: "" }), "pse")).toMatch(/grupo empresarial/)
    expect(validarItemReqAdmin(pse({ concepto: "" }), "pse")).toMatch(/concepto/)
    expect(validarItemReqAdmin(pse({ proyectoId: "" }), "pse")).toMatch(/proyecto/)
    expect(validarItemReqAdmin(pse({ valor: "0" }), "pse")).toMatch(/mayor que cero/)
    expect(validarItemReqAdmin(pse({ valor: "abc" }), "pse")).toMatch(/mayor que cero/)
  })

  it("requisición: al menos uno y como mucho 50; errores por ítem", () => {
    expect(validarRequisicionAdmin([], "pse")[0].mensaje).toMatch(/al menos un ítem/)
    const muchos = Array.from({ length: MAX_ITEMS_REQ_ADMIN + 1 }, () => pse())
    expect(validarRequisicionAdmin(muchos, "pse")[0].mensaje).toMatch(/50/)
    expect(validarRequisicionAdmin(Array.from({ length: 50 }, () => pse()), "pse")).toEqual([])
    const errores = validarRequisicionAdmin([pse(), pse({ concepto: "" })], "pse")
    expect(errores).toEqual([{ indice: 1, mensaje: "Escribe el concepto de la factura." }])
  })
})

describe("valores y lo que se guarda", () => {
  it("valor en formato colombiano y total", () => {
    expect(valorItem({ valor: "1.250.000,50" })).toBe(1250000.5)
    expect(valorItem({ valor: "38.500" })).toBe(38500)
    expect(totalItems([{ valor: "1.250.000,50" }, { valor: "49.999,50" }, { valor: "" }])).toBe(1300000)
  })

  it("limpia el NIT", () => {
    expect(limpiarNit("899.999.061-9")).toBe("899999061-9")
    expect(limpiarNit(" 900 123 456 ")).toBe("900123456")
  })

  it("transferencia manda ids; el titular por omisión es quien factura", () => {
    const g = itemParaGuardar(transferencia({ observaciones: "  urgente " }), "transferencia")
    expect(g).toEqual({
      empresa_id: "e1",
      proyecto_id: "p1",
      concepto: "Papelería",
      valor: 1250000.5,
      observaciones: "urgente",
      tercero_factura_id: "t1",
      titular_tercero_id: "t1",
      cuenta_tercero_id: "c1",
    })
    expect(itemParaGuardar(transferencia({ titularTerceroId: "t2" }), "transferencia")).toMatchObject({ titular_tercero_id: "t2" })
  })

  it("PSE manda los datos escritos, limpios", () => {
    expect(itemParaGuardar(pse(), "pse")).toMatchObject({
      factura_nombre: "Secretaría de Hacienda",
      factura_nit: "899999061-9",
      titular_tipo_documento: "NIT",
      titular_documento: "899999061",
    })
  })

  it("cambiar de método conserva grupo, proyecto, concepto, valor y observaciones", () => {
    const it = itemParaMetodo(transferencia({ observaciones: "x" }))
    expect(it).toMatchObject({ empresaId: "e1", proyectoId: "p1", concepto: "Papelería", valor: "1.250.000,50", observaciones: "x" })
    expect(it.terceroFacturaId).toBeNull()
    expect(it.cuentaId).toBeNull()
  })
})

describe("detalle", () => {
  const raw = {
    id: "r1",
    numero: 7,
    metodo: "transferencia",
    estado: "rechazada",
    n_items: 1,
    valor_total: "150000.50",
    creado_por: "u1",
    es_mia: true,
    editable: true,
    creado_en: "2026-10-21T15:00:00Z",
    enviada_en: "2026-10-21T15:00:00Z",
    motivo_rechazo: "Falta la factura",
    items: [
      {
        id: "i1",
        orden: 1,
        empresa_id: "e1",
        empresa_nombre: "CONYCA",
        tercero_factura_id: "t1",
        factura_nombre: "FERRETERIA",
        factura_nit: "800123456-7",
        titular_tercero_id: "t1",
        titular_nombre: "FERRETERIA",
        titular_tipo_documento: "NIT",
        titular_documento: "800123456",
        cuenta_tercero_id: "c1",
        banco: "BANCOLOMBIA",
        tipo_cuenta: "AHORROS",
        numero_cuenta: "•••••8901",
        cuenta_verificada: true,
        concepto: "Papelería",
        proyecto_id: "p1",
        proyecto_codigo: "100-PP",
        proyecto_nombre: "Estuario",
        valor: 150000.5,
        observaciones: null,
      },
    ],
  }

  it("mapea el detalle y vuelve al formulario para corregir", () => {
    const d = mapDetalleReqAdmin(raw)
    expect(d).toMatchObject({ numero: 7, estado: "rechazada", valorTotal: 150000.5, esMia: true, editable: true, motivoRechazo: "Falta la factura" })
    const f = itemFormDesdeDetalle(d.items[0])
    // El titular es el mismo que factura: queda como "el mismo" (null).
    expect(f.titularTerceroId).toBeNull()
    expect(f.cuentaTexto).toBe("BANCOLOMBIA · Ahorros · •••••8901")
    expect(valorItem(f)).toBe(150000.5)
    expect(validarItemReqAdmin(f, "transferencia")).toBeNull()
  })
})

const opciones: OpcionesReqAdmin = {
  empresas: [
    { id: "e1", razonSocial: "CONYCA SOLUCIONES SAS", nit: "900" },
    { id: "e2", razonSocial: "VANUR SAS", nit: "901" },
  ],
  proyectos: [
    { id: "p1", codigo: "100-PP-CTG-LOTE68", nombre: "Estuario Casa", empresaId: "e2" },
    { id: "p2", codigo: null, nombre: "Administrativo", empresaId: null },
  ],
}

const ENCABEZADO = [C.grupo, C.factura, C.nit, C.titular, C.tipoDocumento, C.documento, C.concepto, C.proyecto, C.valor, C.observaciones]

describe("plantilla PSE", () => {
  it("lee las filas llenas, salta las vacías y reporta errores por fila", () => {
    const filas: unknown[][] = [
      ["Requisición administrativa · PSE"],
      [],
      ENCABEZADO,
      ["conyca soluciones sas", "Hacienda", "899.999.061-9", "Distrito", "nit", 899999061, "Predial", "100-PP-CTG-LOTE68", 50000.5, "obs"],
      [null, null, null, null, null, null, null, null, null, null],
      ["VANUR SAS", "EPM", "890904996-1", "EPM", "NIT", "890904996", "Energía", "Administrativo", "1.250.000", null],
      ["OTRA SAS", "X", "1", "Y", "CC", "2", "c", "100-PP-CTG-LOTE68", 1, null],
      ["VANUR SAS", "X", "1", "Y", "PA", "2", "c", "100-PP-CTG-LOTE68", 1, null],
      ["VANUR SAS", "X", "1", "Y", "CC", "2", "c", "100-PP-CTG-LOTE68", 0, null],
      ["VANUR SAS", "", "1", "Y", "CC", "2", "c", "100-PP-CTG-LOTE68", 5, null],
    ]
    const r = leerFilasReqAdminPse(filas, opciones)
    expect(r.items).toHaveLength(2)
    expect(r.items[0]).toMatchObject({
      empresaId: "e1",
      facturaNit: "899999061-9",
      titularTipoDocumento: "NIT",
      titularDocumento: "899999061",
      proyectoId: "p1",
      valor: "50000,5",
      observaciones: "obs",
    })
    expect(r.items[1]).toMatchObject({ empresaId: "e2", proyectoId: "p2", valor: "1250000" })
    for (const it of r.items) expect(validarItemReqAdmin(it, "pse")).toBeNull()
    expect(r.errores.map((e) => e.fila)).toEqual([7, 8, 9, 10])
    expect(r.errores[0].mensaje).toMatch(/grupo empresarial/)
    expect(r.errores[1].mensaje).toMatch(/tipo de documento/)
    expect(r.errores[2].mensaje).toMatch(/valor/)
    expect(r.errores[3].mensaje).toMatch(/empresa que factura/)
  })

  it("sin la columna de grupo empresarial pide usar la plantilla", () => {
    expect(() => leerFilasReqAdminPse([["Algo"], ["otra"]], opciones)).toThrow(/plantilla/)
  })

  it("la plantilla descargada se puede leer de vuelta", async () => {
    const XLSX = await import("xlsx")
    const { construirPlantillaReqAdminPse } = await import("@/lib/excel-req-admin-pse")
    const libro = await construirPlantillaReqAdminPse(opciones, null)
    const hoja = libro.getWorksheet("Pagos PSE")!
    // Fila de encabezados: la que dice "Grupo empresarial".
    let filaEncabezado = 0
    hoja.eachRow((row, n) => {
      if (row.getCell(1).value === C.grupo) filaEncabezado = n
    })
    expect(filaEncabezado).toBeGreaterThan(0)
    const fila = hoja.getRow(filaEncabezado + 1)
    ;["VANUR SAS", "EPM", "890904996-1", "EPM", "NIT", "890904996", "Energía", "100-PP-CTG-LOTE68", 1000, ""].forEach(
      (v, i) => (fila.getCell(i + 1).value = v)
    )
    const buffer = await libro.xlsx.writeBuffer()
    const leido = XLSX.read(new Uint8Array(buffer as ArrayBuffer), { type: "array" })
    const filas = XLSX.utils.sheet_to_json<unknown[]>(leido.Sheets[leido.SheetNames[0]], { header: 1, defval: null })
    const r = leerFilasReqAdminPse(filas, opciones)
    expect(r.errores).toEqual([])
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ empresaId: "e2", proyectoId: "p1", valor: "1000" })
  })
})

describe("menú y ruta", () => {
  const sinPestanas: PermisosRol = {
    sinRol: false,
    rolId: "r",
    rolClave: "x",
    rolNombre: "X",
    esAdministrador: false,
    pestanas: [],
    acciones: [],
    todosProyectos: false,
  }

  it("cualquier usuario ve Requisiciones en A&F y la ruta es libre", () => {
    const ayf = construirModulos(sinPestanas).find((m) => m.clave === "ayf")!
    expect(ayf.grupos.map((g) => g.titulo)).toContain("Requisiciones")
    expect(ayf.grupos.find((g) => g.titulo === "Requisiciones")!.items[0].url).toBe("/ayf/requisiciones-administrativas")
    expect(evaluarRuta("/ayf/requisiciones-administrativas")).toEqual({ tipo: "libre" })
  })
})

describe("pago de una requisición administrativa", () => {
  it("origen y titular de PSE sin tercero", () => {
    const p = mapPago({
      id: "g1",
      tipo: "unico",
      fuente: "requisicion_admin",
      estado: "aprobado",
      valor: "50000",
      concepto: "REQ",
      requisicion_admin_id: "r4",
      requisicion_admin_principal: true,
      lote: { items: 3, total: "1500.5" },
      req: { numero: 4, metodo: "pse" },
      req_item: { titular_nombre: "Distrito", titular_tipo_documento: "NIT", titular_documento: "899999061" },
      tercero: null,
    })
    expect(p.origen).toBe("Req. admin. N° 4 · PSE")
    expect(p.requisicionAdminId).toBe("r4")
    expect(p.requisicionAdminLote).toEqual({ items: 3, total: 1500.5 })
    expect(mapPago({ id: "g2", fuente: "requisicion_admin", requisicion_admin_principal: false, lote: { items: 3, total: 1 } }).requisicionAdminLote).toBeNull()
    expect(p.terceroNombre).toBe("Distrito")
    expect(p.terceroDocumento).toBe("NIT 899999061")
  })
})
