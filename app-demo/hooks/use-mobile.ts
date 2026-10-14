import * as React from "react"

const MOBILE_BREAKPOINT = 768
const CONSULTA = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function suscribir(avisar: () => void) {
  const mql = window.matchMedia(CONSULTA)
  mql.addEventListener("change", avisar)
  return () => mql.removeEventListener("change", avisar)
}

// Ancho de celular. En el servidor no hay ventana: false (escritorio), igual
// que antes antes de montar.
export function useIsMobile() {
  return React.useSyncExternalStore(
    suscribir,
    () => window.matchMedia(CONSULTA).matches,
    () => false
  )
}
