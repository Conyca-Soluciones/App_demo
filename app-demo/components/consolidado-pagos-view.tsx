"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Loader2, Wrench } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { BuscadorAsync, type OpcionBuscador } from "@/components/buscador-async"
import { PanelFiltros } from "@/components/panel-filtros"
import { PaginacionSimple } from "@/components/paginacion-simple"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import {
  asignarTerceroPago,
  buscarTercerosParaPago,
  cuentasDeTercero,
  listarConsolidado,
  listarConsolidadosPago,
  obtenerAlertasConsolidado,
  reintentarPagos,
  type AlertasConsolidado,
  type ConsolidadoOpcion,
  type CuentaOpcion,
} from "@/app/(app)/ayf/consolidado/actions"
import {
  CLASE_ESTADO_PAGO,
  ETIQUETA_ESTADO_PAGO,
  ETIQUETA_TIPO_PAGO,
  formatoMoneda,
  semanaIso,
  type EstadoPago,
  type FiltrosConsolidado,
  type Pago,
} from "@/lib/pagos"

const ESTADOS_FILTRO: EstadoPago[] = ["aprobado", "liquidado", "en_dispersion", "dispersado", "anulado"]

async function buscarTercerosAdaptado(termino: string): Promise<OpcionBuscador[]> {
  const r = await buscarTercerosParaPago(termino)
  return r.map((t) => ({ id: t.id, etiqueta: t.nombre, subetiqueta: t.documento }))
}

// Un pago ya en dispersión, pagado o anulado no se puede cambiar.
const puedeResolver = (p: Pago) => !["en_dispersion", "dispersado", "rechazado", "anulado"].includes(p.estado)

