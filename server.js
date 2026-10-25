const http=require('http'),fs=require('fs'),path=require('path');
const PORT=process.env.PORT||3000;
const CHAINS={ethereum:1,base:8453,bsc:56};
async function j(url){try{const r=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{'accept':'application/json'}});if(!r.ok)return{_err:`HTTP ${r.status}`};return await r.json();}catch(e){return{_err:String(e.message||e)}}}

const DEX_CACHE=new Map(),DEX_TTL=3*60*1000;
const GT_NET={solana:'solana',ethereum:'eth',base:'base',bsc:'bsc'};
async function gtFetch(addr,chain){
  if(process.env.GT_FORCE_FAIL)return{_err:'HTTP 429 (forced)'};
  const r=await j(`https://api.geckoterminal.com/api/v2/networks/${GT_NET[chain]}/tokens/${addr}/pools?include=base_token,quote_token&page=1`);
  if(r._err||!Array.isArray(r.data))return{_err:r._err||'bad response'};
  const toks={};(r.included||[]).forEach(t=>{toks[t.id]=t.attributes||{}});
  const me=toks[`${GT_NET[chain]}_${addr}`]||Object.values(toks).find(t=>(t.address||'').toLowerCase()===addr.toLowerCase())||{};
  return{pairs:r.data.map(p=>{const a=p.attributes||{};return{chainId:chain,liquidity:{usd:Number(a.reserve_in_usd)||0},volume:{h24:Number(a.volume_usd&&a.volume_usd.h24)||0},pairCreatedAt:a.pool_created_at?Date.parse(a.pool_created_at):undefined,baseToken:{name:me.name,symbol:me.symbol,address:addr},priceUsd:a.base_token_price_usd,fdv:Number(a.fdv_usd)||undefined,url:`https://www.geckoterminal.com/${GT_NET[chain]}/pools/${a.address}`}})};
}
async function dexFetch(addr,nets){
  const k=addr.toLowerCase(),c=DEX_CACHE.get(k);
  if(c&&Date.now()-c.t<DEX_TTL)return c.v;
  const ds=await dexScreener(addr);
  if(!ds._err){ds._source='dexscreener';DEX_CACHE.set(k,{t:Date.now(),v:ds});if(DEX_CACHE.size>500)DEX_CACHE.delete(DEX_CACHE.keys().next().value);return ds;}
  const gts=await Promise.all(nets.map(n=>gtFetch(addr,n)));
  const pairs=gts.flatMap(g=>g.pairs||[]);
  if(gts.some(g=>!g._err)){const v={pairs,_source:'geckoterminal',_dsErr:ds._err};DEX_CACHE.set(k,{t:Date.now(),v});return v;}
  return{_err:`dexscreener ${ds._err}; geckoterminal ${gts.map(g=>g._err).join(',')}`};
}
async function dexScreener(addr){
  if(process.env.DEX_FORCE_FAIL)return{_err:'HTTP 429 (forced)'};
  let r;
  for(let i=0;i<3;i++){
    r=await j(`https://api.dexscreener.com/latest/dex/tokens/${addr}`);
    const m=r._err&&/HTTP (\d+)/.exec(r._err);
    if(!r._err)return r;
    if(m&&!(m[1]==='429'||m[1][0]==='5'))return r;
    if(i<2)await new Promise(z=>setTimeout(z,600*Math.pow(2,i)+Math.random()*300));
  }
  return r;
}

