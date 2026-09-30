import path from "path"
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer"
import { numeroALetrasCOP } from "@/lib/numero-a-letras"
import { calcularLinea, calcularTotalesOrden } from "@/lib/ordenes-compra-calculos"
import type { OrdenCompraDetalle } from "@/app/(app)/almacen/comprar-pedidos/actions"

const LOGO_CONYCA_PATH = path.join(process.cwd(), "public", "logo-conyca.png")

const formatoMoneda = (n: number) =>
  n.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const formatoFecha = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "—"

const AZUL = "#3B6EA5"
const GRIS_BORDE = "#D0D7DE"
const GRIS_TEXTO = "#57606A"

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: 30,
    paddingTop: 28,
    paddingBottom: 50,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#1F2328",
  },

  // Encabezado: logo de la empresa (izquierda) y datos de la orden (derecha)
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderColor: AZUL,
  },
  headerLeft: { flex: 1, flexDirection: "row", alignItems: "center" },
  logoEmpresa: { width: 70, height: 70, objectFit: "contain", marginRight: 12 },
  empresaNombre: { fontSize: 12, fontFamily: "Helvetica-Bold", color: AZUL, marginBottom: 2 },
  empresaDato: { fontSize: 8.5, color: GRIS_TEXTO, marginBottom: 1 },
  headerRight: { alignItems: "flex-end" },
  logoConyca: { width: 90, objectFit: "contain", marginBottom: 6 },
  tituloOrden: { fontSize: 13, fontFamily: "Helvetica-Bold", color: AZUL },
  numeroOrden: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 2 },
  fechaOrden: { fontSize: 8.5, color: GRIS_TEXTO, marginTop: 2 },

  // Tarjetas de datos
  cards: { flexDirection: "row", marginTop: 12 },
  card: { flex: 1, borderWidth: 1, borderColor: GRIS_BORDE, borderRadius: 3 },
  cardGap: { marginRight: 10 },
  cardTitulo: {
    backgroundColor: AZUL,
    color: "#fff",
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  cardBody: { padding: 8 },
  labelValue: { flexDirection: "row", marginBottom: 3 },
  label: { width: 68, color: GRIS_TEXTO },
  value: { flex: 1 },

  // Tabla de insumos
  table: { marginTop: 12, borderWidth: 1, borderColor: GRIS_BORDE },
  tr: { flexDirection: "row", alignItems: "stretch" },
  trPar: { flexDirection: "row", alignItems: "stretch", backgroundColor: "#F6F8FA" },
  th: { backgroundColor: AZUL, color: "#fff", padding: 4, fontSize: 8, fontFamily: "Helvetica-Bold" },
  td: { padding: 4, fontSize: 8, borderTopWidth: 1, borderColor: GRIS_BORDE },
  colInsumo: { flex: 3 },
  colUm: { width: 34 },
  colCant: { width: 44, textAlign: "right" },
  colPrecio: { width: 62, textAlign: "right" },
  colDto: { width: 36, textAlign: "right" },
  colIva: { width: 70, textAlign: "right" },
  colTotal: { width: 68, textAlign: "right" },

  // Notas y totales
  bottom: { flexDirection: "row", marginTop: 10, alignItems: "flex-start" },
  notas: { flex: 1, marginRight: 16 },
  notaTitulo: { fontFamily: "Helvetica-Bold", marginBottom: 2 },
  nota: { marginBottom: 6, lineHeight: 1.3 },
  totales: { width: 210, borderWidth: 1, borderColor: GRIS_BORDE, padding: 8 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  totalRowFinal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 4,
    marginTop: 3,
    borderTopWidth: 1.5,
    borderColor: AZUL,
  },
  totalFinalTxt: { fontFamily: "Helvetica-Bold", fontSize: 10, color: AZUL },

  firmas: { flexDirection: "row", marginTop: 44, justifyContent: "space-between" },
  firma: { width: "30%", borderTopWidth: 1, borderColor: "#333", paddingTop: 4 },
  firmaLabel: { fontSize: 7.5, color: GRIS_TEXTO },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 30,
    right: 30,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: GRIS_TEXTO,
    borderTopWidth: 0.5,
    borderColor: GRIS_BORDE,
    paddingTop: 4,
  },
})

function Dato({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.labelValue}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  )
}

