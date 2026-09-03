/**
 * Parser de la hoja "APU" de la plantilla CONYCA (presupuesto + APU).
 * Corre 100% en el cliente (igual que el parser de la hoja PRESUPUESTO ya
 * existente) -- no toca la base de datos, solo transforma el Excel en
 * estructuras JS. El matching contra el maestro de insumos es un paso
 * aparte (ver lib/matching-apu-import.ts) porque ese sí necesita DB.
 *
 * Estructura esperada de la hoja (validada contra un archivo real de
 * ejemplo, ver notas en el bloque de abajo):
 *
 *   Código | Nombre | Tipo | unidad | Cantidad | Valor unitario | Valor total
 *
 * Clasificación de cada fila (sin depender de en qué fila numérica cae el
 * encabezado -- se detecta buscando la fila que contiene los headers):
 *   - CAPÍTULO: tiene Código y Nombre, NO tiene Tipo, NO tiene unidad.
 *   - ÍTEM:     tiene Código, Nombre y unidad, NO tiene Tipo.
 *   - INSUMO:   NO tiene Código, tiene Nombre y SÍ tiene Tipo.
 *   - vacía:    se ignora en silencio.
 *
 * Cualquier fila con Tipo pero sin ningún ítem abierto todavía es un
 * error de estructura (insumo huérfano) y se reporta, no se descarta en
 * silencio -- mismo criterio que ya usas en el import de la hoja
 * PRESUPUESTO ("cortar la importación y mostrar fila + motivo").
 */

import * as XLSX from "xlsx";

export type TipoInsumoApu = "INSUMO" | "MO" | "EQUIPO" | "TRANSPORTE";

const TIPOS_VALIDOS: readonly TipoInsumoApu[] = [
  "INSUMO",
  "MO",
  "EQUIPO",
  "TRANSPORTE",
] as const;

// Grupo de categoría usado como FILTRO en el matching contra el maestro
// (ver lib/matching-apu-import.ts) -- ADAPTAR estos strings para que
// coincidan exactamente con los grupos reales de categorias-apu.ts.
export const GRUPO_POR_TIPO: Record<TipoInsumoApu, string> = {
  INSUMO: "Materiales",
  MO: "Mano de Obra",
  EQUIPO: "Equipo y Herramienta",
  TRANSPORTE: "Transporte",
};

export interface LineaInsumoApu {
  descripcion: string;
  tipo: TipoInsumoApu;
  unidad: string | null;
  cantidad: number;
}

export interface BloqueApu {
  codigoItem: string; // debe coincidir con presupuesto_items.codigo de la hoja 1
  nombreItem: string;
  unidadItem: string | null;
  lineas: LineaInsumoApu[];
}

export interface ResultadoParseoApu {
  bloques: BloqueApu[];
  erroresEstructura: string[]; // insumo sin ítem abierto, Tipo inválido, etc.
}

// Normaliza "Tipo" tolerando espacios y typos comunes vistos en archivos
// reales de entidades (ej. "INSUMO " con espacio, "ISUMO" mal escrito).
// YA NO rechaza valores desconocidos ni corta la importación por esto --
// el Tipo dejó de usarse para filtrar el matching (ver diseño), así que
// un valor raro (ej. "HR" copiado por error de la columna de unidad del
// Excel original de la entidad) no debería tumbar todo el archivo. Si no
// reconoce el valor, cae a INSUMO por default (la categoría más común) y
// sigue -- el usuario puede corregirlo después si el insumo termina en
// una solicitud de aprobación con la categoría equivocada.
function normalizarTipo(valor: unknown): TipoInsumoApu {
  if (typeof valor !== "string") return "INSUMO";
  const limpio = valor.trim().toUpperCase();
  if ((TIPOS_VALIDOS as readonly string[]).includes(limpio)) {
    return limpio as TipoInsumoApu;
  }
  // typos conocidos -- ampliar esta lista si aparecen más al usar la
  // plantilla en la práctica
  if (limpio === "ISUMO" || limpio === "INSUMOS") return "INSUMO";
  if (limpio === "MANO DE OBRA") return "MO";
  if (limpio === "EQUIPOS" || limpio === "EQP") return "EQUIPO";
  if (limpio === "TRANSPORTES") return "TRANSPORTE";
  return "INSUMO"; // valor no reconocido (ej. "HR", "d", "m²") -- default silencioso
}

function celdaTexto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim();
  return texto.length > 0 ? texto : null;
}

function celdaNumero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = typeof valor === "number" ? valor : parseFloat(String(valor));
  return Number.isFinite(n) ? n : null;
}

/**
 * Busca la fila de encabezado dentro de las primeras `maxFilasBusqueda`
 * filas, en vez de asumir un número de fila fijo -- así la plantilla
 * puede tener más o menos filas de título/instrucciones arriba sin
 * romper el parser.
 */