export function ConsolidadoPagosView({ puedeGestionar }: { puedeGestionar: boolean }) {
  // null = todavía no se consultó: no se muestra nada hasta presionar Consultar.
  const [pagos, setPagos] = useState<Pago[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [pagina, setPagina] = useState(0)
  const [hayMas, setHayMas] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ultimosFiltros, setUltimosFiltros] = useState<FiltrosConsolidado>({})

  const [consolidados, setConsolidados] = useState<ConsolidadoOpcion[]>([])
  const actual = semanaIso()
  const [consolidadoId, setConsolidadoId] = useState("todos")
  const [anio, setAnio] = useState(String(actual.anio))
  const [semana, setSemana] = useState(String(actual.semana))
  const [estado, setEstado] = useState<EstadoPago | "todos">("todos")
  const [tercero, setTercero] = useState("")
  const [soloConNovedad, setSoloConNovedad] = useState(false)
  const [sinItem, setSinItem] = useState(false)

  const [resolviendo, setResolviendo] = useState<Pago | null>(null)
  const [alertas, setAlertas] = useState<AlertasConsolidado | null>(null)
  const [reintentando, setReintentando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  function cargarAlertas() {
    obtenerAlertasConsolidado()
      .then((a: AlertasConsolidado) => setAlertas(a))
      .catch(() => setAlertas(null))
  }

  useEffect(() => {
    cargarAlertas()
    listarConsolidadosPago()
      .then((c: ConsolidadoOpcion[]) => setConsolidados(c))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los consolidados."))
  }, [])

  // Nombre del consolidado de cada pago, indexado una vez (sin buscar en la
  // lista por cada fila).
  const nombreConsolidado = useMemo(() => new Map(consolidados.map((c) => [c.id, c.nombre])), [consolidados])

  function cargar(filtros: FiltrosConsolidado = ultimosFiltros, pag: number = pagina) {
    setUltimosFiltros(filtros)
    setCargando(true)
    setError(null)
    listarConsolidado(filtros, pag)
      .then((r: { pagos: Pago[]; hayMas: boolean }) => {
        setPagos(r.pagos)
        setPagina(pag)
        setHayMas(r.hayMas)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar el consolidado."))
      .finally(() => setCargando(false))
  }

  function handleConsultar(): boolean {
    const a = anio.trim() === "" ? undefined : Number(anio)
    const s = semana.trim() === "" ? undefined : Number(semana)
    if (!sinItem) {
      if (a !== undefined && (!Number.isInteger(a) || a < 2020 || a > 2100)) {
        setError("El año no es válido.")
        return false
      }
      if (s !== undefined && (!Number.isInteger(s) || s < 1 || s > 53)) {
        setError("La semana debe estar entre 1 y 53.")
        return false
      }
    }
    cargar(
      {
        consolidadoId: consolidadoId === "todos" ? undefined : consolidadoId,
        anio: sinItem ? undefined : a,
        semana: sinItem ? undefined : s,
        estado: estado === "todos" ? undefined : estado,
        tercero: tercero.trim() || undefined,
        soloConNovedad: soloConNovedad || undefined,
        sinItem: sinItem || undefined,
      },
      0
    )
    return true
  }

  function limpiar() {
    setConsolidadoId("todos")
    setAnio(String(actual.anio))
    setSemana(String(actual.semana))
    setEstado("todos")
    setTercero("")
    setSoloConNovedad(false)
    setSinItem(false)
  }

  const totalPagina = pagos ? pagos.reduce((acc, p) => acc + p.valor, 0) : 0

  async function handleReintentar() {
    setReintentando(true)
    setError(null)
    setAviso(null)
    try {
      const r = await reintentarPagos()
      setAviso(
        `Se resolvieron ${r.fallosResueltos} ${r.fallosResueltos === 1 ? "orden" : "órdenes"} y se asignó ITEM a ` +
          `${r.itemsAsignados} ${r.itemsAsignados === 1 ? "pago" : "pagos"}.`
      )
      cargarAlertas()
      if (pagos !== null) cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo reintentar.")
    } finally {
      setReintentando(false)
    }
  }

  function verSinItem() {
    setSinItem(true)
    cargar({ sinItem: true }, 0)
  }

  const columnas: ColumnaExcel<Pago>[] = [
    {
      clave: "item",
      titulo: "ITEM",
      ancho: 70,
      fija: true,
      alinear: "center",
      texto: (p) => (p.item != null ? String(p.item) : ""),
    },
    {
      clave: "consolidado",
      titulo: "Consolidado",
      ancho: 150,
      texto: (p) => (p.consolidadoId ? (nombreConsolidado.get(p.consolidadoId) ?? "") : ""),
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
    {
      clave: "cuenta",
      titulo: "Cuenta",
      ancho: 230,
      texto: (p) => p.cuentaTexto ?? "",
      celda: (p) => (
        <span className={`truncate ${p.cuentaTexto && !p.cuentaVerificada ? "text-amber-700" : ""}`} title={p.cuentaTexto ?? undefined}>
          {p.cuentaTexto ?? <span className="text-muted-foreground/60">—</span>}
          {p.cuentaTexto && !p.cuentaVerificada && " (sin verificar)"}
        </span>
      ),
    },
    {
      clave: "concepto",
      titulo: "Concepto",
      ancho: 300,
      texto: (p) => p.concepto,
    },
    { clave: "proyecto", titulo: "Proyecto", ancho: 150, texto: (p) => p.proyectoCodigo ?? p.proyectoNombre ?? "" },
    {
      clave: "tipo",
      titulo: "Pago",
      ancho: 100,
      texto: (p) => ETIQUETA_TIPO_PAGO[p.tipo],
    },
    {
      clave: "valor",
      titulo: "Valor",
      ancho: 130,
      alinear: "right",
      texto: (p) => formatoMoneda(p.valor),
      claseCelda: "tabular-nums",
    },
    {
      clave: "estado",
      titulo: "Estado",
      ancho: 140,
      texto: (p) => ETIQUETA_ESTADO_PAGO[p.estado],
      celda: (p) => (
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className={`h-6 px-3 text-xs ${CLASE_ESTADO_PAGO[p.estado]}`}>
            {ETIQUETA_ESTADO_PAGO[p.estado]}
          </Badge>
          {p.novedad && (
            <span title={p.novedad}>
              <AlertTriangle className="h-4 w-4 text-amber-600" aria-label="Con novedad" />
            </span>
          )}
        </div>
      ),
    },
    {
      clave: "novedad",
      titulo: "Novedad",
      ancho: 260,
      texto: (p) => p.novedad ?? "",
    },
    {
      clave: "acciones",
      titulo: "Acciones",
      ancho: 120,
      ordenable: false,
      texto: () => "",
      celda: (p) =>
        puedeGestionar && puedeResolver(p) ? (
          <Button size="sm" variant="outline" className="h-8" onClick={() => setResolviendo(p)}>
            <Wrench className="mr-1.5 h-4 w-4" />
            Tercero
          </Button>
        ) : null,
    },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex min-h-0 flex-1 gap-4">
        <PanelFiltros
          cargando={cargando}
          onConsultar={handleConsultar}
          onLimpiar={limpiar}
          ayuda="Por omisión: la semana actual. El ITEM se numera por consolidado y semana."
        >
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
              <Label htmlFor="anio-pagos">Año</Label>
              <Input
                id="anio-pagos"
                type="number"
                inputMode="numeric"
                value={anio}
                disabled={sinItem}
                onChange={(e) => setAnio(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="semana-pagos">Semana</Label>
              <Input
                id="semana-pagos"
                type="number"
                inputMode="numeric"
                min="1"
                max="53"
                value={semana}
                disabled={sinItem}
                onChange={(e) => setSemana(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Estado</Label>
            <Select value={estado} onValueChange={(v) => setEstado((v ?? "todos") as EstadoPago | "todos")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {ESTADOS_FILTRO.map((e) => (
                  <SelectItem key={e} value={e}>
                    {ETIQUETA_ESTADO_PAGO[e]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tercero-consolidado">Tercero</Label>
            <Input
              id="tercero-consolidado"
              placeholder="Nombre o razón social"
              value={tercero}
              onChange={(e) => setTercero(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConsultar()}
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={soloConNovedad} onCheckedChange={(v) => setSoloConNovedad(v === true)} />
            Solo con novedad
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={sinItem} onCheckedChange={(v) => setSinItem(v === true)} />
            Aprobados sin ITEM (empresa sin consolidado)
          </label>
        </PanelFiltros>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {aviso && (
            <div className="rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-800">{aviso}</div>
          )}

          {alertas && (alertas.fallos > 0 || alertas.sinItem > 0) && (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {alertas.fallos > 0 && (
                <p>
                  <strong>{alertas.fallos}</strong> {alertas.fallos === 1 ? "orden aprobada no generó" : "órdenes aprobadas no generaron"} sus
                  pagos.
                </p>
              )}
              {alertas.sinItem > 0 && (
                <p>
                  <strong>{alertas.sinItem}</strong> {alertas.sinItem === 1 ? "pago aprobado no tiene" : "pagos aprobados no tienen"} ITEM
                  todavía: su proyecto no tiene empresa, o su empresa no tiene consolidado (se asignan en Control
                  administrativo).
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {alertas.sinItem > 0 && (
                  <Button size="sm" variant="outline" onClick={verSinItem}>
                    Ver los pagos sin ITEM
                  </Button>
                )}
                {puedeGestionar && (
                  <Button size="sm" disabled={reintentando} onClick={handleReintentar}>
                    {reintentando ? "Reintentando..." : "Reintentar"}
                  </Button>
                )}
              </div>
            </div>
          )}

          {pagos === null && !cargando ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Elige los filtros que quieras y presiona Consultar para ver el consolidado.
            </div>
          ) : pagos === null ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando consolidado...
            </div>
          ) : pagos.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Ningún pago coincide con los filtros.
            </div>
          ) : (
            <>
              <TablaExcel
                filas={pagos}
                columnas={columnas}
                claveFila={(p) => p.id}
                tarjeta={{
                  titulo: (p) => p.terceroNombre ?? "Sin tercero",
                  subtitulo: (p) => `ITEM ${p.item ?? "—"} · ${p.empresaNombre ?? ""}`,
                  esquina: (p) => (
                    <Badge variant="outline" className={`h-6 px-3 text-xs ${CLASE_ESTADO_PAGO[p.estado]}`}>
                      {ETIQUETA_ESTADO_PAGO[p.estado]}
                    </Badge>
                  ),
                  campos: ["cuenta", "concepto", "proyecto", "valor", "novedad", "acciones"],
                }}
              />
              <div className="text-right text-sm text-muted-foreground">
                {pagos.length} {pagos.length === 1 ? "pago" : "pagos"} en esta página · Total de la página{" "}
                <span className="font-medium text-foreground tabular-nums">{formatoMoneda(totalPagina)}</span>
              </div>
            </>
          )}

          {pagos !== null && pagos.length > 0 && (
            <PaginacionSimple pagina={pagina} hayMas={hayMas} cargando={cargando} onCambiar={(n) => cargar(ultimosFiltros, n)} />
          )}
        </div>
      </div>

      <ResolverPagoDialogo
        pago={resolviendo}
        onCerrar={() => setResolviendo(null)}
        onResuelto={(p) => {
          setResolviendo(null)
          setPagos((actuales) => (actuales ? actuales.map((x) => (x.id === p.id ? p : x)) : actuales))
        }}
      />
    </div>
  )
}

// Elegir el tercero y la cuenta de un pago (cuando no se resolvieron solos).
function ResolverPagoDialogo({
  pago,
  onCerrar,
  onResuelto,
}: {
  pago: Pago | null
  onCerrar: () => void
  onResuelto: (p: Pago) => void
}) {
  return (
    <Dialog open={pago !== null} onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent>
        {pago && <ContenidoResolver key={pago.id} pago={pago} onCerrar={onCerrar} onResuelto={onResuelto} />}
      </DialogContent>
    </Dialog>
  )
}

function ContenidoResolver({
  pago,
  onCerrar,
  onResuelto,
}: {
  pago: Pago
  onCerrar: () => void
  onResuelto: (p: Pago) => void
}) {
  const [tercero, setTercero] = useState<OpcionBuscador | null>(
    pago.terceroId && pago.terceroNombre ? { id: pago.terceroId, etiqueta: pago.terceroNombre } : null
  )
  const [cuentas, setCuentas] = useState<CuentaOpcion[]>([])
  const [cuentaId, setCuentaId] = useState(pago.cuentaId ?? "")
  const [cargandoCuentas, setCargandoCuentas] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!tercero) {
      setCuentas([])
      return
    }
    let vigente = true
    setCargandoCuentas(true)
    cuentasDeTercero(tercero.id)
      .then((c: CuentaOpcion[]) => {
        if (!vigente) return
        setCuentas(c)
        // Si el tercero tiene una sola cuenta verificada se propone sola.
        const activas = c.filter((x) => x.estado === "ACTIVO")
        setCuentaId((previa) => (c.some((x) => x.id === previa) ? previa : activas.length === 1 ? activas[0].id : ""))
      })
      .catch((e) => vigente && setError(e instanceof Error ? e.message : "No se pudieron cargar las cuentas."))
      .finally(() => vigente && setCargandoCuentas(false))
    return () => {
      vigente = false
    }
  }, [tercero])

  async function guardar() {
    if (!tercero) return
    setGuardando(true)
    setError(null)
    try {
      onResuelto(await asignarTerceroPago(pago.id, tercero.id, cuentaId || null))
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Tercero y cuenta del pago {pago.item != null ? `· ITEM ${pago.item}` : ""}</DialogTitle>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">
        {pago.concepto} · {formatoMoneda(pago.valor)}
      </p>
      {pago.novedad && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{pago.novedad}</p>
      )}
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      <div className="space-y-1.5">
        <Label>Tercero</Label>
        <BuscadorAsync
          placeholder="Buscar por nombre o documento"
          valorSeleccionado={tercero}
          onSeleccionar={(o) => {
            setTercero(o)
            setCuentaId("")
          }}
          buscar={buscarTercerosAdaptado}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Cuenta bancaria</Label>
        <Select value={cuentaId} onValueChange={(v) => setCuentaId(v ?? "")} disabled={!tercero || cargandoCuentas}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={cargandoCuentas ? "Cargando..." : "Escoge la cuenta"} />
          </SelectTrigger>
          <SelectContent>
            {cuentas.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.texto}
                {c.estado === "PENDIENTE" ? " (sin verificar)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {tercero && !cargandoCuentas && cuentas.length === 0 && (
          <p className="text-xs text-amber-700">
            Este tercero no tiene cuentas bancarias: agrégala en A&F → Terceros.
          </p>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" disabled={guardando} onClick={onCerrar}>
          Cancelar
        </Button>
        <Button disabled={!tercero || guardando} onClick={guardar}>
          {guardando ? "Guardando..." : "Guardar"}
        </Button>
      </DialogFooter>
    </>
  )
}
