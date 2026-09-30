"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2, Plus, Search, X } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { actualizarProveedor, crearProveedor, listarProveedores } from "@/app/(app)/almacen/proveedores/actions"
import { ETIQUETA_CAMPO, OPCIONES, validarCampo, type CampoEditable, type Proveedor } from "@/lib/proveedores"

// ---------------------------------------------------------------------------
// Proveedores: tabla tipo Excel con edición en línea (clic en la celda,
// Enter guarda, Esc cancela). En pantallas chicas la tabla se vuelve una
// lista de tarjetas con los mismos campos editables.
//
// Para que los textos nunca se monten: tabla con `table-fixed` y ancho fijo
// por columna, cada celda con `truncate` y el texto completo en `title`
// (hover) y al editar. Las dos primeras columnas (ID y Proveedor) quedan fijas
// al hacer scroll horizontal.
// ---------------------------------------------------------------------------

type Columna = {
  campo: CampoEditable | "idProv"
  titulo: string
  ancho: number // px
  alinear?: "right" | "center"
}

const COLUMNAS: Columna[] = [
  { campo: "idProv", titulo: "ID", ancho: 76 },
  { campo: "nombre", titulo: "Proveedor", ancho: 300 },
  { campo: "estado", titulo: "Estado", ancho: 116, alinear: "center" },
  { campo: "tipoProveedor", titulo: "Tipo", ancho: 168 },
  { campo: "tipoDocumento", titulo: "Doc.", ancho: 84 },
  { campo: "numeroDocumento", titulo: "Número", ancho: 136, alinear: "right" },
  { campo: "digitoVerificacion", titulo: "DV", ancho: 72, alinear: "center" },
  { campo: "nombreContacto", titulo: "Contacto", ancho: 200 },
  { campo: "telefono", titulo: "Teléfono", ancho: 150 },
  { campo: "correo", titulo: "Correo", ancho: 250 },
  { campo: "ciudad", titulo: "Ciudad", ancho: 140 },
  { campo: "direccion", titulo: "Dirección", ancho: 290 },
]
const ANCHO_TABLA = COLUMNAS.reduce((acc, c) => acc + c.ancho, 0)
// Las columnas fijas a la izquierda (ID y Proveedor) y su offset.
const IZQUIERDA_FIJA: Partial<Record<Columna["campo"], number>> = { idProv: 0, nombre: COLUMNAS[0].ancho }

const ETIQUETA = ETIQUETA_CAMPO
// Orden de los campos en la tarjeta de móvil (nombre y estado van arriba).
const CAMPOS_TARJETA: CampoEditable[] = [
  "tipoProveedor",
  "tipoDocumento",
  "numeroDocumento",
  "digitoVerificacion",
  "nombreContacto",
  "telefono",
  "correo",
  "ciudad",
  "direccion",
]

type FiltroEstado = "todos" | "ACTIVO" | "INACTIVO"
type Orden = { campo: Columna["campo"]; dir: "asc" | "desc" }
type Aviso = { tipo: "ok" | "error"; texto: string } | null

const TAMANO_PAGINA_MOVIL = 40

function normalizar(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
}

// Texto a MOSTRAR (no a editar) de un campo.
function textoVisible(p: Proveedor, campo: Columna["campo"]): string {
  const v = p[campo]
  if (v === null || v === undefined || v === "") return ""
  if (campo === "numeroDocumento") return Number(v).toLocaleString("es-CO")
  return String(v)
}

// Texto con el que ARRANCA el input al editar.
function textoEditable(p: Proveedor, campo: CampoEditable): string {
  const v = p[campo]
  return v === null || v === undefined ? "" : String(v)
}

