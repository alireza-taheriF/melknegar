from PIL import Image, ImageOps
import numpy as np
def trans(path):
    im = Image.open(path).convert('RGB'); a = np.asarray(im).astype(np.float32)
    # alpha from distance to white
    d = 255 - a.min(axis=2)
    alpha = np.clip(d*1.6, 0, 255)
    # unpremultiply toward white
    al = np.maximum(alpha/255.0, 1e-3)[...,None]
    rgb = np.clip((a - 255*(1-al))/al, 0, 255)
    out = np.dstack([rgb, alpha]).astype(np.uint8)
    img = Image.fromarray(out, 'RGBA')
    bbox = img.getchannel('A').point(lambda v: 255 if v>20 else 0).getbbox()
    return img.crop(bbox)
mark = trans('/mnt/user-data/uploads/c791124f-image.jpg')
word = trans('/mnt/user-data/uploads/c23973ef-image.jpg')
def fit(img, h):
    w = round(img.width*h/img.height); return img.resize((w,h), Image.LANCZOS)
fit(mark, 256).save('public/img/mark.png', optimize=True)
fit(word, 160).save('public/img/wordmark.png', optimize=True)
# white version of wordmark for dark backgrounds: recolor navy pixels to white, keep teal
w = fit(word,160); arr = np.asarray(w).astype(np.float32)
r,g,b,al = arr[...,0],arr[...,1],arr[...,2],arr[...,3]
navy = (b-r) < 60  # navy-ish has low teal; teal has high g,b
lum = (r+g+b)/3
isnavy = (g < 110)
arr[isnavy,0]=255; arr[isnavy,1]=255; arr[isnavy,2]=255
Image.fromarray(arr.astype(np.uint8),'RGBA').save('public/img/wordmark-light.png', optimize=True)
def icon(size, pad, bg=(255,255,255,255)):
    c = Image.new('RGBA',(size,size),bg); inner = int(size*(1-2*pad))
    m = mark.copy(); m.thumbnail((inner,inner), Image.LANCZOS)
    c.alpha_composite(m, ((size-m.width)//2, (size-m.height)//2)); return c
icon(192,0.10).save('public/icons/icon-192.png'); icon(512,0.10).save('public/icons/icon-512.png')
icon(512,0.22).save('public/icons/maskable-512.png'); icon(180,0.12).convert('RGB').save('public/icons/apple-touch-icon.png')
icon(64,0.06).save('public/icons/favicon-64.png')
print(mark.size, word.size)
