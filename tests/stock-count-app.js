const fs=require("fs"),path=require("path"),REPO="D:/GitHub/ringscript";
const RingScript=require(path.join(REPO,"playground","ringscript.js"));
let bad=0;
const ok=(n,c,d)=>{console.log((c?"  PASS  ":"  FAIL  ")+n+(c||d===undefined?"":"  ["+JSON.stringify(d)+"]"));if(!c)bad++;};
(async()=>{
  const b=fs.readFileSync(path.join(REPO,"playground","ringscript.wasm"));
  const vm=await RingScript.load(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),{onOutput:()=>{}});
  const ev=vm.eval(fs.readFileSync(path.join(REPO,"samples","stock-count","count.ring"),"utf8"));
  if(!ev.ok){console.log("EVAL FAILED:",ev.error);process.exit(1);}
  // The outbox lives in ringscript-pwa now, and Pwa.attach() evals this in
  // the page. Without it the harness tests an app the browser never runs.
  const lib=vm.eval(fs.readFileSync(path.join(REPO,"samples","stock-count","lib","pwa","pwa.ring"),"utf8"));
  if(!lib.ok){console.log("PWA EVAL FAILED:",lib.error);process.exit(1);}
  const call=(f,a)=>{const r=vm.call(f,a===undefined?1:a);
    if(!r.ok)throw new Error(f+": "+r.error);
    return typeof r.result==="string"?JSON.parse(r.result):r.result;};
  vm.call("PwaOutboxDevice","aissata");   // answers a bare string, not JSON

  // What app.js does on Finish: count.ring decides whether the sheet may be
  // sent, the library names and stores it. One call each, which is the
  // boundary the library exists to draw.
  const queue=who=>{const q=call("StockFinish",who||"unknown");
    if(!q.ok)return q;
    const e=call("PwaOutboxAdd",JSON.stringify({kind:"count",payload:q}));
    return {ok:e.ok,id:e.id,lines:q.lines.length};};

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

  let q=queue("aissata");
  ok("queueing an unfinished count is refused", q.ok===0,q);

  call("StockCount",JSON.stringify([["sku","THE-VT"],["counted",300]]));
  p=call("StockProgress",0);
  ok("finishable once all five are counted", p.counted===5&&(p.finishable===1||p.finishable===true),p);

  const d=call("StockDiscrepancies",3);
  ok("worst discrepancy first, by money", d[0].sku==="RIZ-25"&&d.length===3,d);

  q=queue("aissata");
  ok("queue accepted when complete", q.ok===1&&q.lines===5,q);
  ok("one entry still queued", call("PwaOutboxPending")===1);

  const pay=call("PwaOutboxPayload",q.id);
  ok("payload carries every line, wrapped with the id the device made",
     pay.id===q.id&&pay.kind==="count"&&pay.payload.lines.length===5,
     {id:pay.id,lines:pay.payload&&pay.payload.lines&&pay.payload.lines.length});

  call("PwaOutboxSent",q.id);
  ok("sent leaves nothing queued", call("PwaOutboxPending")===0);
  call("PwaOutboxRollback",q.id);
  ok("a failed send goes back to queued", call("PwaOutboxPending")===1);

  // Restart: a new VM, restored from what the page had stored. Two blobs,
  // because there are two owners -- the sheet is count.ring's, the queue is
  // the library's. The page keeps both, so the test restores both.
  const snap=vm.call("StockSnapshot",0).result;
  const qsnap=vm.call("PwaOutboxSnapshot",0).result;
  const vm2=await RingScript.load(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),{onOutput:()=>{}});
  vm2.eval(fs.readFileSync(path.join(REPO,"samples","stock-count","count.ring"),"utf8"));
  vm2.eval(fs.readFileSync(path.join(REPO,"samples","stock-count","lib","pwa","pwa.ring"),"utf8"));
  vm2.call("StockLoad",JSON.stringify(ref));
  vm2.call("StockRestore",snap);
  vm2.call("PwaOutboxRestore",qsnap);
  const p2=typeof vm2.call("StockProgress",0).result==="string"?JSON.parse(vm2.call("StockProgress",0).result):null;
  ok("a restart keeps the counts", p2&&p2.counted===5,p2);
  const o2=JSON.parse(vm2.call("PwaOutboxList",0).result);
  ok("a restart keeps the outbox", o2.length===1&&o2[0].state==="queued",o2);

  console.log(bad?"\n"+bad+" FAILED":"\nAll count.ring checks passed.");
  process.exit(bad?1:0);
})().catch(e=>{console.error("ERROR",e.message);process.exit(1);});
