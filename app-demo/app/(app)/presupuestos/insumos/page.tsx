"use client"

import { COMODIN_LISTAR } from "@/lib/busqueda"
import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { traerTodo } from "@/lib/supabase/traer-todo"
import { Search, X } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { EncabezadoPagina } from "@/components/encabezado-pagina"
import { TablaExcel, PaginacionExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  describirPresentacion,
  nombreUnidad,
  sugerirPresentacion,
  UNIDADES_DE_USO,
} from "@/lib/unidades"
import { aceptarSugerenciasPresentacion, guardarPresentacion, puedeEditarPresentacion } from "./actions"

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
  // Presentación: 1 u_m trae `contenido` de `unidad_uso` (1 bulto = 50 KG).
  unidad_uso: string | null
  contenido: number | null
  // Calculados en el cliente: texto de la presentación, y la que se lee del
  // nombre cuando todavía no tiene ("CEMENTO X 50 KG").
  presentacion: string
  sugerencia: { unidadUso: string; contenido: number } | null
}

type ColumnaOrdenable = "codigo" | "descripcion" | "tipo" | "u_m" | "agrupacion" | "precioEfectivo" | "presentacion"
type FiltroPresentacion = "todos" | "con" | "sugeridas" | "sin"

function textoPresentacion(i: Pick<Insumo, "u_m" | "unidad_uso" | "contenido">): string {
  return describirPresentacion({ u_m: i.u_m, unidad_uso: i.unidad_uso, contenido: i.contenido }) ?? ""
}

function conCalculados<T extends Omit<Insumo, "presentacion" | "sugerencia">>(i: T): T & Pick<Insumo, "presentacion" | "sugerencia"> {
  return {
    ...i,
    presentacion: textoPresentacion(i),
    sugerencia: i.unidad_uso ? null : sugerirPresentacion(i.descripcion, i.u_m),
  }
}
type Direccion = "asc" | "desc"

const FILAS_POR_PAGINA = 50

// precios_efectivos_insumos no está pensado para recibir miles de ids de
// una sola vez -- se pide en lotes, en paralelo (mismo criterio que ya
// usa matchearYGuardarImportApu en presupuestos/actions.ts).
const TAMANO_LOTE_PRECIOS_EFECTIVOS = 500

