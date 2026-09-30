"use server"

import { cookies } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import {
  COOKIE_PROYECTO,
  DIAS_COOKIE_PROYECTO,
  type ProyectoLanding,
} from "@/lib/proyecto-actual"

// Proyectos que el usuario puede ver. Sin filtro propio: la política RLS de
// `proyectos` ya devuelve solo los accesibles (asignados, "todos" o, para
// Administrador, todos).
export async function listarMisProyectos(): Promise<ProyectoLanding[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("proyectos")
    .select("id, codigo, nombre, cliente, ciudad")
    .order("codigo", { ascending: false, nullsFirst: false })

  if (error) throw new Error(error.message)
  return data ?? []
}

export async function seleccionarProyecto(proyectoId: string): Promise<void> {
  const proyectos = await listarMisProyectos()
  if (!proyectos.some((p) => p.id === proyectoId)) {
    throw new Error("No tienes acceso a ese proyecto.")
  }

  const jar = await cookies()
  jar.set(COOKIE_PROYECTO, proyectoId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * DIAS_COOKIE_PROYECTO,
  })
}
