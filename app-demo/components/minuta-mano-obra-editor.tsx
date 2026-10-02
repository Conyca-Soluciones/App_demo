"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowDown, ArrowUp, Download, ExternalLink, Loader2, Plus, RefreshCw, RotateCcw, Save, Trash2 } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { leerNumero, pesos } from "@/lib/contratos"
import { fechaContrato } from "@/components/detalle-solicitud-contrato"
import {
  CLAUSULAS_PLANTILLA,
  OBLIGACIONES_CONTRATANTE,
  OBLIGACIONES_CONTRATISTA,
  POSICION_OBLIGACION_CORRECCION,
  REQUISITOS_PAGO,
  ordinalClausula,
  origenCampo,
  origenRenglon,
  type OrigenDato,
  nombreArchivoMinuta,
  obligacionCorreccion,
  totalItemsMinuta,
  valorEnLetras,
  type ClausulaAdicional,
  type ItemAnexoMinuta,
  type MinutaManoObra,
} from "@/lib/minuta-mano-obra"
import type { SolicitudContratoDetalle } from "@/lib/contratos"
import { guardarMinutaContrato, obtenerMinutaContrato, type MinutaContrato } from "@/app/(app)/contratos/pre-aprobacion/actions"

// ---------------------------------------------------------------------------
// Editor de la minuta de mano de obra (plantilla GJ-F-003) dentro del detalle
// de Pre-aprobación: todos los campos de la plantilla, prellenados con la
// solicitud; vista previa del PDF con lo que está en pantalla, descarga y
// guardado (contratos.minuta_datos). El texto fijo de las cláusulas está en
// components/minuta-mano-obra-pdf.tsx.
// ---------------------------------------------------------------------------

const claseCampo =
  "h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
const claseArea =
  "w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"

const formatoValor = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 })

type CampoTexto = { [K in keyof MinutaManoObra]: MinutaManoObra[K] extends string ? K : never }[keyof MinutaManoObra]
type CampoLista = "obligacionesContratante" | "obligacionesContratista" | "requisitosPago"

// Origen de cada dato: plantilla (texto de la GJ-F-003), solicitud (datos de
// la solicitud, el contratista o el proyecto) o falta (rojo). Lo escrito o
// cambiado a mano queda sin color.
const ORIGEN: Record<OrigenDato, { etiqueta: string; chip: string; borde: string; ayuda: string }> = {
  plantilla: {
    etiqueta: "Plantilla",
    chip: "bg-slate-100 text-slate-700 ring-slate-300",
    borde: "border-l-4 border-l-slate-400",
    ayuda: "Texto que trae la plantilla GJ-F-003.",
  },
  solicitud: {
    etiqueta: "Solicitud",
    chip: "bg-sky-100 text-sky-800 ring-sky-300",
    borde: "border-l-4 border-l-sky-500",
    ayuda: "Dato de la solicitud, el contratista o el proyecto.",
  },
  editado: {
    etiqueta: "Editado",
    chip: "",
    borde: "",
    ayuda: "Escrito o cambiado a mano en la minuta (sin color).",
  },
  vacio: {
    etiqueta: "Falta",
    chip: "bg-red-100 text-red-800 ring-red-300",
    borde: "border-l-4 border-l-red-500 bg-red-50/40",
    ayuda: "Falta llenarlo: en el PDF sale como raya.",
  },
}

function ChipOrigen({ origen }: { origen: OrigenDato }) {
  if (origen === "editado") return null
  const o = ORIGEN[origen]
  return (
    <span title={o.ayuda} className={`inline-flex shrink-0 items-center rounded px-1.5 py-px text-[10px] font-medium ring-1 ${o.chip}`}>
      {o.etiqueta}
    </span>
  )
}

function Seccion({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border bg-background p-4">
      <div>
        <h3 className="text-sm font-semibold">{titulo}</h3>
        {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
      </div>
      {children}
    </section>
  )
}

async function generarPdf(id: string, minuta: MinutaManoObra, signal?: AbortSignal): Promise<Blob> {
  const r = await fetch(`/contratos/pre-aprobacion/${id}/minuta`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ minuta }),
    signal,
  })
  const tipo = r.headers.get("Content-Type") ?? ""
  if (!r.ok || !tipo.includes("application/pdf")) {
    const cuerpo = tipo.includes("json") ? await r.json().catch(() => null) : null
    throw new Error(cuerpo?.error ?? "No se pudo generar el PDF.")
  }
  return r.blob()
}

