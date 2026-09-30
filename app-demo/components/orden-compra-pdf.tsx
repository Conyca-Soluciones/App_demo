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

const styles = StyleSheet.create({
  page: { padding: 30, fontSize: 9, fontFamily: "Helvetica" },
  row: { flexDirection: "row" },
  headerLeft: { flex: 2 },
  headerRight: { flex: 1, alignItems: "flex-end", justifyContent: "center" },
  logo: { width: 150, objectFit: "contain" },
  labelValue: { flexDirection: "row", marginBottom: 2 },
  label: { width: 100, color: "#555" },
  value: { flex: 1 },
  tituloBloque: { fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 4, marginTop: 12 },
  box: { borderWidth: 1, borderColor: "#999", padding: 8, marginBottom: 8 },
  boxCols: { flexDirection: "row" },
  boxColLeft: { flex: 1, marginRight: 20 },
  boxColRight: { flex: 1 },
  table: { marginTop: 10, borderWidth: 1, borderColor: "#999" },
  tr: { flexDirection: "row" },
  th: { backgroundColor: "#3B6EA5", color: "#fff", padding: 4, fontSize: 8, fontFamily: "Helvetica-Bold" },
  td: { padding: 4, fontSize: 8, borderTopWidth: 1, borderColor: "#ccc" },
  colInsumo: { flex: 3 },
  colUm: { width: 35 },
  colCant: { width: 45, textAlign: "right" },
  colPrecio: { width: 60, textAlign: "right" },
  colDto: { width: 35, textAlign: "right" },
  colIva: { width: 60, textAlign: "right" },
  colTotal: { width: 65, textAlign: "right" },
  totales: { alignSelf: "flex-end", width: 220, marginTop: 6 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1 },
  totalRowFinal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
    borderTopWidth: 1,
    borderColor: "#333",
    marginTop: 2,
  },
  firmas: { flexDirection: "row", marginTop: 40, justifyContent: "space-between" },
  firma: { width: "30%", borderTopWidth: 1, borderColor: "#333", paddingTop: 4 },
  footer: { marginTop: 20, fontSize: 7, color: "#666" },
})

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
        <View style={styles.row}>
          <View style={styles.headerLeft}>
            <View style={styles.labelValue}>
              <Text style={styles.label}>Empresa</Text>
              <Text style={styles.value}>{orden.empresaNombre ?? orden.proyectoNombre ?? "—"}</Text>
            </View>
            <View style={styles.labelValue}>
              <Text style={styles.label}>NIT</Text>
              <Text style={styles.value}>{orden.empresaNit ?? "N/A"}</Text>
            </View>
            <View style={styles.labelValue}>
              <Text style={styles.label}>Dirección</Text>
              <Text style={styles.value}>N/A</Text>
            </View>
            <View style={styles.labelValue}>
              <Text style={styles.label}>Teléfono</Text>
              <Text style={styles.value}>N/A</Text>
            </View>
            <View style={styles.labelValue}>
              <Text style={styles.label}>Ciudad</Text>
              <Text style={styles.value}>{orden.proyectoCiudad ?? "N/A"}</Text>
            </View>
            <View style={styles.labelValue}>
              <Text style={styles.label}>Fecha y hora de impresión</Text>
              <Text style={styles.value}>{new Date().toLocaleString("es-CO")}</Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            <Image src={LOGO_CONYCA_PATH} style={styles.logo} />
          </View>
        </View>

        <View style={[styles.row, { marginTop: 10, justifyContent: "space-between" }]}>
          <Text>FECHA: {formatoFecha(orden.createdAt)}</Text>
          <Text>ORDEN DE COMPRA No. {orden.numero}</Text>
        </View>

        <Text style={styles.tituloBloque}>Datos proveedor</Text>
        <View style={styles.box}>
          <View style={styles.boxCols}>
            <View style={styles.boxColLeft}>
              <View style={styles.labelValue}>
                <Text style={styles.label}>Proveedor</Text>
                <Text style={styles.value}>{orden.proveedorNombre}</Text>
              </View>
              <View style={styles.labelValue}>
                <Text style={styles.label}>NIT</Text>
                <Text style={styles.value}>{orden.proveedorNit ?? "—"}</Text>
              </View>
              <View style={styles.labelValue}>
                <Text style={styles.label}>Dirección</Text>
                <Text style={styles.value}>{orden.proveedorDireccion ?? "—"}</Text>
              </View>
              <View style={styles.labelValue}>
                <Text style={styles.label}>Ciudad</Text>
                <Text style={styles.value}>{orden.proveedorCiudad ?? "—"}</Text>
              </View>
            </View>
            <View style={styles.boxColRight}>
              <View style={styles.labelValue}>
                <Text style={styles.label}>Teléfono</Text>
                <Text style={styles.value}>{orden.proveedorTelefono ?? "—"}</Text>
              </View>
              <View style={styles.labelValue}>
                <Text style={styles.label}>Email</Text>
                <Text style={styles.value}>{orden.proveedorEmail ?? "—"}</Text>
              </View>
              <View style={styles.labelValue}>
                <Text style={styles.label}>Contacto</Text>
                <Text style={styles.value}>{orden.proveedorContacto ?? "—"}</Text>
              </View>
              <View style={styles.labelValue}>
                <Text style={styles.label}>Condiciones de Pago</Text>
                <Text style={styles.value}>{orden.condicionesPago ?? "—"}</Text>
              </View>
            </View>
          </View>
        </View>

        <Text style={styles.tituloBloque}>Datos proyecto</Text>
        <View style={styles.box}>
          <View style={styles.boxCols}>
            <View style={styles.boxColLeft}>
              <View style={styles.labelValue}>
                <Text style={styles.label}>Proyecto</Text>
                <Text style={styles.value}>{orden.proyectoCodigo ?? orden.proyectoNombre ?? "—"}</Text>
              </View>
              <View style={styles.labelValue}>
                <Text style={styles.label}>Sitio de Entrega</Text>
                <Text style={styles.value}>{orden.sitioEntrega ?? "—"}</Text>
              </View>
              <View style={styles.labelValue}>
                <Text style={styles.label}>Contacto</Text>
                <Text style={styles.value}>{orden.contactoNombre ?? "—"}</Text>
              </View>
              <View style={styles.labelValue}>
                <Text style={styles.label}>Fecha de Entrega</Text>
                <Text style={styles.value}>{formatoFecha(orden.fechaEntrega)}</Text>
              </View>
            </View>
            <View style={styles.boxColRight}>
              <View style={styles.labelValue}>
                <Text style={styles.label}>Teléfono</Text>
                <Text style={styles.value}>{orden.telefono ?? "—"}</Text>
              </View>
              <View style={styles.labelValue}>
                <Text style={styles.label}>Ciudad</Text>
                <Text style={styles.value}>{orden.ciudad ?? "—"}</Text>
              </View>
              <View style={styles.labelValue}>
                <Text style={styles.label}>Email</Text>
                <Text style={styles.value}>{orden.email ?? "—"}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tr}>
            <Text style={[styles.th, styles.colInsumo]}>Insumo</Text>
            <Text style={[styles.th, styles.colUm]}>U.M.</Text>
            <Text style={[styles.th, styles.colCant]}>Cant.</Text>
            <Text style={[styles.th, styles.colPrecio]}>Vr. Unitario</Text>
            <Text style={[styles.th, styles.colDto]}>% Dto.</Text>
            <Text style={[styles.th, styles.colIva]}>IVA</Text>
            <Text style={[styles.th, styles.colTotal]}>Total</Text>
          </View>
          {orden.lineas.map((linea) => {
            const c = calcularLinea({
              cantidad: linea.cantidad,
              precioUnitario: linea.precioUnitario,
              porcentajeDescuento: linea.porcentajeDescuento,
              porcentajeIva: linea.porcentajeIva,
            })
            return (
              <View style={styles.tr} key={linea.id}>
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
            <Text style={{ fontFamily: "Helvetica-Bold" }}>TOTAL</Text>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{formatoMoneda(totales.total)}</Text>
          </View>
        </View>

        <Text style={{ marginTop: 10 }}>Son: {totalEnLetras}</Text>

        <Text style={{ marginTop: 4 }}>
          Descripción: Pedidos Obra  Observaciones: {orden.observaciones ?? ""}
        </Text>

        <Text style={{ marginTop: 4 }}>
          FAVOR FACTURAR A NOMBRE DE: {orden.empresaNombre ?? orden.proyectoNombre ?? "—"}  PROYECTO:{" "}
          {orden.proyectoCodigo ?? "—"}
        </Text>

        <View style={styles.firmas}>
          <View style={styles.firma}>
            <Text>Elaboró: {orden.creadaPorNombre ?? "—"}</Text>
          </View>
          <View style={styles.firma}>
            <Text>Aprobó: {orden.aprobadaPorNombre ?? "—"}</Text>
          </View>
          <View style={styles.firma}>
            <Text>Firma y sello del cliente:</Text>
          </View>
        </View>

        <Text style={styles.footer}>
          Documento generado automáticamente. Los nombres de Elaboró/Aprobó se muestran como
          constancia mientras se habilitan las firmas digitalizadas.
        </Text>
      </Page>
    </Document>
  )
}