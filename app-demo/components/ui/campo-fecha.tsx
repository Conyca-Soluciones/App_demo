"use client"

import * as React from "react"
import { CalendarDays } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Campo de fecha que SIEMPRE se ve dd/mm/aaaa. El <input type="date"> del
// navegador usa el idioma del navegador (en inglés sale mm/dd/aaaa) y la
// página no lo puede cambiar. Este campo se escribe a mano (las barras se
// ponen solas) o se elige en el calendario del navegador con el botón.
//
// El valor sigue siendo "AAAA-MM-DD" (igual que el de <input type="date">) y
// onChange entrega { target: { value } }, así que reemplaza a
// <Input type="date"> sin cambiar quien lo usa. Mientras la fecha está a
// medio escribir o no existe (31/02/2026), el valor es "" (y al salir del
// campo se borra lo escrito).
// ---------------------------------------------------------------------------

const aTexto = (iso: string | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "")
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ""
}

function aIso(texto: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto)
  if (!m) return null
  const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const f = new Date(Date.UTC(a, mes - 1, d))
  if (a < 1900 || f.getUTCFullYear() !== a || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

// Solo números; las barras se ponen solas: "05102026" -> "05/10/2026".
function enmascarar(t: string) {
  const n = t.replace(/\D/g, "").slice(0, 8)
  if (n.length <= 2) return n
  if (n.length <= 4) return `${n.slice(0, 2)}/${n.slice(2)}`
  return `${n.slice(0, 2)}/${n.slice(2, 4)}/${n.slice(4)}`
}

type Props = Omit<React.ComponentProps<"input">, "value" | "onChange" | "type" | "defaultValue"> & {
  value: string
  onChange?: (e: { target: { value: string } }) => void
  // Clases del contenedor (el ancho: "w-44"); className va al campo.
  contenedorClassName?: string
  // Campo sin los estilos de <Input> (para formularios con su propia clase).
  sinEstilo?: boolean
}

export function CampoFecha({ value, onChange, contenedorClassName, sinEstilo, className, min, max, disabled, readOnly, onBlur, onFocus, ...props }: Props) {
  const [texto, setTexto] = React.useState(() => aTexto(value))
  const nativo = React.useRef<HTMLInputElement>(null)

  // Si el valor cambia desde afuera (limpiar filtros, cargar una edición),
  // se muestra; si es el mismo que ya está escrito, no se toca lo escrito.
  const [valorPrevio, setValorPrevio] = React.useState(value)
  if (value !== valorPrevio) {
    setValorPrevio(value)
    if ((aIso(texto) ?? "") !== (value ?? "")) setTexto(aTexto(value))
  }

  function emitir(iso: string) {
    if (iso !== (value ?? "")) onChange?.({ target: { value: iso } })
  }

  // Completa pero no existe (31/02/2026): en rojo mientras se escribe. Al salir
  // del campo, lo incompleto o inexistente se borra: lo que se ve es lo que vale.
  const invalido = texto.length === 10 && aIso(texto) == null
  const Campo = sinEstilo ? "input" : Input

  return (
    <div className={cn("relative w-full", contenedorClassName)}>
      <Campo
        {...props}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/aaaa"
        maxLength={10}
        value={texto}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={invalido || props["aria-invalid"] || undefined}
        className={cn(className, !readOnly && !disabled && "pr-9", invalido && "border-destructive")}
        onFocus={onFocus}
        onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
          if (texto !== "" && aIso(texto) == null) setTexto("")
          onBlur?.(e)
        }}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          const t = enmascarar(e.target.value)
          setTexto(t)
          emitir(t === "" ? "" : (aIso(t) ?? ""))
        }}
      />
      {!readOnly && !disabled && (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Abrir calendario"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
            onClick={() => {
              try {
                nativo.current?.showPicker()
              } catch {
                nativo.current?.focus()
              }
            }}
          >
            <CalendarDays className="h-4 w-4" />
          </button>
          {/* Solo para abrir el calendario del navegador; no se ve. */}
          <input
            ref={nativo}
            type="date"
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none absolute right-0 bottom-0 h-px w-px opacity-0"
            value={value ?? ""}
            min={min}
            max={max}
            onChange={(e) => {
              setTexto(aTexto(e.target.value))
              emitir(e.target.value)
            }}
          />
        </>
      )}
    </div>
  )
}