export function MinutaManoObraEditor({ detalle, puedeEditar }: { detalle: SolicitudContratoDetalle; puedeEditar: boolean }) {
  const [datos, setDatos] = useState<MinutaContrato | null>(null)
  const [m, setM] = useState<MinutaManoObra | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cambios, setCambios] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const [descargando, setDescargando] = useState(false)
  const [vista, setVista] = useState<{ url: string | null; cargando: boolean; error: string | null }>({ url: null, cargando: false, error: null })
  const urlVista = useRef<string | null>(null)

  const editable = puedeEditar && detalle.estado !== "rechazada"
  const deshabilitado = !editable || guardando

  useEffect(() => {
    let cancelado = false
    obtenerMinutaContrato(detalle.id)
      .then((d: MinutaContrato) => {
        if (cancelado) return
        setDatos(d)
        setM(d.minuta)
      })
      .catch((e) => !cancelado && setError(e instanceof Error ? e.message : "No se pudo cargar la minuta."))
    return () => {
      cancelado = true
    }
  }, [detalle.id])

  // Vista previa: se vuelve a generar un momento después del último cambio.
  useEffect(() => {
    if (!m) return
    const control = new AbortController()
    const t = setTimeout(() => {
      setVista((v) => ({ ...v, cargando: true, error: null }))
      generarPdf(detalle.id, m, control.signal)
        .then((blob) => {
          const url = URL.createObjectURL(blob)
          if (urlVista.current) URL.revokeObjectURL(urlVista.current)
          urlVista.current = url
          setVista({ url, cargando: false, error: null })
        })
        .catch((e) => {
          if (control.signal.aborted) return
          setVista((v) => ({ ...v, cargando: false, error: e instanceof Error ? e.message : "No se pudo generar la vista previa." }))
        })
    }, 900)
    return () => {
      clearTimeout(t)
      control.abort()
    }
  }, [m, detalle.id])

  useEffect(
    () => () => {
      if (urlVista.current) URL.revokeObjectURL(urlVista.current)
    },
    []
  )

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!m || !datos) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Cargando minuta...
      </div>
    )
  }

  function actualizar(cambio: Partial<MinutaManoObra>) {
    setM((prev) => (prev ? { ...prev, ...cambio } : prev))
    setCambios(true)
    setAviso(null)
  }

  function cambiarValor(texto: string) {
    // El valor en letras sigue al número mientras nadie lo haya escrito a mano.
    const anterior = leerNumero(m!.valor)
    const nuevo = leerNumero(texto)
    const letrasAutomaticas = anterior !== null && m!.valorLetras === valorEnLetras(anterior)
    actualizar({ valor: texto, ...(nuevo !== null && (letrasAutomaticas || !m!.valorLetras.trim()) ? { valorLetras: valorEnLetras(nuevo) } : {}) })
  }

  function campo(clave: CampoTexto, etiqueta: string, opciones?: { placeholder?: string; tipo?: string; ayuda?: string; ancho?: boolean }) {
    const idCampo = `minuta-${clave}`
    const origen = origenCampo(clave, m![clave] as string, datos!.porDefecto)
    return (
      <div className={`min-w-0 space-y-1 ${opciones?.ancho ? "sm:col-span-2" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={idCampo} className="text-xs font-medium text-muted-foreground">
            {etiqueta}
          </label>
          <ChipOrigen origen={origen} />
        </div>
        <input
          id={idCampo}
          type={opciones?.tipo ?? "text"}
          value={m![clave] as string}
          placeholder={opciones?.placeholder}
          onChange={(e) => (clave === "valor" ? cambiarValor(e.target.value) : actualizar({ [clave]: e.target.value } as Partial<MinutaManoObra>))}
          disabled={deshabilitado}
          className={`${claseCampo} ${ORIGEN[origen].borde}`}
        />
        {opciones?.ayuda && <p className="text-xs text-muted-foreground">{opciones.ayuda}</p>}
      </div>
    )
  }

  function area(clave: CampoTexto, etiqueta: string, filas = 3, ayuda?: string) {
    const idCampo = `minuta-${clave}`
    const origen = origenCampo(clave, m![clave] as string, datos!.porDefecto)
    return (
      <div className="min-w-0 space-y-1 sm:col-span-2">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={idCampo} className="text-xs font-medium text-muted-foreground">
            {etiqueta}
          </label>
          <ChipOrigen origen={origen} />
        </div>
        <textarea
          id={idCampo}
          rows={filas}
          value={m![clave] as string}
          onChange={(e) => actualizar({ [clave]: e.target.value } as Partial<MinutaManoObra>)}
          disabled={deshabilitado}
          className={`${claseArea} ${ORIGEN[origen].borde}`}
        />
        {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
      </div>
    )
  }

  function lista(clave: CampoLista, marcador: (i: number) => string, textoAgregar: string) {
    const items = m![clave]
    const plantilla =
      clave === "obligacionesContratante" ? OBLIGACIONES_CONTRATANTE : clave === "obligacionesContratista" ? OBLIGACIONES_CONTRATISTA : REQUISITOS_PAGO
    const deSolicitud = clave === "obligacionesContratista" ? detalle.obligaciones : []
    const mover = (i: number, d: -1 | 1) => {
      const copia = [...items]
      ;[copia[i], copia[i + d]] = [copia[i + d], copia[i]]
      actualizar({ [clave]: copia } as Partial<MinutaManoObra>)
    }
    return (
      <div className="space-y-2">
        {items.map((t, i) => {
          const origen = origenRenglon(t, plantilla, deSolicitud)
          return (
          <div key={i} className="flex items-start gap-2">
            <div className="flex w-16 shrink-0 flex-col items-end gap-1 pt-1.5">
              <span className="text-xs text-muted-foreground tabular-nums">{marcador(i)}</span>
              <ChipOrigen origen={origen} />
            </div>
            <textarea
              rows={2}
              value={t}
              aria-label={`${textoAgregar} ${i + 1}`}
              onChange={(e) => actualizar({ [clave]: items.map((x, j) => (j === i ? e.target.value : x)) } as Partial<MinutaManoObra>)}
              disabled={deshabilitado}
              className={`${claseArea} flex-1 ${ORIGEN[origen].borde}`}
            />
            {editable && (
              <div className="flex flex-col">
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Subir" disabled={guardando || i === 0} onClick={() => mover(i, -1)}>
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Bajar" disabled={guardando || i === items.length - 1} onClick={() => mover(i, 1)}>
                  <ArrowDown className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Quitar"
                  disabled={guardando}
                  onClick={() => actualizar({ [clave]: items.filter((_, j) => j !== i) } as Partial<MinutaManoObra>)}
                >
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              </div>
            )}
          </div>
          )
        })}
        {editable && (
          <Button type="button" size="sm" variant="outline" disabled={guardando} onClick={() => actualizar({ [clave]: [...items, ""] } as Partial<MinutaManoObra>)}>
            <Plus className="size-4" /> {textoAgregar}
          </Button>
        )}
      </div>
    )
  }

  function cambiarItem(i: number, cambio: Partial<ItemAnexoMinuta>) {
    actualizar({ items: m!.items.map((it, j) => (j === i ? { ...it, ...cambio } : it)) })
  }

  async function guardar() {
    if (!m) return
    setGuardando(true)
    setAviso(null)
    try {
      const r = await guardarMinutaContrato(detalle.id, m)
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
      const blob = await generarPdf(detalle.id, m)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = nombreArchivoMinuta(detalle.numero, m.contratistaNombre)
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
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

  const totalAnexo = totalItemsMinuta(m.items)
  const valorNumero = leerNumero(m.valor)
  const juridica = m.contratistaTipoPersona === "juridica"

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ---------------- formulario ---------------- */}
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3">
          <div className="min-w-0 flex-1 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Plantilla GJ-F-003 · Contrato de mano de obra</p>
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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Origen de cada dato:</span>
          {(["plantilla", "solicitud", "vacio"] as OrigenDato[]).map((o) => (
            <span key={o} className="flex items-center gap-1">
              <ChipOrigen origen={o} /> {ORIGEN[o].ayuda}
            </span>
          ))}
        </div>

        <Seccion titulo="Lugar y fecha de firma">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("ciudadFirma", "Ciudad")}
            {campo("fechaFirma", "Fecha", { tipo: "date" })}
          </div>
        </Seccion>

        <Seccion titulo="Contratante">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("contratanteNombre", "Razón social")}
            {campo("contratanteNit", "NIT")}
            {campo("contratanteRepresentante", "Representante legal")}
            {campo("contratanteRepresentanteCedula", "Cédula del representante")}
            {campo("contratanteRepresentanteExpedida", "Cédula expedida en")}
            {campo("contratanteCorreo", "Correo de notificaciones", { tipo: "email" })}
          </div>
        </Seccion>

        <Seccion titulo="Contratista">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1 sm:col-span-2">
              <label htmlFor="minuta-tipo-persona" className="text-xs font-medium text-muted-foreground">
                Tipo de persona
              </label>
              <select
                id="minuta-tipo-persona"
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
            {campo("contratistaCedula", juridica ? "Cédula del representante" : "Cédula")}
            {campo("contratistaCedulaExpedida", "Cédula expedida en")}
            {campo("contratistaCiudad", "Ciudad de domicilio")}
            {campo("contratistaCorreo", "Correo de notificaciones", { tipo: "email" })}
          </div>
        </Seccion>

        <Seccion titulo="Primera · Objeto" ayuda="Texto que sigue a «EL CONTRATANTE encarga al CONTRATISTA…».">
          <div className="grid gap-3 sm:grid-cols-2">
            {area("objeto", "Objeto", 3)}
            {campo("obra", "Obra denominada", { ancho: true })}
          </div>
        </Seccion>

        <Seccion titulo="Segunda · Obligaciones de las partes">
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">El contratante se compromete a:</p>
              {lista("obligacionesContratante", (i) => `${i + 1}.`, "Agregar obligación")}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">El contratista se compromete a:</p>
              {lista(
                "obligacionesContratista",
                (i) => `${i < POSICION_OBLIGACION_CORRECCION ? i + 1 : i + 2}.`,
                "Agregar obligación"
              )}
            </div>
            <div className="space-y-2 rounded-md border border-dashed p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Obligación de corrección de actividades (va en el puesto {Math.min(POSICION_OBLIGACION_CORRECCION, m.obligacionesContratista.length) + 1}):
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {campo("plazoSolicitudCorreccion", "Plazo para pedir corrección", { placeholder: "cinco (5) días hábiles" })}
                {campo("plazoAjustes", "Plazo máximo de ajustes", { placeholder: "cinco (5) días hábiles" })}
                {campo("plazoSilencio", "Silencio = aceptación tras", { placeholder: "siete (7) días hábiles" })}
              </div>
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <ChipOrigen origen="plantilla" />
                <span>{obligacionCorreccion(m)}</span>
              </p>
            </div>
          </div>
        </Seccion>

        <Seccion titulo="Tercera · Duración" ayuda="Texto que sigue a «…se llevará a cabo dentro de un plazo».">
          <div className="grid gap-3 sm:grid-cols-2">{campo("plazo", "Plazo", { ancho: true, placeholder: "de tres (3) meses contados a partir de la firma de este" })}</div>
        </Seccion>

        <Seccion titulo="Cuarta · Precio y forma de pago">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("valor", "Valor del contrato ($)", {
              ayuda:
                valorNumero === null
                  ? "Escribe el valor en pesos, por ejemplo 1.500.000."
                  : `${pesos(valorNumero)}${Math.abs(valorNumero - totalAnexo) >= 0.01 ? ` · el anexo suma ${pesos(totalAnexo)}` : " · igual al total del anexo"}`,
            })}
            <div className="flex items-end">
              {editable && valorNumero !== totalAnexo && totalAnexo > 0 && (
                <Button type="button" size="sm" variant="outline" disabled={guardando} onClick={() => cambiarValor(formatoValor.format(totalAnexo))}>
                  Usar el total del anexo
                </Button>
              )}
            </div>
            {area("valorLetras", "Valor en letras", 2, "Se actualiza al cambiar el valor, salvo que lo hayas escrito a mano.")}
            {area("formaPago", "Forma de pago", 3)}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Para el respectivo pago se requiere:</p>
            {lista("requisitosPago", (i) => `${String.fromCharCode(97 + i)})`, "Agregar requisito")}
          </div>
        </Seccion>

        <Seccion titulo="Lugar de ejecución, domicilio y controversias">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("municipioEjecucion", "Municipio de ejecución (quinta)")}
            {campo("ciudadArbitramento", "Sede del tribunal de arbitramento (décima quinta)")}
            {campo("domicilioMunicipio", "Domicilio: municipio (décima segunda)")}
            {campo("domicilioDepartamento", "Domicilio: departamento")}
          </div>
        </Seccion>

        <Seccion titulo="Cláusulas" ayuda="Vencimiento, porcentajes y cláusulas que se agregan a las de la plantilla.">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("vencimiento", "Vencimiento del contrato (tercera)", { tipo: "date", ayuda: "En el PDF: «El presente contrato vence el …»." })}
            <div />
            {campo("clausulaPenalPorcentaje", "Cláusula penal (% del valor)")}
            {campo("polizaPorcentaje", "Póliza de cumplimiento (% del valor)")}
            {campo("anexos", "Anexos que forman parte del contrato (décima tercera)", { ancho: true })}
          </div>

          <details className="rounded-md border">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
              Cláusulas de la plantilla ({CLAUSULAS_PLANTILLA.length}) — texto fijo
            </summary>
            <ol className="space-y-1 border-t px-3 py-2 text-xs">
              {CLAUSULAS_PLANTILLA.map((t, i) => (
                <li key={t} className="flex items-center gap-2">
                  <ChipOrigen origen="plantilla" />
                  <span>
                    <span className="font-medium">{ordinalClausula(i + 1)}.</span> {t}
                  </span>
                </li>
              ))}
            </ol>
          </details>

          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground">Cláusulas adicionales (van después de la décima octava)</p>
            {m.clausulasAdicionales.length === 0 && <p className="text-xs text-muted-foreground">No hay cláusulas adicionales.</p>}
            {m.clausulasAdicionales.map((c, i) => {
              const cambiarClausula = (cambio: Partial<ClausulaAdicional>) =>
                actualizar({ clausulasAdicionales: m.clausulasAdicionales.map((x, j) => (j === i ? { ...x, ...cambio } : x)) })
              const vacia = !c.titulo.trim() || !c.texto.trim()
              return (
                <div key={i} className={`space-y-2 rounded-md border p-3 ${ORIGEN[vacia ? "vacio" : "editado"].borde}`}>
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-xs font-semibold">{ordinalClausula(CLAUSULAS_PLANTILLA.length + 1 + i)}.</span>
                    <input
                      aria-label={`Título de la cláusula adicional ${i + 1}`}
                      value={c.titulo}
                      onChange={(e) => cambiarClausula({ titulo: e.target.value })}
                      placeholder="Título, p. ej. Seguridad y salud en el trabajo"
                      disabled={deshabilitado}
                      className={claseCampo}
                    />
                    <ChipOrigen origen={vacia ? "vacio" : "editado"} />
                    {editable && (
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Quitar cláusula"
                        disabled={guardando}
                        onClick={() => actualizar({ clausulasAdicionales: m.clausulasAdicionales.filter((_, j) => j !== i) })}
                      >
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                  <textarea
                    rows={3}
                    aria-label={`Texto de la cláusula adicional ${i + 1}`}
                    value={c.texto}
                    onChange={(e) => cambiarClausula({ texto: e.target.value })}
                    placeholder="Texto de la cláusula"
                    disabled={deshabilitado}
                    className={claseArea}
                  />
                </div>
              )
            })}
            {editable && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={guardando}
                onClick={() => actualizar({ clausulasAdicionales: [...m.clausulasAdicionales, { titulo: "", texto: "" }] })}
              >
                <Plus className="size-4" /> Agregar cláusula
              </Button>
            )}
          </div>
        </Seccion>

        <Seccion titulo="Anexo N° 1 · Actividades, cantidades y valores">
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="bg-muted/60 text-left text-xs">
                  <th className="px-2 py-1.5">Actividad</th>
                  <th className="w-20 px-2 py-1.5">Unidad</th>
                  <th className="w-24 px-2 py-1.5 text-right">Cantidad</th>
                  <th className="w-32 px-2 py-1.5 text-right">Valor unitario</th>
                  <th className="w-32 px-2 py-1.5 text-right">Total</th>
                  {editable && <th className="w-10" />}
                </tr>
              </thead>
              <tbody>
                {m.items.map((it, i) => {
                  const c = leerNumero(it.cantidad)
                  const v = leerNumero(it.valorUnitario)
                  const original = datos.porDefecto.items[i]
                  const origenFila: OrigenDato =
                    !it.actividad.trim() && !it.cantidad.trim()
                      ? "vacio"
                      : original &&
                          original.actividad === it.actividad &&
                          original.unidad === it.unidad &&
                          original.cantidad === it.cantidad &&
                          original.valorUnitario === it.valorUnitario
                        ? "solicitud"
                        : "editado"
                  return (
                    <tr key={i} className={`border-t align-top ${ORIGEN[origenFila].borde}`}>
                      <td className="p-1">
                        <div className="px-1 pb-1">
                          <ChipOrigen origen={origenFila} />
                        </div>
                        <textarea
                          rows={2}
                          aria-label={`Actividad ${i + 1}`}
                          value={it.actividad}
                          onChange={(e) => cambiarItem(i, { actividad: e.target.value })}
                          disabled={deshabilitado}
                          className={claseArea}
                        />
                      </td>
                      <td className="p-1">
                        <input aria-label={`Unidad ${i + 1}`} value={it.unidad} onChange={(e) => cambiarItem(i, { unidad: e.target.value })} disabled={deshabilitado} className={claseCampo} />
                      </td>
                      <td className="p-1">
                        <input
                          aria-label={`Cantidad ${i + 1}`}
                          inputMode="decimal"
                          value={it.cantidad}
                          onChange={(e) => cambiarItem(i, { cantidad: e.target.value })}
                          disabled={deshabilitado}
                          className={`${claseCampo} text-right tabular-nums ${it.cantidad.trim() && c === null ? "border-destructive" : ""}`}
                        />
                      </td>
                      <td className="p-1">
                        <input
                          aria-label={`Valor unitario ${i + 1}`}
                          inputMode="decimal"
                          value={it.valorUnitario}
                          onChange={(e) => cambiarItem(i, { valorUnitario: e.target.value })}
                          disabled={deshabilitado}
                          className={`${claseCampo} text-right tabular-nums ${it.valorUnitario.trim() && v === null ? "border-destructive" : ""}`}
                        />
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{c !== null && v !== null ? pesos(Math.round(c * v * 100) / 100) : "—"}</td>
                      {editable && (
                        <td className="p-1">
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Quitar actividad"
                            disabled={guardando}
                            onClick={() => actualizar({ items: m.items.filter((_, j) => j !== i) })}
                          >
                            <Trash2 className="size-3.5 text-destructive" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/40 font-medium">
                  <td colSpan={4} className="px-2 py-1.5 text-right">
                    Total
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{pesos(totalAnexo)}</td>
                  {editable && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
          {editable && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={guardando}
              onClick={() => actualizar({ items: [...m.items, { actividad: "", unidad: "", cantidad: "", valorUnitario: "" }] })}
            >
              <Plus className="size-4" /> Agregar actividad
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            Cambiar el anexo aquí solo cambia el documento; las cantidades reservadas del presupuesto siguen siendo las de la solicitud.
          </p>
        </Seccion>
      </div>

      {/* ---------------- vista previa ---------------- */}
      <div className="min-w-0">
        <div className="sticky top-0 flex h-[70svh] flex-col overflow-hidden rounded-lg border bg-muted/30 lg:h-[calc(94svh-9rem)]">
          <div className="flex items-center gap-2 border-b bg-background px-3 py-2 text-xs">
            <span className="flex-1 font-medium">Vista previa del PDF</span>
            {vista.cargando && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Actualizando...
              </span>
            )}
            {vista.url && (
              <a href={vista.url} target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm", variant: "ghost" })}>
                <ExternalLink className="size-4" /> Abrir
              </a>
            )}
            <Button size="sm" variant="ghost" aria-label="Actualizar vista previa" onClick={() => setM((x) => (x ? { ...x } : x))}>
              <RefreshCw className="size-4" />
            </Button>
          </div>
          {vista.error ? (
            <p className="p-4 text-sm text-destructive">{vista.error}</p>
          ) : vista.url ? (
            <iframe src={vista.url} title="Vista previa de la minuta" className="min-h-0 flex-1 bg-white" />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> Generando vista previa...
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
