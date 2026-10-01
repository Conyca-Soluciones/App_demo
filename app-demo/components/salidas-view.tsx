"use client"

import { leerCantidadEntera } from "@/lib/numeros"
import { COMODIN_LISTAR } from "@/lib/busqueda"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CheckCircle2, Loader2, X } from "lucide-react"
import { BuscadorAsync, type OpcionBuscador } from "@/components/buscador-async"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useProyectoActual } from "@/components/proyecto-provider"
import { SinProyecto } from "@/components/sin-proyecto"
import {
  obtenerInventarioProyecto,
  type InsumoInventario,
} from "@/app/(app)/almacen/inventario/actions"
import { registrarSalida } from "@/app/(app)/almacen/salidas/actions"

const formatoNumero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 4 })

// Cantidades: solo números enteros (ver lib/numeros.ts). "1.500" es 1500;
// "1,5" se rechaza con el motivo para mostrárselo al usuario.

// Una línea de la tabla de salida: el insumo elegido y la cantidad que sale.
type LineaSalida = { key: string; insumo: OpcionBuscador | null; um: string | null; cantidad: string }

export function SalidasView() {
  // Proyecto escogido en /inicio o en el selector del header (ver
  // lib/proyecto-actual.ts).
  const proyectoId = useProyectoActual().proyecto?.id ?? null
  const [inventario, setInventario] = useState<InsumoInventario[] | null>(null)
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

  function cargar(pid: string) {
    setError(null)
    obtenerInventarioProyecto(pid)
      .then((inv: InsumoInventario[]) => setInventario(inv))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar el proyecto."))
  }

  useEffect(() => {
    setLineas([nuevaLinea()])
    setAviso(null)
    setInventario(null)
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto pb-72">
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

            <div className="min-h-[26rem] rounded-lg border">
              <table className="w-full caption-bottom text-sm">
                <thead className="border-b">
                  <tr className="text-left text-muted-foreground">
                    <th className="h-11 w-10 px-3 text-center font-medium">#</th>
                    <th className="h-11 px-3 font-medium">Insumo</th>
                    <th className="h-11 w-24 px-3 font-medium">UM</th>
                    <th className="h-11 w-44 px-3 text-right font-medium">Cantidad a sacar</th>
                    <th className="h-11 w-12 px-3" />
                  </tr>
                </thead>
                <tbody>
                  {lineas.map((l, idx) => (
                    <tr key={l.key} className="border-b last:border-b-0 align-top">
                      <td className="px-3 py-3 text-center text-muted-foreground">{idx + 1}</td>
                      <td className="min-w-72 px-3 py-2">
                        <BuscadorAsync
                          inputId={`salida-buscar-${l.key}`}
                          placeholder="Buscar insumo (o _ para ver todos)"
                          valorSeleccionado={l.insumo}
                          onSeleccionar={(o) => elegirInsumo(l.key, o)}
                          buscar={buscarInsumo}
                        />
                      </td>
                      <td className="px-3 py-3">{l.insumo ? l.um ?? "—" : ""}</td>
                      <td className="px-3 py-2 text-right">
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
                      </td>
                      <td className="px-3 py-2 text-center">
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
        </>
      )}
    </div>
  )
}
