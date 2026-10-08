import { Document, Page, View, Text } from "@react-pdf/renderer"
import { leerNumero } from "@/lib/contratos"
import { blanco, cantidadEnLetras, ordinalClausula, partesFecha, pesosSinSimbolo, totalItemsMinuta } from "@/lib/minuta-mano-obra"
import { tipoDocumentoArrendador } from "@/lib/minuta-arrendamiento"
import { PRIMERA_CLAUSULA_ADICIONAL_SUMINISTRO, type MinutaSuministro } from "@/lib/minuta-suministro"
import { Clausula, Encabezado, Lista, P, s } from "@/components/minuta-mano-obra-pdf"

// ---------------------------------------------------------------------------
// PDF de la minuta del contrato de suministro: el texto de la plantilla
// GJ-F-012 de Jurídica con los campos de la minuta. Se genera en el servidor
// (app/(app)/contratos/pre-aprobacion/[id]/minuta/route.tsx).
// ---------------------------------------------------------------------------

const ENCABEZADO = { formato: "CONTRATO DE SUMINISTRO", codigo: "GJ-F-012", version: "01", fecha: "28/02/2023" }

const letra = (i: number) => `${String.fromCharCode(97 + i)})`
const pct = (t: string) => `${blanco(t.replace(/%/g, ""))}%`

