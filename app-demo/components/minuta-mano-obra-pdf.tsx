import { Document, Font, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer"
import { leerNumero } from "@/lib/contratos"
import {
  POSICION_OBLIGACION_CORRECCION,
  blanco,
  cantidadEnLetras,
  fechaLarga,
  obligacionCorreccion,
  ordinalClausula,
  CLAUSULAS_PLANTILLA,
  partesFecha,
  pesosSinSimbolo,
  totalItemsMinuta,
  type MinutaManoObra,
} from "@/lib/minuta-mano-obra"

// ---------------------------------------------------------------------------
// PDF de la minuta del contrato de mano de obra: el texto de la plantilla
// GJ-F-003 de Jurídica con los campos de la minuta. Se genera en el servidor
// (app/(app)/contratos/pre-aprobacion/[id]/minuta/route.tsx).
// ---------------------------------------------------------------------------

// Sin partir palabras con guion: en un contrato, "CONSTRUC-CIONES" o un
// apellido cortado se ven mal. (Es global de @react-pdf: aplica también a los
// demás PDF que se generen en el mismo proceso.)
Font.registerHyphenationCallback((palabra) => [palabra])

const AZUL = "#3B6EA5"
const BORDE = "#9AA4AE"

// Estilos y piezas compartidas con las demás minutas (arrendamiento...).
export const s = StyleSheet.create({
  page: { paddingTop: 108, paddingBottom: 56, paddingHorizontal: 72, fontSize: 10.5, fontFamily: "Helvetica", lineHeight: 1.35, color: "#111" },
  header: { position: "absolute", top: 28, left: 72, right: 72, flexDirection: "row", borderWidth: 1, borderColor: BORDE },
  headerLogo: { width: 130, padding: 6, justifyContent: "center", alignItems: "center", borderRightWidth: 1, borderColor: BORDE },
  logo: { width: 112, objectFit: "contain" },
  headerTitulo: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 6, borderRightWidth: 1, borderColor: BORDE },
  headerTituloTexto: { fontFamily: "Helvetica-Bold", fontSize: 10, textAlign: "center" },
  headerDatos: { width: 100 },
  headerDato: { fontSize: 8.5, paddingVertical: 3, paddingHorizontal: 5, textAlign: "center" },
  headerDatoBorde: { borderTopWidth: 1, borderColor: BORDE },
  footer: { position: "absolute", bottom: 24, left: 72, right: 72, fontSize: 8, color: "#666", textAlign: "center" },
  titulo: { fontFamily: "Helvetica-Bold", fontSize: 11.5, textAlign: "center", marginBottom: 12 },
  p: { textAlign: "justify", marginBottom: 8 },
  b: { fontFamily: "Helvetica-Bold" },
  sub: { fontFamily: "Helvetica-Bold", marginBottom: 4 },
  li: { flexDirection: "row", marginBottom: 4, paddingLeft: 10 },
  liNum: { width: 18 },
  liTexto: { flex: 1, textAlign: "justify" },
  firmas: { flexDirection: "row", marginTop: 50, marginBottom: 18 },
  firma: { flex: 1, paddingRight: 18 },
  firmaLinea: { borderTopWidth: 1, borderColor: "#111", width: "88%", marginBottom: 4 },
  // Tablas
  tabla: { borderWidth: 1, borderColor: BORDE, marginTop: 6 },
  tr: { flexDirection: "row" },
  th: { backgroundColor: AZUL, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8.5, padding: 4 },
  td: { fontSize: 8.5, padding: 4, borderTopWidth: 1, borderColor: BORDE },
  celdaBorde: { borderLeftWidth: 1, borderColor: BORDE },
  control: { marginTop: 18 },
  controlTitulo: { fontFamily: "Helvetica-Bold", fontSize: 9, textAlign: "center", marginBottom: 2 },
})

export function Encabezado(props: { logo: string | Buffer; formato: string; codigo: string; version: string; fecha: string }) {
  const { logo, formato, codigo, version, fecha } = props
  return (
    <View style={s.header} fixed>
      <View style={s.headerLogo}>
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <Image style={s.logo} src={logo} />
      </View>
      <View style={s.headerTitulo}>
        <Text style={s.headerTituloTexto}>SISTEMA INTEGRADO DE GESTIÓN</Text>
        <Text style={s.headerTituloTexto}>{formato}</Text>
      </View>
      <View style={s.headerDatos}>
        <Text style={s.headerDato}>{codigo}</Text>
        <Text style={[s.headerDato, s.headerDatoBorde]}>Versión {version}</Text>
        <Text style={[s.headerDato, s.headerDatoBorde]}>Fecha: {fecha}</Text>
      </View>
    </View>
  )
}

