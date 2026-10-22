"""Deterministic original surface maps and signage for the rooftop scene."""
from pathlib import Path
import random, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/textures'
OUT.mkdir(parents=True, exist_ok=True)
rng = random.Random(2207)
FONT = 'C:/Windows/Fonts/msyh.ttc'

def surface(name, base, size=512, seams=False):
    image = Image.new('RGB', (size, size))
    px = image.load()
    for y in range(size):
        for x in range(size):
            n = rng.gauss(0, 5) + math.sin(x*.12)*1.5
            px[x,y] = tuple(max(0, min(255, int(c+n))) for c in base)
    d = ImageDraw.Draw(image)
    for _ in range(650):
        x,y = rng.randrange(size),rng.randrange(size)
        c = tuple(max(0, v-rng.randrange(5,28)) for v in base)
        d.line((x,y,x+rng.randrange(2,35),y+rng.randrange(-1,2)), fill=c)
    if seams:
        for y in range(0,size,128):
            d.line((0,y,size,y), fill=(8,13,19),width=3)
            d.line((0,y+3,size,y+3), fill=(62,70,76),width=1)
        for x in range(0,size,128):
            d.line((x,0,x,size), fill=(8,13,19),width=3)
        for x in range(7,size,128):
            for y in range(7,size,128):
                d.ellipse((x,y,x+3,y+3),fill=(106,116,125))
    image.save(OUT/f'{name}.png')

surface('steel',(85,91,93))
surface('paint',(129,125,107))
surface('roof',(44,53,62),seams=True)
surface('rubber',(57,66,77))

# Uneven wet concrete: perturb reflected light instead of producing a perfect mirror.
normal=Image.new('RGB',(512,512)); np=normal.load()
orm=Image.new('RGB',(512,512)); op=orm.load()
for y in range(512):
    for x in range(512):
        a=math.sin(x*.19+y*.08)*math.sin(y*.14-x*.03)
        b=math.sin(y*.31+x*.025)*math.sin(x*.12)
        np[x,y]=(int(128+a*24),int(128+b*24),248)
        op[x,y]=(255,int(125+35*a+20*b),105)
normal.save(OUT/'roof-normal.png');orm.save(OUT/'roof-orm.png')

for i, (label,col) in enumerate([
    ('自由港',(255,45,162)), ('未来医疗',(48,217,255)),
    ('夜市',(255,114,34)), ('义体改造',(86,177,255)),
    ('新生活',(255,61,178)), ('旅館',(49,235,221)),
]):
    im=Image.new('RGB',(256,1024),(6,12,25)); d=ImageDraw.Draw(im)
    d.rectangle((8,8,247,1015),outline=col,width=5)
    d.line((22,32,22,992),fill=col,width=2)
    font=ImageFont.truetype(FONT,161)
    for j,c in enumerate(label):
        d.text((46,90+j*190),c,font=font,fill=col,stroke_width=1)
    d.text((43,910),'24 / 7',font=ImageFont.truetype(FONT,39),fill=(180,215,231))
    im.save(OUT/f'sign-{i}.png')

# A luminous equipment display; all marks remain original and editable.
im=Image.new('RGB',(256,256),(2,22,30)); d=ImageDraw.Draw(im)
d.rounded_rectangle((8,8,248,248),20,outline=(35,237,255),width=6)
d.polygon([(42,118),(128,76),(218,115),(132,161)],outline=(60,255,255),width=6)
d.line([(42,118),(42,141),(132,186),(218,141),(218,115)],fill=(60,255,255),width=5)
d.line((132,161,132,186),fill=(60,255,255),width=5)
d.text((32,208),'BUILD / 04',font=ImageFont.truetype(FONT,23),fill=(74,224,241))
im.save(OUT/'tool-display.png')
print('Surface textures and signage written.')

