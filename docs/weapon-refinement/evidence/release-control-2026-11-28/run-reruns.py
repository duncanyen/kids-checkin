import subprocess,os,json,time
from pathlib import Path
out=Path('/tmp/nexus-release-control/regression-rerun');out.mkdir(exist_ok=True);results=[]
node='/workspace/.kids-checkin-tools/node_modules/node/bin/node'
env=os.environ.copy();env.update({'NODE_OPTIONS':'--require=/workspace/kids-checkin/tests/weapon-refinement/browser-guard.cjs','PHASER_FIXTURE':'/tmp/kids-phaser.js','FARM_BASE_URL':'http://127.0.0.1:8033','OPS_UI_BASE':'http://127.0.0.1:8033/game-admin/site'})
server=subprocess.Popen(['python3','-m','http.server','8033','--bind','127.0.0.1'],cwd='/workspace/kids-checkin',stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
import urllib.request
for _ in range(40):
 try:
  urllib.request.urlopen('http://127.0.0.1:8033/farmgame.html',timeout=2);break
 except Exception:time.sleep(.15)
for name,script,flag in [(name,'tests/farm-private-backend-browser.cjs',flag) for name,flag in [('countdown','COUNTDOWN_TESTS'),('combat-feedback','COMBAT_FEEDBACK_TESTS'),('critical-feedback','CRITICAL_FEEDBACK_TESTS')]]:
 e=env.copy()
 if flag:e[flag]='1'
 start=time.time()
 with (out/(name+'.log')).open('w') as log:
  try:r=subprocess.run([node,script],cwd='/workspace/kids-checkin',env=e,stdout=log,stderr=subprocess.STDOUT,timeout=240);code=r.returncode
  except subprocess.TimeoutExpired:code=124
 results.append({'id':name,'exitCode':code,'durationMs':round((time.time()-start)*1000),'flag':flag,'log':name+'.log'})
 (out/'extra-browser-summary.json').write_text(json.dumps(results,indent=2))
 print(name,code,flush=True)

server.terminate()
server.wait(timeout=10)
