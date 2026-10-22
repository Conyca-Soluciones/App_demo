// ---------------------------------------------------------------------------
// Motor de sugerencias de la liquidación de pagos (A&F). Lógica pura: sin
// servidor ni base, lo usan la pantalla de Liquidación y las pruebas (incluida
// la prueba contra las semanas 31-42 que liquidó Contabilidad a mano).
//
// Cada línea sugerida dice qué regla la produjo. Orden de las reglas (la
// primera que aplica gana), sacado de lo que hizo Contabilidad:
//   1. Anticipo: sin retenciones (se retiene la factura completa al final).
//   2. La empresa que paga no practica esa retención (empresas_retenciones).
//   3. El tercero: autorretenedor / régimen simple / gran contribuyente.
//   4. Lo que Contabilidad decidió para este documento (memoria): concepto y
//      tarifa de retefuente, tarifa de ICA por municipio, ReteIVA.
//   5. El origen del pago: categoría de los insumos de la OC o tipo de
//      contrato del acta -> concepto del catálogo.
//   6. Catálogo + perfil del RUT: tarifa de declarante / no declarante /
//      jurídica, ZOMAC a la mitad, base mínima en UVT (honorarios de persona
//      natural: tabla del art. 383, nada por debajo de 95 UVT).
// La base vuelve a calcular cada valor al guardar (liquidar_pago): base ×
// tarifa redondeado al peso, igual que valorLinea.
// ---------------------------------------------------------------------------

export type TipoPersona = "natural" | "juridica"
export type TipoLinea = "retefuente" | "reteica" | "reteiva" | "descuento"
export type TipoRetencion = Exclude<TipoLinea, "descuento">

export type ConceptoRetencion = {
  clave: string
  nombre: string
  tarifaDeclarante: number
  tarifaNoDeclarante: number
  tarifaJuridica: number | null
  baseUvt: number
  naturalTabla383: boolean
  actividadIca: string | null
}

export type ActividadIca = { clave: string; nombre: string; usaBase: "compras" | "servicios" | "profesionales" }

export type CatalogoLiquidacion = {
  uvt: Record<string, number>
  conceptos: ConceptoRetencion[]
  actividades: ActividadIca[]
}

export type PerfilTributario = {
  tipoPersona: TipoPersona
  declarante: boolean
  responsableIva: boolean
  regimenSimple: boolean
  autorretenedor: boolean
  granContribuyente: boolean
  zomac: boolean
  ciiuPrincipal: string | null
  // Domicilio del RUT: el ICA se practica (casi siempre) solo a terceros del
  // municipio de la obra.
  municipioRut: string | null
  fechaRut: string | null
  estado: "PENDIENTE" | "VERIFICADO"
  alerta: string | null
}

export type PreferenciaLiquidacion = {
  tipo: TipoRetencion
  municipioId: string | null
  concepto: string | null
  actividad: string | null
  tarifa: number
  veces: number
  origen: "historial" | "contabilidad"
}

// De dónde sale el pago. 'texto' = el concepto ya clasificado (fuentes sin
// estructura y la prueba contra el cuadro de Contabilidad); null = sin retención.
export type OrigenPago =
  | { fuente: "orden_compra"; categorias: Record<string, number> }
  | { fuente: "acta"; contratoTipo: string | null; contratoClase: string | null }
  | { fuente: "texto"; concepto: string | null }

export type MunicipioIca = {
  id: string
  nombre: string
  baseCompras: number | null
  baseServicios: number | null
  baseProfesionales: number | null
  tarifas: Record<string, number>
}

export type ContextoPago = {
  tipo: "unico" | "anticipo" | "saldo"
  anio: number
  valor: number
  valorDocumento: number | null
  baseGravable: number | null
  iva: number | null
  tercero: { documento: string; tipoDocumento: string; razonSocial: string } | null
  perfil: PerfilTributario | null
  empresa: { agenteRetefuente: boolean; agenteReteiva: boolean; confirmado: boolean } | null
  empresaIca: boolean
  municipio: MunicipioIca | null
  preferencias: PreferenciaLiquidacion[]
  origen: OrigenPago
  retefuenteAnticipos: number
}

