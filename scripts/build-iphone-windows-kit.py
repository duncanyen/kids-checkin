#!/usr/bin/env python3
"""Package only synthetic lab dependencies and public art; no credentials or deploy config."""
from pathlib import Path
import shutil, json, hashlib, subprocess, zipfile, datetime, argparse
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--output',default='/workspace/exports/gugu-windows-iphone-lab.zip');p.add_argument('--directory',default='/tmp/gugu-windows-iphone-lab');p.add_argument('--phaser',default='/tmp/kids-phaser.js');p.add_argument('--phaser-license',default='/tmp/phaser-3.60-LICENSE.md');a=p.parse_args()
out=Path(a.output).resolve();dest=Path(a.directory).resolve()
if dest==ROOT or dest in ROOT.parents or dest.is_relative_to(ROOT):raise SystemExit('Build directory must be outside repository')
if dest.exists():raise SystemExit('Choose an empty build directory; existing files are never deleted')
phaser=Path(a.phaser);license_file=Path(a.phaser_license)
if b'3.60.0' not in phaser.read_bytes() or 'MIT License' not in license_file.read_text():raise SystemExit('Phaser3.60.0 and its license are required')
dest.mkdir(parents=True)
def copy(rel,target=None):
 src=ROOT/rel
 if not src.is_file() or src.is_symlink():raise RuntimeError('Not a regular allowlisted file: '+str(rel))
 dst=dest/(target or rel);dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
for directory in ['assets/farm','js','css','game-admin/functions']:
 for src in sorted((ROOT/directory).rglob('*')):
  rel=src.relative_to(ROOT)
  if not src.is_file() or src.is_symlink() or any(x in ('node_modules','.git') for x in rel.parts):continue
  if directory=='assets/farm':ok=src.suffix.lower() in ('.png','.webp','.jpg','.jpeg','.gif','.svg','.json','.mp3','.ogg','.woff2','.ico')
  else:ok=src.suffix.lower() in ('.js','.mjs','.cjs','.css') or src.name=='package.json'
  if ok:copy(rel)
for rel in ['farmgame.html','Nexus.png','scripts/iphone-lab.cjs','functions/identity-domain.cjs','functions/identity-access.cjs','game-admin/tests/memory-db.cjs','game-admin/tests/helpers/refinement-fixture.cjs','game-admin/tests/helpers/release-fixture.cjs']:
 copy(rel)
for src in sorted((ROOT/'tests/iphone-lab').iterdir()):
 if src.is_file() and src.name!='smoke.cjs' and src.suffix in ('.cjs','.js','.html'):copy(src.relative_to(ROOT))
for src in sorted((ROOT/'docs/weapon-refinement/iphone').iterdir()):
 if src.is_file() and src.suffix in ('.md','.csv'):copy(src.relative_to(ROOT))
copy('tests/iphone-lab/windows/Start-Lab.ps1','Start-Lab.ps1');copy('tests/iphone-lab/windows/WINDOWS-README.md','WINDOWS-README.md')
# The browser adapter already replaces this route; sanitize the physical kit file too.
(dest/'js/firebase-config.js').write_text("export const db={},app={},firebaseConfig={projectId:'demo-iphone-lab'};\n")
(dest/'vendor').mkdir();shutil.copy2(phaser,dest/'vendor/phaser.min.js');shutil.copy2(license_file,dest/'vendor/PHASER-LICENSE.md')
(dest/'certs').mkdir();(dest/'certs/README.txt').write_text('Certificates and private keys are generated locally on your Windows PC. This package contains none.\n')
commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
meta={'schemaVersion':1,'baseCommit':commit,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'purpose':'Windows synthetic iPhone lab, not a production release','production':False,'firebaseConfigSanitized':True,'requires':['Node.js22','mkcert for Windows HTTPS'],'externalNodePackagesRequired':False,'windowsDeviceAcceptance':'NOT_RUN','iphoneAcceptance':'NOT_RUN'}
(dest/'lab-build.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
manifest={str(f.relative_to(dest)).replace('\\','/'):hashlib.sha256(f.read_bytes()).hexdigest()for f in sorted(dest.rglob('*'))if f.is_file()}
(dest/'KIT-SHA256.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
out.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=4)as z:
 for f in sorted(dest.rglob('*')):
  if f.is_file():z.write(f,f.relative_to(dest).as_posix())
print(json.dumps({'output':str(out),'directory':str(dest),'files':len(manifest)+1,'bytes':out.stat().st_size,'sha256':hashlib.sha256(out.read_bytes()).hexdigest()},indent=2))
