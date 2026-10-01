"use client"

import { leerCantidadEntera } from "@/lib/numeros"
import { COMODIN_LISTAR } from "@/lib/busqueda"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CheckCircle2, Loader2, X } from "lucide-react"
import { BuscadorAsync, type OpcionBuscador } from "@/components/buscador-async"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useProyectoActual } from "@/components/proyecto-provider"
import { SinProyecto } from "@/components/sin-proyecto"
import {
  obtenerInventarioProyecto,
  type InsumoInventario,
} from "@/app/(app)/almacen/inventario/actions"
import {
  anularSalida,
  editarSalida,
  listarSalidasDelProyecto,
  registrarSalida,
  type SalidaRegistrada,
} from "@/app/(app)/almacen/salidas/actions"

const formatoNumero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 4 })
const formatoFecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })

// Cantidades: solo números enteros (ver lib/numeros.ts). "1.500" es 1500;
// "1,5" se rechaza con el motivo para mostrárselo al usuario.

// Una línea de la tabla de salida: el insumo elegido y la cantidad que sale.
type LineaSalida = { key: string; insumo: OpcionBuscador | null; um: string | null; cantidad: string }

export function SalidasView() {
  // Proyecto escogido en /inicio o en el selector del header (ver
  // lib/proyecto-actual.ts).
  const proyectoId = useProyectoActual().proyecto?.id ?? null
  const [inventario, setInventario] = useState<InsumoInventario[] | null>(null)
  const [historial, setHistorial] = useState<SalidaRegistrada[] | null>(null)
  // Tabla de salida: siempre termina con una línea vacía lista para el
  // siguiente insumo.
  const [lineas, setLineas] = useState<LineaSalida[]>([])
  const contadorLineas = useRef(0)
  const nuevaLinea = useCallback(
    (): LineaSalida => ({ key: `l${++contadorLineas.current}`, insumo: null, um: null, cantidad: "" }),
    []
  )
  const [retira, setRetira] = useState("")
  const [observaciones, setObservaciones] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const [editando, setEditando] = useState<SalidaRegistrada | null>(null)
  const [edCantidad, setEdCantidad] = useState("")
  const [edRetira, setEdRetira] = useState("")
  const [edObservaciones, setEdObservaciones] = useState("")
  const [procesandoEdicion, setProcesandoEdicion] = useState(false)

  const [anulando, setAnulando] = useState<SalidaRegistrada | null>(null)
  const [motivo, setMotivo] = useState("")
  const [procesandoAnulacion, setProcesandoAnulacion] = useState(false)

  function cargar(pid: string) {
    setError(null)
    Promise.all([obtenerInventarioProyecto(pid), listarSalidasDelProyecto(pid)])
      .then(([inv, hist]: [InsumoInventario[], SalidaRegistrada[]]) => {
        setInventario(inv)
        setHistorial(hist)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar el proyecto."))
  }

  useEffect(() => {
    setLineas([nuevaLinea()])
    setAviso(null)
    setInventario(null)
    setHistorial(null)
    if (proyectoId) cargar(proyectoId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proyectoId])

  // Insumo -> inventario, una sola vez (O(1) por búsqueda en vez de recorrer
  // el inventario por cada línea).
  const inventarioPorId = useMemo(
    () => new Map((inventario ?? []).map((i) => [i.insumoId, i])),
    [inventario]
  )
  // Insumos ya puestos en la tabla: no se ofrecen otra vez.
  const idsEnTabla = useMemo(
    () => new Set(lineas.flatMap((l) => (l.insumo ? [l.insumo.id] : []))),
    [lineas]
  )

  // Solo se sugieren insumos con algo en bodega, pero sin mostrar cuánto hay.
  const buscarInsumo = useCallback(
    async (termino: string): Promise<OpcionBuscador[]> => {
      const q = termino.trim().toLowerCase()
      const todos = q === COMODIN_LISTAR
      const resultado: OpcionBuscador[] = []
      for (const i of inventario ?? []) {
        if (i.cantidadDisponible <= 0 || idsEnTabla.has(i.insumoId)) continue
        if (
          todos ||
          i.insumoDescripcion.toLowerCase().includes(q) ||
          String(i.insumoCodigo).includes(q)
        ) {
          resultado.push({
            id: i.insumoId,
            etiqueta: i.insumoDescripcion,
            subetiqueta: `${i.insumoCodigo} · ${i.insumoUm ?? ""}`,
          })
          if (resultado.length >= (todos ? 50 : 15)) break
        }
      }
      return resultado
    },
    [inventario, idsEnTabla]
  )

  function elegirInsumo(key: string, opcion: OpcionBuscador | null) {
    setLineas((prev) => {
      const siguiente = prev.map((l) =>
        l.key === key
          ? { ...l, insumo: opcion, um: opcion ? inventarioPorId.get(opcion.id)?.insumoUm ?? null : null, cantidad: opcion ? l.cantidad : "" }
          : l
      )
      // Al llenar la última línea aparece otra vacía debajo.
      const ultima = siguiente[siguiente.length - 1]
      if (ultima.insumo) siguiente.push(nuevaLinea())
      return siguiente
    })
    // Tras elegir, el cursor pasa a la cantidad de esa misma línea.
    if (opcion) setTimeout(() => document.getElementById(`salida-cant-${key}`)?.focus(), 0)
  }

  function quitarLinea(key: string) {
    setLineas((prev) => {
      const siguiente = prev.filter((l) => l.key !== key)
      if (siguiente.length === 0 || siguiente[siguiente.length - 1].insumo) siguiente.push(nuevaLinea())
      return siguiente
    })
  }

  // Enter en la cantidad: salta al buscador de la línea siguiente.
  function siguienteLinea(key: string) {
    const i = lineas.findIndex((l) => l.key === key)
    const sig = lineas[i + 1]
    if (sig) setTimeout(() => document.getElementById(`salida-buscar-${sig.key}`)?.focus(), 0)
  }

  async function handleRegistrar() {
    if (!proyectoId || !inventario) return
    setError(null)
    setAviso(null)

    // Una pasada por las líneas de la tabla (las vacías se ignoran).
    const aEnviar: { insumoId: string; cantidad: number }[] = []
    for (const l of lineas) {
      if (!l.insumo) continue
      const inv = inventarioPorId.get(l.insumo.id)
      const nombre = l.insumo.etiqueta
      if (!l.cantidad.trim()) {
        setError(`"${nombre}": escribe la cantidad a sacar.`)
        return
      }
      const leida = leerCantidadEntera(l.cantidad)
      if (!leida.ok || leida.valor <= 0) {
        setError(`"${nombre}": ${leida.ok ? "la cantidad debe ser mayor que cero." : leida.error}`)
        return
      }
      if (!inv || leida.valor > inv.cantidadDisponible) {
        setError(
          `"${nombre}": solo hay ${formatoNumero.format(inv?.cantidadDisponible ?? 0)} disponibles en bodega.`
        )
        return
      }
      aEnviar.push({ insumoId: l.insumo.id, cantidad: leida.valor })
    }
    if (aEnviar.length === 0) {
      setError("Agrega al menos un insumo y la cantidad a sacar.")
      return
    }

    setGuardando(true)
    try {
      const n = await registrarSalida({ proyectoId, retira, observaciones, lineas: aEnviar })
      setAviso(`Salida registrada (${n} ${n === 1 ? "insumo" : "insumos"}).`)
      setLineas([nuevaLinea()])
      setRetira("")
      setObservaciones("")
      cargar(proyectoId)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar la salida.")
    } finally {
      setGuardando(false)
    }
  }

  function abrirEdicion(salida: SalidaRegistrada) {
    setError(null)
    setAviso(null)
    setEditando(salida)
    setEdCantidad(String(salida.cantidad))
    setEdRetira(salida.retira ?? "")
    setEdObservaciones(salida.observaciones ?? "")
  }

  // Tope al editar: lo disponible + lo que esta misma salida ya tenía sacado.
  const maximoEdicion = useMemo(() => {
    if (!editando || !inventario) return null
    const inv = inventario.find((i) => i.insumoCodigo === editando.insumoCodigo)
    return (inv?.cantidadDisponible ?? 0) + editando.cantidad
  }, [editando, inventario])

  async function confirmarEdicion() {
    if (!editando || !proyectoId) return
    const leida = leerCantidadEntera(edCantidad)
    const cantidad = leida.ok ? leida.valor : NaN
    if (!leida.ok || cantidad <= 0) {
      setError(leida.ok ? "La cantidad debe ser mayor que cero." : leida.error)
      setEditando(null)
      return
    }
    if (maximoEdicion !== null && cantidad > maximoEdicion) {
      setError(`No hay suficiente inventario: máximo ${formatoNumero.format(maximoEdicion)}.`)
      setEditando(null)
      return
    }
    setProcesandoEdicion(true)
    try {
      await editarSalida({
        salidaId: editando.id,
        cantidad,
        retira: edRetira,
        observaciones: edObservaciones,
      })
      setEditando(null)
      setAviso("Salida corregida.")
      cargar(proyectoId)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo editar la salida.")
      setEditando(null)
    } finally {
      setProcesandoEdicion(false)
    }
  }

  async function confirmarAnulacion() {
    if (!anulando || !proyectoId) return
    setProcesandoAnulacion(true)
    try {
      await anularSalida(anulando.id, motivo)
      setAnulando(null)
      setMotivo("")
      setAviso("Salida anulada: el material volvió al inventario.")
      cargar(proyectoId)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo anular la salida.")
      setAnulando(null)
    } finally {
      setProcesandoAnulacion(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto">
      {aviso && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4" /> {aviso}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {!proyectoId ? (
        <SinProyecto />
      ) : inventario === null ? (
        !error && (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando...
          </div>
        )
      ) : (
        <>
          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-medium">Nueva salida</h2>
              <p className="text-sm text-muted-foreground">
                Busca el insumo, elígelo y escribe la cantidad que sale; con Enter pasas a la
                siguiente línea. Puedes sacar varios insumos en una misma salida.
              </p>
            </div>

            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 text-center">#</TableHead>
                    <TableHead>Insumo</TableHead>
                    <TableHead className="w-20">UM</TableHead>
                    <TableHead className="w-40 text-right">Cantidad a sacar</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lineas.map((l, idx) => (
                    <TableRow key={l.key}>
                      <TableCell className="text-center text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="min-w-72 whitespace-normal">
                        <BuscadorAsync
                          inputId={`salida-buscar-${l.key}`}
                          placeholder="Buscar insumo (o _ para ver todos)"
                          valorSeleccionado={l.insumo}
                          onSeleccionar={(o) => elegirInsumo(l.key, o)}
                          buscar={buscarInsumo}
                        />
                      </TableCell>
                      <TableCell>{l.insumo ? l.um ?? "—" : ""}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          id={`salida-cant-${l.key}`}
                          inputMode="numeric"
                          className="ml-auto h-9 w-28 text-right"
                          placeholder="0"
                          disabled={!l.insumo}
                          value={l.cantidad}
                          onChange={(e) =>
                            setLineas((prev) =>
                              prev.map((x) => (x.key === l.key ? { ...x, cantidad: e.target.value } : x))
                            )
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault()
                              siguienteLinea(l.key)
                            }
                          }}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        {l.insumo && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            title="Quitar esta línea"
                            aria-label="Quitar esta línea"
                            onClick={() => quitarLinea(l.key)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="¿Quién retira el material? (opcional)"
                value={retira}
                onChange={(e) => setRetira(e.target.value)}
              />
              <Textarea
                placeholder="Observaciones (opcional)"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                rows={2}
              />
            </div>
            <div>
              <Button onClick={handleRegistrar} disabled={guardando}>
                {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Registrar salida
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-medium">Salidas registradas</h2>
            {historial && historial.length > 0 ? (
              <div className="overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Insumo</TableHead>
                      <TableHead className="text-right">Cantidad</TableHead>
                      <TableHead>Retira</TableHead>
                      <TableHead>Registró</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historial.map((s) => (
                      <TableRow key={s.id} className={s.anuladaAt ? "text-muted-foreground" : ""}>
                        <TableCell>{formatoFecha(s.fecha)}</TableCell>
                        <TableCell>{s.insumoDescripcion}</TableCell>
                        <TableCell className="text-right">
                          {formatoNumero.format(s.cantidad)} {s.insumoUm ?? ""}
                          {s.cantidadOriginal !== null && (
                            <span className="block text-xs text-muted-foreground">
                              (antes {formatoNumero.format(s.cantidadOriginal)})
                            </span>
                          )}
                        </TableCell>
                        <TableCell>{s.retira ?? "—"}</TableCell>
                        <TableCell>{s.registradoPorNombre ?? "—"}</TableCell>
                        <TableCell>
                          {s.anuladaAt ? (
                            <span title={s.motivoAnulacion ?? ""}>
                              <Badge variant="destructive">Anulada</Badge>
                            </span>
                          ) : s.editadaAt ? (
                            <Badge variant="outline">Editada</Badge>
                          ) : (
                            <Badge variant="outline">Registrada</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {!s.anuladaAt && (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => abrirEdicion(s)}>
                                Editar
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setAnulando(s)}>
                                Anular
                              </Button>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Este proyecto no tiene salidas registradas.</p>
            )}
          </div>
        </>
      )}

      <Dialog
        open={editando !== null}
        onOpenChange={(abierto) => {
          if (!abierto) setEditando(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar salida</DialogTitle>
          </DialogHeader>
          {editando && (
            <p className="text-sm text-muted-foreground">
              {editando.insumoDescripcion}
              {maximoEdicion !== null &&
                ` — máximo permitido: ${formatoNumero.format(maximoEdicion)} ${editando.insumoUm ?? ""}`}
              . Para cambiar de insumo, anula la salida y regístrala de nuevo.
            </p>
          )}
          <Input
            inputMode="numeric"
            placeholder="Cantidad"
            value={edCantidad}
            onChange={(e) => setEdCantidad(e.target.value)}
          />
          <Input
            placeholder="¿Quién retira el material?"
            value={edRetira}
            onChange={(e) => setEdRetira(e.target.value)}
          />
          <Textarea
            placeholder="Observaciones"
            value={edObservaciones}
            onChange={(e) => setEdObservaciones(e.target.value)}
            rows={2}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmarEdicion} disabled={procesandoEdicion}>
              {procesandoEdicion ? "Guardando..." : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={anulando !== null}
        onOpenChange={(abierto) => {
          if (!abierto) {
            setAnulando(null)
            setMotivo("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular salida</DialogTitle>
          </DialogHeader>
          {anulando && (
            <p className="text-sm text-muted-foreground">
              Se devolverán {formatoNumero.format(anulando.cantidad)} {anulando.insumoUm ?? ""} de{" "}
              {anulando.insumoDescripcion} al inventario. La salida queda registrada como anulada.
            </p>
          )}
          <Textarea
            placeholder="Motivo de la anulación (obligatorio)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnulando(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={!motivo.trim() || procesandoAnulacion}
              onClick={confirmarAnulacion}
            >
              {procesandoAnulacion ? "Anulando..." : "Anular salida"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
