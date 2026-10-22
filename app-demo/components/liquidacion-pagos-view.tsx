"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Calculator, CheckCheck, History, Loader2 } from "lucide-react"
import { HistorialDialog } from "@/components/historial-timeline"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PanelFiltros } from "@/components/panel-filtros"
import { PaginacionSimple } from "@/components/paginacion-simple"
import { SelectorNumeros } from "@/components/selector-numeros"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { AYUDA_DOBLE_CLIC } from "@/components/ventana-detalle"
import { LiquidarPagoDialogo } from "@/components/liquidar-pago-dialogo"
import {
  contextoLiquidacion,
  listarConsolidadosLiquidacion,
  listarPagosLiquidacion,
  liquidarVarios,
  type ResultadoLote,
} from "@/app/(app)/ayf/liquidacion/actions"
import { CLASE_ESTADO_PAGO, ETIQUETA_ESTADO_PAGO, fechasSemanaIso, formatoMoneda, semanaIso, semanasDelAnio, type Pago } from "@/lib/pagos"
import {
  datosLiquidacion,
  sugerirLiquidacion,
  totalesLiquidacion,
  type CatalogoLiquidacion,
  type ContextoPago,
  type SugerenciaLiquidacion,
  type TotalesLiquidacion,
} from "@/lib/liquidacion"
import type { FiltrosLiquidacion } from "@/lib/liquidacion-pantalla"

type Fila = {
  pago: Pago
  sugerencia: SugerenciaLiquidacion | null
  // Liquidado: lo guardado; por liquidar: lo sugerido.
  totales: TotalesLiquidacion | null
  revisar: number
}

