"use client"

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Search, X } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { EncabezadoPagina } from "@/components/encabezado-pagina"
import { TablaExcel, PaginacionExcel, type ColumnaExcel } from "@/components/tabla-excel"

interface Insumo {
  id: string
  codigo: number
  descripcion: string
  tipo: string | null
  u_m: string | null
  agrupacion: string | null
  // Precio base que precios_efectivos_insumos usa como respaldo cuando el
  // insumo no tiene historial de compras -- ya NO se edita desde acá
  // (decisión de negocio: esta pantalla pasó a ser de solo consulta; el
  // respaldo se fija al crear el insumo, vía el flujo de "solicitar
  // insumo nuevo" al armar un APU). Se sigue trayendo únicamente como
  // fallback local, por si el RPC de abajo no devuelve fila para este id.
  vr_unitario: number | null
  // Campo calculado del lado del cliente -- NO existe en maestro_insumos.
  // null mientras todavía no se ha calculado (ver fetchPreciosEfectivos).
  precioEfectivo: number | null
}

type ColumnaOrdenable = "codigo" | "descripcion" | "tipo" | "u_m" | "agrupacion" | "precioEfectivo"
type Direccion = "asc" | "desc"

const FILAS_POR_PAGINA = 50

// precios_efectivos_insumos no está pensado para recibir miles de ids de
// una sola vez -- se pide en lotes, en paralelo (mismo criterio que ya
// usa matchearYGuardarImportApu en presupuestos/actions.ts).
const TAMANO_LOTE_PRECIOS_EFECTIVOS = 200

