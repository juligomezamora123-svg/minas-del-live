# Minas del Live (versión real)

Tablero de premios con cuentas de jugadores, retiros, soporte y recuperación de clave por correo.
Funciona en Vercel (gratis para empezar) con una base de datos Postgres de Neon.

## Qué trae

- **Ingreso y registro** con usuario, correo y celular (de cualquier país). Claves cifradas con scrypt; sesión en cookie firmada.
- **Recuperar clave por correo:** código de 6 dígitos, vence en 10 minutos, sirve una vez, máximo 5 intentos.
- **Tres páginas:** Administrador (solo el dueño), Jugar (solo el dueño) y Vista del jugador (todos).
- **El reparto de premios vive en el servidor.** El jugador nunca recibe el reparto ni cuántos premios hay de cada tipo; solo ve las casillas que ya destapó.
- **Saldo en pesos:** al cobrar, los puntos se suman al saldo (valor del punto configurable).
- **Retiros** a cuenta bancaria, Bre-B, USDT (TRC-20), Nequi, Daviplata u otro; montos parciales; el dueño marca *pagado* o *rechazar* (rechazar devuelve el saldo). Los datos de pago se guardan **cifrados** (AES-256-GCM).
- **Comprobante** descargable de los retiros pagados.
- **Soporte:** mensajes de jugadores (y de quien no puede entrar) que llegan al Administrador, con respuesta y estado.
- **Mi cuenta:** datos, cambio de clave y historial de juegos, cada uno con su código único.
- Modo **Web completo**, pantalla completa y datos bancarios ocultos con ojito.

> El dinero **no se mueve solo**: "Pagado" es una marca que pones tú cuando ya hiciste la transferencia por fuera.

## Probarlo en tu computador

Necesitas Node.js 20 o más (ya lo tienes instalado).

```bash
npm install
npm run dev
```

Abre http://localhost:3000. Para crear la cuenta del dueño en tu computador:

```bash
# Windows PowerShell
$env:OWNER_SETUP_KEY="una-clave-que-tu-elijas"; npm run dev
```

Sin base de datos configurada usa una local (carpeta `.data`). Los correos no salen: el código de recuperación aparece en la consola.

Pruebas automáticas del servidor (16 pruebas): `npm test`.

## Subirlo a Vercel

1. **GitHub:** crea un repositorio privado y sube **solo esta carpeta** (`minas-del-live-web`).
   ```bash
   git init
   git add .
   git commit -m "Minas del Live"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/minas-del-live.git
   git push -u origin main
   ```
   (`.env`, `.data` y `node_modules` están en `.gitignore`: no se suben.)
2. **Vercel:** *Add New → Project*, elige el repositorio y pulsa **Deploy**.
3. **Base de datos:** en el proyecto de Vercel, *Storage → Create → Neon (Postgres)* y conéctala. Vercel crea sola la variable `DATABASE_URL`. Las tablas se crean solas la primera vez.
4. **Variables** (*Settings → Environment Variables*):

   | Variable | Qué poner |
   |---|---|
   | `SESSION_SECRET` | Un texto largo y aleatorio. Genera uno con `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
   | `OWNER_SETUP_KEY` | Una clave tuya (mínimo 8 caracteres) para crear la cuenta del dueño |
   | `RESEND_API_KEY` | La clave de API de tu cuenta de Resend |
   | `MAIL_FROM` | Ej: `Minas del Live <no-responder@tu-dominio.com>` |

   Después de agregarlas, vuelve a desplegar (*Deployments → Redeploy*).
5. **Correos:** en resend.com crea la cuenta y verifica tu dominio. Sin dominio verificado, Resend solo deja enviar correos a tu propia dirección, así que los jugadores no recibirían el código.
6. **Primer ingreso:** abre tu sitio, toca **🛠 Crear cuenta del dueño** y escribe la `OWNER_SETUP_KEY`. Esa opción desaparece cuando ya existe el dueño.

## Antes de usarlo con dinero real

- **Vercel Hobby no permite uso comercial.** Si cobras o pagas premios, necesitas el plan Pro.
- **Revisa la ley.** Rifas y juegos con premios en dinero están regulados en muchos países. Esto no lo resuelve el código.
- **No guardes SESSION_SECRET en ningún archivo del repositorio**, y no lo cambies después: invalida las sesiones y los datos de pago cifrados dejan de poder leerse. Si quieres una llave aparte para los datos de pago, define `DATA_KEY` (32 bytes en base64) desde el principio.
- El correo no se verifica al registrarse (solo se usa para recuperar la clave).
- No se pudo probar el despliegue en Vercel desde el computador donde se armó; el servidor y la pantalla sí se probaron en local. Si algo falla al desplegar, revisa *Deployments → Logs*.

## Estructura

```
api/[...path].js   punto de entrada de Vercel (una sola función)
lib/app.js         rutas de la API
lib/game.js        reglas del juego (reparto, puntos, bomba roja)
lib/security.js    claves, sesiones, cifrado, límite de intentos
lib/db.js          base de datos (Neon en Vercel, PGlite en local)
lib/email.js       envío de correos (Resend)
public/            la página (index.html, app.js, styles.css)
dev.js             servidor local
test/              pruebas automáticas
```
