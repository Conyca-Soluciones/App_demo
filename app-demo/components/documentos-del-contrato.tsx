"use client"

import { useEffect, useState } from "react"
import { Eye, FileText, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { VisorDocumento } from "@/components/visor-documento"
import { BadgePolizaContrato } from "@/components/badge-poliza"
import { OtrosisDelContrato } from "@/components/otrosis-del-contrato"
import { DatosPoliza } from "@/components/polizas-view"
import { formatearFechaSinHora } from "@/lib/fechas"
import { CLASE_ESTADO_POLIZA, ETIQUETA_ESTADO_POLIZA, type EstadoPolizaContrato, type Poliza } from "@/lib/polizas"
import type { FirmadosContrato } from "@/lib/contratos-firmados"
import { firmadosDeContrato, puedeSubirFirmados } from "@/app/(app)/contratos/firmados/actions"
import { BotonSubirFirmado, BotonVerFirmado } from "@/components/copia-firmada"
import { enlacePoliza, polizasDeContrato } from "@/app/(app)/contratos/polizas/actions"

// ---------------------------------------------------------------------------
// Lo asociado a un contrato aprobado, en su detalle (20270101001900): la copia
// firmada por el contratista (se descarga al lado del encabezado; se sube con los permisos de pólizas), la póliza con sus
// datos y los otrosí (con su copia firmada). Las actas siguen en su módulo.
// ---------------------------------------------------------------------------

const mensaje = (e: unknown, otro: string) => (e instanceof Error ? e.message : otro)

// Firmados del contrato + si quien mira puede subir (cargados una vez).
export function useFirmados(contratoId: string | null) {
  const [carga, setCarga] = useState<{ id: string; firmados: FirmadosContrato } | null>(null)
  const [puedeSubir, setPuedeSubir] = useState(false)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!contratoId) return
    let activo = true
    firmadosDeContrato(contratoId)
      .then((f: FirmadosContrato) => activo && setCarga({ id: contratoId, firmados: f }))
      .catch(() => {}) // sin la copia, el detalle sigue igual
    return () => {
      activo = false
    }
  }, [contratoId, version])
  useEffect(() => {
    let activo = true
    puedeSubirFirmados()
      .then((v: boolean) => activo && setPuedeSubir(v))
      .catch(() => {})
    return () => {
      activo = false
    }
  }, [])
  return {
    firmados: carga && carga.id === contratoId ? carga.firmados : null,
    puedeSubir,
    recargar: () => setVersion((v) => v + 1),
  }
}

// Lo del encabezado del detalle: ver la copia firmada o adjuntarla.
export function CopiaFirmadaContrato({
  contratoId,
  firmados,
  puedeSubir,
  onCambio,
}: {
  contratoId: string
  firmados: FirmadosContrato | null
  puedeSubir: boolean
  onCambio: () => void
}) {
  if (!firmados) return null
  const archivo = firmados.contrato
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {archivo ? (
        <BotonVerFirmado contratoId={contratoId} archivo={archivo} titulo="Contrato firmado por el contratista" />
      ) : (
        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
          Falta la copia firmada por el contratista
        </Badge>
      )}
      {puedeSubir && <BotonSubirFirmado contratoId={contratoId} hay={Boolean(archivo)} onSubido={onCambio} />}
    </span>
  )
}

// Sección completa del detalle: copia firmada, póliza y otrosí.
export function DocumentosAsociados({
  contratoId,
  polizaEstado,
  firmados,
  puedeSubir,
  onCambio,
}: {
  contratoId: string
  polizaEstado: EstadoPolizaContrato | null | undefined
  firmados: FirmadosContrato | null
  puedeSubir: boolean
  onCambio: () => void
}) {
  return (
    <div className="space-y-4 rounded-md border p-3">
      <h3 className="text-sm font-semibold">Documentos asociados al contrato</h3>

      <div className="space-y-2">
        <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground uppercase">
          Contrato firmado por el contratista
        </p>
        <CopiaFirmadaContrato contratoId={contratoId} firmados={firmados} puedeSubir={puedeSubir} onCambio={onCambio} />
        {firmados && !firmados.contrato && (
          <p className="text-xs text-muted-foreground">Sin la copia firmada no se pueden hacer actas del contrato.</p>
        )}
      </div>

      <div className="space-y-2">
        <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground uppercase">
          Póliza {polizaEstado && <BadgePolizaContrato estado={polizaEstado} />}
        </p>
        {polizaEstado === "no_aplica" ? (
          <p className="text-sm text-muted-foreground">Este contrato no requiere póliza.</p>
        ) : (
          <PolizasDelContrato contratoId={contratoId} />
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase">Otrosí</p>
        <OtrosisDelContrato contratoId={contratoId} firmados={firmados?.otrosis ?? {}} puedeSubirFirmado={puedeSubir} onFirmado={onCambio} />
      </div>
    </div>
  )
}

function PolizasDelContrato({ contratoId }: { contratoId: string }) {
  const [carga, setCarga] = useState<{ id: string; polizas: Poliza[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viendo, setViendo] = useState<Poliza | null>(null)
  const [datos, setDatos] = useState<Poliza | null>(null)
  useEffect(() => {
    let activo = true
    polizasDeContrato(contratoId)
      .then((d) => activo && setCarga({ id: contratoId, polizas: d.polizas }))
      .catch((e) => activo && setError(mensaje(e, "No se pudieron cargar las pólizas.")))
    return () => {
      activo = false
    }
  }, [contratoId])
  if (error) return <p className="text-sm text-destructive">{error}</p>
  const polizas = carga && carga.id === contratoId ? carga.polizas : null
  if (!polizas)
    return (
      <p className="flex items-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Cargando pólizas...
      </p>
    )
  if (polizas.length === 0) return <p className="text-sm text-muted-foreground">Todavía no se ha subido la póliza.</p>
  return (
    <>
      <ul className="divide-y rounded-md border">
        {polizas.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate" title={p.nombreArchivo}>
              {p.nombreArchivo}
              <span className="block text-xs text-muted-foreground">
                Subida el {formatearFechaSinHora(p.createdAt)}
                {p.resueltaAt && ` · revisada el ${formatearFechaSinHora(p.resueltaAt)}`}
              </span>
            </span>
            <Badge variant="outline" className={`min-h-6 px-3 text-xs ${CLASE_ESTADO_POLIZA[p.estado]}`}>
              {ETIQUETA_ESTADO_POLIZA[p.estado]}
            </Badge>
            <Button size="xs" variant="outline" onClick={() => setViendo(p)}>
              <Eye className="size-3.5" /> Ver
            </Button>
            {p.estado === "aprobada" && (
              <Button size="xs" variant="outline" onClick={() => setDatos(p)}>
                <FileText className="size-3.5" /> Datos
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Dialog open={viendo !== null} onOpenChange={(a) => !a && setViendo(null)}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] sm:max-w-[min(1200px,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>Póliza</DialogTitle>
          </DialogHeader>
          {viendo && (
            <VisorDocumento
              titulo="Póliza"
              nombreArchivo={viendo.nombreArchivo}
              mime={viendo.mime}
              cargarUrl={() => enlacePoliza(viendo.id)}
              onVolver={() => setViendo(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={datos !== null} onOpenChange={(a) => !a && setDatos(null)}>
        <DialogContent className="flex max-h-[92svh] flex-col gap-3 overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Datos de la póliza</DialogTitle>
          </DialogHeader>
          {datos && <DatosPoliza polizaId={datos.id} />}
        </DialogContent>
      </Dialog>
    </>
  )
}

