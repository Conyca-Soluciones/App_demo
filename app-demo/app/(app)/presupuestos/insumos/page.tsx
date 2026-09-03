"use client"

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { ArrowUp, ArrowDown, ArrowUpDown, Search, X } from "lucide-react"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"

interface Insumo {
  id: string
  codigo: number
  descripcion: string
  tipo: string | null
  u_m: string | null
  agrupacion: string | null
  vr_unitario: number | null
  iva_porcentaje: number | null
  vr_neto: number | null
  iva_descontable: boolean | null
  excluye_iva: boolean | null
  usuario_modificacion: string | null
  fecha_modificacion: string | null
}

type ColumnaOrdenable = "codigo" | "descripcion" | "tipo" | "u_m" | "agrupacion" | "vr_unitario"
type Direccion = "asc" | "desc"

const FILAS_POR_PAGINA = 50

const COLUMNAS: { key: ColumnaOrdenable; label: string; alinear?: "right" }[] = [
  { key: "codigo", label: "Código" },
  { key: "descripcion", label: "Descripción" },
  { key: "tipo", label: "Tipo" },
  { key: "u_m", label: "U.M." },
  { key: "agrupacion", label: "Agrupación" },
  { key: "vr_unitario", label: "Valor unitario promedio", alinear: "right" },
]

