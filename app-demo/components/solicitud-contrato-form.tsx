"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { ArrowLeft, FileUp, Loader2, Plus, Search, Send, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownFlotante } from "@/components/dropdown-flotante"
import { createClient } from "@/lib/supabase/client"
import {
  DOCUMENTOS_POR_PERSONA,
  documentoFormateado,
  validarArchivo,
  type Contratista,
} from "@/lib/contratistas"
import {
  OPCIONES_ACTAS,
  TIPOS_CONTRATO,
  TIPO_CONTRATO_POR_VALOR,
  anticipoEnLetras,
  empiezaConVerbo,
  pesosEnLetras,
  pideValorMensual,
  polizaObligatoria,
  leerNumero,
  pesos,
  numero,
  sinManoObraEnApu,
  topeValorUnitario,
  totalAnexo,
  validarSolicitud,
  type CampoSolicitud,
  type ItemPresupuestoContrato,
  type SolicitudContratoDetalle,
  type ActasPeriodicidad,
  type SolicitudContratoForm,
  type TipoContrato,
  type TipoDocumentoContrato,
} from "@/lib/contratos"
import { listarContratistas } from "@/app/(app)/contratos/contratistas/actions"
import {
  crearSolicitudContrato,
  listarItemsPresupuestoContrato,
  reenviarSolicitudContrato,
  type DocumentoContratoSubido,
} from "@/app/(app)/contratos/solicitar/actions"
import { CampoFecha } from "@/components/ui/campo-fecha"
import { MetodoPagoContrato } from "@/components/metodo-pago-contrato"

// ---------------------------------------------------------------------------
// Formulario de solicitud de contrato. El director elige el tipo (eso define
// qué documentos se piden) y el contratista (sus datos salen del directorio),
// llena las condiciones y lo manda a pre-aprobación.
// ---------------------------------------------------------------------------

const ITEM_VACIO = { presupuestoItemId: "", cantidad: "", valorUnitario: "" }

const FORMULARIO_VACIO: SolicitudContratoForm = {
  tipo: "",
  contratistaId: "",
  objeto: "",
  anexoTipo: "valor_global",
  valor: "",
  valorMensual: "",
  items: [{ ...ITEM_VACIO }],
  tieneAnticipo: false,
  anticipoPorcentaje: "",
  requierePoliza: true,
  formaPago: "",
  metodoPago: "transferencia",
  pagoObservaciones: "",
  plazoTipo: "fechas",
  fechaInicio: "",
  fechaFin: "",
  duracionCantidad: "",
  duracionUnidad: "meses",
  obligaciones: [],
  entregables: [],
  correoNotificacion: "",
  observaciones: "",
  departamentoDomicilio: "",
  pagoCadaDias: "",
  retencionGarantia: "",
  retencionPorcentaje: "",
  inmuebleDireccion: "",
  inmuebleUso: "",
  canonIva: "",
  serviciosIncluidos: "",
  correoFactura: "",
  bienNombre: "",
  actas: "",
  exigeGarantia: "",
}

const siNo = (v: boolean | undefined): "" | "si" | "no" => (v === undefined ? "" : v ? "si" : "no")

// Formulario lleno con una solicitud devuelta, para corregirla.
function formularioDesde(d: SolicitudContratoDetalle): SolicitudContratoForm {
  return {
    tipo: d.tipo,
    contratistaId: d.contratistaId,
    objeto: d.objeto,
    anexoTipo: d.anexoTipo,
    valor: d.anexoTipo === "valor_global" ? numero(d.valor) : "",
    valorMensual: d.valorMensual !== null ? numero(d.valorMensual) : "",
    items:
      d.items.length > 0
        ? d.items.map((i) => ({ presupuestoItemId: i.presupuestoItemId, cantidad: numero(i.cantidad), valorUnitario: numero(i.valorUnitario) }))
        : [{ ...ITEM_VACIO }],
    tieneAnticipo: d.tieneAnticipo,
    requierePoliza: d.requierePoliza !== false,
    anticipoPorcentaje: d.anticipoPorcentaje !== null ? numero(d.anticipoPorcentaje) : "",
    formaPago: d.formaPago,
    metodoPago: d.metodoPago ?? "transferencia",
    pagoObservaciones: d.pagoObservaciones ?? "",
    plazoTipo: d.plazoTipo,
    fechaInicio: d.fechaInicio ?? "",
    fechaFin: d.fechaFin ?? "",
    duracionCantidad: d.duracionCantidad !== null ? String(d.duracionCantidad) : "",
    duracionUnidad: d.duracionUnidad ?? "meses",
    obligaciones: d.obligaciones,
    entregables: d.entregables,
    correoNotificacion: d.correoNotificacion,
    observaciones: d.observaciones ?? "",
    departamentoDomicilio: d.domicilioDepartamento ?? "",
    pagoCadaDias: d.datosTipo.pagoCadaDias !== undefined ? String(d.datosTipo.pagoCadaDias) : "",
    retencionGarantia: siNo(d.datosTipo.retencionGarantia),
    retencionPorcentaje: d.datosTipo.retencionPorcentaje ? numero(d.datosTipo.retencionPorcentaje) : "",
    inmuebleDireccion: d.datosTipo.inmuebleDireccion ?? "",
    inmuebleUso: d.datosTipo.inmuebleUso ?? "",
    canonIva: d.datosTipo.canonIva ?? "",
    serviciosIncluidos: siNo(d.datosTipo.serviciosIncluidos),
    correoFactura: d.datosTipo.correoFactura ?? "",
    bienNombre: d.datosTipo.bienNombre ?? "",
    actas: d.datosTipo.actas ?? "",
    exigeGarantia: siNo(d.datosTipo.exigeGarantia),
  }
}

