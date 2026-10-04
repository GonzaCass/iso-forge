"""Rebuild the desktop icon from the simple vector geometry in assets/icon.svg."""
from pathlib import Path
from PIL import Image, ImageDraw
root = Path(__file__).resolve().parent.parent
factor = 4
image = Image.new('RGBA', (256 * factor, 256 * factor), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((16, 16, 1008, 1008), radius=224, fill='#101725')
for points in [[(128,57),(199,95),(128,133),(57,95),(128,57)],
               [(57,126),(128,164),(199,126)], [(57,158),(128,196),(199,158)]]:
    draw.line([(x*factor,y*factor) for x,y in points], fill='#76e89e', width=11*factor, joint='curve')
    for x,y in points:
        r=5.5*factor
        draw.ellipse((x*factor-r,y*factor-r,x*factor+r,y*factor+r),fill='#76e89e')
image=image.resize((256,256),Image.Resampling.LANCZOS)
image.save(root/'assets/icon.png')
image.save(root/'assets/icon.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
