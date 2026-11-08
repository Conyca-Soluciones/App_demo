"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"

// ---------------------------------------------------------------------------
// Confirmaciones de la app en vez de confirm() / prompt() del navegador (que
// se ven distinto en cada navegador, algunos los bloquean y no se pueden
// leer bien en el celular). Se usan igual que antes, pero con await:
//
//   if (!(await confirmar("¿Eliminar el rol?"))) return
//   const motivo = await pedirTexto("¿Por qué se devuelve?", { minimo: 3 })
//
// <ConfirmarHost /> va una sola vez en el layout de la app.
// ---------------------------------------------------------------------------

type OpcionesConfirmar = {
  titulo?: string
  boton?: string
  // Botón rojo para lo que borra o no tiene vuelta atrás.
  peligro?: boolean
}

type OpcionesTexto = OpcionesConfirmar & {
  etiqueta?: string
  valorInicial?: string
  // Mínimo de caracteres (sin espacios a los lados) para poder aceptar.
  minimo?: number
}

type Pedido =
  | { tipo: "confirmar"; mensaje: string; opciones: OpcionesConfirmar; resolver: (v: boolean) => void }
  | { tipo: "texto"; mensaje: string; opciones: OpcionesTexto; resolver: (v: string | null) => void }

let mostrar: ((p: Pedido) => void) | null = null

export function confirmar(mensaje: string, opciones: OpcionesConfirmar = {}): Promise<boolean> {
  // Sin el host montado (no debería pasar) se usa el del navegador.
  if (!mostrar) return Promise.resolve(window.confirm(mensaje))
  const abrir = mostrar
  return new Promise((resolver) => abrir({ tipo: "confirmar", mensaje, opciones, resolver }))
}

export function pedirTexto(mensaje: string, opciones: OpcionesTexto = {}): Promise<string | null> {
  if (!mostrar) return Promise.resolve(window.prompt(mensaje, opciones.valorInicial ?? ""))
  const abrir = mostrar
  return new Promise((resolver) => abrir({ tipo: "texto", mensaje, opciones, resolver }))
}

export function ConfirmarHost() {
  const [pedido, setPedido] = React.useState<Pedido | null>(null)
  const [texto, setTexto] = React.useState("")

  React.useEffect(() => {
    mostrar = (p) => {
      setTexto(p.tipo === "texto" ? (p.opciones.valorInicial ?? "") : "")
      setPedido((anterior) => {
        // Si quedaba uno abierto, se cancela: solo hay una pregunta a la vez.
        if (anterior) {
          if (anterior.tipo === "confirmar") anterior.resolver(false)
          else anterior.resolver(null)
        }
        return p
      })
    }
    return () => {
      mostrar = null
    }
  }, [])

  function cerrar(aceptar: boolean) {
    if (!pedido) return
    if (pedido.tipo === "confirmar") pedido.resolver(aceptar)
    else pedido.resolver(aceptar ? texto.trim() : null)
    setPedido(null)
  }

  const minimo = pedido?.tipo === "texto" ? (pedido.opciones.minimo ?? 1) : 0
  const faltaTexto = pedido?.tipo === "texto" && texto.trim().length < minimo

  return (
    <Dialog open={pedido != null} onOpenChange={(abierto) => !abierto && cerrar(false)}>
      <DialogContent className="sm:max-w-md">
        {pedido && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (!faltaTexto) cerrar(true)
            }}
          >
            <DialogHeader>
              <DialogTitle>{pedido.opciones.titulo ?? (pedido.tipo === "texto" ? "Escribe el motivo" : "Confirmar")}</DialogTitle>
              <DialogDescription className="whitespace-pre-line">{pedido.mensaje}</DialogDescription>
            </DialogHeader>
            {pedido.tipo === "texto" && (
              <div className="space-y-1">
                <label htmlFor="confirmar-texto" className="text-xs font-medium text-muted-foreground">
                  {pedido.opciones.etiqueta ?? "Motivo"}
                </label>
                <Textarea id="confirmar-texto" autoFocus rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} />
                {minimo > 1 && faltaTexto && texto.length > 0 && (
                  <p className="text-xs text-muted-foreground">Mínimo {minimo} caracteres.</p>
                )}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => cerrar(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                variant={pedido.opciones.peligro ? "destructive" : "default"}
                disabled={faltaTexto}
                autoFocus={pedido.tipo === "confirmar"}
              >
                {pedido.opciones.boton ?? "Aceptar"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
