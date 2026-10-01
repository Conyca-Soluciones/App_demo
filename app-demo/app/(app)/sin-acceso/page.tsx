import { MarcoPagina } from "@/components/encabezado-pagina"

export default function SinAccesoPage() {
  return (
    <MarcoPagina titulo="Sin acceso">
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md rounded-lg border border-dashed p-10 text-center">
          <h2 className="text-lg font-semibold">Todavía no tienes pestañas asignadas</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Tu rol no tiene acceso a ninguna sección de la aplicación. Pídele a un
            administrador que revise tu rol y tus proyectos.
          </p>
        </div>
      </div>
    </MarcoPagina>
  )
}
