import { Badge } from "@/components/ui/badge"
import { CLASE_POLIZA_CONTRATO, ETIQUETA_POLIZA_CONTRATO, type EstadoPolizaContrato } from "@/lib/polizas"

// Estado de la póliza de un contrato aprobado (20261126000000_polizas.sql).
export function BadgePolizaContrato({ estado }: { estado: EstadoPolizaContrato | null | undefined }) {
  if (!estado) return null
  return (
    <Badge variant="outline" className={`h-6 px-3 text-xs ${CLASE_POLIZA_CONTRATO[estado]}`}>
      {ETIQUETA_POLIZA_CONTRATO[estado]}
    </Badge>
  )
}
