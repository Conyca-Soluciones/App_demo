import { pesos } from "@/lib/contratos"
import type { OrigenDato } from "@/lib/minuta-mano-obra"
import { mapContratoPoliza, mapPoliza, type ContratoPoliza, type Poliza } from "@/lib/polizas"

// ---------------------------------------------------------------------------
// Acta de aprobación de pólizas (plantilla GJ-F-013 versión 03, 23/06/2026).
// Sale prellenada con lo que ya está en el sistema y cada dato se edita; se
// guarda en contrato_polizas.acta_datos y queda fija al aprobar la póliza
// (supabase/migrations/20261127000000_acta_poliza.sql). El texto fijo está en
// components/acta-poliza-pdf.tsx.
// ---------------------------------------------------------------------------

export type AmparoActaPoliza = { amparo: string; valor: string; vigencia: string }

export type ActaPoliza = {
  numeroContrato: string
  supervisorNombre: string // "PARA:" — por defecto el director que pidió el contrato
  correo: string // "Correo electrónico del proyecto" — por defecto el del director
  objeto: string
  empresaNombre: string
  contratistaNombre: string
  aseguradora: string
  amparos: AmparoActaPoliza[]
  soportePago: string // "Certificado de pago de la póliza"
  fechaAprobacion: string // AAAA-MM-DD
  asesorNombre: string
  asesorCargo: string
}

export const CARGO_ASESOR_PLANTILLA = "ASESORA JURÍDICA"
export const EMPRESA_PLANTILLA = "CONYCA SOLUCIONES SAS"
export const ENCABEZADO_ACTA_POLIZA = { formato: "ACTA DE APROBACIÓN DE POLIZAS", codigo: "GJ-F-013", version: "03", fecha: "23/06/2026" }

// Página de control de la plantilla (fija).
export const CONTROL_ACTA_POLIZA = {
  firmas: [
    ["", "ELABORÓ", "APROBÓ"],
    ["NOMBRE:", "Diana Marcela Pérez M", "Luz Angela Tuirán Diaz"],
    ["CARGO:", "Coordinación Jurídica", "Coordinadora SIG"],
    ["FECHA:", "23/06/2026", "23/06/2026"],
  ],
  versiones: [
    ["01", "28/02/2023", "Emisión y Aprobación del documento."],
    ["02", "21/09/2024", "Actualización de campos para la digitalización de datos."],
    ["03", "23/06/2026", "Actualización de campos para la digitalización de datos."],
  ],
}

// Lo que devuelve datos_acta_poliza.
export type DatosActaPoliza = {
  poliza: Poliza
  contrato: ContratoPoliza
  empresaNombre: string | null
  directorNombre: string | null
  directorCorreo: string | null
  contratoMinuta: unknown
  actaDatos: unknown
  actaActualizadaAt: string | null
  actaActualizadaPorNombre: string | null
  usuarioNombre: string | null
}

type Fila = Record<string, unknown>
const textoONulo = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v))

export function mapDatosActaPoliza(x: Fila): DatosActaPoliza {
  return {
    poliza: mapPoliza(x),
    contrato: mapContratoPoliza((x.contrato ?? {}) as Fila),
    empresaNombre: textoONulo(x.empresa_nombre),
    directorNombre: textoONulo(x.director_nombre),
    directorCorreo: textoONulo(x.director_correo),
    contratoMinuta: x.contrato_minuta ?? null,
    actaDatos: x.acta_datos ?? null,
    actaActualizadaAt: textoONulo(x.acta_actualizada_at),
    actaActualizadaPorNombre: textoONulo(x.acta_actualizada_por_nombre),
    usuarioNombre: textoONulo(x.usuario_nombre),
  }
}

const numeroDe = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."))
  return Number.isFinite(n) ? n : null
}

// Amparos de la minuta del contrato (amparo, %, vigencia) -> valor asegurado
// sobre el valor vigente del contrato.
export function amparosDesdeMinuta(minuta: unknown, valorContrato: number): AmparoActaPoliza[] {
  const lista = minuta && typeof minuta === "object" && !Array.isArray(minuta) ? (minuta as Fila).amparos : null
  if (!Array.isArray(lista)) return []
  const r: AmparoActaPoliza[] = []
  for (const a of lista) {
    if (!a || typeof a !== "object") continue
    const f = a as Fila
    const amparo = String(f.amparo ?? "").trim()
    if (!amparo) continue
    const pct = numeroDe(f.porcentaje)
    r.push({
      amparo: pct !== null ? `${amparo} (${String(f.porcentaje).trim()} %)` : amparo,
      valor: pct !== null && valorContrato > 0 ? pesos(Math.round(valorContrato * pct) / 100) : "",
      vigencia: String(f.vigencia ?? "").trim(),
    })
  }
  return r
}

