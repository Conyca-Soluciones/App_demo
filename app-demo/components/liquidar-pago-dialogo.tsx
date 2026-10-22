"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Info, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { leerNumero } from "@/lib/contratos"
import { CLASE_ESTADO_PAGO, ETIQUETA_ESTADO_PAGO, ETIQUETA_TIPO_PAGO, formatoMoneda, type Pago } from "@/lib/pagos"
import {
  ETIQUETA_TIPO_LINEA,
  TARIFA_RETEIVA,
  datosLiquidacion,
  sugerirLiquidacion,
  tarifaRetefuente,
  totalesLiquidacion,
  valorLinea,
  type CatalogoLiquidacion,
  type ContextoPago,
  type LineaLiquidacion,
  type SugerenciaLiquidacion,
  type TipoLinea,
} from "@/lib/liquidacion"
import { deshacerLiquidacion, liquidarPago, lineasLiquidacionVigente } from "@/app/(app)/ayf/liquidacion/actions"

// Línea con los textos que se están escribiendo (base, tarifa en %, valor).
type LineaEditable = LineaLiquidacion & { id: number; baseTexto: string; tarifaTexto: string; valorTexto: string }

const numeroTexto = (n: number | null) =>
  n == null ? "" : n.toLocaleString("es-CO", { maximumFractionDigits: 2, useGrouping: true })
const tarifaTexto = (t: number | null) => (t == null ? "" : (t * 100).toLocaleString("es-CO", { maximumFractionDigits: 4 }))

let siguienteId = 1
function editable(l: LineaLiquidacion): LineaEditable {
  return {
    ...l,
    id: siguienteId++,
    baseTexto: numeroTexto(l.base),
    tarifaTexto: tarifaTexto(l.tarifa),
    valorTexto: l.tipo === "descuento" ? numeroTexto(l.valor) : "",
  }
}