export default function MaestroInsumos() {
  const [insumos, setInsumos] = useState<Insumo[]>([])
  const [loading, setLoading] = useState(true)

  const [busqueda, setBusqueda] = useState("")
  const [filtroTipo, setFiltroTipo] = useState("todos")
  const [filtroUM, setFiltroUM] = useState("todos")
  const [filtroAgrupacion, setFiltroAgrupacion] = useState("todos")

  const [columnaOrden, setColumnaOrden] = useState<ColumnaOrdenable>("codigo")
  const [direccionOrden, setDireccionOrden] = useState<Direccion>("asc")

  const [pagina, setPagina] = useState(1)

  // Insumo que se está editando -- null cuando el diálogo está cerrado.
  // Doble click en una fila lo abre (ver <tr onDoubleClick>).
  const [insumoEditando, setInsumoEditando] = useState<Insumo | null>(null)

  useEffect(() => {
    async function fetchInsumos() {
      const supabase = createClient()

      const { data, error } = await supabase
        .from("maestro_insumos")
        .select("*")
        .order("codigo")

      if (error) {
        console.error("Error obteniendo insumos:", error)
        setLoading(false)
        return
      }

      setInsumos(data ?? [])
      setLoading(false)
    }

    fetchInsumos()
  }, [])

  // opciones únicas para los selects de filtro, calculadas de los datos reales
  const tipos = useMemo(
    () => Array.from(new Set(insumos.map((i) => i.tipo).filter((v): v is string => !!v))).sort(),
    [insumos]
  )
  const unidades = useMemo(
    () => Array.from(new Set(insumos.map((i) => i.u_m).filter((v): v is string => !!v))).sort(),
    [insumos]
  )
  const agrupaciones = useMemo(
    () => Array.from(new Set(insumos.map((i) => i.agrupacion).filter((v): v is string => !!v))).sort(),
    [insumos]
  )

  const hayFiltrosActivos =
    busqueda !== "" || filtroTipo !== "todos" || filtroUM !== "todos" || filtroAgrupacion !== "todos"

  function limpiarFiltros() {
    setBusqueda("")
    setFiltroTipo("todos")
    setFiltroUM("todos")
    setFiltroAgrupacion("todos")
  }

  // filtrado + búsqueda + orden, todo en un solo memo
  const filasProcesadas = useMemo(() => {
    const termino = busqueda.trim().toLowerCase()

    const filtradas = insumos.filter((insumo) => {
      if (filtroTipo !== "todos" && insumo.tipo !== filtroTipo) return false
      if (filtroUM !== "todos" && insumo.u_m !== filtroUM) return false
      if (filtroAgrupacion !== "todos" && insumo.agrupacion !== filtroAgrupacion) return false

      if (!termino) return true
      return (
        insumo.descripcion.toLowerCase().includes(termino) ||
        String(insumo.codigo).includes(termino) ||
        (insumo.tipo ?? "").toLowerCase().includes(termino) ||
        (insumo.agrupacion ?? "").toLowerCase().includes(termino)
      )
    })

    const ordenadas = [...filtradas].sort((a, b) => {
      const va = a[columnaOrden]
      const vb = b[columnaOrden]

      if (va === null || va === undefined) return 1
      if (vb === null || vb === undefined) return -1

      const comparacion =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb), "es")

      return direccionOrden === "asc" ? comparacion : -comparacion
    })

    return ordenadas
  }, [insumos, busqueda, filtroTipo, filtroUM, filtroAgrupacion, columnaOrden, direccionOrden])

  // volver a la página 1 cada vez que cambian filtros/búsqueda/orden
  useEffect(() => {
    setPagina(1)
  }, [busqueda, filtroTipo, filtroUM, filtroAgrupacion, columnaOrden, direccionOrden])

  const totalPaginas = Math.max(1, Math.ceil(filasProcesadas.length / FILAS_POR_PAGINA))
  const paginaActual = Math.min(pagina, totalPaginas)
  const filasPagina = filasProcesadas.slice(
    (paginaActual - 1) * FILAS_POR_PAGINA,
    paginaActual * FILAS_POR_PAGINA
  )

  function alternarOrden(columna: ColumnaOrdenable) {
    if (columnaOrden === columna) {
      setDireccionOrden((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setColumnaOrden(columna)
      setDireccionOrden("asc")
    }
  }

  function formatearMoneda(valor: number | null) {
    if (valor === null) return "—"
    return valor.toLocaleString("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    })
  }

  // Cuando se guarda una edición, se actualiza el insumo en `insumos`
  // local (para no tener que recargar toda la tabla de ~5.270 filas de
  // nuevo) y se cierra el diálogo.
  function handleGuardado(actualizado: Insumo) {
    setInsumos((prev) => prev.map((i) => (i.id === actualizado.id ? actualizado : i)))
    setInsumoEditando(null)
  }

  return (
    <div className="space-y-6 p-8">
      {/* Header */}
      <header className="flex h-16 items-center gap-4 border-b px-6">
        <SidebarTrigger />
      <div>
        <h1 className="text-3xl font-semibold">Maestro de Insumos</h1>
        <p className="mt-1 text-muted-foreground">
          {loading
            ? "Consulta y administra los insumos disponibles."
            : `${filasProcesadas.length.toLocaleString("es-CO")} de ${insumos.length.toLocaleString("es-CO")} insumos`}
        </p>
      </div>
      </header>

      {/* Barra de búsqueda + filtros */}
      {!loading && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por código o descripción..."
              className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <select
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value)}
            className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="todos">Todos los tipos</option>
            {tipos.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <select
            value={filtroUM}
            onChange={(e) => setFiltroUM(e.target.value)}
            className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="todos">Todas las U.M.</option>
            {unidades.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>

          <select
            value={filtroAgrupacion}
            onChange={(e) => setFiltroAgrupacion(e.target.value)}
            className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="todos">Todas las agrupaciones</option>
            {agrupaciones.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>

          {hayFiltrosActivos && (
            <button
              onClick={limpiarFiltros}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              Limpiar filtros
            </button>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && <p className="text-sm text-muted-foreground">Cargando insumos...</p>}

      {/* Tabla */}
      {!loading && (
        <>
          <div className="overflow-hidden rounded-xl border">
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                  <tr>
                    {COLUMNAS.map((col) => (
                      <th
                        key={col.key}
                        className={`whitespace-nowrap border-b px-4 py-3 font-medium ${
                          col.alinear === "right" ? "text-right" : "text-left"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => alternarOrden(col.key)}
                          className={`inline-flex select-none items-center gap-1.5 hover:text-foreground ${
                            columnaOrden === col.key ? "text-foreground" : "text-muted-foreground"
                          } ${col.alinear === "right" ? "flex-row-reverse" : ""}`}
                        >
                          {col.label}
                          {columnaOrden === col.key ? (
                            direccionOrden === "asc" ? (
                              <ArrowUp className="h-3.5 w-3.5" />
                            ) : (
                              <ArrowDown className="h-3.5 w-3.5" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/40" />
                          )}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {filasPagina.map((insumo, idx) => (
                    <tr
                      key={insumo.id}
                      onDoubleClick={() => setInsumoEditando(insumo)}
                      title="Doble click para editar este insumo"
                      className={`cursor-pointer border-b last:border-b-0 hover:bg-muted/40 ${
                        idx % 2 === 1 ? "bg-muted/10" : ""
                      }`}
                    >
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {insumo.codigo}
                      </td>
                      <td className="px-4 py-2.5">{insumo.descripcion}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{insumo.tipo ?? "—"}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{insumo.u_m ?? "—"}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{insumo.agrupacion ?? "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono">
                        {formatearMoneda(insumo.vr_unitario)}
                      </td>
                    </tr>
                  ))}

                  {filasPagina.length === 0 && (
                    <tr>
                      <td colSpan={COLUMNAS.length} className="px-4 py-10 text-center text-muted-foreground">
                        No hay insumos que coincidan con la búsqueda o los filtros.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Paginación */}
          {filasProcesadas.length > FILAS_POR_PAGINA && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Página {paginaActual} de {totalPaginas}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPagina((p) => Math.max(1, p - 1))}
                  disabled={paginaActual === 1}
                  className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                  disabled={paginaActual === totalPaginas}
                  className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {insumoEditando && (
        <EditarInsumoDialog
          insumo={insumoEditando}
          tiposConocidos={tipos}
          unidadesConocidas={unidades}
          onCerrar={() => setInsumoEditando(null)}
          onGuardado={handleGuardado}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Diálogo de edición -- se abre con doble click en una fila. Escribe
// directo a Supabase desde el cliente (mismo patrón que ya usa esta
// página para leer) -- la RLS de maestro_insumos ya restringe el UPDATE
// a admin_insumos/es_admin, así que no hace falta duplicar ese chequeo
// acá; si el usuario no tiene permiso, Supabase devuelve el error y se
// muestra tal cual.
// ---------------------------------------------------------------------------

function EditarInsumoDialog({
  insumo,
  tiposConocidos,
  unidadesConocidas,
  onCerrar,
  onGuardado,
}: {
  insumo: Insumo
  tiposConocidos: string[]
  unidadesConocidas: string[]
  onCerrar: () => void
  onGuardado: (actualizado: Insumo) => void
}) {
  const [descripcion, setDescripcion] = useState(insumo.descripcion)
  const [tipo, setTipo] = useState(insumo.tipo ?? "")
  const [uM, setUM] = useState(insumo.u_m ?? "")
  const [agrupacion, setAgrupacion] = useState(insumo.agrupacion ?? "")
  const [vrUnitario, setVrUnitario] = useState(String(insumo.vr_unitario ?? ""))
  const [ivaPorcentaje, setIvaPorcentaje] = useState(String(insumo.iva_porcentaje ?? ""))
  const [excluyeIva, setExcluyeIva] = useState(insumo.excluye_iva ?? false)
  const [ivaDescontable, setIvaDescontable] = useState(insumo.iva_descontable ?? false)
  const [mostrarAvanzado, setMostrarAvanzado] = useState(false)

  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGuardar() {
    if (!descripcion.trim()) {
      setError("La descripción no puede quedar vacía.")
      return
    }
    const vrUnitarioNum = vrUnitario.trim() === "" ? null : Number(vrUnitario)
    if (vrUnitario.trim() !== "" && (Number.isNaN(vrUnitarioNum) || (vrUnitarioNum as number) < 0)) {
      setError("El valor unitario debe ser un número válido.")
      return
    }
    const ivaPorcentajeNum = ivaPorcentaje.trim() === "" ? null : Number(ivaPorcentaje)
    if (ivaPorcentaje.trim() !== "" && Number.isNaN(ivaPorcentajeNum)) {
      setError("El % de IVA debe ser un número válido.")
      return
    }

    setGuardando(true)
    setError(null)
    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      const cambios = {
        descripcion: descripcion.trim(),
        tipo: tipo.trim() || null,
        u_m: uM.trim() || null,
        agrupacion: agrupacion.trim() || null,
        vr_unitario: vrUnitarioNum,
        iva_porcentaje: ivaPorcentajeNum,
        excluye_iva: excluyeIva,
        iva_descontable: ivaDescontable,
        usuario_modificacion: user?.id ?? null,
        fecha_modificacion: new Date().toISOString(),
      }

      const { data, error: errorUpdate } = await supabase
        .from("maestro_insumos")
        .update(cambios)
        .eq("id", insumo.id)
        .select()
        .single()

      if (errorUpdate) throw new Error(errorUpdate.message)

      onGuardado(data as Insumo)
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "No se pudo guardar -- puede que no tengas permiso para editar el maestro de insumos."
      )
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && !guardando && onCerrar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Editar insumo <span className="font-mono text-sm text-muted-foreground">#{insumo.codigo}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Descripción</label>
            <textarea
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              rows={2}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Tipo</label>
              <input
                list="tipos-conocidos"
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <datalist id="tipos-conocidos">
                {tiposConocidos.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Unidad (U.M.)</label>
              <input
                list="unidades-conocidas"
                value={uM}
                onChange={(e) => setUM(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <datalist id="unidades-conocidas">
                {unidadesConocidas.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Agrupación</label>
              <input
                value={agrupacion}
                onChange={(e) => setAgrupacion(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Valor unitario</label>
              <input
                type="number"
                value={vrUnitario}
                onChange={(e) => setVrUnitario(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-right text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setMostrarAvanzado((v) => !v)}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {mostrarAvanzado ? "Ocultar" : "Mostrar"} IVA / avanzado
          </button>

          {mostrarAvanzado && (
            <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/20 p-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">% IVA</label>
                <input
                  type="number"
                  value={ivaPorcentaje}
                  onChange={(e) => setIvaPorcentaje(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-right text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="flex flex-col justify-center gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={excluyeIva}
                    onChange={(e) => setExcluyeIva(e.target.checked)}
                  />
                  Excluye IVA
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={ivaDescontable}
                    onChange={(e) => setIvaDescontable(e.target.checked)}
                  />
                  IVA descontable
                </label>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={onCerrar}
            disabled={guardando}
            className="rounded-lg border px-4 py-2 text-sm hover:bg-muted/40 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleGuardar}
            disabled={guardando}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar cambios"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}