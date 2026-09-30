import { redirect } from "next/navigation"

// La raíz lleva al landing de selección de proyecto (si no hay sesión, el
// middleware manda a /login antes de llegar acá).
export default function Home() {
  redirect("/inicio")
}
