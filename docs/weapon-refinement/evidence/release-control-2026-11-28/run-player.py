import subprocess,os,time,urllib.request
server=subprocess.Popen(['python3','-m','http.server','8032','--bind','127.0.0.1'],cwd='/workspace/kids-checkin',stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
 for _ in range(40):
  try:urllib.request.urlopen('http://127.0.0.1:8032/farmgame.html',timeout=2);break
  except Exception:time.sleep(.1)
 env=os.environ.copy();env.update({'REFINEMENT_RELEASE_TESTS':'1','PHASER_FIXTURE':'/tmp/kids-phaser.js','FARM_BASE_URL':'http://127.0.0.1:8032','NODE_OPTIONS':'--require=/workspace/kids-checkin/tests/weapon-refinement/browser-guard.cjs'})
 r=subprocess.run(['/workspace/.kids-checkin-tools/node_modules/node/bin/node','tests/farm-private-backend-browser.cjs'],cwd='/workspace/kids-checkin',env=env)
 raise SystemExit(r.returncode)
finally:server.terminate();server.wait(timeout=10)
