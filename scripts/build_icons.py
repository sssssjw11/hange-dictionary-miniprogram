"""Original line icons, drawn on a shared 24-unit grid and antialiased."""
from pathlib import Path
from PIL import Image, ImageDraw

FOLDER=Path(__file__).resolve().parents[1]/'miniprogram/assets'
SCALE=4

def build(name, active):
    image=Image.new('RGBA',(96,96),(0,0,0,0));draw=ImageDraw.Draw(image)
    color='#2a8fe0' if active else '#949da8';stroke=7
    def box(values):return tuple(round(value*SCALE) for value in values)
    def line(points):draw.line([box(point) for point in points],fill=color,width=stroke,joint='curve')
    def ellipse(values):draw.ellipse(box(values),outline=color,width=stroke)
    def rounded(values,radius=2.5):draw.rounded_rectangle(box(values),radius=round(radius*SCALE),outline=color,width=stroke)
    if name=='search':
        ellipse((3.5,3.5,16.6,16.6));line([(15.2,15.2),(21.5,21.5)])
    elif name=='ai':
        rounded((3.5,3.5,20.5,17.8),3);line([(8,17.5),(7.7,22),(12.3,18)])
        for x in [8,12,16]:draw.ellipse(box((x-.55,9.6,x+.55,10.7)),fill=color)
    elif name=='bookmark':
        rounded((5,3,20,21),2.2);line([(9,3),(9,21)]);line([(12,8),(17,8)]);line([(12,12),(17,12)])
    elif name=='study':
        line([(3,4.5),(8.5,4.5),(12,7),(15.5,4.5),(21,4.5),(21,19.5),(15.5,19.5),(12,22),(8.5,19.5),(3,19.5),(3,4.5)]);line([(12,7),(12,22)])
    elif name=='profile':
        ellipse((8,2.5,16,10.5));draw.arc(box((4,13,20,29)),180,360,fill=color,width=stroke);line([(4,21),(20,21)])
    elif name=='history':
        ellipse((3,3,21,21));line([(12,7),(12,12),(16,14)])
    elif name=='menu':
        for y in [6,12,18]:line([(4,y),(20,y)])
    elif name=='mic':
        rounded((9,2.8,15,14.5),3);draw.arc(box((6,8,18,20)),0,180,fill=color,width=stroke);line([(12,20),(12,23)]);line([(8.5,23),(15.5,23)])
    elif name=='camera':
        rounded((2.7,6.5,21.3,21),2.6);line([(7,6.5),(9,3.5),(15,3.5),(17,6.5)]);ellipse((8,10,16,18))
    elif name=='headphones':
        draw.arc(box((4,3,20,20)),180,360,fill=color,width=stroke);rounded((3,11,7.5,21),2);rounded((16.5,11,21,21),2)
    elif name=='chevron':line([(9,5),(16,12),(9,19)])
    elif name=='translate':
        ellipse((3,3,21,21));ellipse((8,3,16,21));line([(3,12),(21,12)])
    elif name=='settings':
        for y,x in [(6,9),(12,16),(18,7)]:
            line([(3,y),(21,y)]);draw.ellipse(box((x-2,y-2,x+2,y+2)),fill=(255,255,255,255),outline=color,width=stroke)
    elif name=='backup':
        line([(12,3),(12,15)]);line([(8,11),(12,15),(16,11)]);line([(4,16),(4,21),(20,21),(20,16)])
    else:raise ValueError(name)
    target=FOLDER/(name+('-on' if active else '')+'.png')
    image.resize((81,81),Image.Resampling.LANCZOS).save(target,optimize=True)

FOLDER.mkdir(parents=True,exist_ok=True)
for name in ['search','ai','bookmark','study','profile','history','menu','mic','camera','headphones','chevron','translate','settings','backup']:
    for active in [False,True]:build(name,active)
print('Built 28 original line icons.')
