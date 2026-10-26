const { chromium } = require('playwright');
const fs=require('fs');
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const sleep=ms=>new Promise(z=>setTimeout(z,ms));
function urlFor(q){
  if(q.startsWith('page:')) return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&view_all_page_id=${q.slice(5)}&search_type=page&media_type=all`;
  const exact=q.startsWith('"');
  return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=${encodeURIComponent(q)}&search_type=${exact?'keyword_exact_phrase':'keyword_unordered'}&media_type=all`;
}
async function once(b,q,scrolls){
  const ctx=await b.newContext({locale:'en-US',userAgent:UA,viewport:{width:1400,height:1000}});
  const p=await ctx.newPage(); const gql=[];
  p.on('response',async r=>{ if(r.url().includes('/api/graphql')){ try{gql.push(await r.text());}catch(e){} }});
  try{
    await p.goto(urlFor(q),{waitUntil:'domcontentloaded',timeout:60000});
    await p.waitForTimeout(6000);
    let txt=await p.evaluate(()=>document.body.innerText);
    if(!/results?\n/.test(txt) && !/~?[\d,.]+K? results?/.test(txt)){ await ctx.close(); return null; }
    for(let i=0;i<scrolls;i++){ await p.mouse.wheel(0,30000); await p.waitForTimeout(2000); }
    const r=await p.evaluate(()=>{
      const total=(document.body.innerText.match(/~?[\d,.]+K? results?/)||[''])[0];
      const cands=[...document.querySelectorAll('div')].filter(d=>{const t=d.innerText||''; return t.includes('Library ID:')&&t.includes('Sponsored')&&(t.match(/Library ID:/g)||[]).length===1;});
      const max=cands.filter(d=>!(d.parentElement&&cands.includes(d.parentElement)));
      const ads=max.map(c=>{const t=c.innerText; const lines=t.split('\n').map(s=>s.trim()).filter(Boolean); const si=lines.indexOf('Sponsored');
        const links=[...c.querySelectorAll('a')].map(a=>a.href);
        const dest=(links.filter(h=>h.includes('l.facebook.com')).map(h=>{try{return decodeURIComponent(new URL(h).searchParams.get('u')||'')}catch(e){return ''}})[0])||'';
        return {id:(t.match(/Library ID: (\d+)/)||[])[1],start:(t.match(/Started running on ([A-Za-z]{3} \d+, \d{4})/)||[])[1],n:+((t.match(/(\d+) ads use this creative/)||[])[1]||1),page:si>0?lines[si-1]:'',pageLink:links.find(h=>/facebook\.com\/(?!ads|l\.php)[^?]+\/?$/.test(h))||'',dest,body:lines.slice(si+1,si+8).join(' | ').slice(0,400)};});
      return {total,ads};
    });
    if(q.startsWith('page:')){ try{ await p.getByText('About',{exact:true}).first().click({timeout:5000}); await p.waitForTimeout(3500); const at=await p.evaluate(()=>document.body.innerText); const i=at.search(/Page transparency|About the advertiser|Page created|Creation date/i); r.about=i>=0?at.slice(Math.max(0,i-100),i+1500):at.slice(0,2500);}catch(e){ r.about='ERR '+e.message.slice(0,60);} }
    r.pages=[]; for(const t of gql){ try{ const j=JSON.parse(t); const pg=j?.data?.ad_library_main?.dynamic_filter_options?.pages; if(pg) r.pages.push(...pg);}catch(e){} }
    await ctx.close(); return r;
  }catch(e){ try{await ctx.close();}catch(_){} return null; }
}
(async()=>{
  const b=await chromium.launch();
  const qs=JSON.parse(fs.readFileSync(process.argv[2])); const outF=process.argv[3]; const scrolls=+(process.argv[4]||3);
  const res=fs.existsSync(outF)?JSON.parse(fs.readFileSync(outF)):{};
  for(const q of qs){ if(res[q]&&res[q].total) continue;
    let r=null; for(let k=0;k<6&&!r;k++){ r=await once(b,q,scrolls); if(!r) await sleep(5000*(k+1)); }
    res[q]=r||{total:'',ads:[],pages:[]}; console.log(q, res[q].total, res[q].ads.length, res[q].pages.length);
    fs.writeFileSync(outF,JSON.stringify(res)); await sleep(2000);
  }
  await b.close();
})();
