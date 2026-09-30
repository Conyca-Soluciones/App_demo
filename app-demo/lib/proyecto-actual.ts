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
  codigo: string | null
  nombre: string
  cliente: string | null
  ciudad: string | null
}

// Cómo se nombra un proyecto en pantalla: "CÓDIGO — Nombre" o solo el nombre.
export const etiquetaProyecto = (p: Pick<ProyectoLanding, "codigo" | "nombre">) =>
  p.codigo ? `${p.codigo} — ${p.nombre}` : p.nombre
