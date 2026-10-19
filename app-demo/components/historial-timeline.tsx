"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  obtenerHistorial,
  type EventoHistorial,
  type TipoHistorial,
} from "@/app/(app)/almacen/historial/actions"

// Cómo se muestra cada evento. El color del punto indica el "tono":
// verde = aprobado, rojo = rechazado/cancelado, ámbar = desaprobado.
const EVENTOS: Record<string, { etiqueta: string; tono: "ok" | "malo" | "aviso" | "neutro" }> = {
  // órdenes de compra
  creada: { etiqueta: "Orden solicitada", tono: "neutro" },
  aprobada: { etiqueta: "Orden aprobada", tono: "ok" },
  rechazada: { etiqueta: "Orden rechazada", tono: "malo" },
  desaprobada: { etiqueta: "Orden desaprobada", tono: "aviso" },
  cancelada: { etiqueta: "Orden cancelada", tono: "malo" },
  entrega_actualizada: { etiqueta: "Estado de entrega", tono: "neutro" },
  // requisiciones
  creado: { etiqueta: "Requisición solicitada", tono: "neutro" },
  modificado: { etiqueta: "Requisición modificada", tono: "aviso" },
  aprobado: { etiqueta: "Requisición aprobada", tono: "ok" },
  rechazado: { etiqueta: "Requisición rechazada", tono: "malo" },
  desaprobado: { etiqueta: "Requisición desaprobada", tono: "aviso" },
  cancelado: { etiqueta: "Requisición cancelada", tono: "malo" },
  rechazado_por_compras: { etiqueta: "Rechazado por Compras", tono: "malo" },
  estado_cambiado: { etiqueta: "Cambio de estado", tono: "neutro" },
}

// Eventos de una REQUISICIÓN (agrupada). Mismas claves que las órdenes de compra
// (creada, aprobada...) pero con su propio texto.
const EVENTOS_REQUISICION: Record<string, { etiqueta: string; tono: "ok" | "malo" | "aviso" | "neutro" }> = {
  creada: { etiqueta: "Requisición solicitada", tono: "neutro" },
  modificada: { etiqueta: "Requisición modificada", tono: "aviso" },
  aprobada: { etiqueta: "Requisición aprobada", tono: "ok" },
  rechazada: { etiqueta: "Requisición rechazada", tono: "malo" },
  desaprobada: { etiqueta: "Requisición desaprobada", tono: "aviso" },
  cancelada: { etiqueta: "Requisición cancelada", tono: "malo" },
  rechazado_por_compras: { etiqueta: "Insumo rechazado por Compras", tono: "malo" },
}

// Eventos de una SOLICITUD DE CONTRATO (pre-aprobación y minuta).
const EVENTOS_ACTA: Record<string, { etiqueta: string; tono: "ok" | "malo" | "aviso" | "neutro" }> = {
  creada: { etiqueta: "Acta elaborada", tono: "neutro" },
  editada: { etiqueta: "Acta editada", tono: "aviso" },
  reenviada: { etiqueta: "Acta corregida y enviada otra vez", tono: "neutro" },
  aprobada: { etiqueta: "Acta aprobada", tono: "ok" },
  rechazada: { etiqueta: "Acta rechazada", tono: "malo" },
}

const EVENTOS_CONTRATO: Record<string, { etiqueta: string; tono: "ok" | "malo" | "aviso" | "neutro" }> = {
  creada: { etiqueta: "Solicitud enviada a pre-aprobación", tono: "neutro" },
  reenviada: { etiqueta: "Solicitud corregida y reenviada", tono: "neutro" },
  aprobada: { etiqueta: "Pre-aprobada por Jurídica", tono: "ok" },
  devuelta: { etiqueta: "Devuelta para corregir", tono: "aviso" },
  rechazada: { etiqueta: "Rechazada", tono: "malo" },
  minuta_enviada: { etiqueta: "Minuta enviada a Subgerencia", tono: "neutro" },
  minuta_reenviada: { etiqueta: "Minuta corregida y enviada otra vez", tono: "neutro" },
  minuta_aprobada: { etiqueta: "Minuta aprobada por Subgerencia", tono: "ok" },
  minuta_devuelta: { etiqueta: "Minuta devuelta por Subgerencia", tono: "aviso" },
}

