"use server"

import { createClient } from "@/lib/supabase/server"
import { obtenerPermisosRol } from "@/lib/permisos"
import { ETIQUETA_TIPO_CUENTA, documentoFormateado } from "@/lib/terceros"
import type { RequisicionAdminDePago } from "@/lib/pagos"

// Lo que se abre con doble clic en un pago de requisición administrativa
// (Consolidado y Aprobación de pagos). La base solo deja leer el ítem si se ve
// su pago (o la requisición completa con Aprobación de pagos).
export async function obtenerRequisicionAdminDePago(itemId: string): Promise<RequisicionAdminDePago> {
  const permisos = await obtenerPermisosRol()
  const ok =
    permisos?.esAdministrador ||
    (!permisos?.sinRol &&
      (permisos?.pestanas.includes("ayf.aprobacion_pagos") || permisos?.pestanas.some((p) => p.startsWith("ayf.consolidado_"))))
  if (!ok) throw new Error("No tienes permiso para ver esta requisición.")

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("requisicion_admin_items")
    .select(
      `factura_nombre, factura_nit, titular_nombre, titular_tipo_documento, titular_documento, concepto, valor, observaciones,
       empresa:empresas(razon_social),
       proyecto:proyectos(codigo, nombre),
       cuenta:terceros_cuentas(numero_cuenta, tipo_cuenta, banco:bancos(nombre)),
       requisicion:requisiciones_admin(numero, metodo, estado, enviada_en, resuelta_en,
         creador:perfiles!requisiciones_admin_creado_por_fkey(nombre))`
    )
    .eq("id", itemId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error("La requisición no existe o no tienes acceso.")
  const f = data as any
  const r = f.requisicion
  return {
    numero: r?.numero ?? null,
    metodo: r?.metodo ?? "",
    estado: r?.estado ?? "",
    creadoPorNombre: r?.creador?.nombre ?? null,
    enviadaEn: r?.enviada_en ?? null,
    resueltaEn: r?.resuelta_en ?? null,
    empresa: f.empresa?.razon_social ?? null,
    facturaNombre: f.factura_nombre,
    facturaNit: f.factura_nit,
    titularNombre: f.titular_nombre,
    titularDocumento: `${f.titular_tipo_documento} ${documentoFormateado({
      tipoDocumento: f.titular_tipo_documento,
      numeroDocumento: f.titular_documento,
      dv: null,
    })}`,
    cuentaTexto: f.cuenta
      ? `${f.cuenta.banco?.nombre ?? ""} · ${ETIQUETA_TIPO_CUENTA[f.cuenta.tipo_cuenta as keyof typeof ETIQUETA_TIPO_CUENTA] ?? f.cuenta.tipo_cuenta} · ${f.cuenta.numero_cuenta}`
      : null,
    concepto: f.concepto,
    proyecto: f.proyecto ? [f.proyecto.codigo, f.proyecto.nombre].filter(Boolean).join(" · ") : null,
    valor: Number(f.valor),
    observaciones: f.observaciones ?? null,
  }
}