export type LineaLiquidacion = {
  tipo: TipoLinea
  concepto: string | null // retefuente
  municipioId: string | null // reteica
  actividad: string | null // reteica
  descripcion: string | null
  base: number | null // null en descuentos
  tarifa: number | null // fracción (0.025); null en descuentos
  valor: number // descuentos: lo que se escribe; retenciones: base × tarifa
  asumida: boolean
  regla: string | null
  editada: boolean
}

export type AvisoLiquidacion = { nivel: "revisar" | "info"; texto: string }

export type SugerenciaLiquidacion = { lineas: LineaLiquidacion[]; avisos: AvisoLiquidacion[] }

export const TARIFA_RETEIVA = 0.15

export const ETIQUETA_TIPO_LINEA: Record<TipoLinea, string> = {
  retefuente: "Retefuente",
  reteica: "ReteICA",
  reteiva: "ReteIVA",
  descuento: "Descuento",
}

// ------------------------------------------------------------- cálculos

// Base × tarifa al peso (como round() de Postgres para positivos). toFixed
// quita el ruido de coma flotante antes de redondear.
export function valorLinea(l: Pick<LineaLiquidacion, "tipo" | "base" | "tarifa" | "valor">): number {
  if (l.tipo === "descuento") return Math.round(l.valor)
  if (l.base == null || l.tarifa == null) return 0
  return Math.round(Number((l.base * l.tarifa).toFixed(6)))
}

export type TotalesLiquidacion = {
  retefuente: number
  reteica: number
  reteiva: number
  asumidas: number
  descuentos: number
  neto: number
}

// Mismo cálculo que liquidar_pago: las retenciones incluyen las asumidas, que
// no bajan el neto.
export function totalesLiquidacion(valorPago: number, lineas: LineaLiquidacion[]): TotalesLiquidacion {
  const t = { retefuente: 0, reteica: 0, reteiva: 0, asumidas: 0, descuentos: 0, neto: 0 }
  for (const l of lineas) {
    const v = valorLinea(l)
    if (l.tipo === "descuento") t.descuentos += v
    else {
      t[l.tipo] += v
      if (l.asumida) t.asumidas += v
    }
  }
  t.neto = valorPago - (t.retefuente + t.reteica + t.reteiva - t.asumidas) - t.descuentos
  return t
}

export function uvtDelAnio(cat: CatalogoLiquidacion, anio: number): number | null {
  const exacto = cat.uvt[String(anio)]
  if (exacto) return exacto
  const anios = Object.keys(cat.uvt).map(Number).filter((a) => a <= anio)
  return anios.length > 0 ? cat.uvt[String(Math.max(...anios))] : null
}

export function tarifaRetefuente(c: ConceptoRetencion, persona: TipoPersona, declarante: boolean, zomac: boolean): number {
  let t = persona === "juridica" && c.tarifaJuridica != null ? c.tarifaJuridica : declarante ? c.tarifaDeclarante : c.tarifaNoDeclarante
  if (zomac) t = t / 2
  return Number(t.toFixed(6))
}

// "Bogotá D.C." y "BOGOTA" son el mismo municipio.
const claveMunicipio = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z]/g, "").replace(/DC$/, "")
export function mismoMunicipio(a: string, b: string): boolean {
  const x = claveMunicipio(a)
  const y = claveMunicipio(b)
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x))
}

const pesos = (n: number) => n.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })
const porcentaje = (t: number) => `${(t * 100).toLocaleString("es-CO", { maximumFractionDigits: 3 })} %`

// Categoría del insumo (letra de maestro_insumos.tipo) -> concepto.
const CONCEPTO_POR_CATEGORIA: Record<string, string> = {
  T: "transporte_carga",
  Q: "servicios",
  S: "construccion",
  H: "honorarios",
  F: "consultoria_obra",
  B: "arrendamiento_muebles",
}

