'use strict';
const $=id=>document.getElementById(id),M=window.MetricMath;
const number=v=>Number.isFinite(v)?v.toLocaleString('en-US',{maximumSignificantDigits:8}):'—';
const money=v=>Number.isFinite(v)?(v<0?'−$':'$')+Math.abs(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
const dollars=v=>Number.isFinite(v)?(v<0?'−$':'$')+Math.abs(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:6}):'—';
const pct=v=>Number.isFinite(v)?v.toLocaleString('en-US',{maximumFractionDigits:4})+'%':'—';
const when=v=>Number.isFinite(v)&&v>0?new Date(v*1000).toLocaleString('zh-CN',{hour12:false}):'未提供';
const text=(id,v)=>$(id).textContent=v;
const el=(tag,value,cls)=>{const e=document.createElement(tag);if(value!==undefined)e.textContent=value;if(cls)e.className=cls;return e;};
const read=id=>{const raw=$(id).value;if(raw.trim()==='')throw Error('请完整填写测算参数');const v=Number(raw);if(!Number.isFinite(v))throw Error('请输入有效数字');return v;};
const storageKey='metric-lp-scenarios-v1';
let market=null,selected=null,binData=null,allocation=null,profits=null,pnl=null,usedApr=null;
let busy=false,requestId=0,lastError='',executionEdited=false,toastTimer;
let scenarios=[];
try{const s=JSON.parse(localStorage.getItem(storageKey)||'[]');if(Array.isArray(s))scenarios=s.filter(v=>v&&v.platform==='metric'&&typeof v.id==='string'&&v.allocation&&Array.isArray(v.profits)&&v.profits.length===9).slice(-60);}catch{}
function pool(){return market?.pools.find(p=>p.id===selected);}
function toast(v){text('toast',v);$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4000);}
async function api(path){const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),50000);try{const r=await fetch(path,{signal:ctl.signal});const d=await r.json();if(!r.ok)throw Error(d.error||'本机接口不可用');return d;}finally{clearTimeout(timer);}}
function notice(){
  const issues=[];if(lastError)issues.push('刷新失败，保留上次成功数据：'+lastError);
  if(market){for(const [k,v]of Object.entries(market.sources)){if(v.stale)issues.push((k==='metadata'?'池子':'网络')+'数据未更新（'+when(v.fetchedAt)+'）'+(v.error?'：'+v.error:''));}if(market.invalidRows)issues.push(market.invalidRows+' 条无效池子记录未展示');}
  $('globalNotice').hidden=!issues.length;text('globalNotice',issues.join('；'));
}
function setChainOptions(){const value=$('chainFilter').value;const options=[el('option','所有网络')];options[0].value='all';for(const c of market.chains){const o=el('option',c.name);o.value=String(c.chainId);options.push(o);}$('chainFilter').replaceChildren(...options);$('chainFilter').value=options.some(o=>o.value===value)?value:'all';}
async function refresh(cached=false){
  if(busy)return;busy=true;$('refresh').disabled=true;text('syncStatus','正在同步 Metric 市场…');
  try{
    const next=await api('/api/markets'+(cached===true?'?cached=1':''));
    if(next.platform!=='metric'||!Array.isArray(next.pools)||!Array.isArray(next.chains))throw Error('数据服务版本不匹配，请使用启动工具重新打开');
    market=next;lastError='';setChainOptions();text('poolCount',next.pools.length);
    for(const[key,id]of[['tvl','totalTvl'],['volume24h','totalVolume']]){const values=next.pools.map(p=>p[key]).filter(Number.isFinite);text(id,values.length?money(values.reduce((a,b)=>a+b,0))+(values.length<next.pools.length?' *':''):'—');}
    text('syncStatus','本机读取于 '+when(next.sources.metadata.fetchedAt)+(next.sources.metadata.stale?' · 缓存':' · 公开接口'));
    if(!pool()){
      const preferred=next.pools.find(p=>p.chainId===4663&&p.base.symbol==='WETH'&&p.quote.symbol==='USDG')||next.pools[0];
      if(preferred)selectPool(preferred.id);else{selected=null;binData=null;requestId++;text('pairTitle','暂未取得池子');text('pairName','等待联网刷新');$('poolLink').removeAttribute('href');calculate();}
    }else{renderHeader();calculate();loadBins(selected);}
    renderPools();
  }catch(e){lastError=e.name==='AbortError'?'连接超时':e.message;text('syncStatus','刷新未完成 · 可重试');}
  finally{busy=false;$('refresh').disabled=false;notice();}
}
function renderPools(){
  const list=$('poolList');list.replaceChildren();if(!market)return;
  const q=$('search').value.trim().toLowerCase(),chain=$('chainFilter').value,tier=$('tierFilter').value,key=$('sort').value;
  const rows=market.pools.filter(p=>(chain==='all'||String(p.chainId)===chain)&&(tier==='all'||p.tier===tier)&&[p.base.symbol,p.quote.symbol,p.address,p.curator,p.chain].join(' ').toLowerCase().includes(q)).sort((a,b)=>(Number.isFinite(b[key])?b[key]:-Infinity)-(Number.isFinite(a[key])?a[key]:-Infinity));
  text('matchCount',rows.length+' 个');
  for(const p of rows){const b=el('button',undefined,'poolbutton'+(p.id===selected?' selected':''));b.dataset.pool=p.id;b.setAttribute('aria-pressed',String(p.id===selected));const left=el('span');left.append(el('span',p.base.symbol+' / '+p.quote.symbol,'pair'),el('span',p.chain+' · '+money(p.tvl),'sub'),el('span',p.address.slice(0,6)+'…'+p.address.slice(-4)+' · '+p.curator,'sub'));const right=el('span',pct(p.apr7d),'rate');right.append(el('small',p.tier));b.append(left,right);b.onclick=()=>selectPool(p.id);list.append(b);}
  if(!rows.length)list.append(el('div',market.pools.length?'没有匹配的池子':'暂无 Metric 数据，请点击刷新。','empty'));
}
function renderHeader(){
  const p=pool();if(!p)return;
  text('pairTitle',p.base.symbol+' / '+p.quote.symbol);text('pairName',p.chain+' · '+p.curator+(p.verified?' · 官方已验证管理人':'')+' · '+p.tier);
  $('poolLink').href=p.url;text('poolApr',pct(p.apr7d));text('dayApr',pct(p.apr24h));text('tradingApr',pct(p.tradingApr7d));
  text('tvl',money(p.tvl));text('volume',money(p.volume24h));text('edge',money(p.edge24h));
  text('health',p.priceStatus+' / '+(p.pauseLevel===0?'未暂停':Number.isInteger(p.pauseLevel)?'暂停级别 '+p.pauseLevel:'状态未知'));
  text('poolDetails','池地址 '+p.address+' · 左币 '+money(p.base.usd)+' / 右币 '+money(p.quote.usd)+' · 入场白名单 '+(p.allowlist===true?'需要':p.allowlist===false?'未启用':'未知')+' · 价差分成：协议 '+pct(p.protocolShare)+'，管理人 '+pct(p.curatorShare)+'（已体现在 LP Edge 口径中）');
  const stale=!p.dataAt||Date.now()/1000-p.dataAt>300;
  text('poolTiming','上游 24h 统计截至 '+when(p.dataAt)+(stale?' · 上游统计时间缺失或超过 5 分钟，当前显示历史数据':'')+' · 美元统计覆盖 '+pct(p.coverage));$('poolTiming').classList.toggle('negative',stale);
  for(const k of ['base','quote'])text(k+'Name',p[k].symbol);
  $('entryMode').options[1].textContent='从 '+p.base.symbol+' 单币配齐';$('entryMode').options[2].textContent='从 '+p.quote.symbol+' 单币配齐';
  text('change0Label',p.base.symbol+' 涨跌幅 %');text('change1Label',p.quote.symbol+' 涨跌幅 %');text('executionLabel','假设平均成交价 · '+p.quote.symbol+' / '+p.base.symbol);
  if(!executionEdited&&p.base.usd>0&&p.quote.usd>0)$('executionPrice').value=p.base.usd/p.quote.usd;
}
function selectPool(id){selected=id;binData=null;requestId++;executionEdited=false;$('lowerBin').replaceChildren();$('upperBin').replaceChildren();$('binChart').replaceChildren();$('binRows').replaceChildren();renderHeader();renderPools();calculate();loadBins(id);}
async function loadBins(id){
  const seq=++requestId;text('binStatus','正在读取所选池子的 Bin 储备…');
  try{const d=await api('/api/bins?pool='+encodeURIComponent(id));if(seq!==requestId||id!==selected)return;binData=d;
    const rows=d.value?.bins;if(!Array.isArray(rows))throw Error(d.error||'暂无 Bin 数据');
    const oldLo=$('lowerBin').value,oldHi=$('upperBin').value;
    for(const field of ['lowerBin','upperBin']){const options=rows.map(b=>{const o=el('option','Bin '+b.index+' · '+pct(b.lowerDeviation)+' ~ '+pct(b.upperDeviation));o.value=String(b.index);return o;});$(field).replaceChildren(...options);}
    if(rows.some(b=>String(b.index)===oldLo)&&rows.some(b=>String(b.index)===oldHi)){$('lowerBin').value=oldLo;$('upperBin').value=oldHi;}
    else if(rows.length){const active=Number.isInteger(d.value.activeBin)?d.value.activeBin:rows[Math.floor(rows.length/2)].index;const near=rows.filter(b=>Math.abs(b.index-active)<=2);$('lowerBin').value=String((near[0]||rows[0]).index);$('upperBin').value=String((near[near.length-1]||rows[rows.length-1]).index);}
    renderBins();calculate();
  }catch(e){if(seq!==requestId||id!==selected)return;binData={...(binData||{}),stale:true,error:e.message};renderBins();calculate();}
}
function renderBins(){
  const p=pool(),rows=binData?.value?.bins||[];if(!p)return;
  const v=binData?.value,stale=binData?.stale||!v?.toTs||Date.now()/1000-v.toTs>300;
  text('activeBin',Number.isInteger(v?.activeBin)?'活跃 Bin '+v.activeBin:'活跃 Bin 暂缺');
  text('binStatus','Bin 本机读取 '+when(binData?.fetchedAt)+' · 上游统计截至 '+when(v?.toTs)+(stale?' · 缓存 / 上游未更新':'')+(binData?.error?' · '+binData.error:''));
  const chart=$('binChart'),table=$('binRows');chart.replaceChildren();table.replaceChildren();
  const values=rows.map(b=>Number.isFinite(b.base)&&Number.isFinite(b.quote)&&p.base.usd>0&&p.quote.usd>0?b.base*p.base.usd+b.quote*p.quote.usd:null),max=Math.max(1,...values.filter(Number.isFinite));
  for(let i=0;i<rows.length;i++){const b=rows[i],lo=Number($('lowerBin').value),hi=Number($('upperBin').value),selected=b.index>=lo&&b.index<=hi;
    const bar=el('button',undefined,'binbar'+(selected?' chosen':'')+(b.index===v.activeBin?' current':''));bar.style.height=(values[i]===null?4:Math.max(4,values[i]/max*100))+'%';bar.title='Bin '+b.index+' · '+money(values[i])+' · APR '+pct(b.apr24h);bar.setAttribute('aria-label',bar.title);bar.setAttribute('aria-pressed',String(selected));bar.onclick=()=>{$('lowerBin').value=String(b.index);$('upperBin').value=String(b.index);calculate();renderBins();};chart.append(bar);
    const tr=el('tr');tr.append(el('td',String(b.index)+(b.index===v.activeBin?' · 活跃':'')),el('td',pct(b.lowerDeviation)+' ~ '+pct(b.upperDeviation)),el('td',number(b.base)),el('td',number(b.quote)),el('td',pct(b.apr24h)),el('td',pct(b.pnlApr24h)));table.append(tr);
  }
}
function renderBinGuide(){
  const p=pool(),v=binData?.value,rows=v?.bins||[];
  const lo=$('lowerBin').value===''?NaN:Number($('lowerBin').value),hi=$('upperBin').value===''?NaN:Number($('upperBin').value);
  const chosen=rows.filter(b=>b.index>=lo&&b.index<=hi),first=chosen[0],last=chosen[chosen.length-1];
  const valid=Number.isInteger(lo)&&Number.isInteger(hi)&&lo<=hi&&chosen.length===hi-lo+1;
  const active=Number.isInteger(v?.activeBin)?rows.find(b=>b.index===v.activeBin):null;
  const stale=!!binData?.stale||!Number.isFinite(v?.toTs)||Date.now()/1000-v.toTs>300;
  const box=$('binPosition'),track=$('binPositionTrack');box.dataset.state='unknown';track.replaceChildren();track.setAttribute('aria-label','等待有效区间及活跃 Bin');
  text('binPositionTitle',valid?'活跃 Bin 信息暂缺':'等待有效的 Bin 区间');
  text('binPositionDetail',valid?'不能据此判断区间内外，请刷新或在 Metric 核对。':'请选择起始和结束 Bin；起始编号不能大于结束编号。');
  text('binPositionTime',v?'上游统计截至 '+when(v.toTs)+(stale?' · 历史 / 缓存快照，不能作为当前成交位置的确认。':' · 按最近快照判断，成交位置可能变化。'):'尚未取得 Bin 快照。');
  if(valid&&active){
    const inside=active.index>=lo&&active.index<=hi;
    const relative=inside?'在所选区间内':active.index<lo?'在所选区间下方（左侧）':'在所选区间上方（右侧）';
    box.dataset.state=stale?'unknown':inside?'inside':'outside';
    text('binPositionTitle',(stale?'历史快照：':'快照位置：')+relative);
    text('binPositionDetail','所选 Bin '+lo+' 至 '+hi+'；活跃 Bin '+active.index+'（'+pct(active.lowerDeviation)+' ~ '+pct(active.upperDeviation)+'）。'+(inside?'范围覆盖活跃格，但不代表所有资金都在成交。':active.index<lo?'所选格通常持有 '+p.base.symbol+'，等待买单向上经过时卖出。':'所选格通常持有 '+p.quote.symbol+'，等待卖单向下经过时买入 '+p.base.symbol+'。')+' 仅实际成交产生 Edge。');
    for(const b of rows){const cell=el('span',b.index===active.index?'●':'');cell.classList.toggle('selected',b.index>=lo&&b.index<=hi);cell.classList.toggle('active',b.index===active.index);cell.title='Bin '+b.index+' · '+pct(b.lowerDeviation)+' ~ '+pct(b.upperDeviation);track.append(cell);}
    track.setAttribute('aria-label','所选 Bin '+lo+' 至 '+hi+'；活跃 Bin '+active.index+' '+relative+'。格子等宽，仅表示编号顺序，不表示价格距离或精确成交点。');
    if(inside&&allocation?.parts.find(b=>b.index===active.index)?.weight===0)text('binPositionDetail',$('binPositionDetail').textContent+' 当前分配方式给活跃格的资金为 0，范围覆盖不等于本方案在该格有资金。');
  }
  const move=Number($('guideMove').value);text('guideMoveValue',(move>=0?'+':'')+move+'%');
  const bounds=valid&&Number.isFinite(first?.lowerDeviation)&&Number.isFinite(last?.upperDeviation);
  text('guideDemoRange',bounds?pct(first.lowerDeviation)+' 至 '+pct(last.upperDeviation):'等待有效的偏离边界');
  text('guideDemoBefore','请选择带有偏离边界的 Bin。');text('guideDemoAfter','缺少数据时不推算实际价格。');
  if(bounds){
    const ref=Number($('guideReference').value),unit=p?p.quote.symbol+' / '+p.base.symbol:'右币 / 左币';
    if(!Number.isFinite(ref)||ref<=0){text('guideDemoBefore','请输入大于 0 的假设参考价。');text('guideDemoAfter','');return;}
    const next=ref*(1+move/100),a=1+first.lowerDeviation/100,b=1+last.upperDeviation/100;
    if(![ref*a,ref*b,next*a,next*b].every(Number.isFinite)){text('guideDemoBefore','输入数值过大，请缩小假设参考价。');text('guideDemoAfter','');return;}
    text('guideDemoBefore','变化前：参考价 '+number(ref)+'，区间 '+number(ref*a)+' ～ '+number(ref*b)+' '+unit);
    text('guideDemoAfter','变化后：参考价 '+number(next)+'，区间 '+number(next*a)+' ～ '+number(next*b)+' '+unit+'。仅参考价变化，代币数量与活跃 Bin 不变。');
  }
}
function calculate(){
  allocation=null;
  try{const p=pool();if(!p)throw Error('等待 Metric 市场数据');const bins=binData?.value?.bins;if(!bins?.length)throw Error('正在等待可用的 Bin 数据，历史 APR 仍可在池子列表查看');
    allocation=M.allocation(p,bins,read('lowerBin'),read('upperBin'),read('capital'),read('entryCost'),$('distribution').value,$('entryMode').value);
    const a=allocation;text('baseAmount',number(a.base));text('quoteAmount',number(a.quote));text('baseValue',money(a.baseValue));text('quoteValue',money(a.quoteValue));text('basePct',pct(a.basePercent));text('quotePct',pct(100-a.basePercent));$('baseBar').style.width=a.basePercent+'%';
    text('allocationNote','扣除入场损耗后入池 '+money(a.net)+'，覆盖 '+a.parts.length+' 个 Bin。币数按 API 储备和当前美元价格估算。');text('binApr',pct(a.binApr));
    const first=a.parts[0],last=a.parts[a.parts.length-1];text('binRange','Bin '+a.lo+' 至 '+a.hi+' · 相对参考价 '+pct(first.lowerDeviation)+' 至 '+pct(last.upperDeviation)+'。点击柱子可选单 Bin，柱高为当前储备美元价值。');
    $('singleEntry').hidden=a.entry==='pair';if(a.entry!=='pair'){const s=p[a.entry].symbol,other=a.entry==='base'?p.quote.symbol:p.base.symbol;text('singleEntry','初始 '+number(a.inputAmount)+' '+s+' → 按现价预计兑换 '+number(a.swapAmount)+' '+s+'，得到 '+number(a.received)+' '+other+'；另计损耗 '+dollars(a.entryCost)+'（折合 '+number(a.costUnits)+' '+s+'）。这是配币估算，不是实时路由报价。');}
    $('calcError').hidden=true;
  }catch(e){text('calcError',e.message);$('calcError').hidden=false;$('singleEntry').hidden=true;for(const id of ['baseAmount','quoteAmount','baseValue','quoteValue','basePct','quotePct','binApr'])text(id,'—');$('baseBar').style.width='0%';text('allocationNote','等待有效配比数据');text('binRange','请选择有效 Bin 区间。');}
  renderBinGuide();renderProjection();
}
function renderProjection(){
  const p=pool(),mode=$('aprMode').value;profits=null;usedApr=null;$('profitRows').replaceChildren();$('aprInput').disabled=mode!=='manual';
  try{usedApr=mode==='manual'?read('aprInput'):mode==='pool7'?p?.apr7d:mode==='pool24'?p?.apr24h:allocation?.binApr;
    if(mode!=='manual')$('aprInput').value=Number.isFinite(usedApr)?String(usedApr):'';
    profits=M.project(allocation,usedApr,read('utilization'),read('cost'));
    for(const r of profits){const tr=el('tr');tr.append(el('td',r.label),el('td',dollars(r.gross)),el('td',dollars(r.net),r.net<0?'negative':'profit'),el('td',pct(r.roi)));$('profitRows').append(tr);}$('projectionError').hidden=true;
  }catch(e){text('projectionError',e.message);$('projectionError').hidden=false;}
  text('projectionNote','假设所选 APR '+pct(usedApr)+' 在整个期间不变，按净入池本金和收入实现比例计算单利。净额扣入场损耗及其他成本各一次，回报率除以原始本金。Metric 实际收益留在仓位中；本表不模拟复投、币价变化或未来成交，历史 APR 不保证个人未来收益。'+(mode==='bins'?' 所选 Bin 是 24h 历史 APR 的资金加权，不是新增资金的真实收益报价。':''));
  renderPnl();
}
function renderPnl(){
  pnl=null;$('pnlResults').hidden=true;$('saveScenario').disabled=true;const trade=$('tradeMode').value;$('tradeControls').hidden=trade==='none';
  try{const a=allocation,p=pool(),change1=read('change1'),fraction=trade==='none'?0:read('tradeFraction'),execution=trade==='none'?1:read('executionPrice'),earned=read('earned'),cost=read('cost');
    pnl=M.outcome(a,read('change0'),change1,trade,fraction,execution,earned,cost);const r=pnl;
    text('positionValue',dollars(r.value));text('positionTokens',number(r.base)+' '+p.base.symbol+' + '+number(r.quote)+' '+p.quote.symbol);text('holdValue',dollars(r.hold));text('tradingPnl',dollars(r.tradingPnl));text('principalPnl',dollars(r.pnl));text('netPnl',dollars(r.net)+' / '+pct(r.roi));
    for(const[id,value]of[['tradingPnl',r.tradingPnl],['principalPnl',r.pnl],['netPnl',r.net]])$(id).className=value<0?'negative':'profit';
    text('pnlAssumption',p.base.symbol+' 假设价格 '+dollars(r.p0)+'，'+p.quote.symbol+' '+dollars(r.p1)+'。'+(trade==='none'?'期间无成交，持币数量不变，因此相对初始配比持币的 Trading PnL 为 0；本金盈亏仍受币价影响。':'使用手动填写的换币比例与平均成交价，不是根据涨幅推断成交。')+' Metric 的区间随参考价移动，没有 Fables 式固定上界收益封顶。');
    text('singleHoldNote',r.singleHold===null?'':'如果原单币一直持有：'+dollars(r.singleHold)+'；本情景净结果比原单币 '+(r.singleDifference>=0?'多 ':'少 ')+dollars(Math.abs(r.singleDifference))+'。此项与 Trading PnL 的初始双币基准不同。');
    $('pnlRows').replaceChildren();for(const c of [...new Set([-50,-20,0,10,25,50,100,r.change0])].sort((a,b)=>a-b)){const v=M.outcome(a,c,change1,trade,fraction,execution,earned,cost),tr=el('tr');tr.append(el('td',pct(c)+(c===r.change0?' · 当前假设':'')),...['value','hold','tradingPnl','pnl','net'].map(k=>el('td',dollars(v[k]),v[k]<0?'negative':k==='net'?'profit':'')));$('pnlRows').append(tr);}
    $('pnlError').hidden=true;$('pnlResults').hidden=false;$('saveScenario').disabled=!profits;
  }catch(e){text('pnlError',e.message);$('pnlError').hidden=false;}
}
function persist(){try{localStorage.setItem(storageKey,JSON.stringify(scenarios));return true;}catch{toast('浏览器保存失败，请立即导出 CSV');return false;}}
function save(){
  if(!allocation||!profits||!pnl)return;if(scenarios.length>=60){toast('最多保留 60 个方案，请导出后删除旧方案');return;}
  const p=pool();scenarios.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2),platform:'metric',createdAt:Date.now()/1000,pool:p.id,pair:p.base.symbol+'/'+p.quote.symbol,chain:p.chain,url:p.url,
    fetchedAt:market.sources.metadata.fetchedAt,dataAt:p.dataAt,binDataAt:binData?.value?.toTs,stale:!!(lastError||market.sources.metadata.stale||binData?.stale||!p.dataAt||Date.now()/1000-p.dataAt>300||!binData?.value?.toTs||Date.now()/1000-binData.value.toTs>300),
    allocation:JSON.parse(JSON.stringify(allocation)),apr:usedApr,aprMode:$('aprMode').value,utilization:read('utilization'),cost:read('cost'),profits:profits.map(x=>({...x})),pnl:{...pnl}});
  const ok=persist();renderScenarios();if(ok)toast('已保存 Metric 方案及涨跌情景');
}
function renderScenarios(){
  const head=el('tr');for(const h of ['池子 / 时间','投入 / Bin / 配比','APR / 假设','涨跌情景净盈亏',...M.intervals.map(x=>x[0]+'净额'),'操作'])head.append(el('th',h));$('scenarioHead').replaceChildren(head);$('scenarioRows').replaceChildren();$('emptyScenarios').hidden=!!scenarios.length;$('export').disabled=!scenarios.length;
  for(const s of scenarios){const a=s.allocation,tr=el('tr'),pair=el('td',s.pair),capital=el('td',money(a.capital)),rate=el('td',pct(s.apr)),result=el('td',dollars(s.pnl?.net));pair.append(el('small',s.chain+' · '+s.pool.split(':')[1]),el('small',when(s.createdAt)),el('small',s.stale?'保存时含缓存 / 上游历史数据':'保存时的数据快照'));capital.append(el('small','Bin '+a.lo+' ~ '+a.hi),el('small',number(a.base)+' / '+number(a.quote)),el('small','入场损耗 '+money(a.entryCost)));rate.append(el('small',s.aprMode+' · 实现 '+s.utilization+'%'),el('small','其他成本 '+money(s.cost)));result.append(el('small','左币 '+pct(s.pnl?.change0)+' / 右币 '+pct(s.pnl?.change1)),el('small','相对持币 '+dollars(s.pnl?.tradingPnl)));tr.append(pair,capital,rate,result,...s.profits.map(r=>el('td',dollars(r.net),r.net<0?'negative':'profit')));const cell=el('td'),b=el('button','删除');b.onclick=()=>{scenarios=scenarios.filter(x=>x.id!==s.id);persist();renderScenarios();};cell.append(b);tr.append(cell);$('scenarioRows').append(tr);}
  try{$('exportLegacy').hidden=!localStorage.getItem('fables-lp-scenarios-v1');}catch{}
}
function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type})),a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
function exportCsv(){
  if(!scenarios.length)return;
  const headers=['平台','网络','池子ID','币对','保存时间','市场读取时间','上游统计时间','Bin统计时间','含历史数据','投入USD','净入池USD','入场方式','入场损耗USD','起始Bin','结束Bin','资金分配方式','左币数量','右币数量','左币USD','右币USD','APR%','APR来源','收入实现比例%','其他成本USD',...M.intervals.flatMap(x=>[x[0]+'收入USD',x[0]+'净额USD']),'左币涨跌%','右币涨跌%','成交假设','换币比例%','成交价右币每左币','额外收入USD','情景仓位USD','初始配比持有USD','TradingPnLUSD','本金盈亏USD','净盈亏USD','原单币持有USD','相对原单币净差额USD'];
  const rows=scenarios.map(s=>{const a=s.allocation,r=s.pnl||{};return ['metric',s.chain,s.pool,s.pair,when(s.createdAt),when(s.fetchedAt),when(s.dataAt),when(s.binDataAt),s.stale?'是':'否',a.capital,a.net,a.entry,a.entryCost,a.lo,a.hi,a.distribution,a.base,a.quote,a.p0,a.p1,s.apr,s.aprMode,s.utilization,s.cost,...s.profits.flatMap(v=>[v.gross,v.net]),r.change0,r.change1,r.trade,r.fraction,r.executionPrice,r.earned,r.value,r.hold,r.tradingPnl,r.pnl,r.net,r.singleHold,r.singleDifference];});
  const quote=v=>{let s=String(v??'');if(typeof v==='string'&&/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};download('\ufeff'+[headers,...rows].map(r=>r.map(quote).join(',')).join('\r\n'),'Metric-LP-方案.csv','text/csv;charset=utf-8');
}
$('refresh').onclick=()=>refresh();for(const id of ['search','chainFilter','tierFilter','sort'])$(id).addEventListener('input',renderPools);
for(const id of ['guideReference','guideMove'])$(id).addEventListener('input',renderBinGuide);
for(const id of ['capital','entryCost','entryMode','distribution','lowerBin','upperBin'])$(id).addEventListener('input',()=>{calculate();if(id.endsWith('Bin'))renderBins();});
for(const id of ['aprInput','utilization','cost'])$(id).addEventListener('input',renderProjection);
$('aprMode').onchange=()=>{if($('aprMode').value==='manual'&&!$('aprInput').value)$('aprInput').value='50';renderProjection();};
for(const id of ['change0','change1','tradeMode','tradeFraction','earned'])$(id).addEventListener('input',renderPnl);
$('executionPrice').oninput=()=>{executionEdited=true;renderPnl();};
$('capitalPresets').onclick=e=>{if(e.target.dataset.value){$('capital').value=e.target.dataset.value;calculate();}};
$('pricePresets').onclick=e=>{if(e.target.dataset.change!==undefined){$('change0').value=e.target.dataset.change;renderPnl();}};
$('binPresets').onclick=e=>{const preset=e.target.dataset.bin,rows=binData?.value?.bins;if(!preset||!rows?.length)return;const active=binData.value.activeBin;let chosen=preset==='all'?rows:rows.filter(b=>Math.abs(b.index-active)<=(preset==='active'?0:2));if(!Number.isInteger(active)&&preset!=='all')chosen=[];if(!chosen.length){toast('没有对应的 Bin 数据');return;}$('lowerBin').value=String(chosen[0].index);$('upperBin').value=String(chosen[chosen.length-1].index);calculate();renderBins();};
$('saveScenario').onclick=save;$('export').onclick=exportCsv;
$('exportLegacy').onclick=()=>{try{const raw=localStorage.getItem('fables-lp-scenarios-v1');if(raw)download(raw,'Fables-原方案备份.json','application/json');}catch{toast('无法读取原方案');}};
$('auto').onchange=()=>{if($('auto').checked)refresh();};
setInterval(()=>{notice();if($('auto').checked&&!document.hidden)refresh();},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&$('auto').checked)refresh();});
renderScenarios();refresh(true).then(()=>refresh());
