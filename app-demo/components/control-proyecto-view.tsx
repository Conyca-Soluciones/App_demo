"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, ChevronDown, ChevronUp, Eye, Loader2, Search } from "lucide-react"
import { EncabezadoPagina } from "@/components/encabezado-pagina"
import { useProyectoActual } from "@/components/proyecto-provider"
import { SinProyecto } from "@/components/sin-proyecto"
import { Input } from "@/components/ui/input"
import { DetalleSolicitudContrato, tituloTipoContrato } from "@/components/detalle-solicitud-contrato"
import { OrdenCompraDetalleView } from "@/components/orden-compra-detalle-view"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ZONA_HORARIA, hoyColombia } from "@/lib/fechas"
import { Badge } from "@/components/ui/badge"
import { ESTADO_VISIBLE_BADGE } from "@/lib/ordenes-compra-estado"
import {
  buscarInsumosPrecios,
  comparacionPrecio,
  indexarPrecios,
  inicioDeMes,
  partesBarraPlata,
  porcentaje,
  totalesControl,
  type ControlProyecto,
  type OrdenControl,
  type PrecioProveedor,
} from "@/lib/control-proyecto"
import { listarOrdenesControl, obtenerControlProyecto } from "@/app/(app)/admin/visualizacion/actions"
import { CampoFecha } from "@/components/ui/campo-fecha"

// ---------------------------------------------------------------------------
// Control del proyecto: a dónde va la plata del proyecto actual (el de la
// barra de arriba). Pensado primero para celular: cifras en tarjetas, listas en
// renglones (no tablas anchas). Todo sale de control_proyecto (una llamada).
// ---------------------------------------------------------------------------

const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })
const numero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 })

// Millones abreviados para las tarjetas ("$1.234 M"); debajo de un millón, completo.
function pesosCortos(v: number) {
  if (Math.abs(v) < 1_000_000) return pesos.format(v)
  return `$${new Intl.NumberFormat("es-CO", { maximumFractionDigits: Math.abs(v) < 10_000_000 ? 1 : 0 }).format(v / 1_000_000)} M`
}
const pct = (v: number) => `${Math.round(v)} %`
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-CO", { timeZone: ZONA_HORARIA, day: "2-digit", month: "2-digit", year: "numeric" })

const COLOR = {
  compras: "bg-sky-500",
  actas: "bg-emerald-500",
}

type Pestana = "capitulos" | "proveedores" | "contratos" | "ordenes"

export function ControlProyectoView() {
  const { proyecto } = useProyectoActual()
  const proyectoId = proyecto?.id ?? null
  // Resultado con el proyecto al que corresponde: lo de otro proyecto no se
  // muestra (sin setState dentro del efecto, ver CLAUDE.md).
  const [carga, setCarga] = useState<{ proyectoId: string; datos: ControlProyecto | null; error: string | null } | null>(null)
  const vigente = proyectoId != null && carga?.proyectoId === proyectoId ? carga : null
  const datos = vigente?.datos ?? null
  const [pestana, setPestana] = useState<Pestana>("capitulos")

  useEffect(() => {
    if (!proyectoId) return
    let activo = true
    obtenerControlProyecto(proyectoId)
      .then((d: ControlProyecto) => activo && setCarga({ proyectoId, datos: d, error: null }))
      .catch((e) => activo && setCarga({ proyectoId, datos: null, error: e instanceof Error ? e.message : "No se pudo cargar el control del proyecto." }))
    return () => {
      activo = false
    }
  }, [proyectoId])

  return (
    <>
      <EncabezadoPagina titulo="Control del proyecto" subtitulo="Distribución: presupuesto, compras y actas aprobadas, y avance." />
      <main className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
        {!proyecto ? (
          <SinProyecto />
        ) : vigente?.error ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">{vigente.error}</div>
        ) : !datos ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Cargando el control del proyecto...
          </div>
        ) : !datos.tienePresupuesto ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            Este proyecto todavía no tiene presupuesto cargado.
          </div>
        ) : (
          // key: al cambiar de proyecto se limpian búsqueda y desplegados.
          <div key={proyecto.id} className="space-y-5">
            <Resumen datos={datos} />
            <div className="flex gap-1 overflow-x-auto border-b" role="tablist" aria-label="Detalle">
              {(
                [
                  ["capitulos", "Capítulos"],
                  ["proveedores", "Proveedores"],
                  ["contratos", "Contratos"],
                  ["ordenes", "Órdenes de compra"],
                ] as const
              ).map(([valor, etiqueta]) => (
                <button
                  key={valor}
                  type="button"
                  role="tab"
                  aria-selected={pestana === valor}
                  onClick={() => setPestana(valor)}
                  className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
                    pestana === valor ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {etiqueta}
                </button>
              ))}
            </div>
            {pestana === "capitulos" && <Capitulos datos={datos} />}
            {pestana === "proveedores" && <Proveedores datos={datos} />}
            {pestana === "contratos" && <Contratos datos={datos} />}
            {pestana === "ordenes" && <OrdenesCompra proyectoId={proyecto.id} />}
          </div>
        )}
      </main>
    </>
  )
}

