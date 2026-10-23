// Los pagos en Realizar Pagos: el equivalente del cruce (nucleo/cruce.py) y
// del armado de tandas (servidor.py, _tanda / dispersores) de la consola de
// Python, sobre los datos de la app. Lógica pura: la usan el servidor y la
// pantalla (pruebas en tests/dispersores-pagos.test.ts).
//
// Diferencia de fondo con Python (decisión del usuario): allá la cuenta del
// beneficiario se cruzaba contra BASE_TERCEROS porque el consolidado se
// llenaba a mano; aquí la cuenta es SIEMPRE la del pago (la del titular si se
// eligió otro), que ya es un dato estructurado. Por eso "Confirmar cuenta"
// queda para cuentas sin verificar o que cambiaron, y "Bloqueados" para pagos
// sin tercero, sin cuenta o con la cuenta inactiva.

import { aPesos, digitos, paraBanco, pesos, texto } from "@/lib/dispersores/textos"
import { nombreBase, type CuentaDebitar, type Renglon, type Tanda } from "@/lib/dispersores/generador"

export type EstadoDispersor = "listo" | "asignado" | "confirmar" | "bloqueado" | "fuera" | "dispersado"

export const ETIQUETA_ESTADO_DISPERSOR: Record<EstadoDispersor, string> = {
  listo: "Por asignar",
  asignado: "Asignados",
  confirmar: "Confirmar cuenta",
  bloqueado: "Bloqueados",
  fuera: "No van por dispersor",
  dispersado: "Ya dispersados",
}

// Los pasos de la consola y qué estados ve cada uno (DEL_PASO de consola.html).
export const ESTADOS_DEL_PASO: Record<1 | 2, EstadoDispersor[]> = {
  1: ["confirmar", "bloqueado", "fuera"],
  2: ["listo", "asignado", "dispersado"],
}

export type Alerta = { nivel: "BLOQUEA" | "CONFIRMAR" | "AVISO"; mensaje: string; detalle: string }

export type TerceroDispersor = {
  razonSocial: string
  tipoDocumento: string
  numeroDocumento: string
  dv: string
  nombreBanco: string
  nombres: string
  apellidos: string
}

/** Un pago listo para el dispersor (lo que llega de la base, ya leído). */
export type PagoDispersor = {
  id: string
  item: string
  semana: number | null
  anio: number | null
  consolidado: string
  grupo: string // grupo empresarial (empresa del pago)
  proyecto: string
  valorOriginal: number // valor a pagar liquidado (con centavos)
  valor: number // truncado al peso
  estadoPago: string
  esPse: boolean
  fueraManual: boolean
  esNomina: boolean
  // el dueño de la cuenta: el titular si se eligió otro, si no quien factura
  beneficiario: TerceroDispersor | null
  factura: string | null // quien factura (para mostrar)
  cuenta: { banco: string; tipoCuenta: string; numero: string; estado: string; etiqueta: string } | null
  cuentaModificada: boolean
  confirmada: boolean
  cuentaDebitarId: string | null
  // soporte individual del pago en esa tanda (bucket dispersores)
  dispersion: { apodo: string; nombreBase: string; generadoEn: string; soporte: { nombre: string; ruta: string } | null } | null
}

export type PagoConEstado = PagoDispersor & { estado: EstadoDispersor; alertas: Alerta[] }

export function descripcionCuenta(c: NonNullable<PagoDispersor["cuenta"]>): string {
  const base = `${c.banco} · ${c.tipoCuenta.toLowerCase()} · ${c.numero}`
  return c.etiqueta ? `${base} (${c.etiqueta})` : base
}

/** El estado de cada pago (Pago.estado de cruce.py). */
export function conEstado(p: PagoDispersor): PagoConEstado {
  const alertas: Alerta[] = []
  let estado: EstadoDispersor
  if (p.estadoPago === "dispersado" || p.dispersion) {
    estado = "dispersado"
    alertas.push({ nivel: "AVISO", mensaje: "ya se disperso", detalle: p.dispersion ? `en ${p.dispersion.nombreBase} (${p.dispersion.apodo})` : "" })
  } else if (p.esPse) {
    estado = "fuera"
    alertas.push({ nivel: "AVISO", mensaje: "se paga por Pse", detalle: "" })
  } else if (p.fueraManual) {
    estado = "fuera"
    alertas.push({ nivel: "AVISO", mensaje: "se paga por otro medio", detalle: "lo sacaron del dispersor a mano" })
  } else if (!p.beneficiario || !digitos(p.beneficiario.numeroDocumento)) {
    estado = "bloqueado"
    alertas.push({ nivel: "BLOQUEA", mensaje: "el tercero no esta en la base", detalle: "el pago no tiene tercero: asígnele tercero y cuenta" })
  } else if (!p.cuenta || !digitos(p.cuenta.numero)) {
    estado = "bloqueado"
    alertas.push({ nivel: "BLOQUEA", mensaje: "el pago no tiene cuenta", detalle: "asígnele la cuenta del tercero" })
  } else if (p.cuenta.estado === "INACTIVO") {
    estado = "bloqueado"
    alertas.push({ nivel: "BLOQUEA", mensaje: "la cuenta del tercero esta inactiva", detalle: descripcionCuenta(p.cuenta) })
  } else if (p.cuentaModificada || (p.cuenta.estado !== "ACTIVO" && !p.confirmada)) {
    // confirmar quita la marca de "cambió": si vuelve a estar, cambió otra vez
    estado = "confirmar"
    alertas.push({
      nivel: "CONFIRMAR",
      mensaje: p.cuentaModificada ? "la cuenta cambio despues de solicitar el pago" : "la cuenta del tercero esta pendiente de verificar",
      detalle: `${descripcionCuenta(p.cuenta)}. Confirmela.`,
    })
  } else {
    estado = p.cuentaDebitarId ? "asignado" : "listo"
  }
  return { ...p, estado, alertas }
}

