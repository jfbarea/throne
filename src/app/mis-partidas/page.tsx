// Legacy route — multi-liga A2 (redirecciones-de-rutas-antiguas), spec §4.3,
// §5.10, §7.1 (continuidad en producción): an old bookmark to `/mis-partidas`
// must keep working, landing the player on `/liga/<su-slug>/mis-partidas`.
// Also the target of `/` for a PLAYER session (src/app/page.tsx) — that
// entry point keeps working transitively through this redirect.
// See src/app/_lib/legacy-route-redirect.ts for the resolution rules.
import { redirectToOwnLeaguePage } from "@/app/_lib/legacy-route-redirect";

export default async function MisPartidasRedirectPage() {
  await redirectToOwnLeaguePage("mis-partidas");
}
