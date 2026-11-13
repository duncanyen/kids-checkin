"""依使用者指定裁切排行榜原 JPEG；只去除連通外部白底，不生成美術。"""
import hashlib,json
from collections import deque
from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parents[1]
out=root/'assets/farm/leaderboard'
source=out/'source/asset-sheet.jpg'
sheet=Image.open(source).convert('RGB')
boxes={
 'title':(22,0,540,160),'close':(543,44,646,153),'category':(22,162,575,253),
 'panel':(646,28,1104,778),'period_banner':(18,264,537,351),'divider':(42,353,592,397),
 'row_gold':(18,402,627,489),'row_silver':(18,489,627,574),'row_bronze':(18,574,627,658),'row_normal':(18,658,627,737),
 'medal_gold':(1117,32,1272,173),'medal_silver':(1117,177,1272,285),'medal_bronze':(1117,289,1272,398),
 'gift':(1137,499,1252,614),'sparkle':(1120,625,1253,723),
 'reward_banner':(18,743,626,848),'refresh':(137,848,515,950),
 'grass_left':(647,788,894,891),'grass_right':(959,790,1209,891),'calendar':(546,259,634,347)
}
def remove_background(image):
 im=image.convert('RGBA');pixels=im.load();w,h=im.size
 seen=set();queue=deque([(x,y) for x in range(w) for y in (0,h-1)]+[(x,y) for y in range(h) for x in (0,w-1)])
 while queue:
  x,y=queue.popleft()
  if (x,y) in seen:continue
  seen.add((x,y));r,g,b,a=pixels[x,y]
  if min(r,g,b)<239 or max(r,g,b)-min(r,g,b)>18:continue
  pixels[x,y]=(r,g,b,0)
  for nx,ny in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
   if 0<=nx<w and 0<=ny<h:queue.append((nx,ny))
 # 只處理外部白底相鄰的抗鋸齒像素，避免 JPEG 白色 matte 在深色遮罩留下白圈。
 edges=[]
 for y in range(h):
  for x in range(w):
   r,g,b,a=pixels[x,y]
   if a and min(r,g,b)>207 and any(0<=nx<w and 0<=ny<h and pixels[nx,ny][3]==0 for nx,ny in ((x-1,y),(x+1,y),(x,y-1),(x,y+1))):edges.append((x,y,r,g,b))
 for x,y,r,g,b in edges:
  alpha=min(1,(255-min(r,g,b))/48)
  pixels[x,y]=(*(max(0,min(255,round((v-255*(1-alpha))/alpha))) if alpha else 0 for v in (r,g,b)),round(alpha*255))
 return im
manifest={'source':{'path':'source/asset-sheet.jpg','sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'size':sheet.size},'assets':{},'limitations':['白底 JPEG 的邊緣壓縮與半透明陰影無法還原成原始透明 PNG；保留原圖顏色，不宣稱逐像素一致。','一般名次改用既有每日任務的空白圓章，避免原圖固定數字 4。']}
for name,box in boxes.items():
 im=remove_background(sheet.crop(box));filename='leaderboard_'+name+'.png';im.save(out/filename)
 manifest['assets'][name]={'file':filename,'box':box,'size':im.size,'processing':'外部連通白底去背與邊緣 white-matte 去除；未重新繪製'}
blank=root/'assets/farm/daily-missions/v2/status-empty.png'
im=Image.open(blank);im.save(out/'leaderboard_rank_normal.png');manifest['assets']['rank_normal']={'file':'leaderboard_rank_normal.png','reusedFrom':str(blank.relative_to(root)),'size':im.size}
(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
# 去背後的深色底檢視圖，供人工檢查白邊、鄰近碎片與切邊。
canvas=Image.new('RGB',(1000,((len(boxes)+2)//3)*180),(62,66,62))
for i,(name,_) in enumerate(boxes.items()):
 im=Image.open(out/('leaderboard_'+name+'.png'));im.thumbnail((315,160));canvas.paste(im,((i%3)*330,(i//3)*180),im)
canvas.save('/tmp/leaderboard-asset-inspection.png')
print('Extracted',len(manifest['assets']),'source-derived/reused PNG assets')
