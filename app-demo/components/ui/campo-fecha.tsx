"use client"

import * as React from "react"
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { hoyColombia } from "@/lib/fechas"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Campo de fecha que SIEMPRE se ve dd/mm/aaaa. El <input type="date"> del
// navegador usa el idioma del navegador (en inglés sale mm/dd/aaaa) y la
// página no lo puede cambiar. Este campo se escribe a mano (las barras se
// ponen solas) o se elige en el calendario del botón (propio: Safari no abre
// el calendario de un <input type="date"> escondido con showPicker).
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
  const [abierto, setAbierto] = React.useState(false)

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
        <Popover open={abierto} onOpenChange={setAbierto}>
          <PopoverTrigger
            type="button"
            tabIndex={-1}
            aria-label="Abrir calendario"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <CalendarDays className="h-4 w-4" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-3">
            <Calendario
              valor={value ?? ""}
              min={typeof min === "string" ? min : undefined}
              max={typeof max === "string" ? max : undefined}
              onElegir={(iso) => {
                setTexto(aTexto(iso))
                emitir(iso)
                setAbierto(false)
              }}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
const DIAS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"]
const iso = (a: number, m: number, d: number) =>
  `${String(a).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`

// Calendario de un mes (semana de lunes a domingo). Abre en el mes de la fecha
// elegida, o en el de hoy; los días fuera de min/max no se pueden elegir.
function Calendario({ valor, min, max, onElegir }: { valor: string; min?: string; max?: string; onElegir: (iso: string) => void }) {
  const hoy = hoyColombia()
  const base = /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : hoy
  const [mes, setMes] = React.useState({ a: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) - 1 })

  const primero = new Date(Date.UTC(mes.a, mes.m, 1)).getUTCDay() // 0 = domingo
  const vacios = (primero + 6) % 7
  const diasMes = new Date(Date.UTC(mes.a, mes.m + 1, 0)).getUTCDate()
  const mover = (delta: number) =>
    setMes(({ a, m }) => {
      const n = m + delta
      return { a: a + Math.floor(n / 12), m: ((n % 12) + 12) % 12 }
    })

  return (
    <div className="w-64 select-none">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" aria-label="Mes anterior" className="rounded p-1 hover:bg-muted" onClick={() => mover(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium">
          {MESES[mes.m]} {mes.a}
        </span>
        <button type="button" aria-label="Mes siguiente" className="rounded p-1 hover:bg-muted" onClick={() => mover(1)}>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
        {DIAS.map((d) => (
          <div key={d} className="py-1 font-medium text-muted-foreground">
            {d}
          </div>
        ))}
        {Array.from({ length: vacios }, (_, i) => (
          <div key={`v${i}`} />
        ))}
        {Array.from({ length: diasMes }, (_, i) => {
          const f = iso(mes.a, mes.m, i + 1)
          const fuera = (!!min && f < min) || (!!max && f > max)
          return (
            <button
              key={f}
              type="button"
              disabled={fuera}
              onClick={() => onElegir(f)}
              className={cn(
                "h-8 rounded text-sm",
                f === valor
                  ? "bg-primary text-primary-foreground"
                  : f === hoy
                    ? "border border-primary/50 hover:bg-muted"
                    : "hover:bg-muted",
                fuera && "cursor-not-allowed opacity-30 hover:bg-transparent"
              )}
            >
              {i + 1}
            </button>
          )
        })}
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          disabled={(!!min && hoy < min) || (!!max && hoy > max)}
          onClick={() => onElegir(hoy)}
          className="rounded px-2 py-1 text-xs text-primary hover:bg-muted disabled:opacity-40"
        >
          Hoy
        </button>
      </div>
    </div>
  )
}
