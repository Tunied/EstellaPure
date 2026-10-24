#!/bin/bash
# The engine's picture of a lab scene: <out>/engine_<lab>.png.
# usage: run-lab.sh <lab> <scene.glb> [name]       env: BACKEND (webgl2|webgpu)  EFFECTS  Q  EXTENT  OUT
set -e
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -W)"
ROOT="$(cd "$HERE/../.." && pwd -W)"
OUT="${OUT:-$ROOT/output/render-lab}"
mkdir -p "$OUT"
LAB=$1; GLB=$2; NAME=${3:-$LAB}
P="$OUT/proj_$NAME"
rm -rf "$P" "$OUT/web_$NAME"
python "$HERE/lab_project.py" "$P" "$LAB" "$GLB" > /dev/null
cd "$ROOT"
node pipeline/bin/estella.mjs import-hdr "$P/assets/env/uniform.hdr" --project "$P" > /dev/null 2>&1
node pipeline/bin/estella.mjs import-model "$P/assets/models/lab/lab.glb" --project "$P" > /dev/null 2>&1
node tools/asset-meta.js "$P/assets" > /dev/null 2>&1
python - <<EOF
import json
P=r'$P'
u=json.load(open(P+'/assets/models/lab/lab.esprefab.meta'))['uuid']
sp=P+'/assets/scenes/lab.esscene'
s=json.load(open(sp))
s['entities'].append({'id':max(e['id'] for e in s['entities'])+1,'name':'Lab','parent':None,'prefab':'@uuid:'+u,'overrides':[],'added':[],'removed':[]})
json.dump(s,open(sp,'w'),indent=1)
EOF
node pipeline/bin/estella.mjs export "$P" --out "$OUT/web_$NAME" 2>&1 | grep -E '"ok"|error' | head -2
node "$HERE/shot.mjs" "$OUT" "$OUT/web_$NAME" "$NAME" 2>&1 | grep -E "error|ERROR|warn" | head -5 | cut -c1-200 || true
mv "$OUT/lab-$NAME.png" "$OUT/engine_$NAME.png"
echo "engine_$NAME.png written to $OUT"
