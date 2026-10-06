"use client"

import { useEffect, useState } from "react"
import { Loader2, PackageX } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PanelFiltros } from "@/components/panel-filtros"
import { PaginacionSimple } from "@/components/paginacion-simple"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { verProyectos } from "@/app/(app)/almacen/actions"
import {
  cerrarSaldoPedido,
  listarSaldosPendientes,
  type SaldoPendiente,
} from "@/app/(app)/almacen/comprar-pedidos/actions"
import { nombreUnidad } from "@/lib/unidades"

const formatoCant = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 2 })
const formatoFecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Bogota" })

// Solo ayudan a la vista (color); no hacen nada automático.
const DIAS_AMARILLO = 15
const DIAS_ROJO = 30

function EtiquetaDias({ dias }: { dias: number }) {
  const clase =
    dias >= DIAS_ROJO
      ? "border-red-300 bg-red-50 text-red-700"
      : dias >= DIAS_AMARILLO
        ? "border-amber-300 bg-amber-50 text-amber-700"
        : "border-gray-300 bg-gray-50 text-gray-600"
  return (
    <Badge variant="outline" className={`h-6 px-3 text-xs ${clase}`}>
      {dias === 0 ? "hoy" : `${dias} ${dias === 1 ? "día" : "días"}`}
    </Badge>
  )
}

