"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, ExternalLink, FileUp, Loader2, Plus, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { EncabezadoPagina } from "@/components/encabezado-pagina"
import { TablaExcel, PaginacionExcel, type ColumnaExcel, type OrdenExcel } from "@/components/tabla-excel"
import { createClient } from "@/lib/supabase/client"
import { ZONA_HORARIA } from "@/lib/fechas"
import {
  DOCUMENTOS_POR_PERSONA,
  TIPOS_DOCUMENTO_PERSONA,
  documentoFormateado,
  validarArchivo,
  validarContratista,
  type CampoContratista,
  type Contratista,
  type DatosContratista,
  type TipoDocumentoContratista,
  type TipoPersona,
} from "@/lib/contratistas"
import {
  crearContratista,
  enlaceDocumentoContratista,
  listarContratistas,
  type DocumentoSubido,
} from "@/app/(app)/contratos/contratistas/actions"

const FILAS_POR_PAGINA = 50

const ETIQUETA_PERSONA: Record<TipoPersona, string> = { natural: "Natural", juridica: "Jurídica" }

// Documentos obligatorios entregados / exigidos, para la columna y el detalle.
function resumenDocumentos(c: Contratista) {
  const exigidos = DOCUMENTOS_POR_PERSONA[c.tipoPersona].filter((d) => d.obligatorio)
  const tiene = new Set(c.documentos.map((d) => d.tipo))
  return { entregados: exigidos.filter((d) => tiene.has(d.tipo)).length, total: exigidos.length }
}

// Fecha de creación en hora de Colombia (cortar el texto ISO daría la fecha
// UTC: lo creado después de las 7 p. m. saldría con el día siguiente).
const fechaCreacion = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { timeZone: ZONA_HORARIA, day: "2-digit", month: "2-digit", year: "numeric" })

// Texto normalizado para buscar sin tildes ni mayúsculas.
const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

