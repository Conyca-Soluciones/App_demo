import { Document, Page, View, Text } from "@react-pdf/renderer"
import { leerNumero } from "@/lib/contratos"
import { blanco, cantidadEnLetras, fechaLarga, ordinalClausula, partesFecha, pesosSinSimbolo } from "@/lib/minuta-mano-obra"
import {
  OPCIONES_SERVICIOS,
  PRIMERA_CLAUSULA_ADICIONAL_ARRENDAMIENTO,
  tipoDocumentoArrendador,
  type MinutaArrendamiento,
} from "@/lib/minuta-arrendamiento"
import { Clausula, Encabezado, Lista, s } from "@/components/minuta-mano-obra-pdf"

// ---------------------------------------------------------------------------
// PDF de la minuta del contrato de arrendamiento: el texto de la plantilla
// GJ-F-014 de Jurídica con los campos de la minuta. Se genera en el servidor
// (app/(app)/contratos/pre-aprobacion/[id]/minuta/route.tsx).
// ---------------------------------------------------------------------------

const ENCABEZADO = { formato: "CONTRATO DE ARRENDAMIENTO", codigo: "GJ-F-014", version: "01", fecha: "17/03/2023" }

const letra = (i: number) => `${String.fromCharCode(97 + i)})`

export function MinutaArrendamientoPDF({ minuta: m, numero, logo }: { minuta: MinutaArrendamiento; numero: number; logo: string | Buffer }) {
  const fecha = partesFecha(m.fechaFirma)
  const juridica = m.arrendadorTipoPersona === "juridica"
  const documento = tipoDocumentoArrendador(m.arrendadorTipoDocumento)
  const canon = leerNumero(m.canon)
  const consecutivo = `Nº CJ-${numero} DE ${fecha ? fecha.anio : "20__"}`
  const iva = m.iva === "mas_iva" ? "más IVA" : m.iva === "incluido" ? "incluido el IVA" : blanco(null)
  const servicios = OPCIONES_SERVICIOS.find((o) => o.valor === m.serviciosPublicos)?.texto ?? blanco(null)
  const diaFirma = fecha ? (fecha.dia === 1 ? "el primer (1) día" : `el ${cantidadEnLetras(fecha.dia)} día`) : "el ____ día"
  const lugarFecha = fecha ? `${diaFirma} del mes de ${fecha.mes} de ${fecha.anio}` : `${diaFirma} del mes de ________ de ____`

  return (
    <Document title={`Contrato de arrendamiento ${consecutivo}`} author={m.arrendatarioNombre}>
      <Page size="LETTER" style={s.page}>
        <Encabezado logo={logo} {...ENCABEZADO} />
        <Text style={s.footer} fixed render={({ pageNumber, totalPages }) => `Contrato de arrendamiento ${consecutivo} · Página ${pageNumber} de ${totalPages}`} />

        <Text style={[s.titulo, { marginBottom: 2 }]}>CONTRATO DE ARRENDAMIENTO</Text>
        <Text style={s.titulo}>{consecutivo}</Text>

        <Text style={s.p}>
          Entre los suscritos a saber:{" "}
          {juridica ? (
            <>
              <Text style={s.b}>{blanco(m.arrendadorNombre)}</Text> identificada con número de identificación tributaria {blanco(m.arrendadorNit)},
              representada legalmente por <Text style={s.b}>{blanco(m.arrendadorRepresentante)}</Text> identificado con {documento.texto}{" "}
              {blanco(m.arrendadorCedula)} {documento.expedido} en {blanco(m.arrendadorCedulaExpedida)}
            </>
          ) : (
            <>
              <Text style={s.b}>{blanco(m.arrendadorNombre)}</Text>, mayor de edad, identificado con {documento.texto} {blanco(m.arrendadorCedula)}{" "}
              {documento.expedido} en {blanco(m.arrendadorCedulaExpedida)}, actuando en nombre propio
            </>
          )}
          , quien obra en calidad de propietario del inmueble, y que para efectos de este contrato se denominará el{" "}
          <Text style={s.b}>ARRENDADOR,</Text> por una parte, y por la otra, {blanco(m.arrendatarioNombre)} identificada con número de identificación
          tributaria {blanco(m.arrendatarioNit)}, representada legalmente por <Text style={s.b}>{blanco(m.arrendatarioRepresentante)}</Text> identificado
          con cédula de ciudadanía {blanco(m.arrendatarioCedula)}, quien para los efectos del presente contrato se denominará el{" "}
          <Text style={s.b}>ARRENDATARIO,</Text> manifestaron que han decidido celebrar un contrato de arrendamiento de bien inmueble para uso comercial, en
          adelante el “Contrato”, el cual se rige por las siguientes cláusulas:
        </Text>

        <Text style={s.p}>
          <Text style={s.b}>PRIMERA. - OBJETO: </Text>
          <Text style={s.b}>
            CONCEDER (POR PARTE DEL ARRENDADOR) EL USO Y GOCE TEMPORAL DE UN BIEN Y PAGAR UN PRECIO DETERMINADO Y PERIÓDICO POR DICHO USO (POR PARTE DEL
            ARRENDATARIO) DEL BIEN INMUEBLE UBICADO EN {blanco(m.inmuebleDireccion).toUpperCase()}, {blanco(m.inmuebleCiudad).toUpperCase()}.
          </Text>
        </Text>

        <Clausula titulo="SEGUNDA. - DESTINACIÓN:">
          <Text style={s.b}>El ARRENDATARIO</Text> destinará el inmueble arrendado exclusivamente para {blanco(m.destinacion)}.
        </Clausula>
        <Text style={s.p}>
          <Text style={s.b}>PARÁGRAFO. El ARRENDADOR</Text> prohíbe expresa y terminantemente al ARRENDATARIO dar al inmueble destinación con fines ilícitos
          tales como los contemplados en el literal b) del parágrafo del Artículo 3 del Decreto 180 de 1998 y el Artículo 34 de la Ley 30 de 1986 y ley 820
          de 2003 y en consecuencia el ARRENDATARIO se obliga a no utilizar el inmueble objeto de este contrato para ocultar o como depósito de armas,
          explosivos o Dineros de grupos terroristas o artículos de contrabando o para que en él se elaboren o almacenen, vendan o usen drogas
          estupefacientes o sustancias alucinógenas y afines.
        </Text>

        <Clausula titulo="TERCERA. - CANON DE ARRENDAMIENTO:">
          Se pacta en la suma de {blanco(m.canonLetras)} M/CTE (${canon !== null ? pesosSinSimbolo(canon) : blanco(m.canon)}) mensuales {iva}, valor al
          cual se le aplicarán los descuentos y retenciones de ley y deberá ser pagado de forma anticipada por el ARRENDATARIO dentro de los cinco (05)
          primeros días hábiles de cada mes contados a partir de la radicación de factura al correo electrónico {blanco(m.correoFacturacion)}. El pago se
          efectuará mediante transferencia electrónica a la cuenta bancaria acreditada por el arrendador, quedando establecido que los períodos mensuales
          son indivisibles.
        </Clausula>
        {m.condicionesPago.trim() && <Text style={s.p}>{m.condicionesPago.trim()}</Text>}
        <Text style={s.p}>
          <Text style={s.b}>PARÁGRAFO PRIMERO. </Text>
          La mera tolerancia del <Text style={s.b}>ARRENDADOR</Text> en aceptar el pago del precio de la renta con posterioridad al plazo pactado, no se
          entenderá como ánimo de novar o modificar el término para el pago de este contrato o la modificación del precio del arrendamiento, lo cual en
          ningún caso podrá considerarse como novación o existencia de un contrato verbal de arrendamiento.
        </Text>
        {m.paragrafoAdministracion.trim() && (
          <Text style={s.p}>
            <Text style={s.b}>PARÁGRAFO SEGUNDO. </Text>
            {m.paragrafoAdministracion.trim()}
          </Text>
        )}

        <Clausula titulo="CUARTA. - TÉRMINO DE DURACIÓN DEL ARRENDAMIENTO.">
          El término de arrendamiento es de {blanco(m.plazo)} contados a partir del {fechaLarga(m.fechaInicio)} y se prorrogara sucesivamente por un (1) año
          después de cumplido el término inicial o inferior si lo acuerdan las partes, salvo que cualquiera de las partes manifieste por escrito, con
          anticipación no menor a treinta (30) días para el cumplimiento del plazo inicial o de alguna de sus prorrogas su intención de no prorrogarlo a su
          vencimiento, sin que en tal evento deba mediar indemnización alguna.
        </Clausula>
        <Text style={s.p}>
          <Text style={s.b}>PARÁGRAFO: </Text>
          {servicios}
        </Text>

        <Text style={[s.p, s.b]}>QUINTA. - OBLIGACIONES DE LAS PARTES:</Text>
        <Text style={s.sub}>Serán obligaciones de EL ARRENDADOR:</Text>
        <Lista items={m.obligacionesArrendador} marcador={letra} />
        <Text style={s.sub}>Serán obligaciones de EL ARRENDATARIO:</Text>
        <Lista items={m.obligacionesArrendatario} marcador={letra} />

        <Clausula titulo="SEXTA. REAJUSTE DEL CANON DE ARRENDAMIENTO.">
          El canon será reajustado cada doce (12) meses de la vigencia contractual en forma automática en un porcentaje igual a la variación del IPC (Índice
          de Precios al Consumidor), certificado por el DANE a corte de diciembre del año inmediatamente anterior.
        </Clausula>

        <Clausula titulo="SEPTIMA. - ENTREGA DEL INMUEBLE.">
          La entrega del inmueble se llevará a cabo una vez finalizado el plazo del contrato, fecha en la cual se suscribirá la correspondiente acta de entrega
          y recibo a conformidad, así como el inventario los cuales se firmarán en pliego separado y que para todos los efectos legales forman parte de este
          contrato. El arrendatario se obliga desde ya a conservar el inmueble y restituirlo en las mismas condiciones salvo el deterioro causado por el uso y
          goce legítimos.
        </Clausula>

        <Clausula titulo="OCTAVA. - REPARACIONES Y MEJORAS.">
          <Text style={s.b}>El ARRENDATARIO</Text> queda autorizado a hacer las reparaciones locativas que considere pertinentes para el funcionamiento de su
          negocio. Las reparaciones necesarias son a cargo del <Text style={s.b}>ARRENDADOR.</Text> En consecuencia, el ARRENDADOR no queda obligado a
          pagar tales mejoras o reformas ni a indemnizar en forma alguna al <Text style={s.b}>ARRENDATARIO,</Text> aún en los casos en los que este las haya
          autorizado expresamente. <Text style={s.b}>El ARRENDATARIO,</Text> podrá separar o llevarse los materiales utilizados y cualquier cerradura o
          implemento adicional que este instale en las puertas o ventanas interiores o exteriores del inmueble siempre y cuando su retiro no genere
          detrimento al inmueble.
        </Clausula>
        <Text style={s.p}>
          <Text style={s.b}>PARÁGRAFO. EL ARRENDATARIO</Text> se obliga expresamente a notificar por escrito y en tiempo a{" "}
          <Text style={s.b}>EL ARRENDADOR</Text> acerca de las novedades que presente el inmueble y que requieran de las reparaciones necesarias a las que
          está obligado a realizar, no obstante, pasados quince (15) días calendario posteriores a la notificación sin que{" "}
          <Text style={s.b}>EL ARRENDADOR</Text> haya siquiera iniciado las reparaciones a su cargo con los debidos requisitos legales, podrá{" "}
          <Text style={s.b}>EL ARRENDATARIO</Text> iniciar tales reparaciones en los términos del artículo 1993 del código civil, razón por la cual, podrá
          descontar de las sumas adeudadas por concepto de canon de arrendamiento el costo de tales reparaciones, situación que las partes manifiestan conocer
          y aceptar con la suscripción del presente contrato.
        </Text>

        <Clausula titulo="NOVENA. - INSPECCIÓN.">
          <Text style={s.b}>El ARRENDATARIO</Text> permitirá, en cualquier tiempo, las visitas que el <Text style={s.b}>ARRENDADOR</Text> o sus
          representantes debidamente acreditados como tal, tengan a bien realizar para constatar el estado y conservación del inmueble u otras
          circunstancias que sean de su interés, con previo aviso de dos (2) días hábiles de antelación, siempre y cuando dicha visita no genere una
          afectación al desarrollo del objeto social o de las operaciones logísticas o administrativas del <Text style={s.b}>ARRENDATARIO</Text> ni genere
          una violación a la cláusula de confidencialidad del presente contrato.
        </Clausula>

        <Clausula titulo="DECIMA. - SERVICIOS PÚBLICOS.">
          <Text style={s.b}>El ARRENDADOR</Text> se compromete a entregar el inmueble objeto de arriendo con los servicios de agua y energía eléctrica
          debidamente legalizados y al día cuyos pagos deberá asumir el ARRENDATARIO a partir de la entrega y recibo del inmueble.
        </Clausula>
        <Text style={s.p}>
          El pago de los servicios públicos de energía eléctrica, acueducto, alcantarillado, etc., serán asumidos por <Text style={s.b}>EL ARRENDATARIO</Text>{" "}
          desde el momento en que reciba el inmueble, hasta el día en que lo entregue y restituya formalmente a <Text style={s.b}>EL ARRENDADOR.</Text>{" "}
          <Text style={s.b}>EL ARRENDADOR</Text> no será responsable por los perjuicios, retrasos y fallas de la operación logística de EL ARRENDATARIO por
          fallas o deficiente prestación de los servicios públicos.
        </Text>

        <Clausula titulo="DÉCIMA PRIMERA. - CESIÓN DEL CONTRATO.">
          <Text style={s.b}>El ARRENDATARIO</Text> no podrá ceder el presente contrato de arrendamiento, ni subarrendar el inmueble total o parcialmente, sin
          previa autorización escrita del <Text style={s.b}>ARRENDADOR.</Text> Si la cesión es consecuencia de enajenación del establecimiento de comercio
          que funciona en el inmueble arrendado, los cedentes se obligan a avisar, por escrito, tal circunstancia dentro de los diez (10) días siguientes
          contados a partir de la enajenación.
        </Clausula>

        <Clausula titulo="DÉCIMA SEGUNDA. - DEVOLUCIÓN SATISFACTORIA DEL INMUEBLE.">
          Vencido el periodo inicial o la última prórroga del contrato, EL ARRENDATARIO restituirá el inmueble al arrendador en las mismas condiciones en que
          lo recibió del ARRENDADOR salvo el deterioro causado por el uso y goce legítimos y por el paso del tiempo. Para lo cual EL ARRENDATARIO deberá a su
          cargo realizar el resane y pintura de las paredes y techos, el retiro de anuncios y demás implementos destinados a la publicidad.
        </Clausula>

        <Clausula titulo="DÉCIMA TERCERA. CAUSALES DE TERMINACIÓN DEL CONTRATO:">
          Las Partes podrán dar por terminado el presente Contrato por las siguientes causales:
        </Clausula>
        <Lista items={m.causalesTerminacion} marcador={letra} />

        <Clausula titulo="DÉCIMA CUARTA. - SOLUCIÓN DE CONFLICTOS.">
          Las partes acuerdan que para la solución de las diferencias y discrepancias que surjan de la celebración o ejecución de este contrato, o de la forma
          de pago de sanciones salvo los hechos que dan lugar a la terminación inmediata se acudirá a los procedimientos de transacción y conciliación, el
          centro de conciliación corresponderá al de la Cámara de comercio del lugar del inmueble tomado en arrendamiento.
        </Clausula>

        <Clausula titulo="DÉCIMA SEPTIMA. INDEMNIDAD.">
          <Text style={s.b}>El ARRENDADOR</Text> mantendrá indemne al ARRENDATARIO contra todo reclamo, demanda, acción legal y costo que pueda causarse o
          surgir durante la ejecución del objeto contractual y, que sea de su responsabilidad. Se consideran como hechos imputables al ARRENDADOR, todas las
          acciones u omisiones y en general cualquier incumplimiento de sus obligaciones contractuales. En caso de que se entable un reclamo, demanda o acción
          legal contra el <Text style={s.b}>ARRENDATARIO,</Text> por asuntos que según el contrato posiblemente sean de responsabilidad del{" "}
          <Text style={s.b}>ARRENDADOR,</Text> éste será notificado lo más pronto posible de ellos, para qué se vincule al respectivo proceso y, sea la
          justicia quien determine el responsable. Sí el <Text style={s.b}>ARRENDADOR</Text> resulta declarado culpable, pagará todos los gastos en los que
          el <Text style={s.b}>ARRENDATARIO</Text> incurra por tal motivo. En caso de que así no lo hiciere el <Text style={s.b}>ARRENDADOR,</Text> el{" "}
          <Text style={s.b}>ARRENDATARIO</Text> tendrá derecho a descontar el valor de las erogaciones que haya debido hacer por el trámite del proceso y la
          decisión judicial, de cualquier suma que se le adeude al <Text style={s.b}>ARRENDADOR</Text> por tal razón de las actividades objeto del contrato o
          a utilizar cualquier otro mecanismo judicial o extrajudicial.
        </Clausula>

        <Clausula titulo="DÉCIMA OCTAVA. PERFECCIONAMIENTO Y EJECUCIÓN.">
          El presente contrato se entiende perfeccionado con el acuerdo libre y voluntario de las partes y la firma del presente documento.
        </Clausula>

        <Clausula titulo="DÉCIMA NOVENA. NOTIFICACIONES.">
          Las partes autorizan ser notificados en las siguientes direcciones: El ARRENDADOR al correo electrónico {blanco(m.arrendadorCorreo)} y por parte
          del ARRENDATARIO al correo electrónico: {blanco(m.arrendatarioCorreo)}. Las partes deberán comunicar inmediatamente cualquier variación de
          dirección, so pena de entenderse surtidas las notificaciones en el lugar aquí señalado.
        </Clausula>

        {m.clausulasAdicionales.map((c, i) => (
          <Clausula key={i} titulo={`${ordinalClausula(PRIMERA_CLAUSULA_ADICIONAL_ARRENDAMIENTO + i)}. - ${blanco(c.titulo).toUpperCase()}.`}>
            {c.texto}
          </Clausula>
        ))}

        <Text style={s.p}>
          Para constancia de lo anterior, se firma el presente contrato en la ciudad de {blanco(m.ciudadFirma)}, {lugarFecha}.
        </Text>

        <View style={s.firmas} wrap={false}>
          <View style={s.firma}>
            <Text style={{ marginBottom: 36 }}>El Arrendador</Text>
            <View style={s.firmaLinea} />
            <Text style={s.b}>{blanco(m.arrendadorNombre)}</Text>
            {juridica && <Text>NIT. {blanco(m.arrendadorNit)}</Text>}
            {juridica && <Text>RL. {blanco(m.arrendadorRepresentante)}</Text>}
            <Text>
              {documento.firma} {blanco(m.arrendadorCedula)}
            </Text>
          </View>
          <View style={s.firma}>
            <Text style={{ marginBottom: 36 }}>El Arrendatario</Text>
            <View style={s.firmaLinea} />
            <Text style={s.b}>{blanco(m.arrendatarioNombre)}</Text>
            <Text>NIT. {blanco(m.arrendatarioNit)}</Text>
            <Text>RL. {blanco(m.arrendatarioRepresentante)}</Text>
            <Text>CC. {blanco(m.arrendatarioCedula)}</Text>
          </View>
        </View>
      </Page>
    </Document>
  )
}
