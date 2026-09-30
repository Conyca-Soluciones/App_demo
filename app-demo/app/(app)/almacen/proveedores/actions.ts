"use server"

import { createClient } from "@/lib/supabase/server"
import { obtenerUsuarioId, requerirAccion } from "@/lib/permisos"
import {
  COLUMNA_DE_CAMPO,
  validarCampo,
  type CampoEditable,
  type Proveedor,
} from "@/lib/proveedores"

const SELECT_PROVEEDOR =
  "unique_id, id_prov, nombre, tipo_documento, numero_documento, digito_verificacion, tipo_proveedor, estado, nombre_contacto, telefono, correo, ciudad, direccion"

type FilaProveedor = {
  unique_id: string
  id_prov: string | null
  nombre: string
  tipo_documento: string | null
  numero_documento: number | null
  digito_verificacion: number | null
  tipo_proveedor: string | null
  estado: string | null
  nombre_contacto: string | null
  telefono: string | null
  correo: string | null
  ciudad: string | null
  direccion: string | null
}

function mapearProveedor(f: FilaProveedor): Proveedor {
  return {
    uniqueId: f.unique_id,
    idProv: f.id_prov,
    nombre: f.nombre,
    tipoDocumento: f.tipo_documento,
    numeroDocumento: f.numero_documento,
    digitoVerificacion: f.digito_verificacion,
    tipoProveedor: f.tipo_proveedor,
    estado: f.estado,
    nombreContacto: f.nombre_contacto,
    telefono: f.telefono,
    correo: f.correo,
    ciudad: f.ciudad,
    direccion: f.direccion,
  }
}

// Todos los proveedores (~400 filas): se filtran y ordenan en el cliente.
// La visibilidad la decide RLS (proveedores_select: compras o admin).
export async function listarProveedores(): Promise<Proveedor[]> {
  if (!(await obtenerUsuarioId())) throw new Error("No autenticado.")

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("proveedores")
    .select(SELECT_PROVEEDOR)
    .order("nombre", { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []).map(mapearProveedor)
}

// Edita UN campo de un proveedor (edición en línea de la tabla). Mismo
// permiso que la política proveedores_update: acción 'comprar' o admin.
export async function actualizarProveedor(
  uniqueId: string,
  campo: CampoEditable,
  valorCrudo: string
): Promise<Proveedor> {
  await requerirAccion("comprar")

  if (!(campo in COLUMNA_DE_CAMPO)) throw new Error("Campo no editable.")
  const validado = validarCampo(campo, valorCrudo)
  if (!validado.ok) throw new Error(validado.error)

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("proveedores")
    .update({ [COLUMNA_DE_CAMPO[campo]]: validado.valor })
    .eq("unique_id", uniqueId)
    .select(SELECT_PROVEEDOR)

  if (error) throw new Error(error.message)
  // RLS no da error cuando bloquea un UPDATE: simplemente no actualiza filas.
  if (!data || data.length === 0) {
    throw new Error("No se guardó el cambio: el proveedor no existe o no tienes permiso para editarlo.")
  }
  return mapearProveedor(data[0])
}
