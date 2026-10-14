import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer"

// ---------------------------------------------------------------------------
// Hoja del contrato general, con el formato del "Contrato General" de Sinco:
// empresa, número, contratista, datos del contrato, descripción, observaciones
// y el bloque de quién lo elaboró, pre-aprobó y aprobó (con fecha y hora). Los
// datos salen de la base (ruta del PDF), no del navegador.
// ---------------------------------------------------------------------------

export type HojaContratoGeneral = {
  numero: string // CJ-<n>-<año> o "Solicitud N° <n>" si aún no está aprobado
  empresaNombre: string
  empresaNit: string
  ciudad: string
  contratista: {
    nombre: string
    documento: string
    direccion: string
    telefono: string
    correo: string
    ciudad: string
  }
  proyecto: string
  tipo: string
  valor: string
  fechaInicio: string
  fechaFin: string
  estado: string
  formaPago: string
  retencionGarantia: string
  retencionAnticipo: string
  retencionFic: string
  referencia: string
  descripcion: string
  observaciones: string
  elaboro: { nombre: string; fecha: string } | null
  preaprobo: { nombre: string; fecha: string } | null
  aprobo: { nombre: string; fecha: string } | null
  impreso: string
}

const BORDE = "#9AA4AE"
const AZUL = "#3B6EA5"

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: "#111", lineHeight: 1.3 },
  encabezado: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: BORDE, marginBottom: 10 },
  logoCaja: { width: 130, padding: 8, borderRightWidth: 1, borderColor: BORDE, alignItems: "center" },
  logo: { width: 110, objectFit: "contain" },
  empresa: { flex: 1, padding: 8 },
  empresaNombre: { fontFamily: "Helvetica-Bold", fontSize: 11 },
  numeroCaja: { width: 150, padding: 8, borderLeftWidth: 1, borderColor: BORDE, alignItems: "center" },
  numeroEtiqueta: { fontSize: 8, color: "#555" },
  numero: { fontFamily: "Helvetica-Bold", fontSize: 12, color: AZUL },
  seccion: { borderWidth: 1, borderColor: BORDE, marginBottom: 8 },
  seccionTitulo: { backgroundColor: AZUL, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 9, paddingVertical: 3, paddingHorizontal: 6 },
  fila: { flexDirection: "row", borderTopWidth: 1, borderColor: BORDE },
  celda: { flex: 1, flexDirection: "row", paddingVertical: 3, paddingHorizontal: 6 },
  celdaBorde: { borderLeftWidth: 1, borderColor: BORDE },
  etiqueta: { fontFamily: "Helvetica-Bold", marginRight: 4 },
  bloque: { paddingVertical: 4, paddingHorizontal: 6, borderTopWidth: 1, borderColor: BORDE },
  texto: { textAlign: "justify" },
  firmas: { flexDirection: "row", borderWidth: 1, borderColor: BORDE, marginTop: 10 },
  firma: { flex: 1, padding: 6, minHeight: 70, justifyContent: "flex-end" },
  firmaTitulo: { fontFamily: "Helvetica-Bold", fontSize: 8, color: "#555", marginBottom: 18 },
  firmaNombre: { fontFamily: "Helvetica-Bold" },
  firmaCargo: { fontSize: 8 },
  firmaFecha: { fontSize: 8, color: "#555" },
  pie: { position: "absolute", bottom: 18, left: 36, right: 36, fontSize: 7.5, color: "#666", flexDirection: "row", justifyContent: "space-between" },
})

function Celda({ etiqueta, valor, borde }: { etiqueta: string; valor: string; borde?: boolean }) {
  return (
    <View style={borde ? [s.celda, s.celdaBorde] : s.celda}>
      <Text>
        <Text style={s.etiqueta}>{etiqueta}: </Text>
        {valor || "—"}
      </Text>
    </View>
  )
}

function Firma({ titulo, cargo, firma, borde }: { titulo: string; cargo: string; firma: { nombre: string; fecha: string } | null; borde?: boolean }) {
  return (
    <View style={borde ? [s.firma, s.celdaBorde] : s.firma}>
      <Text style={s.firmaTitulo}>{titulo}</Text>
      <Text style={s.firmaNombre}>{firma?.nombre ?? "Pendiente"}</Text>
      <Text style={s.firmaCargo}>{cargo}</Text>
      <Text style={s.firmaFecha}>{firma?.fecha ?? ""}</Text>
    </View>
  )
}

