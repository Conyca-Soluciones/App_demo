"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { textoCuenta, type CuentaReqAdmin } from "@/lib/requisiciones-admin"
import { cuentasTerceroRequisicionAdmin } from "@/app/(app)/ayf/requisiciones-administrativas/actions"

// Cuentas bancarias de un tercero (no inactivas, número enmascarado), tal como
// las tiene Terceros: ahí vive la cuenta de contratistas y proveedores
// (20261222000000) y A&F la verifica. Solo lectura.
export function CuentasTercero({ terceroId }: { terceroId: string }) {
  const [carga, setCarga] = useState<{ terceroId: string; lista: CuentaReqAdmin[] | null; error: string | null } | null>(null)
  const actual = carga?.terceroId === terceroId ? carga : null

  useEffect(() => {
    let vigente = true
    cuentasTerceroRequisicionAdmin(terceroId)
      .then((lista: CuentaReqAdmin[]) => vigente && setCarga({ terceroId, lista, error: null }))
      .catch(
        (e) =>
          vigente &&
          setCarga({ terceroId, lista: null, error: e instanceof Error ? e.message : "No se pudieron cargar las cuentas." })
      )
    return () => {
      vigente = false
    }
  }, [terceroId])

  if (!actual) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Cargando cuentas…
      </p>
    )
  }
  if (actual.error) return <p className="text-sm text-destructive">{actual.error}</p>
  if (!actual.lista || actual.lista.length === 0) {
    return (
      <p className="text-sm text-amber-700">
        Sin cuenta bancaria en Terceros. Se puede pagar por PSE, o A&amp;F la registra y la verifica.
      </p>
    )
  }
  return (
    <ul className="space-y-0.5 text-sm">
      {actual.lista.map((c) => (
        <li key={c.id}>
          {textoCuenta(c)}{" "}
          <span className={c.verificada ? "text-emerald-700" : "text-amber-700"}>
            ({c.verificada ? "verificada" : "pendiente de verificar en A&F"})
          </span>
        </li>
      ))}
    </ul>
  )
}
