"use client"

import { useEffect, useState } from "react"
import { representantesDeContrato } from "@/app/(app)/contratos/representantes/actions"
import { ETIQUETA_TIPO_REPRESENTANTE, origenFirmaRepresentante, soloDigitos, type RepresentanteLegal } from "@/lib/representantes"

// Representante legal que firma la minuta (Jurídica): los activos de la
// empresa del proyecto. Escoger uno llena nombre, cédula (y lugar de
// expedición, si la plantilla lo pide). Su firma se pone sola cuando
// Subgerencia aprueba: firma el de la cédula que quede en la minuta.
export function SelectorRepresentante({
  contratoId,
  documentoActual,
  deshabilitado,
  onElegir,
}: {
  contratoId: string
  documentoActual: string
  deshabilitado: boolean
  onElegir: (r: RepresentanteLegal) => void
}) {
  const [reps, setReps] = useState<{ id: string; lista: RepresentanteLegal[] } | null>(null)

  useEffect(() => {
    let vigente = true
    representantesDeContrato(contratoId)
      .then((lista: RepresentanteLegal[]) => vigente && setReps({ id: contratoId, lista }))
      .catch(() => vigente && setReps({ id: contratoId, lista: [] }))
    return () => {
      vigente = false
    }
  }, [contratoId])

  if (!reps || reps.id !== contratoId) return null
  if (reps.lista.length === 0)
    return (
      <p className="mb-2 text-xs text-muted-foreground">
        La empresa no tiene representantes legales registrados (Contratos › Representantes legales): el contrato se aprueba sin
        su firma.
      </p>
    )
  const actual = soloDigitos(documentoActual)
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">Representante que firma:</span>
      {reps.lista.map((r) => {
        const elegido = r.numeroDocumento === actual
        return (
          <button
            key={r.id}
            type="button"
            disabled={deshabilitado || elegido}
            onClick={() => onElegir(r)}
            className={`rounded-full border px-3 py-1 ${elegido ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-accent"} disabled:cursor-default`}
            title={origenFirmaRepresentante(r) ? "Tiene firma" : "Todavía no tiene firma: Subgerencia no podrá aprobar"}
          >
            {ETIQUETA_TIPO_REPRESENTANTE[r.tipo]}: {r.nombre}
            {!origenFirmaRepresentante(r) && " · sin firma"}
          </button>
        )
      })}
      {actual && !reps.lista.some((r) => r.numeroDocumento === actual) && (
        <span className="text-amber-700">La cédula de la minuta no es de ningún representante registrado: Subgerencia no podrá aprobar.</span>
      )}
    </div>
  )
}
