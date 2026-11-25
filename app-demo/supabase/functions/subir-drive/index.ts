// Función de Supabase "subir-drive" (20270101006800): toma la cola drive_cola y
// copia cada archivo de Storage a Google Drive, dentro de la CARPETA RAÍZ de la copia
// (la carpeta "CONYCA ERP" de la unidad compartida de CONYCA), en carpetas por
// proyecto (Proyectos/001 - CODIGO/Contratos/CJ-001-0001/...).
// La llama pg_cron cada minuto, solo si ajustes_drive.activo y hay algo por subir.
// Se publica desde el panel de Supabase con "Verify JWT" apagado (como
// enviar-correos): solo procesa la cola, no recibe datos.
//
// La carpeta raíz se comparte con la cuenta de servicio como "Administrador de
// contenido" (solo esa carpeta, no toda la unidad): no hace falta delegación de
// dominio. También sirve el id de una unidad compartida completa.
//
// Secretos (Supabase › Edge Functions › Secrets; nunca en el código):
//   DRIVE_SA_JSON  llave JSON de la cuenta de servicio (si falta, usa GMAIL_SA_JSON,
//                  la de los correos)
//   DRIVE_SUB      opcional: correo a nombre de quien sube (delegación de dominio);
//                  sin él sube la cuenta de servicio misma
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los pone Supabase solo.
// El id de la carpeta raíz va en la tabla ajustes_drive (unidad_id).
//
// Con el cuerpo {"informe": "requisiciones"} (pg_cron, lunes 00:30 en Colombia;
// 20270101007000) en vez de la cola arma el Excel semanal de requisiciones de cada
// proyecto (las creadas la semana anterior) y lo sube a
// Proyectos/<proyecto>/Requisiciones/<año> - Semana NN/. {"lunes": "AAAA-MM-DD"}
// genera otra semana; volver a generarla reemplaza el archivo.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2"

type Destino = { proyecto_id: string | null; proyecto_nombre: string | null; carpetas: string[]; nombre: string | null }
type Tarea = { id: string; bucket: string; ruta: string; drive_file_id: string | null; destino: Destino }

const CARPETA = "application/vnd.google-apps.folder"
const API = "https://www.googleapis.com/drive/v3/files"
const API_SUBIDA = "https://www.googleapis.com/upload/drive/v3/files"

const enc = new TextEncoder()
const b64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""))
const b64url = (bytes: Uint8Array) => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const b64urlTexto = (s: string) => b64url(enc.encode(s))

// Token de acceso de Google: JWT firmado con la llave de la cuenta de servicio (RS256).
async function tokenGoogle(): Promise<string> {
  const sa = JSON.parse(Deno.env.get("DRIVE_SA_JSON") ?? Deno.env.get("GMAIL_SA_JSON") ?? "{}")
  if (!sa.client_email || !sa.private_key) throw new Error("Falta el secreto DRIVE_SA_JSON (o GMAIL_SA_JSON).")
  const sub = Deno.env.get("DRIVE_SUB")
  const ahora = Math.floor(Date.now() / 1000)
  const cabecera = b64urlTexto(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const cuerpo = b64urlTexto(
    JSON.stringify({
      iss: sa.client_email,
      ...(sub ? { sub } : {}),
      scope: "https://www.googleapis.com/auth/drive",
      aud: "https://oauth2.googleapis.com/token",
      iat: ahora,
      exp: ahora + 3600,
    })
  )
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")
  const der = Uint8Array.from(atob(pem), (ch) => ch.charCodeAt(0))
  const llave = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"])
  const firma = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", llave, enc.encode(`${cabecera}.${cuerpo}`)))
  const jwt = `${cabecera}.${cuerpo}.${b64url(firma)}`
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  })
  const j = await r.json()
  if (!r.ok || !j.access_token) throw new Error(`Google no dio el token: ${j.error_description ?? j.error ?? r.status}`)
  return j.access_token
}

