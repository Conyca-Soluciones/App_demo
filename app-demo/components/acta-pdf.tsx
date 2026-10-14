import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer"
import { Encabezado, s } from "@/components/minuta-mano-obra-pdf"
import { formatearFechaSinHora } from "@/lib/fechas"
import { numero, pesos, pesosEnLetras } from "@/lib/contratos"
import { ETIQUETA_TIPO_ACTA, saldoContrato, type ActaDetalle } from "@/lib/actas"

// PDF del acta (no hay plantilla de Jurídica: formato propio con el mismo
// encabezado de las minutas). Datos del contrato, lo ejecutado, el resumen con
// descuentos y neto a pagar, observaciones y los bloques de firma (quien la
// elaboró, el contratista y quien la aprobó; las firmas digitales irán ahí).
// El código del formato es provisional hasta que Jurídica asigne uno.
const ENCABEZADO = { codigo: "Código: por definir", version: "01", fecha: "14/10/2026" }

const t = StyleSheet.create({
  pagina: { ...s.page, fontSize: 9.5 },
  marca: { fontFamily: "Helvetica-Bold", fontSize: 9, color: "#b45309", textAlign: "center", marginBottom: 6 },
  datos: { borderWidth: 1, borderColor: "#9AA4AE", marginBottom: 10 },
  fila: { flexDirection: "row", borderTopWidth: 1, borderColor: "#9AA4AE" },
  etiqueta: { width: 130, padding: 4, fontFamily: "Helvetica-Bold", backgroundColor: "#EEF2F7" },
  valor: { flex: 1, padding: 4 },
  seccion: { fontFamily: "Helvetica-Bold", fontSize: 10, marginTop: 8, marginBottom: 4 },
  num: { textAlign: "right" },
  resumen: { marginLeft: "auto", width: 300, borderWidth: 1, borderColor: "#9AA4AE", marginTop: 8 },
  resumenFila: { flexDirection: "row", paddingVertical: 3, paddingHorizontal: 6 },
  resumenTotal: { flexDirection: "row", paddingVertical: 4, paddingHorizontal: 6, borderTopWidth: 1, borderColor: "#9AA4AE", backgroundColor: "#EEF2F7" },
  firmaNombre: { fontFamily: "Helvetica-Bold", fontSize: 9 },
  firmaRol: { fontSize: 8.5, color: "#444" },
})

// Columnas de la tabla de actividades (anchos en puntos; la actividad se estira).
const COLS = [
  { titulo: "Actividad", flex: 1 },
  { titulo: "Und", w: 30 },
  { titulo: "Contratada", w: 54 },
  { titulo: "Acum. anterior", w: 46 },
  { titulo: "Esta acta", w: 44 },
  { titulo: "Acumulado", w: 54 },
  { titulo: "Valor unitario", w: 58 },
  { titulo: "Valor esta acta", w: 64 },
]

// Estilo de un elemento del PDF (sin depender de @react-pdf/types, que no es dependencia directa).
type Estilo = Parameters<typeof StyleSheet.create>[0][string]

function celda(i: number, extra: Estilo = {}): Estilo[] {
  const c = COLS[i]
  return [c.flex ? { flex: c.flex } : { width: c.w }, i > 0 ? s.celdaBorde : {}, extra]
}

function Dato({ etiqueta, children, primero }: { etiqueta: string; children: string; primero?: boolean }) {
  return (
    <View style={primero ? { flexDirection: "row" } : t.fila}>
      <Text style={t.etiqueta}>{etiqueta}</Text>
      <Text style={t.valor}>{children}</Text>
    </View>
  )
}

function Renglon({ titulo, valor, total }: { titulo: string; valor: number; total?: boolean }) {
  return (
    <View style={total ? t.resumenTotal : t.resumenFila}>
      <Text style={[{ flex: 1 }, total ? s.b : {}]}>{titulo}</Text>
      <Text style={[t.num, total ? s.b : {}]}>{valor === 0 && !total ? "—" : pesos(valor)}</Text>
    </View>
  )
}

