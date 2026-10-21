"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, Loader2, Search, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { documentoFormateado, type Contratista } from "@/lib/contratistas"
import {
  CONTRATO_GENERAL_VACIO,
  contratoGeneralDesde,
  leerNumero,
  pesos,
  pesosEnLetras,
  validarContratoGeneral,
  type CampoContratoGeneral,
  type ContratoGeneralForm,
  type SolicitudContratoDetalle,
} from "@/lib/contratos"
import { listarContratistas } from "@/app/(app)/contratos/contratistas/actions"
import { crearContratoGeneral, reenviarContratoGeneral } from "@/app/(app)/contratos/generales/actions"
import { CampoFecha } from "@/components/ui/campo-fecha"

// ---------------------------------------------------------------------------
// Formulario del contrato general (como el "Contrato General" de Sinco): es
// una hoja con datos y observaciones, sin documentos (decisión del usuario).
// Tipo Servicios u Otro (con cuál), contratista, descripción, valor global,
// fechas, forma de pago, retenciones, referencia y observaciones. Va a
// pre-aprobación de Jurídica como los de por grupos. El buscador de
// contratistas funciona igual que en solicitud-contrato-form.tsx.
// ---------------------------------------------------------------------------

const claseCampo = (conError = false) =>
  `h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60 ${
    conError ? "border-destructive" : ""
  }`
const claseArea = (conError = false) =>
  `w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60 ${
    conError ? "border-destructive" : ""
  }`

const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

