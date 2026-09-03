"use client"

import { useEffect, useState, type RefObject } from "react"
import { createPortal } from "react-dom"

/**
 * Dropdown de sugerencias que se "escapa" de cualquier contenedor con
 * scroll u overflow que lo envuelva (ej. un diálogo con overflow-y-scroll).
 *
 * Un `position: absolute` normal queda recortado por el borde del
 * contenedor con overflow más cercano, aunque visualmente "debería"
 * verse más abajo en la pantalla -- es el comportamiento estándar del
 * navegador, no un bug del layout. La solución es renderizarlo por
 * fuera con un portal a document.body y calcularle la posición a mano
 * con `position: fixed`, que no respeta el overflow de ningún ancestro.
 */
export function DropdownFlotante({
  anchorRef,
  abierto,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>
  abierto: boolean
  children: React.ReactNode
}) {
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)

  useEffect(() => {
    if (!abierto || !anchorRef.current) {
      setPos(null)
      return
    }

    function recalcular() {
      const el = anchorRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }

    recalcular()
    // recalcular si se hace scroll (en la ventana o en el diálogo, que
    // también dispara el evento "scroll" con burbujeo capturado) o si
    // cambia el tamaño de la ventana, para que el dropdown no quede
    // "flotando" en un lugar viejo.
    window.addEventListener("scroll", recalcular, true)
    window.addEventListener("resize", recalcular)
    return () => {
      window.removeEventListener("scroll", recalcular, true)
      window.removeEventListener("resize", recalcular)
    }
  }, [abierto, anchorRef])

  if (!abierto || !pos || typeof document === "undefined") return null

  return createPortal(
    <div
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: pos.width,
        zIndex: 100,
      }}
    >
      {children}
    </div>,
    document.body
  )
}