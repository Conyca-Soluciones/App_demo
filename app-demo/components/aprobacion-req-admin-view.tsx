"use client"

import { useEffect, useState } from "react"
import { Check, Eye, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PanelFiltros } from "@/components/panel-filtros"
import { PaginacionSimple } from "@/components/paginacion-simple"
import { ConfirmarAprobacion } from "@/components/confirmar-aprobacion"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { DetalleRequisicionAdmin, EtiquetaEstadoReqAdmin } from "@/components/detalle-requisicion-admin"
import { formatoMoneda } from "@/lib/pagos"
import { formatearFechaHora } from "@/lib/fechas"
import {
  ETIQUETA_ESTADO_REQ_ADMIN,
  ETIQUETA_METODO_REQ_ADMIN,
  type EstadoReqAdmin,
  type RequisicionAdminDetalle,
  type RequisicionAdminFila,
} from "@/lib/requisiciones-admin"
import {
  listarRequisicionesAdminAprobacion,
  obtenerRequisicionAdminAprobacion,
  resolverRequisicionAdmin,
} from "@/app/(app)/ayf/aprobacion-pagos/actions"

const ESTADOS: EstadoReqAdmin[] = ["por_aprobar", "aprobada", "rechazada", "cancelada"]

// Requisiciones administrativas en A&F: se aprueban o rechazan COMPLETAS (no
// pasan por Subgerencia ni por el área técnica). Aprobar crea sus pagos en el
// consolidado; rechazar la devuelve a quien la hizo para corregirla.
export function AprobacionReqAdminView({ puedeAprobar }: { puedeAprobar: boolean }) {
  const [filas, setFilas] = useState<RequisicionAdminFila[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pagina, setPagina] = useState(0)
  const [hayMas, setHayMas] = useState(false)
  const [estado, setEstado] = useState<EstadoReqAdmin | "todas">("por_aprobar")
  const [numero, setNumero] = useState("")
  const [ultimos, setUltimos] = useState<{ estado?: EstadoReqAdmin; numero?: number }>({ estado: "por_aprobar" })
  const [verId, setVerId] = useState<string | null>(null)

  function cargar(filtros = ultimos, pag = pagina) {
    setUltimos(filtros)
    setCargando(true)
    setError(null)
    listarRequisicionesAdminAprobacion(filtros, pag)
      .then((r: { filas: RequisicionAdminFila[]; hayMas: boolean }) => {
        if (r.filas.length === 0 && pag > 0) return cargar(filtros, pag - 1)
        setFilas(r.filas)
        setPagina(pag)
        setHayMas(r.hayMas)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las requisiciones."))
      .finally(() => setCargando(false))
  }

  function consultar(): boolean {
    const n = Number(numero.replace(/\D/g, ""))
    cargar({ estado: estado === "todas" ? undefined : estado, numero: numero.trim() && n > 0 ? n : undefined }, 0)
    return true
  }

  // La resuelta sale de la lista si ya no coincide con el filtro de estado.
  function reflejar(d: RequisicionAdminDetalle) {
    setFilas((actuales) => {
      if (!actuales) return actuales
      if (ultimos.estado && ultimos.estado !== d.estado) return actuales.filter((f) => f.id !== d.id)
      return actuales.map((f) =>
        f.id === d.id ? { ...f, estado: d.estado, resueltaEn: d.resueltaEn, resueltaPorNombre: d.resueltaPorNombre, motivoRechazo: d.motivoRechazo } : f
      )
    })
  }

  const columnas: ColumnaExcel<RequisicionAdminFila>[] = [
    { clave: "numero", titulo: "N°", ancho: 70, fija: true, alinear: "center", texto: (r) => (r.numero != null ? String(r.numero) : "") },
    { clave: "solicita", titulo: "Solicita", ancho: 180, texto: (r) => r.creadoPorNombre ?? "" },
    { clave: "metodo", titulo: "Método", ancho: 120, texto: (r) => ETIQUETA_METODO_REQ_ADMIN[r.metodo] },
    { clave: "empresas", titulo: "Grupo empresarial", ancho: 240, flexible: true, texto: (r) => r.empresas ?? "" },
    { clave: "items", titulo: "Ítems", ancho: 70, alinear: "center", texto: (r) => String(r.nItems) },
    { clave: "total", titulo: "Total", ancho: 150, alinear: "right", claseCelda: "tabular-nums", texto: (r) => formatoMoneda(r.valorTotal) },
    { clave: "enviada", titulo: "Enviada", ancho: 150, texto: (r) => formatearFechaHora(r.enviadaEn) },
    {
      clave: "estado",
      titulo: "Estado",
      ancho: 130,
      texto: (r) => ETIQUETA_ESTADO_REQ_ADMIN[r.estado],
      celda: (r) => <EtiquetaEstadoReqAdmin estado={r.estado} />,
    },
    {
      clave: "acciones",
      titulo: "Acciones",
      ancho: 90,
      ordenable: false,
      texto: () => "",
      celda: (r) => (
        <Button size="sm" variant="outline" className="h-8" onClick={() => setVerId(r.id)}>
          <Eye className="size-4" /> Ver
        </Button>
      ),
    },
  ]

  return (
    <div className="flex h-full min-h-0 gap-4">
      <PanelFiltros
        cargando={cargando}
        onConsultar={consultar}
        onLimpiar={() => {
          setEstado("por_aprobar")
          setNumero("")
        }}
        ayuda="Las requisiciones administrativas las hace cualquier usuario y llegan directo aquí. Se aprueban o rechazan completas: al aprobarse, cada ítem pasa como pago al consolidado."
      >
        <div className="space-y-1.5">
          <Label>Estado</Label>
          <Select value={estado} onValueChange={(v) => setEstado((v ?? "por_aprobar") as EstadoReqAdmin | "todas")}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ESTADOS.map((e) => (
                <SelectItem key={e} value={e}>
                  {ETIQUETA_ESTADO_REQ_ADMIN[e]}
                </SelectItem>
              ))}
              <SelectItem value="todas">Todas</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="numero-req-admin-ayf">Número</Label>
          <Input id="numero-req-admin-ayf" inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)} onKeyDown={(e) => e.key === "Enter" && consultar()} />
        </div>
      </PanelFiltros>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        {error && <p className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p>}
        {filas === null && !cargando ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
            Presiona Consultar para ver las requisiciones administrativas por aprobar.
          </div>
        ) : filas === null ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando…
          </div>
        ) : filas.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
            Ninguna requisición coincide con los filtros.
          </div>
        ) : (
          <TablaExcel
            filas={filas}
            columnas={columnas}
            claveFila={(r) => r.id}
            onDobleClickFila={(r) => setVerId(r.id)}
            tarjeta={{
              titulo: (r) => `Requisición N° ${r.numero ?? ""}`,
              subtitulo: (r) => `${r.creadoPorNombre ?? ""} · ${ETIQUETA_METODO_REQ_ADMIN[r.metodo]}`,
              esquina: (r) => <EtiquetaEstadoReqAdmin estado={r.estado} />,
              campos: ["total", "items", "empresas", "enviada", "acciones"],
            }}
          />
        )}
        {filas !== null && filas.length > 0 && (
          <PaginacionSimple pagina={pagina} hayMas={hayMas} cargando={cargando} onCambiar={(n) => cargar(ultimos, n)} />
        )}
      </div>

      {verId && (
        <ResolverRequisicionAdmin id={verId} puedeAprobar={puedeAprobar} onCerrar={() => setVerId(null)} onResuelta={reflejar} />
      )}
    </div>
  )
}

