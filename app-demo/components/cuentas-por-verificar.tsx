"use client"

import { useEffect, useRef, useState } from "react"
import { confirmar } from "@/components/ui/confirmar"
import { CheckCircle2, ExternalLink, FileUp, Loader2, Pencil, RefreshCw, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { TerceroDialogo } from "@/components/tercero-dialogo"
import { createClient } from "@/lib/supabase/client"
import { formatearFechaHora } from "@/lib/fechas"
import {
  ETIQUETA_TIPO_CUENTA,
  documentoFormateado,
  type Banco,
  type CuentaPorVerificar,
  type Tercero,
} from "@/lib/terceros"
import {
  guardarCertificacionCuenta,
  listarBancos,
  listarCuentasPorVerificar,
  obtenerTercero,
  urlCertificacionCuenta,
  verificarCuentas,
} from "@/app/(app)/ayf/terceros/actions"

// ---------------------------------------------------------------------------
// Cuentas por verificar (20261231200000): todas las cuentas PENDIENTES en una
// lista; al elegir una se ve al lado su certificación bancaria y se verifica
// con un clic ("Verificar y seguir" pasa a la siguiente). También se pueden
// elegir varias y verificarlas juntas, subir la certificación que falte o
// abrir el tercero para corregir la cuenta.
// ---------------------------------------------------------------------------

const TIPOS_CERTIFICACION = ["application/pdf", "image/jpeg", "image/png"]
const MAX_BYTES = 10 * 1024 * 1024

export function CuentasPorVerificar({ puedeEditar, puedeVerificar }: { puedeEditar: boolean; puedeVerificar: boolean }) {
  const [cuentas, setCuentas] = useState<CuentaPorVerificar[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [version, setVersion] = useState(0)
  const [elegidaId, setElegidaId] = useState<string | null>(null)
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [bancos, setBancos] = useState<Banco[]>([])
  const [terceroAbierto, setTerceroAbierto] = useState<Tercero | null>(null)
  const [busqueda, setBusqueda] = useState("")

  useEffect(() => {
    let activo = true
    listarCuentasPorVerificar()
      .then((lista: CuentaPorVerificar[]) => {
        if (!activo) return
        setCuentas(lista)
        setError(null)
        // Sigue elegida la misma si todavía está; si no, la primera.
        const enLista = new Set(lista.map((c) => c.cuentaId))
        setElegidaId((id) => (id && enLista.has(id) ? id : (lista[0]?.cuentaId ?? null)))
        setMarcadas((m) => new Set([...m].filter((id) => enLista.has(id))))
      })
      .catch((e) => activo && setError(e instanceof Error ? e.message : "No se pudieron cargar las cuentas."))
      .finally(() => activo && setCargando(false))
    return () => {
      activo = false
    }
  }, [version])

  useEffect(() => {
    listarBancos()
      .then((b: Banco[]) => setBancos(b))
      .catch(() => {})
  }, [])

  function recargar() {
    setCargando(true)
    setVersion((v) => v + 1)
  }

  // Búsqueda por tercero, documento, banco o número de cuenta (sin tildes).
  const sinTildes = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  const q = sinTildes(busqueda.trim())
  const todas = cuentas ?? []
  const lista = q
    ? todas.filter((c) => sinTildes(`${c.razonSocial} ${c.numeroDocumento} ${c.banco} ${c.numeroCuenta} ${c.etiqueta ?? ""}`).includes(q))
    : todas
  const indice = lista.findIndex((c) => c.cuentaId === elegidaId)
  const elegida = indice >= 0 ? lista[indice] : null

  // Quita las verificadas de la lista y elige la que seguía.
  function quitar(ids: string[]) {
    const fuera = new Set(ids)
    const resto = lista.filter((c) => !fuera.has(c.cuentaId))
    const siguiente = lista.slice(Math.max(indice, 0)).find((c) => !fuera.has(c.cuentaId)) ?? resto[0] ?? null
    setCuentas(resto)
    setElegidaId(siguiente?.cuentaId ?? null)
    setMarcadas((m) => new Set([...m].filter((id) => !fuera.has(id))))
  }

  async function correr(etiqueta: string, paso: () => Promise<string | null>) {
    setOcupado(etiqueta)
    setError(null)
    setAviso(null)
    try {
      const m = await paso()
      if (m) setAviso(m)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar.")
    } finally {
      setOcupado(null)
    }
  }

  const verificarUna = (c: CuentaPorVerificar) =>
    correr("verificar", async () => {
      const n = await verificarCuentas([c.cuentaId])
      quitar([c.cuentaId])
      return n > 0 ? `Cuenta de ${c.razonSocial} verificada.` : "Esa cuenta ya no estaba pendiente."
    })

  const verificarMarcadas = () =>
    correr("varias", async () => {
      const ids = [...marcadas]
      if (
        !(await confirmar(
          `¿Verificar ${ids.length} ${ids.length === 1 ? "cuenta" : "cuentas"}? Confirma que revisaste la certificación bancaria de cada una: una cuenta verificada ya puede recibir pagos.`,
          { titulo: "Verificar cuentas", boton: `Verificar ${ids.length}` }
        ))
      )
        return null
      const n = await verificarCuentas(ids)
      quitar(ids)
      return `${n} ${n === 1 ? "cuenta verificada" : "cuentas verificadas"}.`
    })

  const abrirTercero = (c: CuentaPorVerificar) =>
    correr("tercero", async () => {
      setTerceroAbierto(await obtenerTercero(c.terceroId))
      return null
    })

  const todasMarcadas = lista.length > 0 && marcadas.size === lista.length

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">
          {cuentas === null
            ? "Buscando cuentas…"
            : `${todas.length} ${todas.length === 1 ? "cuenta pendiente" : "cuentas pendientes"} de verificar${q ? ` · ${lista.length} con «${busqueda.trim()}»` : ""}`}
        </p>
        <Input
          type="search"
          aria-label="Buscar cuenta"
          placeholder="Buscar tercero, documento o cuenta"
          className="h-8 w-64"
          value={busqueda}
          onChange={(e) => {
            setBusqueda(e.target.value)
            // Lo marcado que deja de verse no se verifica a ciegas.
            setMarcadas(new Set())
          }}
        />
        <div className="ml-auto flex flex-wrap gap-2">
          {puedeVerificar && (
            <Button size="sm" disabled={marcadas.size === 0 || ocupado !== null} onClick={verificarMarcadas}>
              {ocupado === "varias" ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <ShieldCheck className="mr-1.5 size-4" />}
              Verificar marcadas{marcadas.size > 0 ? ` (${marcadas.size})` : ""}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={recargar} disabled={cargando}>
            {cargando ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <RefreshCw className="mr-1.5 size-4" />}
            Actualizar
          </Button>
        </div>
      </div>

      {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>}
      {aviso && <div className="rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-800">{aviso}</div>}

      {cuentas !== null && todas.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          <CheckCircle2 className="size-8 text-emerald-600" />
          <p className="font-medium text-foreground">No hay cuentas por verificar</p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          {/* Lista */}
          <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border">
            <label className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
              <Checkbox
                checked={todasMarcadas}
                disabled={lista.length === 0}
                onCheckedChange={() => setMarcadas(todasMarcadas ? new Set() : new Set(lista.map((c) => c.cuentaId)))}
              />
              {q ? "Marcar todas las de la búsqueda" : "Marcar todas"}
            </label>
            {cuentas !== null && lista.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Ninguna cuenta coincide con la búsqueda.</p>
            )}
            <div className="min-h-0 flex-1 overflow-auto">
              {cuentas === null && (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" /> Cargando…
                </div>
              )}
              {lista.map((c) => (
                <div
                  key={c.cuentaId}
                  className={`flex items-start gap-2 border-b px-3 py-2.5 last:border-b-0 ${
                    c.cuentaId === elegidaId ? "bg-accent" : "hover:bg-muted/50"
                  }`}
                >
                  <Checkbox
                    className="mt-0.5"
                    aria-label={`Marcar la cuenta de ${c.razonSocial}`}
                    checked={marcadas.has(c.cuentaId)}
                    onCheckedChange={() =>
                      setMarcadas((m) => {
                        const n = new Set(m)
                        if (n.has(c.cuentaId)) n.delete(c.cuentaId)
                        else n.add(c.cuentaId)
                        return n
                      })
                    }
                  />
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setElegidaId(c.cuentaId)}>
                    <p className="truncate text-sm font-medium">{c.razonSocial}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.banco} · {ETIQUETA_TIPO_CUENTA[c.tipoCuenta] ?? c.tipoCuenta} · {c.numeroCuenta}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.pagos > 0 && (
                        <Badge variant="outline" className="h-5 border-amber-300 bg-amber-50 px-1.5 text-[10px] text-amber-800">
                          {c.pagos} {c.pagos === 1 ? "pago espera" : "pagos esperan"}
                        </Badge>
                      )}
                      {!c.certificacion && (
                        <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
                          Sin certificación
                        </Badge>
                      )}
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Detalle de la elegida */}
          {elegida ? (
            <DetalleCuenta
              key={elegida.cuentaId}
              cuenta={elegida}
              puedeEditar={puedeEditar}
              puedeVerificar={puedeVerificar}
              ocupado={ocupado}
              onVerificar={() => verificarUna(elegida)}
              onEditar={() => abrirTercero(elegida)}
              onCertificacionSubida={recargar}
              onError={setError}
            />
          ) : (
            <div className="hidden items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground lg:flex">
              Elige una cuenta de la lista.
            </div>
          )}
        </div>
      )}

      <TerceroDialogo
        tercero={terceroAbierto}
        bancos={bancos}
        puedeEditar={puedeEditar}
        puedeVerificar={puedeVerificar}
        onCambio={setTerceroAbierto}
        // Al cerrar se vuelve a la lista con lo que haya cambiado.
        onCerrar={() => {
          setTerceroAbierto(null)
          recargar()
        }}
      />
    </div>
  )
}

