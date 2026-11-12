"use client"

import { formatearFechaSinHora } from "@/lib/fechas"
import { useEffect, useId, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { extensionArchivo, revisarArchivoTercero } from "@/lib/archivos-tercero"
import { RutTercero } from "@/components/rut-tercero"
import { BadgeCheck, Download, History, Loader2, Pencil, Plus } from "lucide-react"
import { HistorialTimeline } from "@/components/historial-timeline"
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
  buscarTerceroPorDocumento,
  crearTercero,
  enlaceCertificacionTercero,
  inactivarCuenta,
  reactivarCuenta,
  verificarCuenta,
} from "@/app/(app)/ayf/terceros/actions"
import { calcularDvNit } from "@/lib/contratistas"
import {
  CLASE_ESTADO_CUENTA,
  ETIQUETA_ESTADO_CUENTA,
  TIPOS_CUENTA_TERCERO,
  ETIQUETA_TIPO_CUENTA,
  TIPOS_DOCUMENTO_TERCERO,
  documentoFormateado,
  soloDigitos,
  validarCuenta,
  validarTercero,
  type Banco,
  type CuentaTercero,
  type DatosCuenta,
  type Tercero,
  type TerceroBasico,
} from "@/lib/terceros"

const CUENTA_VACIA: DatosCuenta = { bancoId: "", tipoCuenta: "", numeroCuenta: "", etiqueta: "", observaciones: "" }

// Fecha sin hora o marca de tiempo: dd/mm/aaaa en hora de Colombia (lib/fechas).
const formatoFecha = (iso: string) => formatearFechaSinHora(iso)

function Etiqueta({ estado }: { estado: CuentaTercero["estado"] }) {
  return (
    <Badge variant="outline" className={`h-6 px-3 text-xs ${CLASE_ESTADO_CUENTA[estado]}`}>
      {ETIQUETA_ESTADO_CUENTA[estado]}
    </Badge>
  )
}