// Concepto escrito (pagos sin OC ni acta: requisiciones administrativas) ->
// concepto del catálogo; null = no lleva retefuente (nómina, impuestos,
// servicios públicos, pólizas...). Mismas reglas que la prueba contra el
// cuadro de Contabilidad (`scripts/generar_datos_liquidacion.py`, REGLAS_TEXTO);
// la primera que aplica gana, y sin ninguna es compras.
const REGLAS_CONCEPTO_TEXTO: [string | null, RegExp][] = [
  [
    null,
    /N[OÓ]MINA|SEGURIDAD\s+SOCIAL|PLANILLA|PRESTACIONES|LIQUIDACI[OÓ]N\b|\bRT\b|AUTO ?RENTA|DIAN|IMPUESTO|ACUEDUCTO|ALCANTARILLADO|ENERG[IÍ]A|\bLUZ\b|GASES|INTERNET|TELEFON|CELULAR|P[OÓ]LIZA|SOAT|SEGURO|CAJA MENOR|REEMBOLSO|PEAJE|PR[EÉ]STAMO/,
  ],
  ["combustibles", /COMBUSTIBLE|DIESEL|GASOLINA|ACPM/],
  ["honorarios", /SERVICIOS? PROFESIONAL|HONORARIO|ASESOR[IÍ]A|CONSULTOR|TOPOGRAF|AVAL[UÚ]O|DICTAMEN|RETIE|INTERVENTOR|DISE[NÑ]O/],
  ["transporte_carga", /TRANSPORTE|FLETE|ACARREO|MOTOCARRO|VOLQUETA|RECOLECCI/],
  ["arrendamiento_inmuebles", /CANON|ARRIENDO|ARRENDAMIENTO/],
  ["arrendamiento_muebles", /ALQUILER/],
  ["hoteles_restaurantes", /HOSPEDAJE|HOTEL|ALOJAMIENTO|ALIMENTACI[OÓ]N|RESTAURANTE/],
  ["construccion", /MANO DE OBRA|CORTE (DE|FINAL)|\bOBRA\b|OBRAS|ACTA|INSTALACI[OÓ]N/],
  ["servicios", /SERVICIO|MANTENIMIENTO|ARREGLO|REPARACI|EX[AÁ]MEN/],
]

export function conceptoDesdeTexto(texto: string | null): string | null {
  const t = (texto ?? "").toUpperCase()
  for (const [concepto, rx] of REGLAS_CONCEPTO_TEXTO) if (rx.test(t)) return concepto
  return "compras"
}

// Tipo de contrato (contratos.tipo) -> concepto.
const CONCEPTO_POR_CONTRATO: Record<string, string> = {
  obra: "construccion",
  mano_obra: "construccion",
  suministro_instalacion: "construccion",
  alquiler_vehiculo: "arrendamiento_muebles",
  arrendamiento: "arrendamiento_inmuebles",
  servicios: "servicios",
  otro: "servicios",
}

export function conceptoPorOrigen(origen: OrigenPago, persona: TipoPersona): { concepto: string | null; regla: string } {
  if (origen.fuente === "texto") {
    return { concepto: origen.concepto, regla: "Por el concepto del pago" }
  }
  if (origen.fuente === "acta") {
    if (origen.contratoTipo === "prestacion_servicios") {
      return {
        concepto: persona === "natural" ? "honorarios" : "servicios",
        regla: "Acta de un contrato de prestación de servicios",
      }
    }
    const c = (origen.contratoTipo && CONCEPTO_POR_CONTRATO[origen.contratoTipo]) || "construccion"
    return { concepto: c, regla: `Acta de un contrato de ${(origen.contratoTipo ?? "obra").replace(/_/g, " ")}` }
  }
  // OC: la categoría con más valor manda.
  let mejor: string | null = null
  let max = -1
  for (const [cat, valor] of Object.entries(origen.categorias)) {
    if (valor > max) {
      max = valor
      mejor = cat
    }
  }
  const c = (mejor && CONCEPTO_POR_CATEGORIA[mejor]) || "compras"
  return { concepto: c, regla: c === "compras" ? "Orden de compra de materiales" : "Por la categoría de los insumos de la orden de compra" }
}

