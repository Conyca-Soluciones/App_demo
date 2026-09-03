/**
 * Matching de las líneas de insumo de la hoja APU contra maestro_insumos.
 *
 * Diseño (ver conversación de diseño en CLAUDE.md / historial del proyecto):
 *  - Deduplicar ANTES de matchear (una descripción repetida N veces en el
 *    Excel se matchea 1 sola vez, no N).
 *  - Cargar el maestro completo en memoria UNA sola vez (1 query), no una
 *    query por descripción -- evita el patrón N+1.
 *  - Umbral de auto-match: score >= 90 (0-100). Por debajo, va a revisión.
 *
 * ADAPTAR: `puntuarSimilitud` de abajo es un fallback simple (Jaccard de
 * palabras + coincidencia normalizada) para que el pipeline sea
 * testeable de una vez, SIN depender todavía de lib/similitud-texto.ts.
 * Cuando conectemos el motor real (TF-IDF + Jaccard + Levenshtein que ya
 * tienes), la única función que hay que reemplazar es esa -- el resto
 * del pipeline (dedup, carga del maestro, clasificación por umbral,
 * reparto de vuelta a las líneas) no cambia.
 */

import type { BloqueApu, TipoInsumoApu } from "./parse-apu-excel";
import { GRUPO_POR_TIPO } from "./parse-apu-excel";

export const UMBRAL_AUTO_MATCH = 90;
const TOP_N_SUGERENCIAS = 5;

export interface InsumoMaestroCandidato {
  id: string; // uuid -- OJO: distinto de `codigo` (el consecutivo entero visible al usuario)
  codigo: number;
  descripcion: string;
  u_m: string;
  vr_unitario: number;
  tipo: string; // categoría real del maestro (MATERIAL-M, NOMINA-N, etc.) -- este es el que se guarda en item_apu.tipo, NUNCA el Tipo genérico del Excel
}

export interface CandidatoSugerido {
  insumo: InsumoMaestroCandidato;
  score: number; // 0-100
}

export type EstadoResolucion = "auto_match" | "requiere_revision";

export interface DescripcionResuelta {
  descripcionOriginal: string;
  grupoSugerido: string; // de GRUPO_POR_TIPO, usado solo para prefiltrar candidatos
  estado: EstadoResolucion;
  insumoIdAsignado: string | null; // uuid de maestro_insumos.id
  candidatosSugeridos: CandidatoSugerido[];
  // true si el mejor candidato tiene un precio placeholder (ver
  // PRECIOS_PLACEHOLDER) -- cuando es true, "estado" NUNCA es "auto_match"
  // aunque el score sea alto, porque agregarInsumoApu ya bloquea insertar
  // item_apu con un precio placeholder; mejor mandarlo a revisión antes
  // que fallar silenciosamente al guardar.
  precioPlaceholder: boolean;
}

// ---------- Paso 1: deduplicar ----------

interface DescripcionUnica {
  clave: string; // normalizada, usada para deduplicar
  original: string; // tal cual viene del Excel, para mostrar en revisión
  grupo: string; // de qué Tipo(s) viene -- si aparece con más de un Tipo, se queda con el primero visto
}

function normalizarParaComparar(texto: string): string {
  return texto.trim().toLowerCase().replace(/\s+/g, " ");
}

export function extraerDescripcionesUnicas(bloques: BloqueApu[]): DescripcionUnica[] {
  const mapa = new Map<string, DescripcionUnica>();
  for (const bloque of bloques) {
    for (const linea of bloque.lineas) {
      const clave = normalizarParaComparar(linea.descripcion);
      if (!mapa.has(clave)) {
        mapa.set(clave, {
          clave,
          original: linea.descripcion,
          grupo: GRUPO_POR_TIPO[linea.tipo],
        });
      }
    }
  }
  return Array.from(mapa.values());
}

// ---------- Paso 2: similitud (placeholder reemplazable) ----------

function distanciaLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + costo);
    }
  }
  return dp[m][n];
}

function jaccardPalabras(a: string, b: string): number {
  const setA = new Set(a.split(" ").filter(Boolean));
  const setB = new Set(b.split(" ").filter(Boolean));
  const interseccion = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : interseccion.size / union.size;
}

/**
 * Score 0-100. FALLBACK -- reemplazar por el motor real
 * (TF-IDF + coseno 45% + Jaccard 30% + Levenshtein 25%) cuando se
 * conecte lib/similitud-texto.ts. La forma de la función (recibe una
 * descripción + un candidato, devuelve 0-100) no cambia, así que el
 * resto del pipeline no se toca al hacer el swap.
 */
export function puntuarSimilitud(descripcion: string, candidatoDescripcion: string): number {
  const a = normalizarParaComparar(descripcion);
  const b = normalizarParaComparar(candidatoDescripcion);
  if (a === b) return 100;

  const jaccard = jaccardPalabras(a, b); // 0-1
  const maxLen = Math.max(a.length, b.length) || 1;
  const levenshteinSim = 1 - distanciaLevenshtein(a, b) / maxLen; // 0-1

  const combinado = jaccard * 0.5 + levenshteinSim * 0.5;
  return Math.round(combinado * 100);
}

