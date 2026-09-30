"use server"

import { cookies } from "next/headers"
import { verProyectos } from "@/app/(app)/almacen/actions"
import { COOKIE_PROYECTO_ACTUAL, type ProyectoActual } from "@/lib/proyecto-actual"

// Proyectos a los que el usuario tiene acceso (misma regla que el resto de
// la app: directo, por grupo, o todos si es admin / ve_todos_proyectos).
export async function listarMisProyectos(): Promise<ProyectoActual[]> {
  return (await verProyectos()) ?? []
}

// Guarda (o borra, con null) el proyecto actual en la cookie. 30 días: al
// volver a iniciar sesión la landing lo muestra marcado como el último usado.
export async function elegirProyecto(proyecto: ProyectoActual | null) {
  const almacen = await cookies()
  if (!proyecto) {
    almacen.delete(COOKIE_PROYECTO_ACTUAL)
    return
  }
  almacen.set(
    COOKIE_PROYECTO_ACTUAL,
    encodeURIComponent(
      JSON.stringify({ id: proyecto.id, codigo: proyecto.codigo, nombre: proyecto.nombre })
    ),
    { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30 }
  )
}