// Pagos de A&F (el evento de un cambio de estado es el nombre del estado nuevo).
const EVENTOS_PAGO: Record<string, { etiqueta: string; tono: "ok" | "malo" | "aviso" | "neutro" }> = {
  creado: { etiqueta: "Pago creado", tono: "neutro" },
  programado: { etiqueta: "Pago programado", tono: "neutro" },
  solicitado: { etiqueta: "Pago enviado a aprobación", tono: "neutro" },
  aprobado: { etiqueta: "Pago aprobado", tono: "ok" },
  rechazado: { etiqueta: "Pago rechazado", tono: "malo" },
  anulado: { etiqueta: "Pago anulado", tono: "malo" },
  liquidado: { etiqueta: "Pago liquidado", tono: "neutro" },
  en_dispersion: { etiqueta: "Pago en dispersión", tono: "neutro" },
  dispersado: { etiqueta: "Pago dispersado", tono: "ok" },
  tercero_cambiado: { etiqueta: "Tercero o cuenta cambiados", tono: "aviso" },
  valor_cambiado: { etiqueta: "Valor cambiado", tono: "aviso" },
}

// Terceros y sus cuentas (salen de terceros_auditoria).
const EVENTOS_TERCERO: Record<string, { etiqueta: string; tono: "ok" | "malo" | "aviso" | "neutro" }> = {
  tercero_creado: { etiqueta: "Tercero creado", tono: "neutro" },
  tercero_editado: { etiqueta: "Datos del tercero editados", tono: "aviso" },
  tercero_borrado: { etiqueta: "Tercero borrado", tono: "malo" },
  cuenta_agregada: { etiqueta: "Cuenta agregada", tono: "neutro" },
  cuenta_verificada: { etiqueta: "Cuenta verificada", tono: "ok" },
  cuenta_inactivada: { etiqueta: "Cuenta inactivada", tono: "malo" },
  cuenta_pendiente: { etiqueta: "Cuenta pendiente de verificar", tono: "aviso" },
  cuenta_modificada: { etiqueta: "Cuenta modificada", tono: "aviso" },
  cuenta_editada: { etiqueta: "Cuenta editada", tono: "neutro" },
  cuenta_borrada: { etiqueta: "Cuenta borrada", tono: "malo" },
}

const EVENTOS_PROVEEDOR: Record<string, { etiqueta: string; tono: "ok" | "malo" | "aviso" | "neutro" }> = {
  creado: { etiqueta: "Proveedor creado", tono: "neutro" },
  editado: { etiqueta: "Proveedor editado", tono: "aviso" },
}

const EVENTOS_POR_TIPO: Partial<
  Record<TipoHistorial, Record<string, { etiqueta: string; tono: "ok" | "malo" | "aviso" | "neutro" }>>
> = {
  requisicion: EVENTOS_REQUISICION,
  contrato: EVENTOS_CONTRATO,
  acta: EVENTOS_ACTA,
  pago: EVENTOS_PAGO,
  tercero: EVENTOS_TERCERO,
  proveedor: EVENTOS_PROVEEDOR,
}

// Nombre legible de los campos que se muestran en "qué cambió" (proveedores y
// terceros). Los que no están aquí salen con su nombre de columna.
const NOMBRE_CAMPO: Record<string, string> = {
  nombre: "Nombre",
  id_prov: "ID",
  tipo_documento: "Tipo de documento",
  numero_documento: "Documento",
  digito_verificacion: "DV",
  dv: "DV",
  nombre_contacto: "Contacto",
  telefono: "Teléfono",
  correo: "Correo",
  ciudad: "Ciudad",
  direccion: "Dirección",
  estado: "Estado",
  tipo_proveedor: "Tipo de proveedor",
  razon_social: "Razón social",
  nombre_banco: "Nombre para el banco",
  nombres: "Nombres",
  apellidos: "Apellidos",
  observaciones: "Observaciones",
}

