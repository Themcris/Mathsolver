from PIL import Image, ImageDraw, ImageFont

def create_icon(size, filename):
    bg_color = (11, 16, 22)      # #0b1016 (Fondo oscuro)
    accent_color = (25, 230, 189) # #19e6bd (Verde neón)

    img = Image.new('RGB', (size, size), bg_color)
    draw = ImageDraw.Draw(img)

    # Dibujar borde redondeado (estilo app moderna)
    margin = size * 0.08
    radius = size * 0.22
    stroke = int(size * 0.025)
    draw.rounded_rectangle([margin, margin, size-margin, size-margin], 
                           radius=radius, outline=accent_color, width=stroke)

    # Cargar una fuente
    try:
        font = ImageFont.truetype("/system/fonts/Roboto-Regular.ttf", int(size * 0.45))
    except IOError:
        font = ImageFont.load_default()

    # Texto: Raíz de x
    text = "√x"
    
    # Centrar el texto
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    x_pos = (size - text_width) / 2 - bbox[0]
    y_pos = (size - text_height) / 2 - bbox[1]

    draw.text((x_pos, y_pos), text, font=font, fill=accent_color)
    
    img.save(filename)
    print(f"✅ Generado: {filename}")

create_icon(512, 'icon-512.png')
create_icon(192, 'icon-192.png')
