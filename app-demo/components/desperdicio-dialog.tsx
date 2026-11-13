"use client"

// Desperdicio del presupuesto (decisiones del usuario, 2026-11-13). Es de la
// CANTIDAD, no del insumo del maestro: un % general de la versión vigente que
// la base aplica sola a todas las líneas de insumo del APU, también a las que
// esperan aprobación (lo toman al aprobarse). La lista trae TODAS las líneas de
// insumo del Excel por su texto; se desmarcan las que no llevan desperdicio
// (concretos, morteros "5% desperdicio") o se les pone otro %.

import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { fijarDesperdicioPresupuesto, listarInsumosDesperdicio } from "@/app/(app)/presupuestos/actions"
import {
  excepcionesParaGuardar,
  filasIniciales,
  impactoDesperdicio,
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
  // Texto de cada % mientras se escribe ("5," todavía no es número)
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
        setFilas(filasIniciales(datos))
        setTextos({})
        setGeneralTexto(numero(datos.configurado ? datos.general : PORCENTAJE_GENERAL))
        setErrorCarga(null)
      })
      .catch((e) => vigente && setErrorCarga(e instanceof Error ? e.message : "No se pudieron cargar las líneas."))
    return () => {
      vigente = false
    }
  }, [open, versionId])

  const datos = cargado?.versionId === versionId ? cargado.datos : null
  const cargando = open && !datos && !errorCarga
  const general = leerNumero(generalTexto)
  const generalOk = porcentajeValido(general)
  const porClave = useMemo(() => new Map(filas.map((f) => [f.clave, f])), [filas])

  const visibles = useMemo(() => {
    if (!datos) return []
    const t = busqueda.trim().toLowerCase()
    if (!t) return datos.lineas
    return datos.lineas.filter((l) => l.descripcion.toLowerCase().includes(t))
  }, [datos, busqueda])

  const impacto = useMemo(
    () => (datos && generalOk ? impactoDesperdicio(datos.lineas, filas, general ?? 0) : { aumento: 0, marcadas: 0 }),
    [datos, filas, general, generalOk]
  )
  const pendientes = useMemo(() => (datos ? datos.lineas.reduce((n, l) => n + l.lineasPendientes, 0) : 0), [datos])
  const filasInvalidas = filas.some((f) => {
    if (!f.marcado) return false
    const t = textos[f.clave]
    if (t != null && t.trim() !== "" && leerNumero(t) == null) return true
    return f.porcentaje != null && !porcentajeValido(f.porcentaje)
  })
  const visiblesMarcadas = visibles.filter((l) => porClave.get(l.clave)?.marcado).length
  const todasVisiblesMarcadas = visibles.length > 0 && visiblesMarcadas === visibles.length

  function cambiar(clave: string, cambio: Partial<FilaDesperdicio>) {
    setFilas((fs) => fs.map((f) => (f.clave === clave ? { ...f, ...cambio } : f)))
    setResultado(null)
  }

  function marcarVisibles(marcado: boolean) {
    const claves = new Set(visibles.map((l) => l.clave))
    setFilas((fs) => fs.map((f) => (claves.has(f.clave) ? { ...f, marcado } : f)))
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
        `Guardado: ${numero(g)} % general${r.excepciones > 0 ? ` y ${r.excepciones} línea(s) con excepción` : ""}. ` +
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
      <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Desperdicio</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          El desperdicio sube la <span className="font-medium">cantidad</span> de las líneas de insumo del APU: sube el
          valor del presupuesto y lo que se puede pedir en requisiciones. Salen todas las líneas de insumo del Excel, aprobadas
          o esperando aprobación; las pendientes toman su % solas cuando se aprueben. Desmarca las que no llevan desperdicio
          (las que ya dicen &ldquo;desperdicio&rdquo; llegan desmarcadas la primera vez) o escribe otro %. Para quitarlo
          todo, pon el general en 0.
        </p>

        {cargando && <p className="py-6 text-sm text-muted-foreground">Cargando líneas…</p>}
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
                placeholder="Buscar línea (ej. concreto, mortero)"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="h-8 w-72"
              />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={todasVisiblesMarcadas} onChange={(e) => marcarVisibles(e.target.checked)} />
                Seleccionar todas{busqueda.trim() ? " (las de la búsqueda)" : ""}
              </label>
              {!generalOk && <span className="text-sm text-destructive">Escribe un % entre 0 y 100.</span>}
            </div>

            <div className="min-h-0 flex-1 overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0">
                  <tr>
                    <th className="w-10 px-2 py-2" />
                    <th className="px-2 py-2 text-left">Línea del Excel</th>
                    <th className="px-2 py-2 text-left">UM</th>
                    <th className="px-2 py-2 text-right">Ítems</th>
                    <th className="px-2 py-2 text-right">Cantidad sin desperdicio</th>
                    <th className="px-2 py-2 text-right">Valor aprobado</th>
                    <th className="w-28 px-2 py-2 text-right">%</th>
                    <th className="px-2 py-2 text-right">Suma</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((l) => {
                    const f = porClave.get(l.clave)
                    if (!f) return null
                    const pct = generalOk ? porcentajeDeFila(f, general ?? 0) : 0
                    return (
                      <tr key={l.clave} className={f.marcado ? "" : "text-muted-foreground"}>
                        <td className="px-2 py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={f.marcado}
                            onChange={(e) => cambiar(l.clave, { marcado: e.target.checked })}
                            aria-label={`Desperdicio para ${l.descripcion}`}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          {l.descripcion}
                          {l.lineasPendientes > 0 && (
                            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                              {l.lineasPendientes === l.lineas ? "esperando aprobación" : `${l.lineasPendientes} esperando aprobación`}
                            </span>
                          )}
                          {l.diceDesperdicio && (
                            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
                              dice &ldquo;desperdicio&rdquo;
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">{l.unidad ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right">{l.nItems}</td>
                        <td className="px-2 py-1.5 text-right">{numero(l.cantidadBase)}</td>
                        <td className="px-2 py-1.5 text-right">{l.valorBase > 0 ? pesos(l.valorBase) : "—"}</td>
                        <td className="px-2 py-1.5 text-right">
                          <Input
                            value={textos[l.clave] ?? (f.porcentaje == null ? "" : numero(f.porcentaje))}
                            placeholder={generalOk ? numero(general ?? 0) : ""}
                            disabled={!f.marcado}
                            onChange={(e) => {
                              const t = e.target.value
                              setTextos((x) => ({ ...x, [l.clave]: t }))
                              cambiar(l.clave, { porcentaje: t.trim() === "" ? null : leerNumero(t) })
                            }}
                            className="ml-auto h-7 w-20 text-right"
                            inputMode="decimal"
                            title="Vacío = el % general"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {pct > 0 && l.valorBase > 0 ? pesos((l.valorBase * pct) / 100) : pct > 0 ? `${numero(pct)} %` : "—"}
                        </td>
                      </tr>
                    )
                  })}
                  {visibles.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-2 py-6 text-center text-muted-foreground">
                        {datos.lineas.length === 0 ? "Esta versión no tiene líneas de insumo." : "Ninguna línea con esa búsqueda."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm">
              <div>
                <p>
                  Sobre lo ya aprobado, el desperdicio suma <span className="font-semibold">{pesos(impacto.aumento)}</span>.
                  {pendientes > 0 && ` ${pendientes} línea(s) esperando aprobación lo sumarán cuando se aprueben.`}
                </p>
                <p className="text-xs text-muted-foreground">Aproximado: el valor exacto lo calcula la base al guardar.</p>
                {filasInvalidas && <p className="text-destructive">Hay un % por línea que no es un número entre 0 y 100.</p>}
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
