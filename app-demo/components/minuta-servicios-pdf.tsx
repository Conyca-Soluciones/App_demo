import { Document, Page, View, Text } from "@react-pdf/renderer"
import { leerNumero } from "@/lib/contratos"
import { blanco, cantidadEnLetras, fechaLarga, ordinalClausula, partesFecha, pesosSinSimbolo } from "@/lib/minuta-mano-obra"
import { tipoDocumentoArrendador } from "@/lib/minuta-arrendamiento"
import { PRIMERA_CLAUSULA_ADICIONAL_SERVICIOS, type MinutaServicios } from "@/lib/minuta-servicios"
import { Clausula, Encabezado, Lista, P, s, campoResaltable, renglonConFoco } from "@/components/minuta-mano-obra-pdf"

// ---------------------------------------------------------------------------
// PDF de la minuta del contrato de prestación de servicios: el texto de la
// plantilla GJ-F-020 de Jurídica con los campos de la minuta. Se genera en el
// servidor (app/(app)/contratos/pre-aprobacion/[id]/minuta/route.tsx).
// ---------------------------------------------------------------------------

const ENCABEZADO = { formato: "CONTRATO DE PRESTACIÓN DE SERVICIOS", codigo: "GJ-F-020", version: "02", fecha: "19/11/2024" }

const numero = (i: number) => `${i + 1}.`