function BadgeEstado({ estado }: { estado: string | null }) {
  if (!estado) return <span className="text-xs text-muted-foreground">—</span>
  const activo = estado === "ACTIVO"
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        activo
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {activo ? "Activo" : estado === "INACTIVO" ? "Inactivo" : estado}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Celda editable (sirve igual en la tabla y en la tarjeta de móvil).
// ---------------------------------------------------------------------------

function CeldaEditable({
  proveedor,
  campo,
  puedeEditar,
  onGuardar,
  alinear,
  multilinea = false,
  className = "",
}: {
  proveedor: Proveedor
  campo: CampoEditable
  puedeEditar: boolean
  onGuardar: (p: Proveedor, campo: CampoEditable, texto: string) => Promise<string | null>
  alinear?: "right" | "center"
  // true = el texto baja de línea en vez de cortarse con "…" (nombre en la
  // tarjeta de móvil, donde hay alto de sobra pero poco ancho).
  multilinea?: boolean
  className?: string
}) {
  const [editando, setEditando] = useState(false)
  const [borrador, setBorrador] = useState("")
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const opciones = OPCIONES[campo]
  const visible = textoVisible(proveedor, campo)
  const claseAlineacion = alinear === "right" ? "text-right" : alinear === "center" ? "text-center" : "text-left"
  const claseTexto = multilinea ? "whitespace-normal break-words" : "truncate"

  useEffect(() => {
    if (editando && !opciones) inputRef.current?.select()
  }, [editando, opciones])

  // Tras un error se devuelve el foco al campo. Va en un efecto (y no justo
  // después del await) porque en ese momento el input sigue `disabled` por
  // `guardando` y focus() no hace nada -- el foco se perdía y ni Esc ni el
  // clic afuera cerraban la celda.
  useEffect(() => {
    if (editando && error && !guardando) inputRef.current?.focus()
  }, [editando, error, guardando])

  function empezar() {
    if (!puedeEditar || guardando) return
    setBorrador(textoEditable(proveedor, campo))
    setError(null)
    setEditando(true)
  }

  function cancelar() {
    setEditando(false)
    setError(null)
  }

  // alSalir = se llamó por blur (clic en otra parte). Si falla en ese caso,
  // se descarta el cambio en vez de retener el foco: si no, la celda con
  // error "atrapa" al usuario (cada clic afuera reintenta, falla y vuelve a
  // enfocar). El motivo queda en el aviso de arriba de la tabla.
  async function guardar(texto: string, alSalir = false) {
    if (texto.trim() === textoEditable(proveedor, campo).trim()) {
      cancelar()
      return
    }
    setGuardando(true)
    const err = await onGuardar(proveedor, campo, texto)
    setGuardando(false)
    if (err) {
      if (alSalir) {
        setEditando(false)
        setError(null)
        return
      }
      setError(err)
      return
    }
    setEditando(false)
    setError(null)
  }

  const contenido =
    campo === "estado" ? <BadgeEstado estado={proveedor.estado} /> : visible || <span className="text-muted-foreground/60">—</span>

  if (!editando) {
    if (!puedeEditar) {
      return (
        <div className={`${claseTexto} px-3 py-2 ${claseAlineacion} ${className}`} title={visible || undefined}>
          {contenido}
        </div>
      )
    }
    return (
      <button
        type="button"
        onClick={empezar}
        title={visible ? `${visible} — clic para editar` : "Clic para editar"}
        className={`block w-full min-w-0 cursor-text ${claseTexto} px-3 py-2 outline-none hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset ${claseAlineacion} ${className}`}
      >
        {contenido}
      </button>
    )
  }

  const claseCampo = `h-9 w-full min-w-0 bg-background px-3 text-sm outline-none ring-2 ring-inset ${
    error ? "ring-destructive" : "ring-primary"
  } ${claseAlineacion}`

  return (
    <div className="relative" title={error ?? undefined}>
      {opciones ? (
        <select
          autoFocus
          value={borrador}
          disabled={guardando}
          onChange={(e) => {
            setBorrador(e.target.value)
            guardar(e.target.value)
          }}
          onBlur={() => !guardando && cancelar()}
          onKeyDown={(e) => e.key === "Escape" && cancelar()}
          className={claseCampo}
        >
          <option value="">— Sin valor —</option>
          {opciones.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          ref={inputRef}
          autoFocus
          value={borrador}
          disabled={guardando}
          inputMode={campo === "numeroDocumento" || campo === "digitoVerificacion" ? "numeric" : campo === "telefono" ? "tel" : campo === "correo" ? "email" : undefined}
          onChange={(e) => {
            setBorrador(e.target.value)
            if (error) setError(null)
          }}
          onBlur={() => !guardando && guardar(borrador, true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              guardar(borrador)
            } else if (e.key === "Escape") {
              e.preventDefault()
              cancelar()
            }
          }}
          className={`${claseCampo} ${guardando ? "pr-8" : ""}`}
        />
      )}
      {guardando && (
        <Loader2 className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Diálogo "Nuevo proveedor". El ID (PV0395...) lo asigna el servidor.
// ---------------------------------------------------------------------------

// Orden de los campos en el formulario (nombre ocupa toda la fila).
const CAMPOS_FORMULARIO: CampoEditable[] = [
  "nombre",
  "tipoProveedor",
  "estado",
  "tipoDocumento",
  "numeroDocumento",
  "digitoVerificacion",
  "nombreContacto",
  "telefono",
  "correo",
  "ciudad",
  "direccion",
]
const FORMULARIO_VACIO: Partial<Record<CampoEditable, string>> = { estado: "ACTIVO" }

function NuevoProveedorDialog({
  abierto,
  onAbiertoChange,
  onCreado,
}: {
  abierto: boolean
  onAbiertoChange: (abierto: boolean) => void
  onCreado: (p: Proveedor) => void
}) {
  const [valores, setValores] = useState<Partial<Record<CampoEditable, string>>>(FORMULARIO_VACIO)
  const [errores, setErrores] = useState<Partial<Record<CampoEditable, string>>>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  function cambiarAbierto(abrir: boolean) {
    if (guardando) return
    if (!abrir) {
      setValores(FORMULARIO_VACIO)
      setErrores({})
      setErrorGeneral(null)
    }
    onAbiertoChange(abrir)
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    const nuevosErrores: Partial<Record<CampoEditable, string>> = {}
    for (const campo of CAMPOS_FORMULARIO) {
      const crudo = valores[campo] ?? ""
      if (campo !== "nombre" && crudo.trim() === "") continue
      const r = validarCampo(campo, crudo)
      if (!r.ok) nuevosErrores[campo] = r.error
    }
    setErrores(nuevosErrores)
    if (Object.keys(nuevosErrores).length > 0) return

    setGuardando(true)
    setErrorGeneral(null)
    try {
      const creado = await crearProveedor(valores)
      onCreado(creado)
      setValores(FORMULARIO_VACIO)
      onAbiertoChange(false)
    } catch (err) {
      setErrorGeneral(err instanceof Error ? err.message : "No se pudo crear el proveedor.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={cambiarAbierto}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nuevo proveedor</DialogTitle>
        </DialogHeader>
        <form id="form-nuevo-proveedor" onSubmit={crear} className="grid gap-3 sm:grid-cols-2" noValidate>
          {CAMPOS_FORMULARIO.map((campo) => {
            const opciones = OPCIONES[campo]
            const id = `nuevo-proveedor-${campo}`
            const claseCampo = `h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              errores[campo] ? "border-destructive" : ""
            }`
            return (
              <div key={campo} className={`min-w-0 space-y-1 ${campo === "nombre" || campo === "direccion" ? "sm:col-span-2" : ""}`}>
                <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
                  {campo === "nombre" ? "Nombre del proveedor *" : ETIQUETA[campo]}
                </label>
                {opciones ? (
                  <select
                    id={id}
                    value={valores[campo] ?? ""}
                    onChange={(e) => setValores((v) => ({ ...v, [campo]: e.target.value }))}
                    className={claseCampo}
                  >
                    <option value="">— Sin valor —</option>
                    {opciones.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={id}
                    autoFocus={campo === "nombre"}
                    value={valores[campo] ?? ""}
                    inputMode={campo === "numeroDocumento" || campo === "digitoVerificacion" ? "numeric" : campo === "telefono" ? "tel" : campo === "correo" ? "email" : undefined}
                    onChange={(e) => {
                      setValores((v) => ({ ...v, [campo]: e.target.value }))
                      if (errores[campo]) setErrores((er) => ({ ...er, [campo]: undefined }))
                    }}
                    className={claseCampo}
                  />
                )}
                {errores[campo] && <p className="text-xs text-destructive">{errores[campo]}</p>}
              </div>
            )
          })}
        </form>
        {errorGeneral && <p className="text-sm text-destructive">{errorGeneral}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => cambiarAbierto(false)} disabled={guardando}>
            Cancelar
          </Button>
          <Button type="submit" form="form-nuevo-proveedor" disabled={guardando}>
            {guardando && <Loader2 className="size-4 animate-spin" />}
            Crear proveedor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export function ProveedoresView({ puedeEditar }: { puedeEditar: boolean }) {
  const [proveedores, setProveedores] = useState<Proveedor[] | null>(null)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState("")
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("todos")
  const [filtroTipo, setFiltroTipo] = useState("todos")
  const [orden, setOrden] = useState<Orden>({ campo: "nombre", dir: "asc" })
  // Cuántas tarjetas se ven en móvil. Vuelve al tamaño inicial cuando cambian
  // los filtros (se guarda junto a la "clave" de filtros con la que se amplió).
  const [paginaMovil, setPaginaMovil] = useState({ clave: "", n: TAMANO_PAGINA_MOVIL })
  const [aviso, setAviso] = useState<Aviso>(null)
  const [nuevoAbierto, setNuevoAbierto] = useState(false)

  useEffect(() => {
    listarProveedores()
      .then((lista: Proveedor[]) => setProveedores(lista))
      .catch((e) => setErrorCarga(e instanceof Error ? e.message : "No se pudieron cargar los proveedores."))
  }, [])

  // El aviso de "guardado" se va solo; el de error se queda hasta el próximo.
  useEffect(() => {
    if (aviso?.tipo !== "ok") return
    const t = setTimeout(() => setAviso(null), 2500)
    return () => clearTimeout(t)
  }, [aviso])

  const conteoEstado = useMemo(() => {
    const c = { todos: 0, ACTIVO: 0, INACTIVO: 0 }
    for (const p of proveedores ?? []) {
      c.todos++
      if (p.estado === "ACTIVO") c.ACTIVO++
      if (p.estado === "INACTIVO") c.INACTIVO++
    }
    return c
  }, [proveedores])

  const filtrados = useMemo(() => {
    if (!proveedores) return []
    const q = normalizar(busqueda.trim())
    const lista = proveedores.filter((p) => {
      if (filtroEstado !== "todos" && p.estado !== filtroEstado) return false
      if (filtroTipo === "sin" && p.tipoProveedor) return false
      if (filtroTipo !== "todos" && filtroTipo !== "sin" && p.tipoProveedor !== filtroTipo) return false
      if (!q) return true
      return normalizar(
        [p.idProv, p.nombre, p.numeroDocumento, p.nombreContacto, p.telefono, p.correo, p.ciudad, p.direccion]
          .filter(Boolean)
          .join(" ")
      ).includes(q)
    })
    const signo = orden.dir === "asc" ? 1 : -1
    return lista.sort((a, b) => {
      const va = a[orden.campo]
      const vb = b[orden.campo]
      // Vacíos siempre al final, sin importar la dirección.
      if (va === null || va === "") return vb === null || vb === "" ? 0 : 1
      if (vb === null || vb === "") return -1
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * signo
      return String(va).localeCompare(String(vb), "es", { numeric: true, sensitivity: "base" }) * signo
    })
  }, [proveedores, busqueda, filtroEstado, filtroTipo, orden])

  const claveFiltros = `${busqueda}|${filtroEstado}|${filtroTipo}`
  const visiblesMovil = paginaMovil.clave === claveFiltros ? paginaMovil.n : TAMANO_PAGINA_MOVIL

  async function guardar(p: Proveedor, campo: CampoEditable, texto: string): Promise<string | null> {
    const validado = validarCampo(campo, texto)
    if (!validado.ok) {
      setAviso({ tipo: "error", texto: `No se guardó ${ETIQUETA[campo].toLowerCase()} de ${p.nombre}: ${validado.error}` })
      return validado.error
    }
    try {
      const actualizado = await actualizarProveedor(p.uniqueId, campo, texto)
      setProveedores((prev) => prev?.map((x) => (x.uniqueId === actualizado.uniqueId ? actualizado : x)) ?? prev)
      setAviso({ tipo: "ok", texto: `Guardado: ${ETIQUETA[campo].toLowerCase()} de ${actualizado.nombre}.` })
      return null
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : "No se pudo guardar."
      setAviso({ tipo: "error", texto: mensaje })
      return mensaje
    }
  }

  function alternarOrden(campo: Columna["campo"]) {
    setOrden((prev) => (prev.campo === campo ? { campo, dir: prev.dir === "asc" ? "desc" : "asc" } : { campo, dir: "asc" }))
  }

  const hayFiltros = busqueda !== "" || filtroEstado !== "todos" || filtroTipo !== "todos"

  return (
    <>
      <header className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-3 sm:px-6">
        <SidebarTrigger />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Proveedores</h1>
          <p className="text-sm text-muted-foreground">
            {puedeEditar
              ? "Haz clic en una celda para editarla. Enter guarda, Esc cancela."
              : "Consulta de proveedores (solo lectura)."}
          </p>
        </div>
        {puedeEditar && (
          <Button className="ml-auto gap-1.5" onClick={() => setNuevoAbierto(true)}>
            <Plus className="size-4" /> Nuevo proveedor
          </Button>
        )}
      </header>

      {puedeEditar && (
        <NuevoProveedorDialog
          abierto={nuevoAbierto}
          onAbiertoChange={setNuevoAbierto}
          onCreado={(p) => {
            setProveedores((prev) => (prev ? [...prev, p] : [p]))
            // Que se vea: se limpian los filtros y la búsqueda apunta al nuevo.
            setFiltroEstado("todos")
            setFiltroTipo("todos")
            setBusqueda(p.idProv ?? p.nombre)
            setAviso({ tipo: "ok", texto: `Proveedor creado: ${p.nombre} (${p.idProv}).` })
          }}
        />
      )}

      <main className="@container mx-auto w-full max-w-[1800px] min-w-0 flex-1 space-y-4 p-4 sm:p-6">
        {/* Barra de filtros: se acomoda en varias líneas en pantallas chicas */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar nombre, NIT, contacto, ciudad…"
              className="h-9 pr-8 pl-9"
            />
            {busqueda && (
              <button
                type="button"
                onClick={() => setBusqueda("")}
                aria-label="Limpiar búsqueda"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          <div className="inline-flex rounded-md border p-0.5" role="tablist" aria-label="Filtrar por estado">
            {(
              [
                ["todos", "Todos"],
                ["ACTIVO", "Activos"],
                ["INACTIVO", "Inactivos"],
              ] as const
            ).map(([valor, etiqueta]) => (
              <button
                key={valor}
                type="button"
                role="tab"
                aria-selected={filtroEstado === valor}
                onClick={() => setFiltroEstado(valor)}
                className={`rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                  filtroEstado === valor ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {etiqueta} <span className="tabular-nums opacity-70">{conteoEstado[valor]}</span>
              </button>
            ))}
          </div>

          <select
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value)}
            aria-label="Filtrar por tipo de proveedor"
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="todos">Todos los tipos</option>
            {OPCIONES.tipoProveedor!.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            <option value="sin">Sin tipo</option>
          </select>

          {hayFiltros && (
            <button
              type="button"
              onClick={() => {
                setBusqueda("")
                setFiltroEstado("todos")
                setFiltroTipo("todos")
              }}
              className="text-xs text-primary hover:underline"
            >
              Quitar filtros
            </button>
          )}

          <span className="text-xs text-muted-foreground tabular-nums sm:ml-auto">
            {proveedores ? `${filtrados.length} de ${proveedores.length} proveedores` : ""}
          </span>
        </div>

        <div aria-live="polite" className="min-h-5 text-sm">
          {aviso && (
            <p className={aviso.tipo === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}>{aviso.texto}</p>
          )}
        </div>

        {errorCarga && <p className="text-sm text-destructive">{errorCarga}</p>}

        {!proveedores && !errorCarga && (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        )}

        {proveedores && filtrados.length === 0 && (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            {proveedores.length === 0 ? "No hay proveedores para mostrar." : "Ningún proveedor coincide con los filtros."}
          </div>
        )}

        {proveedores && filtrados.length > 0 && (
          <>
            {/* ---------- Tabla ----------
                Se decide por el ANCHO DISPONIBLE de la página (container
                query), no por el de la pantalla: en una tablet con el menú
                lateral abierto quedan ~460px y la tabla no cabe bien. */}
            <div className="hidden max-h-[calc(100svh-15rem)] overflow-auto rounded-lg border @3xl:block">
              <table className="table-fixed border-separate border-spacing-0 text-sm" style={{ width: ANCHO_TABLA }}>
                <colgroup>
                  {COLUMNAS.map((c) => (
                    <col key={c.campo} style={{ width: c.ancho }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {COLUMNAS.map((c) => {
                      const izquierda = IZQUIERDA_FIJA[c.campo]
                      const activa = orden.campo === c.campo
                      return (
                        <th
                          key={c.campo}
                          scope="col"
                          aria-sort={activa ? (orden.dir === "asc" ? "ascending" : "descending") : "none"}
                          style={izquierda !== undefined ? { left: izquierda } : undefined}
                          className={`sticky top-0 border-r border-b border-primary-foreground/15 bg-primary p-0 text-xs font-medium text-primary-foreground last:border-r-0 ${
                            izquierda !== undefined ? "z-30" : "z-20"
                          } ${c.campo === "nombre" ? "shadow-[2px_0_0_0_var(--border)]" : ""}`}
                        >
                          <button
                            type="button"
                            onClick={() => alternarOrden(c.campo)}
                            className={`flex w-full items-center gap-1 px-3 py-2.5 ${
                              c.alinear === "right" ? "justify-end" : c.alinear === "center" ? "justify-center" : ""
                            }`}
                          >
                            <span className="truncate">{c.titulo}</span>
                            {activa ? (
                              orden.dir === "asc" ? <ArrowUp className="size-3 shrink-0" /> : <ArrowDown className="size-3 shrink-0" />
                            ) : (
                              <ArrowUpDown className="size-3 shrink-0 opacity-40" />
                            )}
                          </button>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((p) => (
                    <tr key={p.uniqueId} className="group">
                      {COLUMNAS.map((c) => {
                        const izquierda = IZQUIERDA_FIJA[c.campo]
                        return (
                          <td
                            key={c.campo}
                            style={izquierda !== undefined ? { left: izquierda } : undefined}
                            className={`h-9 max-w-0 border-r border-b bg-background p-0 align-middle last:border-r-0 group-hover:bg-muted ${
                              izquierda !== undefined ? "sticky z-10" : ""
                            } ${c.campo === "nombre" ? "font-medium shadow-[2px_0_0_0_var(--border)]" : ""}`}
                          >
                            {c.campo === "idProv" ? (
                              <div className="truncate px-3 py-2 text-xs text-muted-foreground tabular-nums" title={p.idProv ?? undefined}>
                                {p.idProv}
                              </div>
                            ) : (
                              <CeldaEditable
                                proveedor={p}
                                campo={c.campo}
                                puedeEditar={puedeEditar}
                                onGuardar={guardar}
                                alinear={c.alinear}
                                className={c.campo === "numeroDocumento" ? "tabular-nums" : ""}
                              />
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ---------- Tarjetas (poco espacio) ---------- */}
            <ul className="grid items-start gap-3 @xl:grid-cols-2 @3xl:hidden">
              {filtrados.slice(0, visiblesMovil).map((p) => (
                <li key={p.uniqueId} className="overflow-hidden rounded-lg border">
                  <div className="flex items-start gap-2 border-b bg-muted/40 px-1 py-1">
                    <div className="min-w-0 flex-1">
                      <CeldaEditable
                        proveedor={p}
                        campo="nombre"
                        puedeEditar={puedeEditar}
                        onGuardar={guardar}
                        multilinea
                        className="font-medium"
                      />
                      <p className="px-3 pb-1 text-xs text-muted-foreground tabular-nums">ID {p.idProv}</p>
                    </div>
                    <div className="w-28 shrink-0">
                      <CeldaEditable proveedor={p} campo="estado" puedeEditar={puedeEditar} onGuardar={guardar} alinear="center" />
                    </div>
                  </div>
                  <dl className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] text-sm">
                    {CAMPOS_TARJETA.map((campo) => (
                      <div key={campo} className="contents">
                        <dt className="truncate border-b px-3 py-2 text-xs text-muted-foreground">{ETIQUETA[campo]}</dt>
                        <dd className="min-w-0 border-b">
                          <CeldaEditable proveedor={p} campo={campo} puedeEditar={puedeEditar} onGuardar={guardar} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
            {filtrados.length > visiblesMovil && (
              <button
                type="button"
                onClick={() => setPaginaMovil({ clave: claveFiltros, n: visiblesMovil + TAMANO_PAGINA_MOVIL })}
                className="w-full rounded-md border py-2 text-sm font-medium @3xl:hidden"
              >
                Mostrar más ({filtrados.length - visiblesMovil} restantes)
              </button>
            )}
          </>
        )}
      </main>
    </>
  )
}