export function ActaPDF({ acta: a, logo }: { acta: ActaDetalle; logo: string | Buffer }) {
  const titulo = `${ETIQUETA_TIPO_ACTA[a.tipo].toUpperCase()} N° ${a.numero}`
  const periodo =
    a.periodoDesde || a.periodoHasta
      ? `${a.periodoDesde ? formatearFechaSinHora(a.periodoDesde) : "—"} a ${a.periodoHasta ? formatearFechaSinHora(a.periodoHasta) : "—"}`
      : "—"
  const usado = a.otrasActas + (a.estado === "rechazada" ? 0 : a.valorBruto)
  const contratista =
    a.contratistaTipoPersona === "juridica" && a.contratistaRepresentante
      ? `${a.contratistaNombre} (${a.contratistaDocumento}), representada por ${a.contratistaRepresentante}`
      : `${a.contratistaNombre} (${a.contratistaDocumento})`

  return (
    <Document title={`${titulo} - ${a.numeroContrato}`}>
      <Page size="LETTER" style={t.pagina}>
        <Encabezado logo={logo} formato={`${ETIQUETA_TIPO_ACTA[a.tipo].toUpperCase()} DE CONTRATO`} {...ENCABEZADO} />

        {a.estado !== "aprobada" && (
          <Text style={t.marca}>{a.estado === "rechazada" ? "ACTA RECHAZADA" : "BORRADOR: ACTA POR APROBAR"}</Text>
        )}
        <Text style={s.titulo}>
          {titulo} DEL CONTRATO {a.numeroContrato}
        </Text>

        <View style={t.datos}>
          <Dato etiqueta="Contratante" primero>
            {a.empresaNombre ? `${a.empresaNombre}${a.empresaNit ? ` (NIT ${a.empresaNit})` : ""}` : "—"}
          </Dato>
          <Dato etiqueta="Contratista">{contratista}</Dato>
          <Dato etiqueta="Objeto">{a.objeto}</Dato>
          <Dato etiqueta="Proyecto">{`${a.proyectoCodigo} · ${a.proyectoNombre}${a.proyectoCiudad ? ` (${a.proyectoCiudad})` : ""}`}</Dato>
          <Dato etiqueta="Valor del contrato">{pesos(a.contratoValor)}</Dato>
          <Dato etiqueta="Período del acta">{periodo}</Dato>
          <Dato etiqueta="Fecha de elaboración">{formatearFechaSinHora(a.createdAt)}</Dato>
        </View>

        {a.tipo !== "liquidacion" && a.anexoTipo === "valores_unitarios" && (
          <>
            <Text style={t.seccion}>Actividades del contrato</Text>
            <View style={s.tabla}>
              <View style={s.tr} fixed>
                {COLS.map((c, i) => (
                  <Text key={c.titulo} style={[s.th, ...celda(i), i > 1 ? t.num : {}]}>
                    {c.titulo}
                  </Text>
                ))}
              </View>
              {a.actividades.map((x) => {
                const esta = x.cantidad ?? 0
                return (
                  <View key={x.id} style={s.tr} wrap={false}>
                    <Text style={[s.td, ...celda(0)]}>{x.actividad}</Text>
                    <Text style={[s.td, ...celda(1)]}>{x.unidad}</Text>
                    <Text style={[s.td, ...celda(2, t.num)]}>{numero(x.cantidadContratada)}</Text>
                    <Text style={[s.td, ...celda(3, t.num)]}>{numero(x.acumuladoAnterior)}</Text>
                    <Text style={[s.td, ...celda(4, t.num), esta ? s.b : {}]}>{esta ? numero(esta) : "—"}</Text>
                    <Text style={[s.td, ...celda(5, t.num)]}>{numero(x.acumuladoAnterior + esta)}</Text>
                    <Text style={[s.td, ...celda(6, t.num)]}>{pesos(x.valorUnitario)}</Text>
                    <Text style={[s.td, ...celda(7, t.num)]}>{x.valor != null ? pesos(x.valor) : "—"}</Text>
                  </View>
                )
              })}
            </View>
          </>
        )}

        {a.tipo !== "liquidacion" && a.porcentajeAvance != null && (
          <View style={t.datos}>
            <Dato etiqueta="Avance anterior" primero>{`${numero(a.avanceAnterior)} %`}</Dato>
            <Dato etiqueta="Avance de esta acta">{`${numero(a.porcentajeAvance)} %`}</Dato>
            <Dato etiqueta="Avance acumulado">{`${numero(a.avanceAnterior + a.porcentajeAvance)} %`}</Dato>
          </View>
        )}

        <View wrap={false}>
          <Text style={t.seccion}>Estado del contrato</Text>
          <View style={t.datos}>
            <Dato etiqueta="Valor del contrato" primero>{pesos(a.contratoValor)}</Dato>
            <Dato etiqueta="Actas anteriores">{pesos(a.otrasActas)}</Dato>
            <Dato etiqueta="Esta acta (valor bruto)">{pesos(a.valorBruto)}</Dato>
            <Dato etiqueta="Saldo del contrato">{pesos(saldoContrato(a.contratoValor, usado))}</Dato>
          </View>

          <View style={t.resumen}>
            {a.tipo === "liquidacion" ? (
              <>
                <Renglon titulo="Devolución de la retención en garantía" valor={a.devolucionRetencion} />
                <Renglon titulo="Anticipo por amortizar" valor={-a.amortizacion} />
              </>
            ) : (
              <>
                <Renglon titulo="Valor bruto del acta" valor={a.valorBruto} />
                <Renglon
                  titulo={`Amortización del anticipo${a.anticipoPorcentaje ? ` (${numero(a.anticipoPorcentaje)} %)` : ""}`}
                  valor={-a.amortizacion}
                />
                <Renglon
                  titulo={`Retención en garantía${a.retencionPorcentaje ? ` (${numero(a.retencionPorcentaje)} %)` : ""}`}
                  valor={-a.retencion}
                />
              </>
            )}
            {a.descuentos.map((d, i) => (
              <Renglon key={i} titulo={d.concepto} valor={-d.valor} />
            ))}
            <Renglon titulo="NETO A PAGAR" valor={a.neto} total />
          </View>
          {a.neto > 0 && <Text style={{ marginTop: 6, textAlign: "right", fontSize: 8.5 }}>Son: {pesosEnLetras(a.neto)}</Text>}
        </View>

        {a.observaciones && (
          <View wrap={false}>
            <Text style={t.seccion}>Observaciones</Text>
            <Text style={s.p}>{a.observaciones}</Text>
          </View>
        )}

        <View style={s.firmas} wrap={false}>
          <View style={s.firma}>
            <View style={s.firmaLinea} />
            <Text style={t.firmaNombre}>{a.creadoPorNombre ?? " "}</Text>
            <Text style={t.firmaRol}>Elaboró</Text>
          </View>
          <View style={s.firma}>
            <View style={s.firmaLinea} />
            <Text style={t.firmaNombre}>{a.contratistaRepresentante && a.contratistaTipoPersona === "juridica" ? a.contratistaRepresentante : a.contratistaNombre}</Text>
            <Text style={t.firmaRol}>
              Contratista{a.contratistaTipoPersona === "juridica" ? ` · ${a.contratistaNombre}` : ""}
            </Text>
          </View>
          <View style={s.firma}>
            <View style={s.firmaLinea} />
            <Text style={t.firmaNombre}>{a.estado === "aprobada" ? (a.resueltoPorNombre ?? " ") : " "}</Text>
            <Text style={t.firmaRol}>Aprobó</Text>
          </View>
        </View>

        <Text style={s.footer} render={({ pageNumber, totalPages }) => `${titulo} · ${a.numeroContrato} · Página ${pageNumber} de ${totalPages}`} fixed />
      </Page>
    </Document>
  )
}
