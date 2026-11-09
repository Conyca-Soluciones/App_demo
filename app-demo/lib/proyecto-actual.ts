// Proyecto en el que se está trabajando. Se elige UNA sola vez, en la página
// de inicio (/inicio), y se guarda en esta cookie; el resto de pantallas lo
// leen (layout -> ProyectoProvider) en vez de tener su propio selector.
//
// La cookie solo dice CUÁL de los proyectos accesibles se está usando: no da
// acceso a nada (las políticas RLS de la base siguen decidiendo qué se ve), y
// el layout la ignora si el proyecto ya no es accesible para el usuario.

export const COOKIE_PROYECTO = "proyecto_actual"
export const DIAS_COOKIE_PROYECTO = 30

export type ProyectoLanding = {
  id: string
  // Número del proyecto (000–999): va en los códigos OC-001-0001, RQ-001-0001...
  numero?: number | null
  codigo: string | null
  nombre: string
  cliente: string | null
  ciudad: string | null
}

// Cómo se nombra un proyecto en pantalla: "001-900-CS-YOP-MALECÓN" (número y
// código; decisión del usuario, 2026-11-09: en CONYCA se usa el código, no el
// nombre). Sin código, el nombre.
export const numeroProyecto = (numero: number | null | undefined) =>
  numero != null ? String(numero).padStart(3, "0") : null

export const etiquetaProyecto = (p: Pick<ProyectoLanding, "numero" | "codigo" | "nombre">) => {
  const base = p.codigo || p.nombre
  const n = numeroProyecto(p.numero)
  return n ? `${n}-${base}` : base
}
