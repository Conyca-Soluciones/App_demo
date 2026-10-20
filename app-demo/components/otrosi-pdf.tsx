import { Document, Page, View, Text } from "@react-pdf/renderer"
import { blanco, cantidadEnLetras, ordinalClausula, partesFecha } from "@/lib/minuta-mano-obra"
import { tipoDocumentoArrendador } from "@/lib/minuta-arrendamiento"
import type { MinutaOtrosi } from "@/lib/otrosi"
import { Clausula, Encabezado, P, s, campoResaltable, renglonConFoco, resaltado, unirTexto } from "@/components/minuta-mano-obra-pdf"

// ---------------------------------------------------------------------------
// PDF del otrosí (plantilla "OTROSÍ" versión 04, 9/05/2025): una cláusula por
// cada modificación ("Modificar la cláusula X" + cómo queda), las cláusulas no
// modificadas y el perfeccionamiento, numeradas seguidas (la plantilla salta de
// SEGUNDA a SEXTO). Se genera en el servidor
// (app/(app)/contratos/otrosi-pdf/[id]/route.tsx).
// ---------------------------------------------------------------------------

// Así viene el encabezado de la plantilla (el código no trae número).
const ENCABEZADO = { formato: "OTROSÍ", codigo: "GJ-F", version: "04", fecha: "9/05/2025" }

export function OtrosiPDF({ minuta: m, numero, logo, foco }: { minuta: MinutaOtrosi; numero: number; logo: string | Buffer; foco?: string }) {
  const res = campoResaltable(foco)
  const renglon = renglonConFoco(foco, "modificaciones")
  const fecha = partesFecha(m.fechaFirma)
  const juridica = m.contratistaTipoPersona === "juridica"
  const documento = tipoDocumentoArrendador(m.contratistaTipoDocumento)
  const lugarFecha = fecha
    ? `a los ${cantidadEnLetras(fecha.dia)} ${fecha.dia === 1 ? "día" : "días"} del mes de ${fecha.mes} del año ${fecha.anio}`
    : "a los ____ días del mes de ________ del año ____"
  const contrato = blanco(m.numeroContrato)
  const mods = m.modificaciones.length > 0 ? m.modificaciones : [{ clausula: "", redaccion: "" }]
  const pie = ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
    `Otrosí N° ${numero} al contrato No. ${contrato} · Página ${pageNumber} de ${totalPages}`

  return (
    <Document title={`Otrosí N° ${numero} al contrato ${contrato}`} author={m.contratanteNombre}>
      <Page size="LETTER" style={s.page}>
        <Encabezado logo={logo} {...ENCABEZADO} />
        <Text style={s.footer} fixed render={pie} />

        <Text style={[s.titulo, { marginBottom: 2 }]}>OTROSÍ Nº {numero} AL CONTRATO</Text>
        <Text style={s.titulo}>No. {res("numeroContrato", contrato)}</Text>

        <P>
          Entre los suscritos a saber: <Text style={s.b}>{res("contratanteNombre", blanco(m.contratanteNombre))},</Text> con Nit.{" "}
          {res("contratanteNit", blanco(m.contratanteNit))}, representado por {res("contratanteRepresentante", blanco(m.contratanteRepresentante))}, con
          cédula N° {res("contratanteRepresentanteCedula", blanco(m.contratanteRepresentanteCedula))} expedida en{" "}
          {res("contratanteRepresentanteExpedida", blanco(m.contratanteRepresentanteExpedida))}, en calidad de <Text style={s.b}>CONTRATANTE</Text>, de
          una parte y por la otra,{" "}
          {juridica ? (
            <>
              <Text style={s.b}>{res("contratistaNombre", blanco(m.contratistaNombre))},</Text> con Nit. {res("contratistaNit", blanco(m.contratistaNit))},
              representada legalmente por {res("contratistaRepresentante", blanco(m.contratistaRepresentante))} mayor de edad, identificado con{" "}
              {documento.articulo} {documento.texto} No. {res("contratistaCedula", blanco(m.contratistaCedula))}
            </>
          ) : (
            <>
              <Text style={s.b}>{res("contratistaNombre", blanco(m.contratistaNombre))},</Text> mayor de edad, identificado con {documento.articulo}{" "}
              {documento.texto} No. {res("contratistaCedula", blanco(m.contratistaCedula))}
            </>
          )}
          , domiciliado y residente en la ciudad de {res("contratistaCiudad", blanco(m.contratistaCiudad))}, en calidad de{" "}
          <Text style={s.b}>CONTRATISTA</Text>, hemos convenido celebrar el otrosí Nº {numero} al presente contrato:
        </P>

        {mods.map((mod, i) => {
          const parrafos = mod.redaccion.split(/\n+/).map((t) => t.trim()).filter(Boolean)
          const conFoco = i === renglon
          return (
            <View key={i}>
              <Clausula titulo={`${ordinalClausula(i + 1).toUpperCase()}.`}>
                Modificar la cláusula {conFoco ? resaltado(blanco(mod.clausula)) : blanco(mod.clausula)}, la cual quedará así:
              </Clausula>
              {(parrafos.length > 0 ? parrafos : [blanco(null)]).map((t, j) => (
                <Text key={j} style={[s.p, { paddingLeft: 18 }]}>
                  {conFoco ? unirTexto(resaltado(t)) : t}
                </Text>
              ))}
            </View>
          )
        })}

        <Clausula titulo={`${ordinalClausula(mods.length + 1).toUpperCase()}. CLÁUSULAS NO MODIFICADAS:`}>
          Las demás cláusulas y estipulaciones contenidas en el {res("nombreContrato", blanco(m.nombreContrato))} No. {contrato} continúan vigentes de
          acuerdo a lo convenido en el contrato inicial. El presente Otrosí hace parte integral del enunciado contrato.
        </Clausula>
        <Clausula titulo={`${ordinalClausula(mods.length + 2).toUpperCase()}.`}>El presente documento se perfecciona con la firma de las partes.</Clausula>

        <P>
          En constancia de lo anterior, se firma en la ciudad de {res("ciudadFirma", blanco(m.ciudadFirma))} {res("fechaFirma", lugarFecha)}.
        </P>

        <View style={s.firmas} wrap={false}>
          <View style={s.firma}>
            <Text style={[s.b, { marginBottom: 36 }]}>EL CONTRATISTA</Text>
            <View style={s.firmaLinea} />
            <Text style={s.b}>{res("contratistaNombre", blanco(m.contratistaNombre))}</Text>
            {juridica && <Text>NIT. {res("contratistaNit", blanco(m.contratistaNit))}</Text>}
            {juridica && <Text>RL. {res("contratistaRepresentante", blanco(m.contratistaRepresentante))}</Text>}
            <Text>
              {documento.firma} {res("contratistaCedula", blanco(m.contratistaCedula))}
            </Text>
          </View>
          <View style={s.firma}>
            <Text style={[s.b, { marginBottom: 36 }]}>EL CONTRATANTE</Text>
            <View style={s.firmaLinea} />
            <Text style={s.b}>{res("contratanteNombre", blanco(m.contratanteNombre))}</Text>
            <Text>NIT. {res("contratanteNit", blanco(m.contratanteNit))}</Text>
            <Text>RL. {res("contratanteRepresentante", blanco(m.contratanteRepresentante))}</Text>
            <Text>CC. {res("contratanteRepresentanteCedula", blanco(m.contratanteRepresentanteCedula))}</Text>
          </View>
        </View>
      </Page>
    </Document>
  )
}
