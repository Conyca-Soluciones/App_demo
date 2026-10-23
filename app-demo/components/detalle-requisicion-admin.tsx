"use client"

import { Paperclip } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { HistorialTimeline } from "@/components/historial-timeline"
import { CLASE_ESTADO_PAGO, ETIQUETA_ESTADO_PAGO, formatoMoneda, type EstadoPago } from "@/lib/pagos"
import { formatearFechaHora } from "@/lib/fechas"
import {
  CLASE_ESTADO_REQ_ADMIN,
  ETIQUETA_ESTADO_REQ_ADMIN,
  ETIQUETA_METODO_REQ_ADMIN,
  type EstadoReqAdmin,
  type ItemReqAdmin,
  type MetodoReqAdmin,
  type RequisicionAdminDetalle,
} from "@/lib/requisiciones-admin"

export function EtiquetaEstadoReqAdmin({ estado }: { estado: EstadoReqAdmin }) {
  return (
    <Badge variant="outline" className={`h-6 px-3 text-xs ${CLASE_ESTADO_REQ_ADMIN[estado]}`}>
      {ETIQUETA_ESTADO_REQ_ADMIN[estado]}
    </Badge>
  )
}

const vacio = <span className="text-muted-foreground/60">—</span>

// Columnas del formato GF-F-018 (B-J, L-N y observaciones). En PSE no van
// banco, tipo ni número de cuenta.
export function columnasItemsReqAdmin<T>(
  metodo: MetodoReqAdmin,
  leer: (fila: T) => {
    orden: number
    empresa: string
    facturaNombre: string
    facturaNit: string
    titularNombre: string
    titularTipoDocumento: string
    titularDocumento: string
    banco: string | null
    tipoCuenta: string | null
    numeroCuenta: string | null
    cuentaVerificada: boolean
    concepto: string
    proyecto: string
    valor: number | null
    observaciones: string | null
    // Factura o cuenta de cobro del ítem; con `ver`, se abre.
    soporte?: { nombre: string; ver?: () => void } | null
  }
): ColumnaExcel<T>[] {
  const columnas: ColumnaExcel<T>[] = [
    { clave: "orden", titulo: "Ítem", ancho: 56, alinear: "center", fija: true, texto: (f) => String(leer(f).orden) },
    { clave: "empresa", titulo: "Grupo empresarial", ancho: 200, texto: (f) => leer(f).empresa },
    { clave: "factura", titulo: "Empresa que factura", ancho: 220, texto: (f) => leer(f).facturaNombre },
    { clave: "nit", titulo: "NIT empresa que factura", ancho: 140, texto: (f) => leer(f).facturaNit },
    { clave: "titular", titulo: "Titular de la cuenta", ancho: 220, texto: (f) => leer(f).titularNombre },
    { clave: "tipoDocumento", titulo: "Tipo de documento", ancho: 100, alinear: "center", texto: (f) => leer(f).titularTipoDocumento },
    { clave: "documento", titulo: "NIT o CC titular", ancho: 130, texto: (f) => leer(f).titularDocumento },
  ]
  if (metodo === "transferencia") {
    columnas.push(
      { clave: "banco", titulo: "Banco", ancho: 150, texto: (f) => leer(f).banco ?? "", celda: (f) => leer(f).banco ?? vacio },
      {
        clave: "tipoCuenta",
        titulo: "Tipo de cuenta",
        ancho: 110,
        texto: (f) => leer(f).tipoCuenta ?? "",
        celda: (f) => leer(f).tipoCuenta ?? vacio,
      },
      {
        clave: "numeroCuenta",
        titulo: "Número de cuenta",
        ancho: 160,
        texto: (f) => leer(f).numeroCuenta ?? "",
        celda: (f) => {
          const l = leer(f)
          if (!l.numeroCuenta) return vacio
          return (
            <span className={l.cuentaVerificada ? "tabular-nums" : "tabular-nums text-amber-700"} title={l.cuentaVerificada ? undefined : "Cuenta sin verificar por A&F"}>
              {l.numeroCuenta}
              {!l.cuentaVerificada && " (sin verificar)"}
            </span>
          )
        },
      }
    )
  }
  columnas.push(
    { clave: "concepto", titulo: "Concepto de la factura", ancho: 260, flexible: true, texto: (f) => leer(f).concepto },
    { clave: "proyecto", titulo: "Código de proyecto", ancho: 170, texto: (f) => leer(f).proyecto },
    {
      clave: "valor",
      titulo: "Valor documento",
      ancho: 140,
      alinear: "right",
      claseCelda: "tabular-nums",
      texto: (f) => {
        const v = leer(f).valor
        return v == null ? "" : formatoMoneda(v)
      },
    },
    {
      clave: "observaciones",
      titulo: "Observaciones",
      ancho: 200,
      texto: (f) => leer(f).observaciones ?? "",
      celda: (f) => leer(f).observaciones || vacio,
    },
    {
      clave: "soporte",
      titulo: "Soporte",
      ancho: 180,
      ordenable: false,
      texto: (f) => leer(f).soporte?.nombre ?? "",
      celda: (f) => {
        const sop = leer(f).soporte
        if (!sop) return vacio
        return sop.ver ? (
          <Button size="sm" variant="ghost" className="h-7 max-w-full gap-1 px-2" title={sop.nombre} onClick={sop.ver}>
            <Paperclip className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Ver</span>
          </Button>
        ) : (
          <span className="flex min-w-0 items-center gap-1" title={sop.nombre}>
            <Paperclip className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{sop.nombre}</span>
          </span>
        )
      },
    }
  )
  return columnas
}

