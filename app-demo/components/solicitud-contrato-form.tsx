"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, FileUp, Loader2, Plus, Search, Send, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { createClient } from "@/lib/supabase/client"
import {
  DOCUMENTOS_POR_PERSONA,
  documentoFormateado,
  validarArchivo,
  type Contratista,
} from "@/lib/contratistas"
import {
  TIPOS_CONTRATO,
  TIPO_CONTRATO_POR_VALOR,
  empiezaConVerbo,
  leerNumero,
  pesos,
  totalAnexo,
  validarSolicitud,
  type CampoSolicitud,
  type SolicitudContratoForm,
  type TipoContrato,
  type TipoDocumentoContrato,
} from "@/lib/contratos"
import { listarContratistas } from "@/app/(app)/contratos/contratistas/actions"
import { crearSolicitudContrato, type DocumentoContratoSubido } from "@/app/(app)/contratos/solicitar/actions"

// ---------------------------------------------------------------------------
// Formulario de solicitud de contrato. El director elige el tipo (eso define
// qué documentos se piden) y el contratista (sus datos salen del directorio),
// llena las condiciones y lo manda a pre-aprobación.
// ---------------------------------------------------------------------------

const ITEM_VACIO = { actividad: "", unidad: "", cantidad: "", valorUnitario: "" }

const FORMULARIO_VACIO: SolicitudContratoForm = {
  tipo: "",
  contratistaId: "",
  objeto: "",
  anexoTipo: "valor_global",
  valor: "",
  items: [{ ...ITEM_VACIO }],
  tieneAnticipo: false,
  anticipoPorcentaje: "",
  formaPago: "",
  plazoTipo: "fechas",
  fechaInicio: "",
  fechaFin: "",
  duracionCantidad: "",
  duracionUnidad: "meses",
  obligaciones: [],
  entregables: [],
  correoNotificacion: "",
  observaciones: "",
}

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