export function MinutaSuministroPDF({ minuta: m, numero, logo }: { minuta: MinutaSuministro; numero: number; logo: string | Buffer }) {
  const fecha = partesFecha(m.fechaFirma)
  const juridica = m.contratistaTipoPersona === "juridica"
  const documento = tipoDocumentoArrendador(m.contratistaTipoDocumento)
  const valor = leerNumero(m.valor)
  const consecutivo = `Nº CJ-${numero}-${fecha ? fecha.anio : "20__"}`
  const lugarFecha = fecha
    ? fecha.dia === 1
      ? `el primer (1) día del mes de ${fecha.mes} de ${fecha.anio}`
      : `a los ${cantidadEnLetras(fecha.dia)} días del mes de ${fecha.mes} de ${fecha.anio}`
    : "a los ____ días del mes de ________ de ____"
  const totalItems = totalItemsMinuta(m.items)
  const anchos = { item: "8%", detalle: "40%", und: "9%", cant: "11%", vu: "16%", total: "16%" }
  const anchosAmparo = { amparo: "40%", porcentaje: "20%", vigencia: "40%" }

  return (
    <Document title={`Contrato de suministro ${consecutivo}`} author={m.contratanteNombre}>
      <Page size="LETTER" style={s.page}>
        <Encabezado logo={logo} {...ENCABEZADO} />
        <Text style={s.footer} fixed render={({ pageNumber, totalPages }) => `Contrato de suministro ${consecutivo} · Página ${pageNumber} de ${totalPages}`} />

        <Text style={[s.titulo, { marginBottom: 2 }]}>CONTRATO DE SUMINISTRO</Text>
        <Text style={s.titulo}>{consecutivo}</Text>

        <P>
          Entre los suscritos a saber: <Text style={s.b}>{blanco(m.contratanteNombre)}</Text> identificado con Nit. {blanco(m.contratanteNit)} representado
          legalmente por <Text style={s.b}>{blanco(m.contratanteRepresentante)}</Text> mayor de edad, identificado con cédula de ciudadanía{" "}
          {blanco(m.contratanteRepresentanteCedula)}, quien para efectos del presente contrato se denominará el CONTRATANTE, y{" "}
          {juridica ? (
            <>
              <Text style={s.b}>{blanco(m.contratistaNombre)}</Text> identificado con Nit. {blanco(m.contratistaNit)} representada legalmente por{" "}
              <Text style={s.b}>{blanco(m.contratistaRepresentante)},</Text> mayor de edad, identificada con {documento.articulo} {documento.texto} Nº.{" "}
              {blanco(m.contratistaCedula)} de {blanco(m.contratistaCedulaExpedida)}, domiciliada y residente en la ciudad de {blanco(m.contratistaCiudad)}
            </>
          ) : (
            <>
              <Text style={s.b}>{blanco(m.contratistaNombre)},</Text> mayor de edad, identificado con {documento.articulo} {documento.texto} Nº. {blanco(m.contratistaCedula)} de{" "}
              {blanco(m.contratistaCedulaExpedida)}, domiciliado y residente en la ciudad de {blanco(m.contratistaCiudad)}, actuando en nombre propio
            </>
          )}{" "}
          y quien para los efectos del presente documento se denominará el CONTRATISTA, acuerdan celebrar el presente negocio jurídico, previo a las
          siguientes consideraciones:
        </P>

        <Clausula titulo="PRIMERA. – OBJETO:">
          {blanco(m.objeto)}, para el proyecto {blanco(m.obra)}. De conformidad con el valor dispuesto en la cotización y de acuerdo con las necesidades,
          características y conceptos contenidos en el presente contrato según las siguientes especificaciones técnicas:
        </Clausula>
        <View style={[s.tabla, { marginBottom: 10 }]}>
          <View style={s.tr} fixed>
            <Text style={[s.th, { width: anchos.item, textAlign: "center" }]}>ITEM</Text>
            <Text style={[s.th, { width: anchos.detalle }]}>DETALLE</Text>
            <Text style={[s.th, { width: anchos.und, textAlign: "center" }]}>UND</Text>
            <Text style={[s.th, { width: anchos.cant, textAlign: "right" }]}>CANT</Text>
            <Text style={[s.th, { width: anchos.vu, textAlign: "right" }]}>VALOR UNIT</Text>
            <Text style={[s.th, { width: anchos.total, textAlign: "right" }]}>VALOR TOTAL</Text>
          </View>
          {m.items.map((it, i) => {
            const c = leerNumero(it.cantidad)
            const v = leerNumero(it.valorUnitario)
            return (
              <View key={i} style={s.tr} wrap={false}>
                <Text style={[s.td, { width: anchos.item, textAlign: "center" }]}>{i + 1}</Text>
                <Text style={[s.td, s.celdaBorde, { width: anchos.detalle }]}>{it.actividad}</Text>
                <Text style={[s.td, s.celdaBorde, { width: anchos.und, textAlign: "center" }]}>{it.unidad}</Text>
                <Text style={[s.td, s.celdaBorde, { width: anchos.cant, textAlign: "right" }]}>{it.cantidad}</Text>
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

        <Clausula titulo="SEGUNDO. - VALOR Y FORMA DE PAGO:">
          Para los efectos legales y fiscales, el valor del presente contrato será la suma de{" "}
          <Text style={s.b}>
            {blanco(m.valorLetras)} (${valor !== null ? pesosSinSimbolo(valor) : blanco(m.valor)}) M/CTE,
          </Text>{" "}
          incluidos todos los impuestos, gravámenes y demás.
        </Clausula>
        <Clausula titulo="FORMA DE PAGO:">{blanco(m.formaPago)}</Clausula>

        <Clausula titulo="TERCERA. - PLAZO DEL CONTRATO:">
          El plazo de ejecución será de {blanco(m.plazo)} contados a partir de la aprobación de la garantía general de cumplimiento.
        </Clausula>

        <Text style={[s.p, s.b]}>CUARTA. - OBLIGACIONES DEL CONTRATANTE:</Text>
        <Lista items={m.obligacionesContratante} marcador={letra} />

        <Text style={[s.p, s.b]}>QUINTA - OBLIGACIONES DEL CONTRATISTA:</Text>
        <Lista items={m.obligacionesContratista} marcador={letra} />

        <Clausula titulo="SEXTA - SUPERVISIÓN:">
          La supervisión del presente contrato de suministro será efectuada por el Director de obra o quien haga sus veces, quien tendrá la atribución de
          exigir al CONTRATISTA la ejecución idónea y oportuna del objeto contratado, verificando que se cumpla con las especificaciones descritas en el objeto
          del mismo.
        </Clausula>

        <Clausula titulo="SEPTIMA. - LUGAR DE EJECUCIÓN:">
          Las actividades objeto del contrato, se desarrollarán en la ciudad de {blanco(m.ciudadEjecucion)}.
        </Clausula>

        <Clausula titulo="OCTAVA - SOLUCION DIRECTA DE LAS CONTROVERSIAS CONTRACTUALES:">
          Se considera que las diferencias o discrepancias, surgidas de la actividad contractual, se solucionan de manera ágil, rápida y directa para lo cual
          se acudirá a la conciliación, transacción o cualquier otro mecanismo de solución de controversia contractual previsto en la ley.
        </Clausula>

        <Clausula titulo="NOVENA - GARANTIA:">
          El CONTRATISTA constituirá a favor del CONTRATANTE las garantía que se describen más adelante y que sean aceptables para el contratante, en origen y
          forma, expedidas por una compañía de seguros legalmente establecida en Colombia.
        </Clausula>
        <P>
          La garantía deberá estar firmada por el Representante Legal de LA CONTRATISTA, las primas serán de su cargo y deberán estar acompañadas de los
          recibos de cancelación expedidos por la entidad aseguradora, las mismas deberán ser entregadas para su aprobación al contratante a más tardar tres
          (3) días después de la suscripción del presente contrato; la garantía deberá cubrir los riesgos de:
        </P>
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

        <Clausula titulo="DECIMA. – CLAUSULA PENAL Y MULTAS:">
          En caso de incumplimiento de las obligaciones a cargo de alguna de las partes, habrá lugar al pago de una sanción pecuniaria equivalente al{" "}
          {pct(m.clausulaPenalPorcentaje)} del valor del contrato, suma que se tendrá como pago parcial pero no definitivo de los perjuicios que sufra la parte
          afectada por el incumplimiento. PARÁGRAFO. El valor de la cláusula penal, será descontado de cualquier saldo que resultare a favor del CONTRATISTA
          en razón de este contrato si lo hubiere. En caso contrario se hará efectiva la garantía y si esto no fuere posible, se iniciarán las acciones
          judiciales pertinentes. El retraso en la entrega de los materiales objeto de suministro en los plazos requeridos dará lugar a multa del{" "}
          {pct(m.multaDiariaPorcentaje)} del valor total del contrato por cada día de retraso, valores que el contratista autoriza a descontarse de los valores
          adeudados.
        </Clausula>

        <Clausula titulo="DECIMA PRIMERA. - MODIFICACIONES:">
          El presente contrato podrá modificarse previo acuerdo de las partes el cual deberá reposar por escrito.
        </Clausula>

        <Clausula titulo="DÉCIMO SEGUNDA - CESIÓN:">
          EL CONTRATISTA no podrá ceder ni total, ni parcialmente este contrato, ni subcontratar sin autorización expresa y por escrito del contratante.
        </Clausula>

        <Clausula titulo="DECIMA TERCERA. - CAUSALES DE TERMINACIÓN:">
          Sin perjuicio de lo contemplado en la ley, este contrato se terminará: A) Por vencimiento del término fijado en el presente contrato para la
          ejecución del mismo. B) Por la ejecución del objeto contratado. C) Por grave incumplimiento de las obligaciones del CONTRATISTA o EL CONTRATANTE. E)
          Por mutuo acuerdo de las partes.
        </Clausula>

        <Clausula titulo="DECIMA CUARTA. - DOMICILIO:">
          Para todos los efectos legales, las partes acuerdan como domicilio de este contrato la Ciudad {blanco(m.domicilioCiudad)}.
        </Clausula>

        <Clausula titulo="DECIMA QUINTA. - DOCUMENTOS DEL CONTRATO:">
          Forman parte integral del presente contrato la cotización presentada por el CONTRATISTA.
        </Clausula>

        <Clausula titulo="DECIMA SEXTA. - CONFIDENCIALIDAD:">
          Las partes se comprometen, con carácter mutuo y recíproco, a tratar como “confidencial” toda la información técnica, comercial o de cualquier otra
          naturaleza comprendida y/o que se derive directa o indirectamente de las indicaciones que la contraparte le haya facilitado para el desarrollo del
          objeto del presente contrato (en adelante “la información confidencial”). En consecuencia, ninguna parte podrá revelar total o parcialmente, de
          palabra, por escrito o de cualquier otra forma, a ninguna persona física o jurídica, ya sea de carácter público o privado, la Información
          Confidencial, sin el consentimiento expreso y por escrito de la contraparte.
        </Clausula>
        <P>
          La misma confidencialidad que se imponen a las partes o a terceros que intervengan en la ejecución, deberá ser impuesta por cada una de las partes a
          sus trabajadores (por cuenta propia o ajena, con relación laboral o mercantil) que de modo directo o indirecto estén relacionados con el objeto del
          contrato. Será obligación de las mismas partes hacer firmar a sus trabajadores un documento vinculante por el que adquieren tal obligación.
        </P>
        <P>
          Este compromiso de confidencialidad, tanto entre las partes como de éstas con sus trabajadores y contratistas, permanecerá durante la vigencia del
          presente contrato, así como un año después de la finalización del mismo.
        </P>

        <Clausula titulo="DECIMA SEPTIMA. – PERFECCIONAMIENTO:">
          El presente contrato se perfecciona con la firma de los de los que intervinieron en el mismo y para su ejecución requiere la constitución y
          aprobación de las Garantías exigidas.
        </Clausula>

        <Clausula titulo="DECIMA OCTAVA. – NOTIFICACIONES:">
          Las partes recibirán notificaciones en: El CONTRATANTE al correo electrónico {blanco(m.contratanteCorreo)} y el CONTRATISTA al correo electrónico{" "}
          {blanco(m.contratistaCorreo)}.
        </Clausula>

        {m.clausulasAdicionales.map((c, i) => (
          <Clausula key={i} titulo={`${ordinalClausula(PRIMERA_CLAUSULA_ADICIONAL_SUMINISTRO + i)}. – ${blanco(c.titulo).toUpperCase()}:`}>
            {c.texto}
          </Clausula>
        ))}

        <P>
          En constancia de lo anterior se firma en {blanco(m.ciudadFirma)}, {lugarFecha}.
        </P>

        <View style={s.firmas} wrap={false}>
          <View style={s.firma}>
            <View style={s.firmaLinea} />
            <Text style={s.b}>{blanco(m.contratanteNombre)}</Text>
            <Text>{blanco(m.contratanteRepresentante)}</Text>
            <Text>C.C.: {blanco(m.contratanteRepresentanteCedula)}</Text>
            <Text>NIT. {blanco(m.contratanteNit)}</Text>
            <Text style={s.b}>CONTRATANTE</Text>
          </View>
          <View style={s.firma}>
            <View style={s.firmaLinea} />
            <Text style={s.b}>{blanco(m.contratistaNombre)}</Text>
            {juridica && <Text>R/L {blanco(m.contratistaRepresentante)}</Text>}
            <Text>
              {documento.firma === "CC." ? "C.C.:" : documento.firma} {blanco(m.contratistaCedula)}
            </Text>
            {juridica && <Text>NIT. {blanco(m.contratistaNit)}</Text>}
            <Text style={s.b}>CONTRATISTA</Text>
          </View>
        </View>
      </Page>
    </Document>
  )
}