export function ContratoGeneralPDF({ hoja: h, logo }: { hoja: HojaContratoGeneral; logo: string | Buffer }) {
  return (
    <Document title={`Contrato general ${h.numero}`}>
      <Page size="LETTER" style={s.page}>
        <View style={s.encabezado}>
          <View style={s.logoCaja}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image style={s.logo} src={logo} />
          </View>
          <View style={s.empresa}>
            <Text style={s.empresaNombre}>{h.empresaNombre || "—"}</Text>
            <Text>NIT: {h.empresaNit || "—"}</Text>
            <Text>Ciudad: {h.ciudad || "—"}</Text>
          </View>
          <View style={s.numeroCaja}>
            <Text style={s.numeroEtiqueta}>CONTRATO NO.</Text>
            <Text style={s.numero}>{h.numero}</Text>
          </View>
        </View>

        <View style={s.seccion}>
          <Text style={s.seccionTitulo}>Contratista</Text>
          <View style={s.fila}>
            <Celda etiqueta="Contratista" valor={h.contratista.nombre} />
            <Celda etiqueta="NIT/CC" valor={h.contratista.documento} borde />
          </View>
          <View style={s.fila}>
            <Celda etiqueta="Dirección" valor={h.contratista.direccion} />
            <Celda etiqueta="Teléfono" valor={h.contratista.telefono} borde />
          </View>
          <View style={s.fila}>
            <Celda etiqueta="Email" valor={h.contratista.correo} />
            <Celda etiqueta="Ciudad" valor={h.contratista.ciudad} borde />
          </View>
        </View>

        <View style={s.seccion}>
          <Text style={s.seccionTitulo}>Contrato general</Text>
          <View style={s.fila}>
            <Celda etiqueta="Proyecto" valor={h.proyecto} />
          </View>
          <View style={s.fila}>
            <Celda etiqueta="Tipo contrato" valor={h.tipo} />
            <Celda etiqueta="Valor contrato" valor={h.valor} borde />
          </View>
          <View style={s.fila}>
            <Celda etiqueta="Fecha inicio" valor={h.fechaInicio} />
            <Celda etiqueta="Fecha terminación" valor={h.fechaFin} borde />
          </View>
          <View style={s.fila}>
            <Celda etiqueta="Estado" valor={h.estado} />
            <Celda etiqueta="Forma de pago" valor={h.formaPago} borde />
          </View>
          <View style={s.fila}>
            <Celda etiqueta="% Ret. garantías" valor={h.retencionGarantia} />
            <Celda etiqueta="% Ret. anticipo" valor={h.retencionAnticipo} borde />
          </View>
          <View style={s.fila}>
            <Celda etiqueta="% Ret. FIC" valor={h.retencionFic} />
            <Celda etiqueta="Referencia" valor={h.referencia} borde />
          </View>
          <View style={s.bloque}>
            <Text style={s.texto}>
              <Text style={s.etiqueta}>Descripción: </Text>
              {h.descripcion}
            </Text>
          </View>
          <View style={s.bloque}>
            <Text style={s.texto}>
              <Text style={s.etiqueta}>Observaciones: </Text>
              {h.observaciones || "—"}
            </Text>
          </View>
        </View>

        <View style={s.firmas} wrap={false}>
          <Firma titulo="Elaborado por" cargo="Director de obra" firma={h.elaboro} />
          <Firma titulo="Pre aprobado por" cargo="Jurídica" firma={h.preaprobo} borde />
          <Firma titulo="Aprobado por" cargo="Subgerencia" firma={h.aprobo} borde />
          <View style={[s.firma, s.celdaBorde]}>
            <Text style={s.firmaTitulo}>Firma y sello del contratista</Text>
          </View>
        </View>

        <View style={s.pie} fixed>
          <Text>Impresión contrato general · {h.numero}</Text>
          <Text>Fecha y hora de impresión: {h.impreso}</Text>
        </View>
      </Page>
    </Document>
  )
}
