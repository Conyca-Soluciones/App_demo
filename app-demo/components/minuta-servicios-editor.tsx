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
  claseCampo,
  descargarPdfMinuta,
  focoDeEvento,
  useVistaPreviaMinuta,
} from "@/components/minuta-comun"
import { fechaContrato } from "@/components/detalle-solicitud-contrato"
import { leerNumero, pesos, type SolicitudContratoDetalle } from "@/lib/contratos"
import { origenRenglon, valorEnLetras, type OrigenDato } from "@/lib/minuta-mano-obra"
import { TIPOS_DOCUMENTO_ARRENDADOR } from "@/lib/minuta-arrendamiento"
import {
  CLAUSULAS_SERVICIOS,
  OBLIGACIONES_CONTRATANTE_SERVICIOS,
  OBLIGACIONES_GENERALES_SERVICIOS,
  PRIMERA_CLAUSULA_ADICIONAL_SERVICIOS,
  nombreArchivoMinutaServicios,
  origenCampoServicios,
  type MinutaServicios,
} from "@/lib/minuta-servicios"
import { guardarMinutaServicios, obtenerMinutaServicios, type MinutaContratoServicios } from "@/app/(app)/contratos/pre-aprobacion/actions"

// ---------------------------------------------------------------------------
// Editor de la minuta de prestación de servicios (plantilla GJ-F-020) dentro
// del detalle de Pre-aprobación. Mismo funcionamiento que las demás minutas.
// El texto fijo de las cláusulas está en components/minuta-servicios-pdf.tsx.
// ---------------------------------------------------------------------------

type CampoTexto = { [K in keyof MinutaServicios]: MinutaServicios[K] extends string ? K : never }[keyof MinutaServicios]
type CampoLista = "obligacionesGenerales" | "obligacionesEspecificas" | "obligacionesContratante"

const numero = (i: number) => `${i + 1}.`

