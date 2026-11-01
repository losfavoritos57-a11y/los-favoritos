# Los Favoritos

App instalable (PWA) de la pichanga: plantel, partidos, goles, notas, ranking y lista de la próxima pichanga.

- **Datos:** Supabase (plan gratis). Todo pasa por funciones que revisan las claves en el servidor (`supabase.sql`).
- **Publicación:** Vercel (plan gratis). Una vez al día Vercel llama a `/api/keepalive` para que Supabase no pause el proyecto.
- **Entrada:** clave del grupo para todos, PIN de 4 números por jugador y clave de administrador para Diego.

## Puesta en marcha

1. **Supabase:** crear un proyecto nuevo (región São Paulo). En *SQL Editor*, pegar todo `supabase.sql` y apretar *Run*.
2. **config.js:** copiar desde *Project Settings > API* la URL del proyecto y la clave pública (*publishable* o *anon*). Nunca la *secret* ni la *service_role*.
3. **Vercel:** importar este repositorio, sin cambiar nada de la configuración (no tiene paso de build).
4. Abrir la app: la primera vez pide crear la clave del grupo y la de administrador.

## Cambios

- Íconos: `npm run icons` vuelve a dibujarlos en `icons/`.
- El SQL se puede volver a correr completo sin perder datos.
- Si cambias archivos de la app, sube el número de `CACHE` en `sw.js` para que los celulares bajen la versión nueva.