// Texto para la búsqueda de Drive (q): comillas y barras escapadas.
const comillas = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")

class Drive {
  // Carpetas ya resueltas en esta corrida (clave -> id de Drive).
  private cache = new Map<string, string>()

  constructor(
    private token: string,
    raiz: string,
    private sb: SupabaseClient
  ) {
    this.cache.set("", raiz) // la carpeta raíz de la copia
  }

  private async pedir(url: string, init: RequestInit = {}): Promise<Response> {
    const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${this.token}`, ...(init.headers ?? {}) } })
    return r
  }

  // Carpeta `nombre` dentro de la carpeta `clavePadre`. Busca primero en la
  // tabla drive_carpetas, después en Drive (por si alguien la creó a mano) y si no
  // existe la crea.
  async carpeta(clavePadre: string, nombre: string, clave: string, proyectoId: string | null = null): Promise<string> {
    const enMemoria = this.cache.get(clave)
    if (enMemoria) return enMemoria
    const { data: guardada } = await this.sb.from("drive_carpetas").select("drive_id").eq("clave", clave).maybeSingle()
    if (guardada?.drive_id) {
      this.cache.set(clave, guardada.drive_id)
      return guardada.drive_id
    }
    const padre = this.cache.get(clavePadre)
    if (!padre) throw new Error(`Falta la carpeta padre de ${clave}.`)

    const q = `'${comillas(padre)}' in parents and name = '${comillas(nombre)}' and mimeType = '${CARPETA}' and trashed = false`
    const busqueda = new URLSearchParams({
      q,
      fields: "files(id)",
      // Buscar en todas las unidades: la raíz puede ser una carpeta dentro de una unidad compartida.
      corpora: "allDrives",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      pageSize: "1",
    })
    const rb = await this.pedir(`${API}?${busqueda}`)
    if (!rb.ok) throw new Error(`Drive (buscar carpeta) respondió ${rb.status}: ${(await rb.text()).slice(0, 300)}`)
    let id: string | undefined = (await rb.json()).files?.[0]?.id
    if (!id) {
      const rc = await this.pedir(`${API}?supportsAllDrives=true&fields=id`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ name: nombre, mimeType: CARPETA, parents: [padre] }),
      })
      if (!rc.ok) throw new Error(`Drive (crear carpeta) respondió ${rc.status}: ${(await rc.text()).slice(0, 300)}`)
      id = (await rc.json()).id as string
    }
    await this.sb.from("drive_carpetas").upsert({ clave, drive_id: id, proyecto_id: proyectoId }, { onConflict: "clave" })
    this.cache.set(clave, id)
    return id
  }

  // Carpeta final del destino: Proyectos/<proyecto>/<carpetas...> o <carpetas...>.
  async carpetaDestino(d: Destino): Promise<string> {
    let clave = ""
    let id = this.cache.get("")!
    if (d.proyecto_id) {
      id = await this.carpeta("", "Proyectos", "Proyectos")
      const claveProyecto = `proyecto:${d.proyecto_id}`
      id = await this.carpeta("Proyectos", d.proyecto_nombre ?? d.proyecto_id, claveProyecto, d.proyecto_id)
      clave = claveProyecto
    }
    for (const nombre of d.carpetas) {
      const claveHija = clave ? `${clave}/${nombre}` : nombre
      id = await this.carpeta(clave, nombre, claveHija)
      clave = claveHija
    }
    return id
  }

  // Sube (o actualiza, si ya tiene id) por subida reanudable: sirve para cualquier tamaño.
  async subir(archivo: Blob, nombre: string, carpeta: string, idExistente: string | null): Promise<string> {
    const tipo = archivo.type || "application/octet-stream"
    const iniciar = (url: string, metodo: string, metadatos: Record<string, unknown>) =>
      this.pedir(url, {
        method: metodo,
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": tipo,
          "X-Upload-Content-Length": String(archivo.size),
        },
        body: JSON.stringify(metadatos),
      })

    let inicio: Response | null = null
    if (idExistente) {
      inicio = await iniciar(`${API_SUBIDA}/${idExistente}?uploadType=resumable&supportsAllDrives=true&fields=id`, "PATCH", {})
      if (inicio.status === 404) inicio = null // lo borraron en Drive: se sube de nuevo
    }
    if (!inicio) {
      inicio = await iniciar(`${API_SUBIDA}?uploadType=resumable&supportsAllDrives=true&fields=id`, "POST", {
        name: nombre,
        parents: [carpeta],
      })
    }
    if (!inicio.ok) throw new Error(`Drive (iniciar subida) respondió ${inicio.status}: ${(await inicio.text()).slice(0, 300)}`)
    const destino = inicio.headers.get("Location")
    if (!destino) throw new Error("Drive no devolvió la dirección de subida.")
    const r = await fetch(destino, { method: "PUT", headers: { "Content-Type": tipo }, body: archivo })
    if (!r.ok) throw new Error(`Drive (subir) respondió ${r.status}: ${(await r.text()).slice(0, 300)}`)
    return (await r.json()).id as string
  }
}

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e))

// ------------------------------------------------------------------ Excel semanal de requisiciones

type FilaRequisicion = {
  id: string
  codigo: string
  solicitado_por: string
  insumo_codigo: number | null
  insumo: string
  unidad: string
  cantidad: number
  fecha_requisicion: string
  fecha_requerida: string | null
  fecha_estimada: string | null
  estado: string
  estado_compra: string | null
  tipo: string
  anexos: number
}
type SemanaRequisiciones = {
  lunes: string
  semana: string
  url_app: string | null
  proyectos: { proyecto_id: string; destino: Destino; filas: FilaRequisicion[] }[]
}

const ESTADO: Record<string, string> = { pendiente: "Pendiente", aprobada: "Aprobada", rechazada: "Rechazada", cancelada: "Cancelada" }
const COMPRA: Record<string, string> = {
  completa: "Completa",
  parcial: "Compra parcial",
  pendiente: "Pendiente",
  rechazada_compras: "Rechazada por Compras",
}
const AZUL = "FF4070A1"
const COLUMNAS = [
  { titulo: "Requisición", ancho: 15 },
  { titulo: "Solicitado por", ancho: 24 },
  { titulo: "Insumo solicitado", ancho: 48 },
  { titulo: "Unidad", ancho: 14 },
  { titulo: "Cantidad solicitada", ancho: 14 },
  { titulo: "Fecha de requisición", ancho: 14 },
  { titulo: "Fecha requerida", ancho: 14 },
  { titulo: "Fecha estimada de entrega", ancho: 14 },
  { titulo: "Estado", ancho: 12 },
  { titulo: "Estado de la compra", ancho: 20 },
  { titulo: "Tipo", ancho: 16 },
  { titulo: "Anexos", ancho: 16 },
]

// "AAAA-MM-DD" -> fecha de Excel a medianoche UTC (Excel no tiene zona horaria).
const fechaExcel = (ymd: string | null) => {
  if (!ymd) return null
  const [a, m, d] = ymd.split("-").map(Number)
  return new Date(Date.UTC(a, m - 1, d))
}
const ddmmaaaa = (ymd: string) => ymd.split("-").reverse().join("/")
const sumarDias = (ymd: string, n: number) => {
  const f = fechaExcel(ymd)!
  f.setUTCDate(f.getUTCDate() + n)
  return f.toISOString().slice(0, 10)
}

// Lunes de la semana anterior, en hora de Colombia (UTC-5 todo el año).
function lunesSemanaAnterior(): string {
  const hoy = new Date(Date.now() - 5 * 3600 * 1000)
  const dia = hoy.getUTCDay() || 7 // 1 = lunes ... 7 = domingo
  hoy.setUTCDate(hoy.getUTCDate() - (dia - 1) - 7)
  return hoy.toISOString().slice(0, 10)
}

async function excelRequisiciones(s: SemanaRequisiciones, p: SemanaRequisiciones["proyectos"][number]): Promise<Blob> {
  const ExcelJS = (await import("npm:exceljs@4.4.0")).default
  const libro = new ExcelJS.Workbook()
  const hoja = libro.addWorksheet("Requisiciones")
  const n = COLUMNAS.length
  COLUMNAS.forEach((c, i) => (hoja.getColumn(i + 1).width = c.ancho))

  hoja.mergeCells(1, 1, 1, n)
  const titulo = hoja.getCell(1, 1)
  titulo.value = `Requisiciones · ${p.destino.proyecto_nombre ?? ""} · ${s.semana}`
  titulo.font = { bold: true, size: 14, color: { argb: AZUL } }
  hoja.mergeCells(2, 1, 2, n)
  hoja.getCell(2, 1).value =
    `Requisiciones creadas del ${ddmmaaaa(s.lunes)} al ${ddmmaaaa(sumarDias(s.lunes, 6))}, con su estado al generar este archivo. ` +
    "Cantidades en la unidad de compra."
  hoja.getCell(2, 1).font = { italic: true, color: { argb: "FF555555" } }

  const encabezado = hoja.getRow(4)
  COLUMNAS.forEach((c, i) => {
    const celda = encabezado.getCell(i + 1)
    celda.value = c.titulo
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } }
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } }
    celda.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
  })
  encabezado.height = 30

  p.filas.forEach((f, i) => {
    const fila = hoja.getRow(5 + i)
    const valores = [
      f.codigo,
      f.solicitado_por,
      f.insumo_codigo != null ? `${f.insumo_codigo} - ${f.insumo}` : f.insumo,
      f.unidad,
      Number(f.cantidad),
      fechaExcel(f.fecha_requisicion),
      fechaExcel(f.fecha_requerida),
      fechaExcel(f.fecha_estimada),
      ESTADO[f.estado] ?? f.estado,
      f.estado_compra ? (COMPRA[f.estado_compra] ?? f.estado_compra) : "",
      f.tipo,
    ]
    valores.forEach((v, k) => (fila.getCell(k + 1).value = v))
    fila.getCell(5).numFmt = Number.isInteger(Number(f.cantidad)) ? "#,##0" : "#,##0.##"
    const anexos = fila.getCell(12)
    if (f.anexos > 0 && s.url_app) {
      anexos.value = { text: `Ver anexos (${f.anexos})`, hyperlink: `${s.url_app}/almacen/comprar-pedidos/anexos/${f.id}` }
      anexos.font = { color: { argb: "FF0563C1" }, underline: true }
    } else {
      anexos.value = f.anexos > 0 ? f.anexos : ""
    }
  })
  for (const c of [6, 7, 8]) hoja.getColumn(c).numFmt = "dd/mm/yyyy"
  hoja.views = [{ state: "frozen", ySplit: 4 }]
  hoja.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + Math.max(p.filas.length, 1), column: n } }

  const buffer = await libro.xlsx.writeBuffer()
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
}

async function informeRequisiciones(sb: SupabaseClient, raiz: string, lunesPedido: unknown): Promise<Response> {
  const lunes = typeof lunesPedido === "string" && /^\d{4}-\d{2}-\d{2}$/.test(lunesPedido) ? lunesPedido : lunesSemanaAnterior()
  const { data, error } = await sb.rpc("requisiciones_semana_drive", { p_lunes: lunes })
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  const semana = data as SemanaRequisiciones
  if (semana.proyectos.length === 0) return new Response(JSON.stringify({ informe: "requisiciones", semana: semana.semana, archivos: 0 }))

  const drive = new Drive(await tokenGoogle(), raiz, sb)
  const resultado: { proyecto: string | null; filas: number; error?: string }[] = []
  for (const p of semana.proyectos) {
    try {
      const clave = `requisiciones:${p.proyecto_id}:${semana.lunes}`
      const { data: previo } = await sb.from("drive_informes").select("drive_file_id").eq("clave", clave).maybeSingle()
      const carpeta = await drive.carpetaDestino(p.destino)
      const id = await drive.subir(await excelRequisiciones(semana, p), p.destino.nombre ?? "Requisiciones.xlsx", carpeta, previo?.drive_file_id ?? null)
      await sb.from("drive_informes").upsert({ clave, drive_file_id: id, actualizado_en: new Date().toISOString() }, { onConflict: "clave" })
      resultado.push({ proyecto: p.destino.proyecto_nombre, filas: p.filas.length })
    } catch (e) {
      resultado.push({ proyecto: p.destino.proyecto_nombre, filas: p.filas.length, error: mensaje(e) })
    }
  }
  return new Response(JSON.stringify({ informe: "requisiciones", semana: semana.semana, archivos: resultado }))
}

Deno.serve(async (req: Request) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

  const { data: ajustes, error: errorAjustes } = await sb.from("ajustes_drive").select("activo, unidad_id").eq("id", true).maybeSingle()
  if (errorAjustes) return new Response(JSON.stringify({ error: errorAjustes.message }), { status: 500 })
  if (!ajustes?.activo || !ajustes.unidad_id) return new Response(JSON.stringify({ subidos: 0, motivo: "apagada" }))

  const cuerpo = await req.json().catch(() => ({}))
  if (cuerpo?.informe === "requisiciones") {
    try {
      return await informeRequisiciones(sb, ajustes.unidad_id, cuerpo.lunes)
    } catch (e) {
      return new Response(JSON.stringify({ error: mensaje(e) }), { status: 500 })
    }
  }

  const { data, error } = await sb.rpc("tomar_drive", { p_limite: 10 })
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  const tareas = (data ?? []) as Tarea[]
  if (tareas.length === 0) return new Response(JSON.stringify({ subidos: 0 }))

  let drive: Drive
  try {
    drive = new Drive(await tokenGoogle(), ajustes.unidad_id, sb)
  } catch (e) {
    for (const t of tareas) await sb.rpc("marcar_drive", { p_id: t.id, p_estado: "error", p_file_id: null, p_error: mensaje(e) })
    return new Response(JSON.stringify({ error: mensaje(e) }), { status: 500 })
  }

  let subidos = 0
  for (const t of tareas) {
    try {
      const { data: archivo, error: errorDescarga } = await sb.storage.from(t.bucket).download(t.ruta)
      if (errorDescarga || !archivo) {
        // Ya no está en Storage (se cambió o se borró antes de copiarlo): no hay nada que subir.
        const texto = mensaje(errorDescarga)
        const noExiste = /not.?found|no existe|404/i.test(texto) || !archivo
        await sb.rpc("marcar_drive", {
          p_id: t.id,
          p_estado: noExiste ? "omitido" : "error",
          p_file_id: null,
          p_error: `No se pudo descargar de Storage: ${texto}`,
        })
        continue
      }
      const carpeta = await drive.carpetaDestino(t.destino)
      const nombre = t.destino.nombre ?? t.ruta.split("/").pop() ?? "archivo"
      const id = await drive.subir(archivo, nombre, carpeta, t.drive_file_id)
      await sb.rpc("marcar_drive", { p_id: t.id, p_estado: "subido", p_file_id: id, p_error: null })
      subidos++
    } catch (e) {
      await sb.rpc("marcar_drive", { p_id: t.id, p_estado: "error", p_file_id: null, p_error: mensaje(e) })
    }
  }
  return new Response(JSON.stringify({ subidos, total: tareas.length }))
})