export default function MaestroInsumos() {
  const [insumos, setInsumos] = useState<Insumo[]>([])
  const [loading, setLoading] = useState(true)
  const [cargandoPreciosEfectivos, setCargandoPreciosEfectivos] = useState(false)

  const [busqueda, setBusqueda] = useState("")
  const [filtroTipo, setFiltroTipo] = useState("todos")
  const [filtroUM, setFiltroUM] = useState("todos")
  const [filtroAgrupacion, setFiltroAgrupacion] = useState("todos")
  const [filtroPresentacion, setFiltroPresentacion] = useState<FiltroPresentacion>("todos")

  const [puedeEditar, setPuedeEditar] = useState(false)
  const [editando, setEditando] = useState<Insumo | null>(null)
  const [dialogoSugerencias, setDialogoSugerencias] = useState(false)

  useEffect(() => {
    puedeEditarPresentacion()
      .then((v: boolean) => setPuedeEditar(v))
      .catch(() => setPuedeEditar(false))
  }, [])

  const [columnaOrden, setColumnaOrden] = useState<ColumnaOrdenable>("codigo")
  const [direccionOrden, setDireccionOrden] = useState<Direccion>("asc")

  const [pagina, setPagina] = useState(1)

  useEffect(() => {
    async function fetchInsumos() {
      const supabase = createClient()

      // Por páginas (traerTodo): una sola consulta se cortaría sin avisar en
      // el límite de filas de la API si el maestro crece.
      let data
      try {
        data = await traerTodo((desde, hasta) =>
          supabase
            .from("maestro_insumos")
            .select("id, codigo, descripcion, tipo, u_m, agrupacion, vr_unitario, unidad_uso, contenido")
            .order("codigo")
            .range(desde, hasta)
        )
      } catch (error) {
        console.error("Error obteniendo insumos:", error)
        setLoading(false)
        return
      }

      setInsumos(
        data.map((i: any) =>
          conCalculados({ ...i, contenido: i.contenido == null ? null : Number(i.contenido), precioEfectivo: null })
        )
      )
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
    busqueda !== "" ||
    filtroTipo !== "todos" ||
    filtroUM !== "todos" ||
    filtroAgrupacion !== "todos" ||
    filtroPresentacion !== "todos"

  function limpiarFiltros() {
    setBusqueda("")
    setFiltroTipo("todos")
    setFiltroUM("todos")
    setFiltroAgrupacion("todos")
    setFiltroPresentacion("todos")
  }

  const conSugerencia = useMemo(() => insumos.filter((i) => i.sugerencia), [insumos])

  function actualizarInsumos(cambios: Map<string, { unidad_uso: string | null; contenido: number | null }>) {
    setInsumos((prev) =>
      prev.map((i) => {
        const c = cambios.get(i.id)
        return c ? conCalculados({ ...i, ...c }) : i
      })
    )
  }

  // filtrado + búsqueda + orden, todo en un solo memo
  const filasProcesadas = useMemo(() => {
    const termino = busqueda.trim().toLowerCase()

    const filtradas = insumos.filter((insumo) => {
      if (filtroTipo !== "todos" && insumo.tipo !== filtroTipo) return false
      if (filtroUM !== "todos" && insumo.u_m !== filtroUM) return false
      if (filtroAgrupacion !== "todos" && insumo.agrupacion !== filtroAgrupacion) return false
      if (filtroPresentacion === "con" && !insumo.unidad_uso) return false
      if (filtroPresentacion === "sugeridas" && !insumo.sugerencia) return false
      if (filtroPresentacion === "sin" && (insumo.unidad_uso || insumo.sugerencia)) return false

      if (!termino || termino === COMODIN_LISTAR) return true
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
  }, [insumos, busqueda, filtroTipo, filtroUM, filtroAgrupacion, filtroPresentacion, columnaOrden, direccionOrden])

  // volver a la página 1 cada vez que cambian filtros/búsqueda/orden
  useEffect(() => {
    setPagina(1)
  }, [busqueda, filtroTipo, filtroUM, filtroAgrupacion, filtroPresentacion, columnaOrden, direccionOrden])

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
    {
      clave: "presentacion",
      titulo: "Presentación",
      ancho: 210,
      texto: (i) =>
        i.presentacion ||
        (i.sugerencia ? `Sugerida: ${i.sugerencia.contenido} ${nombreUnidad(i.sugerencia.unidadUso)}` : ""),
      celda: (i) => (
        <CeldaPresentacion insumo={i} puedeEditar={puedeEditar} onEditar={() => setEditando(i)} />
      ),
    },
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

            <select
              value={filtroPresentacion}
              onChange={(e) => setFiltroPresentacion(e.target.value as FiltroPresentacion)}
              className={claseFiltro}
              aria-label="Filtrar por presentación"
            >
              <option value="todos">Todas las presentaciones</option>
              <option value="con">Con presentación</option>
              <option value="sugeridas">Sugeridas sin confirmar</option>
              <option value="sin">Sin presentación</option>
            </select>

            {puedeEditar && conSugerencia.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setDialogoSugerencias(true)}>
                Revisar sugerencias ({conSugerencia.length})
              </Button>
            )}

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
              campos: ["tipo", "u_m", "presentacion", "agrupacion", "precioEfectivo"],
            }}
          />
        )}

        {!loading && <PaginacionExcel pagina={paginaActual} totalPaginas={totalPaginas} onCambiar={setPagina} />}
      </main>

      {editando && (
        <DialogoPresentacion
          insumo={editando}
          onCerrar={() => setEditando(null)}
          onGuardado={(c) => {
            actualizarInsumos(new Map([[editando.id, c]]))
            setEditando(null)
          }}
        />
      )}

      {dialogoSugerencias && (
        <DialogoSugerencias
          insumos={conSugerencia}
          onCerrar={() => setDialogoSugerencias(false)}
          onGuardadas={(cambios) => {
            actualizarInsumos(cambios)
            setDialogoSugerencias(false)
          }}
        />
      )}
    </>
  )
}

function CeldaPresentacion({
  insumo,
  puedeEditar,
  onEditar,
}: {
  insumo: Insumo
  puedeEditar: boolean
  onEditar: () => void
}) {
  const contenido = insumo.presentacion ? (
    <span>{insumo.presentacion}</span>
  ) : insumo.sugerencia ? (
    <span className="text-amber-700" title="Leída del nombre; falta confirmarla">
      Sugerida: {insumo.sugerencia.contenido} {nombreUnidad(insumo.sugerencia.unidadUso)}
    </span>
  ) : (
    <span className="text-muted-foreground">—</span>
  )
  if (!puedeEditar) return contenido
  return (
    <button type="button" onClick={onEditar} className="w-full truncate text-left hover:underline" title="Editar presentación">
      {contenido}
    </button>
  )
}

