import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer"
import { ZONA_HORARIA } from "@/lib/fechas"
import { nombreBase, totalTanda, type Tanda } from "@/lib/dispersores/generador"
import { enLetras, pesos } from "@/lib/dispersores/textos"

// ---------------------------------------------------------------------------
// Port de nucleo/soporte.py (pdf_soporte) de la consola de dispersores: el PDF
// que se aprueba y se archiva, el único rastro que conecta cada abono con su
// ITEM, su empresa y su proyecto. Mismo diseño: carta, márgenes 16/14/16 mm,
// paleta azul/blanco/negro, ficha de la cuenta debitada, tabla agrupada por
// EMPRESA y dentro por PROYECTO, total en letras, cuentas confirmadas a mano y
// pie. El grupal lleva todos los pagos de la tanda; el individual, uno solo.
// ---------------------------------------------------------------------------

const mm = (n: number) => n * 2.834645669

const AZUL_OSCURO = "#0F2A4A"
const AZUL_MEDIO = "#1F5FA8"
const AZUL_PASTEL = "#DCE7F4"
const NEGRO = "#16211A"
const GRIS = "#5C6672"
const GRIS_LINEA = "#D9DEE6"
const SELLO = "#8C2F2A"

const ANCHOS = [13, 64, 24, 30, 28, 25].map(mm)
// SimpleDocTemplate de reportlab: márgenes 16/14/16 mm MÁS el relleno de 6 pt
// del marco; las tablas que no ocupan el ancho van centradas en él.
const RELLENO_MARCO = 6
const ANCHO_MARCO = 612 - 2 * (mm(16) + RELLENO_MARCO)
const centrada = (ancho: number) => (ANCHO_MARCO - ancho) / 2
const ANCHO_TABLA = ANCHOS.reduce((a, b) => a + b, 0)
type Estilo = Parameters<typeof StyleSheet.create>[0][string]

const s = StyleSheet.create({
  pagina: {
    paddingLeft: mm(16) + RELLENO_MARCO,
    paddingRight: mm(16) + RELLENO_MARCO,
    paddingTop: mm(14) + RELLENO_MARCO,
    paddingBottom: mm(16) + RELLENO_MARCO,
    fontFamily: "Helvetica",
  },
  titulo: { fontFamily: "Helvetica-Bold", fontSize: 14.5, color: AZUL_OSCURO, lineHeight: 17 / 14.5 },
  semana: { fontFamily: "Helvetica", fontSize: 11, color: AZUL_MEDIO, lineHeight: 14 / 11 },
  etqFicha: { fontFamily: "Helvetica-Bold", fontSize: 8.5, color: GRIS, lineHeight: 13 / 8.5 },
  valFicha: { fontFamily: "Helvetica-Bold", fontSize: 9.5, color: NEGRO, lineHeight: 13 / 9.5 },
  valFichaReg: { fontFamily: "Helvetica", fontSize: 9.5, color: NEGRO, lineHeight: 13 / 9.5 },
  pieMeta: { fontFamily: "Helvetica", fontSize: 8, color: GRIS, lineHeight: 11 / 8 },
  etq: { fontFamily: "Courier", fontSize: 7, color: GRIS, lineHeight: 9 / 7, marginBottom: 1 },
  txt: { fontFamily: "Helvetica", fontSize: 8.5, color: NEGRO, lineHeight: 11 / 8.5 },
  mono: { fontFamily: "Courier-Bold", fontSize: 9, color: NEGRO, lineHeight: 12 / 9 },
  rojo: { fontFamily: "Helvetica-Bold", fontSize: 8.5, color: SELLO, lineHeight: 11 / 8.5 },
  fila: { flexDirection: "row", alignItems: "center" },
  celda: { paddingTop: 4.5, paddingBottom: 4.5, paddingLeft: 7, paddingRight: 6 },
})

