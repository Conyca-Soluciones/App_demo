import { SidebarTrigger } from "@/components/ui/sidebar"
import { SelectorProyecto } from "@/components/selector-proyecto"

// Encabezado estándar de página: botón del menú, título, subtítulo y (si la
// página trabaja sobre un proyecto) el selector de proyecto a la derecha.
// En pantallas chicas el selector baja a su propia línea (flex-wrap).
export function EncabezadoPagina({
  titulo,
  subtitulo,
  conProyecto = false,
  children,
}: {
  titulo: string
  subtitulo?: string
  conProyecto?: boolean
  // Acciones extra a la derecha (ej. un botón "Nuevo").
  children?: React.ReactNode
}) {
  return (
    <header className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-6">
      <SidebarTrigger />
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
        {subtitulo && <p className="text-sm text-muted-foreground">{subtitulo}</p>}
      </div>
      {(conProyecto || children) && (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {children}
          {conProyecto && <SelectorProyecto />}
        </div>
      )}
    </header>
  )
}
