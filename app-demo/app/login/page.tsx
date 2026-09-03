"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [mostrarPassword, setMostrarPassword] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setCargando(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError("Email o contraseña incorrectos.")
      setCargando(false)
      return
    }

    router.push("/presupuestos")
    router.refresh()
  }

  return (
    <div className="flex min-h-screen">
    <div className="hidden w-1/2 flex-col items-center justify-center bg-[#2A85DB] text-white md:flex">        <div className="space-y-2 text-center">
          <p className="text-3xl font-semibold tracking-tight">CONYCA SOLUCIONES SAS</p>
          <p className="text-sm text-teal-100"></p>
        </div>
      </div>

      <div className="flex w-full items-center justify-center px-6 md:w-1/2">
        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-6">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">Bienvenido</h1>
            
          </div>

          <div className="space-y-3">
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            <div className="relative">
              <Input
                type={mostrarPassword ? "text" : "password"}
                placeholder="Contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setMostrarPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
              >
                {mostrarPassword ? "Ocultar" : "Mostrar"}
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={cargando}>
            {cargando ? "Entrando..." : "Entrar"}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            ¿No tienes cuenta? Pídesela a tu administrador
          </p>
        </form>
      </div>
    </div>
  )
}