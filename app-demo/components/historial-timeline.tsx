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
import { ACCIONES, PESTANAS } from "@/lib/pestanas"

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
  firmada_contratista: { etiqueta: "Copia firmada por el contratista subida", tono: "ok" },
}

const EVENTOS_REQUISICION_ADMIN: Record<string, { etiqueta: string; tono: "ok" | "malo" | "aviso" | "neutro" }> = {
  creada: { etiqueta: "Requisición enviada a A&F", tono: "neutro" },
  modificada: { etiqueta: "Requisición modificada", tono: "aviso" },
  reenviada: { etiqueta: "Requisición corregida y enviada otra vez", tono: "neutro" },
  aprobada: { etiqueta: "Aprobada por A&F", tono: "ok" },
  rechazada: { etiqueta: "Rechazada por A&F", tono: "malo" },
  cancelada: { etiqueta: "Requisición cancelada", tono: "malo" },
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
  minuta_guardada: { etiqueta: "Minuta guardada", tono: "neutro" },
  // Eventos de sus otrosí (historial_otrosis_de_contrato).
  otrosi_creado: { etiqueta: "Otrosí solicitado", tono: "neutro" },
  otrosi_reenviado: { etiqueta: "Otrosí corregido y enviado otra vez", tono: "neutro" },
  otrosi_devuelto: { etiqueta: "Otrosí devuelto al ingeniero por Jurídica", tono: "aviso" },
  otrosi_rechazado: { etiqueta: "Otrosí rechazado por Jurídica", tono: "malo" },
  otrosi_enviado_subgerencia: { etiqueta: "Otrosí enviado a Subgerencia", tono: "neutro" },
  otrosi_reenviado_subgerencia: { etiqueta: "Otrosí corregido y enviado otra vez a Subgerencia", tono: "neutro" },
  otrosi_devuelto_subgerencia: { etiqueta: "Otrosí devuelto a Jurídica por Subgerencia", tono: "aviso" },
  otrosi_aprobado: { etiqueta: "Otrosí aprobado por Subgerencia", tono: "ok" },
  // Póliza (20261126000000_polizas.sql).
  poliza_subida: { etiqueta: "Póliza subida", tono: "neutro" },
  poliza_aprobada: { etiqueta: "Póliza aprobada por Jurídica", tono: "ok" },
  firma_representante: { etiqueta: "Firma del representante legal puesta en el contrato", tono: "ok" },
  poliza_devuelta: { etiqueta: "Póliza devuelta por Jurídica", tono: "aviso" },
}

