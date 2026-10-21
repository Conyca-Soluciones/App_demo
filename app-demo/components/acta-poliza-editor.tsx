"use client"

import { useState } from "react"
import { Download, Eye, Loader2, PencilLine, Plus, RotateCcw, Save, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  CampoMinuta,
  ChipOrigen,
  LeyendaOrigen,
  PanelVistaPrevia,
  Seccion,
  claseCampo,
  descargarPdfMinuta,
  useVistaPreviaMinuta,
} from "@/components/minuta-comun"
import { fechaContrato } from "@/components/detalle-solicitud-contrato"
import type { OrigenDato } from "@/lib/minuta-mano-obra"
import { nombreArchivoActaPoliza, origenCampoActaPoliza, type ActaPoliza, type AmparoActaPoliza } from "@/lib/acta-poliza"
import { guardarActaPoliza, type DocumentoActaPoliza } from "@/app/(app)/contratos/polizas/actions"

// ---------------------------------------------------------------------------
// Acta de aprobación de la póliza (plantilla GJ-F-013): datos prellenados del
// contrato y editables, con la vista previa del PDF y la descarga. El estado
// del acta vive en quien lo usa (Aprobación de pólizas), porque "Aprobar"
// manda el acta de pantalla.
// ---------------------------------------------------------------------------

type CampoTexto = { [K in keyof ActaPoliza]: ActaPoliza[K] extends string ? K : never }[keyof ActaPoliza]

export const rutaPdfActaPoliza = (id: string) => `/contratos/poliza-acta/${id}`

