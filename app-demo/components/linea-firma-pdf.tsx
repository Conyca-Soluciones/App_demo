import { Image, StyleSheet, Text, View } from "@react-pdf/renderer"
import { textoFirmado, type FirmaDocumento } from "@/lib/firmas"

// Línea de firma de las minutas con la firma del representante legal encima
// (copiada al aprobar la minuta, 20261201000000_representantes_legales.sql).
// La imagen se monta sobre el espacio en blanco encima de la línea (margen
// negativo): no mueve nada del documento, así la minuta firmada se ve igual
// que la aprobada. Mismo estilo
// de línea que `s.firmaLinea` (minuta-mano-obra-pdf; no se importa de ahí
// para no crear un ciclo).

const t = StyleSheet.create({
  // Caja de 40 pt con margen negativo: se monta sobre el espacio en blanco que
  // ya hay encima de la línea (react-pdf no dibuja una imagen absoluta dentro
  // de una caja de alto cero).
  espacio: { height: 40, marginTop: -40, justifyContent: "flex-end", paddingLeft: 4 },
  imagen: { maxHeight: 38, maxWidth: 150, objectFit: "contain" },
  linea: { borderTopWidth: 1, borderColor: "#111", width: "88%", marginBottom: 4 },
  leyenda: { fontSize: 6.5, color: "#555", marginBottom: 2 },
})

export function LineaFirma({ firma }: { firma?: FirmaDocumento | null }) {
  return (
    <>
      {firma?.imagen && (
        <View style={t.espacio}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- Image de react-pdf, no de HTML */}
          <Image src={firma.imagen} style={t.imagen} />
        </View>
      )}
      <View style={t.linea} />
      {firma && <Text style={t.leyenda}>{textoFirmado(firma)}</Text>}
    </>
  )
}
