"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, Eye, FileUp, History, Loader2, Pencil, Plus, Search, X } from "lucide-react"
import { HistorialTimeline } from "@/components/historial-timeline"
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
import { VisorDocumento } from "@/components/visor-documento"
import { TablaExcel, type ColumnaExcel, type OrdenExcel } from "@/components/tabla-excel"
import { PanelFiltros } from "@/components/panel-filtros"
import { PaginacionSimple } from "@/components/paginacion-simple"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createClient } from "@/lib/supabase/client"
import { CuentasTercero } from "@/components/cuentas-tercero"
import { NuevoTerceroDialogo } from "@/components/tercero-dialogo"
import { buscarTerceroPorDocumento, listarBancos } from "@/app/(app)/ayf/terceros/actions"
import type { Banco, TerceroBasico } from "@/lib/terceros"
import { ZONA_HORARIA } from "@/lib/fechas"
import {
  DOCUMENTOS_POR_PERSONA,
  TIPOS_DOCUMENTO_PERSONA,
  documentoFormateado,
  esDocumentoContratista,
  tipoPersonaDeTercero,
  validarArchivo,
  validarContratista,
  type CampoContratista,
  type Contratista,
  type DatosContratista,
  type DocumentoContratista,
  type FiltrosContratistas,
  type TipoDocumentoContratista,
  type TipoPersona,
} from "@/lib/contratistas"
import {
  crearContratista,
  editarContratista,
  enlaceDocumentoContratista,
  listarContratistasPagina,
  type DocumentoSubido,
} from "@/app/(app)/contratos/contratistas/actions"


const ETIQUETA_PERSONA: Record<TipoPersona, string> = { natural: "Natural", juridica: "Jurídica" }

// Documentos obligatorios entregados / exigidos, para la columna y el detalle.
// Sin permiso de datos bancarios la certificación bancaria no se ve: no cuenta.
function resumenDocumentos(c: Contratista) {
  const exigidos = DOCUMENTOS_POR_PERSONA[c.tipoPersona].filter(
    (d) => d.obligatorio && (c.datosBancariosVisibles || d.tipo !== "certificacion_bancaria")
  )
  const tiene = new Set(c.documentos.map((d) => d.tipo))
  return { entregados: exigidos.filter((d) => tiene.has(d.tipo)).length, total: exigidos.length }
}

// Fecha de creación en hora de Colombia (cortar el texto ISO daría la fecha
// UTC: lo creado después de las 7 p. m. saldría con el día siguiente).
const fechaCreacion = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { timeZone: ZONA_HORARIA, day: "2-digit", month: "2-digit", year: "numeric" })



// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export function ContratistasView({ puedeCrear }: { puedeCrear: boolean }) {
  // Una página (50) a la vez, filtrada y ordenada en la base: la lista va a
  // crecer mucho. null = todavía no se consultó: no se trae nada hasta
  // presionar Consultar (los filtros por omisión consultan todos).
  const [contratistas, setContratistas] = useState<Contratista[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [pagina, setPagina] = useState(0)
  const [hayMas, setHayMas] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nombre, setNombre] = useState("")
  const [ciudad, setCiudad] = useState("")
  const [filtroPersona, setFiltroPersona] = useState<TipoPersona | "todos">("todos")
  const [orden, setOrden] = useState<OrdenExcel>({ clave: "nombre", dir: "asc" })
  const [nuevoAbierto, setNuevoAbierto] = useState(false)
  const [editando, setEditando] = useState<Contratista | null>(null)
  // Cambia al cerrar el formulario: la próxima vez se monta de cero.
  const [vezFormulario, setVezFormulario] = useState(0)
  const [detalle, setDetalle] = useState<Contratista | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  // La consulta en curso; cada cambio (Consultar, página, orden) trae esa
  // página. null = no se ha presionado Consultar.
  const [consulta, setConsulta] = useState<{ filtros: FiltrosContratistas; pagina: number; orden: OrdenExcel; vez: number } | null>(null)

  useEffect(() => {
    if (!consulta) return
    let activo = true
    listarContratistasPagina(consulta.filtros, consulta.pagina, consulta.orden)
      .then((r: { contratistas: Contratista[]; hayMas: boolean }) => {
        if (!activo) return
        setContratistas(r.contratistas)
        setHayMas(r.hayMas)
        setPagina(consulta.pagina)
        setError(null)
      })
      .catch((e) => activo && setError(e instanceof Error ? e.message : "No se pudieron cargar los contratistas."))
      .finally(() => activo && setCargando(false))
    return () => {
      activo = false
    }
  }, [consulta])

  function cargar(filtros: FiltrosContratistas, pag: number, o: OrdenExcel = orden) {
    setCargando(true)
    setConsulta((c) => ({ filtros, pagina: pag, orden: o, vez: (c?.vez ?? 0) + 1 }))
  }

  function handleConsultar(): boolean {
    setAviso(null)
    cargar(
      {
        nombre: nombre.trim() || undefined,
        ciudad: ciudad.trim() || undefined,
        tipoPersona: filtroPersona === "todos" ? undefined : filtroPersona,
      },
      0
    )
    return true
  }

  function limpiar() {
    setNombre("")
    setCiudad("")
    setFiltroPersona("todos")
  }

  function ordenar(clave: string) {
    const nuevo: OrdenExcel = orden.clave === clave ? { clave, dir: orden.dir === "asc" ? "desc" : "asc" } : { clave, dir: "asc" }
    setOrden(nuevo)
    if (consulta) cargar(consulta.filtros, 0, nuevo)
  }

  const columnas: ColumnaExcel<Contratista>[] = useMemo(
    () => [
      { clave: "nombre", titulo: "Nombre o razón social", ancho: 240, fija: true, flexible: true, texto: (c) => c.nombre },
      { clave: "tipoPersona", titulo: "Persona", ancho: 100, texto: (c) => ETIQUETA_PERSONA[c.tipoPersona] },
      { clave: "documento", titulo: "Documento", ancho: 160, texto: (c) => documentoFormateado(c), claseCelda: "tabular-nums" },
      { clave: "representante", titulo: "Representante legal", ancho: 200, ordenable: false, texto: (c) => c.representanteNombre ?? "" },
      { clave: "correo", titulo: "Correo de notificación", ancho: 220, texto: (c) => c.correo },
      { clave: "telefono", titulo: "Teléfono", ancho: 130, ordenable: false, texto: (c) => c.telefono, claseCelda: "tabular-nums" },
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

      <main className="flex min-h-0 flex-1 gap-4 overflow-auto p-4 sm:p-6">
        <PanelFiltros
          cargando={cargando}
          onConsultar={handleConsultar}
          onLimpiar={limpiar}
          ayuda="Ningún filtro es obligatorio: sin filtros se consultan todos los contratistas."
        >
          <div className="space-y-1.5">
            <Label htmlFor="nombre-contratista">Nombre o documento</Label>
            <Input
              id="nombre-contratista"
              placeholder="Vacío = todos"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConsultar()}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ciudad-contratista">Ciudad</Label>
            <Input
              id="ciudad-contratista"
              placeholder="Vacío = todas"
              value={ciudad}
              onChange={(e) => setCiudad(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConsultar()}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Tipo de persona</Label>
            <Select value={filtroPersona} onValueChange={(v) => setFiltroPersona((v ?? "todos") as TipoPersona | "todos")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="natural">{ETIQUETA_PERSONA.natural}</SelectItem>
                <SelectItem value="juridica">{ETIQUETA_PERSONA.juridica}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </PanelFiltros>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
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

          {contratistas === null && !cargando ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Elige los filtros que quieras y presiona Consultar para ver los contratistas.
            </div>
          ) : contratistas === null ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> Cargando contratistas...
            </div>
          ) : contratistas.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              <p>Ningún contratista coincide con los filtros.</p>
              {puedeCrear && (
                <Button variant="outline" onClick={() => setNuevoAbierto(true)}>
                  <Plus className="size-4" /> Nuevo contratista
                </Button>
              )}
            </div>
          ) : (
            <>
              <TablaExcel
                filas={contratistas}
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
              <PaginacionSimple
                pagina={pagina}
                hayMas={hayMas}
                cargando={cargando}
                onCambiar={(p) => consulta && cargar(consulta.filtros, p)}
              />
            </>
          )}
        </div>
      </main>

      {puedeCrear && (
        <ContratistaFormDialog
          key={`${editando?.id ?? "nuevo"}-${vezFormulario}`}
          abierto={nuevoAbierto || editando !== null}
          editando={editando}
          onAbiertoChange={(abrir) => {
            if (abrir) return
            setNuevoAbierto(false)
            setEditando(null)
            setVezFormulario((n) => n + 1)
          }}
          onGuardado={(c, nuevo) => {
            // Al editar se actualiza la fila; al crear se vuelve a consultar la
            // página (el nuevo puede caer en cualquier lugar del orden).
            if (nuevo && consulta) cargar(consulta.filtros, pagina)
            else setContratistas((prev) => (prev ?? []).map((x) => (x.id === c.id ? c : x)))
            setAviso(nuevo ? `Contratista "${c.nombre}" creado.` : `Contratista "${c.nombre}" actualizado.`)
          }}
        />
      )}

      <DetalleContratistaDialog
        contratista={detalle}
        onCerrar={() => setDetalle(null)}
        onEditar={
          puedeCrear
            ? (c) => {
                setDetalle(null)
                setAviso(null)
                setEditando(c)
              }
            : undefined
        }
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detalle (datos + documentos)
// ---------------------------------------------------------------------------

