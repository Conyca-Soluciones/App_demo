import path from "path"
import { renderToBuffer } from "@react-pdf/renderer"
import type { FirmaDocumento } from "@/lib/firmas"
import { limpiarMinuta, mezclarMinuta, minutaVacia, nombreArchivoMinuta } from "@/lib/minuta-mano-obra"
import { MinutaManoObraPDF } from "@/components/minuta-mano-obra-pdf"
import {
  limpiarMinutaArrendamiento,
  mezclarMinutaArrendamiento,
  minutaArrendamientoVacia,
  nombreArchivoMinutaArrendamiento,
} from "@/lib/minuta-arrendamiento"
import { MinutaArrendamientoPDF } from "@/components/minuta-arrendamiento-pdf"
import { limpiarMinutaSuministro, mezclarMinutaSuministro, minutaSuministroVacia, nombreArchivoMinutaSuministro } from "@/lib/minuta-suministro"
import { MinutaSuministroPDF } from "@/components/minuta-suministro-pdf"
import { limpiarMinutaVehiculo, mezclarMinutaVehiculo, minutaVehiculoVacia, nombreArchivoMinutaVehiculo } from "@/lib/minuta-vehiculo"
import { MinutaVehiculoPDF } from "@/components/minuta-vehiculo-pdf"
import { limpiarMinutaServicios, mezclarMinutaServicios, minutaServiciosVacia, nombreArchivoMinutaServicios } from "@/lib/minuta-servicios"
import { MinutaServiciosPDF } from "@/components/minuta-servicios-pdf"
import { esMinutaManoObra04, limpiarMinutaObra, mezclarMinutaObra, minutaObraVacia, nombreArchivoMinutaObra } from "@/lib/minuta-obra"
import { MinutaObraPDF } from "@/components/minuta-obra-pdf"

// ---------------------------------------------------------------------------
// PDF de la minuta de un contrato según su tipo, con los datos de la minuta
// (lo de pantalla o lo guardado). Lo usan la ruta de Pre-aprobación / Aprobación
// de contratos y la de ver el contrato desde Solicitud de otrosí. null = el tipo
// no tiene plantilla. El tipo sale siempre de la base, no del navegador.
// ---------------------------------------------------------------------------

export const LOGO_CONYCA_PATH = path.join(process.cwd(), "public", "logo-conyca.png")

export async function pdfMinutaContrato(
  tipo: string,
  numero: number,
  datos: unknown,
  foco?: string,
  // Firma del representante legal de la empresa (minuta aprobada).
  firmaContratante?: FirmaDocumento | null
): Promise<{ buffer: Buffer; archivo: string } | null> {
  // Mano de obra con la plantilla nueva (versión 04): mismo PDF que obra, con
  // su variante. Sin `variante` es una minuta de la plantilla anterior.
  if ((tipo === "obra" || tipo === "mano_obra") && (tipo === "obra" || esMinutaManoObra04(datos))) {
    const minuta = limpiarMinutaObra(mezclarMinutaObra(minutaObraVacia(), datos))
    // El tipo del contrato manda (de la base, no del navegador).
    minuta.variante = tipo === "mano_obra" ? "mano_obra" : "obra"
    const buffer = await renderToBuffer(<MinutaObraPDF minuta={minuta} numero={numero} logo={LOGO_CONYCA_PATH} foco={foco} firmaContratante={firmaContratante} />)
    return { buffer, archivo: nombreArchivoMinutaObra(numero, minuta.contratistaNombre, minuta.variante) }
  } else if (tipo === "mano_obra") {
    const minuta = limpiarMinuta(mezclarMinuta(minutaVacia(), datos))
    const buffer = await renderToBuffer(<MinutaManoObraPDF minuta={minuta} numero={numero} logo={LOGO_CONYCA_PATH} foco={foco} firmaContratante={firmaContratante} />)
    return { buffer, archivo: nombreArchivoMinuta(numero, minuta.contratistaNombre) }
  } else if (tipo === "arrendamiento") {
    const minuta = limpiarMinutaArrendamiento(mezclarMinutaArrendamiento(minutaArrendamientoVacia(), datos))
    const buffer = await renderToBuffer(<MinutaArrendamientoPDF minuta={minuta} numero={numero} logo={LOGO_CONYCA_PATH} foco={foco} firmaContratante={firmaContratante} />)
    return { buffer, archivo: nombreArchivoMinutaArrendamiento(numero, minuta.arrendadorNombre) }
  } else if (tipo === "suministro_instalacion") {
    const minuta = limpiarMinutaSuministro(mezclarMinutaSuministro(minutaSuministroVacia(), datos))
    const buffer = await renderToBuffer(<MinutaSuministroPDF minuta={minuta} numero={numero} logo={LOGO_CONYCA_PATH} foco={foco} firmaContratante={firmaContratante} />)
    return { buffer, archivo: nombreArchivoMinutaSuministro(numero, minuta.contratistaNombre) }
  } else if (tipo === "alquiler_vehiculo") {
    const minuta = limpiarMinutaVehiculo(mezclarMinutaVehiculo(minutaVehiculoVacia(), datos))
    const buffer = await renderToBuffer(<MinutaVehiculoPDF minuta={minuta} numero={numero} logo={LOGO_CONYCA_PATH} foco={foco} firmaContratante={firmaContratante} />)
    return { buffer, archivo: nombreArchivoMinutaVehiculo(numero, minuta.contratistaNombre) }
  } else if (tipo === "prestacion_servicios") {
    const minuta = limpiarMinutaServicios(mezclarMinutaServicios(minutaServiciosVacia(), datos))
    const buffer = await renderToBuffer(<MinutaServiciosPDF minuta={minuta} numero={numero} logo={LOGO_CONYCA_PATH} foco={foco} firmaContratante={firmaContratante} />)
    return { buffer, archivo: nombreArchivoMinutaServicios(numero, minuta.contratistaNombre) }
  } else {
    return null
  }
}
