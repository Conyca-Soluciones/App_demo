"use client"

import { leerCantidadEntera } from "@/lib/numeros"


import { useEffect, useState } from "react"
import { ArrowLeft, CheckCircle2, History, Loader2, Paperclip } from "lucide-react"
import { HistorialDialog } from "@/components/historial-timeline"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { BuscadorAsync, type OpcionBuscador } from "@/components/buscador-async"
import { PanelFiltros } from "@/components/panel-filtros"
import { useProyectoActual } from "@/components/proyecto-provider"
import { SinProyecto } from "@/components/sin-proyecto"
import { PaginacionSimple } from "@/components/paginacion-simple"
import { buscarUsuarios } from "@/app/(app)/almacen/comprar-pedidos/actions"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  anularEntrada,
  editarEntrada,
  enlaceRemisionEntrada,
  guardarRemisionEntrada,
  listarRemisionesDeOrden,
  listarOrdenesEntradas,
  obtenerDetalleOrdenParaEntrada,
  registrarEntrada,
  type DetalleOrdenEntrada,
  type EntradaRegistrada,
  type EstadoEntrega,
  type FiltrosEntradas,
  type OrdenEntradaFila,
} from "@/app/(app)/almacen/entradas/actions"
import { CampoFecha } from "@/components/ui/campo-fecha"
import { TablaExcel, useOrdenExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { AYUDA_DOBLE_CLIC } from "@/components/ventana-detalle"
import { CampoSoporte } from "@/components/campo-soporte"
import { createClient } from "@/lib/supabase/client"
import { rutaSoporte, type SoporteGuardado, type SoporteSubidoArchivo } from "@/lib/soportes"

const formatoFecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })

const formatoNumero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 4 })

const ESTADO_BADGE: Record<
  EstadoEntrega,
  { label: string; clase: string }
> = {
  // Rojo = falta recibir todo; amarillo = recibido en parte; verde = completa.
  sin_entregar: { label: "Entrega Pendiente", clase: "border-transparent bg-red-100 text-red-800" },
  entrega_parcial: { label: "Entrega Parcial", clase: "border-transparent bg-amber-100 text-amber-800" },
  entregada: { label: "Entrega Completa", clase: "border-transparent bg-emerald-100 text-emerald-800" },
}

const formatoFechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })

const ESTADOS_FILTRO: { valor: EstadoEntrega | "todos"; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos" },
  { valor: "sin_entregar", etiqueta: "Entrega Pendiente" },
  { valor: "entrega_parcial", etiqueta: "Entrega Parcial" },
  { valor: "entregada", etiqueta: "Entrega Completa" },
]

async function buscarUsuariosAdaptado(termino: string): Promise<OpcionBuscador[]> {
  const usuarios = await buscarUsuarios(termino)
  return usuarios.map((u) => ({ id: u.id, etiqueta: u.nombre }))
}

// Cantidades: solo números enteros (ver lib/numeros.ts). "1.500" es 1500;
// "1,5" se rechaza con el motivo para mostrárselo al usuario.

// Trabaja sobre el proyecto actual (selector del encabezado). La key remonta
// la vista al cambiar de proyecto: se limpian la lista, los filtros y la orden
// abierta, sin efectos que copien estado.
export function EntradasView() {
  const proyectoId = useProyectoActual().proyecto?.id ?? null
  if (!proyectoId) return <SinProyecto />
  return <EntradasProyecto key={proyectoId} proyectoId={proyectoId} />
}