// Pregunta de sí / no con dos botones.
function PreguntaSiNo(props: {
  id: string
  etiqueta: string
  valor: "" | "si" | "no"
  onChange: (v: "si" | "no") => void
  disabled: boolean
  conError: boolean
  textoSi?: string
  textoNo?: string
}) {
  const { id, etiqueta, valor, onChange, disabled, conError, textoSi = "Sí", textoNo = "No" } = props
  return (
    <div className="space-y-1">
      <p id={id} className="text-xs font-medium text-muted-foreground">
        {etiqueta}
      </p>
      <div role="radiogroup" aria-labelledby={id} className={`inline-flex gap-1 rounded-md ${conError ? "ring-1 ring-destructive" : ""}`}>
        {(
          [
            ["si", textoSi],
            ["no", textoNo],
          ] as const
        ).map(([v, texto]) => (
          <Button
            key={v}
            type="button"
            size="sm"
            role="radio"
            aria-checked={valor === v}
            variant={valor === v ? "default" : "outline"}
            onClick={() => onChange(v)}
            disabled={disabled}
          >
            {texto}
          </Button>
        ))}
      </div>
    </div>
  )
}

type DocumentoExistente = DocumentoContratoSubido

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

// Buscador de un ítem del presupuesto (por código o descripción). Muestra
// hasta 10 coincidencias; los ítems sin cantidad disponible salen deshabilitados.
export function SelectorItemPresupuesto({
  etiqueta,
  catalogo,
  excluir,
  disabled,
  onElegir,
}: {
  etiqueta: string
  catalogo: ItemPresupuestoContrato[]
  excluir: Set<string>
  disabled: boolean
  onElegir: (item: ItemPresupuestoContrato) => void
}) {
  const [texto, setTexto] = useState("")
  const [abierto, setAbierto] = useState(false)
  const idLista = useId()
  const ancla = useRef<HTMLInputElement>(null)
  const coincidencias = useMemo(() => {
    const q = normalizar(texto.trim())
    const lista = catalogo.filter((c) => !excluir.has(c.id) && (!q || normalizar(`${c.codigo} ${c.descripcion}`).includes(q)))
    return lista.slice(0, 10)
  }, [catalogo, excluir, texto])

  return (
    <div>
      <input
        ref={ancla}
        aria-label={etiqueta}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value)
          setAbierto(true)
        }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        placeholder="Buscar ítem por código o descripción"
        disabled={disabled}
        className={claseCampo()}
        role="combobox"
        aria-expanded={abierto}
        aria-controls={idLista}
      />
      {/* Fuera de la tabla (portal): dentro quedaba recortado por su scroll. */}
      <DropdownFlotante anchorRef={ancla} abierto={abierto} anchoMinimo={640}>
        <div className="overflow-hidden rounded-md border bg-popover shadow-lg">
          <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_7.5rem_7.5rem] gap-3 border-b bg-muted/60 px-3 py-1.5 text-xs font-medium text-muted-foreground">
            <span>Código</span>
            <span>Descripción</span>
            <span className="text-right">Disponible</span>
            <span className="text-right">Valor unitario</span>
          </div>
          <ul id={idLista} role="listbox" className="max-h-80 overflow-auto">
            {coincidencias.length === 0 ? (
              <li className="px-3 py-3 text-sm text-muted-foreground">Ningún ítem del presupuesto coincide.</li>
            ) : (
              coincidencias.map((c) => {
                const agotado = c.disponible <= 0
                return (
                  <li key={c.id} role="option" aria-selected={false} aria-disabled={agotado} className="border-b last:border-b-0">
                    <button
                      type="button"
                      disabled={agotado}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onElegir(c)
                        setTexto("")
                        setAbierto(false)
                      }}
                      className="grid w-full grid-cols-[4.5rem_minmax(0,1fr)_7.5rem_7.5rem] items-start gap-3 px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="font-medium tabular-nums">{c.codigo}</span>
                      <span className="break-words">{c.descripcion}</span>
                      <span className="text-right text-xs tabular-nums">
                        {agotado ? "Contratado" : `${numero(c.disponible)} ${c.unidad ?? ""}`}
                      </span>
                      <span className="text-right text-xs tabular-nums">{pesos(c.valorUnitario)}</span>
                    </button>
                  </li>
                )
              })
            )}
          </ul>
          {coincidencias.length === 10 && (
            <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">Se muestran 10. Escribe más para afinar la búsqueda.</p>
          )}
        </div>
      </DropdownFlotante>
    </div>
  )
}

