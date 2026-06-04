# throne

Aplicación web para gestionar una liga privada de **Warhammer 40.000** entre un grupo de amigos (10-20 jugadores). Formato: fase de liga round-robin seguida de playoffs de eliminatoria simple.

## Requisitos previos

- Node.js 20+ 
- npm 10+

## Arranque rápido

```bash
# 1. Instalar dependencias
npm install

# 2. Copiar variables de entorno y ajustarlas
cp .env.example .env

# 3. Crear la base de datos y aplicar migraciones
npx prisma migrate dev

# 4. Arrancar el servidor de desarrollo
npm run dev
```

La aplicación estará disponible en [http://localhost:3000](http://localhost:3000).

## Comandos disponibles

```bash
npm run dev          # Servidor de desarrollo Next.js
npm run build        # Build de producción
npm run start        # Arrancar build de producción
npm run lint         # Linting con ESLint
npm run format       # Formatear código con Prettier
npm run test         # Ejecutar tests unitarios con Vitest
npm run test:watch   # Tests en modo observador
npm run test:coverage # Tests con reporte de cobertura
npm run e2e          # Tests end-to-end con Playwright (arranca dev server en :3001)
npm run e2e:ui       # Tests e2e en modo UI interactivo
npm run e2e:report   # Ver último reporte HTML de e2e
```

> **Tests e2e:** Se ejecutan contra una base de datos dedicada (`e2e.db`) que se
> crea y destruye en cada ejecución. Las variables de entorno del e2e están
> embebidas en `playwright.config.ts` — no se lee ni modifica el `.env` real.

## Base de datos

```bash
npx prisma migrate dev        # Aplicar migraciones pendientes
npx prisma migrate dev --name nombre  # Crear y aplicar nueva migración
npx prisma studio             # Interfaz visual de la base de datos
npx prisma generate           # Regenerar el cliente TypeScript
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
    lib/                # Cliente DB, auth, esquemas Zod
    components/         # Componentes UI React
    generated/          # Cliente Prisma generado (no versionar)
  tests/                # Tests Vitest (unit) y Playwright (e2e)
```

## Variables de entorno

| Variable          | Descripción                                   |
|-------------------|-----------------------------------------------|
| `DATABASE_URL`    | Ruta al fichero SQLite, p.ej. `file:./dev.db` |
| `ADMIN_PASSCODE`  | Contraseña del administrador de la liga       |
| `SESSION_SECRET`  | Secreto para firmar cookies de sesión (32+ chars) |

## Documentación

| Documento | Descripción |
|-----------|-------------|
| [docs/guia-de-uso.md](docs/guia-de-uso.md) | Manual de usuario: flujo completo para admin y jugadores, con la terminología del dominio |
| [docs/configuracion.md](docs/configuracion.md) | Variables de entorno, comandos, configuración de la liga, base de datos y nota sobre despliegue |
| [docs/guion-de-pruebas.md](docs/guion-de-pruebas.md) | Walkthrough paso a paso para probar la app de extremo a extremo en local |

## Stack tecnológico

| Capa        | Tecnología                                |
|-------------|-------------------------------------------|
| Framework   | Next.js 16 (App Router) + TypeScript      |
| UI          | React + Tailwind CSS (mobile-first, dark) |
| ORM         | Prisma 7                                  |
| Base de datos | SQLite (dev) / Postgres-ready           |
| Tests       | Vitest (unit) + Playwright (e2e)          |
| Lint/format | ESLint + Prettier                         |
