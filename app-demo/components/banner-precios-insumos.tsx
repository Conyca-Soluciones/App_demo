"use client"

// Banner de Aprobación de insumos: las solicitudes pendientes se descargan en
// un Excel, se llenan (precio, IVA, tipo, unidad de compra, agrupación) y al
// subirlo cada fila completa se aprueba y entra al maestro
// (lib/excel-precios-insumos.ts). Las que no se llenan siguen en la lista.

import { useEffect, useState } from "react"
import * as XLSX from "xlsx"
import { Button } from "@/components/ui/button"
import {
  aprobarSolicitudesInsumoDesdeExcel,
  contarSolicitudesInsumoPendientes,
  listarSolicitudesInsumoParaPrecio,
} from "@/app/(app)/presupuestos/actions"
import {
  descargarExcelPreciosInsumos,
  leerFilasPreciosInsumos,
  type ErrorFilaPrecio,
  type FilaPrecioInsumo,
} from "@/lib/excel-precios-insumos"

const POR_TANDA = 5
const TANDAS_A_LA_VEZ = 3
const ERRORES_VISIBLES = 50

type Resultado = { aprobadas: number; sinPrecio: number; errores: ErrorFilaPrecio[] }

export function BannerPreciosInsumos({ onAprobadas }: { onAprobadas?: () => void }) {
  const [pendientes, setPendientes] = useState<number | null>(null)
  const [descargando, setDescargando] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const [avance, setAvance] = useState<{ hechas: number; total: number } | null>(null)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    contarSolicitudesInsumoPendientes()
      .then(setPendientes)
      .catch(() => setPendientes(0))
  }, [])

  async function handleDescargar() {
    setDescargando(true)
    setError(null)
    try {
      const { solicitudes, listas } = await listarSolicitudesInsumoParaPrecio()
      if (solicitudes.length === 0) {
        setPendientes(0)
        setError("No hay insumos esperando precio.")
        return
      }
      await descargarExcelPreciosInsumos(solicitudes, listas)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar el Excel.")
    } finally {
      setDescargando(false)
    }
  }

  async function handleSubir(archivo: File) {
    setSubiendo(true)
    setError(null)
    setResultado(null)
    try {
      const libro = XLSX.read(await archivo.arrayBuffer(), { type: "array" })
      const hoja = libro.Sheets[libro.SheetNames[0]]
      const filasExcel = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, defval: null })

      // Las listas y lo que sigue pendiente se piden otra vez: otra persona
      // pudo aprobar algo desde que se descargó el archivo.
      const { solicitudes, listas } = await listarSolicitudesInsumoParaPrecio()
      const leidas = leerFilasPreciosInsumos(filasExcel, listas)
      const pendientesAhora = new Set(solicitudes.map((s) => s.id))
      const errores: ErrorFilaPrecio[] = [...leidas.errores]
      const filaDe = new Map<string, { fila: number; insumo: string }>()
      const porAprobar: FilaPrecioInsumo[] = []
      for (const f of leidas.filas) {
        filaDe.set(f.solicitudId, { fila: f.fila, insumo: f.descripcion })
        if (pendientesAhora.has(f.solicitudId)) porAprobar.push(f)
        else errores.push({ fila: f.fila, insumo: f.descripcion, mensaje: "Ya no está pendiente (alguien lo aprobó o rechazó)." })
      }

      if (porAprobar.length === 0) {
        setResultado({ aprobadas: 0, sinPrecio: leidas.sinPrecio, errores })
        if (errores.length === 0) setError("No hay ninguna fila con precio.")
        return
      }

      const tandas: FilaPrecioInsumo[][] = []
      for (let i = 0; i < porAprobar.length; i += POR_TANDA) tandas.push(porAprobar.slice(i, i + POR_TANDA))
      let aprobadas = 0
      let hechas = 0
      setAvance({ hechas: 0, total: porAprobar.length })
      let siguiente = 0
      const trabajador = async () => {
        while (siguiente < tandas.length) {
          const tanda = tandas[siguiente++]
          try {
            const r = await aprobarSolicitudesInsumoDesdeExcel(tanda)
            aprobadas += r.aprobadas.length
            for (const e of r.errores) {
              const origen = filaDe.get(e.solicitudId)
              errores.push({ fila: origen?.fila ?? 0, insumo: origen?.insumo ?? "", mensaje: e.mensaje })
            }
          } catch (e) {
            const mensaje = e instanceof Error ? e.message : "No se pudo aprobar."
            for (const f of tanda) {
              const origen = filaDe.get(f.solicitudId)
              errores.push({ fila: origen?.fila ?? 0, insumo: f.descripcion, mensaje })
            }
          }
          hechas += tanda.length
          setAvance({ hechas, total: porAprobar.length })
        }
      }
      await Promise.all(Array.from({ length: Math.min(TANDAS_A_LA_VEZ, tandas.length) }, trabajador))

      errores.sort((a, b) => a.fila - b.fila)
      setResultado({ aprobadas, sinPrecio: leidas.sinPrecio, errores })
      setPendientes(await contarSolicitudesInsumoPendientes())
      if (aprobadas > 0) onAprobadas?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo procesar el Excel.")
    } finally {
      setSubiendo(false)
      setAvance(null)
    }
  }

  if (pendientes === null || (pendientes === 0 && !resultado && !error)) return null

  return (
    <div className="space-y-2 rounded-lg border border-sky-300 bg-sky-50 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-sky-900">
          {pendientes > 0
            ? `${pendientes} solicitud(es) por aprobar. Puedes aprobarlas en bloque: descarga el Excel, llena precio, IVA, tipo, unidad de compra y agrupación, y súbelo. Cada fila completa queda aprobada en el maestro; las que dejes sin precio siguen aquí.`
            : "No quedan solicitudes por aprobar."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleDescargar} disabled={descargando || pendientes === 0}>
            {descargando ? "Generando…" : "Descargar Excel"}
          </Button>
          <label className="inline-flex">
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              disabled={subiendo}
              onChange={(e) => {
                const archivo = e.target.files?.[0]
                e.target.value = "" // permite subir el mismo archivo otra vez
                if (archivo) handleSubir(archivo)
              }}
            />
            <span
              className={`inline-flex cursor-pointer items-center rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted/40 ${
                subiendo ? "pointer-events-none opacity-50" : ""
              }`}
            >
              {subiendo
                ? avance
                  ? `Aprobando ${avance.hechas} de ${avance.total}…`
                  : "Leyendo…"
                : "Subir Excel con precios"}
            </span>
          </label>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {resultado && (
        <div className="space-y-1 border-t border-sky-200 pt-2 text-sm">
          <p className="text-emerald-700">
            {resultado.aprobadas} insumo(s) aprobado(s) y agregado(s) al maestro.
            {resultado.sinPrecio > 0 && ` ${resultado.sinPrecio} fila(s) sin precio se dejaron para después.`}
          </p>
          {resultado.errores.length > 0 && (
            <div className="text-destructive">
              <p className="font-medium">{resultado.errores.length} fila(s) con error (corrígelas y sube el archivo otra vez):</p>
              <ul className="list-inside list-disc">
                {resultado.errores.slice(0, ERRORES_VISIBLES).map((e, i) => (
                  <li key={i}>
                    {e.fila > 0 ? `Fila ${e.fila}` : "Fila"}
                    {e.insumo ? ` (${e.insumo})` : ""}: {e.mensaje}
                  </li>
                ))}
              </ul>
              {resultado.errores.length > ERRORES_VISIBLES && (
                <p>Y {resultado.errores.length - ERRORES_VISIBLES} más.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
