# Guía de configuración — throne

Cómo preparar el entorno, configurar la liga y ejecutar los comandos del proyecto.

---

## Índice

1. [Requisitos previos](#1-requisitos-previos)
2. [Variables de entorno](#2-variables-de-entorno)
3. [Instalación y primer arranque](#3-instalación-y-primer-arranque)
4. [Comandos disponibles](#4-comandos-disponibles)
5. [Configuración de la liga](#5-configuración-de-la-liga)
6. [Base de datos](#6-base-de-datos)
7. [Tests](#7-tests)
8. [Nota sobre despliegue futuro](#8-nota-sobre-despliegue-futuro)

---

## 1. Requisitos previos

- **Node.js 20+** — se recomienda la última versión LTS.
- **npm 10+** — incluido con Node.js 20.

No se necesita ninguna base de datos externa: en desarrollo se usa SQLite, que es un fichero local creado automáticamente.

---

## 2. Variables de entorno

Hay **dos entornos, en dos ficheros distintos**, y ninguno se versiona:

| Fichero | Para qué | Quién lo carga |
|---------|----------|----------------|
| `.env` | Local: SQLite en fichero, sin red | Todo, por defecto: `npm run dev`, los tests, los scripts de Prisma |
| `.env.prod` | Producción: Turso | Nadie solo. Solo los scripts `:prod` (§4) |

La asimetría es deliberada: **si se te olvida el flag, te quedas en local**, nunca
apuntando a la liga de verdad por accidente. Producción hay que pedirla por su
nombre.

Para empezar, copia la plantilla:

```bash
cp .env.example .env
```

El `.env.example` tiene este contenido:

```
# Base de datos SQLite (ruta relativa al directorio prisma/)
DATABASE_URL="file:./dev.db"

# Passcode del administrador (se compara con hash en servidor)
ADMIN_PASSCODE="change-me"

# Secreto para firmar las cookies de sesión (mínimo 32 caracteres)
SESSION_SECRET="replace-with-a-long-random-secret-at-least-32-chars"
```

### `DATABASE_URL`

Ruta al fichero SQLite. El valor `file:./dev.db` crea la base de datos en `prisma/dev.db` (relativo al directorio `prisma/`). Puedes cambiar la ruta si quieres usar un nombre o ubicación distinta.

Para producción con Postgres, cambia este valor por una URL de conexión Postgres estándar (`postgresql://user:password@host:5432/dbname`). El resto de la app no necesita cambios gracias al diseño Postgres-ready (ADR-002).

### `ADMIN_PASSCODE`

La contraseña que usa el administrador de la liga para entrar en `/login`. Cámbiala por una clave que solo tú conozcas. Es texto plano en el `.env`; el servidor la compara de forma segura con comparación en tiempo constante.

Ejemplo de valor seguro: elige una frase o cadena de al menos 12 caracteres que no uses en otro sitio.

### `SESSION_SECRET`

Secreto criptográfico para firmar las cookies de sesión. **Mínimo 32 caracteres.** Si este secreto cambia, todas las sesiones activas quedan invalidadas (los usuarios tendrán que volver a hacer login).

Genera un valor aleatorio con:

```bash
openssl rand -hex 32
```

Copia la salida (64 caracteres hexadecimales) y úsala como valor de `SESSION_SECRET`.

> **Seguridad:** el fichero `.env` nunca debe versionarse ni compartirse. Está incluido en `.gitignore`. El `.env.example` sí se versiona y sirve de plantilla sin valores reales.

---

## 3. Instalación y primer arranque

```bash
# 1. Instalar dependencias (también ejecuta prisma generate automáticamente)
npm install

# 2. Copiar y editar las variables de entorno
cp .env.example .env
# Edita .env y cambia ADMIN_PASSCODE y SESSION_SECRET

# 3. Crear la base de datos y aplicar migraciones
npx prisma migrate dev

# 4. (Opcional) Cargar datos de ejemplo
npm run seed

# 5. Arrancar el servidor de desarrollo
npm run dev
```

La aplicación estará disponible en [http://localhost:3000](http://localhost:3000).

---

## 4. Comandos disponibles

Estos son los scripts reales definidos en `package.json`:

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Arranca el servidor de desarrollo Next.js en [http://localhost:3000](http://localhost:3000) |
| `npm run build` | Genera el build de producción optimizado |
| `npm run start` | Arranca el servidor con el build de producción (requiere `npm run build` previo) |
| `npm run lint` | Linting con ESLint |
| `npm run format` | Formatea todo el código con Prettier |
| `npm run test` | Ejecuta los tests unitarios con Vitest (una pasada) |
| `npm run test:watch` | Tests unitarios en modo observador (útil durante el desarrollo) |
| `npm run test:coverage` | Tests unitarios con reporte de cobertura |
| `npm run seed` | Carga los datos de ejemplo en la base de datos (idempotente) |
| `npm run e2e` | Tests end-to-end con Playwright (arranca un servidor en `:3001`, usa `e2e.db` aislada) |
| `npm run e2e:ui` | Tests e2e en modo UI interactivo de Playwright |
| `npm run e2e:report` | Abre el último reporte HTML de los tests e2e |

### Comandos contra producción

Todos leen `.env.prod` (nunca `.env`) y avisan con un banner amarillo de a qué base
apuntan antes de arrancar. Si `.env.prod` no existe, no tiene token, o su
`DATABASE_URL` no es una URL `libsql://`, se niegan a ejecutar: un script `:prod`
que apunte en silencio a otra cosa es peor que uno que falle.

| Comando | Descripción |
|---------|-------------|
| `npm run dev:prod` | Servidor de desarrollo **contra la base de producción**. Para reproducir un fallo con datos reales; lo que escribas lo ve la liga |
| `npm run seed:prod` | Carga los datos de ejemplo en producción (idempotente, pero pisa nombres y facciones de los jugadores del seed) |
| `npm run studio:prod` | Prisma Studio sobre producción |
| `npm run db:migrate:turso` | Aplica a producción las migraciones que le falten (ver `docs/despliegue.md` §3) |

### Comandos de Prisma (base de datos)

| Comando | Descripción |
|---------|-------------|
| `npx prisma migrate dev` | Aplica migraciones pendientes y regenera el cliente TypeScript |
| `npx prisma migrate dev --name nombre` | Crea una nueva migración con ese nombre y la aplica |
| `npx prisma studio` | Abre la interfaz visual de la base de datos en el navegador |
| `npx prisma generate` | Regenera el cliente TypeScript sin aplicar migraciones |

---

## 5. Configuración de la liga

La configuración se gestiona desde el panel de admin en `/admin/liga`. Los campos configurables son:

### Sistema de puntuación

| Campo | Por defecto | Descripción |
|-------|-------------|-------------|
| `pointsWin` | 3 | Puntos de liga por victoria |
| `pointsDraw` | 1 | Puntos de liga por empate |
| `pointsLoss` | 0 | Puntos de liga por derrota |

### Rondas mensuales

| Campo | Por defecto | Descripción |
|-------|-------------|-------------|
| `matchesPerRound` | 2 | Partidas que cada jugador debe jugar por ronda. El número de rondas se **deriva** de esto y del número de jugadores; no se configura directamente |
| `startMonth` | — (vacío) | Mes de arranque de la liga. De él se deriva la fecha de cierre de cada ronda (el último día de cada mes sucesivo). Sin él, no se pueden generar emparejamientos |

Cambiar `matchesPerRound` con la liga ya en marcha **recalcula el reparto** de las partidas que aún no tienen resultado entre las rondas todavía abiertas; las rondas cerradas y sus resultados no se tocan. El admin puede editar la fecha de cierre de una ronda concreta desde `/admin/rondas` sin que eso reasigne ninguna partida.

### Bonus (opcionales, pensados para W40k)

| Campo | Por defecto | Descripción |
|-------|-------------|-------------|
| `bonusEnabled` | false | Activa o desactiva los bonus |
| `bonusMarginThreshold` | 20 | Diferencia de VP para el bonus de masacre; se otorga al ganador si supera al rival por este margen o más. No aplica en empates (no hay ganador) |
| `bonusMinVP` | 40 | VP mínimos para el bonus por jugar agresivo; se otorga a cualquier jugador que alcance este umbral, independientemente del resultado (aplica en victoria, derrota y empate) |

Los bonus se calculan y almacenan en el momento de reportar cada resultado (`Result.bonusHome` / `Result.bonusAway`). Cambiar la config después no altera resultados ya registrados.

### Playoffs

| Campo | Por defecto | Descripción |
|-------|-------------|-------------|
| `playoffSize` | 4 | Número de jugadores que clasifican a playoffs |

El `playoffSize` debe ser menor o igual al número de jugadores activos. Si no es potencia de 2, los mejores seeds reciben bye en primera ronda.

### Tiebreakers (criterios de desempate)

El orden de desempate es configurable. Los criterios disponibles y su orden por defecto:

1. **Puntos de liga** (desc) — `POINTS`
2. **Diferencia de VP** (`VP+ - VP-`, desc) — `VP_DIFF`
3. **VP a favor** (desc) — `VP_FOR`
4. **Enfrentamiento directo** (head-to-head entre los empatados) — `HEAD_TO_HEAD`
5. **Menor número de derrotas** — `LOSSES`
6. **Orden de alta** (por `id`, siempre determinista) — `ID_ORDER`

En la UI puedes reordenarlos con las flechas arriba/abajo. El orden se guarda en la columna `tiebreakers` de la tabla `League`.

---

## 6. Base de datos

### Estructura de ficheros

- `prisma/schema.prisma` — esquema de datos (modelos, enums, relaciones).
- `prisma/migrations/` — migraciones versionadas (en git).
- `prisma/dev.db` — base de datos SQLite de desarrollo (no versionada, en `.gitignore`).
- `prisma/seed.ts` — script de datos de ejemplo.

### Datos de ejemplo (seed)

El seed crea:
- **1 liga** llamada "Liga Warhammer 40K — Capítulo Hierro" (temporada "2026 Primavera"), en estado `SETUP`, con `playoffSize=4` y `bonusEnabled=true`.
- **12 jugadores** con facciones variadas de W40k. El primero (`Comisario Valdris`, Astra Militarum) tiene rol `ADMIN`; el resto son `PLAYER`.
- **Passcode de todos los jugadores del seed: `1234`**. En producción cada jugador tiene su passcode único generado por la app.

El seed es idempotente: ejecutarlo varias veces no duplica datos.

```bash
npm run seed
```

### Backup

Con SQLite, hacer un backup es copiar el fichero `prisma/dev.db`:

```bash
cp prisma/dev.db prisma/dev.db.backup
```

---

## 7. Tests

### Tests unitarios (Vitest)

```bash
npm run test          # pasada única
npm run test:watch    # modo observador
npm run test:coverage # con reporte de cobertura
```

Los tests unitarios cubren la lógica de dominio pura: generación de emparejamientos, cálculo de standings, construcción del bracket, cálculo de bonus, validaciones Zod, helpers de auth, etc.

### Tests end-to-end (Playwright)

```bash
npm run e2e           # recorrido completo en headless
npm run e2e:ui        # modo UI interactivo (útil para depurar)
npm run e2e:report    # ver el último reporte HTML
```

Los tests e2e usan una base de datos aislada (`e2e.db`) que se crea y destruye en cada ejecución. Las credenciales están embebidas en `playwright.config.ts`. El fichero `.env` real no se lee ni modifica durante los e2e.

---

## 8. Nota sobre despliegue futuro

Actualmente throne funciona en local con SQLite, que es cero infraestructura: un fichero, sin servidor de base de datos. Es la opción correcta para 10-20 personas.

El diseño es **Postgres-ready** (ADR-002): toda la lógica de negocio (standings, emparejamientos, bracket, bonus) está en funciones puras en `src/server/`, sin SQL específico de SQLite. Para mover a Postgres:

1. Cambiar `DATABASE_URL` a una URL de conexión Postgres.
2. Cambiar el adapter de Prisma en `src/lib/db.ts` a `@prisma/adapter-pg` (o eliminar el adapter si se usa el driver nativo de Prisma 7 con Postgres).
3. Ejecutar `npx prisma migrate deploy` en el entorno destino.

No se necesitan cambios en la lógica de negocio, las vistas ni los tests unitarios.

El despliegue cloud (Vercel, VPS, contenedor) y el pipeline de CI/CD quedan fuera del MVP y se abordarán como decisión futura.
