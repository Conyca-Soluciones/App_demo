import { Document, Page, View, Text } from "@react-pdf/renderer"
import { leerNumero } from "@/lib/contratos"
import { blanco, cantidadEnLetras, ordinalClausula, partesFecha, pesosSinSimbolo } from "@/lib/minuta-mano-obra"
import { tipoDocumentoArrendador } from "@/lib/minuta-arrendamiento"
import { PRIMERA_CLAUSULA_ADICIONAL_VEHICULO, obligacionOferta, type MinutaVehiculo } from "@/lib/minuta-vehiculo"
import { Clausula, Encabezado, Lista, P, s } from "@/components/minuta-mano-obra-pdf"

// ---------------------------------------------------------------------------
// PDF de la minuta del contrato de alquiler de vehículo o maquinaria: el texto
// de la plantilla de Jurídica (versión 04) con los campos de la minuta. Se
// genera en el servidor (app/(app)/contratos/pre-aprobacion/[id]/minuta/route.tsx).
// ---------------------------------------------------------------------------

// Así viene el encabezado de la plantilla (el código es el mismo de la de mano de obra).
const ENCABEZADO = { formato: "CONTRATO DE ALQUILER DE VEHICULO O MAQUINARIA", codigo: "GJ-F-003", version: "04", fecha: "9/05/2025" }

const numero = (i: number) => `${i + 1}.`
const pct = (t: string) => `${blanco(t.replace(/%/g, ""))}%`

