"use client"

import { useEffect, useState } from "react"
import { Download, Loader2, Plus, RotateCcw, Save, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  CampoMinuta,
  ChipOrigen,
  LeyendaOrigen,
  PanelVistaPrevia,
  Seccion,
  SelectorMinuta,
  claseArea,
  claseCampo,
  descargarPdfMinuta,
  focoDeEvento,
  useVistaPreviaMinuta,
} from "@/components/minuta-comun"
import { fechaContrato } from "@/components/detalle-solicitud-contrato"
import { TIPOS_DOCUMENTO_ARRENDADOR } from "@/lib/minuta-arrendamiento"
import { ordinalClausula, type OrigenDato } from "@/lib/minuta-mano-obra"
import { MAXIMO_MODIFICACIONES_OTROSI, nombreArchivoOtrosi, origenCampoOtrosi, type MinutaOtrosi, type OtrosiDetalle } from "@/lib/otrosi"
import { guardarDocumentoOtrosi, obtenerDocumentoOtrosi, type DocumentoOtrosi } from "@/app/(app)/contratos/otrosi/actions"

// ---------------------------------------------------------------------------
// Documento del otrosí (segunda pestaña de Aprobación de otrosí): Jurídica
// edita los datos de la plantilla y la redacción de cada cláusula, con la
// vista previa del PDF al lado (mismas piezas que las minutas,
// components/minuta-comun.tsx). Subgerencia lo ve igual, en solo lectura. El
// texto fijo está en components/otrosi-pdf.tsx.
// ---------------------------------------------------------------------------

type CampoTexto = { [K in keyof MinutaOtrosi]: MinutaOtrosi[K] extends string ? K : never }[keyof MinutaOtrosi]

export const rutaPdfOtrosi = (id: string) => `/contratos/otrosi-pdf/${id}`
export const otrosiEditable = (o: { estado: OtrosiDetalle["estado"] }) => o.estado === "por_revisar" || o.estado === "devuelta_subgerencia"

