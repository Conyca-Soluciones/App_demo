"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, Loader2, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useProyectoActual } from "@/components/proyecto-provider"
import { seleccionarProyecto } from "@/app/(app)/inicio/actions"
import { obtenerMisPendientes } from "@/app/(app)/pendientes/actions"
import { formatearFechaSinHora } from "@/lib/fechas"
import { formatoMoneda } from "@/lib/pagos"
import { defGrupo, diasDesde, textoEspera, type GrupoPendientes, type PendienteItem } from "@/lib/pendientes"

// ---------------------------------------------------------------------------
// Mis pendientes (T1): lo que le toca a ESTA persona, calculado en la base en
// el momento (mis_pendientes). Agrupado por tipo; en cada grupo, los vencidos
// y los más viejos primero (como mucho 20; el resto se ve en su pantalla).
// Abrir un pendiente de otro proyecto cambia primero el proyecto actual,
// porque varias pantallas trabajan sobre él.
// ---------------------------------------------------------------------------

export function MisPendientesView() {
  const router = useRouter()
  const { proyecto, proyectos } = useProyectoActual()
  const [grupos, setGrupos] = useState<GrupoPendientes[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [abriendo, setAbriendo] = useState<string | null>(null)
  const [cerrados, setCerrados] = useState<Set<string>>(new Set())
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let activo = true
    obtenerMisPendientes()
      .then((g: GrupoPendientes[]) => {
        if (!activo) return
        setGrupos(g)
        setError(null)
      })
      .catch((e) => activo && setError(e instanceof Error ? e.message : "No se pudieron cargar tus pendientes."))
      .finally(() => activo && setCargando(false))
    return () => {
      activo = false
    }
  }, [version])

  function cargar() {
    setCargando(true)
    setVersion((v) => v + 1)
  }

  async function abrir(item: PendienteItem) {
    setAbriendo(item.id)
    setError(null)
    try {
      const otro = item.proyectoId && item.proyectoId !== proyecto?.id && proyectos.some((p) => p.id === item.proyectoId)
      if (otro) await seleccionarProyecto(item.proyectoId!)
      router.push(item.url)
      if (otro) router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abrir el pendiente.")
      setAbriendo(null)
    }
  }

  function alternar(tipo: string) {
    setCerrados((c) => {
      const n = new Set(c)
      if (n.has(tipo)) n.delete(tipo)
      else n.add(tipo)
      return n
    })
  }

  const hacer = (grupos ?? []).filter((g) => g.categoria === "hacer")
  const seguimiento = (grupos ?? []).filter((g) => g.categoria === "seguimiento")
  const totalHacer = hacer.reduce((a, g) => a + g.total, 0)
  const vencidos = hacer.reduce((a, g) => a + g.vencidos, 0)
  const masViejo = hacer.reduce<string | null>((a, g) => (g.masAntiguo && (!a || g.masAntiguo < a) ? g.masAntiguo : a), null)

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Resumen etiqueta="Por hacer" valor={grupos ? String(totalHacer) : "…"} />
        <Resumen etiqueta="Vencidos" valor={grupos ? String(vencidos) : "…"} alerta={vencidos > 0} />
        <Resumen etiqueta="Lo más viejo" valor={grupos ? textoEspera(diasDesde(masViejo)) || "—" : "…"} />
        <Button variant="outline" size="sm" className="ml-auto" onClick={cargar} disabled={cargando}>
          {cargando ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <RefreshCw className="mr-1.5 size-4" />}
          Actualizar
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>
      )}

      {grupos === null && !error ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" /> Buscando tus pendientes...
        </div>
      ) : grupos && hacer.length === 0 && seguimiento.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center text-muted-foreground">
          <CheckCircle2 className="size-8 text-emerald-600" />
          <p className="font-medium text-foreground">Estás al día</p>
          <p className="text-sm">No tienes nada pendiente en tus proyectos.</p>
        </div>
      ) : (
        <>
          {hacer.map((g) => (
            <Grupo key={g.tipo} grupo={g} cerrado={cerrados.has(g.tipo)} onAlternar={() => alternar(g.tipo)} onAbrir={abrir} abriendo={abriendo} />
          ))}
          {seguimiento.length > 0 && (
            <div className="space-y-3 pt-2">
              <h2 className="text-sm font-medium text-muted-foreground">Para seguimiento (lo tuyo que está en manos de otros)</h2>
              {seguimiento.map((g) => (
                <Grupo key={g.tipo} grupo={g} cerrado={cerrados.has(g.tipo)} onAlternar={() => alternar(g.tipo)} onAbrir={abrir} abriendo={abriendo} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Resumen({ etiqueta, valor, alerta }: { etiqueta: string; valor: string; alerta?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${alerta ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40" : "bg-card"}`}>
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      <p className={`text-lg font-semibold tabular-nums ${alerta ? "text-red-700 dark:text-red-400" : ""}`}>{valor}</p>
    </div>
  )
}

function Grupo({
  grupo,
  cerrado,
  onAlternar,
  onAbrir,
  abriendo,
}: {
  grupo: GrupoPendientes
  cerrado: boolean
  onAlternar: () => void
  onAbrir: (i: PendienteItem) => void
  abriendo: string | null
}) {
  const def = defGrupo(grupo.tipo)
  const faltan = grupo.total - grupo.items.length
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={!cerrado}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-muted/40"
      >
        <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${cerrado ? "-rotate-90" : ""}`} />
        <span className="font-medium">{def.titulo}</span>
        <Badge variant="secondary" className="tabular-nums">
          {grupo.total}
        </Badge>
        {grupo.vencidos > 0 && (
          <Badge variant="destructive" className="tabular-nums">
            {grupo.vencidos} {grupo.vencidos === 1 ? "vencido" : "vencidos"}
          </Badge>
        )}
        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {grupo.montoTotal != null && grupo.montoTotal > 0 && <span className="tabular-nums">{formatoMoneda(grupo.montoTotal)}</span>}
          {grupo.masAntiguo && (
            <span className="flex items-center gap-1">
              <Clock className="size-3.5" /> el más viejo {textoEspera(diasDesde(grupo.masAntiguo))}
            </span>
          )}
        </span>
      </button>
      {!cerrado && (
        <ul className="divide-y border-t">
          {grupo.items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-medium">{i.titulo}</span>
                  {i.proyecto && <span className="text-xs text-muted-foreground">{i.proyecto}</span>}
                </div>
                {i.detalle && <p className="truncate text-xs text-muted-foreground">{i.detalle}</p>}
                <p className="text-xs text-muted-foreground">
                  {[
                    textoEspera(diasDesde(i.desde)) && `Espera ${textoEspera(diasDesde(i.desde))}`,
                    i.deQuien && `de ${i.deQuien}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  {i.vence && (
                    <span className={i.vencido ? "font-medium text-destructive" : ""}>
                      {" · "}
                      {i.vencido && <AlertTriangle className="mr-0.5 inline size-3 align-[-1px]" />}
                      {i.vencido ? "venció el " : "para el "}
                      {formatearFechaSinHora(i.vence)}
                    </span>
                  )}
                </p>
              </div>
              {i.monto != null && i.monto > 0 && <span className="shrink-0 tabular-nums">{formatoMoneda(i.monto)}</span>}
              <Button size="sm" variant="outline" className="shrink-0" disabled={abriendo !== null} onClick={() => onAbrir(i)}>
                {abriendo === i.id && <Loader2 className="mr-1.5 size-4 animate-spin" />}
                {def.accion}
              </Button>
            </li>
          ))}
          {faltan > 0 && (
            <li className="px-4 py-2 text-xs text-muted-foreground">
              Y {faltan} más. Aquí salen los {grupo.items.length} más viejos; el resto, en su pantalla.
            </li>
          )}
        </ul>
      )}
    </section>
  )
}
