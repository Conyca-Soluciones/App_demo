"use client"

import { useState } from "react"
import { Loader2, Pencil } from "lucide-react"

import { Button } from "@/components/ui/button"
import { actualizarDatosProveedor } from "@/app/(app)/almacen/proveedores/actions"
import type { ProveedorDetalle } from "@/app/(app)/almacen/comprar-pedidos/actions"
import { ETIQUETA_CAMPO, validarCampo, type CampoEditable } from "@/lib/proveedores"

// ---------------------------------------------------------------------------
// Tarjeta del proveedor en Generar orden de compra. Muestra los datos que
// salen en el PDF de la orden y, si el usuario tiene la acción
// `editar_proveedores` (o es Administrador), permite completarlos/corregirlos
// ahí mismo. Guardar escribe en la tabla `proveedores` (queda para todas las
// órdenes futuras) y actualiza la tarjeta, de donde la orden que se está
// generando toma teléfono, ciudad y correo. Los datos bancarios son de solo
// lectura (viven en otra tabla).
// ---------------------------------------------------------------------------

// Campos editables, en el orden en que se muestran.
const CAMPOS: CampoEditable[] = [
  "nombreContacto",
  "telefono",
  "correo",
  "ciudad",
  "direccion",
  "numeroDocumento",
  "digitoVerificacion",
]

function valorTexto(d: ProveedorDetalle, campo: CampoEditable): string {
  const v = d[campo as keyof ProveedorDetalle]
  return v === null || v === undefined ? "" : String(v)
}

function nitVisible(d: ProveedorDetalle): string | null {
  if (d.numeroDocumento == null) return null
  const tipo = d.tipoDocumento ? `${d.tipoDocumento} ` : ""
  const numero = d.numeroDocumento.toLocaleString("es-CO")
  return d.digitoVerificacion != null ? `${tipo}${numero}-${d.digitoVerificacion}` : `${tipo}${numero}`
}

export function TarjetaProveedorOC({
  detalle,
  puedeEditar,
  onActualizado,
}: {
  detalle: ProveedorDetalle
  puedeEditar: boolean
  onActualizado: (d: ProveedorDetalle) => void
}) {
  const [editando, setEditando] = useState(false)
  const [valores, setValores] = useState<Partial<Record<CampoEditable, string>>>({})
  const [errores, setErrores] = useState<Partial<Record<CampoEditable, string>>>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState(false)

  function empezar() {
    setValores(Object.fromEntries(CAMPOS.map((c) => [c, valorTexto(detalle, c)])))
    setErrores({})
    setErrorGeneral(null)
    setGuardado(false)
    setEditando(true)
  }

  async function guardar() {
    // Solo se envían los campos que cambiaron.
    const cambios: Partial<Record<CampoEditable, string>> = {}
    const nuevosErrores: Partial<Record<CampoEditable, string>> = {}
    for (const campo of CAMPOS) {
      const nuevo = (valores[campo] ?? "").trim()
      if (nuevo === valorTexto(detalle, campo).trim()) continue
      const r = validarCampo(campo, nuevo)
      if (!r.ok) nuevosErrores[campo] = r.error
      cambios[campo] = nuevo
    }
    setErrores(nuevosErrores)
    if (Object.keys(nuevosErrores).length > 0) return
    if (Object.keys(cambios).length === 0) {
      setEditando(false)
      return
    }

    setGuardando(true)
    setErrorGeneral(null)
    try {
      const p = await actualizarDatosProveedor(detalle.id, cambios)
      onActualizado({
        ...detalle,
        nombreContacto: p.nombreContacto,
        telefono: p.telefono,
        correo: p.correo,
        ciudad: p.ciudad,
        direccion: p.direccion,
        tipoDocumento: p.tipoDocumento,
        numeroDocumento: p.numeroDocumento,
        digitoVerificacion: p.digitoVerificacion,
      })
      setEditando(false)
      setGuardado(true)
    } catch (e) {
      setErrorGeneral(e instanceof Error ? e.message : "No se pudieron guardar los cambios.")
    } finally {
      setGuardando(false)
    }
  }

  const fila = (etiqueta: string, valor: string | null) => (
    <p className="break-words">
      <span className="text-muted-foreground">{etiqueta}: </span>
      {valor || <span className="text-amber-600">Falta</span>}
    </p>
  )

  return (
    <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
      {!editando ? (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-2">
              {fila("Contacto", detalle.nombreContacto)}
              {fila("Teléfono", detalle.telefono)}
              {fila("Correo", detalle.correo)}
              {fila("Ciudad", detalle.ciudad)}
              {fila("Dirección", detalle.direccion)}
              {fila("NIT / Documento", nitVisible(detalle))}
            </div>
            {puedeEditar && (
              <Button type="button" size="sm" variant="ghost" className="h-7 shrink-0 gap-1 px-2 text-xs" onClick={empezar}>
                <Pencil className="size-3.5" /> Editar
              </Button>
            )}
          </div>
          {guardado && (
            <p className="text-xs text-emerald-700 dark:text-emerald-400">
              Guardado en el proveedor. Esta orden y las siguientes usan los datos nuevos.
            </p>
          )}
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Los cambios se guardan en el proveedor (para todas las órdenes) y se usan en esta orden.
          </p>
          {CAMPOS.map((campo) => {
            const id = `oc-proveedor-${campo}`
            return (
              <div key={campo} className="space-y-0.5">
                <label htmlFor={id} className="text-xs text-muted-foreground">
                  {campo === "numeroDocumento" ? "NIT / N° documento" : ETIQUETA_CAMPO[campo]}
                </label>
                <input
                  id={id}
                  value={valores[campo] ?? ""}
                  disabled={guardando}
                  inputMode={
                    campo === "numeroDocumento" || campo === "digitoVerificacion"
                      ? "numeric"
                      : campo === "telefono"
                        ? "tel"
                        : campo === "correo"
                          ? "email"
                          : undefined
                  }
                  onChange={(e) => {
                    setValores((v) => ({ ...v, [campo]: e.target.value }))
                    if (errores[campo]) setErrores((er) => ({ ...er, [campo]: undefined }))
                  }}
                  className={`h-8 w-full min-w-0 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    errores[campo] ? "border-destructive" : ""
                  }`}
                />
                {errores[campo] && <p className="text-xs text-destructive">{errores[campo]}</p>}
              </div>
            )
          })}
          {errorGeneral && <p className="text-xs text-destructive">{errorGeneral}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" size="sm" variant="outline" onClick={() => setEditando(false)} disabled={guardando}>
              Cancelar
            </Button>
            <Button type="button" size="sm" onClick={guardar} disabled={guardando}>
              {guardando && <Loader2 className="size-3.5 animate-spin" />}
              Guardar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
