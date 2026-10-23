// Port EXACTO de nucleo/catalogos.py de la consola de dispersores (Python):
// lo que depende del banco pagador. Los cuatro bancos usan el mismo código de
// compensación de tres dígitos, solo lo escriben distinto, y cada uno llama
// distinto al tipo de producto del beneficiario. No cambiar sin volver a
// correr tests/dispersores-*.test.ts.

export const BOGOTA = "BANCO DE BOGOTA"
export const BANCOLOMBIA = "BANCOLOMBIA"
export const ITAU = "ITAU"
export const DAVIVIENDA = "DAVIVIENDA"
export const PAGADORES = [BOGOTA, BANCOLOMBIA, ITAU, DAVIVIENDA] as const

// Tipo de transacción: NO lo escoge nadie. Es el tipo de cuenta del tercero,
// traducido al código de cada banco pagador. Única excepción: DaviPlata
// pagado desde Davivienda va con DP; desde cualquier otro banco, como ahorros.
const TRADUCCION: Record<string, Record<string, string>> = {
  [BOGOTA]: { AHORROS: "02", CORRIENTE: "01" },
  [BANCOLOMBIA]: { AHORROS: "37", CORRIENTE: "27" },
  [ITAU]: { AHORROS: "AHO", CORRIENTE: "CTE" },
  [DAVIVIENDA]: { AHORROS: "CA", CORRIENTE: "CC" },
}
const TIPO_DAVIPLATA: Record<string, string> = { [DAVIVIENDA]: "DP" }
const NOMBRE_TIPO: Record<string, string> = {
  "02": "Ahorros", "01": "Corriente",
  "37": "Ahorros", "27": "Corriente",
  AHO: "Ahorros", CTE: "Corriente",
  CA: "Ahorros", CC: "Corriente",
  DE: "Deposito electronico", DP: "DaviPlata",
}

/** [código, texto] o [null, motivo] si no se puede resolver. */
export function tipoTransaccion(bancoPagador: string, tipoCuentaTercero: string, bancoDestino = ""): [string | null, string] {
  const p = bancoPagador.trim().toUpperCase()
  const t = tipoCuentaTercero.trim().toUpperCase()
  const d = bancoDestino.trim().toUpperCase()
  if (d === "DAVIPLATA" && p === DAVIVIENDA) {
    const cod = TIPO_DAVIPLATA[DAVIVIENDA]
    return [cod, NOMBRE_TIPO[cod]]
  }
  const tabla = Object.hasOwn(TRADUCCION, p) ? TRADUCCION[p] : null
  if (!tabla) return [null, `no se como escribe ${p} el tipo de transaccion`]
  const cod = Object.hasOwn(tabla, t) ? tabla[t] : null
  if (cod == null) return [null, `la base dice que la cuenta es '${t}' y en ${p} solo se manejan ahorros y corriente`]
  return [cod, NOMBRE_TIPO[cod]]
}

// Clase de pago: va en la cabecera de Bogotá y Bancolombia (Itaú y Davivienda no la piden).
export const CLASE_PAGO: Record<string, [string, string][]> = {
  [BOGOTA]: [["002", "Proveedores"], ["001", "Nomina"], ["003", "Transferencias"]],
  [BANCOLOMBIA]: [["220", "Proveedores"], ["225", "Nomina"], ["238", "Terceros"]],
}

// Bancos destino. Código = el estándar de tres dígitos.
//   bogota / itau  -> tres dígitos con ceros
//   bancolombia    -> 1000 + código, a nueve posiciones
//   davivienda     -> el código sin ceros a la izquierda
export const BANCOS_DESTINO: Record<string, string> = {
  "BANCO DE BOGOTA": "001",
  "BANCO POPULAR": "002",
  "ITAU CORPBANCA": "006",
  BANCOLOMBIA: "007",
  "SCOTIABANK COLOMBIA": "008",
  CITIBANK: "009",
  "BANCO GNB SUDAMERIS": "012",
  BBVA: "013",
  ITAU: "014",
  "SCOTIABANK COLPATRIA": "019",
  "BANCO DE OCCIDENTE": "023",
  BANCOLDEX: "031",
  "BANCO CAJA SOCIAL": "032",
  "BANCO AGRARIO": "040",
  DAVIVIENDA: "051",
  "BANCO DAVIVIENDA": "051",
  "AV VILLAS": "052",
  "BANCO AV VILLAS": "052",
  "BANCO W": "053",
  "BANCO PROCREDIT": "058",
  "BANCO PICHINCHA": "060",
  BANCOOMEVA: "061",
  "BANCO FALABELLA": "062",
  BANCAMIA: "059",
  "FINANCIERA JURISCOOP": "121",
  "BANCO FINANDINA": "063",
  "BANCO MULTIBANK": "064",
  "BANCO SANTANDER DE NEGOCIOS": "065",
  "BANCO COOPCENTRAL": "066",
  "BANCO COMPARTIR": "067",
  "BANCO SERFINANZA": "069",
  "LULO BANK": "070",
  RAPPIPAY: "151",
  "CONFIAR COOPERATIVA FINANCIERA": "292",
  COLTEFINANCIERA: "370",
  NEQUI: "507",
  DAVIPLATA: "551",
  "BANCO CREDIFINANCIERA": "558",
  PIBANK: "560",
  MOVII: "801",
  DING: "802",
  POWWI: "803",
  UALA: "804",
  "NU BANK": "809",
  NU: "809",
  DALE: "897",
}

// Casos donde un banco pagador escribe distinto de la regla general.
const EXCEPCIONES: Record<string, string> = {
  // Itaú se identifica a sí mismo con 6 y a los demás les dice 14.
  [`${ITAU}|ITAU`]: "006",
  // En Davivienda, DaviPlata no tiene código propio: va con 51 y tipo DP.
  [`${DAVIVIENDA}|DAVIPLATA`]: "51",
}

// Combinaciones que el banco pagador no publica: se avisa antes de generar.
const SIN_CODIGO = new Set([`${ITAU}|DAVIPLATA`, `${ITAU}|CONFIAR COOPERATIVA FINANCIERA`])

/** Cómo escribe el banco pagador el código del banco del beneficiario. null = no se conoce. */
export function codigoDestino(bancoPagador: string, bancoDestino: string): string | null {
  const p = bancoPagador.trim().toUpperCase()
  let d = bancoDestino.trim().toUpperCase()
  // aguanta '023-BANCO DE OCCIDENTE', que es como lo escriben las plantillas
  const m = /^(\d{3})\s*-\s*(.+)$/.exec(d)
  if (m) {
    d = m[2].trim()
    if (!Object.hasOwn(BANCOS_DESTINO, d)) {
      const cod = m[1]
      if (p === BANCOLOMBIA) return String(1000 + Number(cod)).padStart(9, "0")
      if (p === DAVIVIENDA) return String(Number(cod))
      return cod
    }
  }
  if (SIN_CODIGO.has(`${p}|${d}`)) return null
  const excepcion = EXCEPCIONES[`${p}|${d}`]
  if (excepcion != null) return excepcion
  const cod = Object.hasOwn(BANCOS_DESTINO, d) ? BANCOS_DESTINO[d] : null
  if (cod == null) return null
  if (p === BANCOLOMBIA) return String(1000 + Number(cod)).padStart(9, "0")
  if (p === DAVIVIENDA) return String(Number(cod))
  return cod // Bogotá e Itaú: tres dígitos con ceros
}