function EntradasProyecto({ proyectoId }: { proyectoId: string }) {
  // null = todavía no se consultó: no se muestra nada hasta presionar Consultar.
  const [ordenes, setOrdenes] = useState<OrdenEntradaFila[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [pagina, setPagina] = useState(0)
  const [hayMas, setHayMas] = useState(false)
  const [ordenId, setOrdenId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  // Últimos filtros consultados (para refrescar al volver del detalle).
  const [ultimosFiltros, setUltimosFiltros] = useState<FiltrosEntradas | null>(null)

  // Filtros del panel (todos opcionales)
  const [numero, setNumero] = useState("")
  const [proveedor, setProveedor] = useState("")
  const [usuario, setUsuario] = useState<OpcionBuscador | null>(null)

  const columnas: ColumnaExcel<OrdenEntradaFila>[] = [
    { clave: "numero", titulo: "OC N°", ancho: 90, fija: true, texto: (o) => String(o.numero), valorOrden: (o) => o.numero, claseCelda: "font-medium tabular-nums" },
    { clave: "proveedor", titulo: "Proveedor", ancho: 260, flexible: true, texto: (o) => o.proveedorNombre },
    {
      clave: "estado",
      titulo: "Estado",
      ancho: 160,
      alinear: "center",
      texto: (o) => ESTADO_BADGE[o.estadoEntrega].label,
      celda: (o) => <Badge variant="outline" className={ESTADO_BADGE[o.estadoEntrega].clase}>{ESTADO_BADGE[o.estadoEntrega].label}</Badge>,
    },
    { clave: "persona", titulo: "Persona que hizo la entrada", ancho: 220, texto: (o) => o.entradaPersona ?? "" },
    {
      clave: "fecha",
      titulo: "Fecha de la entrada",
      ancho: 170,
      texto: (o) => (o.entradaFecha ? formatoFechaHora(o.entradaFecha) : ""),
      valorOrden: (o) => o.entradaFecha,
      claseCelda: "tabular-nums",
    },
  ]
  const { ordenadas, orden, ordenar } = useOrdenExcel(ordenes ?? [], columnas)
  const [estado, setEstado] = useState<EstadoEntrega | "todos">("todos")
  // "Solo por Recibir" (marcado de entrada): entrega pendiente o parcial.
  const [soloPorRecibir, setSoloPorRecibir] = useState(true)
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")

  function consultar(filtros: FiltrosEntradas, pag = 0) {
    setUltimosFiltros(filtros)
    setCargando(true)
    setError(null)
    listarOrdenesEntradas(filtros, pag)
      .then((r: { filas: OrdenEntradaFila[]; hayMas: boolean }) => {
        // Si la página quedó vacía (p. ej. ya no hay pendientes en ella), se retrocede.
        if (r.filas.length === 0 && pag > 0) return consultar(filtros, pag - 1)
        setOrdenes(r.filas)
        setPagina(pag)
        setHayMas(r.hayMas)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las órdenes."))
      .finally(() => setCargando(false))
  }

  function handleConsultar(): boolean {
    const n = numero.trim() === "" ? undefined : Number(numero)
    if (n !== undefined && (!Number.isInteger(n) || n <= 0)) {
      setError("El número de orden de compra debe ser un número entero mayor que cero.")
      return false
    }
    consultar({
      proyectoId,
      numero: n,
      proveedor: proveedor.trim() || undefined,
      usuarioId: usuario?.id,
      estado: soloPorRecibir ? "por_recibir" : estado === "todos" ? undefined : estado,
      desde: desde || undefined,
      hasta: hasta || undefined,
    })
    return true
  }

  function limpiar() {
    setNumero("")
    setProveedor("")
    setUsuario(null)
    setEstado("todos")
    setSoloPorRecibir(true)
    setDesde("")
    setHasta("")
  }

  if (ordenId) {
    return (
      <DetalleEntrada
        ordenId={ordenId}
        onVolver={() => {
          setOrdenId(null)
          if (ultimosFiltros) consultar(ultimosFiltros, pagina)
        }}
        onRegistrada={(estado) =>
          setAviso(
            estado === "entregada"
              ? "Entrada registrada. La orden quedó en Entrega Completa."
              : "Entrada registrada. La orden quedó en Entrega Parcial."
          )
        }
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex min-h-0 flex-1 gap-4">
        <PanelFiltros
          cargando={cargando}
          onConsultar={handleConsultar}
          onLimpiar={limpiar}
          ayuda="Ningún filtro es obligatorio: sin filtros se consultan todas."
        >
          <div className="space-y-1.5">
            <Label htmlFor="numero-oc-entradas">Número de OC</Label>
            <Input
              id="numero-oc-entradas"
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              placeholder="Ej. 34"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConsultar()}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="proveedor-entradas">Proveedor</Label>
            <Input
              id="proveedor-entradas"
              placeholder="Nombre del proveedor"
              value={proveedor}
              onChange={(e) => setProveedor(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConsultar()}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Persona que hizo la entrada</Label>
            <BuscadorAsync
              placeholder="Buscar usuario"
              valorSeleccionado={usuario}
              onSeleccionar={setUsuario}
              buscar={buscarUsuariosAdaptado}
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={soloPorRecibir} onCheckedChange={(v) => setSoloPorRecibir(v === true)} />
            Solo por Recibir
          </label>

          <div className="space-y-1.5">
            <Label>Estado</Label>
            <Select
              disabled={soloPorRecibir}
              value={soloPorRecibir ? "por_recibir" : estado}
              onValueChange={(v) => setEstado((v ?? "todos") as EstadoEntrega | "todos")}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {soloPorRecibir && (
                  <SelectItem value="por_recibir">Entrega Pendiente o Parcial</SelectItem>
                )}
                {ESTADOS_FILTRO.map((e) => (
                  <SelectItem key={e.valor} value={e.valor}>
                    {e.etiqueta}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Fecha de la entrada</Label>
            <div className="flex items-center gap-2">
              <span className="w-12 text-xs text-muted-foreground">Inicial</span>
              <CampoFecha value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-12 text-xs text-muted-foreground">Final</span>
              <CampoFecha value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
          </div>
        </PanelFiltros>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          {aviso && (
            <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
              <CheckCircle2 className="h-4 w-4" /> {aviso}
            </div>
          )}
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {ordenes === null && !cargando ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Elige los filtros que quieras y presiona Consultar para ver las órdenes. Con &quot;Solo por
              Recibir&quot; ves únicamente las que tienen entrega pendiente o parcial.
            </div>
          ) : ordenes === null ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando órdenes...
            </div>
          ) : ordenes.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Ninguna orden de compra de este proyecto coincide con los filtros.
            </div>
          ) : (
            <TablaExcel
              filas={ordenadas}
              columnas={columnas}
              claveFila={(o) => o.id}
              orden={orden}
              onOrdenar={ordenar}
              onDobleClickFila={(o) => {
                setAviso(null)
                setOrdenId(o.id)
              }}
              tituloFila={AYUDA_DOBLE_CLIC}
              tarjeta={{
                titulo: (o) => `OC N° ${o.numero}`,
                subtitulo: (o) => o.proveedorNombre,
                esquina: (o) => <Badge variant="outline" className={ESTADO_BADGE[o.estadoEntrega].clase}>{ESTADO_BADGE[o.estadoEntrega].label}</Badge>,
                campos: ["persona", "fecha"],
              }}
            />
          )}
          {ordenes !== null && ordenes.length > 0 && (
            <PaginacionSimple
              pagina={pagina}
              hayMas={hayMas}
              cargando={cargando}
              onCambiar={(n) => ultimosFiltros && consultar(ultimosFiltros, n)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function DetalleEntrada({
  ordenId,
  onVolver,
  onRegistrada,
}: {
  ordenId: string
  onVolver: () => void
  onRegistrada: (estado: EstadoEntrega) => void
}) {
  const [detalle, setDetalle] = useState<DetalleOrdenEntrada | null>(null)
  const [cantidades, setCantidades] = useState<Record<string, string>>({})
  const [remision, setRemision] = useState("")
  // Soporte de la remisión (opcional): el archivo que se sube al registrar.
  const [archivoRemision, setArchivoRemision] = useState<File | null>(null)
  const [edArchivoRemision, setEdArchivoRemision] = useState<File | null>(null)
  const [remisiones, setRemisiones] = useState<Record<string, SoporteGuardado>>({})
  const [observaciones, setObservaciones] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const [editando, setEditando] = useState<EntradaRegistrada | null>(null)
  const [edCantidades, setEdCantidades] = useState<Record<string, string>>({})
  const [edRemision, setEdRemision] = useState("")
  const [edObservaciones, setEdObservaciones] = useState("")
  const [procesandoEdicion, setProcesandoEdicion] = useState(false)

  const [anulando, setAnulando] = useState<EntradaRegistrada | null>(null)
  const [motivo, setMotivo] = useState("")
  const [procesandoAnulacion, setProcesandoAnulacion] = useState(false)
  const [historialDe, setHistorialDe] = useState<EntradaRegistrada | null>(null)

  function abrirEdicion(e: EntradaRegistrada) {
    setError(null)
    setAviso(null)
    setEditando(e)
    setEdCantidades(Object.fromEntries(e.lineas.map((l) => [l.id, String(l.cantidad)])))
    setEdRemision(e.remision ?? "")
    setEdArchivoRemision(null)
    setEdObservaciones(e.observaciones ?? "")
  }

  async function confirmarEdicion() {
    if (!editando || !detalle) return
    setError(null)

    // Índice por id: evita un .find() sobre todas las líneas de la orden por
    // cada línea editada (O(n·m) -> O(n + m)).
    const lineaPorId = new Map(detalle.lineas.map((x) => [x.id, x]))
    const lineas: { id: string; cantidad: number; enUnidadCompra?: boolean }[] = []
    for (const l of editando.lineas) {
      const leida = leerCantidadEntera(edCantidades[l.id] ?? "")
      if (!leida.ok || leida.valor <= 0) {
        setError(`"${l.insumoDescripcion}": ${leida.ok ? "la cantidad debe ser mayor que cero." : leida.error}`)
        return
      }
      const cantidad = leida.valor
      // Máximo = ordenado - lo recibido en OTRAS entradas vigentes.
      const linea = lineaPorId.get(l.ordenCompraItemId)
      if (linea) {
        const maximo = linea.cantidadOrdenada - (linea.cantidadRecibida - l.cantidad)
        if (cantidad > maximo) {
          setError(
            `"${l.insumoDescripcion}": no puede superar lo ordenado (máximo ${formatoNumero.format(maximo)}).`
          )
          return
        }
      }
      lineas.push({ id: l.id, cantidad, enUnidadCompra: l.enUnidadCompra })
    }

    setProcesandoEdicion(true)
    let subida: SoporteSubidoArchivo | null = null
    try {
      const estado = await editarEntrada({
        entradaId: editando.id,
        remision: edRemision,
        observaciones: edObservaciones,
        lineas,
      })
      if (edArchivoRemision) {
        subida = await subirRemision(edArchivoRemision)
        const viejas = await guardarRemisionEntrada(editando.id, subida)
        if (viejas.length > 0) await createClient().storage.from("entradas").remove(viejas)
        subida = null
      }
      setEditando(null)
      setAviso(
        `Entrada #${editando.numero} corregida. La orden quedó en ${ESTADO_BADGE[estado].label}.`
      )
      cargar()
    } catch (e) {
      if (subida) await createClient().storage.from("entradas").remove([subida.ruta])
      setError(e instanceof Error ? e.message : "No se pudo editar la entrada.")
      setEditando(null)
    } finally {
      setProcesandoEdicion(false)
    }
  }

  async function confirmarAnulacion() {
    if (!anulando) return
    setProcesandoAnulacion(true)
    try {
      const estado = await anularEntrada(anulando.id, motivo)
      setAviso(
        `Entrada #${anulando.numero} anulada. La orden quedó en ${ESTADO_BADGE[estado].label}.`
      )
      setAnulando(null)
      setMotivo("")
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo anular la entrada.")
      setAnulando(null)
    } finally {
      setProcesandoAnulacion(false)
    }
  }

  function cargar() {
    Promise.all([obtenerDetalleOrdenParaEntrada(ordenId), listarRemisionesDeOrden(ordenId)])
      .then(([d, r]: [DetalleOrdenEntrada, Record<string, SoporteGuardado>]) => {
        setDetalle(d)
        setRemisiones(r)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar la orden."))
  }

  // Sube el archivo de la remisión al bucket (antes de guardar). Si después
  // falla el guardado, quien llama lo borra.
  async function subirRemision(archivo: File): Promise<SoporteSubidoArchivo> {
    const supabase = createClient()
    const ruta = rutaSoporte(ordenId, "remision", archivo)
    const { error: e } = await supabase.storage.from("entradas").upload(ruta, archivo, { contentType: archivo.type, upsert: false })
    if (e) throw new Error(`No se pudo subir la remisión: ${e.message}`)
    return { ruta, nombreArchivo: archivo.name, tamano: archivo.size, mime: archivo.type }
  }

  async function verRemision(soporteId: string) {
    // La pestaña se abre antes de pedir el enlace (si no, el navegador la bloquea).
    const ventana = window.open("", "_blank")
    try {
      const url = await enlaceRemisionEntrada(soporteId)
      if (ventana) ventana.location.href = url
      else window.location.href = url
    } catch (e) {
      ventana?.close()
      setError(e instanceof Error ? e.message : "No se pudo abrir la remisión.")
    }
  }

  useEffect(cargar, [ordenId])

  if (!detalle) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {error ? error : (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando orden...</>)}
      </div>
    )
  }

  const badge = ESTADO_BADGE[detalle.estadoEntrega]
  const completa = detalle.estadoEntrega === "entregada"

  async function handleGuardar() {
    if (!detalle) return
    setError(null)

    const lineas: { ordenCompraItemId: string; cantidad: number; enUnidadCompra?: boolean }[] = []
    for (const l of detalle.lineas) {
      const texto = cantidades[l.id]
      if (!texto || !texto.trim()) continue
      const leida = leerCantidadEntera(texto)
      if (!leida.ok || leida.valor < 0) {
        setError(`"${l.insumoDescripcion}": ${leida.ok ? "la cantidad no puede ser negativa." : leida.error}`)
        return
      }
      const cantidad = leida.valor
      if (cantidad > l.cantidadPendiente) {
        setError(
          `"${l.insumoDescripcion}": no puedes recibir más de lo pendiente (${formatoNumero.format(l.cantidadPendiente)}).`
        )
        return
      }
      if (cantidad > 0) lineas.push({ ordenCompraItemId: l.id, cantidad, enUnidadCompra: l.enUnidadCompra })
    }
    if (lineas.length === 0) {
      setError("Ingresa la cantidad recibida de al menos un insumo.")
      return
    }

    setGuardando(true)
    let subida: SoporteSubidoArchivo | null = null
    try {
      if (archivoRemision) subida = await subirRemision(archivoRemision)
      const estado = await registrarEntrada(
        {
          ordenId: detalle.id,
          remision,
          observaciones,
          lineas,
        },
        subida
      )
      onRegistrada(estado)
      if (estado === "entregada") {
        onVolver()
        return
      }
      setCantidades({})
      setRemision("")
      setArchivoRemision(null)
      setObservaciones("")
      cargar()
    } catch (e) {
      if (subida) await createClient().storage.from("entradas").remove([subida.ruta])
      setError(e instanceof Error ? e.message : "No se pudo registrar la entrada.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onVolver}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Volver
        </Button>
        <h1 className="text-2xl font-semibold">Entrada — OC {detalle.numero}</h1>
        <Badge variant="outline" className={badge.clase}>{badge.label}</Badge>
      </div>

      <div className="text-sm text-muted-foreground">
        {detalle.proyectoCodigo ?? detalle.proyectoNombre} · {detalle.proveedorNombre}
      </div>

      {aviso && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4" /> {aviso}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="overflow-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Insumo</TableHead>
              <TableHead>UM</TableHead>
              <TableHead className="text-right">Ordenado</TableHead>
              <TableHead className="text-right">Ya recibido</TableHead>
              <TableHead className="text-right">Pendiente</TableHead>
              <TableHead className="w-40 text-right">Recibir ahora</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detalle.lineas.map((l) => (
              <TableRow key={l.id}>
                <TableCell>{l.insumoCodigo}</TableCell>
                <TableCell>{l.insumoDescripcion}</TableCell>
                <TableCell>{l.um ?? "—"}</TableCell>
                <TableCell className="text-right">{formatoNumero.format(l.cantidadOrdenada)}</TableCell>
                <TableCell className="text-right">{formatoNumero.format(l.cantidadRecibida)}</TableCell>
                <TableCell className="text-right">{formatoNumero.format(l.cantidadPendiente)}</TableCell>
                <TableCell className="text-right">
                  {l.cantidadPendiente > 0 ? (
                    <div className="flex items-center justify-end gap-1">
                      <Input
                        inputMode="numeric"
                        className="h-8 w-24 text-right"
                        placeholder="0"
                        value={cantidades[l.id] ?? ""}
                        onChange={(e) =>
                          setCantidades((prev) => ({ ...prev, [l.id]: e.target.value }))
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        title="Recibir todo lo pendiente"
                        onClick={() =>
                          setCantidades((prev) => ({
                            ...prev,
                            [l.id]: String(l.cantidadPendiente),
                          }))
                        }
                      >
                        Todo
                      </Button>
                    </div>
                  ) : (
                    <span className="text-emerald-700">Completo</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {!completa && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            placeholder="N° de remisión / factura del proveedor (opcional)"
            value={remision}
            onChange={(e) => setRemision(e.target.value)}
          />
          <Textarea
            placeholder="Observaciones (opcional)"
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={2}
          />
          <CampoSoporte
            etiqueta="Soporte de la remisión"
            archivo={archivoRemision}
            onArchivo={setArchivoRemision}
            onError={setError}
            disabled={guardando}
          />
        </div>
      )}

      {!completa && (
        <div>
          <Button onClick={handleGuardar} disabled={guardando}>
            {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Registrar entrada
          </Button>
        </div>
      )}

      {detalle.entradas.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-medium">Entradas registradas</h2>
          {detalle.entradas.map((e) => (
            <div
              key={e.id}
              className={`rounded-lg border p-3 text-sm ${e.anuladaAt ? "bg-muted/40 text-muted-foreground" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-medium">
                <span className={e.anuladaAt ? "line-through" : ""}>Entrada #{e.numero}</span>
                {e.anuladaAt && <Badge variant="destructive">Anulada</Badge>}
                {!e.anuladaAt && e.editadaAt && <Badge variant="outline">Editada</Badge>}
                <span className="font-normal text-muted-foreground">
                  {formatoFecha(e.createdAt)} · {e.recibidoPor ?? "—"}
                  {e.remision ? ` · Remisión ${e.remision}` : ""}
                </span>
                <span className="ml-auto flex gap-1">
                  {remisiones[e.id] && (
                    <Button variant="ghost" size="sm" onClick={() => verRemision(remisiones[e.id].id)} title={remisiones[e.id].nombreArchivo}>
                      <Paperclip className="mr-1 h-4 w-4" />
                      Remisión
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setHistorialDe(e)}>
                    <History className="mr-1 h-4 w-4" />
                    Historial
                  </Button>
                  {!e.anuladaAt && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => abrirEdicion(e)}>
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setError(null)
                          setAviso(null)
                          setAnulando(e)
                        }}
                      >
                        Anular
                      </Button>
                    </>
                  )}
                </span>
              </div>
              <ul className="mt-1 list-disc pl-5">
                {e.lineas.map((l) => (
                  <li key={l.id}>
                    {l.insumoDescripcion}: {formatoNumero.format(l.cantidad)} {l.um ?? ""}
                    {l.cantidadOriginal !== null && (
                      <span className="text-muted-foreground">
                        {" "}(antes {formatoNumero.format(l.cantidadOriginal)})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {e.observaciones && <p className="mt-1 text-muted-foreground">{e.observaciones}</p>}
              {e.anuladaAt && e.motivoAnulacion && (
                <p className="mt-1">Motivo de anulación: {e.motivoAnulacion}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={editando !== null}
        onOpenChange={(abierto) => {
          if (!abierto) setEditando(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar entrada #{editando?.numero}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {editando?.lineas.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {l.insumoDescripcion} {l.um ? `(${l.um})` : ""}
                </span>
                <Input
                  inputMode="numeric"
                  className="h-8 w-28 text-right"
                  value={edCantidades[l.id] ?? ""}
                  onChange={(ev) => setEdCantidades((prev) => ({ ...prev, [l.id]: ev.target.value }))}
                />
              </div>
            ))}
          </div>
          <Input
            placeholder="N° de remisión / factura del proveedor"
            value={edRemision}
            onChange={(ev) => setEdRemision(ev.target.value)}
          />
          <Textarea
            placeholder="Observaciones"
            value={edObservaciones}
            onChange={(ev) => setEdObservaciones(ev.target.value)}
            rows={2}
          />
          <CampoSoporte
            etiqueta="Soporte de la remisión"
            archivo={edArchivoRemision}
            onArchivo={setEdArchivoRemision}
            onError={setError}
            disabled={procesandoEdicion}
            actual={
              editando && remisiones[editando.id]
                ? { nombreArchivo: remisiones[editando.id].nombreArchivo, onVer: () => verRemision(remisiones[editando.id].id) }
                : null
            }
          />
          <p className="text-xs text-muted-foreground">
            Para quitar un insumo o pasar la entrada a otra orden, anúlala y regístrala de nuevo.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmarEdicion} disabled={procesandoEdicion}>
              {procesandoEdicion ? "Guardando..." : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={anulando !== null}
        onOpenChange={(abierto) => {
          if (!abierto) {
            setAnulando(null)
            setMotivo("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular entrada #{anulando?.numero}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            El material de esta entrada sale del inventario y la orden vuelve a mostrarlo como
            pendiente. La entrada queda registrada como anulada.
          </p>
          <Textarea
            placeholder="Motivo de la anulación (obligatorio)"
            value={motivo}
            onChange={(ev) => setMotivo(ev.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnulando(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={!motivo.trim() || procesandoAnulacion}
              onClick={confirmarAnulacion}
            >
              {procesandoAnulacion ? "Anulando..." : "Anular entrada"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <HistorialDialog
        abierto={historialDe !== null}
        tipo="entrada"
        id={historialDe?.id ?? null}
        titulo={`Historial de la entrada #${historialDe?.numero ?? ""}`}
        onCerrar={() => setHistorialDe(null)}
      />
    </div>
  )
}
