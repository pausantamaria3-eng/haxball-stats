# Haxball Futsal - Fase 2: Supabase

## 1. Crear el proyecto Supabase
1. Ve a https://supabase.com y crea un proyecto nuevo.
2. Anota la `Project URL` y la `anon public key` (Settings -> API).
3. La `service_role key` se usa solo en la Edge Function (no la pongas en el cliente).

## 2. Crear las tablas
1. En el dashboard: SQL Editor -> New query.
2. Pega el contenido de `supabase/schema.sql` y ejecuta.
3. Verifica que las tablas aparezcan en Table Editor.

## 2b. Repeticiones de goles (grabación nativa)
1. En el SQL Editor ejecuta también `supabase/replays.sql`. Crea el bucket público `replays` y añade a `match_goals` las columnas de contexto y `replay_url`.
2. Despliega la Edge Function actualizada (paso 3) y pega en el headless el `haxball-server.js` actualizado.
3. El servidor usa `room.startRecording()` / `room.stopRecording()` de HaxBall: guarda un archivo `.hbr2` real por cada gol (toda la jugada previa + 1,2 s después) y lo sube a `replays/<id-partido>/<indice-gol>.hbr2`.
4. En la web, cada gol tiene un botón **▶ Reproducir aquí** que carga el reproductor oficial de HaxBall incrustado en la propia página (copia de la versión 3 alojada en `docs/replayer/`, porque haxball.com no permite iframes). También puedes abrirlo en haxball.com con el enlace secundario y, desde el detalle del partido, `Ver ▶` abre la repetición ya cargada.
5. Los goles anteriores a este cambio no tienen grabación y no aparecen en la pestaña **Repeticiones**.

## 3. Desplegar la Edge Function
Instala la CLI de Supabase (https://supabase.com/docs/guides/cli) y ejecuta desde `C:\Users\ytpau\haxball-stats`:

```bash
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase functions deploy submit-match --no-verify-jwt
```

> La sala llama a `.../functions/v1/hyper-action`. Si desplegaste la función con
> ese nombre en el dashboard, pega el contenido de `index.ts` en esa función.
> Si usas la CLI, la carpeta `submit-match` crea una función con ese nombre:
> cambia `EDGE_FUNCTION_URL` en `haxball-server.js` a `/functions/v1/submit-match`
> o renombra la función desplegada a `hyper-action`.

Configura los secretos (el EDGE_SECRET lo eliges tú, una cadena larga aleatoria):

```bash
supabase secrets set EDGE_SECRET=tu_secreto_largo_aqui
```

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya los inyecta Supabase automáticamente.

## 4. Configurar el script del servidor
En `C:\Users\ytpau\haxball-server.js`, rellena:

```js
const SUPABASE_URL = "https://xxxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJ...";          // anon public
const EDGE_FUNCTION_URL = "https://xxxx.supabase.co/functions/v1/submit-match";
const EDGE_SECRET = "tu_secreto_largo_aqui"; // igual que el secret de la función
```

Pega el script en la página headless como siempre. Las partidas finalizadas se encolan y se envían cada 15 s. Usa `!sync` para forzar el envío.

## 5. Seguridad
- La `service_role` nunca sale del servidor de Supabase.
- El script solo envía el secret por HTTPS a la Edge Function.
- Las lecturas (plataforma web) se harán con la `anon key` + RLS (Fase 3).

## 6. Verificar
- Tras una partida, revisa los logs de la función: `supabase functions logs submit-match`.
- En Table Editor deberías ver la fila en `matches`, `match_participants` y `match_goals`.
- El ELO se actualiza en `players` y queda registrado en `elo_history`.

## 7. Verificación de cuenta (vincular web ↔ Haxball)
Para que los usuarios puedan vincular su cuenta web con su nombre de Haxball:

1. Ejecuta `supabase/verification.sql` en el SQL Editor.
2. Despliega las funciones `generate-code` y `verify-code` (mismo proceso que `submit-match`).
3. En el servidor Haxball, el comando `!conectar` genera un código de 6 dígitos válido por 5 minutos.
4. El usuario introduce el código en la página `verify.html` de la web.

## 8. Plataforma web (GitHub Pages)
La carpeta `docs/` contiene un sitio estático listo para GitHub Pages.

### Activar GitHub Pages
1. Crea un repositorio en GitHub y sube la carpeta `haxball-stats` (o al menos `docs/`).
2. En el repositorio: **Settings -> Pages**.
3. En "Source", selecciona **Deploy from a branch**.
4. Branch: `main` (o `master`), carpeta: `/docs`.
5. Guarda. En unos minutos el sitio estará en `https://TU_USUARIO.github.io/TU_REPO/`.

### Login opcional (Google / Discord)
1. En Supabase: **Authentication -> Providers**.
2. Activa **Google** y **Discord** y configura los client ID/secret (sigue la guía de Supabase para cada proveedor).
3. En **Authentication -> URL Configuration**, añade la URL de tu GitHub Pages en "Redirect URLs".
4. Ejecuta el SQL actualizado de `schema.sql` (incluye la columna `auth_user_id` y la política de vinculación).

### Páginas incluidas
- `index.html` — inicio con Top ELO y últimas partidas.
- `players.html` — ranking completo.
- `player.html?name=...` — perfil de jugador, con todos sus goles (minuto, xG/probabilidad, velocidad, asistencia y enlace a la repetición).
- `matches.html` — listado de partidas con paginación.
- `match.html?id=...` — detalle de partida.
- `login.html` — login opcional y vinculación de nombre.

Todas las tablas se ordenan haciendo clic en su cabecera (↑/↓ indican el sentido). La lista de repeticiones también se puede ordenar por fecha, minuto, probabilidad, velocidad o golazo.