const COLOR_PUNTO = {
  ok: "bg-emerald-500",
  malo: "bg-red-500",
  aviso: "bg-amber-500",
  neutro: "bg-slate-400",
}

const ETIQUETA_ENTREGA: Record<string, string> = {
  sin_entregar: "Sin entregar",
  entrega_parcial: "Entrega parcial",
  entregada: "Entregada",
}

const CAMPOS_PEDIDO: { clave: string; etiqueta: string }[] = [
  { clave: "cantidad", etiqueta: "Cantidad" },
  { clave: "fecha_requerida", etiqueta: "Fecha requerida" },
  { clave: "urgente", etiqueta: "Urgente" },
  { clave: "observaciones", etiqueta: "Observaciones" },
]

const formatoFechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

function formatoValor(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—"
  if (typeof v === "boolean") return v ? "Sí" : "No"
  return String(v)
}

const pesosTexto = (v: unknown) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 2 }).format(Number(v))

// "Campo: antes → después" por cada campo de `cambios` ({campo: {de, a}}).
function lineasCambios(cambios: Record<string, { de: unknown; a: unknown }> | undefined): string[] {
  if (!cambios) return []
  return Object.entries(cambios).map(
    ([campo, c]) => `${NOMBRE_CAMPO[campo] ?? campo}: ${formatoValor(c?.de)} → ${formatoValor(c?.a)}`
  )
}

// Detalle extra de algunos eventos (qué cambió en una modificación, etc.).
function detalleEvento(e: EventoHistorial, tipo: TipoHistorial): string[] {
  const d = e.datos ?? {}
  if (tipo === "pago") {
    if (e.evento === "creado" && d.valor != null) return [`Valor: ${pesosTexto(d.valor)}`]
    if (e.evento === "valor_cambiado") return [`${pesosTexto(d.de)} → ${pesosTexto(d.a)}`]
    if (e.evento === "tercero_cambiado") {
      const lineas: string[] = []
      if (d.tercero_de !== d.tercero_a) lineas.push(`Tercero: ${formatoValor(d.tercero_de)} → ${formatoValor(d.tercero_a)}`)
      if (d.cuenta_de !== d.cuenta_a) lineas.push(`Cuenta: ${formatoValor(d.cuenta_de)} → ${formatoValor(d.cuenta_a)}`)
      return lineas
    }
    return []
  }
  if (tipo === "tercero") {
    if (e.evento === "tercero_editado") return lineasCambios(d.cambios)
    if (e.evento === "cuenta_modificada" && d.cuenta_antes) return [`${d.cuenta_antes} → ${d.cuenta}`]
    if (d.cuenta) return [String(d.cuenta)]
    return []
  }
  if (tipo === "proveedor") {
    if (e.evento === "editado") return lineasCambios(d.cambios)
    return []
  }
  if (tipo === "acta") {
    if (e.evento === "aprobada" && d.pago_id) return [`Pago creado en A&F por ${pesosTexto(d.neto)}`]
    if (d.neto != null) return [`Neto a pagar: ${pesosTexto(d.neto)}`]
    return []
  }
  if (tipo === "requisicion") {
    if (e.evento === "creada" && d.insumos) return [`${d.insumos} ${d.insumos === 1 ? "insumo" : "insumos"}`]
    if (e.evento === "rechazado_por_compras" && d.insumo) return [String(d.insumo)]
    if (e.evento === "modificada") {
      const lineas: string[] = []
      for (const x of d.agregados ?? []) lineas.push(`Agregó: ${x.insumo} (${x.cantidad}) · ítem ${x.item}`)
      for (const x of d.quitados ?? []) lineas.push(`Quitó: ${x.insumo} (${x.cantidad}) · ítem ${x.item}`)
      for (const x of d.cambios ?? []) lineas.push(`${x.insumo} · ítem ${x.item}: cantidad ${x.de} → ${x.a}`)
      if (d.antes && d.despues) {
        for (const c of CAMPOS_PEDIDO.filter((c) => c.clave !== "cantidad")) {
          if (d.antes[c.clave] !== d.despues[c.clave]) {
            lineas.push(`${c.etiqueta}: ${formatoValor(d.antes[c.clave])} → ${formatoValor(d.despues[c.clave])}`)
          }
        }
      }
      return lineas
    }
    return []
  }
  if (e.evento === "modificado" && d.antes && d.despues) {
    return CAMPOS_PEDIDO.filter((c) => d.antes[c.clave] !== d.despues[c.clave]).map(
      (c) => `${c.etiqueta}: ${formatoValor(d.antes[c.clave])} → ${formatoValor(d.despues[c.clave])}`
    )
  }
  if (e.evento === "entrega_actualizada" && d.de && d.a) {
    return [`${ETIQUETA_ENTREGA[d.de] ?? d.de} → ${ETIQUETA_ENTREGA[d.a] ?? d.a}`]
  }
  return []
}

