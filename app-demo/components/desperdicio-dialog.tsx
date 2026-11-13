"use client"

// Desperdicio del presupuesto (decisión del usuario, 2026-11-13): un % general
// de la versión vigente que la base aplica sola a todas las cantidades de
// insumos, también a las que entren después (insumos aprobados, revisión,
// editor). Sube el valor del presupuesto y el cupo de las requisiciones. Las
// líneas cuyo Excel ya dice "desperdicio" quedan sin % adicional. Excepciones
// por insumo: desmarcarlo (sin desperdicio) u otro %.

import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { fijarDesperdicioPresupuesto, listarInsumosDesperdicio } from "@/app/(app)/presupuestos/actions"
import {
  filasIniciales,
  impactoDesperdicio,
  excepcionesParaGuardar,
  porcentajeDeFila,
  porcentajeValido,
  type DatosDesperdicio,
  type FilaDesperdicio,
} from "@/lib/desperdicio"
import { leerNumero } from "@/lib/contratos"

const pesos = (n: number) =>
  n.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })
const numero = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 2 })

const PORCENTAJE_GENERAL = 5

export function DesperdicioDialog({
  open,
  onOpenChange,
  versionId,
  onGuardado,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  versionId: string
  onGuardado: () => void | Promise<void>
}) {
  const [cargado, setCargado] = useState<{ versionId: string; datos: DatosDesperdicio } | null>(null)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [filas, setFilas] = useState<FilaDesperdicio[]>([])
  const [generalTexto, setGeneralTexto] = useState(String(PORCENTAJE_GENERAL))
  // Texto de cada % por insumo mientras se escribe ("5," todavía no es número)
  const [textos, setTextos] = useState<Record<string, string>>({})
  const [busqueda, setBusqueda] = useState("")
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultado, setResultado] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let vigente = true
    listarInsumosDesperdicio(versionId)
      .then((datos: DatosDesperdicio) => {
        if (!vigente) return
        setCargado({ versionId, datos })
        setFilas(filasIniciales(datos.insumos))
        setTextos({})
        // Sin desperdicio todavía se propone el 5 %; si ya hay, el guardado.
        setGeneralTexto(numero(datos.general > 0 ? datos.general : PORCENTAJE_GENERAL))
        setErrorCarga(null)
      })
      .catch((e) => vigente && setErrorCarga(e instanceof Error ? e.message : "No se pudieron cargar los insumos."))
    return () => {
      vigente = false
    }
  }, [open, versionId])

  const datos = cargado?.versionId === versionId ? cargado.datos : null
  const cargando = open && !datos && !errorCarga
  const general = leerNumero(generalTexto)
  const generalOk = porcentajeValido(general)
  const porId = useMemo(() => new Map(filas.map((f) => [f.insumoId, f])), [filas])

  const visibles = useMemo(() => {
    if (!datos) return []
    const t = busqueda.trim().toLowerCase()
    if (!t) return datos.insumos
    return datos.insumos.filter((i) => i.descripcion.toLowerCase().includes(t) || String(i.codigo ?? "").includes(t))
  }, [datos, busqueda])

  const impacto = useMemo(
    () => (datos && generalOk ? impactoDesperdicio(datos.insumos, filas, general ?? 0) : { aumento: 0, marcados: 0 }),
    [datos, filas, general, generalOk]
  )
  const filasInvalidas = filas.some((f) => {
    if (!f.marcado) return false
    const t = textos[f.insumoId]
    if (t != null && t.trim() !== "" && leerNumero(t) == null) return true
    return f.porcentaje != null && !porcentajeValido(f.porcentaje)
  })
  const visiblesMarcados = visibles.filter((i) => porId.get(i.insumoId)?.marcado).length
  const todosVisiblesMarcados = visibles.length > 0 && visiblesMarcados === visibles.length

  function cambiar(insumoId: string, cambio: Partial<FilaDesperdicio>) {
    setFilas((fs) => fs.map((f) => (f.insumoId === insumoId ? { ...f, ...cambio } : f)))
    setResultado(null)
  }

  function marcarVisibles(marcado: boolean) {
    const ids = new Set(visibles.map((i) => i.insumoId))
    setFilas((fs) => fs.map((f) => (ids.has(f.insumoId) ? { ...f, marcado } : f)))
    setResultado(null)
  }

  async function guardar() {
    if (!generalOk || filasInvalidas) return
    setGuardando(true)
    setError(null)
    try {
      const g = general ?? 0
      const r = await fijarDesperdicioPresupuesto(versionId, g, excepcionesParaGuardar(filas, g))
      setResultado(
        `Guardado: ${numero(g)} % general${r.excepciones > 0 ? ` y ${r.excepciones} excepción(es)` : ""}. ` +
          `El presupuesto pasó de ${pesos(r.valorAntes)} a ${pesos(r.valorDespues)}.`
      )
      await onGuardado()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el desperdicio.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Desperdicio</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          El % general se aplica a <span className="font-medium">todas</span> las cantidades de insumos de esta versión,
          también a las que entren después (insumos que apruebe Compras, líneas resueltas en Revisar pendientes). Sube
          el valor del presupuesto y lo que se puede pedir en requisiciones. Las líneas cuyo Excel ya dice
          &ldquo;desperdicio&rdquo; (concretos, morteros) quedan sin % adicional. En la lista puedes quitarle el
          desperdicio a un insumo o ponerle otro %. Para quitarlo todo, pon el general en 0.
        </p>

        {cargando && <p className="py-6 text-sm text-muted-foreground">Cargando insumos…</p>}
        {errorCarga && <p className="text-sm text-destructive">{errorCarga}</p>}

        {datos && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1 text-sm">
                <span className="font-medium">Desperdicio general (%)</span>
                <Input
                  value={generalTexto}
                  onChange={(e) => {
                    setGeneralTexto(e.target.value)
                    setResultado(null)
                  }}
                  className="h-8 w-24 text-right"
                  inputMode="decimal"
                />
              </label>
              <Input
                placeholder="Buscar insumo o código"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="h-8 w-64"
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={todosVisiblesMarcados}
                  onChange={(e) => marcarVisibles(e.target.checked)}
                />
                Seleccionar todos{busqueda.trim() ? " (los de la búsqueda)" : ""}
              </label>
              {!generalOk && <span className="text-sm text-destructive">Escribe un % entre 0 y 100.</span>}
            </div>

            <div className="min-h-0 flex-1 overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0">
                  <tr>
                    <th className="w-10 px-2 py-2" />
                    <th className="px-2 py-2 text-left">Insumo</th>
                    <th className="px-2 py-2 text-left">UM</th>
                    <th className="px-2 py-2 text-right">Ítems</th>
                    <th className="px-2 py-2 text-right">Cantidad sin desperdicio</th>
                    <th className="px-2 py-2 text-right">Valor sin desperdicio</th>
                    <th className="w-28 px-2 py-2 text-right">%</th>
                    <th className="px-2 py-2 text-right">Suma</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((i) => {
                    const f = porId.get(i.insumoId)
                    if (!f) return null
                    const pct = generalOk ? porcentajeDeFila(f, general ?? 0) : 0
                    return (
                      <tr key={i.insumoId} className={f.marcado ? "" : "text-muted-foreground"}>
                        <td className="px-2 py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={f.marcado}
                            onChange={(e) => cambiar(i.insumoId, { marcado: e.target.checked })}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="text-muted-foreground">{i.codigo ?? ""} </span>
                          {i.descripcion}
                          {i.lineasTrae > 0 && (
                            <span
                              className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900"
                              title="Esas líneas quedan sin % adicional"
                            >
                              {i.lineasTrae} línea(s) ya traen desperdicio
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">{i.unidad ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right">{i.nItems}</td>
                        <td className="px-2 py-1.5 text-right">{numero(i.cantidadBase)}</td>
                        <td className="px-2 py-1.5 text-right">{pesos(i.valorBase)}</td>
                        <td className="px-2 py-1.5 text-right">
                          <Input
                            value={textos[i.insumoId] ?? (f.porcentaje == null ? "" : numero(f.porcentaje))}
                            placeholder={generalOk ? numero(general ?? 0) : ""}
                            disabled={!f.marcado}
                            onChange={(e) => {
                              const t = e.target.value
                              setTextos((x) => ({ ...x, [i.insumoId]: t }))
                              cambiar(i.insumoId, { porcentaje: t.trim() === "" ? null : leerNumero(t) })
                            }}
                            className="ml-auto h-7 w-20 text-right"
                            inputMode="decimal"
                            title="Vacío = el % general"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right">{pct > 0 && i.valorAplicable > 0 ? pesos((i.valorAplicable * pct) / 100) : "—"}</td>
                      </tr>
                    )
                  })}
                  {visibles.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-2 py-6 text-center text-muted-foreground">
                        {datos.insumos.length === 0 ? "Esta versión no tiene insumos en sus APU." : "Ningún insumo con esa búsqueda."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm">
              <div>
                <p>
                  Con lo que ya está en los APU, el desperdicio suma{" "}
                  <span className="font-semibold">{pesos(impacto.aumento)}</span> en {impacto.marcados} insumo(s). Lo
                  que se apruebe después también lo toma.
                </p>
                <p className="text-xs text-muted-foreground">
                  Aproximado: el valor exacto lo calcula la base al guardar (redondeos por ítem).
                </p>
                {filasInvalidas && <p className="text-destructive">Hay un % por insumo que no es un número entre 0 y 100.</p>}
                {error && <p className="text-destructive">{error}</p>}
                {resultado && <p className="text-emerald-700">{resultado}</p>}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>
                  Cerrar
                </Button>
                <Button onClick={guardar} disabled={guardando || !generalOk || filasInvalidas}>
                  {guardando ? "Guardando…" : "Guardar desperdicio"}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
