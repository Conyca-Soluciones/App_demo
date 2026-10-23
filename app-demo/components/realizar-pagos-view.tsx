"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, Download, FileText, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PanelFiltros } from "@/components/panel-filtros"
import { SelectorNumeros } from "@/components/selector-numeros"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import {
  asignarCuentaDebitar,
  confirmarCuentaPagos,
  enlaceArchivoDispersion,
  generarDispersores,
  listarDispersiones,
  listarRealizarPagos,
  marcarFueraDispersor,
  type ArchivoDispersion,
  type Dispersion,
  type FiltrosRealizarPagos,
  type TandaGenerada,
} from "@/app/(app)/ayf/realizar-pagos/actions"
import {
  ESTADOS_DEL_PASO,
  ETIQUETA_ESTADO_DISPERSOR,
  agruparAsignados,
  descripcionCuenta,
  nombreArchivoGrupo,
  renglonDe,
  type CuentaEmpresa,
  type EstadoDispersor,
  type PagoConEstado,
} from "@/lib/dispersores/pagos-dispersor"
import { avisosDispersor } from "@/lib/dispersores/generador"
import { fechasSemanaIso, formatoMoneda, semanaIso, semanasDelAnio } from "@/lib/pagos"
import { formatearFechaHora } from "@/lib/fechas"

const TODOS = "todos"
type Vista = "dispersar" | "otros" | "generados"
type Paso = 1 | 2 | 3

const COLOR_ESTADO: Record<EstadoDispersor, string> = {
  listo: "bg-sky-100 text-sky-800",
  asignado: "bg-green-100 text-green-800",
  confirmar: "bg-amber-100 text-amber-800",
  bloqueado: "bg-red-100 text-red-700",
  fuera: "bg-muted text-muted-foreground",
  dispersado: "bg-violet-100 text-violet-800",
}

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

