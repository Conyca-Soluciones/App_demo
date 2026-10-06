"use client"

import { useState } from "react"
import { BadgeCheck, Loader2, Pencil, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  actualizarCuenta,
  actualizarTercero,
  agregarCuenta,
  crearTercero,
  inactivarCuenta,
  reactivarCuenta,
  verificarCuenta,
} from "@/app/(app)/ayf/terceros/actions"
import { calcularDvNit } from "@/lib/contratistas"
import {
  CLASE_ESTADO_CUENTA,
  ETIQUETA_ESTADO_CUENTA,
  TIPOS_CUENTA_TERCERO,
  TIPOS_DOCUMENTO_TERCERO,
  documentoFormateado,
  soloDigitos,
  type Banco,
  type CuentaTercero,
  type DatosCuenta,
  type Tercero,
} from "@/lib/terceros"

const CUENTA_VACIA: DatosCuenta = { bancoId: "", tipoCuenta: "", numeroCuenta: "", etiqueta: "", observaciones: "" }

const formatoFecha = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })

function Etiqueta({ estado }: { estado: CuentaTercero["estado"] }) {
  return (
    <Badge variant="outline" className={`h-6 px-3 text-xs ${CLASE_ESTADO_CUENTA[estado]}`}>
      {ETIQUETA_ESTADO_CUENTA[estado]}
    </Badge>
  )
}

function Banner({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
  )
}