function linea(parcial: Partial<LineaLiquidacion> & Pick<LineaLiquidacion, "tipo">): LineaLiquidacion {
  const l: LineaLiquidacion = {
    concepto: null,
    municipioId: null,
    actividad: null,
    descripcion: null,
    base: null,
    tarifa: null,
    valor: 0,
    asumida: false,
    regla: null,
    editada: false,
    ...parcial,
  }
  l.valor = valorLinea(l)
  return l
}

// ------------------------------------------------------------- el motor

export function sugerirLiquidacion(ctx: ContextoPago, cat: CatalogoLiquidacion): SugerenciaLiquidacion {
  const lineas: LineaLiquidacion[] = []
  const avisos: AvisoLiquidacion[] = []
  const conceptos = new Map(cat.conceptos.map((c) => [c.clave, c]))
  const actividades = new Map(cat.actividades.map((a) => [a.clave, a]))
  const pref = (tipo: TipoRetencion, municipioId: string | null = null) =>
    ctx.preferencias.find((p) => p.tipo === tipo && (tipo !== "reteica" || p.municipioId === municipioId)) ?? null

  const perfil = ctx.perfil
  const persona: TipoPersona =
    perfil?.tipoPersona ?? (ctx.tercero?.tipoDocumento === "NIT" ? "juridica" : "natural")
  const declarante = perfil?.declarante ?? persona === "juridica"
  if (!ctx.tercero) {
    avisos.push({ nivel: "revisar", texto: "El pago no tiene tercero: asígnalo antes de liquidar." })
    return { lineas, avisos }
  }
  if (!perfil) {
    avisos.push({
      nivel: "revisar",
      texto: `El tercero no tiene perfil tributario (falta el RUT): se supone persona ${persona}${
        persona === "natural" ? (declarante ? " declarante" : " no declarante") : ""
      }, sin régimen simple ni autorretención.`,
    })
  } else if (perfil.alerta) {
    avisos.push({ nivel: "revisar", texto: `RUT: ${perfil.alerta}` })
  }
  if (ctx.empresa && !ctx.empresa.confirmado) {
    avisos.push({ nivel: "info", texto: "Lo que retiene la empresa que paga está inferido del historial: confírmalo en Retenciones." })
  }

  if (ctx.tipo === "anticipo") {
    avisos.push({ nivel: "info", texto: "Anticipo: se sugiere sin retenciones (se retiene la factura completa en el saldo)." })
    return { lineas, avisos }
  }

  const uvt = uvtDelAnio(cat, ctx.anio)
  if (!uvt) avisos.push({ nivel: "revisar", texto: `No hay UVT para ${ctx.anio}: no se revisan las bases mínimas.` })
  const base = ctx.baseGravable ?? ctx.valorDocumento ?? ctx.valor

  // Concepto: el que Contabilidad le confirmó al tercero, si no el del origen.
  const prefRf = pref("retefuente")
  const porOrigen = conceptoPorOrigen(ctx.origen, persona)
  const conceptoClave = prefRf?.concepto ?? porOrigen.concepto
  const concepto = conceptoClave ? (conceptos.get(conceptoClave) ?? null) : null
  if (conceptoClave && !concepto) avisos.push({ nivel: "revisar", texto: `El concepto "${conceptoClave}" no está en el catálogo.` })

  // ---- Retefuente
  if (ctx.empresa && !ctx.empresa.agenteRetefuente) {
    avisos.push({ nivel: "info", texto: "La empresa que paga no practica retención en la fuente." })
  } else if (perfil?.autorretenedor) {
    avisos.push({ nivel: "info", texto: "El tercero es autorretenedor: sin retefuente." })
  } else if (perfil?.regimenSimple) {
    avisos.push({ nivel: "info", texto: "El tercero es del régimen simple: sin retefuente." })
  } else if (prefRf && prefRf.tarifa === 0) {
    avisos.push({ nivel: "info", texto: "Contabilidad no le practica retefuente a este tercero." })
  } else if (!concepto) {
    if (!conceptoClave) avisos.push({ nivel: "info", texto: "El concepto del pago no lleva retención en la fuente." })
  } else {
    const minimo = concepto.naturalTabla383 && persona === "natural" ? 95 : concepto.baseUvt
    if (uvt && base < minimo * uvt) {
      avisos.push({
        nivel: "info",
        texto: `Retefuente: la base ${pesos(base)} no llega a la mínima de ${concepto.nombre.toLowerCase()} (${minimo} UVT = ${pesos(minimo * uvt)}).`,
      })
    } else {
      const usaPref = prefRf != null && prefRf.concepto === concepto.clave && prefRf.tarifa > 0
      const tarifa = usaPref ? prefRf.tarifa : tarifaRetefuente(concepto, persona, declarante, perfil?.zomac ?? false)
      lineas.push(
        linea({
          tipo: "retefuente",
          concepto: concepto.clave,
          base,
          tarifa,
          regla: usaPref
            ? `Lo que Contabilidad le liquidó a este tercero (${prefRf.veces} ${prefRf.veces === 1 ? "vez" : "veces"}): ${concepto.nombre}, ${porcentaje(tarifa)}`
            : `${porOrigen.regla}: ${concepto.nombre}, ${porcentaje(tarifa)} (${persona === "juridica" ? "persona jurídica" : declarante ? "declarante" : "no declarante"}${perfil?.zomac ? ", ZOMAC a la mitad" : ""})`,
        })
      )
      if (ctx.retefuenteAnticipos > 0) {
        avisos.push({
          nivel: "revisar",
          texto: `En los anticipos de esta orden ya se retuvieron ${pesos(ctx.retefuenteAnticipos)}: réstalos de la base o agrega el descuento.`,
        })
      }
    }
  }

  // ---- ReteIVA: régimen simple responsable de IVA, 15 % del IVA.
  const iva = ctx.iva ?? 0
  if (iva > 0 && perfil?.regimenSimple && perfil.responsableIva) {
    const prefIva = pref("reteiva")
    if (ctx.empresa && !ctx.empresa.agenteReteiva) {
      avisos.push({ nivel: "info", texto: "La empresa que paga no practica ReteIVA." })
    } else if (prefIva && prefIva.tarifa === 0) {
      avisos.push({ nivel: "info", texto: "Contabilidad no le practica ReteIVA a este tercero." })
    } else {
      const tarifa = prefIva && prefIva.tarifa > 0 ? prefIva.tarifa : TARIFA_RETEIVA
      lineas.push(
        linea({
          tipo: "reteiva",
          base: iva,
          tarifa,
          regla: `Régimen simple responsable de IVA: ${porcentaje(tarifa)} del IVA`,
        })
      )
    }
  }

  // ---- ReteICA: municipio del proyecto × actividad.
  const mun = ctx.municipio
  if (!mun) {
    if (ctx.empresaIca) avisos.push({ nivel: "revisar", texto: "El proyecto no tiene municipio de ICA asignado." })
  } else if (!ctx.empresaIca) {
    avisos.push({ nivel: "info", texto: `La empresa que paga no practica ReteICA en ${mun.nombre}.` })
  } else if (perfil?.autorretenedor || perfil?.granContribuyente) {
    avisos.push({ nivel: "info", texto: "El tercero es autorretenedor o gran contribuyente: sin ReteICA." })
  } else if (perfil?.regimenSimple) {
    avisos.push({ nivel: "info", texto: "El tercero es del régimen simple: sin ReteICA." })
  } else {
    const prefIca = pref("reteica", mun.id)
    const deFuera = perfil?.municipioRut != null && !mismoMunicipio(perfil.municipioRut, mun.nombre)
    if (prefIca && prefIca.tarifa === 0) {
      avisos.push({ nivel: "info", texto: `Contabilidad no le practica ReteICA a este tercero en ${mun.nombre}.` })
    } else if (deFuera && !(prefIca && prefIca.tarifa > 0)) {
      avisos.push({
        nivel: "info",
        texto: `El tercero está en ${perfil!.municipioRut} según su RUT, no en ${mun.nombre}: no se sugiere ReteICA (agrégala si el servicio se presta allá).`,
      })
    } else {
      const actividadClave = prefIca?.actividad ?? concepto?.actividadIca ?? "compras"
      const tarifa = prefIca && prefIca.tarifa > 0 ? prefIca.tarifa : mun.tarifas[actividadClave]
      const act = actividades.get(actividadClave)
      if (tarifa == null) {
        avisos.push({ nivel: "revisar", texto: `${mun.nombre} no tiene tarifa de ICA para ${act?.nombre ?? actividadClave}.` })
      } else {
        const minimo =
          act?.usaBase === "compras"
            ? mun.baseCompras
            : act?.usaBase === "profesionales"
              ? (mun.baseProfesionales ?? mun.baseServicios)
              : mun.baseServicios
        if (minimo != null && base < minimo) {
          avisos.push({ nivel: "info", texto: `ReteICA: la base ${pesos(base)} no llega a la mínima de ${mun.nombre} (${pesos(minimo)}).` })
        } else {
          lineas.push(
            linea({
              tipo: "reteica",
              municipioId: mun.id,
              actividad: actividadClave,
              base,
              tarifa,
              regla:
                prefIca && prefIca.tarifa > 0
                  ? `Lo que Contabilidad le liquidó a este tercero en ${mun.nombre} (${prefIca.veces} ${prefIca.veces === 1 ? "vez" : "veces"}): ${(tarifa * 1000).toLocaleString("es-CO", { maximumFractionDigits: 2 })} por mil`
                  : `${mun.nombre}, ${act?.nombre.toLowerCase() ?? actividadClave}: ${(tarifa * 1000).toLocaleString("es-CO", { maximumFractionDigits: 2 })} por mil`,
            })
          )
        }
      }
    }
  }

  return { lineas, avisos }
}

