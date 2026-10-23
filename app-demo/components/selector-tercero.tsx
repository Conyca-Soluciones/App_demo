"use client"

import { useEffect, useState } from "react"
import { Loader2, Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CuentasTercero } from "@/components/cuentas-tercero"
import { NuevoTerceroDialogo } from "@/components/tercero-dialogo"
import { buscarTerceroPorDocumento, listarBancos } from "@/app/(app)/ayf/terceros/actions"
import type { Banco, TerceroBasico } from "@/lib/terceros"

// Elegir el tercero de un contratista, proveedor (o empleado): se busca por
// DOCUMENTO (cédula o NIT), no por nombre, para no registrar dos veces a la
// misma persona; si no existe se crea con el formulario de A&F, con el
// documento ya escrito. Elegido, muestra nombre, documento y sus cuentas.
// fijo = no se puede cambiar (al editar: lo corrige A&F en Terceros).
// validar: rechaza un tercero que no sirve (devuelve el mensaje).
export function SelectorTercero({
  tercero,
  onElegir,
  onQuitar,
  fijo = false,
  deshabilitado = false,
  etiqueta = "Cédula o NIT *",
  error,
  validar,
  detalle,
  nota = "Se busca por documento para no registrar dos veces a la misma persona o empresa. La cuenta bancaria se registra en el tercero y A&F la verifica.",
  claseCampo,
}: {
  tercero: TerceroBasico | null
  onElegir: (t: TerceroBasico) => void
  onQuitar: () => void
  fijo?: boolean
  deshabilitado?: boolean
  etiqueta?: string
  error?: string
  validar?: (t: TerceroBasico) => string | null
  detalle?: React.ReactNode // debajo del documento (p. ej. tipo de persona)
  nota?: string
  claseCampo: string
}) {
  const [documento, setDocumento] = useState("")
  const [buscando, setBuscando] = useState(false)
  // Documento buscado que no está en Terceros (para ofrecer crearlo).
  const [noExiste, setNoExiste] = useState<string | null>(null)
  const [errorTercero, setErrorTercero] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)
  const [bancos, setBancos] = useState<Banco[]>([])

  useEffect(() => {
    if (fijo) return
    let activo = true
    listarBancos()
      .then((lista: Banco[]) => activo && setBancos(lista))
      .catch(() => activo && setBancos([]))
    return () => {
      activo = false
    }
  }, [fijo])

  function elegir(t: TerceroBasico) {
    setNoExiste(null)
    const problema = validar?.(t) ?? null
    if (problema) {
      setErrorTercero(problema)
      return
    }
    setErrorTercero(null)
    onElegir(t)
  }

  async function buscar() {
    const doc = documento.trim()
    if (!doc) return
    setBuscando(true)
    setNoExiste(null)
    setErrorTercero(null)
    try {
      const t = await buscarTerceroPorDocumento(doc)
      if (t) elegir(t)
      else setNoExiste(doc)
    } catch (e) {
      setErrorTercero(e instanceof Error ? e.message : "No se pudo buscar el tercero.")
    } finally {
      setBuscando(false)
    }
  }

  if (tercero) {
    return (
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border bg-muted/40 p-3 text-sm">
        <div className="min-w-0 space-y-1">
          <p className="font-medium">{tercero.razonSocial}</p>
          <p className="text-xs text-muted-foreground">
            {tercero.tipoDocumento} {tercero.numeroDocumento}
            {tercero.dv ? `-${tercero.dv}` : ""}
            {detalle}
          </p>
          <CuentasTercero terceroId={tercero.id} />
          {fijo && (
            <p className="text-xs text-muted-foreground">El nombre, el documento y la cuenta se corrigen en Terceros (A&amp;F).</p>
          )}
        </div>
        {!fijo && (
          <Button type="button" size="sm" variant="outline" onClick={onQuitar} disabled={deshabilitado}>
            Cambiar
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor="selector-tercero-documento" className="text-xs font-medium text-muted-foreground">
            {etiqueta}
          </label>
          <input
            id="selector-tercero-documento"
            value={documento}
            onChange={(e) => {
              setDocumento(e.target.value)
              setNoExiste(null)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                void buscar()
              }
            }}
            inputMode="numeric"
            autoFocus
            placeholder="Ej. 900123456"
            disabled={deshabilitado}
            className={claseCampo}
          />
        </div>
        <Button type="button" variant="outline" onClick={() => void buscar()} disabled={buscando || !documento.trim()}>
          {buscando ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          Buscar
        </Button>
      </div>
      {noExiste && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>No hay ningún tercero con el documento {noExiste}.</span>
          <Button type="button" size="sm" onClick={() => setCreando(true)}>
            <Plus className="size-4" /> Crear tercero
          </Button>
        </div>
      )}
      {errorTercero && <p className="text-xs text-destructive">{errorTercero}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {nota && <p className="text-xs text-muted-foreground">{nota}</p>}

      {/* Mismo formulario de A&F (crear un tercero lo puede cualquiera). */}
      {creando && (
        <NuevoTerceroDialogo
          abierto
          bancos={bancos}
          documentoInicial={noExiste ?? documento}
          onCerrar={() => setCreando(false)}
          onCreado={(t) => {
            setCreando(false)
            elegir(t)
          }}
          onExistente={(t) => {
            setCreando(false)
            elegir(t)
          }}
        />
      )}
    </div>
  )
}
