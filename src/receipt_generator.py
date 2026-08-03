import sys
import os
import json
import base64
import io
from PIL import Image, ImageDraw, ImageFont, ImageFilter

def generate_thermal_receipt_base64(poem_text, logo_path=None):
    if not logo_path:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        logo_path = os.path.join(base_dir, 'logo.jpg')

    # 1. Load logo or fallback
    if os.path.exists(logo_path):
        try:
            raw_logo = Image.open(logo_path).convert('RGB')
            # Crop tight bounding box if not already cropped
            gray_logo = raw_logo.convert('L')
            mask = gray_logo.point(lambda p: 255 if p < 235 else 0)
            bbox = mask.getbbox() or (0, 0, raw_logo.width, raw_logo.height)
            cropped_logo = raw_logo.crop(bbox)
            
            # Thermal image transform for crisp outlines and non-blob dithered apple
            sharpened = cropped_logo.convert('L').filter(ImageFilter.UnsharpMask(radius=2, percent=180, threshold=2))
            def thermal_transform(p):
                if p > 210: return 255
                elif p < 100: return 0
                else: return int((p - 100) * (255 / 110))
            logo = sharpened.point(thermal_transform).convert('1', dither=Image.FLOYDSTEINBERG).convert('RGB')
        except Exception:
            logo = Image.new('RGB', (180, 180), (255, 255, 255))
    else:
        logo = Image.new('RGB', (180, 180), (255, 255, 255))

    RECEIPT_WIDTH = 384
    # Logo desactivado por el momento
    target_logo_width = 0
    target_logo_height = 0
    logo_resized = None

    # 2. Select System Fonts
    font_paths = [
        'C:\\Windows\\Fonts\\arial.ttf',
        'C:\\Windows\\Fonts\\segoeui.ttf',
        'C:\\Windows\\Fonts\\consola.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    ]
    font_path = None
    for fp in font_paths:
        if os.path.exists(fp):
            font_path = fp
            break

    try:
        if font_path:
            font_title = ImageFont.truetype(font_path, 20)
            font_body = ImageFont.truetype(font_path, 16)
            font_footer = ImageFont.truetype(font_path, 14)
            bold_path = font_path.replace('arial.ttf', 'arialbd.ttf').replace('segoeui.ttf', 'segoeuib.ttf')
            if os.path.exists(bold_path):
                font_bold = ImageFont.truetype(bold_path, 15)
            else:
                font_bold = ImageFont.truetype(font_path, 15)
        else:
            font_title = font_body = font_footer = font_bold = ImageFont.load_default()
    except Exception:
        font_title = font_body = font_footer = font_bold = ImageFont.load_default()

    # 3. Word Wrap
    def wrap_line(text, max_chars=32):
        words = text.split(' ')
        lines = []
        curr = ''
        for w in words:
            if len(curr + (' ' if curr else '') + w) <= max_chars:
                curr += (' ' if curr else '') + w
            else:
                if curr: lines.append(curr)
                curr = w
        if curr: lines.append(curr)
        return lines

    raw_lines = poem_text.split('\n')
    wrapped_lines = []
    for l in raw_lines:
        t = l.strip()
        if not t:
            wrapped_lines.append('')
        else:
            wrapped_lines.extend(wrap_line(t, 32))

    header_title = '🍎 UN POEMA PARA TI 🍎'
    footer_lines = [
        'Gracias por apoyar el arte.',
        '--------------------------------',
        'Encuentra más información en:',
        'www.elpecado.ar'
    ]

    padding_top = 10
    padding_between_logo_title = 10
    padding_between_title_poem = 12
    padding_between_poem_footer = 14
    padding_bottom = 15

    line_height_body = 22
    line_height_footer = 20

    h_poem = sum(line_height_body if l != '' else 10 for l in wrapped_lines)
    h_footer = sum(24 if l == 'elpecado.ar' else line_height_footer for l in footer_lines)

    total_height = (padding_top + target_logo_height + 
                    padding_between_logo_title + 26 + 
                    padding_between_title_poem + h_poem + 
                    padding_between_poem_footer + h_footer + 
                    padding_bottom)

    receipt = Image.new('RGB', (RECEIPT_WIDTH, total_height), (255, 255, 255))
    draw = ImageDraw.Draw(receipt)

    # 4. Draw Logo Centered (Si está activo)
    curr_y = padding_top
    if logo_resized:
        logo_x = (RECEIPT_WIDTH - target_logo_width) // 2
        receipt.paste(logo_resized, (logo_x, curr_y))
        curr_y += target_logo_height + padding_between_logo_title

    # 5. Draw Header Title
    bbox = draw.textbbox((0,0), header_title, font=font_title)
    tw = bbox[2] - bbox[0]
    draw.text(((RECEIPT_WIDTH - tw)//2, curr_y), header_title, fill=(0,0,0), font=font_title)
    curr_y += 26 + padding_between_title_poem

    # 6. Draw Poem Lines
    for line in wrapped_lines:
        if line == '':
            curr_y += 10
            continue
        bbox = draw.textbbox((0,0), line, font=font_body)
        tw = bbox[2] - bbox[0]
        draw.text(((RECEIPT_WIDTH - tw)//2, curr_y), line, fill=(0,0,0), font=font_body)
        curr_y += line_height_body

    curr_y += padding_between_poem_footer

    # 7. Draw Footer Lines
    for i, line in enumerate(footer_lines):
        if line == 'elpecado.ar':
            f = font_bold
            lh = 24
        elif line == 'Encuentra más información en:':
            f = font_footer
            lh = line_height_footer
        else:
            f = font_footer
            lh = line_height_footer
        bbox = draw.textbbox((0,0), line, font=f)
        tw = bbox[2] - bbox[0]
        draw.text(((RECEIPT_WIDTH - tw)//2, curr_y), line, fill=(0,0,0), font=f)
        curr_y += lh

    # 8. Convert to 1-bit monochrome thermal image
    monochrome = receipt.convert('1', dither=Image.FLOYDSTEINBERG).convert('RGB')
    
    buffer = io.BytesIO()
    monochrome.save(buffer, format='PNG')
    return base64.b64encode(buffer.getvalue()).decode('utf-8')

if __name__ == '__main__':
    try:
        if hasattr(sys.stdin, 'reconfigure'):
            sys.stdin.reconfigure(encoding='utf-8')
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8')

        input_data = sys.stdin.read()
        if input_data:
            parsed = json.loads(input_data)
            poem_text = parsed.get('poem', '')
        else:
            poem_text = '🍎 Un Poema 🍎'
        
        b64 = generate_thermal_receipt_base64(poem_text)
        sys.stdout.write(b64)
    except Exception as e:
        sys.stderr.write(f'Error generating thermal receipt: {str(e)}')
        sys.exit(1)
