// ---------------------------------------------------------------------------
// Representantes legales de las empresas (20261201000000_representantes_legales.sql).
// Cada empresa tiene un principal y puede tener suplentes; los registra
// Subgerencia. Su firma (la de su "Mi firma" si usa la app, o la que sube
// Subgerencia) se pone en el contrato al aprobar la minuta: firma el
// representante cuya cédula está en la minuta.
// ---------------------------------------------------------------------------

export type TipoRepresentante = "principal" | "suplente"
export const TIPOS_DOCUMENTO_REPRESENTANTE = ["CC", "CE", "PPT", "PA"] as const
export type TipoDocumentoRepresentante = (typeof TIPOS_DOCUMENTO_REPRESENTANTE)[number]

export const ETIQUETA_TIPO_REPRESENTANTE: Record<TipoRepresentante, string> = {
  principal: "Principal",
  suplente: "Suplente",
}

export type RepresentanteLegal = {
  id: string
  empresaId: string
  tipo: TipoRepresentante
  nombre: string
  tipoDocumento: TipoDocumentoRepresentante
  numeroDocumento: string
  expedidaEn: string | null
  perfilId: string | null // usa la app: firma con su "Mi firma"
  perfilNombre: string | null
  firmaDeUsuario: boolean
  tieneImagen: boolean
  imagenFirma: string | null // solo en la pantalla de Subgerencia
  activo: boolean
  actualizadoAt: string
}

export type EmpresaConRepresentantes = { id: string; razonSocial: string; nit: string | null; representantes: RepresentanteLegal[] }

export type DatosRepresentante = {
  tipo: TipoRepresentante
  nombre: string
  tipoDocumento: TipoDocumentoRepresentante
  numeroDocumento: string
  expedidaEn: string
  perfilId: string | null
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapRepresentante(r: any): RepresentanteLegal {
  return {
    id: String(r.id),
    empresaId: String(r.empresa_id),
    tipo: r.tipo === "suplente" ? "suplente" : "principal",
    nombre: String(r.nombre ?? ""),
    tipoDocumento: TIPOS_DOCUMENTO_REPRESENTANTE.includes(r.tipo_documento) ? r.tipo_documento : "CC",
    numeroDocumento: String(r.numero_documento ?? ""),
    expedidaEn: r.expedida_en ?? null,
    perfilId: r.perfil_id ?? null,
    perfilNombre: r.perfil_nombre ?? null,
    firmaDeUsuario: Boolean(r.firma_de_usuario),
    tieneImagen: Boolean(r.tiene_imagen),
    imagenFirma: typeof r.imagen_firma === "string" ? r.imagen_firma : null,
    activo: r.activo !== false,
    actualizadoAt: String(r.actualizado_at ?? ""),
  }
}

export function mapEmpresasRepresentantes(crudo: unknown): EmpresaConRepresentantes[] {
  return (Array.isArray(crudo) ? crudo : []).map((e: any) => ({
    id: String(e.id),
    razonSocial: String(e.razon_social ?? ""),
    nit: e.nit ?? null,
    representantes: (Array.isArray(e.representantes) ? e.representantes : []).map(mapRepresentante),
  }))
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Con qué firma: la de su usuario (si la registró) o la subida por Subgerencia.
export function origenFirmaRepresentante(r: RepresentanteLegal): "usuario" | "subida" | null {
  if (r.perfilId && r.firmaDeUsuario) return "usuario"
  if (r.tieneImagen) return "subida"
  return null
}

export const soloDigitos = (s: string) => s.replace(/\D/g, "")

export function validarRepresentante(d: DatosRepresentante): string | null {
  if (d.nombre.trim().length < 3) return "Escribe el nombre del representante."
  const doc = soloDigitos(d.numeroDocumento)
  if (doc.length < 4 || doc.length > 15) return "El número de documento debe tener solo números (4 a 15)."
  return null
}

// El principal activo de una empresa (el que llena la minuta).
export function principalActivo(reps: RepresentanteLegal[]): RepresentanteLegal | null {
  return reps.find((r) => r.activo && r.tipo === "principal") ?? null
}

// ---------------------------------------------------------------- quién firma un contrato
export type FirmaRepresentanteContrato =
  | { estado: "sin_registro" }
  | { estado: "no_coincide"; empresa: string; minutaNombre: string | null; minutaDocumento: string | null }
  | { estado: "ok" | "sin_firma"; nombre: string; tipo: TipoRepresentante; empresa: string }

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapFirmaRepresentante(v: any): FirmaRepresentanteContrato {
  if (v?.estado === "no_coincide")
    return { estado: "no_coincide", empresa: String(v.empresa ?? ""), minutaNombre: v.minuta_nombre ?? null, minutaDocumento: v.minuta_documento ?? null }
  if (v?.estado === "ok" || v?.estado === "sin_firma")
    return { estado: v.estado, nombre: String(v.nombre ?? ""), tipo: v.tipo === "suplente" ? "suplente" : "principal", empresa: String(v.empresa ?? "") }
  return { estado: "sin_registro" }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Texto para Subgerencia antes de aprobar. bloquea = la base no dejará aprobar.
export function textoFirmaRepresentante(f: FirmaRepresentanteContrato): { texto: string; bloquea: boolean } {
  switch (f.estado) {
    case "ok":
      return { texto: `Al aprobar se pone la firma de ${f.nombre} (representante legal${f.tipo === "suplente" ? " suplente" : ""} de ${f.empresa}).`, bloquea: false }
    case "sin_firma":
      return { texto: `${f.nombre}, representante legal de ${f.empresa}, no tiene firma: súbela en Contratos › Representantes legales antes de aprobar.`, bloquea: true }
    case "no_coincide":
      return {
        texto: `El representante de la minuta (${[f.minutaNombre, f.minutaDocumento && `C.C. ${f.minutaDocumento}`].filter(Boolean).join(", ") || "sin datos"}) no está registrado en ${f.empresa}: regístralo en Representantes legales o devuelve la minuta a Jurídica.`,
        bloquea: true,
      }
    default:
      return { texto: "La empresa no tiene representantes legales registrados: el contrato se aprueba sin su firma.", bloquea: false }
  }
}