export function SolicitudContratoForm({
  proyectoId,
  proyectoNombre,
  onCancelar,
  onEnviada,
}: {
  proyectoId: string
  proyectoNombre: string
  onCancelar: () => void
  onEnviada: (numero: number) => void
}) {
  const [f, setF] = useState<SolicitudContratoForm>(FORMULARIO_VACIO)
  const [errores, setErrores] = useState<Partial<Record<CampoSolicitud, string>>>({})
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

  const coincidencias = useMemo(() => {
    if (!contratistas) return []
    const q = normalizar(busqueda.trim())
    const lista = q
      ? contratistas.filter((c) => normalizar(`${c.nombre} ${c.numeroDocumento}`).includes(q))
      : contratistas
    return lista.slice(0, 8)
  }, [contratistas, busqueda])

  const total = f.anexoTipo === "valores_unitarios" ? totalAnexo(f.items) : leerNumero(f.valor)

  function cambiar<K extends keyof SolicitudContratoForm>(campo: K, valor: SolicitudContratoForm[K], error?: CampoSolicitud) {
    setF((v) => ({ ...v, [campo]: valor }))
    const clave = error ?? (campo as CampoSolicitud)
    if (errores[clave]) setErrores((e) => ({ ...e, [clave]: undefined }))
  }

  function elegirTipo(valor: TipoContrato) {
    cambiar("tipo", valor)
    // Los documentos de otro tipo no aplican (salvo los que se repiten).
    const validos = new Set(TIPO_CONTRATO_POR_VALOR.get(valor)!.documentos.map((d) => d.tipo))
    setArchivos((a) => Object.fromEntries(Object.entries(a).filter(([t]) => validos.has(t as TipoDocumentoContrato))))
    setErroresArchivo({})
  }

  function elegirContratista(c: Contratista) {
    setF((v) => ({
      ...v,
      contratistaId: c.id,
      // El correo de notificación se toma del directorio (se puede cambiar
      // para este contrato). Solo se reemplaza si no lo habían editado.
      correoNotificacion:
        !v.correoNotificacion || v.correoNotificacion === contratista?.correo ? c.correo : v.correoNotificacion,
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

  function cambiarLista(campo: "obligaciones" | "entregables", i: number, texto: string) {
    setF((v) => ({ ...v, [campo]: v[campo].map((x, j) => (j === i ? texto : x)) }))
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErrorGeneral(null)
    const r = validarSolicitud(f)
    const faltan: Partial<Record<TipoDocumentoContrato, string>> = {}
    for (const d of tipo?.documentos ?? []) if (d.obligatorio && !archivos[d.tipo]) faltan[d.tipo] = "Adjunta este documento."
    setErrores(r.ok ? {} : r.errores)
    setErroresArchivo(faltan)
    if (!r.ok || Object.keys(faltan).length > 0) {
      setErrorGeneral("Revisa los campos marcados en rojo.")
      // Lleva al primer error para que no quede escondido más arriba.
      requestAnimationFrame(() => document.querySelector("[data-error='true']")?.scrollIntoView({ behavior: "smooth", block: "center" }))
      return
    }

    const id = crypto.randomUUID()
    const supabase = createClient()
    const subidos: DocumentoContratoSubido[] = []
    setPaso("subiendo")
    try {
      await Promise.all(
        tipo!.documentos
          .filter((d) => archivos[d.tipo])
          .map(async (d) => {
            const archivo = archivos[d.tipo]!
            const ruta = `${id}/${d.tipo}.${extension(archivo)}`
            const { error } = await supabase.storage.from("contratos").upload(ruta, archivo, { contentType: archivo.type, upsert: false })
            if (error) throw new Error(`No se pudo subir "${archivo.name}": ${error.message}`)
            subidos.push({ tipo: d.tipo, ruta, nombreArchivo: archivo.name, tamano: archivo.size, mime: archivo.type })
          })
      )
      setPaso("guardando")
      const numero = await crearSolicitudContrato(id, proyectoId, f, subidos)
      onEnviada(numero)
    } catch (err) {
      // La solicitud no se creó (es una sola transacción): se borran los archivos.
      if (subidos.length > 0) await supabase.storage.from("contratos").remove(subidos.map((s) => s.ruta))
      setErrorGeneral(err instanceof Error ? err.message : "No se pudo mandar la solicitud.")
    } finally {
      setPaso(null)
    }
  }

  const objetoSinVerbo = f.objeto.trim().length > 3 && !empiezaConVerbo(f.objeto)

  return (
    <form onSubmit={enviar} noValidate className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={onCancelar} disabled={enviando}>
          <ArrowLeft className="size-4" /> Volver a las solicitudes
        </Button>
        <p className="text-sm text-muted-foreground">
          Nueva solicitud para <span className="font-medium text-foreground">{proyectoNombre}</span>
        </p>
      </div>

      {/* 1. Tipo de contrato */}
      <Seccion titulo="Tipo de contrato" ayuda="Define qué documentos se piden para este contrato.">
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
                className={`rounded-md border px-3 py-2.5 text-left text-sm transition-colors ${
                  activo ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
                }`}
              >
                <span className="font-medium">{t.titulo}</span>
                <span className={`block text-xs ${activo ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                  {(() => {
                    const n = t.documentos.filter((d) => d.obligatorio).length
                    return `${n} ${n === 1 ? "documento obligatorio" : "documentos obligatorios"}`
                  })()}
                </span>
              </button>
            )
          })}
        </div>
        <MensajeError texto={errores.tipo} />
      </Seccion>

      {/* 2. Contratista */}
      <Seccion titulo="Contratista" ayuda="Sus datos y documentos generales salen del directorio de Contratistas.">
        {errorContratistas && <p className="text-sm text-destructive">{errorContratistas}</p>}
        {contratista ? (
          <div className="space-y-3 rounded-md border bg-muted/30 p-3">
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium break-words">{contratista.nombre}</p>
                <p className="text-sm text-muted-foreground">
                  {contratista.tipoPersona === "juridica" ? "Persona jurídica" : "Persona natural"} · {documentoFormateado(contratista)}
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => cambiar("contratistaId", "")} disabled={enviando}>
                Cambiar
              </Button>
            </div>
            <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
              {contratista.tipoPersona === "juridica" && (
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Representante legal</dt>
                  <dd className="break-words">
                    {contratista.representanteNombre} · {contratista.representanteTipoDocumento} {contratista.representanteNumeroDocumento}
                  </dd>
                </div>
              )}
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">Teléfono</dt>
                <dd>{contratista.telefono}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">Dirección</dt>
                <dd className="break-words">
                  {contratista.direccion}, {contratista.ciudad}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">Cuenta</dt>
                <dd>
                  {contratista.banco} · {contratista.tipoCuenta === "ahorros" ? "Ahorros" : "Corriente"} {contratista.numeroCuenta}
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-1.5">
              {DOCUMENTOS_POR_PERSONA[contratista.tipoPersona].map((d) => {
                const tiene = contratista.documentos.some((x) => x.tipo === d.tipo)
                if (!tiene && !d.obligatorio) return null
                return (
                  <Badge
                    key={d.tipo}
                    variant="outline"
                    className={tiene ? "border-transparent bg-emerald-100 text-emerald-800" : "border-transparent bg-red-100 text-red-800"}
                  >
                    {tiene ? "✓" : "Falta"} {d.titulo.replace(/ \(si aplica\)$/, "")}
                  </Badge>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="relative" data-error={Boolean(errores.contratistaId)}>
            <Search className="pointer-events-none absolute top-[18px] left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="buscar-contratista-contrato"
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
              aria-controls="lista-contratistas-contrato"
            />
            {listaAbierta && contratistas && (
              <ul
                id="lista-contratistas-contrato"
                role="listbox"
                className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover shadow-md"
              >
                {coincidencias.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-muted-foreground">
                    {contratistas.length === 0
                      ? "Todavía no hay contratistas. Créalo primero en Contratos › Contratistas."
                      : "Ningún contratista coincide. Si es nuevo, créalo en Contratos › Contratistas."}
                  </li>
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

      {/* 3. Objeto */}
      <Seccion titulo="Objeto del contrato" ayuda='Describe las acciones empezando con un verbo en infinitivo: "Desarrollar...", "Ejecutar...", "Suministrar e instalar...".'>
        <div data-error={Boolean(errores.objeto)}>
          <textarea
            id="contrato-objeto"
            rows={3}
            value={f.objeto}
            onChange={(e) => cambiar("objeto", e.target.value)}
            disabled={enviando}
            className={claseArea(Boolean(errores.objeto))}
            placeholder="Ejecutar las obras de mampostería y pañetes del bloque 2..."
          />
          {errores.objeto ? (
            <MensajeError texto={errores.objeto} />
          ) : (
            objetoSinVerbo && <p className="text-xs text-amber-700">Debe empezar con un verbo en infinitivo (terminado en -ar, -er o -ir).</p>
          )}
        </div>
      </Seccion>

      {/* 4. Valor y anexo */}
      <Seccion titulo="Valor y anexo" ayuda="El anexo es el valor del trabajo completo o la tabla de valores unitarios por actividad.">
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Tipo de anexo">
          {(
            [
              ["valor_global", "Valor global"],
              ["valores_unitarios", "Valores unitarios"],
            ] as const
          ).map(([valor, titulo]) => (
            <Button
              key={valor}
              type="button"
              role="radio"
              aria-checked={f.anexoTipo === valor}
              variant={f.anexoTipo === valor ? "default" : "outline"}
              size="sm"
              onClick={() => cambiar("anexoTipo", valor, "items")}
              disabled={enviando}
            >
              {titulo}
            </Button>
          ))}
        </div>

        {f.anexoTipo === "valor_global" ? (
          <div className="max-w-sm space-y-1" data-error={Boolean(errores.valor)}>
            <label htmlFor="contrato-valor" className="text-xs font-medium text-muted-foreground">
              Valor del contrato (pesos) *
            </label>
            <input
              id="contrato-valor"
              inputMode="decimal"
              value={f.valor}
              onChange={(e) => cambiar("valor", e.target.value)}
              placeholder="Ej. 25.000.000"
              disabled={enviando}
              className={claseCampo(Boolean(errores.valor))}
            />
            {errores.valor ? (
              <MensajeError texto={errores.valor} />
            ) : (
              total !== null && total > 0 && <p className="text-xs text-muted-foreground tabular-nums">{pesos(total)}</p>
            )}
          </div>
        ) : (
          <div className="space-y-2" data-error={Boolean(errores.items)}>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="bg-primary text-left text-xs text-primary-foreground">
                    <th className="px-2 py-2 font-medium">Actividad</th>
                    <th className="w-24 px-2 py-2 font-medium">Unidad</th>
                    <th className="w-28 px-2 py-2 text-right font-medium">Cantidad</th>
                    <th className="w-36 px-2 py-2 text-right font-medium">Valor unitario</th>
                    <th className="w-36 px-2 py-2 text-right font-medium">Total</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {f.items.map((it, i) => {
                    const c = leerNumero(it.cantidad)
                    const v = leerNumero(it.valorUnitario)
                    const subtotal = c !== null && v !== null ? c * v : null
                    const cambiarItem = (campo: keyof typeof it, valor: string) =>
                      cambiar(
                        "items",
                        f.items.map((x, j) => (j === i ? { ...x, [campo]: valor } : x)),
                        "items"
                      )
                    return (
                      <tr key={i} className="border-t">
                        <td className="p-1">
                          <input aria-label={`Actividad ${i + 1}`} value={it.actividad} onChange={(e) => cambiarItem("actividad", e.target.value)} disabled={enviando} className={claseCampo()} />
                        </td>
                        <td className="p-1">
                          <input aria-label={`Unidad ${i + 1}`} value={it.unidad} onChange={(e) => cambiarItem("unidad", e.target.value)} placeholder="m2" disabled={enviando} className={claseCampo()} />
                        </td>
                        <td className="p-1">
                          <input aria-label={`Cantidad ${i + 1}`} inputMode="decimal" value={it.cantidad} onChange={(e) => cambiarItem("cantidad", e.target.value)} disabled={enviando} className={`${claseCampo()} text-right`} />
                        </td>
                        <td className="p-1">
                          <input aria-label={`Valor unitario ${i + 1}`} inputMode="decimal" value={it.valorUnitario} onChange={(e) => cambiarItem("valorUnitario", e.target.value)} disabled={enviando} className={`${claseCampo()} text-right`} />
                        </td>
                        <td className="px-2 text-right tabular-nums">{subtotal !== null ? pesos(subtotal) : "—"}</td>
                        <td className="p-1 text-center">
                          <button
                            type="button"
                            onClick={() => cambiar("items", f.items.length > 1 ? f.items.filter((_, j) => j !== i) : [{ ...ITEM_VACIO }], "items")}
                            className="rounded p-1 text-muted-foreground hover:text-destructive"
                            aria-label={`Quitar actividad ${i + 1}`}
                            disabled={enviando}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/40 font-medium">
                    <td colSpan={4} className="px-2 py-2 text-right">
                      Valor del contrato
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{pesos(total ?? 0)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => cambiar("items", [...f.items, { ...ITEM_VACIO }], "items")} disabled={enviando}>
              <Plus className="size-4" /> Agregar actividad
            </Button>
            <MensajeError texto={errores.items} />
          </div>
        )}
      </Seccion>

      {/* 5. Forma de pago */}
      <Seccion titulo="Forma de pago">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-4" data-error={Boolean(errores.anticipoPorcentaje)}>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={f.tieneAnticipo}
                onCheckedChange={(v) => {
                  cambiar("tieneAnticipo", v === true, "anticipoPorcentaje")
                  if (v !== true) cambiar("anticipoPorcentaje", "")
                }}
                disabled={enviando}
              />
              Tiene anticipo
            </label>
            {f.tieneAnticipo && (
              <div className="flex items-center gap-2">
                <label htmlFor="contrato-anticipo" className="text-sm text-muted-foreground">
                  Porcentaje
                </label>
                <input
                  id="contrato-anticipo"
                  inputMode="decimal"
                  value={f.anticipoPorcentaje}
                  onChange={(e) => cambiar("anticipoPorcentaje", e.target.value)}
                  disabled={enviando}
                  className={`${claseCampo(Boolean(errores.anticipoPorcentaje))} w-20 text-right`}
                />
                <span className="text-sm">%</span>
                {total !== null && total > 0 && leerNumero(f.anticipoPorcentaje) !== null && (
                  <span className="text-sm text-muted-foreground tabular-nums">
                    = {pesos((total * leerNumero(f.anticipoPorcentaje)!) / 100)}
                  </span>
                )}
              </div>
            )}
          </div>
          <MensajeError texto={errores.anticipoPorcentaje} />
          <div className="space-y-1" data-error={Boolean(errores.formaPago)}>
            <label htmlFor="contrato-forma-pago" className="text-xs font-medium text-muted-foreground">
              Forma y plazo de pago {f.tieneAnticipo ? "del saldo " : ""}*
            </label>
            <textarea
              id="contrato-forma-pago"
              rows={2}
              value={f.formaPago}
              onChange={(e) => cambiar("formaPago", e.target.value)}
              placeholder="Ej. Actas de avance quincenales, pagaderas a 30 días de radicada la factura."
              disabled={enviando}
              className={claseArea(Boolean(errores.formaPago))}
            />
            <MensajeError texto={errores.formaPago} />
          </div>
        </div>
      </Seccion>

      {/* 6. Plazo */}
      <Seccion titulo="Plazo del contrato">
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Tipo de plazo">
          {(
            [
              ["fechas", "Por fechas"],
              ["duracion", "Por duración"],
            ] as const
          ).map(([valor, titulo]) => (
            <Button
              key={valor}
              type="button"
              role="radio"
              aria-checked={f.plazoTipo === valor}
              variant={f.plazoTipo === valor ? "default" : "outline"}
              size="sm"
              onClick={() => cambiar("plazoTipo", valor, "plazo")}
              disabled={enviando}
            >
              {titulo}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3" data-error={Boolean(errores.plazo)}>
          <div className="space-y-1">
            <label htmlFor="contrato-inicio" className="text-xs font-medium text-muted-foreground">
              {f.plazoTipo === "fechas" ? "Fecha de inicio *" : "Inicio estimado (opcional)"}
            </label>
            <input id="contrato-inicio" type="date" value={f.fechaInicio} onChange={(e) => cambiar("fechaInicio", e.target.value, "plazo")} disabled={enviando} className={claseCampo(Boolean(errores.plazo))} />
          </div>
          {f.plazoTipo === "fechas" ? (
            <div className="space-y-1">
              <label htmlFor="contrato-fin" className="text-xs font-medium text-muted-foreground">
                Fecha de fin *
              </label>
              <input id="contrato-fin" type="date" value={f.fechaFin} min={f.fechaInicio || undefined} onChange={(e) => cambiar("fechaFin", e.target.value, "plazo")} disabled={enviando} className={claseCampo(Boolean(errores.plazo))} />
            </div>
          ) : (
            <div className="space-y-1">
              <label htmlFor="contrato-duracion" className="text-xs font-medium text-muted-foreground">
                Duración *
              </label>
              <div className="flex gap-2">
                <input
                  id="contrato-duracion"
                  inputMode="numeric"
                  value={f.duracionCantidad}
                  onChange={(e) => cambiar("duracionCantidad", e.target.value, "plazo")}
                  placeholder="Ej. 3"
                  disabled={enviando}
                  className={`${claseCampo(Boolean(errores.plazo))} w-24`}
                />
                <select
                  aria-label="Unidad de la duración"
                  value={f.duracionUnidad}
                  onChange={(e) => cambiar("duracionUnidad", e.target.value as "dias" | "meses", "plazo")}
                  disabled={enviando}
                  className={`${claseCampo()} w-28`}
                >
                  <option value="dias">días</option>
                  <option value="meses">meses</option>
                </select>
              </div>
            </div>
          )}
        </div>
        <MensajeError texto={errores.plazo} />
      </Seccion>

      {/* 7. Obligaciones y entregables */}
      {(
        [
          ["obligaciones", "Obligaciones específicas", "Adicionales a las propias del tipo de contrato. Opcional.", "Agregar obligación"],
          ["entregables", "Entregables", "Si aplican.", "Agregar entregable"],
        ] as const
      ).map(([campo, titulo, ayuda, boton]) => (
        <Seccion key={campo} titulo={titulo} ayuda={ayuda}>
          {f[campo].length > 0 && (
            <ol className="space-y-2">
              {f[campo].map((texto, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-2 w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
                  <textarea
                    aria-label={`${titulo} ${i + 1}`}
                    rows={1}
                    value={texto}
                    onChange={(e) => cambiarLista(campo, i, e.target.value)}
                    disabled={enviando}
                    className={`${claseArea()} min-h-9`}
                  />
                  <button
                    type="button"
                    onClick={() => setF((v) => ({ ...v, [campo]: v[campo].filter((_, j) => j !== i) }))}
                    className="mt-1.5 rounded p-1 text-muted-foreground hover:text-destructive"
                    aria-label={`Quitar ${titulo.toLowerCase()} ${i + 1}`}
                    disabled={enviando}
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ol>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => setF((v) => ({ ...v, [campo]: [...v[campo], ""] }))} disabled={enviando}>
            <Plus className="size-4" /> {boton}
          </Button>
        </Seccion>
      ))}

      {/* 8. Notificación y observaciones */}
      <Seccion titulo="Notificación y observaciones">
        <div className="max-w-md space-y-1" data-error={Boolean(errores.correoNotificacion)}>
          <label htmlFor="contrato-correo" className="text-xs font-medium text-muted-foreground">
            Correo electrónico de notificación *
          </label>
          <input
            id="contrato-correo"
            inputMode="email"
            value={f.correoNotificacion}
            onChange={(e) => cambiar("correoNotificacion", e.target.value)}
            placeholder={contratista ? undefined : "Se llena al elegir el contratista"}
            disabled={enviando}
            className={claseCampo(Boolean(errores.correoNotificacion))}
          />
          <MensajeError texto={errores.correoNotificacion} />
        </div>
        <div className="space-y-1">
          <label htmlFor="contrato-observaciones" className="text-xs font-medium text-muted-foreground">
            Observaciones
          </label>
          <textarea id="contrato-observaciones" rows={3} value={f.observaciones} onChange={(e) => cambiar("observaciones", e.target.value)} disabled={enviando} className={claseArea()} />
        </div>
      </Seccion>

      {/* 9. Documentos del tipo de contrato */}
      <Seccion
        titulo="Documentos del contrato"
        ayuda={tipo ? `Específicos de ${tipo.titulo.toLowerCase()}. PDF, JPG o PNG de hasta 10 MB.` : "Elige primero el tipo de contrato."}
      >
        {tipo && (
          <ul className="divide-y rounded-md border">
            {tipo.documentos.map((d) => {
              const archivo = archivos[d.tipo]
              const err = erroresArchivo[d.tipo]
              const id = `contrato-archivo-${d.tipo}`
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
                      archivo && (
                        <p className="truncate text-xs text-muted-foreground" title={archivo.name}>
                          {archivo.name}
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
                    className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted ${
                      enviando ? "pointer-events-none opacity-50" : ""
                    } ${err ? "border-destructive" : ""}`}
                  >
                    <FileUp className="size-4" />
                    {archivo ? "Cambiar" : "Adjuntar"}
                  </label>
                  {archivo && !d.obligatorio && (
                    <button
                      type="button"
                      onClick={() =>
                        setArchivos((a) => {
                          const sig = { ...a }
                          delete sig[d.tipo]
                          return sig
                        })
                      }
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
          {paso === "subiendo" ? "Subiendo documentos..." : paso === "guardando" ? "Enviando..." : "Mandar a pre-aprobación"}
        </Button>
      </div>
    </form>
  )
}
