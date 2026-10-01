import Link from "next/link"
import { Button } from "@/components/ui/button"

// Estado vacío de las pantallas que trabajan sobre un proyecto cuando todavía
// no se eligió ninguno.
export function SinProyecto({ mensaje }: { mensaje?: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-md rounded-lg border border-dashed p-10 text-center">
        <h2 className="text-lg font-semibold">Selecciona un proyecto</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {mensaje ?? "Esta pantalla trabaja sobre un proyecto. Elige con cuál quieres trabajar."}
        </p>
        <Link href="/inicio" className="mt-4 inline-block">
          <Button>Elegir proyecto</Button>
        </Link>
      </div>
    </div>
  )
}