// ------------------------------------------------------------- guardar

const mismaLinea = (a: LineaLiquidacion, b: LineaLiquidacion) =>
  a.tipo === b.tipo &&
  a.concepto === b.concepto &&
  a.municipioId === b.municipioId &&
  (a.actividad ?? null) === (b.actividad ?? null) &&
  valorLinea(a) === valorLinea(b) &&
  a.asumida === b.asumida

// ¿Contabilidad dejó la sugerencia tal cual? (para medir el acierto)
export function sinCambios(sugeridas: LineaLiquidacion[], finales: LineaLiquidacion[]): boolean {
  if (sugeridas.length !== finales.length) return false
  const porTipo = (ls: LineaLiquidacion[]) => [...ls].sort((x, y) => (x.tipo + (x.concepto ?? "")).localeCompare(y.tipo + (y.concepto ?? "")))
  const a = porTipo(sugeridas)
  const b = porTipo(finales)
  return a.every((l, i) => mismaLinea(l, b[i]))
}

// Lo que recibe liquidar_pago (p_datos).
export function datosLiquidacion(
  lineas: LineaLiquidacion[],
  sugerencia: SugerenciaLiquidacion | null,
  numeroFactura: string,
  observaciones: string
) {
  const fila = (l: LineaLiquidacion) => ({
    tipo: l.tipo,
    concepto: l.concepto,
    municipio_id: l.municipioId,
    actividad: l.actividad,
    descripcion: l.descripcion,
    base: l.base,
    tarifa: l.tarifa,
    valor: l.tipo === "descuento" ? l.valor : valorLinea(l),
    asumida: l.asumida,
    regla: l.regla,
    editada: l.editada,
  })
  return {
    lineas: lineas.map(fila),
    numero_factura: numeroFactura.trim() || null,
    observaciones: observaciones.trim() || null,
    sugerencia: sugerencia ? { lineas: sugerencia.lineas.map(fila), avisos: sugerencia.avisos } : null,
    sin_cambios: sugerencia ? sinCambios(sugerencia.lineas, lineas) : null,
  }
}