export function Lista({ items, marcador }: { items: string[]; marcador: (i: number) => string }) {
  return (
    <View style={{ marginBottom: 8 }}>
      {items.map((t, i) => (
        <View key={i} style={s.li} wrap={false}>
          <Text style={s.liNum}>{marcador(i)}</Text>
          <Text style={s.liTexto}>{t}</Text>
        </View>
      ))}
    </View>
  )
}

export function Clausula({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <Text style={s.p}>
      <Text style={s.b}>{titulo} </Text>
      {children}
    </Text>
  )
}

const ENCABEZADO = { formato: "FORMATO CONTRATO DE MANO DE OBRA", codigo: "GJ-F-003", version: "01", fecha: "19/01/2023" }

export function MinutaManoObraPDF({ minuta: m, numero, logo }: { minuta: MinutaManoObra; numero: number; logo: string | Buffer }) {
  const fecha = partesFecha(m.fechaFirma)
  const juridica = m.contratistaTipoPersona === "juridica"
  const valor = leerNumero(m.valor)
  const pct = (t: string) => `${blanco(t.replace(/%/g, ""))}%`

  const obligacionesContratista = [...m.obligacionesContratista]
  obligacionesContratista.splice(Math.min(POSICION_OBLIGACION_CORRECCION, obligacionesContratista.length), 0, obligacionCorreccion(m))

  const lugarFecha = fecha
    ? fecha.dia === 1
      ? `el primer (1) día del mes de ${fecha.mes} de ${fecha.anio}`
      : `a los ${cantidadEnLetras(fecha.dia)} días del mes de ${fecha.mes} de ${fecha.anio}`
    : "a los ____ días del mes de ________ de ____"

  const totalAnexo = totalItemsMinuta(m.items)
  const anchos = { actividad: "46%", unidad: "10%", cantidad: "12%", vu: "16%", total: "16%" }

  return (
    <Document title={`Contrato de mano de obra N° ${numero}`} author={m.contratanteNombre}>
      <Page size="LETTER" style={s.page}>
        <Encabezado logo={logo} {...ENCABEZADO} />
        <Text style={s.footer} fixed render={({ pageNumber, totalPages }) => `Contrato de mano de obra N° ${numero} · Página ${pageNumber} de ${totalPages}`} />

        <Text style={s.titulo}>CONTRATO DE MANO DE OBRA N° {numero}</Text>

        <Text style={s.p}>
          En la ciudad de {blanco(m.ciudadFirma)} {lugarFecha}, entre los suscritos a saber: {blanco(m.contratanteRepresentante)} mayor de edad,
          identificado con cédula de ciudadanía {blanco(m.contratanteRepresentanteCedula)} de {blanco(m.contratanteRepresentanteExpedida)}, actuando
          en calidad de representante legal de <Text style={s.b}>{blanco(m.contratanteNombre)}</Text> identificado con Nit. {blanco(m.contratanteNit)}{" "}
          quien para efectos del presente contrato se denominará el <Text style={s.b}>CONTRATANTE</Text>, y{" "}
          {juridica ? (
            <>
              {blanco(m.contratistaRepresentante)}, mayor de edad, identificado con la cédula de ciudadanía Nº. {blanco(m.contratistaCedula)} de{" "}
              {blanco(m.contratistaCedulaExpedida)} domiciliado y residente en la ciudad de {blanco(m.contratistaCiudad)}, actuando en nombre y
              representación legal de <Text style={s.b}>{blanco(m.contratistaNombre)}</Text> identificada con NIT N° {blanco(m.contratistaNit)} y quien
              para los efectos del presente documento se denominará el <Text style={s.b}>CONTRATISTA</Text>
            </>
          ) : (
            <>
              <Text style={s.b}>{blanco(m.contratistaNombre)}</Text>, mayor de edad, identificado con la cédula de ciudadanía Nº.{" "}
              {blanco(m.contratistaCedula)} de {blanco(m.contratistaCedulaExpedida)}, domiciliado y residente en la ciudad de{" "}
              {blanco(m.contratistaCiudad)}, actuando en nombre propio y quien para los efectos del presente documento se denominará el{" "}
              <Text style={s.b}>CONTRATISTA</Text>
            </>
          )}
          , acuerdan celebrar el presente negocio jurídico, previo a las siguientes consideraciones:
        </Text>

        <Clausula titulo="PRIMERA. – OBJETO:">
          En virtud del presente contrato, EL CONTRATANTE, encarga al CONTRATISTA {blanco(m.objeto)}, para la obra denominada {blanco(m.obra)}.
        </Clausula>

        <Text style={[s.p, s.b]}>SEGUNDA. - OBLIGACIONES DE LAS PARTES</Text>
        <Text style={s.sub}>El CONTRATANTE se compromete a:</Text>
        <Lista items={m.obligacionesContratante} marcador={(i) => `${i + 1}.`} />
        <Text style={s.sub}>EL CONTRATISTA se compromete a:</Text>
        <Lista items={obligacionesContratista} marcador={(i) => `${i + 1}.`} />

        <Clausula titulo="TERCERA. - DURACIÓN Y ENTREGA DE LA OBRA:">
          La realización de las actividades del presente contrato, se llevará a cabo dentro de un plazo {blanco(m.plazo)}. El presente
          contrato vence el {fechaLarga(m.vencimiento)}.
        </Clausula>
        <Text style={s.p}>
          Una vez finalizado el objeto del contrato y aceptada por EL CONTRATANTE, EL CONTRATISTA deberá hacer entrega formal de las mismas, junto con
          cualquier otra documentación que se haya generado con motivo de este contrato, de tal forma que sólo existirá una copia de la totalidad del
          material relativo al objeto del contrato en poder exclusivo de EL CONTRATANTE.
        </Text>

        <Clausula titulo="CUARTA. - PRECIO Y FORMA DE PAGO:">
          El valor del presente contrato será por la suma de {blanco(m.valorLetras)} (${valor !== null ? pesosSinSimbolo(valor) : blanco(m.valor)}) M/CTE,
          incluidos todos los impuestos, gravámenes y demás.
        </Clausula>
        {m.formaPago.trim() && <Text style={s.p}>{m.formaPago.trim()}</Text>}
        {m.requisitosPago.length > 0 && (
          <>
            <Text style={s.p}>Para el respectivo pago se requiere:</Text>
            <Lista items={m.requisitosPago} marcador={(i) => `${String.fromCharCode(97 + i)})`} />
          </>
        )}

        <Clausula titulo="QUINTA. - LUGAR DE EJECUCIÓN:">
          Las actividades objeto del contrato, se desarrollarán en el Municipio de {blanco(m.municipioEjecucion)}, donde el contratante ejecuta la obra
          denominada {blanco(m.obra)}.
        </Clausula>

        <Clausula titulo="SEXTA. - INDEPENDENCIA DEL CONTRATISTA:">
          El CONTRATISTA actuará por su propia cuenta, con absoluta autonomía y no estará sometido a subordinación laboral con el CONTRATANTE,
          comprometiéndose a realizar con sus propios medios y bajo su responsabilidad esta obra. Por tanto, este contrato no es de carácter laboral y no
          genera prestaciones laborales a su favor.
        </Clausula>

        <Clausula titulo="SÉPTIMA. - CESIÓN O SUBCONTRATACIÓN DE LAS ACTIVIDADES DE OBRA OBJETO DEL CONTRATO:">
          El CONTRATISTA no podrá ceder a persona alguna natural o jurídica, Nacional o extranjera, el presente contrato. PARÁGRAFO: Para la cesión del
          presente contrato se requiere de previa autorización por escrito del CONTRATANTE.
        </Clausula>
        <Text style={s.p}>
          El CONTRATISTA no podrá subcontratar con persona jurídica o natural la ejecución parcial o total del objeto del presente contrato, salvo
          autorización expresa del CONTRATANTE.
        </Text>

        <Clausula titulo="OCTAVA. – CLAUSULA PENAL:">
          En caso de incumplimiento de las obligaciones a cargo de alguna de las partes, habrá lugar al pago de una sanción pecuniaria equivalente al{" "}
          {pct(m.clausulaPenalPorcentaje)} del valor del contrato, suma que se tendrá como pago parcial pero no definitivo de los perjuicios que sufra la
          parte afectada por el incumplimiento. PARÁGRAFO. El valor de la cláusula penal, será descontado de cualquier saldo que resultare a favor del
          CONTRATISTA en razón de este contrato si lo hubiere. En caso contrario se hará efectiva la garantía y si esto no fuere posible, se iniciarán las
          acciones judiciales pertinentes.
        </Clausula>

        <Clausula titulo="NOVENA. - MODIFICACIONES:">
          El presente contrato podrá modificarse previo acuerdo de las partes el cual deberá reposar por escrito.
        </Clausula>

        <Clausula titulo="DECIMA. - CAUSALES DE TERMINACIÓN:">
          Sin perjuicio de lo contemplado en la ley, este contrato se terminará: A) Por vencimiento del término fijado en el presente contrato para la
          ejecución del mismo. B) Por la ejecución del objeto contratado. C) Por grave incumplimiento de las obligaciones del CONTRATISTA o EL
          CONTRATANTE. D) Por mutuo acuerdo de las partes.
        </Clausula>

        <Clausula titulo="DECIMA PRIMERA. - CLÁUSULA PENAL PECUNIARIA:">
          En caso de incumplimiento de las obligaciones a cargo de alguna de las partes, habrá lugar al pago de una sanción pecuniaria equivalente al{" "}
          {pct(m.clausulaPenalPorcentaje)} del valor del contrato, suma que se tendrá como pago parcial pero no definitivo de los perjuicios que sufra la
          parte afectada por el incumplimiento. PARÁGRAFO. El valor de la cláusula penal, será descontado de cualquier saldo que resultare a favor del
          CONTRATISTA en razón de este contrato si lo hubiere. En caso contrario, se iniciarán las acciones judiciales pertinentes.
        </Clausula>

        <Clausula titulo="DECIMA SEGUNDA. - DOMICILIO:">
          Para todos los efectos legales, las partes acuerdan como domicilio de este contrato el municipio de {blanco(m.domicilioMunicipio)}, departamento
          de {blanco(m.domicilioDepartamento)}.
        </Clausula>

        <Clausula titulo="DECIMA TERCERA. - DOCUMENTOS DEL CONTRATO:">
          Forman parte integral del presente contrato los anexos {blanco(m.anexos)}, y todos los documentos que se produzcan durante el desarrollo del
          mismo.
        </Clausula>

        <Clausula titulo="DECIMA CUARTA. - CONFIDENCIALIDAD:">
          Las partes se comprometen, con carácter mutuo y recíproco, a tratar como “confidencial” toda la información técnica, comercial o de cualquier
          otra naturaleza comprendida y/o que se derive directa o indirectamente de las indicaciones que la contraparte le haya facilitado para el
          desarrollo del objeto del presente contrato (en adelante “la información confidencial”). En consecuencia, ninguna parte podrá revelar total o
          parcialmente, de palabra, por escrito o de cualquier otra forma, a ninguna persona física o jurídica, ya sea de carácter público o privado, la
          Información Confidencial, sin el consentimiento expreso y por escrito de la contraparte.
        </Clausula>
        <Text style={s.p}>
          La misma confidencialidad que se imponen a las partes o a terceros que intervengan en la ejecución, deberá ser impuesta por cada una de las
          partes a sus trabajadores (por cuenta propia o ajena, con relación laboral o mercantil) que de modo directo o indirecto estén relacionados con el
          objeto del contrato. Será obligación de las mismas partes hacer firmar a sus trabajadores un documento vinculante por el que adquieren tal
          obligación.
        </Text>
        <Text style={s.p}>
          Este compromiso de confidencialidad, tanto entre las partes como de éstas con sus trabajadores y contratistas, permanecerá durante la vigencia
          del presente contrato, así como un año después de la finalización del mismo.
        </Text>

        <Clausula titulo="DECIMA QUINTA. – SOLUCION DE CONTROVERSIAS:">
          Cualquier disputa o diferencia que surja con ocasión del objeto y obligaciones de este contrato serán arregladas en lo posible mediante la
          negociación y la conciliación entre las partes, para lo cual se contará con un período de treinta (30) días calendario. Sin embargo, en
          cualquier momento las partes podrán llevar cualquier disputa o controversia o reclamo relacionado con este contrato, incluyendo la existencia,
          validez o terminación de éste, ante un Tribunal de Arbitramento. La sede de dicho Tribunal de Arbitramento será la ciudad de{" "}
          {blanco(m.ciudadArbitramento)} y estará conformado por un (1) árbitro que será un abogado o con experiencia laboral no menor a cinco años en
          actividades de obra civil, que fallará en derecho dando aplicación a la ley colombiana. Dicho árbitro será nombrado por el Centro de
          Conciliación y Arbitraje de la Cámara de Comercio.
        </Clausula>

        <Clausula titulo="DECIMA SEXTA. – GARANTIA GENERAL DE CUMPLIMIENTO:">
          El contratista podrá presentar póliza de cumplimiento del contrato en cuantía equivalente al {pct(m.polizaPorcentaje)} del valor total del
          mismo con una vigencia igual a la del término del contrato y dos meses más, o cualquiera otra garantía a satisfacción del contratante.
        </Clausula>

        <Clausula titulo="DECIMA SEPTIMA. – PERFECCIONAMIENTO:">
          El presente contrato se perfecciona con la suscripción del mismo por las partes.
        </Clausula>

        <Clausula titulo="DECIMA OCTAVA. – NOTIFICACIONES:">
          Las partes recibirán notificaciones en: El CONTRATANTE al correo electrónico {blanco(m.contratanteCorreo)} y el CONTRATISTA al correo
          electrónico {blanco(m.contratistaCorreo)}.
        </Clausula>

        {m.clausulasAdicionales.map((c, i) => (
          <Clausula key={i} titulo={`${ordinalClausula(CLAUSULAS_PLANTILLA.length + 1 + i)}. – ${blanco(c.titulo).toUpperCase()}:`}>
            {c.texto}
          </Clausula>
        ))}

        <Text style={s.p}>
          En constancia de lo anterior se firma en la ciudad de {blanco(m.ciudadFirma)}, {lugarFecha}.
        </Text>

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
            {juridica && <Text>{blanco(m.contratistaRepresentante)}</Text>}
            <Text>C.C.: {blanco(m.contratistaCedula)}</Text>
            {juridica && <Text>NIT. {blanco(m.contratistaNit)}</Text>}
            <Text style={s.b}>CONTRATISTA</Text>
          </View>
        </View>

        <View style={s.control} wrap={false}>
          <Text style={s.controlTitulo}>APROBACIÓN Y CONTROL DE CAMBIOS DEL DOCUMENTO</Text>
          <View style={s.tabla}>
            {[
              ["", "ELABORÓ", "REVISÓ", "APROBÓ"],
              ["NOMBRE:", "Katherine Hernandez", "Sandra Johanna Amaya", "Luis Carlos Perez"],
              ["CARGO:", "Coordinadora Jurídica", "Subgerente administrativa y financiera", "Gerente General"],
              ["FECHA:", "28 de octubre", "", "19 de enero de 2023"],
            ].map((fila, i) => (
              <View key={i} style={s.tr}>
                {fila.map((c, j) => (
                  <Text key={j} style={[i === 0 ? s.th : s.td, { width: j === 0 ? "16%" : "28%" }, j > 0 ? s.celdaBorde : {}, i > 0 && j === 0 ? s.b : {}]}>
                    {c}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </View>
      </Page>

      <Page size="LETTER" style={s.page}>
        <Encabezado logo={logo} {...ENCABEZADO} />
        <Text style={s.footer} fixed render={({ pageNumber, totalPages }) => `Contrato de mano de obra N° ${numero} · Página ${pageNumber} de ${totalPages}`} />
        <Text style={s.titulo}>ANEXO N° 1 — ACTIVIDADES, CANTIDADES Y VALORES</Text>
        <Text style={s.p}>
          Contrato de mano de obra N° {numero} entre {blanco(m.contratanteNombre)} y {blanco(m.contratistaNombre)}, para la obra denominada{" "}
          {blanco(m.obra)}.
        </Text>
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
                <Text style={[s.td, { width: anchos.actividad }]}>{it.actividad}</Text>
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
            <Text style={[s.td, s.celdaBorde, s.b, { width: anchos.total, textAlign: "right" }]}>$ {pesosSinSimbolo(totalAnexo)}</Text>
          </View>
        </View>
        <Text style={[s.p, { marginTop: 10, fontSize: 9, color: "#444" }]}>Fecha: {fechaLarga(m.fechaFirma)}.</Text>
      </Page>
    </Document>
  )
}
