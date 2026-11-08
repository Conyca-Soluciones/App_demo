"use client"

// app/(app)/almacen/requisiciones-extraordinarias/page.tsx
//
// Aprobación de requisiciones extraordinarias (Gerencia): lo que los
// ingenieros piden por encima del presupuesto con "Solicitar requisición
// extraordinaria a Gerencia". Cada una tiene uno o varios insumos, cada uno en
// su ítem (puede no estar en el APU del ítem); el detalle muestra por insumo
// cuánto contempla el presupuesto y cuánto se ha pedido ya. Ve todos los proyectos que el usuario tiene (no el proyecto actual).

import { useEffect, useState } from "react"
import { Check, ClipboardCheck, Loader2, TriangleAlert, X } from "lucide-react"
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
  listarRequisicionesExtraordinarias,
  puedeAprobarExtraordinarias,
  resolverRequisicionExtraordinaria,
  type LineaExtraordinaria,
  type RequisicionExtraordinaria,
} from "./actions"

const FILTROS: { valor: EstadoRequisicion | null; etiqueta: string }[] = [
  { valor: "pendiente", etiqueta: "Por aprobar" },
  { valor: "aprobada", etiqueta: "Aprobadas" },
  { valor: "rechazada", etiqueta: "Rechazadas" },
  { valor: null, etiqueta: "Todas" },
]

const fmt = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 2 })

// "Ya pedido" de una línea: normales en el ítem + extraordinarias anteriores en el ítem.
function textoYaPedido(l: LineaExtraordinaria) {
  if (l.requisicionesItem === 0 && l.extraPrevias === 0) return "No se ha pedido"
  const partes = []
  if (l.requisicionesItem > 0)
    partes.push(`${fmt(l.pedidoItem)} en ${l.requisicionesItem} ${l.requisicionesItem === 1 ? "requisición" : "requisiciones"}`)
  if (l.extraPrevias > 0)
    partes.push(`${fmt(l.extraPreviasCantidad)} en ${l.extraPrevias} ${l.extraPrevias === 1 ? "extraordinaria" : "extraordinarias"}`)
  return partes.join(" + ")
}

// Resumen de insumos para la fila: el primero y cuántos más.
function resumenInsumos(r: RequisicionExtraordinaria) {
  const primero = r.lineas[0]
  if (!primero) return ""
  const mas = r.lineas.length - 1
  return `${primero.insumoDescripcion} × ${fmt(primero.cantidad)}${mas > 0 ? ` y ${mas} más` : ""}`
}

