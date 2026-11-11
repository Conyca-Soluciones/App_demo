"use client"

// Aprobación de requisiciones administrativas (Subgerencia, Paquete A): lo que
// se pide para FUNCIONAMIENTO o un proyecto sin cupo del presupuesto. Se aprueba
// o rechaza la requisición completa; aprobada pasa a Requisiciones por comprar.

import { useEffect, useState } from "react"
import { Check, ClipboardCheck, Loader2, X } from "lucide-react"
import { EncabezadoPagina } from "@/components/encabezado-pagina"
import { ConfirmarAprobacion } from "@/components/confirmar-aprobacion"
import { BadgeEstadoRequisicion } from "@/components/badge-requisicion"
import { PaginacionSimple } from "@/components/paginacion-simple"
import { TablaExcel, useOrdenExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { AYUDA_DOBLE_CLIC, VentanaDetalle } from "@/components/ventana-detalle"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatearFechaHora, formatearFechaSinHora } from "@/lib/fechas"
import type { EstadoRequisicion } from "@/lib/requisiciones-lineas"
import {
  listarReqAdministrativasAprobacion,
  puedeAprobarReqAdministrativas,
  resolverReqAdministrativa,
  type ReqAdministrativaAprobacion,
} from "./actions"

const FILTROS: { valor: EstadoRequisicion | null; etiqueta: string }[] = [
  { valor: "pendiente", etiqueta: "Por aprobar" },
  { valor: "aprobada", etiqueta: "Aprobadas" },
  { valor: "rechazada", etiqueta: "Rechazadas" },
  { valor: null, etiqueta: "Todas" },
]

const fmt = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 2 })

function resumenInsumos(r: ReqAdministrativaAprobacion) {
  const primero = r.lineas[0]
  if (!primero) return ""
  const mas = r.lineas.length - 1
  return `${primero.insumoDescripcion} × ${fmt(primero.cantidad)}${mas > 0 ? ` y ${mas} más` : ""}`
}

