import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer"
import { formatearFechaHora, formatearFechaSinHora } from "@/lib/fechas"
import type { LegalizacionDetalle } from "@/lib/caja-menor"

// Relación de gastos de una caja menor (formato de control GF-F-016): el
// soporte del cuadro de pago del reembolso. La genera la app cuando Líder
// Financiera da el okay (20270101007400) y queda en el ítem del cuadro.

const AZUL = "#3E70A1"
const GRIS = "#5C6672"
const LINEA = "#D9DEE6"

const s = StyleSheet.create({
  pagina: { padding: 32, fontFamily: "Helvetica", fontSize: 8, color: "#16211A" },
  encabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  logo: { width: 110, height: 34, objectFit: "contain" },
  titulo: { fontFamily: "Helvetica-Bold", fontSize: 13, color: AZUL },
  sub: { fontSize: 9, color: GRIS, marginTop: 2 },
  ficha: { flexDirection: "row", flexWrap: "wrap", borderWidth: 1, borderColor: LINEA, padding: 6, marginBottom: 10 },
  dato: { width: "33%", marginBottom: 4 },
  etq: { fontSize: 7, color: GRIS },
  val: { fontFamily: "Helvetica-Bold", fontSize: 8.5 },
  fila: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINEA },
  cab: { flexDirection: "row", backgroundColor: AZUL, color: "#FFFFFF", fontFamily: "Helvetica-Bold" },
  celda: { paddingVertical: 3, paddingHorizontal: 3 },
  total: { flexDirection: "row", justifyContent: "flex-end", marginTop: 6, fontFamily: "Helvetica-Bold", fontSize: 10 },
  firmas: { flexDirection: "row", marginTop: 24, justifyContent: "space-between" },
  firma: { width: "31%", borderTopWidth: 1, borderTopColor: "#16211A", paddingTop: 3 },
  pie: { position: "absolute", bottom: 18, left: 32, right: 32, fontSize: 7, color: GRIS, textAlign: "center" },
})

const COLS: { titulo: string; ancho: string; derecha?: boolean }[] = [
  { titulo: "N°", ancho: "4%" },
  { titulo: "Fecha", ancho: "9%" },
  { titulo: "Proyecto", ancho: "12%" },
  { titulo: "Factura", ancho: "9%" },
  { titulo: "NIT o cédula", ancho: "11%" },
  { titulo: "Nombre o razón social", ancho: "17%" },
  { titulo: "Concepto", ancho: "14%" },
  { titulo: "Destino", ancho: "12%" },
  { titulo: "Valor", ancho: "12%", derecha: true },
]

const pesos = (n: number) =>
  "$ " + n.toLocaleString("es-CO", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })

export function RelacionCajaMenorPDF({
  detalle,
  logo,
  generado,
  aprobadoPor,
}: {
  detalle: LegalizacionDetalle
  logo: Buffer | null
  generado: string
  aprobadoPor: string
}) {
  const caja = detalle.caja
  const valores = (g: LegalizacionDetalle["gastos"][number]) => [
    String(g.orden),
    formatearFechaSinHora(g.fecha),
    g.proyectoCodigo || g.proyectoNombre,
    g.numeroFactura,
    g.documento,
    g.nombre,
    g.concepto,
    g.destino,
    pesos(g.valor),
  ]
  return (
    <Document title={`Relación de caja menor ${detalle.codigo}`}>
      <Page size="LETTER" orientation="landscape" style={s.pagina}>
        <View style={s.encabezado}>
          <View>
            <Text style={s.titulo}>Relación de gastos de caja menor</Text>
            <Text style={s.sub}>
              {detalle.codigo} · GF-F-016 Control de caja menor (procedimiento GF-PR-001)
            </Text>
          </View>
          {logo && <Image src={logo} style={s.logo} />}
        </View>

        <View style={s.ficha}>
          {[
            ["Responsable", detalle.responsableNombre],
            ["Caja", caja ? `N° ${caja.numero}${caja.descripcion ? ` · ${caja.descripcion}` : ""}` : "—"],
            ["Monto de la caja", caja ? pesos(caja.monto) : "—"],
            ["Grupo empresarial", detalle.empresaNombre],
            ["Proyecto de la caja", detalle.proyectoCodigo || detalle.proyectoNombre],
            ["Se reembolsa a", caja ? `${caja.terceroNombre} · ${caja.terceroDocumento}` : "—"],
            ["Cuenta", caja?.cuentaTexto || "—"],
            ["Enviada", formatearFechaHora(detalle.enviadaEn)],
            ["Gastos", String(detalle.nGastos)],
          ].map(([e, v]) => (
            <View key={e} style={s.dato}>
              <Text style={s.etq}>{e}</Text>
              <Text style={s.val}>{v}</Text>
            </View>
          ))}
        </View>

        <View style={s.cab} fixed>
          {COLS.map((c) => (
            <Text key={c.titulo} style={[s.celda, { width: c.ancho, textAlign: c.derecha ? "right" : "left" }]}>
              {c.titulo}
            </Text>
          ))}
        </View>
        {detalle.gastos.map((g) => (
          <View key={g.id} style={s.fila} wrap={false}>
            {valores(g).map((v, i) => (
              <Text key={i} style={[s.celda, { width: COLS[i].ancho, textAlign: COLS[i].derecha ? "right" : "left" }]}>
                {v}
              </Text>
            ))}
          </View>
        ))}
        <View style={s.total}>
          <Text>Total a reembolsar: {pesos(detalle.valorTotal)}</Text>
        </View>

        <View style={s.firmas} wrap={false}>
          <View style={s.firma}>
            <Text style={s.val}>{detalle.responsableNombre}</Text>
            <Text style={s.etq}>Responsable de la caja menor</Text>
          </View>
          <View style={s.firma}>
            <Text style={s.val}>{detalle.revisadaPorNombre ?? "—"}</Text>
            <Text style={s.etq}>
              Revisó los soportes (Financiera){detalle.revisadaEn ? ` · ${formatearFechaHora(detalle.revisadaEn)}` : ""}
            </Text>
          </View>
          <View style={s.firma}>
            <Text style={s.val}>{aprobadoPor}</Text>
            <Text style={s.etq}>Aprobó (Líder Financiera) · {generado}</Text>
          </View>
        </View>

        <Text
          style={s.pie}
          fixed
          render={({ pageNumber, totalPages }) => `CONYCA 360 · ${detalle.codigo} · Página ${pageNumber} de ${totalPages}`}
        />
      </Page>
    </Document>
  )
}
