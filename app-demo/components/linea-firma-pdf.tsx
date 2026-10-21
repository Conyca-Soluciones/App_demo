import { Image, StyleSheet, Text, View } from "@react-pdf/renderer"
import { textoFirmado, type FirmaDocumento } from "@/lib/firmas"

// Línea de firma de las minutas con la firma del representante legal encima
// (copiada al aprobar la minuta, 20261201000000_representantes_legales.sql).
// La imagen va en posición absoluta sobre la línea: no mueve nada del
// documento, así la minuta firmada se ve igual que la aprobada. Mismo estilo
// de línea que `s.firmaLinea` (minuta-mano-obra-pdf; no se importa de ahí
// para no crear un ciclo).

const t = StyleSheet.create({
  ancla: { height: 0, position: "relative" },
  imagen: { position: "absolute", bottom: 1, left: 4, maxHeight: 42, maxWidth: 150, objectFit: "contain" },
  linea: { borderTopWidth: 1, borderColor: "#111", width: "88%", marginBottom: 4 },
  leyenda: { fontSize: 6.5, color: "#555", marginBottom: 2 },
})

export function LineaFirma({ firma }: { firma?: FirmaDocumento | null }) {
  return (
    <>
      {firma?.imagen && (
        <View style={t.ancla}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- Image de react-pdf, no de HTML */}
          <Image src={firma.imagen} style={t.imagen} />
        </View>
      )}
      <View style={t.linea} />
      {firma && <Text style={t.leyenda}>{textoFirmado(firma)}</Text>}
    </>
  )
}
