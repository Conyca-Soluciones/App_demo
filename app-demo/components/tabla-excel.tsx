"use client"

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"

// ---------------------------------------------------------------------------
// Tabla "tipo Excel" compartida (mismo diseño que /almacen/proveedores):
//   * table-fixed + ancho fijo por columna + truncate: los textos nunca se
//     montan; el texto completo queda en `title` (hover).
//   * encabezado azul fijo arriba; columnas `fija` fijas a la izquierda al
//     hacer scroll horizontal.
//   * con poco ANCHO DISPONIBLE (container query, no breakpoint de pantalla)
//     se vuelve una lista de tarjetas.
// Solo presentación: el filtrado, el orden y la paginación los hace quien la
// usa (así cada página conserva su propia lógica de datos).
// ---------------------------------------------------------------------------

export type ColumnaExcel<T> = {
  clave: string
  titulo: string
  ancho: number // px
  alinear?: "right" | "center"
  // Fija a la izquierda. Deben ser las PRIMERAS columnas.
  fija?: boolean
  // Absorbe el espacio sobrante cuando la tabla es más angosta que la
  // página (así el encabezado azul llega hasta el borde). `ancho` pasa a ser
  // su mínimo. Usar en UNA columna de texto largo (ej. Descripción).
  flexible?: boolean
  ordenable?: boolean // default true
  // Texto plano de la celda (para `title`, tarjeta y celda por defecto).
  texto: (fila: T) => string
  // Render propio (badge, botón...). Si no, se muestra `texto` truncado.
  celda?: (fila: T) => React.ReactNode
  claseCelda?: string
}

export type OrdenExcel = { clave: string; dir: "asc" | "desc" }

type Props<T> = {
  filas: T[]
  columnas: ColumnaExcel<T>[]
  claveFila: (fila: T) => string
  orden?: OrdenExcel | null
  onOrdenar?: (clave: string) => void
  onDobleClickFila?: (fila: T) => void
  tituloFila?: string // tooltip de la fila (ej. "Doble clic para editar")
  tarjeta: {
    titulo: (fila: T) => React.ReactNode
    subtitulo?: (fila: T) => React.ReactNode
    esquina?: (fila: T) => React.ReactNode // arriba a la derecha (badge, botón)
    campos: string[] // claves de `columnas` que se listan en la tarjeta
  }
  // Alto máximo de la tabla (scroll interno con encabezado fijo).
  claseAltoMax?: string
}

