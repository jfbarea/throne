# Guía de despliegue — throne en Netlify + Turso

Esta guía explica cómo desplegar throne en un hosting serverless (Netlify) usando
**Turso** como base de datos remota. En desarrollo y tests se sigue usando SQLite
en fichero local — no se requiere Turso ni red para trabajar en local.

---

## 1. Instalar la CLI de Turso (solo para crear la DB y el token)

La CLI se usa **únicamente** para crear la base de datos y emitir el token; las
migraciones se aplican con un script de Node (sección 3), no con la CLI. Si prefieres,
puedes hacer la creación desde el panel web de Turso y saltarte este paso.

```bash
curl -sSfL https://get.tur.so/install.sh | bash
turso auth login
```

Comprueba que está disponible:

```bash
turso --version
```

---

## 2. Crear la base de datos en Turso

```bash
# Crear la base de datos (elige un nombre descriptivo)
turso db create throne-prod

# Obtener la URL de conexión (DATABASE_URL de producción)
turso db show throne-prod --url
# Salida de ejemplo: libsql://throne-prod-mi-org.turso.io

# Crear un token de autenticación (DATABASE_AUTH_TOKEN)
turso db tokens create throne-prod
# Guarda el token; solo se muestra una vez.
```

---

## 3. Aplicar las migraciones al remoto

Las migraciones están en `prisma/migrations/` en formato SQLite, que es compatible
con libSQL (el motor de Turso). No es necesario cambiar el dialecto.

Usa el script incluido en el repositorio. Lee `DATABASE_URL` y `DATABASE_AUTH_TOKEN`
del `.env` automáticamente (`node --env-file-if-exists=.env`); si esas variables ya
están en `.env` apuntando a Turso, basta con:

```bash
npm run db:migrate:turso
```

O bien pasándolas en línea (útil si tu `.env` apunta a SQLite local):

```bash
DATABASE_URL="libsql://throne-prod-mi-org.turso.io" \
DATABASE_AUTH_TOKEN="<tu-token>" \
npm run db:migrate:turso
```

El script (`scripts/migrate-turso.mjs`) usa `@libsql/client` directamente —el mismo
cliente que el adapter de Prisma— para autenticarse con el token, sin depender de la
CLI de Turso ni de sus flags. Aplica cada `migration.sql` en orden cronológico.
**Importante:** aplica *todas* las migraciones versionadas, no solo las nuevas. Las
migraciones de Prisma no son idempotentes (`CREATE TABLE`, `DROP TABLE`, etc.), así
que re-ejecutarlo sobre una base que ya las tiene fallará. Úsalo sobre una **base
Turso recién creada** (vacía) la primera vez; para migraciones posteriores, aplica a
mano solo el `migration.sql` nuevo, por ejemplo:

```bash
node --env-file-if-exists=.env -e "import('@libsql/client').then(async ({createClient})=>{const c=createClient({url:process.env.DATABASE_URL,authToken:process.env.DATABASE_AUTH_TOKEN});await c.executeMultiple(require('fs').readFileSync('prisma/migrations/<nueva>/migration.sql','utf8'));c.close();})"
```

> **Nota:** `db:migrate:turso` no sustituye a `prisma migrate dev`. El flujo de
> trabajo es el mismo de siempre: creates las migraciones en local con
> `npx prisma migrate dev`, las versionas en git y luego las aplicas al remoto
> con este script cuando vayas a desplegar.

---

## 4. Sembrar datos iniciales (opcional)

Si quieres partir de una liga de ejemplo, puedes ejecutar el seed apuntando a Turso:

```bash
DATABASE_URL="libsql://throne-prod-mi-org.turso.io" \
DATABASE_AUTH_TOKEN="<tu-token>" \
npm run seed
```

En producción real lo habitual es empezar con la base de datos vacía y que el
admin cree la liga desde la interfaz.

---

## 5. Variables de entorno en Netlify

En el panel de Netlify (**Site settings → Environment variables**) configura las cuatro
variables antes del primer despliegue. Deben estar disponibles tanto en **build** como
en **runtime** (Netlify las propaga automáticamente a ambas fases).

| Variable              | Valor de producción                                          |
|-----------------------|--------------------------------------------------------------|
| `DATABASE_URL`        | `libsql://throne-prod-mi-org.turso.io`                      |
| `DATABASE_AUTH_TOKEN` | Token obtenido con `turso db tokens create throne-prod`     |
| `ADMIN_PASSCODE`      | Contraseña del administrador de la liga (elige una segura)  |
| `SESSION_SECRET`      | Secreto aleatorio de al menos 32 caracteres                 |