function DialogoPresentacion({
  insumo,
  onCerrar,
  onGuardado,
}: {
  insumo: Insumo
  onCerrar: () => void
  onGuardado: (c: { unidad_uso: string | null; contenido: number | null }) => void
}) {
  const inicial = insumo.unidad_uso
    ? { unidad: insumo.unidad_uso, contenido: String(insumo.contenido ?? "") }
    : insumo.sugerencia
      ? { unidad: insumo.sugerencia.unidadUso, contenido: String(insumo.sugerencia.contenido) }
      : { unidad: "", contenido: "" }
  const [unidad, setUnidad] = useState(inicial.unidad)
  const [contenido, setContenido] = useState(inicial.contenido)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const compra = nombreUnidad(insumo.u_m) || "unidad"
  const numero = Number(contenido.replace(",", "."))
  const precioPorUso =
    insumo.precioEfectivo != null && numero > 0 && unidad ? insumo.precioEfectivo / numero : null

  async function guardar(quitar: boolean) {
    setGuardando(true)
    setError(null)
    try {
      const r = await guardarPresentacion(insumo.id, quitar ? null : unidad, quitar ? null : contenido)
      onGuardado({ unidad_uso: r.unidadUso, contenido: r.contenido })
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.")
      setGuardando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Presentación</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p>
            <span className="font-mono text-xs text-muted-foreground">{insumo.codigo}</span> {insumo.descripcion}
          </p>
          <p className="text-muted-foreground">
            El precio está por <strong>{compra}</strong>. Si en los APU se usa por kg, metro, etc., indica cuánto trae
            cada {compra}: el precio de la línea se divide por ese contenido y Compras pide {compra}s completos.
          </p>
          <div className="flex items-end gap-2">
            <span className="pb-2">1 {compra} trae</span>
            <Input
              value={contenido}
              onChange={(e) => setContenido(e.target.value)}
              inputMode="decimal"
              className="w-24"
              aria-label="Contenido"
            />
            <select
              value={unidad}
              onChange={(e) => setUnidad(e.target.value)}
              className="h-9 rounded-md border bg-background px-2"
              aria-label="Unidad de uso"
            >
              <option value="">Unidad…</option>
              {UNIDADES_DE_USO.map((u) => (
                <option key={u.codigo} value={u.codigo}>
                  {u.nombre}
                </option>
              ))}
            </select>
          </div>
          {precioPorUso != null && (
            <p className="text-muted-foreground">
              Precio por {nombreUnidad(unidad)}:{" "}
              {precioPorUso.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 2 })}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Solo afecta a las líneas de APU que se agreguen o se resuelvan de aquí en adelante.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-between gap-2">
            {insumo.unidad_uso ? (
              <Button variant="outline" onClick={() => guardar(true)} disabled={guardando}>
                Quitar presentación
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={onCerrar} disabled={guardando}>
                Cancelar
              </Button>
              <Button onClick={() => guardar(false)} disabled={guardando || !unidad || !contenido.trim()}>
                {guardando ? "Guardando…" : "Guardar"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DialogoSugerencias({
  insumos,
  onCerrar,
  onGuardadas,
}: {
  insumos: Insumo[]
  onCerrar: () => void
  onGuardadas: (cambios: Map<string, { unidad_uso: string | null; contenido: number | null }>) => void
}) {
  const [elegidos, setElegidos] = useState<Set<string>>(() => new Set(insumos.map((i) => i.id)))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function alternar(id: string) {
    setElegidos((prev) => {
      const copia = new Set(prev)
      if (copia.has(id)) copia.delete(id)
      else copia.add(id)
      return copia
    })
  }

  async function guardar() {
    const lista = insumos.filter((i) => elegidos.has(i.id) && i.sugerencia)
    setGuardando(true)
    setError(null)
    try {
      await aceptarSugerenciasPresentacion(
        lista.map((i) => ({ insumoId: i.id, unidadUso: i.sugerencia!.unidadUso, contenido: i.sugerencia!.contenido }))
      )
      onGuardadas(
        new Map(lista.map((i) => [i.id, { unidad_uso: i.sugerencia!.unidadUso, contenido: i.sugerencia!.contenido }]))
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron guardar.")
      setGuardando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Presentaciones sugeridas</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Leídas del nombre de cada insumo. Desmarca las que no estén bien (por ejemplo, una medida que no es el
          contenido) y corrígelas una por una desde la tabla.
        </p>
        <ul className="divide-y rounded-md border text-sm">
          {insumos.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-3 py-2">
              <input
                type="checkbox"
                checked={elegidos.has(i.id)}
                onChange={() => alternar(i.id)}
                aria-label={`Aceptar sugerencia de ${i.descripcion}`}
              />
              <span className="min-w-0 flex-1 truncate" title={i.descripcion}>
                <span className="font-mono text-xs text-muted-foreground">{i.codigo}</span> {i.descripcion}
              </span>
              <span className="shrink-0 whitespace-nowrap">
                1 {nombreUnidad(i.u_m) || "unidad"} = {i.sugerencia!.contenido} {nombreUnidad(i.sugerencia!.unidadUso)}
              </span>
            </li>
          ))}
        </ul>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={guardando || elegidos.size === 0}>
            {guardando ? "Guardando…" : `Aceptar ${elegidos.size}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
