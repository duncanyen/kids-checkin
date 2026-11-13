"""驗證素材來源、裁切尺寸、透明背景與未去背區域的像素沒有被重繪。"""
import hashlib,json
from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parents[1]
folder=root/'assets/farm/leaderboard';manifest=json.loads((folder/'manifest.json').read_text())
source=folder/manifest['source']['path'];assert hashlib.sha256(source.read_bytes()).hexdigest()==manifest['source']['sha256']
sheet=Image.open(source).convert('RGBA')
def pixels(image):return image.get_flattened_data() if hasattr(image,'get_flattened_data') else image.getdata()
for name,meta in manifest['assets'].items():
 actual=Image.open(folder/meta['file']).convert('RGBA');assert list(actual.size)==meta['size'],name
 if 'reusedFrom' in meta:
  expected=Image.open(root/meta['reusedFrom']).convert('RGBA');assert actual.tobytes()==expected.tobytes(),name
 else:
  x0,y0,x1,y1=meta['box'];assert 0<=x0<x1<=sheet.width and 0<=y0<y1<=sheet.height,name
  expected=sheet.crop(meta['box']);assert actual.size==expected.size,name
  assert any(pixel[3]==0 for pixel in pixels(actual)),name+' lacks transparent background'
  for pixel,original in zip(pixels(actual),pixels(expected)):
   if pixel[3]==255:assert pixel[:3]==original[:3],name+' opaque source pixels changed'
print('PASS:',len(manifest['assets']),'assets: source SHA-256, bounds, dimensions, transparency, opaque source pixels and reused blank badge')
