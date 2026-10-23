"""Author a blue-hour overcast HDR panorama for the rooftop's indirect lighting."""
from pathlib import Path
import math

ROOT=Path(__file__).resolve().parents[1]
out=ROOT.parents[1]/'output/cyber-rooftop/rain-sky.hdr'
width,height=1024,512

def rgbe(rgb):
    peak=max(rgb)
    if peak<1e-12:return bytes(4)
    mantissa,exponent=math.frexp(peak);scale=mantissa*256/peak
    return bytes([min(255,int(v*scale)) for v in rgb]+[exponent+128])

with out.open('wb') as f:
    f.write(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n')
    f.write(f'-Y {height} +X {width}\n'.encode())
    for y in range(height):
        elevation=math.cos((y+.5)/height*math.pi)
        horizon=math.exp(-(elevation/.29)**2)
        row=[]
        for x in range(width):
            angle=(x+.5)/width*math.tau
            cloud=.94+.04*math.sin(angle*4+elevation*15)+.02*math.sin(angle*11-elevation*37)
            # Wide soft sky illumination; no baked buildings or reference image.
            upper=max(0,elevation)
            rgb=[(.075+.10*horizon+.025*upper)*cloud,
                 (.12+.15*horizon+.04*upper)*cloud,
                 (.20+.20*horizon+.065*upper)*cloud]
            if elevation<0:rgb=[v*(.18+.42*horizon) for v in rgb]
            row.append(rgbe([v*.34 for v in rgb]))
        f.write(bytes([2,2,width>>8,width&255]))
        for channel in range(4):
            data=bytes(p[channel] for p in row)
            for start in range(0,width,127):
                chunk=data[start:start+127];f.write(bytes([len(chunk)]));f.write(chunk)
print(out)
