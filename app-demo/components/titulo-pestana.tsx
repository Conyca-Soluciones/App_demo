// Título de la pestaña del navegador: "Aprobación de pagos · CONYCA 360".
// Lo pone el encabezado de cada página (React lo sube al <head>, sirve en
// páginas de cliente y de servidor) para distinguir pestañas e historial.
export function TituloPestana({ titulo }: { titulo: string }) {
  return <title>{titulo ? `${titulo} · CONYCA 360` : "CONYCA 360"}</title>
}
