const ws=new WebSocket('ws://127.0.0.1:64199/devtools/page/target-1');
const jobs=new Map();
ws.onopen=()=>{for(const [id,method,params] of [[1,'Page.getLayoutMetrics',{}],[2,'Runtime.evaluate',{expression:'JSON.stringify({url:location.href,y:scrollY,ready:document.readyState})',returnByValue:true}],[3,'Page.captureScreenshot',{format:'bgra',captureBeyondViewport:false}]]){jobs.set(id,{method,start:Date.now()});ws.send(JSON.stringify({id,method,params}));}};
ws.onmessage=e=>{const r=JSON.parse(e.data);if(!jobs.has(r.id))return;const j=jobs.get(r.id);console.log(j.method,Date.now()-j.start,JSON.stringify(r).slice(0,1400));jobs.delete(r.id);if(!jobs.size){ws.close();process.exit(0);}};
setTimeout(()=>{console.log('TIMEOUT',[...jobs.values()]);ws.close();process.exit(1)},8000);
