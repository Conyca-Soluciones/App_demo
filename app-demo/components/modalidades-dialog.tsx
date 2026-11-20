"use client"

// Modalidades del presupuesto actual (2026-11-16, paso 4; ver lib/modalidades.ts):
// se baja el Excel con los ítems, se llenan Modalidad y Mano de obra, se sube,
// se ve el resumen (sin cambiar nada) y se aplica. Lo resuelto del APU se
// conserva: lo que una modalidad no usa queda guardado aparte y vuelve si cambia.
// Las filas con error no frenan las demás (decisión del usuario, 2026-11-20): se
// aplican las buenas, se listan las que tienen error y el Excel corregido se
// vuelve a subir (solo cambian los ítems distintos).

import { useRef, useState } from "react"
import * as XLSX from "xlsx"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { fijarModalidadesPresupuesto, infoModalidadesVersion } from "@/app/(app)/presupuestos/actions"
import {
  descargarExcelModalidades,
  filasParaAplicar,
  leerFilasModalidades,
  mensajeErrorModalidad,
  type FilaModalidadExcel,
} from "@/lib/excel-modalidades"
import { MODALIDADES, NOMBRE_MODALIDAD, type ResultadoModalidades } from "@/lib/modalidades"

const pesos = (n: number) => n.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })
const entero = (n: number) => n.toLocaleString("es-CO")

