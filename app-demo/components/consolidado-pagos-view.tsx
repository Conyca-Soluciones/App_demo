"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Download, FileText, Loader2, Paperclip, Send, Upload } from "lucide-react"
import * as XLSX from "xlsx"
import { HistorialDialog } from "@/components/historial-timeline"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { BuscadorAsync, type OpcionBuscador } from "@/components/buscador-async"
import { PanelFiltros } from "@/components/panel-filtros"
import { PaginacionSimple } from "@/components/paginacion-simple"
import { SelectorNumeros } from "@/components/selector-numeros"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { AYUDA_DOBLE_CLIC, camposDesdeColumnas } from "@/components/ventana-detalle"
import { DetalleOrigenPago } from "@/components/detalle-origen-pago"
import { EtiquetaEtapa, VentanaPagoLiquidacion } from "@/components/ventana-pago-liquidacion"
import { descargarExcelLiquidacion, leerFilasLiquidacion, type AvisoFilaLiquidacion, type ErrorFilaLiquidacion } from "@/lib/excel-liquidacion"
import {
  asignarTerceroPago,
  buscarTercerosParaPago,
  conteoEtapasConsolidado,
  cuentasDeTercero,
  enviarFiltradosALiquidar,
  enviarPagosALiquidar,
  liquidarPagos,
  listarConsolidado,
  obtenerAlertasConsolidado,
  pagosParaExcelLiquidacion,
  reintentarPagos,
  type AlertasConsolidado,
  type CuentaOpcion,
} from "@/app/(app)/ayf/consolidado/actions"
import {
  CONSOLIDADOS,
  ETAPAS_CONSOLIDADO,
  ETIQUETA_ESTADO_PAGO,
  anticiposOrigen,
  formatoMoneda,
  fechasSemanaIso,
  rutaSoporteDispersor,
  rutaSoportePago,
  semanaIso,
  semanasDelAnio,
  type ClaveConsolidado,
  type ConteoEtapas,
  type EstadoPago,
  type EtapaConsolidado,
  type FiltrosConsolidado,
  type Pago,
  type ResultadoLiquidacion,
  type SoportePago,
} from "@/lib/pagos"

const ESTADOS_FILTRO: EstadoPago[] = ["aprobado", "en_dispersion", "dispersado", "anulado"]

async function buscarTercerosAdaptado(termino: string): Promise<OpcionBuscador[]> {
  const r = await buscarTercerosParaPago(termino)
  return r.map((t) => ({ id: t.id, etiqueta: t.nombre, subetiqueta: t.documento }))
}

// Columna de pesos: vacía si no hay valor y en gris si es cero.
function columnaPesos(clave: string, titulo: string, valor: (p: Pago) => number | null, fuerte = false): ColumnaExcel<Pago> {
  return {
    clave,
    titulo,
    ancho: fuerte ? 150 : 130,
    alinear: "right",
    texto: (p) => {
      const v = valor(p)
      return v == null ? "" : formatoMoneda(v)
    },
    valorOrden: (p) => valor(p) ?? -1,
    celda: (p) => {
      const v = valor(p)
      if (v == null) return <span className="text-muted-foreground/60">—</span>
      return <span className={fuerte ? "font-medium" : v === 0 ? "text-muted-foreground" : undefined}>{formatoMoneda(v)}</span>
    },
    claseCelda: "tabular-nums",
  }
}

const valorAPagarDe = (p: Pago) => p.valorAPagar ?? p.valor

type ReporteSubida = {
  liquidados: number
  observados: number
  sinCambios: number
  sinTocar: number
  errores: (ErrorFilaLiquidacion | { fila: number | null; item: string; mensaje: string })[]
  avisos: AvisoFilaLiquidacion[]
}

