"use client"

import { useEffect, useState } from "react"
import { Loader2, Paperclip } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { createClient } from "@/lib/supabase/client"
import { formatoMoneda } from "@/lib/pagos"
import { formatearFechaHora, formatearFechaSinHora } from "@/lib/fechas"
import {
  CLASE_ESTADO_LEGALIZACION,
  ETIQUETA_ESTADO_LEGALIZACION,
  ETIQUETA_EVENTO_LEGALIZACION,
  porcentajeDeCaja,
  type EstadoLegalizacion,
  type GastoDetalle,
  type LegalizacionDetalle,
} from "@/lib/caja-menor"
import { obtenerLegalizacion } from "@/app/(app)/ayf/cajas-menores/actions"

export function EtiquetaEstadoLegalizacion({ estado }: { estado: EstadoLegalizacion }) {
  return (
    <Badge variant="outline" className={`min-h-6 px-3 text-xs ${CLASE_ESTADO_LEGALIZACION[estado]}`}>
      {ETIQUETA_ESTADO_LEGALIZACION[estado]}
    </Badge>
  )
}

// Enlace firmado de 2 minutos (la base solo lo da si se ve el gasto). La pestaña
// se abre antes de pedirlo: si no, el navegador la bloquea.
export async function verSoporteGasto(ruta: string) {
  const ventana = window.open("", "_blank")
  const { data, error } = await createClient().storage.from("cajas_menores").createSignedUrl(ruta, 120)
  if (error || !data) {
    ventana?.close()
    window.alert("No se pudo abrir el soporte.")
    return
  }
  if (ventana) ventana.location.href = data.signedUrl
  else window.location.href = data.signedUrl
}

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      <div className="truncate text-sm font-medium">{children}</div>
    </div>
  )
}

const COLUMNAS_GASTOS: ColumnaExcel<GastoDetalle>[] = [
  { clave: "orden", titulo: "N°", ancho: 50, alinear: "right", texto: (g) => String(g.orden), valorOrden: (g) => g.orden },
  { clave: "fecha", titulo: "Fecha", ancho: 100, texto: (g) => formatearFechaSinHora(g.fecha), valorOrden: (g) => g.fecha },
  { clave: "proyecto", titulo: "Proyecto", ancho: 150, texto: (g) => g.proyectoCodigo || g.proyectoNombre },
  { clave: "solicitado", titulo: "Solicitado por", ancho: 150, texto: (g) => g.solicitadoPorNombre ?? "" },
  { clave: "factura", titulo: "N° factura", ancho: 110, texto: (g) => g.numeroFactura },
  { clave: "documento", titulo: "NIT o cédula", ancho: 120, texto: (g) => g.documento },
  { clave: "nombre", titulo: "Nombre o razón social", ancho: 200, texto: (g) => g.nombre },
  { clave: "concepto", titulo: "Concepto", ancho: 200, texto: (g) => g.concepto },
  { clave: "destino", titulo: "Destino", ancho: 180, texto: (g) => g.destino },
  {
    clave: "valor",
    titulo: "Valor total pagado",
    ancho: 140,
    alinear: "right",
    texto: (g) => formatoMoneda(g.valor),
    valorOrden: (g) => g.valor,
    celda: (g) => <span className="tabular-nums">{formatoMoneda(g.valor)}</span>,
  },
  {
    clave: "liquidacion",
    titulo: "Liquidación (Contabilidad)",
    ancho: 190,
    alinear: "right",
    texto: (g) => (g.liquidacion ? formatoMoneda(g.liquidacion.valorAPagar) : ""),
    valorOrden: (g) => g.liquidacion?.valorAPagar ?? null,
    celda: (g) => {
      const l = g.liquidacion
      if (!l) return <span className="text-xs text-muted-foreground">Sin liquidar</span>
      const ret = l.retefuente + l.reteiva + l.reteica
      return (
        <span className="tabular-nums">
          {formatoMoneda(l.valorAPagar)}
          <span className="block text-xs text-muted-foreground">{ret > 0 ? `Retenciones ${formatoMoneda(ret)}` : "Sin retenciones"}</span>
        </span>
      )
    },
  },
  {
    clave: "soporte",
    titulo: "Soporte",
    ancho: 110,
    ordenable: false,
    texto: (g) => g.soporte.nombre,
    celda: (g) => (
      <Button type="button" variant="outline" size="sm" className="h-7" onClick={() => verSoporteGasto(g.soporte.ruta)}>
        <Paperclip className="mr-1 size-3.5" />
        Ver
      </Button>
    ),
  },
]

