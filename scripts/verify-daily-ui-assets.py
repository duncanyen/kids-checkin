"""Verify source identities and all unpatched sprite pixels; requires Pillow."""
import hashlib,json
from pathlib import Path
from PIL import Image,ImageChops
root=Path(__file__).resolve().parents[1]/'assets/farm/daily-missions'
m=json.loads((root/'v2/manifest.json').read_text())
sources={}
for name,meta in m['sources'].items():
 p=root/'source'/(name+'.png')
 assert hashlib.sha256(p.read_bytes()).hexdigest()==meta['sha256'],name+' source differs'
 sources[name]=Image.open(p).convert('RGBA')
for name,meta in m['assets'].items():
 original=sources[meta['source']].crop(meta['box']);actual=Image.open(root/'v2'/meta['file']).convert('RGBA')
 assert original.size==actual.size,name+' size differs'
 diff=ImageChops.difference(original,actual)
 for patch in meta['patches']:diff.paste((0,0,0,0),patch['target'])
 for box in meta.get('excluded_neighbor_boxes',[]):diff.paste((0,0,0,0),box)
 assert not any(band.getbbox() for band in diff.split()),name+' unpatched pixels differ'
print('PASS:',len(m['assets']),'source-derived PNGs; source SHA-256, bounds, alpha and unpatched pixels match T1/T2')