// ---------- Paso 3: construir índice (carga del maestro, 1 sola vez) ----------

export interface IndiceMaestro {
  candidatos: InsumoMaestroCandidato[];
  porGrupo: Map<string, InsumoMaestroCandidato[]>; // prefiltro simple por grupo/tipo
}

// Mapea la categoría real del maestro (MATERIAL-M, NOMINA-N, etc.) al
// mismo grupo usado en GRUPO_POR_TIPO -- ADAPTAR a los valores reales de
// categorias-apu.ts.
function grupoDeCategoriaMaestro(categoria: string): string {
  const cat = categoria.toUpperCase();
  if (cat.includes("MATERIAL") || cat.includes("CONSUMIBLE")) return "Materiales";
  if (cat.includes("HONORARIO") || cat.includes("NOMINA") || cat.includes("SUBCONTRATO")) return "Mano de Obra";
  if (cat.includes("EQUIPO") || cat.includes("MAQUINARIA")) return "Equipo y Herramienta";
  if (cat.includes("TRANSPORTE")) return "Transporte";
  return "Otros";
}

export function construirIndice(candidatos: InsumoMaestroCandidato[]): IndiceMaestro {
  const porGrupo = new Map<string, InsumoMaestroCandidato[]>();
  for (const c of candidatos) {
    const grupo = grupoDeCategoriaMaestro(c.tipo);
    if (!porGrupo.has(grupo)) porGrupo.set(grupo, []);
    porGrupo.get(grupo)!.push(c);
  }
  return { candidatos, porGrupo };
}

// ---------- Paso 4: resolver cada descripción única contra el índice ----------

export function resolverDescripciones(
  descripcionesUnicas: DescripcionUnica[],
  indice: IndiceMaestro,
  // ADAPTAR: pasar acá los MISMOS valores que ya usa `agregarInsumoApu`
  // en actions.ts (constante PRECIOS_PLACEHOLDER) -- se recibe como
  // parámetro en vez de hardcodearlo acá para no mantener dos copias de
  // la misma lista desincronizadas.
  preciosPlaceholder: number[] = []
): DescripcionResuelta[] {
  return descripcionesUnicas.map(({ original, grupo }) => {
    // Prefiltro: primero candidatos del mismo grupo; si el grupo no tiene
    // ninguno (ej. maestro mal categorizado), cae a buscar en todo el
    // maestro para no perder un match válido por un error de categoría.
    const candidatosDelGrupo = indice.porGrupo.get(grupo) ?? [];
    const universoBusqueda = candidatosDelGrupo.length > 0 ? candidatosDelGrupo : indice.candidatos;

    const puntuados = universoBusqueda
      .map((candidato) => ({ insumo: candidato, score: puntuarSimilitud(original, candidato.descripcion) }))
      .sort((a, b) => b.score - a.score);

    const candidatosSugeridos = puntuados.slice(0, TOP_N_SUGERENCIAS);
    const mejor = candidatosSugeridos[0];
    const mejorTienePrecioPlaceholder = !!mejor && preciosPlaceholder.includes(mejor.insumo.vr_unitario);

    if (mejor && mejor.score >= UMBRAL_AUTO_MATCH && !mejorTienePrecioPlaceholder) {
      return {
        descripcionOriginal: original,
        grupoSugerido: grupo,
        estado: "auto_match",
        insumoIdAsignado: mejor.insumo.id,
        candidatosSugeridos,
        precioPlaceholder: false,
      };
    }

    return {
      descripcionOriginal: original,
      grupoSugerido: grupo,
      estado: "requiere_revision",
      insumoIdAsignado: null,
      candidatosSugeridos,
      // se marca aunque el motivo real de caer a revisión haya sido el
      // score (no el precio) -- la UI solo debe mostrar la advertencia si
      // el usuario termina eligiendo justo ese candidato
      precioPlaceholder: mejorTienePrecioPlaceholder,
    };
  });
}

// ---------- Paso 5: repartir resoluciones de vuelta a cada línea original ----------

export interface LineaApuResuelta {
  bloqueIndex: number;
  descripcion: string;
  tipo: TipoInsumoApu;
  unidad: string | null;
  cantidad: number;
  resolucion: DescripcionResuelta;
}

export function aplicarResolucionesABloques(
  bloques: BloqueApu[],
  resoluciones: DescripcionResuelta[]
): LineaApuResuelta[] {
  const mapa = new Map(resoluciones.map((r) => [normalizarParaComparar(r.descripcionOriginal), r]));
  const resultado: LineaApuResuelta[] = [];

  bloques.forEach((bloque, bloqueIndex) => {
    for (const linea of bloque.lineas) {
      const resolucion = mapa.get(normalizarParaComparar(linea.descripcion));
      if (!resolucion) {
        throw new Error(`No se encontró resolución para "${linea.descripcion}" (bloque ${bloque.codigoItem})`);
      }
      resultado.push({
        bloqueIndex,
        descripcion: linea.descripcion,
        tipo: linea.tipo,
        unidad: linea.unidad,
        cantidad: linea.cantidad,
        resolucion,
      });
    }
  });

  return resultado;
}