// Detalle de una legalización de caja menor (responsable, Financiera, Líder
// Financiera y quien ve el pago). Los botones los pone cada pantalla.
export function DetalleLegalizacion({ detalle }: { detalle: LegalizacionDetalle }) {
  const caja = detalle.caja
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-4">
        <Dato etiqueta="Estado">
          <EtiquetaEstadoLegalizacion estado={detalle.estado} />
        </Dato>
        <Dato etiqueta="Responsable">{detalle.responsableNombre}</Dato>
        <Dato etiqueta="Caja">
          {caja ? `N° ${caja.numero} · ${formatoMoneda(caja.monto)}` : `N° ${detalle.cajaNumero}`}
        </Dato>
        <Dato etiqueta="Proyecto de la caja">{detalle.proyectoCodigo || detalle.proyectoNombre}</Dato>
        <Dato etiqueta="Grupo empresarial">{detalle.empresaNombre}</Dato>
        <Dato etiqueta="Se reembolsa a">{caja ? caja.terceroNombre : "—"}</Dato>
        <Dato etiqueta="Cuenta">{caja?.cuentaTexto || "—"}</Dato>
        <Dato etiqueta="Enviada">{formatearFechaHora(detalle.enviadaEn)}</Dato>
        <Dato etiqueta="Gastos">{detalle.nGastos}</Dato>
        <Dato etiqueta="Total">
          <span className="tabular-nums">{formatoMoneda(detalle.valorTotal)}</span>
          {detalle.cajaMonto > 0 && (
            <span className="ml-1 text-xs text-muted-foreground">({porcentajeDeCaja(detalle.valorTotal, detalle.cajaMonto)} % de la caja)</span>
          )}
        </Dato>
        {detalle.revisadaEn && (
          <Dato etiqueta="Revisó (Financiera)">
            {detalle.revisadaPorNombre ?? "—"} · {formatearFechaHora(detalle.revisadaEn)}
          </Dato>
        )}
        {detalle.aprobadaEn && (
          <Dato etiqueta="Aprobó (Líder Financiera)">
            {detalle.aprobadaPorNombre ?? "—"} · {formatearFechaHora(detalle.aprobadaEn)}
          </Dato>
        )}
        {detalle.requisicionAdminId && (
          <Dato etiqueta="Cuadro de pago">
            <a className="text-primary underline" href={`/ayf/pagos-administrativos?ver=${detalle.requisicionAdminId}`}>
              {detalle.cuadroCodigo ?? `N° ${detalle.cuadroNumero ?? ""}`}
            </a>
          </Dato>
        )}
      </div>

      {detalle.estado === "devuelta" && detalle.motivoDevolucion && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <span className="font-medium">Devuelta{detalle.devueltaPorNombre ? ` por ${detalle.devueltaPorNombre}` : ""}:</span>{" "}
          {detalle.motivoDevolucion}
        </p>
      )}
      {detalle.estado === "cancelada" && detalle.motivoCancelacion && (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">Cancelada:</span> {detalle.motivoCancelacion}
        </p>
      )}

      <TablaExcel
        dosLineas
        filas={detalle.gastos}
        columnas={COLUMNAS_GASTOS}
        claveFila={(g) => g.id}
        claseAltoMax="max-h-[45svh]"
        tarjeta={{
          titulo: (g) => `${g.orden}. ${g.nombre}`,
          subtitulo: (g) => g.concepto,
          esquina: (g) => <span className="text-sm font-medium tabular-nums">{formatoMoneda(g.valor)}</span>,
          campos: ["fecha", "proyecto", "factura", "documento", "destino", "soporte"],
        }}
      />
      <p className="text-right text-sm">
        Total: <span className="font-semibold tabular-nums">{formatoMoneda(detalle.valorTotal)}</span>
      </p>

      {detalle.eventos.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium">Historial</p>
          <ol className="space-y-1 text-sm">
            {detalle.eventos.map((e, i) => (
              <li key={i} className="flex flex-wrap gap-x-2">
                <span className="tabular-nums text-muted-foreground">{formatearFechaHora(e.fecha)}</span>
                <span className="font-medium">{ETIQUETA_EVENTO_LEGALIZACION[e.evento] ?? e.evento}</span>
                {e.usuarioNombre && <span className="text-muted-foreground">· {e.usuarioNombre}</span>}
                {e.motivo && <span className="text-muted-foreground">· {e.motivo}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

/** Ventana con el detalle de una legalización; los botones van abajo según la pantalla. */
export function DialogoLegalizacion({
  id,
  version = 0,
  onCerrar,
  acciones,
}: {
  id: string | null
  version?: number
  onCerrar: () => void
  acciones?: (d: LegalizacionDetalle) => React.ReactNode
}) {
  const [cargado, setCargado] = useState<{ clave: string; detalle: LegalizacionDetalle | null; error: string | null } | null>(null)
  const clave = `${id}:${version}`

  useEffect(() => {
    if (!id) return
    let vigente = true
    obtenerLegalizacion(id)
      .then((d: LegalizacionDetalle) => vigente && setCargado({ clave, detalle: d, error: null }))
      .catch((e) => vigente && setCargado({ clave, detalle: null, error: e instanceof Error ? e.message : "No se pudo cargar." }))
    return () => {
      vigente = false
    }
  }, [id, clave])

  const actual = cargado?.clave === clave ? cargado : null
  return (
    <Dialog open={id != null} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Caja menor {actual?.detalle?.codigo ?? ""}</DialogTitle>
          <DialogDescription>Legalización de gastos y reembolso al responsable.</DialogDescription>
        </DialogHeader>
        {!actual ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Cargando…
          </div>
        ) : actual.error ? (
          <p className="text-sm text-red-700">{actual.error}</p>
        ) : actual.detalle ? (
          <DetalleLegalizacion detalle={actual.detalle} />
        ) : null}
        {actual?.detalle && acciones && <DialogFooter className="flex-wrap gap-2">{acciones(actual.detalle)}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}
