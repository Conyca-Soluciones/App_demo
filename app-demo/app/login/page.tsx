"use client"

import { useState } from "react"
import Image from "next/image"
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

    router.push("/inicio")
    router.refresh()
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Panel de marca: azul CONYCA con los triángulos del logo */}
      <div className="relative hidden w-1/2 overflow-hidden bg-gradient-to-br from-[#1f2f4d] via-[#2d4a7c] to-[#4266a2] text-white md:flex md:flex-col md:justify-between md:p-12">
        <svg
          aria-hidden
          viewBox="0 0 200 180"
          className="pointer-events-none absolute -right-16 -bottom-10 w-[520px] text-white opacity-[0.08]"
        >
          <polygon points="95,0 135,58 55,75" fill="currentColor" />
          <polygon points="140,70 195,170 85,170" fill="currentColor" />
          <polygon points="30,120 75,170 0,170" fill="currentColor" />
        </svg>
        <svg aria-hidden viewBox="0 0 200 180" className="h-12 w-12 text-white">
          <polygon points="95,0 135,58 55,75" fill="currentColor" />
          <polygon points="140,70 195,170 85,170" fill="currentColor" />
          <polygon points="30,120 75,170 0,170" fill="currentColor" />
        </svg>
        <p className="relative text-xs text-white/50">CONYCA Soluciones S.A.S.</p>
      </div>

      <div className="flex w-full items-center justify-center bg-gradient-to-b from-[#f4f7fc] to-background px-6 md:w-1/2">
        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-7">
          <Image
            src="/logo-conyca360.png"
            alt="CONYCA 360"
            width={1120}
            height={173}
            priority
            className="h-auto w-[260px]"
          />
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-[#1f2f4d] dark:text-foreground">Bienvenido</h1>
            <p className="text-sm text-muted-foreground">Ingresa con tu correo y contraseña.</p>
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

          <Button type="submit" className="h-10 w-full bg-[#4266a2] text-white hover:bg-[#365689]" disabled={cargando}>
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