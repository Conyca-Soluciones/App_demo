"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { BuscadorAsync, type OpcionBuscador } from "@/components/buscador-async"
import { CampoSoporte } from "@/components/campo-soporte"
import { formatoMoneda } from "@/lib/pagos"
import {
  ETIQUETA_SOPORTE_REQ_ADMIN,
  TIPOS_DOCUMENTO_PSE,
  etiquetaProyecto,
  textoCuenta,
  validarItemReqAdmin,
  valorItem,
  type CuentaReqAdmin,
  type ItemFormReqAdmin,
  type MetodoReqAdmin,
  type OpcionesReqAdmin,
} from "@/lib/requisiciones-admin"
import {
  buscarTercerosRequisicionAdmin,
  cuentasTerceroRequisicionAdmin,
} from "@/app/(app)/ayf/requisiciones-administrativas/actions"

// Tipo y número de documento desde la subetiqueta del buscador ("NIT 800.123.456-7").
function partesDocumento(sub: string | null | undefined): { tipo: string; numero: string; nit: string } {
  const [tipo = "", ...resto] = (sub ?? "").trim().split(/\s+/)
  const conDv = resto.join("").replace(/\./g, "")
  return { tipo, numero: conDv.split("-")[0].replace(/\D/g, ""), nit: conDv }
}

function Campo({ etiqueta, children, ayuda }: { etiqueta: string; children: React.ReactNode; ayuda?: string }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label>{etiqueta}</Label>
      {children}
      {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
    </div>
  )
}

