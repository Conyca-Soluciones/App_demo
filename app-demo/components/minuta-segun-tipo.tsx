"use client"

import { tituloTipoContrato } from "@/components/detalle-solicitud-contrato"
import { MinutaManoObraEditor } from "@/components/minuta-mano-obra-editor"
import { MinutaArrendamientoEditor } from "@/components/minuta-arrendamiento-editor"
import { MinutaSuministroEditor } from "@/components/minuta-suministro-editor"
import { MinutaVehiculoEditor } from "@/components/minuta-vehiculo-editor"
import { MinutaServiciosEditor } from "@/components/minuta-servicios-editor"
import { MinutaObraEditor } from "@/components/minuta-obra-editor"
import type { SolicitudContratoDetalle } from "@/lib/contratos"

// Editor de la minuta según el tipo de contrato (Pre-aprobación, Jurídica).
// Subgerencia la ve solo en PDF (components/minuta-solo-pdf.tsx).
export function MinutaSegunTipo({ detalle: d, puedeEditar }: { detalle: SolicitudContratoDetalle; puedeEditar: boolean }) {
  if (d.tipo === "mano_obra") return <MinutaManoObraEditor detalle={d} puedeEditar={puedeEditar} />
  if (d.tipo === "arrendamiento") return <MinutaArrendamientoEditor detalle={d} puedeEditar={puedeEditar} />
  if (d.tipo === "suministro_instalacion") return <MinutaSuministroEditor detalle={d} puedeEditar={puedeEditar} />
  if (d.tipo === "alquiler_vehiculo") return <MinutaVehiculoEditor detalle={d} puedeEditar={puedeEditar} />
  if (d.tipo === "prestacion_servicios") return <MinutaServiciosEditor detalle={d} puedeEditar={puedeEditar} />
  if (d.tipo === "obra") return <MinutaObraEditor detalle={d} puedeEditar={puedeEditar} />
  return (
    <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
      El tipo {tituloTipoContrato(d.tipo).toLowerCase()} todavía no tiene plantilla de minuta.
    </p>
  )
}
