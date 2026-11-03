from pathlib import Path
from PIL import Image,ImageDraw

folder=Path(__file__).resolve().parents[1]/'miniprogram/assets'
for name in ['ai','study','profile']:
    for active in [False,True]:
        image=Image.new('RGBA',(81,81),(0,0,0,0));draw=ImageDraw.Draw(image);color='#267fbb' if active else '#8193a1'
        if name=='ai':
            draw.rounded_rectangle((11,12,70,59),radius=10,outline=color,width=5)
            draw.line([(25,59),(23,72),(40,60)],fill=color,width=5)
            for x in [28,41,54]:draw.ellipse((x-2,32,x+2,36),fill=color)
        elif name=='study':
            draw.line([(10,16),(29,16),(40,24),(51,16),(71,16),(71,65),(51,65),(40,72),(29,65),(10,65),(10,16)],fill=color,width=5)
            draw.line((40,24,40,72),fill=color,width=4)
        else:
            draw.ellipse((27,10,55,38),outline=color,width=5)
            draw.arc((13,43,69,91),180,360,fill=color,width=5)
            draw.line((14,66,68,66),fill=color,width=5)
        image.save(folder/(name+('-on' if active else '')+'.png'))
print('Built original native tab icons.')
