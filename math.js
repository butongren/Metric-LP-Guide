(function(root){
  'use strict';
  const intervals=[['10 分钟',10],['30 分钟',30],['1 小时',60],['4 小时',240],['8 小时',480],['12 小时',720],['24 小时',1440],['15 天',21600],['30 天',43200]];
  function positive(v,name){if(!Number.isFinite(v)||v<=0)throw Error(name+'必须大于 0');}
  function nonnegative(v,name){if(!Number.isFinite(v)||v<0)throw Error(name+'必须是非负数');}
  function allocation(pool,bins,lo,hi,capital,entryCost=0,distribution='reserve',entry='pair'){
    positive(capital,'投入本金');nonnegative(entryCost,'入场损耗');
    if(entryCost>=capital)throw Error('入场损耗必须小于本金');
    if(!Number.isInteger(lo)||!Number.isInteger(hi)||lo>hi)throw Error('请选择有效的起止 Bin');
    if(!['reserve','equal'].includes(distribution)||!['pair','base','quote'].includes(entry))throw Error('入场或分配模式无效');
    const p0=pool.base.usd,p1=pool.quote.usd;positive(p0,'左币美元价格');positive(p1,'右币美元价格');
    const selected=bins.filter(b=>b.index>=lo&&b.index<=hi);
    if(!selected.length||selected.length!==hi-lo+1)throw Error('所选区间缺少 Bin 数据，暂不能计算完整配比');
    const values=selected.map(b=>{nonnegative(b.base,'Bin 左币储备');nonnegative(b.quote,'Bin 右币储备');return b.base*p0+b.quote*p1;});
    const total=values.reduce((x,y)=>x+y,0);positive(total,'所选 Bin 储备价值');
    if(distribution==='equal'&&values.some(v=>v===0))throw Error('空 Bin 无现有配比，请缩小范围或使用按储备分配');
    const net=capital-entryCost;
    const parts=selected.map((b,i)=>{const weight=distribution==='equal'?1/selected.length:values[i]/total,usd=net*weight,scale=values[i]>0?usd/values[i]:0;return {...b,usd,weight,depositBase:b.base*scale,depositQuote:b.quote*scale};});
    const base=parts.reduce((n,b)=>n+b.depositBase,0),quote=parts.reduce((n,b)=>n+b.depositQuote,0);
    const funded=parts.filter(b=>b.weight>0);
    const binApr=funded.every(b=>b.baseline&&Number.isFinite(b.apr24h))?funded.reduce((n,b)=>n+b.apr24h*b.weight,0):null;
    const a={base,quote,capital,net,entryCost,p0,p1,baseValue:base*p0,quoteValue:quote*p1,basePercent:base*p0/net*100,lo,hi,parts,binApr,entry,distribution};
    if(entry!=='pair'){
      const unit=entry==='base'?p0:p1;
      a.inputAmount=capital/unit;a.swapAmount=(entry==='base'?a.quoteValue:a.baseValue)/unit;
      a.received=entry==='base'?quote:base;a.costUnits=entryCost/unit;
    }
    if(![base,quote,a.baseValue,a.quoteValue].every(Number.isFinite))throw Error('数值超出测算范围');
    return a;
  }
  function project(a,apr,utilization,cost){
    if(!a)throw Error('请先计算有效入场配比');
    if(!Number.isFinite(apr))throw Error('APR 缺失，可切换到手动假设');
    if(!Number.isFinite(utilization)||utilization<0||utilization>100)throw Error('收入实现比例必须为 0～100%');
    nonnegative(cost,'其他成本');
    return intervals.map(([label,minutes])=>{const gross=a.net*apr/100*minutes/525600*utilization/100,net=gross-a.entryCost-cost;if(!Number.isFinite(net))throw Error('收益超出测算范围');return {label,minutes,gross,net,roi:net/a.capital*100};});
  }
  function outcome(a,change0,change1,trade='none',fraction=0,executionPrice=1,earned=0,cost=0){
    if(!a)throw Error('请先计算有效入场配比');
    if(![change0,change1].every(v=>Number.isFinite(v)&&v>=-100))throw Error('涨跌幅不能低于 -100%');
    if(!['none','sell','buy'].includes(trade))throw Error('未知交易假设');
    if(!Number.isFinite(fraction)||fraction<0||fraction>100)throw Error('换币比例必须为 0～100%');
    nonnegative(earned,'额外累计收入');nonnegative(cost,'其他成本');
    let base=a.base,quote=a.quote;
    if(trade!=='none'){
      positive(executionPrice,'假设平均成交价');
      if(trade==='sell'){const sold=base*fraction/100;base-=sold;quote+=sold*executionPrice;}
      else{const spent=quote*fraction/100;quote-=spent;base+=spent/executionPrice;}
    }
    const p0=a.p0*(1+change0/100),p1=a.p1*(1+change1/100);
    const value=base*p0+quote*p1,hold=a.base*p0+a.quote*p1,tradingPnl=value-hold,pnl=value-a.capital,net=pnl+earned-cost;
    const singleHold=a.entry==='pair'?null:a.inputAmount*(a.entry==='base'?p0:p1);
    const r={base,quote,p0,p1,value,hold,tradingPnl,pnl,net,roi:net/a.capital*100,change0,change1,trade,fraction,executionPrice,earned,cost,singleHold,singleDifference:singleHold===null?null:value+earned-cost-singleHold};
    if(![base,quote,value,hold,pnl,net].every(Number.isFinite))throw Error('盈亏超出测算范围');
    return r;
  }
  root.MetricMath={allocation,project,outcome,intervals};
})(typeof window==='undefined'?globalThis:window);