// Eventos de un OTROSÍ (Jurídica y Subgerencia).
const EVENTOS_OTROSI: Record<string, { etiqueta: string; tono: "ok" | "malo" | "aviso" | "neutro" }> = {
  creado: { etiqueta: "Otrosí solicitado", tono: "neutro" },
  reenviado: { etiqueta: "Otrosí corregido y enviado otra vez", tono: "neutro" },
  devuelto: { etiqueta: "Devuelto al ingeniero por Jurídica", tono: "aviso" },
  rechazado: { etiqueta: "Rechazado por Jurídica", tono: "malo" },
  enviado_subgerencia: { etiqueta: "Enviado a Subgerencia", tono: "neutro" },
  reenviado_subgerencia: { etiqueta: "Corregido y enviado otra vez a Subgerencia", tono: "neutro" },
  devuelto_subgerencia: { etiqueta: "Devuelto a Jurídica por Subgerencia", tono: "aviso" },
  aprobado: { etiqueta: "Aprobado por Subgerencia", tono: "ok" },
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

type DefEvento = { etiqueta: string; tono: "ok" | "malo" | "aviso" | "neutro" }

const EVENTOS_CONTRATISTA: Record<string, DefEvento> = {
  creado: { etiqueta: "Contratista creado", tono: "neutro" },
  editado: { etiqueta: "Datos del contratista editados", tono: "aviso" },
  documento_subido: { etiqueta: "Documento subido", tono: "neutro" },
  documento_reemplazado: { etiqueta: "Documento reemplazado", tono: "aviso" },
  documento_quitado: { etiqueta: "Documento quitado", tono: "malo" },
}

const EVENTOS_ENTRADA: Record<string, DefEvento> = {
  registrada: { etiqueta: "Entrada registrada", tono: "neutro" },
  editada: { etiqueta: "Entrada editada", tono: "aviso" },
  linea_editada: { etiqueta: "Cantidad recibida corregida", tono: "aviso" },
  anulada: { etiqueta: "Entrada anulada", tono: "malo" },
}

const EVENTOS_SALIDA: Record<string, DefEvento> = {
  registrada: { etiqueta: "Salida registrada", tono: "neutro" },
  editada: { etiqueta: "Salida editada", tono: "aviso" },
  anulada: { etiqueta: "Salida anulada", tono: "malo" },
}

const EVENTOS_SOLICITUD: Record<string, DefEvento> = {
  solicitada: { etiqueta: "Solicitud enviada", tono: "neutro" },
  aprobada: { etiqueta: "Solicitud aprobada", tono: "ok" },
  rechazada: { etiqueta: "Solicitud rechazada", tono: "malo" },
}

const EVENTOS_PRESUPUESTO: Record<string, DefEvento> = {
  creado: { etiqueta: "Presupuesto creado", tono: "neutro" },
  version_creada: { etiqueta: "Versión creada", tono: "neutro" },
  version_descartada: { etiqueta: "Versión descartada", tono: "malo" },
  descartado: { etiqueta: "Presupuesto descartado", tono: "malo" },
}

const EVENTOS_ROL: Record<string, DefEvento> = {
  creado: { etiqueta: "Rol creado", tono: "neutro" },
  renombrado: { etiqueta: "Rol renombrado", tono: "aviso" },
  eliminado: { etiqueta: "Rol eliminado", tono: "malo" },
  permiso_agregado: { etiqueta: "Permiso agregado", tono: "ok" },
  permiso_quitado: { etiqueta: "Permiso quitado", tono: "malo" },
}

const EVENTOS_USUARIO: Record<string, DefEvento> = {
  creado: { etiqueta: "Usuario creado", tono: "neutro" },
  renombrado: { etiqueta: "Nombre cambiado", tono: "aviso" },
  rol_cambiado: { etiqueta: "Rol cambiado", tono: "aviso" },
  todos_proyectos: { etiqueta: "Acceso a todos los proyectos", tono: "aviso" },
  proyecto_asignado: { etiqueta: "Proyecto asignado", tono: "ok" },
  proyecto_quitado: { etiqueta: "Proyecto quitado", tono: "malo" },
}

const EVENTOS_POR_TIPO: Partial<Record<TipoHistorial, Record<string, DefEvento>>> = {
  requisicion: EVENTOS_REQUISICION,
  contrato: EVENTOS_CONTRATO,
  acta: EVENTOS_ACTA,
  otrosi: EVENTOS_OTROSI,
  requisicion_admin: EVENTOS_REQUISICION_ADMIN,
  pago: EVENTOS_PAGO,
  tercero: EVENTOS_TERCERO,
  proveedor: EVENTOS_PROVEEDOR,
  contratista: EVENTOS_CONTRATISTA,
  entrada: EVENTOS_ENTRADA,
  salida: EVENTOS_SALIDA,
  solicitud_insumo: EVENTOS_SOLICITUD,
  solicitud_mano_obra: EVENTOS_SOLICITUD,
  solicitud_equipo: EVENTOS_SOLICITUD,
  presupuesto: EVENTOS_PRESUPUESTO,
  rol: EVENTOS_ROL,
  usuario: EVENTOS_USUARIO,
}

// Nombre de cada tipo (para la pantalla de Auditoría).
export const NOMBRE_TIPO_HISTORIAL: Record<TipoHistorial, string> = {
  orden_compra: "Orden de compra",
  pedido: "Línea de requisición",
  requisicion: "Requisición",
  contrato: "Contrato",
  acta: "Acta",
  otrosi: "Otrosí",
  requisicion_admin: "Requisición administrativa",
  pago: "Pago",
  tercero: "Tercero",
  proveedor: "Proveedor",
  contratista: "Contratista",
  entrada: "Entrada de almacén",
  salida: "Salida de almacén",
  solicitud_insumo: "Solicitud de insumo",
  solicitud_mano_obra: "Solicitud de mano de obra",
  solicitud_equipo: "Solicitud de equipo",
  presupuesto: "Presupuesto",
  rol: "Rol",
  usuario: "Usuario",
}

// "Pestaña: Entradas" / "Acción: Gestionar bodega" desde 'tab.x' / 'accion.x'.
const TITULO_PERMISO = new Map<string, string>([
  ...PESTANAS.map((p) => [`tab.${p.clave}`, `Pestaña: ${p.subseccion ? `${p.subseccion} › ` : ""}${p.titulo}`] as const),
  ...ACCIONES.map((a) => [`accion.${a.clave}`, `Acción: ${a.titulo}`] as const),
])

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
  if (Array.isArray(v)) {
    const texto = v.map((x) => (typeof x === "object" && x !== null ? JSON.stringify(x) : String(x))).join("; ")
    return texto.length > 160 ? `${texto.slice(0, 160)}…` : texto || "—"
  }
  if (typeof v === "object") {
    const texto = JSON.stringify(v)
    return texto.length > 160 ? `${texto.slice(0, 160)}…` : texto
  }
  return String(v)
}

