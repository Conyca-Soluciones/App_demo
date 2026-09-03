"use client"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"

type PresupuestoItem = {
  codigo: string
  descripcion: string
  nivel: number
  unidad: string | null
  indPadre: number | null
  cantidad?: number
}

const inputClasses =
  "border-none bg-transparent px-0 shadow-none focus-visible:ring-1 focus-visible:ring-ring"

export function PresupuestoTable({
  data,
  onChange,
}: {
  data: PresupuestoItem[]
  onChange: (data: PresupuestoItem[]) => void
}) {
  function actualizarCampo(
    index: number,
    campo: keyof PresupuestoItem,
    valor: string
  ) {
    const copia = [...data]
    copia[index] = {
      ...copia[index],
      [campo]: campo === "cantidad" ? Number(valor) : valor,
    }
    onChange(copia)
  }

  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-32">Código</TableHead>
            <TableHead>Descripción</TableHead>
            <TableHead className="w-24">Unidad</TableHead>
            <TableHead className="w-28 text-right">Cantidad</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {data.map((item, index) => (
            <TableRow key={index}>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {item.codigo}
              </TableCell>

              <TableCell
                style={{ paddingLeft: `${(item.nivel - 1) * 20 + 16}px` }}
              >
                <Input
                  value={item.descripcion ?? ""}
                  onChange={(e) =>
                    actualizarCampo(index, "descripcion", e.target.value)
                  }
                  className={
                    item.nivel === 1
                      ? `${inputClasses} font-semibold`
                      : inputClasses
                  }
                />
              </TableCell>

              <TableCell>
                <Input
                  value={item.unidad ?? ""}
                  onChange={(e) =>
                    actualizarCampo(index, "unidad", e.target.value)
                  }
                  className={inputClasses}
                />
              </TableCell>

              <TableCell className="text-right">
                <Input
                  type="number"
                  value={item.cantidad ?? ""}
                  onChange={(e) =>
                    actualizarCampo(index, "cantidad", e.target.value)
                  }
                  className={`${inputClasses} text-right`}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}