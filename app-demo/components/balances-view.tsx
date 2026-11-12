"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeftRight, FileText, Loader2, Minus, Pencil, Plus, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CampoFecha } from "@/components/ui/campo-fecha"
import { pedirTexto } from "@/components/ui/confirmar"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { PaginacionSimple } from "@/components/paginacion-simple"
import { AYUDA_DOBLE_CLIC } from "@/components/ventana-detalle"
import { createClient } from "@/lib/supabase/client"
import { extensionArchivo, revisarArchivoTercero } from "@/lib/archivos-tercero"
import { formatoMoneda } from "@/lib/pagos"
import { formatearFechaHora, formatearFechaSinHora, hoyColombia } from "@/lib/fechas"
import {
  ETIQUETA_CLASE_LINEA,
  ETIQUETA_TIPO_MOVIMIENTO,
  etiquetaCuenta,
  validarMovimiento,
  type Extracto,
  type FormMovimiento,
  type MovimientoBancario,
  type SaldoCuenta,
  type TipoMovimiento,
} from "@/lib/balances"
import {
  eliminarMovimiento,
  enlaceSoporteMovimiento,
  extractoCuenta,
  guardarMovimiento,
  guardarSaldoInicial,
  listarMovimientos,
  saldosBancarios,
  type FiltrosMovimientos,
} from "@/app/(app)/ayf/balances/actions"

const TODAS = "todas"

// Saldo con signo: "-1.500" o "1.500,50" (leerNumero no acepta negativos).
function leerSaldo(texto: string): number | null {
  const t = texto.trim()
  const negativo = t.startsWith("-")
  const n = leerMonto(negativo ? t.slice(1) : t)
  return n == null ? null : negativo ? -n : n
}
function leerMonto(texto: string): number | null {
  const t = texto.trim().replace(/\s|\$/g, "")
  if (t === "") return null
  let normal: string
  if (t.includes(",")) normal = t.replace(/\./g, "").replace(",", ".")
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) normal = t.replace(/\./g, "")
  else normal = t
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return null
  return Number(normal)
}
const aTextoMonto = (n: number | null) => (n == null ? "" : String(n).replace(".", ","))

const COLOR_TIPO: Record<TipoMovimiento, string> = {
  ingreso: "border-green-300 bg-green-50 text-green-800",
  egreso: "border-amber-300 bg-amber-50 text-amber-800",
  traslado: "border-sky-300 bg-sky-50 text-sky-800",
}

export function EtiquetaTipoMovimiento({ tipo }: { tipo: TipoMovimiento }) {
  return (
    <Badge variant="outline" className={`h-6 px-2 text-xs ${COLOR_TIPO[tipo]}`}>
      {tipo === "ingreso" ? "INGRESO" : tipo === "egreso" ? "EGRESO EXTERNO" : "TRASLADO"}
    </Badge>
  )
}

const Pesos = ({ n, rojo }: { n: number | null; rojo?: boolean }) =>
  n == null ? <span className="text-muted-foreground/60">—</span> : <span className={`tabular-nums ${rojo && n < 0 ? "font-medium text-red-700" : ""}`}>{formatoMoneda(n)}</span>