export function LiquidacionPagosView({ puedeLiquidar }: { puedeLiquidar: boolean }) {
  const actual = semanaIso()
  const [estado, setEstado] = useState<"aprobado" | "liquidado">("aprobado")
  const [consolidados, setConsolidados] = useState<{ id: string; nombre: string }[]>([])
  const [consolidadoId, setConsolidadoId] = useState("todos")
  const [anios, setAnios] = useState<number[]>([actual.anio])
  const [semanas, setSemanas] = useState<number[]>([])
  const [tercero, setTercero] = useState("")

  const [pagos, setPagos] = useState<Pago[] | null>(null)
  const [contexto, setContexto] = useState<{ catalogo: CatalogoLiquidacion; contextos: Record<string, ContextoPago> } | null>(null)
  const [cargando, setCargando] = useState(false)
  const [pagina, setPagina] = useState(0)
  const [hayMas, setHayMas] = useState(false)
  const [ultimos, setUltimos] = useState<FiltrosLiquidacion>({ estado: "aprobado" })
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [abierto, setAbierto] = useState<Pago | null>(null)
  const [historialDe, setHistorialDe] = useState<Pago | null>(null)
  const [confirmarLote, setConfirmarLote] = useState(false)
  const [liquidandoLote, setLiquidandoLote] = useState(false)

  useEffect(() => {
    listarConsolidadosLiquidacion()
      .then((c: { id: string; nombre: string }[]) => setConsolidados(c))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los consolidados."))
  }, [])

  const opcionesAnios = useMemo(() => {
    const l: number[] = []
    for (let y = actual.anio; y >= Math.min(2026, actual.anio); y--) l.push(y)
    return l
  }, [actual.anio])
  const totalSemanas = anios.length === 1 ? semanasDelAnio(anios[0]) : 53
  const opcionesSemanas = useMemo(() => Array.from({ length: totalSemanas }, (_, i) => i + 1), [totalSemanas])

  function cargar(filtros: FiltrosLiquidacion = ultimos, pag = pagina) {
    setUltimos(filtros)
    setCargando(true)
    setError(null)
    listarPagosLiquidacion(filtros, pag)
      .then(async (r: { pagos: Pago[]; hayMas: boolean }) => {
        const ctx = r.pagos.length > 0 ? await contextoLiquidacion(r.pagos.map((p) => p.id)) : null
        setPagos(r.pagos)
        setContexto(ctx)
        setPagina(pag)
        setHayMas(r.hayMas)
        setSeleccion(new Set())
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar la liquidación."))
      .finally(() => setCargando(false))
  }

  function consultar(): boolean {
    setAviso(null)
    cargar(
      {
        estado,
        consolidadoId: consolidadoId === "todos" ? undefined : consolidadoId,
        anios: anios.length ? anios : undefined,
        semanas: semanas.length ? semanas : undefined,
        tercero: tercero.trim() || undefined,
      },
      0
    )
    return true
  }

  function limpiar() {
    setEstado("aprobado")
    setConsolidadoId("todos")
    setAnios([actual.anio])
    setSemanas([])
    setTercero("")
  }

  // Sugerencia de cada pago, calculada una vez por página (lineal).
  const filas: Fila[] = useMemo(() => {
    if (!pagos) return []
    return pagos.map((p) => {
      const ctx = contexto?.contextos[p.id]
      if (p.liquidacion) {
        const l = p.liquidacion
        return {
          pago: p,
          sugerencia: null,
          totales: { retefuente: l.retefuente, reteica: l.reteica, reteiva: l.reteiva, asumidas: l.asumidas, descuentos: l.descuentos, neto: l.neto },
          revisar: 0,
        }
      }
      if (!ctx || !contexto) return { pago: p, sugerencia: null, totales: null, revisar: 0 }
      const s = sugerirLiquidacion(ctx, contexto.catalogo)
      return {
        pago: p,
        sugerencia: s,
        totales: totalesLiquidacion(p.valor, s.lineas),
        revisar: s.avisos.filter((a) => a.nivel === "revisar").length,
      }
    })
  }, [pagos, contexto])
  const porId = useMemo(() => new Map(filas.map((f) => [f.pago.id, f])), [filas])

  const seleccionables = filas.filter((f) => f.sugerencia && f.pago.terceroId && f.totales && f.totales.neto > 0)
  const sinRevisar = seleccionables.filter((f) => f.revisar === 0)
  const elegidas = seleccionables.filter((f) => seleccion.has(f.pago.id))

  function alternar(id: string) {
    setSeleccion((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  async function liquidarSeleccion() {
    setLiquidandoLote(true)
    setError(null)
    try {
      const res: ResultadoLote[] = await liquidarVarios(
        elegidas.map((f) => ({ pagoId: f.pago.id, datos: datosLiquidacion(f.sugerencia!.lineas, f.sugerencia, "", "") }))
      )
      const malos = res.filter((r) => !r.ok)
      setAviso(
        `Se liquidaron ${res.length - malos.length} de ${res.length} pagos con la sugerencia.` +
          (malos.length ? ` No se pudieron: ${malos.map((m) => `ITEM ${porId.get(m.pagoId)?.pago.item ?? "?"} (${m.error})`).join("; ")}` : "")
      )
      setConfirmarLote(false)
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo liquidar.")
    } finally {
      setLiquidandoLote(false)
    }
  }

  const pesosOVacio = (n: number | undefined | null, sugerido: boolean) =>
    n == null ? (
      <span className="text-muted-foreground/60">—</span>
    ) : (
      <span className={`${n === 0 ? "text-muted-foreground" : ""} ${sugerido ? "italic" : ""}`}>{formatoMoneda(n)}</span>
    )
  const col = (clave: string, titulo: string, v: (f: Fila) => number | null | undefined): ColumnaExcel<Fila> => ({
    clave,
    titulo,
    ancho: 130,
    alinear: "right",
    texto: (f) => (v(f) == null ? "" : formatoMoneda(v(f)!)),
    valorOrden: (f) => v(f) ?? -1,
    celda: (f) => pesosOVacio(v(f), !f.pago.liquidacion),
    claseCelda: "tabular-nums",
  })

  const columnas: ColumnaExcel<Fila>[] = [
    ...(puedeLiquidar && ultimos.estado === "aprobado"
      ? [
          {
            clave: "sel",
            titulo: "",
            ancho: 44,
            ordenable: false,
            alinear: "center" as const,
            texto: () => "",
            celda: (f: Fila) =>
              f.sugerencia && f.pago.terceroId && f.totales && f.totales.neto > 0 ? (
                <Checkbox checked={seleccion.has(f.pago.id)} onCheckedChange={() => alternar(f.pago.id)} aria-label="Elegir" />
              ) : null,
          },
        ]
      : []),
    { clave: "item", titulo: "ITEM", ancho: 64, fija: true, alinear: "center", texto: (f) => (f.pago.item != null ? String(f.pago.item) : "") },
    { clave: "semana", titulo: "Semana", ancho: 90, alinear: "center", texto: (f) => (f.pago.semana != null ? `${f.pago.semana} · ${f.pago.anio}` : "") },
    { clave: "empresa", titulo: "Grupo empresarial", ancho: 200, texto: (f) => f.pago.empresaNombre ?? "" },
    {
      clave: "tercero",
      titulo: "Tercero",
      ancho: 250,
      flexible: true,
      texto: (f) => f.pago.terceroNombre ?? "",
      celda: (f) => (
        <div className="min-w-0">
          <div className="truncate">{f.pago.terceroNombre ?? <span className="text-amber-700">Sin tercero</span>}</div>
          {f.pago.terceroDocumento && <div className="truncate text-xs text-muted-foreground">{f.pago.terceroDocumento}</div>}
        </div>
      ),
    },
    { clave: "concepto", titulo: "Concepto", ancho: 260, texto: (f) => f.pago.concepto },
    { clave: "origen", titulo: "Origen", ancho: 150, texto: (f) => f.pago.origen },
    col("documento", "Valor documento", (f) => f.pago.valorDocumento),
    col("base", "Base", (f) => f.pago.baseGravable),
    col("iva", "IVA", (f) => f.pago.iva),
    col("retefuente", "Retefuente", (f) => f.totales?.retefuente),
    col("reteica", "ReteICA", (f) => f.totales?.reteica),
    col("reteiva", "ReteIVA", (f) => f.totales?.reteiva),
    {
      clave: "neto",
      titulo: ultimos.estado === "liquidado" ? "Neto a pagar" : "Neto sugerido",
      ancho: 150,
      alinear: "right",
      texto: (f) => (f.totales ? formatoMoneda(f.totales.neto) : ""),
      valorOrden: (f) => f.totales?.neto ?? -1,
      celda: (f) => (f.totales ? <span className="font-medium">{formatoMoneda(f.totales.neto)}</span> : null),
      claseCelda: "tabular-nums",
    },
    {
      clave: "revisar",
      titulo: "Revisar",
      ancho: 90,
      alinear: "center",
      texto: (f) => (f.revisar ? String(f.revisar) : ""),
      valorOrden: (f) => f.revisar,
      celda: (f) =>
        f.revisar > 0 ? (
          <span className="inline-flex items-center gap-1 text-amber-700" title={f.sugerencia?.avisos.filter((a) => a.nivel === "revisar").map((a) => a.texto).join("\n")}>
            <AlertTriangle className="h-4 w-4" /> {f.revisar}
          </span>
        ) : null,
    },
    {
      clave: "estado",
      titulo: "Estado",
      ancho: 120,
      texto: (f) => ETIQUETA_ESTADO_PAGO[f.pago.estado],
      celda: (f) => (
        <Badge variant="outline" className={`h-6 px-3 text-xs ${CLASE_ESTADO_PAGO[f.pago.estado]}`}>
          {ETIQUETA_ESTADO_PAGO[f.pago.estado]}
        </Badge>
      ),
    },
    {
      clave: "acciones",
      titulo: "Acciones",
      ancho: 150,
      ordenable: false,
      texto: () => "",
      celda: (f) => (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" className="h-8 w-8 shrink-0 p-0" title="Historial del pago" onClick={() => setHistorialDe(f.pago)}>
            <History className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" className="h-8" onClick={() => setAbierto(f.pago)}>
            <Calculator className="mr-1.5 h-4 w-4" />
            {f.pago.liquidacion ? "Ver" : "Liquidar"}
          </Button>
        </div>
      ),
    },
  ]

  const filaAbierta = abierto ? porId.get(abierto.id) : undefined

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex min-h-0 flex-1 gap-4">
        <PanelFiltros
          cargando={cargando}
          onConsultar={consultar}
          onLimpiar={limpiar}
          ayuda="La sugerencia sale de lo que Contabilidad le liquidó antes a cada tercero, del origen del pago y del RUT. Revisa siempre las que tengan el aviso."
        >
          <div className="space-y-1.5">
            <Label>Pagos</Label>
            <Select value={estado} onValueChange={(v) => setEstado((v ?? "aprobado") as "aprobado" | "liquidado")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="aprobado">Por liquidar</SelectItem>
                <SelectItem value="liquidado">Liquidados</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Consolidado</Label>
            <Select value={consolidadoId} onValueChange={(v) => setConsolidadoId(v ?? "todos")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {consolidados.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="anio-liq">Años</Label>
              <SelectorNumeros id="anio-liq" opciones={opcionesAnios} seleccion={anios} onChange={setAnios} textoTodas="Todos" plural="años" columnas={3} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="semana-liq">Semanas</Label>
              <SelectorNumeros
                id="semana-liq"
                opciones={opcionesSemanas}
                seleccion={semanas}
                onChange={setSemanas}
                textoTodas="Todas"
                plural="semanas"
                ayuda={anios.length === 1 ? (n) => fechasSemanaIso(anios[0], n) : undefined}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tercero-liq">Tercero</Label>
            <Input
              id="tercero-liq"
              placeholder="Nombre o razón social"
              value={tercero}
              onChange={(e) => setTercero(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && consultar()}
            />
          </div>
        </PanelFiltros>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>
          )}
          {aviso && <div className="rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-800">{aviso}</div>}

          {puedeLiquidar && ultimos.estado === "aprobado" && pagos && pagos.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setSeleccion(new Set(sinRevisar.map((f) => f.pago.id)))} disabled={sinRevisar.length === 0}>
                Elegir los que no tienen nada por revisar ({sinRevisar.length})
              </Button>
              {seleccion.size > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setSeleccion(new Set())}>
                  Quitar selección
                </Button>
              )}
              <Button size="sm" disabled={elegidas.length === 0} onClick={() => setConfirmarLote(true)}>
                <CheckCheck className="mr-1.5 h-4 w-4" />
                Liquidar con la sugerencia ({elegidas.length})
              </Button>
            </div>
          )}

          {pagos === null && !cargando ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Elige los filtros y presiona Consultar para ver los pagos por liquidar.
            </div>
          ) : pagos === null ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando...
            </div>
          ) : pagos.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Ningún pago coincide con los filtros.
            </div>
          ) : (
            <>
              <TablaExcel
                filas={filas}
                columnas={columnas}
                claveFila={(f) => f.pago.id}
                onDobleClickFila={(f) => setAbierto(f.pago)}
                tituloFila={AYUDA_DOBLE_CLIC}
                fondoFila={(f) => (f.revisar > 0 ? "bg-amber-50/60" : undefined)}
                tarjeta={{
                  titulo: (f) => f.pago.terceroNombre ?? "Sin tercero",
                  subtitulo: (f) => `ITEM ${f.pago.item ?? "—"} · ${f.pago.empresaNombre ?? ""}`,
                  esquina: (f) => (
                    <Badge variant="outline" className={`h-6 px-3 text-xs ${CLASE_ESTADO_PAGO[f.pago.estado]}`}>
                      {ETIQUETA_ESTADO_PAGO[f.pago.estado]}
                    </Badge>
                  ),
                  campos: ["concepto", "documento", "retefuente", "reteica", "reteiva", "neto", "revisar", "acciones"],
                }}
              />
              <div className="text-right text-sm text-muted-foreground">
                {pagos.length} {pagos.length === 1 ? "pago" : "pagos"} en esta página · Neto{" "}
                {ultimos.estado === "liquidado" ? "liquidado" : "sugerido"}{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {formatoMoneda(filas.reduce((a, f) => a + (f.totales?.neto ?? f.pago.valor), 0))}
                </span>
                {ultimos.estado === "aprobado" && " (los valores en cursiva son sugeridos)"}
              </div>
            </>
          )}
          {pagos !== null && pagos.length > 0 && (
            <PaginacionSimple pagina={pagina} hayMas={hayMas} cargando={cargando} onCambiar={(n) => cargar(ultimos, n)} />
          )}
        </div>
      </div>

      <LiquidarPagoDialogo
        pago={abierto}
        contexto={abierto ? (contexto?.contextos[abierto.id] ?? null) : null}
        catalogo={contexto?.catalogo ?? null}
        sugerencia={filaAbierta?.sugerencia ?? null}
        puedeLiquidar={puedeLiquidar}
        onCerrar={() => setAbierto(null)}
        onGuardado={(p) => {
          setAbierto(null)
          // Sale de la lista en la que estaba (por liquidar / liquidados).
          setPagos((ps) => (ps ? ps.filter((x) => x.id !== p.id || x.estado === p.estado) : ps))
          setAviso(
            p.estado === "liquidado"
              ? `Pago liquidado: neto a pagar ${formatoMoneda(p.liquidacion?.neto ?? p.valor)}.`
              : "Liquidación deshecha: el pago volvió a Por liquidar."
          )
        }}
      />

      <Dialog open={confirmarLote} onOpenChange={(a) => !a && !liquidandoLote && setConfirmarLote(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Liquidar {elegidas.length} pagos con la sugerencia</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Se guardan tal como se sugirieron. Neto total:{" "}
            <span className="font-medium text-foreground">{formatoMoneda(elegidas.reduce((a, f) => a + (f.totales?.neto ?? 0), 0))}</span>.
            {elegidas.some((f) => f.revisar > 0) && " Algunos tienen avisos por revisar."}
          </p>
          <DialogFooter>
            <Button variant="outline" disabled={liquidandoLote} onClick={() => setConfirmarLote(false)}>
              Cancelar
            </Button>
            <Button disabled={liquidandoLote} onClick={liquidarSeleccion}>
              {liquidandoLote ? "Liquidando..." : "Liquidar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <HistorialDialog
        abierto={historialDe !== null}
        tipo="pago"
        id={historialDe?.id ?? null}
        titulo={`Historial del pago${historialDe?.item != null ? ` · ITEM ${historialDe.item}` : ""}`}
        onCerrar={() => setHistorialDe(null)}
      />
    </div>
  )
}