export function MinutaVehiculoPDF({ minuta: m, numero: numeroContrato, logo }: { minuta: MinutaVehiculo; numero: number; logo: string | Buffer }) {
  const fecha = partesFecha(m.fechaFirma)
  const juridica = m.contratistaTipoPersona === "juridica"
  const documento = tipoDocumentoArrendador(m.contratistaTipoDocumento)
  const valor = leerNumero(m.valor)
  const anticipo = leerNumero(m.anticipo)
  const conAnticipo = Boolean(m.anticipo.trim())
  const consecutivo = `No. CJ-${numeroContrato}-${fecha ? fecha.anio : "20__"}`
  const lugarFecha = fecha
    ? `a los ${cantidadEnLetras(fecha.dia)} ${fecha.dia === 1 ? "día" : "días"} del mes de ${fecha.mes} del año ${fecha.anio}`
    : "a los ____ días del mes de ________ del año ____"
  const especificas = [...m.obligacionesEspecificas, obligacionOferta(m.ofertaMercantil)]
  const anchosAmparo = { amparo: "40%", porcentaje: "20%", vigencia: "40%" }

  return (
    <Document title={`Contrato de alquiler de vehículo o maquinaria ${consecutivo}`} author={m.contratanteNombre}>
      <Page size="LETTER" style={s.page}>
        <Encabezado logo={logo} {...ENCABEZADO} />
        <Text
          style={s.footer}
          fixed
          render={({ pageNumber, totalPages }) => `Contrato de alquiler de vehículo o maquinaria ${consecutivo} · Página ${pageNumber} de ${totalPages}`}
        />

        <Text style={[s.titulo, { marginBottom: 2 }]}>CONTRATO DE ALQUILER DE VEHICULO O MAQUINARIA</Text>
        <Text style={s.titulo}>{consecutivo}</Text>

        <P>
          Entre los suscritos a saber: <Text style={s.b}>{blanco(m.contratanteNombre)}</Text> con Nit. {blanco(m.contratanteNit)}, representado por{" "}
          {blanco(m.contratanteRepresentante)}, con cédula N° {blanco(m.contratanteRepresentanteCedula)}, quien para efectos del presente contrato se
          denominará <Text style={s.b}>EL CONTRATANTE,</Text> de una parte y por la otra,{" "}
          {juridica ? (
            <>
              <Text style={s.b}>{blanco(m.contratistaNombre)}</Text> con Nit. {blanco(m.contratistaNit)}, representado por {blanco(m.contratistaRepresentante)},
              mayor de edad, con {documento.texto} No. {blanco(m.contratistaCedula)}
            </>
          ) : (
            <>
              <Text style={s.b}>{blanco(m.contratistaNombre)},</Text> mayor de edad, con {documento.texto} No. {blanco(m.contratistaCedula)}, actuando en
              nombre propio
            </>
          )}
          , quien para los efectos del presente documento se denominará <Text style={s.b}>EL CONTRATISTA,</Text> acuerdan celebrar el presente negocio
          jurídico, previo a las siguientes consideraciones:
        </P>

        <Clausula titulo="PRIMERA. OBJETO:">
          Entregar en calidad alquiler y poner a disposición de este, para su utilización durante el periodo contratado, {blanco(m.bien)} para uso en el
          proyecto {blanco(m.obra)}. <Text style={s.b}>PARAGRAFO.</Text> La maquinaria deberá ser entregada en condiciones óptimas de funcionamiento,
          seguridad, operación y conservación, y deberá ser apta para desarrollar las actividades para las cuales se contrata.{" "}
          <Text style={s.b}>PARAGRAFO SEGUNDO.</Text> Hacen parte de la maquinaria y serán entregados para su operación los accesorios y componentes
          relacionados en la Oferta Mercantil No. {blanco(m.ofertaMercantil)}.
        </Clausula>

        <Clausula titulo="SEGUNDA. PLAZO DEL CONTRATO.">
          El periodo de operación será de {blanco(m.periodo)} contado a partir de su llegada a la obra
          {m.horasOperacion.trim() ? `, o ${m.horasOperacion.trim()}, lo que ocurra primero` : ""}.
        </Clausula>

        <Clausula titulo="TERCERA. VALOR DEL CONTRATO:">
          El valor total del presente contrato es de{" "}
          <Text style={s.b}>
            {blanco(m.valorLetras)} M/CTE (${valor !== null ? pesosSinSimbolo(valor) : blanco(m.valor)}),
          </Text>{" "}
          correspondiente a: {blanco(m.detalleValor)}
        </Clausula>

        <Clausula titulo="CUARTA. ANTICIPO:">
          {conAnticipo ? (
            <>
              EL CONTRATANTE entregará a EL CONTRATISTA, en calidad de anticipo, la suma de{" "}
              <Text style={s.b}>
                {blanco(m.anticipoLetras)} M/CTE (${anticipo !== null ? pesosSinSimbolo(anticipo) : blanco(m.anticipo)}),
              </Text>{" "}
              correspondiente al anticipo pactado entre las partes.
            </>
          ) : (
            "EL CONTRATANTE no entregará anticipo a EL CONTRATISTA."
          )}
        </Clausula>

        <Clausula titulo="QUINTA. FORMA DE PAGO:">
          EL CONTRATANTE pagará a el contratista de la siguiente manera: Los pagos se efectuaran mediante actas parciales {blanco(m.periodicidadPago)}
          {conAnticipo ? " sobre las cuales se realizará la amortización del anticipo de manera proporcional al valor de las actas." : "."}
        </Clausula>
        {m.condicionesPago.trim() && <P>{m.condicionesPago.trim()}</P>}

        <Text style={[s.p, s.b]}>SEXTA. OBLIGACIONES DEL CONTRATANTE:</Text>
        <Lista items={m.obligacionesContratante} marcador={numero} />

        <Text style={[s.p, s.b]}>SEPTIMA. OBLIGACIONES GENERALES DEL CONTRATISTA:</Text>
        <Lista items={m.obligacionesGenerales} marcador={numero} />

        <Text style={[s.p, s.b]}>OCTAVA. OBLIGACIONES ESPECIFICAS DEL CONTRATISTA:</Text>
        <Lista items={especificas} marcador={numero} />

        <Clausula titulo="NOVENA. INDEPENDENCIA DEL CONTRATISTA:">
          El contratista actuará por su propia cuenta, con absoluta autonomía y no estará sometido a subordinación laboral con el contratante,
          comprometiéndose a realizar con sus propios medios y bajo su responsabilidad esta obra, por tanto, este contrato no es de carácter laboral y no
          genera prestaciones laborales a su favor.
        </Clausula>

        <Clausula titulo="DECIMA. CESIÓN O SUBCONTRATACIÓN DEL OBJETO DEL CONTRATO:">
          El contratista no podrá ceder a persona alguna natural o jurídica, Nacional o extranjera, el presente contrato ni subcontratar el objeto
          contratado. Para la cesión del presente contrato se requiere de previa autorización por escrito del contratante.
        </Clausula>

        <Clausula titulo="DECIMA PRIMERA. MANTENIMIENTO Y REPARACIONES.">
          El mantenimiento preventivo y correctivo derivado del desgaste normal del vehículo/maquinaria y de su utilización conforme a las especificaciones
          del fabricante estará a cargo de el contratista, salvo pacto escrito en contrario.
        </Clausula>

        <Clausula titulo="DECIMA SEGUNDA. RESPONSABILIDAD:">El Contratista es responsable por el cumplimiento de las obligaciones pactadas en el Contrato.</Clausula>

        <Clausula titulo="DECIMA TERCERA. - MODIFICACIONES:">
          El presente contrato podrá modificarse previo acuerdo de las partes el cual deberá constar por escrito.
        </Clausula>

        <Clausula titulo="DECIMA CUARTA. CAUSALES DE TERMINACIÓN:">
          Sin perjuicio de lo contemplado en la ley, este contrato se terminará: 1. Por vencimiento del término fijado en el presente contrato para la
          ejecución del mismo. 2. Por la ejecución del objeto contratado. 3. Por incumplimiento de las obligaciones del contratista o el contratante. 4. Por
          mutuo acuerdo de las partes.
        </Clausula>

        {m.garantia === "no_exige" ? (
          <Clausula titulo="DECIMA QUINTA. GARANTÍAS:">Para la ejecución del presente contrato no se exigirá la constitución de garantías.</Clausula>
        ) : m.garantia === "exige" ? (
          <>
            <Clausula titulo="DECIMA QUINTA. GARANTÍAS:">
              Para cubrir cualquier hecho constitutivo de incumplimiento, el contratista se compromete a constituir a favor del contratante, una garantía que
              ampare lo siguiente:
            </Clausula>
            <View style={[s.tabla, { marginBottom: 10 }]} wrap={false}>
              <View style={s.tr}>
                <Text style={[s.th, { width: anchosAmparo.amparo }]}>AMPAROS</Text>
                <Text style={[s.th, { width: anchosAmparo.porcentaje, textAlign: "center" }]}>% DE AMPARO</Text>
                <Text style={[s.th, { width: anchosAmparo.vigencia }]}>VIGENCIA</Text>
              </View>
              {m.amparos.map((a, i) => (
                <View key={i} style={s.tr}>
                  <Text style={[s.td, { width: anchosAmparo.amparo }]}>{blanco(a.amparo)}</Text>
                  <Text style={[s.td, s.celdaBorde, { width: anchosAmparo.porcentaje, textAlign: "center" }]}>{pct(a.porcentaje)}</Text>
                  <Text style={[s.td, s.celdaBorde, { width: anchosAmparo.vigencia }]}>{blanco(a.vigencia)}</Text>
                </View>
              ))}
            </View>
            <P>
              La garantía deberá estar firmada por el Representante Legal de LA CONTRATISTA, las primas serán de su cargo y deberán estar acompañadas de los
              recibos de cancelación expedidos por la entidad aseguradora, las mismas deberán ser entregadas para su aprobación al contratante a más tardar
              tres (3) días después de la suscripción del presente contrato. <Text style={s.b}>PARAGRAFO PRIMERO:</Text> En caso de ser necesario, el
              contratista podrá presentar una garantía diferente a la enunciada, siempre que esta sea aceptada por el contratante.
            </P>
          </>
        ) : (
          <Clausula titulo="DECIMA QUINTA. GARANTÍAS:">__________</Clausula>
        )}

        <Clausula titulo="DECIMA SEXTA. PERÍODOS ADICIONALES Y PRÓRROGA.">
          La utilización de la {blanco(m.bienNombre).toUpperCase()} por un período adicional deberá ser solicitada formalmente por el contratante con una
          anticipación mínima de diez (10) días. La solicitud del contratante no genera por sí misma obligación del contratista de aceptar la prórroga o
          período adicional, el cual estará sujeto a la aceptación expresa del contratista.
        </Clausula>

        <Clausula titulo="DECIMA SEPTIMA. DOMICILIO:">
          Para todos los efectos leales, las partes acuerdan como domicilio de este contrato la ciudad de {blanco(m.domicilio)}.
        </Clausula>

        <Clausula titulo="DECIMA OCTAVA. DOCUMENTOS DEL CONTRATO:">
          Forma parte integral del presente contrato la Oferta Mercantil No. {blanco(m.ofertaMercantil)}, presentada y aceptada por las partes, junto con
          los demás documentos que expresamente se incorporen al negocio jurídico. Las condiciones técnicas, económicas y operativas contenidas en la Oferta
          Mercantil No. {blanco(m.ofertaMercantil)} se mantienen vigentes y deberán interpretarse de manera armónica con el presente contrato.
        </Clausula>

        <Clausula titulo="DECIMA NOVENA. SOLUCION DE CONTROVERSIAS:">
          Cualquier disputa o diferencia que surja con ocasión del objeto y obligaciones de este contrato serán arregladas en lo posible mediante la
          negociación y la conciliación entre las partes.
        </Clausula>

        <Clausula titulo="VIGESIMA. LIQUIDACIÓN DEL CONTRATO:">
          El término para la liquidación bilateral del contrato será de dos (2) meses siguientes a la expiración del término previsto para la ejecución del
          contrato.
        </Clausula>

        <Clausula titulo="VIGESIMA PRIMERA. SUPERVISIÓN:">
          La supervisión del presente contrato y del cumplimiento de las obligaciones derivadas del mismo, estarán a cargo del director de Obra o quien haga
          sus veces.
        </Clausula>

        <Clausula titulo="VIGESIMA SEGUNDA- LUGAR DE EJECUCIÓN:">
          Las actividades objeto del contrato se desarrollarán en la ciudad de {blanco(m.ciudadEjecucion)} – {blanco(m.departamentoEjecucion)}.
        </Clausula>

        <Clausula titulo="VIGESIMA TERCERA. – REQUISITOS DE PERFECCIONAMIENTO Y EJECUCIÓN:">
          El presente contrato se perfecciona con la suscripción de las partes.
        </Clausula>

        <Clausula titulo="VIGESIMA CUARTA. – NOTIFICACIONES:">
          Las partes autorizan recibir notificaciones en las siguientes direcciones El contratante al correo electrónico {blanco(m.contratanteCorreo)} y el
          contratista al correo electrónico {blanco(m.contratistaCorreo)}.
        </Clausula>

        {m.clausulasAdicionales.map((c, i) => (
          <Clausula key={i} titulo={`${ordinalClausula(PRIMERA_CLAUSULA_ADICIONAL_VEHICULO + i)}. – ${blanco(c.titulo).toUpperCase()}:`}>
            {c.texto}
          </Clausula>
        ))}

        <P>
          En constancia de lo anterior, se firma en la ciudad de {blanco(m.ciudadFirma)} {lugarFecha}.
        </P>

        <View style={s.firmas} wrap={false}>
          <View style={s.firma}>
            <Text style={[s.b, { marginBottom: 36 }]}>EL CONTRATANTE</Text>
            <View style={s.firmaLinea} />
            <Text style={s.b}>{blanco(m.contratanteNombre)}</Text>
            <Text>NIT. {blanco(m.contratanteNit)}</Text>
            <Text>RL. {blanco(m.contratanteRepresentante)}</Text>
            <Text>CC. {blanco(m.contratanteRepresentanteCedula)}</Text>
          </View>
          <View style={s.firma}>
            <Text style={[s.b, { marginBottom: 36 }]}>EL CONTRATISTA</Text>
            <View style={s.firmaLinea} />
            <Text style={s.b}>{blanco(m.contratistaNombre)}</Text>
            {juridica && <Text>NIT. {blanco(m.contratistaNit)}</Text>}
            {juridica && <Text>RL. {blanco(m.contratistaRepresentante)}</Text>}
            <Text>
              {documento.firma} {blanco(m.contratistaCedula)}
            </Text>
          </View>
        </View>
      </Page>
    </Document>
  )
}
