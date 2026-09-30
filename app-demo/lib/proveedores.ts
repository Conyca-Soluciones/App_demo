// ---------------------------------------------------------------------------
// Tipos y reglas de la página de Proveedores (/almacen/proveedores).
// Archivo plano (sin "use server"/"use client") para que lo compartan
// actions.ts y el componente de cliente -- ver la regla del boundary
// cliente/servidor en CLAUDE.md.
// ---------------------------------------------------------------------------

export type Proveedor = {
  uniqueId: string
  idProv: string | null
  nombre: string
  tipoDocumento: string | null
  numeroDocumento: number | null
  digitoVerificacion: number | null
  tipoProveedor: string | null
  estado: string | null
  nombreContacto: string | null
  telefono: string | null
  correo: string | null
  ciudad: string | null
  direccion: string | null
}

// Campos que se pueden editar desde la tabla -> columna real en la base.
export const COLUMNA_DE_CAMPO = {
  nombre: "nombre",
  tipoDocumento: "tipo_documento",
  numeroDocumento: "numero_documento",
  digitoVerificacion: "digito_verificacion",
  tipoProveedor: "tipo_proveedor",
  estado: "estado",
  nombreContacto: "nombre_contacto",
  telefono: "telefono",
  correo: "correo",
  ciudad: "ciudad",
  direccion: "direccion",
} as const

export type CampoEditable = keyof typeof COLUMNA_DE_CAMPO

// Valores que ya existen en la base (se guardan en MAYÚSCULAS).
export const OPCIONES: Partial<Record<CampoEditable, string[]>> = {
  estado: ["ACTIVO", "INACTIVO"],
  tipoDocumento: ["NIT", "CC", "CE"],
  tipoProveedor: ["DIRECTO", "DIRECTO PRECIO", "DIRECTO CREDITO", "NO DIRECTO"],
}

const REGEX_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Normaliza y valida el valor escrito en una celda. Devuelve el valor listo
// para guardar (null = vacío) o un mensaje de error. Se usa en el cliente
// (aviso inmediato) y otra vez en el servidor (no se confía en el cliente).
export function validarCampo(
  campo: CampoEditable,
  crudo: string
): { ok: true; valor: string | number | null } | { ok: false; error: string } {
  const texto = crudo.trim().replace(/\s+/g, " ")

  if (campo === "nombre") {
    return texto ? { ok: true, valor: texto } : { ok: false, error: "El nombre no puede quedar vacío." }
  }
  if (texto === "") return { ok: true, valor: null }

  const opciones = OPCIONES[campo]
  if (opciones) {
    const mayus = texto.toUpperCase()
    return opciones.includes(mayus)
      ? { ok: true, valor: mayus }
      : { ok: false, error: `Valor no válido. Opciones: ${opciones.join(", ")}.` }
  }

  if (campo === "numeroDocumento") {
    const digitos = texto.replace(/[.\s-]/g, "")
    if (!/^\d{1,15}$/.test(digitos)) return { ok: false, error: "Solo números (sin puntos ni guiones)." }
    return { ok: true, valor: Number(digitos) }
  }
  if (campo === "digitoVerificacion") {
    if (!/^\d$/.test(texto)) return { ok: false, error: "El dígito de verificación es un número del 0 al 9." }
    return { ok: true, valor: Number(texto) }
  }
  if (campo === "correo") {
    const correo = texto.toLowerCase()
    return REGEX_CORREO.test(correo) ? { ok: true, valor: correo } : { ok: false, error: "Correo no válido." }
  }
  return { ok: true, valor: texto }
}