export function TablaExcel<T>({
  filas,
  columnas,
  claveFila,
  orden,
  onOrdenar,
  onDobleClickFila,
  tituloFila,
  tarjeta,
  claseAltoMax = "max-h-[calc(100svh-16rem)]",
}: Props<T>) {
  // Offset izquierdo de cada columna fija: suma de los anchos anteriores.
  const izquierda = new Map<string, number>()
  let acumulado = 0
  for (const c of columnas) {
    if (!c.fija) break
    izquierda.set(c.clave, acumulado)
    acumulado += c.ancho
  }
  const ultimaFija = [...izquierda.keys()].at(-1)
  const anchoTabla = columnas.reduce((acc, c) => acc + c.ancho, 0)
  const columnaPorClave = new Map(columnas.map((c) => [c.clave, c]))

  const alineacion = (a?: "right" | "center") =>
    a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left"

  return (
    <div className="@container">
      {/* ---------- Tabla (cuando hay espacio) ---------- */}
      <div className={`hidden overflow-auto rounded-lg border @3xl:block ${claseAltoMax}`}>
        {/* Ancho = todo el disponible, nunca menos que la suma de columnas
            (si no cabe, aparece el scroll horizontal). Con table-fixed, la
            columna sin ancho declarado (`flexible`) se queda con el sobrante. */}
        <table
          className="w-full table-fixed border-separate border-spacing-0 text-sm"
          style={{ minWidth: anchoTabla }}
        >
          <colgroup>
            {columnas.map((c) => (
              <col key={c.clave} style={c.flexible ? undefined : { width: c.ancho }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columnas.map((c) => {
                const izq = izquierda.get(c.clave)
                const activa = orden?.clave === c.clave
                const ordenable = onOrdenar && c.ordenable !== false
                const contenido = (
                  <>
                    <span className="truncate">{c.titulo}</span>
                    {ordenable &&
                      (activa ? (
                        orden!.dir === "asc" ? <ArrowUp className="size-3 shrink-0" /> : <ArrowDown className="size-3 shrink-0" />
                      ) : (
                        <ArrowUpDown className="size-3 shrink-0 opacity-40" />
                      ))}
                  </>
                )
                const claseJustificar =
                  c.alinear === "right" ? "justify-end" : c.alinear === "center" ? "justify-center" : ""
                return (
                  <th
                    key={c.clave}
                    scope="col"
                    aria-sort={activa ? (orden!.dir === "asc" ? "ascending" : "descending") : undefined}
                    style={izq !== undefined ? { left: izq } : undefined}
                    className={`sticky top-0 border-r border-b border-primary-foreground/15 bg-primary p-0 text-xs font-medium text-primary-foreground last:border-r-0 ${
                      izq !== undefined ? "z-30" : "z-20"
                    } ${c.clave === ultimaFija ? "shadow-[2px_0_0_0_var(--border)]" : ""}`}
                  >
                    {ordenable ? (
                      <button
                        type="button"
                        onClick={() => onOrdenar!(c.clave)}
                        className={`flex w-full items-center gap-1 px-3 py-2.5 ${claseJustificar}`}
                      >
                        {contenido}
                      </button>
                    ) : (
                      <div className={`flex w-full items-center gap-1 px-3 py-2.5 ${claseJustificar}`}>{contenido}</div>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {filas.map((fila) => (
              <tr
                key={claveFila(fila)}
                className={`group ${onDobleClickFila ? "cursor-pointer" : ""}`}
                onDoubleClick={onDobleClickFila ? () => onDobleClickFila(fila) : undefined}
                title={tituloFila}
              >
                {columnas.map((c) => {
                  const izq = izquierda.get(c.clave)
                  const texto = c.texto(fila)
                  return (
                    <td
                      key={c.clave}
                      style={izq !== undefined ? { left: izq } : undefined}
                      className={`h-9 max-w-0 border-r border-b bg-background p-0 align-middle last:border-r-0 group-hover:bg-muted ${
                        izq !== undefined ? "sticky z-10" : ""
                      } ${c.clave === ultimaFija ? "shadow-[2px_0_0_0_var(--border)]" : ""}`}
                    >
                      {c.celda ? (
                        <div className={`flex min-w-0 items-center px-3 py-1 ${alineacion(c.alinear)} ${
                          c.alinear === "right" ? "justify-end" : c.alinear === "center" ? "justify-center" : ""
                        } ${c.claseCelda ?? ""}`}>
                          {c.celda(fila)}
                        </div>
                      ) : (
                        <div
                          className={`truncate px-3 py-2 ${alineacion(c.alinear)} ${c.claseCelda ?? ""}`}
                          title={texto || undefined}
                        >
                          {texto || <span className="text-muted-foreground/60">—</span>}
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---------- Tarjetas (poco espacio) ---------- */}
      <ul className="grid items-start gap-3 @xl:grid-cols-2 @3xl:hidden">
        {filas.map((fila) => (
          <li key={claveFila(fila)} className="overflow-hidden rounded-lg border">
            <div className="flex items-start gap-2 border-b bg-muted/40 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium break-words">{tarjeta.titulo(fila)}</div>
                {tarjeta.subtitulo && <div className="text-xs text-muted-foreground">{tarjeta.subtitulo(fila)}</div>}
              </div>
              {tarjeta.esquina && <div className="shrink-0">{tarjeta.esquina(fila)}</div>}
            </div>
            <dl className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] text-sm">
              {tarjeta.campos.map((clave) => {
                const c = columnaPorClave.get(clave)
                if (!c) return null
                const texto = c.texto(fila)
                return (
                  <div key={clave} className="contents">
                    <dt className="truncate border-b px-3 py-2 text-xs text-muted-foreground">{c.titulo}</dt>
                    <dd className={`min-w-0 truncate border-b px-3 py-2 ${c.claseCelda ?? ""}`} title={texto || undefined}>
                      {c.celda ? c.celda(fila) : texto || <span className="text-muted-foreground/60">—</span>}
                    </dd>
                  </div>
                )
              })}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Paginación compartida (mismo estilo en todas las tablas).
export function PaginacionExcel({
  pagina,
  totalPaginas,
  onCambiar,
}: {
  pagina: number
  totalPaginas: number
  onCambiar: (pagina: number) => void
}) {
  if (totalPaginas <= 1) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
      <span className="tabular-nums">
        Página {pagina} de {totalPaginas}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onCambiar(Math.max(1, pagina - 1))}
          disabled={pagina === 1}
          className="rounded-md border px-3 py-1.5 hover:bg-muted disabled:opacity-40"
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={() => onCambiar(Math.min(totalPaginas, pagina + 1))}
          disabled={pagina === totalPaginas}
          className="rounded-md border px-3 py-1.5 hover:bg-muted disabled:opacity-40"
        >
          Siguiente
        </button>
      </div>
    </div>
  )
}
