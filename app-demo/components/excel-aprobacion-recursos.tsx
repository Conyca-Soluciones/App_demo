"use client"

// Aprobación de mano de obra y equipos por Excel (2026-11-12): se descargan
// las solicitudes pendientes (una fila por actividad, con capítulo e ítems),
// se llenan grupo, unidad y valor (o el motivo para rechazar) y al subirlo
// cada fila se aprueba o se rechaza por separado (lib/excel-aprobacion-recursos.ts).

import { useState } from "react"
import * as XLSX from "xlsx"
import { Button } from "@/components/ui/button"
import {
  agruparAprobaciones,
  descargarExcelAprobacionRecursos,
  leerFilasAprobacionRecursos,
  type ErrorFilaRecurso,
  type FilaAprobacionRecurso,
} from "@/lib/excel-aprobacion-recursos"
import type { SolicitudRecursoAprobar } from "@/lib/solicitudes-recurso"
import { aprobarSolicitudesRecurso } from "@/app/(app)/presupuestos/actions"

const A_LA_VEZ = 3
const ERRORES_VISIBLES = 50

type Resultado = { aprobadas: number; rechazadas: number; sinLlenar: number; errores: ErrorFilaRecurso[] }

export function ExcelAprobacionRecursos({
  tipo,
  solicitudes,
  listas,
  rechazar,
  onResueltas,
}: {
  tipo: "mano_obra" | "equipo"
  solicitudes: SolicitudRecursoAprobar[]
  listas: { unidades: string[]; grupos: string[] }
  rechazar: (id: string, motivo?: string) => Promise<void>
  // ids que ya no están pendientes (aprobadas o rechazadas)
  onResueltas: (ids: string[]) => void
}) {
  const [descargando, setDescargando] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const [avance, setAvance] = useState<{ hechas: number; total: number } | null>(null)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleDescargar() {
    setDescargando(true)
    setError(null)
    try {
      await descargarExcelAprobacionRecursos(tipo, solicitudes, listas)
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
      const leidas = leerFilasAprobacionRecursos(filasExcel)
      const errores: ErrorFilaRecurso[] = [...leidas.errores]
      const pendientes = new Set(solicitudes.map((s) => s.id))
      const porHacer: FilaAprobacionRecurso[] = []
      for (const f of leidas.filas) {
        if (pendientes.has(f.solicitudId)) porHacer.push(f)
        else errores.push({ fila: f.fila, actividad: f.actividad, mensaje: "Ya no está pendiente (alguien la aprobó o rechazó)." })
      }
      if (porHacer.length === 0) {
        setResultado({ aprobadas: 0, rechazadas: 0, sinLlenar: leidas.sinLlenar, errores })
        if (errores.length === 0) setError("No hay ninguna fila con valor o motivo de rechazo.")
        return
      }

      // Por aprobar: mismo nombre y unidad = una sola categoría (un trabajo
      // por grupo). Por rechazar: una por fila.
      // Las filas sin valor se suman al grupo con el mismo nombre y unidad que
      // sí trae el valor (solo las que siguen pendientes).
      const { grupos, errores: erroresGrupos, sumadasSinValor } = agruparAprobaciones(
        porHacer.filter((f): f is Extract<FilaAprobacionRecurso, { accion: "aprobar" }> => f.accion === "aprobar"),
        leidas.sinValor.filter((f) => pendientes.has(f.solicitudId))
      )
      errores.push(...erroresGrupos)
      const sinLlenar = leidas.sinLlenar - sumadasSinValor
      const trabajos: (() => Promise<void>)[] = []
      let aprobadas = 0
      let rechazadas = 0
      let hechas = 0
      const total = grupos.reduce((n, g) => n + g.filas.length, 0) + porHacer.filter((f) => f.accion === "rechazar").length
      const resueltas: string[] = []
      for (const g of grupos) {
        trabajos.push(async () => {
          try {
            const r = await aprobarSolicitudesRecurso(tipo, {
              solicitudIds: g.filas.map((f) => f.solicitudId),
              nombre: g.nombre,
              grupo: g.grupo,
              unidad: g.unidad,
              valorUnitario: g.valor,
              enlazarSiExiste: true,
              exigirMismoValor: true,
            })
            aprobadas += r.aprobadas.length
            resueltas.push(...r.aprobadas)
          } catch (e) {
            const mensaje = e instanceof Error ? e.message : "No se pudo aprobar."
            for (const f of g.filas) errores.push({ fila: f.fila, actividad: f.actividad, mensaje })
          }
          hechas += g.filas.length
          setAvance({ hechas, total })
        })
      }
      for (const f of porHacer) {
        if (f.accion !== "rechazar") continue
        trabajos.push(async () => {
          try {
            await rechazar(f.solicitudId, f.motivo)
            rechazadas++
            resueltas.push(f.solicitudId)
          } catch (e) {
            errores.push({ fila: f.fila, actividad: f.actividad, mensaje: e instanceof Error ? e.message : "No se pudo rechazar." })
          }
          hechas++
          setAvance({ hechas, total })
        })
      }
      setAvance({ hechas: 0, total })
      let siguiente = 0
      const trabajador = async () => {
        while (siguiente < trabajos.length) await trabajos[siguiente++]()
      }
      await Promise.all(Array.from({ length: Math.min(A_LA_VEZ, trabajos.length) }, trabajador))
      errores.sort((a, b) => a.fila - b.fila)
      setResultado({ aprobadas, rechazadas, sinLlenar, errores })
      if (resueltas.length > 0) onResueltas(resueltas)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo procesar el Excel.")
    } finally {
      setSubiendo(false)
      setAvance(null)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={handleDescargar} disabled={descargando || solicitudes.length === 0}>
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
            className={`inline-flex h-8 cursor-pointer items-center rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted/40 ${
              subiendo ? "pointer-events-none opacity-50" : ""
            }`}
          >
            {subiendo ? (avance ? `Resolviendo ${avance.hechas} de ${avance.total}…` : "Leyendo…") : "Subir Excel"}
          </span>
        </label>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {resultado && (
        <div className="space-y-1 rounded-md border px-3 py-2 text-sm">
          <p className="text-emerald-700">
            {resultado.aprobadas} aprobada(s) y {resultado.rechazadas} rechazada(s).
            {resultado.sinLlenar > 0 && ` ${resultado.sinLlenar} fila(s) sin valor ni motivo se dejaron para después.`}
          </p>
          {resultado.errores.length > 0 && (
            <div className="text-destructive">
              <p className="font-medium">{resultado.errores.length} fila(s) con error (corrígelas y sube el archivo otra vez):</p>
              <ul className="list-inside list-disc">
                {resultado.errores.slice(0, ERRORES_VISIBLES).map((e, i) => (
                  <li key={i}>
                    {e.fila > 0 ? `Fila ${e.fila}` : "Fila"}
                    {e.actividad ? ` (${e.actividad})` : ""}: {e.mensaje}
                  </li>
                ))}
              </ul>
              {resultado.errores.length > ERRORES_VISIBLES && <p>Y {resultado.errores.length - ERRORES_VISIBLES} más.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
