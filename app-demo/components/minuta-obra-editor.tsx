"use client"

import { useEffect, useState } from "react"
import { Download, Loader2, RotateCcw, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  CampoMinuta,
  ChipOrigen,
  ClausulasAdicionalesEditor,
  LeyendaOrigen,
  ListaEditable,
  PanelVistaPrevia,
  Seccion,
  SelectorMinuta,
  TablaAmparosMinuta,
  TablaItemsMinuta,
  claseCampo,
  descargarPdfMinuta,
  useVistaPreviaMinuta,
} from "@/components/minuta-comun"
import { fechaContrato } from "@/components/detalle-solicitud-contrato"
import { leerNumero, pesos, type SolicitudContratoDetalle } from "@/lib/contratos"
import { origenRenglon, totalItemsMinuta, valorEnLetras, type OrigenDato } from "@/lib/minuta-mano-obra"
import { TIPOS_DOCUMENTO_ARRENDADOR } from "@/lib/minuta-arrendamiento"
import {
  CLAUSULAS_OBRA,
  OBLIGACIONES_CONTRATANTE_OBRA,
  OBLIGACIONES_ESPECIFICAS_OBRA,
  OBLIGACIONES_GENERALES_OBRA,
  PRIMERA_CLAUSULA_ADICIONAL_OBRA,
  nombreArchivoMinutaObra,
  origenCampoObra,
  type MinutaObra,
} from "@/lib/minuta-obra"
import { guardarMinutaObra, obtenerMinutaObra, type MinutaContratoObra } from "@/app/(app)/contratos/pre-aprobacion/actions"

// ---------------------------------------------------------------------------
// Editor de la minuta de obra a todo costo dentro del detalle de
// Pre-aprobación. Mismo funcionamiento que las demás minutas; lleva el anexo
// N° 1 (actividades, cantidades y valores). El texto fijo de las cláusulas
// está en components/minuta-obra-pdf.tsx.
// ---------------------------------------------------------------------------

type CampoTexto = { [K in keyof MinutaObra]: MinutaObra[K] extends string ? K : never }[keyof MinutaObra]
type CampoLista = "obligacionesContratante" | "obligacionesGenerales" | "obligacionesEspecificas"

const formatoValor = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 })
const numero = (i: number) => `${i + 1}.`

