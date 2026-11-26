"use client"

import { AvisoRevisionTercero } from "@/components/aviso-revision-tercero"

import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, Download, Eye, FileUp, History, Loader2, Pencil, Plus, Trash2, X } from "lucide-react"
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
import { SelectorTercero } from "@/components/selector-tercero"
import type { TerceroBasico } from "@/lib/terceros"
import { formatearFechaSinHora } from "@/lib/fechas"
import {
  DOCUMENTOS_POR_PERSONA,
  TIPOS_DOCUMENTO_PERSONA,
  documentoFormateado,
  documentoQuitable,
  esDocumentoContratista,
  extensionArchivo,
  rutaDocumentoNuevo,
  tipoPersonaDeTercero,
  validarArchivo,
  validarContratista,
  type CampoContratista,
  type CertificacionCuenta,
  type Contratista,
  type DatosContratista,
  type DocumentoContratista,
  type DocumentoRequerido,
  type FiltrosContratistas,
  type TipoDocumentoContratista,
  type TipoPersona,
} from "@/lib/contratistas"
import {
  certificacionesContratista,
  crearContratista,
  editarContratista,
  enlaceCertificacionContratista,
  enlaceDocumentoContratista,
  guardarDocumentoContratista,
  listarContratistas,
  listarContratistasPagina,
  quitarDocumentoContratista,
  type DocumentoSubido,
} from "@/app/(app)/contratos/contratistas/actions"


const ETIQUETA_PERSONA: Record<TipoPersona, string> = { natural: "Natural", juridica: "Jurídica" }

// Formato en blanco de la autorización de datos personales (public/plantillas).
const PLANTILLA_AUTORIZACION_DATOS = "/plantillas/GA-F-025-V4-autorizacion-tratamiento-datos-personales.pdf"

// Documentos obligatorios entregados / exigidos, para la columna y el detalle.
// La certificación bancaria ya no cuenta: vive en la cuenta del tercero.
function resumenDocumentos(c: Contratista) {
  const exigidos = DOCUMENTOS_POR_PERSONA[c.tipoPersona].filter((d) => d.obligatorio)
  const tiene = new Set(c.documentos.map((d) => d.tipo))
  return { entregados: exigidos.filter((d) => tiene.has(d.tipo)).length, total: exigidos.length }
}

// Fecha de creación en hora de Colombia (cortar el texto ISO daría la fecha
// UTC: lo creado después de las 7 p. m. saldría con el día siguiente).
const fechaCreacion = (iso: string) =>
  formatearFechaSinHora(iso)



// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export function ContratistasView({ puedeCrear, revisar = null }: { puedeCrear: boolean; revisar?: string | null }) {
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

  // ?revisar=<id>: viene de Mis pendientes (su tercero cambió); abre ese contratista.
  const [revisarPedido] = useState<string | null>(revisar)
  useEffect(() => {
    if (!revisarPedido) return
    let activo = true
    listarContratistas()
      .then((lista: Contratista[]) => {
        const c = lista.find((x) => x.id === revisarPedido)
        if (activo && c) setDetalle(c)
      })
      .catch(() => {})
      .finally(() => window.history.replaceState(null, "", window.location.pathname))
    return () => {
      activo = false
    }
  }, [revisarPedido])

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

      <main className="flex min-h-0 flex-1 gap-4 overflow-auto p-4 sm:p-6 con-filtros">
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
        puedeGestionar={puedeCrear}
        onCerrar={() => setDetalle(null)}
        onActualizado={(c, mensaje) => {
          setDetalle(c)
          setContratistas((prev) => prev && prev.map((x) => (x.id === c.id ? c : x)))
          setAviso(`${c.nombre} · ${mensaje}`)
        }}
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

type DocumentoEnVisor = { titulo: string; nombreArchivo: string; mime: string; cargarUrl: () => Promise<string> }

