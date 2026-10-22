"use client"

import { ETIQUETA_TIPO_REPRESENTANTE, origenFirmaRepresentante, soloDigitos, type RepresentanteLegal } from "@/lib/representantes"

// Representante legal que firma la minuta (Jurídica): los activos de la
// empresa del proyecto (vienen con la minuta: obtenerMinuta*; sin otra llamada
// al servidor, que Next atiende de una en una). Escoger uno llena nombre, cédula (y lugar de
// expedición, si la plantilla lo pide). Su firma se pone sola cuando
// Subgerencia aprueba: firma el de la cédula que quede en la minuta.
export function SelectorRepresentante({
  representantes,
  documentoActual,
  deshabilitado,
  onElegir,
}: {
  representantes: RepresentanteLegal[]
  documentoActual: string
  deshabilitado: boolean
  onElegir: (r: RepresentanteLegal) => void
}) {
  if (representantes.length === 0)
    return (
      <p className="mb-2 text-xs text-muted-foreground">
        La empresa no tiene representantes legales registrados (Admin › Empresas): el contrato se aprueba sin su firma.
      </p>
    )
  const actual = soloDigitos(documentoActual)
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">Representante que firma:</span>
      {representantes.map((r) => {
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
      {actual && !representantes.some((r) => r.numeroDocumento === actual) && (
        <span className="text-amber-700">La cédula de la minuta no es de ningún representante registrado: Subgerencia no podrá aprobar.</span>
      )}
    </div>
  )
}