export function OrdenCompraPDF({ orden }: { orden: OrdenCompraDetalle }) {
  const lineasCalculables = orden.lineas.map((l) => ({
    cantidad: l.cantidad,
    precioUnitario: l.precioUnitario,
    porcentajeDescuento: l.porcentajeDescuento,
    porcentajeIva: l.porcentajeIva,
  }))
  const bruto = lineasCalculables.reduce((acc, l) => acc + l.cantidad * l.precioUnitario, 0)
  const totales = calcularTotalesOrden(lineasCalculables)

  const totalEnLetras = numeroALetrasCOP(totales.total)

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {orden.empresaLogoUrl && <Image src={orden.empresaLogoUrl} style={styles.logoEmpresa} />}
            <View>
              <Text style={styles.empresaNombre}>
                {orden.empresaNombre ?? orden.proyectoNombre ?? "—"}
              </Text>
              <Text style={styles.empresaDato}>NIT: {orden.empresaNit ?? "N/A"}</Text>
              <Text style={styles.empresaDato}>Ciudad: {orden.proyectoCiudad ?? "N/A"}</Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            <Image src={LOGO_CONYCA_PATH} style={styles.logoConyca} />
            <Text style={styles.tituloOrden}>ORDEN DE COMPRA</Text>
            <Text style={styles.numeroOrden}>No. {orden.numero}</Text>
            <Text style={styles.fechaOrden}>Fecha: {formatoFecha(orden.createdAt)}</Text>
          </View>
        </View>

        <View style={styles.cards}>
          <View style={[styles.card, styles.cardGap]}>
            <Text style={styles.cardTitulo}>DATOS DEL PROVEEDOR</Text>
            <View style={styles.cardBody}>
              <Dato label="Proveedor" value={orden.proveedorNombre} />
              <Dato label="NIT" value={orden.proveedorNit ?? "—"} />
              <Dato label="Dirección" value={orden.proveedorDireccion ?? "—"} />
              <Dato label="Ciudad" value={orden.proveedorCiudad ?? "—"} />
              <Dato label="Teléfono" value={orden.proveedorTelefono ?? "—"} />
              <Dato label="Email" value={orden.proveedorEmail ?? "—"} />
              <Dato label="Contacto" value={orden.proveedorContacto ?? "—"} />
              <Dato label="Cond. de pago" value={orden.condicionesPago ?? "—"} />
            </View>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitulo}>DATOS DEL PROYECTO / ENTREGA</Text>
            <View style={styles.cardBody}>
              <Dato label="Proyecto" value={orden.proyectoCodigo ?? orden.proyectoNombre ?? "—"} />
              <Dato label="Sitio de entrega" value={orden.sitioEntrega ?? "—"} />
              <Dato label="Fecha de entrega" value={formatoFecha(orden.fechaEntrega)} />
              <Dato label="Ciudad" value={orden.ciudad ?? "—"} />
              <Dato label="Contacto" value={orden.contactoNombre ?? "—"} />
              <Dato label="Teléfono" value={orden.telefono ?? "—"} />
              <Dato label="Email" value={orden.email ?? "—"} />
            </View>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tr} fixed>
            <Text style={[styles.th, styles.colInsumo]}>Insumo</Text>
            <Text style={[styles.th, styles.colUm]}>U.M.</Text>
            <Text style={[styles.th, styles.colCant]}>Cant.</Text>
            <Text style={[styles.th, styles.colPrecio]}>Vr. Unitario</Text>
            <Text style={[styles.th, styles.colDto]}>% Dto.</Text>
            <Text style={[styles.th, styles.colIva]}>IVA</Text>
            <Text style={[styles.th, styles.colTotal]}>Total</Text>
          </View>
          {orden.lineas.map((linea, idx) => {
            const c = calcularLinea({
              cantidad: linea.cantidad,
              precioUnitario: linea.precioUnitario,
              porcentajeDescuento: linea.porcentajeDescuento,
              porcentajeIva: linea.porcentajeIva,
            })
            return (
              <View style={idx % 2 === 1 ? styles.trPar : styles.tr} key={linea.id} wrap={false}>
                <Text style={[styles.td, styles.colInsumo]}>
                  {linea.insumoCodigo} - {linea.insumoDescripcion}
                </Text>
                <Text style={[styles.td, styles.colUm]}>{linea.um ?? "—"}</Text>
                <Text style={[styles.td, styles.colCant]}>{linea.cantidad.toLocaleString("es-CO")}</Text>
                <Text style={[styles.td, styles.colPrecio]}>{formatoMoneda(linea.precioUnitario)}</Text>
                <Text style={[styles.td, styles.colDto]}>{linea.porcentajeDescuento}%</Text>
                <Text style={[styles.td, styles.colIva]}>
                  {linea.porcentajeIva}% · {formatoMoneda(c.iva)}
                </Text>
                <Text style={[styles.td, styles.colTotal]}>{formatoMoneda(c.total)}</Text>
              </View>
            )
          })}
        </View>

        <View style={styles.bottom} wrap={false}>
          <View style={styles.notas}>
            <Text style={styles.notaTitulo}>Son:</Text>
            <Text style={styles.nota}>{totalEnLetras}</Text>
            <Text style={styles.notaTitulo}>Observaciones:</Text>
            <Text style={styles.nota}>Pedidos Obra. {orden.observaciones ?? ""}</Text>
            <Text style={styles.notaTitulo}>Favor facturar a nombre de:</Text>
            <Text style={styles.nota}>
              {orden.empresaNombre ?? orden.proyectoNombre ?? "—"} · Proyecto:{" "}
              {orden.proyectoCodigo ?? "—"}
            </Text>
          </View>
          <View style={styles.totales}>
            <View style={styles.totalRow}>
              <Text>Subtotal</Text>
              <Text>{formatoMoneda(bruto)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text>Descuento</Text>
              <Text>{formatoMoneda(totales.descuento)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text>IVA</Text>
              <Text>{formatoMoneda(totales.iva)}</Text>
            </View>
            <View style={styles.totalRowFinal}>
              <Text style={styles.totalFinalTxt}>TOTAL</Text>
              <Text style={styles.totalFinalTxt}>{formatoMoneda(totales.total)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.firmas} wrap={false}>
          <View style={styles.firma}>
            <Text>{orden.creadaPorNombre ?? "—"}</Text>
            <Text style={styles.firmaLabel}>Elaboró</Text>
          </View>
          <View style={styles.firma}>
            <Text>{orden.aprobadaPorNombre ?? "—"}</Text>
            <Text style={styles.firmaLabel}>Aprobó</Text>
          </View>
          <View style={styles.firma}>
            <Text> </Text>
            <Text style={styles.firmaLabel}>Firma y sello del cliente</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>
            Generado el {new Date().toLocaleString("es-CO")} · Las firmas se muestran como constancia
            mientras se habilitan las firmas digitalizadas.
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
