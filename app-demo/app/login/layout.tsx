import { Plus_Jakarta_Sans } from "next/font/google"

// Fuente propia SOLO del login (el resto de la app no cambia).
const fuente = Plus_Jakarta_Sans({ subsets: ["latin"], display: "swap" })

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <div className={fuente.className}>{children}</div>
}
