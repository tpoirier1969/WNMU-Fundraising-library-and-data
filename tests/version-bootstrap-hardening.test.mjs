import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function parseVersion(textValue){
  const versionText=String(textValue).replace(/^\uFEFF/,'').trim();
  let payload;
  try{
    payload=JSON.parse(versionText);
  }catch(firstError){
    const repaired=versionText.replace(/\\n+\s*$/,'').trim();
    if(repaired===versionText)throw firstError;
    payload=JSON.parse(repaired);
  }
  return String(payload?.appVersion||payload?.version||'').trim().replace(/^v/i,'');
}

test('Program Library version bootstrap tolerates stale literal backslash-n artifact',()=>{
  const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(index,/versionResponse\.text\(\)/);
  assert.match(index,/versionText\.replace\(\/\\\\n\+\\s\*\$\//);
  assert.equal(parseVersion('{"appVersion":"0.22.233"}\\n'),'0.22.233');
  assert.equal(parseVersion('{"appVersion":"0.22.233"}\n'),'0.22.233');
});