export function OtrosiEditor({ detalle, puedeEditar }: { detalle: OtrosiDetalle; puedeEditar: boolean }) {
  const [datos, setDatos] = useState<DocumentoOtrosi | null>(null)
  const [m, setM] = useState<MinutaOtrosi | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cambios, setCambios] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const [descargando, setDescargando] = useState(false)
  const [foco, setFoco] = useState<string | null>(null)
  const ruta = rutaPdfOtrosi(detalle.id)
  const vistaPrevia = useVistaPreviaMinuta(detalle.id, m, foco, ruta)

  const editable = puedeEditar && otrosiEditable(detalle)
  const deshabilitado = !editable || guardando

  useEffect(() => {
    let cancelado = false
    obtenerDocumentoOtrosi(detalle.id)
      .then((d: DocumentoOtrosi) => {
        if (cancelado) return
        setDatos(d)
        setM(d.minuta)
      })
      .catch((e) => !cancelado && setError(e instanceof Error ? e.message : "No se pudo cargar el otrosí."))
    return () => {
      cancelado = true
    }
  }, [detalle.id])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!m || !datos) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Cargando otrosí...
      </div>
    )
  }

  function actualizar(cambio: Partial<MinutaOtrosi>) {
    setM((prev) => (prev ? { ...prev, ...cambio } : prev))
    setCambios(true)
    setAviso(null)
  }

  function campo(clave: CampoTexto, etiqueta: string, opciones?: { placeholder?: string; tipo?: string; ayuda?: string; ancho?: boolean }) {
    return (
      <CampoMinuta
        id={`minuta-${clave}`}
        etiqueta={etiqueta}
        valor={m![clave] as string}
        origen={origenCampoOtrosi(clave, m![clave] as string, datos!.porDefecto)}
        onChange={(v) => actualizar({ [clave]: v } as Partial<MinutaOtrosi>)}
        disabled={deshabilitado}
        {...opciones}
      />
    )
  }

  // Cada cláusula: lo que pidió el ingeniero (solicitud) o editado.
  const pedidas = new Set(datos.porDefecto.modificaciones.map((x) => `${x.clausula.trim()}\u0000${x.redaccion.trim()}`))
  const origenModificacion = (x: { clausula: string; redaccion: string }): OrigenDato =>
    !x.clausula.trim() || !x.redaccion.trim() ? "vacio" : pedidas.has(`${x.clausula.trim()}\u0000${x.redaccion.trim()}`) ? "solicitud" : "editado"

  function cambiarModificacion(i: number, cambio: Partial<{ clausula: string; redaccion: string }>) {
    actualizar({ modificaciones: m!.modificaciones.map((x, j) => (j === i ? { ...x, ...cambio } : x)) })
  }

  async function guardar() {
    if (!m) return
    setGuardando(true)
    setAviso(null)
    try {
      const r = await guardarDocumentoOtrosi(detalle.id, m)
      setDatos((d) => (d ? { ...d, guardadaAt: r.guardadaAt, guardadaPorNombre: null } : d))
      setCambios(false)
      setAviso({ ok: true, texto: "Otrosí guardado." })
    } catch (e) {
      setAviso({ ok: false, texto: e instanceof Error ? e.message : "No se pudo guardar el otrosí." })
    } finally {
      setGuardando(false)
    }
  }

  async function descargar() {
    if (!m) return
    setDescargando(true)
    try {
      await descargarPdfMinuta(detalle.id, m, nombreArchivoOtrosi(detalle.numeroContrato, datos!.numero), ruta)
    } catch (e) {
      setAviso({ ok: false, texto: e instanceof Error ? e.message : "No se pudo generar el PDF." })
    } finally {
      setDescargando(false)
    }
  }

  function restablecer() {
    if (!datos) return
    if (!confirm("¿Volver a llenar el otrosí con los datos del contrato y de la solicitud? Se pierde lo que se haya editado (hasta que guardes, lo guardado no cambia).")) return
    setM(datos.porDefecto)
    setCambios(true)
    setAviso(null)
  }

  const juridica = m.contratistaTipoPersona === "juridica"
  const origenTipoDocumento: OrigenDato = m.contratistaTipoDocumento === datos.porDefecto.contratistaTipoDocumento ? "solicitud" : "editado"

  return (
    <div
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      onFocus={(e) => {
        const f = focoDeEvento(e)
        if (f) setFoco(f)
      }}
    >
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3">
          <div className="min-w-0 flex-1 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">
              Plantilla OTROSÍ versión 04 · Otrosí N° {datos.numero}
              {detalle.numero === null && " (provisional: el número queda al aprobarlo)"}
            </p>
            {datos.guardadaAt ? (
              <p>
                Guardado el {fechaContrato(datos.guardadaAt)}
                {datos.guardadaPorNombre && ` por ${datos.guardadaPorNombre}`}
                {cambios && " · hay cambios sin guardar"}
              </p>
            ) : (
              <p>{cambios ? "Cambios sin guardar." : "Llenado con los datos del contrato y de la solicitud; todavía no se ha guardado."}</p>
            )}
            {!editable && <p>Solo lectura.</p>}
          </div>
          {editable && (
            <Button type="button" size="sm" variant="ghost" onClick={restablecer} disabled={guardando}>
              <RotateCcw className="size-4" /> Restablecer
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={descargar} disabled={descargando}>
            {descargando ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Descargar PDF
          </Button>
          {editable && (
            <Button type="button" size="sm" onClick={guardar} disabled={guardando || !cambios}>
              {guardando ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Guardar
            </Button>
          )}
        </div>
        {aviso && <p className={`text-sm ${aviso.ok ? "text-emerald-700" : "text-destructive"}`}>{aviso.texto}</p>}
        <LeyendaOrigen />

        <Seccion titulo="Contrato" ayuda="El número sale del contrato aprobado.">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">Contrato No.</span>
                <ChipOrigen origen="solicitud" />
              </div>
              <p className={`${claseCampo} flex items-center bg-muted/40`}>{detalle.numeroContrato}</p>
            </div>
            {campo("nombreContrato", "Nombre del contrato (segunda cláusula)", { placeholder: "contrato de mano de obra" })}
          </div>
        </Seccion>

        <Seccion titulo="Contratante" ayuda="La empresa del proyecto.">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("contratanteNombre", "Razón social")}
            {campo("contratanteNit", "NIT")}
            {campo("contratanteRepresentante", "Representante legal")}
            {campo("contratanteRepresentanteCedula", "Cédula del representante")}
            {campo("contratanteRepresentanteExpedida", "Cédula expedida en")}
          </div>
        </Seccion>

        <Seccion titulo="Contratista">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1 sm:col-span-2">
              <label htmlFor="minuta-contratista-tipo" className="text-xs font-medium text-muted-foreground">
                Tipo de persona
              </label>
              <select
                id="minuta-contratista-tipo"
                value={m.contratistaTipoPersona}
                onChange={(e) => actualizar({ contratistaTipoPersona: e.target.value as "natural" | "juridica" })}
                disabled={deshabilitado}
                className={claseCampo}
              >
                <option value="natural">Persona natural</option>
                <option value="juridica">Persona jurídica (firma su representante legal)</option>
              </select>
            </div>
            {campo("contratistaNombre", juridica ? "Razón social" : "Nombre completo")}
            {juridica && campo("contratistaNit", "NIT")}
            {juridica && campo("contratistaRepresentante", "Representante legal")}
            <SelectorMinuta
              id="minuta-contratista-tipo-documento"
              etiqueta={juridica ? "Documento del representante" : "Tipo de documento"}
              valor={m.contratistaTipoDocumento}
              opciones={TIPOS_DOCUMENTO_ARRENDADOR}
              origen={origenTipoDocumento}
              onChange={(v) => v && actualizar({ contratistaTipoDocumento: v })}
              disabled={deshabilitado}
            />
            {campo("contratistaCedula", juridica ? "Número de documento del representante" : "Número de documento")}
            {campo("contratistaCiudad", "Domiciliado y residente en (ciudad)")}
          </div>
        </Seccion>

        <Seccion titulo="Cláusulas que se modifican" ayuda="Cada una sale como «Modificar la cláusula …, la cual quedará así:» y la redacción nueva.">
          <div className="space-y-3">
            {m.modificaciones.map((x, i) => (
              <div key={i} data-foco={`modificaciones:${i}`} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase">{ordinalClausula(i + 1)}</span>
                  <div className="flex items-center gap-2">
                    <ChipOrigen origen={origenModificacion(x)} />
                    {editable && (
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Quitar la cláusula ${i + 1}`}
                        onClick={() => actualizar({ modificaciones: m.modificaciones.filter((_, j) => j !== i) })}
                        disabled={guardando}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
                <input
                  aria-label={`Cláusula que se modifica ${i + 1}`}
                  value={x.clausula}
                  placeholder="TERCERA. PLAZO"
                  onChange={(e) => cambiarModificacion(i, { clausula: e.target.value })}
                  disabled={deshabilitado}
                  className={claseCampo}
                />
                <textarea
                  aria-label={`Cómo queda la cláusula ${i + 1}`}
                  rows={5}
                  value={x.redaccion}
                  placeholder="Redacción completa de la cláusula nueva"
                  onChange={(e) => cambiarModificacion(i, { redaccion: e.target.value })}
                  disabled={deshabilitado}
                  className={claseArea}
                />
              </div>
            ))}
            {editable && m.modificaciones.length < MAXIMO_MODIFICACIONES_OTROSI && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => actualizar({ modificaciones: [...m.modificaciones, { clausula: "", redaccion: "" }] })}
                disabled={guardando}
              >
                <Plus className="size-4" /> Agregar cláusula
              </Button>
            )}
          </div>
        </Seccion>

        <Seccion titulo="Lugar y fecha de firma">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("ciudadFirma", "Ciudad")}
            {campo("fechaFirma", "Fecha", { tipo: "date" })}
          </div>
        </Seccion>
      </div>

      <PanelVistaPrevia {...vistaPrevia} />
    </div>
  )
}
