# CLAUDE.md

## Contexto del proyecto

**throne** es una aplicación web responsive para gestionar una liga privada de Warhammer 40.000 entre un grupo de amigos (10-20 jugadores). Formato: fase de liga round-robin + playoffs de eliminatoria simple.

Ver `SPEC.md` para la especificación completa y `plan/PLAN.md` para el plan de desarrollo por hitos.

## Stack tecnológico

| Capa            | Elección                                  |
|-----------------|-------------------------------------------|
| Framework       | Next.js 16 (App Router) + TypeScript      |
| UI              | React + Tailwind CSS (mobile-first, dark) |
| API             | Route Handlers + Server Actions           |
| Validación      | Zod                                       |
| ORM             | Prisma 7                                  |
| DB (dev)        | SQLite                                    |
| DB (futuro)     | Postgres                                  |
| Auth            | Cookie de sesión firmada + passcode       |
| Tests           | Vitest (unit/dominio) + Playwright (e2e)  |
| Lint/format     | ESLint + Prettier                         |

## Convenciones de código

- Idioma del código y comentarios: **inglés**
- Idioma de docs, README y mensajes: **español**
- Commits: formato convencional (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, …)
- Rama principal: `main`
- Dark mode hard-coded en CSS (sin `prefers-color-scheme`)

## Comandos frecuentes

```bash
# Instalar dependencias
npm install

# Desarrollo
npm run dev

# Tests
npm run test
npm run test:watch

# Build / lint
npm run build
npm run lint
npm run format

# Base de datos
npx prisma migrate dev
npx prisma studio
npx prisma generate
```

## Estructura del proyecto

```
throne/
  SPEC.md               # Especificación funcional y técnica
  plan/
    PLAN.md             # Plan de desarrollo por hitos
    _state.json         # Estado actual del desarrollo
  prisma/
    schema.prisma       # Esquema de datos
    migrations/         # Migraciones versionadas
  src/
    app/                # Rutas Next.js (App Router)
    server/             # Lógica de dominio pura (standings, pairings, bracket)
    lib/                # Cliente DB (db.ts), auth, esquemas Zod
    components/         # Componentes UI React
    generated/          # Cliente Prisma generado (no versionar)
  tests/                # Tests Vitest (unit) y Playwright (e2e futuros)
```

## Lo que Claude NO debe hacer sin confirmación explícita

- Push a ramas protegidas (`main`, `production`)
- Modificar archivos de configuración de entornos productivos
- Ejecutar migraciones destructivas (`DROP`, `DELETE` sin `WHERE`, `db reset`)
- Publicar paquetes
- Crear o destruir recursos cloud de pago

## Variables de entorno necesarias

| Variable          | Descripción                                        |
|-------------------|----------------------------------------------------|
| `DATABASE_URL`    | Ruta al fichero SQLite, p.ej. `file:./dev.db`     |
| `ADMIN_PASSCODE`  | Contraseña del administrador de la liga           |
| `SESSION_SECRET`  | Secreto para firmar cookies de sesión (32+ chars) |

Copiar `.env.example` a `.env` y ajustar los valores.

## Contexto adicional

- El modelo completo de datos (League, Player, Match, Result, Bracket, BracketSlot, AuditLog) se añade en el Hito 2 (`modelo-datos-prisma`).
- Toda la lógica de dominio (standings, pairings, bracket) vive en `src/server/` como funciones puras sin SQL propietario para mantener portabilidad SQLite↔Postgres.
- No hay entidad `Round` (eliminada por ADR-007). Los Match de liga cuelgan directamente de League.
