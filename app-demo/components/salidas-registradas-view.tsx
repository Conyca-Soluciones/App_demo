"use client"

import { leerCantidadEntera } from "@/lib/numeros"
import { formatearFechaHora, formatearFechaSinHora } from "@/lib/fechas"
import { useState } from "react"
import { History, Loader2 } from "lucide-react"
import { HistorialDialog } from "@/components/historial-timeline"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { PanelFiltros } from "@/components/panel-filtros"
import { PaginacionSimple } from "@/components/paginacion-simple"
import { useProyectoActual } from "@/components/proyecto-provider"
import { SinProyecto } from "@/components/sin-proyecto"
import {
  anularSalida,
  editarSalida,
  listarSalidasRegistradas,
  type FiltrosSalidas,
  type SalidaRegistrada,
} from "@/app/(app)/almacen/salidas/actions"
import { CampoFecha } from "@/components/ui/campo-fecha"
import { TablaExcel, useOrdenExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { AYUDA_DOBLE_CLIC, VentanaDetalle } from "@/components/ventana-detalle"

const formatoNumero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 4 })
const formatoHora = (iso: string) =>
  formatearFechaHora(iso)

// Salidas ya registradas del proyecto actual: consultar, corregir (cantidad,
// quién retira, observaciones) o anular con motivo. Para cambiar de insumo se
// anula y se registra otra. Los topes y permisos los valida la base
// (editar_salida_almacen / anular_salida_almacen).
export function SalidasRegistradasView() {
  const proyectoId = useProyectoActual().proyecto?.id ?? null

  const [insumo, setInsumo] = useState("")
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")
  const [soloVigentes, setSoloVigentes] = useState(false)

  // null = todavía no se consultó: no se muestra nada hasta presionar Consultar.
  const [salidas, setSalidas] = useState<SalidaRegistrada[] | null>(null)
  const [filtrosAplicados, setFiltrosAplicados] = useState<FiltrosSalidas>({})
  const [pagina, setPagina] = useState(0)
  const [hayMas, setHayMas] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const [editando, setEditando] = useState<SalidaRegistrada | null>(null)
  const [edCantidad, setEdCantidad] = useState("")
  const [edRetira, setEdRetira] = useState("")
  const [edObservaciones, setEdObservaciones] = useState("")
  const [anulando, setAnulando] = useState<SalidaRegistrada | null>(null)
  const [motivo, setMotivo] = useState("")
  const [procesando, setProcesando] = useState(false)
  const [historialDe, setHistorialDe] = useState<SalidaRegistrada | null>(null)
  const [viendo, setViendo] = useState<SalidaRegistrada | null>(null)

  const columnas: ColumnaExcel<SalidaRegistrada>[] = [
    { clave: "fecha", titulo: "Fecha", ancho: 110, fija: true, texto: (s) => formatearFechaSinHora(s.fecha), valorOrden: (s) => s.fecha, claseCelda: "tabular-nums" },
    {
      clave: "insumo",
      titulo: "Insumo",
      ancho: 280,
      flexible: true,
      texto: (s) => `${s.insumoCodigo} · ${s.insumoDescripcion}`,
      celda: (s) => (
        <span className={`truncate ${s.anuladaAt ? "text-muted-foreground line-through" : ""}`} title={s.observaciones ?? undefined}>
          {s.insumoCodigo} · {s.insumoDescripcion}
        </span>
      ),
    },
    { clave: "um", titulo: "UM", ancho: 120, texto: (s) => s.insumoUm ?? "" },
    {
      clave: "cantidad",
      titulo: "Cantidad",
      ancho: 110,
      alinear: "right",
      texto: (s) => formatoNumero.format(s.cantidad),
      valorOrden: (s) => s.cantidad,
      celda: (s) => (
        <span className="flex flex-col items-end leading-tight tabular-nums">
          <span>{formatoNumero.format(s.cantidad)}</span>
          {s.cantidadOriginal !== null && <span className="text-[11px] text-muted-foreground">antes {formatoNumero.format(s.cantidadOriginal)}</span>}
        </span>
      ),
    },
    { clave: "retira", titulo: "Retira", ancho: 150, texto: (s) => s.retira ?? "" },
    { clave: "registro", titulo: "Registró", ancho: 190, texto: (s) => `${s.registradoPorNombre ?? "—"} · ${formatoHora(s.createdAt)}`, valorOrden: (s) => s.createdAt },
    {
      clave: "estado",
      titulo: "Estado",
      ancho: 110,
      alinear: "center",
      texto: (s) => (s.anuladaAt ? "Anulada" : s.editadaAt ? "Editada" : "Vigente"),
      celda: (s) =>
        s.anuladaAt ? (
          <Badge variant="destructive">Anulada</Badge>
        ) : s.editadaAt ? (
          <Badge variant="outline" title={`Editada ${formatoHora(s.editadaAt)}${s.editadaPorNombre ? ` por ${s.editadaPorNombre}` : ""}`}>
            Editada
          </Badge>
        ) : (
          <Badge variant="outline">Vigente</Badge>
        ),
    },
    {
      clave: "acciones",
      titulo: "Acciones",
      ancho: 200,
      alinear: "center",
      ordenable: false,
      texto: () => "",
      celda: (s) => (
        <span className="inline-flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            title="Historial de la salida"
            aria-label="Historial de la salida"
            onClick={() => setHistorialDe(s)}
          >
            <History className="h-4 w-4" />
          </Button>
          {!s.anuladaAt && (
            <>
              <Button variant="outline" size="sm" onClick={() => abrirEdicion(s)}>
                Editar
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={() => {
                  setError(null)
                  setAviso(null)
                  setMotivo("")
                  setAnulando(s)
                }}
              >
                Anular
              </Button>
            </>
          )}
        </span>
      ),
    },
  ]
  const { ordenadas, orden, ordenar } = useOrdenExcel(salidas ?? [], columnas)

  function cargar(filtros: FiltrosSalidas, nuevaPagina: number) {
    if (!proyectoId) return
    setCargando(true)
    setError(null)
    listarSalidasRegistradas(proyectoId, filtros, nuevaPagina)
      .then((r: { salidas: SalidaRegistrada[]; hayMas: boolean }) => {
        setSalidas(r.salidas)
        setHayMas(r.hayMas)
        setPagina(nuevaPagina)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las salidas."))
      .finally(() => setCargando(false))
  }

  function consultar() {
    const filtros: FiltrosSalidas = {
      insumo: insumo.trim() || undefined,
      desde: desde || undefined,
      hasta: hasta || undefined,
      incluirAnuladas: !soloVigentes,
    }
    setFiltrosAplicados(filtros)
    setAviso(null)
    cargar(filtros, 0)
  }

  function limpiar() {
    setInsumo("")
    setDesde("")
    setHasta("")
    setSoloVigentes(false)
  }

  function abrirEdicion(s: SalidaRegistrada) {
    setError(null)
    setAviso(null)
    setEdCantidad(String(s.cantidad))
    setEdRetira(s.retira ?? "")
    setEdObservaciones(s.observaciones ?? "")
    setEditando(s)
  }

  async function confirmarEdicion() {
    if (!editando) return
    const leida = leerCantidadEntera(edCantidad)
    if (!leida.ok || leida.valor <= 0) {
      setError(leida.ok ? "La cantidad debe ser mayor que cero. Para deshacer la salida, anúlala." : leida.error)
      return
    }
    setProcesando(true)
    setError(null)
    try {
      await editarSalida({
        salidaId: editando.id,
        cantidad: leida.valor,
        retira: edRetira,
        observaciones: edObservaciones,
      })
      setAviso(`Salida de "${editando.insumoDescripcion}" corregida.`)
      setEditando(null)
      cargar(filtrosAplicados, pagina)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo corregir la salida.")
    } finally {
      setProcesando(false)
    }
  }

  async function confirmarAnulacion() {
    if (!anulando || !motivo.trim()) return
    setProcesando(true)
    setError(null)
    try {
      await anularSalida(anulando.id, motivo.trim())
      setAviso(`Salida de "${anulando.insumoDescripcion}" anulada: el material vuelve al inventario.`)
      setAnulando(null)
      setMotivo("")
      cargar(filtrosAplicados, pagina)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo anular la salida.")
    } finally {
      setProcesando(false)
    }
  }

  if (!proyectoId) return <SinProyecto />

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 lg:flex-row">
      <PanelFiltros
        onConsultar={consultar}
        onLimpiar={limpiar}
        cargando={cargando}
        ayuda="Ningún filtro es obligatorio: sin filtros se consultan todas las salidas del proyecto."
      >
        <div className="space-y-1.5">
          <Label htmlFor="salidas-insumo">Insumo</Label>
          <Input
            id="salidas-insumo"
            placeholder="Código o parte de la descripción"
            value={insumo}
            onChange={(e) => setInsumo(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Fecha de la salida</Label>
          <div className="grid grid-cols-2 gap-2">
            <CampoFecha value={desde} onChange={(e) => setDesde(e.target.value)} aria-label="Desde" />
            <CampoFecha value={hasta} onChange={(e) => setHasta(e.target.value)} aria-label="Hasta" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={soloVigentes} onCheckedChange={(v) => setSoloVigentes(v === true)} />
          Ocultar anuladas
        </label>
      </PanelFiltros>

      <div className="min-w-0 flex-1 space-y-3 overflow-auto">
        {aviso && (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
            {aviso}
          </div>
        )}
        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {salidas === null ? (
          <p className="text-sm text-muted-foreground">
            Elige los filtros que quieras y presiona Consultar para ver las salidas registradas.
          </p>
        ) : cargando && salidas.length === 0 ? (
          <div className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando...
          </div>
        ) : salidas.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay salidas con esos filtros.</p>
        ) : (
          <>
            <TablaExcel
              filas={ordenadas}
              columnas={columnas}
              claveFila={(s) => s.id}
              orden={orden}
              onOrdenar={ordenar}
              onDobleClickFila={setViendo}
              tituloFila={AYUDA_DOBLE_CLIC}
              tarjeta={{
                titulo: (s) => `${s.insumoCodigo} · ${s.insumoDescripcion}`,
                subtitulo: (s) => formatearFechaSinHora(s.fecha),
                esquina: (s) => columnas.find((c) => c.clave === "estado")!.celda!(s),
                campos: ["um", "cantidad", "retira", "registro", "acciones"],
              }}
            />
            <PaginacionSimple
              pagina={pagina}
              hayMas={hayMas}
              cargando={cargando}
              onCambiar={(n) => cargar(filtrosAplicados, n)}
            />
          </>
        )}
      </div>

      <VentanaDetalle
        abierta={viendo !== null}
        onCerrar={() => setViendo(null)}
        titulo={viendo ? `${viendo.insumoCodigo} · ${viendo.insumoDescripcion}` : ""}
        subtitulo={viendo ? `Salida del ${formatearFechaSinHora(viendo.fecha)}` : undefined}
        campos={
          viendo
            ? [
                { etiqueta: "Fecha", valor: formatearFechaSinHora(viendo.fecha) },
                { etiqueta: "UM", valor: viendo.insumoUm ?? "" },
                {
                  etiqueta: "Cantidad",
                  valor: `${formatoNumero.format(viendo.cantidad)}${viendo.cantidadOriginal !== null ? ` (antes ${formatoNumero.format(viendo.cantidadOriginal)})` : ""}`,
                },
                { etiqueta: "Retira", valor: viendo.retira ?? "" },
                { etiqueta: "Registró", valor: `${viendo.registradoPorNombre ?? "—"} · ${formatoHora(viendo.createdAt)}` },
                {
                  etiqueta: "Estado",
                  valor: viendo.anuladaAt ? "Anulada" : viendo.editadaAt ? "Editada" : "Vigente",
                },
                ...(viendo.editadaAt
                  ? [{ etiqueta: "Editada", valor: `${formatoHora(viendo.editadaAt)}${viendo.editadaPorNombre ? ` por ${viendo.editadaPorNombre}` : ""}` }]
                  : []),
                ...(viendo.anuladaAt
                  ? [
                      {
                        etiqueta: "Anulada",
                        valor: `${formatoHora(viendo.anuladaAt)}${viendo.anuladaPorNombre ? ` por ${viendo.anuladaPorNombre}` : ""}${viendo.motivoAnulacion ? `: ${viendo.motivoAnulacion}` : ""}`,
                        ancho: "completo" as const,
                      },
                    ]
                  : []),
                { etiqueta: "Observaciones", valor: viendo.observaciones ?? "", ancho: "completo" as const },
              ]
            : []
        }
        onEditar={viendo && !viendo.anuladaAt ? () => abrirEdicion(viendo) : undefined}
        acciones={
          viendo && (
            <>
              <Button variant="outline" onClick={() => setHistorialDe(viendo)}>
                <History className="mr-1.5 h-4 w-4" /> Historial
              </Button>
              {!viendo.anuladaAt && (
                <Button
                  variant="outline"
                  className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={() => {
                    setError(null)
                    setAviso(null)
                    setMotivo("")
                    setAnulando(viendo)
                  }}
                >
                  Anular
                </Button>
              )}
            </>
          )
        }
      />

      <Dialog
        open={editando !== null}
        onOpenChange={(abierto) => {
          if (!abierto && !procesando) setEditando(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar salida</DialogTitle>
            <DialogDescription>
              {editando?.insumoCodigo} · {editando?.insumoDescripcion} ({editando?.insumoUm ?? "—"}). Para
              cambiar de insumo, anula esta salida y registra otra.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="salida-ed-cantidad">Cantidad</Label>
              <Input
                id="salida-ed-cantidad"
                inputMode="numeric"
                value={edCantidad}
                onChange={(e) => setEdCantidad(e.target.value)}
              />
            </div>
            <Input placeholder="¿Quién retira? (opcional)" value={edRetira} onChange={(e) => setEdRetira(e.target.value)} />
            <Textarea
              placeholder="Observaciones (opcional)"
              value={edObservaciones}
              onChange={(e) => setEdObservaciones(e.target.value)}
              rows={2}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditando(null)} disabled={procesando}>
              Cancelar
            </Button>
            <Button onClick={confirmarEdicion} disabled={procesando}>
              {procesando ? "Guardando..." : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={anulando !== null}
        onOpenChange={(abierto) => {
          if (!abierto && !procesando) setAnulando(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular salida</DialogTitle>
            <DialogDescription>
              {anulando ? `${formatoNumero.format(anulando.cantidad)} ${anulando.insumoUm ?? ""} de ${anulando.insumoDescripcion}` : ""}
              {". "}El material vuelve al inventario. La salida queda registrada como anulada.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Motivo de la anulación (obligatorio)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnulando(null)} disabled={procesando}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={!motivo.trim() || procesando} onClick={confirmarAnulacion}>
              {procesando ? "Anulando..." : "Anular salida"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <HistorialDialog
        abierto={historialDe !== null}
        tipo="salida"
        id={historialDe?.id ?? null}
        titulo={`Historial de la salida · ${historialDe?.insumoDescripcion ?? ""}`}
        onCerrar={() => setHistorialDe(null)}
      />
    </div>
  )
}