export default function RequisicionesExtraordinarias() {
  const [estado, setEstado] = useState<EstadoRequisicion | null>("pendiente")
  const [filas, setFilas] = useState<RequisicionExtraordinaria[] | null>(null)
  const [pagina, setPagina] = useState(0)
  const [hayMas, setHayMas] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [puedeAprobar, setPuedeAprobar] = useState(false)
  const [abierta, setAbierta] = useState<RequisicionExtraordinaria | null>(null)
  const [porAprobar, setPorAprobar] = useState<RequisicionExtraordinaria | null>(null)
  const [porRechazar, setPorRechazar] = useState<RequisicionExtraordinaria | null>(null)
  const [motivo, setMotivo] = useState("")
  const [procesando, setProcesando] = useState(false)

  function cargar(e: EstadoRequisicion | null = estado, pag = pagina) {
    setCargando(true)
    setError(null)
    listarRequisicionesExtraordinarias(e, pag)
      .then((r: { filas: RequisicionExtraordinaria[]; hayMas: boolean }) => {
        if (r.filas.length === 0 && pag > 0) return cargar(e, pag - 1)
        setFilas(r.filas)
        setPagina(pag)
        setHayMas(r.hayMas)
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudieron cargar las requisiciones."))
      .finally(() => setCargando(false))
  }

  // Es una bandeja de aprobación: abre directo con las que esperan aprobación.
  useEffect(() => {
    let activo = true
    puedeAprobarExtraordinarias()
      .then((v) => activo && setPuedeAprobar(v))
      .catch(() => {})
    listarRequisicionesExtraordinarias("pendiente", 0)
      .then((r: { filas: RequisicionExtraordinaria[]; hayMas: boolean }) => {
        if (!activo) return
        setFilas(r.filas)
        setHayMas(r.hayMas)
      })
      .catch((err) => activo && setError(err instanceof Error ? err.message : "No se pudieron cargar las requisiciones."))
    return () => {
      activo = false
    }
  }, [])

  async function resolver(r: RequisicionExtraordinaria, accion: "aprobado" | "rechazado") {
    setProcesando(true)
    setError(null)
    try {
      await resolverRequisicionExtraordinaria(r.id, accion, accion === "rechazado" ? motivo : undefined)
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

  function botones(r: RequisicionExtraordinaria) {
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

  const columnas: ColumnaExcel<RequisicionExtraordinaria>[] = [
    { clave: "numero", titulo: "REF", ancho: 130, fija: true, texto: (r) => r.codigo, valorOrden: (r) => r.codigo, claseCelda: "font-medium tabular-nums" },
    { clave: "proyecto", titulo: "Proyecto", ancho: 140, texto: (r) => r.proyectoCodigo ?? r.proyectoNombre ?? "" },
    {
      clave: "insumos",
      titulo: "Insumos",
      ancho: 320,
      flexible: true,
      texto: resumenInsumos,
      valorOrden: (r) => r.lineas.length,
      celda: (r) => {
        const fuera = r.lineas.filter((l) => !l.enApu).length
        return (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{resumenInsumos(r)}</span>
            {fuera > 0 && (
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                {fuera} fuera del APU
              </span>
            )}
          </span>
        )
      },
    },
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
        titulo="Aprobación de requisiciones extraordinarias"
        subtitulo="Insumos que los ingenieros piden por encima de lo presupuestado. Las aprueba Gerencia."
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
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {filas === null ? (
          <div className="flex items-center justify-center p-12 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando requisiciones...
          </div>
        ) : filas.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
            <ClipboardCheck className="h-8 w-8" />
            No hay requisiciones extraordinarias {estado === "pendiente" ? "por aprobar" : "con este filtro"}.
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
              titulo: (r) => `Extraordinaria ${r.codigo}`,
              subtitulo: (r) => `${r.proyectoCodigo ?? r.proyectoNombre ?? "—"} · ${r.solicitanteNombre ?? "—"}`,
              esquina: (r) => <BadgeEstadoRequisicion estado={r.estado} />,
              campos: ["insumos", "requerida", "acciones"],
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
        titulo={abierta ? `Requisición extraordinaria ${abierta.codigo}` : ""}
        subtitulo={abierta ? `${abierta.proyectoCodigo ?? ""} ${abierta.proyectoNombre ?? ""}`.trim() : undefined}
        campos={
          abierta
            ? [
                { etiqueta: "Solicitado por", valor: abierta.solicitanteNombre ?? "—" },
                { etiqueta: "Fecha de solicitud", valor: formatearFechaHora(abierta.createdAt) },
                { etiqueta: "Fecha requerida", valor: abierta.fechaRequerida ? formatearFechaSinHora(abierta.fechaRequerida) : "—" },
                { etiqueta: "Estado", valor: <BadgeEstadoRequisicion estado={abierta.estado} /> },
                { etiqueta: "Justificación", valor: abierta.justificacion ?? "—", ancho: "completo" },
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
        {abierta && <TablaLineas lineas={abierta.lineas} />}
        <p className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          Requisición extraordinaria: pide más de lo que contempla el presupuesto. Descuenta del cupo como
          cualquier requisición (rechazarla lo devuelve); al aprobarla pasa a Compras.
        </p>
      </VentanaDetalle>

      <ConfirmarAprobacion
        abierta={porAprobar !== null}
        titulo={`¿Aprobar la requisición extraordinaria ${porAprobar?.codigo ?? ""}?`}
        detalle={
          porAprobar
            ? `${porAprobar.lineas.length} ${porAprobar.lineas.length === 1 ? "insumo" : "insumos"} por encima del presupuesto. Pasa a Compras y se le avisa a ${
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
            <DialogTitle>Rechazar requisición extraordinaria {porRechazar?.codigo}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Quien la pidió recibe una notificación con este motivo.
          </p>
          <Textarea placeholder="Motivo (obligatorio)" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPorRechazar(null)} disabled={procesando}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={!motivo.trim() || procesando}
              onClick={() => porRechazar && resolver(porRechazar, "rechazado")}
            >
              {procesando ? "Procesando..." : "Rechazar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// Insumos de la requisición con lo que ya se ha pedido de cada uno.
function TablaLineas({ lineas }: { lineas: LineaExtraordinaria[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left">Insumo</th>
            <th className="px-3 py-2 text-left">Ítem</th>
            <th className="px-3 py-2 text-right">Pide</th>
            <th className="px-3 py-2 text-right">Presupuestado</th>
            <th className="px-3 py-2 text-left">Ya pedido en el ítem</th>
            <th className="px-3 py-2 text-left">Pedido en el proyecto</th>
          </tr>
        </thead>
        <tbody>
          {lineas.map((l) => (
            <tr key={l.id} className="align-top">
              <td className="px-3 py-2">
                <p className="font-medium">{l.insumoDescripcion}</p>
                <p className="text-xs text-muted-foreground">
                  {l.insumoCodigo ?? ""} · {l.insumoUm ?? "sin unidad"}
                </p>
              </td>
              <td className="px-3 py-2">
                <p>
                  <span className="font-mono text-xs text-muted-foreground">{l.itemCodigo}</span> {l.itemDescripcion}
                </p>
                {!l.enApu && <p className="text-xs font-medium text-amber-700">No está en el APU del ítem</p>}
              </td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">{fmt(l.cantidad)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{l.enApu ? fmt(l.presupuestado) : "—"}</td>
              <td className="px-3 py-2">{textoYaPedido(l)}</td>
              <td className="px-3 py-2">
                {l.requisicionesProyecto === 0
                  ? "No se ha pedido"
                  : `${fmt(l.pedidoProyecto)} en ${l.requisicionesProyecto} ${
                      l.requisicionesProyecto === 1 ? "requisición" : "requisiciones"
                    } (todos los ítems)`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