// Abre un documento en otra pestaña. La pestaña se abre ANTES de pedir el
// enlace (dentro del clic), si no el navegador la bloquea como ventana emergente.
async function abrirDocumento(documentoId: string, onError: (m: string) => void) {
  const ventana = window.open("", "_blank")
  try {
    const url = await enlaceDocumentoContratista(documentoId)
    if (ventana) ventana.location.href = url
    else window.location.href = url
  } catch (e) {
    ventana?.close()
    onError(e instanceof Error ? e.message : "No se pudo abrir el documento.")
  }
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export function ContratistasView({ puedeCrear }: { puedeCrear: boolean }) {
  const [contratistas, setContratistas] = useState<Contratista[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState("")
  const [filtroPersona, setFiltroPersona] = useState<TipoPersona | "todos">("todos")
  const [orden, setOrden] = useState<OrdenExcel | null>({ clave: "nombre", dir: "asc" })
  const [pagina, setPagina] = useState(1)
  const [nuevoAbierto, setNuevoAbierto] = useState(false)
  const [detalle, setDetalle] = useState<Contratista | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    listarContratistas()
      .then((lista: Contratista[]) => setContratistas(lista))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los contratistas."))
  }, [])

  const columnas: ColumnaExcel<Contratista>[] = useMemo(
    () => [
      { clave: "nombre", titulo: "Nombre o razón social", ancho: 240, fija: true, flexible: true, texto: (c) => c.nombre },
      { clave: "tipoPersona", titulo: "Persona", ancho: 100, texto: (c) => ETIQUETA_PERSONA[c.tipoPersona] },
      { clave: "documento", titulo: "Documento", ancho: 160, texto: (c) => documentoFormateado(c), claseCelda: "tabular-nums" },
      { clave: "representante", titulo: "Representante legal", ancho: 200, texto: (c) => c.representanteNombre ?? "" },
      { clave: "correo", titulo: "Correo de notificación", ancho: 220, texto: (c) => c.correo },
      { clave: "telefono", titulo: "Teléfono", ancho: 130, texto: (c) => c.telefono, claseCelda: "tabular-nums" },
      { clave: "ciudad", titulo: "Ciudad", ancho: 130, texto: (c) => c.ciudad },
      {
        clave: "documentos",
        titulo: "Documentos",
        ancho: 120,
        alinear: "center",
        ordenable: false,
        texto: (c) => {
          const r = resumenDocumentos(c)
          return `${r.entregados}/${r.total}`
        },
        celda: (c) => {
          const r = resumenDocumentos(c)
          const completo = r.entregados === r.total
          return (
            <Badge variant="outline" className={completo ? "border-transparent bg-emerald-100 text-emerald-800" : "border-transparent bg-amber-100 text-amber-800"}>
              {r.entregados}/{r.total}
            </Badge>
          )
        },
      },
      { clave: "createdAt", titulo: "Creado", ancho: 110, texto: (c) => fechaCreacion(c.createdAt), claseCelda: "tabular-nums" },
    ],
    []
  )

  const filtrados = useMemo(() => {
    if (!contratistas) return []
    const q = normalizar(busqueda.trim())
    let lista = contratistas
    if (filtroPersona !== "todos") lista = lista.filter((c) => c.tipoPersona === filtroPersona)
    if (q) {
      lista = lista.filter((c) =>
        normalizar(
          [c.nombre, c.numeroDocumento, c.representanteNombre ?? "", c.correo, c.ciudad, c.telefono].join(" ")
        ).includes(q)
      )
    }
    if (orden) {
      const col = columnas.find((c) => c.clave === orden.clave)
      if (col) {
        const factor = orden.dir === "asc" ? 1 : -1
        const clave = orden.clave === "createdAt" ? (c: Contratista) => c.createdAt : (c: Contratista) => normalizar(col.texto(c))
        lista = [...lista].sort((a, b) => (clave(a) < clave(b) ? -1 : clave(a) > clave(b) ? 1 : 0) * factor)
      }
    }
    return lista
  }, [contratistas, busqueda, filtroPersona, orden, columnas])

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / FILAS_POR_PAGINA))
  const paginaActual = Math.min(pagina, totalPaginas)
  const filasPagina = filtrados.slice((paginaActual - 1) * FILAS_POR_PAGINA, paginaActual * FILAS_POR_PAGINA)

  function ordenar(clave: string) {
    setOrden((o) => (o?.clave === clave ? { clave, dir: o.dir === "asc" ? "desc" : "asc" } : { clave, dir: "asc" }))
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <EncabezadoPagina
        titulo="Contratistas"
        subtitulo="Personas naturales y jurídicas con las que se contrata, con sus documentos generales."
      >
        {puedeCrear && (
          <Button onClick={() => setNuevoAbierto(true)}>
            <Plus className="size-4" /> Nuevo contratista
          </Button>
        )}
      </EncabezadoPagina>

      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="buscar-contratista"
              value={busqueda}
              onChange={(e) => {
                setBusqueda(e.target.value)
                setPagina(1)
              }}
              placeholder="Buscar por nombre, documento, correo o ciudad"
              className="h-9 w-full rounded-md border bg-background pr-8 pl-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            {busqueda && (
              <button
                type="button"
                onClick={() => setBusqueda("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                aria-label="Limpiar búsqueda"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <div className="flex gap-1" role="group" aria-label="Tipo de persona">
            {(["todos", "natural", "juridica"] as const).map((v) => (
              <Button
                key={v}
                size="sm"
                variant={filtroPersona === v ? "default" : "outline"}
                onClick={() => {
                  setFiltroPersona(v)
                  setPagina(1)
                }}
              >
                {v === "todos" ? "Todos" : ETIQUETA_PERSONA[v]}
              </Button>
            ))}
          </div>
          {contratistas && (
            <span className="ml-auto text-sm text-muted-foreground tabular-nums">
              {filtrados.length} de {contratistas.length}
            </span>
          )}
        </div>

        {aviso && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
            <CheckCircle2 className="size-4" /> {aviso}
          </div>
        )}
        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {contratistas === null && !error ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Cargando contratistas...
          </div>
        ) : contratistas && contratistas.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
            <p>Todavía no hay contratistas registrados.</p>
            {puedeCrear && (
              <Button variant="outline" onClick={() => setNuevoAbierto(true)}>
                <Plus className="size-4" /> Crear el primero
              </Button>
            )}
          </div>
        ) : filtrados.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
            Ningún contratista coincide con la búsqueda.
          </div>
        ) : (
          <>
            <TablaExcel
              filas={filasPagina}
              columnas={columnas}
              claveFila={(c) => c.id}
              orden={orden}
              onOrdenar={ordenar}
              onDobleClickFila={setDetalle}
              tituloFila="Doble clic para ver el detalle y los documentos"
              tarjeta={{
                titulo: (c) => (
                  <button type="button" className="text-left hover:underline" onClick={() => setDetalle(c)}>
                    {c.nombre}
                  </button>
                ),
                subtitulo: (c) => `${ETIQUETA_PERSONA[c.tipoPersona]} · ${documentoFormateado(c)}`,
                esquina: (c) => columnas.find((x) => x.clave === "documentos")!.celda!(c),
                campos: ["representante", "correo", "telefono", "ciudad"],
              }}
            />
            <PaginacionExcel pagina={paginaActual} totalPaginas={totalPaginas} onCambiar={setPagina} />
          </>
        )}
      </main>

      {puedeCrear && (
        <NuevoContratistaDialog
          abierto={nuevoAbierto}
          onAbiertoChange={setNuevoAbierto}
          onCreado={(c) => {
            setContratistas((prev) => [...(prev ?? []), c])
            setAviso(`Contratista "${c.nombre}" creado.`)
          }}
        />
      )}

      <DetalleContratistaDialog contratista={detalle} onCerrar={() => setDetalle(null)} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detalle (datos + documentos)