export default function MaestroInsumos() {
  const [insumos, setInsumos] = useState<Insumo[]>([])
  const [loading, setLoading] = useState(true)
  const [cargandoPreciosEfectivos, setCargandoPreciosEfectivos] = useState(false)

  const [busqueda, setBusqueda] = useState("")
  const [filtroTipo, setFiltroTipo] = useState("todos")
  const [filtroUM, setFiltroUM] = useState("todos")
  const [filtroAgrupacion, setFiltroAgrupacion] = useState("todos")

  const [columnaOrden, setColumnaOrden] = useState<ColumnaOrdenable>("codigo")
  const [direccionOrden, setDireccionOrden] = useState<Direccion>("asc")

  const [pagina, setPagina] = useState(1)

  useEffect(() => {
    async function fetchInsumos() {
      const supabase = createClient()

      const { data, error } = await supabase
        .from("maestro_insumos")
        .select("id, codigo, descripcion, tipo, u_m, agrupacion, vr_unitario")
        .order("codigo")

      if (error) {
        console.error("Error obteniendo insumos:", error)
        setLoading(false)
        return
      }

      setInsumos((data ?? []).map((i) => ({ ...i, precioEfectivo: null })))
      setLoading(false)
    }

    fetchInsumos()
  }, [])

  // Calcula el precio EFECTIVO de todos los insumos apenas termina de
  // cargar la lista base. La dependencia es la CANTIDAD de filas, no el
  // array completo -- así, cuando este mismo efecto actualiza `insumos`
  // más abajo (sin cambiar su longitud), no se vuelve a disparar a sí
  // mismo en un loop.
  useEffect(() => {
    if (insumos.length === 0) return
    let cancelado = false

    async function fetchPreciosEfectivos() {
      setCargandoPreciosEfectivos(true)
      const supabase = createClient()
      const ids = insumos.map((i) => i.id)

      const lotes: string[][] = []
      for (let i = 0; i < ids.length; i += TAMANO_LOTE_PRECIOS_EFECTIVOS) {
        lotes.push(ids.slice(i, i + TAMANO_LOTE_PRECIOS_EFECTIVOS))
      }

      const precioPorId = new Map<string, number | null>()
      try {
        const resultados = await Promise.all(
          lotes.map((lote) => supabase.rpc("precios_efectivos_insumos", { p_insumo_ids: lote }))
        )
        for (const { data, error } of resultados) {
          if (error) throw new Error(error.message)
          for (const fila of data ?? []) {
            precioPorId.set(fila.insumo_id as string, fila.precio_efectivo as number | null)
          }
        }
      } catch (e) {
        // Si falla, cada insumo cae a su propio vr_unitario abajo -- no se
        // bloquea la tabla completa por un error de este cálculo.
        console.error("No se pudieron cargar los precios efectivos:", e)
      }

      if (cancelado) return
      setInsumos((prev) =>
        prev.map((i) => ({
          ...i,
          precioEfectivo: precioPorId.has(i.id) ? (precioPorId.get(i.id) as number | null) : i.vr_unitario,
        }))
      )
      setCargandoPreciosEfectivos(false)
    }

    fetchPreciosEfectivos()
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insumos.length])

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

  function textoPrecio(insumo: Insumo) {
    return cargandoPreciosEfectivos && insumo.precioEfectivo === null ? "…" : formatearMoneda(insumo.precioEfectivo)
  }

  // Mismo diseño que Proveedores (components/tabla-excel.tsx). Código y
  // Descripción quedan fijas al hacer scroll horizontal.
  const columnasTabla: ColumnaExcel<Insumo>[] = [
    { clave: "codigo", titulo: "Código", ancho: 96, fija: true, texto: (i) => String(i.codigo), claseCelda: "font-mono text-xs text-muted-foreground" },
    { clave: "descripcion", titulo: "Descripción", ancho: 320, fija: true, flexible: true, texto: (i) => i.descripcion },
    { clave: "tipo", titulo: "Tipo", ancho: 200, texto: (i) => i.tipo ?? "" },
    { clave: "u_m", titulo: "U.M.", ancho: 150, alinear: "center", texto: (i) => i.u_m ?? "" },
    { clave: "agrupacion", titulo: "Agrupación", ancho: 280, texto: (i) => i.agrupacion ?? "" },
    { clave: "precioEfectivo", titulo: "Valor unitario", ancho: 160, alinear: "right", texto: textoPrecio, claseCelda: "tabular-nums" },
  ]

  const claseFiltro = "h-9 w-auto max-w-[16rem] rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"

  return (
    <>
      <EncabezadoPagina
        titulo="Maestro de insumos"
        subtitulo="Valor unitario vigente: promedio de compra real, o precio de respaldo si el insumo no tiene historial."
      />

      <main className="mx-auto w-full max-w-[1800px] min-w-0 flex-1 space-y-4 p-4 sm:p-6">
        {!loading && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar por código o descripción…"
                className="h-9 w-full rounded-md border bg-background pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className={claseFiltro} aria-label="Filtrar por tipo">
              <option value="todos">Todos los tipos</option>
              {tipos.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            <select value={filtroUM} onChange={(e) => setFiltroUM(e.target.value)} className={claseFiltro} aria-label="Filtrar por unidad">
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
              className={claseFiltro}
              aria-label="Filtrar por agrupación"
            >
              <option value="todos">Todas las agrupaciones</option>
              {agrupaciones.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>

            {hayFiltrosActivos && (
              <button onClick={limpiarFiltros} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <X className="size-3.5" />
                Quitar filtros
              </button>
            )}

            <span className="text-xs text-muted-foreground tabular-nums sm:ml-auto">
              {`${filasProcesadas.length.toLocaleString("es-CO")} de ${insumos.length.toLocaleString("es-CO")} insumos`}
            </span>
          </div>
        )}

        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        )}

        {!loading && filasPagina.length === 0 && (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            No hay insumos que coincidan con la búsqueda o los filtros.
          </div>
        )}

        {!loading && filasPagina.length > 0 && (
          <TablaExcel
            filas={filasPagina}
            columnas={columnasTabla}
            claveFila={(i) => i.id}
            orden={{ clave: columnaOrden, dir: direccionOrden }}
            onOrdenar={(clave) => alternarOrden(clave as ColumnaOrdenable)}
            tarjeta={{
              titulo: (i) => i.descripcion,
              subtitulo: (i) => <span className="font-mono">{i.codigo}</span>,
              campos: ["tipo", "u_m", "agrupacion", "precioEfectivo"],
            }}
          />
        )}

        {!loading && <PaginacionExcel pagina={paginaActual} totalPaginas={totalPaginas} onCambiar={setPagina} />}
      </main>
    </>
  )
}