const leerItem = (i: ItemReqAdmin) => ({
  orden: i.orden,
  empresa: i.empresaNombre,
  facturaNombre: i.facturaNombre,
  facturaNit: i.facturaNit,
  titularNombre: i.titularNombre,
  titularTipoDocumento: i.titularTipoDocumento,
  titularDocumento: i.titularDocumento,
  banco: i.banco,
  tipoCuenta: i.tipoCuenta,
  numeroCuenta: i.numeroCuenta,
  cuentaVerificada: i.cuentaVerificada,
  concepto: i.concepto,
  proyecto: i.proyectoCodigo ?? i.proyectoNombre,
  valor: i.valor,
  observaciones: i.observaciones,
  soporte: i.soporte ? { nombre: i.soporte.nombre, ver: () => verSoporteReqAdmin(i.soporte!.ruta) } : null,
})

// Enlace firmado de 2 minutos (la base solo lo da si se ve el ítem). La pestaña
// se abre antes de pedirlo: si no, el navegador la bloquea.
export async function verSoporteReqAdmin(ruta: string) {
  const ventana = window.open("", "_blank")
  const { data, error } = await createClient().storage.from("requisiciones_admin").createSignedUrl(ruta, 120)
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

// Detalle de una requisición administrativa (quien la hizo y A&F). Los
// botones los pone cada pantalla.
export function DetalleRequisicionAdmin({ detalle }: { detalle: RequisicionAdminDetalle }) {
  const columnas = columnasItemsReqAdmin<ItemReqAdmin>(detalle.metodo, leerItem)
  // Pago de cada ítem (una fila del consolidado); A&F los aprueba o rechaza
  // juntos, con la requisición.
  columnas.push({
    clave: "pago",
    titulo: "Pago",
    ancho: 200,
    texto: (i) => (i.pagoEstado ? (ETIQUETA_ESTADO_PAGO[i.pagoEstado as EstadoPago] ?? i.pagoEstado) : ""),
    celda: (i) => {
      if (!i.pagoEstado) return vacio
      const estado = i.pagoEstado as EstadoPago
      return (
        <div className="flex min-w-0 items-center gap-1.5">
          <Badge variant="outline" className={`h-6 shrink-0 px-2 text-xs ${CLASE_ESTADO_PAGO[estado] ?? ""}`}>
            {ETIQUETA_ESTADO_PAGO[estado] ?? i.pagoEstado}
          </Badge>
          {i.pagoItem != null && (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              ITEM {i.pagoItem} · sem. {i.pagoSemana}
            </span>
          )}
          {estado === "rechazado" && i.pagoMotivoRechazo && (
            <span className="truncate text-xs text-red-700" title={i.pagoMotivoRechazo}>
              {i.pagoMotivoRechazo}
            </span>
          )}
        </div>
      )
    },
  })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-4">
        <Dato etiqueta="Estado">
          <EtiquetaEstadoReqAdmin estado={detalle.estado} />
        </Dato>
        <Dato etiqueta="Método de pago">{ETIQUETA_METODO_REQ_ADMIN[detalle.metodo]}</Dato>
        <Dato etiqueta="Solicita">{detalle.creadoPorNombre ?? "—"}</Dato>
        <Dato etiqueta="Enviada">{formatearFechaHora(detalle.enviadaEn)}</Dato>
        <Dato etiqueta="Ítems">{detalle.nItems}</Dato>
        <Dato etiqueta="Total">
          <span className="tabular-nums">{formatoMoneda(detalle.valorTotal)}</span>
        </Dato>
        {detalle.resueltaEn && (
          <Dato etiqueta={detalle.estado === "rechazada" ? "Rechazada" : "Aprobada"}>
            {formatearFechaHora(detalle.resueltaEn)}
            {detalle.resueltaPorNombre ? ` · ${detalle.resueltaPorNombre}` : ""}
          </Dato>
        )}
      </div>

      {detalle.estado === "rechazada" && detalle.motivoRechazo && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <span className="font-medium">Motivo del rechazo:</span> {detalle.motivoRechazo}
        </p>
      )}
      {detalle.estado === "cancelada" && detalle.motivoCancelacion && (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">Cancelada:</span> {detalle.motivoCancelacion}
        </p>
      )}

      <TablaExcel
        filas={detalle.items}
        columnas={columnas}
        claveFila={(i) => i.id}
        claseAltoMax="max-h-[50svh]"
        tarjeta={{
          titulo: (i) => `${i.orden}. ${i.facturaNombre}`,
          subtitulo: (i) => i.concepto,
          esquina: (i) => <span className="text-sm font-medium tabular-nums">{formatoMoneda(i.valor)}</span>,
          campos: ["empresa", "titular", "documento", ...(detalle.metodo === "transferencia" ? ["banco", "numeroCuenta"] : []), "proyecto", "observaciones", "pago"],
        }}
      />
      <p className="text-right text-sm">
        Total: <span className="font-semibold tabular-nums">{formatoMoneda(detalle.valorTotal)}</span>
      </p>

      <div>
        <p className="mb-2 text-sm font-medium">Historial</p>
        <HistorialTimeline tipo="requisicion_admin" id={detalle.id} />
      </div>
    </div>
  )
}
