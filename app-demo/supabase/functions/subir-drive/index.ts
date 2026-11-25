// Función de Supabase "subir-drive" (20270101006800): toma la cola drive_cola y
// copia cada archivo de Storage a la unidad compartida de Google Drive de CONYCA,
// en carpetas por proyecto (Proyectos/001 - CODIGO/Contratos/CJ-001-0001/...).
// La llama pg_cron cada minuto, solo si ajustes_drive.activo y hay algo por subir.
// Se publica desde el panel de Supabase con "Verify JWT" apagado (como
// enviar-correos): solo procesa la cola, no recibe datos.
//
// La cuenta de servicio entra a la unidad compartida como MIEMBRO (Administrador
// de contenido): no hace falta delegación de dominio.
//
// Secretos (Supabase › Edge Functions › Secrets; nunca en el código):
//   DRIVE_SA_JSON  llave JSON de la cuenta de servicio (si falta, usa GMAIL_SA_JSON,
//                  la de los correos)
//   DRIVE_SUB      opcional: correo a nombre de quien sube (delegación de dominio);
//                  sin él sube la cuenta de servicio misma
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los pone Supabase solo.
// El id de la unidad compartida va en la tabla ajustes_drive (unidad_id).

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
    private unidad: string,
    private sb: SupabaseClient
  ) {
    this.cache.set("", unidad) // la raíz de la unidad compartida
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
      corpora: "drive",
      driveId: this.unidad,
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

Deno.serve(async () => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

  const { data: ajustes, error: errorAjustes } = await sb.from("ajustes_drive").select("activo, unidad_id").eq("id", true).maybeSingle()
  if (errorAjustes) return new Response(JSON.stringify({ error: errorAjustes.message }), { status: 500 })
  if (!ajustes?.activo || !ajustes.unidad_id) return new Response(JSON.stringify({ subidos: 0, motivo: "apagada" }))

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