export default function AprobacionRequisicionesAdministrativas() {
  const [estado, setEstado] = useState<EstadoRequisicion | null>("pendiente")
  const [filas, setFilas] = useState<ReqAdministrativaAprobacion[] | null>(null)
  const [pagina, setPagina] = useState(0)
  const [hayMas, setHayMas] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [puedeAprobar, setPuedeAprobar] = useState(false)
  const [abierta, setAbierta] = useState<ReqAdministrativaAprobacion | null>(null)
  const [porAprobar, setPorAprobar] = useState<ReqAdministrativaAprobacion | null>(null)
  const [porRechazar, setPorRechazar] = useState<ReqAdministrativaAprobacion | null>(null)
  const [motivo, setMotivo] = useState("")
  const [procesando, setProcesando] = useState(false)

  function cargar(e: EstadoRequisicion | null = estado, pag = pagina) {
    setCargando(true)
    setError(null)
    listarReqAdministrativasAprobacion(e, pag)
      .then((r: { filas: ReqAdministrativaAprobacion[]; hayMas: boolean }) => {
        if (r.filas.length === 0 && pag > 0) return cargar(e, pag - 1)
        setFilas(r.filas)
        setPagina(pag)
        setHayMas(r.hayMas)
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudieron cargar las requisiciones."))
      .finally(() => setCargando(false))
  }

  // Bandeja de aprobación: abre con las que esperan.
  useEffect(() => {
    let activo = true
    puedeAprobarReqAdministrativas()
      .then((v: boolean) => activo && setPuedeAprobar(v))
      .catch(() => {})
    listarReqAdministrativasAprobacion("pendiente", 0)
      .then((r: { filas: ReqAdministrativaAprobacion[]; hayMas: boolean }) => {
        if (!activo) return
        setFilas(r.filas)
        setHayMas(r.hayMas)
      })
      .catch((err) => activo && setError(err instanceof Error ? err.message : "No se pudieron cargar las requisiciones."))
    return () => {
      activo = false
    }
  }, [])

  async function resolver(r: ReqAdministrativaAprobacion, accion: "aprobado" | "rechazado") {
    setProcesando(true)
    setError(null)
    try {
      await resolverReqAdministrativa(r.id, accion, accion === "rechazado" ? motivo : undefined)
      setPorAprobar(null)
      setPorRechazar(null)
      setAbierta(null)
      setMotivo("")
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar la requisición.")
      setPorAprobar(null)
      setPorRechazar(null)
    } finally {
      setProcesando(false)
    }
  }

  function botones(r: ReqAdministrativaAprobacion) {
    if (!puedeAprobar || r.estado !== "pendiente") return null
    return (
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-8 border-emerald-300 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
          disabled={procesando}
          onClick={() => setPorAprobar(r)}
        >
          <Check className="mr-1 h-4 w-4" /> Aprobar
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
          disabled={procesando}
          onClick={() => {
            setPorRechazar(r)
            setMotivo("")
          }}
        >
          <X className="mr-1 h-4 w-4" /> Rechazar
        </Button>
      </div>
    )
  }

  const columnas: ColumnaExcel<ReqAdministrativaAprobacion>[] = [
    { clave: "codigo", titulo: "REF", ancho: 130, fija: true, texto: (r) => r.codigo, claseCelda: "font-medium tabular-nums" },
    { clave: "proyecto", titulo: "Para", ancho: 170, texto: (r) => (r.funcionamiento ? "FUNCIONAMIENTO" : r.proyecto) },
    { clave: "insumos", titulo: "Insumos", ancho: 300, flexible: true, texto: resumenInsumos, valorOrden: (r) => r.lineas.length },
    { clave: "direccion", titulo: "Dirección de entrega", ancho: 220, texto: (r) => r.direccionEntrega ?? "—" },
    {
      clave: "requerida",
      titulo: "Fecha requerida",
      ancho: 120,
      alinear: "center",
      texto: (r) => (r.fechaRequerida ? formatearFechaSinHora(r.fechaRequerida) : ""),
      valorOrden: (r) => r.fechaRequerida,
      claseCelda: "tabular-nums",
    },
    { clave: "solicitante", titulo: "Solicitado por", ancho: 160, texto: (r) => r.solicitanteNombre ?? "" },
    { clave: "creada", titulo: "Fecha", ancho: 110, alinear: "center", texto: (r) => formatearFechaSinHora(r.createdAt), valorOrden: (r) => r.createdAt, claseCelda: "tabular-nums" },
    {
      clave: "estado",
      titulo: "Estado",
      ancho: 170,
      texto: (r) => r.estado,
      celda: (r) => (
        <div className="flex items-center gap-2">
          <BadgeEstadoRequisicion estado={r.estado} />
          {r.urgente && <Badge variant="destructive">Urgente</Badge>}
        </div>
      ),
    },
    { clave: "acciones", titulo: "Acciones", ancho: 220, ordenable: false, texto: () => "", celda: botones },
  ]
  const { ordenadas, orden, ordenar } = useOrdenExcel(filas ?? [], columnas)

  return (
    <>
      <EncabezadoPagina
        titulo="Aprobación de requisiciones administrativas"
        subtitulo="Lo que se pide para FUNCIONAMIENTO o un proyecto sin cupo del presupuesto. Aprobadas pasan a Compras."
      />

      <main className="w-full flex-1 space-y-4 p-6">
        <div className="flex flex-wrap gap-2">
          {FILTROS.map((f) => (
            <Button
              key={f.etiqueta}
              size="sm"
              variant={estado === f.valor ? "default" : "outline"}
              disabled={cargando}
              onClick={() => {
                setEstado(f.valor)
                cargar(f.valor, 0)
              }}
            >
              {f.etiqueta}
            </Button>
          ))}
        </div>

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>
        )}

        {filas === null ? (
          <div className="flex items-center justify-center p-12 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando requisiciones...
          </div>
        ) : filas.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
            <ClipboardCheck className="h-8 w-8" />
            No hay requisiciones administrativas {estado === "pendiente" ? "por aprobar" : "con este filtro"}.
          </div>
        ) : (
          <TablaExcel
            filas={ordenadas}
            columnas={columnas}
            claveFila={(r) => r.id}
            orden={orden}
            onOrdenar={ordenar}
            onDobleClickFila={setAbierta}
            tituloFila={AYUDA_DOBLE_CLIC}
            fondoFila={(r) => (r.urgente && r.estado === "pendiente" ? "bg-amber-50" : undefined)}
            tarjeta={{
              titulo: (r) => `Requisición ${r.codigo}`,
              subtitulo: (r) => `${r.funcionamiento ? "FUNCIONAMIENTO" : r.proyecto} · ${r.solicitanteNombre ?? "—"}`,
              esquina: (r) => <BadgeEstadoRequisicion estado={r.estado} />,
              campos: ["insumos", "direccion", "requerida", "acciones"],
            }}
          />
        )}
        {filas !== null && filas.length > 0 && (
          <PaginacionSimple pagina={pagina} hayMas={hayMas} cargando={cargando} onCambiar={(n) => cargar(estado, n)} />
        )}
      </main>

      <VentanaDetalle
        abierta={abierta !== null}
        onCerrar={() => setAbierta(null)}
        titulo={abierta ? `Requisición administrativa ${abierta.codigo}` : ""}
        subtitulo={abierta ? (abierta.funcionamiento ? "FUNCIONAMIENTO" : abierta.proyecto) : undefined}
        campos={
          abierta
            ? [
                { etiqueta: "Solicitado por", valor: abierta.solicitanteNombre ?? "—" },
                { etiqueta: "Fecha de solicitud", valor: formatearFechaHora(abierta.createdAt) },
                { etiqueta: "Fecha requerida", valor: abierta.fechaRequerida ? formatearFechaSinHora(abierta.fechaRequerida) : "—" },
                { etiqueta: "Estado", valor: <BadgeEstadoRequisicion estado={abierta.estado} /> },
                { etiqueta: "Dirección de entrega", valor: abierta.direccionEntrega ?? "—", ancho: "completo" },
                { etiqueta: "Observaciones", valor: abierta.observaciones ?? "—", ancho: "completo" },
                ...(abierta.resueltoAt
                  ? [
                      { etiqueta: "Resuelta por", valor: `${abierta.resueltoPorNombre ?? "—"} · ${formatearFechaHora(abierta.resueltoAt)}` },
                      ...(abierta.motivoResolucion ? [{ etiqueta: "Motivo", valor: abierta.motivoResolucion }] : []),
                    ]
                  : []),
              ]
            : []
        }
        acciones={abierta ? botones(abierta) : null}
        ancha
      >
        {abierta && (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left">Insumo</th>
                  <th className="px-3 py-2 text-left">Unidad</th>
                  <th className="px-3 py-2 text-right">Cantidad</th>
                </tr>
              </thead>
              <tbody>
                {abierta.lineas.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="px-3 py-2">
                      <span className="text-muted-foreground">{l.insumoCodigo ?? ""}</span> {l.insumoDescripcion}
                    </td>
                    <td className="px-3 py-2">{l.insumoUm ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{fmt(l.cantidad)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </VentanaDetalle>

      <ConfirmarAprobacion
        abierta={porAprobar !== null}
        titulo={`¿Aprobar la requisición administrativa ${porAprobar?.codigo ?? ""}?`}
        detalle={
          porAprobar
            ? `${porAprobar.lineas.length} ${porAprobar.lineas.length === 1 ? "insumo" : "insumos"}. Pasa a Compras y se le avisa a ${
                porAprobar.solicitanteNombre ?? "quien la pidió"
              }.`
            : ""
        }
        procesando={procesando}
        onConfirmar={() => porAprobar && resolver(porAprobar, "aprobado")}
        onCerrar={() => setPorAprobar(null)}
      />

      <Dialog open={porRechazar !== null} onOpenChange={(v) => !v && !procesando && setPorRechazar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rechazar requisición administrativa {porRechazar?.codigo}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Quien la pidió recibe una notificación con este motivo.</p>
          <Textarea placeholder="Motivo (obligatorio)" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPorRechazar(null)} disabled={procesando}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={!motivo.trim() || procesando} onClick={() => porRechazar && resolver(porRechazar, "rechazado")}>
              {procesando ? "Procesando..." : "Rechazar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