// ---------------------------------------------------------------------------
// Balances: Saldos bancarios (una fila por cuenta a debitar; doble clic =
// extracto) y Registrar movimientos (saldos de inicio, ingresos, egresos,
// traslados internos y la lista de registros).
// ---------------------------------------------------------------------------
export function BalancesView({ puedeRegistrar }: { puedeRegistrar: boolean }) {
  const [vista, setVista] = useState<"saldos" | "registrar">("saldos")
  const [cuentas, setCuentas] = useState<SaldoCuenta[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [extractoDe, setExtractoDe] = useState<SaldoCuenta | null>(null)
  const [saldoDe, setSaldoDe] = useState<SaldoCuenta | null>(null)
  // Formulario de movimiento: nuevo (tipo) o edición (movimiento).
  const [form, setForm] = useState<{ tipo: TipoMovimiento; mov: MovimientoBancario | null } | null>(null)
  const [versionRegistros, setVersionRegistros] = useState(0)

  const cargarCuentas = useCallback(() => {
    saldosBancarios()
      .then((c: SaldoCuenta[]) => setCuentas(c))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los saldos."))
  }, [])
  useEffect(() => {
    cargarCuentas()
  }, [cargarCuentas])

  function cambio(mensaje: string) {
    setAviso(mensaje)
    setError(null)
    cargarCuentas()
    setVersionRegistros((v) => v + 1)
  }

  const pestana = (v: "saldos" | "registrar", titulo: string) => (
    <button
      type="button"
      onClick={() => setVista(v)}
      className={`-mb-px border-b-2 px-3 py-2 text-sm ${vista === v ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
    >
      {titulo}
    </button>
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-1 border-b">
        {pestana("saldos", "Saldos bancarios")}
        {pestana("registrar", "Registrar movimientos")}
        {puedeRegistrar && (
          <div className="mb-1.5 ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="border-green-300 text-green-800" onClick={() => setForm({ tipo: "ingreso", mov: null })}>
              <Plus className="mr-1.5 h-4 w-4" /> Ingreso
            </Button>
            <Button size="sm" variant="outline" className="border-amber-300 text-amber-800" onClick={() => setForm({ tipo: "egreso", mov: null })}>
              <Minus className="mr-1.5 h-4 w-4" /> Egreso externo
            </Button>
            <Button size="sm" variant="outline" className="border-sky-300 text-sky-800" onClick={() => setForm({ tipo: "traslado", mov: null })}>
              <ArrowLeftRight className="mr-1.5 h-4 w-4" /> Traslado interno
            </Button>
          </div>
        )}
      </div>

      {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>}
      {aviso && <div className="rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-800">{aviso}</div>}

      {cuentas === null ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando cuentas...
        </div>
      ) : vista === "saldos" ? (
        <SaldosBancarios cuentas={cuentas} onExtracto={setExtractoDe} />
      ) : (
        <RegistrarMovimientos
          cuentas={cuentas}
          puedeRegistrar={puedeRegistrar}
          version={versionRegistros}
          onSaldoInicial={setSaldoDe}
          onEditar={(m) => setForm({ tipo: m.tipo, mov: m })}
          onCambio={cambio}
          onError={setError}
        />
      )}

      <ExtractoDialog cuenta={extractoDe} onCerrar={() => setExtractoDe(null)} />
      <SaldoInicialDialog
        cuenta={saldoDe}
        onCerrar={() => setSaldoDe(null)}
        onGuardado={(c) => {
          setSaldoDe(null)
          cambio(`Saldo de inicio de ${c.apodo} guardado.`)
        }}
      />
      {cuentas && (
        <MovimientoDialog
          abierto={form}
          cuentas={cuentas}
          onCerrar={() => setForm(null)}
          onGuardado={(codigo, editado) => {
            setForm(null)
            cambio(editado ? `Movimiento ${codigo} actualizado.` : `Movimiento ${codigo} registrado.`)
          }}
        />
      )}
    </div>
  )
}

// ------------------------------------------------------------ Saldos bancarios
function SaldosBancarios({ cuentas, onExtracto }: { cuentas: SaldoCuenta[]; onExtracto: (c: SaldoCuenta) => void }) {
  const [busqueda, setBusqueda] = useState("")
  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return q ? cuentas.filter((c) => [c.apodo, c.banco, c.empresa, c.numeroCuenta].join(" ").toLowerCase().includes(q)) : cuentas
  }, [cuentas, busqueda])
  const conSaldo = visibles.filter((c) => c.saldoActual != null)
  const total = conSaldo.reduce((a, c) => a + (c.saldoActual ?? 0), 0)
  const sinInicio = visibles.length - conSaldo.length

  const columnas: ColumnaExcel<SaldoCuenta>[] = [
    { clave: "empresa", titulo: "Empresa", ancho: 220, texto: (c) => c.empresa },
    { clave: "banco", titulo: "Banco", ancho: 140, texto: (c) => c.banco },
    {
      clave: "cuenta",
      titulo: "Cuenta",
      ancho: 230,
      flexible: true,
      texto: (c) => `${c.apodo} ${c.tipoCuenta} ${c.numeroCuenta}`,
      celda: (c) => (
        <div className="min-w-0">
          <div className="truncate">{c.apodo}</div>
          <div className="truncate text-xs text-muted-foreground">
            {c.tipoCuenta.toLowerCase()} · ****{c.numeroCuenta.slice(-4)}
          </div>
        </div>
      ),
    },
    {
      clave: "inicio",
      titulo: "Saldo de inicio",
      ancho: 160,
      alinear: "right",
      texto: (c) => (c.saldoInicial == null ? "" : formatoMoneda(c.saldoInicial)),
      valorOrden: (c) => c.saldoInicial ?? 0,
      celda: (c) =>
        c.saldoInicial == null ? (
          <span className="text-xs text-amber-700">Sin saldo de inicio</span>
        ) : (
          <div className="leading-tight">
            <Pesos n={c.saldoInicial} />
            <div className="text-xs text-muted-foreground">al {formatearFechaSinHora(c.fechaCorte)}</div>
          </div>
        ),
    },
    { clave: "ingresos", titulo: "Ingresos", ancho: 140, alinear: "right", texto: (c) => formatoMoneda(c.ingresos), valorOrden: (c) => c.ingresos, celda: (c) => <Pesos n={c.ingresos} /> },
    { clave: "egresos", titulo: "Egresos externos", ancho: 140, alinear: "right", texto: (c) => formatoMoneda(c.egresos), valorOrden: (c) => c.egresos, celda: (c) => <Pesos n={c.egresos} /> },
    { clave: "traslados", titulo: "Traslados (neto)", ancho: 140, alinear: "right", texto: (c) => formatoMoneda(c.traslados), valorOrden: (c) => c.traslados, celda: (c) => <Pesos n={c.traslados} /> },
    { clave: "pagos", titulo: "Pagos", ancho: 140, alinear: "right", texto: (c) => formatoMoneda(c.pagos), valorOrden: (c) => c.pagos, celda: (c) => <Pesos n={c.pagos} /> },
    {
      clave: "saldo",
      titulo: "Saldo actual",
      ancho: 160,
      alinear: "right",
      texto: (c) => (c.saldoActual == null ? "" : formatoMoneda(c.saldoActual)),
      valorOrden: (c) => c.saldoActual ?? Number.NEGATIVE_INFINITY,
      celda: (c) => <span className="font-semibold"><Pesos n={c.saldoActual} rojo /></span>,
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-72 space-y-1">
          <Label htmlFor="buscar-cuenta" className="text-xs">
            Buscar
          </Label>
          <Input id="buscar-cuenta" placeholder="Cuenta, banco o empresa" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <div className="ml-auto text-right text-sm">
          <div className="text-muted-foreground">Total de las cuentas con saldo de inicio</div>
          <div className={`text-lg font-semibold tabular-nums ${total < 0 ? "text-red-700" : ""}`}>{formatoMoneda(total)}</div>
          {sinInicio > 0 && <div className="text-xs text-amber-700">{sinInicio} sin saldo de inicio (no suman)</div>}
        </div>
      </div>
      <TablaExcel
        filas={visibles}
        columnas={columnas}
        claveFila={(c) => c.id}
        onDobleClickFila={onExtracto}
        tituloFila={AYUDA_DOBLE_CLIC}
        fondoFila={(c) => (c.saldoActual != null && c.saldoActual < 0 ? "bg-red-50" : undefined)}
        claseAltoMax="max-h-[calc(100svh-19rem)]"
        tarjeta={{
          titulo: (c) => c.apodo,
          subtitulo: (c) => `${c.banco} · ${c.empresa}`,
          campos: ["inicio", "ingresos", "egresos", "pagos", "saldo"],
        }}
      />
      <p className="text-xs text-muted-foreground">
        {AYUDA_DOBLE_CLIC} (extracto). Pagos = los dispersados y los PSE u otro medio marcados como pagados con esa cuenta, desde la fecha de corte.
      </p>
    </div>
  )
}

function ExtractoDialog({ cuenta, onCerrar }: { cuenta: SaldoCuenta | null; onCerrar: () => void }) {
  const hoy = hoyColombia()
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState(hoy)
  const [extracto, setExtracto] = useState<Extracto | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const consultar = useCallback(
    (cuentaId: string, d: string, h: string) => {
      // Los setState van dentro de la promesa (también se llama desde un efecto).
      Promise.resolve()
        .then(() => {
          setCargando(true)
          setError(null)
          return extractoCuenta(cuentaId, d || null, h || null)
        })
        .then((x: Extracto) => setExtracto(x))
        .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar el extracto."))
        .finally(() => setCargando(false))
    },
    []
  )

  const [abiertaPara, setAbiertaPara] = useState<string | null>(null)
  if (cuenta && cuenta.id !== abiertaPara) {
    setAbiertaPara(cuenta.id)
    setDesde("")
    setHasta(hoy)
    setExtracto(null)
  }
  useEffect(() => {
    if (abiertaPara) consultar(abiertaPara, "", hoyColombia())
  }, [abiertaPara, consultar])

  return (
    <Dialog
      open={cuenta !== null}
      onOpenChange={(a) => {
        if (a) return
        setAbiertaPara(null)
        onCerrar()
      }}
    >
      <DialogContent className="flex max-h-[92svh] w-[calc(100vw-1rem)] max-w-5xl flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Extracto · {cuenta ? etiquetaCuenta(cuenta) : ""}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Desde</Label>
            <CampoFecha value={desde} onChange={(e) => setDesde(e.target.value)} contenedorClassName="w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Hasta (saldo a esta fecha)</Label>
            <CampoFecha value={hasta} onChange={(e) => setHasta(e.target.value)} contenedorClassName="w-40" />
          </div>
          <Button size="sm" disabled={!cuenta || cargando} onClick={() => cuenta && consultar(cuenta.id, desde, hasta)}>
            {cargando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Consultar
          </Button>
          <span className="text-xs text-muted-foreground">Sin &quot;desde&quot;: desde la fecha de corte.</span>
        </div>
        {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        {extracto?.sinSaldoInicial ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Esta cuenta no tiene saldo de inicio. Pónselo en Registrar movimientos › Saldos de inicio.
          </p>
        ) : extracto ? (
          <div className="min-h-0 flex-1 overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-primary text-primary-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">Fecha</th>
                  <th className="px-2 py-1.5 text-left font-medium">Tipo</th>
                  <th className="px-2 py-1.5 text-left font-medium">Código / REF</th>
                  <th className="px-2 py-1.5 text-left font-medium">Titular</th>
                  <th className="px-2 py-1.5 text-left font-medium">Concepto</th>
                  <th className="px-2 py-1.5 text-right font-medium">Entra</th>
                  <th className="px-2 py-1.5 text-right font-medium">Sale</th>
                  <th className="px-2 py-1.5 text-right font-medium">Saldo</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b bg-muted/40">
                  <td className="px-2 py-1.5" colSpan={7}>
                    Saldo al empezar ({formatearFechaSinHora(extracto.desde)}
                    {extracto.desde === extracto.fechaCorte ? ", saldo de inicio" : ""})
                  </td>
                  <td className="px-2 py-1.5 text-right font-medium">
                    <Pesos n={extracto.saldoAnterior} rojo />
                  </td>
                </tr>
                {extracto.filas.map((f) => (
                  <tr key={`${f.registroId}-${f.clase}`} className="border-b">
                    <td className="whitespace-nowrap px-2 py-1.5">{formatearFechaSinHora(f.fecha)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{ETIQUETA_CLASE_LINEA[f.clase] ?? f.clase}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{f.clase.startsWith("pago") && f.codigo ? `REF ${f.codigo}` : (f.codigo ?? "")}</td>
                    <td className="max-w-48 truncate px-2 py-1.5" title={f.titular ?? undefined}>
                      {f.titular ?? ""}
                    </td>
                    <td className="max-w-64 truncate px-2 py-1.5" title={f.concepto ?? undefined}>
                      {f.concepto ?? ""}
                    </td>
                    <td className="px-2 py-1.5 text-right text-green-800">{f.valor > 0 ? <Pesos n={f.valor} /> : ""}</td>
                    <td className="px-2 py-1.5 text-right">{f.valor < 0 ? <Pesos n={-f.valor} /> : ""}</td>
                    <td className="px-2 py-1.5 text-right">
                      <Pesos n={f.saldo} rojo />
                    </td>
                  </tr>
                ))}
                {extracto.filas.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-2 py-6 text-center text-muted-foreground">
                      Sin movimientos en estas fechas.
                    </td>
                  </tr>
                )}
                <tr className="bg-muted/40 font-medium">
                  <td className="px-2 py-1.5" colSpan={7}>
                    Saldo al {formatearFechaSinHora(extracto.hasta ?? hoy)}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <Pesos n={extracto.saldoFinal} rojo />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex items-center justify-center p-8 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando...
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------- Registrar movimientos
function RegistrarMovimientos({
  cuentas,
  puedeRegistrar,
  version,
  onSaldoInicial,
  onEditar,
  onCambio,
  onError,
}: {
  cuentas: SaldoCuenta[]
  puedeRegistrar: boolean
  version: number
  onSaldoInicial: (c: SaldoCuenta) => void
  onEditar: (m: MovimientoBancario) => void
  onCambio: (mensaje: string) => void
  onError: (m: string | null) => void
}) {
  const [cuentaId, setCuentaId] = useState(TODAS)
  const [tipo, setTipo] = useState(TODAS)
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")
  const [eliminados, setEliminados] = useState(false)
  const [filas, setFilas] = useState<MovimientoBancario[] | null>(null)
  const [pagina, setPagina] = useState(0)
  const [hayMas, setHayMas] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)

  const filtros: FiltrosMovimientos = useMemo(
    () => ({
      cuentaId: cuentaId === TODAS ? undefined : cuentaId,
      tipo: tipo === TODAS ? undefined : (tipo as TipoMovimiento),
      desde: desde || undefined,
      hasta: hasta || undefined,
      eliminados,
    }),
    [cuentaId, tipo, desde, hasta, eliminados]
  )

  const cargar = useCallback(
    (pag: number) => {
      Promise.resolve()
        .then(() => {
          setCargando(true)
          return listarMovimientos(filtros, pag)
        })
        .then((r: { filas: MovimientoBancario[]; hayMas: boolean }) => {
          setFilas(r.filas)
          setHayMas(r.hayMas)
          setPagina(pag)
        })
        .catch((e) => onError(e instanceof Error ? e.message : "No se pudieron cargar los registros."))
        .finally(() => setCargando(false))
    },
    [filtros, onError]
  )
  useEffect(() => {
    cargar(0)
  }, [cargar, version])

  async function verSoporte(m: MovimientoBancario) {
    try {
      window.open(await enlaceSoporteMovimiento(m.id), "_blank", "noopener")
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se pudo abrir el soporte.")
    }
  }

  async function eliminar(m: MovimientoBancario) {
    const motivo = await pedirTexto(`Se elimina ${m.codigo} (${formatoMoneda(m.valor)}). Deja de contar en los saldos; queda en los registros como eliminado.`, {
      titulo: "Eliminar movimiento",
      etiqueta: "¿Por qué se elimina?",
      boton: "Eliminar",
      peligro: true,
      minimo: 3,
    })
    if (motivo === null) return
    setOcupado(m.id)
    try {
      await eliminarMovimiento(m.id, motivo.trim())
      onCambio(`Movimiento ${m.codigo} eliminado.`)
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se pudo eliminar.")
    } finally {
      setOcupado(null)
    }
  }

  const colsInicio: ColumnaExcel<SaldoCuenta>[] = [
    { clave: "empresa", titulo: "Empresa", ancho: 220, texto: (c) => c.empresa },
    { clave: "cuenta", titulo: "Cuenta", ancho: 280, flexible: true, texto: (c) => etiquetaCuenta(c) },
    { clave: "saldo", titulo: "Saldo de inicio", ancho: 160, alinear: "right", texto: (c) => (c.saldoInicial == null ? "" : formatoMoneda(c.saldoInicial)), celda: (c) => <Pesos n={c.saldoInicial} rojo /> },
    { clave: "corte", titulo: "Fecha de corte", ancho: 130, alinear: "center", texto: (c) => (c.fechaCorte ? formatearFechaSinHora(c.fechaCorte) : "") },
    ...(puedeRegistrar
      ? [
          {
            clave: "accion",
            titulo: "",
            ancho: 120,
            ordenable: false,
            texto: () => "",
            celda: (c: SaldoCuenta) => (
              <Button size="sm" variant="outline" className="h-8" onClick={() => onSaldoInicial(c)}>
                {c.saldoInicial == null ? "Poner" : "Cambiar"}
              </Button>
            ),
          },
        ]
      : []),
  ]

  const colsRegistros: ColumnaExcel<MovimientoBancario>[] = [
    {
      clave: "codigo",
      titulo: "Código",
      ancho: 170,
      fija: true,
      texto: (m) => `${m.codigo} ${ETIQUETA_TIPO_MOVIMIENTO[m.tipo]}`,
      celda: (m) => (
        <div className="flex items-center gap-1.5">
          <span className="font-medium">{m.codigo}</span>
          <EtiquetaTipoMovimiento tipo={m.tipo} />
        </div>
      ),
    },
    { clave: "fecha", titulo: "Fecha", ancho: 110, alinear: "center", texto: (m) => formatearFechaSinHora(m.fecha), valorOrden: (m) => m.fecha },
    {
      clave: "cuenta",
      titulo: "Cuenta",
      ancho: 230,
      texto: (m) => (m.tipo === "traslado" ? `${m.cuenta} → ${m.cuentaDestino}` : m.cuenta),
      celda: (m) => (
        <div className="min-w-0 leading-tight">
          <div className="truncate">{m.tipo === "traslado" ? `${m.cuenta} → ${m.cuentaDestino ?? ""}` : m.cuenta}</div>
          <div className="truncate text-xs text-muted-foreground">{[m.banco, m.empresa].filter(Boolean).join(" · ")}</div>
        </div>
      ),
    },
    { clave: "titular", titulo: "Titular", ancho: 200, texto: (m) => m.titular ?? "" },
    { clave: "concepto", titulo: "Concepto", ancho: 260, flexible: true, texto: (m) => m.concepto },
    { clave: "valor", titulo: "Valor", ancho: 140, alinear: "right", texto: (m) => formatoMoneda(m.valor), valorOrden: (m) => m.valor, celda: (m) => <Pesos n={m.valor} /> },
    {
      clave: "registro",
      titulo: "Registrado",
      ancho: 190,
      texto: (m) => `${m.creadoPor ?? ""} ${formatearFechaHora(m.creadoEn)}`,
      celda: (m) => (
        <div className="min-w-0 text-xs leading-tight">
          <div className="truncate">
            {m.creadoPor ?? "—"} · {formatearFechaHora(m.creadoEn)}
          </div>
          {m.eliminadoEn ? (
            <div className="truncate text-red-700" title={m.motivoEliminacion ?? undefined}>
              Eliminado por {m.eliminadoPor ?? "—"}: {m.motivoEliminacion}
            </div>
          ) : m.editadoEn ? (
            <div className="truncate text-muted-foreground">
              Editado por {m.editadoPor ?? "—"} · {formatearFechaHora(m.editadoEn)}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      clave: "acciones",
      titulo: "",
      ancho: puedeRegistrar ? 200 : 80,
      ordenable: false,
      texto: () => "",
      celda: (m) => (
        <div className="flex items-center gap-1">
          {m.soporteNombre && (
            <Button size="sm" variant="ghost" className="h-8 px-2" title={m.soporteNombre} onClick={() => verSoporte(m)}>
              <FileText className="h-4 w-4" />
            </Button>
          )}
          {puedeRegistrar && !m.eliminadoEn && (
            <>
              <Button size="sm" variant="outline" className="h-8" onClick={() => onEditar(m)}>
                <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-red-700" disabled={ocupado === m.id} onClick={() => eliminar(m)}>
                {ocupado === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </Button>
            </>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Saldos de inicio</h3>
        <p className="text-xs text-muted-foreground">
          El saldo de cada cuenta en la fecha de corte. Desde esa fecha cuentan los movimientos y los pagos; lo de antes no.
        </p>
        <TablaExcel
          filas={cuentas}
          columnas={colsInicio}
          claveFila={(c) => c.id}
          claseAltoMax="max-h-72"
          tarjeta={{ titulo: (c) => c.apodo, subtitulo: (c) => `${c.banco} · ${c.empresa}`, campos: ["saldo", "corte", "accion"] }}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Registros</h3>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-72 space-y-1">
            <Label className="text-xs">Cuenta</Label>
            <Select value={cuentaId} onValueChange={(v) => setCuentaId(v ?? TODAS)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Todas</SelectItem>
                {cuentas.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {etiquetaCuenta(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-44 space-y-1">
            <Label className="text-xs">Tipo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v ?? TODAS)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Todos</SelectItem>
                {(Object.keys(ETIQUETA_TIPO_MOVIMIENTO) as TipoMovimiento[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {ETIQUETA_TIPO_MOVIMIENTO[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Desde</Label>
            <CampoFecha value={desde} onChange={(e) => setDesde(e.target.value)} contenedorClassName="w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Hasta</Label>
            <CampoFecha value={hasta} onChange={(e) => setHasta(e.target.value)} contenedorClassName="w-40" />
          </div>
          <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={eliminados} onCheckedChange={(v) => setEliminados(v === true)} />
            Ver eliminados
          </label>
          {cargando && <Loader2 className="mb-2 h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        {filas === null ? null : filas.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No hay movimientos con estos filtros.</p>
        ) : (
          <>
            <TablaExcel
              filas={filas}
              columnas={colsRegistros}
              claveFila={(m) => m.id}
              fondoFila={(m) => (m.eliminadoEn ? "bg-muted/60 text-muted-foreground line-through decoration-muted-foreground/40" : undefined)}
              claseAltoMax="max-h-[60svh]"
              tarjeta={{
                titulo: (m) => `${m.codigo} · ${formatoMoneda(m.valor)}`,
                subtitulo: (m) => `${ETIQUETA_TIPO_MOVIMIENTO[m.tipo]} · ${formatearFechaSinHora(m.fecha)}`,
                campos: ["cuenta", "titular", "concepto", "registro", "acciones"],
              }}
            />
            <PaginacionSimple pagina={pagina} hayMas={hayMas} cargando={cargando} onCambiar={cargar} />
          </>
        )}
      </section>
    </div>
  )
}

// ------------------------------------------------------------- Saldo de inicio
function SaldoInicialDialog({ cuenta, onCerrar, onGuardado }: { cuenta: SaldoCuenta | null; onCerrar: () => void; onGuardado: (c: SaldoCuenta) => void }) {
  const [saldo, setSaldo] = useState("")
  const [fecha, setFecha] = useState("")
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [para, setPara] = useState<string | null>(null)
  if (cuenta && cuenta.id !== para) {
    setPara(cuenta.id)
    setSaldo(aTextoMonto(cuenta.saldoInicial))
    setFecha(cuenta.fechaCorte ?? hoyColombia())
    setError(null)
  }

  async function guardar() {
    if (!cuenta) return
    const n = leerSaldo(saldo)
    if (n == null) return setError("Escribe el saldo (puede ser negativo, con hasta 2 decimales).")
    if (!fecha) return setError("Escoge la fecha de corte.")
    setOcupado(true)
    setError(null)
    try {
      await guardarSaldoInicial(cuenta.id, n, fecha)
      setPara(null)
      onGuardado(cuenta)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.")
    } finally {
      setOcupado(false)
    }
  }

  return (
    <Dialog
      open={cuenta !== null}
      onOpenChange={(a) => {
        if (a || ocupado) return
        setPara(null)
        onCerrar()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Saldo de inicio</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {cuenta ? etiquetaCuenta(cuenta) : ""}. Es el saldo de la cuenta al empezar el día de corte: desde ese día cuentan los movimientos y los pagos.
          {cuenta?.saldoInicial != null && " Cambiarlo recalcula el saldo y queda en el registro de cambios."}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="saldo-inicio">Saldo</Label>
            <Input id="saldo-inicio" inputMode="decimal" placeholder="Ej. 15.000.000" value={saldo} onChange={(e) => setSaldo(e.target.value)} />
            {leerSaldo(saldo) != null && <p className="text-xs text-muted-foreground">{formatoMoneda(leerSaldo(saldo) ?? 0)}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Fecha de corte</Label>
            <CampoFecha value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
        </div>
        {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={ocupado}
            onClick={() => {
              setPara(null)
              onCerrar()
            }}
          >
            Cancelar
          </Button>
          <Button disabled={ocupado} onClick={guardar}>
            {ocupado && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------ Movimiento
const FORM_VACIO = (tipo: TipoMovimiento): FormMovimiento => ({
  tipo,
  cuentaId: "",
  cuentaDestinoId: "",
  fecha: hoyColombia(),
  valor: null,
  concepto: "",
  titular: "",
})

function MovimientoDialog({
  abierto,
  cuentas,
  onCerrar,
  onGuardado,
}: {
  abierto: { tipo: TipoMovimiento; mov: MovimientoBancario | null } | null
  cuentas: SaldoCuenta[]
  onCerrar: () => void
  onGuardado: (codigo: string, editado: boolean) => void
}) {
  const [form, setForm] = useState<FormMovimiento>(FORM_VACIO("ingreso"))
  const [valorTexto, setValorTexto] = useState("")
  const [archivo, setArchivo] = useState<File | null>(null)
  const [quitarSoporte, setQuitarSoporte] = useState(false)
  const [errores, setErrores] = useState<Partial<Record<keyof FormMovimiento, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const archivoRef = useRef<HTMLInputElement>(null)

  const clave = abierto ? `${abierto.tipo}:${abierto.mov?.id ?? "nuevo"}` : null
  const [para, setPara] = useState<string | null>(null)
  if (clave && clave !== para) {
    setPara(clave)
    const m = abierto!.mov
    setForm(
      m
        ? {
            tipo: m.tipo,
            cuentaId: m.cuentaId,
            cuentaDestinoId: m.cuentaDestinoId ?? "",
            fecha: m.fecha,
            valor: m.valor,
            concepto: m.concepto,
            titular: m.titular ?? "",
          }
        : FORM_VACIO(abierto!.tipo)
    )
    setValorTexto(m ? aTextoMonto(m.valor) : "")
    setArchivo(null)
    setQuitarSoporte(false)
    setErrores({})
    setError(null)
  }

  const editando = abierto?.mov ?? null
  const tipo = form.tipo
  const poner = (c: Partial<FormMovimiento>) => {
    setForm((f) => ({ ...f, ...c }))
    setErrores((e) => {
      const n = { ...e }
      for (const k of Object.keys(c)) delete n[k as keyof FormMovimiento]
      return n
    })
  }

  function cerrar() {
    if (ocupado) return
    setPara(null)
    onCerrar()
  }

  async function guardar() {
    const datos = { ...form, valor: leerMonto(valorTexto) }
    const e = validarMovimiento(datos, hoyColombia())
    setErrores(e)
    if (Object.keys(e).length > 0) {
      setError("Revisa los datos marcados en rojo.")
      return
    }
    setOcupado(true)
    setError(null)
    const supabase = createClient()
    let ruta: string | null = null
    try {
      let soporte: { ruta: string; nombre: string; mime: string } | null | undefined = undefined
      if (archivo) {
        const { data: sesion } = await supabase.auth.getUser()
        const uid = sesion.user?.id
        if (!uid) throw new Error("Tu sesión se cerró: vuelve a iniciar sesión.")
        const intento = `${uid}/${crypto.randomUUID()}.${extensionArchivo(archivo)}`
        const { error: eSubir } = await supabase.storage.from("balances").upload(intento, archivo, { contentType: archivo.type, upsert: false })
        if (eSubir) throw new Error(`No se pudo subir el soporte: ${eSubir.message}`)
        ruta = intento
        soporte = { ruta, nombre: archivo.name, mime: archivo.type }
      } else if (editando && quitarSoporte) {
        soporte = null
      } else if (!editando) {
        soporte = null
      }
      const r = await guardarMovimiento(editando?.id ?? null, datos, soporte)
      setPara(null)
      onGuardado(r.codigo, editando != null)
    } catch (err) {
      if (ruta) await supabase.storage.from("balances").remove([ruta])
      setError(err instanceof Error ? err.message : "No se pudo guardar.")
    } finally {
      setOcupado(false)
    }
  }

  const selectorCuenta = (etiqueta: string, valor: string, onCambiar: (v: string) => void, errorCampo?: string) => (
    <div className="space-y-1.5">
      <Label>{etiqueta}</Label>
      <Select value={valor} onValueChange={(v) => onCambiar(v ?? "")}>
        <SelectTrigger className={`w-full ${errorCampo ? "border-destructive" : ""}`} aria-invalid={!!errorCampo}>
          <SelectValue placeholder="Escoge la cuenta" />
        </SelectTrigger>
        <SelectContent>
          {cuentas.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {etiquetaCuenta(c)}
              {c.empresa ? ` · ${c.empresa}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {errorCampo && <p className="text-xs text-destructive">{errorCampo}</p>}
    </div>
  )

  const titulo =
    (editando ? `Editar ${editando.codigo}` : "Nuevo") +
    (tipo === "ingreso" ? (editando ? " · ingreso" : " ingreso") : tipo === "egreso" ? (editando ? " · egreso externo" : " egreso externo") : editando ? " · traslado interno" : " traslado interno")

  return (
    <Dialog open={abierto !== null} onOpenChange={(a) => !a && cerrar()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {titulo} <EtiquetaTipoMovimiento tipo={tipo} />
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          {tipo === "traslado" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {selectorCuenta("Sale de", form.cuentaId, (v) => poner({ cuentaId: v }), errores.cuentaId)}
              {selectorCuenta("Entra a", form.cuentaDestinoId, (v) => poner({ cuentaDestinoId: v }), errores.cuentaDestinoId)}
            </div>
          ) : (
            selectorCuenta(tipo === "ingreso" ? "Cuenta a la que entra" : "Cuenta que se debita", form.cuentaId, (v) => poner({ cuentaId: v }), errores.cuentaId)
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Fecha</Label>
              <CampoFecha value={form.fecha} onChange={(e) => poner({ fecha: e.target.value })} />
              {errores.fecha && <p className="text-xs text-destructive">{errores.fecha}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="valor-mov">Valor</Label>
              <Input
                id="valor-mov"
                inputMode="decimal"
                placeholder="Ej. 2.500.000"
                value={valorTexto}
                aria-invalid={!!errores.valor}
                className={errores.valor ? "border-destructive" : undefined}
                onChange={(e) => {
                  setValorTexto(e.target.value)
                  poner({ valor: leerMonto(e.target.value) })
                }}
              />
              {errores.valor ? (
                <p className="text-xs text-destructive">{errores.valor}</p>
              ) : leerMonto(valorTexto) != null ? (
                <p className="text-xs text-muted-foreground">{formatoMoneda(leerMonto(valorTexto) ?? 0)}</p>
              ) : null}
            </div>
          </div>
          {tipo !== "traslado" && (
            <div className="space-y-1.5">
              <Label htmlFor="titular-mov">Titular</Label>
              <Input
                id="titular-mov"
                value={form.titular}
                maxLength={200}
                aria-invalid={!!errores.titular}
                className={errores.titular ? "border-destructive" : undefined}
                placeholder={tipo === "ingreso" ? "Quién consigna" : "A quién se le paga"}
                onChange={(e) => poner({ titular: e.target.value })}
              />
              {errores.titular && <p className="text-xs text-destructive">{errores.titular}</p>}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="concepto-mov">Concepto</Label>
            <Textarea
              id="concepto-mov"
              rows={2}
              maxLength={500}
              value={form.concepto}
              aria-invalid={!!errores.concepto}
              className={errores.concepto ? "border-destructive" : undefined}
              onChange={(e) => poner({ concepto: e.target.value })}
            />
            {errores.concepto && <p className="text-xs text-destructive">{errores.concepto}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Soporte (opcional)</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={ocupado} onClick={() => archivoRef.current?.click()}>
                {archivo || (editando?.soporteNombre && !quitarSoporte) ? "Cambiar archivo" : "Adjuntar archivo"}
              </Button>
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                {archivo ? archivo.name : editando?.soporteNombre && !quitarSoporte ? editando.soporteNombre : "PDF, JPG o PNG de hasta 10 MB"}
              </span>
              {(archivo || (editando?.soporteNombre && !quitarSoporte)) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={ocupado}
                  onClick={() => {
                    if (archivo) setArchivo(null)
                    else setQuitarSoporte(true)
                  }}
                >
                  Quitar
                </Button>
              )}
            </div>
            <input
              ref={archivoRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ""
                if (!f) return
                const problema = revisarArchivoTercero(f, "El soporte")
                setError(problema)
                if (!problema) setArchivo(f)
              }}
            />
          </div>
        </div>
        {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        <DialogFooter>
          <Button variant="outline" disabled={ocupado} onClick={cerrar}>
            Cancelar
          </Button>
          <Button disabled={ocupado} onClick={guardar}>
            {ocupado && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editando ? "Guardar cambios" : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
