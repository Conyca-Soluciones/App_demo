"use client"

import { useEffect, useRef, useState } from "react"
import { Search, X, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { DropdownFlotante } from "@/components/dropdown-flotante"
import { puedeBuscar, COMODIN_LISTAR } from "@/lib/busqueda"

export type OpcionBuscador = {
  id: string
  etiqueta: string
  subetiqueta?: string | null
}

type BuscadorAsyncProps = {
  placeholder: string
  valorSeleccionado: OpcionBuscador | null
  onSeleccionar: (opcion: OpcionBuscador | null) => void
  buscar: (termino: string) => Promise<OpcionBuscador[]>
  minCaracteres?: number
  disabled?: boolean
  // Para enfocar el campo desde fuera (llenado rápido con teclado).
  inputId?: string
  autoFocus?: boolean
  // Dentro de una tabla con scroll: la lista sale encima de todo (portal) en
  // vez de quedar recortada por el borde del contenedor.
  flotante?: boolean
}

/**
 * Combobox de búsqueda genérico, reutilizado para Proyecto/Usuario/Insumo en
 * el filtro de Compras. Implementado sin el Popover de shadcn a propósito --
 * ese componente en este proyecto está sobre Base UI, no Radix, y su API
 * (asChild, onOpenAutoFocus) no coincide con la que asumí originalmente. Un
 * combobox de búsqueda es más simple como un dropdown propio con posición
 * absoluta + cierre al hacer clic afuera, sin depender de esa librería.
 */
export function BuscadorAsync({
  placeholder,
  valorSeleccionado,
  onSeleccionar,
  buscar,
  minCaracteres = 2,
  disabled,
  inputId,
  autoFocus,
  flotante = false,
}: BuscadorAsyncProps) {
  const [termino, setTermino] = useState("")
  const [abierto, setAbierto] = useState(false)
  const [opcionesEncontradas, setOpciones] = useState<OpcionBuscador[]>([])
  const [buscandoAhora, setCargando] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contenedorRef = useRef<HTMLDivElement>(null)
  const listaRef = useRef<HTMLDivElement>(null)

  // Con un término muy corto no se muestra nada (se deriva en el render; el
  // efecto solo busca).
  const hayQueBuscar = puedeBuscar(termino, minCaracteres)
  const opciones = hayQueBuscar ? opcionesEncontradas : []
  const cargando = hayQueBuscar && buscandoAhora

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!puedeBuscar(termino, minCaracteres)) return

    debounceRef.current = setTimeout(async () => {
      setCargando(true)
      try {
        const resultados = await buscar(termino)
        setOpciones(resultados)
      } finally {
        setCargando(false)
      }
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [termino, buscar, minCaracteres])

  useEffect(() => {
    function alHacerClicAfuera(e: MouseEvent) {
      const objetivo = e.target as Node
      if (contenedorRef.current && !contenedorRef.current.contains(objetivo) && !listaRef.current?.contains(objetivo)) {
        setAbierto(false)
      }
    }
    document.addEventListener("mousedown", alHacerClicAfuera)
    return () => document.removeEventListener("mousedown", alHacerClicAfuera)
  }, [])

  if (valorSeleccionado) {
    return (
      <div className="flex items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm">
        <div className="truncate">
          <span className="font-medium">{valorSeleccionado.etiqueta}</span>
          {valorSeleccionado.subetiqueta && (
            <span className="ml-1 text-muted-foreground">{valorSeleccionado.subetiqueta}</span>
          )}
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={() => onSeleccionar(null)}
            className="ml-2 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Quitar selección"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div ref={contenedorRef} className="relative">
      <div className="relative">
        <Input
          id={inputId}
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={termino}
          disabled={disabled}
          onChange={(e) => {
            setTermino(e.target.value)
            setAbierto(true)
          }}
          onFocus={() => setAbierto(true)}
          className="pr-9"
        />
        {cargando ? (
          <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : (
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        )}
      </div>

      {abierto && !disabled && flotante && (
        <DropdownFlotante anchorRef={contenedorRef} abierto anchoMinimo={360}>
          <div ref={listaRef}>{lista("max-h-72 w-full")}</div>
        </DropdownFlotante>
      )}
      {abierto && !disabled && !flotante && lista("absolute z-50 mt-1 max-h-72 w-full")}
    </div>
  )

  function lista(posicion: string) {
    return (
      <div className={`${posicion} overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md`}>
        {!puedeBuscar(termino, minCaracteres) && (
          <div className="px-2 py-3 text-sm text-muted-foreground">
            Escribe al menos {minCaracteres} caracteres, o {COMODIN_LISTAR} para ver las opciones disponibles.
          </div>
        )}
        {puedeBuscar(termino, minCaracteres) && !cargando && opciones.length === 0 && (
          <div className="px-2 py-3 text-sm text-muted-foreground">Sin resultados.</div>
        )}
        {!cargando &&
          opciones.map((opcion) => (
            <button
              key={opcion.id}
              type="button"
              onClick={() => {
                onSeleccionar(opcion)
                setTermino("")
                setAbierto(false)
              }}
              className="flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              <span>{opcion.etiqueta}</span>
              {opcion.subetiqueta && (
                <span className="text-xs text-muted-foreground">{opcion.subetiqueta}</span>
              )}
            </button>
          ))}
      </div>
    )
  }
}