type Fila =
  | { tipo: "empresa"; nombre: string; n: number; total: number }
  | { tipo: "proyecto"; nombre: string; total: number }
  | { tipo: "pago"; item: string; nombre: string; documento: string; banco: string; cuenta: string; valor: number }
  | { tipo: "aire" }

// Se agrupa SIEMPRE por empresa y dentro por proyecto (orden alfabético).
function filasDe(t: Tanda): Fila[] {
  const arbol = new Map<string, Map<string, Tanda["renglones"]>>()
  for (const r of t.renglones) {
    const e = r.empresa || "(sin empresa)"
    const p = r.proyecto || "(sin proyecto)"
    if (!arbol.has(e)) arbol.set(e, new Map())
    const pr = arbol.get(e)!
    if (!pr.has(p)) pr.set(p, [])
    pr.get(p)!.push(r)
  }
  const filas: Fila[] = []
  const empresas = [...arbol.keys()].sort()
  empresas.forEach((empresa, idx) => {
    const proyectos = arbol.get(empresa)!
    let tot = 0
    let n = 0
    for (const g of proyectos.values()) for (const x of g) {
      tot += x.valor
      n++
    }
    filas.push({ tipo: "empresa", nombre: empresa.slice(0, 74), n, total: tot })
    for (const proyecto of [...proyectos.keys()].sort()) {
      const grupo = proyectos.get(proyecto)!
      filas.push({ tipo: "proyecto", nombre: proyecto.slice(0, 68), total: grupo.reduce((a, x) => a + x.valor, 0) })
      for (const r of grupo) {
        filas.push({ tipo: "pago", item: r.item, nombre: r.nombre.slice(0, 42), documento: r.documento, banco: r.bancoDestino.slice(0, 18), cuenta: r.cuenta, valor: r.valor })
      }
    }
    // una fila de aire entre empresas, nunca después de la última
    if (idx < empresas.length - 1) filas.push({ tipo: "aire" })
  })
  return filas
}

const capitalizar = (x: string) => (x ? x[0].toUpperCase() + x.slice(1).toLowerCase() : x)
const titulo = (x: string) => x.toLowerCase().replace(/(^|[^a-záéíóúñü])([a-záéíóúñü])/gi, (_, a, b) => a + b.toUpperCase())

