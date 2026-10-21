import { Image, StyleSheet, Text, View } from "@react-pdf/renderer"
import { s } from "@/components/minuta-mano-obra-pdf"
import { textoFirmado, type FirmaDocumento } from "@/lib/firmas"

// Bloque de firma de los PDF: la firma registrada (si el documento ya se
// firmó), la línea, el nombre, el rol y la leyenda con fecha, hora y código.
// Sin firma deja el espacio en blanco para firmar en papel.

const t = StyleSheet.create({
  espacio: { height: 46, justifyContent: "flex-end", marginBottom: 2 },
  imagen: { maxHeight: 44, maxWidth: 150, objectFit: "contain" },
  nombre: { fontFamily: "Helvetica-Bold", fontSize: 9 },
  rol: { fontSize: 8.5, color: "#444" },
  leyenda: { fontSize: 6.5, color: "#555", marginTop: 2 },
})

export function FirmaPDF({ firma, nombre, rol }: { firma?: FirmaDocumento | null; nombre: string; rol: string }) {
  return (
    <View style={s.firma}>
      <View style={t.espacio}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- Image de react-pdf, no de HTML */}
        {firma?.imagen ? <Image src={firma.imagen} style={t.imagen} /> : null}
      </View>
      <View style={s.firmaLinea} />
      <Text style={t.nombre}>{firma?.nombre ?? nombre}</Text>
      <Text style={t.rol}>{firma?.cargo ? `${rol} · ${firma.cargo}` : rol}</Text>
      {firma && <Text style={t.leyenda}>{textoFirmado(firma)}</Text>}
    </View>
  )
}