export function MinutaObraEditor({ detalle, puedeEditar }: { detalle: SolicitudContratoDetalle; puedeEditar: boolean }) {
  const [datos, setDatos] = useState<MinutaContratoObra | null>(null)
  const [m, setM] = useState<MinutaObra | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cambios, setCambios] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const [descargando, setDescargando] = useState(false)
  const vistaPrevia = useVistaPreviaMinuta(detalle.id, m)

  const editable = puedeEditar && detalle.estado !== "rechazada"
  const deshabilitado = !editable || guardando

  useEffect(() => {
    let cancelado = false
    obtenerMinutaObra(detalle.id)
      .then((d: MinutaContratoObra) => {
        if (cancelado) return
        setDatos(d)
        setM(d.minuta)
      })
      .catch((e) => !cancelado && setError(e instanceof Error ? e.message : "No se pudo cargar la minuta."))
    return () => {
      cancelado = true
    }
  }, [detalle.id])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!m || !datos) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Cargando minuta...
      </div>
    )
  }

  function actualizar(cambio: Partial<MinutaObra>) {
    setM((prev) => (prev ? { ...prev, ...cambio } : prev))
    setCambios(true)
    setAviso(null)
  }

  // Las letras siguen al número mientras nadie las haya escrito a mano.
  const letrasNuevas = (anteriorTexto: string, letras: string, texto: string) => {
    const anterior = leerNumero(anteriorTexto)
    const nuevo = leerNumero(texto)
    if (!texto.trim()) return ""
    const automaticas = anterior !== null && letras === valorEnLetras(anterior)
    return nuevo !== null && (automaticas || !letras.trim()) ? valorEnLetras(nuevo) : letras
  }

  function cambiarValor(texto: string) {
    actualizar({ valor: texto, valorLetras: letrasNuevas(m!.valor, m!.valorLetras, texto) })
  }

  function cambiarAnticipo(texto: string) {
    actualizar({ anticipo: texto, anticipoLetras: letrasNuevas(m!.anticipo, m!.anticipoLetras, texto) })
  }

  // Cambiar el porcentaje recalcula el anticipo con el valor del contrato.
  function cambiarPorcentaje(texto: string) {
    const p = leerNumero(texto.replace(/%/g, ""))
    const v = leerNumero(m!.valor)
    if (p === null || v === null) {
      actualizar({ anticipoPorcentaje: texto })
      return
    }
    const monto = formatoValor.format(Math.round(((v * p) / 100) * 100) / 100)
    actualizar({ anticipoPorcentaje: texto, anticipo: monto, anticipoLetras: letrasNuevas(m!.anticipo, m!.anticipoLetras, monto) })
  }

  function campo(clave: CampoTexto, etiqueta: string, opciones?: { placeholder?: string; tipo?: string; ayuda?: string; ancho?: boolean; filas?: number }) {
    const manejar: Partial<Record<CampoTexto, (v: string) => void>> = {
      valor: cambiarValor,
      anticipo: cambiarAnticipo,
      anticipoPorcentaje: cambiarPorcentaje,
    }
    return (
      <CampoMinuta
        id={`minuta-${clave}`}
        etiqueta={etiqueta}
        valor={m![clave] as string}
        origen={origenCampoObra(clave, m![clave] as string, datos!.porDefecto)}
        onChange={(v) => (manejar[clave] ? manejar[clave]!(v) : actualizar({ [clave]: v } as Partial<MinutaObra>))}
        disabled={deshabilitado}
        {...opciones}
      />
    )
  }

  function lista(clave: CampoLista) {
    const plantilla =
      clave === "obligacionesContratante"
        ? OBLIGACIONES_CONTRATANTE_OBRA
        : clave === "obligacionesGenerales"
          ? OBLIGACIONES_GENERALES_OBRA
          : OBLIGACIONES_ESPECIFICAS_OBRA
    const deSolicitud = clave === "obligacionesEspecificas" ? datos!.porDefecto.obligacionesEspecificas : []
    return (
      <ListaEditable
        items={m![clave]}
        onChange={(items) => actualizar({ [clave]: items } as Partial<MinutaObra>)}
        marcador={numero}
        origen={(t) => origenRenglon(t, plantilla, deSolicitud)}
        textoAgregar="Agregar obligación"
        editable={editable}
        guardando={guardando}
      />
    )
  }

  async function guardar() {
    if (!m) return
    setGuardando(true)
    setAviso(null)
    try {
      const r = await guardarMinutaObra(detalle.id, m)
      setDatos((d) => (d ? { ...d, guardadaAt: r.guardadaAt, guardadaPorNombre: null } : d))
      setCambios(false)
      setAviso({ ok: true, texto: "Minuta guardada." })
    } catch (e) {
      setAviso({ ok: false, texto: e instanceof Error ? e.message : "No se pudo guardar la minuta." })
    } finally {
      setGuardando(false)
    }
  }

  async function descargar() {
    if (!m) return
    setDescargando(true)
    try {
      await descargarPdfMinuta(detalle.id, m, nombreArchivoMinutaObra(detalle.numero, m.contratistaNombre))
    } catch (e) {
      setAviso({ ok: false, texto: e instanceof Error ? e.message : "No se pudo generar el PDF." })
    } finally {
      setDescargando(false)
    }
  }

  function restablecer() {
    if (!datos) return
    if (!confirm("¿Volver a llenar la minuta con los datos de la solicitud? Se pierde lo que se haya editado (hasta que guardes, lo guardado no cambia).")) return
    setM(datos.porDefecto)
    setCambios(true)
    setAviso(null)
  }

  const juridica = m.contratistaTipoPersona === "juridica"
  const valorNumero = leerNumero(m.valor)
  const anticipoNumero = leerNumero(m.anticipo)
  const totalItems = totalItemsMinuta(m.items)
  const origenTipoDocumento: OrigenDato = m.contratistaTipoDocumento === datos.porDefecto.contratistaTipoDocumento ? "solicitud" : "editado"

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ---------------- formulario ---------------- */}
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3">
          <div className="min-w-0 flex-1 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Plantilla · Contrato de obra a todo costo (versión 04)</p>
            {datos.guardadaAt ? (
              <p>
                Guardada el {fechaContrato(datos.guardadaAt)}
                {datos.guardadaPorNombre && ` por ${datos.guardadaPorNombre}`}
                {cambios && " · hay cambios sin guardar"}
              </p>
            ) : (
              <p>{cambios ? "Cambios sin guardar." : "Llenada con los datos de la solicitud; todavía no se ha guardado."}</p>
            )}
            {!editable && <p>Solo lectura{detalle.estado === "rechazada" ? ": la solicitud fue rechazada." : "."}</p>}
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

        <Seccion titulo="Contratante" ayuda="La empresa del proyecto.">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("contratanteNombre", "Razón social")}
            {campo("contratanteNit", "NIT")}
            {campo("contratanteRepresentante", "Representante legal")}
            {campo("contratanteRepresentanteCedula", "Cédula del representante")}
            {campo("contratanteCorreo", "Correo de notificaciones (vigésima séptima)", { tipo: "email", ancho: true })}
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
            {campo("contratistaCorreo", "Correo de notificaciones (vigésima séptima)", { tipo: "email", ancho: true })}
          </div>
        </Seccion>

        <Seccion titulo="Primera y segunda · Proyecto y plazo">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("obra", "Proyecto denominado", { ancho: true })}
            {campo("plazo", "Plazo de ejecución", {
              placeholder: "noventa (90) días",
              ayuda: "En el PDF sigue «calendario, contados a partir de la suscripción del acta de inicio».",
            })}
          </div>
        </Seccion>

        <Seccion titulo="Tercera y cuarta · Valor y anticipo">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("valor", "Valor del contrato ($)", {
              ayuda:
                valorNumero === null
                  ? "Escribe el valor en pesos."
                  : `${pesos(valorNumero)}${Math.abs(valorNumero - totalItems) >= 0.01 ? ` · el anexo suma ${pesos(totalItems)}` : " · igual al total del anexo"}`,
            })}
            <div className="flex items-end">
              {editable && valorNumero !== totalItems && totalItems > 0 && (
                <Button type="button" size="sm" variant="outline" disabled={guardando} onClick={() => cambiarValor(formatoValor.format(totalItems))}>
                  Usar el total del anexo
                </Button>
              )}
            </div>
            {campo("valorLetras", "Valor en letras", { filas: 2, ayuda: "Se actualiza al cambiar el valor, salvo que lo hayas escrito a mano." })}
            {campo("anticipoPorcentaje", "Anticipo (% del valor)", { ayuda: "Vacío = sin anticipo (la cuarta dice que no se entrega)." })}
            {campo("anticipo", "Anticipo ($)", { ayuda: anticipoNumero === null ? "Se calcula con el porcentaje." : pesos(anticipoNumero) })}
            {campo("anticipoLetras", "Anticipo en letras", { ancho: true })}
            {campo("amortizacion", "Amortización por acta", { placeholder: "30%", ayuda: "«El Anticipo será amortizado en el … en cada cobro de acta parcial»." })}
          </div>
        </Seccion>

        <Seccion titulo="Quinta · Forma de pago">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("periodicidadPago", "Se pagará cada", { placeholder: "quince (15) días" })}
            {campo("retencionGarantia", "Retención en garantía (parágrafo tercero)", { placeholder: "5%", ayuda: "«…retención … de la obra del … del valor del contrato»." })}
            {campo("condicionesPago", "Forma de pago de la solicitud (párrafo aparte, opcional)", { filas: 2 })}
          </div>
        </Seccion>

        <Seccion titulo="Sexta a octava · Obligaciones">
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Obligaciones del contratante:</p>
              {lista("obligacionesContratante")}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Obligaciones generales del contratista:</p>
              {lista("obligacionesGenerales")}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Obligaciones específicas del contratista (las de la plantilla, más las de la solicitud y sus entregables):</p>
              {lista("obligacionesEspecificas")}
            </div>
          </div>
        </Seccion>

        <Seccion titulo="Décima octava · Garantías">
          <TablaAmparosMinuta
            amparos={m.amparos}
            porDefecto={datos.porDefecto.amparos}
            onChange={(amparos) => actualizar({ amparos })}
            editable={editable}
            guardando={guardando}
          />
        </Seccion>

        <Seccion titulo="Domicilio, lugar de ejecución y firma">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("domicilioDepartamento", "Domicilio: departamento de (décima novena)")}
            {campo("municipioEjecucion", "Municipio de ejecución (vigésima quinta)")}
            {campo("departamentoFirma", "Se firma en el Departamento de")}
            {campo("fechaFirma", "Fecha de firma", { tipo: "date", ayuda: "El año también va en el número: No. CJ-<número>-<año>." })}
          </div>
        </Seccion>

        <Seccion titulo="Cláusulas" ayuda="Las de la plantilla van con su texto fijo; aquí se agregan otras.">
          <details className="rounded-md border">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium">Cláusulas de la plantilla ({CLAUSULAS_OBRA.length}) — texto fijo</summary>
            <ol className="space-y-1 border-t px-3 py-2 text-xs">
              {CLAUSULAS_OBRA.map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <ChipOrigen origen="plantilla" />
                  <span>{t}</span>
                </li>
              ))}
            </ol>
          </details>
          <ClausulasAdicionalesEditor
            clausulas={m.clausulasAdicionales}
            onChange={(clausulasAdicionales) => actualizar({ clausulasAdicionales })}
            desde={PRIMERA_CLAUSULA_ADICIONAL_OBRA}
            editable={editable}
            guardando={guardando}
          />
        </Seccion>

        <Seccion titulo="Anexo N° 1 · Actividades, cantidades y valores">
          <TablaItemsMinuta
            items={m.items}
            porDefecto={datos.porDefecto.items}
            onChange={(items) => actualizar({ items })}
            editable={editable}
            guardando={guardando}
          />
          <p className="text-xs text-muted-foreground">
            Cambiar el anexo aquí solo cambia el documento; las cantidades reservadas del presupuesto siguen siendo las de la solicitud.
          </p>
        </Seccion>
      </div>

      {/* ---------------- vista previa ---------------- */}
      <PanelVistaPrevia {...vistaPrevia} />
    </div>
  )
}
