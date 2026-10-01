"use server"

import { createClient } from "@/lib/supabase/server"
import { obtenerUsuarioId, requerirAccion } from "@/lib/permisos"
import { traerTodo } from "@/lib/supabase/traer-todo"
import {
  COLUMNA_DE_CAMPO,
  ETIQUETA_CAMPO,
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
  // Por páginas (ver lib/supabase/traer-todo.ts); unique_id desempata el orden.
  const filas = await traerTodo<FilaProveedor>((desde, hasta) =>
    supabase
      .from("proveedores")
      .select(SELECT_PROVEEDOR)
      .order("nombre", { ascending: true })
      .order("unique_id")
      .range(desde, hasta)
  )
  return filas.map(mapearProveedor)
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

// Siguiente ID tipo "PV0395": el mayor número actual + 1. Los IDs viejos no
// tienen el mismo relleno de ceros ("PV001" y "PV0394" conviven), así que
// se compara el NÚMERO, no el texto. Un solo recorrido: O(n).
function siguienteIdProv(existentes: (string | null)[], saltar: number): string {
  let mayor = 0
  for (const id of existentes) {
    const n = Number((id ?? "").replace(/\D/g, ""))
    if (Number.isFinite(n) && n > mayor) mayor = n
  }
  return `PV${String(mayor + 1 + saltar).padStart(4, "0")}`
}

export type NuevoProveedorInput = Partial<Record<CampoEditable, string>>

// Crea un proveedor. Mismo permiso que editar (acción 'comprar' o admin; la
// política proveedores_insert exige lo mismo en la base). El ID se asigna
// acá; si otra persona creó uno al mismo tiempo, el UNIQUE de id_prov hace
// fallar el INSERT (23505) y se reintenta con el número siguiente.
export async function crearProveedor(input: NuevoProveedorInput): Promise<Proveedor> {
  await requerirAccion("comprar")

  const fila: Record<string, string | number | null> = {}
  for (const campo of Object.keys(COLUMNA_DE_CAMPO) as CampoEditable[]) {
    const crudo = input[campo] ?? ""
    if (campo !== "nombre" && crudo.trim() === "") continue
    const validado = validarCampo(campo, crudo)
    if (!validado.ok) throw new Error(`${ETIQUETA_CAMPO[campo]}: ${validado.error}`)
    fila[COLUMNA_DE_CAMPO[campo]] = validado.valor
  }
  if (!fila.estado) fila.estado = "ACTIVO"

  const supabase = await createClient()

  // Mismo número de documento = casi seguro el mismo proveedor dos veces.
  if (fila.numero_documento !== undefined) {
    const { data: repetido, error: errorRepetido } = await supabase
      .from("proveedores")
      .select("id_prov, nombre")
      .eq("numero_documento", fila.numero_documento)
      .limit(1)
    if (errorRepetido) throw new Error(errorRepetido.message)
    if (repetido && repetido.length > 0) {
      throw new Error(`Ya existe un proveedor con ese número de documento: ${repetido[0].nombre} (${repetido[0].id_prov}).`)
    }
  }

  // Todos los IDs, por páginas: si faltara alguno (límite de filas de la
  // API) el "siguiente" podría repetirse.
  const ids = await traerTodo<{ id_prov: string | null }>((desde, hasta) =>
    supabase.from("proveedores").select("id_prov").order("unique_id").range(desde, hasta)
  )
  const existentes = ids.map((r) => r.id_prov)

  for (let intento = 0; intento < 3; intento++) {
    const { data, error } = await supabase
      .from("proveedores")
      .insert({ ...fila, id_prov: siguienteIdProv(existentes, intento) })
      .select(SELECT_PROVEEDOR)
      .single()

    if (!error) return mapearProveedor(data)
    if (error.code !== "23505") throw new Error(error.message)
  }
  throw new Error("No se pudo asignar un ID al proveedor (muchas personas creando a la vez). Intenta de nuevo.")
}