function Seccion({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border bg-background p-4 sm:p-5">
      <div>
        <h2 className="text-sm font-semibold">{titulo}</h2>
        {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
      </div>
      {children}
    </section>
  )
}

function MensajeError({ texto }: { texto?: string }) {
  return texto ? <p className="text-xs text-destructive">{texto}</p> : null
}

function Campo({
  id,
  etiqueta,
  error,
  children,
}: {
  id: string
  etiqueta: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1" data-error={Boolean(error)}>
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {etiqueta}
      </label>
      {children}
      <MensajeError texto={error} />
    </div>
  )
}

export function ContratoGeneralFormulario({
  proyectoId,
  proyectoNombre,
  edicion,
  onCancelar,
  onEnviado,
}: {
  proyectoId: string
  proyectoNombre: string
  // Contrato general DEVUELTO que se corrige y reenvía (mismo número).
  edicion?: SolicitudContratoDetalle
  onCancelar: () => void
  onEnviado: (numero: number) => void
}) {
  const [f, setF] = useState<ContratoGeneralForm>(() => (edicion ? contratoGeneralDesde(edicion) : CONTRATO_GENERAL_VACIO))
  const [errores, setErrores] = useState<Partial<Record<CampoContratoGeneral, string>>>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const [contratistas, setContratistas] = useState<Contratista[] | null>(null)
  const [errorContratistas, setErrorContratistas] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState("")
  const [listaAbierta, setListaAbierta] = useState(false)

  useEffect(() => {
    listarContratistas()
      .then((lista: Contratista[]) => setContratistas(lista))
      .catch((e) => setErrorContratistas(e instanceof Error ? e.message : "No se pudieron cargar los contratistas."))
  }, [])

  const contratistaPorId = useMemo(() => new Map((contratistas ?? []).map((c) => [c.id, c])), [contratistas])
  const contratista = f.contratistaId ? contratistaPorId.get(f.contratistaId) ?? null : null
  const valor = leerNumero(f.valor)

  const coincidencias = useMemo(() => {
    if (!contratistas) return []
    const q = normalizar(busqueda.trim())
    const lista = q ? contratistas.filter((c) => normalizar(`${c.nombre} ${c.numeroDocumento}`).includes(q)) : contratistas
    return lista.slice(0, 8)
  }, [contratistas, busqueda])

  function cambiar<K extends keyof ContratoGeneralForm>(campo: K, v: ContratoGeneralForm[K], error?: CampoContratoGeneral) {
    setF((x) => ({ ...x, [campo]: v }))
    const clave = error ?? campo
    if (errores[clave]) setErrores((e) => ({ ...e, [clave]: undefined }))
  }

  function elegirContratista(c: Contratista) {
    setF((v) => ({
      ...v,
      contratistaId: c.id,
      correoNotificacion: !v.correoNotificacion || v.correoNotificacion === contratista?.correo ? c.correo : v.correoNotificacion,
    }))
    setErrores((e) => ({ ...e, contratistaId: undefined, correoNotificacion: undefined }))
    setBusqueda("")
    setListaAbierta(false)
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErrorGeneral(null)
    const r = validarContratoGeneral(f)
    setErrores(r.ok ? {} : r.errores)
    if (!r.ok) {
      setErrorGeneral("Revisa los campos marcados en rojo.")
      requestAnimationFrame(() => document.querySelector("[data-error='true']")?.scrollIntoView({ behavior: "smooth", block: "center" }))
      return
    }
    setEnviando(true)
    try {
      const numero = edicion
        ? await reenviarContratoGeneral(edicion.id, proyectoId, f, [])
        : await crearContratoGeneral(crypto.randomUUID(), proyectoId, f, [])
      onEnviado(numero)
    } catch (err) {
      setErrorGeneral(err instanceof Error ? err.message : "No se pudo mandar el contrato.")
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form onSubmit={enviar} noValidate className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={onCancelar} disabled={enviando}>
          <ArrowLeft className="size-4" /> Volver a los contratos
        </Button>
        <p className="text-sm text-muted-foreground">
          {edicion ? `Corregir contrato general N° ${edicion.numero} de ` : "Nuevo contrato general para "}
          <span className="font-medium text-foreground">{proyectoNombre}</span>
        </p>
      </div>
      {edicion?.motivoResolucion && (
        <div className="rounded-md border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-900">
          <p className="font-medium">Jurídica lo devolvió{edicion.resueltoPorNombre ? ` (${edicion.resueltoPorNombre})` : ""}. Motivo:</p>
          <p className="whitespace-pre-line">{edicion.motivoResolucion}</p>
        </div>
      )}

      <Seccion titulo="Tipo de contrato">
        <div className="flex flex-wrap items-start gap-2" data-error={Boolean(errores.tipo || errores.tipoDetalle)}>
          {(
            [
              ["servicios", "Servicios"],
              ["otro", "Otro"],
            ] as const
          ).map(([valorTipo, etiqueta]) => (
            <Button
              key={valorTipo}
              type="button"
              role="radio"
              aria-checked={f.tipo === valorTipo}
              variant={f.tipo === valorTipo ? "default" : "outline"}
              onClick={() => cambiar("tipo", valorTipo, "tipoDetalle")}
              disabled={enviando}
            >
              {etiqueta}
            </Button>
          ))}
          {f.tipo === "otro" && (
            <div className="min-w-56 flex-1">
              <input
                aria-label="Qué tipo de contrato es"
                value={f.tipoDetalle}
                onChange={(e) => cambiar("tipoDetalle", e.target.value)}
                disabled={enviando}
                placeholder="¿Cuál? Ej. Consultoría"
                autoFocus
                className={claseCampo(Boolean(errores.tipoDetalle))}
              />
            </div>
          )}
        </div>
        <MensajeError texto={errores.tipo ?? errores.tipoDetalle} />
      </Seccion>

      <Seccion titulo="Contratista" ayuda="Sus datos salen del directorio de Contratistas.">
        {errorContratistas && <p className="text-sm text-destructive">{errorContratistas}</p>}
        {contratista ? (
          <div className="flex flex-wrap items-start gap-2 rounded-md border bg-muted/30 p-3">
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium break-words">{contratista.nombre}</p>
              <p className="text-muted-foreground">{documentoFormateado(contratista)}</p>
              <p className="text-muted-foreground">
                {contratista.direccion}, {contratista.ciudad} · {contratista.telefono} · {contratista.correo}
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => cambiar("contratistaId", "")} disabled={enviando}>
              Cambiar
            </Button>
          </div>
        ) : (
          <div className="relative" data-error={Boolean(errores.contratistaId)}>
            <Search className="pointer-events-none absolute top-[18px] left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={busqueda}
              onChange={(e) => {
                setBusqueda(e.target.value)
                setListaAbierta(true)
              }}
              onFocus={() => setListaAbierta(true)}
              onBlur={() => setTimeout(() => setListaAbierta(false), 150)}
              placeholder={contratistas === null ? "Cargando contratistas..." : "Buscar contratista por nombre o documento"}
              disabled={enviando || contratistas === null}
              className={`${claseCampo(Boolean(errores.contratistaId))} pl-9`}
              role="combobox"
              aria-expanded={listaAbierta}
              aria-controls="lista-contratistas-general"
            />
            {listaAbierta && contratistas && (
              <ul id="lista-contratistas-general" role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover shadow-md">
                {coincidencias.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-muted-foreground">Ningún contratista coincide. Si es nuevo, créalo en Contratos › Contratistas.</li>
                ) : (
                  coincidencias.map((c) => (
                    <li key={c.id} role="option" aria-selected={false}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => elegirContratista(c)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                      >
                        <span className="font-medium">{c.nombre}</span>
                        <span className="block text-xs text-muted-foreground">{documentoFormateado(c)}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
            <MensajeError texto={errores.contratistaId} />
          </div>
        )}
      </Seccion>

      <Seccion titulo="Contrato">
        <Campo id="general-descripcion" etiqueta="Descripción *" error={errores.objeto}>
          <textarea
            id="general-descripcion"
            rows={2}
            value={f.objeto}
            onChange={(e) => cambiar("objeto", e.target.value)}
            disabled={enviando}
            placeholder="Ej. Realización de visitas de categorización"
            className={claseArea(Boolean(errores.objeto))}
          />
        </Campo>
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo id="general-valor" etiqueta="Valor del contrato *" error={errores.valor}>
            <input
              id="general-valor"
              inputMode="decimal"
              value={f.valor}
              onChange={(e) => cambiar("valor", e.target.value)}
              disabled={enviando}
              placeholder="17.340.500"
              className={`${claseCampo(Boolean(errores.valor))} text-right tabular-nums`}
            />
          </Campo>
          <Campo id="general-inicio" etiqueta="Fecha de inicio *" error={errores.plazo}>
            <CampoFecha
              sinEstilo
              id="general-inicio" value={f.fechaInicio} onChange={(e) => cambiar("fechaInicio", e.target.value, "plazo")} disabled={enviando} className={claseCampo(Boolean(errores.plazo))} />
          </Campo>
          <Campo id="general-fin" etiqueta="Fecha de terminación *">
            <CampoFecha
              sinEstilo
              id="general-fin"
              value={f.fechaFin}
              min={f.fechaInicio || undefined}
              onChange={(e) => cambiar("fechaFin", e.target.value, "plazo")}
              disabled={enviando}
              className={claseCampo(Boolean(errores.plazo))}
            />
          </Campo>
        </div>
        {valor !== null && valor > 0 && (
          <p className="rounded-md bg-muted/50 px-3 py-2 text-xs">
            <span className="font-medium">{pesos(valor)}: </span>
            {pesosEnLetras(valor)}
          </p>
        )}
        <Campo id="general-forma-pago" etiqueta="Forma de pago *" error={errores.formaPago}>
          <input
            id="general-forma-pago"
            value={f.formaPago}
            onChange={(e) => cambiar("formaPago", e.target.value)}
            disabled={enviando}
            placeholder="Ej. Semanal"
            className={claseCampo(Boolean(errores.formaPago))}
          />
        </Campo>
      </Seccion>

      <Seccion titulo="Retenciones y referencia" ayuda="Porcentajes del valor de cada pago. Vacío = 0 %.">
        <div className="grid gap-3 sm:grid-cols-4">
          {(
            [
              ["retencionGarantiaPct", "% Ret. garantías"],
              ["retencionAnticipoPct", "% Ret. anticipo"],
              ["retencionFicPct", "% Ret. FIC"],
            ] as const
          ).map(([campo, etiqueta]) => (
            <Campo key={campo} id={`general-${campo}`} etiqueta={etiqueta} error={errores[campo]}>
              <input
                id={`general-${campo}`}
                inputMode="decimal"
                value={f[campo]}
                onChange={(e) => cambiar(campo, e.target.value)}
                disabled={enviando}
                className={`${claseCampo(Boolean(errores[campo]))} text-right tabular-nums`}
              />
            </Campo>
          ))}
          <Campo id="general-referencia" etiqueta="Referencia">
            <input id="general-referencia" value={f.referencia} onChange={(e) => cambiar("referencia", e.target.value)} disabled={enviando} className={claseCampo()} />
          </Campo>
        </div>
      </Seccion>

      <Seccion titulo="Notificación y observaciones">
        <div className="max-w-md">
          <Campo id="general-correo" etiqueta="Correo electrónico de notificación *" error={errores.correoNotificacion}>
            <input
              id="general-correo"
              inputMode="email"
              value={f.correoNotificacion}
              onChange={(e) => cambiar("correoNotificacion", e.target.value)}
              placeholder={contratista ? undefined : "Se llena al elegir el contratista"}
              disabled={enviando}
              className={claseCampo(Boolean(errores.correoNotificacion))}
            />
          </Campo>
        </div>
        <Campo id="general-observaciones" etiqueta="Observaciones">
          <textarea
            id="general-observaciones"
            rows={4}
            value={f.observaciones}
            onChange={(e) => cambiar("observaciones", e.target.value)}
            disabled={enviando}
            placeholder="Actividades, entregables, condiciones de pago..."
            className={claseArea()}
          />
        </Campo>
      </Seccion>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        {errorGeneral && <p className="mr-auto text-sm text-destructive">{errorGeneral}</p>}
        <Button type="button" variant="outline" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </Button>
        <Button type="submit" disabled={enviando}>
          {enviando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {enviando ? "Enviando..." : edicion ? "Reenviar a pre-aprobación" : "Mandar a pre-aprobación"}
        </Button>
      </div>
    </form>
  )
}
