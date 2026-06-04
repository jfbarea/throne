import {
  Trophy,
  Sword,
  Users,
  CalendarBlank,
  Medal,
  ArrowRight,
  MagnifyingGlass,
  Check,
  Warning,
  Info,
  X,
} from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/Button";
import { Card, CardEyebrow, CardTitle } from "@/components/Card";
import { Badge, StatusBadge } from "@/components/Badge";
import { Divider } from "@/components/Divider";
import { Eyebrow } from "@/components/Eyebrow";
import { Input } from "@/components/Input";

// -----------------------------------------------------------------------
// Showcase page — sistema de diseño de throne
// This page demonstrates the visual language: palette, type, components.
// Will be replaced by the real landing/lobby in a future milestone.
// -----------------------------------------------------------------------

export default function Home() {
  return (
    <main
      className="min-h-screen"
      style={{ background: "var(--bg)", color: "var(--fg)" }}
    >
      {/* ── Hero / masthead ─────────────────────────────────────── */}
      <header
        className="sticky top-0 z-10 border-b px-4 sm:px-14"
        style={{
          background: "rgba(15, 14, 12, 0.85)",
          backdropFilter: "blur(12px)",
          borderColor: "var(--border)",
          height: "var(--bar-height)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div className="flex items-center gap-3">
          <span style={{ color: "var(--accent)", fontSize: 20 }}>✦</span>
          <span
            className="text-[20px] font-semibold leading-none"
            style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
          >
            throne
          </span>
        </div>
        <Eyebrow>Sistema de diseño</Eyebrow>
      </header>

      <div className="px-4 sm:px-14 py-12 space-y-20 max-w-[860px]">
        {/* ── Display hero ──────────────────────────────────────── */}
        <section>
          <Eyebrow as="div" className="mb-4">
            Liga privada de Warhammer 40.000
          </Eyebrow>
          <h1
            className="mb-4"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(2.5rem, 8vw, var(--type-display-size))",
              lineHeight: "1.05",
              fontWeight: 500,
              color: "var(--fg)",
            }}
          >
            throne
          </h1>
          <p
            className="max-w-[520px] mb-8"
            style={{ fontSize: "var(--type-h3-size)", color: "var(--fg-muted)" }}
          >
            Gestión de ligas de Warhammer 40.000 — emparejamientos round-robin,
            clasificación con desempates y playoffs de eliminatoria.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" icon={<Trophy weight="bold" size={16} />}>
              Entrar a la liga
            </Button>
            <Button variant="secondary" icon={<ArrowRight size={16} />} iconPosition="right">
              Ver clasificación
            </Button>
          </div>
        </section>

        <Divider ornamental />

        {/* ── Paleta de colores ─────────────────────────────────── */}
        <section>
          <Eyebrow as="div" className="mb-6">Paleta de colores</Eyebrow>
          <h2 className="mb-8" style={{ fontFamily: "var(--font-display)" }}>
            Ink · Paper · Brass
          </h2>

          {/* Ink scale */}
          <div className="mb-6">
            <Eyebrow className="mb-3 block">Ink — superficies y estructura</Eyebrow>
            <div className="flex gap-2 flex-wrap">
              {[
                { token: "ink-900", hex: "#0f0e0c", label: "900" },
                { token: "ink-800", hex: "#161410", label: "800" },
                { token: "ink-700", hex: "#1f1c17", label: "700" },
                { token: "ink-600", hex: "#2a261f", label: "600" },
                { token: "ink-500", hex: "#3d372e", label: "500" },
                { token: "ink-400", hex: "#5a5247", label: "400" },
              ].map(({ token, hex, label }) => (
                <div key={token} className="flex flex-col items-center gap-1">
                  <div
                    className="w-12 h-12 rounded-[2px] border border-[var(--border)]"
                    style={{ background: hex }}
                  />
                  <span className="text-[10px] text-[var(--fg-faint)] font-mono">
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Paper scale */}
          <div className="mb-6">
            <Eyebrow className="mb-3 block">Paper — texto sobre oscuro</Eyebrow>
            <div className="flex gap-2 flex-wrap">
              {[
                { hex: "#f5f0e6", label: "50" },
                { hex: "#e8e1d1", label: "100" },
                { hex: "#c9bfa8", label: "200" },
                { hex: "#9a907c", label: "300" },
              ].map(({ hex, label }) => (
                <div key={label} className="flex flex-col items-center gap-1">
                  <div
                    className="w-12 h-12 rounded-[2px] border border-[var(--border)]"
                    style={{ background: hex }}
                  />
                  <span className="text-[10px] text-[var(--fg-faint)] font-mono">
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Brass + semantic */}
          <div>
            <Eyebrow className="mb-3 block">Brass · Ember · Moss · Ash</Eyebrow>
            <div className="flex gap-2 flex-wrap">
              {[
                { hex: "#c9a66b", label: "brass" },
                { hex: "#b8924e", label: "press" },
                { hex: "#b85c3c", label: "ember" },
                { hex: "#6b7a4e", label: "moss" },
                { hex: "#7a8b99", label: "ash" },
              ].map(({ hex, label }) => (
                <div key={label} className="flex flex-col items-center gap-1">
                  <div
                    className="w-12 h-12 rounded-[2px] border border-[var(--border)]"
                    style={{ background: hex }}
                  />
                  <span className="text-[10px] text-[var(--fg-faint)] font-mono">
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <Divider ornamental />

        {/* ── Tipografía ────────────────────────────────────────── */}
        <section>
          <Eyebrow as="div" className="mb-6">Tipografía</Eyebrow>
          <h2 className="mb-8" style={{ fontFamily: "var(--font-display)" }}>
            Escala tipográfica
          </h2>

          <div className="space-y-6">
            {/* Display */}
            <div className="border-b pb-6" style={{ borderColor: "var(--border)" }}>
              <Eyebrow className="mb-2 block">Display · Cormorant Garamond 500</Eyebrow>
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "var(--type-display-size)",
                  lineHeight: "var(--type-display-line)",
                  fontWeight: 500,
                  color: "var(--fg)",
                }}
              >
                throne
              </span>
            </div>

            {/* H1 */}
            <div className="border-b pb-6" style={{ borderColor: "var(--border)" }}>
              <Eyebrow className="mb-2 block">H1 · 40px / 48px</Eyebrow>
              <h1>Clasificación general</h1>
            </div>

            {/* H2 */}
            <div className="border-b pb-6" style={{ borderColor: "var(--border)" }}>
              <Eyebrow className="mb-2 block">H2 · 28px / 36px</Eyebrow>
              <h2>Ronda 3 — emparejamientos</h2>
            </div>

            {/* H3 */}
            <div className="border-b pb-6" style={{ borderColor: "var(--border)" }}>
              <Eyebrow className="mb-2 block">H3 · 20px / 28px</Eyebrow>
              <h3>Resultado pendiente de confirmación</h3>
            </div>

            {/* Body */}
            <div className="border-b pb-6" style={{ borderColor: "var(--border)" }}>
              <Eyebrow className="mb-2 block">Body · Inter 16px / 26px</Eyebrow>
              <p style={{ maxWidth: "var(--measure-reading)" }}>
                Una liga round-robin genera todos los emparejamientos posibles
                entre participantes — cada jugador se enfrenta a todos los demás
                exactamente una vez. Cuando termina la fase regular, los mejores
                clasificados pasan a una eliminatoria de playoffs.
              </p>
            </div>

            {/* UI / Meta */}
            <div className="border-b pb-6" style={{ borderColor: "var(--border)" }}>
              <Eyebrow className="mb-2 block">UI · 14px &amp; Meta · 12px</Eyebrow>
              <div className="space-y-2">
                <p
                  style={{
                    fontSize: "var(--type-ui-size)",
                    lineHeight: "var(--type-ui-line)",
                    color: "var(--fg)",
                  }}
                >
                  Partida confirmada por ambos participantes
                </p>
                <p
                  style={{
                    fontSize: "var(--type-meta-size)",
                    lineHeight: "var(--type-meta-line)",
                    color: "var(--fg-faint)",
                  }}
                >
                  Última actualización hace 3 minutos · 12 partidas jugadas
                </p>
              </div>
            </div>

            {/* Mono / stat */}
            <div>
              <Eyebrow className="mb-2 block">Mono · JetBrains Mono &amp; Stat</Eyebrow>
              <div className="flex flex-wrap items-baseline gap-8">
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--type-ui-size)",
                    color: "var(--fg-muted)",
                  }}
                >
                  VP: 2.450 · Dif: +320 · PJ: 8
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "var(--type-stat-size)",
                    lineHeight: "var(--type-stat-line)",
                    fontWeight: 600,
                    color: "var(--accent)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  24 PTS
                </span>
              </div>
            </div>
          </div>
        </section>

        <Divider ornamental />

        {/* ── Botones ───────────────────────────────────────────── */}
        <section>
          <Eyebrow as="div" className="mb-6">Componentes — botones</Eyebrow>
          <h2 className="mb-8" style={{ fontFamily: "var(--font-display)" }}>
            Variantes y estados
          </h2>

          <div className="space-y-6">
            <div>
              <Eyebrow className="mb-3 block">Primary · brass sólido</Eyebrow>
              <div className="flex flex-wrap gap-3">
                <Button variant="primary" icon={<Trophy weight="bold" size={16} />}>
                  Ver clasificación
                </Button>
                <Button variant="primary">Confirmar resultado</Button>
                <Button variant="primary" size="sm" icon={<Check size={14} />}>
                  Guardar
                </Button>
              </div>
            </div>

            <div>
              <Eyebrow className="mb-3 block">Secondary · surface + border</Eyebrow>
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" icon={<CalendarBlank size={16} />}>
                  Programar partida
                </Button>
                <Button variant="secondary">Cancelar</Button>
                <Button variant="secondary" size="sm">
                  Compartir
                </Button>
              </div>
            </div>

            <div>
              <Eyebrow className="mb-3 block">Ghost · transparente</Eyebrow>
              <div className="flex flex-wrap gap-3">
                <Button variant="ghost" icon={<ArrowRight size={16} />} iconPosition="right">
                  Ver todos los resultados
                </Button>
                <Button variant="ghost">Volver</Button>
              </div>
            </div>

            <div>
              <Eyebrow className="mb-3 block">Danger · ember</Eyebrow>
              <div className="flex flex-wrap gap-3">
                <Button variant="danger" icon={<X size={16} />}>
                  Disputar resultado
                </Button>
              </div>
            </div>

            <div>
              <Eyebrow className="mb-3 block">Disabled</Eyebrow>
              <div className="flex flex-wrap gap-3">
                <Button variant="primary" disabled>
                  Acción no disponible
                </Button>
                <Button variant="secondary" disabled>
                  Sin acceso
                </Button>
              </div>
            </div>
          </div>
        </section>

        <Divider ornamental />

        {/* ── Inputs ────────────────────────────────────────────── */}
        <section>
          <Eyebrow as="div" className="mb-6">Componentes — inputs</Eyebrow>
          <h2 className="mb-8" style={{ fontFamily: "var(--font-display)" }}>
            Campos de texto
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Input
              label="Nombre del jugador"
              placeholder="Ej: Fran Barea"
              helper="Nombre que aparecerá en la clasificación"
            />
            <Input
              label="Buscar partida"
              placeholder="Buscar…"
              leadingIcon={<MagnifyingGlass size={16} />}
              helper="Filtra por jugador o fecha"
            />
            <Input
              label="Puntos de victoria"
              placeholder="0"
              type="number"
              error="El valor debe estar entre 0 y 5000"
            />
            <Input
              label="Código de acceso"
              placeholder="••••••"
              type="password"
              helper="Introduce el código que te dio el admin"
            />
          </div>
        </section>

        <Divider ornamental />

        {/* ── Cards ─────────────────────────────────────────────── */}
        <section>
          <Eyebrow as="div" className="mb-6">Componentes — cards</Eyebrow>
          <h2 className="mb-8" style={{ fontFamily: "var(--font-display)" }}>
            Default y featured
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card>
              <CardEyebrow>Partida · Ronda 3</CardEyebrow>
              <CardTitle>Fran vs. Alejandro</CardTitle>
              <div
                className="flex gap-3 text-[12px]"
                style={{ color: "var(--fg-faint)" }}
              >
                <span>Domingo 8 jun · 18:00</span>
                <span>·</span>
                <span>Warzone Valencia</span>
              </div>
            </Card>

            <Card featured>
              <CardEyebrow>Próxima partida</CardEyebrow>
              <CardTitle>Fran vs. Sergio</CardTitle>
              <div
                className="flex gap-3 text-[12px]"
                style={{ color: "var(--fg-faint)" }}
              >
                <span>Por programar</span>
              </div>
            </Card>

            <Card>
              <CardEyebrow>Clasificación · 1.ª posición</CardEyebrow>
              <CardTitle>Fran Barea</CardTitle>
              <div className="flex items-baseline gap-3 mt-2">
                <span
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "var(--type-stat-size)",
                    fontWeight: 600,
                    color: "var(--accent)",
                  }}
                >
                  24
                </span>
                <span
                  className="text-[12px]"
                  style={{ color: "var(--fg-faint)", fontFamily: "var(--font-mono)" }}
                >
                  PTS · 8V 0E 0D
                </span>
              </div>
            </Card>

            <Card featured>
              <CardEyebrow>Campeón de la liga</CardEyebrow>
              <CardTitle>Temporada I — Iron Hands</CardTitle>
              <div className="flex items-center gap-2 mt-2">
                <Medal size={20} style={{ color: "var(--accent)" }} />
                <span
                  className="text-[13px]"
                  style={{ color: "var(--fg-muted)" }}
                >
                  Fran Barea
                </span>
              </div>
            </Card>
          </div>
        </section>

        <Divider ornamental />

        {/* ── Badges ────────────────────────────────────────────── */}
        <section>
          <Eyebrow as="div" className="mb-6">Componentes — badges</Eyebrow>
          <h2 className="mb-8" style={{ fontFamily: "var(--font-display)" }}>
            Pills de estado
          </h2>

          <div className="space-y-5">
            <div>
              <Eyebrow className="mb-3 block">Estado de partida</Eyebrow>
              <div className="flex flex-wrap gap-2">
                <StatusBadge status="pendiente" />
                <StatusBadge status="programado" />
                <StatusBadge status="confirmado" />
                <StatusBadge status="disputado" />
              </div>
            </div>

            <div>
              <Eyebrow className="mb-3 block">Variantes semánticas</Eyebrow>
              <div className="flex flex-wrap gap-2">
                <Badge variant="brass" dot>Temporada I</Badge>
                <Badge variant="moss" dot>
                  <Check size={12} />
                  Validado
                </Badge>
                <Badge variant="ember" dot>
                  <Warning size={12} />
                  Disputado
                </Badge>
                <Badge variant="ash" dot>
                  <Info size={12} />
                  Pendiente
                </Badge>
                <Badge variant="neutral">Borrador</Badge>
              </div>
            </div>
          </div>
        </section>

        <Divider ornamental />

        {/* ── Iconos ────────────────────────────────────────────── */}
        <section>
          <Eyebrow as="div" className="mb-6">Iconografía — Phosphor Icons</Eyebrow>
          <h2 className="mb-8" style={{ fontFamily: "var(--font-display)" }}>
            Sistema de iconos
          </h2>
          <p className="mb-6" style={{ maxWidth: "var(--measure-reading)" }}>
            Phosphor Icons en peso regular para la UI predeterminada, bold para
            estados activos/seleccionados. Fill solo para indicadores de estado
            de fase. Duotono prohibido. Nunca emoji en el chrome del producto.
          </p>

          <div className="flex flex-wrap gap-6">
            {[
              { icon: <Trophy size={24} />, label: "Trophy" },
              { icon: <Sword size={24} />, label: "Sword" },
              { icon: <Users size={24} />, label: "Users" },
              { icon: <CalendarBlank size={24} />, label: "Calendar" },
              { icon: <Medal size={24} />, label: "Medal" },
              { icon: <MagnifyingGlass size={24} />, label: "Search" },
              { icon: <Check size={24} />, label: "Check" },
              { icon: <Warning size={24} />, label: "Warning" },
              { icon: <Info size={24} />, label: "Info" },
              { icon: <X size={24} />, label: "X" },
              { icon: <ArrowRight size={24} />, label: "Arrow" },
            ].map(({ icon, label }) => (
              <div
                key={label}
                className="flex flex-col items-center gap-2"
                style={{ color: "var(--fg-muted)" }}
              >
                {icon}
                <span
                  className="text-[10px]"
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: "var(--fg-faint)",
                  }}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>
        </section>

        <Divider ornamental />

        {/* ── Divider ───────────────────────────────────────────── */}
        <section>
          <Eyebrow as="div" className="mb-6">Componentes — separadores</Eyebrow>
          <h2 className="mb-8" style={{ fontFamily: "var(--font-display)" }}>
            Hairline · Ornamental
          </h2>
          <p className="mb-4">Separador de línea simple:</p>
          <Divider />
          <p className="mb-4">Separador ornamental con ✦ en brass:</p>
          <Divider ornamental />
        </section>

        {/* ── Footer ────────────────────────────────────────────── */}
        <footer
          className="border-t pt-8 pb-12 flex justify-between items-center"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex items-center gap-2">
            <span style={{ color: "var(--accent)" }}>✦</span>
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--type-ui-size)",
                color: "var(--fg-faint)",
              }}
            >
              throne · sistema de diseño
            </span>
          </div>
          <Eyebrow>Hito 3</Eyebrow>
        </footer>
      </div>
    </main>
  );
}
