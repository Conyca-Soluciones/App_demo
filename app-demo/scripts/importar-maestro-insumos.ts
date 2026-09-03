/**
 * IMPORTAR MAESTRO DE INSUMOS A SUPABASE
 * ========================================
 * Script de una sola vez (o re-ejecutable) que sube "maestro_insumos.csv"
 * a la tabla `maestro_insumos`. Usa UPSERT sobre `codigo`, así que
 * puedes correrlo de nuevo sin duplicar filas: si el código ya existe,
 * actualiza esa fila (sin tocar su `id`); si no existe, la inserta.
 *
 * ⚠️  UPSERT NUNCA BORRA FILAS. Cuando el proceso de limpieza fusiona
 * duplicados (un código queda eliminado a favor de otro), ese código
 * viejo se queda huérfano en la base de datos para siempre si no se
 * borra explícitamente. Por eso este script, ANTES de subir nada, borra
 * los códigos listados en "codigos_eliminados.csv" (la lista de códigos
 * que se fusionaron en otro código en esta corrida de limpieza). Si ese
 * archivo no existe o está vacío, el script se salta el borrado y sigue
 * directo con el upsert normal.
 *
 * Por qué NO usa "@/lib/supabase/server":
 * Ese cliente está pensado para requests dentro de la app (usa cookies
 * de sesión). Este es un script de importación masiva que corre por
 * fuera de la app, así que usa el cliente de supabase-js directo con
 * la SERVICE ROLE KEY (necesaria para saltarse RLS en una carga masiva).
 *
 * ⚠️  La service role key tiene acceso total a la base de datos.
 *     Nunca la expongas en código de cliente/navegador ni la subas a
 *     git -- solo úsala en scripts locales o backend, vía variable de
 *     entorno.
 *
 * CÓMO USARLO
 * -----------
 * 1. npm install @supabase/supabase-js csv-parse dotenv
 * 2. Corre primero la migración (supabase/migrations/..._create_maestro_insumos.sql)
 *    con `supabase db push` o pegándola en el SQL Editor de Supabase.
 * 3. Agrega a tu .env.local (probablemente ya tengas la primera):
 *      NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
 *      SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key   <- SIN prefijo NEXT_PUBLIC_
 *    La service_role key está en Project Settings -> API Keys -> "service_role"
 *    (o "secret" en el dashboard nuevo de Supabase). NO es la publishable/anon key.
 * 4. Coloca "maestro_insumos.csv" (y "codigos_eliminados.csv" si aplica)
 *    en la raíz del proyecto, o ajusta las rutas de abajo.
 * 5. npx tsx scripts/importar-maestro-insumos.ts
 */

import { createClient } from "@supabase/supabase-js"
import { parse } from "csv-parse/sync"
import { existsSync, readFileSync } from "fs"
import path from "path"
import { config as loadEnv } from "dotenv"

// Carga variables de entorno explícitamente -- tsx NO las carga solo
// (eso solo pasa dentro de `next dev` / `next build`, un script suelto
// no lo ve). Revisa .env.local primero (convención Next.js) y usa .env
// como respaldo si algo falta ahí.
loadEnv({ path: path.join(process.cwd(), ".env.local") })
loadEnv({ path: path.join(process.cwd(), ".env") })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const CSV_PATH = path.join(process.cwd(), "maestro_insumos.csv")
const CODIGOS_ELIMINADOS_PATH = path.join(process.cwd(), "codigos_eliminados.csv")
const TABLA = "maestro_insumos"
const TAMANO_LOTE = 500

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en .env.local.\n" +
    "OJO: SUPABASE_SERVICE_ROLE_KEY es la 'service_role' / 'secret' key de " +
    "Project Settings -> API Keys en el dashboard de Supabase -- NO la " +
    "'publishable'/'anon' key, y NUNCA debe llevar el prefijo NEXT_PUBLIC_ " +
    "(esa key tiene permisos de admin y se saltaría RLS si se expusiera al navegador)."
  )
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

