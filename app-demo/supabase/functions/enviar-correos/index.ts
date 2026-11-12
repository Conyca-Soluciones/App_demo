// Función de Supabase "enviar-correos" (20270101002100): toma la cola
// correos_salientes y envía cada correo con la API de Gmail, como el alias
// notificaciones@conycasoluciones.com (cuenta de servicio con delegación de todo
// el dominio, permiso solo gmail.send). La llama pg_cron cada minuto.
//
// Secretos (Supabase › Edge Functions › Secrets; nunca en el código):
//   GMAIL_SA_JSON    llave JSON de la cuenta de servicio
//   GMAIL_USUARIO    correo principal del usuario que tiene el alias
//   GMAIL_REMITENTE  notificaciones@conycasoluciones.com
//   GMAIL_NOMBRE     CONYCA 360
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los pone Supabase solo.

import { createClient } from "jsr:@supabase/supabase-js@2"

type Correo = { id: string; para: string; asunto: string; titulo: string; mensaje: string; enlace: string | null }

const enc = new TextEncoder()
const b64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""))
const b64url = (bytes: Uint8Array) => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const b64urlTexto = (s: string) => b64url(enc.encode(s))
// Encabezado con tildes: =?UTF-8?B?...?=
const encabezado = (s: string) => `=?UTF-8?B?${b64(enc.encode(s))}?=`

function escapar(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function html(c: Correo): string {
  const boton = c.enlace
    ? `<p style="margin:24px 0"><a href="${escapar(c.enlace)}" style="background:#3E70A1;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Abrir en 360</a></p>`
    : ""
  return `<!doctype html><html><body style="margin:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;color:#1f2933">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:8px;border:1px solid #e3e8ef">
<tr><td style="background:#3E70A1;color:#fff;padding:14px 20px;border-radius:8px 8px 0 0;font-weight:700">CONYCA 360</td></tr>
<tr><td style="padding:20px">
<h2 style="margin:0 0 12px;font-size:18px">${escapar(c.titulo)}</h2>
<p style="margin:0;font-size:14px;line-height:1.5;white-space:pre-line">${escapar(c.mensaje)}</p>
${boton}
<p style="margin:24px 0 0;font-size:12px;color:#7b8794">Este es un aviso automático de CONYCA 360. No respondas este correo.</p>
</td></tr></table></td></tr></table></body></html>`
}

// Token de acceso de Google: JWT firmado con la llave de la cuenta de servicio
// (RS256), a nombre del usuario que tiene el alias (delegación de dominio).
async function tokenGoogle(): Promise<string> {
  const sa = JSON.parse(Deno.env.get("GMAIL_SA_JSON") ?? "{}")
  const usuario = Deno.env.get("GMAIL_USUARIO")
  if (!sa.client_email || !sa.private_key || !usuario) throw new Error("Faltan los secretos GMAIL_SA_JSON o GMAIL_USUARIO.")
  const ahora = Math.floor(Date.now() / 1000)
  const cabecera = b64urlTexto(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const cuerpo = b64urlTexto(
    JSON.stringify({
      iss: sa.client_email,
      sub: usuario,
      scope: "https://www.googleapis.com/auth/gmail.send",
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

async function enviar(token: string, c: Correo) {
  const remitente = Deno.env.get("GMAIL_REMITENTE") ?? ""
  const nombre = Deno.env.get("GMAIL_NOMBRE") ?? "CONYCA 360"
  const mensaje = [
    `From: ${encabezado(nombre)} <${remitente}>`,
    `To: ${c.para}`,
    `Subject: ${encabezado(c.asunto)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(enc.encode(html(c))).replace(/.{76}/g, "$&\r\n"),
  ].join("\r\n")
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: b64urlTexto(mensaje) }),
  })
  if (!r.ok) throw new Error(`Gmail respondió ${r.status}: ${(await r.text()).slice(0, 300)}`)
}

Deno.serve(async () => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
  const { data, error } = await sb.rpc("tomar_correos", { p_limite: 20 })
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  const correos = (data ?? []) as Correo[]
  if (correos.length === 0) return new Response(JSON.stringify({ enviados: 0 }))

  let token: string
  try {
    token = await tokenGoogle()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    for (const c of correos) await sb.rpc("marcar_correo", { p_id: c.id, p_ok: false, p_error: msg })
    return new Response(JSON.stringify({ error: msg }), { status: 500 })
  }

  let enviados = 0
  for (const c of correos) {
    try {
      await enviar(token, c)
      await sb.rpc("marcar_correo", { p_id: c.id, p_ok: true, p_error: null })
      enviados++
    } catch (e) {
      await sb.rpc("marcar_correo", { p_id: c.id, p_ok: false, p_error: e instanceof Error ? e.message : String(e) })
    }
  }
  return new Response(JSON.stringify({ enviados, total: correos.length }))
})