export function actaPolizaPorDefecto(d: DatosActaPoliza, hoy: string): ActaPoliza {
  const c = d.contrato
  const amparos = amparosDesdeMinuta(d.contratoMinuta, c.valor)
  return {
    numeroContrato: c.numeroContrato,
    supervisorNombre: d.directorNombre ?? "",
    correo: d.directorCorreo ?? "",
    objeto: c.objeto,
    empresaNombre: d.empresaNombre ?? EMPRESA_PLANTILLA,
    contratistaNombre: c.contratista.nombre,
    aseguradora: "",
    amparos: amparos.length > 0 ? amparos : [{ amparo: "", valor: "", vigencia: "" }],
    soportePago: "",
    // Aprobada: la fecha en que se aprobó; si no, hoy.
    fechaAprobacion: d.poliza.resueltaAt && d.poliza.estado === "aprobada" ? d.poliza.resueltaAt.slice(0, 10) : hoy,
    asesorNombre: (d.poliza.estado === "aprobada" ? d.poliza.resueltaPorNombre : d.usuarioNombre) ?? "",
    asesorCargo: CARGO_ASESOR_PLANTILLA,
  }
}

// Lo guardado gana campo por campo; lo que no sea del tipo esperado se ignora.
export function mezclarActaPoliza(defecto: ActaPoliza, guardada: unknown): ActaPoliza {
  if (!guardada || typeof guardada !== "object" || Array.isArray(guardada)) return defecto
  const g = guardada as Fila
  const r: ActaPoliza = { ...defecto }
  for (const clave of Object.keys(defecto) as (keyof ActaPoliza)[]) {
    if (!(clave in g)) continue
    const v = g[clave]
    if (clave === "amparos") {
      if (Array.isArray(v))
        r.amparos = v
          .filter((x): x is Fila => Boolean(x) && typeof x === "object")
          .map((x) => ({ amparo: String(x.amparo ?? ""), valor: String(x.valor ?? ""), vigencia: String(x.vigencia ?? "") }))
    } else if (clave !== "numeroContrato" && typeof v === "string") {
      ;(r as Record<string, unknown>)[clave] = v
    }
  }
  return r
}

// Lo que se guarda: sin espacios de más y sin filas de amparo vacías.
export function limpiarActaPoliza(a: ActaPoliza): ActaPoliza {
  const t = (s: string) => s.trim()
  return {
    numeroContrato: a.numeroContrato,
    supervisorNombre: t(a.supervisorNombre),
    correo: t(a.correo),
    objeto: t(a.objeto),
    empresaNombre: t(a.empresaNombre),
    contratistaNombre: t(a.contratistaNombre),
    aseguradora: t(a.aseguradora),
    amparos: a.amparos
      .map((x) => ({ amparo: t(x.amparo), valor: t(x.valor), vigencia: t(x.vigencia) }))
      .filter((x) => x.amparo || x.valor || x.vigencia),
    soportePago: t(a.soportePago),
    fechaAprobacion: t(a.fechaAprobacion),
    asesorNombre: t(a.asesorNombre),
    asesorCargo: t(a.asesorCargo),
  }
}

// Antes de aprobar (la base exige aseguradora y un amparo; aquí también lo demás que sale en el acta).
export function validarActaPoliza(a: ActaPoliza): string | null {
  const l = limpiarActaPoliza(a)
  if (!l.supervisorNombre) return "Escribe el supervisor (PARA)."
  if (!l.objeto) return "Escribe el objeto del contrato."
  if (!l.contratistaNombre) return "Escribe el nombre del contratista."
  if (!l.aseguradora) return "Escribe la aseguradora que expidió la póliza."
  if (!l.amparos.some((x) => x.amparo)) return "Escribe al menos un amparo de la póliza."
  if (l.amparos.some((x) => !x.amparo)) return "Cada amparo necesita su nombre."
  if (!/^\d{4}-\d{2}-\d{2}$/.test(l.fechaAprobacion)) return "Escoge la fecha de aprobación."
  if (!l.asesorNombre) return "Escribe el nombre del asesor jurídico que firma."
  return null
}

const CAMPOS_PLANTILLA = new Set<keyof ActaPoliza>(["asesorCargo"])
export function origenCampoActaPoliza(clave: keyof ActaPoliza, actual: string, defecto: ActaPoliza): OrigenDato {
  if (!actual.trim()) return "vacio"
  const inicial = defecto[clave]
  if (typeof inicial !== "string" || actual !== inicial) return "editado"
  return CAMPOS_PLANTILLA.has(clave) ? "plantilla" : "solicitud"
}

export const nombreArchivoActaPoliza = (numeroContrato: string) =>
  `acta-aprobacion-poliza-${numeroContrato}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") + ".pdf"
