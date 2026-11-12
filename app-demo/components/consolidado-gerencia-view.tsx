"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Paperclip } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PanelFiltros } from "@/components/panel-filtros"
import { PaginacionSimple } from "@/components/paginacion-simple"
import { FiltroSemanas } from "@/components/filtro-semanas"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { AYUDA_DOBLE_CLIC, VentanaDetalle, camposDesdeColumnas } from "@/components/ventana-detalle"
import { EtiquetaTipoMovimiento } from "@/components/balances-view"
import { enlaceSoporteMovimiento } from "@/app/(app)/ayf/balances/actions"
import { formatearFechaSinHora } from "@/lib/fechas"
import type { MovimientoGerencia } from "@/lib/balances"
import { DetalleOrigenPago } from "@/components/detalle-origen-pago"
import {
  listarConsolidadoGerencia,
  movimientosConsolidadoGerencia,
  opcionesConsolidadoGerencia,
  soportesDePagos,
} from "@/app/(app)/ayf/consolidado-gerencia/actions"
import {
  formatoMoneda,
  rutaSoportePago,
  semanaIso,
  type FiltrosConsolidadoGerencia,
  type OpcionesConsolidadoGerencia,
  type Pago,
  type SoportePago,
} from "@/lib/pagos"

const TODOS = "todos"

// Una fila: un pago, o un ingreso / egreso externo de Balances (20270101001200).
type Fila = { clase: "pago"; id: string; pago: Pago } | { clase: "mov"; id: string; mov: MovimientoGerencia }

