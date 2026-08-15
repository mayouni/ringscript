const fs=require("fs"),path=require("path"),REPO="D:/GitHub/ringscript";
const RingScript=require(path.join(REPO,"playground","ringscript.js"));
let bad=0;
const ok=(n,c,d)=>{console.log((c?"  PASS  ":"  FAIL  ")+n+(c||d===undefined?"":"  ["+JSON.stringify(d)+"]"));if(!c)bad++;};
(async()=>{
  const b=fs.readFileSync(path.join(REPO,"playground","ringscript.wasm"));
  const vm=await RingScript.load(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),{onOutput:()=>{}});
  const ev=vm.eval(fs.readFileSync(path.join(REPO,"samples","stock-count","count.ring"),"utf8"));
  if(!ev.ok){console.log("EVAL FAILED:",ev.error);process.exit(1);}
  const call=(f,a)=>{const r=vm.call(f,a===undefined?1:a);
    if(!r.ok)throw new Error(f+": "+r.error);
    return typeof r.result==="string"?JSON.parse(r.result):r.result;};

  // sku, name, expected, unit cost
  const ref=[["SAV-01","Savon de Marseille",120,350],["RIZ-25","Riz 25kg",40,14500],
             ["HUI-5L","Huile 5L",25,6200],["SUC-1K","Sucre 1kg",200,750],
             ["THE-VT","The vert",300,400]];
  ok("load returns the count", call("StockLoad",JSON.stringify(ref))===5);

  let v=call("StockCount",JSON.stringify([["sku","SAV-01"],["counted",120]]));
  ok("exact count is a match", v.ok===1&&v.verdict==="match"&&v.variance===0,v);

  v=call("StockCount",JSON.stringify([["sku","SUC-1K"],["counted",197]]));
  ok("small shortage is 'short', not flagged", v.verdict==="short"&&v.variance===-3&&v.variance_value===-2250,v);

  v=call("StockCount",JSON.stringify([["sku","RIZ-25"],["counted",39]]));
  ok("shortage over the money threshold investigates", v.verdict==="investigate"&&v.variance_value===-14500,v);

  v=call("StockCount",JSON.stringify([["sku","HUI-5L"],["counted",27]]));
  ok("overage is 'over'", v.verdict==="over"&&v.variance===2,v);

  v=call("StockCount",JSON.stringify([["sku","NOPE"],["counted",1]]));
  ok("unknown sku refused", v.ok===0,v);
  v=call("StockCount",JSON.stringify([["sku","THE-VT"],["counted",-4]]));
  ok("negative refused", v.ok===0,v);
  v=call("StockCount",JSON.stringify([["sku","THE-VT"],["counted",2.5]]));
  ok("fraction refused", v.ok===0,v);

  let p=call("StockProgress",0);
  ok("progress counts only counted lines", p.counted===4&&p.remaining===1,p);
  ok("progress flags the serious one", p.flagged===1&&p.short===2&&p.over===1,p);
  ok("not finishable until every line is counted", p.finishable===0||p.finishable===false,p);

  let q=call("StockQueue","aissata");
  ok("queueing an unfinished count is refused", q.ok===0,q);

  call("StockCount",JSON.stringify([["sku","THE-VT"],["counted",300]]));
  p=call("StockProgress",0);
  ok("finishable once all five are counted", p.counted===5&&(p.finishable===1||p.finishable===true),p);

  const d=call("StockDiscrepancies",3);
  ok("worst discrepancy first, by money", d[0].sku==="RIZ-25"&&d.length===3,d);

  q=call("StockQueue","aissata");
  ok("queue accepted when complete", q.ok===1&&q.lines===5,q);
  ok("one entry still queued", call("StockStillQueued",0)===1);

  const pay=call("StockPayload",q.id);
  ok("payload carries every line and the device id", pay.lines.length===5&&pay.id===q.id,{id:pay.id});

  call("StockSent",q.id);
  ok("sent leaves nothing queued", call("StockStillQueued",0)===0);
  call("StockRollback",q.id);
  ok("a failed send goes back to queued", call("StockStillQueued",0)===1);

  // restart: a new VM, restored from the snapshot the page had stored
  const snap=vm.call("StockSnapshot",0).result;
  const vm2=await RingScript.load(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),{onOutput:()=>{}});
  vm2.eval(fs.readFileSync(path.join(REPO,"samples","stock-count","count.ring"),"utf8"));
  vm2.call("StockLoad",JSON.stringify(ref));
  vm2.call("StockRestore",snap);
  const p2=typeof vm2.call("StockProgress",0).result==="string"?JSON.parse(vm2.call("StockProgress",0).result):null;
  ok("a restart keeps the counts", p2&&p2.counted===5,p2);
  const o2=JSON.parse(vm2.call("StockOutbox",0).result);
  ok("a restart keeps the outbox", o2.length===1&&o2[0].state==="queued",o2);

  console.log(bad?"\n"+bad+" FAILED":"\nAll count.ring checks passed.");
  process.exit(bad?1:0);
})().catch(e=>{console.error("ERROR",e.message);process.exit(1);});
