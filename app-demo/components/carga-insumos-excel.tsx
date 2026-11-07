"use client"

import { useRef, useState } from "react"
import { AlertTriangle, CheckCircle2, Loader2, Upload, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { crearInsumosDesdeCarga, previsualizarCargaInsumos } from "@/app/(app)/presupuestos/actions"
import { leerPlantillaInsumos, type FilaCargaInsumo, type ResultadoFilaCarga } from "@/lib/carga-insumos"

type ResultadoCreacion = Awaited<ReturnType<typeof crearInsumosDesdeCarga>>

// Aprobación de insumos: subir el Excel de "insumos sin opción" (exportado en
// Revisar pendientes) ya completado. Primero una vista previa (nada se guarda):
// cada fila lista o bloqueada con el motivo; al confirmar se crean las listas y
// se asignan a sus líneas pendientes.
export function CargaInsumosExcel() {
  const entrada = useRef<HTMLInputElement>(null)
  const [nombreArchivo, setNombreArchivo] = useState("")
  const [filas, setFilas] = useState<FilaCargaInsumo[] | null>(null)
  const [vista, setVista] = useState<ResultadoFilaCarga[] | null>(null)
  const [resultado, setResultado] = useState<ResultadoCreacion | null>(null)
  const [trabajando, setTrabajando] = useState<"leyendo" | "creando" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const listas = vista?.filter((r) => r.errores.length === 0 && r.unidoAFila == null) ?? []
  const unidas = vista?.filter((r) => r.errores.length === 0 && r.unidoAFila != null) ?? []
  const bloqueadas = vista?.filter((r) => r.errores.length > 0) ?? []
  const abierto = vista !== null || resultado !== null

  async function alElegir(archivo: File | undefined) {
    if (!archivo) return
    setNombreArchivo(archivo.name)
    setError(null)
    setResultado(null)
    setTrabajando("leyendo")
    try {
      const leidas = await leerPlantillaInsumos(await archivo.arrayBuffer())
      setFilas(leidas)
      setVista(await previsualizarCargaInsumos(leidas))
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el archivo.")
    } finally {
      setTrabajando(null)
      if (entrada.current) entrada.current.value = ""
    }
  }

  async function crear() {
    if (!filas) return
    setTrabajando("creando")
    setError(null)
    try {
      setResultado(await crearInsumosDesdeCarga(filas))
      setVista(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron crear los insumos.")
    } finally {
      setTrabajando(null)
    }
  }

  function cerrar() {
    setVista(null)
    setResultado(null)
    setFilas(null)
    setError(null)
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="mr-auto min-w-0">
        <p className="font-medium">Cargar insumos nuevos desde Excel</p>
        <p className="text-xs text-muted-foreground">
          Sube el Excel de “insumos sin opción” (se exporta en Revisar pendientes) con tipo, unidad, agrupación, IVA y precio
          completos. Se crean en el maestro y se asignan a las líneas del APU que los pedían. La presentación (cuánto trae)
          solo se llena si el insumo se compra en otra unidad que la del APU.
        </p>
      </div>
      <input
        ref={entrada}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={(e) => alElegir(e.target.files?.[0])}
      />
      <Button variant="outline" disabled={trabajando !== null} onClick={() => entrada.current?.click()}>
        {trabajando === "leyendo" ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Upload className="mr-1.5 size-4" />}
        {trabajando === "leyendo" ? "Revisando..." : "Subir Excel"}
      </Button>
      {error && !abierto && <p className="w-full text-sm text-destructive">{error}</p>}

      <Dialog open={abierto} onOpenChange={(v) => !v && trabajando === null && cerrar()}>
        <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{resultado ? "Insumos creados" : `Vista previa — ${nombreArchivo}`}</DialogTitle>
          </DialogHeader>

          {resultado ? (
            <div className="space-y-2 text-sm">
              <p>
                <CheckCircle2 className="mr-1 inline size-4 text-emerald-600" />
                Se crearon <b>{resultado.creados.length}</b> insumos en el maestro y se asignaron a <b>{resultado.lineasAsignadas}</b> líneas del
                APU.
              </p>
              {resultado.conError > 0 && (
                <p className="text-muted-foreground">{resultado.conError} filas tenían errores y no se crearon.</p>
              )}
              {resultado.lineasConError.length > 0 && (
                <p className="text-amber-700">
                  <AlertTriangle className="mr-1 inline size-4" />
                  {resultado.lineasConError.length} líneas no se pudieron asignar y siguen en Revisar pendientes (por ejemplo:{" "}
                  {resultado.lineasConError[0].mensaje}).
                </p>
              )}
              <div className="max-h-[50vh] overflow-auto rounded border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Fila</th>
                      <th className="px-2 py-1.5 text-left">Código</th>
                      <th className="px-2 py-1.5 text-left">Insumo creado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.creados.map((c) => (
                      <tr key={c.codigo} className="border-t">
                        <td className="px-2 py-1">{c.fila}</td>
                        <td className="px-2 py-1 font-mono">{c.codigo}</td>
                        <td className="px-2 py-1">{c.descripcion}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            vista && (
              <div className="space-y-3 text-sm">
                <p>
                  <span className="text-emerald-700">{listas.length} listas para crear</span>
                  {unidas.length > 0 && <span className="text-muted-foreground"> · {unidas.length} se unen a otra fila (mismo insumo)</span>}
                  {bloqueadas.length > 0 && <span className="text-destructive"> · {bloqueadas.length} bloqueadas (no se crean)</span>}.
                  Las bloqueadas se corrigen en el Excel y se vuelve a subir el archivo.
                </p>
                <div className="max-h-[55vh] overflow-auto rounded border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted">
                      <tr>
                        <th className="w-12 px-2 py-1.5 text-left">Fila</th>
                        <th className="px-2 py-1.5 text-left">Insumo para el maestro</th>
                        <th className="px-2 py-1.5 text-left">Estado</th>
                        <th className="w-64 px-2 py-1.5 text-left">Líneas del APU</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...bloqueadas, ...listas, ...unidas].map((r) => (
                        <tr key={r.fila} className="border-t align-top">
                          <td className="px-2 py-1.5">{r.fila}</td>
                          <td className="px-2 py-1.5">
                            <p>{r.descripcion || r.insumoExcel}</p>
                            {r.descripcion && r.descripcion !== r.insumoExcel.toUpperCase() && (
                              <p className="text-muted-foreground">En el APU: {r.insumoExcel}</p>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            {r.errores.length === 0 && r.unidoAFila != null ? (
                              <span className="text-emerald-700">
                                <CheckCircle2 className="mr-1 inline size-3.5" />
                                Mismo insumo que la fila {r.unidoAFila}
                              </span>
                            ) : r.errores.length === 0 ? (
                              <span className="text-emerald-700">
                                <CheckCircle2 className="mr-1 inline size-3.5" />
                                Lista
                              </span>
                            ) : (
                              <ul className="space-y-0.5 text-destructive">
                                {r.errores.map((e) => (
                                  <li key={e}>
                                    <XCircle className="mr-1 inline size-3.5" />
                                    {e}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            {r.lineas === 0 ? (
                              <span className="text-muted-foreground">Ninguna pendiente</span>
                            ) : (
                              <>
                                {r.lineas - r.lineasNoCuadran} se asignan
                                {r.lineasNoCuadran > 0 && (
                                  <span className="block text-amber-700">{r.lineasNoCuadran} no cuadran en unidad (quedan pendientes)</span>
                                )}
                                {r.avisoUnidad && <span className="mt-0.5 block text-amber-700">{r.avisoUnidad}</span>}
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          )}

          {error && abierto && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button variant="outline" disabled={trabajando !== null} onClick={cerrar}>
              {resultado ? "Cerrar" : "Cancelar"}
            </Button>
            {!resultado && (
              <Button disabled={listas.length === 0 || trabajando !== null} onClick={crear}>
                {trabajando === "creando" && <Loader2 className="mr-1.5 size-4 animate-spin" />}
                {trabajando === "creando" ? "Creando..." : `Crear ${listas.length} insumos`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
