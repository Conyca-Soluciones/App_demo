"use client"

import { useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, FileText, History, Loader2, Paperclip, Send, Wrench } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { leerNumero } from "@/lib/contratos"
import { formatearFechaHora } from "@/lib/fechas"
import {
  anticiposOrigen,
  cuadreLiquidacion,
  etiquetaEtapa,
  formatoMoneda,
  rutaSoportePago,
  type ComentarioPago,
  type FilaLiquidacion,
  type Pago,
  type SoportePago,
  type TipoComentarioPago,
} from "@/lib/pagos"
import {
  comentarPago,
  enviarPagosALiquidar,
  liquidarPagos,
  listarComentariosPago,
  obtenerPagoConsolidado,
} from "@/app/(app)/ayf/consolidado/actions"

// ---------------------------------------------------------------------------
// Doble clic en un pago del Consolidado: todo lo del pago en una ventana, para
// trabajar sin salir de la lista (Anterior / Siguiente): sus datos, el
// soporte, la liquidación (Contabilidad), los comentarios con Financiera y los
// botones de la fila (historial, tercero y cuenta, documento de origen).
// ---------------------------------------------------------------------------

const CAMPOS = [
  { clave: "base", titulo: "Base" },
  { clave: "iva", titulo: "IVA" },
  { clave: "retefuente", titulo: "Retefuente" },
  { clave: "reteiva", titulo: "Retención de IVA" },
  { clave: "reteica", titulo: "Retención de ICA" },
  { clave: "asumidas", titulo: "Asumidas" },
  { clave: "liquidaciones", titulo: "Liquidaciones" },
  { clave: "anticiposDescuentos", titulo: "Anticipos y/o descuentos" },
  { clave: "valorAPagar", titulo: "Valor a pagar" },
] as const
type ClaveCampo = (typeof CAMPOS)[number]["clave"]

const aTexto = (n: number | null) => (n == null ? "" : String(n).replace(".", ","))

function formularioDe(p: Pago): Record<ClaveCampo, string> {
  return {
    base: aTexto(p.liqBase ?? p.baseGravable),
    iva: aTexto(p.liqIva ?? p.iva),
    retefuente: aTexto(p.retefuente),
    reteiva: aTexto(p.reteiva),
    reteica: aTexto(p.reteica),
    asumidas: aTexto(p.asumidas),
    liquidaciones: aTexto(p.liquidaciones),
    anticiposDescuentos: aTexto(p.liqAnticiposDescuentos ?? anticiposOrigen(p)),
    valorAPagar: aTexto(p.valorAPagar),
  }
}

const CLASE_ETAPA: Record<string, string> = {
  "En preparación": "border-gray-300 bg-gray-50 text-gray-600",
  "Por liquidar": "border-amber-300 bg-amber-50 text-amber-700",
  Observado: "border-red-300 bg-red-50 text-red-700",
  Liquidado: "border-green-300 bg-green-50 text-green-700",
}

export function EtiquetaEtapa({ pago }: { pago: Pick<Pago, "estado" | "liquidacionEstado"> }) {
  const t = etiquetaEtapa(pago)
  return (
    <Badge variant="outline" className={`h-6 px-3 text-xs ${CLASE_ETAPA[t] ?? "border-gray-300 bg-gray-50 text-gray-600"}`}>
      {t}
    </Badge>
  )
}