interface MaestroInsumoRow {
  codigo: number
  descripcion: string
  tipo: string | null
  u_m: string | null
  agrupacion: string | null
  vr_unitario: number | null
  iva_porcentaje: number | null
  vr_neto: number | null
  iva_descontable: boolean | null
  excluye_iva: boolean | null
  usuario_modificacion: string | null
  fecha_modificacion: string | null // 'YYYY-MM-DD'
}

function aTextoONull(valor: string | undefined): string | null {
  return valor === undefined || valor === "" ? null : valor
}

function aNumeroONull(valor: string | undefined): number | null {
  if (valor === undefined || valor === "") return null
  const n = Number(valor)
  return Number.isNaN(n) ? null : n
}

function aBooleanoONull(valor: string | undefined): boolean | null {
  if (valor === "True" || valor === "true") return true
  if (valor === "False" || valor === "false") return false
  return null
}

function parsearCsv(): MaestroInsumoRow[] {
  const contenido = readFileSync(CSV_PATH, "utf-8")
  const registros: Record<string, string>[] = parse(contenido, {
    columns: true,
    skip_empty_lines: true,
  })

  return registros.map((r) => ({
    codigo: Number(r.codigo),
    descripcion: r.descripcion,
    tipo: aTextoONull(r.tipo),
    u_m: aTextoONull(r.u_m),
    agrupacion: aTextoONull(r.agrupacion),
    vr_unitario: aNumeroONull(r.vr_unitario),
    iva_porcentaje: aNumeroONull(r.iva_porcentaje),
    vr_neto: aNumeroONull(r.vr_neto),
    iva_descontable: aBooleanoONull(r.iva_descontable),
    excluye_iva: aBooleanoONull(r.excluye_iva),
    usuario_modificacion: aTextoONull(r.usuario_modificacion),
    fecha_modificacion: aTextoONull(r.fecha_modificacion),
  }))
}

function parsearCodigosEliminados(): number[] {
  if (!existsSync(CODIGOS_ELIMINADOS_PATH)) {
    return []
  }
  const contenido = readFileSync(CODIGOS_ELIMINADOS_PATH, "utf-8")
  const registros: Record<string, string>[] = parse(contenido, {
    columns: true,
    skip_empty_lines: true,
  })
  return registros.map((r) => Number(r.codigo)).filter((n) => !Number.isNaN(n))
}

async function borrarCodigosEliminados() {
  const codigos = parsearCodigosEliminados()

  if (codigos.length === 0) {
    console.log("No hay codigos_eliminados.csv (o está vacío) -- no se borra nada.")
    return
  }

  console.log(`Borrando ${codigos.length} códigos fusionados/eliminados de "${TABLA}"...`)

  // borrar en lotes por si la lista de códigos eliminados llega a ser
  // muy larga (evita pasarse del límite de tamaño del filtro "in")
  for (let i = 0; i < codigos.length; i += TAMANO_LOTE) {
    const lote = codigos.slice(i, i + TAMANO_LOTE)
    const { error } = await supabase.from(TABLA).delete().in("codigo", lote)

    if (error) {
      throw new Error(`Error borrando códigos eliminados: ${error.message}`)
    }
  }

  console.log(`  Borrados: ${codigos.join(", ")}`)
}

async function importarMaestroInsumos() {
  await borrarCodigosEliminados()

  const filas = parsearCsv()
  console.log(`Leídas ${filas.length} filas de ${CSV_PATH}`)

  let totalSubido = 0

  for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
    const lote = filas.slice(i, i + TAMANO_LOTE)

    const { error } = await supabase
      .from(TABLA)
      .upsert(lote, { onConflict: "codigo" })

    if (error) {
      throw new Error(
        `Error en el lote ${Math.floor(i / TAMANO_LOTE) + 1}: ${error.message}`
      )
    }

    totalSubido += lote.length
    console.log(`  Subidas ${totalSubido}/${filas.length} filas...`)
  }

  console.log(`Listo: ${totalSubido} filas insertadas/actualizadas en "${TABLA}".`)
}

importarMaestroInsumos().catch((err) => {
  console.error("Falló la importación:", err)
  process.exit(1)
})