// Optional headless QA: npm install --no-save playwright
// Serve the repository root before running: python3 -m http.server 8080
// DUEL_URL=http://127.0.0.1:8080/duel/ node duel/qa-browser.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url=process.env.DUEL_URL||'http://127.0.0.1:8080/duel/';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-webgl','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1060,height:670}});
const errors=[];const checks=[];
page.on('pageerror',err=>errors.push(err.message));
page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text())});
// Instrument the response ONLY inside this testing browser; never alter app sources.
await page.route('**/duel/',async route=>{
 const response=await route.fetch();let html=await response.text();
 const anchor='syncPos(reiner);loop();';
 assert.ok(html.includes(anchor),'QA injection anchor exists');
 html=html.replace(anchor,'syncPos(reiner);window.__duelQA={eren,reiner,state,motion,keys,tick,attack,grapple,assist,dodge,reset,dist};loop();');
 await route.fulfill({response,body:html});
});
try{
 await page.goto(url,{waitUntil:'domcontentloaded'});
 assert.equal(await page.locator('canvas').count(),1,'Three.js canvas created');
 checks.push('3D canvas loads');
 await page.click('#start');
 await page.waitForFunction(()=>!!window.__duelQA,{timeout:10000});
 const result=await page.evaluate(()=>{
  const q=window.__duelQA;const tests=[];
  const step=(n,seconds)=>{for(let i=0;i<Math.round(seconds*60);i++)q.tick(1/60);};
  function expect(ok,name){tests.push({name,pass:!!ok});}
  q.reset();q.keys.add('KeyW');q.keys.add('ShiftLeft');step(0,2.15);
  q.keys.delete('KeyW');q.keys.delete('ShiftLeft');
  expect(q.dist()<11,'Eren can sprint into grappling range');
  q.reset();q.eren.pos.copy(q.reiner.pos);q.eren.pos.z+=7;
  step(0,17.5);expect(q.eren.hp<100,'Reiner AI can land damaging counterattacks');
  q.reset();q.eren.pos.copy(q.reiner.pos);q.eren.pos.z+=7;
  const initial=q.reiner.armor;q.attack(true);
  expect(q.reiner.armor<initial,'Heavy attack hits armored target');
  q.reset();
  for(let i=0;i<11&&q.state.phase<3;i++){
   q.eren.pos.copy(q.reiner.pos);q.eren.pos.z+=7;
   q.grapple();step(0,1.72);
   if(q.state.phase===2&&!tests.some(t=>t.name==='Phase II unlocks')){expect(true,'Phase II unlocks');q.eren.pos.copy(q.reiner.pos);q.eren.pos.z+=7;const armor=q.reiner.armor;q.assist();expect(q.reiner.armor<armor,'Mikasa assist damages joint');}
  }
  expect(q.state.phase===3,'Phase III unlocks from broken armor');
  q.eren.pos.copy(q.reiner.pos);q.eren.pos.z+=7;
  q.keys.add('KeyE');q.grapple();step(0,3.5);q.keys.delete('KeyE');
  expect(q.state.ended&&q.state.lock===1,'Finishing grapple ends battle');
  q.reset();
  expect(q.eren.hp===100&&q.state.phase===1&&!q.state.ended,'Restart returns to full-health Act I');
  return {tests,phase:q.state.phase,hp:q.eren.hp};
 });
 for(const c of result.tests){checks.push((c.pass?'PASS ':'FAIL ')+c.name);assert.ok(c.pass,c.name);}
 if(process.env.DUEL_SCREENSHOT)await page.screenshot({path:process.env.DUEL_SCREENSHOT});
 assert.deepEqual(errors,[],'No browser runtime errors');
 console.log(JSON.stringify({ok:true,checks,errors},null,2));
}finally{await browser.close();}