export function VentanaPagoLiquidacion({
  pagos,
  indice,
  soportes,
  puedeGestionar,
  puedeLiquidar,
  onIndice,
  onCerrar,
  onCambio,
  onHistorial,
  onTercero,
  onOrigen,
}: {
  pagos: Pago[]
  indice: number | null
  soportes: Record<string, SoportePago>
  puedeGestionar: boolean
  puedeLiquidar: boolean
  onIndice: (i: number) => void
  onCerrar: () => void
  onCambio: (p: Pago) => void
  onHistorial: (p: Pago) => void
  onTercero: (p: Pago) => void
  onOrigen: (p: Pago) => void
}) {
  const pago = indice != null ? pagos[indice] ?? null : null
  return (
    <Dialog open={pago !== null} onOpenChange={(a) => !a && onCerrar()}>
      <DialogContent className="max-h-[94svh] w-[calc(100vw-1rem)] max-w-4xl overflow-y-auto sm:max-w-4xl">
        {pago && indice != null && (
          <Contenido
            key={`${pago.id}-${pago.liquidacionEstado}-${pago.valorAPagar}`}
            pago={pago}
            soporte={soportes[pago.id] ?? null}
            puedeGestionar={puedeGestionar}
            puedeLiquidar={puedeLiquidar}
            anterior={indice > 0 ? () => onIndice(indice - 1) : null}
            siguiente={indice < pagos.length - 1 ? () => onIndice(indice + 1) : null}
            posicion={`${indice + 1} de ${pagos.length}`}
            onCambio={onCambio}
            onHistorial={() => onHistorial(pago)}
            onTercero={() => onTercero(pago)}
            onOrigen={() => onOrigen(pago)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function Dato({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{titulo}</div>
      <div className="truncate text-sm">{children}</div>
    </div>
  )
}

function Contenido({
  pago,
  soporte,
  puedeGestionar,
  puedeLiquidar,
  anterior,
  siguiente,
  posicion,
  onCambio,
  onHistorial,
  onTercero,
  onOrigen,
}: {
  pago: Pago
  soporte: SoportePago | null
  puedeGestionar: boolean
  puedeLiquidar: boolean
  anterior: (() => void) | null
  siguiente: (() => void) | null
  posicion: string
  onCambio: (p: Pago) => void
  onHistorial: () => void
  onTercero: () => void
  onOrigen: () => void
}) {
  const [form, setForm] = useState<Record<ClaveCampo, string>>(() => formularioDe(pago))
  const [comentarios, setComentarios] = useState<ComentarioPago[] | null>(null)
  const [nuevo, setNuevo] = useState("")
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    listarComentariosPago(pago.id)
      .then((c: ComentarioPago[]) => vigente && setComentarios(c))
      .catch((e) => vigente && setError(e instanceof Error ? e.message : "No se pudieron cargar los comentarios."))
    return () => {
      vigente = false
    }
  }, [pago.id])

  const aprobado = pago.estado === "aprobado"
  const enLiquidacion = aprobado && pago.liquidacionEstado != null
  const editable = puedeLiquidar && enLiquidacion
  const documento = pago.valorDocumento ?? pago.valor
  const numeros = Object.fromEntries(CAMPOS.map((c) => [c.clave, form[c.clave].trim() === "" ? null : leerNumero(form[c.clave])])) as Record<
    ClaveCampo,
    number | null
  >
  const cuadre = cuadreLiquidacion(documento, numeros)

  async function refrescar() {
    const p = await obtenerPagoConsolidado(pago.id)
    onCambio(p)
    return p
  }

  async function correr(etiqueta: string, paso: () => Promise<string | null>, luegoSiguiente = false) {
    setOcupado(etiqueta)
    setError(null)
    setAviso(null)
    try {
      const mensaje = await paso()
      if (mensaje) setAviso(mensaje)
      if (luegoSiguiente && siguiente) siguiente()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.")
    } finally {
      setOcupado(null)
    }
  }

  function fila(sinRetenciones: boolean): FilaLiquidacion {
    for (const c of CAMPOS) {
      const v = numeros[c.clave]
      if (form[c.clave].trim() !== "" && (v == null || v < 0)) throw new Error(`"${c.titulo}" tiene que ser un número mayor o igual a cero.`)
    }
    return {
      pagoId: pago.id,
      base: numeros.base,
      iva: numeros.iva,
      retefuente: numeros.retefuente,
      reteiva: numeros.reteiva,
      reteica: numeros.reteica,
      asumidas: numeros.asumidas,
      liquidaciones: numeros.liquidaciones,
      anticiposDescuentos: numeros.anticiposDescuentos,
      valorAPagar: numeros.valorAPagar,
      sinRetenciones,
      comentario: null,
    }
  }

  async function liquidar(sinRetenciones: boolean, luegoSiguiente: boolean) {
    await correr(
      sinRetenciones ? "sin" : "liquidar",
      async () => {
        const f = fila(sinRetenciones)
        if (!sinRetenciones && f.valorAPagar == null) throw new Error("Escribe el valor a pagar (o usa Liquidar sin retenciones).")
        const [r] = await liquidarPagos([f])
        if (r?.resultado === "error") throw new Error(r.mensaje ?? "No se pudo liquidar.")
        await refrescar()
        return r?.resultado === "sin_cambios" ? "No había cambios." : null
      },
      luegoSiguiente
    )
  }

  async function comentar(tipo: TipoComentarioPago) {
    await correr(tipo, async () => {
      if (!nuevo.trim()) throw new Error("Escribe el comentario.")
      await comentarPago(pago.id, nuevo, tipo)
      setNuevo("")
      setComentarios(await listarComentariosPago(pago.id))
      await refrescar()
      return null
    })
  }

  return (
    <>
      <DialogHeader>
        <div className="flex flex-wrap items-center gap-2 pr-8">
          <DialogTitle className="mr-auto">
            {pago.item != null ? `ITEM ${pago.item}` : "Pago"}
            {pago.semana != null ? ` · semana ${pago.semana} de ${pago.anio}` : ""}
          </DialogTitle>
          <EtiquetaEtapa pago={pago} />
          <span className="text-xs text-muted-foreground">{posicion}</span>
          <Button size="sm" variant="outline" className="h-8 w-8 p-0" disabled={!anterior || ocupado !== null} onClick={() => anterior?.()} aria-label="Pago anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" className="h-8 w-8 p-0" disabled={!siguiente || ocupado !== null} onClick={() => siguiente?.()} aria-label="Pago siguiente">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <DialogDescription className="truncate">{pago.concepto}</DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-3 rounded-md border p-3 sm:grid-cols-4">
        <Dato titulo="Grupo empresarial">{pago.empresaNombre ?? "—"}</Dato>
        <Dato titulo="Empresa que factura">
          {pago.terceroNombre ?? "Sin tercero"}
          {pago.terceroDocumento && <span className="block text-xs text-muted-foreground">{pago.terceroDocumento}</span>}
        </Dato>
        <Dato titulo="Solicitante">{pago.solicitadoPorNombre ?? "—"}</Dato>
        <Dato titulo="Origen">{pago.origen || "—"}</Dato>
        <Dato titulo="Valor documento">{formatoMoneda(documento)}</Dato>
        <Dato titulo="Base / IVA (del documento)">
          {pago.baseGravable != null ? formatoMoneda(pago.baseGravable) : "—"} / {pago.iva != null ? formatoMoneda(pago.iva) : "—"}
        </Dato>
        <Dato titulo="Anticipos y descuentos del origen">{formatoMoneda(anticiposOrigen(pago))}</Dato>
        <Dato titulo="Valor del pago">{formatoMoneda(pago.valor)}</Dato>
        <div className="col-span-2 min-w-0 sm:col-span-4">
          <div className="text-xs text-muted-foreground">Cuenta</div>
          <div className="text-sm">
            {pago.cuentaTexto ? (
              <>
                {pago.cuentaTitular && <span className="font-medium">Titular: {pago.cuentaTitular} · </span>}
                <span className={pago.cuentaVerificada ? "" : "text-amber-700"}>
                  {pago.cuentaTexto}
                  {pago.cuentaVerificada ? "" : " (sin verificar)"}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Sin cuenta</span>
            )}
          </div>
          {pago.novedad && <p className="mt-1 text-xs text-amber-700">{pago.novedad}</p>}
          {pago.pagoObservaciones && (
            <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
              Observaciones del pago: {pago.pagoObservaciones}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {soporte ? (
          <a href={rutaSoportePago(pago.id)} target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm", variant: "outline" })} title={soporte.nombre}>
            <Paperclip className="mr-1.5 h-4 w-4" /> Ver soporte
          </a>
        ) : (
          <span className="self-center text-sm text-muted-foreground">Sin soporte</span>
        )}
        <Button size="sm" variant="outline" onClick={onOrigen}>
          <FileText className="mr-1.5 h-4 w-4" /> Ver {pago.ordenCompraId ? "orden de compra" : pago.actaId ? "acta" : "documento"}
        </Button>
        <Button size="sm" variant="outline" onClick={onHistorial}>
          <History className="mr-1.5 h-4 w-4" /> Historial
        </Button>
        {puedeGestionar && aprobado && (
          <Button size="sm" variant="outline" onClick={onTercero}>
            <Wrench className="mr-1.5 h-4 w-4" /> Tercero y cuenta
          </Button>
        )}
        {puedeGestionar && aprobado && pago.liquidacionEstado == null && (
          <Button
            size="sm"
            className="ml-auto"
            disabled={ocupado !== null}
            onClick={() =>
              correr(
                "enviar",
                async () => {
                  await enviarPagosALiquidar([pago.id])
                  await refrescar()
                  return null
                },
                true
              )
            }
          >
            {ocupado === "enviar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
            Enviar a liquidar
          </Button>
        )}
      </div>

      {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      {aviso && <div className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{aviso}</div>}

      {enLiquidacion && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">Liquidación</h3>
            <span className="text-xs text-muted-foreground">
              Esperado según los descuentos: <span className="tabular-nums">{formatoMoneda(cuadre.esperado)}</span>
              {cuadre.diferencia != null && Math.abs(cuadre.diferencia) >= 1 && (
                <span className="ml-2 font-medium text-red-700">No cuadra por {formatoMoneda(cuadre.diferencia)}</span>
              )}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {CAMPOS.map((c) => (
              <label key={c.clave} className="min-w-0 space-y-1">
                <span className="text-xs text-muted-foreground">{c.titulo}</span>
                <Input
                  inputMode="decimal"
                  className={`tabular-nums ${c.clave === "valorAPagar" ? "font-medium" : ""}`}
                  value={form[c.clave]}
                  disabled={!editable || ocupado !== null}
                  onChange={(e) => setForm((f) => ({ ...f, [c.clave]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && editable && liquidar(false, true)}
                />
              </label>
            ))}
          </div>
          {editable && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="outline" disabled={ocupado !== null} onClick={() => liquidar(true, true)}>
                {ocupado === "sin" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Liquidar sin retenciones
              </Button>
              <Button size="sm" variant="outline" disabled={ocupado !== null} onClick={() => liquidar(false, false)}>
                Guardar liquidación
              </Button>
              <Button size="sm" disabled={ocupado !== null || !siguiente} onClick={() => liquidar(false, true)}>
                {ocupado === "liquidar" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Guardar y siguiente
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2 rounded-md border p-3">
        <h3 className="text-sm font-medium">Comentarios</h3>
        {comentarios === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </p>
        ) : comentarios.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin comentarios.</p>
        ) : (
          <ul className="max-h-56 space-y-2 overflow-y-auto">
            {comentarios.map((c) => (
              <li key={c.id} className={`rounded-md px-3 py-2 text-sm ${c.tipo === "observacion" ? "bg-red-50" : c.tipo === "respuesta" ? "bg-blue-50" : "bg-muted/50"}`}>
                <div className="text-xs text-muted-foreground">
                  {c.autor ?? "—"} · {formatearFechaHora(c.creadoEn)}
                  {c.tipo === "observacion" ? " · Observación" : c.tipo === "respuesta" ? " · Devuelto a Contabilidad" : ""}
                </div>
                <div className="whitespace-pre-wrap">{c.texto}</div>
              </li>
            ))}
          </ul>
        )}
        {(puedeLiquidar || puedeGestionar) && aprobado && (
          <>
            <Textarea rows={2} value={nuevo} placeholder="Escribe un comentario…" onChange={(e) => setNuevo(e.target.value)} disabled={ocupado !== null} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="outline" disabled={ocupado !== null || !nuevo.trim()} onClick={() => comentar("comentario")}>
                Solo comentar
              </Button>
              {puedeLiquidar && enLiquidacion && (
                <Button size="sm" variant="outline" className="text-red-700" disabled={ocupado !== null || !nuevo.trim()} onClick={() => comentar("observacion")}>
                  Observar (a Financiera)
                </Button>
              )}
              {puedeGestionar && pago.liquidacionEstado === "observado" && (
                <Button size="sm" disabled={ocupado !== null || !nuevo.trim()} onClick={() => comentar("respuesta")}>
                  Responder y devolver a Contabilidad
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
