import { Document, Page, View, Text } from "@react-pdf/renderer"
import { leerNumero } from "@/lib/contratos"
import { blanco, cantidadEnLetras, fechaLarga, ordinalClausula, partesFecha, pesosSinSimbolo, totalItemsMinuta } from "@/lib/minuta-mano-obra"
import { tipoDocumentoArrendador } from "@/lib/minuta-arrendamiento"
import { PRIMERA_CLAUSULA_ADICIONAL_OBRA, type MinutaObra } from "@/lib/minuta-obra"
import { Clausula, Encabezado, Lista, P, s, campoResaltable, renglonConFoco } from "@/components/minuta-mano-obra-pdf"
import { LineaFirma } from "@/components/linea-firma-pdf"
import type { FirmaDocumento } from "@/lib/firmas"

// ---------------------------------------------------------------------------
// PDF de la minuta del contrato de obra a todo costo y del contrato de mano de
// obra (las dos plantillas de Jurídica versión 04, 9/05/2025): el texto de la
// plantilla con los campos de la minuta, y el anexo N° 1. `m.variante` dice
// cuál; donde las dos plantillas dicen lo mismo, el texto es uno solo. Se
// genera en el servidor (app/(app)/contratos/pre-aprobacion/[id]/minuta/route.tsx).
// ---------------------------------------------------------------------------

// Así viene el encabezado de cada plantilla (las dos con el código GJ-F-003).
const ENCABEZADO = {
  obra: { formato: "CONTRATO DE OBRA TC", codigo: "GJ-F-003", version: "04", fecha: "9/05/2025" },
  mano_obra: { formato: "CONTRATO DE MANO DE OBRA", codigo: "GJ-F-003", version: "04", fecha: "9/05/2025" },
}

const numero = (i: number) => `${i + 1}.`