Para generar un `SESSION_SECRET` seguro:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **Nota:** estas variables se necesitan en **runtime**, no en build. El proceso de
> build (`npm run build` + `prisma generate` en `postinstall`) no abre ninguna
> conexión a la base de datos y no requiere `DATABASE_URL` ni `DATABASE_AUTH_TOKEN`.
> Pero la app **fallará al arrancar** si no las encuentra, así que configúralas en
> Netlify antes del primer deploy. (Netlify las propaga a ambas fases de todos modos.)

---

## 6. Despliegue en Netlify

### 6.1 Conectar el repositorio

1. Entra en [app.netlify.com](https://app.netlify.com) y pulsa **Add new site →
   Import an existing project**.
2. Selecciona **GitHub** y autoriza el acceso al repositorio `throne`.
3. Netlify detectará que es un proyecto Next.js. **No hace falta configurar
   el directorio de publicación a mano**: el fichero `netlify.toml` del repositorio
   y el plugin oficial `@netlify/plugin-nextjs` se encargan del build.

### 6.2 Configuración de build (netlify.toml)

El repositorio ya incluye `netlify.toml` en la raíz:

```toml
[build]
  command = "npm run build"

[build.environment]
  NODE_VERSION = "20"

[[plugins]]
  package = "@netlify/plugin-nextjs"
```

- `NODE_VERSION = "20"` — Next.js 16 requiere Node 20+.
- `@netlify/plugin-nextjs` — pinneado en `devDependencies` (versión `5.15.11`);
  Netlify lo carga desde `node_modules` al instalar dependencias.
- No se configura `publish` manualmente; el plugin gestiona la salida de Next.js.

### 6.3 prisma generate — sin binario nativo

throne usa el generador `prisma-client` con el driver adapter `@prisma/adapter-libsql`
(libSQL, sin motor binario Rust). El hook `postinstall` del proyecto ejecuta
`prisma generate` automáticamente tras `npm install`, por lo que Netlify no necesita
ningún paso extra: el cliente se genera durante la fase de instalación, antes del build.

### 6.4 Orden recomendado para el primer despliegue

```
1. Provisionar Turso y obtener URL + token  (ver secciones 1-2)
2. Aplicar migraciones al remoto Turso      (ver sección 3)
3. Configurar las 4 variables de entorno en Netlify  (ver sección 5)
4. Conectar el repo en Netlify              (ver sección 6.1)
5. Netlify lanza el primer deploy:
   └─ npm install  →  postinstall: prisma generate
   └─ npm run build  →  Next.js build serverless (App Router)
```

Asegúrate de aplicar las migraciones a Turso **antes** del primer deploy en Netlify:
la app arrancará con la base de datos ya inicializada.

---

## 7. Build serverless — sin motor nativo de Prisma

throne usa el generador `prisma-client` con el driver adapter `@prisma/adapter-libsql`,
lo que elimina la dependencia del motor binario de Prisma (el Rust query engine).
Esto lo hace compatible de forma nativa con entornos serverless como Netlify
Functions o Vercel Edge, sin configuración adicional.

El hook `postinstall` ya se encarga de ejecutar `prisma generate` automáticamente
después de `npm install`, por lo que Netlify no necesita ningún paso extra de build
para generar el cliente.

---

## 8. Flujo completo de despliegue

```
1. Desarrollar en local con SQLite (file:./dev.db)
   └─ npx prisma migrate dev  →  nueva migración versionada en prisma/migrations/

2. Hacer commit y push a main

3. Aplicar la nueva migración al remoto Turso
   └─ DATABASE_URL=... DATABASE_AUTH_TOKEN=... npm run db:migrate:turso

4. Netlify detecta el push y despliega automáticamente
   └─ npm install  →  postinstall: prisma generate
   └─ npm run build  →  Next.js build serverless (App Router)
```

---

## Véase también

- [Documentación de Turso](https://docs.turso.tech/)
- [CLI de Turso](https://docs.turso.tech/cli/introduction)
- [Prisma Driver Adapters](https://www.prisma.io/docs/orm/overview/databases/driver-adapters)
- [Netlify Next.js Plugin](https://docs.netlify.com/frameworks/next-js/overview/)
