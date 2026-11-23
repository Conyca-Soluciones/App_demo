"use client"

// Resumen de lo que cambia entre el Excel y la versión vigente, antes de crear
// la versión nueva (lib/comparar-version.ts). Solo muestra: crear la versión
// sigue igual (botón "Crear versión" de la página).

import { useState } from "react"
import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react"
import type { CambioCampo, ResultadoComparacion } from "@/lib/comparar-version"

const NOMBRE_CAMPO: Record<CambioCampo, string> = {
  descripcion: "Descripción",
  unidad: "Unidad",
  cantidad: "Cantidad",
  precioOficial: "Precio oficial",
}

const num = (v: number | null) => (v == null ? "—" : v.toLocaleString("es-CO", { maximumFractionDigits: 4 }))
const pesos = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })
const valorCampo = (campo: CambioCampo, v: string | number | null) =>
  v == null || v === "" ? "—" : campo === "precioOficial" ? pesos(Number(v)) : campo === "cantidad" ? num(Number(v)) : String(v)

function Seccion({
  titulo,
  cantidad,
  tono = "normal",
  children,
}: {
  titulo: string
  cantidad: number
  tono?: "normal" | "alerta"
  children: React.ReactNode
}) {
  const [abierta, setAbierta] = useState(false)
  if (cantidad === 0) return null
  return (
    <div className={`rounded-md border bg-white ${tono === "alerta" ? "border-amber-300" : ""}`}>
      <button
        type="button"
        onClick={() => setAbierta((a) => !a)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium"
      >
        {abierta ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        {tono === "alerta" && <TriangleAlert className="size-4 text-amber-600" />}
        {titulo}
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs">{cantidad}</span>
      </button>
      {abierta && <div className="max-h-80 overflow-auto border-t px-3 py-2 text-xs">{children}</div>}
    </div>
  )
}

export function ComparacionVersion({ comparacion }: { comparacion: ResultadoComparacion }) {
  const c = comparacion
  const quitablesN = c.quitados.filter((q) => !q.conMovimientos).length
  return (
    <div className="space-y-2">
      <p className="text-sm text-sky-900">
        Frente a la versión vigente ({c.totalVigente} ítems): <strong>{c.nuevos.length}</strong> nuevos ·{" "}
        <strong>{c.quitados.length}</strong> ya no vienen · <strong>{c.cambios.length}</strong> con cantidad, descripción, unidad o
        precio distintos · <strong>{c.apus.length}</strong> con el APU distinto · {c.sinCambios} sin cambios.
      </p>

      <Seccion titulo="Revisa antes de crear la versión" cantidad={c.alertas.length} tono="alerta">
        <ul className="space-y-1">
          {c.alertas.map((a, i) => (
            <li key={`${a.tipo}-${a.codigo}-${i}`}>
              <span className="font-mono font-medium">{a.codigo}</span> {a.descripcion}: <span className="text-amber-800">{a.mensaje}</span>
            </li>
          ))}
        </ul>
      </Seccion>

      <Seccion titulo="Ítems nuevos" cantidad={c.nuevos.length}>
        <ul className="space-y-0.5">
          {c.nuevos.map((i) => (
            <li key={i.codigo}>
              <span className="font-mono font-medium">{i.codigo}</span> {i.descripcion}
              {i.esHoja && (
                <span className="text-muted-foreground">
                  {" "}
                  · {num(i.cantidad)} {i.unidad ?? ""} · {pesos(i.precioOficial)}
                  {i.esGlobal ? " · global (sin APU)" : i.lineas ? ` · APU de ${i.lineas.length} líneas` : " · sin bloque en la hoja APU"}
                </span>
              )}
            </li>
          ))}
        </ul>
      </Seccion>

      <Seccion titulo={`Ítems que ya no vienen (${quitablesN} se quitarían)`} cantidad={c.quitados.length}>
        <ul className="space-y-0.5">
          {c.quitados.map((i) => (
            <li key={i.codigo}>
              <span className="font-mono font-medium">{i.codigo}</span> {i.descripcion}
              {i.conMovimientos && <span className="text-amber-800"> · tiene requisiciones o contratos: no se quita</span>}
            </li>
          ))}
        </ul>
      </Seccion>

      <Seccion titulo="Cantidad, descripción, unidad o precio distintos" cantidad={c.cambios.length}>
        <table className="w-full" data-tabla-libre>
          <tbody>
            {c.cambios.flatMap((ch) =>
              ch.campos.map((f, k) => (
                <tr key={`${ch.codigo}-${f.campo}`} className="border-b align-top last:border-b-0">
                  <td className="py-1 pr-2 font-mono font-medium">{k === 0 ? ch.codigo : ""}</td>
                  <td className="py-1 pr-2">{k === 0 ? ch.descripcion : ""}</td>
                  <td className="py-1 pr-2 text-muted-foreground">{NOMBRE_CAMPO[f.campo]}</td>
                  <td className="py-1 pr-2">{valorCampo(f.campo, f.antes)}</td>
                  <td className="py-1 pr-2">→</td>
                  <td className="py-1 font-medium">{valorCampo(f.campo, f.ahora)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Seccion>

      <Seccion titulo="APU distintos" cantidad={c.apus.length}>
        <div className="space-y-2">
          {c.apus.map((a) => (
            <div key={a.codigo}>
              <p className="font-medium">
                <span className="font-mono">{a.codigo}</span> {a.descripcion}
              </p>
              <ul className="ml-4 list-disc text-muted-foreground">
                {a.nuevas.map((l, i) => (
                  <li key={`n${i}`}>
                    <span className="text-emerald-700">Nueva:</span> {l.tipo} · {l.descripcion} · {num(l.cantidad)} {l.unidad ?? ""}
                  </li>
                ))}
                {a.quitadas.map((l, i) => (
                  <li key={`q${i}`}>
                    <span className="text-red-700">Ya no viene:</span> {l.tipo} · {l.descripcion} · {num(l.cantidad)} {l.unidad ?? ""}
                  </li>
                ))}
                {a.cantidades.map((l, i) => (
                  <li key={`c${i}`}>
                    <span className="text-sky-700">Cantidad:</span> {l.tipo} · {l.descripcion}: {num(l.antes)} → {num(l.ahora)} {l.unidad ?? ""}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Seccion>
    </div>
  )
}