// ------------------------------------------------------------- leer el contexto

const num = (v: unknown): number | null => (v == null ? null : Number(v))

// jsonb de contexto_liquidacion -> tipos del motor.
export function catalogoDesdeJson(j: any): CatalogoLiquidacion {
  return {
    uvt: Object.fromEntries(Object.entries(j?.uvt ?? {}).map(([k, v]) => [k, Number(v)])),
    conceptos: (j?.conceptos ?? []).map((c: any) => ({
      clave: c.clave,
      nombre: c.nombre,
      tarifaDeclarante: Number(c.tarifa_declarante),
      tarifaNoDeclarante: Number(c.tarifa_no_declarante),
      tarifaJuridica: num(c.tarifa_juridica),
      baseUvt: Number(c.base_uvt),
      naturalTabla383: Boolean(c.natural_tabla_383),
      actividadIca: c.actividad_ica ?? null,
    })),
    actividades: (j?.actividades ?? []).map((a: any) => ({ clave: a.clave, nombre: a.nombre, usaBase: a.usa_base })),
  }
}

export function contextoDesdeJson(p: any): ContextoPago {
  const per = p.perfil
  const mun = p.municipio
  return {
    tipo: p.tipo,
    anio: Number(p.anio),
    valor: Number(p.valor),
    valorDocumento: num(p.valor_documento),
    baseGravable: num(p.base_gravable),
    iva: num(p.iva),
    tercero: p.tercero
      ? { documento: p.tercero.documento, tipoDocumento: p.tercero.tipo_documento, razonSocial: p.tercero.razon_social }
      : null,
    perfil: per
      ? {
          tipoPersona: per.tipo_persona,
          declarante: Boolean(per.declarante),
          responsableIva: Boolean(per.responsable_iva),
          regimenSimple: Boolean(per.regimen_simple),
          autorretenedor: Boolean(per.autorretenedor),
          granContribuyente: Boolean(per.gran_contribuyente),
          zomac: Boolean(per.zomac),
          ciiuPrincipal: per.ciiu_principal ?? null,
          municipioRut: per.municipio_rut ?? null,
          fechaRut: per.fecha_rut ?? null,
          estado: per.estado,
          alerta: per.alerta ?? null,
        }
      : null,
    empresa: p.empresa
      ? {
          agenteRetefuente: Boolean(p.empresa.agente_retefuente),
          agenteReteiva: Boolean(p.empresa.agente_reteiva),
          confirmado: Boolean(p.empresa.confirmado),
        }
      : null,
    empresaIca: Boolean(p.empresa_ica),
    municipio: mun
      ? {
          id: mun.id,
          nombre: mun.nombre,
          baseCompras: num(mun.base_compras),
          baseServicios: num(mun.base_servicios),
          baseProfesionales: num(mun.base_profesionales),
          tarifas: Object.fromEntries(Object.entries(mun.tarifas ?? {}).map(([k, v]) => [k, Number(v)])),
        }
      : null,
    preferencias: (p.preferencias ?? []).map((x: any) => ({
      tipo: x.tipo,
      municipioId: x.municipio_id ?? null,
      concepto: x.concepto ?? null,
      actividad: x.actividad ?? null,
      tarifa: Number(x.tarifa),
      veces: Number(x.veces),
      origen: x.origen,
    })),
    origen:
      p.fuente === "acta"
        ? { fuente: "acta", contratoTipo: p.contrato?.tipo ?? null, contratoClase: p.contrato?.clase ?? null }
        : p.fuente === "requisicion_admin"
          ? { fuente: "texto", concepto: conceptoDesdeTexto(p.concepto ?? null) }
          : { fuente: "orden_compra", categorias: Object.fromEntries(Object.entries(p.categorias ?? {}).map(([k, v]) => [k, Number(v)])) },
    retefuenteAnticipos: Number(p.retefuente_anticipos ?? 0),
  }
}