export function SaldosPendientesView() {
  // null = todavía no se consultó: no se muestra nada hasta presionar Consultar.
  const [saldos, setSaldos] = useState<SaldoPendiente[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [pagina, setPagina] = useState(0)
  const [hayMas, setHayMas] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ultimoProyecto, setUltimoProyecto] = useState<string | undefined>(undefined)

  const [proyectos, setProyectos] = useState<{ id: string; codigo: string | null; nombre: string }[]>([])
  const [proyectoId, setProyectoId] = useState("todos")

  const [cerrando, setCerrando] = useState<SaldoPendiente | null>(null)
  const [motivo, setMotivo] = useState("")
  const [procesando, setProcesando] = useState(false)

  useEffect(() => {
    verProyectos()
      .then(setProyectos)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los proyectos."))
  }, [])

  function cargar(proyecto: string | undefined = ultimoProyecto, pag: number = pagina) {
    setUltimoProyecto(proyecto)
    setCargando(true)
    setError(null)
    listarSaldosPendientes(proyecto, pag)
      .then((r: { saldos: SaldoPendiente[]; hayMas: boolean }) => {
        // Si la página quedó vacía (se cerró el último de la página), se retrocede.
        if (r.saldos.length === 0 && pag > 0) return cargar(proyecto, pag - 1)
        setSaldos(r.saldos)
        setPagina(pag)
        setHayMas(r.hayMas)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los saldos."))
      .finally(() => setCargando(false))
  }

  function handleConsultar(): boolean {
    cargar(proyectoId === "todos" ? undefined : proyectoId, 0)
    return true
  }

  async function confirmarCierre() {
    if (!cerrando || !motivo.trim()) return
    setProcesando(true)
    setError(null)
    try {
      await cerrarSaldoPedido(cerrando.pedidoId, motivo.trim())
      const id = cerrando.pedidoId
      setSaldos((actuales) => (actuales ? actuales.filter((s) => s.pedidoId !== id) : actuales))
      setCerrando(null)
      setMotivo("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cerrar el saldo.")
      setCerrando(null)
    } finally {
      setProcesando(false)
    }
  }

  const columnas: ColumnaExcel<SaldoPendiente>[] = [
    {
      clave: "requisicion",
      titulo: "Requisición",
      ancho: 110,
      fija: true,
      texto: (s) => (s.requisicionNumero != null ? `#${s.requisicionNumero}` : ""),
    },
    {
      clave: "insumo",
      titulo: "Insumo",
      ancho: 300,
      flexible: true,
      texto: (s) => s.insumoDescripcion,
      celda: (s) => (
        <span className="line-clamp-2 whitespace-normal break-words" title={s.insumoDescripcion}>
          <span className="text-muted-foreground">{s.insumoCodigo} · </span>
          {s.insumoDescripcion}
        </span>
      ),
    },
    { clave: "proyecto", titulo: "Proyecto", ancho: 150, texto: (s) => s.proyectoCodigo ?? s.proyectoNombre },
    {
      clave: "pedido",
      titulo: "Pedido",
      ancho: 110,
      alinear: "right",
      texto: (s) => `${formatoCant(s.cantidad)} ${nombreUnidad(s.unidad)}`,
    },
    {
      clave: "comprado",
      titulo: "Comprado",
      ancho: 110,
      alinear: "right",
      texto: (s) => `${formatoCant(s.comprado)} ${nombreUnidad(s.unidad)}`,
    },
    {
      clave: "pendiente",
      titulo: "Falta",
      ancho: 110,
      alinear: "right",
      texto: (s) => `${formatoCant(s.pendiente)} ${nombreUnidad(s.unidad)}`,
      claseCelda: "font-medium",
    },
    { clave: "ultima", titulo: "Última compra", ancho: 120, texto: (s) => formatoFecha(s.ultimaCompra) },
    {
      clave: "dias",
      titulo: "Sin comprar",
      ancho: 110,
      texto: (s) => `${s.diasSinCompra} días`,
      celda: (s) => <EtiquetaDias dias={s.diasSinCompra} />,
    },
    { clave: "solicitante", titulo: "Pidió", ancho: 170, texto: (s) => s.solicitante ?? "" },
    {
      clave: "acciones",
      titulo: "Acciones",
      ancho: 140,
      ordenable: false,
      texto: () => "",
      celda: (s) => (
        <Button
          size="sm"
          variant="outline"
          className="h-8 border-amber-300 text-amber-800 hover:bg-amber-50"
          onClick={() => {
            setCerrando(s)
            setMotivo("")
            setError(null)
          }}
        >
          <PackageX className="mr-1.5 h-4 w-4" />
          Cerrar saldo
        </Button>
      ),
    },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex min-h-0 flex-1 gap-4">
        <PanelFiltros
          cargando={cargando}
          onConsultar={handleConsultar}
          onLimpiar={() => setProyectoId("todos")}
          ayuda="Requisiciones con algo comprado pero menos de lo pedido. Mientras no se cierre el saldo, lo que falta sigue descontado del presupuesto."
        >
          <div className="space-y-1.5">
            <Label>Proyecto</Label>
            <Select value={proyectoId} onValueChange={(v) => setProyectoId(v ?? "todos")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos mis proyectos</SelectItem>
                {proyectos.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.codigo ? `${p.codigo} · ${p.nombre}` : p.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </PanelFiltros>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {saldos === null && !cargando ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Presiona Consultar para ver las requisiciones compradas a medias.
            </div>
          ) : saldos === null ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando saldos...
            </div>
          ) : saldos.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              No hay requisiciones compradas a medias.
            </div>
          ) : (
            <TablaExcel
              filas={saldos}
              columnas={columnas}
              claveFila={(s) => s.pedidoId}
              tarjeta={{
                titulo: (s) => s.insumoDescripcion,
                subtitulo: (s) => `Requisición #${s.requisicionNumero ?? "—"} · ${s.proyectoCodigo ?? s.proyectoNombre}`,
                esquina: (s) => <EtiquetaDias dias={s.diasSinCompra} />,
                campos: ["pedido", "comprado", "pendiente", "ultima", "solicitante", "acciones"],
              }}
            />
          )}

          {saldos !== null && saldos.length > 0 && (
            <PaginacionSimple pagina={pagina} hayMas={hayMas} cargando={cargando} onCambiar={(n) => cargar(ultimoProyecto, n)} />
          )}
        </div>
      </div>

      <Dialog
        open={cerrando !== null}
        onOpenChange={(abierto) => {
          if (!abierto) {
            setCerrando(null)
            setMotivo("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cerrar saldo de la requisición #{cerrando?.requisicionNumero ?? ""}</DialogTitle>
          </DialogHeader>
          {cerrando && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {cerrando.insumoDescripcion}: se compraron {formatoCant(cerrando.comprado)} de {formatoCant(cerrando.cantidad)}{" "}
              {nombreUnidad(cerrando.unidad)}. Al cerrar el saldo, lo que falta ({formatoCant(cerrando.pendiente)}) se libera
              del presupuesto, la requisición queda en lo comprado y se avisa a {cerrando.solicitante ?? "quien la pidió"}.
            </p>
          )}
          <Textarea
            placeholder="Motivo del cierre (obligatorio)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCerrando(null)}>
              Cancelar
            </Button>
            <Button disabled={!motivo.trim() || procesando} onClick={confirmarCierre}>
              {procesando ? "Cerrando..." : "Cerrar saldo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