// Un consolidado por pestaña: la pantalla no nombra a los demás (quien solo
// tiene uno no debe saber que existen) y la base solo le da sus pagos. Cada
// pago pasa por etapas (20261215000000): Financiera lo prepara y lo envía a
// liquidar, Contabilidad lo liquida (aquí o con el Excel) u lo observa, y
// Financiera responde. Una pestaña por etapa, con sus columnas.
export function ConsolidadoPagosView({
  clave,
  puedeGestionar,
  puedeLiquidar,
}: {
  clave: ClaveConsolidado
  puedeGestionar: boolean
  puedeLiquidar: boolean
}) {
  const titulo = CONSOLIDADOS.find((c) => c.clave === clave)?.titulo ?? "Consolidado"
  // null = todavía no se consultó: no se muestra nada hasta presionar Consultar.
  const [pagos, setPagos] = useState<Pago[] | null>(null)
  const [soportes, setSoportes] = useState<Record<string, SoportePago>>({})
  // pago dispersado -> nombre del soporte individual de su dispersor
  const [dispersores, setDispersores] = useState<Record<string, string>>({})
  const [conteo, setConteo] = useState<ConteoEtapas | null>(null)
  const [cargando, setCargando] = useState(false)
  const [pagina, setPagina] = useState(0)
  const [hayMas, setHayMas] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ultimosFiltros, setUltimosFiltros] = useState<FiltrosConsolidado | null>(null)
  // Contabilidad entra directo a lo suyo.
  const [etapa, setEtapa] = useState<EtapaConsolidado>(puedeLiquidar && !puedeGestionar ? "por_liquidar" : "preparacion")
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())

  const actual = semanaIso()
  const [anios, setAnios] = useState<number[]>([actual.anio])
  const [semanas, setSemanas] = useState<number[]>([actual.semana])
  const [estado, setEstado] = useState<EstadoPago | "todos">("todos")
  const [tercero, setTercero] = useState("")
  const [soloConNovedad, setSoloConNovedad] = useState(false)

  const [resolviendo, setResolviendo] = useState<Pago | null>(null)
  const [historialDe, setHistorialDe] = useState<Pago | null>(null)
  const [origenDe, setOrigenDe] = useState<Pago | null>(null)
  const [indiceViendo, setIndiceViendo] = useState<number | null>(null)
  const [alertas, setAlertas] = useState<AlertasConsolidado | null>(null)
  const [reintentando, setReintentando] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [reporte, setReporte] = useState<ReporteSubida | null>(null)
  const archivoRef = useRef<HTMLInputElement>(null)

  function cargarAlertas() {
    obtenerAlertasConsolidado(clave)
      .then((a: AlertasConsolidado) => setAlertas(a))
      .catch(() => setAlertas(null))
  }

  useEffect(() => {
    cargarAlertas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  const opcionesAnios = useMemo(() => {
    const lista: number[] = []
    for (let y = actual.anio; y >= Math.min(2026, actual.anio); y--) lista.push(y)
    return lista
  }, [actual.anio])
  const totalSemanas = anios.length === 1 ? semanasDelAnio(anios[0]) : 53
  const opcionesSemanas = useMemo(() => Array.from({ length: totalSemanas }, (_, i) => i + 1), [totalSemanas])

  function cargar(filtros: FiltrosConsolidado, pag: number, conConteo = true) {
    setUltimosFiltros(filtros)
    setCargando(true)
    setError(null)
    setSeleccion(new Set())
    listarConsolidado(clave, filtros, pag)
      .then((r: { pagos: Pago[]; hayMas: boolean; soportes: Record<string, SoportePago>; dispersores: Record<string, string> }) => {
        setPagos(r.pagos)
        setSoportes(r.soportes)
        setDispersores(r.dispersores)
        setPagina(pag)
        setHayMas(r.hayMas)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar el consolidado."))
      .finally(() => setCargando(false))
    if (conConteo) {
      conteoEtapasConsolidado(clave, filtros)
        .then((c: ConteoEtapas) => setConteo(c))
        .catch(() => setConteo(null))
    }
  }

  function filtrosDelPanel(): FiltrosConsolidado {
    return {
      anios: anios.length === 0 ? undefined : anios,
      semanas: semanas.length === 0 ? undefined : semanas,
      estado: estado === "todos" ? undefined : estado,
      tercero: tercero.trim() || undefined,
      soloConNovedad: soloConNovedad || undefined,
      etapa,
    }
  }

  function handleConsultar(): boolean {
    setAviso(null)
    cargar(filtrosDelPanel(), 0)
    return true
  }

  function cambiarEtapa(e: EtapaConsolidado) {
    setEtapa(e)
    if (ultimosFiltros) cargar({ ...ultimosFiltros, etapa: e }, 0, false)
  }

  function recargar() {
    if (ultimosFiltros) cargar(ultimosFiltros, pagina)
  }

  function limpiar() {
    setAnios([actual.anio])
    setSemanas([actual.semana])
    setEstado("todos")
    setTercero("")
    setSoloConNovedad(false)
  }

  // Un pago cambió en la ventana: se actualiza la fila (sigue en la lista
  // aunque ya no sea de esta etapa, para no perder el lugar) y el conteo.
  function cambioDePago(p: Pago) {
    setPagos((lista) => (lista ? lista.map((x) => (x.id === p.id ? p : x)) : lista))
    if (ultimosFiltros) {
      conteoEtapasConsolidado(clave, ultimosFiltros)
        .then((c: ConteoEtapas) => setConteo(c))
        .catch(() => undefined)
    }
  }

  const pagosQueSuman = pagos ? pagos.filter((p) => p.estado !== "anulado" && p.estado !== "rechazado") : []
  const totalPagina = pagosQueSuman.reduce((acc, p) => acc + valorAPagarDe(p), 0)

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
      recargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo reintentar.")
    } finally {
      setReintentando(false)
    }
  }

  async function correr(etiqueta: string, paso: () => Promise<string | null>) {
    setOcupado(etiqueta)
    setError(null)
    setAviso(null)
    try {
      const m = await paso()
      if (m) setAviso(m)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar.")
    } finally {
      setOcupado(null)
    }
  }

  const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

  // ------------------------------------------------------------ acciones en lote
  const enviarSeleccionados = () =>
    correr("enviar", async () => {
      const n = await enviarPagosALiquidar([...seleccion])
      recargar()
      return `${plural(n, "pago enviado", "pagos enviados")} a liquidar.`
    })

  const enviarFiltrados = () =>
    correr("enviar_todos", async () => {
      if (!ultimosFiltros) return null
      if (!window.confirm(`¿Enviar a liquidar los ${conteo?.preparacion ?? ""} pagos en preparación de estos filtros?`)) return null
      const n = await enviarFiltradosALiquidar(clave, ultimosFiltros)
      recargar()
      return `${plural(n, "pago enviado", "pagos enviados")} a liquidar.`
    })

  const sinRetencionesSeleccionados = () =>
    correr("sin", async () => {
      const r = await liquidarPagos(
        [...seleccion].map((id) => ({
          pagoId: id,
          base: null,
          iva: null,
          retefuente: null,
          reteiva: null,
          reteica: null,
          asumidas: null,
          liquidaciones: null,
          anticiposDescuentos: null,
          valorAPagar: null,
          sinRetenciones: true,
          comentario: null,
        }))
      )
      recargar()
      const malos = r.filter((x) => x.resultado === "error")
      return `${plural(r.filter((x) => x.resultado === "liquidado").length, "pago liquidado", "pagos liquidados")} sin retenciones.${
        malos.length ? ` ${plural(malos.length, "no se pudo", "no se pudieron")}: ${malos[0].mensaje}` : ""
      }`
    })

  const descargarExcel = () =>
    correr("excel", async () => {
      if (!ultimosFiltros) return null
      const lista = await pagosParaExcelLiquidacion(clave, ultimosFiltros)
      if (lista.length === 0) return "No hay pagos enviados a liquidar con estos filtros."
      await descargarExcelLiquidacion(lista, titulo)
      return null
    })

  async function subirExcel(archivo: File) {
    await correr("subir", async () => {
      const libro = XLSX.read(await archivo.arrayBuffer(), { type: "array" })
      const hoja = libro.Sheets[libro.SheetNames[0]]
      const filas = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, defval: null })
      const leido = leerFilasLiquidacion(filas)
      // ITEM y fila de cada pago, para el reporte.
      const filaDe = new Map<string, number>()
      const itemDe = new Map<string, string>()
      const iId = (filas.find((f) => (f ?? []).some((c) => String(c ?? "").toLowerCase().startsWith("id interno"))) ?? []).findIndex((c) =>
        String(c ?? "").toLowerCase().startsWith("id interno")
      )
      filas.forEach((f, i) => {
        const id = f?.[iId]
        if (id) {
          filaDe.set(String(id), i + 1)
          itemDe.set(String(id), String(f?.[0] ?? ""))
        }
      })
      const resultados: ResultadoLiquidacion[] = leido.filas.length > 0 ? await liquidarPagos(leido.filas) : []
      const cuenta = (r: ResultadoLiquidacion["resultado"]) => resultados.filter((x) => x.resultado === r).length
      setReporte({
        liquidados: cuenta("liquidado"),
        observados: cuenta("observado"),
        sinCambios: cuenta("sin_cambios"),
        sinTocar: leido.sinTocar,
        errores: [
          ...leido.errores,
          ...resultados
            .filter((x) => x.resultado === "error")
            .map((x) => ({ fila: filaDe.get(x.pagoId) ?? null, item: itemDe.get(x.pagoId) ?? "", mensaje: x.mensaje ?? "No se pudo guardar." })),
        ],
        avisos: leido.avisos,
      })
      recargar()
      return null
    })
  }

  // ------------------------------------------------------------ columnas
  const enPreparacion = etapa === "preparacion"
  const enLiquidacion = etapa === "por_liquidar" || etapa === "observado"
  const conSeleccion = (enPreparacion && puedeGestionar) || (enLiquidacion && puedeLiquidar)
  const seleccionables = (pagos ?? []).filter((p) =>
    enPreparacion ? p.estado === "aprobado" && p.liquidacionEstado == null : p.estado === "aprobado" && (p.liquidacionEstado === "por_liquidar" || p.liquidacionEstado === "observado")
  )
  const idsSeleccionables = new Set(seleccionables.map((p) => p.id))

  const colSeleccion: ColumnaExcel<Pago> = {
    clave: "sel",
    titulo: "",
    ancho: 44,
    fija: true,
    alinear: "center",
    ordenable: false,
    texto: () => "",
    celda: (p) =>
      idsSeleccionables.has(p.id) ? (
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
      ) : null,
  }
  const colItem: ColumnaExcel<Pago> = { clave: "item", titulo: "ITEM", ancho: 70, fija: true, alinear: "center", texto: (p) => (p.item != null ? String(p.item) : "") }
  const colSemana: ColumnaExcel<Pago> = {
    clave: "semana",
    titulo: "Semana",
    ancho: 90,
    alinear: "center",
    texto: (p) => (p.semana != null ? `${p.semana} · ${p.anio}` : ""),
    claseCelda: "tabular-nums",
  }
  const colEmpresa: ColumnaExcel<Pago> = { clave: "empresa", titulo: "Grupo empresarial", ancho: 200, texto: (p) => p.empresaNombre ?? "" }
  const colFactura: ColumnaExcel<Pago> = {
    clave: "tercero",
    titulo: "Empresa que factura",
    ancho: 260,
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
  }
  const colCuenta: ColumnaExcel<Pago> = {
    clave: "cuenta",
    titulo: "Titular y cuenta",
    ancho: 250,
    texto: (p) => (p.cuentaTexto ? `${p.cuentaTitular ? `Titular: ${p.cuentaTitular} · ` : ""}${p.cuentaTexto}` : ""),
    celda: (p) => (
      <div className="min-w-0">
        <div className="truncate text-xs text-muted-foreground" title={p.cuentaTitular ?? p.terceroNombre ?? undefined}>
          {p.cuentaTitular ?? p.terceroNombre ?? ""}
        </div>
        <div className={`truncate ${p.cuentaTexto && !p.cuentaVerificada ? "text-amber-700" : ""}`} title={p.cuentaTexto ?? undefined}>
          {p.cuentaTexto ?? <span className="text-muted-foreground/60">Sin cuenta</span>}
          {p.cuentaTexto && !p.cuentaVerificada && " (sin verificar)"}
        </div>
      </div>
    ),
  }
  const colSolicita: ColumnaExcel<Pago> = { clave: "solicita", titulo: "Solicitante", ancho: 170, texto: (p) => p.solicitadoPorNombre ?? "" }
  const colOrigen: ColumnaExcel<Pago> = { clave: "origen", titulo: "Origen", ancho: 170, texto: (p) => p.origen }
  const colProyecto: ColumnaExcel<Pago> = { clave: "proyecto", titulo: "Proyecto", ancho: 150, texto: (p) => p.proyectoCodigo ?? p.proyectoNombre ?? "" }
  const colDocumento = columnaPesos("documento", "Valor documento", (p) => p.valorDocumento ?? p.valor)
  const colValorAPagar = columnaPesos("valor", "Valor a pagar", (p) => (enLiquidacion || etapa === "liquidado" || etapa === "dispersado" ? p.valorAPagar : valorAPagarDe(p)), true)
  const colEtapa: ColumnaExcel<Pago> = {
    clave: "etapa",
    titulo: "Etapa",
    ancho: 130,
    alinear: "center",
    texto: (p) => (p.estado === "aprobado" ? "" : ETIQUETA_ESTADO_PAGO[p.estado]),
    celda: (p) => <EtiquetaEtapa pago={p} />,
  }
  const colComentarios: ColumnaExcel<Pago> = {
    clave: "comentarios",
    titulo: "Comentarios",
    ancho: 240,
    ordenable: false,
    texto: (p) => p.ultimoComentario?.texto ?? "",
    celda: (p) =>
      p.ultimoComentario ? (
        <div className="min-w-0" title={p.ultimoComentario.texto}>
          <div className={`truncate ${p.ultimoComentario.tipo === "observacion" ? "text-red-700" : ""}`}>{p.ultimoComentario.texto}</div>
          <div className="truncate text-xs text-muted-foreground">
            {p.ultimoComentario.autor ?? ""}
            {p.ultimoComentario.total > 1 ? ` · ${p.ultimoComentario.total} comentarios` : ""}
          </div>
        </div>
      ) : (
        <span className="text-muted-foreground/60">—</span>
      ),
  }
  const colSoporte: ColumnaExcel<Pago> = {
    clave: "soporte",
    titulo: "Soporte",
    ancho: 100,
    ordenable: false,
    texto: (p) => soportes[p.id]?.nombre ?? "",
    celda: (p) =>
      soportes[p.id] ? (
        <a
          href={rutaSoportePago(p.id)}
          target="_blank"
          rel="noreferrer"
          title={soportes[p.id].nombre}
          className={buttonVariants({ size: "sm", variant: "ghost", className: "h-8 gap-1 px-2" })}
        >
          <Paperclip className="h-4 w-4" /> Ver
        </a>
      ) : (
        <span className="text-muted-foreground/60">—</span>
      ),
  }
  const colDispersor: ColumnaExcel<Pago> = {
    clave: "dispersor",
    titulo: "Dispersor",
    ancho: 100,
    ordenable: false,
    texto: (p) => dispersores[p.id] ?? "",
    celda: (p) =>
      dispersores[p.id] ? (
        <a
          href={rutaSoporteDispersor(p.id)}
          target="_blank"
          rel="noreferrer"
          title={dispersores[p.id]}
          className={buttonVariants({ size: "sm", variant: "ghost", className: "h-8 gap-1 px-2" })}
        >
          <FileText className="h-4 w-4" /> Ver
        </a>
      ) : (
        <span className="text-muted-foreground/60">—</span>
      ),
  }
  const colsLiquidacion: ColumnaExcel<Pago>[] = [
    columnaPesos("base", "Base", (p) => p.liqBase ?? p.baseGravable),
    columnaPesos("iva", "IVA", (p) => p.liqIva ?? p.iva),
    columnaPesos("retefuente", "Retefuente", (p) => p.retefuente),
    columnaPesos("reteiva", "Retención de IVA", (p) => p.reteiva),
    columnaPesos("reteica", "Retención de ICA", (p) => p.reteica),
    columnaPesos("asumidas", "Asumidas", (p) => p.asumidas),
    columnaPesos("liquidaciones", "Liquidaciones", (p) => p.liquidaciones),
    columnaPesos("anticipos", "Anticipos y/o descuentos", (p) => p.liqAnticiposDescuentos ?? anticiposOrigen(p)),
  ]

  const base = [colItem, colSemana, colEmpresa, colFactura]
  const columnas: ColumnaExcel<Pago>[] = [
    ...(conSeleccion ? [colSeleccion] : []),
    ...(enPreparacion
      ? [...base, colDocumento, colSolicita, colOrigen, colComentarios, colSoporte]
      : enLiquidacion
        ? [...base, colDocumento, colSolicita, ...colsLiquidacion, colValorAPagar, colComentarios, colSoporte]
        : etapa === "liquidado"
          ? [...base, colCuenta, colValorAPagar, colComentarios, colSoporte]
          : etapa === "dispersado"
            ? [...base, colCuenta, colValorAPagar, colComentarios, colSoporte, colDispersor]
          : [...base, colCuenta, colOrigen, colProyecto, colSolicita, colDocumento, colValorAPagar, colEtapa, colSoporte]),
  ]
  const camposTarjeta = columnas.map((c) => c.clave).filter((c) => !["sel", "item", "semana", "empresa", "tercero"].includes(c))
  const pagoOrigen = origenDe

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex min-h-0 flex-1 gap-4">
        <PanelFiltros
          cargando={cargando}
          onConsultar={handleConsultar}
          onLimpiar={limpiar}
          ayuda="Por omisión: la semana actual. Se pueden elegir varios años y varias semanas (las semanas valen en cada año elegido). El ITEM se numera por consolidado y semana."
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="anio-pagos">Años</Label>
              <SelectorNumeros
                id="anio-pagos"
                opciones={opcionesAnios}
                seleccion={anios}
                onChange={setAnios}
                textoTodas="Todos"
                plural="años"
                columnas={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="semana-pagos">Semanas</Label>
              <SelectorNumeros
                id="semana-pagos"
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
            <Label htmlFor="tercero-consolidado">Empresa que factura</Label>
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
        </PanelFiltros>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {/* Etapas: una pestaña por etapa, con cuántos pagos tiene cada una. */}
          <div className="flex flex-wrap gap-1 border-b">
            {ETAPAS_CONSOLIDADO.map((e) => (
              <button
                key={e.clave}
                type="button"
                onClick={() => cambiarEtapa(e.clave)}
                className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${
                  etapa === e.clave ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {e.titulo}
                {conteo && (
                  <Badge variant="secondary" className={`h-5 px-1.5 text-xs ${e.clave === "observado" && conteo.observado > 0 ? "bg-red-100 text-red-700" : ""}`}>
                    {conteo[e.clave]}
                  </Badge>
                )}
              </button>
            ))}
          </div>

          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>
          )}
          {aviso && <div className="rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-800">{aviso}</div>}

          {alertas && alertas.fallos > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="min-w-0 flex-1">
                <strong>{alertas.fallos}</strong> {alertas.fallos === 1 ? "orden aprobada no generó" : "órdenes aprobadas no generaron"} sus
                pagos.
              </p>
              {puedeGestionar && (
                <Button size="sm" disabled={reintentando} onClick={handleReintentar}>
                  {reintentando ? "Reintentando..." : "Reintentar"}
                </Button>
              )}
            </div>
          )}

          {/* Acciones de la etapa. */}
          {pagos !== null && (
            <div className="flex flex-wrap items-center gap-2">
              {conSeleccion && seleccionables.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setSeleccion((s) => (s.size === seleccionables.length ? new Set() : new Set(seleccionables.map((p) => p.id))))
                  }
                >
                  {seleccion.size === seleccionables.length ? "Quitar selección" : "Elegir los de la página"}
                </Button>
              )}
              {enPreparacion && puedeGestionar && (
                <>
                  <Button size="sm" disabled={seleccion.size === 0 || ocupado !== null} onClick={enviarSeleccionados}>
                    {ocupado === "enviar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
                    Enviar a liquidar{seleccion.size > 0 ? ` (${seleccion.size})` : ""}
                  </Button>
                  <Button size="sm" variant="outline" disabled={!conteo?.preparacion || ocupado !== null} onClick={enviarFiltrados}>
                    {ocupado === "enviar_todos" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                    Enviar todos los filtrados{conteo ? ` (${conteo.preparacion})` : ""}
                  </Button>
                </>
              )}
              {enLiquidacion && puedeLiquidar && (
                <Button size="sm" disabled={seleccion.size === 0 || ocupado !== null} onClick={sinRetencionesSeleccionados}>
                  {ocupado === "sin" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  Liquidar sin retenciones{seleccion.size > 0 ? ` (${seleccion.size})` : ""}
                </Button>
              )}
              <div className="ml-auto flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={ocupado !== null} onClick={descargarExcel}>
                  {ocupado === "excel" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
                  Descargar Excel de liquidación
                </Button>
                {puedeLiquidar && (
                  <>
                    <Button size="sm" variant="outline" disabled={ocupado !== null} onClick={() => archivoRef.current?.click()}>
                      {ocupado === "subir" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
                      Subir Excel liquidado
                    </Button>
                    <input
                      ref={archivoRef}
                      type="file"
                      accept=".xlsx"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        e.target.value = ""
                        if (f) subirExcel(f)
                      }}
                    />
                  </>
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
              Ningún pago en esta etapa con los filtros.
            </div>
          ) : (
            <>
              <TablaExcel
                filas={pagos}
                columnas={columnas}
                claveFila={(p) => p.id}
                onDobleClickFila={(p) => setIndiceViendo(pagos.findIndex((x) => x.id === p.id))}
                tituloFila={AYUDA_DOBLE_CLIC}
                // Los anulados (no se pagan) van en gris; los observados, en rojo suave.
                fondoFila={(p) =>
                  p.estado === "anulado" || p.estado === "rechazado"
                    ? "bg-muted/60 text-muted-foreground"
                    : p.liquidacionEstado === "observado"
                      ? "bg-red-50/70"
                      : undefined
                }
                tarjeta={{
                  titulo: (p) => p.terceroNombre ?? "Sin tercero",
                  subtitulo: (p) => `ITEM ${p.item ?? "—"}${p.semana != null ? ` · semana ${p.semana} de ${p.anio}` : ""} · ${p.empresaNombre ?? ""}`,
                  esquina: (p) => <EtiquetaEtapa pago={p} />,
                  campos: camposTarjeta,
                }}
              />
              <div className="text-right text-sm text-muted-foreground">
                {plural(pagos.length, "pago", "pagos")} en esta página · Total{" "}
                <span className="font-medium text-foreground tabular-nums">{formatoMoneda(totalPagina)}</span>
              </div>
            </>
          )}

          {pagos !== null && pagos.length > 0 && ultimosFiltros && (
            <PaginacionSimple pagina={pagina} hayMas={hayMas} cargando={cargando} onCambiar={(n) => cargar(ultimosFiltros, n, false)} />
          )}
        </div>
      </div>

      <VentanaPagoLiquidacion
        pagos={pagos ?? []}
        indice={indiceViendo}
        soportes={soportes}
        puedeGestionar={puedeGestionar}
        puedeLiquidar={puedeLiquidar}
        onIndice={setIndiceViendo}
        onCerrar={() => setIndiceViendo(null)}
        onCambio={cambioDePago}
        onHistorial={setHistorialDe}
        onTercero={setResolviendo}
        onOrigen={setOrigenDe}
      />

      <ResolverPagoDialogo
        pago={resolviendo}
        onCerrar={() => setResolviendo(null)}
        onResuelto={(p) => {
          setResolviendo(null)
          cambioDePago(p)
        }}
      />

      {/* El documento de donde sale el pago: la OC, el acta o la requisición administrativa. */}
      <DetalleOrigenPago
        pago={pagoOrigen}
        acciones={null}
        camposPago={pagoOrigen ? camposDesdeColumnas(columnas, pagoOrigen, ["sel", "soporte"]) : []}
        onCerrar={() => setOrigenDe(null)}
      />

      <HistorialDialog
        abierto={historialDe !== null}
        tipo="pago"
        id={historialDe?.id ?? null}
        titulo={`Historial del pago${historialDe?.item != null ? ` · ITEM ${historialDe.item}` : ""}`}
        onCerrar={() => setHistorialDe(null)}
      />

      <Dialog open={reporte !== null} onOpenChange={(a) => !a && setReporte(null)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Excel de liquidación subido</DialogTitle>
          </DialogHeader>
          {reporte && (
            <div className="space-y-3 text-sm">
              <ul className="space-y-1">
                <li>
                  <strong>{reporte.liquidados}</strong> liquidados
                </li>
                <li>
                  <strong>{reporte.observados}</strong> observados (con comentario para Financiera)
                </li>
                <li>
                  <strong>{reporte.sinCambios}</strong> sin cambios
                </li>
                <li>
                  <strong>{reporte.sinTocar}</strong> sin llenar (siguen por liquidar)
                </li>
                <li className={reporte.errores.length > 0 ? "text-destructive" : ""}>
                  <strong>{reporte.errores.length}</strong> con error (no se guardaron)
                </li>
              </ul>
              {reporte.errores.length > 0 && (
                <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-2">
                  {reporte.errores.map((e, i) => (
                    <p key={i}>
                      {e.fila != null ? `Fila ${e.fila}` : "Fila"}
                      {e.item ? ` (ITEM ${e.item})` : ""}: {e.mensaje}
                    </p>
                  ))}
                </div>
              )}
              {reporte.avisos.length > 0 && (
                <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
                  <p className="font-medium">Se guardaron, pero revísalos:</p>
                  {reporte.avisos.map((e, i) => (
                    <p key={i}>
                      Fila {e.fila}
                      {e.item ? ` (ITEM ${e.item})` : ""}: {e.mensaje}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setReporte(null)}>Listo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  // Cuentas con el tercero al que corresponden: las de otro tercero no se
  // muestran y mientras no lleguen las del elegido se están cargando.
  const [cargaCuentas, setCargaCuentas] = useState<{ terceroId: string; cuentas: CuentaOpcion[] } | null>(null)
  const cuentas = tercero && cargaCuentas?.terceroId === tercero.id ? cargaCuentas.cuentas : []
  const cargandoCuentas = tercero !== null && cargaCuentas?.terceroId !== tercero.id
  const [cuentaId, setCuentaId] = useState(pago.cuentaId ?? "")
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!tercero) return
    let vigente = true
    cuentasDeTercero(tercero.id)
      .then((c: CuentaOpcion[]) => {
        if (!vigente) return
        setCargaCuentas({ terceroId: tercero.id, cuentas: c })
        // Si el tercero tiene una sola cuenta verificada se propone sola.
        const activas = c.filter((x) => x.estado === "ACTIVO")
        setCuentaId((previa) => (c.some((x) => x.id === previa) ? previa : activas.length === 1 ? activas[0].id : ""))
      })
      .catch((e) => {
        if (!vigente) return
        setError(e instanceof Error ? e.message : "No se pudieron cargar las cuentas.")
        setCargaCuentas({ terceroId: tercero.id, cuentas: [] })
      })
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