export function HistorialTimeline({ tipo, id }: { tipo: TipoHistorial; id: string }) {
  // Resultado con la entidad a la que corresponde: el de otra entidad no se
  // muestra (sin setState dentro del efecto).
  const clave = `${tipo}|${id}`
  const [carga, setCarga] = useState<{ clave: string; eventos: EventoHistorial[] | null; error: string | null } | null>(null)
  const eventos = carga?.clave === clave ? carga.eventos : null
  const error = carga?.clave === clave ? carga.error : null

  useEffect(() => {
    let activo = true
    obtenerHistorial(tipo, id)
      .then((e: EventoHistorial[]) => activo && setCarga({ clave: `${tipo}|${id}`, eventos: e, error: null }))
      .catch(
        (e) =>
          activo &&
          setCarga({ clave: `${tipo}|${id}`, eventos: null, error: e instanceof Error ? e.message : "No se pudo cargar el historial." })
      )
    return () => {
      activo = false
    }
  }, [tipo, id])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (eventos === null) {
    return (
      <div className="flex items-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando historial...
      </div>
    )
  }
  if (eventos.length === 0) {
    return <p className="text-sm text-muted-foreground">Todavía no hay movimientos registrados.</p>
  }

  return (
    <ol className="space-y-3">
      {eventos.map((e) => {
        const def =
          EVENTOS_POR_TIPO[tipo]?.[e.evento] ?? EVENTOS[e.evento] ?? { etiqueta: e.evento, tono: "neutro" as const }
        const detalle = detalleEvento(e, tipo)
        return (
          <li key={e.id} className="flex gap-3 text-sm">
            <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${COLOR_PUNTO[def.tono]}`} />
            <div className="min-w-0">
              <p className="font-medium">{def.etiqueta}</p>
              <p className="text-xs text-muted-foreground">
                {e.usuarioNombre
                  ? `${e.usuarioNombre}${e.usuarioRol ? ` (${e.usuarioRol})` : ""}`
                  : "Sistema o carga de datos"}{" "}
                · {formatoFechaHora(e.createdAt)}
                {e.datos?.reconstruido && " · reconstruido de datos anteriores"}
              </p>
              {detalle.map((linea, i) => (
                <p key={i} className="text-xs">
                  {linea}
                </p>
              ))}
              {e.motivo && <p className="mt-0.5 text-xs">Motivo: {e.motivo}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function HistorialDialog({
  abierto,
  tipo,
  id,
  titulo,
  onCerrar,
}: {
  abierto: boolean
  tipo: TipoHistorial
  id: string | null
  titulo: string
  onCerrar: () => void
}) {
  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          {id && <HistorialTimeline tipo={tipo} id={id} />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCerrar}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
