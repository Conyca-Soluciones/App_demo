import { SidebarTrigger } from "@/components/ui/sidebar"

export default function SinAccesoPage() {
  return (
    <div className="flex h-full flex-col p-6">
      <SidebarTrigger />
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-md rounded-lg border border-dashed p-10 text-center">
          <h1 className="text-lg font-semibold">Todavía no tienes pestañas asignadas</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Tu rol no tiene acceso a ninguna sección de la aplicación. Pídele a un
            administrador que revise tu rol y tus proyectos.
          </p>
        </div>
      </div>
    </div>
  )
}