export function MinutaServiciosPDF({ minuta: m, numero: numeroContrato, logo, foco }: { minuta: MinutaServicios; numero: number; logo: string | Buffer; foco?: string }) {
  const res = campoResaltable(foco)
  const r = (lista: string) => renglonConFoco(foco, lista)
  const fecha = partesFecha(m.fechaFirma)
  const juridica = m.contratistaTipoPersona === "juridica"
  const documento = tipoDocumentoArrendador(m.contratistaTipoDocumento)
  const valor = leerNumero(m.valor)
  const consecutivo = `No. CJ-${numeroContrato}-${fecha ? fecha.anio : "20__"}`
  const lugarFecha = fecha
    ? `a los ${cantidadEnLetras(fecha.dia)} ${fecha.dia === 1 ? "día" : "días"} del mes de ${fecha.mes} de ${fecha.anio}`
    : "a los ____ días del mes de ________ de ____"
  const pct = m.clausulaPenalPorcentaje.replace(/%/g, "").trim()

  return (
    <Document title={`Contrato de prestación de servicios ${consecutivo}`} author={m.contratanteNombre}>
      <Page size="LETTER" style={s.page}>
        <Encabezado logo={logo} {...ENCABEZADO} />
        <Text
          style={s.footer}
          fixed
          render={({ pageNumber, totalPages }) => `Contrato de prestación de servicios ${consecutivo} · Página ${pageNumber} de ${totalPages}`}
        />

        <Text style={[s.titulo, { marginBottom: 2 }]}>CONTRATO PRESTACIÓN DES SERVICIOS PROFESIONALES</Text>
        <Text style={s.titulo}>{consecutivo}</Text>

        <P>
          Entre los suscritos a saber: <Text style={s.b}>{res("contratanteNombre", blanco(m.contratanteNombre))},</Text> con NIT. {res("contratanteNit", blanco(m.contratanteNit))}, representado por{" "}
          <Text style={s.b}>{res("contratanteRepresentante", blanco(m.contratanteRepresentante))},</Text> mayor de edad identificado con cedula número {res("contratanteRepresentanteCedula", blanco(m.contratanteRepresentanteCedula))},
          en adelante el <Text style={s.b}>CONTRATANTE,</Text> por una parte y por la otra,{" "}
          {juridica ? (
            <>
              <Text style={s.b}>{res("contratistaNombre", blanco(m.contratistaNombre))},</Text> con NIT. {res("contratistaNit", blanco(m.contratistaNit))}, representada por{" "}
              <Text style={s.b}>{res("contratistaRepresentante", blanco(m.contratistaRepresentante))},</Text> mayor de edad, identificado con {documento.articulo} {documento.texto} Nro.{" "}
              <Text style={s.b}>{res("contratistaCedula", blanco(m.contratistaCedula))}</Text> {documento.expedido} en <Text style={s.b}>{res("contratistaCedulaExpedida", blanco(m.contratistaCedulaExpedida))},</Text>
            </>
          ) : (
            <>
              <Text style={s.b}>{res("contratistaNombre", blanco(m.contratistaNombre))},</Text> mayor de edad, identificado con {documento.articulo} {documento.texto} Nro.{" "}
              <Text style={s.b}>{res("contratistaCedula", blanco(m.contratistaCedula))}</Text> {documento.expedido} en <Text style={s.b}>{res("contratistaCedulaExpedida", blanco(m.contratistaCedulaExpedida))},</Text>{" "}
              actuando en nombre y representación propia,
            </>
          )}{" "}
          en adelante <Text style={s.b}>EL CONTRATISTA,</Text> hemos celebrado el presente <Text style={s.b}>CONTRATO DE PRESTACIÓN DE SERVICIOS,</Text>{" "}
          regido además por las siguientes.
        </P>
        <Text style={[s.p, s.b]}>CLÁUSULAS:</Text>

        <Clausula titulo="PRIMERA- OBJETO:">
          El contratista se compromete con el contratante a prestar de manera diligente y con plena autonomía, los servicios profesionales como{" "}
          {res("servicio", blanco(m.servicio))}, para el proyecto {res("obra", blanco(m.obra))}.
        </Clausula>

        <Text style={[s.p, s.b]}>SEGUNDA. – OBLIGACIONES GENERALES DEL CONTRATISTA:</Text>
        <Lista items={m.obligacionesGenerales} resaltado={r("obligacionesGenerales")} marcador={numero} />
        <P>
          <Text style={s.b}>PARÁGRAFO:</Text> EL contratista tiene la obligación como requisito para el pago de los honorarios acordados, presentar los
          soportes de la afiliación y pago mensual de la seguridad social en salud, pensión y ARL los cuales lo presentará con el informe de actividades
          mensual.
        </P>

        <Text style={[s.p, s.b]}>TERCERA- OBLIGACIONES ESPECÍFICAS DEL CONTRATISTA:</Text>
        {m.obligacionesEspecificas.length > 0 ? <Lista items={m.obligacionesEspecificas} resaltado={r("obligacionesEspecificas")} marcador={numero} /> : <P>{blanco(null)}</P>}

        <Text style={[s.p, s.b]}>CUARTA-OBLIGACIONES GENERALES DEL CONTRATANTE:</Text>
        <Lista items={m.obligacionesContratante} resaltado={r("obligacionesContratante")} marcador={numero} />

        <Clausula titulo="QUINTA-DURACIÓN O PLAZO:">
          La realización de las actividades del presente contrato se llevará a cabo dentro de un plazo de {res("plazo", blanco(m.plazo))} contado a partir del{" "}
          {res("fechaInicio", fechaLarga(m.fechaInicio))}.
        </Clausula>
        <P>
          Una vez finalizado el objeto del contrato y aceptada por el contratante, el contratista deberá hacer entrega formal de las actividades encargadas,
          junto con cualquier otra documentación que se haya generado con motivo de este contrato, de tal forma que sólo existirá una copia de la totalidad
          del material relativo al objeto del contrato en poder exclusivo del contratante.
        </P>

        <Clausula titulo="SEXTA-VALOR:">
          El contratante cancelará como contraprestación por concepto de honorarios la suma de valor{" "}
          <Text style={s.b}>
            {res("valorLetras", blanco(m.valorLetras))} (${res("valor", valor !== null ? pesosSinSimbolo(valor) : blanco(m.valor))}) M/CTE,
          </Text>{" "}
          incluido todos los costos, descuentos y deducciones que apliquen. Los pagos se realizarán de manera {res("formaPago", blanco(m.formaPago))}
        </Clausula>
        <P>
          <Text style={s.b}>PARÁGRAFO 2:</Text> Los pagos se realizarán previa verificación de las obligaciones del contratista, para lo cual, el
          contratista presentará por escrito un informe de actividades de acuerdo con las obligaciones y/o directrices impartidas por el contratante.
        </P>

        <Clausula titulo="SÉPTIMA-SUPERVISIÓN:">
          El contratante ejercerá la vigilancia del cumplimiento de las obligaciones del contratista a través del director de Obra o quien haga sus veces,
          quien deberá cumplir con las siguientes funciones: <Text style={s.b}>a)</Text> Vigilar el cabal cumplimiento de las actividades a efecto de lograr
          el correcto desarrollo del objeto del contrato. <Text style={s.b}>b)</Text> Aprobar los informes de actividades que el contratista presente al
          contratante. <Text style={s.b}>c)</Text> Impartir las órdenes y sugerencias por escrito. <Text style={s.b}>d)</Text> Formular las observaciones
          que estime convenientes sobre el desarrollo del contrato, siempre enmarcadas dentro de los términos del mismo. <Text style={s.b}>e)</Text>{" "}
          Inspeccionar las actividades del CONTRATISTA, dar aprobación a las mismas y hacer los reparos a ellas.
        </Clausula>

        <Clausula titulo="OCTAVA- CLÁUSULA PENAL PECUNIARIA:">
          En caso de incumplimiento parcial o total de las obligaciones a cargo del contratista, el contratante previo aviso escrito podrá hacer efectiva la
          cláusula penal pecuniaria en un monto equivalente ({res("clausulaPenalPorcentaje", pct ? `${pct}%` : blanco(null))}) por ciento del valor del contrato que se haya ejecutado, como
          estimación anticipada y parcial de los perjuicios que se causen, sin perjuicio de que se pueda solicitar al contratista la totalidad del valor de
          los perjuicios causados en lo que excedan del valor de la cláusula penal pecuniaria.
        </Clausula>
        <P>
          <Text style={s.b}>PARÁGRAFO:</Text> El contratista autoriza que el contratante descuente de las sumas que le adeude, los valores correspondientes
          a la cláusula penal pecuniaria.
        </P>

        <Clausula titulo="NOVENA- LUGAR DE EJECUCIÓN:">
          El lugar de ejecución de la actividad contratada será el Municipio de {res("municipioEjecucion", blanco(m.municipioEjecucion))} del Departamento de{" "}
          {res("departamentoEjecucion", blanco(m.departamentoEjecucion))}.
        </Clausula>

        <Clausula titulo="DÉCIMA- SUSPENSIÓN, TERMINACIÓN ANTICIPADA O PRÓRROGA:">
          De común acuerdo entre las partes podrán suspender, prorrogar o dar por terminado el contrato antes del vencimiento de su vigencia, mediante acta,
          sin que para efectos del plazo extintivo se compute el tiempo de suspensión.
        </Clausula>

        <Clausula titulo="DÉCIMA PRIMERA- CAUSALES DE TERMINACIÓN:">
          El presente contrato se podrá terminar en los siguientes eventos: 1. Por vencimiento del plazo de ejecución. 2. Por mutuo acuerdo entre las
          partes. 3. Por el cumplimiento del objeto contractual. 4. En forma unilateral por parte del contratante por el incumplimiento del contratista.
        </Clausula>

        <Clausula titulo="DÉCIMA SEGUNDA- CESIÓN:">
          <Text style={s.b}>EL CONTRATISTA</Text> no podrá ceder parcial ni totalmente la ejecución del presente contrato a un tercero, sin la previa,
          expresa y escrita autorización del contratante.
        </Clausula>

        <Clausula titulo="DÉCIMA TERCERA- SOLUCIÓN DE CONTROVERSIAS:">
          Las partes acuerdan que en el evento de que surjan controversias entre ellas, por razón o con ocasión del presente contrato, las mismas buscarán
          mecanismos de arreglo directo. Y en caso de fracasar el intento directo, se intentará en cualquier centro de conciliación y arbitraje de la ciudad
          de domicilio contractual.
        </Clausula>

        <Clausula titulo="DÉCIMA CUARTA- MODIFICACIONES:">
          El presente contrato podrá modificarse previo acuerdo de las partes el cual deberá constar por escrito. <Text style={s.b}>RÉGIMEN LEGAL:</Text> El
          presente contrato se regirá por las disposiciones establecidas en el derecho privado. La celebración, interpretación, terminación y ejecución del
          presente Contrato estarán sujetas a la normativa colombiana vigente.
        </Clausula>

        <Clausula titulo="DÉCIMA QUINTA- INDEPENDENCIA:">
          El contratista actuará por su cuenta, con autonomía y sin que exista relación laboral, ni subordinación con el contratante, sus derechos se
          limitarán por la naturaleza del contrato, a exigir el cumplimiento de las obligaciones del contratante y el pago oportuno de sus honorarios en este
          documento.
        </Clausula>

        <Clausula titulo="DÉCIMA SEXTA-CONFIDENCIALIDAD:">
          El Contratista se compromete a mantener la confidencialidad de toda la información a la que tenga acceso durante la ejecución del contrato. Esto
          incluye, pero no se limita a, datos técnicos, comerciales, financieros y de cualquier otra naturaleza que le sean proporcionados por el Contratante
          o que el Contratista obtenga como resultado de su participación en el proyecto.
        </Clausula>
        <P>
          <Text style={s.b}>PARÁGRAFO:</Text> Esta confidencialidad se mantendrá en vigor incluso después de terminado el contrato y el contratista deberá
          tomar todas las medidas necesarias para que esta información no sea divulgada.
        </P>

        <Clausula titulo="DÉCIMA SÉPTIMA- LIQUIDACIÓN:">
          El contratista manifiesta desde ya de forma expresa y voluntaria que si a la finalización del contrato de prestación de servicios, no se encuentra a
          Paz y Salvo con el contratante, de acuerdo a las obligaciones consagradas dentro del presente contrato, autoriza expresa e irrevocablemente para
          deducir de todo concepto resultante de la liquidación final del contrato, el valor de los activos puestos a su disposición para la ejecución de los
          servicios prestados, igualmente autoriza la retención del pago final hasta no encontrarse totalmente a paz y salvo con la entrega de informe y
          cumplimiento de actividades.
        </Clausula>
        <P>
          <Text style={s.b}>PARÁGRAFO:</Text> Acorde con lo previsto en el parágrafo anterior, el incumplimiento de dichas obligaciones facultará al
          contratante para efectuar el pago de las mismas una vez la empresa verifique el cumplimiento de estas por parte del contratista.
        </P>

        <Clausula titulo="DÉCIMA OCTAVA - DOMICILIO CONTRACTUAL:">
          Para todos los efectos legales el presente contrato tendrá como domicilio la ciudad de {res("domicilioCiudad", blanco(m.domicilioCiudad))}.
        </Clausula>

        <Clausula titulo="DÉCIMA NOVENA: NOTIFICACIONES">
          para todos los efectos de notificaciones, las partes autorizan las siguientes direcciones: El Contratista en el correo electrónico{" "}
          {res("contratistaCorreo", blanco(m.contratistaCorreo))} y el contratante al correo {res("contratanteCorreo", blanco(m.contratanteCorreo))}.
        </Clausula>

        {m.clausulasAdicionales.map((c, i) => (
          <Clausula key={i} titulo={`${ordinalClausula(PRIMERA_CLAUSULA_ADICIONAL_SERVICIOS + i)}- ${blanco(c.titulo).toUpperCase()}:`}>
            {res(`clausulasAdicionales:${i}`, c.texto)}
          </Clausula>
        ))}

        <P>
          Para constancia se firma en {res("ciudadFirma", blanco(m.ciudadFirma))} {res("fechaFirma", lugarFecha)}.
        </P>

        <View style={s.firmas} wrap={false}>
          <View style={s.firma}>
            <Text style={[s.b, { marginBottom: 36 }]}>EL CONTRATANTE</Text>
            <View style={s.firmaLinea} />
            <Text style={s.b}>{res("contratanteNombre", blanco(m.contratanteNombre))}</Text>
            <Text style={s.b}>NIT {res("contratanteNit", blanco(m.contratanteNit))}</Text>
            <Text style={s.b}>R/: {res("contratanteRepresentante", blanco(m.contratanteRepresentante))}</Text>
          </View>
          <View style={s.firma}>
            <Text style={[s.b, { marginBottom: 36 }]}>EL CONTRATISTA</Text>
            <View style={s.firmaLinea} />
            <Text style={s.b}>{res("contratistaNombre", blanco(m.contratistaNombre))}</Text>
            {juridica && <Text style={s.b}>NIT {res("contratistaNit", blanco(m.contratistaNit))}</Text>}
            {juridica && <Text style={s.b}>R/: {res("contratistaRepresentante", blanco(m.contratistaRepresentante))}</Text>}
            <Text style={s.b}>
              {documento.firma === "CC." ? "C.C." : documento.firma} {res("contratistaCedula", blanco(m.contratistaCedula))}
            </Text>
          </View>
        </View>
      </Page>
    </Document>
  )
}