function DetalleContratistaDialog({
  contratista: c,
  onCerrar,
  onEditar,
}: {
  contratista: Contratista | null
  onCerrar: () => void
  onEditar?: (c: Contratista) => void
}) {
  // Documento abierto en el visor (dentro del mismo diálogo).
  const [viendo, setViendo] = useState<{ id: string; titulo: string; nombreArchivo: string; mime: string } | null>(null)
  const [verHistorial, setVerHistorial] = useState(false)

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
        [c.tipoPersona === "juridica" ? "Cédula del representante expedida en" : "Cédula expedida en", c.cedulaExpedidaEn ?? "—"],
        ["Correo de notificación", c.correo],
        ["Teléfono", c.telefono],
        ["Dirección", c.direccion],
        ["Ciudad", c.ciudad],
        ["Creado", `${fechaCreacion(c.createdAt)}${c.creadoPorNombre ? ` por ${c.creadoPorNombre}` : ""}`],
        ...(c.editadoAt
          ? ([["Última edición", `${fechaCreacion(c.editadoAt)}${c.editadoPorNombre ? ` por ${c.editadoPorNombre}` : ""}`]] as [string, string][])
          : []),
      ]
    : []

  const documentoPorTipo = new Map(c?.documentos.map((d) => [d.tipo, d]) ?? [])

  return (
    <Dialog
      open={c !== null}
      onOpenChange={(abierto) => {
        if (!abierto) {
          setViendo(null)
          setVerHistorial(false)
          onCerrar()
        }
      }}
    >
      <DialogContent className={`max-h-[92svh] overflow-y-auto ${viendo ? "sm:max-w-5xl" : "sm:max-w-2xl"}`}>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
            <span className="min-w-0 flex-1">{c?.nombre}</span>
            {c && onEditar && !viendo && (
              <Button size="sm" variant="outline" onClick={() => onEditar(c)}>
                <Pencil className="size-4" /> Editar
              </Button>
            )}
          </DialogTitle>
        </DialogHeader>
        {c && viendo && (
          <VisorDocumento
            titulo={viendo.titulo}
            nombreArchivo={viendo.nombreArchivo}
            mime={viendo.mime}
            cargarUrl={() => enlaceDocumentoContratista(viendo.id)}
            onVolver={() => setViendo(null)}
          />
        )}
        {c && !viendo && (
          <div className="space-y-5">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {campos.map(([etiqueta, valor]) => (
                <div key={etiqueta} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
                  <dd className="break-words">{valor}</dd>
                </div>
              ))}
            </dl>

            <section className="space-y-1">
              <h3 className="text-sm font-semibold">Cuenta bancaria (en Terceros)</h3>
              <CuentasTercero terceroId={c.terceroId} />
            </section>

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
                          onClick={() => setViendo({ id: doc.id, titulo: req.titulo, nombreArchivo: doc.nombreArchivo, mime: doc.mime })}
                        >
                          <Eye className="size-4" />
                          Ver
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {req.tipo === "certificacion_bancaria" && !c.datosBancariosVisibles ? "Restringido" : req.obligatorio ? "Falta" : "No aplica"}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Historial</h3>
                <Button size="sm" variant="outline" onClick={() => setVerHistorial((v) => !v)}>
                  <History className="size-4" />
                  {verHistorial ? "Ocultar" : "Ver historial"}
                </Button>
              </div>
              {verHistorial && (
                <div className="rounded-md border p-3">
                  <HistorialTimeline tipo="contratista" id={c.id} />
                </div>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Nuevo contratista / editar contratista
// ---------------------------------------------------------------------------

const FORMULARIO_VACIO: DatosContratista = {
  terceroId: "",
  tipoPersona: "juridica",
  representanteNombre: "",
  representanteTipoDocumento: "CC",
  representanteNumeroDocumento: "",
  cedulaExpedidaEn: "",
  correo: "",
  telefono: "",
  direccion: "",
  ciudad: "",
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

// Datos del contratista en el formulario (todo como texto), para editarlo.
function formularioDesde(c: Contratista): DatosContratista {
  return {
    terceroId: c.terceroId,
    tipoPersona: c.tipoPersona,
    representanteNombre: c.representanteNombre ?? "",
    representanteTipoDocumento: c.representanteTipoDocumento ?? "CC",
    representanteNumeroDocumento: c.representanteNumeroDocumento ?? "",
    cedulaExpedidaEn: c.cedulaExpedidaEn ?? "",
    correo: c.correo,
    telefono: c.telefono,
    direccion: c.direccion,
    ciudad: c.ciudad,
  }
}

// Con `editando`, el mismo formulario corrige un contratista: datos llenos, el
// tipo de persona fijo y los documentos actuales; solo se suben los que se
// reemplazan o agregan.
function ContratistaFormDialog({
  abierto,
  editando,
  onAbiertoChange,
  onGuardado,
}: {
  abierto: boolean
  editando: Contratista | null
  onAbiertoChange: (abierto: boolean) => void
  onGuardado: (c: Contratista, nuevo: boolean) => void
}) {
  // Al editar arranca lleno con el contratista (la página monta un formulario
  // nuevo cada vez que se abre: ver `key`).
  const [valores, setValores] = useState<DatosContratista>(() => (editando ? formularioDesde(editando) : FORMULARIO_VACIO))
  const [errores, setErrores] = useState<Partial<Record<CampoContratista, string>>>({})
  const [archivos, setArchivos] = useState<Partial<Record<TipoDocumentoContratista, File>>>({})
  const [erroresArchivo, setErroresArchivo] = useState<Partial<Record<TipoDocumentoContratista, string>>>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [paso, setPaso] = useState<"subiendo" | "guardando" | null>(null)
  const guardando = paso !== null
  const juridica = valores.tipoPersona === "juridica"
  // Al editar sin permiso de datos bancarios no se muestran ni se piden (la
  // base los deja como estaban), ni la certificación bancaria.
  const sinBancarios = Boolean(editando && !editando.datosBancariosVisibles)
  const documentos = DOCUMENTOS_POR_PERSONA[valores.tipoPersona].filter(
    (d) => !sinBancarios || d.tipo !== "certificacion_bancaria"
  )
  const actuales = useMemo(
    () => new Map<TipoDocumentoContratista, DocumentoContratista>((editando?.documentos ?? []).map((d) => [d.tipo, d])),
    [editando]
  )
  // El tercero del contratista (20261222000000): se busca por documento (no por
  // nombre, para no registrar dos veces a la misma persona) o se crea con el
  // formulario de A&F. Al editar queda fijo: lo corrige A&F en Terceros.
  const [tercero, setTercero] = useState<TerceroBasico | null>(() =>
    editando
      ? {
          id: editando.terceroId,
          razonSocial: editando.nombre,
          tipoDocumento: editando.tipoDocumento,
          numeroDocumento: editando.numeroDocumento,
          dv: editando.digitoVerificacion !== null ? String(editando.digitoVerificacion) : null,
        }
      : null
  )
  const [documentoBuscar, setDocumentoBuscar] = useState("")
  const [buscando, setBuscando] = useState(false)
  // Documento buscado que no está en Terceros (para ofrecer crearlo).
  const [noExiste, setNoExiste] = useState<string | null>(null)
  const [errorTercero, setErrorTercero] = useState<string | null>(null)
  const [creandoTercero, setCreandoTercero] = useState(false)
  const [bancos, setBancos] = useState<Banco[]>([])
  useEffect(() => {
    if (editando) return
    let activo = true
    listarBancos()
      .then((lista: Banco[]) => activo && setBancos(lista))
      .catch(() => activo && setBancos([]))
    return () => {
      activo = false
    }
  }, [editando])

  function elegirTercero(t: TerceroBasico) {
    setNoExiste(null)
    if (!esDocumentoContratista(t.tipoDocumento)) {
      setErrorTercero(`Un contratista se identifica con CC, CE, PPT, PA o NIT; ${t.razonSocial} tiene ${t.tipoDocumento}.`)
      return
    }
    setErrorTercero(null)
    setTercero(t)
    const tipo = tipoPersonaDeTercero(t.tipoDocumento)
    setValores((v) => ({ ...v, terceroId: t.id, tipoPersona: tipo }))
    if (errores.terceroId) setErrores((e) => ({ ...e, terceroId: undefined }))
    // Los documentos de un tipo de persona no sirven para el otro (salvo los comunes).
    const validos = new Set(DOCUMENTOS_POR_PERSONA[tipo].map((d) => d.tipo))
    setArchivos((a) => Object.fromEntries(Object.entries(a).filter(([k]) => validos.has(k as TipoDocumentoContratista))))
    setErroresArchivo({})
  }

  function quitarTercero() {
    setTercero(null)
    setValores((v) => ({ ...v, terceroId: "" }))
  }

  async function buscarTercero() {
    const documento = documentoBuscar.trim()
    if (!documento) return
    setBuscando(true)
    setNoExiste(null)
    setErrorTercero(null)
    try {
      const t = await buscarTerceroPorDocumento(documento)
      if (t) elegirTercero(t)
      else setNoExiste(documento)
    } catch (e) {
      setErrorTercero(e instanceof Error ? e.message : "No se pudo buscar el tercero.")
    } finally {
      setBuscando(false)
    }
  }

  function limpiar() {
    setValores(FORMULARIO_VACIO)
    setTercero(null)
    setDocumentoBuscar("")
    setNoExiste(null)
    setErrorTercero(null)
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
    for (const d of documentos) if (d.obligatorio && !archivos[d.tipo] && !actuales.has(d.tipo)) faltan[d.tipo] = "Adjunta este documento."
    setErrores(r.ok ? {} : r.errores)
    setErroresArchivo(faltan)
    if (!r.ok || Object.keys(faltan).length > 0) {
      setErrorGeneral(
        editando
          ? "Revisa los campos marcados: todos los datos y los documentos obligatorios son necesarios."
          : "Revisa los campos marcados: todos los datos y los documentos obligatorios son necesarios para crear el contratista."
      )
      return
    }

    const id = editando?.id ?? crypto.randomUUID()
    const supabase = createClient()
    const subidos: DocumentoSubido[] = []
    setPaso("subiendo")
    try {
      const marca = crypto.randomUUID().slice(0, 8)
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
      if (editando) {
        const r = await editarContratista(id, valores, subidos)
        // Los archivos reemplazados ya no son documento de nadie: se borran
        // (si falla, solo queda un archivo suelto, los datos ya se guardaron).
        if (r.rutasReemplazadas.length > 0) await supabase.storage.from("contratistas").remove(r.rutasReemplazadas)
        onGuardado(r.contratista, false)
      } else {
        onGuardado(await crearContratista(id, valores, subidos), true)
      }
      limpiar()
      onAbiertoChange(false)
    } catch (err) {
      // No queda nada a medias: los archivos subidos se borran (crear y
      // editar son una sola transacción en la base).
      if (subidos.length > 0) await supabase.storage.from("contratistas").remove(subidos.map((s) => s.ruta))
      setErrorGeneral(err instanceof Error ? err.message : editando ? "No se pudo guardar el contratista." : "No se pudo crear el contratista.")
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
          <DialogTitle>{editando ? `Editar contratista · ${editando.nombre}` : "Nuevo contratista"}</DialogTitle>
        </DialogHeader>

        <form id="form-nuevo-contratista" onSubmit={crear} noValidate className="space-y-6">
          {editando && (
            <p className="text-xs text-muted-foreground">
              El tercero no se cambia aquí. Los documentos actuales se conservan; adjunta uno nuevo solo para reemplazarlo.
            </p>
          )}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Tercero</h3>
            {tercero ? (
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border bg-muted/40 p-3 text-sm">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">{tercero.razonSocial}</p>
                  <p className="text-xs text-muted-foreground">
                    {tercero.tipoDocumento} {tercero.numeroDocumento}
                    {tercero.dv ? `-${tercero.dv}` : ""} · Persona {ETIQUETA_PERSONA[valores.tipoPersona].toLowerCase()}
                  </p>
                  <CuentasTercero terceroId={tercero.id} />
                  {editando && (
                    <p className="text-xs text-muted-foreground">
                      El nombre, el documento y la cuenta se corrigen en Terceros (A&amp;F).
                    </p>
                  )}
                </div>
                {!editando && (
                  <Button type="button" size="sm" variant="outline" onClick={quitarTercero} disabled={guardando}>
                    Cambiar
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <label htmlFor="contratista-buscar-documento" className="text-xs font-medium text-muted-foreground">
                      Cédula o NIT del contratista *
                    </label>
                    <input
                      id="contratista-buscar-documento"
                      value={documentoBuscar}
                      onChange={(e) => {
                        setDocumentoBuscar(e.target.value)
                        setNoExiste(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          void buscarTercero()
                        }
                      }}
                      inputMode="numeric"
                      autoFocus
                      placeholder="Ej. 900123456"
                      disabled={guardando}
                      className={claseCampo(Boolean(errores.terceroId))}
                    />
                  </div>
                  <Button type="button" variant="outline" onClick={() => void buscarTercero()} disabled={buscando || !documentoBuscar.trim()}>
                    {buscando ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                    Buscar
                  </Button>
                </div>
                {noExiste && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <span>No hay ningún tercero con el documento {noExiste}.</span>
                    <Button type="button" size="sm" onClick={() => setCreandoTercero(true)}>
                      <Plus className="size-4" /> Crear tercero
                    </Button>
                  </div>
                )}
                {errorTercero && <p className="text-xs text-destructive">{errorTercero}</p>}
                {errores.terceroId && <p className="text-xs text-destructive">{errores.terceroId}</p>}
                <p className="text-xs text-muted-foreground">
                  Se busca por documento para no registrar dos veces a la misma persona o empresa. La cuenta bancaria se
                  registra en el tercero y A&amp;F la verifica.
                </p>
              </div>
            )}
            {!juridica && tercero && (
              <div className="grid gap-3 sm:grid-cols-6">
                {campoTexto("cedulaExpedidaEn", "Cédula expedida en *", { ancho: "sm:col-span-3", placeholder: "Ej. Bogotá" })}
              </div>
            )}
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
                {campoTexto("cedulaExpedidaEn", "Cédula expedida en *", { ancho: "sm:col-span-3", placeholder: "Ej. Bogotá" })}
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
            <div>
              <h3 className="text-sm font-semibold">Documentos generales</h3>
              <p className="text-xs text-muted-foreground">PDF, JPG o PNG de hasta 10 MB.</p>
            </div>
            <ul className="divide-y rounded-md border">
              {documentos.map((d) => {
                const archivo = archivos[d.tipo]
                const actual = actuales.get(d.tipo)
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
                      ) : archivo ? (
                        <p className="truncate text-xs text-muted-foreground" title={archivo.name}>
                          {actual ? `Nuevo: ${archivo.name} (reemplaza a ${actual.nombreArchivo})` : archivo.name}
                        </p>
                      ) : (
                        actual && (
                          <p className="truncate text-xs text-muted-foreground" title={actual.nombreArchivo}>
                            Actual: {actual.nombreArchivo}
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
                      {archivo ? "Cambiar" : actual ? "Reemplazar" : "Adjuntar"}
                    </label>
                    {archivo && (!d.obligatorio || actual) && (
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

        {/* Mismo formulario de A&F (crear un tercero lo puede cualquiera). */}
        {creandoTercero && (
          <NuevoTerceroDialogo
            abierto
            bancos={bancos}
            documentoInicial={noExiste ?? documentoBuscar}
            onCerrar={() => setCreandoTercero(false)}
            onCreado={(t) => {
              setCreandoTercero(false)
              elegirTercero(t)
            }}
            onExistente={(t) => {
              setCreandoTercero(false)
              elegirTercero(t)
            }}
          />
        )}

        {errorGeneral && <p className="text-sm text-destructive">{errorGeneral}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => cambiarAbierto(false)} disabled={guardando}>
            Cancelar
          </Button>
          <Button type="submit" form="form-nuevo-contratista" disabled={guardando}>
            {guardando && <Loader2 className="size-4 animate-spin" />}
            {paso === "subiendo" ? "Subiendo documentos..." : paso === "guardando" ? "Guardando..." : editando ? "Guardar cambios" : "Crear contratista"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
