import { Document, Image, Page, View, Text } from "@react-pdf/renderer"
import { formatearFechaHora } from "@/lib/fechas"
import { formatearCodigo, type FirmaDocumento } from "@/lib/firmas"
import { blanco, partesFecha } from "@/lib/minuta-mano-obra"
import { CONTROL_ACTA_POLIZA, ENCABEZADO_ACTA_POLIZA, type ActaPoliza } from "@/lib/acta-poliza"
import { Encabezado, P, s, campoResaltable, renglonConFoco } from "@/components/minuta-mano-obra-pdf"

// ---------------------------------------------------------------------------
// PDF del acta de aprobación de pólizas (plantilla GJ-F-013 versión 03). Los
// espacios que la plantilla deja para pegar (amparos y soporte de pago) son
// una tabla de amparos y un texto. Se genera en el servidor
// (app/(app)/contratos/poliza-acta/[id]/route.tsx). Aprobada, lleva la firma
// de quien la aprobó en Jurídica (20261129000000_firmas.sql).
// ---------------------------------------------------------------------------

export function ActaPolizaPDF({
  acta: a,
  logo,
  foco,
  borrador,
  firma,
}: {
  acta: ActaPoliza
  logo: string | Buffer
  foco?: string
  borrador?: boolean
  firma?: FirmaDocumento | null
}) {
  const res = campoResaltable(foco)
  const renglon = renglonConFoco(foco, "amparos")
  const fecha = partesFecha(a.fechaAprobacion)
  const textoFecha = fecha ? `A los ${fecha.dia} días del mes de ${fecha.mes} de ${fecha.anio}` : "A los ____ días del mes de ________ de ____"
  const contrato = blanco(a.numeroContrato)
  const amparos = a.amparos.length > 0 ? a.amparos : [{ amparo: "", valor: "", vigencia: "" }]
  const anchos = ["44%", "26%", "30%"]
  const resaltar = (i: number) => (i === renglon ? { backgroundColor: "#fff59d" } : {})

  return (
    <Document title={`Acta de aprobación de póliza · contrato ${contrato}`} author={a.empresaNombre}>
      <Page size="LETTER" style={s.page}>
        <Encabezado logo={logo} {...ENCABEZADO_ACTA_POLIZA} />
        <Text style={s.footer} fixed render={({ pageNumber, totalPages }) => `Acta de aprobación de póliza · contrato No. ${contrato} · Página ${pageNumber} de ${totalPages}`} />
        {borrador && <Text style={{ position: "absolute", top: 90, right: 72, fontSize: 9, color: "#b45309" }}>BORRADOR (póliza sin aprobar)</Text>}

        <Text style={s.titulo}>ACTA DE APROBACIÓN DE PÓLIZA CONTRATO No. {res("numeroContrato", contrato)}</Text>

        <P>
          <Text style={s.b}>PARA: </Text>
          {res("supervisorNombre", blanco(a.supervisorNombre))}
        </P>
        <P>
          <Text style={s.b}>SUPERVISOR DE CONTRATO No. </Text>
          {contrato}
        </P>
        <P>
          <Text style={s.b}>Correo: </Text>
          {res("correo", blanco(a.correo))}
        </P>
        <P>
          <Text style={s.b}>OBJETO: </Text>
          {res("objeto", blanco(a.objeto))}
        </P>

        <P>
          La presente acta se expide en cumplimiento de lo establecido en el Contrato No. {contrato} suscrito entre{" "}
          {res("empresaNombre", blanco(a.empresaNombre))} y {res("contratistaNombre", blanco(a.contratistaNombre))}. Se constató el contenido de la Póliza
          de Seguro de Cumplimiento Particular, expedida por la {res("aseguradora", blanco(a.aseguradora))}:
        </P>

        <View style={[s.tabla, { marginBottom: 10 }]} wrap={false}>
          <View style={s.tr}>
            {["Amparo", "Valor asegurado", "Vigencia"].map((t, j) => (
              <Text key={t} style={[s.th, { width: anchos[j] }, j > 0 ? s.celdaBorde : {}]}>
                {t}
              </Text>
            ))}
          </View>
          {amparos.map((x, i) => (
            <View key={i} style={[s.tr, resaltar(i)]}>
              <Text style={[s.td, { width: anchos[0] }]}>{blanco(x.amparo)}</Text>
              <Text style={[s.td, s.celdaBorde, { width: anchos[1] }]}>{blanco(x.valor)}</Text>
              <Text style={[s.td, s.celdaBorde, { width: anchos[2] }]}>{blanco(x.vigencia)}</Text>
            </View>
          ))}
        </View>

        <P>
          <Text style={s.b}>Certificado de pago de la póliza. </Text>
          {res("soportePago", blanco(a.soportePago))}
        </P>

        <P>
          Comparados los amparos, valores y vigencias contenidas en la póliza, la misma se ajusta a lo requerido por el Consorcio y en consecuencia se
          imparte la aprobación de la Póliza de seguro de cumplimiento particular.
        </P>
        <P>
          <Text style={s.b}>Fecha de aprobación: </Text>
          {res("fechaAprobacion", textoFecha)}.
        </P>

        <View style={{ marginTop: firma?.imagen ? 8 : 40 }} wrap={false}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- Image de react-pdf, no de HTML */}
          {firma?.imagen && <Image src={firma.imagen} style={{ maxHeight: 48, maxWidth: 170, objectFit: "contain", marginBottom: 2 }} />}
          <View style={[s.firmaLinea, { width: "50%" }]} />
          <Text style={s.b}>{res("asesorNombre", blanco(a.asesorNombre).toUpperCase())}</Text>
          <Text>{res("asesorCargo", blanco(a.asesorCargo))}</Text>
          {firma && (
            <Text style={{ fontSize: 7, color: "#555", marginTop: 3 }}>
              Firmado electrónicamente por {firma.nombre} el {formatearFechaHora(firma.firmadoAt)} · Código {formatearCodigo(firma.codigo)} ·
              verifícalo en la plataforma (tu nombre › Verificar documento)
            </Text>
          )}
        </View>

        <View style={s.control} wrap={false}>
          <Text style={s.controlTitulo}>APROBACIÓN Y CONTROL DE CAMBIOS DEL DOCUMENTO</Text>
          <View style={s.tabla}>
            {CONTROL_ACTA_POLIZA.firmas.map((fila, i) => (
              <View key={i} style={s.tr}>
                {fila.map((c, j) => (
                  <Text key={j} style={[i === 0 ? s.th : s.td, { width: j === 0 ? "20%" : "40%" }, j > 0 ? s.celdaBorde : {}, i > 0 && j === 0 ? s.b : {}]}>
                    {c}
                  </Text>
                ))}
              </View>
            ))}
          </View>
          <View style={[s.tabla, { marginTop: 8 }]}>
            <View style={s.tr}>
              {["VERSIÓN", "FECHA", "DESCRIPCIÓN DEL CAMBIO"].map((t, j) => (
                <Text key={t} style={[s.th, { width: j === 2 ? "60%" : "20%" }, j > 0 ? s.celdaBorde : {}]}>
                  {t}
                </Text>
              ))}
            </View>
            {CONTROL_ACTA_POLIZA.versiones.map((fila, i) => (
              <View key={i} style={s.tr}>
                {fila.map((c, j) => (
                  <Text key={j} style={[s.td, { width: j === 2 ? "60%" : "20%" }, j > 0 ? s.celdaBorde : {}]}>
                    {c}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </View>
      </Page>
    </Document>
  )
}