export function MinutaServiciosEditor({ detalle, puedeEditar }: { detalle: SolicitudContratoDetalle; puedeEditar: boolean }) {
  const [datos, setDatos] = useState<MinutaContratoServicios | null>(null)
  const [m, setM] = useState<MinutaServicios | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cambios, setCambios] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const [descargando, setDescargando] = useState(false)
  // Dato que se está editando: la vista previa lo resalta y abre en su página.
  const [foco, setFoco] = useState<string | null>(null)
  const vistaPrevia = useVistaPreviaMinuta(detalle.id, m, foco)

  const editable = puedeEditar && detalle.estado !== "rechazada"
  const deshabilitado = !editable || guardando

  useEffect(() => {
    let cancelado = false
    obtenerMinutaServicios(detalle.id)
      .then((d: MinutaContratoServicios) => {
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

  function actualizar(cambio: Partial<MinutaServicios>) {
    setM((prev) => (prev ? { ...prev, ...cambio } : prev))
    setCambios(true)
    setAviso(null)
  }

  function cambiarValor(texto: string) {
    // El valor en letras sigue al número mientras nadie lo haya escrito a mano.
    const anterior = leerNumero(m!.valor)
    const nuevo = leerNumero(texto)
    const automaticas = anterior !== null && m!.valorLetras === valorEnLetras(anterior)
    actualizar({ valor: texto, ...(nuevo !== null && (automaticas || !m!.valorLetras.trim()) ? { valorLetras: valorEnLetras(nuevo) } : {}) })
  }

  function campo(clave: CampoTexto, etiqueta: string, opciones?: { placeholder?: string; tipo?: string; ayuda?: string; ancho?: boolean; filas?: number }) {
    return (
      <CampoMinuta
        id={`minuta-${clave}`}
        etiqueta={etiqueta}
        valor={m![clave] as string}
        origen={origenCampoServicios(clave, m![clave] as string, datos!.porDefecto)}
        onChange={(v) => (clave === "valor" ? cambiarValor(v) : actualizar({ [clave]: v } as Partial<MinutaServicios>))}
        disabled={deshabilitado}
        {...opciones}
      />
    )
  }

  function lista(clave: CampoLista) {
    const plantilla =
      clave === "obligacionesGenerales" ? OBLIGACIONES_GENERALES_SERVICIOS : clave === "obligacionesContratante" ? OBLIGACIONES_CONTRATANTE_SERVICIOS : []
    const deSolicitud = clave === "obligacionesEspecificas" ? datos!.porDefecto.obligacionesEspecificas : []
    return (
      <ListaEditable
        foco={clave}
        items={m![clave]}
        onChange={(items) => actualizar({ [clave]: items } as Partial<MinutaServicios>)}
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
      const r = await guardarMinutaServicios(detalle.id, m)
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
      await descargarPdfMinuta(detalle.id, m, nombreArchivoMinutaServicios(detalle.numero, m.contratistaNombre))
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
  const origenTipoDocumento: OrigenDato = m.contratistaTipoDocumento === datos.porDefecto.contratistaTipoDocumento ? "solicitud" : "editado"

  return (
    <div
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      onFocus={(e) => {
        const f = focoDeEvento(e)
        if (f) setFoco(f)
      }}
    >
      {/* ---------------- formulario ---------------- */}
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3">
          <div className="min-w-0 flex-1 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Plantilla GJ-F-020 · Contrato de prestación de servicios</p>
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
            {campo("contratanteCorreo", "Correo de notificaciones (décima novena)", { tipo: "email", ancho: true })}
          </div>
        </Seccion>

        <Seccion titulo="Contratista" ayuda="La plantilla es para una persona natural; si es una empresa, firma su representante legal.">
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
            {campo("contratistaCedulaExpedida", "Documento expedido en")}
            {campo("contratistaCorreo", "Correo de notificaciones (décima novena)", { tipo: "email" })}
          </div>
        </Seccion>

        <Seccion titulo="Primera · Objeto">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("servicio", "Servicios profesionales como", {
              filas: 2,
              placeholder: "ingeniero residente de obra",
              ayuda: "Sigue a «…los servicios profesionales como» y va antes de «, para el proyecto …».",
            })}
            {campo("obra", "Proyecto", { ancho: true })}
          </div>
        </Seccion>

        <Seccion titulo="Segunda a cuarta · Obligaciones">
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Obligaciones generales del contratista:</p>
              {lista("obligacionesGenerales")}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Obligaciones específicas del contratista (las de la solicitud y sus entregables):
              </p>
              {m.obligacionesEspecificas.length === 0 && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ChipOrigen origen="vacio" /> La plantilla las deja en blanco; agrega al menos una.
                </p>
              )}
              {lista("obligacionesEspecificas")}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Obligaciones generales del contratante:</p>
              {lista("obligacionesContratante")}
            </div>
          </div>
        </Seccion>

        <Seccion titulo="Quinta y sexta · Plazo y valor">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("plazo", "Plazo", { placeholder: "tres (3) meses", ayuda: "«…dentro de un plazo de … contado a partir del …»." })}
            {campo("fechaInicio", "Inicia el", { tipo: "date" })}
            {campo("valor", "Honorarios ($)", { ayuda: valorNumero === null ? "Escribe el valor en pesos." : pesos(valorNumero) })}
            {campo("valorLetras", "Honorarios en letras", { ayuda: "Se actualiza al cambiar el valor, salvo que lo hayas escrito a mano." })}
            {campo("formaPago", "Forma de pago", {
              filas: 3,
              placeholder: "mensual, en pagos iguales de …",
              ayuda: "Sigue a «Los pagos se realizarán de manera …». Valor mensual, anticipo y forma de pago de la solicitud.",
            })}
          </div>
        </Seccion>

        <Seccion titulo="Octava, novena y décima octava · Cláusula penal, lugar y domicilio">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("clausulaPenalPorcentaje", "Cláusula penal pecuniaria (% de lo ejecutado)")}
            <div />
            {campo("municipioEjecucion", "Municipio de ejecución")}
            {campo("departamentoEjecucion", "Departamento de ejecución")}
            {campo("domicilioCiudad", "Ciudad de domicilio del contrato")}
          </div>
        </Seccion>

        <Seccion titulo="Cláusulas" ayuda="Las de la plantilla van con su texto fijo; aquí se agregan otras.">
          <details className="rounded-md border">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium">Cláusulas de la plantilla ({CLAUSULAS_SERVICIOS.length}) — texto fijo</summary>
            <ol className="space-y-1 border-t px-3 py-2 text-xs">
              {CLAUSULAS_SERVICIOS.map((t) => (
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
            desde={PRIMERA_CLAUSULA_ADICIONAL_SERVICIOS}
            editable={editable}
            guardando={guardando}
          />
        </Seccion>

        <Seccion titulo="Lugar y fecha de firma">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("ciudadFirma", "Ciudad")}
            {campo("fechaFirma", "Fecha", { tipo: "date", ayuda: "El año también va en el número: No. CJ-<número>-<año>." })}
          </div>
        </Seccion>
      </div>

      {/* ---------------- vista previa ---------------- */}
      <PanelVistaPrevia {...vistaPrevia} />
    </div>
  )
}