export function LiquidarPagoDialogo({
  pago,
  contexto,
  catalogo,
  sugerencia,
  puedeLiquidar,
  onCerrar,
  onGuardado,
}: {
  pago: Pago | null
  contexto: ContextoPago | null
  catalogo: CatalogoLiquidacion | null
  sugerencia: SugerenciaLiquidacion | null
  puedeLiquidar: boolean
  onCerrar: () => void
  onGuardado: (p: Pago) => void
}) {
  return (
    <Dialog open={pago !== null} onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-5xl">
        {pago && (
          <Contenido
            key={pago.id}
            pago={pago}
            contexto={contexto}
            catalogo={catalogo}
            sugerencia={sugerencia}
            puedeLiquidar={puedeLiquidar}
            onCerrar={onCerrar}
            onGuardado={onGuardado}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function Contenido({
  pago,
  contexto,
  catalogo,
  sugerencia,
  puedeLiquidar,
  onCerrar,
  onGuardado,
}: {
  pago: Pago
  contexto: ContextoPago | null
  catalogo: CatalogoLiquidacion | null
  sugerencia: SugerenciaLiquidacion | null
  puedeLiquidar: boolean
  onCerrar: () => void
  onGuardado: (p: Pago) => void
}) {
  const liquidado = pago.estado === "liquidado"
  // Un pago liquidado arranca con sus líneas guardadas; uno por liquidar, con
  // la sugerencia del motor.
  const [lineas, setLineas] = useState<LineaEditable[] | null>(
    liquidado ? null : (sugerencia?.lineas ?? []).map(editable)
  )
  const [numeroFactura, setNumeroFactura] = useState(pago.numeroFactura ?? "")
  const [observaciones, setObservaciones] = useState("")
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [motivoDeshacer, setMotivoDeshacer] = useState<string | null>(null)
  // Base e IVA de la factura: los del pago, o los que estimó el motor si el
  // pago no los traía. Contabilidad los corrige y recalcula la sugerencia.
  const desgloseInicial = liquidado
    ? { base: pago.baseGravable ?? pago.valorDocumento ?? pago.valor, iva: pago.iva ?? 0, estimado: false }
    : (sugerencia?.desglose ?? { base: pago.baseGravable ?? pago.valorDocumento ?? pago.valor, iva: pago.iva ?? 0, estimado: false })
  const [baseFacturaTexto, setBaseFacturaTexto] = useState(numeroTexto(desgloseInicial.base))
  const [ivaFacturaTexto, setIvaFacturaTexto] = useState(numeroTexto(desgloseInicial.iva))
  const [avisosActuales, setAvisosActuales] = useState(sugerencia?.avisos ?? [])
  const [recalculada, setRecalculada] = useState(false)

  useEffect(() => {
    if (!liquidado) return
    let vigente = true
    lineasLiquidacionVigente(pago.id)
      .then((ls: LineaLiquidacion[]) => vigente && setLineas(ls.map(editable)))
      .catch((e) => {
        if (!vigente) return
        setError(e instanceof Error ? e.message : "No se pudieron cargar las líneas.")
        setLineas([])
      })
    return () => {
      vigente = false
    }
  }, [liquidado, pago.id])

  const conceptos = useMemo(() => new Map((catalogo?.conceptos ?? []).map((c) => [c.clave, c])), [catalogo])
  const actividades = useMemo(() => new Map((catalogo?.actividades ?? []).map((a) => [a.clave, a])), [catalogo])
  const perfil = contexto?.perfil ?? null
  const persona = perfil?.tipoPersona ?? (contexto?.tercero?.tipoDocumento === "NIT" ? "juridica" : "natural")
  const declarante = perfil?.declarante ?? persona === "juridica"
  const mun = contexto?.municipio ?? null
  const documento = pago.valorDocumento ?? pago.valor
  const baseFactura = leerNumero(baseFacturaTexto)
  const ivaFactura = leerNumero(ivaFacturaTexto) ?? 0
  const desgloseValido = baseFactura != null && baseFactura > 0 && ivaFactura >= 0 && baseFactura + ivaFactura <= documento + 1
  const base = baseFactura ?? documento
  // ¿Cambió frente a lo que tiene guardado el pago? (entonces se manda).
  const desgloseCambiado =
    desgloseValido && (baseFactura !== (pago.baseGravable ?? null) || ivaFactura !== (pago.iva ?? 0) || desgloseInicial.estimado)

  // Vuelve a sugerir con la base y el IVA escritos (los descuentos escritos a
  // mano se conservan).
  function recalcular() {
    if (!contexto || !catalogo || !desgloseValido) return
    const s = sugerirLiquidacion({ ...contexto, baseGravable: baseFactura, iva: ivaFactura, ivaConocido: true }, catalogo)
    setLineas((ls) => [...s.lineas.map(editable), ...(ls ?? []).filter((l) => l.tipo === "descuento")])
    setAvisosActuales(s.avisos)
    setRecalculada(true)
  }

  const totales = totalesLiquidacion(pago.valor, lineas ?? [])

  function cambiar(id: number, cambio: Partial<LineaEditable>) {
    setLineas((ls) =>
      (ls ?? []).map((l) => {
        if (l.id !== id) return l
        const n = { ...l, ...cambio, editada: true }
        n.valor = n.tipo === "descuento" ? (leerNumero(n.valorTexto) ?? 0) : valorLinea(n)
        return n
      })
    )
  }

  function agregar(tipo: TipoLinea) {
    const nueva: LineaLiquidacion = {
      tipo,
      concepto: null,
      municipioId: tipo === "reteica" ? (mun?.id ?? null) : null,
      actividad: null,
      descripcion: null,
      base: tipo === "descuento" ? null : tipo === "reteiva" ? ivaFactura : base,
      tarifa: tipo === "descuento" ? null : tipo === "reteiva" ? TARIFA_RETEIVA : 0,
      valor: 0,
      asumida: false,
      regla: null,
      editada: true,
    }
    nueva.valor = valorLinea(nueva)
    setLineas((ls) => [...(ls ?? []), editable(nueva)])
  }

  const avisos = avisosActuales
  const datosValidos =
    lineas !== null &&
    desgloseValido &&
    lineas.every((l) =>
      l.tipo === "descuento"
        ? l.valor > 0 && (l.descripcion ?? "").trim() !== ""
        : l.base != null && l.tarifa != null && (l.tipo !== "retefuente" || l.concepto) && (l.tipo !== "reteica" || l.municipioId)
    )

  async function guardar() {
    if (!lineas) return
    setGuardando(true)
    setError(null)
    try {
      onGuardado(await liquidarPago(pago.id, datosLiquidacion(
            lineas,
            sugerencia,
            numeroFactura,
            observaciones,
            desgloseCambiado ? { base: baseFactura!, iva: ivaFactura } : null
          )))
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo liquidar.")
    } finally {
      setGuardando(false)
    }
  }

  async function deshacer() {
    if (!motivoDeshacer?.trim()) return
    setGuardando(true)
    setError(null)
    try {
      onGuardado(await deshacerLiquidacion(pago.id, motivoDeshacer))
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo deshacer.")
    } finally {
      setGuardando(false)
    }
  }

  const dato = (titulo: string, valor: React.ReactNode) => (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{titulo}</div>
      <div className="truncate text-sm">{valor ?? "—"}</div>
    </div>
  )
  const pesos = (n: number | null) => (n == null ? "—" : formatoMoneda(n))

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          {liquidado ? "Liquidación del pago" : "Liquidar pago"}
          {pago.item != null && <span className="text-muted-foreground">· ITEM {pago.item}</span>}
          <Badge variant="outline" className={`h-6 px-3 text-xs ${CLASE_ESTADO_PAGO[pago.estado]}`}>
            {ETIQUETA_ESTADO_PAGO[pago.estado]}
          </Badge>
        </DialogTitle>
      </DialogHeader>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      {/* El pago */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border p-3 sm:grid-cols-4">
        {dato("Tercero", pago.terceroNombre ?? "Sin tercero")}
        {dato("Documento", pago.terceroDocumento)}
        {dato("Grupo empresarial", pago.empresaNombre)}
        {dato("Proyecto", pago.proyectoCodigo ?? pago.proyectoNombre)}
        <div className="col-span-2">{dato("Concepto", pago.concepto)}</div>
        {dato("Origen", `${pago.origen || "—"} · ${ETIQUETA_TIPO_PAGO[pago.tipo]}`)}
        {dato("Solicita", pago.solicitadoPorNombre)}
        {dato("Valor documento", pesos(pago.valorDocumento))}
        {dato("Anticipos y/o descuentos", pesos(pago.descuentoAnticipos + pago.otrosDescuentos))}
        {dato("Retención en garantía", pesos(pago.retencionGarantia))}
        {dato("Valor aprobado", <span className="font-medium">{formatoMoneda(pago.valor)}</span>)}
      </div>

      {/* Base e IVA de la factura: sobre la base van retefuente y ReteICA; el
          ReteIVA, sobre el IVA. */}
      <div
        className={`flex flex-wrap items-end gap-3 rounded-md border p-3 ${
          desgloseInicial.estimado && !recalculada ? "border-amber-300 bg-amber-50/60" : ""
        }`}
      >
        <div className="space-y-1">
          <Label htmlFor="base-factura">Base de la factura (sin IVA)</Label>
          <Input
            id="base-factura"
            className="h-9 w-44 text-right tabular-nums"
            value={baseFacturaTexto}
            onChange={(e) => setBaseFacturaTexto(e.target.value)}
            disabled={!puedeLiquidar}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="iva-factura">IVA de la factura</Label>
          <Input
            id="iva-factura"
            className="h-9 w-40 text-right tabular-nums"
            value={ivaFacturaTexto}
            onChange={(e) => setIvaFacturaTexto(e.target.value)}
            disabled={!puedeLiquidar}
          />
        </div>
        {puedeLiquidar && (
          <Button size="sm" variant="outline" className="h-9" disabled={!desgloseValido || !contexto || !catalogo} onClick={recalcular}>
            <RefreshCw className="mr-1.5 h-4 w-4" /> Recalcular la sugerencia
          </Button>
        )}
        <div className="min-w-48 flex-1 text-xs text-muted-foreground">
          {!desgloseValido
            ? <span className="text-destructive">La base debe ser mayor que cero y la base más el IVA no pueden pasar de {formatoMoneda(documento)}.</span>
            : desgloseInicial.estimado && !recalculada
              ? <span className="text-amber-800">IVA estimado al 19 % incluido: confírmalo con la factura.</span>
              : `Valor del documento ${formatoMoneda(documento)}. Si cambias la base o el IVA, pulsa Recalcular.`}
        </div>
      </div>

      {/* Tercero, empresa y municipio */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {perfil ? (
          <>
            <Badge variant="outline">{perfil.tipoPersona === "juridica" ? "Persona jurídica" : "Persona natural"}</Badge>
            {perfil.tipoPersona === "natural" && (
              <Badge variant="outline">{perfil.declarante ? "Declarante" : "No declarante"}</Badge>
            )}
            {perfil.responsableIva && <Badge variant="outline">Responsable de IVA</Badge>}
            {perfil.regimenSimple && <Badge variant="outline">Régimen simple</Badge>}
            {perfil.autorretenedor && <Badge variant="outline">Autorretenedor</Badge>}
            {perfil.granContribuyente && <Badge variant="outline">Gran contribuyente</Badge>}
            {perfil.zomac && <Badge variant="outline">ZOMAC</Badge>}
            {perfil.municipioRut && <Badge variant="outline">RUT: {perfil.municipioRut}</Badge>}
            <Badge
              variant="outline"
              className={perfil.estado === "VERIFICADO" ? "border-green-300 text-green-700" : "border-amber-300 text-amber-700"}
            >
              Perfil {perfil.estado === "VERIFICADO" ? "verificado" : "sin verificar"}
            </Badge>
          </>
        ) : (
          <Badge variant="outline" className="border-amber-300 text-amber-700">
            Sin RUT
          </Badge>
        )}
        {mun && <Badge variant="outline">ICA: {mun.nombre}</Badge>}
      </div>

      {avisos.length > 0 && !liquidado && (
        <ul className="space-y-1 text-sm">
          {avisos.map((a, i) => (
            <li key={i} className={`flex items-start gap-2 ${a.nivel === "revisar" ? "text-amber-800" : "text-muted-foreground"}`}>
              {a.nivel === "revisar" ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span>{a.texto}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Líneas */}
      {lineas === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando la liquidación...
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="px-2 py-1.5 text-left">Tipo</th>
                <th className="px-2 py-1.5 text-left">Concepto / actividad</th>
                <th className="px-2 py-1.5 text-right">Base</th>
                <th className="px-2 py-1.5 text-right">Tarifa %</th>
                <th className="px-2 py-1.5 text-right">Valor</th>
                <th className="px-2 py-1.5 text-center" title="La empresa la asume: se registra pero no baja el neto">
                  Asumida
                </th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {lineas.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-3 text-center text-muted-foreground">
                    Sin retenciones ni descuentos: el neto es el valor aprobado.
                  </td>
                </tr>
              )}
              {lineas.map((l) => (
                <tr key={l.id} className="align-top">
                  <td className="px-2 py-1.5 font-medium">{ETIQUETA_TIPO_LINEA[l.tipo]}</td>
                  <td className="min-w-64 px-2 py-1.5">
                    {l.tipo === "retefuente" && (
                      <Select
                        value={l.concepto ?? ""}
                        onValueChange={(v) => {
                          const c = v ? conceptos.get(v) : undefined
                          if (!c) return
                          const t = tarifaRetefuente(c, persona, declarante, perfil?.zomac ?? false)
                          cambiar(l.id, { concepto: c.clave, tarifa: t, tarifaTexto: tarifaTexto(t) })
                        }}
                        disabled={!puedeLiquidar}
                      >
                        <SelectTrigger className="h-8 w-full">
                          <SelectValue placeholder="Escoge el concepto" />
                        </SelectTrigger>
                        <SelectContent>
                          {(catalogo?.conceptos ?? []).map((c) => (
                            <SelectItem key={c.clave} value={c.clave}>
                              {c.nombre}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {l.tipo === "reteica" &&
                      (mun ? (
                        <Select
                          value={l.actividad ?? ""}
                          onValueChange={(v) => {
                            if (!v) return
                            const t = mun.tarifas[v]
                            cambiar(l.id, { actividad: v, tarifa: t ?? l.tarifa, tarifaTexto: tarifaTexto(t ?? l.tarifa) })
                          }}
                          disabled={!puedeLiquidar}
                        >
                          <SelectTrigger className="h-8 w-full">
                            <SelectValue placeholder={`Actividad en ${mun.nombre}`} />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.keys(mun.tarifas).map((a) => (
                              <SelectItem key={a} value={a}>
                                {actividades.get(a)?.nombre ?? a} ({(mun.tarifas[a] * 1000).toLocaleString("es-CO")} ‰)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-xs text-amber-700">El proyecto no tiene municipio de ICA.</span>
                      ))}
                    {l.tipo === "reteiva" && <span className="text-muted-foreground">Sobre el IVA</span>}
                    {l.tipo === "descuento" && (
                      <Input
                        className="h-8"
                        placeholder="Qué se descuenta (préstamo, cruce...)"
                        value={l.descripcion ?? ""}
                        onChange={(e) => cambiar(l.id, { descripcion: e.target.value })}
                        disabled={!puedeLiquidar}
                      />
                    )}
                    {l.regla && <div className="mt-1 text-xs text-muted-foreground">{l.regla}</div>}
                  </td>
                  <td className="px-2 py-1.5">
                    {l.tipo !== "descuento" && (
                      <Input
                        className="h-8 w-36 text-right tabular-nums"
                        value={l.baseTexto}
                        onChange={(e) => cambiar(l.id, { baseTexto: e.target.value, base: leerNumero(e.target.value) })}
                        disabled={!puedeLiquidar}
                      />
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {l.tipo !== "descuento" && (
                      <Input
                        className="h-8 w-24 text-right tabular-nums"
                        value={l.tarifaTexto}
                        onChange={(e) => {
                          const n = leerNumero(e.target.value)
                          cambiar(l.id, { tarifaTexto: e.target.value, tarifa: n == null ? null : Number((n / 100).toFixed(7)) })
                        }}
                        disabled={!puedeLiquidar}
                      />
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {l.tipo === "descuento" ? (
                      <Input
                        className="h-8 w-36 text-right tabular-nums"
                        value={l.valorTexto}
                        onChange={(e) => cambiar(l.id, { valorTexto: e.target.value })}
                        disabled={!puedeLiquidar}
                      />
                    ) : (
                      formatoMoneda(l.valor)
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {l.tipo !== "descuento" && (
                      <Checkbox
                        checked={l.asumida}
                        onCheckedChange={(v) => cambiar(l.id, { asumida: v === true })}
                        disabled={!puedeLiquidar}
                      />
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {puedeLiquidar && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        title="Quitar línea"
                        onClick={() => setLineas((ls) => (ls ?? []).filter((x) => x.id !== l.id))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {puedeLiquidar && lineas !== null && (
        <div className="flex flex-wrap gap-2">
          {(["retefuente", "reteica", "reteiva", "descuento"] as TipoLinea[]).map((t) => (
            <Button key={t} size="sm" variant="outline" onClick={() => agregar(t)}>
              <Plus className="mr-1 h-4 w-4" /> {ETIQUETA_TIPO_LINEA[t]}
            </Button>
          ))}
        </div>
      )}

      {/* Totales */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-muted/50 p-3 text-sm sm:grid-cols-6">
        {dato("Retefuente", pesos(totales.retefuente))}
        {dato("ReteICA", pesos(totales.reteica))}
        {dato("ReteIVA", pesos(totales.reteiva))}
        {dato("Asumidas", pesos(totales.asumidas))}
        {dato("Descuentos", pesos(totales.descuentos))}
        <div>
          <div className="text-xs text-muted-foreground">Neto a pagar</div>
          <div className={`text-lg font-semibold tabular-nums ${totales.neto <= 0 ? "text-destructive" : ""}`}>
            {formatoMoneda(totales.neto)}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="factura-liq">Factura o cuenta de cobro</Label>
          <Input id="factura-liq" value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} disabled={!puedeLiquidar} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="obs-liq">Observaciones</Label>
          <Textarea id="obs-liq" rows={1} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} disabled={!puedeLiquidar} />
        </div>
      </div>

      {motivoDeshacer !== null && (
        <div className="space-y-1.5 rounded-md border border-amber-300 bg-amber-50 p-3">
          <Label htmlFor="motivo-deshacer">Motivo para deshacer la liquidación (el pago vuelve a &quot;Aprobado&quot;)</Label>
          <Textarea id="motivo-deshacer" rows={2} value={motivoDeshacer} onChange={(e) => setMotivoDeshacer(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setMotivoDeshacer(null)} disabled={guardando}>
              Cancelar
            </Button>
            <Button size="sm" variant="destructive" onClick={deshacer} disabled={guardando || !motivoDeshacer.trim()}>
              Deshacer liquidación
            </Button>
          </div>
        </div>
      )}

      <DialogFooter className="gap-2">
        <Button variant="outline" disabled={guardando} onClick={onCerrar}>
          Cerrar
        </Button>
        {puedeLiquidar && liquidado && motivoDeshacer === null && (
          <Button variant="outline" disabled={guardando} onClick={() => setMotivoDeshacer("")}>
            Deshacer liquidación
          </Button>
        )}
        {puedeLiquidar && (
          <Button disabled={guardando || !datosValidos || totales.neto <= 0 || !pago.terceroId} onClick={guardar}>
            {guardando ? "Guardando..." : liquidado ? "Volver a liquidar" : "Liquidar"}
          </Button>
        )}
      </DialogFooter>
    </>
  )
}
