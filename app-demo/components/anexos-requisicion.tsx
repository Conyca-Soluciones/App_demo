"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Paperclip, Plus, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { confirmar } from "@/components/ui/confirmar"
import { createClient } from "@/lib/supabase/client"
import {
  ACEPTA_ANEXO_REQUISICION,
  MAX_ANEXOS_REQUISICION,
  rutaAnexoRequisicion,
  tamanoLegible,
  validarAnexoRequisicion,
  type AnexoRequisicion,
} from "@/lib/anexos-requisicion"
import {
  agregarAnexoRequisicion,
  eliminarAnexoRequisicion,
  enlaceAnexoRequisicion,
  listarAnexosRequisicion,
} from "@/app/(app)/almacen/actions"

// Anexos de la requisición (20270101006000): archivos opcionales para Compras.

// Sube los archivos a la carpeta de la requisición y los registra. Devuelve los
// errores (uno por archivo que no se pudo); los que sí, quedan.
export async function subirAnexosRequisicion(requisicionId: string, archivos: File[]): Promise<string[]> {
  const supabase = createClient()
  const errores: string[] = []
  for (const f of archivos) {
    const ruta = rutaAnexoRequisicion(requisicionId, f, crypto.randomUUID())
    let subido = false
    try {
      const { error } = await supabase.storage.from("requisiciones").upload(ruta, f, { contentType: f.type, upsert: false })
      if (error) throw new Error(error.message)
      subido = true
      await agregarAnexoRequisicion(requisicionId, { ruta, nombreArchivo: f.name, mime: f.type, tamano: f.size })
    } catch (e) {
      if (subido) await supabase.storage.from("requisiciones").remove([ruta])
      errores.push(`${f.name}: ${e instanceof Error ? e.message : "no se pudo adjuntar"}`)
    }
  }
  return errores
}

// Elegir archivos en el formulario (antes de que exista la requisición).
export function CampoAnexosNuevos({
  archivos,
  onCambio,
  onError,
  disabled,
}: {
  archivos: File[]
  onCambio: (archivos: File[]) => void
  onError: (mensaje: string | null) => void
  disabled?: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  const lleno = archivos.length >= MAX_ANEXOS_REQUISICION
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-sm font-medium">Anexos para Compras (opcional)</label>
        <Button type="button" size="sm" variant="outline" disabled={disabled || lleno} onClick={() => ref.current?.click()}>
          <Plus className="mr-1.5 h-4 w-4" /> Adjuntar archivo
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Planos, fichas técnicas, fotos o lo que Compras necesite. PDF, imagen, Excel o Word; hasta {MAX_ANEXOS_REQUISICION}, de 10 MB
        cada uno.
      </p>
      {archivos.length > 0 && (
        <ul className="space-y-1">
          {archivos.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
              <Paperclip className="h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate" title={f.name}>
                {f.name}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{tamanoLegible(f.size)}</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                disabled={disabled}
                onClick={() => onCambio(archivos.filter((_, k) => k !== i))}
                aria-label={`Quitar ${f.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={ref}
        type="file"
        multiple
        accept={ACEPTA_ANEXO_REQUISICION}
        className="hidden"
        onChange={(e) => {
          const nuevos = Array.from(e.target.files ?? [])
          e.target.value = ""
          const problema = nuevos.map(validarAnexoRequisicion).find(Boolean) ?? null
          if (problema) {
            onError(problema)
            return
          }
          const juntos = [...archivos, ...nuevos]
          if (juntos.length > MAX_ANEXOS_REQUISICION) {
            onError(`Una requisición puede tener máximo ${MAX_ANEXOS_REQUISICION} anexos.`)
            return
          }
          onError(null)
          onCambio(juntos)
        }}
      />
    </div>
  )
}

// Lista de anexos de una requisición ya creada: "Ver" para todos; quien la hizo
// puede añadir y quitar (la base lo revisa).
export function AnexosRequisicion({ requisicionId, puedeEditar = false }: { requisicionId: string; puedeEditar?: boolean }) {
  const [anexos, setAnexos] = useState<AnexoRequisicion[] | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)

  function cargar() {
    listarAnexosRequisicion(requisicionId)
      .then((l: AnexoRequisicion[]) => setAnexos(l))
      .catch(() => setAnexos([]))
  }
  useEffect(() => {
    let vigente = true
    listarAnexosRequisicion(requisicionId)
      .then((l: AnexoRequisicion[]) => vigente && setAnexos(l))
      .catch(() => vigente && setAnexos([]))
    return () => {
      vigente = false
    }
  }, [requisicionId])

  async function ver(id: string) {
    // La pestaña se abre antes de pedir el enlace (si no, el navegador la bloquea).
    const ventana = window.open("", "_blank")
    try {
      const url = await enlaceAnexoRequisicion(id)
      if (ventana) ventana.location.href = url
      else window.open(url, "_blank", "noopener")
    } catch (e) {
      ventana?.close()
      setError(e instanceof Error ? e.message : "No se pudo abrir el anexo.")
    }
  }

  async function subir(archivos: File[]) {
    const problema = archivos.map(validarAnexoRequisicion).find(Boolean) ?? null
    if (problema) {
      setError(problema)
      return
    }
    setOcupado(true)
    setError(null)
    const errores = await subirAnexosRequisicion(requisicionId, archivos)
    if (errores.length > 0) setError(errores.join("\n"))
    setOcupado(false)
    cargar()
  }

  async function quitar(a: AnexoRequisicion) {
    if (!(await confirmar(`Se quita el anexo "${a.nombreArchivo}" de la requisición.`, { titulo: "Quitar anexo", boton: "Quitar" }))) return
    setOcupado(true)
    setError(null)
    try {
      await eliminarAnexoRequisicion(a.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo quitar el anexo.")
    } finally {
      setOcupado(false)
      cargar()
    }
  }

  if (anexos === null) return null
  if (anexos.length === 0 && !puedeEditar) return null
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground">Anexos</p>
        {puedeEditar && anexos.length < MAX_ANEXOS_REQUISICION && (
          <Button type="button" size="sm" variant="outline" className="h-7" disabled={ocupado} onClick={() => ref.current?.click()}>
            {ocupado ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
            Añadir anexo
          </Button>
        )}
      </div>
      {anexos.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sin anexos.</p>
      ) : (
        <ul className="space-y-1">
          {anexos.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-sm">
              <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate" title={a.nombreArchivo}>
                {a.nombreArchivo}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{tamanoLegible(a.tamano)}</span>
              <Button type="button" size="sm" variant="outline" className="h-7 shrink-0" onClick={() => ver(a.id)}>
                Ver
              </Button>
              {puedeEditar && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 text-destructive hover:text-destructive"
                  disabled={ocupado}
                  onClick={() => quitar(a)}
                >
                  Quitar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="whitespace-pre-line text-xs text-destructive">{error}</p>}
      <input
        ref={ref}
        type="file"
        multiple
        accept={ACEPTA_ANEXO_REQUISICION}
        className="hidden"
        onChange={(e) => {
          const nuevos = Array.from(e.target.files ?? [])
          e.target.value = ""
          if (nuevos.length === 0) return
          if (anexos.length + nuevos.length > MAX_ANEXOS_REQUISICION) {
            setError(`Una requisición puede tener máximo ${MAX_ANEXOS_REQUISICION} anexos.`)
            return
          }
          void subir(nuevos)
        }}
      />
    </div>
  )
}