function ResolverRequisicionAdmin({
  id,
  puedeAprobar,
  onCerrar,
  onResuelta,
}: {
  id: string
  puedeAprobar: boolean
  onCerrar: () => void
  onResuelta: (d: RequisicionAdminDetalle) => void
}) {
  const [carga, setCarga] = useState<{ id: string; detalle: RequisicionAdminDetalle | null; error: string | null } | null>(null)
  const [porAprobar, setPorAprobar] = useState(false)
  const [rechazando, setRechazando] = useState(false)
  const [motivo, setMotivo] = useState("")
  const [procesando, setProcesando] = useState(false)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    obtenerRequisicionAdminAprobacion(id)
      .then((d: RequisicionAdminDetalle) => vigente && setCarga({ id, detalle: d, error: null }))
      .catch((e) => vigente && setCarga({ id, detalle: null, error: e instanceof Error ? e.message : "No se pudo cargar." }))
    return () => {
      vigente = false
    }
  }, [id])

  const actual = carga?.id === id ? carga : null
  const d = actual?.detalle ?? null

  async function resolver(accion: "aprobar" | "rechazar") {
    setProcesando(true)
    setErrorAccion(null)
    try {
      const nuevo = await resolverRequisicionAdmin(id, accion, accion === "rechazar" ? motivo : undefined)
      setCarga({ id, detalle: nuevo, error: null })
      onResuelta(nuevo)
      setRechazando(false)
      setMotivo("")
    } catch (e) {
      setErrorAccion(e instanceof Error ? e.message : "No se pudo resolver la requisición.")
    } finally {
      setProcesando(false)
      setPorAprobar(false)
    }
  }

  return (
    <Dialog open onOpenChange={(a) => !a && !procesando && onCerrar()}>
      <DialogContent className="max-h-[94svh] w-[calc(100vw-1rem)] max-w-6xl overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Requisición administrativa {d?.numero != null ? `N° ${d.numero}` : ""}</DialogTitle>
          <DialogDescription>Formato GF-F-018 · Relación de pagos</DialogDescription>
        </DialogHeader>
        {!actual ? (
          <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Cargando…
          </p>
        ) : actual.error ? (
          <p className="text-sm text-destructive">{actual.error}</p>
        ) : d ? (
          <DetalleRequisicionAdmin detalle={d} />
        ) : null}

        {rechazando && (
          <div className="space-y-2 rounded-md border p-3">
            <Label htmlFor="motivo-rechazo-req-admin">Motivo del rechazo (le llega a quien la hizo para corregirla)</Label>
            <Textarea id="motivo-rechazo-req-admin" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setRechazando(false)} disabled={procesando}>
                Volver
              </Button>
              <Button size="sm" variant="destructive" onClick={() => resolver("rechazar")} disabled={procesando || !motivo.trim()}>
                {procesando && <Loader2 className="size-4 animate-spin" />} Rechazar requisición
              </Button>
            </div>
          </div>
        )}
        {errorAccion && <p className="text-sm text-destructive">{errorAccion}</p>}

        {d && puedeAprobar && d.estado === "por_aprobar" && !rechazando && (
          <DialogFooter>
            <Button
              variant="outline"
              className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => setRechazando(true)}
              disabled={procesando}
            >
              <X className="size-4" /> Rechazar
            </Button>
            <Button onClick={() => setPorAprobar(true)} disabled={procesando}>
              <Check className="size-4" /> Aprobar
            </Button>
          </DialogFooter>
        )}

        <ConfirmarAprobacion
          abierta={porAprobar}
          titulo={`¿Aprobar la requisición administrativa N° ${d?.numero ?? ""}?`}
          detalle={
            d
              ? `${d.nItems} ${d.nItems === 1 ? "pago" : "pagos"} por ${formatoMoneda(d.valorTotal)} (${ETIQUETA_METODO_REQ_ADMIN[d.metodo]}) pasan al consolidado.`
              : ""
          }
          procesando={procesando}
          onConfirmar={() => resolver("aprobar")}
          onCerrar={() => setPorAprobar(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
