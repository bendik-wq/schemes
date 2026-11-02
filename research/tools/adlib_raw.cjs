const { chromium } = require('playwright'); const fs=require('fs');
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const [,, url, out, scrolls='10']=process.argv;
(async()=>{ const b=await chromium.launch();
 for(let k=0;k<6;k++){ const ctx=await b.newContext({locale:'en-US',userAgent:UA,viewport:{width:1400,height:1000}}); const p=await ctx.newPage();
  const bodies=[]; p.on('response',async r=>{ const u=r.url(); if(u.includes('/api/graphql')||u.includes('/ads/library/async')){ try{bodies.push(await r.text());}catch(e){} }});
  await p.goto(url,{waitUntil:'domcontentloaded',timeout:60000}); await p.waitForTimeout(8000);
  const t=await p.evaluate(()=>document.body.innerText); if(!/[0-9] results?/.test(t)){ await ctx.close(); await new Promise(z=>setTimeout(z,5000*(k+1))); continue; }
  for(let i=0;i<+scrolls;i++){ await p.mouse.wheel(0,40000); await p.waitForTimeout(2500); }
  const html=await p.content(); fs.writeFileSync(out+'.html',html); fs.writeFileSync(out+'.gql.json',JSON.stringify(bodies));
  console.log('ok html',html.length,'gql',bodies.length,bodies.map(x=>x.length)); await ctx.close(); break; }
 await b.close(); })();