// "camara_comercio" -> "Camara comercio" (tipos de documento sin catálogo a mano).
const textoTipo = (t: unknown) => {
  const s = String(t ?? "").replace(/_/g, " ")
  return s.charAt(0).toUpperCase() + s.slice(1)
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

// Etiqueta y color de un evento (la usan esta línea de tiempo y la Auditoría).
export function definicionEvento(tipo: TipoHistorial, evento: string): DefEvento {
  return EVENTOS_POR_TIPO[tipo]?.[evento] ?? EVENTOS[evento] ?? { etiqueta: evento, tono: "neutro" }
}

export const COLOR_TONO_EVENTO = {
  ok: "bg-emerald-500",
  malo: "bg-red-500",
  aviso: "bg-amber-500",
  neutro: "bg-slate-400",
} as const

// "Nombre (Rol)", o "Sistema o carga de datos" si no hubo usuario.
export function quienHizo(e: Pick<EventoHistorial, "usuarioNombre" | "usuarioRol">): string {
  return e.usuarioNombre ? `${e.usuarioNombre}${e.usuarioRol ? ` (${e.usuarioRol})` : ""}` : "Sistema o carga de datos"
}

// Detalle extra de algunos eventos (qué cambió en una modificación, etc.).
export function detalleEvento(e: EventoHistorial, tipo: TipoHistorial): string[] {
  const d = e.datos ?? {}
  if (e.evento === "firma_representante" && d.representante)
    return [`${d.representante}${d.tipo === "suplente" ? " (suplente)" : ""}`]
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
  if (tipo === "contratista") {
    if (e.evento === "editado") return lineasCambios(d.cambios)
    if (e.evento === "documento_reemplazado") return [`${textoTipo(d.tipo)}: ${formatoValor(d.archivo)} → ${formatoValor(d.archivo_nuevo)}`]
    if (e.evento === "documento_subido" || e.evento === "documento_quitado") return [`${textoTipo(d.tipo)}: ${formatoValor(d.archivo)}`]
    if (e.evento === "creado" && d.documento) return [String(d.documento)]
    return []
  }
  if (tipo === "contrato" && e.evento === "minuta_guardada") return lineasCambios(d.cambios)
  if (tipo === "entrada") {
    if (e.evento === "registrada" && d.numero != null) return [`Entrada ${d.numero}${d.orden != null ? ` · OC ${d.orden}` : ""}${d.remision ? ` · remisión ${d.remision}` : ""}`]
    if (e.evento === "linea_editada") return [`${formatoValor(d.insumo)}: ${formatoValor(d.de)} → ${formatoValor(d.a)}`]
    if (e.evento === "editada") return lineasCambios(d.cambios)
    return []
  }
  if (tipo === "salida") {
    if (e.evento === "registrada" && d.insumo) return [`${d.insumo}: ${formatoValor(d.cantidad)}${d.retira ? ` · retira ${d.retira}` : ""}`]
    if (e.evento === "editada") return lineasCambios(d.cambios)
    return []
  }
  if (tipo === "solicitud_insumo" || tipo === "solicitud_mano_obra" || tipo === "solicitud_equipo") {
    const lineas: string[] = []
    if (d.descripcion) lineas.push(String(d.descripcion))
    if (d.item) lineas.push(`Ítem ${d.item}`)
    return lineas
  }
  if (tipo === "presupuesto") {
    if (e.evento === "version_creada" || e.evento === "version_descartada") return [`Versión ${formatoValor(d.numero)}: ${formatoValor(d.nombre)}`]
    return [d.proyecto, d.nombre].filter(Boolean).map(String)
  }
  if (tipo === "rol") {
    if (e.evento === "permiso_agregado" || e.evento === "permiso_quitado") {
      return [`${d.rol ? `${d.rol} · ` : ""}${TITULO_PERMISO.get(String(d.permiso)) ?? formatoValor(d.permiso)}`]
    }
    if (e.evento === "renombrado") return [`${formatoValor(d.de)} → ${formatoValor(d.a)}`]
    return d.nombre ? [String(d.nombre)] : []
  }
  if (tipo === "usuario") {
    if (e.evento === "rol_cambiado" || e.evento === "renombrado") return [`${formatoValor(d.de)} → ${formatoValor(d.a)}`]
    if (e.evento === "todos_proyectos") return [d.a ? "Ve todos los proyectos" : "Ya no ve todos los proyectos"]
    if (e.evento === "proyecto_asignado" || e.evento === "proyecto_quitado") return d.proyecto ? [String(d.proyecto)] : []
    if (e.evento === "creado") return [d.nombre, d.rol].filter(Boolean).map(String)
    return []
  }
  if (tipo === "acta") {
    if (e.evento === "aprobada" && d.pago_id) return [`Pago creado en A&F por ${pesosTexto(d.neto)}`]
    if (d.neto != null) return [`Neto a pagar: ${pesosTexto(d.neto)}`]
    return []
  }
  if (tipo === "otrosi") return e.evento === "aprobado" && d.numero ? [`Otrosí N° ${d.numero}`] : []
  // Evento de un otrosí dentro del historial del contrato: cuál y qué cláusulas.
  if (tipo === "contrato" && e.evento.startsWith("otrosi_")) {
    const lineas = [d.otrosi_numero ? `Otrosí N° ${d.otrosi_numero}` : "Otrosí en trámite"]
    if (d.clausulas) lineas.push(`Cláusulas: ${d.clausulas}`)
    return lineas
  }
  if (tipo === "requisicion_admin") {
    if (d.items != null && d.valor != null)
      return [`${d.items} ${d.items === 1 ? "ítem" : "ítems"} · ${pesosTexto(d.valor)}${d.metodo === "pse" ? " · PSE" : ""}`]
    if (e.evento === "aprobada" && d.pagos != null) return [`${d.pagos} ${d.pagos === 1 ? "pago" : "pagos"} al consolidado`]
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
        const def = definicionEvento(tipo, e.evento)
        const detalle = detalleEvento(e, tipo)
        return (
          <li key={e.id} className="flex gap-3 text-sm">
            <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${COLOR_TONO_EVENTO[def.tono]}`} />
            <div className="min-w-0">
              <p className="font-medium">{def.etiqueta}</p>
              <p className="text-xs text-muted-foreground">
                {quienHizo(e)} · {formatoFechaHora(e.createdAt)}
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
