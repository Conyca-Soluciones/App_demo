"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, FileUp, Loader2, Search, Send, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { documentoFormateado, validarArchivo, type Contratista } from "@/lib/contratistas"
import {
  CONTRATO_GENERAL_VACIO,
  TIPOS_CONTRATO,
  TIPO_CONTRATO_POR_VALOR,
  contratoGeneralDesde,
  leerNumero,
  pesos,
  pesosEnLetras,
  validarContratoGeneral,
  type CampoContratoGeneral,
  type ContratoGeneralForm,
  type SolicitudContratoDetalle,
  type TipoContrato,
  type TipoDocumentoContrato,
} from "@/lib/contratos"
import { listarContratistas } from "@/app/(app)/contratos/contratistas/actions"
import type { DocumentoContratoSubido } from "@/app/(app)/contratos/solicitar/actions"
import { crearContratoGeneral, reenviarContratoGeneral } from "@/app/(app)/contratos/generales/actions"

// ---------------------------------------------------------------------------
// Formulario del contrato general (como el "Contrato General" de Sinco): tipo,
// contratista, descripción, valor global, fechas, forma de pago, retenciones,
// referencia y observaciones, más los documentos del tipo de contrato. Va a
// pre-aprobación de Jurídica como los de por grupos. El buscador de
// contratistas y la subida de documentos funcionan igual que en
// solicitud-contrato-form.tsx.
// ---------------------------------------------------------------------------

const claseCampo = (conError = false) =>
  `h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60 ${
    conError ? "border-destructive" : ""
  }`
const claseArea = (conError = false) =>
  `w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60 ${
    conError ? "border-destructive" : ""
  }`

const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

function extension(archivo: File) {
  const desdeNombre = archivo.name.includes(".") ? archivo.name.split(".").pop()!.toLowerCase() : ""
  if (/^[a-z0-9]{2,5}$/.test(desdeNombre)) return desdeNombre
  return archivo.type === "application/pdf" ? "pdf" : archivo.type === "image/png" ? "png" : "jpg"
}