export function MinutaObraPDF({ minuta: m, numero: numeroContrato, logo, foco, firmaContratante }: { minuta: MinutaObra; numero: number; logo: string | Buffer; foco?: string; firmaContratante?: FirmaDocumento | null }) {
  const res = campoResaltable(foco)
  const r = (lista: string) => renglonConFoco(foco, lista)
  const fecha = partesFecha(m.fechaFirma)
  const juridica = m.contratistaTipoPersona === "juridica"
  const mo = m.variante === "mano_obra"
  const encabezado = ENCABEZADO[mo ? "mano_obra" : "obra"]
  const nombreContrato = mo ? "Contrato de mano de obra" : "Contrato de obra"
  const documento = tipoDocumentoArrendador(m.contratistaTipoDocumento)
  const valor = leerNumero(m.valor)
  const anticipo = leerNumero(m.anticipo)
  const conAnticipo = Boolean(m.anticipoPorcentaje.trim() || m.anticipo.trim())
  const consecutivo = `No. CJ-${numeroContrato}-${fecha ? fecha.anio : "20__"}`
  const lugarFecha = fecha
    ? `a los ${cantidadEnLetras(fecha.dia)} ${fecha.dia === 1 ? "día" : "días"} del mes de ${fecha.mes} del año ${fecha.anio}`
    : "a los ____ días del mes de ________ del año ____"
  const totalItems = totalItemsMinuta(m.items)
  const anchos = { actividad: "46%", unidad: "10%", cantidad: "12%", vu: "16%", total: "16%" }
  const anchosAmparo = { amparo: "40%", porcentaje: "20%", vigencia: "40%" }
  const pie = ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
    `${nombreContrato} ${consecutivo} · Página ${pageNumber} de ${totalPages}`

  return (
    <Document title={`${nombreContrato} ${consecutivo}`} author={m.contratanteNombre}>
      <Page size="LETTER" style={s.page}>
        <Encabezado logo={logo} {...encabezado} />
        <Text style={s.footer} fixed render={pie} />

        <Text style={[s.titulo, { marginBottom: 2 }]}>{mo ? "CONTRATO DE MANO DE OBRA" : "CONTRATO DE MANO DE OBRA TC"}</Text>
        <Text style={s.titulo}>{consecutivo}</Text>

        <P>
          Entre los suscritos a saber: <Text style={s.b}>{res("contratanteNombre", blanco(m.contratanteNombre))},</Text> con Nit. {res("contratanteNit", blanco(m.contratanteNit))}, representado por{" "}
          {res("contratanteRepresentante", blanco(m.contratanteRepresentante))}, con cédula N° {res("contratanteRepresentanteCedula", blanco(m.contratanteRepresentanteCedula))}, quien para efectos del presente contrato se
          denominará <Text style={s.b}>EL CONTRATANTE,</Text> de una parte y por la otra,{" "}
          {juridica ? (
            <>
              <Text style={s.b}>{res("contratistaNombre", blanco(m.contratistaNombre))},</Text> con Nit. {res("contratistaNit", blanco(m.contratistaNit))},{" "}
              {mo ? "representado por" : "representada legalmente por"} {res("contratistaRepresentante", blanco(m.contratistaRepresentante))},
              {mo ? "" : " mayor de edad,"} identificado con {documento.articulo} {documento.texto} No. {res("contratistaCedula", blanco(m.contratistaCedula))}
            </>
          ) : (
            <>
              <Text style={s.b}>{res("contratistaNombre", blanco(m.contratistaNombre))},</Text> mayor de edad, identificado con {documento.articulo} {documento.texto} No.{" "}
              {res("contratistaCedula", blanco(m.contratistaCedula))}, actuando en nombre propio
            </>
          )}
          , quien para los efectos del presente documento se denominará <Text style={s.b}>EL CONTRATISTA,</Text> acuerdan celebrar el presente negocio
          jurídico, previo a las siguientes consideraciones:
        </P>

        {mo ? (
          <Clausula titulo="PRIMERA. OBJETO:">
            En virtud del presente contrato <Text style={s.b}>EL CONTRATANTE</Text> encarga a <Text style={s.b}>EL CONTRATISTA,</Text> quien se obliga a
            ejecutar, por su cuenta y riesgo, las actividades de mano de obra necesarias para el desarrollo de las obras civiles correspondientes al proyecto
            cuyo objeto es: “{res("obra", blanco(m.obra))}”.
          </Clausula>
        ) : (
          <>
            <Clausula titulo="PRIMERA. OBJETO:">
              En virtud del presente contrato <Text style={s.b}>EL CONTRATANTE</Text> encarga a <Text style={s.b}>EL CONTRATISTA,</Text> quien se obliga a
              ejecutar a todo costo, por su cuenta y riesgo, las actividades necesarias para el desarrollo de las obras civiles correspondientes al proyecto
              denominado: {res("obra", blanco(m.obra))}, de conformidad con las cantidades, actividades, especificaciones técnicas, diseños, planos, presupuestos y demás
              condiciones contenidas en el anexo Nº 1.
            </Clausula>
            <P>
              El alcance del presente contrato comprende, salvo las actividades o elementos que expresamente se hayan establecido como responsabilidad del EL
              CONTRATANTE, el suministro de la totalidad de la mano de obra, materiales, insumos, herramientas, equipos, maquinaria, transporte, cargue,
              descargue, almacenamiento, instalación, disposición de residuos y demás recursos necesarios para la correcta ejecución y entrega de las
              actividades contratadas.
            </P>
          </>
        )}

        <Clausula titulo="SEGUNDA. PLAZO DE EJECUCIÓN:">
          El plazo ejecución del presente contrato será de {res("plazo", blanco(m.plazo))} calendario, contados a partir de la suscripción del acta de inicio.
        </Clausula>

        <Clausula titulo="TERCERA. VALOR DEL CONTRATO:">
          El valor del presente contrato es de{" "}
          <Text style={s.b}>
            {res("valorLetras", blanco(m.valorLetras))} (${res("valor", valor !== null ? pesosSinSimbolo(valor) : blanco(m.valor))}) M/CTE.,
          </Text>{" "}
          incluidos los costos, impuestos, deducciones y descuentos a los que haya lugar por parte del contratante, conocidos y aceptados por el
          contratista.
        </Clausula>

        <Clausula titulo="CUARTA. ANTICIPO:">
          {conAnticipo && mo ? (
            <>
              Para el presente contrato, será por valor de{" "}
              <Text style={s.b}>
                {res("anticipoLetras", blanco(m.anticipoLetras))} (${res("anticipo", anticipo !== null ? pesosSinSimbolo(anticipo) : blanco(m.anticipo))}) M/CTE.
              </Text>{" "}
              El anticipo se tramitará una vez suscrito el contrato y aprobadas las pólizas que las ampara. <Text style={s.b}>PARÁGRAFO PRIMERO:</Text>{" "}
              El Anticipo será amortizado en el {res("amortizacion", blanco(m.amortizacion))} en cada cobro de acta parcial.
            </>
          ) : conAnticipo ? (
            <>
              El contratante entregará al contratista un anticipo equivalente al {res("anticipoPorcentaje", `${blanco(m.anticipoPorcentaje.replace(/%/g, ""))}%`)} del valor del
              contrato, es decir, la suma de{" "}
              <Text style={s.b}>
                {res("anticipoLetras", blanco(m.anticipoLetras))} (${res("anticipo", anticipo !== null ? pesosSinSimbolo(anticipo) : blanco(m.anticipo))}) M/CTE.
              </Text>{" "}
              El anticipo se tramitará una vez suscrito el contrato y aprobadas las pólizas que las ampara. <Text style={s.b}>PARÁGRAFO PRIMERO:</Text>{" "}
              El Anticipo será amortizado en el {res("amortizacion", blanco(m.amortizacion))} en cada cobro de acta parcial.
            </>
          ) : mo ? (
            "El contratante no entregará ningún tipo de anticipo para la ejecución del contrato."
          ) : (
            "El contratante no entregará anticipo al contratista."
          )}
        </Clausula>

        <Clausula titulo="QUINTA. FORMA DE PAGO:">
          Se pagará cada {res("periodicidadPago", blanco(m.periodicidadPago))}, según programación de pago,{" "}
          {mo
            ? "y conforme al avance efectivo de las actividades de mano de obra ejecutadas previa aprobación del corte correspondiente por parte del director de obra o supervisor designado."
            : "conforme el avance de la obra y previa aprobación del director de obra."}{" "}
          Mediante transferencia electrónica, previa factura electrónica, aprobación del corte, certificación de cumplimiento y soportes de seguridad
          social. <Text style={s.b}>PARÁGRAFO PRIMERO:</Text> Las actas antes señaladas deberán ser acompañadas de los siguientes documentos:{" "}
          <Text style={s.b}>1.</Text> Informe de ejecución del contratista con sus respectivos soportes fotográficos de avance de actividades y visto
          bueno del supervisor. <Text style={s.b}>2.</Text> Factura electrónica o documento asimilable. <Text style={s.b}>3.</Text> Planillas de
          seguridad social pagadas del personal a cargo del contratista que haya intervenido en la ejecución del contrato, de acuerdo con la lista de
          asistencia durante el periodo de cobro. <Text style={s.b}>4.</Text> Los aportes parafiscales, cuando corresponda. <Text style={s.b}>5.</Text>{" "}
          Relación de paz y salvos del personal retirado durante el periodo de corte. <Text style={s.b}>PARAGRÁFO SEGUNDO:</Text> El contratante se
          reserva el derecho de retener cualquier pago a favor del contratista, si este último incumple cualquiera de las obligaciones contraídas por
          medio del presente contrato, retención que es autorizada por el contratista con la suscripción del presente contrato, hasta que se dé
          cumplimiento a la obligación que originó la retención. <Text style={s.b}>PARAGRÁFO TERCERO:</Text>{" "}
          {m.retencion === "no" ? (
            res("retencion", "No se hará retención en garantía sobre los pagos del contrato.")
          ) : mo ? (
            <>
              Como mecanismo de garantía contractual, se efectuará una retención del ({res("retencionGarantia", blanco(m.retencionGarantia))}) sobre los valores
              objeto de pago, la cual será devuelta a el contratista con ocasión de la liquidación del contrato, previa verificación del cumplimiento de las
              obligaciones a su cargo.
            </>
          ) : (
            <>
              Se le hará retención en garantía del ({res("retencionGarantia", blanco(m.retencionGarantia))}) de cada factura o cuenta de cobro de acta parcial,
              retención que será pagada con la expedición del acta de liquidación del contrato.
            </>
          )}{" "}
          <Text style={s.b}>PARAGRÁFO CUARTO:</Text> Los pagos se realizarán mediante transferencia electrónica a la
          cuenta bancaria acredita por el contratista mediante certificación bancaria en la que éste figure como titular.
        </Clausula>
        {m.condicionesPago.trim() && <P>{res("condicionesPago", m.condicionesPago.trim())}</P>}

        <Text style={[s.p, s.b]}>SEXTA. OBLIGACIONES DEL CONTRATANTE:</Text>
        <Lista items={m.obligacionesContratante} resaltado={r("obligacionesContratante")} marcador={numero} />

        <Text style={[s.p, s.b]}>SÉPTIMA. OBLIGACIONES GENERALES DEL CONTRATISTA:</Text>
        <Lista items={m.obligacionesGenerales} resaltado={r("obligacionesGenerales")} marcador={numero} />

        <Text style={[s.p, s.b]}>OCTAVA. OBLIGACIONES ESPECÍFICAS DEL CONTRATISTA:</Text>
        <Lista items={m.obligacionesEspecificas} resaltado={r("obligacionesEspecificas")} marcador={numero} />

        <Clausula titulo="NOVENA. INDEPENDENCIA DEL CONTRATISTA:">
          El contratista actuará por su propia cuenta, con absoluta autonomía y no estará sometido a subordinación laboral con el contratante,
          comprometiéndose a realizar con sus propios medios y bajo su responsabilidad esta obra, por tanto, este contrato no es de carácter laboral y no
          genera prestaciones laborales a su favor.
        </Clausula>

        <Clausula titulo="DÉCIMA. CESIÓN O SUBCONTRATACIÓN DEL OBJETO DEL CONTRATO:">
          El contratista no podrá ceder a persona alguna natural o jurídica, Nacional o extranjera, el presente contrato ni subcontratar el objeto
          contratado. Para la cesión del presente contrato se requiere de previa autorización por escrito del contratante.
        </Clausula>

        <Clausula titulo="DÉCIMA PRIMERA. CONTRATACIÓN DE PERSONAL:">
          {mo
            ? "El contratista contratará, por su cuenta y riesgo, el personal que considere necesario para la ejecución del objeto contractual. El contratista será el único responsable de las obligaciones laborales, salariales, prestacionales, de seguridad social, parafiscales y demás obligaciones derivadas de las relaciones laborales que establezca con su personal."
            : "El contratista debe contratar el personal que considere necesario para adelantar la ejecución del objeto del presente contrato, para tal fin deberá por su cuenta y riesgo asumir la responsabilidad del personal a su cargo."}
        </Clausula>

        <Clausula titulo="DÉCIMA SEGUNDA. CLÁUSULA PENAL:">
          En caso de incumplimiento de las obligaciones a cargo de alguna de las partes, habrá lugar al pago de una sanción pecuniaria equivalente al diez
          por ciento (10%) del valor del contrato, suma que se tendrá como pago parcial pero no definitivo de los perjuicios que sufra la parte afectada.
          En caso de incumplimiento del contratista se pondrá en conocimiento el incumplimiento de la obligación, la cual generará imposición de multa por
          cada día de incumplimiento, si cumplidos 5 días consecutivos de incumplimiento, o reiteración de incumplimiento hasta 3 veces, se dará aplicación
          de la cláusula penal, sin necesidad que esta sea fallada en la jurisdicción. <Text style={s.b}>PARÁGRAFO PRIMERO.</Text> El valor de la
          cláusula penal impuesta por incumplimiento del contratista, será descontado de cualquier saldo que resultare a favor de éste en razón de este
          contrato si lo hubiere. En caso contrario se hará efectiva la garantía y si esto no fuere posible, se iniciarán las acciones judiciales
          pertinentes.
        </Clausula>

        <Clausula titulo="DÉCIMA TERCERA. MULTA:">
          En caso de incumplimiento parcial o total de las obligaciones establecidas en el presente contrato por parte del Contratista, este deberá pagar al
          Contratante una multa de apremio equivalente al cero punto uno por ciento (0.1%) del valor total del contrato por cada día de incumplimiento o
          mora. Lo anterior es sin perjuicio de la facultad del Contratante para hacer exigible la cláusula penal en caso de reiteración de 3 veces del
          incumplimiento de las obligaciones, o en caso de incumplimiento total del contrato por parte del contratista.{" "}
          <Text style={s.b}>PARÁGRAFO SEGUNDO.</Text> El Contratista autoriza que las sumas correspondientes a multa sean descontadas de cualquier valor
          que se haya causado a su favor y esté pendiente de pago por el Contratante y/o de la suma derivada de la Retención en Garantía.
        </Clausula>

        <Clausula titulo="DÉCIMA CUARTA. RESPONSABILIDAD:">
          El Contratista es responsable por el cumplimiento de las obligaciones pactadas en el Contrato. Además, responderá por los daños generados al
          contratante y a terceros en la ejecución del Contrato, causados por sus Subcontratistas, dependientes o empleados.
          {mo ? " El contratista será responsable por la calidad y correcta ejecución de las actividades de mano de obra a su cargo." : ""}
        </Clausula>

        <Clausula titulo="DÉCIMA QUINTA. INDEMNIDAD:">
          El contratista mantendrá indemne al contratante contra todo reclamo, demanda, acción legal y costos que puedan causarse o surgir por daños o
          lesiones a personas o propiedades de terceros, que se ocasionen durante la ejecución del objeto de este contrato.
        </Clausula>

        <Clausula titulo="DÉCIMA SEXTA. - MODIFICACIONES:">
          El presente contrato podrá modificarse previo acuerdo de las partes el cual deberá constar por escrito.
        </Clausula>

        <Clausula titulo="DÉCIMA SÉPTIMA. CAUSALES DE TERMINACIÓN:">
          Sin perjuicio de lo contemplado en la ley, este contrato se terminará: 1. Por vencimiento del término fijado en el presente contrato para la
          ejecución del mismo. 2. Por la ejecución del objeto contratado. 3. Por incumplimiento de las obligaciones del contratista o el contratante. 4. Por
          mutuo acuerdo de las partes.
        </Clausula>

        {mo && m.exigeGarantia === "no" ? (
          <Clausula titulo="DÉCIMA OCTAVA. GARANTÍAS:">
            {res("exigeGarantia", "Para la ejecución del presente contrato no se exigirá la constitución de garantías.")}
          </Clausula>
        ) : (
        <>
        <Clausula titulo="DÉCIMA OCTAVA. GARANTÍAS:">
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
              <Text style={[s.td, { width: anchosAmparo.amparo }]}>{res(`amparos:${i}`, blanco(a.amparo))}</Text>
              <Text style={[s.td, s.celdaBorde, { width: anchosAmparo.porcentaje, textAlign: "center" }]}>{`${blanco(a.porcentaje.replace(/%/g, ""))}%`}</Text>
              <Text style={[s.td, s.celdaBorde, { width: anchosAmparo.vigencia }]}>{blanco(a.vigencia)}</Text>
            </View>
          ))}
        </View>
        <P>
          La garantía deberá estar firmada por el Representante Legal de LA CONTRATISTA, las primas serán de su cargo y deberán estar acompañadas de los
          recibos de cancelación expedidos por la entidad aseguradora, las mismas deberán ser entregadas para su aprobación al contratante a más tardar tres
          (3) días después de la suscripción del presente contrato{mo ? "." : ""} <Text style={s.b}>PARÁGRAFO PRIMERO:</Text> En caso de ser necesario, el contratista
          podrá presentar una garantía diferente a la enunciada, siempre que esta sea aceptada por el contratante.
        </P>
        </>
        )}

        <Clausula titulo="DÉCIMA NOVENA. DOMICILIO:">
          Para todos los efectos leales, las partes acuerdan como domicilio el departamento de {res("domicilioDepartamento", blanco(m.domicilioDepartamento))}.
        </Clausula>

        <Clausula titulo="VIGÉSIMA. DOCUMENTOS DEL CONTRATO:">
          Forman parte integral del presente contrato el formato de solicitud de contrato elaborado por el director de obra y aprobado por la subgerencia
          administrativa{mo ? "," : ""} el cronograma de cumplimiento de ejecución de actividades y todos los documentos que se produzcan durante el desarrollo del mismo.
        </Clausula>

        <Clausula titulo="VIGÉSIMA PRIMERA. SOLUCIÓN DE CONTROVERSIAS:">
          Cualquier disputa o diferencia que surja con ocasión del objeto y obligaciones de este contrato serán arregladas en lo posible mediante la
          negociación y la conciliación entre las partes.
        </Clausula>

        <Clausula titulo="VIGÉSIMA SEGUNDA. LIQUIDACIÓN DEL CONTRATO:">
          El término para la liquidación bilateral del contrato será de dos (2) mes siguiente a la expiración del término previsto para la ejecución del
          contrato.
        </Clausula>

        <Clausula titulo="VIGÉSIMA TERCERA. SUPERVISIÓN:">
          {mo
            ? "La supervisión del presente contrato y del cumplimiento de las obligaciones derivadas del mismo, estará a cargo del director de Obra o quien haga sus veces, quien tendrá a cargo la verificación del cumplimiento de las obligaciones, cantidades, calidades, avance y demás condiciones establecidas en el contrato y sus anexos."
            : "La supervisión del presente contrato y del cumplimiento de las obligaciones derivadas del mismo, estarán a cargo del director de Obra o quien haga sus veces."}
        </Clausula>

        <Clausula titulo="VIGÉSIMA CUARTA. ENTREGABLES:">
          El Contratista se obliga a entregar un registro fotográfico completo de cada una de las actividades realizadas, el cual deberá incluir imágenes
          tomadas durante el desarrollo de las mismas y al finalizar la ejecución de ellas. Así mismo,{" "}
          {mo ? "deberá entregar los formatos SST debidamente diligenciados, deberá presentar los" : "deberá presentar"} paz y salvos laborales
          correspondientes a todos los trabajadores vinculados a la obra, incluyendo constancias de pago de salarios, prestaciones sociales, y liquidaciones
          laborales.
        </Clausula>

        <Clausula titulo="VIGÉSIMA QUINTA. - LUGAR DE EJECUCIÓN:">
          Las actividades objeto del contrato se desarrollarán en el {mo ? "Departamento" : "municipio"} de {res("municipioEjecucion", blanco(m.municipioEjecucion))}.
        </Clausula>

        <Clausula titulo="VIGÉSIMA SEXTA. – REQUISITOS DE PERFECCIONAMIENTO Y EJECUCIÓN:">
          {mo
            ? "El presente contrato se perfecciona con la suscripción de las partes."
            : "El presente contrato se perfecciona con la suscripción de las partes, y para su ejecución requiere aprobación de pólizas y suscripción de acta de inicio."}
        </Clausula>

        <Clausula titulo="VIGÉSIMA SÉPTIMA. – NOTIFICACIONES:">
          El contratante en el correo electrónico {res("contratanteCorreo", blanco(m.contratanteCorreo))} y el contratista al correo electrónico {res("contratistaCorreo", blanco(m.contratistaCorreo))}.
        </Clausula>

        {m.clausulasAdicionales.map((c, i) => (
          <Clausula key={i} titulo={`${ordinalClausula(PRIMERA_CLAUSULA_ADICIONAL_OBRA + i)}. – ${blanco(c.titulo).toUpperCase()}:`}>
            {res(`clausulasAdicionales:${i}`, c.texto)}
          </Clausula>
        ))}

        <P>
          En constancia de lo anterior, se firma en {mo ? "" : "el Departamento de "}
          {res("departamentoFirma", blanco(m.departamentoFirma))}
          {mo ? " " : ", "}
          {res("fechaFirma", lugarFecha)}.
        </P>

        <View style={s.firmas} wrap={false}>
          {mo ? (
            <>
          <View style={s.firma}>
            <Text style={[s.b, { marginBottom: 36 }]}>EL CONTRATANTE</Text>
            <LineaFirma firma={firmaContratante} />
            <Text style={s.b}>{res("contratanteNombre", blanco(m.contratanteNombre))}</Text>
            <Text>NIT. {res("contratanteNit", blanco(m.contratanteNit))}</Text>
            <Text>RL. {res("contratanteRepresentante", blanco(m.contratanteRepresentante))}</Text>
            <Text>CC. {res("contratanteRepresentanteCedula", blanco(m.contratanteRepresentanteCedula))}</Text>
          </View>
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
            </>
          ) : (
            <>
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
            <LineaFirma firma={firmaContratante} />
            <Text style={s.b}>{res("contratanteNombre", blanco(m.contratanteNombre))}</Text>
            <Text>NIT. {res("contratanteNit", blanco(m.contratanteNit))}</Text>
            <Text>RL. {res("contratanteRepresentante", blanco(m.contratanteRepresentante))}</Text>
            <Text>CC. {res("contratanteRepresentanteCedula", blanco(m.contratanteRepresentanteCedula))}</Text>
          </View>
            </>
          )}
        </View>
      </Page>

      <Page size="LETTER" style={s.page}>
        <Encabezado logo={logo} {...encabezado} />
        <Text style={s.footer} fixed render={pie} />
        <Text style={s.titulo}>ANEXO N° 1 — ACTIVIDADES, CANTIDADES Y VALORES</Text>
        <P>
          {nombreContrato} {consecutivo} entre {res("contratanteNombre", blanco(m.contratanteNombre))} y {res("contratistaNombre", blanco(m.contratistaNombre))}, para el proyecto denominado {res("obra", blanco(m.obra))}.
        </P>
        <View style={s.tabla}>
          <View style={s.tr} fixed>
            <Text style={[s.th, { width: anchos.actividad }]}>Actividad</Text>
            <Text style={[s.th, { width: anchos.unidad }]}>Unidad</Text>
            <Text style={[s.th, { width: anchos.cantidad, textAlign: "right" }]}>Cantidad</Text>
            <Text style={[s.th, { width: anchos.vu, textAlign: "right" }]}>Valor unitario</Text>
            <Text style={[s.th, { width: anchos.total, textAlign: "right" }]}>Total</Text>
          </View>
          {m.items.map((it, i) => {
            const c = leerNumero(it.cantidad)
            const v = leerNumero(it.valorUnitario)
            return (
              <View key={i} style={s.tr} wrap={false}>
                <Text style={[s.td, { width: anchos.actividad }]}>{res(`items:${i}`, it.actividad)}</Text>
                <Text style={[s.td, s.celdaBorde, { width: anchos.unidad }]}>{it.unidad}</Text>
                <Text style={[s.td, s.celdaBorde, { width: anchos.cantidad, textAlign: "right" }]}>{it.cantidad}</Text>
                <Text style={[s.td, s.celdaBorde, { width: anchos.vu, textAlign: "right" }]}>{v !== null ? `$ ${pesosSinSimbolo(v)}` : it.valorUnitario}</Text>
                <Text style={[s.td, s.celdaBorde, { width: anchos.total, textAlign: "right" }]}>
                  {c !== null && v !== null ? `$ ${pesosSinSimbolo(Math.round(c * v * 100) / 100)}` : ""}
                </Text>
              </View>
            )
          })}
          <View style={s.tr} wrap={false}>
            <Text style={[s.td, s.b, { width: "84%", textAlign: "right" }]}>TOTAL</Text>
            <Text style={[s.td, s.celdaBorde, s.b, { width: anchos.total, textAlign: "right" }]}>$ {pesosSinSimbolo(totalItems)}</Text>
          </View>
        </View>
        <Text style={[s.p, { marginTop: 10, fontSize: 9, color: "#444" }]}>{`Fecha: ${res("fechaFirma", fechaLarga(m.fechaFirma))}.`}</Text>
      </Page>
    </Document>
  )
}
