import { redirect } from "next/navigation"

// Con sesión, la entrada a la app es la landing de proyectos. Sin sesión, el
// middleware ya redirige a /login antes de llegar acá.
export default function Home() {
  redirect("/inicio")
}