function Seccion({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border bg-background p-4 sm:p-5">
      <div>
        <h2 className="text-sm font-semibold">{titulo}</h2>
        {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
      </div>
      {children}
    </section>
  )
}

function MensajeError({ texto }: { texto?: string }) {
  return texto ? <p className="text-xs text-destructive">{texto}</p> : null
}

function Campo({
  id,
  etiqueta,
  error,
  children,
}: {
  id: string
  etiqueta: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1" data-error={Boolean(error)}>
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {etiqueta}
      </label>
      {children}
      <MensajeError texto={error} />
    </div>
  )
}

export function ContratoGeneralFormulario({
  proyectoId,
  proyectoNombre,
  edicion,
  onCancelar,
  onEnviado,
}: {
  proyectoId: string
  proyectoNombre: string
  // Contrato general DEVUELTO que se corrige y reenvía (mismo número).
  edicion?: SolicitudContratoDetalle
  onCancelar: () => void
  onEnviado: (numero: number) => void
}) {
  const [f, setF] = useState<ContratoGeneralForm>(() => (edicion ? contratoGeneralDesde(edicion) : CONTRATO_GENERAL_VACIO))
  const [existentes, setExistentes] = useState<Partial<Record<TipoDocumentoContrato, DocumentoContratoSubido>>>(() =>
    Object.fromEntries(
      (edicion?.documentos ?? []).map((d) => [d.tipo, { tipo: d.tipo, ruta: d.ruta, nombreArchivo: d.nombreArchivo, tamano: d.tamano, mime: d.mime }])
    )
  )
  const [errores, setErrores] = useState<Partial<Record<CampoContratoGeneral, string>>>({})
  const [archivos, setArchivos] = useState<Partial<Record<TipoDocumentoContrato, File>>>({})
  const [erroresArchivo, setErroresArchivo] = useState<Partial<Record<TipoDocumentoContrato, string>>>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [paso, setPaso] = useState<"subiendo" | "guardando" | null>(null)
  const enviando = paso !== null

  const [contratistas, setContratistas] = useState<Contratista[] | null>(null)
  const [errorContratistas, setErrorContratistas] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState("")
  const [listaAbierta, setListaAbierta] = useState(false)

  useEffect(() => {
    listarContratistas()
      .then((lista: Contratista[]) => setContratistas(lista))
      .catch((e) => setErrorContratistas(e instanceof Error ? e.message : "No se pudieron cargar los contratistas."))
  }, [])

  const contratistaPorId = useMemo(() => new Map((contratistas ?? []).map((c) => [c.id, c])), [contratistas])
  const contratista = f.contratistaId ? contratistaPorId.get(f.contratistaId) ?? null : null
  const tipo = f.tipo ? TIPO_CONTRATO_POR_VALOR.get(f.tipo) ?? null : null
  const valor = leerNumero(f.valor)

  const coincidencias = useMemo(() => {
    if (!contratistas) return []
    const q = normalizar(busqueda.trim())
    const lista = q ? contratistas.filter((c) => normalizar(`${c.nombre} ${c.numeroDocumento}`).includes(q)) : contratistas
    return lista.slice(0, 8)
  }, [contratistas, busqueda])

  function cambiar<K extends keyof ContratoGeneralForm>(campo: K, v: ContratoGeneralForm[K], error?: CampoContratoGeneral) {
    setF((x) => ({ ...x, [campo]: v }))
    const clave = error ?? campo
    if (errores[clave]) setErrores((e) => ({ ...e, [clave]: undefined }))
  }

  function elegirTipo(valorTipo: TipoContrato) {
    cambiar("tipo", valorTipo)
    const validos = new Set(TIPO_CONTRATO_POR_VALOR.get(valorTipo)!.documentos.map((d) => d.tipo))
    setArchivos((a) => Object.fromEntries(Object.entries(a).filter(([t]) => validos.has(t as TipoDocumentoContrato))))
    setExistentes((a) => Object.fromEntries(Object.entries(a).filter(([t]) => validos.has(t as TipoDocumentoContrato))))
    setErroresArchivo({})
  }

  function elegirContratista(c: Contratista) {
    setF((v) => ({
      ...v,
      contratistaId: c.id,
      correoNotificacion: !v.correoNotificacion || v.correoNotificacion === contratista?.correo ? c.correo : v.correoNotificacion,
    }))
    setErrores((e) => ({ ...e, contratistaId: undefined, correoNotificacion: undefined }))
    setBusqueda("")
    setListaAbierta(false)
  }

  function elegirArchivo(t: TipoDocumentoContrato, archivo: File | undefined) {
    if (!archivo) return
    const err = validarArchivo(archivo)
    setErroresArchivo((e) => ({ ...e, [t]: err ?? undefined }))
    setArchivos((a) => {
      const sig = { ...a }
      if (err) delete sig[t]
      else sig[t] = archivo
      return sig
    })
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErrorGeneral(null)
    const r = validarContratoGeneral(f)
    const faltan: Partial<Record<TipoDocumentoContrato, string>> = {}
    for (const d of tipo?.documentos ?? []) if (d.obligatorio && !archivos[d.tipo] && !existentes[d.tipo]) faltan[d.tipo] = "Adjunta este documento."
    setErrores(r.ok ? {} : r.errores)
    setErroresArchivo(faltan)
    if (!r.ok || Object.keys(faltan).length > 0) {
      setErrorGeneral("Revisa los campos marcados en rojo.")
      requestAnimationFrame(() => document.querySelector("[data-error='true']")?.scrollIntoView({ behavior: "smooth", block: "center" }))
      return
    }

    const id = edicion?.id ?? crypto.randomUUID()
    const supabase = createClient()
    const subidos: DocumentoContratoSubido[] = []
    setPaso("subiendo")
    try {
      await Promise.all(
        tipo!.documentos
          .filter((d) => archivos[d.tipo])
          .map(async (d) => {
            const archivo = archivos[d.tipo]!
            // Al corregir, el nombre lleva un sufijo: el archivo anterior del
            // mismo tipo sigue existiendo hasta que la base acepte el cambio.
            const sufijo = edicion ? `-${crypto.randomUUID().slice(0, 8)}` : ""
            const ruta = `${id}/${d.tipo}${sufijo}.${extension(archivo)}`
            const { error } = await supabase.storage.from("contratos").upload(ruta, archivo, { contentType: archivo.type, upsert: false })
            if (error) throw new Error(`No se pudo subir "${archivo.name}": ${error.message}`)
            subidos.push({ tipo: d.tipo, ruta, nombreArchivo: archivo.name, tamano: archivo.size, mime: archivo.type })
          })
      )
      const nuevosTipos = new Set(subidos.map((x) => x.tipo))
      const conservados = tipo!.documentos.filter((d) => !nuevosTipos.has(d.tipo) && existentes[d.tipo]).map((d) => existentes[d.tipo]!)
      const documentos = [...subidos, ...conservados]

      setPaso("guardando")
      const numero = edicion
        ? await reenviarContratoGeneral(id, proyectoId, f, documentos)
        : await crearContratoGeneral(id, proyectoId, f, subidos)

      if (edicion) {
        const enUso = new Set(documentos.map((x) => x.ruta))
        const sobran = edicion.documentos.map((x) => x.ruta).filter((r) => !enUso.has(r))
        if (sobran.length > 0) await supabase.storage.from("contratos").remove(sobran)
      }
      onEnviado(numero)
    } catch (err) {
      if (subidos.length > 0) await supabase.storage.from("contratos").remove(subidos.map((s) => s.ruta))
      setErrorGeneral(err instanceof Error ? err.message : "No se pudo mandar el contrato.")
    } finally {
      setPaso(null)
    }
  }

  return (
    <form onSubmit={enviar} noValidate className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={onCancelar} disabled={enviando}>
          <ArrowLeft className="size-4" /> Volver a los contratos
        </Button>
        <p className="text-sm text-muted-foreground">
          {edicion ? `Corregir contrato general N° ${edicion.numero} de ` : "Nuevo contrato general para "}
          <span className="font-medium text-foreground">{proyectoNombre}</span>
        </p>
      </div>
      {edicion?.motivoResolucion && (
        <div className="rounded-md border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-900">
          <p className="font-medium">Jurídica lo devolvió{edicion.resueltoPorNombre ? ` (${edicion.resueltoPorNombre})` : ""}. Motivo:</p>
          <p className="whitespace-pre-line">{edicion.motivoResolucion}</p>
        </div>
      )}

      <Seccion titulo="Tipo de contrato" ayuda="Define qué documentos se piden.">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Tipo de contrato" data-error={Boolean(errores.tipo)}>
          {TIPOS_CONTRATO.map((t) => {
            const activo = f.tipo === t.valor
            return (
              <button
                key={t.valor}
                type="button"
                role="radio"
                aria-checked={activo}
                disabled={enviando}
                onClick={() => elegirTipo(t.valor)}
                className={`rounded-md border px-3 py-2.5 text-left text-sm transition-colors ${activo ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                <span className="font-medium">{t.titulo}</span>
              </button>
            )
          })}
        </div>
        <MensajeError texto={errores.tipo} />
      </Seccion>

      <Seccion titulo="Contratista" ayuda="Sus datos salen del directorio de Contratistas.">
        {errorContratistas && <p className="text-sm text-destructive">{errorContratistas}</p>}
        {contratista ? (
          <div className="flex flex-wrap items-start gap-2 rounded-md border bg-muted/30 p-3">
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium break-words">{contratista.nombre}</p>
              <p className="text-muted-foreground">{documentoFormateado(contratista)}</p>
              <p className="text-muted-foreground">
                {contratista.direccion}, {contratista.ciudad} · {contratista.telefono} · {contratista.correo}
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => cambiar("contratistaId", "")} disabled={enviando}>
              Cambiar
            </Button>
          </div>
        ) : (
          <div className="relative" data-error={Boolean(errores.contratistaId)}>
            <Search className="pointer-events-none absolute top-[18px] left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={busqueda}
              onChange={(e) => {
                setBusqueda(e.target.value)
                setListaAbierta(true)
              }}
              onFocus={() => setListaAbierta(true)}
              onBlur={() => setTimeout(() => setListaAbierta(false), 150)}
              placeholder={contratistas === null ? "Cargando contratistas..." : "Buscar contratista por nombre o documento"}
              disabled={enviando || contratistas === null}
              className={`${claseCampo(Boolean(errores.contratistaId))} pl-9`}
              role="combobox"
              aria-expanded={listaAbierta}
              aria-controls="lista-contratistas-general"
            />
            {listaAbierta && contratistas && (
              <ul id="lista-contratistas-general" role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover shadow-md">
                {coincidencias.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-muted-foreground">Ningún contratista coincide. Si es nuevo, créalo en Contratos › Contratistas.</li>
                ) : (
                  coincidencias.map((c) => (
                    <li key={c.id} role="option" aria-selected={false}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => elegirContratista(c)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                      >
                        <span className="font-medium">{c.nombre}</span>
                        <span className="block text-xs text-muted-foreground">{documentoFormateado(c)}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
            <MensajeError texto={errores.contratistaId} />
          </div>
        )}
      </Seccion>

      <Seccion titulo="Contrato">
        <Campo id="general-descripcion" etiqueta="Descripción *" error={errores.objeto}>
          <textarea
            id="general-descripcion"
            rows={2}
            value={f.objeto}
            onChange={(e) => cambiar("objeto", e.target.value)}
            disabled={enviando}
            placeholder="Ej. Realización de visitas de categorización"
            className={claseArea(Boolean(errores.objeto))}
          />
        </Campo>
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo id="general-valor" etiqueta="Valor del contrato *" error={errores.valor}>
            <input
              id="general-valor"
              inputMode="decimal"
              value={f.valor}
              onChange={(e) => cambiar("valor", e.target.value)}
              disabled={enviando}
              placeholder="17.340.500"
              className={`${claseCampo(Boolean(errores.valor))} text-right tabular-nums`}
            />
          </Campo>
          <Campo id="general-inicio" etiqueta="Fecha de inicio *" error={errores.plazo}>
            <input id="general-inicio" type="date" value={f.fechaInicio} onChange={(e) => cambiar("fechaInicio", e.target.value, "plazo")} disabled={enviando} className={claseCampo(Boolean(errores.plazo))} />
          </Campo>
          <Campo id="general-fin" etiqueta="Fecha de terminación *">
            <input
              id="general-fin"
              type="date"
              value={f.fechaFin}
              min={f.fechaInicio || undefined}
              onChange={(e) => cambiar("fechaFin", e.target.value, "plazo")}
              disabled={enviando}
              className={claseCampo(Boolean(errores.plazo))}
            />
          </Campo>
        </div>
        {valor !== null && valor > 0 && (
          <p className="rounded-md bg-muted/50 px-3 py-2 text-xs">
            <span className="font-medium">{pesos(valor)}: </span>
            {pesosEnLetras(valor)}
          </p>
        )}
        <Campo id="general-forma-pago" etiqueta="Forma de pago *" error={errores.formaPago}>
          <input
            id="general-forma-pago"
            value={f.formaPago}
            onChange={(e) => cambiar("formaPago", e.target.value)}
            disabled={enviando}
            placeholder="Ej. Semanal"
            className={claseCampo(Boolean(errores.formaPago))}
          />
        </Campo>
      </Seccion>

      <Seccion titulo="Retenciones y referencia" ayuda="Porcentajes del valor de cada pago. Vacío = 0 %.">
        <div className="grid gap-3 sm:grid-cols-4">
          {(
            [
              ["retencionGarantiaPct", "% Ret. garantías"],
              ["retencionAnticipoPct", "% Ret. anticipo"],
              ["retencionFicPct", "% Ret. FIC"],
            ] as const
          ).map(([campo, etiqueta]) => (
            <Campo key={campo} id={`general-${campo}`} etiqueta={etiqueta} error={errores[campo]}>
              <input
                id={`general-${campo}`}
                inputMode="decimal"
                value={f[campo]}
                onChange={(e) => cambiar(campo, e.target.value)}
                disabled={enviando}
                className={`${claseCampo(Boolean(errores[campo]))} text-right tabular-nums`}
              />
            </Campo>
          ))}
          <Campo id="general-referencia" etiqueta="Referencia">
            <input id="general-referencia" value={f.referencia} onChange={(e) => cambiar("referencia", e.target.value)} disabled={enviando} className={claseCampo()} />
          </Campo>
        </div>
      </Seccion>

      <Seccion titulo="Notificación y observaciones">
        <div className="max-w-md">
          <Campo id="general-correo" etiqueta="Correo electrónico de notificación *" error={errores.correoNotificacion}>
            <input
              id="general-correo"
              inputMode="email"
              value={f.correoNotificacion}
              onChange={(e) => cambiar("correoNotificacion", e.target.value)}
              placeholder={contratista ? undefined : "Se llena al elegir el contratista"}
              disabled={enviando}
              className={claseCampo(Boolean(errores.correoNotificacion))}
            />
          </Campo>
        </div>
        <Campo id="general-observaciones" etiqueta="Observaciones">
          <textarea
            id="general-observaciones"
            rows={4}
            value={f.observaciones}
            onChange={(e) => cambiar("observaciones", e.target.value)}
            disabled={enviando}
            placeholder="Actividades, entregables, condiciones de pago..."
            className={claseArea()}
          />
        </Campo>
      </Seccion>

      <Seccion
        titulo="Documentos del contrato"
        ayuda={tipo ? `Específicos de ${tipo.titulo.toLowerCase()}. PDF, JPG o PNG de hasta 10 MB.` : "Elige primero el tipo de contrato."}
      >
        {tipo && (
          <ul className="divide-y rounded-md border">
            {tipo.documentos.map((d) => {
              const archivo = archivos[d.tipo]
              const existente = existentes[d.tipo]
              const err = erroresArchivo[d.tipo]
              const id = `general-archivo-${d.tipo}`
              return (
                <li key={d.tipo} className="flex flex-wrap items-center gap-3 px-3 py-2.5" data-error={Boolean(err)}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      {d.titulo}
                      {d.obligatorio && <span className="text-destructive"> *</span>}
                    </p>
                    {err ? (
                      <p className="text-xs text-destructive">{err}</p>
                    ) : (
                      (archivo || existente) && (
                        <p className="truncate text-xs text-muted-foreground" title={archivo?.name ?? existente?.nombreArchivo}>
                          {archivo ? archivo.name : `Actual: ${existente!.nombreArchivo}`}
                        </p>
                      )
                    )}
                  </div>
                  <input
                    id={id}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png"
                    className="sr-only"
                    disabled={enviando}
                    onChange={(e) => {
                      elegirArchivo(d.tipo, e.target.files?.[0])
                      e.target.value = ""
                    }}
                  />
                  <label
                    htmlFor={id}
                    className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted ${enviando ? "pointer-events-none opacity-50" : ""} ${err ? "border-destructive" : ""}`}
                  >
                    <FileUp className="size-4" />
                    {archivo || existente ? "Cambiar" : "Adjuntar"}
                  </label>
                  {(archivo || existente) && !d.obligatorio && (
                    <button
                      type="button"
                      onClick={() => {
                        setArchivos((a) => {
                          const sig = { ...a }
                          delete sig[d.tipo]
                          return sig
                        })
                        setExistentes((a) => {
                          const sig = { ...a }
                          delete sig[d.tipo]
                          return sig
                        })
                      }}
                      className="rounded p-1 text-muted-foreground hover:text-foreground"
                      aria-label={`Quitar ${d.titulo}`}
                      disabled={enviando}
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Seccion>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        {errorGeneral && <p className="mr-auto text-sm text-destructive">{errorGeneral}</p>}
        <Button type="button" variant="outline" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </Button>
        <Button type="submit" disabled={enviando}>
          {enviando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {paso === "subiendo" ? "Subiendo documentos..." : paso === "guardando" ? "Enviando..." : edicion ? "Reenviar a pre-aprobación" : "Mandar a pre-aprobación"}
        </Button>
      </div>
    </form>
  )
}
