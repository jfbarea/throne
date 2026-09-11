// Legacy route — multi-liga A2 (redirecciones-de-rutas-antiguas), spec §4.3,
// §5.10, §7.1 (continuidad en producción): an old bookmark to `/bracket`
// must keep working, landing the player on `/liga/<su-slug>/bracket`.
// See src/app/_lib/legacy-route-redirect.ts for the resolution rules.
import { redirectToOwnLeaguePage } from "@/app/_lib/legacy-route-redirect";

export default async function BracketRedirectPage() {
  await redirectToOwnLeaguePage("bracket");
}