// ---------------------------------------------------------------------------
// Campos de una cuenta bancaria (los usan "agregar", "editar" y "nuevo tercero").
// ---------------------------------------------------------------------------
function CamposCuenta({
  valores,
  onCambiar,
  bancos,
}: {
  valores: DatosCuenta
  onCambiar: (v: DatosCuenta) => void
  bancos: Banco[]
}) {
  const poner = (campo: keyof DatosCuenta, valor: string) => onCambiar({ ...valores, [campo]: valor })
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label>Banco</Label>
        <Select value={valores.bancoId} onValueChange={(v) => poner("bancoId", v ?? "")}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Escoge el banco" />
          </SelectTrigger>
          <SelectContent>
            {bancos.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Tipo de cuenta</Label>
        <Select value={valores.tipoCuenta} onValueChange={(v) => poner("tipoCuenta", v ?? "")}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Escoge el tipo" />
          </SelectTrigger>
          <SelectContent>
            {TIPOS_CUENTA_TERCERO.map((t) => (
              <SelectItem key={t} value={t}>
                {t === "AHORROS" ? "Ahorros" : "Corriente"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Número de cuenta</Label>
        <Input
          inputMode="numeric"
          placeholder="Solo números"
          value={valores.numeroCuenta}
          onChange={(e) => poner("numeroCuenta", soloDigitos(e.target.value))}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Etiqueta (opcional)</Label>
        <Input
          placeholder="Ej. Cuenta de nómina"
          value={valores.etiqueta}
          onChange={(e) => poner("etiqueta", e.target.value)}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detalle de un tercero: datos, cuentas y verificación.
// ---------------------------------------------------------------------------
export function TerceroDialogo({
  tercero,
  bancos,
  puedeEditar,
  puedeVerificar,
  onCambio,
  onCerrar,
}: {
  tercero: Tercero | null
  bancos: Banco[]
  puedeEditar: boolean
  puedeVerificar: boolean
  onCambio: (t: Tercero) => void
  onCerrar: () => void
}) {
  return (
    <Dialog open={tercero !== null} onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="max-h-[90vh] w-[min(95vw,52rem)] max-w-none overflow-y-auto sm:max-w-none">
        {tercero && (
          <ContenidoTercero
            key={tercero.id}
            tercero={tercero}
            bancos={bancos}
            puedeEditar={puedeEditar}
            puedeVerificar={puedeVerificar}
            onCambio={onCambio}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ContenidoTercero({
  tercero,
  bancos,
  puedeEditar,
  puedeVerificar,
  onCambio,
}: {
  tercero: Tercero
  bancos: Banco[]
  puedeEditar: boolean
  puedeVerificar: boolean
  onCambio: (t: Tercero) => void
}) {
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const [datos, setDatos] = useState({
    razonSocial: tercero.razonSocial,
    nombreBanco: tercero.nombreBanco ?? "",
    nombres: tercero.nombres ?? "",
    apellidos: tercero.apellidos ?? "",
    observaciones: tercero.observaciones ?? "",
  })
  const datosCambiaron =
    datos.razonSocial !== tercero.razonSocial ||
    datos.nombreBanco !== (tercero.nombreBanco ?? "") ||
    datos.nombres !== (tercero.nombres ?? "") ||
    datos.apellidos !== (tercero.apellidos ?? "") ||
    datos.observaciones !== (tercero.observaciones ?? "")

  // null = sin formulario; "nueva" = agregando; un id = editando esa cuenta.
  const [formCuenta, setFormCuenta] = useState<string | null>(null)
  const [valoresCuenta, setValoresCuenta] = useState<DatosCuenta>(CUENTA_VACIA)

  async function ejecutar(accion: () => Promise<Tercero>, mensajeOk?: string) {
    setOcupado(true)
    setError(null)
    setAviso(null)
    try {
      onCambio(await accion())
      if (mensajeOk) setAviso(mensajeOk)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la acción.")
      return false
    } finally {
      setOcupado(false)
    }
  }

  function abrirEditar(c: CuentaTercero) {
    setFormCuenta(c.id)
    setValoresCuenta({
      bancoId: c.bancoId,
      tipoCuenta: c.tipoCuenta,
      numeroCuenta: c.numeroCuenta,
      etiqueta: c.etiqueta ?? "",
      observaciones: c.observaciones ?? "",
    })
    setError(null)
    setAviso(null)
  }

  async function guardarCuenta() {
    const editando = formCuenta === "nueva" ? null : tercero.cuentas.find((c) => c.id === formCuenta)
    const ok = await ejecutar(
      () =>
        formCuenta === "nueva"
          ? agregarCuenta(tercero.id, valoresCuenta)
          : actualizarCuenta(tercero.id, formCuenta as string, valoresCuenta),
      formCuenta === "nueva"
        ? "Cuenta agregada. Queda pendiente hasta que Financiera la verifique."
        : editando?.estado === "ACTIVO"
          ? "Cuenta actualizada. Al cambiar sus datos volvió a pendiente: hay que verificarla de nuevo."
          : "Cuenta actualizada."
    )
    if (ok) setFormCuenta(null)
  }

  const esNit = tercero.tipoDocumento === "NIT"

  return (
    <>
      <DialogHeader>
        <DialogTitle>{tercero.razonSocial}</DialogTitle>
        <p className="text-sm text-muted-foreground">
          {tercero.tipoDocumento} {documentoFormateado(tercero)}
        </p>
      </DialogHeader>

      <Banner error={error} />
      {aviso && (
        <div className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{aviso}</div>
      )}

      {/* ------------------------------------------------------------ datos */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium">Datos</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>{esNit ? "Razón social" : "Nombre completo"}</Label>
            <Input
              value={datos.razonSocial}
              disabled={!puedeEditar}
              onChange={(e) => setDatos({ ...datos, razonSocial: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Nombre para el banco</Label>
            <Input
              value={datos.nombreBanco}
              disabled={!puedeEditar}
              placeholder="Si se deja vacío se usa el nombre"
              onChange={(e) => setDatos({ ...datos, nombreBanco: e.target.value })}
            />
          </div>
          {!esNit && (
            <>
              <div className="space-y-1.5">
                <Label>Nombres</Label>
                <Input
                  value={datos.nombres}
                  disabled={!puedeEditar}
                  onChange={(e) => setDatos({ ...datos, nombres: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Apellidos</Label>
                <Input
                  value={datos.apellidos}
                  disabled={!puedeEditar}
                  onChange={(e) => setDatos({ ...datos, apellidos: e.target.value })}
                />
              </div>
            </>
          )}
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Observaciones</Label>
            <Input
              value={datos.observaciones}
              disabled={!puedeEditar}
              onChange={(e) => setDatos({ ...datos, observaciones: e.target.value })}
            />
          </div>
        </div>
        {puedeEditar && datosCambiaron && (
          <div className="flex justify-end">
            <Button size="sm" disabled={ocupado} onClick={() => ejecutar(() => actualizarTercero(tercero.id, datos), "Datos guardados.")}>
              {ocupado ? "Guardando..." : "Guardar datos"}
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          El documento no se puede cambiar: identifica al tercero en todos sus pagos.
        </p>
      </section>

      {/* ----------------------------------------------------------- cuentas */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Cuentas bancarias</h3>
          {puedeEditar && formCuenta === null && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setFormCuenta("nueva")
                setValoresCuenta(CUENTA_VACIA)
                setError(null)
                setAviso(null)
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Agregar cuenta
            </Button>
          )}
        </div>

        {tercero.cuentas.length === 0 && formCuenta !== "nueva" && (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            Este tercero no tiene cuentas bancarias: no se le puede pagar por transferencia.
          </p>
        )}

        <ul className="space-y-2">
          {tercero.cuentas.map((c) => (
            <li key={c.id} className="rounded-lg border p-3">
              {formCuenta === c.id ? (
                <FormularioCuenta
                  titulo="Editar cuenta"
                  advertencia={
                    c.estado === "ACTIVO"
                      ? "Si cambias el banco, el tipo o el número, la cuenta vuelve a pendiente y Financiera debe verificarla de nuevo."
                      : undefined
                  }
                  valores={valoresCuenta}
                  onCambiar={setValoresCuenta}
                  bancos={bancos}
                  ocupado={ocupado}
                  onGuardar={guardarCuenta}
                  onCancelar={() => setFormCuenta(null)}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {c.bancoNombre} · {c.tipoCuenta === "AHORROS" ? "Ahorros" : "Corriente"}
                    </div>
                    <div className="font-mono text-sm">{c.numeroCuenta}</div>
                    {c.etiqueta && <div className="text-xs text-muted-foreground">{c.etiqueta}</div>}
                    {c.estado === "ACTIVO" && c.verificadaPor && (
                      <div className="text-xs text-muted-foreground">
                        Verificada por {c.verificadaPor}
                        {c.verificadaEn ? ` el ${formatoFecha(c.verificadaEn)}` : ""}
                      </div>
                    )}
                  </div>
                  <Etiqueta estado={c.estado} />
                  <div className="flex flex-wrap items-center gap-2">
                    {puedeVerificar && c.estado === "PENDIENTE" && (
                      <Button
                        size="sm"
                        disabled={ocupado}
                        onClick={() => ejecutar(() => verificarCuenta(tercero.id, c.id), "Cuenta verificada.")}
                      >
                        <BadgeCheck className="mr-1.5 h-4 w-4" />
                        Verificar
                      </Button>
                    )}
                    {puedeEditar && formCuenta === null && (
                      <Button size="sm" variant="outline" disabled={ocupado} onClick={() => abrirEditar(c)}>
                        <Pencil className="mr-1.5 h-4 w-4" />
                        Editar
                      </Button>
                    )}
                    {puedeEditar && c.estado !== "INACTIVO" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={ocupado}
                        onClick={() => ejecutar(() => inactivarCuenta(tercero.id, c.id), "Cuenta inactivada.")}
                      >
                        Inactivar
                      </Button>
                    )}
                    {puedeEditar && c.estado === "INACTIVO" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={ocupado}
                        onClick={() =>
                          ejecutar(() => reactivarCuenta(tercero.id, c.id), "Cuenta reactivada: queda pendiente de verificar.")
                        }
                      >
                        Reactivar
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>

        {formCuenta === "nueva" && (
          <div className="rounded-lg border p-3">
            <FormularioCuenta
              titulo="Nueva cuenta"
              valores={valoresCuenta}
              onCambiar={setValoresCuenta}
              bancos={bancos}
              ocupado={ocupado}
              onGuardar={guardarCuenta}
              onCancelar={() => setFormCuenta(null)}
            />
          </div>
        )}
      </section>
    </>
  )
}

function FormularioCuenta({
  titulo,
  advertencia,
  valores,
  onCambiar,
  bancos,
  ocupado,
  onGuardar,
  onCancelar,
}: {
  titulo: string
  advertencia?: string
  valores: DatosCuenta
  onCambiar: (v: DatosCuenta) => void
  bancos: Banco[]
  ocupado: boolean
  onGuardar: () => void
  onCancelar: () => void
}) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium">{titulo}</h4>
      {advertencia && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">{advertencia}</p>
      )}
      <CamposCuenta valores={valores} onCambiar={onCambiar} bancos={bancos} />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" disabled={ocupado} onClick={onCancelar}>
          Cancelar
        </Button>
        <Button size="sm" disabled={ocupado} onClick={onGuardar}>
          {ocupado ? "Guardando..." : "Guardar cuenta"}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Crear un tercero (con su primera cuenta, opcional).
// ---------------------------------------------------------------------------
const TERCERO_VACIO = {
  tipoDocumento: "",
  numeroDocumento: "",
  dv: "",
  razonSocial: "",
  nombreBanco: "",
  nombres: "",
  apellidos: "",
  observaciones: "",
}

export function NuevoTerceroDialogo({
  abierto,
  bancos,
  onCerrar,
  onCreado,
}: {
  abierto: boolean
  bancos: Banco[]
  onCerrar: () => void
  onCreado: (t: Tercero) => void
}) {
  const [datos, setDatos] = useState(TERCERO_VACIO)
  const [conCuenta, setConCuenta] = useState(true)
  const [cuenta, setCuenta] = useState<DatosCuenta>(CUENTA_VACIA)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const esNit = datos.tipoDocumento === "NIT"

  function cambiarDocumento(numero: string) {
    const digitos = soloDigitos(numero)
    // Para un NIT se propone el dígito de verificación (se puede corregir).
    const dv = datos.tipoDocumento === "NIT" && digitos ? String(calcularDvNit(digitos)) : datos.dv
    setDatos({ ...datos, numeroDocumento: digitos, dv })
  }

  function cerrar() {
    setDatos(TERCERO_VACIO)
    setCuenta(CUENTA_VACIA)
    setConCuenta(true)
    setError(null)
    onCerrar()
  }

  async function guardar() {
    setOcupado(true)
    setError(null)
    try {
      const creado = await crearTercero(datos, conCuenta ? cuenta : null)
      setDatos(TERCERO_VACIO)
      setCuenta(CUENTA_VACIA)
      setConCuenta(true)
      onCreado(creado)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el tercero.")
    } finally {
      setOcupado(false)
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && cerrar()}>
      <DialogContent className="max-h-[90vh] w-[min(95vw,44rem)] max-w-none overflow-y-auto sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Nuevo tercero</DialogTitle>
        </DialogHeader>

        <Banner error={error} />

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Tipo de documento</Label>
            <Select
              value={datos.tipoDocumento}
              onValueChange={(v) => {
                const tipo = v ?? ""
                const dv = tipo === "NIT" && datos.numeroDocumento ? String(calcularDvNit(datos.numeroDocumento)) : ""
                setDatos({ ...datos, tipoDocumento: tipo, dv })
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Escoge" />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_DOCUMENTO_TERCERO.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Número {esNit ? "(sin dígito de verificación)" : ""}</Label>
            <Input inputMode="numeric" value={datos.numeroDocumento} onChange={(e) => cambiarDocumento(e.target.value)} />
          </div>
          {esNit && (
            <div className="space-y-1.5">
              <Label>Dígito de verificación</Label>
              <Input
                inputMode="numeric"
                maxLength={1}
                value={datos.dv}
                onChange={(e) => setDatos({ ...datos, dv: soloDigitos(e.target.value) })}
              />
            </div>
          )}
          <div className="space-y-1.5 sm:col-span-3">
            <Label>{esNit ? "Razón social" : "Nombre completo"}</Label>
            <Input value={datos.razonSocial} onChange={(e) => setDatos({ ...datos, razonSocial: e.target.value })} />
          </div>
          {datos.tipoDocumento && !esNit && (
            <>
              <div className="space-y-1.5 sm:col-span-3 sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0">
                <div className="space-y-1.5">
                  <Label>Nombres (opcional)</Label>
                  <Input value={datos.nombres} onChange={(e) => setDatos({ ...datos, nombres: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Apellidos (opcional)</Label>
                  <Input value={datos.apellidos} onChange={(e) => setDatos({ ...datos, apellidos: e.target.value })} />
                </div>
              </div>
            </>
          )}
          <div className="space-y-1.5 sm:col-span-3">
            <Label>Nombre para el banco (opcional)</Label>
            <Input
              placeholder="Si se deja vacío se usa el nombre"
              value={datos.nombreBanco}
              onChange={(e) => setDatos({ ...datos, nombreBanco: e.target.value })}
            />
          </div>
        </div>

        <section className="space-y-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={conCuenta} onChange={(e) => setConCuenta(e.target.checked)} />
            Agregar su cuenta bancaria ahora
          </label>
          {conCuenta && <CamposCuenta valores={cuenta} onCambiar={setCuenta} bancos={bancos} />}
          <p className="text-xs text-muted-foreground">
            Las cuentas nuevas quedan pendientes hasta que Financiera las verifique.
          </p>
        </section>

        <DialogFooter>
          <Button variant="outline" disabled={ocupado} onClick={cerrar}>
            Cancelar
          </Button>
          <Button disabled={ocupado} onClick={guardar}>
            {ocupado ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...
              </>
            ) : (
              "Crear tercero"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
