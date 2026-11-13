"""Extract the supplied T1/T2 PNGs; no AI generation or substitute icons.
Pillow is needed only for this offline extraction, not for the game runtime.
"""
import argparse, hashlib, json
from pathlib import Path
from PIL import Image
parser=argparse.ArgumentParser()
parser.add_argument('t1');parser.add_argument('t2');parser.add_argument('--output',default='assets/farm/daily-missions/v2')
a=parser.parse_args();paths={'T1':Path(a.t1),'T2':Path(a.t2)};sheets={k:Image.open(v).convert('RGBA') for k,v in paths.items()}
out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
# Bounds use original source pixels, x0/y0 inclusive, x1/y1 exclusive.
boxes={
 'title':('T1',(86,0,654,134)), 'close':('T1',(679,6,804,134)),
 'tab-checkin-inactive':('T1',(45,130,378,232)), 'tab-checkin-active':('T1',(381,130,712,232)),
 'tab-mission-inactive':('T1',(715,130,1044,232)), 'tab-mission-active':('T1',(1048,130,1392,232)),
 'window':('T1',(20,238,639,828)), 'ribbon':('T1',(698,238,1305,329)),
 'wood-label':('T1',(800,321,1185,395)),
 'card-normal':('T1',(644,570,819,812)), 'card-today':('T1',(820,565,1009,817)),
 'card-locked':('T1',(1009,572,1193,813)), 'card-seventh':('T1',(1193,568,1417,817)),
 'button-checkin':('T1',(55,830,414,934)), 'button-claim':('T1',(432,830,781,937)),
 'button-disabled':('T1',(788,832,1142,937)),
 'reward-panel':('T1',(25,938,537,1085)), 'connector':('T1',(793,511,822,541)),
 'mission-row':('T2',(24,38,790,199)),
 'mission-table':('T1',(548,967,1096,1068)),
 'task-empty':('T2',(665,77,752,167)),
 'track':('T2',(813,41,1404,99)), 'fill':('T2',(813,106,1404,161)),
 'eggs':('T2',(810,241,975,372)), 'broom':('T2',(970,240,1101,383)),
 'monster':('T2',(1100,244,1264,373)), 'swords':('T2',(1263,233,1448,381)),
 'coins':('T2',(803,397,943,542)), 'coin':('T2',(952,410,1043,501)),
 'chest':('T2',(1048,405,1161,501)), 'check':('T2',(1167,411,1255,500)),
 'status-empty':('T2',(1261,411,1346,498)),
 'node-completed':('T2',(52,575,161,684)), 'node-current':('T2',(193,571,309,688)),
 'node-locked':('T2',(339,572,454,687)), 'node-empty':('T2',(1141,569,1235,663)),
 'hen':('T2',(20,688,274,923)),
}
manifest={'version':'T1-T2-original-crops','sources':{k:{'sha256':hashlib.sha256(v.read_bytes()).hexdigest(),'size':sheets[k].size} for k,v in paths.items()},'assets':{}}
images={}
for name,(sheet,box) in boxes.items():
 images[name]=sheets[sheet].crop(box)
 manifest['assets'][name]={'source':sheet,'box':list(box),'file':name+'.png','patches':[]}
# Remove baked control labels by copying a blank strip from that SAME supplied
# control at the SAME vertical coordinates. Frame, glyph icons and original colors
# stay sourced from T1; visible labels are real DOM text instead of duplicate words.
def blank_strip(name,rect,sample):
 im=images[name];patch=im.crop(sample).resize((rect[2]-rect[0],rect[3]-rect[1]),Image.Resampling.LANCZOS);im.paste(patch,rect)
 manifest['assets'][name]['patches'].append({'kind':'copy-original-blank-strip','target':list(rect),'sample':list(sample)})
# The title face uses the supplied blank wooden caption, retaining the original
# chicken and outer foliage. This deliberate patch is recorded, never called exact.
name='title';rect=(180,17,500,124);patch=images['wood-label'].resize((rect[2]-rect[0],rect[3]-rect[1]),Image.Resampling.LANCZOS);images[name].paste(patch,rect,patch)
manifest['assets'][name]['patches'].append({'kind':'supplied-blank-wood-face','target':list(rect),'asset':'wood-label'})
blank_strip('tab-checkin-inactive',(126,26,302,83),(25,26,43,83))
blank_strip('tab-checkin-active',(126,26,302,83),(25,26,43,83))
blank_strip('tab-mission-inactive',(125,26,302,83),(25,26,43,83))
blank_strip('tab-mission-active',(127,26,307,83),(25,26,43,83))
blank_strip('button-checkin',(72,20,311,79),(43,20,52,79))
blank_strip('button-claim',(55,20,298,81),(26,20,38,81))
blank_strip('button-disabled',(54,20,298,81),(26,20,38,81))
# This region belongs to the next wooden caption on T1, not to the ribbon.
images['ribbon'].paste((0,0,0,0),(80,80,520,91))
manifest['assets']['ribbon']['excluded_neighbor_boxes']=[[80,80,520,91]]
for name,im in images.items():im.save(out/(name+'.png'),optimize=True)
(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