function Dato({ etiqueta, valor, grande }: { etiqueta: string; valor: string; grande?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      <p className={`break-words ${grande ? "font-mono text-lg font-semibold tracking-wide" : "text-sm"}`}>{valor || "—"}</p>
    </div>
  )
}

function DetalleCuenta({
  cuenta: c,
  puedeEditar,
  puedeVerificar,
  ocupado,
  onVerificar,
  onEditar,
  onCertificacionSubida,
  onError,
}: {
  cuenta: CuentaPorVerificar
  puedeEditar: boolean
  puedeVerificar: boolean
  ocupado: string | null
  onVerificar: () => void
  onEditar: () => void
  onCertificacionSubida: () => void
  onError: (m: string | null) => void
}) {
  const [doc, setDoc] = useState<{ url: string; nombre: string; mime: string } | null>(null)
  const [cargandoDoc, setCargandoDoc] = useState(Boolean(c.certificacion))
  const [subiendo, setSubiendo] = useState(false)
  const archivoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!c.certificacion) return
    let activo = true
    urlCertificacionCuenta(c.cuentaId)
      .then((d) => activo && setDoc(d))
      .catch((e) => activo && onError(e instanceof Error ? e.message : "No se pudo abrir la certificación."))
      .finally(() => activo && setCargandoDoc(false))
    return () => {
      activo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.cuentaId, c.certificacion?.nombre])

  async function subir(archivo: File) {
    if (!TIPOS_CERTIFICACION.includes(archivo.type)) return onError("La certificación debe ser PDF, JPG o PNG.")
    if (archivo.size > MAX_BYTES) return onError("La certificación pesa más de 10 MB.")
    setSubiendo(true)
    onError(null)
    const supabase = createClient()
    const ext = archivo.type === "application/pdf" ? "pdf" : archivo.type === "image/png" ? "png" : "jpg"
    const ruta = `${c.cuentaId}/${Date.now()}.${ext}`
    let subido = false
    try {
      const { error } = await supabase.storage.from("terceros").upload(ruta, archivo, { contentType: archivo.type, upsert: false })
      if (error) throw new Error(`No se pudo subir la certificación: ${error.message}`)
      subido = true
      await guardarCertificacionCuenta(c.cuentaId, ruta, archivo.name, archivo.type)
      onCertificacionSubida()
    } catch (e) {
      if (subido) await supabase.storage.from("terceros").remove([ruta])
      onError(e instanceof Error ? e.message : "No se pudo guardar la certificación.")
    } finally {
      setSubiendo(false)
    }
  }

  const esImagen = doc?.mime.startsWith("image/")

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-auto rounded-lg border p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold">{c.razonSocial}</p>
          <p className="text-sm text-muted-foreground">
            {c.tipoDocumento} {documentoFormateado(c)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {puedeEditar && (
            <Button size="sm" variant="outline" disabled={ocupado !== null} onClick={onEditar} title="Abre el tercero para corregir la cuenta o sus datos">
              {ocupado === "tercero" ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Pencil className="mr-1.5 size-4" />}
              Editar
            </Button>
          )}
          {puedeVerificar && (
            <Button size="sm" disabled={ocupado !== null} onClick={onVerificar}>
              {ocupado === "verificar" ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <ShieldCheck className="mr-1.5 size-4" />}
              Verificar y seguir
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 rounded-md bg-muted/40 p-3 sm:grid-cols-3">
        <Dato etiqueta="Banco" valor={c.banco} />
        <Dato etiqueta="Tipo de cuenta" valor={ETIQUETA_TIPO_CUENTA[c.tipoCuenta] ?? c.tipoCuenta} />
        <Dato etiqueta="Número de cuenta" valor={c.numeroCuenta} grande />
        {c.etiqueta && <Dato etiqueta="Etiqueta" valor={c.etiqueta} />}
        <Dato etiqueta="Creada por" valor={`${c.creadoPor ?? "Carga de datos"}${c.creadoEn ? ` · ${formatearFechaHora(c.creadoEn)}` : ""}`} />
        <Dato etiqueta="Pagos que la esperan" valor={String(c.pagos)} />
        {c.observaciones && (
          <div className="sm:col-span-3">
            <Dato etiqueta="Observaciones" valor={c.observaciones} />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">Certificación bancaria</p>
        {c.certificacion?.origen === "contratista" && (
          <span className="text-xs text-muted-foreground">(la que subió el contratista)</span>
        )}
        <div className="ml-auto flex gap-2">
          {doc && (
            <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted">
              <ExternalLink className="size-4" /> Abrir aparte
            </a>
          )}
          <Button size="sm" variant="outline" disabled={subiendo} onClick={() => archivoRef.current?.click()}>
            {subiendo ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <FileUp className="mr-1.5 size-4" />}
            {c.certificacion?.origen === "cuenta" ? "Cambiar certificación" : "Subir certificación"}
          </Button>
          <input
            ref={archivoRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ""
              if (f) void subir(f)
            }}
          />
        </div>
      </div>

      {!c.certificacion ? (
        <div className="flex min-h-48 flex-1 items-center justify-center rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Esta cuenta no tiene certificación bancaria. Súbela para verificarla con el documento a la vista.
        </div>
      ) : cargandoDoc ? (
        <div className="flex min-h-[60svh] items-center justify-center rounded-md border text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" /> Cargando certificación…
        </div>
      ) : !doc ? (
        <div className="flex min-h-48 items-center justify-center rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No tienes permiso para ver esta certificación.
        </div>
      ) : esImagen ? (
        <div className="flex min-h-[60svh] items-center justify-center overflow-auto rounded-md border bg-muted/30">
          {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado temporal de Storage */}
          <img src={doc.url} alt={`Certificación de ${c.razonSocial}`} className="max-h-[70svh] max-w-full object-contain" />
        </div>
      ) : (
        <iframe src={doc.url} title={`Certificación de ${c.razonSocial}`} className="min-h-[60svh] w-full flex-1 rounded-md border bg-muted/30" />
      )}
    </div>
  )
}
