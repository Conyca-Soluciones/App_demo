import { SidebarTrigger } from "@/components/ui/sidebar"
import { SelectorProyecto } from "@/components/selector-proyecto"

// Encabezado estándar de TODAS las páginas: botón del menú, título, subtítulo y
// (si la página trabaja sobre un proyecto) el selector de proyecto a la derecha.
// Margen y alto iguales en todas (el de Salidas). En pantallas chicas el
// selector baja a su propia línea (flex-wrap).
export function EncabezadoPagina({
  titulo,
  subtitulo,
  conProyecto = false,
  className = "",
  children,
}: {
  titulo: string
  subtitulo?: string
  conProyecto?: boolean
  // Para casos especiales (ej. encabezado fijo al hacer scroll).
  className?: string
  // Acciones extra a la derecha (ej. un botón "Nuevo").
  children?: React.ReactNode
}) {
  return (
    <header
      className={`flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-6 ${className}`}
    >
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

// Página completa: encabezado estándar + contenido con el margen estándar
// (p-4 sm:p-6). `scroll` = el contenido hace scroll dentro de la página (las
// vistas que manejan su propio scroll interno lo dejan en false).
export function MarcoPagina({
  titulo,
  subtitulo,
  conProyecto = false,
  scroll = false,
  children,
}: {
  titulo: string
  subtitulo?: string
  conProyecto?: boolean
  scroll?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <EncabezadoPagina titulo={titulo} subtitulo={subtitulo} conProyecto={conProyecto} />
      <div className={`min-h-0 flex-1 p-4 sm:p-6 ${scroll ? "overflow-auto" : ""}`}>{children}</div>
    </div>
  )
}