function DetalleContratistaDialog({
  contratista: c,
  puedeGestionar,
  onCerrar,
  onEditar,
  onActualizado,
}: {
  contratista: Contratista | null
  puedeGestionar: boolean
  onCerrar: () => void
  onEditar?: (c: Contratista) => void
  onActualizado: (c: Contratista, mensaje: string) => void
}) {
  // Documento abierto en el visor (dentro del mismo diálogo).
  const [viendo, setViendo] = useState<DocumentoEnVisor | null>(null)
  const [verHistorial, setVerHistorial] = useState(false)
  // Documento que se está guardando o quitando (uno a la vez) y el último error.
  const [ocupado, setOcupado] = useState<TipoDocumentoContratista | null>(null)
  const [errorDoc, setErrorDoc] = useState<{ tipo: TipoDocumentoContratista; mensaje: string } | null>(null)
  const [quitando, setQuitando] = useState<DocumentoRequerido | null>(null)

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
  // Certificaciones que el contratista tenía antes de que vivieran en Terceros.
  const certificacionesAnteriores = c?.documentos.filter((d) => d.tipo === "certificacion_bancaria") ?? []

  // Sube el archivo y lo guarda como el documento de ese tipo. Con la misma
  // extensión sobrescribe el archivo en su ruta (la copia de Drive se actualiza).
  async function reemplazar(req: DocumentoRequerido, archivo: File | undefined) {
    if (!c || !archivo) return
    const err = validarArchivo(archivo)
    if (err) {
      setErrorDoc({ tipo: req.tipo, mensaje: err })
      return
    }
    setErrorDoc(null)
    setOcupado(req.tipo)
    const supabase = createClient()
    const actual = documentoPorTipo.get(req.tipo)
    const { ruta, sobrescribe } = rutaDocumentoNuevo(
      c.id,
      req.tipo,
      extensionArchivo(archivo.name, archivo.type),
      actual?.ruta ?? null,
      crypto.randomUUID().slice(0, 8)
    )
    let subido = false
    try {
      const { error } = await supabase.storage
        .from("contratistas")
        .upload(ruta, archivo, { contentType: archivo.type, upsert: sobrescribe })
      if (error) throw new Error(`No se pudo subir "${archivo.name}": ${error.message}`)
      subido = true
      const r = await guardarDocumentoContratista(c.id, {
        tipo: req.tipo,
        ruta,
        nombreArchivo: archivo.name,
        tamano: archivo.size,
        mime: archivo.type,
      })
      // El archivo anterior ya no es documento de nadie (si falla, solo queda suelto).
      if (r.rutaAnterior) await supabase.storage.from("contratistas").remove([r.rutaAnterior])
      onActualizado(r.contratista, `${req.titulo}: ${actual ? "reemplazado" : "agregado"}.`)
    } catch (e) {
      // Un archivo en ruta nueva que no quedó guardado se borra. Uno sobrescrito
      // ya quedó en su lugar: al volver a intentar se corrigen sus datos.
      if (subido && !sobrescribe) await supabase.storage.from("contratistas").remove([ruta])
      setErrorDoc({
        tipo: req.tipo,
        mensaje:
          (e instanceof Error ? e.message : "No se pudo guardar el documento.") +
          (subido && sobrescribe ? " El archivo nuevo ya se subió: vuelve a intentarlo para terminar." : ""),
      })
    } finally {
      setOcupado(null)
    }
  }

  async function quitar(req: DocumentoRequerido) {
    if (!c) return
    setQuitando(null)
    setErrorDoc(null)
    setOcupado(req.tipo)
    try {
      const r = await quitarDocumentoContratista(c.id, req.tipo)
      await createClient().storage.from("contratistas").remove([r.ruta])
      onActualizado(r.contratista, `${req.titulo}: quitado.`)
    } catch (e) {
      setErrorDoc({ tipo: req.tipo, mensaje: e instanceof Error ? e.message : "No se pudo quitar el documento." })
    } finally {
      setOcupado(null)
    }
  }

  return (
    <Dialog
      open={c !== null}
      onOpenChange={(abierto) => {
        if (!abierto && ocupado) return
        if (!abierto) {
          setViendo(null)
          setVerHistorial(false)
          setErrorDoc(null)
          onCerrar()
        }
      }}
    >
      <DialogContent className={`max-h-[92svh] overflow-y-auto ${viendo ? "sm:max-w-5xl" : "sm:max-w-2xl"}`}>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
            <span className="min-w-0 flex-1">{c?.nombre}</span>
            {c && onEditar && !viendo && (
              <Button size="sm" variant="outline" onClick={() => onEditar(c)} disabled={ocupado !== null}>
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
            cargarUrl={viendo.cargarUrl}
            onVolver={() => setViendo(null)}
          />
        )}
        {c && !viendo && (
          <div className="space-y-5">
            {/* Financiera cambió su tercero (20270101006100): lo revisa quien lo creó. */}
            <AvisoRevisionTercero key={`rev-${c.id}`} entidad="contratista" id={c.id} puedeMarcar />
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
              {c.datosBancariosVisibles && (
                <CertificacionesTercero
                  key={`cert-${c.id}`}
                  contratistaId={c.id}
                  anteriores={certificacionesAnteriores}
                  onVer={setViendo}
                />
              )}
            </section>

            <section className="space-y-2">
              <div>
                <h3 className="text-sm font-semibold">Documentos generales</h3>
                {puedeGestionar && (
                  <p className="text-xs text-muted-foreground">
                    PDF, JPG o PNG de hasta 10 MB. Cada cambio se guarda al momento y queda en el historial.
                  </p>
                )}
              </div>
              <ul className="divide-y rounded-md border">
                {DOCUMENTOS_POR_PERSONA[c.tipoPersona].map((req) => {
                  const doc = documentoPorTipo.get(req.tipo)
                  const idInput = `reemplazar-${c.id}-${req.tipo}`
                  const esteOcupado = ocupado === req.tipo
                  return (
                    <li key={req.tipo} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p>{req.titulo}</p>
                        {doc && (
                          <p className="truncate text-xs text-muted-foreground" title={doc.nombreArchivo}>
                            {doc.nombreArchivo} · {fechaCreacion(doc.subidoAt)}
                          </p>
                        )}
                        {errorDoc?.tipo === req.tipo && <p className="text-xs text-destructive">{errorDoc.mensaje}</p>}
                      </div>
                      {esteOcupado && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                      {doc ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={esteOcupado}
                          onClick={() =>
                            setViendo({
                              titulo: req.titulo,
                              nombreArchivo: doc.nombreArchivo,
                              mime: doc.mime,
                              cargarUrl: () => enlaceDocumentoContratista(doc.id),
                            })
                          }
                        >
                          <Eye className="size-4" />
                          Ver
                        </Button>
                      ) : (
                        !puedeGestionar && (
                          <span className="text-xs text-muted-foreground">{req.obligatorio ? "Falta" : "No aplica"}</span>
                        )
                      )}
                      {puedeGestionar && (
                        <>
                          {/* Formato GA-F-025 en blanco: se descarga, se firma y se adjunta aquí mismo. */}
                          {req.tipo === "autorizacion_datos" && !doc && (
                            <a
                              href={PLANTILLA_AUTORIZACION_DATOS}
                              download="GA-F-025 V4 Autorizacion de tratamiento de datos personales.pdf"
                              className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted"
                            >
                              <Download className="size-4" />
                              Plantilla
                            </a>
                          )}
                          <input
                            id={idInput}
                            type="file"
                            accept="application/pdf,image/jpeg,image/png"
                            className="sr-only"
                            disabled={ocupado !== null}
                            onChange={(e) => {
                              void reemplazar(req, e.target.files?.[0])
                              e.target.value = ""
                            }}
                          />
                          <label
                            htmlFor={idInput}
                            className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted ${
                              ocupado !== null ? "pointer-events-none opacity-50" : ""
                            } ${!doc && req.obligatorio ? "border-amber-400" : ""}`}
                          >
                            <FileUp className="size-4" />
                            {doc ? "Reemplazar" : "Adjuntar"}
                          </label>
                          {doc && documentoQuitable(c.tipoPersona, req.tipo) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              disabled={ocupado !== null}
                              onClick={() => setQuitando(req)}
                            >
                              <Trash2 className="size-4" />
                              Quitar
                            </Button>
                          )}
                        </>
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
                  {/* La clave cambia con cada edición: el historial se vuelve a leer. */}
                  <HistorialTimeline key={c.editadoAt ?? c.createdAt} tipo="contratista" id={c.id} />
                </div>
              )}
            </section>
          </div>
        )}
        <Dialog open={quitando !== null} onOpenChange={(abrir) => !abrir && setQuitando(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Quitar {quitando?.titulo.toLowerCase()}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              El archivo se quita del contratista y queda anotado en el historial. La copia que ya está en Google Drive se conserva.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setQuitando(null)}>
                Cancelar
              </Button>
              <Button variant="destructive" onClick={() => quitando && void quitar(quitando)}>
                <Trash2 className="size-4" /> Quitar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}

// Certificación bancaria de las cuentas del tercero (vive en Terceros, la cambia
// Financiera) y las que el contratista tenía antes, solo para ver. Solo se monta
// con ver_datos_bancarios.
function CertificacionesTercero({
  contratistaId,
  anteriores,
  onVer,
}: {
  contratistaId: string
  anteriores: DocumentoContratista[]
  onVer: (d: DocumentoEnVisor) => void
}) {
  const [carga, setCarga] = useState<{ lista: CertificacionCuenta[] | null; error: string | null } | null>(null)

  useEffect(() => {
    let vigente = true
    certificacionesContratista(contratistaId)
      .then((lista: CertificacionCuenta[]) => vigente && setCarga({ lista, error: null }))
      .catch((e) => vigente && setCarga({ lista: null, error: e instanceof Error ? e.message : "No se pudo cargar la certificación." }))
    return () => {
      vigente = false
    }
  }, [contratistaId])

  return (
    <div className="space-y-1 pt-1">
      <p className="text-xs font-medium text-muted-foreground">Certificación bancaria</p>
      {!carga ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Cargando…
        </p>
      ) : carga.error ? (
        <p className="text-xs text-destructive">{carga.error}</p>
      ) : carga.lista!.length === 0 ? (
        <p className="text-xs text-amber-700">Su cuenta no tiene certificación en Terceros: la sube Financiera.</p>
      ) : (
        <ul className="space-y-1">
          {carga.lista!.map((k) => (
            <li key={k.cuentaId} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate" title={k.nombreArchivo}>
                {[k.banco, k.tipoCuenta, k.numeroFinal ? `…${k.numeroFinal}` : null].filter(Boolean).join(" · ")}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onVer({
                    titulo: "Certificación bancaria",
                    nombreArchivo: k.nombreArchivo,
                    mime: k.mime,
                    cargarUrl: () => enlaceCertificacionContratista(contratistaId, k.cuentaId),
                  })
                }
              >
                <Eye className="size-4" /> Ver
              </Button>
            </li>
          ))}
        </ul>
      )}
      {anteriores.map((d) => (
        <div key={d.id} className="flex items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={d.nombreArchivo}>
            Anterior, del contratista ({fechaCreacion(d.subidoAt)})
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              onVer({
                titulo: "Certificación bancaria anterior",
                nombreArchivo: d.nombreArchivo,
                mime: d.mime,
                cargarUrl: () => enlaceDocumentoContratista(d.id),
              })
            }
          >
            <Eye className="size-4" /> Ver
          </Button>
        </div>
      ))}
    </div>
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

// Con `editando`, el mismo formulario corrige los datos de un contratista (el
// tipo de persona queda fijo). Los documentos de un contratista que ya existe se
// cambian uno a uno desde su detalle (20270101007100), no aquí.
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
  // Solo al crear: al editar, los documentos se cambian desde el detalle.
  const documentos = editando ? [] : DOCUMENTOS_POR_PERSONA[valores.tipoPersona]
  // El tercero del contratista (20261222000000): SelectorTercero lo busca por
  // documento o lo crea con el formulario de A&F. Al editar queda fijo.
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

  function elegirTercero(t: TerceroBasico) {
    setTercero(t)
    const tipo = tipoPersonaDeTercero(t.tipoDocumento)
    // El contacto es el del tercero (20270101004300): no se vuelve a pedir.
    const c = t.contacto
    setValores((v) => ({
      ...v,
      terceroId: t.id,
      tipoPersona: tipo,
      ...(c
        ? {
            correo: c.correo || v.correo,
            telefono: c.telefono || v.telefono,
            direccion: c.direccion || v.direccion,
            ciudad: c.ciudad || v.ciudad,
          }
        : {}),
    }))
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

  function limpiar() {
    setValores(FORMULARIO_VACIO)
    setTercero(null)
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
    for (const d of documentos) if (d.obligatorio && !archivos[d.tipo]) faltan[d.tipo] = "Adjunta este documento."
    setErrores(r.ok ? {} : r.errores)
    setErroresArchivo(faltan)
    if (!r.ok || Object.keys(faltan).length > 0) {
      setErrorGeneral(
        editando
          ? "Revisa los campos marcados: todos los datos son necesarios."
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
            const ruta = `${id}/${d.tipo}-${marca}.${extensionArchivo(archivo.name, archivo.type)}`
            const { error } = await supabase.storage
              .from("contratistas")
              .upload(ruta, archivo, { contentType: archivo.type, upsert: false })
            if (error) throw new Error(`No se pudo subir "${archivo.name}": ${error.message}`)
            subidos.push({ tipo: d.tipo, ruta, nombreArchivo: archivo.name, tamano: archivo.size, mime: archivo.type })
          })
      )

      setPaso("guardando")
      // El contacto es el del tercero (lo copia la base) y solo lo cambia Financiera.
      if (editando) {
        const r = await editarContratista(id, valores, [])
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
              El tercero no se cambia aquí. Los documentos se reemplazan o agregan desde el detalle del contratista (doble clic).
            </p>
          )}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Tercero</h3>
            <SelectorTercero
              tercero={tercero}
              onElegir={elegirTercero}
              onQuitar={quitarTercero}
              fijo={editando !== null}
              deshabilitado={guardando}
              etiqueta="Cédula o NIT del contratista *"
              error={errores.terceroId}
              validar={(t) =>
                esDocumentoContratista(t.tipoDocumento)
                  ? null
                  : `Un contratista se identifica con CC, CE, PPT, PA o NIT; ${t.razonSocial} tiene ${t.tipoDocumento}.`
              }
              detalle={<> · Persona {ETIQUETA_PERSONA[valores.tipoPersona].toLowerCase()}</>}
              claseCampo={claseCampo(Boolean(errores.terceroId))}
            />
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
            <div>
              <h3 className="text-sm font-semibold">Contacto</h3>
              <p className="text-xs text-muted-foreground">
                Es el contacto del tercero: aquí solo se ve. Si está mal o falta, lo corrige Financiera en Terceros (20270101006100).
              </p>
            </div>
            <dl className="grid gap-x-6 gap-y-2 rounded-md border bg-muted/30 px-3 py-2 text-sm sm:grid-cols-2">
              {(
                [
                  ["correo", "Correo de notificación"],
                  ["telefono", "Teléfono"],
                  ["direccion", "Dirección"],
                  ["ciudad", "Ciudad"],
                ] as const
              ).map(([k, t]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{t}</dt>
                  <dd className="break-words">{valores[k] || <span className="text-amber-700">Falta en el tercero</span>}</dd>
                  {errores[k] && <p className="text-xs text-destructive">Falta en el tercero: pídele a Financiera que lo complete.</p>}
                </div>
              ))}
            </dl>
          </section>

          {!editando && (
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
                    {/* Formato GA-F-025 en blanco: se descarga, se firma y se adjunta aquí mismo. */}
                    {d.tipo === "autorizacion_datos" && (
                      <a
                        href={PLANTILLA_AUTORIZACION_DATOS}
                        download="GA-F-025 V4 Autorizacion de tratamiento de datos personales.pdf"
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted"
                        title="Formato GA-F-025 V4 en blanco: el contratista lo llena y lo firma"
                      >
                        <Download className="size-4" />
                        Descargar plantilla
                      </a>
                    )}
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
            <p className="text-xs text-muted-foreground">
              La certificación bancaria va con la cuenta del tercero (Terceros): no se adjunta aquí.
            </p>
          </section>
          )}
        </form>

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
