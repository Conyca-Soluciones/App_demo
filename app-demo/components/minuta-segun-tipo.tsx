"use client"

import { tituloTipoContrato } from "@/components/detalle-solicitud-contrato"
import { MinutaManoObraEditor } from "@/components/minuta-mano-obra-editor"
import { MinutaArrendamientoEditor } from "@/components/minuta-arrendamiento-editor"
import { MinutaSuministroEditor } from "@/components/minuta-suministro-editor"
import { MinutaVehiculoEditor } from "@/components/minuta-vehiculo-editor"
import { MinutaServiciosEditor } from "@/components/minuta-servicios-editor"
import { MinutaObraEditor } from "@/components/minuta-obra-editor"
import { MinutaSoloPdf } from "@/components/minuta-solo-pdf"
import { useEffect, useState } from "react"
import { plantillaMinutaManoObra } from "@/app/(app)/contratos/pre-aprobacion/actions"
import type { SolicitudContratoDetalle } from "@/lib/contratos"

// Editor de la minuta según el tipo de contrato (Pre-aprobación, Jurídica).
// Subgerencia la ve solo en PDF (components/minuta-solo-pdf.tsx).
export function MinutaSegunTipo({ detalle: d, puedeEditar }: { detalle: SolicitudContratoDetalle; puedeEditar: boolean }) {
  // Contrato general: no hay minuta que editar, solo su hoja en PDF.
  if (d.clase === "general") return <MinutaSoloPdf id={d.id} />
  if (d.tipo === "mano_obra") return <MinutaManoObraSegunPlantilla detalle={d} puedeEditar={puedeEditar} />
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

// Mano de obra: la plantilla nueva (versión 04, mismo editor que obra) salvo
// las minutas ya enviadas o aprobadas con la anterior (lib/minuta-obra.ts,
// usaPlantillaManoObra04).
function MinutaManoObraSegunPlantilla({ detalle, puedeEditar }: { detalle: SolicitudContratoDetalle; puedeEditar: boolean }) {
  const [plantilla, setPlantilla] = useState<{ id: string; valor: "04" | "anterior" } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelado = false
    plantillaMinutaManoObra(detalle.id)
      .then((valor: "04" | "anterior") => !cancelado && setPlantilla({ id: detalle.id, valor }))
      .catch((e) => !cancelado && setError(e instanceof Error ? e.message : "No se pudo cargar la minuta."))
    return () => {
      cancelado = true
    }
  }, [detalle.id])
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!plantilla || plantilla.id !== detalle.id) return <p className="py-10 text-center text-sm text-muted-foreground">Cargando minuta...</p>
  return plantilla.valor === "04" ? (
    <MinutaObraEditor detalle={detalle} puedeEditar={puedeEditar} />
  ) : (
    <MinutaManoObraEditor detalle={detalle} puedeEditar={puedeEditar} />
  )
}