# HUD frame art is generated separately from text; labels remain native editable UI.
def frame(name,w,h):
    s=2; im=Image.new('RGBA',(w*s,h*s)); d=ImageDraw.Draw(im)
    poly=[(12,0),(w-3,0),(w,3),(w,h-12),(w-12,h),(3,h),(0,h-3),(0,12)]
    poly=[(x*s,y*s) for x,y in poly]
    d.polygon(poly,fill=(4,17,27,214),outline=(88,134,147,230),width=2)
    d.line([(0,26),(26,0),(80,0)],fill=(35,233,255),width=6)
    d.line([(w*s-80,h*s-2),(w*s-26,h*s-2),(w*s-2,h*s-26)],fill=(255,36,166),width=6)
    im.resize((w,h),Image.Resampling.LANCZOS).save(OUT/f'{name}.png')
for name,w,h in [('hud-location',270,100),('hud-objectives',280,112),('hud-vitals',260,174),('hud-build',260,190),('hud-slot',92,94),('hud-hint',430,40)]: frame(name,w,h)

im=Image.new('RGB',(250,194),(7,20,30)); d=ImageDraw.Draw(im)
for x in range(-50,300,36):
    d.line((x,0,x+70,194),fill=(43,75,89),width=9)
    for y in range(0,194,28):
        d.rectangle((x+y*.36+8,y+5,x+y*.36+30,y+22),fill=(22,44,58),outline=(75,100,111))
for k in range(18):
    x,y=rng.randrange(250),rng.randrange(194)
    d.rectangle((x,y,x+5,y+2),fill=(242,33,146) if k%2 else (40,202,229))
d.rectangle((77,89,158,151),outline=(181,225,236),width=2)
d.rectangle((82,95,112,108),outline=(181,225,236),width=2)
d.rectangle((115,95,148,108),outline=(181,225,236),width=2)
d.polygon([(176,43),(186,53),(176,63),(166,53)],outline=(255,193,40),width=3)
im.save(OUT/'hud-map.png')

def iso(d,x,y,w,h,depth,color):
    a=(x,y); b=(x+w,y-h*.45); c=(x+w+depth,y-h*.45+depth*.4); e=(x+depth,y+depth*.4)
    d.polygon([a,b,c,e],fill=color,outline=(167,193,203,255),width=2)
    d.polygon([e,c,(c[0],c[1]+h),(e[0],e[1]+h)],fill=tuple(int(v*.65) for v in color[:3])+(255,),outline=(98,131,151,255),width=2)
    d.polygon([a,e,(e[0],e[1]+h),(x,y+h)],fill=tuple(int(v*.40) for v in color[:3])+(255,),outline=(98,131,151,255),width=2)
for k in range(8):
    im=Image.new('RGBA',(128,100)); d=ImageDraw.Draw(im)
    if k==0:
        iso(d,23,38,58,21,23,(181,123,40,255)); iso(d,56,63,15,28,12,(70,90,107,255)); d.rectangle((76,40,95,58),fill=(8,37,46),outline=(33,226,243),width=3)
    elif k==1:
        iso(d,49,45,16,38,15,(168,44,53,255)); d.ellipse((24,9,77,56),fill=(56,68,78),outline=(177,198,204),width=5); d.ellipse((41,26,61,42),fill=(151,42,41))
    elif k==2:
        iso(d,32,29,43,48,15,(97,121,136,255)); d.polygon([(47,36),(76,23),(76,59),(47,72)],fill=(5,43,54),outline=(36,211,239),width=3)
    elif k==3:
        iso(d,14,43,64,7,35,(157,183,198,255));
        for x,y in [(17,47),(79,22),(110,38),(49,60)]: d.rectangle((x,y,x+5,y+10),fill=(204,226,235))
    elif k==4:
        iso(d,32,25,51,52,14,(125,140,146,255)); d.line((62,24,62,73),fill=(44,62,73),width=4)
    elif k==5:
        iso(d,32,24,45,51,20,(50,67,82,255)); d.line((49,31,49,78),fill=(255,165,30),width=7); d.line((79,19,79,65),fill=(255,165,30),width=7)
    elif k==6:
        iso(d,27,35,48,40,20,(183,32,48,255)); d.rectangle((60,40,67,68),fill='white'); d.rectangle((51,49,76,57),fill='white')
    else:
        iso(d,42,26,33,51,17,(180,151,98,255)); d.ellipse((51,37,80,65),fill=(220,224,190),outline=(124,66,40),width=3)
    im.save(OUT/f'hud-item-{k+1}.png')
print('HUD frames, map and inventory art written.')