// Un ítem (una fila del formato GF-F-018). En transferencia el tercero que
// factura y el titular salen de Terceros, con la cuenta del titular; en PSE se
// escribe todo y no hay cuenta.
export function ItemRequisicionAdminDialog({
  abierto,
  metodo,
  opciones,
  inicial,
  numero,
  onGuardar,
  onCerrar,
}: {
  abierto: boolean
  metodo: MetodoReqAdmin
  opciones: OpcionesReqAdmin
  inicial: ItemFormReqAdmin
  numero: number
  onGuardar: (item: ItemFormReqAdmin) => void
  onCerrar: () => void
}) {
  const [item, setItem] = useState<ItemFormReqAdmin>(inicial)
  const [error, setError] = useState<string | null>(null)
  // Cuentas del titular, guardadas con el tercero al que pertenecen.
  const [cuentas, setCuentas] = useState<{ terceroId: string; lista: CuentaReqAdmin[] } | null>(null)
  const [errorCuentas, setErrorCuentas] = useState<string | null>(null)
  const [titularDistinto, setTitularDistinto] = useState(Boolean(inicial.titularTerceroId))
  // Tipo de documento del tercero que factura (para volver a ponerlo de titular).
  const [tipoFactura, setTipoFactura] = useState(inicial.titularTerceroId ? "" : inicial.titularTipoDocumento)

  const titularId = metodo !== "transferencia" ? null : titularDistinto ? item.titularTerceroId : item.terceroFacturaId
  const cuentasDelTitular = cuentas && cuentas.terceroId === titularId ? cuentas.lista : null
  const cargandoCuentas = Boolean(titularId) && cuentasDelTitular === null && !errorCuentas

  useEffect(() => {
    if (!titularId) return
    let vigente = true
    cuentasTerceroRequisicionAdmin(titularId)
      .then((lista: CuentaReqAdmin[]) => {
        if (!vigente) return
        setErrorCuentas(null)
        setCuentas({ terceroId: titularId, lista })
        // Una sola cuenta: se elige sola.
        setItem((it) =>
          it.cuentaId || lista.length !== 1
            ? it
            : { ...it, cuentaId: lista[0].id, cuentaTexto: textoCuenta(lista[0]), cuentaVerificada: lista[0].verificada }
        )
      })
      .catch((e) => vigente && setErrorCuentas(e instanceof Error ? e.message : "No se pudieron cargar las cuentas."))
    return () => {
      vigente = false
    }
  }, [titularId])

  const cambiar = (p: Partial<ItemFormReqAdmin>) => setItem((it) => ({ ...it, ...p }))

  const facturaSeleccionada: OpcionBuscador | null = item.terceroFacturaId
    ? { id: item.terceroFacturaId, etiqueta: item.facturaNombre, subetiqueta: item.facturaNit ? `NIT ${item.facturaNit}` : null }
    : null
  const titularSeleccionado: OpcionBuscador | null = item.titularTerceroId
    ? { id: item.titularTerceroId, etiqueta: item.titularNombre, subetiqueta: `${item.titularTipoDocumento} ${item.titularDocumento}` }
    : null

  function elegirFactura(o: OpcionBuscador | null) {
    const doc = partesDocumento(o?.subetiqueta)
    setTipoFactura(o ? doc.tipo : "")
    setItem((it) => ({
      ...it,
      terceroFacturaId: o?.id ?? null,
      facturaNombre: o?.etiqueta ?? "",
      facturaNit: o ? doc.nit : "",
      // Titular = el mismo, salvo que se haya elegido otro.
      ...(titularDistinto
        ? {}
        : {
            titularNombre: o?.etiqueta ?? "",
            titularTipoDocumento: o ? doc.tipo : "",
            titularDocumento: o ? doc.numero : "",
            cuentaId: null,
            cuentaTexto: "",
            cuentaVerificada: false,
          }),
    }))
  }

  function elegirTitular(o: OpcionBuscador | null) {
    const doc = partesDocumento(o?.subetiqueta)
    setItem((it) => ({
      ...it,
      titularTerceroId: o?.id ?? null,
      titularNombre: o?.etiqueta ?? "",
      titularTipoDocumento: o ? doc.tipo : "",
      titularDocumento: o ? doc.numero : "",
      cuentaId: null,
      cuentaTexto: "",
      cuentaVerificada: false,
    }))
  }

  function titularEsOtro(otro: boolean) {
    if (otro) {
      setItem((it) => ({ ...it, titularTerceroId: null, titularNombre: "", titularTipoDocumento: "", titularDocumento: "", cuentaId: null, cuentaTexto: "" }))
      setTitularDistinto(true)
    } else {
      setTitularDistinto(false)
      setItem((it) => ({
        ...it,
        titularTerceroId: null,
        titularNombre: it.facturaNombre,
        titularTipoDocumento: tipoFactura,
        titularDocumento: it.facturaNit.split("-")[0].replace(/\D/g, ""),
        cuentaId: null,
        cuentaTexto: "",
        cuentaVerificada: false,
      }))
    }
  }
  function elegirProyecto(id: string) {
    const p = opciones.proyectos.find((x) => x.id === id)
    // El grupo empresarial se propone con la empresa del proyecto.
    setItem((it) => ({ ...it, proyectoId: id, empresaId: it.empresaId || p?.empresaId || "" }))
  }

  function guardar() {
    const e = validarItemReqAdmin(item, metodo)
    if (e) {
      setError(e)
      return
    }
    onGuardar(item)
  }

  const valor = valorItem(item)

  return (
    <Dialog open={abierto} onOpenChange={(a) => !a && onCerrar()}>
      <DialogContent className="max-h-[94svh] w-[calc(100vw-1rem)] max-w-3xl overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Ítem {numero}</DialogTitle>
          <DialogDescription>
            {metodo === "transferencia"
              ? "Pago por transferencia: el tercero que factura y el titular de la cuenta tienen que estar inscritos en Terceros."
              : "Pago por PSE: escribe los datos de quien factura y del titular (no lleva cuenta bancaria)."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Código de proyecto">
            <Select value={item.proyectoId} onValueChange={(v) => elegirProyecto(String(v ?? ""))}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Elige el proyecto" />
              </SelectTrigger>
              <SelectContent>
                {opciones.proyectos.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {etiquetaProyecto(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <Campo etiqueta="Grupo empresarial">
            <Select value={item.empresaId} onValueChange={(v) => cambiar({ empresaId: String(v ?? "") })}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Elige el grupo empresarial" />
              </SelectTrigger>
              <SelectContent>
                {opciones.empresas.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.razonSocial}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
        </div>

        {metodo === "transferencia" ? (
          <div className="space-y-4 rounded-lg border p-3">
            <Campo etiqueta="Empresa que factura" ayuda="Busca por nombre o NIT. Si no aparece, pídele a A&F que la inscriba en Terceros.">
              <BuscadorAsync
                placeholder="Nombre o NIT del tercero"
                valorSeleccionado={facturaSeleccionada}
                onSeleccionar={elegirFactura}
                buscar={buscarTercerosRequisicionAdmin}
              />
            </Campo>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={titularDistinto} onCheckedChange={(v) => titularEsOtro(Boolean(v))} />
              El titular de la cuenta es otro tercero
            </label>
            {titularDistinto && (
              <Campo etiqueta="Titular de la cuenta">
                <BuscadorAsync
                  placeholder="Nombre o documento del titular"
                  valorSeleccionado={titularSeleccionado}
                  onSeleccionar={elegirTitular}
                  buscar={buscarTercerosRequisicionAdmin}
                />
              </Campo>
            )}
            {titularId && (
              <Campo etiqueta={`Cuenta de ${item.titularNombre || "el titular"}`}>
                {cargandoCuentas ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Cargando cuentas…
                  </p>
                ) : errorCuentas ? (
                  <p className="text-sm text-destructive">{errorCuentas}</p>
                ) : cuentasDelTitular && cuentasDelTitular.length === 0 ? (
                  <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Este tercero no tiene cuentas registradas. Pídele a A&F que la registre en Terceros.
                  </p>
                ) : (
                  <Select
                    value={item.cuentaId ?? ""}
                    onValueChange={(v) => {
                      const c = cuentasDelTitular?.find((x) => x.id === v)
                      if (c) cambiar({ cuentaId: c.id, cuentaTexto: textoCuenta(c), cuentaVerificada: c.verificada })
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Elige la cuenta" />
                    </SelectTrigger>
                    <SelectContent>
                      {(cuentasDelTitular ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {textoCuenta(c)}
                          {c.verificada ? "" : " (sin verificar)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {item.cuentaId && !item.cuentaVerificada && (
                  <p className="text-xs text-amber-700">A&F todavía no ha verificado esta cuenta: lo revisará antes de pagar.</p>
                )}
              </Campo>
            )}
          </div>
        ) : (
          <div className="grid gap-4 rounded-lg border p-3 sm:grid-cols-2">
            <Campo etiqueta="Empresa que factura">
              <Input value={item.facturaNombre} onChange={(e) => cambiar({ facturaNombre: e.target.value })} />
            </Campo>
            <Campo etiqueta="NIT de la empresa que factura" ayuda="Solo números; el dígito de verificación después de un guion.">
              <Input inputMode="numeric" value={item.facturaNit} onChange={(e) => cambiar({ facturaNit: e.target.value })} placeholder="900123456-7" />
            </Campo>
            <div className="sm:col-span-2">
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-xs"
                onClick={() => {
                  const [numero] = item.facturaNit.split("-")
                  cambiar({ titularNombre: item.facturaNombre, titularTipoDocumento: "NIT", titularDocumento: numero.replace(/\D/g, "") })
                }}
                disabled={!item.facturaNombre.trim()}
              >
                El titular es la misma empresa que factura
              </Button>
            </div>
            <Campo etiqueta="Titular de la cuenta">
              <Input value={item.titularNombre} onChange={(e) => cambiar({ titularNombre: e.target.value })} />
            </Campo>
            <div className="grid grid-cols-[7rem_1fr] gap-2">
              <Campo etiqueta="Tipo de documento">
                <Select value={item.titularTipoDocumento} onValueChange={(v) => cambiar({ titularTipoDocumento: String(v ?? "") })}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS_DOCUMENTO_PSE.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>
              <Campo etiqueta="NIT o CC del titular">
                <Input inputMode="numeric" value={item.titularDocumento} onChange={(e) => cambiar({ titularDocumento: e.target.value })} />
              </Campo>
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
          <Campo etiqueta="Concepto de la factura">
            <Input value={item.concepto} onChange={(e) => cambiar({ concepto: e.target.value })} />
          </Campo>
          <Campo etiqueta="Valor documento" ayuda={valor != null && valor > 0 ? formatoMoneda(valor) : undefined}>
            <Input inputMode="decimal" value={item.valor} onChange={(e) => cambiar({ valor: e.target.value })} placeholder="1.250.000" />
          </Campo>
        </div>
        <Campo etiqueta="Observaciones (opcional)">
          <Textarea rows={2} value={item.observaciones} onChange={(e) => cambiar({ observaciones: e.target.value })} />
        </Campo>
        {/* El archivo se sube al enviar la requisición. */}
        <CampoSoporte
          etiqueta="Soporte (factura o cuenta de cobro)"
          obligatorio
          tipos={ETIQUETA_SOPORTE_REQ_ADMIN}
          tipo={item.tipoSoporte}
          onTipo={(t) => cambiar({ tipoSoporte: t })}
          archivo={item.archivoSoporte ?? null}
          onArchivo={(f) => cambiar({ archivoSoporte: f })}
          onError={setError}
          actual={item.soporte && !item.archivoSoporte ? { nombreArchivo: item.soporte.nombre } : null}
        />

        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button onClick={guardar}>Guardar ítem</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