// ---------------------------------------------------------------- resumen

function Tarjeta({ etiqueta, valor, detalle, aviso }: { etiqueta: string; valor: string; detalle?: string; aviso?: boolean }) {
  return (
    <div className={`rounded-lg p-3 ${aviso ? "bg-amber-50 text-amber-900" : "bg-muted/50"}`}>
      <p className={`text-xs ${aviso ? "text-amber-800" : "text-muted-foreground"}`}>{etiqueta}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums sm:text-2xl">{valor}</p>
      {detalle && <p className={`mt-0.5 text-xs ${aviso ? "text-amber-800" : "text-muted-foreground"}`}>{detalle}</p>}
    </div>
  )
}

function Leyenda({ color, texto }: { color: string; texto: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`size-2.5 shrink-0 rounded-sm ${color}`} />
      {texto}
    </span>
  )
}

function Resumen({ datos }: { datos: ControlProyecto }) {
  const t = totalesControl(datos)
  const barra = partesBarraPlata(datos)
  const [verSobre, setVerSobre] = useState(false)

  return (
    <section className="space-y-4">
      {datos.itemsSobre.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-900">
          <button type="button" onClick={() => setVerSobre((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
            <AlertTriangle className="size-4 shrink-0" />
            <span className="flex-1 font-medium">
              {datos.itemsSobre.length === 1 ? "1 ítem va" : `${datos.itemsSobre.length} ítems van`} sobre presupuesto
            </span>
            {verSobre ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
          {verSobre && (
            <ul className="divide-y divide-amber-200 border-t border-amber-200">
              {datos.itemsSobre.map((i) => (
                <li key={i.codigo} className="px-3 py-2">
                  <div className="flex justify-between gap-3">
                    <span className="min-w-0">
                      <span className="font-medium tabular-nums">{i.codigo}</span> {i.descripcion}
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">+{pesosCortos(i.exceso)}</span>
                  </div>
                  <p className="text-xs text-amber-800">
                    {i.capitulo} · gastado {pesosCortos(i.gastado)} de {pesosCortos(i.presupuesto)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tarjeta etiqueta="Presupuesto" valor={pesosCortos(datos.presupuesto)} detalle="Versión vigente" />
        <Tarjeta
          etiqueta="Gastado (aprobado)"
          valor={pesosCortos(t.gastado)}
          detalle={`${pct(t.pctGastado)} del presupuesto`}
          aviso={t.pctGastado > 100}
        />
        <Tarjeta
          etiqueta="Avance de bodega"
          valor={pct(t.pctBodega)}
          detalle={`Salió ${pesosCortos(datos.salidasValor)} de ${pesosCortos(datos.presupuestoMateriales)} en materiales`}
        />
        <Tarjeta
          etiqueta="Avance de actas"
          valor={pct(t.pctActas)}
          detalle={
            datos.contratado > 0
              ? `${pesosCortos(datos.actasContratadas)} en actas (bruto) de ${pesosCortos(datos.contratado)} contratado`
              : "Sin contratos aprobados"
          }
        />
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-medium">Distribución</h2>
        <div className="flex h-4 overflow-hidden rounded bg-muted" aria-hidden="true">
          <div className={COLOR.compras} style={{ width: `${barra.compras}%` }} />
          <div className={COLOR.actas} style={{ width: `${barra.actas}%` }} />
        </div>
        <div className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
          <Leyenda color={COLOR.compras} texto={`Compras ${pesosCortos(datos.compras)}`} />
          <Leyenda color={COLOR.actas} texto={`Actas (bruto) ${pesosCortos(datos.actas)}`} />
          <Leyenda color="bg-muted-foreground/20" texto={`Disponible ${pesosCortos(t.disponible)}`} />
        </div>
        <p className="text-xs text-muted-foreground">
          Compras = órdenes de compra aprobadas (con IVA){datos.excedentes > 0 && `; de eso, ${pesosCortos(datos.excedentes)} son excedentes de compras`}.
          Actas = valor bruto de las actas aprobadas, antes de descuentos (anticipo, retención en garantía, retenciones); en A&F el pago es el neto. Disponible = presupuesto − compras − actas aprobadas (las requisiciones sin orden de compra no se descuentan).
          {datos.presupuestoManoObra > 0 && ` Contratado: ${pct(t.pctContratadoMo)} del presupuesto de mano de obra.`}
          {barra.sobrepasa && " Lo gastado ya supera el presupuesto."}
        </p>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- capítulos

function Capitulos({ datos }: { datos: ControlProyecto }) {
  const capitulos = useMemo(() => [...datos.capitulos].sort((a, b) => b.compras + b.actas - (a.compras + a.actas) || a.codigo.localeCompare(b.codigo, "es", { numeric: true })), [datos.capitulos])
  return (
    <section className="space-y-1">
      <ul className="divide-y rounded-lg border">
        {capitulos.map((c) => {
          const gastado = c.compras + c.actas
          const p = porcentaje(gastado, c.presupuesto)
          const pasado = gastado > c.presupuesto && gastado > 0
          return (
            <li key={c.id} className="px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 font-medium">
                  <span className="tabular-nums">{c.codigo}</span> · {c.descripcion}
                </span>
                <span className={`shrink-0 tabular-nums ${pasado ? "font-medium text-amber-700" : ""}`}>{pct(p)}</span>
              </div>
              <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div className={COLOR.compras} style={{ width: `${Math.min(porcentaje(c.compras, Math.max(c.presupuesto, gastado)), 100)}%` }} />
                <div className={COLOR.actas} style={{ width: `${Math.min(porcentaje(c.actas, Math.max(c.presupuesto, gastado)), 100)}%` }} />
              </div>
              <p className={`mt-1 text-xs ${pasado ? "text-amber-700" : "text-muted-foreground"}`}>
                {pesosCortos(gastado)} de {pesosCortos(c.presupuesto)}
                {gastado > 0 && ` · compras ${pesosCortos(c.compras)} · actas ${pesosCortos(c.actas)}`}
              </p>
            </li>
          )
        })}
      </ul>
      {datos.sinItem > 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          {pesosCortos(datos.sinItem)} de lo gastado viene de ítems que ya no están en la versión vigente del presupuesto.
        </p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- proveedores

const CLASE_PRECIO = {
  debajo: "bg-emerald-100 text-emerald-800",
  encima: "bg-amber-100 text-amber-800",
  sin_referencia: "bg-muted text-foreground",
}

function PrecioChip({ p }: { p: PrecioProveedor }) {
  const c = comparacionPrecio(p.precioPromedio, p.precioPresupuesto)
  return (
    <span
      className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium tabular-nums ${CLASE_PRECIO[c]}`}
      title={p.precioPresupuesto ? `Presupuesto: ${pesos.format(p.precioPresupuesto)}` : "Sin precio en el presupuesto"}
    >
      {pesos.format(p.precioPromedio)}
    </span>
  )
}

const PRIMEROS_PROVEEDORES = 5

function Proveedores({ datos }: { datos: ControlProyecto }) {
  const [busqueda, setBusqueda] = useState("")
  const [verTodos, setVerTodos] = useState(false)
  const [abierto, setAbierto] = useState<string | null>(null)
  const indice = useMemo(() => indexarPrecios(datos.precios), [datos.precios])
  const nombreProveedor = useMemo(() => new Map(datos.proveedores.map((p) => [p.id, p.nombre])), [datos.proveedores])
  const encontrados = useMemo(() => buscarInsumosPrecios(indice.porInsumo, busqueda), [indice, busqueda])
  const buscando = busqueda.trim().length >= 2

  if (datos.proveedores.length === 0) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Todavía no hay órdenes de compra aprobadas.</p>
  }

  const maximo = datos.proveedores[0]?.total ?? 0
  const visibles = verTodos ? datos.proveedores : datos.proveedores.slice(0, PRIMEROS_PROVEEDORES)
  const resto = datos.proveedores.slice(PRIMEROS_PROVEEDORES)
  const totalResto = resto.reduce((s, p) => s + p.total, 0)

  return (
    <section className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar insumo (cemento, acero...)" className="pl-8" />
      </div>

      {buscando ? (
        encontrados.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Ningún insumo comprado coincide con “{busqueda.trim()}”.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Precio promedio de lo comprado a cada proveedor, sin IVA. Verde: igual o por debajo del presupuesto; ámbar: por encima.
            </p>
            {encontrados.map((i) => (
              <div key={i.insumoId} className="rounded-lg border px-3 py-2.5">
                <p className="text-sm font-medium">{i.descripcion}</p>
                <p className="text-xs text-muted-foreground">
                  {i.precioPresupuesto ? `Presupuesto ${pesos.format(i.precioPresupuesto)}` : "Sin precio en el presupuesto"}
                  {i.um && ` / ${i.um}`} · {numero.format(i.cantidad)} comprados
                </p>
                <ul className="mt-1.5 divide-y">
                  {i.proveedores.map((p) => (
                    <li key={p.proveedorId} className="flex items-center justify-between gap-3 py-1.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{nombreProveedor.get(p.proveedorId) ?? "(proveedor)"}</p>
                        <p className="text-xs text-muted-foreground">
                          {numero.format(p.cantidad)} · última {p.ultima ? fecha(p.ultima) : "—"}
                        </p>
                      </div>
                      <PrecioChip p={p} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {datos.proveedores.length} {datos.proveedores.length === 1 ? "proveedor" : "proveedores"} · {pesosCortos(datos.compras)} aprobado. Toca uno
            para ver sus insumos.
          </p>
          <ul className="divide-y rounded-lg border">
            {visibles.map((p) => {
              const abiertoEste = abierto === p.id
              const insumos = indice.porProveedor.get(p.id) ?? []
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setAbierto(abiertoEste ? null : p.id)}
                    aria-expanded={abiertoEste}
                    className="w-full px-3 py-2.5 text-left hover:bg-muted/40"
                  >
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate font-medium">{p.nombre}</span>
                      <span className="shrink-0 tabular-nums">{pesosCortos(p.total)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <div className={`h-full ${COLOR.compras}`} style={{ width: `${porcentaje(p.total, maximo)}%` }} />
                    </div>
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      {p.insumos} {p.insumos === 1 ? "insumo" : "insumos"} · {p.ordenes} {p.ordenes === 1 ? "orden" : "órdenes"}
                      {abiertoEste ? <ChevronUp className="ml-auto size-4" /> : <ChevronDown className="ml-auto size-4" />}
                    </p>
                  </button>
                  {abiertoEste && (
                    <ul className="divide-y border-t bg-muted/20 px-3">
                      {insumos.map((i) => (
                        <li key={i.insumoId} className="flex items-center justify-between gap-3 py-1.5">
                          <div className="min-w-0">
                            <p className="truncate text-sm">{i.descripcion}</p>
                            <p className="text-xs text-muted-foreground">
                              {numero.format(i.cantidad)}
                              {i.um && ` ${i.um}`} · {pesosCortos(i.valor)}
                            </p>
                          </div>
                          <PrecioChip p={i} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
            {resto.length > 0 && (
              <li>
                <button
                  type="button"
                  onClick={() => setVerTodos((v) => !v)}
                  className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm text-muted-foreground hover:bg-muted/40"
                >
                  <span>{verTodos ? "Ver menos" : `${resto.length} más`}</span>
                  <span className="flex items-center gap-1 tabular-nums">
                    {!verTodos && pesosCortos(totalResto)}
                    {verTodos ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                  </span>
                </button>
              </li>
            )}
          </ul>
        </>
      )}

    </section>
  )
}

// ---------------------------------------------------------------- contratos

function Contratos({ datos }: { datos: ControlProyecto }) {
  const [viendo, setViendo] = useState<string | null>(null)
  if (datos.contratos.length === 0) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Este proyecto no tiene contratos aprobados.</p>
  }
  return (
    <>
      <ul className="divide-y rounded-lg border">
        {datos.contratos.map((c) => {
          const p = porcentaje(c.actasAprobadas, c.valor)
          return (
            <li key={c.id} className="px-3 py-2.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 font-medium">{c.numeroContrato ?? `Solicitud N° ${c.numero}`}</span>
                <span className="ml-auto shrink-0 tabular-nums">{pesosCortos(c.valor)}</span>
                <Button size="sm" variant="outline" onClick={() => setViendo(c.id)}>
                  <Eye className="size-4" /> Ver
                </Button>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {c.contratista} · {tituloTipoContrato(c.tipo)}
                {!c.minutaAprobada && " · minuta sin aprobar"}
              </p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div className={`h-full ${COLOR.actas}`} style={{ width: `${Math.min(p, 100)}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Actas aprobadas (bruto) {pesosCortos(c.actasAprobadas)} ({pct(p)}) · saldo {pesosCortos(Math.max(c.valor - c.actasAprobadas, 0))}
                {c.actasPorAprobar > 0 && ` · ${pesosCortos(c.actasPorAprobar)} por aprobar`}
              </p>
            </li>
          )
        })}
      </ul>
      <DetalleSolicitudContrato id={viendo} onCerrar={() => setViendo(null)} resumen />
    </>
  )
}

// ---------------------------------------------------------------- órdenes de compra

// Órdenes del proyecto en un rango de fechas (por defecto, el mes en curso).
// Se consultan al pulsar Consultar (no en cada cambio de fecha).
function OrdenesCompra({ proyectoId }: { proyectoId: string }) {
  const hoy = hoyColombia()
  const [desde, setDesde] = useState(inicioDeMes(hoy))
  const [hasta, setHasta] = useState(hoy)
  // Resultado con el rango para el que se pidió ("cargando" = aún no llega).
  const [consulta, setConsulta] = useState<{ clave: string; ordenes: OrdenControl[] | null; error: string | null } | null>(null)
  const [pedida, setPedida] = useState(`${inicioDeMes(hoy)}|${hoy}`)
  const [abierta, setAbierta] = useState<string | null>(null)
  const vigente = consulta?.clave === pedida ? consulta : null

  useEffect(() => {
    const [d, h] = pedida.split("|")
    let activo = true
    listarOrdenesControl(proyectoId, d, h)
      .then((ordenes: OrdenControl[]) => activo && setConsulta({ clave: pedida, ordenes, error: null }))
      .catch((e) => activo && setConsulta({ clave: pedida, ordenes: null, error: e instanceof Error ? e.message : "No se pudieron cargar las órdenes." }))
    return () => {
      activo = false
    }
  }, [proyectoId, pedida])

  const ordenes = vigente?.ordenes ?? null
  const aprobadas = ordenes?.filter((o) => o.estado === "aprobada") ?? []
  const totalAprobado = aprobadas.reduce((s, o) => s + o.total, 0)

  return (
    <section className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setPedida(`${desde}|${hasta}`)
        }}
      >
        <label className="space-y-1 text-xs text-muted-foreground">
          Desde
          <CampoFecha value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} contenedorClassName="w-40" />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Hasta
          <CampoFecha value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} contenedorClassName="w-40" />
        </label>
        <button
          type="submit"
          disabled={!desde || !hasta || desde > hasta}
          className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Consultar
        </button>
      </form>

      {vigente?.error ? (
        <p className="text-sm text-destructive">{vigente.error}</p>
      ) : !ordenes ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" /> Cargando órdenes...
        </div>
      ) : ordenes.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No hay órdenes de compra en esas fechas.</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {ordenes.length} {ordenes.length === 1 ? "orden" : "órdenes"} · {aprobadas.length} {aprobadas.length === 1 ? "aprobada" : "aprobadas"} por{" "}
            <span className="font-medium text-foreground">{pesos.format(totalAprobado)}</span> (con IVA)
          </p>
          <ul className="divide-y rounded-lg border">
            {ordenes.map((o) => {
              const badge = ESTADO_VISIBLE_BADGE[o.estado]
              return (
                <li key={o.id}>
                  <div className="px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate font-medium">
                        OC {o.numero} · {o.proveedor}
                      </span>
                      <span className={`ml-auto shrink-0 tabular-nums ${o.estado === "aprobada" ? "" : "text-muted-foreground"}`}>{pesos.format(o.total)}</span>
                      <Button size="sm" variant="outline" onClick={() => setAbierta(o.id)}>
                        <Eye className="size-4" /> Ver
                      </Button>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{fecha(o.fecha)}</span>
                      <span>· {o.lineas} {o.lineas === 1 ? "línea" : "líneas"}</span>
                      <Badge variant="outline" className={`ml-auto ${badge.clase}`}>
                        {badge.label}
                      </Badge>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
      {/* El mismo detalle que en Órdenes de compra, en un diálogo encima. */}
      <Dialog open={abierta !== null} onOpenChange={(abiertoDialogo) => !abiertoDialogo && setAbierta(null)}>
        <DialogContent className="flex h-[90vh] w-[calc(100vw-1rem)] max-w-none flex-col overflow-hidden sm:w-[90vw] sm:max-w-none">
          <DialogTitle className="sr-only">Detalle de orden de compra</DialogTitle>
          {abierta && <OrdenCompraDetalleView ordenId={abierta} onCerrar={() => setAbierta(null)} />}
        </DialogContent>
      </Dialog>
    </section>
  )
}