export function ModalidadesDialog({
  open,
  onOpenChange,
  presupuestoId,
  versionId,
  nombreProyecto,
  onAplicado,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  presupuestoId: string
  versionId: string
  nombreProyecto: string
  onAplicado: () => void | Promise<void>
}) {
  const archivoRef = useRef<HTMLInputElement>(null)
  const [descargando, setDescargando] = useState(false)
  const [revisando, setRevisando] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errores, setErrores] = useState<string[]>([])
  const [nombreArchivo, setNombreArchivo] = useState<string | null>(null)
  const [filas, setFilas] = useState<FilaModalidadExcel[] | null>(null)
  const [resumen, setResumen] = useState<ResultadoModalidades | null>(null)
  // Ítems con requisiciones o contratos que se dejaron como estaban.
  const [saltadas, setSaltadas] = useState(0)
  // Cuántos ítems se aplicaron cuando quedaron filas con error (el diálogo sigue
  // abierto con la lista para corregirlas).
  const [aplicados, setAplicados] = useState<number | null>(null)

  function limpiar() {
    setError(null)
    setErrores([])
    setFilas(null)
    setResumen(null)
    setNombreArchivo(null)
    setSaltadas(0)
    setAplicados(null)
  }

  async function descargar() {
    setDescargando(true)
    setError(null)
    try {
      const items = await infoModalidadesVersion(versionId)
      items.sort((a, b) => a.codigo.localeCompare(b.codigo, "es", { numeric: true }))
      await descargarExcelModalidades(nombreProyecto, items)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo armar el Excel.")
    } finally {
      setDescargando(false)
    }
  }

  async function subir(archivo: File) {
    limpiar()
    setNombreArchivo(archivo.name)
    setRevisando(true)
    try {
      const libro = XLSX.read(await archivo.arrayBuffer(), { type: "array" })
      const hoja = libro.Sheets[libro.SheetNames[0]]
      const matriz = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, defval: null })
      const leido = leerFilasModalidades(matriz)
      // Las filas que no se pudieron leer quedan por fuera; las demás siguen.
      const mensajes = [...leido.errores]
      if (leido.filas.length === 0) {
        if (mensajes.length > 0) setErrores(mensajes)
        else setError("El Excel no trae ítems.")
        return
      }
      const info = await infoModalidadesVersion(versionId)
      const porAplicar = filasParaAplicar(leido.filas, new Map(info.map((i) => [i.codigo, i])))
      // Vista previa: la base aplica todo dentro de un bloque que deshace. Si
      // hay filas con error, se quitan y se revisan otra vez las demás (la base
      // no aplica nada mientras haya un error).
      let buenas = porAplicar.filas
      let r: ResultadoModalidades | null = null
      for (let intento = 0; intento < 3 && buenas.length > 0; intento++) {
        const previa = await fijarModalidadesPresupuesto(presupuestoId, buenas, false)
        if (previa.errores.length === 0) {
          r = previa
          break
        }
        const malas = new Set<number>()
        for (const e of previa.errores) {
          const f = buenas[e.fila - 1]
          malas.add(e.fila - 1)
          mensajes.push(
            `  Fila ${f?.filaExcel ?? "?"} (ítem ${e.codigo ?? f?.codigo ?? "?"}): ${mensajeErrorModalidad(f, e.error)}`
          )
        }
        buenas = buenas.filter((_, i) => !malas.has(i))
      }
      setErrores(mensajes)
      if (!r) return
      setFilas(buenas)
      setSaltadas(porAplicar.saltadas)
      setResumen(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el Excel.")
    } finally {
      setRevisando(false)
      if (archivoRef.current) archivoRef.current.value = ""
    }
  }

  async function aplicar() {
    if (!filas) return
    setAplicando(true)
    setError(null)
    try {
      const r = await fijarModalidadesPresupuesto(presupuestoId, filas, true)
      if (r.errores.length > 0) {
        // Algo cambió entre la vista previa y ahora (otra persona, una requisición nueva...).
        setResumen(null)
        setFilas(null)
        setAplicados(null)
        setErrores(r.errores.map((e) => `  Ítem ${e.codigo ?? "?"}: ${e.error}`))
        return
      }
      await onAplicado()
      if (errores.length > 0) {
        // Quedan filas con error: el diálogo sigue abierto con la lista.
        setResumen(null)
        setFilas(null)
        setAplicados(r.cambian)
        return
      }
      limpiar()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron aplicar las modalidades.")
    } finally {
      setAplicando(false)
    }
  }

  const diferencia = resumen ? resumen.valorDespues - resumen.valorAntes : 0

  return (
    <Dialog
      open={open}
      onOpenChange={(abierto) => {
        if (!abierto && !aplicando) limpiar()
        if (!aplicando) onOpenChange(abierto)
      }}
    >
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Modalidades del presupuesto</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Cada ítem se ejecuta por <strong>Administración</strong>, <strong>Subcontrato todo costo</strong> (vale el %
            de todo costo del proyecto sobre el precio oficial) o <strong>Subcontrato mano de obra</strong>. Se aplica sobre
            este presupuesto sin volver a importarlo: lo ya resuelto del APU se conserva, y lo que una modalidad no usa
            queda guardado aparte.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={descargar} disabled={descargando || revisando || aplicando}>
              {descargando ? "Armando el Excel…" : "1. Descargar Excel de modalidades"}
            </Button>
            <Button
              variant="outline"
              onClick={() => archivoRef.current?.click()}
              disabled={descargando || revisando || aplicando}
            >
              {revisando ? "Revisando…" : "2. Subir Excel lleno"}
            </Button>
            <input
              ref={archivoRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const archivo = e.target.files?.[0]
                if (archivo) subir(archivo)
              }}
            />
            {nombreArchivo && <span className="text-xs text-muted-foreground">{nombreArchivo}</span>}
          </div>

          {error && <p className="text-destructive">{error}</p>}

          {aplicados !== null && (
            <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-emerald-900">
              Se aplicaron {entero(aplicados)} ítem(s). Los de la lista de abajo quedaron sin aplicar: corrige el Excel y
              súbelo otra vez (solo cambian los ítems distintos).
            </p>
          )}

          {errores.length > 0 && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-900">
              <p className="font-medium">
                {resumen
                  ? `${errores.length} ítem(s) con error no se aplicarán. Puedes aplicar los demás ahora y después subir el Excel corregido.`
                  : aplicados !== null
                    ? `${errores.length} ítem(s) sin aplicar:`
                    : `No se aplicó nada: ${errores.length} ítem(s) con problemas. Corrige el Excel y súbelo otra vez.`}
              </p>
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap font-sans text-xs">{errores.join("\n")}</pre>
            </div>
          )}

          {resumen && (
            <div className="space-y-3 rounded-lg border bg-muted/20 px-4 py-3">
              <p className="font-medium">
                Revisa antes de aplicar (todavía no ha cambiado nada):
              </p>
              {resumen.cambian === 0 ? (
                <p>Ningún ítem cambia: el Excel dice lo mismo que el presupuesto.</p>
              ) : (
                <ul className="list-disc space-y-1 pl-5">
                  <li>
                    <strong>{entero(resumen.cambian)}</strong> ítem(s) cambian.
                  </li>
                  {resumen.preciosCambian > 0 && (
                    <li>
                      {entero(resumen.preciosCambian)} precio(s) oficial(es) se actualizan con el del Excel (quedan en el
                      historial con el valor de antes).
                    </li>
                  )}
                  <li>
                    Quedarán:{" "}
                    {[...MODALIDADES, "sin_modalidad" as const]
                      .filter((m) => resumen.porModalidad[m])
                      .map((m) => `${m === "sin_modalidad" ? "Sin modalidad" : NOMBRE_MODALIDAD[m]} ${entero(resumen.porModalidad[m] ?? 0)}`)
                      .join(" · ")}
                  </li>
                  <li>{entero(resumen.lineasGuardadas)} línea(s) del APU quedan guardadas aparte (no se borran).</li>
                  <li>{entero(resumen.lineasNoRequeridas)} línea(s) pendientes ya no hacen falta y salen de Revisar pendientes.</li>
                  {resumen.solicitudesCerradas > 0 && (
                    <li>Se cierran {entero(resumen.solicitudesCerradas)} solicitud(es) de aprobación que ya no sirven.</li>
                  )}
                  {saltadas > 0 && (
                    <li>
                      {entero(saltadas)} ítem(s) con requisiciones o contratos se quedan como están.
                    </li>
                  )}
                  <li>
                    Valor del presupuesto: {pesos(resumen.valorAntes)} → <strong>{pesos(resumen.valorDespues)}</strong>{" "}
                    <span className={diferencia < 0 ? "text-emerald-700" : diferencia > 0 ? "text-amber-700" : ""}>
                      ({diferencia >= 0 ? "+" : ""}
                      {pesos(diferencia)})
                    </span>
                  </li>
                </ul>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={limpiar} disabled={aplicando}>
                  Cancelar
                </Button>
                <Button onClick={aplicar} disabled={aplicando || resumen.cambian === 0}>
                  {aplicando
                    ? "Aplicando…"
                    : errores.length > 0
                      ? `3. Aplicar los ${entero(resumen.cambian)} que sí se pueden`
                      : "3. Aplicar"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