export function SolicitudContratoForm({
  proyectoId,
  proyectoNombre,
  edicion,
  onCancelar,
  onEnviada,
}: {
  proyectoId: string
  proyectoNombre: string
  // Solicitud DEVUELTA que se corrige y reenvía (mismo número). Sin esto, es nueva.
  edicion?: SolicitudContratoDetalle
  onCancelar: () => void
  onEnviada: (numero: number) => void
}) {
  const [f, setF] = useState<SolicitudContratoForm>(() => (edicion ? formularioDesde(edicion) : FORMULARIO_VACIO))
  // Documentos que ya tiene la solicitud devuelta: se conservan salvo que se
  // cambien o se quiten.
  const [existentes, setExistentes] = useState<Partial<Record<TipoDocumentoContrato, DocumentoExistente>>>(() =>
    Object.fromEntries(
      (edicion?.documentos ?? []).map((d) => [
        d.tipo,
        { tipo: d.tipo, ruta: d.ruta, nombreArchivo: d.nombreArchivo, tamano: d.tamano, mime: d.mime },
      ])
    )
  )
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

  // Ítems del presupuesto vigente (para el anexo de valores unitarios).
  const [catalogo, setCatalogo] = useState<ItemPresupuestoContrato[] | null>(null)
  const [errorCatalogo, setErrorCatalogo] = useState<string | null>(null)
  useEffect(() => {
    listarItemsPresupuestoContrato(proyectoId)
      .then((lista: ItemPresupuestoContrato[]) => setCatalogo(lista))
      .catch((e) => setErrorCatalogo(e instanceof Error ? e.message : "No se pudo cargar el presupuesto del proyecto."))
  }, [proyectoId])
  // Al corregir una devuelta, su propia cantidad todavía figura como
  // contratada en el presupuesto: se suma de vuelta (la base hace lo mismo al
  // reenviar: borra sus líneas antes de revisar los topes).
  const catalogoPorId = useMemo(() => {
    const propias = new Map((edicion?.items ?? []).map((i) => [i.presupuestoItemId, i.cantidad]))
    return new Map(
      (catalogo ?? []).map((i) => {
        const propia = propias.get(i.id) ?? 0
        return [i.id, propia ? { ...i, contratado: i.contratado - propia, disponible: i.disponible + propia } : i]
      })
    )
  }, [catalogo, edicion])
  const catalogoAjustado = useMemo(() => [...catalogoPorId.values()], [catalogoPorId])

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
  // El buscador muestra el tope según el tipo (mano de obra: la del APU).
  const catalogoParaSelector = useMemo(
    () => catalogoAjustado.map((i) => ({ ...i, valorUnitario: topeValorUnitario(i, f.tipo) })),
    [catalogoAjustado, f.tipo]
  )

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
    setExistentes((a) => Object.fromEntries(Object.entries(a).filter(([t]) => validos.has(t as TipoDocumentoContrato))))
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
    if (errores[campo]) setErrores((e) => ({ ...e, [campo]: undefined }))
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErrorGeneral(null)
    const r = validarSolicitud(f, catalogoPorId)
    const faltan: Partial<Record<TipoDocumentoContrato, string>> = {}
    for (const d of tipo?.documentos ?? []) if (d.obligatorio && !archivos[d.tipo] && !existentes[d.tipo]) faltan[d.tipo] = "Adjunta este documento."
    setErrores(r.ok ? {} : r.errores)
    setErroresArchivo(faltan)
    if (!r.ok || Object.keys(faltan).length > 0) {
      setErrorGeneral("Revisa los campos marcados en rojo.")
      // Lleva al primer error para que no quede escondido más arriba.
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
      // Lo nuevo reemplaza; lo demás que ya tenía, se conserva.
      const nuevosTipos = new Set(subidos.map((x) => x.tipo))
      const conservados = tipo!.documentos
        .filter((d) => !nuevosTipos.has(d.tipo) && existentes[d.tipo])
        .map((d) => existentes[d.tipo]!)
      const documentos = [...subidos, ...conservados]

      setPaso("guardando")
      const numero = edicion
        ? await reenviarSolicitudContrato(id, proyectoId, f, documentos)
        : await crearSolicitudContrato(id, proyectoId, f, subidos)

      // Archivos viejos que ya no usa la solicitud (reemplazados o quitados):
      // se borran; si falla, no afecta la solicitud.
      if (edicion) {
        const enUso = new Set(documentos.map((x) => x.ruta))
        const sobran = edicion.documentos.map((x) => x.ruta).filter((r) => !enUso.has(r))
        if (sobran.length > 0) await supabase.storage.from("contratos").remove(sobran)
      }
      onEnviada(numero)
    } catch (err) {
      // No se guardó (es una sola transacción): se borran los archivos nuevos.
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
          {edicion ? `Corregir solicitud N° ${edicion.numero} de ` : "Nueva solicitud para "}
          <span className="font-medium text-foreground">{proyectoNombre}</span>
        </p>
      </div>
      {edicion?.motivoResolucion && (
        <div className="rounded-md border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-900">
          <p className="font-medium">
            Jurídica la devolvió{edicion.resueltoPorNombre ? ` (${edicion.resueltoPorNombre})` : ""}. Motivo:
          </p>
          <p className="whitespace-pre-line">{edicion.motivoResolucion}</p>
        </div>
      )}

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
              {contratista.datosBancariosVisibles && (
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Cuenta</dt>
                  <dd>
                    {contratista.banco} · {contratista.tipoCuenta === "ahorros" ? "Ahorros" : "Corriente"} {contratista.numeroCuenta}
                  </dd>
                </div>
              )}
            </dl>
            <div className="flex flex-wrap gap-1.5">
              {DOCUMENTOS_POR_PERSONA[contratista.tipoPersona].map((d) => {
                if (d.tipo === "certificacion_bancaria" && !contratista.datosBancariosVisibles) return null
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
              total !== null && total > 0 && <p className="text-xs text-muted-foreground tabular-nums">{pesosEnLetras(total)}</p>
            )}
          </div>
        ) : catalogo === null && !errorCatalogo ? (
          <p className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Cargando el presupuesto del proyecto...
          </p>
        ) : errorCatalogo || (catalogo && catalogo.length === 0) ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {errorCatalogo ??
              "El proyecto no tiene presupuesto vigente con ítems (cantidad y valor unitario): no se puede contratar a valores unitarios. Usa valor global o carga el presupuesto."}
          </p>
        ) : (
          <div className="space-y-2" data-error={Boolean(errores.items)}>
            <p className="text-xs text-muted-foreground">
              Cada actividad es un ítem del presupuesto vigente. La cantidad no puede pasar lo disponible (presupuestado menos lo
              que ya tienen otros contratos) y el valor unitario no puede pasar el del presupuesto.
            </p>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="bg-primary text-left text-xs text-primary-foreground">
                    <th className="px-2 py-2 font-medium">Ítem del presupuesto</th>
                    <th className="w-16 px-2 py-2 font-medium">Unidad</th>
                    <th className="w-28 px-2 py-2 text-right font-medium">Cantidad</th>
                    <th className="w-36 px-2 py-2 text-right font-medium">Valor unitario</th>
                    <th className="w-36 px-2 py-2 text-right font-medium">Total</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {f.items.map((it, i) => {
                    const ref = it.presupuestoItemId ? catalogoPorId.get(it.presupuestoItemId) : undefined
                    const c = leerNumero(it.cantidad)
                    const v = leerNumero(it.valorUnitario)
                    const subtotal = c !== null && v !== null ? c * v : null
                    const excedeCantidad = Boolean(ref && c !== null && c > ref.disponible)
                    const tope = ref ? topeValorUnitario(ref, f.tipo) : 0
                    const excedeValor = Boolean(ref && v !== null && v > tope)
                    const cambiarItem = (cambios: Partial<typeof it>) =>
                      cambiar(
                        "items",
                        f.items.map((x, j) => (j === i ? { ...x, ...cambios } : x)),
                        "items"
                      )
                    const usados = new Set(f.items.filter((_, j) => j !== i).map((x) => x.presupuestoItemId))
                    return (
                      <tr key={i} className="border-t align-top">
                        <td className="p-1">
                          {ref ? (
                            <div className="flex items-start gap-2 px-1 py-1">
                              <div className="min-w-0 flex-1">
                                <p className="break-words">
                                  <span className="font-medium tabular-nums">{ref.codigo}</span> {ref.descripcion}
                                </p>
                                <p className="text-xs text-muted-foreground tabular-nums">
                                  Disponible {numero(ref.disponible)} de {numero(ref.cantidad)} ·{" "}
                                  {f.tipo === "mano_obra" && !sinManoObraEnApu(ref, f.tipo)
                                    ? `mano de obra ${pesos(tope)} c/u (ítem completo ${pesos(ref.valorUnitario)})`
                                    : `${pesos(ref.valorUnitario)} c/u`}
                                </p>
                                {sinManoObraEnApu(ref, f.tipo) && (
                                  <p className="text-xs text-amber-700 dark:text-amber-400">
                                    El APU de este ítem no tiene mano de obra: el tope es el ítem completo y Jurídica lo verá marcado.
                                  </p>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => cambiarItem({ presupuestoItemId: "", cantidad: "", valorUnitario: "" })}
                                className="shrink-0 text-xs text-primary hover:underline"
                                disabled={enviando}
                              >
                                Cambiar
                              </button>
                            </div>
                          ) : (
                            <>
                            {it.presupuestoItemId && catalogo && (
                              <p className="px-1 pb-1 text-xs text-destructive">
                                Este ítem ya no está en el presupuesto vigente (¿cambió la versión?). Elige otro.
                              </p>
                            )}
                            <SelectorItemPresupuesto
                              etiqueta={`Ítem del presupuesto ${i + 1}`}
                              catalogo={catalogoParaSelector}
                              excluir={usados}
                              disabled={enviando}
                              onElegir={(item) =>
                                cambiarItem({
                                  presupuestoItemId: item.id,
                                  // Se propone el tope (mano de obra en mano de obra); solo se puede bajar.
                                  valorUnitario: numero(item.valorUnitario),
                                })
                              }
                            />
                            </>
                          )}
                        </td>
                        <td className="px-2 py-2.5">{ref?.unidad ?? "—"}</td>
                        <td className="p-1">
                          <input
                            aria-label={`Cantidad ${i + 1}`}
                            inputMode="decimal"
                            value={it.cantidad}
                            onChange={(e) => cambiarItem({ cantidad: e.target.value })}
                            disabled={enviando || !ref}
                            className={`${claseCampo(excedeCantidad)} text-right`}
                          />
                          {excedeCantidad && <p className="px-1 text-xs text-destructive">Máx. {numero(ref!.disponible)}</p>}
                        </td>
                        <td className="p-1">
                          <input
                            aria-label={`Valor unitario ${i + 1}`}
                            inputMode="decimal"
                            value={it.valorUnitario}
                            onChange={(e) => cambiarItem({ valorUnitario: e.target.value })}
                            disabled={enviando || !ref}
                            className={`${claseCampo(excedeValor)} text-right`}
                          />
                          {excedeValor && <p className="px-1 text-xs text-destructive">Máx. {pesos(tope)}</p>}
                        </td>
                        <td className="px-2 py-2.5 text-right tabular-nums">{subtotal !== null ? pesos(subtotal) : "—"}</td>
                        <td className="p-1 text-center">
                          <button
                            type="button"
                            onClick={() => cambiar("items", f.items.length > 1 ? f.items.filter((_, j) => j !== i) : [{ ...ITEM_VACIO }], "items")}
                            className="mt-1 rounded p-1 text-muted-foreground hover:text-destructive"
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

        {pideValorMensual(f.tipo) && (
          <div className="max-w-sm space-y-1" data-error={Boolean(errores.valorMensual)}>
            <label htmlFor="contrato-valor-mensual" className="text-xs font-medium text-muted-foreground">
              Valor del pago mensual (pesos) *
            </label>
            <input
              id="contrato-valor-mensual"
              inputMode="decimal"
              value={f.valorMensual}
              onChange={(e) => cambiar("valorMensual", e.target.value)}
              placeholder="Ej. 2.500.000"
              disabled={enviando}
              className={claseCampo(Boolean(errores.valorMensual))}
            />
            {errores.valorMensual ? (
              <MensajeError texto={errores.valorMensual} />
            ) : (
              leerNumero(f.valorMensual) !== null && (
                <p className="text-xs text-muted-foreground tabular-nums">{pesosEnLetras(leerNumero(f.valorMensual)!)}</p>
              )
            )}
            <p className="text-xs text-muted-foreground">Obligatorio para {tipo?.titulo.toLowerCase()}, además del valor del contrato.</p>
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
          {f.tipo && (
            <div className="space-y-1">
              {polizaObligatoria(f.tipo) ? (
                <p className="text-sm text-muted-foreground">
                  Este tipo de contrato siempre requiere póliza: Jurídica la revisa antes de las actas.
                </p>
              ) : (
                <>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={f.requierePoliza}
                      onCheckedChange={(v) => cambiar("requierePoliza", v === true)}
                      disabled={enviando}
                    />
                    Requiere póliza
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {f.requierePoliza
                      ? "Al aprobarse el contrato hay que subir la póliza y Jurídica la aprueba antes de las actas."
                      : "Sin póliza: al aprobarse el contrato se pueden hacer actas de una vez."}
                  </p>
                </>
              )}
            </div>
          )}
          {f.tieneAnticipo && total !== null && total > 0 && leerNumero(f.anticipoPorcentaje) !== null && !errores.anticipoPorcentaje && (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs">
              <span className="font-medium">Anticipo en letras: </span>
              {anticipoEnLetras(leerNumero(f.anticipoPorcentaje)!, total)}
            </p>
          )}
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
          <MetodoPagoContrato
            metodo={f.metodoPago}
            observaciones={f.pagoObservaciones}
            error={errores.pagoObservaciones}
            disabled={enviando}
            claseTexto={claseArea(Boolean(errores.pagoObservaciones))}
            onMetodo={(m) => cambiar("metodoPago", m, "pagoObservaciones")}
            onObservaciones={(t) => cambiar("pagoObservaciones", t)}
          />
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
            <CampoFecha sinEstilo id="contrato-inicio" value={f.fechaInicio} onChange={(e) => cambiar("fechaInicio", e.target.value, "plazo")} disabled={enviando} className={claseCampo(Boolean(errores.plazo))} />
          </div>
          {f.plazoTipo === "fechas" ? (
            <div className="space-y-1">
              <label htmlFor="contrato-fin" className="text-xs font-medium text-muted-foreground">
                Fecha de fin *
              </label>
              <CampoFecha sinEstilo id="contrato-fin" value={f.fechaFin} min={f.fechaInicio || undefined} onChange={(e) => cambiar("fechaFin", e.target.value, "plazo")} disabled={enviando} className={claseCampo(Boolean(errores.plazo))} />
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
          [
            "obligaciones",
            "Obligaciones específicas *",
            "Adicionales a las propias del tipo de contrato. Obligatorio: si de verdad no hay, escribe «N/A» o «No aplica».",
            "Agregar obligación",
          ],
          ["entregables", "Entregables *", "Obligatorio: si de verdad no hay, escribe «N/A» o «No aplica».", "Agregar entregable"],
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
          <div className="flex flex-wrap gap-2" data-error={Boolean(errores[campo])}>
            <Button type="button" variant="outline" size="sm" onClick={() => setF((v) => ({ ...v, [campo]: [...v[campo], ""] }))} disabled={enviando}>
              <Plus className="size-4" /> {boton}
            </Button>
            {f[campo].every((t) => !t.trim()) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setF((v) => ({ ...v, [campo]: ["No aplica"] }))
                  setErrores((e) => ({ ...e, [campo]: undefined }))
                }}
                disabled={enviando}
              >
                No aplica
              </Button>
            )}
          </div>
          <MensajeError texto={errores[campo]} />
        </Seccion>
      ))}

      {/* 8. Domicilio y datos para la minuta (según el tipo) */}
      <Seccion titulo="Domicilio y datos para la minuta" ayuda="Jurídica los usa para llenar la minuta del contrato.">
        <div className="max-w-md space-y-1" data-error={Boolean(errores.departamentoDomicilio)}>
          <label htmlFor="contrato-departamento" className="text-xs font-medium text-muted-foreground">
            Departamento de domicilio del contrato *
          </label>
          <input
            id="contrato-departamento"
            value={f.departamentoDomicilio}
            onChange={(e) => cambiar("departamentoDomicilio", e.target.value)}
            placeholder="Ej. Arauca"
            disabled={enviando}
            className={claseCampo(Boolean(errores.departamentoDomicilio))}
          />
          <MensajeError texto={errores.departamentoDomicilio} />
        </div>

        {(f.tipo === "obra" || f.tipo === "mano_obra") && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1" data-error={Boolean(errores.pagoCadaDias)}>
              <label htmlFor="contrato-pago-cada" className="text-xs font-medium text-muted-foreground">
                Se pagará cada (días) *
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="contrato-pago-cada"
                  inputMode="numeric"
                  value={f.pagoCadaDias}
                  onChange={(e) => cambiar("pagoCadaDias", e.target.value)}
                  placeholder="Ej. 15"
                  disabled={enviando}
                  className={`${claseCampo(Boolean(errores.pagoCadaDias))} w-24 text-right`}
                />
                <span className="text-sm text-muted-foreground">días</span>
              </div>
              <MensajeError texto={errores.pagoCadaDias} />
            </div>
            <div className="space-y-2" data-error={Boolean(errores.retencion)}>
              <PreguntaSiNo
                id="contrato-retencion"
                etiqueta="¿Hay retención en garantía? *"
                valor={f.retencionGarantia}
                onChange={(v) => cambiar("retencionGarantia", v, "retencion")}
                disabled={enviando}
                conError={Boolean(errores.retencion) && !f.retencionGarantia}
              />
              {f.retencionGarantia === "si" && (
                <div className="flex items-center gap-2">
                  <label htmlFor="contrato-retencion-porcentaje" className="text-sm text-muted-foreground">
                    Porcentaje
                  </label>
                  <input
                    id="contrato-retencion-porcentaje"
                    inputMode="decimal"
                    value={f.retencionPorcentaje}
                    onChange={(e) => cambiar("retencionPorcentaje", e.target.value, "retencion")}
                    placeholder="Ej. 5"
                    disabled={enviando}
                    className={`${claseCampo(Boolean(errores.retencion))} w-20 text-right`}
                  />
                  <span className="text-sm">%</span>
                </div>
              )}
              <MensajeError texto={errores.retencion} />
            </div>
            {f.tipo === "mano_obra" && (
              <div className="space-y-1" data-error={Boolean(errores.exigeGarantia)}>
                <PreguntaSiNo
                  id="contrato-garantia-mano-obra"
                  etiqueta="¿El contrato exige garantías (pólizas)? *"
                  valor={f.exigeGarantia}
                  onChange={(v) => cambiar("exigeGarantia", v)}
                  disabled={enviando}
                  conError={Boolean(errores.exigeGarantia)}
                />
                <MensajeError texto={errores.exigeGarantia} />
              </div>
            )}
          </div>
        )}

        {f.tipo === "arrendamiento" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2" data-error={Boolean(errores.inmuebleDireccion)}>
              <label htmlFor="contrato-inmueble-direccion" className="text-xs font-medium text-muted-foreground">
                Dirección del inmueble *
              </label>
              <input
                id="contrato-inmueble-direccion"
                value={f.inmuebleDireccion}
                onChange={(e) => cambiar("inmuebleDireccion", e.target.value)}
                placeholder="Ej. Calle 21 # 18-45, bodega 3, Arauca"
                disabled={enviando}
                className={claseCampo(Boolean(errores.inmuebleDireccion))}
              />
              <MensajeError texto={errores.inmuebleDireccion} />
            </div>
            <div className="space-y-1 sm:col-span-2" data-error={Boolean(errores.inmuebleUso)}>
              <label htmlFor="contrato-inmueble-uso" className="text-xs font-medium text-muted-foreground">
                Uso del inmueble *
              </label>
              <input
                id="contrato-inmueble-uso"
                value={f.inmuebleUso}
                onChange={(e) => cambiar("inmuebleUso", e.target.value)}
                placeholder="Ej. uso comercial, como almacén de materiales de la obra"
                disabled={enviando}
                className={claseCampo(Boolean(errores.inmuebleUso))}
              />
              <MensajeError texto={errores.inmuebleUso} />
            </div>
            <div className="space-y-1" data-error={Boolean(errores.canonIva)}>
              <PreguntaSiNo
                id="contrato-canon-iva"
                etiqueta="¿El canon incluye el IVA? *"
                valor={f.canonIva === "incluido" ? "si" : f.canonIva === "mas_iva" ? "no" : ""}
                onChange={(v) => cambiar("canonIva", v === "si" ? "incluido" : "mas_iva")}
                disabled={enviando}
                conError={Boolean(errores.canonIva)}
                textoSi="Sí, incluye IVA"
                textoNo="No, más IVA"
              />
              <MensajeError texto={errores.canonIva} />
            </div>
            <div className="space-y-1" data-error={Boolean(errores.serviciosIncluidos)}>
              <PreguntaSiNo
                id="contrato-servicios"
                etiqueta="¿El canon incluye los servicios públicos? *"
                valor={f.serviciosIncluidos}
                onChange={(v) => cambiar("serviciosIncluidos", v)}
                disabled={enviando}
                conError={Boolean(errores.serviciosIncluidos)}
              />
              <MensajeError texto={errores.serviciosIncluidos} />
            </div>
            <div className="max-w-md space-y-1 sm:col-span-2" data-error={Boolean(errores.correoFactura)}>
              <label htmlFor="contrato-correo-factura" className="text-xs font-medium text-muted-foreground">
                Correo al que llega la factura *
              </label>
              <input
                id="contrato-correo-factura"
                inputMode="email"
                value={f.correoFactura}
                onChange={(e) => cambiar("correoFactura", e.target.value)}
                placeholder="Ej. facturacion@conycasoluciones.com"
                disabled={enviando}
                className={claseCampo(Boolean(errores.correoFactura))}
              />
              <MensajeError texto={errores.correoFactura} />
            </div>
          </div>
        )}

        {f.tipo === "alquiler_vehiculo" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1" data-error={Boolean(errores.bienNombre)}>
              <label htmlFor="contrato-bien-nombre" className="text-xs font-medium text-muted-foreground">
                Nombre corto del vehículo o la maquinaria *
              </label>
              <input
                id="contrato-bien-nombre"
                value={f.bienNombre}
                onChange={(e) => cambiar("bienNombre", e.target.value)}
                placeholder="Ej. retroexcavadora"
                disabled={enviando}
                className={claseCampo(Boolean(errores.bienNombre))}
              />
              <MensajeError texto={errores.bienNombre} />
            </div>
            <div className="space-y-1" data-error={Boolean(errores.actas)}>
              <label htmlFor="contrato-actas" className="text-xs font-medium text-muted-foreground">
                Actas parciales *
              </label>
              <select
                id="contrato-actas"
                value={f.actas}
                onChange={(e) => cambiar("actas", e.target.value as "" | ActasPeriodicidad)}
                disabled={enviando}
                className={claseCampo(Boolean(errores.actas))}
              >
                <option value="">— Elige —</option>
                {OPCIONES_ACTAS.map((a) => (
                  <option key={a.valor} value={a.valor}>
                    {a.titulo}
                  </option>
                ))}
              </select>
              <MensajeError texto={errores.actas} />
            </div>
            <div className="space-y-1" data-error={Boolean(errores.exigeGarantia)}>
              <PreguntaSiNo
                id="contrato-garantia"
                etiqueta="¿El contrato tiene garantías (pólizas)? *"
                valor={f.exigeGarantia}
                onChange={(v) => cambiar("exigeGarantia", v)}
                disabled={enviando}
                conError={Boolean(errores.exigeGarantia)}
              />
              <MensajeError texto={errores.exigeGarantia} />
            </div>
          </div>
        )}
      </Seccion>

      {/* 9. Notificación y observaciones */}
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

      {/* 10. Documentos del tipo de contrato */}
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
                      (archivo || existente) && (
                        <p
                          className="truncate text-xs text-muted-foreground"
                          title={archivo?.name ?? existente?.nombreArchivo}
                        >
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
                    className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted ${
                      enviando ? "pointer-events-none opacity-50" : ""
                    } ${err ? "border-destructive" : ""}`}
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
          {paso === "subiendo"
            ? "Subiendo documentos..."
            : paso === "guardando"
              ? "Enviando..."
              : edicion
                ? "Reenviar a pre-aprobación"
                : "Mandar a pre-aprobación"}
        </Button>
      </div>
    </form>
  )
}