function ErrorCampo({ texto }: { texto?: string }) {
  return texto ? <p className="text-xs text-destructive">{texto}</p> : null
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
  errores,
}: {
  valores: DatosCuenta
  onCambiar: (v: DatosCuenta) => void
  bancos: Banco[]
  errores?: Partial<Record<keyof DatosCuenta, string>>
}) {
  const id = useId()
  const poner = (campo: keyof DatosCuenta, valor: string) => onCambiar({ ...valores, [campo]: valor })
  // PSE no es un banco donde se tenga cuenta (es un método de pago): no se
  // ofrece, salvo que la cuenta que se edita ya lo tenga.
  const opciones = bancos.filter((b) => b.nombre.trim().toUpperCase() !== "PSE" || b.id === valores.bancoId)
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-banco`}>Banco</Label>
        <Select value={valores.bancoId} onValueChange={(v) => poner("bancoId", v ?? "")}>
          <SelectTrigger id={`${id}-banco`} className="w-full" aria-invalid={!!errores?.bancoId}>
            <SelectValue placeholder="Escoge el banco" />
          </SelectTrigger>
          <SelectContent>
            {opciones.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ErrorCampo texto={errores?.bancoId} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-tipo`}>Tipo de cuenta</Label>
        <Select value={valores.tipoCuenta} onValueChange={(v) => poner("tipoCuenta", v ?? "")}>
          <SelectTrigger id={`${id}-tipo`} className="w-full" aria-invalid={!!errores?.tipoCuenta}>
            <SelectValue placeholder="Escoge el tipo" />
          </SelectTrigger>
          <SelectContent>
            {TIPOS_CUENTA_TERCERO.map((t) => (
              <SelectItem key={t} value={t}>
                {ETIQUETA_TIPO_CUENTA[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ErrorCampo texto={errores?.tipoCuenta} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-numero`}>Número de cuenta</Label>
        <Input
          id={`${id}-numero`}
          aria-invalid={!!errores?.numeroCuenta}
          inputMode="numeric"
          placeholder="Solo números"
          value={valores.numeroCuenta}
          onChange={(e) => poner("numeroCuenta", soloDigitos(e.target.value))}
        />
        <ErrorCampo texto={errores?.numeroCuenta} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-etiqueta`}>Etiqueta (opcional)</Label>
        <Input
          id={`${id}-etiqueta`}
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
  const [verHistorial, setVerHistorial] = useState(false)
  const [versionHistorial, setVersionHistorial] = useState(0)

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
      setVersionHistorial((v) => v + 1)
      if (mensajeOk) setAviso(mensajeOk)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la acción.")
      return false
    } finally {
      setOcupado(false)
    }
  }

  // La certificación viene del contratista con el mismo documento (si existe).
  async function descargarCertificacion() {
    setOcupado(true)
    setError(null)
    setAviso(null)
    try {
      const cert = await enlaceCertificacionTercero(tercero.id)
      if (!cert) {
        setAviso("Este tercero no tiene certificación bancaria: no viene de un contratista o el contratista no la subió.")
      } else {
        window.open(cert.url, "_blank", "noopener")
        setAviso(`Certificación de ${cert.contratista}: ${cert.nombreArchivo}.`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abrir la certificación.")
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

      {/* ------------------------------------------------------------- RUT */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">RUT</h3>
        <RutTercero
          terceroId={tercero.id}
          nombreArchivo={tercero.rutNombre}
          puedeSubir={puedeEditar || puedeVerificar}
          onCambio={(nombre) => onCambio({ ...tercero, rutNombre: nombre })}
        />
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

        {puedeVerificar && tercero.cuentas.some((c) => c.estado === "PENDIENTE") && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span className="min-w-0 flex-1">
              Hay cuentas pendientes de verificar. Compáralas con la certificación bancaria antes de verificarlas.
            </span>
            <Button size="sm" variant="outline" disabled={ocupado} onClick={descargarCertificacion}>
              <Download className="mr-1.5 h-4 w-4" />
              Descargar certificación bancaria
            </Button>
          </div>
        )}

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
                      {c.bancoNombre} · {ETIQUETA_TIPO_CUENTA[c.tipoCuenta]}
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

      {/* -------------------------------------------------------- historial */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Historial</h3>
          <Button size="sm" variant="outline" onClick={() => setVerHistorial((v) => !v)}>
            <History className="mr-1.5 h-4 w-4" />
            {verHistorial ? "Ocultar" : "Ver historial"}
          </Button>
        </div>
        {verHistorial && (
          <div className="rounded-lg border p-3">
            {/* La versión cambia con cada cambio guardado: así el historial se vuelve a cargar. */}
            <HistorialTimeline key={versionHistorial} tipo="tercero" id={tercero.id} />
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

// El mismo formulario en A&F y en las pantallas que crean su tercero
// (Contratistas...): crear lo puede cualquiera, editar solo A&F.
// Al escribir el documento se compara con Terceros (tercero_por_documento): si
// ya existe, avisa y no deja crearlo. onExistente (opcional) agrega el botón
// para usar o abrir ese tercero.
export function NuevoTerceroDialogo({
  abierto,
  bancos,
  onCerrar,
  onCreado,
  onExistente,
  textoExistente = "Usar este tercero",
  documentoInicial,
}: {
  abierto: boolean
  bancos: Banco[]
  onCerrar: () => void
  onCreado: (t: TerceroBasico) => void
  onExistente?: (t: TerceroBasico) => void
  textoExistente?: string
  // El documento que se buscó antes de abrir (Contratistas): llega escrito.
  documentoInicial?: string
}) {
  const [datos, setDatos] = useState(() => ({
    ...TERCERO_VACIO,
    numeroDocumento: soloDigitos((documentoInicial ?? "").split("-")[0]),
  }))
  // Resultado de comparar el documento escrito con Terceros; "comprobando"
  // mientras no corresponda al documento actual.
  const [revision, setRevision] = useState<{ numero: string; tercero: TerceroBasico | null } | null>(null)
  const numero = datos.numeroDocumento
  const revisable = numero.length >= 3
  const comprobando = revisable && revision?.numero !== numero
  const existente = revisable && revision?.numero === numero ? revision.tercero : null

  useEffect(() => {
    if (!abierto || numero.length < 3) return
    let vigente = true
    const t = setTimeout(() => {
      buscarTerceroPorDocumento(numero)
        .then((encontrado: TerceroBasico | null) => vigente && setRevision({ numero, tercero: encontrado }))
        // Si la consulta falla no se bloquea: la base igual rechaza el repetido.
        .catch(() => vigente && setRevision({ numero, tercero: null }))
    }, 350)
    return () => {
      vigente = false
      clearTimeout(t)
    }
  }, [abierto, numero])
  const [cuenta, setCuenta] = useState<DatosCuenta>(CUENTA_VACIA)
  // Certificación bancaria de la cuenta y RUT: obligatorios, se suben al crear
  // (20270101000300).
  const [certificacion, setCertificacion] = useState<File | null>(null)
  const [rut, setRut] = useState<File | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Errores por campo (todos a la vez); cada uno se borra al corregir su campo.
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [erroresCuenta, setErroresCuenta] = useState<Partial<Record<keyof DatosCuenta, string>>>({})
  const uid = useId()

  const esNit = datos.tipoDocumento === "NIT"

  // Cambia los datos y quita el error de los campos tocados.
  function ponerDatos(cambio: Partial<typeof datos>) {
    setDatos({ ...datos, ...cambio })
    setError(null)
    setErrores((e) => {
      const n = { ...e }
      for (const k of Object.keys(cambio)) delete n[k]
      if ("tipoDocumento" in cambio || "numeroDocumento" in cambio) delete n.dv
      return n
    })
  }
  function quitarError(campo: string) {
    setErrores((e) => {
      const n = { ...e }
      delete n[campo]
      return n
    })
  }
  function ponerCuenta(c: DatosCuenta) {
    setError(null)
    setErroresCuenta((e) => {
      const n = { ...e }
      for (const k of Object.keys(c) as (keyof DatosCuenta)[]) if (c[k] !== cuenta[k]) delete n[k]
      return n
    })
    setCuenta(c)
  }

  function cambiarDocumento(numero: string) {
    const digitos = soloDigitos(numero)
    // Para un NIT se propone el dígito de verificación (se puede corregir).
    const dv = datos.tipoDocumento === "NIT" && digitos ? String(calcularDvNit(digitos)) : datos.dv
    ponerDatos({ numeroDocumento: digitos, dv })
  }

  function cerrar() {
    setDatos(TERCERO_VACIO)
    setCuenta(CUENTA_VACIA)
    setCertificacion(null)
    setRut(null)
    setError(null)
    setErrores({})
    setErroresCuenta({})
    setRevision(null)
    onCerrar()
  }

  async function guardar() {
    setError(null)
    // Se revisa todo antes de enviar y se muestran todos los errores juntos
    // (la base vuelve a validar).
    const vt = validarTercero(datos)
    const vc = validarCuenta(cuenta)
    const et: Record<string, string> = vt.ok ? {} : { ...(vt.errores as Record<string, string>) }
    if (!certificacion) et.certificacion = "Adjunta la certificación bancaria."
    if (!rut) et.rut = "Adjunta el RUT."
    const ec = vc.ok ? {} : vc.errores
    setErrores(et)
    setErroresCuenta(ec)
    const total = Object.keys(et).length + Object.keys(ec).length
    if (total > 0) {
      setError(total === 1 ? "Falta corregir 1 dato (marcado en rojo)." : `Faltan corregir ${total} datos (marcados en rojo).`)
      return
    }
    setOcupado(true)
    // Los archivos se suben primero (a la carpeta del usuario); si el tercero
    // no se crea, se borran.
    const supabase = createClient()
    const subidas: { ruta: string; nombre: string; mime: string }[] = []
    try {
      const { data: sesion } = await supabase.auth.getUser()
      const uidSesion = sesion.user?.id
      if (!uidSesion) throw new Error("Tu sesión se cerró: vuelve a iniciar sesión.")
      const subir = async (f: File, que: string) => {
        const ruta = `nuevo/${uidSesion}/${crypto.randomUUID()}.${extensionArchivo(f)}`
        const { error: e } = await supabase.storage.from("terceros").upload(ruta, f, { contentType: f.type, upsert: false })
        if (e) throw new Error(`No se pudo subir ${que}: ${e.message}`)
        const subida = { ruta, nombre: f.name, mime: f.type }
        subidas.push(subida)
        return subida
      }
      if (!certificacion || !rut) throw new Error("Adjunta la certificación bancaria y el RUT.")
      const cert = await subir(certificacion, "la certificación")
      const archivoRut = await subir(rut, "el RUT")
      const creado = await crearTercero(datos, cuenta, cert, archivoRut)
      setDatos(TERCERO_VACIO)
      setCuenta(CUENTA_VACIA)
      setCertificacion(null)
      setRut(null)
      onCreado(creado)
    } catch (e) {
      if (subidas.length > 0) await supabase.storage.from("terceros").remove(subidas.map((x) => x.ruta))
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
            <Label htmlFor={`${uid}-tipo`}>Tipo de documento</Label>
            <Select
              value={datos.tipoDocumento}
              onValueChange={(v) => {
                const tipo = v ?? ""
                const dv = tipo === "NIT" && datos.numeroDocumento ? String(calcularDvNit(datos.numeroDocumento)) : ""
                ponerDatos({ tipoDocumento: tipo, dv })
              }}
            >
              <SelectTrigger id={`${uid}-tipo`} className="w-full" aria-invalid={!!errores.tipoDocumento}>
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
            <ErrorCampo texto={errores.tipoDocumento} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-numero`}>Número {esNit ? "(sin dígito de verificación)" : ""}</Label>
            <Input
              id={`${uid}-numero`}
              aria-invalid={!!errores.numeroDocumento}
              inputMode="numeric"
              value={datos.numeroDocumento}
              onChange={(e) => cambiarDocumento(e.target.value)}
            />
            <ErrorCampo texto={errores.numeroDocumento} />
          </div>
          {esNit && (
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-dv`}>Dígito de verificación</Label>
              <Input
                id={`${uid}-dv`}
                aria-invalid={!!errores.dv}
                inputMode="numeric"
                maxLength={1}
                value={datos.dv}
                onChange={(e) => ponerDatos({ dv: soloDigitos(e.target.value) })}
              />
              <ErrorCampo texto={errores.dv} />
            </div>
          )}
          {existente && (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:col-span-3">
              <p>
                Ya existe un tercero con este documento: <span className="font-medium">{existente.razonSocial}</span> (
                {existente.tipoDocumento} {existente.numeroDocumento}
                {existente.dv ? `-${existente.dv}` : ""}). No lo crees de nuevo.
              </p>
              {onExistente && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const t = existente
                    cerrar()
                    onExistente(t)
                  }}
                >
                  {textoExistente}
                </Button>
              )}
            </div>
          )}
          <div className="space-y-1.5 sm:col-span-3">
            <Label htmlFor={`${uid}-razon`}>{esNit ? "Razón social" : "Nombre completo"}</Label>
            <Input
              id={`${uid}-razon`}
              aria-invalid={!!errores.razonSocial}
              value={datos.razonSocial}
              onChange={(e) => ponerDatos({ razonSocial: e.target.value })}
            />
            <ErrorCampo texto={errores.razonSocial} />
          </div>
          {datos.tipoDocumento && !esNit && (
            <>
              <div className="space-y-1.5 sm:col-span-3 sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0">
                <div className="space-y-1.5">
                  <Label htmlFor={`${uid}-nombres`}>Nombres (opcional)</Label>
                  <Input id={`${uid}-nombres`} value={datos.nombres} onChange={(e) => ponerDatos({ nombres: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${uid}-apellidos`}>Apellidos (opcional)</Label>
                  <Input id={`${uid}-apellidos`} value={datos.apellidos} onChange={(e) => ponerDatos({ apellidos: e.target.value })} />
                </div>
              </div>
            </>
          )}
          <div className="space-y-1.5 sm:col-span-3">
            <Label htmlFor={`${uid}-nombre-banco`}>Nombre para el banco (opcional)</Label>
            <Input
              id={`${uid}-nombre-banco`}
              aria-invalid={!!errores.nombreBanco}
              placeholder="Si se deja vacío se usa el nombre"
              value={datos.nombreBanco}
              onChange={(e) => ponerDatos({ nombreBanco: e.target.value })}
            />
            <ErrorCampo texto={errores.nombreBanco} />
          </div>
        </div>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Cuenta bancaria</h3>
          <CamposCuenta valores={cuenta} onCambiar={ponerCuenta} bancos={bancos} errores={erroresCuenta} />
          <div className="grid gap-3 sm:grid-cols-2">
            <CampoArchivoTercero
              etiqueta="Certificación bancaria"
              archivo={certificacion}
              ocupado={ocupado}
              error={errores.certificacion}
              onCambiar={(f, problema) => {
                setError(problema)
                if (problema) return
                setCertificacion(f)
                quitarError("certificacion")
              }}
            />
            <CampoArchivoTercero
              etiqueta="RUT"
              archivo={rut}
              ocupado={ocupado}
              error={errores.rut}
              onCambiar={(f, problema) => {
                setError(problema)
                if (problema) return
                setRut(f)
                quitarError("rut")
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            La cuenta queda pendiente hasta que Financiera la verifique con la certificación.
          </p>
        </section>

        <DialogFooter>
          <Button variant="outline" disabled={ocupado} onClick={cerrar}>
            Cancelar
          </Button>
          <Button disabled={ocupado || comprobando || existente !== null} onClick={guardar}>
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

// Un archivo obligatorio del tercero (certificación bancaria, RUT): PDF, JPG o
// PNG de hasta 10 MB.
function CampoArchivoTercero({
  etiqueta,
  archivo,
  ocupado,
  error,
  onCambiar,
}: {
  etiqueta: string
  archivo: File | null
  ocupado: boolean
  error?: string
  // problema = mensaje si el archivo no sirve (null si sirve)
  onCambiar: (f: File, problema: string | null) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="min-w-0 space-y-1.5">
      <Label>{etiqueta}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={ocupado}
          aria-invalid={!!error}
          className={error ? "border-destructive" : undefined}
          onClick={() => ref.current?.click()}
        >
          {archivo ? "Cambiar archivo" : "Adjuntar archivo"}
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{archivo ? archivo.name : "PDF, JPG o PNG de hasta 10 MB"}</span>
      </div>
      <input
        ref={ref}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ""
          if (!f) return
          onCambiar(f, revisarArchivoTercero(f, etiqueta === "RUT" ? "El RUT" : "La certificación"))
        }}
      />
      <ErrorCampo texto={error} />
    </div>
  )
}