/** Asignables: los que pueden recibir cuenta a debitar (Pago.asignable). */
export const esAsignable = (p: PagoConEstado) => p.estado === "listo" || p.estado === "asignado"

export const referencia = (p: Pick<PagoDispersor, "item" | "semana">) => (p.semana ? `ITEM ${p.item} SEMANA ${p.semana}` : "")

/** El registro del archivo (servidor.py, _tanda): todo sale de la cuenta del pago. */
export function renglonDe(p: PagoDispersor): Renglon {
  const t = p.beneficiario!
  const c = p.cuenta!
  return {
    item: p.item,
    documento: digitos(t.numeroDocumento),
    dv: digitos(t.dv),
    tipoDoc: texto(t.tipoDocumento),
    nombre: paraBanco(t.nombreBanco || t.razonSocial),
    nombres: paraBanco(t.nombres),
    apellidos: paraBanco(t.apellidos),
    bancoDestino: texto(c.banco),
    tipoCuenta: texto(c.tipoCuenta),
    cuenta: digitos(c.numero),
    valor: p.valor,
    referencia: referencia(p),
    empresa: texto(p.grupo),
    proyecto: texto(p.proyecto),
  }
}

export type CuentaEmpresa = CuentaDebitar & { id: string; empresa: string }

/** Una cuenta a debitar como la leía bases.leer_cuentas. */
export function cuentaDebitarDe(f: {
  id: string
  apodo: string
  diminutivo: string
  banco: string
  tipo_cuenta: string
  numero_cuenta: string
  nit: string
  dv: string | null
  razon_social: string
  correo_itau: string | null
  empresa: string | null
}): CuentaEmpresa {
  return {
    id: f.id,
    empresa: f.empresa ?? "",
    apodo: texto(f.apodo),
    diminutivo: texto(f.diminutivo),
    banco: texto(f.banco),
    tipoCuenta: texto(f.tipo_cuenta),
    cuenta: digitos(f.numero_cuenta),
    nit: digitos(f.nit),
    dv: digitos(f.dv),
    razonSocial: paraBanco(f.razon_social),
    correoItau: String(f.correo_itau ?? "").trim(),
  }
}

/** Los centavos que se pierden al truncar (servidor.py: f"{perdido:.2f}" si hay). */
export function truncadoDe(pagos: Pick<PagoDispersor, "valorOriginal" | "valor">[]): string {
  const perdido = Math.round(pagos.reduce((a, p) => a + (p.valorOriginal - p.valor), 0) * 100) / 100
  return perdido ? perdido.toFixed(2) : ""
}

export const ordenItem = (a: { item: string }, b: { item: string }) => Number(a.item) - Number(b.item) || a.item.localeCompare(b.item)

export type GrupoTanda = {
  clave: string
  cuenta: CuentaEmpresa
  anio: number | null
  semana: number | null
  esNomina: boolean
  pagos: PagoConEstado[]
}

/** Un dispersor por cuenta a debitar y semana (y aparte la nómina): cada uno es un archivo. */
export function agruparAsignados(pagos: PagoConEstado[], cuentas: Map<string, CuentaEmpresa>): GrupoTanda[] {
  const grupos = new Map<string, GrupoTanda>()
  for (const p of pagos) {
    if (p.estado !== "asignado" || !p.cuentaDebitarId) continue
    const cuenta = cuentas.get(p.cuentaDebitarId)
    if (!cuenta) continue
    const clave = `${cuenta.id}|${p.anio ?? ""}|${p.semana ?? ""}|${p.esNomina ? "NOM" : ""}`
    let g = grupos.get(clave)
    if (!g) {
      g = { clave, cuenta, anio: p.anio, semana: p.semana, esNomina: p.esNomina, pagos: [] }
      grupos.set(clave, g)
    }
    g.pagos.push(p)
  }
  for (const g of grupos.values()) g.pagos.sort(ordenItem)
  // la pantalla las ordena de mayor a menor total, como la consola
  return [...grupos.values()].sort((a, b) => b.pagos.reduce((s, p) => s + p.valor, 0) - a.pagos.reduce((s, p) => s + p.valor, 0))
}

/** La tanda de un grupo (con su secuencia, que sale de las tandas ya hechas). */
export function tandaDe(g: GrupoTanda, fecha: string, secuencia: string): Tanda {
  return {
    cuenta: g.cuenta,
    renglones: g.pagos.map(renglonDe),
    semana: g.semana,
    clasePago: "PROVEEDORES", // la consola nunca cambia la clase de pago
    secuencia,
    fecha,
    esNomina: g.esNomina,
    truncado: truncadoDe(g.pagos),
  }
}

/** "Cuentas confirmadas a mano" del soporte (servidor.py: los pagos con p.confirmada). */
export function cambiosManuales(g: GrupoTanda): string[] {
  return g.pagos
    .filter((p) => p.confirmada && p.cuenta)
    .map((p) => `item ${p.item} · ${texto(p.beneficiario?.razonSocial)} · ${descripcionCuenta(p.cuenta!)}`)
}

export const nombreArchivoGrupo = (g: GrupoTanda) => nombreBase({ cuenta: g.cuenta, semana: g.semana, esNomina: g.esNomina })

export const totalTexto = (pagos: { valor: number }[]) => pesos(pagos.reduce((a, p) => a + p.valor, 0))

export { aPesos }