const fmt=n=>n==null?'n/a':'$'+Number(n).toLocaleString('en-US',{maximumFractionDigits:0});
function dexSummary(dex,chain){
  let pairs=(dex&&dex.pairs)||[]; if(chain)pairs=pairs.filter(p=>p.chainId===chain);
  if(!pairs.length)return null;
  const liq=pairs.reduce((s,p)=>s+(p.liquidity?.usd||0),0), vol=pairs.reduce((s,p)=>s+(p.volume?.h24||0),0);
  const created=Math.min(...pairs.map(p=>p.pairCreatedAt||Infinity));
  const top=pairs.sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0))[0];
  return {liquidityUsd:liq,volume24h:vol,ageDays:isFinite(created)?(Date.now()-created)/864e5:null,pairs:pairs.length,name:top.baseToken.name,symbol:top.baseToken.symbol,priceUsd:top.priceUsd,fdv:top.fdv,url:top.url,chains:[...new Set(((dex.pairs)||[]).map(p=>p.chainId))]};
}
function market(flags,d,add,dex){
  if(dex&&dex._err)return;
  if(!d){add(25,'No trading pairs found on DexScreener — can\'t be bought/sold on a known DEX, or it\'s dead.');return;}
  if(d.liquidityUsd<10000)add(20,`Very low liquidity (${fmt(d.liquidityUsd)}) — tiny trades move the price a lot and it\'s easy to drain.`);
  else if(d.liquidityUsd<100000)add(8,`Modest liquidity (${fmt(d.liquidityUsd)}).`);
  if(d.volume24h<1000)add(8,`Almost no trading in the last 24h (${fmt(d.volume24h)}).`);
  if(d.ageDays!=null){if(d.ageDays<1)add(15,'Brand-new token (under 1 day old) — most rugs happen in the first hours/days.');else if(d.ageDays<7)add(8,`Very young token (${d.ageDays.toFixed(1)} days old).`);}
}
function verdict(s){return s<=20?'Likely Legit':s<=45?'Caution':s<=70?'High Risk':'Likely Scam'}
async function solana(addr){
  const [rc,dex]=await Promise.all([j(`https://api.rugcheck.xyz/v1/tokens/${addr}/report`),dexFetch(addr,['solana'])]);
  const flags=[],good=[];let score=0;const add=(p,m)=>{score+=p;flags.push(m)};
  const d=dexSummary(dex,'solana'),sources={rugcheck:rc._err||'ok',dexscreener:dex._err||(dex._dsErr||'ok'),market:dex._err?'unavailable':dex._source};
  if(!rc._err){
    if(rc.rugged)add(100,'RugCheck has marked this token as RUGGED.');
    if(rc.token?.mintAuthority)add(30,'Mint authority is still active — the dev can print unlimited new tokens and dump them.');else good.push('Mint authority revoked (no new tokens can be minted).');
    if(rc.token?.freezeAuthority)add(25,'Freeze authority is active — the dev can freeze your wallet so you can\'t sell.');else good.push('Freeze authority revoked.');
    const mk=rc.markets||[];const lockedUsd=mk.reduce((s,m)=>s+(m.lp?.lpLockedUSD||0),0),totLiq=rc.totalMarketLiquidity||0;
    const lockedPct=totLiq?lockedUsd/totLiq*100:0;
    if(lockedPct>=90)good.push(`~${lockedPct.toFixed(0)}% of liquidity locked/burned.`);
    else if(!(d&&d.liquidityUsd>1e6&&d.ageDays>180))add(lockedPct<50?15:6,`Only ~${lockedPct.toFixed(0)}% of pool liquidity is locked/burned — LP could be pulled.`);
    else flags.push(`Note: only ~${lockedPct.toFixed(0)}% of LP locked, but the token is old with deep liquidity, so this is weighted lightly.`);
    const th=(rc.topHolders||[]).slice(0,10),top10=th.reduce((s,h)=>s+(h.pct||0),0),insider=th.filter(h=>h.insider).length;
    if(th.length){if(top10>50)add(20,`Top 10 holders own ${top10.toFixed(1)}% of supply — a few wallets could crash the price.`);else if(top10>30)add(8,`Top 10 holders own ${top10.toFixed(1)}% of supply.`);else good.push(`Top 10 holders own ${top10.toFixed(1)}% (reasonably spread).`);
      if(th[0].pct>20)add(10,`Single largest holder owns ${th[0].pct.toFixed(1)}%.`);}
    if(insider)add(10,`${insider} of the top 10 holders are flagged as insiders.`);
    if(rc.transferFee?.pct>0)add(Math.min(20,rc.transferFee.pct*2),`Token has a ${rc.transferFee.pct}% transfer fee.`);
    for(const r of rc.risks||[]){if(/mint|freeze|top 10|single holder|liquidity/i.test(r.name))continue;
      if(r.level==='danger')add(10,`RugCheck: ${r.name} — ${r.description}`);else flags.push(`RugCheck note: ${r.name} — ${r.description}`);}
    if(rc.graphInsidersDetected>0)add(8,`RugCheck detected ${rc.graphInsidersDetected} linked insider wallets.`);
  } else add(10,'RugCheck report unavailable — score based on less data.');
  market(flags,d,add,dex);
  return {chain:'solana',score:Math.min(100,Math.round(score)),flags,good,market:d,marketUnavailable:!!dex._err,extra:rc._err?null:{rugcheckScoreNormalised:rc.score_normalised,holders:rc.totalHolders,name:rc.tokenMeta?.name,symbol:rc.tokenMeta?.symbol},sources};
}
async function evm(addr,want){
  const dex=await dexFetch(addr,want&&GT_NET[want]?[want]:['ethereum','base','bsc']);
  let chain=want; if(!chain){const cs=(dex.pairs||[]).map(p=>p.chainId).filter(c=>CHAINS[c]);chain=cs[0]||'ethereum';}
  const id=CHAINS[chain];
  const [gp,hp]=await Promise.all([j(`https://api.gopluslabs.io/api/v1/token_security/${id}?contract_addresses=${addr}`),j(`https://api.honeypot.is/v2/IsHoneypot?address=${addr}&chainID=${id}`)]);
  const flags=[],good=[];let score=0;const add=(p,m)=>{score+=p;flags.push(m)};
  const sources={goplus:gp._err||(gp.code===1?'ok':'code '+gp.code+' '+gp.message),honeypot:hp._err||'ok',dexscreener:dex._err||(dex._dsErr||'ok'),market:dex._err?'unavailable':dex._source};
  const d0=dexSummary(dex,chain);const g=gp.result&&gp.result[addr.toLowerCase()];
  if(g){
    const t=v=>v==='1';const o=(g.owner_address||'').toLowerCase();const renounced=!o||/^0x0+$/.test(o)||o==='0x000000000000000000000000000000000000dead';const op=(p,m)=>renounced?flags.push('(Owner renounced, so low risk) '+m):add(p,m);
    if(t(g.is_honeypot))add(100,'GoPlus: HONEYPOT — you can buy but not sell.');
    if(t(g.cannot_sell_all))add(20,'You cannot sell your entire balance.');
    const bt=+g.buy_tax||0,st=+g.sell_tax||0;
    if(st>0.1||bt>0.1)add(25,`High taxes: buy ${(bt*100).toFixed(1)}%, sell ${(st*100).toFixed(1)}%.`);else if(st>0||bt>0)add(5,`Taxes: buy ${(bt*100).toFixed(1)}%, sell ${(st*100).toFixed(1)}%.`);
    if(t(g.is_mintable))op(20,'Contract is mintable — supply can be increased.');
    if(t(g.is_proxy))add(15,'Upgradeable proxy contract — the code can be swapped out later.');
    if(t(g.is_blacklisted))op(12,'Contract has a blacklist function — wallets can be blocked from trading.');
    if(t(g.hidden_owner))add(20,'Hidden owner detected.');
    if(t(g.can_take_back_ownership))add(20,'Ownership can be reclaimed after "renouncing".');
    if(t(g.selfdestruct))add(15,'Contract can self-destruct.');
    if(t(g.slippage_modifiable))op(15,'Owner can change the tax/slippage at any time.');
    if(t(g.transfer_pausable))op(12,'Owner can pause all transfers.');
    if(t(g.owner_change_balance))add(25,'Owner can change wallet balances.');
    if(t(g.external_call))add(5,'Contract makes external calls.');
    if(g.is_open_source==='0')add(20,'Source code is not verified — can\'t see what it does.');else good.push('Source code verified.');
    if(renounced)good.push('Ownership renounced (or no owner).');
    else add(8,`Contract still has an owner (${g.owner_address}).`);
    const lp=g.lp_holders||[];const lockedPct=lp.filter(h=>h.is_locked===1||/^0x0+(dead)?$/i.test(h.address)||/dead$/i.test(h.address)).reduce((s,h)=>s+(+h.percent||0),0)*100;
    const mature=d0&&d0.liquidityUsd>1e6&&d0.ageDays>180;
    if(lp.length){if(lockedPct>=90)good.push(`~${lockedPct.toFixed(0)}% of LP tokens locked/burned.`);else if(mature)flags.push(`Note: only ~${lockedPct.toFixed(0)}% of LP locked, but token is old with deep liquidity (weighted lightly).`);else add(lockedPct<50?15:6,`Only ~${lockedPct.toFixed(0)}% of LP tokens are locked/burned — liquidity could be pulled.`);}
    const holders=(g.holders||[]).filter(h=>h.is_contract!==1&&!h.is_locked);const top10=holders.slice(0,10).reduce((s,h)=>s+(+h.percent||0),0)*100;
    if(holders.length){if(top10>50)add(20,`Top 10 (non-contract) holders own ${top10.toFixed(1)}%.`);else if(top10>30)add(8,`Top 10 (non-contract) holders own ${top10.toFixed(1)}%.`);else good.push(`Top 10 non-contract holders own ${top10.toFixed(1)}%.`);}
    if(+g.creator_percent>0.1)add(10,`Creator still holds ${(g.creator_percent*100).toFixed(1)}%.`);
  } else add(15,'GoPlus has no data for this token on '+chain+'.');
  if(!hp._err){
    if(hp.honeypotResult?.isHoneypot)add(100,'honeypot.is simulation: HONEYPOT — selling failed. '+(hp.honeypotResult.honeypotReason||''));
    else if(hp.simulationSuccess)good.push(`honeypot.is sell simulation passed (buy tax ${(+hp.simulationResult.buyTax).toFixed(1)}%, sell tax ${(+hp.simulationResult.sellTax).toFixed(1)}%).`);
    for(const f of hp.flags||[])flags.push('honeypot.is: '+(f.description||f.flag||JSON.stringify(f)));
  }
  const d=dexSummary(dex,chain);market(flags,d,add,dex);
  return {chain,score:Math.min(100,Math.round(score)),flags,good,market:d,marketUnavailable:!!dex._err,extra:g?{name:g.token_name,symbol:g.token_symbol,holders:g.holder_count}:null,sources};
}
async function analyze(addr,chain){
  addr=addr.trim();
  let r;
  if(/^0x[a-fA-F0-9]{40}$/.test(addr))r=await evm(addr,CHAINS[chain]?chain:null);
  else if(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr))r=await solana(addr);
  else return {error:'Not a valid Solana (base58) or EVM (0x…) address.'};
  r.address=addr;r.verdict=verdict(r.score);r.disclaimer='Automated heuristic check. Not financial advice — always DYOR.';return r;
}
http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://x');
  if(u.pathname==='/api/check'){const r=await analyze(u.searchParams.get('address')||'',u.searchParams.get('chain'));res.writeHead(r.error?400:200,{'content-type':'application/json','access-control-allow-origin':'*'});return res.end(JSON.stringify(r));}
  fs.readFile(path.join(__dirname,'public','index.html'),(e,b)=>{res.writeHead(200,{'content-type':'text/html'});res.end(b)});
}).listen(PORT,()=>console.log('RugCheck app on http://localhost:'+PORT));
