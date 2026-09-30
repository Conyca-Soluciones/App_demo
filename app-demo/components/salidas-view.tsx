"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Search, History, Trash2, CheckCircle2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { createClient } from "@/lib/supabase/client"
import {
  listarProyectosParaSalidas,
  obtenerInsumosDisponiblesParaSalida,
  registrarSalida,
  listarSalidasDelProyecto,
  anularSalida,
  type ProyectoParaSalidas,
  type InsumoDisponibleSalida,
  type SalidaRegistrada,
} from "@/app/(app)/almacen/salidas/actions"

const formatoFecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })

const formatoNumero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 })

// Días sin registrar nada antes de mostrar el aviso -- corte semanal.
const UMBRAL_DIAS_SIN_REGISTRAR = 7

type FilaEstado = { guardando: boolean; error: string | null; ok: boolean }

export function SalidasView() {
  const [usuarioId, setUsuarioId] = useState<string | null>(null)

  const [proyectos, setProyectos] = useState<ProyectoParaSalidas[]>([])
  const [proyectoId, setProyectoId] = useState<string | null>(null)
  const [cargandoProyectos, setCargandoProyectos] = useState(true)

  const [insumos, setInsumos] = useState<InsumoDisponibleSalida[] | null>(null)
  const [cargandoInsumos, setCargandoInsumos] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [cantidades, setCantidades] = useState<Record<string, string>>({})
  const [filas, setFilas] = useState<Record<string, FilaEstado>>({})
  const [busqueda, setBusqueda] = useState("")
  const [guardandoTodo, setGuardandoTodo] = useState(false)

  const [historial, setHistorial] = useState<SalidaRegistrada[] | null>(null)
  const [mostrarHistorial, setMostrarHistorial] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setUsuarioId(data.user?.id ?? null))
  }, [])

  useEffect(() => {
    listarProyectosParaSalidas()
      .then((data) => {
        setProyectos(data)
        if (data.length === 1) setProyectoId(data[0].id)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los proyectos."))
      .finally(() => setCargandoProyectos(false))
  }, [])

  function cargarInsumos(pid: string) {
    setCargandoInsumos(true)
    setError(null)
    Promise.all([obtenerInsumosDisponiblesParaSalida(pid), listarSalidasDelProyecto(pid)])
      .then(([i, h]) => {
        setInsumos(i)
        setHistorial(h)
        setCantidades({})
        setFilas({})
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar la información del proyecto."))
      .finally(() => setCargandoInsumos(false))
  }

  useEffect(() => {
    if (proyectoId) cargarInsumos(proyectoId)
    else {
      setInsumos(null)
      setHistorial(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proyectoId])

  const insumosFiltrados = useMemo(() => {
    if (!insumos) return []
    const q = busqueda.trim().toLowerCase()
    if (!q) return insumos
    return insumos.filter((i) => i.insumoDescripcion.toLowerCase().includes(q))
  }, [insumos, busqueda])

  const pendientesPorGuardar = useMemo(
    () => Object.entries(cantidades).filter(([, v]) => Number(v) > 0),
    [cantidades]
  )

  const diasSinRegistrar = useMemo(() => {
    if (!historial) return null
    if (historial.length === 0) return Infinity
    const masReciente = historial.reduce(
      (max, s) => Math.max(max, new Date(s.createdAt).getTime()),
      0
    )
    return Math.floor((Date.now() - masReciente) / (1000 * 60 * 60 * 24))
  }, [historial])

  function actualizarCantidad(insumoId: string, valor: string) {
    setCantidades((prev) => ({ ...prev, [insumoId]: valor }))
    setFilas((prev) => ({ ...prev, [insumoId]: { guardando: false, error: null, ok: false } }))
  }

  async function guardarFila(insumoId: string) {
    if (!proyectoId) return
    const cantidad = Number(cantidades[insumoId])
    if (!cantidad || cantidad <= 0) return

    setFilas((prev) => ({ ...prev, [insumoId]: { guardando: true, error: null, ok: false } }))
    try {
      await registrarSalida({ proyectoId, insumoId, cantidad })
      setFilas((prev) => ({ ...prev, [insumoId]: { guardando: false, error: null, ok: true } }))
      setCantidades((prev) => {
        const siguiente = { ...prev }
        delete siguiente[insumoId]
        return siguiente
      })
      cargarInsumos(proyectoId)
    } catch (e) {
      setFilas((prev) => ({
        ...prev,
        [insumoId]: { guardando: false, error: e instanceof Error ? e.message : "No se pudo registrar.", ok: false },
      }))
    }
  }

  async function guardarTodas() {
    if (!proyectoId || pendientesPorGuardar.length === 0) return
    setGuardandoTodo(true)
    for (const [insumoId] of pendientesPorGuardar) {
      await guardarFila(insumoId)
    }
    setGuardandoTodo(false)
  }

  async function handleAnular(salidaId: string) {
    if (!proyectoId) return
    try {
      await anularSalida(salidaId)
      cargarInsumos(proyectoId)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo anular la salida.")
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Salidas de bodega</h1>
          <p className="text-sm text-muted-foreground">
            Registra el material que sale de almacén hacia obra. Esto es lo que refleja el avance real.
          </p>
        </div>

        <Select value={proyectoId ?? ""} onValueChange={setProyectoId} disabled={cargandoProyectos}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder={cargandoProyectos ? "Cargando proyectos..." : "Selecciona un proyecto"} />
          </SelectTrigger>
          <SelectContent>
            {proyectos.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.codigo ? `${p.codigo} · ${p.nombre}` : p.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {!proyectoId ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          Elige un proyecto para ver los insumos disponibles en bodega.
        </div>
      ) : cargandoInsumos ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando...
        </div>
      ) : (
        <>
          {diasSinRegistrar !== null && diasSinRegistrar >= UMBRAL_DIAS_SIN_REGISTRAR && (
            <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {historial && historial.length === 0
                ? "Todavía no se ha registrado ninguna salida en este proyecto."
                : `Llevas ${diasSinRegistrar} días sin registrar salidas en este proyecto.`}
            </div>
          )}

          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar insumo..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="pl-8"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
            {insumos && insumos.length === 0 ? (
              <div className="flex h-full items-center justify-center p-12 text-center text-muted-foreground">
                No hay insumos comprados todavía para este proyecto.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">Insumo</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">UM</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-muted/60 backdrop-blur text-right">
                      Disponible
                    </TableHead>
                    <TableHead className="sticky top-0 z-10 w-40 bg-muted/60 backdrop-blur text-right">
                      Salida esta semana
                    </TableHead>
                    <TableHead className="sticky top-0 z-10 w-16 bg-muted/60 backdrop-blur" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {insumosFiltrados.map((i, idx) => {
                    const fila = filas[i.insumoId]
                    return (
                      <TableRow key={i.insumoId} className={idx % 2 === 1 ? "bg-muted/25" : undefined}>
                        <TableCell className="whitespace-normal break-words align-top">
                          {i.insumoCodigo} · {i.insumoDescripcion}
                        </TableCell>
                        <TableCell className="align-top">{i.insumoUm ?? "—"}</TableCell>
                        <TableCell className="text-right align-top tabular-nums">
                          {formatoNumero.format(i.cantidadDisponible)}
                        </TableCell>
                        <TableCell className="align-top">
                          <Input
                            type="number"
                            min={0}
                            max={i.cantidadDisponible}
                            step="any"
                            placeholder="0"
                            value={cantidades[i.insumoId] ?? ""}
                            onChange={(e) => actualizarCantidad(i.insumoId, e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && guardarFila(i.insumoId)}
                            className="text-right"
                            disabled={i.cantidadDisponible <= 0}
                          />
                          {fila?.error && <p className="mt-1 text-xs text-destructive">{fila.error}</p>}
                        </TableCell>
                        <TableCell className="align-top">
                          {fila?.guardando ? (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          ) : fila?.ok ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!cantidades[i.insumoId] || Number(cantidades[i.insumoId]) <= 0}
                              onClick={() => guardarFila(i.insumoId)}
                            >
                              Registrar
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMostrarHistorial((v) => !v)}
              className="gap-2"
            >
              <History className="h-4 w-4" />
              {mostrarHistorial ? "Ocultar historial" : "Ver historial"}
            </Button>

            {pendientesPorGuardar.length > 1 && (
              <Button onClick={guardarTodas} disabled={guardandoTodo}>
                {guardandoTodo ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Guardar {pendientesPorGuardar.length} salidas
              </Button>
            )}
          </div>

          {mostrarHistorial && (
            <div className="max-h-56 shrink-0 overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Insumo</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead>Registrado por</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(historial ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        Sin salidas registradas todavía.
                      </TableCell>
                    </TableRow>
                  ) : (
                    historial!.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>{formatoFecha(s.createdAt)}</TableCell>
                        <TableCell>
                          {s.insumoCodigo} · {s.insumoDescripcion}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatoNumero.format(s.cantidad)} {s.insumoUm ?? ""}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{s.registradoPorNombre ?? "—"}</TableCell>
                        <TableCell>
                          {s.registradoPorId === usuarioId && (
                            <Button size="icon" variant="ghost" onClick={() => handleAnular(s.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  )
}