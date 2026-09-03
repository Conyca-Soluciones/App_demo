"use client"

/**
 * Revisión de insumos del import de APU -- UNA sola fase (ya no hay paso
 * previo de "APU recomendado", ver decisión de negocio en actions.ts:
 * un APU parecido puede necesitar insumos de marca/especificación
 * distinta según la entidad, así que TODO se arma por matching de
 * insumo individual, sin atajos de copiar un APU completo).
 *
 * El padre (page.tsx) llama matchearInsumosApuImport sobre TODOS los
 * bloques del Excel (no hay filtro de "cuáles ítems" -- todos entran) y
 * pasa el resultado acá cuando esté listo.
 */

import { useMemo, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type { ResolucionInsumo } from "@/lib/apu-import-types"

export type ResolucionFinal = {
  descripcionOriginal: string
  accion: "maestro" | "solicitud"
  insumoIdAsignado: string | null
}

interface Props {
  open: boolean
  resolucionesInsumos: ResolucionInsumo[] | null // null mientras carga o no ha empezado
  cargandoResoluciones: boolean
  errorResoluciones: string | null
  onReintentar: () => void
  onConfirmar: (resolucionesFinales: ResolucionFinal[]) => void
  onCancelar: () => void
}

type EleccionInsumo = { tipo: "maestro"; insumoId: string } | { tipo: "solicitud" } | null

export function RevisionImportApuDialog({
  open,
  resolucionesInsumos,
  cargandoResoluciones,
  errorResoluciones,
  onReintentar,
  onConfirmar,
  onCancelar,
}: Props) {
  const [eleccionesInsumo, setEleccionesInsumo] = useState<Record<string, EleccionInsumo>>({})
  // El usuario confirmó que quiere cerrar (segundo click) -- ver
  // handleIntentoCerrar. Sin esto, un click afuera del diálogo o el Esc
  // cerraban de una y se perdía toda la revisión ya hecha.
  const [pidiendoConfirmacionCierre, setPidiendoConfirmacionCierre] = useState(false)

  const pendientesInsumo = useMemo(
    () => (resolucionesInsumos ?? []).filter((r) => r.estado === "requiere_revision"),
    [resolucionesInsumos]
  )
  const autoMatchInsumo = useMemo(
    () => (resolucionesInsumos ?? []).filter((r) => r.estado === "auto_match"),
    [resolucionesInsumos]
  )

  const elegirCandidatoInsumo = (descripcion: string, insumoId: string) => {
    setEleccionesInsumo((prev) => ({ ...prev, [descripcion]: { tipo: "maestro", insumoId } }))
  }
  const marcarInsumoComoSolicitud = (descripcion: string) => {
    setEleccionesInsumo((prev) => ({ ...prev, [descripcion]: { tipo: "solicitud" } }))
  }
  const faltanInsumos = pendientesInsumo.filter((r) => !eleccionesInsumo[r.descripcionOriginal]).length

  // ---------- selección múltiple para aplicar en lote ----------
  const [seleccionadosInsumo, setSeleccionadosInsumo] = useState<Set<string>>(new Set())

  const toggleSeleccionadoInsumo = (descripcion: string) => {
    setSeleccionadosInsumo((prev) => {
      const copia = new Set(prev)
      if (copia.has(descripcion)) copia.delete(descripcion)
      else copia.add(descripcion)
      return copia
    })
  }

  const todosInsumosSeleccionados =
    pendientesInsumo.length > 0 && seleccionadosInsumo.size === pendientesInsumo.length
  const toggleSeleccionarTodosInsumos = () => {
    setSeleccionadosInsumo(
      todosInsumosSeleccionados ? new Set() : new Set(pendientesInsumo.map((r) => r.descripcionOriginal))
    )
  }

  const aplicarEnLoteInsumo = (accion: "mejor_candidato" | "solicitud") => {
    setEleccionesInsumo((prev) => {
      const nuevo = { ...prev }
      for (const descripcion of seleccionadosInsumo) {
        if (accion === "mejor_candidato") {
          const r = pendientesInsumo.find((r) => r.descripcionOriginal === descripcion)
          if (r && r.candidatosSugeridos.length > 0) {
            nuevo[descripcion] = { tipo: "maestro", insumoId: r.candidatosSugeridos[0].id }
          }
          continue
        }
        nuevo[descripcion] = { tipo: "solicitud" }
      }
      return nuevo
    })
  }

  const handleConfirmarFinal = () => {
    if (cargandoResoluciones || errorResoluciones || resolucionesInsumos === null) return

    const resolucionesFinales: ResolucionFinal[] = resolucionesInsumos.map((r) => {
      if (r.estado === "auto_match") {
        return { descripcionOriginal: r.descripcionOriginal, accion: "maestro", insumoIdAsignado: r.insumoIdAsignado }
      }
      const eleccion = eleccionesInsumo[r.descripcionOriginal]
      if (eleccion?.tipo === "maestro") {
        return { descripcionOriginal: r.descripcionOriginal, accion: "maestro", insumoIdAsignado: eleccion.insumoId }
      }
      return { descripcionOriginal: r.descripcionOriginal, accion: "solicitud", insumoIdAsignado: null }
    })
    onConfirmar(resolucionesFinales)
  }

  // Cerrar (click afuera, Esc, botón X) pide confirmación si ya hay
  // trabajo hecho -- antes se perdía todo con un click accidental.
  const hayTrabajoHecho = Object.keys(eleccionesInsumo).length > 0
  const handleIntentoCerrar = (siguienteEstado: boolean) => {
    if (siguienteEstado) return // se está abriendo, no hay nada que confirmar
    if (!hayTrabajoHecho) {
      onCancelar()
      return
    }
    setPidiendoConfirmacionCierre(true)
  }

  return (
    <Dialog open={open} onOpenChange={handleIntentoCerrar}>
      <DialogContent
        className="max-w-6xl w-[95vw] max-h-[92vh] overflow-y-auto"
        style={{ maxWidth: "1200px", width: "95vw" }}
      >
        {pidiendoConfirmacionCierre ? (
          <div className="space-y-4 p-2">
            <DialogHeader>
              <DialogTitle>¿Cerrar sin guardar?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Ya elegiste candidatos para {Object.keys(eleccionesInsumo).length} insumo(s). Si
              cierras ahora, se pierde esa revisión y hay que volver a subir el Excel.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPidiendoConfirmacionCierre(false)}>
                Seguir revisando
              </Button>
              <Button variant="destructive" onClick={onCancelar}>
                Cerrar y perder los cambios
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Revisión de insumos del import</DialogTitle>
            </DialogHeader>

            {cargandoResoluciones && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground border rounded-lg p-4">
                <span className="animate-spin inline-block h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
                Buscando insumos parecidos en el maestro… con presupuestos grandes esto puede
                tardar varios segundos, no cierres esta ventana.
              </div>
            )}

            {!cargandoResoluciones && errorResoluciones && (
              <div className="space-y-2 border rounded-lg p-4 border-destructive/50">
                <p className="text-sm text-destructive">
                  No se pudo completar el matching de insumos: {errorResoluciones}
                </p>
                <Button size="sm" variant="outline" onClick={onReintentar}>
                  Reintentar
                </Button>
              </div>
            )}

            {!cargandoResoluciones && !errorResoluciones && resolucionesInsumos && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {autoMatchInsumo.length} insumos matchearon automáticamente (score ≥ 80).{" "}
                  {pendientesInsumo.length} necesitan tu confirmación.
                </p>

                {pendientesInsumo.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 border rounded-lg p-2 bg-muted/30">
                    <label className="flex items-center gap-1.5 text-sm mr-2">
                      <input
                        type="checkbox"
                        checked={todosInsumosSeleccionados}
                        onChange={toggleSeleccionarTodosInsumos}
                      />
                      Seleccionar todos ({seleccionadosInsumo.size}/{pendientesInsumo.length})
                    </label>
                    <span className="text-xs text-muted-foreground">Aplicar a los seleccionados:</span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={seleccionadosInsumo.size === 0}
                      onClick={() => aplicarEnLoteInsumo("mejor_candidato")}
                    >
                      Usar mejor candidato
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={seleccionadosInsumo.size === 0}
                      onClick={() => aplicarEnLoteInsumo("solicitud")}
                    >
                      Crear solicitud
                    </Button>
                  </div>
                )}

                {pendientesInsumo.map((r) => {
                  const eleccion = eleccionesInsumo[r.descripcionOriginal]
                  return (
                    <div key={r.descripcionOriginal} className="border rounded-lg p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={seleccionadosInsumo.has(r.descripcionOriginal)}
                          onChange={() => toggleSeleccionadoInsumo(r.descripcionOriginal)}
                        />
                        <span className="font-medium">{r.descripcionOriginal}</span>
                      </div>
                      {r.precioPlaceholder && (
                        <p className="text-sm text-amber-600">
                          ⚠ El candidato sugerido tiene un precio placeholder en el maestro —
                          verifica el precio real antes de asignarlo.
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {r.candidatosSugeridos.map((c) => {
                          const seleccionado = eleccion?.tipo === "maestro" && eleccion.insumoId === c.id
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => elegirCandidatoInsumo(r.descripcionOriginal, c.id)}
                              className={`text-sm px-2 py-1 rounded border ${seleccionado ? "border-primary bg-primary/10" : "border-muted"}`}
                            >
                              {c.descripcion} · {c.u_m} · ${(c.vr_unitario ?? 0).toLocaleString()} ·{" "}
                              <span className="text-muted-foreground">{Math.round(c.similitud * 100)}%</span>
                            </button>
                          )
                        })}
                      </div>
                      <button
                        type="button"
                        onClick={() => marcarInsumoComoSolicitud(r.descripcionOriginal)}
                        className={`text-sm px-2 py-1 rounded border ${eleccion?.tipo === "solicitud" ? "border-primary bg-primary/10" : "border-muted"}`}
                      >
                        No existe — crear solicitud de aprobación
                      </button>
                    </div>
                  )
                })}

                {pendientesInsumo.length === 0 && (
                  <p className="text-sm text-muted-foreground">Todo matcheó automáticamente.</p>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => handleIntentoCerrar(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleConfirmarFinal}
                disabled={cargandoResoluciones || !!errorResoluciones || resolucionesInsumos === null || faltanInsumos > 0}
              >
                {cargandoResoluciones
                  ? "Cargando…"
                  : errorResoluciones
                    ? "Corrige el error de arriba"
                    : faltanInsumos > 0
                      ? `Faltan ${faltanInsumos} insumos por resolver`
                      : "Confirmar y guardar en base de datos"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}