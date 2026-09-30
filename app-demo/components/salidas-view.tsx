"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, Loader2, Search } from "lucide-react"
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
import { verProyectos } from "@/app/(app)/almacen/actions"
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

type ProyectoOpcion = { id: string; codigo: string | null; nombre: string }

const formatoNumero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 4 })
const formatoFecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })

// "1.5" y "1,5" son la misma cantidad -- se acepta coma decimal (Colombia).
function parsearCantidad(texto: string): number {
  const n = Number(texto.trim().replace(",", "."))
  return Number.isFinite(n) ? n : NaN
}

export function SalidasView() {
  const [proyectos, setProyectos] = useState<ProyectoOpcion[]>([])
  const [proyectoId, setProyectoId] = useState<string | null>(null)
  const [inventario, setInventario] = useState<InsumoInventario[] | null>(null)
  const [historial, setHistorial] = useState<SalidaRegistrada[] | null>(null)
  const [busqueda, setBusqueda] = useState("")
  const [cantidades, setCantidades] = useState<Record<string, string>>({})
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

  useEffect(() => {
    verProyectos()
      .then((data: ProyectoOpcion[]) => {
        setProyectos(data)
        if (data.length === 1) setProyectoId(data[0].id)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los proyectos."))
  }, [])

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
    setCantidades({})
    setAviso(null)
    setInventario(null)
    setHistorial(null)
    if (proyectoId) cargar(proyectoId)
  }, [proyectoId])

  const disponibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return (inventario ?? [])
      .filter((i) => i.cantidadDisponible > 0)
      .filter(
        (i) => !q || i.insumoDescripcion.toLowerCase().includes(q) || String(i.insumoCodigo).includes(q)
      )
  }, [inventario, busqueda])

  async function handleRegistrar() {
    if (!proyectoId || !inventario) return
    setError(null)
    setAviso(null)

    const lineas: { insumoId: string; cantidad: number }[] = []
    for (const i of inventario) {
      const texto = cantidades[i.insumoId]
      if (!texto || !texto.trim()) continue
      const cantidad = parsearCantidad(texto)
      if (Number.isNaN(cantidad) || cantidad < 0) {
        setError(`Cantidad inválida en "${i.insumoDescripcion}".`)
        return
      }
      if (cantidad > i.cantidadDisponible) {
        setError(
          `"${i.insumoDescripcion}": solo hay ${formatoNumero.format(i.cantidadDisponible)} disponibles.`
        )
        return
      }
      if (cantidad > 0) lineas.push({ insumoId: i.insumoId, cantidad })
    }
    if (lineas.length === 0) {
      setError("Ingresa la cantidad a sacar de al menos un insumo.")
      return
    }

    setGuardando(true)
    try {
      const n = await registrarSalida({ proyectoId, retira, observaciones, lineas })
      setAviso(`Salida registrada (${n} ${n === 1 ? "insumo" : "insumos"}).`)
      setCantidades({})
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
    const cantidad = parsearCantidad(edCantidad)
    if (Number.isNaN(cantidad) || cantidad <= 0) {
      setError("La cantidad debe ser mayor que cero.")
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
      <div>
        <h1 className="text-2xl font-semibold">Salidas</h1>
        <p className="text-sm text-muted-foreground">
          Saca insumos de la bodega hacia obra. Solo puedes sacar lo que hay en el inventario.
        </p>
      </div>

      <Select value={proyectoId ?? ""} onValueChange={(v) => setProyectoId(v || null)}>
        <SelectTrigger className="w-80">
          <SelectValue placeholder="Selecciona un proyecto" />
        </SelectTrigger>
        <SelectContent>
          {proyectos.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.codigo ? `${p.codigo} — ${p.nombre}` : p.nombre}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

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
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-muted-foreground">
          Selecciona un proyecto para registrar salidas.
        </div>
      ) : inventario === null ? (
        !error && (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando...
          </div>
        )
      ) : (
        <>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-medium">Insumos disponibles en bodega</h2>
              <div className="relative w-72">
                <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Buscar insumo o código"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                />
              </div>
            </div>

            {disponibles.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
                {inventario.some((i) => i.cantidadDisponible > 0)
                  ? "Ningún insumo coincide con la búsqueda."
                  : "No hay insumos disponibles en la bodega de este proyecto. Registra una entrada primero."}
              </div>
            ) : (
              <div className="max-h-96 overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Código</TableHead>
                      <TableHead>Insumo</TableHead>
                      <TableHead>UM</TableHead>
                      <TableHead className="text-right">Disponible</TableHead>
                      <TableHead className="w-44 text-right">Sacar</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {disponibles.map((i) => (
                      <TableRow key={i.insumoId}>
                        <TableCell>{i.insumoCodigo}</TableCell>
                        <TableCell>{i.insumoDescripcion}</TableCell>
                        <TableCell>{i.insumoUm ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          {formatoNumero.format(i.cantidadDisponible)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Input
                              inputMode="decimal"
                              className="h-8 w-24 text-right"
                              placeholder="0"
                              value={cantidades[i.insumoId] ?? ""}
                              onChange={(e) =>
                                setCantidades((prev) => ({ ...prev, [i.insumoId]: e.target.value }))
                              }
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              title="Sacar todo lo disponible"
                              onClick={() =>
                                setCantidades((prev) => ({
                                  ...prev,
                                  [i.insumoId]: String(i.cantidadDisponible),
                                }))
                              }
                            >
                              Todo
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

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
            inputMode="decimal"
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
