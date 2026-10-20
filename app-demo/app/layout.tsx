import "./globals.css"

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // Extensiones del navegador (p. ej. Scribe, para grabar guías) agregan
    // atributos a <html> antes de que cargue React: sin esto sale el aviso de
    // hidratación. Solo aplica a los atributos de esta etiqueta.
    <html lang="es" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  )
}