// Consolidado Gerencia: los pagos de los tres consolidados, para control. Solo
// consulta; doble clic abre el documento de donde sale el pago.
export function ConsolidadoGerenciaView() {
  const [pagos, setPagos] = useState<Pago[] | null>(null)
  const [soportes, setSoportes] = useState<Record<string, SoportePago>>({})
  const [cargando, setCargando] = useState(false)
  const [pagina, setPagina] = useState(0)
  const [hayMas, setHayMas] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ultimos, setUltimos] = useState<FiltrosConsolidadoGerencia>({})
  const [opciones, setOpciones] = useState<OpcionesConsolidadoGerencia | null>(null)
  const [viendo, setViendo] = useState<Pago | null>(null)
  // Movimientos de Balances (solo en la primera página, arriba de los pagos).
  const [movimientos, setMovimientos] = useState<MovimientoGerencia[]>([])
  const [viendoMov, setViendoMov] = useState<MovimientoGerencia | null>(null)
  const [incluirIngresos, setIncluirIngresos] = useState(false)
  const [incluirEgresos, setIncluirEgresos] = useState(false)

  const actual = semanaIso()
  const [anios, setAnios] = useState<number[]>([actual.anio])
  const [semanas, setSemanas] = useState<number[]>([actual.semana])
  // Semana de creación del pago: vacía = todas (la de pago es la que se da al aprobar).
  const [aniosCreacion, setAniosCreacion] = useState<number[]>([])
  const [semanasCreacion, setSemanasCreacion] = useState<number[]>([])
  const [empresaId, setEmpresaId] = useState(TODOS)
  const [proyectoId, setProyectoId] = useState(TODOS)
  const [solicitanteId, setSolicitanteId] = useState(TODOS)
  const [tercero, setTercero] = useState("")

  useEffect(() => {
    opcionesConsolidadoGerencia()
      .then((o: OpcionesConsolidadoGerencia) => setOpciones(o))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los filtros."))
  }, [])

  const opcionesAnios = useMemo(() => {
    const lista: number[] = []
    for (let y = actual.anio; y >= Math.min(2026, actual.anio); y--) lista.push(y)
    return lista
  }, [actual.anio])

  function cargar(filtros: FiltrosConsolidadoGerencia = ultimos, pag: number = pagina) {
    setUltimos(filtros)
    setCargando(true)
    setError(null)
    Promise.all([
      listarConsolidadoGerencia(filtros, pag),
      pag === 0 && (filtros.incluirIngresos || filtros.incluirEgresos) ? movimientosConsolidadoGerencia(filtros) : Promise.resolve([]),
    ])
      .then(async ([r, movs]: [{ pagos: Pago[]; hayMas: boolean }, MovimientoGerencia[]]) => {
        setMovimientos(movs)
        setPagos(r.pagos)
        setPagina(pag)
        setHayMas(r.hayMas)
        setSoportes({})
        if (r.pagos.length > 0) {
          const s = await soportesDePagos(
            r.pagos.map((p) => ({
              id: p.id,
              ordenCompraId: p.ordenCompraId,
              actaId: p.actaId,
              requisicionAdminItemId: p.requisicionAdminItemId,
            }))
          )
          setSoportes(s)
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar el consolidado."))
      .finally(() => setCargando(false))
  }

  function handleConsultar(): boolean {
    cargar(
      {
        anios: anios.length === 0 ? undefined : anios,
        semanas: semanas.length === 0 ? undefined : semanas,
        aniosCreacion: aniosCreacion.length === 0 ? undefined : aniosCreacion,
        semanasCreacion: semanasCreacion.length === 0 ? undefined : semanasCreacion,
        empresaId: empresaId === TODOS ? undefined : empresaId,
        proyectoId: proyectoId === TODOS ? undefined : proyectoId,
        solicitanteId: solicitanteId === TODOS ? undefined : solicitanteId,
        tercero: tercero.trim() || undefined,
        incluirIngresos,
        incluirEgresos,
      },
      0
    )
    return true
  }

  function limpiar() {
    setAnios([actual.anio])
    setSemanas([actual.semana])
    setAniosCreacion([])
    setSemanasCreacion([])
    setEmpresaId(TODOS)
    setProyectoId(TODOS)
    setSolicitanteId(TODOS)
    setTercero("")
    setIncluirIngresos(false)
    setIncluirEgresos(false)
  }

  const pagosQueSuman = pagos ? pagos.filter((p) => p.estado !== "anulado" && p.estado !== "rechazado") : []
  const totalPagina = pagosQueSuman.reduce((acc, p) => acc + p.valor, 0)
  const incluirIngresosUltimos = Boolean(ultimos.incluirIngresos)
  const incluirEgresosUltimos = Boolean(ultimos.incluirEgresos)
  const totalIngresos = movimientos.filter((m) => m.tipo === "ingreso").reduce((a, m) => a + m.valor, 0)
  const totalEgresos = movimientos.filter((m) => m.tipo === "egreso").reduce((a, m) => a + m.valor, 0)
  const filas: Fila[] = [
    ...movimientos.map((m) => ({ clase: "mov" as const, id: `mov-${m.id}`, mov: m })),
    ...(pagos ?? []).map((p) => ({ clase: "pago" as const, id: p.id, pago: p })),
  ]

  async function verSoporteMov(m: MovimientoGerencia) {
    try {
      window.open(await enlaceSoporteMovimiento(m.id), "_blank", "noopener")
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abrir el soporte.")
    }
  }

  // Columnas de los pagos (las de siempre).
  const columnasPago: ColumnaExcel<Pago>[] = [
    { clave: "item", titulo: "REF", ancho: 100, fija: true, alinear: "center", texto: (p) => p.referencia ?? "" },
    {
      clave: "semana",
      titulo: "Semana / año",
      ancho: 110,
      alinear: "center",
      texto: (p) => (p.semana != null ? `${p.semana} · ${p.anio}` : ""),
      valorOrden: (p) => (p.anio ?? 0) * 100 + (p.semana ?? 0),
      claseCelda: "tabular-nums",
    },
    { clave: "empresa", titulo: "Grupo empresarial", ancho: 220, texto: (p) => p.empresaNombre ?? "" },
    {
      clave: "tercero",
      titulo: "Tercero",
      ancho: 280,
      flexible: true,
      texto: (p) => p.terceroNombre ?? "",
      celda: (p) => (
        <div className="min-w-0">
          <div className="truncate" title={p.terceroNombre ?? undefined}>
            {p.terceroNombre ?? <span className="text-muted-foreground/60">Sin tercero</span>}
          </div>
          {p.terceroDocumento && <div className="truncate text-xs text-muted-foreground">{p.terceroDocumento}</div>}
        </div>
      ),
    },
    { clave: "proyecto", titulo: "Proyecto", ancho: 160, texto: (p) => p.proyectoCodigo ?? p.proyectoNombre ?? "" },
    { clave: "solicita", titulo: "Solicitante", ancho: 180, texto: (p) => p.solicitadoPorNombre ?? "" },
    {
      clave: "valor",
      titulo: "Valor a pagar",
      ancho: 150,
      alinear: "right",
      texto: (p) => formatoMoneda(p.valor),
      valorOrden: (p) => p.valor,
      celda: (p) => <span className="font-medium">{formatoMoneda(p.valor)}</span>,
      claseCelda: "tabular-nums",
    },
    {
      clave: "soporte",
      titulo: "Soporte",
      ancho: 120,
      ordenable: false,
      texto: (p) => soportes[p.id]?.nombre ?? "",
      celda: (p) => {
        const s = soportes[p.id]
        if (!s) return <span className="text-muted-foreground/60">—</span>
        return (
          <a
            href={rutaSoportePago(p.id)}
            target="_blank"
            rel="noreferrer"
            title={s.nombre}
            className={buttonVariants({ size: "sm", variant: "ghost", className: "h-8 gap-1 px-2" })}
          >
            <Paperclip className="h-4 w-4" /> Ver
          </a>
        )
      },
    },
  ]

  // La misma tabla para pagos y movimientos: cada columna de pago y, para los
  // movimientos, su equivalente (REF = código con la etiqueta INGRESO / EGRESO
  // EXTERNO, tercero = titular, solicitante = quien lo registró).
  const textoMov: Record<string, (m: MovimientoGerencia) => string> = {
    item: (m) => m.codigo,
    semana: (m) => `${m.semana} · ${m.anio}`,
    empresa: (m) => m.empresa ?? "",
    tercero: (m) => m.titular,
    proyecto: () => "",
    solicita: (m) => m.creadoPor ?? "",
    valor: (m) => formatoMoneda(m.valor),
    soporte: (m) => m.soporteNombre ?? "",
  }
  const celdaMov: Record<string, (m: MovimientoGerencia) => React.ReactNode> = {
    item: (m) => (
      <div className="flex flex-col items-center gap-0.5 leading-tight">
        <span className="font-medium">{m.codigo}</span>
        <EtiquetaTipoMovimiento tipo={m.tipo} />
      </div>
    ),
    tercero: (m) => (
      <div className="min-w-0">
        <div className="truncate" title={m.titular}>
          {m.titular}
        </div>
        <div className="truncate text-xs text-muted-foreground" title={m.concepto}>
          {m.concepto}
        </div>
      </div>
    ),
    proyecto: () => <span className="text-muted-foreground/60">—</span>,
    valor: (m) => <span className={`font-medium ${m.tipo === "ingreso" ? "text-green-800" : ""}`}>{formatoMoneda(m.valor)}</span>,
    soporte: (m) =>
      m.soporteNombre ? (
        <Button size="sm" variant="ghost" className="h-8 gap-1 px-2" title={m.soporteNombre} onClick={() => verSoporteMov(m)}>
          <Paperclip className="h-4 w-4" /> Ver
        </Button>
      ) : (
        <span className="text-muted-foreground/60">—</span>
      ),
  }
  const columnas: ColumnaExcel<Fila>[] = columnasPago.map((c) => ({
    ...c,
    texto: (f: Fila) => (f.clase === "pago" ? c.texto(f.pago) : (textoMov[c.clave]?.(f.mov) ?? "")),
    valorOrden: (f: Fila) =>
      f.clase === "pago"
        ? (c.valorOrden ? c.valorOrden(f.pago) : c.texto(f.pago))
        : c.clave === "valor"
          ? f.mov.valor
          : c.clave === "semana"
            ? f.mov.anio * 100 + f.mov.semana
            : (textoMov[c.clave]?.(f.mov) ?? ""),
    celda: (f: Fila) =>
      f.clase === "pago" ? (c.celda ? c.celda(f.pago) : c.texto(f.pago)) : celdaMov[c.clave] ? celdaMov[c.clave](f.mov) : textoMov[c.clave]?.(f.mov),
  }))

  const selector = (
    etiqueta: string,
    valor: string,
    onCambiar: (v: string) => void,
    lista: { id: string; texto: string }[]
  ) => (
    <div className="space-y-1.5">
      <Label>{etiqueta}</Label>
      <Select value={valor} onValueChange={(v) => onCambiar(v ?? TODOS)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>Todos</SelectItem>
          {lista.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.texto}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex min-h-0 flex-1 gap-4">
        <PanelFiltros
          cargando={cargando}
          onConsultar={handleConsultar}
          onLimpiar={limpiar}
          ayuda="Los pagos aprobados de todos los consolidados. Semana de pago: la que el pago recibe al aprobarlo (por omisión, la actual). Semana de creación: cuando se creó el pago (por omisión, todas). La REF se da al enviar a liquidar."
        >
          <FiltroSemanas
            id="aprobacion-gerencia"
            titulo="Semana de pago"
            opcionesAnios={opcionesAnios}
            anios={anios}
            semanas={semanas}
            onAnios={setAnios}
            onSemanas={setSemanas}
          />
          <FiltroSemanas
            id="creacion-gerencia"
            titulo="Semana de creación"
            opcionesAnios={opcionesAnios}
            anios={aniosCreacion}
            semanas={semanasCreacion}
            onAnios={setAniosCreacion}
            onSemanas={setSemanasCreacion}
          />
          {selector("Grupo empresarial", empresaId, setEmpresaId, (opciones?.empresas ?? []).map((e) => ({ id: e.id, texto: e.nombre })))}
          <div className="space-y-1.5">
            <Label htmlFor="tercero-gerencia">Tercero</Label>
            <Input
              id="tercero-gerencia"
              placeholder="Nombre o razón social"
              value={tercero}
              onChange={(e) => setTercero(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConsultar()}
            />
          </div>
          {selector(
            "Proyecto",
            proyectoId,
            setProyectoId,
            (opciones?.proyectos ?? []).map((p) => ({ id: p.id, texto: [p.codigo, p.nombre].filter(Boolean).join(" · ") }))
          )}
          {selector("Solicitante", solicitanteId, setSolicitanteId, (opciones?.solicitantes ?? []).map((s) => ({ id: s.id, texto: s.nombre })))}
          <div className="space-y-2 rounded-md border p-2">
            <p className="text-xs text-muted-foreground">Movimientos de Balances (por la fecha del movimiento)</p>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={incluirIngresos} onCheckedChange={(v) => setIncluirIngresos(v === true)} />
              Incluir ingresos
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={incluirEgresos} onCheckedChange={(v) => setIncluirEgresos(v === true)} />
              Incluir egresos externos
            </label>
          </div>
        </PanelFiltros>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>
          )}

          {pagos === null && !cargando ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Elige los filtros que quieras y presiona Consultar.
            </div>
          ) : pagos === null ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando consolidado...
            </div>
          ) : filas.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Ningún pago coincide con los filtros.
            </div>
          ) : (
            <>
              <TablaExcel
                filas={filas}
                columnas={columnas}
                claveFila={(f) => f.id}
                onDobleClickFila={(f) => (f.clase === "pago" ? setViendo(f.pago) : setViendoMov(f.mov))}
                tituloFila={AYUDA_DOBLE_CLIC}
                fondoFila={(f) =>
                  f.clase === "mov"
                    ? f.mov.tipo === "ingreso"
                      ? "bg-green-50/70"
                      : "bg-amber-50/60"
                    : f.pago.estado === "anulado" || f.pago.estado === "rechazado"
                      ? "bg-muted/60 text-muted-foreground"
                      : undefined
                }
                tarjeta={{
                  titulo: (f) => (f.clase === "pago" ? (f.pago.terceroNombre ?? "Sin tercero") : f.mov.titular),
                  subtitulo: (f) =>
                    f.clase === "pago"
                      ? `REF ${f.pago.referencia ?? "—"}${f.pago.semana != null ? ` · semana ${f.pago.semana} de ${f.pago.anio}` : ""} · ${f.pago.empresaNombre ?? ""}`
                      : `${f.mov.codigo} · ${f.mov.tipo === "ingreso" ? "INGRESO" : "EGRESO EXTERNO"} · ${formatearFechaSinHora(f.mov.fecha)}`,
                  campos: ["proyecto", "solicita", "valor", "soporte"],
                }}
              />
              <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-right text-sm text-muted-foreground">
                {movimientos.length > 0 && (
                  <>
                    {incluirIngresosUltimos && (
                      <span>
                        Ingresos <span className="font-medium text-green-800 tabular-nums">{formatoMoneda(totalIngresos)}</span>
                      </span>
                    )}
                    {incluirEgresosUltimos && (
                      <span>
                        Egresos externos <span className="font-medium text-foreground tabular-nums">{formatoMoneda(totalEgresos)}</span>
                      </span>
                    )}
                  </>
                )}
                <span>
                  {pagos.length} {pagos.length === 1 ? "pago" : "pagos"} en esta página · Total de la página{" "}
                  <span className="font-medium text-foreground tabular-nums">{formatoMoneda(totalPagina)}</span>
                </span>
              </div>
            </>
          )}

          {pagos !== null && filas.length > 0 && (
            <PaginacionSimple pagina={pagina} hayMas={hayMas} cargando={cargando} onCambiar={(n) => cargar(ultimos, n)} />
          )}
        </div>
      </div>

      <DetalleOrigenPago
        pago={viendo}
        acciones={null}
        camposPago={viendo ? camposDesdeColumnas(columnasPago, viendo, ["soporte"]) : []}
        onCerrar={() => setViendo(null)}
      />

      <VentanaDetalle
        abierta={viendoMov !== null}
        onCerrar={() => setViendoMov(null)}
        titulo={viendoMov ? `${viendoMov.codigo} · ${viendoMov.tipo === "ingreso" ? "Ingreso" : "Egreso externo"}` : ""}
        subtitulo={viendoMov ? `Balances · ${formatearFechaSinHora(viendoMov.fecha)}` : undefined}
        campos={
          viendoMov
            ? [
                { etiqueta: "Titular", valor: viendoMov.titular },
                { etiqueta: "Valor", valor: formatoMoneda(viendoMov.valor) },
                { etiqueta: "Cuenta", valor: [viendoMov.cuenta, viendoMov.banco].filter(Boolean).join(" · ") },
                { etiqueta: "Grupo empresarial", valor: viendoMov.empresa ?? "" },
                { etiqueta: "Semana", valor: `${viendoMov.semana} · ${viendoMov.anio}` },
                { etiqueta: "Registrado por", valor: viendoMov.creadoPor ?? "" },
                { etiqueta: "Concepto", valor: viendoMov.concepto, ancho: "completo" },
              ]
            : []
        }
        acciones={
          viendoMov?.soporteNombre ? (
            <Button size="sm" variant="outline" onClick={() => viendoMov && verSoporteMov(viendoMov)}>
              <Paperclip className="mr-1.5 h-4 w-4" /> Ver soporte
            </Button>
          ) : null
        }
      />
    </div>
  )
}
