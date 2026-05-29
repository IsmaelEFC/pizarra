# Configuración PWA - Iconos

Para que la aplicación sea instalable como PWA, necesitas crear los iconos PNG:

## Método 1: Usando herramientas en línea

1. Ve a: https://realfavicongenerator.net/
2. Sube el archivo `icon.svg`
3. Descarga los iconos generados
4. Renombra los archivos a:
   - `icon-192.png` (192x192)
   - `icon-512.png` (512x512)
5. Colócalos en la carpeta raíz del proyecto

## Método 2: Usando ImageMagick (si está instalado)

```bash
# Convertir SVG a PNG 192x192
magick icon.svg -resize 192x192 icon-192.png

# Convertir SVG a PNG 512x512
magick icon.svg -resize 512x512 icon-512.png
```

## Método 3: Usando herramientas de diseño

1. Abre `icon.svg` en Adobe Illustrator, Figma, o Inkscape
2. Exporta como PNG en tamaños:
   - 192x192 píxeles
   - 512x512 píxeles
3. Guarda como `icon-192.png` y `icon-512.png`

## Verificación

Una vez creados los iconos:
1. Abre la aplicación en un navegador (Chrome/Edge)
2. Abre DevTools (F12)
3. Ve a la pestaña "Application"
4. En "Manifest", verifica que los iconos se carguen correctamente
5. Deberías ver un botón "Instalar" en la barra de direcciones

## Notas

- Los iconos deben estar en la carpeta raíz del proyecto junto con index.html
- El service worker solo funcionará cuando la app se sirva por HTTPS o localhost
- Para probar en producción, necesitas un servidor HTTPS