// Realizar Pagos: la consola de dispersores. Paso 1 prepara (confirmar cuentas,
// bloqueados, los que no van por dispersor), paso 2 asigna la cuenta a debitar
// y paso 3 muestra los totales por dispersor y genera.
export function RealizarPagosView({ puedeGenerar }: { puedeGenerar: boolean }) {
  const actual = semanaIso()
  const [anios, setAnios] = useState<number[]>([actual.anio])
  const [semanas, setSemanas] = useState<number[]>([actual.semana])
  const [ultimos, setUltimos] = useState<FiltrosRealizarPagos | null>(null)

  const [pagos, setPagos] = useState<PagoConEstado[] | null>(null)
  const [cuentas, setCuentas] = useState<CuentaEmpresa[]>([])
  const [dispersiones, setDispersiones] = useState<Dispersion[]>([])
  const [cargando, setCargando] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [generadas, setGeneradas] = useState<TandaGenerada[] | null>(null)

  const [vista, setVista] = useState<Vista>("dispersar")
  const [paso, setPaso] = useState<Paso>(1)
  const [estado, setEstado] = useState<EstadoDispersor | null>(null)
  const [busqueda, setBusqueda] = useState("")
  const [grupo, setGrupo] = useState(TODOS)
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [banco, setBanco] = useState("")
  const [cuentaId, setCuentaId] = useState("")

  const opcionesAnios = useMemo(() => {
    const lista: number[] = []
    for (let y = actual.anio; y >= Math.min(2026, actual.anio); y--) lista.push(y)
    return lista
  }, [actual.anio])
  const totalSemanas = anios.length === 1 ? semanasDelAnio(anios[0]) : 53
  const opcionesSemanas = useMemo(() => Array.from({ length: totalSemanas }, (_, i) => i + 1), [totalSemanas])

  function cargar(filtros: FiltrosRealizarPagos) {
    setUltimos(filtros)
    setCargando(true)
    setError(null)
    Promise.all([listarRealizarPagos(filtros), listarDispersiones(filtros)])
      .then(([r, d]: [{ pagos: PagoConEstado[]; cuentas: CuentaEmpresa[] }, Dispersion[]]) => {
        setPagos(r.pagos)
        setCuentas(r.cuentas)
        setDispersiones(d)
        setSeleccion(new Set())
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los pagos."))
      .finally(() => setCargando(false))
  }

  function handleConsultar(): boolean {
    setGeneradas(null)
    setAviso(null)
    cargar({ anios: anios.length ? anios : undefined, semanas: semanas.length ? semanas : undefined })
    return true
  }

  // Una acción del paso y volver a leer (los estados los decide la base).
  async function ejecutar(etiqueta: string, fn: () => Promise<number>, mensaje: (n: number) => string) {
    setOcupado(etiqueta)
    setError(null)
    setAviso(null)
    try {
      const n = await fn()
      setAviso(mensaje(n))
      if (ultimos) cargar(ultimos)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la acción.")
    } finally {
      setOcupado(null)
    }
  }

  // ---------------------------------------------------------- datos derivados

  const lista = useMemo(() => pagos ?? [], [pagos])
  const conteo = useMemo(() => {
    const c: Record<EstadoDispersor, number> = { listo: 0, asignado: 0, confirmar: 0, bloqueado: 0, fuera: 0, dispersado: 0 }
    for (const p of lista) c[p.estado]++
    return c
  }, [lista])
  const grupos = useMemo(() => [...new Set(lista.map((p) => p.grupo).filter(Boolean))].sort(), [lista])
  const cuentaPorId = useMemo(() => new Map(cuentas.map((c) => [c.id, c])), [cuentas])
  const bancos = useMemo(() => [...new Set(cuentas.map((c) => c.banco))].sort(), [cuentas])
  const cuentasDelBanco = cuentas.filter((c) => c.banco === banco)

  const filtrar = (estados: EstadoDispersor[]) => {
    const q = sinTildes(busqueda.trim())
    const permitidos = new Set(estados)
    return lista.filter((p) => {
      if (!permitidos.has(p.estado)) return false
      if (grupo !== TODOS && p.grupo !== grupo) return false
      if (!q) return true
      const t = sinTildes(
        [p.item, p.beneficiario?.razonSocial, p.beneficiario?.numeroDocumento, p.factura, p.proyecto, p.cuenta?.numero, p.consolidado].join(" ")
      )
      return t.includes(q)
    })
  }

  const estadosVisibles: EstadoDispersor[] =
    vista === "otros" ? ["fuera"] : paso === 3 ? ["asignado"] : estado ? [estado] : ESTADOS_DEL_PASO[paso]
  const visibles = vista === "generados" ? [] : filtrar(estadosVisibles)
  const elegidos = visibles.filter((p) => seleccion.has(p.id))
  const idsDe = (estados: EstadoDispersor[]) => elegidos.filter((p) => estados.includes(p.estado)).map((p) => p.id)

  const tandas = useMemo(() => agruparAsignados(lista, cuentaPorId), [lista, cuentaPorId])
  const totalAsignado = tandas.reduce((a, g) => a + g.pagos.reduce((s, p) => s + p.valor, 0), 0)

  function cambiarPaso(n: Paso) {
    setPaso(n)
    setEstado(null)
    setSeleccion(new Set())
  }

  // ---------------------------------------------------------- acciones

  const asignar = () =>
    ejecutar(
      "asignar",
      () => asignarCuentaDebitar(idsDe(["listo", "asignado"]), cuentaId),
      (n) => `${n} ${n === 1 ? "pago asignado" : "pagos asignados"} a ${cuentaPorId.get(cuentaId)?.apodo ?? "la cuenta"}.`
    )
  const quitarAsignacion = () =>
    ejecutar("quitar", () => asignarCuentaDebitar(idsDe(["asignado"]), null), (n) => `Se quitó la asignación de ${n} ${n === 1 ? "pago" : "pagos"}.`)
  const confirmar = () =>
    ejecutar("confirmar", () => confirmarCuentaPagos(idsDe(["confirmar"])), (n) => `${n} ${n === 1 ? "cuenta confirmada" : "cuentas confirmadas"}.`)
  const sacar = () =>
    ejecutar(
      "fuera",
      () => marcarFueraDispersor(idsDe(["listo", "asignado", "confirmar", "bloqueado"]), true),
      (n) => `${n} ${n === 1 ? "pago pasó" : "pagos pasaron"} a Otros pagos pendientes.`
    )
  const devolver = () =>
    ejecutar(
      "devolver",
      () => marcarFueraDispersor(elegidos.filter((p) => p.fueraManual && !p.esPse).map((p) => p.id), false),
      (n) => `${n} ${n === 1 ? "pago volvió" : "pagos volvieron"} al dispersor.`
    )

  async function generar() {
    const ids = tandas.flatMap((g) => g.pagos.map((p) => p.id))
    const n = tandas.length
    if (!window.confirm(`Se van a generar ${n} ${n === 1 ? "dispersor" : "dispersores"} con ${ids.length} pagos por ${formatoMoneda(totalAsignado)}. Los pagos quedan dispersados. ¿Seguir?`)) return
    setOcupado("generar")
    setError(null)
    setAviso(null)
    try {
      const r = await generarDispersores(ids)
      setGeneradas(r)
      setAviso(`Se generaron ${r.length} ${r.length === 1 ? "dispersor" : "dispersores"}. Los pagos quedaron dispersados.`)
      if (ultimos) cargar(ultimos)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron generar los dispersores.")
    } finally {
      setOcupado(null)
    }
  }

  async function abrir(a: ArchivoDispersion) {
    try {
      const url = await enlaceArchivoDispersion(a.ruta)
      window.open(url, "_blank", "noopener")
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abrir el archivo.")
    }
  }

  // ---------------------------------------------------------- columnas

  const seleccionables = puedeGenerar && vista !== "generados" && paso !== 3
  const todosElegidos = visibles.length > 0 && elegidos.length === visibles.length

  const columnas: ColumnaExcel<PagoConEstado>[] = [
    ...(seleccionables
      ? [
          {
            clave: "sel",
            titulo: "",
            ancho: 44,
            fija: true,
            alinear: "center" as const,
            ordenable: false,
            texto: () => "",
            celda: (p: PagoConEstado) =>
              p.estado === "dispersado" || (vista === "otros" && p.esPse) ? null : (
                <Checkbox
                  checked={seleccion.has(p.id)}
                  aria-label="Elegir el pago"
                  onCheckedChange={(v) =>
                    setSeleccion((s) => {
                      const n = new Set(s)
                      if (v) n.add(p.id)
                      else n.delete(p.id)
                      return n
                    })
                  }
                />
              ),
          },
        ]
      : []),
    { clave: "item", titulo: "ITEM", ancho: 70, fija: true, alinear: "center", texto: (p) => p.item, valorOrden: (p) => Number(p.item) },
    {
      clave: "semana",
      titulo: "Semana",
      ancho: 90,
      alinear: "center",
      texto: (p) => (p.semana != null ? `${p.semana} · ${p.anio}` : ""),
      valorOrden: (p) => (p.anio ?? 0) * 100 + (p.semana ?? 0),
    },
    { clave: "consolidado", titulo: "Consolidado", ancho: 140, texto: (p) => p.consolidado },
    { clave: "grupo", titulo: "Grupo empresarial", ancho: 190, texto: (p) => p.grupo },
    { clave: "proyecto", titulo: "Proyecto", ancho: 120, texto: (p) => p.proyecto },
    {
      clave: "beneficiario",
      titulo: "Titular de la cuenta",
      ancho: 260,
      flexible: true,
      texto: (p) => p.beneficiario?.razonSocial ?? p.factura ?? "",
      celda: (p) => (
        <div className="min-w-0">
          <div className="truncate">{p.beneficiario?.razonSocial ?? p.factura ?? <span className="text-muted-foreground/60">Sin tercero</span>}</div>
          {p.beneficiario && (
            <div className="truncate text-xs text-muted-foreground">
              {p.beneficiario.tipoDocumento} {p.beneficiario.numeroDocumento}
              {p.factura && p.factura !== p.beneficiario.razonSocial ? ` · factura ${p.factura}` : ""}
            </div>
          )}
        </div>
      ),
    },
    { clave: "cuenta", titulo: "Cuenta del beneficiario", ancho: 250, texto: (p) => (p.cuenta ? descripcionCuenta(p.cuenta) : "") },
    {
      clave: "valor",
      titulo: "Valor a pagar",
      ancho: 140,
      alinear: "right",
      texto: (p) => formatoMoneda(p.valor),
      valorOrden: (p) => p.valor,
      claseCelda: "tabular-nums font-medium",
    },
    {
      clave: "estado",
      titulo: "Estado",
      ancho: 260,
      texto: (p) => `${ETIQUETA_ESTADO_DISPERSOR[p.estado]}${p.alertas[0] ? `: ${p.alertas[0].mensaje}` : ""}`,
      celda: (p) => (
        <div className="min-w-0" title={p.alertas.map((a) => `${a.mensaje}${a.detalle ? ` (${a.detalle})` : ""}`).join("\n")}>
          <Badge className={`h-6 px-3 text-xs ${COLOR_ESTADO[p.estado]}`}>{ETIQUETA_ESTADO_DISPERSOR[p.estado]}</Badge>
          {p.alertas[0] && p.estado !== "listo" && p.estado !== "asignado" && (
            <div className="truncate text-xs text-muted-foreground">
              {p.alertas[0].mensaje}
              {p.alertas[0].detalle ? ` · ${p.alertas[0].detalle}` : ""}
            </div>
          )}
        </div>
      ),
    },
    {
      clave: "debitar",
      titulo: "Cuenta a debitar",
      ancho: 170,
      texto: (p) => (p.cuentaDebitarId ? cuentaPorId.get(p.cuentaDebitarId)?.apodo ?? "" : p.dispersion?.apodo ?? ""),
    },
    ...(paso === 2 && vista === "dispersar"
      ? [
          {
            clave: "soporte",
            titulo: "Soporte",
            ancho: 100,
            ordenable: false,
            texto: (p: PagoConEstado) => p.dispersion?.soporte?.nombre ?? "",
            celda: (p: PagoConEstado) => {
              const s = p.dispersion?.soporte
              return s ? (
                <Button size="sm" variant="ghost" className="h-8 gap-1 px-2" title={s.nombre} onClick={() => abrir({ ...s, tipo: "application/pdf" })}>
                  <FileText className="h-4 w-4" /> Ver
                </Button>
              ) : null
            },
          },
        ]
      : []),
  ]

  const columnasOtros = columnas.filter((c) => c.clave !== "debitar" && c.clave !== "soporte")

  // ---------------------------------------------------------- render

  const pestanaVista = (v: Vista, titulo: string, n?: number) => (
    <button
      type="button"
      onClick={() => {
        setVista(v)
        setSeleccion(new Set())
      }}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${
        vista === v ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {titulo}
      {n != null && pagos && (
        <Badge variant="secondary" className="h-5 px-1.5 text-xs">
          {n}
        </Badge>
      )}
    </button>
  )

  const botonPaso = (n: Paso, titulo: string, cuantos: number) => (
    <button
      type="button"
      onClick={() => cambiarPaso(n)}
      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
        paso === n ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
      }`}
    >
      <span className="font-semibold">{n}.</span> {titulo}
      <span className={`rounded px-1.5 text-xs ${paso === n ? "bg-primary-foreground/20" : "bg-muted"}`}>{cuantos}</span>
    </button>
  )

  const barraBusqueda = (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-56 flex-1 space-y-1">
        <Label htmlFor="buscar-dispersor" className="text-xs">
          Buscar
        </Label>
        <Input
          id="buscar-dispersor"
          placeholder="ITEM, titular, documento, cuenta o proyecto"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>
      <div className="w-56 space-y-1">
        <Label className="text-xs">Grupo empresarial</Label>
        <Select value={grupo} onValueChange={(v) => setGrupo(v ?? TODOS)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos</SelectItem>
            {grupos.map((g) => (
              <SelectItem key={g} value={g}>
                {g}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )

  const barraSeleccion = seleccionables && visibles.length > 0 && (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
      <Button size="sm" variant="outline" onClick={() => setSeleccion(todosElegidos ? new Set() : new Set(visibles.map((p) => p.id)))}>
        {todosElegidos ? "Quitar selección" : "Elegir todos los de la lista"}
      </Button>
      <span className="text-sm text-muted-foreground">
        {elegidos.length} {elegidos.length === 1 ? "elegido" : "elegidos"}
        {elegidos.length > 0 && ` · ${formatoMoneda(elegidos.reduce((a, p) => a + p.valor, 0))}`}
      </span>
      <div className="flex-1" />
      {vista === "otros" ? (
        <Button size="sm" disabled={ocupado !== null || !elegidos.some((p) => p.fueraManual && !p.esPse)} onClick={devolver}>
          Devolver al dispersor
        </Button>
      ) : paso === 2 ? (
        <>
          <Select
            value={banco}
            onValueChange={(v) => {
              setBanco(v ?? "")
              setCuentaId("")
            }}
          >
            <SelectTrigger className="w-44 bg-background">
              <SelectValue placeholder="Banco a debitar" />
            </SelectTrigger>
            <SelectContent>
              {bancos.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={cuentaId} onValueChange={(v) => setCuentaId(v ?? "")} disabled={!banco}>
            <SelectTrigger className="w-60 bg-background">
              <SelectValue placeholder="Cuenta a debitar" />
            </SelectTrigger>
            <SelectContent>
              {cuentasDelBanco.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.apodo} · {c.tipoCuenta.toLowerCase()} {c.cuenta.slice(-4)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={ocupado !== null || !cuentaId || idsDe(["listo", "asignado"]).length === 0} onClick={asignar}>
            Aplicar
          </Button>
          <Button size="sm" variant="outline" disabled={ocupado !== null || idsDe(["asignado"]).length === 0} onClick={quitarAsignacion}>
            Quitar asignación
          </Button>
          <Button size="sm" variant="outline" disabled={ocupado !== null || idsDe(["listo", "asignado"]).length === 0} onClick={sacar}>
            No van por dispersor
          </Button>
        </>
      ) : (
        <>
          <Button size="sm" disabled={ocupado !== null || idsDe(["confirmar"]).length === 0} onClick={confirmar}>
            Confirmar cuenta del tercero
          </Button>
          <Button size="sm" variant="outline" disabled={ocupado !== null || idsDe(["confirmar", "bloqueado"]).length === 0} onClick={sacar}>
            No van por dispersor
          </Button>
          <Button size="sm" variant="outline" disabled={ocupado !== null || !elegidos.some((p) => p.fueraManual && !p.esPse)} onClick={devolver}>
            Devolver al dispersor
          </Button>
        </>
      )}
      {ocupado && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
    </div>
  )

  const tabla = (filas: PagoConEstado[], cols: ColumnaExcel<PagoConEstado>[], vacio: string) =>
    filas.length === 0 ? (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-10 text-center text-muted-foreground">{vacio}</div>
    ) : (
      <>
        <TablaExcel
          filas={filas}
          columnas={cols}
          claveFila={(p) => p.id}
          claseAltoMax="max-h-[calc(100svh-26rem)]"
          tarjeta={{
            titulo: (p) => p.beneficiario?.razonSocial ?? p.factura ?? "Sin tercero",
            subtitulo: (p) => `ITEM ${p.item} · semana ${p.semana ?? "—"} · ${p.grupo}`,
            esquina: (p) => <Badge className={`h-6 px-3 text-xs ${COLOR_ESTADO[p.estado]}`}>{ETIQUETA_ESTADO_DISPERSOR[p.estado]}</Badge>,
            campos: ["cuenta", "valor", "debitar"],
          }}
        />
        <div className="text-right text-sm text-muted-foreground">
          {filas.length} {filas.length === 1 ? "pago" : "pagos"} · Total{" "}
          <span className="font-medium text-foreground tabular-nums">{formatoMoneda(filas.reduce((a, p) => a + p.valor, 0))}</span>
        </div>
      </>
    )

  const enlaces = (archivos: ArchivoDispersion[]) => (
    <div className="flex flex-wrap gap-1.5">
      {archivos.map((a) => (
        <Button key={a.ruta} size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => abrir(a)}>
          {a.tipo === "application/pdf" ? <FileText className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
          {a.nombre}
        </Button>
      ))}
    </div>
  )

  const paso3 = (
    <div className="flex min-h-0 flex-col gap-3 overflow-auto">
      {generadas && generadas.length > 0 && (
        <div className="space-y-2 rounded-lg border border-green-300 bg-green-50 p-3">
          <p className="text-sm font-medium text-green-900">Archivos generados</p>
          {generadas.map((t) => (
            <div key={t.id} className="space-y-1 rounded-md bg-background p-2">
              <div className="text-sm">
                <span className="font-medium">{t.apodo}</span> · {t.banco} · semana {t.semana ?? "—"}
                {t.esNomina ? " · nómina" : ""} · {t.registros} pagos · {formatoMoneda(t.total)} · secuencia {t.secuencia} · Ronda {t.ronda}
              </div>
              {enlaces([...t.archivos, t.soporte])}
            </div>
          ))}
        </div>
      )}
      {tandas.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          No hay pagos asignados. Asígnales la cuenta a debitar en el paso 2.
        </div>
      ) : (
        <>
          <div className="grid gap-3 @container sm:grid-cols-2 xl:grid-cols-3">
            {tandas.map((g) => {
              const total = g.pagos.reduce((a, p) => a + p.valor, 0)
              const avisos = avisosDispersor(g.cuenta, g.pagos.map(renglonDe))
              return (
                <div key={g.clave} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{g.cuenta.apodo}</div>
                      <div className="text-xs text-muted-foreground">
                        {g.cuenta.banco} · {g.cuenta.tipoCuenta.toLowerCase()} {g.cuenta.cuenta}
                      </div>
                    </div>
                    {g.esNomina && <Badge variant="secondary">Nómina</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {nombreArchivoGrupo(g)} · semana {g.semana ?? "—"} de {g.anio ?? "—"}
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-muted-foreground">
                      {g.pagos.length} {g.pagos.length === 1 ? "pago" : "pagos"}
                    </span>
                    <span className="text-lg font-semibold tabular-nums">{formatoMoneda(total)}</span>
                  </div>
                  {avisos.length > 0 && (
                    <ul className="space-y-1 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
                      {avisos.map((a, i) => (
                        <li key={i} className="flex gap-1">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {a}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3 rounded-lg border bg-muted/40 px-4 py-3">
            <span className="text-sm">
              {tandas.length} {tandas.length === 1 ? "dispersor" : "dispersores"} ·{" "}
              {tandas.reduce((a, g) => a + g.pagos.length, 0)} pagos · Total{" "}
              <span className="font-semibold tabular-nums">{formatoMoneda(totalAsignado)}</span>
            </span>
            {puedeGenerar && (
              <Button disabled={ocupado !== null} onClick={generar}>
                {ocupado === "generar" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {ocupado === "generar" ? "Generando..." : "Generar dispersores"}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )

  const generados = (
    <div className="flex min-h-0 flex-col gap-2 overflow-auto">
      {dispersiones.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          No se han generado dispersores en estas semanas.
        </div>
      ) : (
        dispersiones.map((d) => (
          <div key={d.id} className="space-y-1.5 rounded-lg border p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span>
                <span className="font-medium">{d.apodo}</span> · {d.banco} · semana {d.semana ?? "—"} de {d.anio ?? "—"}
                {d.esNomina ? " · nómina" : ""} · secuencia {d.secuencia} · Ronda {d.ronda}
              </span>
              <span className="tabular-nums">
                {d.registros} pagos · <span className="font-semibold">{formatoMoneda(d.total)}</span>
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              Generado el {formatearFechaHora(d.generadoEn)}
              {d.generadoPor ? ` por ${d.generadoPor}` : ""}
            </div>
            {enlaces([...d.archivos, d.soporte])}
          </div>
        ))
      )}
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex min-h-0 flex-1 gap-4">
        <PanelFiltros
          cargando={cargando}
          onConsultar={handleConsultar}
          onLimpiar={() => {
            setAnios([actual.anio])
            setSemanas([actual.semana])
          }}
          ayuda="Los pagos liquidados de los tres consolidados. Por omisión, la semana actual."
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="anio-dispersor">Años</Label>
              <SelectorNumeros id="anio-dispersor" opciones={opcionesAnios} seleccion={anios} onChange={setAnios} textoTodas="Todos" plural="años" columnas={3} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="semana-dispersor">Semanas</Label>
              <SelectorNumeros
                id="semana-dispersor"
                opciones={opcionesSemanas}
                seleccion={semanas}
                onChange={setSemanas}
                textoTodas="Todas"
                plural="semanas"
                ayuda={anios.length === 1 ? (n) => fechasSemanaIso(anios[0], n) : undefined}
              />
            </div>
          </div>
        </PanelFiltros>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap gap-1 border-b">
            {pestanaVista("dispersar", "Dispersar", conteo.listo + conteo.asignado + conteo.confirmar + conteo.bloqueado)}
            {pestanaVista("otros", "Otros pagos pendientes", conteo.fuera)}
            {pestanaVista("generados", "Dispersores generados", dispersiones.length)}
          </div>

          {error && <div className="whitespace-pre-line rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>}
          {aviso && <div className="rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-800">{aviso}</div>}

          {pagos === null && !cargando ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Elige las semanas y presiona Consultar.
            </div>
          ) : pagos === null ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando pagos...
            </div>
          ) : vista === "generados" ? (
            generados
          ) : vista === "otros" ? (
            <>
              <p className="text-sm text-muted-foreground">
                Pagos por PSE y los que se pagan por otro medio (efectivo u otro). No entran al dispersor.
              </p>
              {barraBusqueda}
              {barraSeleccion}
              {tabla(visibles, columnasOtros, "No hay otros pagos pendientes.")}
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {botonPaso(1, "Preparar", conteo.confirmar + conteo.bloqueado + conteo.fuera)}
                {botonPaso(2, "Asignar", conteo.listo + conteo.asignado)}
                {botonPaso(3, "Confirmar y generar", conteo.asignado)}
              </div>
              {paso === 3 ? (
                paso3
              ) : (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEstado(null)}
                      className={`rounded-full border px-3 py-1 text-xs ${estado === null ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}
                    >
                      Todos
                    </button>
                    {ESTADOS_DEL_PASO[paso].map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => {
                          setEstado(e)
                          setSeleccion(new Set())
                        }}
                        className={`rounded-full border px-3 py-1 text-xs ${estado === e ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}
                      >
                        {ETIQUETA_ESTADO_DISPERSOR[e]} ({conteo[e]})
                      </button>
                    ))}
                  </div>
                  {barraBusqueda}
                  {barraSeleccion}
                  {tabla(visibles, columnas, "Ningún pago en este paso.")}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