export function ActaPolizaEditor({
  polizaId,
  documento,
  acta,
  cambios,
  editable,
  onChange,
  onGuardada,
}: {
  polizaId: string
  documento: DocumentoActaPoliza
  acta: ActaPoliza
  cambios: boolean
  editable: boolean
  onChange: (acta: ActaPoliza) => void
  onGuardada: (guardadaAt: string) => void
}) {
  const [modo, setModo] = useState<"editar" | "pdf">(editable ? "editar" : "pdf")
  const [guardando, setGuardando] = useState(false)
  const [descargando, setDescargando] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const ruta = rutaPdfActaPoliza(polizaId)
  const deshabilitado = !editable || guardando
  const defecto = documento.porDefecto

  function actualizar(cambio: Partial<ActaPoliza>) {
    onChange({ ...acta, ...cambio })
    setAviso(null)
  }

  function campo(clave: CampoTexto, etiqueta: string, opciones?: { tipo?: string; placeholder?: string; filas?: number; ancho?: boolean; ayuda?: string }) {
    return (
      <CampoMinuta
        id={`acta-${clave}`}
        foco={clave}
        etiqueta={etiqueta}
        valor={acta[clave] as string}
        origen={origenCampoActaPoliza(clave, acta[clave] as string, defecto)}
        onChange={(v) => actualizar({ [clave]: v } as Partial<ActaPoliza>)}
        disabled={deshabilitado}
        {...opciones}
      />
    )
  }

  // Amparos: los de la minuta del contrato (Solicitud), editados o vacíos.
  const deLaMinuta = new Set(defecto.amparos.map((x) => `${x.amparo}\u0000${x.valor}\u0000${x.vigencia}`))
  const origenAmparo = (x: AmparoActaPoliza): OrigenDato =>
    !x.amparo.trim() ? "vacio" : deLaMinuta.has(`${x.amparo}\u0000${x.valor}\u0000${x.vigencia}`) ? "solicitud" : "editado"
  const cambiarAmparo = (i: number, cambio: Partial<AmparoActaPoliza>) =>
    actualizar({ amparos: acta.amparos.map((x, j) => (j === i ? { ...x, ...cambio } : x)) })

  async function guardar() {
    setGuardando(true)
    setAviso(null)
    try {
      const r = await guardarActaPoliza(polizaId, acta)
      onGuardada(r.guardadaAt)
      setAviso({ ok: true, texto: "Acta guardada." })
    } catch (e) {
      setAviso({ ok: false, texto: e instanceof Error ? e.message : "No se pudo guardar el acta." })
    } finally {
      setGuardando(false)
    }
  }

  async function descargar() {
    setDescargando(true)
    try {
      await descargarPdfMinuta(polizaId, acta, nombreArchivoActaPoliza(acta.numeroContrato), ruta)
    } catch (e) {
      setAviso({ ok: false, texto: e instanceof Error ? e.message : "No se pudo generar el PDF." })
    } finally {
      setDescargando(false)
    }
  }

  function restablecer() {
    if (!confirm("¿Volver a llenar el acta con los datos del contrato? Se pierde lo que se haya editado (lo guardado no cambia hasta que guardes).")) return
    onChange(defecto)
    setAviso(null)
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2">
        <div className="flex gap-1" role="tablist">
          <Button size="sm" role="tab" aria-selected={modo === "editar"} variant={modo === "editar" ? "default" : "outline"} onClick={() => setModo("editar")}>
            <PencilLine className="size-4" /> {editable ? "Llenar" : "Datos"}
          </Button>
          <Button size="sm" role="tab" aria-selected={modo === "pdf"} variant={modo === "pdf" ? "default" : "outline"} onClick={() => setModo("pdf")}>
            <Eye className="size-4" /> Vista previa
          </Button>
        </div>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          GJ-F-013 v03 ·{" "}
          {documento.guardadaAt
            ? `guardada el ${fechaContrato(documento.guardadaAt)}${documento.guardadaPorNombre ? ` por ${documento.guardadaPorNombre}` : ""}`
            : "sin guardar"}
          {cambios && " · cambios sin guardar"}
          {!editable && " · solo lectura"}
        </span>
        {editable && (
          <Button type="button" size="sm" variant="ghost" onClick={restablecer} disabled={guardando}>
            <RotateCcw className="size-4" /> Restablecer
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" onClick={descargar} disabled={descargando}>
          {descargando ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} PDF
        </Button>
        {editable && (
          <Button type="button" size="sm" onClick={guardar} disabled={guardando || !cambios}>
            {guardando ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Guardar
          </Button>
        )}
      </div>
      {aviso && <p className={`text-sm ${aviso.ok ? "text-emerald-700" : "text-destructive"}`}>{aviso.texto}</p>}

      {modo === "pdf" ? (
        <VistaPreviaActa polizaId={polizaId} acta={acta} ruta={ruta} />
      ) : (
        <div className="min-h-0 space-y-3 overflow-auto">
          <LeyendaOrigen />
          <Seccion titulo="Encabezado" ayuda="El número sale del contrato; el supervisor y el correo, del director que pidió el contrato.">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Contrato No.</span>
                  <ChipOrigen origen="solicitud" />
                </div>
                <p className={`${claseCampo} flex items-center bg-muted/40`}>{acta.numeroContrato}</p>
              </div>
              {campo("supervisorNombre", "PARA (supervisor del contrato)")}
              {campo("correo", "Correo", { tipo: "email" })}
              {campo("objeto", "Objeto", { filas: 3 })}
            </div>
          </Seccion>
          <Seccion titulo="Póliza">
            <div className="grid gap-3 sm:grid-cols-2">
              {campo("empresaNombre", "Suscrito entre (empresa)")}
              {campo("contratistaNombre", "y (contratista)")}
              {campo("aseguradora", "Expedida por (aseguradora)", { ancho: true, placeholder: "Nombre de la aseguradora" })}
            </div>
          </Seccion>
          <Seccion titulo="Amparos de la póliza" ayuda="Salen de la garantía de la minuta (valor = % × valor vigente del contrato); ajústalos a lo que dice la póliza.">
            <div className="space-y-2">
              {acta.amparos.map((x, i) => (
                <div key={i} data-foco={`amparos:${i}`} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]">
                  <input
                    aria-label={`Amparo ${i + 1}`}
                    value={x.amparo}
                    placeholder="Amparo"
                    onChange={(e) => cambiarAmparo(i, { amparo: e.target.value })}
                    disabled={deshabilitado}
                    className={claseCampo}
                  />
                  <input
                    aria-label={`Valor asegurado ${i + 1}`}
                    value={x.valor}
                    placeholder="Valor asegurado"
                    onChange={(e) => cambiarAmparo(i, { valor: e.target.value })}
                    disabled={deshabilitado}
                    className={claseCampo}
                  />
                  <input
                    aria-label={`Vigencia ${i + 1}`}
                    value={x.vigencia}
                    placeholder="Vigencia (desde – hasta)"
                    onChange={(e) => cambiarAmparo(i, { vigencia: e.target.value })}
                    disabled={deshabilitado}
                    className={claseCampo}
                  />
                  <div className="flex items-center gap-1">
                    <ChipOrigen origen={origenAmparo(x)} />
                    {editable && (
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Quitar amparo ${i + 1}`}
                        disabled={guardando}
                        onClick={() => actualizar({ amparos: acta.amparos.filter((_, j) => j !== i) })}
                      >
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {editable && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={guardando}
                  onClick={() => actualizar({ amparos: [...acta.amparos, { amparo: "", valor: "", vigencia: "" }] })}
                >
                  <Plus className="size-4" /> Agregar amparo
                </Button>
              )}
            </div>
          </Seccion>
          <Seccion titulo="Certificado de pago y aprobación">
            <div className="grid gap-3 sm:grid-cols-2">
              {campo("soportePago", "Certificado de pago de la póliza", { filas: 2, placeholder: "Recibo / referencia, fecha y valor pagado" })}
              {campo("fechaAprobacion", "Fecha de aprobación", { tipo: "date" })}
              {campo("asesorNombre", "Asesor jurídico que firma")}
              {campo("asesorCargo", "Cargo")}
            </div>
          </Seccion>
        </div>
      )}
    </div>
  )
}

function VistaPreviaActa({ polizaId, acta, ruta }: { polizaId: string; acta: ActaPoliza; ruta: string }) {
  const vista = useVistaPreviaMinuta(polizaId, acta, null, ruta)
  return <PanelVistaPrevia {...vista} />
}