function generadoEl(d: Date): string {
  const p = new Intl.DateTimeFormat("es-CO", {
    timeZone: ZONA_HORARIA, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d)
  const v = (k: string) => p.find((x) => x.type === k)?.value ?? ""
  return `${v("day")}/${v("month")}/${v("year")} ${v("hour")}:${v("minute")}`
}

export function nombreSoporteGrupal(t: Tanda, ronda: number) {
  return `${nombreBase(t)}_soporte_Ronda${ronda}.pdf`
}
export function nombreSoporteIndividual(t: Tanda, item: string) {
  return `${nombreBase(t)}_ITEM${item}_soporte.pdf`
}

export function SoporteDispersorPDF({
  tanda: t,
  archivos,
  cambiosManuales = [],
  logo,
  generado = new Date(),
}: {
  tanda: Tanda
  archivos: string[]
  cambiosManuales?: string[]
  logo: string | Buffer
  generado?: Date
}) {
  const c = t.cuenta
  const fechaLegible = t.fecha && t.fecha.length === 8 ? `${t.fecha.slice(6, 8)}/${t.fecha.slice(4, 6)}/${t.fecha.slice(0, 4)}` : t.fecha || "—"
  const total = totalTanda(t)
  const filas = filasDe(t)

  const ficha: [string, string, boolean][] = [
    ["Fecha", fechaLegible, false],
    ["Cuenta Debitada", c.apodo, true],
    ["Banco", `${c.banco} · ${capitalizar(c.tipoCuenta)}`, false],
    ["No de Cuenta", c.cuenta, false],
    ["Titular", `${c.razonSocial} · NIT ${c.nit}`, false],
  ]

  const celda = (i: number, contenido: React.ReactNode, extra: Estilo = {}, ancho?: number) => (
    <View style={[s.celda, { width: ancho ?? ANCHOS[i], flexShrink: 0 }, i === 0 ? { paddingRight: 2 } : {}, extra]}>{contenido}</View>
  )

  return (
    <Document title={`Soporte de Generación de Dispersores - Semana ${t.semana ?? ""}`.trim()} author="Consola de dispersores">
      <Page size="LETTER" style={s.pagina}>
        {/* encabezado y logo */}
        <View style={{ flexDirection: "row", marginLeft: centrada(mm(173)) }}>
          <View style={{ width: mm(130) }}>
            <Text style={s.titulo}>Soporte de Generación de Dispersores</Text>
            <Text style={s.semana}>{t.semana ? `Semana ${t.semana}` : ""}</Text>
          </View>
          <View style={{ width: mm(43), alignItems: "flex-end" }}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image src={logo} style={{ width: mm(34), height: mm(34) * (189 / 676) }} />
          </View>
        </View>
        <View style={{ height: 10 }} />
        <View style={{ borderBottomWidth: 1.4, borderBottomColor: AZUL_OSCURO, marginBottom: 10 }} />

        {/* ficha de pago */}
        {ficha.map(([e, v, negrilla]) => (
          <View key={e} style={[s.fila, { paddingTop: 1.5, paddingBottom: 1.5, marginLeft: centrada(mm(173)) }]}>
            <Text style={[s.etqFicha, { width: mm(32) }]}>{e}</Text>
            <Text style={[negrilla ? s.valFicha : s.valFichaReg, { width: mm(141) }]}>{v}</Text>
          </View>
        ))}
        <View style={{ height: 8 }} />
        <Text style={s.pieMeta}>
          {`Clase de pago: ${titulo(t.clasePago)}  ·  Registros: ${t.renglones.length}  ·  Archivos: ${archivos.join(", ")}`}
        </Text>
        <View style={{ height: 12 }} />

        {/* tabla de pagos */}
        <View style={[s.fila, { backgroundColor: NEGRO, marginLeft: centrada(ANCHO_TABLA), width: ANCHO_TABLA }]} wrap={false}>
          {["Item", "Titular de la cuenta", "Documento", "Banco", "Cuenta", "Valor"].map((h, i) =>
            celda(i, <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 7.5, color: "#FFFFFF", lineHeight: 1.2, textAlign: i === 5 ? "right" : "left" }}>{h}</Text>)
          )}
        </View>
        {filas.map((f, k) => {
          if (f.tipo === "empresa") {
            return (
              <View key={k} style={[s.fila, { backgroundColor: AZUL_OSCURO, marginLeft: centrada(ANCHO_TABLA), width: ANCHO_TABLA }]} wrap={false}>
                {celda(0, <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 9.5, color: "#FFFFFF" , lineHeight: 1.2}}>{f.nombre}</Text>, { paddingTop: 6.5, paddingBottom: 6.5, paddingRight: 6 }, ANCHOS[0] + ANCHOS[1] + ANCHOS[2] + ANCHOS[3])}
                {celda(4, <Text style={{ fontFamily: "Helvetica", fontSize: 7.5, color: "#FFFFFF" , lineHeight: 1.2}}>{`${f.n} ${f.n === 1 ? "pago" : "pagos"}`}</Text>, { paddingTop: 6.5, paddingBottom: 6.5 })}
                {celda(5, <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 9.5, color: "#FFFFFF", lineHeight: 1.2, textAlign: "right" }}>{pesos(f.total)}</Text>, { paddingTop: 6.5, paddingBottom: 6.5 })}
              </View>
            )
          }
          if (f.tipo === "proyecto") {
            return (
              <View key={k} style={[s.fila, { backgroundColor: AZUL_PASTEL, marginLeft: centrada(ANCHO_TABLA), width: ANCHO_TABLA }]} wrap={false}>
                {celda(0, <Text style={{ fontFamily: "Helvetica-Oblique", fontSize: 8, color: AZUL_OSCURO , lineHeight: 1.2}}>{f.nombre}</Text>, { paddingTop: 4, paddingBottom: 4, paddingRight: 6 }, ANCHOS[0] + ANCHOS[1] + ANCHOS[2] + ANCHOS[3] + ANCHOS[4])}
                {celda(5, <Text style={{ fontFamily: "Helvetica-BoldOblique", fontSize: 8, color: AZUL_OSCURO, lineHeight: 1.2, textAlign: "right" }}>{pesos(f.total)}</Text>, { paddingTop: 4, paddingBottom: 4 })}
              </View>
            )
          }
          if (f.tipo === "aire") return <View key={k} style={{ height: 3 + 3 + 12 }} />
          return (
            <View key={k} style={[s.fila, { borderBottomWidth: 0.4, borderBottomColor: GRIS_LINEA, marginLeft: centrada(ANCHO_TABLA), width: ANCHO_TABLA }]} wrap={false}>
              {celda(0, <Text style={{ fontFamily: "Courier", fontSize: 7.5, color: GRIS , lineHeight: 1.2}}>{f.item}</Text>)}
              {celda(1, <Text style={{ fontFamily: "Helvetica", fontSize: 8, color: NEGRO , lineHeight: 1.2}}>{f.nombre}</Text>)}
              {celda(2, <Text style={{ fontFamily: "Courier", fontSize: 7.5, color: NEGRO , lineHeight: 1.2}}>{f.documento}</Text>)}
              {celda(3, <Text style={{ fontFamily: "Helvetica", fontSize: 8, color: NEGRO , lineHeight: 1.2}}>{f.banco}</Text>)}
              {celda(4, <Text style={{ fontFamily: "Courier", fontSize: 7.5, color: NEGRO , lineHeight: 1.2}}>{f.cuenta}</Text>)}
              {celda(5, <Text style={{ fontFamily: "Helvetica", fontSize: 8, color: NEGRO, lineHeight: 1.2, textAlign: "right" }}>{pesos(f.valor)}</Text>)}
            </View>
          )
        })}
        {/* total */}
        <View style={[s.fila, { marginLeft: centrada(ANCHO_TABLA), width: ANCHO_TABLA }]} wrap={false}>
          <View style={{ width: ANCHOS[0] + ANCHOS[1] + ANCHOS[2] + ANCHOS[3] }} />
          <View style={{ flexDirection: "row", borderTopWidth: 1.2, borderTopColor: NEGRO, alignItems: "center" }}>
            {celda(4, <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 10, color: NEGRO , lineHeight: 1.2}}>TOTAL</Text>, { paddingTop: 10, paddingBottom: 2 })}
            {celda(5, <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 13, color: NEGRO, lineHeight: 1.2, textAlign: "right" }}>{pesos(total)}</Text>, { paddingTop: 10, paddingBottom: 2 })}
          </View>
        </View>

        <View style={{ height: 8 }} />
        <Text style={s.mono}>{`Son: ${enLetras(total)} M/CTE.`}</Text>
        {t.truncado ? (
          <Text style={s.etq}>{`Los valores se truncaron al peso: quedaron ${t.truncado} sin dispersar frente al total del consolidado.`}</Text>
        ) : null}

        {cambiosManuales.length > 0 && (
          <>
            <View style={{ height: 8 }} />
            <Text style={s.rojo}>Cuentas confirmadas a mano</Text>
            {cambiosManuales.map((x, i) => (
              <Text key={i} style={s.txt}>
                {x}
              </Text>
            ))}
          </>
        )}

        <View style={{ height: 6 }} />
        <Text style={s.etq}>{`Generado el ${generadoEl(generado)} · la referencia de cada abono es ITEM (numero) SEMANA ${t.semana ?? "None"}`}</Text>
      </Page>
    </Document>
  )
}
