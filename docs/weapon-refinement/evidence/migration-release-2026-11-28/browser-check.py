import subprocess,os,time,urllib.request,json
from pathlib import Path
root='/workspace/kids-checkin';node='/workspace/.kids-checkin-tools/node_modules/node/bin/node';out=Path('/tmp/nexus-migration-release');results=[]
server=subprocess.Popen(['python3','-m','http.server','8034','--bind','127.0.0.1'],cwd=root,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
 for _ in range(40):
  try:urllib.request.urlopen('http://127.0.0.1:8034/farmgame.html',timeout=2);break
  except Exception:time.sleep(.1)
 env=os.environ.copy();env.update({'PHASER_FIXTURE':'/tmp/kids-phaser.js','FARM_BASE_URL':'http://127.0.0.1:8034','NODE_OPTIONS':'--require='+root+'/tests/weapon-refinement/browser-guard.cjs'})
 for name,script,extra in [('core-game','tests/farm-private-backend-browser.cjs',{}),('player-release','tests/farm-private-backend-browser.cjs',{'REFINEMENT_RELEASE_TESTS':'1'}),('admin-release','game-admin/tests/refinement-release.browser.cjs',{})]:
  with (out/(name+'.log')).open('w') as log:
   start=time.time();r=subprocess.run([node,script],cwd=root,env={**env,**extra},stdout=log,stderr=subprocess.STDOUT,timeout=240)
  results.append({'id':name,'exitCode':r.returncode,'durationMs':round((time.time()-start)*1000),'backend':'MemoryDB, actual production admission/service branch for whitelist cases; real Firestore separately verified','physicalMobile':False});(out/'browser-summary.json').write_text(json.dumps(results,indent=2));print(name,r.returncode,flush=True)
finally:server.terminate();server.wait(timeout=10)
