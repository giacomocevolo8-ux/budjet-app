from PIL import Image, ImageDraw, ImageFont
def make(size, path, maskable=False):
    S = size * 4
    img = Image.new("RGB", (S, S))
    px = img.load()
    top, bot = (52, 199, 89), (16, 128, 62)
    d = ImageDraw.Draw(img)
    for y in range(S):
        t = y / S
        d.line([(0, y), (S, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    scale = 0.5 if maskable else 0.66
    font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", int(S * scale), index=1)
    bbox = d.textbbox((0, 0), "€", font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((S - w) / 2 - bbox[0], (S - h) / 2 - bbox[1]), "€", font=font, fill="white")
    img.resize((size, size), Image.LANCZOS).save(path, optimize=True)
make(180, "icons/apple-touch-icon.png")
make(192, "icons/icon-192.png")
make(512, "icons/icon-512.png")
make(512, "icons/icon-maskable-512.png", maskable=True)