// ---------------------------------------------------------------------------

function DetalleContratistaDialog({ contratista: c, onCerrar }: { contratista: Contratista | null; onCerrar: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [abriendo, setAbriendo] = useState<string | null>(null)

  const campos: [string, string][] = c
    ? [
        ["Tipo de persona", ETIQUETA_PERSONA[c.tipoPersona]],
        ["Documento", documentoFormateado(c)],
        ...(c.tipoPersona === "juridica"
          ? ([
              ["Representante legal", c.representanteNombre ?? "—"],
              ["Documento del representante", `${c.representanteTipoDocumento ?? ""} ${c.representanteNumeroDocumento ?? ""}`.trim()],
            ] as [string, string][])
          : []),
        ["Correo de notificación", c.correo],
        ["Teléfono", c.telefono],
        ["Dirección", c.direccion],
        ["Ciudad", c.ciudad],
        ["Banco", c.banco],
        ["Cuenta", `${c.tipoCuenta === "ahorros" ? "Ahorros" : "Corriente"} ${c.numeroCuenta}`],
        ["Creado", `${fechaCreacion(c.createdAt)}${c.creadoPorNombre ? ` por ${c.creadoPorNombre}` : ""}`],
      ]
    : []

  const documentoPorTipo = new Map(c?.documentos.map((d) => [d.tipo, d]) ?? [])

  return (
    <Dialog
      open={c !== null}
      onOpenChange={(abierto) => {
        if (!abierto) {
          setError(null)
          onCerrar()
        }
      }}
    >
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{c?.nombre}</DialogTitle>
        </DialogHeader>
        {c && (
          <div className="space-y-5">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {campos.map(([etiqueta, valor]) => (
                <div key={etiqueta} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
                  <dd className="break-words">{valor}</dd>
                </div>
              ))}
            </dl>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Documentos generales</h3>
              <ul className="divide-y rounded-md border">
                {DOCUMENTOS_POR_PERSONA[c.tipoPersona].map((req) => {
                  const doc = documentoPorTipo.get(req.tipo)
                  return (
                    <li key={req.tipo} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p>{req.titulo}</p>
                        {doc && <p className="truncate text-xs text-muted-foreground" title={doc.nombreArchivo}>{doc.nombreArchivo}</p>}
                      </div>
                      {doc ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={abriendo === doc.id}
                          onClick={async () => {
                            setError(null)
                            setAbriendo(doc.id)
                            await abrirDocumento(doc.id, setError)
                            setAbriendo(null)
                          }}
                        >
                          {abriendo === doc.id ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
                          Ver
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">{req.obligatorio ? "Falta" : "No aplica"}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Nuevo contratista
// ---------------------------------------------------------------------------

const FORMULARIO_VACIO: DatosContratista = {
  tipoPersona: "juridica",
  tipoDocumento: "NIT",
  numeroDocumento: "",
  digitoVerificacion: "",
  nombre: "",
  representanteNombre: "",
  representanteTipoDocumento: "CC",
  representanteNumeroDocumento: "",
  correo: "",
  telefono: "",
  direccion: "",
  ciudad: "",
  banco: "",
  tipoCuenta: "",
  numeroCuenta: "",
}

const claseCampo = (conError: boolean) =>
  `h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary ${
    conError ? "border-destructive" : ""
  }`

function extension(archivo: File) {
  const desdeNombre = archivo.name.includes(".") ? archivo.name.split(".").pop()!.toLowerCase() : ""
  if (/^[a-z0-9]{2,5}$/.test(desdeNombre)) return desdeNombre
  return archivo.type === "application/pdf" ? "pdf" : archivo.type === "image/png" ? "png" : "jpg"
}

function NuevoContratistaDialog({
  abierto,
  onAbiertoChange,
  onCreado,
}: {
  abierto: boolean
  onAbiertoChange: (abierto: boolean) => void
  onCreado: (c: Contratista) => void
}) {
  const [valores, setValores] = useState<DatosContratista>(FORMULARIO_VACIO)
  const [errores, setErrores] = useState<Partial<Record<CampoContratista, string>>>({})
  const [archivos, setArchivos] = useState<Partial<Record<TipoDocumentoContratista, File>>>({})
  const [erroresArchivo, setErroresArchivo] = useState<Partial<Record<TipoDocumentoContratista, string>>>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [paso, setPaso] = useState<"subiendo" | "guardando" | null>(null)
  const guardando = paso !== null
  const juridica = valores.tipoPersona === "juridica"
  const documentos = DOCUMENTOS_POR_PERSONA[valores.tipoPersona]

  function limpiar() {
    setValores(FORMULARIO_VACIO)
    setErrores({})
    setArchivos({})
    setErroresArchivo({})
    setErrorGeneral(null)
  }

  function cambiarAbierto(abrir: boolean) {
    if (guardando) return
    if (!abrir) limpiar()
    onAbiertoChange(abrir)
  }

  function cambiar<K extends CampoContratista>(campo: K, valor: DatosContratista[K]) {
    setValores((v) => ({ ...v, [campo]: valor }))
    if (errores[campo]) setErrores((e) => ({ ...e, [campo]: undefined }))
  }

  function cambiarPersona(tipo: TipoPersona) {
    if (tipo === valores.tipoPersona) return
    setValores((v) => ({ ...v, tipoPersona: tipo, tipoDocumento: tipo === "juridica" ? "NIT" : "CC", digitoVerificacion: "" }))
    setErrores({})
    // Los documentos de un tipo de persona no sirven para el otro (salvo los comunes).
    const validos = new Set(DOCUMENTOS_POR_PERSONA[tipo].map((d) => d.tipo))
    setArchivos((a) => Object.fromEntries(Object.entries(a).filter(([t]) => validos.has(t as TipoDocumentoContratista))))
    setErroresArchivo({})
  }

  function elegirArchivo(tipo: TipoDocumentoContratista, archivo: File | undefined) {
    if (!archivo) return
    const err = validarArchivo(archivo)
    setErroresArchivo((e) => ({ ...e, [tipo]: err ?? undefined }))
    setArchivos((a) => {
      const sig = { ...a }
      if (err) delete sig[tipo]
      else sig[tipo] = archivo
      return sig
    })
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    setErrorGeneral(null)

    const r = validarContratista(valores)
    const faltan: Partial<Record<TipoDocumentoContratista, string>> = {}
    for (const d of documentos) if (d.obligatorio && !archivos[d.tipo]) faltan[d.tipo] = "Adjunta este documento."
    setErrores(r.ok ? {} : r.errores)
    setErroresArchivo(faltan)
    if (!r.ok || Object.keys(faltan).length > 0) {
      setErrorGeneral("Revisa los campos marcados: todos los datos y los documentos obligatorios son necesarios para crear el contratista.")
      return
    }

    const id = crypto.randomUUID()
    const supabase = createClient()
    const subidos: DocumentoSubido[] = []
    setPaso("subiendo")
    try {
      const marca = Date.now()
      await Promise.all(
        documentos
          .filter((d) => archivos[d.tipo])
          .map(async (d) => {
            const archivo = archivos[d.tipo]!
            const ruta = `${id}/${d.tipo}-${marca}.${extension(archivo)}`
            const { error } = await supabase.storage
              .from("contratistas")
              .upload(ruta, archivo, { contentType: archivo.type, upsert: false })
            if (error) throw new Error(`No se pudo subir "${archivo.name}": ${error.message}`)
            subidos.push({ tipo: d.tipo, ruta, nombreArchivo: archivo.name, tamano: archivo.size, mime: archivo.type })
          })
      )

      setPaso("guardando")
      const creado = await crearContratista(id, valores, subidos)
      onCreado(creado)
      limpiar()
      onAbiertoChange(false)
    } catch (err) {
      // No queda nada a medias: los archivos subidos se borran (el contratista
      // no se creó, crear_contratista es una sola transacción).
      if (subidos.length > 0) await supabase.storage.from("contratistas").remove(subidos.map((s) => s.ruta))
      setErrorGeneral(err instanceof Error ? err.message : "No se pudo crear el contratista.")
    } finally {
      setPaso(null)
    }
  }

  const campoTexto = (
    campo: CampoContratista,
    etiqueta: string,
    opciones: { ancho?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; autoFocus?: boolean; placeholder?: string } = {}
  ) => (
    <div className={`min-w-0 space-y-1 ${opciones.ancho ?? ""}`}>
      <label htmlFor={`contratista-${campo}`} className="text-xs font-medium text-muted-foreground">
        {etiqueta}
      </label>
      <input
        id={`contratista-${campo}`}
        value={valores[campo] as string}
        onChange={(e) => cambiar(campo, e.target.value as never)}
        inputMode={opciones.inputMode}
        autoFocus={opciones.autoFocus}
        placeholder={opciones.placeholder}
        disabled={guardando}
        className={claseCampo(Boolean(errores[campo]))}
      />
      {errores[campo] && <p className="text-xs text-destructive">{errores[campo]}</p>}
    </div>
  )

  return (
    <Dialog open={abierto} onOpenChange={cambiarAbierto}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Nuevo contratista</DialogTitle>
        </DialogHeader>

        <form id="form-nuevo-contratista" onSubmit={crear} noValidate className="space-y-6">
          <div className="flex gap-1" role="radiogroup" aria-label="Tipo de persona">
            {(["juridica", "natural"] as const).map((t) => (
              <Button
                key={t}
                type="button"
                role="radio"
                aria-checked={valores.tipoPersona === t}
                variant={valores.tipoPersona === t ? "default" : "outline"}
                onClick={() => cambiarPersona(t)}
                disabled={guardando}
              >
                Persona {ETIQUETA_PERSONA[t].toLowerCase()}
              </Button>
            ))}
          </div>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Identificación</h3>
            <div className="grid gap-3 sm:grid-cols-6">
              {campoTexto("nombre", juridica ? "Razón social *" : "Nombre completo *", { ancho: "sm:col-span-6", autoFocus: true })}
              {juridica ? (
                <>
                  {campoTexto("numeroDocumento", "NIT (sin dígito de verificación) *", { ancho: "sm:col-span-4", inputMode: "numeric", placeholder: "Ej. 900123456" })}
                  {campoTexto("digitoVerificacion", "DV *", { ancho: "sm:col-span-2", inputMode: "numeric" })}
                </>
              ) : (
                <>
                  <div className="min-w-0 space-y-1 sm:col-span-3">
                    <label htmlFor="contratista-tipoDocumento" className="text-xs font-medium text-muted-foreground">
                      Tipo de documento *
                    </label>
                    <select
                      id="contratista-tipoDocumento"
                      value={valores.tipoDocumento}
                      onChange={(e) => cambiar("tipoDocumento", e.target.value as DatosContratista["tipoDocumento"])}
                      disabled={guardando}
                      className={claseCampo(Boolean(errores.tipoDocumento))}
                    >
                      {TIPOS_DOCUMENTO_PERSONA.map((t) => (
                        <option key={t.valor} value={t.valor}>
                          {t.titulo}
                        </option>
                      ))}
                    </select>
                    {errores.tipoDocumento && <p className="text-xs text-destructive">{errores.tipoDocumento}</p>}
                  </div>
                  {campoTexto("numeroDocumento", "Número de documento *", { ancho: "sm:col-span-3", inputMode: valores.tipoDocumento === "CC" ? "numeric" : undefined })}
                </>
              )}
            </div>
          </section>

          {juridica && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Representante legal</h3>
              <div className="grid gap-3 sm:grid-cols-6">
                {campoTexto("representanteNombre", "Nombre completo *", { ancho: "sm:col-span-6" })}
                <div className="min-w-0 space-y-1 sm:col-span-3">
                  <label htmlFor="contratista-representanteTipoDocumento" className="text-xs font-medium text-muted-foreground">
                    Tipo de documento *
                  </label>
                  <select
                    id="contratista-representanteTipoDocumento"
                    value={valores.representanteTipoDocumento}
                    onChange={(e) => cambiar("representanteTipoDocumento", e.target.value as DatosContratista["representanteTipoDocumento"])}
                    disabled={guardando}
                    className={claseCampo(Boolean(errores.representanteTipoDocumento))}
                  >
                    {TIPOS_DOCUMENTO_PERSONA.map((t) => (
                      <option key={t.valor} value={t.valor}>
                        {t.titulo}
                      </option>
                    ))}
                  </select>
                  {errores.representanteTipoDocumento && <p className="text-xs text-destructive">{errores.representanteTipoDocumento}</p>}
                </div>
                {campoTexto("representanteNumeroDocumento", "Número de documento *", { ancho: "sm:col-span-3", inputMode: valores.representanteTipoDocumento === "CC" ? "numeric" : undefined })}
              </div>
            </section>
          )}

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Contacto</h3>
            <div className="grid gap-3 sm:grid-cols-6">
              {campoTexto("correo", "Correo de notificación *", { ancho: "sm:col-span-3", inputMode: "email" })}
              {campoTexto("telefono", "Teléfono *", { ancho: "sm:col-span-3", inputMode: "tel" })}
              {campoTexto("direccion", "Dirección *", { ancho: "sm:col-span-4" })}
              {campoTexto("ciudad", "Ciudad *", { ancho: "sm:col-span-2" })}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Datos bancarios</h3>
            <div className="grid gap-3 sm:grid-cols-6">
              {campoTexto("banco", "Banco *", { ancho: "sm:col-span-2" })}
              <div className="min-w-0 space-y-1 sm:col-span-2">
                <label htmlFor="contratista-tipoCuenta" className="text-xs font-medium text-muted-foreground">
                  Tipo de cuenta *
                </label>
                <select
                  id="contratista-tipoCuenta"
                  value={valores.tipoCuenta}
                  onChange={(e) => cambiar("tipoCuenta", e.target.value as DatosContratista["tipoCuenta"])}
                  disabled={guardando}
                  className={claseCampo(Boolean(errores.tipoCuenta))}
                >
                  <option value="">— Elige —</option>
                  <option value="ahorros">Ahorros</option>
                  <option value="corriente">Corriente</option>
                </select>
                {errores.tipoCuenta && <p className="text-xs text-destructive">{errores.tipoCuenta}</p>}
              </div>
              {campoTexto("numeroCuenta", "Número de cuenta *", { ancho: "sm:col-span-2", inputMode: "numeric" })}
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Documentos generales</h3>
              <p className="text-xs text-muted-foreground">PDF, JPG o PNG de hasta 10 MB.</p>
            </div>
            <ul className="divide-y rounded-md border">
              {documentos.map((d) => {
                const archivo = archivos[d.tipo]
                const err = erroresArchivo[d.tipo]
                const id = `archivo-${d.tipo}`
                return (
                  <li key={d.tipo} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
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
                      disabled={guardando}
                      onChange={(e) => {
                        elegirArchivo(d.tipo, e.target.files?.[0])
                        e.target.value = ""
                      }}
                    />
                    <label
                      htmlFor={id}
                      className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted ${
                        guardando ? "pointer-events-none opacity-50" : ""
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
                        disabled={guardando}
                      >
                        <X className="size-4" />
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        </form>

        {errorGeneral && <p className="text-sm text-destructive">{errorGeneral}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => cambiarAbierto(false)} disabled={guardando}>
            Cancelar
          </Button>
          <Button type="submit" form="form-nuevo-contratista" disabled={guardando}>
            {guardando && <Loader2 className="size-4 animate-spin" />}
            {paso === "subiendo" ? "Subiendo documentos..." : paso === "guardando" ? "Guardando..." : "Crear contratista"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