function encontrarFilaHeader(
  filas: unknown[][],
  maxFilasBusqueda = 20
): number {
  for (let i = 0; i < Math.min(filas.length, maxFilasBusqueda); i++) {
    const textos = filas[i].map((c) => celdaTexto(c)?.toLowerCase() ?? "");
    const tieneCodigo = textos.some((t) => t.includes("código") || t.includes("codigo"));
    const tieneTipo = textos.some((t) => t === "tipo");
    const tieneNombre = textos.some((t) => t.includes("nombre"));
    if (tieneCodigo && tieneTipo && tieneNombre) return i;
  }
  throw new Error(
    'No se encontró la fila de encabezado de la hoja APU (se esperaban las columnas "Código", "Nombre", "Tipo").'
  );
}

export function parseApuSheet(workbook: XLSX.WorkBook, nombreHoja = "APU"): ResultadoParseoApu {
  const hoja = workbook.Sheets[nombreHoja];
  if (!hoja) {
    throw new Error(`La plantilla no tiene una hoja llamada "${nombreHoja}".`);
  }

  const filas: unknown[][] = XLSX.utils.sheet_to_json(hoja, {
    header: 1,
    defval: null,
    raw: true,
  });

  const filaHeaderIdx = encontrarFilaHeader(filas);
  const header = filas[filaHeaderIdx].map((c) => celdaTexto(c)?.toLowerCase() ?? "");
  const colCodigo = header.findIndex((h) => h.includes("código") || h.includes("codigo"));
  const colNombre = header.findIndex((h) => h.includes("nombre"));
  const colTipo = header.findIndex((h) => h === "tipo");
  const colUnidad = header.findIndex((h) => h.includes("unidad"));
  const colCantidad = header.findIndex((h) => h.includes("cantidad"));

  const bloques: BloqueApu[] = [];
  const erroresEstructura: string[] = [];
  let bloqueActual: BloqueApu | null = null;

  for (let i = filaHeaderIdx + 1; i < filas.length; i++) {
    const fila = filas[i];
    const numeroFilaExcel = i + 1; // 1-indexado, para mensajes de error legibles

    const codigo = celdaTexto(fila[colCodigo]);
    const nombre = celdaTexto(fila[colNombre]);
    const tipoRaw = fila[colTipo];
    const unidad = celdaTexto(fila[colUnidad]);
    const cantidad = celdaNumero(fila[colCantidad]);

    if (!codigo && !nombre) continue; // fila vacía, se ignora en silencio

    const tipoEstabaPresente = celdaTexto(tipoRaw) !== null;
    // normalizarTipo siempre devuelve un valor válido (default INSUMO si
    // no reconoce el texto) -- pero para saber si esta fila ES una línea
    // de insumo (vs. fila de ítem/capítulo sin Tipo) igual hace falta
    // fijarse si la celda de Tipo tenía algo escrito, no en el resultado
    // ya normalizado.
    const tipo = normalizarTipo(tipoRaw);

    if (tipoEstabaPresente) {
      // fila de INSUMO -- si Nombre viene vacío (fila rota/mal formada
      // en el Excel, ej. una celda de Código con basura pero sin
      // descripción real), se salta en vez de crear un insumo fantasma
      // con descripción en blanco.
      if (!nombre) {
        erroresEstructura.push(
          `Fila ${numeroFilaExcel}: tiene Tipo pero no tiene Nombre -- se saltó (probablemente una fila rota en el Excel).`
        );
        continue;
      }
      if (!bloqueActual) {
        erroresEstructura.push(
          `Fila ${numeroFilaExcel}: insumo "${nombre}" sin ningún ítem abierto antes (revisa si falta la fila del ítem, o el código no coincide).`
        );
        continue;
      }
      bloqueActual.lineas.push({
        descripcion: nombre,
        tipo,
        unidad,
        cantidad: cantidad ?? 0,
      });
      continue;
    }

    if (unidad) {
      // fila de ÍTEM (tiene código + nombre + unidad, sin tipo)
      if (bloqueActual) bloques.push(bloqueActual);
      bloqueActual = {
        codigoItem: codigo ?? "",
        nombreItem: nombre ?? "",
        unidadItem: unidad,
        lineas: [],
      };
      continue;
    }

    // fila de CAPÍTULO (código + nombre, sin unidad ni tipo) -- cierra el
    // bloque anterior si había uno abierto, pero no abre uno nuevo de
    // insumos (un capítulo no tiene APU propio)
    if (bloqueActual) {
      bloques.push(bloqueActual);
      bloqueActual = null;
    }
  }

  if (bloqueActual) bloques.push(bloqueActual);

  return { bloques, erroresEstructura };
}