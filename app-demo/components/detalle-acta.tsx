"use client"

import { useEffect, useState } from "react"
import { FileDown, Loader2, Paperclip, Pencil, Receipt } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { VisorDocumento } from "@/components/visor-documento"
import { HistorialTimeline } from "@/components/historial-timeline"
import { tituloTipoContrato } from "@/components/detalle-solicitud-contrato"
import { formatearFechaSinHora } from "@/lib/fechas"
import { createClient } from "@/lib/supabase/client"
import { numero, pesos } from "@/lib/contratos"
import {
  CLASE_ESTADO_ACTA,
  ETIQUETA_ESTADO_ACTA,
  ETIQUETA_SOPORTE,
  ETIQUETA_TIPO_ACTA,
  resumenPagosActa,
  saldoContrato,
  validarSoporte,
  type ActaDetalle,
  type SoporteActa,
  numeroActa,
} from "@/lib/actas"
import { enlaceSoporteActa, obtenerActa, reemplazarSoporteActa, subirFacturaActa } from "@/app/(app)/contratos/actas/actions"

// Detalle de un acta en un diálogo (Actas por grupos y Aprobación de actas):
// el contrato con su cupo, lo ejecutado (actividades o % de avance), los
// descuentos y el neto, los soportes, el pago en A&F, el historial y el PDF.
// Cada pantalla pone sus botones. Aprobada sin factura, quien elabora actas
// sube la factura y su pago pasa a A&F (puedeSubirFactura).
export function DetalleActa({
  id,
  onCerrar,
  acciones,
  puedeSubirFactura,
}: {
  id: string | null
  onCerrar: () => void
  acciones?: (acta: ActaDetalle) => React.ReactNode
  puedeSubirFactura?: boolean
}) {
  const [acta, setActa] = useState<ActaDetalle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viendo, setViendo] = useState<SoporteActa | null>(null)
  const [recarga, setRecarga] = useState(0)
  const [tipoFactura, setTipoFactura] = useState<"factura" | "cuenta_cobro">("factura")
  const [subiendoFactura, setSubiendoFactura] = useState(false)
  const [errorFactura, setErrorFactura] = useState<string | null>(null)
  // Soporte que se está reemplazando ("Modificar soporte") y su error.
  const [reemplazando, setReemplazando] = useState<string | null>(null)
  const [errorReemplazo, setErrorReemplazo] = useState<{ id: string; texto: string } | null>(null)

  useEffect(() => {
    if (!id) return
    let vigente = true
    obtenerActa(id)
      .then((a) => vigente && setActa(a))
      .catch((e) => vigente && setError(e instanceof Error ? e.message : "No se pudo cargar el acta."))
    return () => {
      vigente = false
    }
  }, [id, recarga])

  // Acta aprobada sin factura: se sube y los pagos aprobados pasan a A&F.
  async function subirFactura(actaId: string, archivo: File | undefined) {
    if (!archivo) return
    const problema = validarSoporte(archivo)
    if (problema) return setErrorFactura(problema)
    const supabase = createClient()
    const ext = archivo.name.includes(".") ? archivo.name.split(".").pop()!.toLowerCase() : "pdf"
    const ruta = rutaSoporteNuevo(actaId, tipoFactura, ext)
    setSubiendoFactura(true)
    setErrorFactura(null)
    let subido = false
    try {
      const { error: e } = await supabase.storage.from("actas").upload(ruta, archivo, { contentType: archivo.type, upsert: false })
      if (e) throw new Error(`No se pudo subir el archivo: ${e.message}`)
      subido = true
      await subirFacturaActa(actaId, { tipo: tipoFactura, ruta, nombreArchivo: archivo.name, tamano: archivo.size, mime: archivo.type })
      subido = false
      setRecarga((n) => n + 1)
    } catch (e) {
      if (subido) await supabase.storage.from("actas").remove([ruta])
      setErrorFactura(e instanceof Error ? e.message : "No se pudo guardar la factura.")
    } finally {
      setSubiendoFactura(false)
    }
  }

  // El archivo nuevo se sube primero; si la base no lo acepta, se borra.
  async function reemplazarSoporte(actaId: string, soporte: SoporteActa, archivo: File | undefined) {
    if (!archivo) return
    const problema = validarSoporte(archivo)
    if (problema) return setErrorReemplazo({ id: soporte.id, texto: problema })
    const supabase = createClient()
    const ext = archivo.name.includes(".") ? archivo.name.split(".").pop()!.toLowerCase() : "pdf"
    const ruta = rutaSoporteNuevo(actaId, soporte.tipo, ext)
    setReemplazando(soporte.id)
    setErrorReemplazo(null)
    let subido = false
    try {
      const { error: e } = await supabase.storage.from("actas").upload(ruta, archivo, { contentType: archivo.type, upsert: false })
      if (e) throw new Error(`No se pudo subir el archivo: ${e.message}`)
      subido = true
      const { rutaAnterior } = await reemplazarSoporteActa(actaId, soporte.id, {
        ruta,
        nombreArchivo: archivo.name,
        tamano: archivo.size,
        mime: archivo.type,
      })
      subido = false
      if (rutaAnterior) await supabase.storage.from("actas").remove([rutaAnterior])
      setRecarga((n) => n + 1)
    } catch (e) {
      if (subido) await supabase.storage.from("actas").remove([ruta])
      setErrorReemplazo({ id: soporte.id, texto: e instanceof Error ? e.message : "No se pudo modificar el soporte." })
    } finally {
      setReemplazando(null)
    }
  }

  function cerrar() {
    setActa(null)
    setError(null)
    setViendo(null)
    setErrorFactura(null)
    setErrorReemplazo(null)
    onCerrar()
  }

  const v = acta && acta.id === id ? acta : null
  // Cupo visto desde esta acta: lo que usan las demás + esta (si no está rechazada).
  const usado = v ? v.otrasActas + (v.estado === "rechazada" ? 0 : v.valorBruto) : 0
  const conActividades = v ? v.actividades.filter((a) => a.cantidad != null) : []
  const pagos = v ? resumenPagosActa(v.pagos) : null
  const tieneFactura = v ? v.soportes.some((s) => s.tipo === "factura" || s.tipo === "cuenta_cobro") : false

  return (
    <Dialog open={id !== null} onOpenChange={(abierto) => !abierto && cerrar()}>
      <DialogContent className="max-h-[94svh] w-[calc(100vw-1rem)] max-w-6xl overflow-y-auto [scrollbar-width:thin] sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {v ? `${ETIQUETA_TIPO_ACTA[v.tipo]} N° ${numeroActa(v.numero)} · ${v.numeroContrato}` : "Acta"}
            {v && <Badge className={`min-h-6 px-3 text-xs ${CLASE_ESTADO_ACTA[v.estado]}`}>{ETIQUETA_ESTADO_ACTA[v.estado]}</Badge>}
            {v && (
              <a
                href={`/contratos/acta-pdf/${v.id}`}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-normal hover:bg-accent"
              >
                <FileDown className="h-4 w-4" /> PDF del acta
              </a>
            )}
          </DialogTitle>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !v ? (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando acta...
          </p>
        ) : viendo ? (
          <VisorDocumento
            titulo={ETIQUETA_SOPORTE[viendo.tipo]}
            nombreArchivo={viendo.nombreArchivo}
            mime={viendo.mime ?? ""}
            cargarUrl={() => enlaceSoporteActa(viendo.ruta)}
            onVolver={() => setViendo(null)}
          />
        ) : (
          <>
            <div className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Dato titulo="Contratista">
                {v.contratistaNombre} <span className="text-muted-foreground">({v.contratistaDocumento})</span>
              </Dato>
              <Dato titulo="Proyecto">
                {v.proyectoCodigo} · {v.proyectoNombre}
              </Dato>
              <Dato titulo="Tipo de contrato">{tituloTipoContrato(v.tipoContrato)}</Dato>
              <Dato titulo="Período">
                {v.periodoDesde || v.periodoHasta
                  ? `${v.periodoDesde ? formatearFechaSinHora(v.periodoDesde) : "…"} a ${v.periodoHasta ? formatearFechaSinHora(v.periodoHasta) : "…"}`
                  : "—"}
              </Dato>
              <Dato titulo="Elaborada">
                {formatearFechaSinHora(v.createdAt)}
                {v.creadoPorNombre ? ` por ${v.creadoPorNombre}` : ""}
              </Dato>
              {v.editadaAt && (
                <Dato titulo="Última edición">
                  {formatearFechaSinHora(v.editadaAt)}
                  {v.editadaPorNombre ? ` por ${v.editadaPorNombre}` : ""}
                </Dato>
              )}
              {v.resueltoAt && (
                <Dato titulo={v.estado === "aprobada" ? "Aprobada" : "Rechazada"}>
                  {formatearFechaSinHora(v.resueltoAt)}
                  {v.resueltoPorNombre ? ` por ${v.resueltoPorNombre}` : ""}
                </Dato>
              )}
              {v.motivoResolucion && <Dato titulo="Motivo">{v.motivoResolucion}</Dato>}
              <div className="sm:col-span-2">
                <Dato titulo="Objeto">{v.objeto}</Dato>
              </div>
              {v.observaciones && (
                <div className="sm:col-span-2">
                  <Dato titulo="Observaciones">{v.observaciones}</Dato>
                </div>
              )}
            </div>

            <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-4">
              <Cifra titulo="Valor del contrato" valor={v.contratoValor} />
              <Cifra titulo="Actas anteriores" valor={v.otrasActas} />
              <Cifra titulo="Esta acta (bruto)" valor={v.valorBruto} fuerte />
              <Cifra titulo="Saldo del contrato" valor={saldoContrato(v.contratoValor, usado)} />
            </div>

            {/* Lo ejecutado */}
            {v.tipo !== "liquidacion" && v.anexoTipo === "valores_unitarios" && conActividades.length > 0 && (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr className="[&_th]:px-3 [&_th]:py-2 [&_th]:font-medium">
                      <th>Actividad</th>
                      <th>Unidad</th>
                      <th className="text-right">Contratada</th>
                      <th className="text-right">Acumulado anterior</th>
                      <th className="text-right">Esta acta</th>
                      <th className="text-right">Acumulado</th>
                      <th className="text-right">Valor unitario</th>
                      <th className="text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conActividades.map((a) => (
                      <tr key={a.id} className="border-t [&_td]:px-3 [&_td]:py-2">
                        <td>{a.actividad}</td>
                        <td className="text-muted-foreground">{a.unidad}</td>
                        <td className="text-right tabular-nums">{numero(a.cantidadContratada)}</td>
                        <td className="text-right tabular-nums">{numero(a.acumuladoAnterior)}</td>
                        <td className="text-right font-medium tabular-nums">{numero(a.cantidad ?? 0)}</td>
                        <td className="text-right tabular-nums">{numero(a.acumuladoAnterior + (a.cantidad ?? 0))}</td>
                        <td className="text-right tabular-nums">{pesos(a.valorUnitario)}</td>
                        <td className="text-right font-medium tabular-nums">{pesos(a.valor ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {v.tipo !== "liquidacion" && v.porcentajeAvance != null && (
              <div className="grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-3">
                <Texto titulo="Avance anterior" texto={`${numero(v.avanceAnterior)} %`} />
                <Texto titulo="Avance de esta acta" texto={`${numero(v.porcentajeAvance)} %`} />
                <Texto titulo="Avance acumulado" texto={`${numero(v.avanceAnterior + v.porcentajeAvance)} %`} />
              </div>
            )}
            {v.lineasAnteriores.length > 0 && (
              <div className="overflow-x-auto rounded-lg border">
                <p className="border-b bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  Acta del formato anterior (líneas de ítem e insumo del APU).
                </p>
                <table className="w-full text-sm">
                  <tbody>
                    {v.lineasAnteriores.map((l) => (
                      <tr key={l.orden} className="border-t [&_td]:px-3 [&_td]:py-2">
                        <td>
                          <span className="font-medium">{l.itemCodigo}</span> {l.itemDescripcion}
                        </td>
                        <td>{l.insumoDescripcion}</td>
                        <td className="text-right tabular-nums">
                          {numero(l.cantidad)} {l.unidad}
                        </td>
                        <td className="text-right tabular-nums">{pesos(l.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Resumen */}
            <div className="ml-auto w-full max-w-md rounded-lg border text-sm">
              <table className="w-full [&_td]:px-3 [&_td]:py-1.5">
                <tbody>
                  {v.tipo === "liquidacion" ? (
                    <>
                      <Fila titulo="Devolución de la retención en garantía" valor={v.devolucionRetencion} />
                      <Fila titulo="Anticipo por amortizar" valor={-v.amortizacion} />
                    </>
                  ) : (
                    <>
                      <Fila titulo="Valor bruto del acta" valor={v.valorBruto} />
                      <Fila
                        titulo={`Amortización del anticipo${v.anticipoPorcentaje ? ` (${numero(v.anticipoPorcentaje)} %)` : ""}`}
                        valor={-v.amortizacion}
                      />
                      <Fila
                        titulo={`Retención en garantía${v.retencionPorcentaje ? ` (${numero(v.retencionPorcentaje)} %)` : ""}`}
                        valor={-v.retencion}
                      />
                    </>
                  )}
                  {v.descuentos.map((d, i) => (
                    <Fila key={i} titulo={d.concepto} valor={-d.valor} />
                  ))}
                  <tr className="border-t bg-muted/30 font-semibold">
                    <td>Neto a pagar</td>
                    <td className="text-right text-base tabular-nums">{pesos(v.neto)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {v.saldosAnteriores.length > 0 && (
              <p className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900">
                Saldos pendientes de actas anteriores del contrato:{" "}
                {v.saldosAnteriores.map((x) => `Acta ${numeroActa(x.numero)} ${pesos(x.saldo)}`).join(" · ")}.
              </p>
            )}

            {v.estado === "pendiente" && v.pago && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Pago por {pesos(v.pago.valor)} por aprobar en A&F (Aprobación de pagos). Al aprobarlo (completo o un avance), el acta queda aprobada.
                {!tieneFactura && " Todavía no tiene factura: se puede subir cuando esté aprobada."}
              </p>
            )}

            {v.estado === "aprobada" && pagos && v.pagos.length > 0 && (
              <div className="space-y-2 rounded-lg border p-3 text-sm">
                <div className="grid gap-2 sm:grid-cols-3">
                  <Cifra titulo="Aprobado para pago" valor={pagos.aprobado} fuerte />
                  <Cifra titulo="Aprobado, espera la factura" valor={pagos.esperaFactura} />
                  <Cifra titulo="Saldo en espera" valor={pagos.saldo} />
                </div>
                {pagos.saldo > 0 && (
                  <p className="text-xs text-orange-800">
                    Se aprobó un avance: el saldo de {pesos(pagos.saldo)} queda en espera en A&F hasta que se decida pagarlo.
                  </p>
                )}
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {v.pagos.map((g) => (
                    <li key={g.id}>
                      {g.saldoActa ? "Saldo" : "Pago"} de {pesos(g.valor)} ·{" "}
                      {g.estado === "en_espera"
                        ? g.aprobado
                          ? "aprobado, espera la factura"
                          : "en espera"
                        : g.estado === "dispersado"
                          ? "pagado"
                          : g.estado === "aprobado"
                            ? "aprobado"
                            : g.estado}
                      {g.semana != null ? ` · semana ${g.semana} de ${g.anio}` : ""}
                      {g.referencia ? ` · REF ${g.referencia}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {v.estado === "aprobada" && pagos && pagos.esperaFactura > 0 && (
              <div className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50/60 p-3 text-sm">
                <p className="flex items-center gap-2 font-medium text-amber-900">
                  <Receipt className="size-4" /> Falta la factura del contratista
                </p>
                <p className="text-xs text-amber-900">
                  El acta está aprobada. Sube la factura o cuenta de cobro: al subirla, el pago de {pesos(pagos.esperaFactura)} pasa a A&F para pagarse.
                </p>
                {puedeSubirFactura ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={tipoFactura}
                      onChange={(e) => setTipoFactura(e.target.value as "factura" | "cuenta_cobro")}
                      disabled={subiendoFactura}
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                      aria-label="Tipo de soporte de pago"
                    >
                      <option value="factura">{ETIQUETA_SOPORTE.factura}</option>
                      <option value="cuenta_cobro">{ETIQUETA_SOPORTE.cuenta_cobro}</option>
                    </select>
                    <input
                      type="file"
                      disabled={subiendoFactura}
                      onChange={(e) => {
                        subirFactura(v.id, e.target.files?.[0])
                        e.target.value = ""
                      }}
                      className="block min-w-0 flex-1 text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
                    />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">La sube quien elabora las actas del proyecto.</p>
                )}
                {subiendoFactura && (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> Subiendo…
                  </p>
                )}
                {errorFactura && <p className="text-xs text-destructive">{errorFactura}</p>}
              </div>
            )}

            {v.soportes.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Soportes</p>
                {v.soportes.map((s) => (
                  <div key={s.id} className="space-y-0.5">
                    <div className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent">
                      <button
                        type="button"
                        onClick={() => setViendo(s)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
                      >
                        <Paperclip className="h-4 w-4 shrink-0" />
                        <span className="truncate text-primary underline underline-offset-2">{s.nombreArchivo}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">({ETIQUETA_SOPORTE[s.tipo]})</span>
                      </button>
                      {puedeSubirFactura && (
                        <label
                          className={`inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs hover:bg-accent ${
                            reemplazando !== null ? "pointer-events-none opacity-50" : ""
                          }`}
                          title="Reemplazar este archivo por otro (queda en el historial)"
                        >
                          {reemplazando === s.id ? <Loader2 className="size-3.5 animate-spin" /> : <Pencil className="size-3.5" />}
                          {reemplazando === s.id ? "Subiendo…" : "Modificar soporte"}
                          <input
                            type="file"
                            className="sr-only"
                            disabled={reemplazando !== null}
                            onChange={(e) => {
                              reemplazarSoporte(v.id, s, e.target.files?.[0])
                              e.target.value = ""
                            }}
                          />
                        </label>
                      )}
                    </div>
                    {errorReemplazo?.id === s.id && <p className="px-2 text-xs text-destructive">{errorReemplazo.texto}</p>}
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Historial</p>
              <HistorialTimeline key={recarga} tipo="acta" id={v.id} />
            </div>

            {acciones && <DialogFooter>{acciones(v)}</DialogFooter>}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Ruta en el bucket de un archivo nuevo del acta (marca de tiempo: no se repite).
const rutaSoporteNuevo = (actaId: string, tipo: string, ext: string) => `${actaId}/${tipo}-${Date.now()}.${ext}`

function Dato({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      <p>{children}</p>
    </div>
  )
}

function Cifra({ titulo, valor, fuerte }: { titulo: string; valor: number; fuerte?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className={`tabular-nums ${fuerte ? "font-semibold" : ""} ${valor < 0 ? "text-destructive" : ""}`}>{pesos(valor)}</p>
    </div>
  )
}

function Texto({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className="tabular-nums">{texto}</p>
    </div>
  )
}

function Fila({ titulo, valor }: { titulo: string; valor: number }) {
  return (
    <tr>
      <td>{titulo}</td>
      <td className="text-right tabular-nums">{valor === 0 ? "—" : pesos(valor)}</td>
    </tr>
  )
}

