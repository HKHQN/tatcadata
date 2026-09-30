/**
 * Delta merge: chỉ ghi nhánh mới/thay đổi; giữ nguyên dữ liệu cũ khi trùng.
 * Mảng object ưu tiên khóa original, sau đó id; primitive/object không khóa dùng canonical JSON.
 * Lưu ý: Firebase update nhiều batch không phải một transaction toàn cục.
 */
(function (global) {
  "use strict";
  const BATCH_SIZE = 250, YIELD_MS = 10, CONCURRENCY = 3;
  const isObject = v => v !== null && typeof v === "object";
  const isPlain = v => isObject(v) && !Array.isArray(v);
  const pathJoin = (p,k) => p ? p + "/" + String(k).replace(/[.#$\[\]]/g, c => encodeURIComponent(c)) : String(k).replace(/[.#$\[\]]/g, c => encodeURIComponent(c));
  const pause = () => new Promise(resolve => setTimeout(resolve, 0));

  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
    return "{" + Object.keys(value).sort().map(k => JSON.stringify(k)+":"+stableStringify(value[k])).join(",") + "}";
  }
  function keyOf(item) {
    if (isPlain(item)) {
      if (item.original !== undefined && item.original !== null) return "original:" + String(item.original);
      if (item.id !== undefined && item.id !== null) return "id:" + String(item.id);
    }
    return "value:" + stableStringify(item);
  }
  function countNodes(root) {
    let count=0, stack=[root];
    while(stack.length){const v=stack.pop(); if(!isObject(v))continue;
      const keys=Object.keys(v); count+=keys.length; for(const k of keys)stack.push(v[k]);}
    return Math.max(1,count);
  }
  async function merge(ref,current,incoming,onProgress=()=>{}) {
    if (!isObject(incoming)) throw new Error("JSON gốc phải là object hoặc array.");
    const root=current == null ? (Array.isArray(incoming)?[]:{}) : current;
    const stats={added:0,updated:0,skipped:0,done:0,total:countNodes(incoming)};
    const ops=Object.create(null); let lastYield=performance.now();
    const report=(phase,f)=>onProgress(phase,Math.max(0,Math.min(1,f)),stats);
    function put(path,value,kind="updated"){ops[path]=value; if(kind==="added")stats.added++; else stats.updated++;}
    async function walk(oldVal,newVal,path) {
      if(newVal === undefined) return;
      if(oldVal === undefined || oldVal === null){put(path,newVal,"added");stats.done++;return;}
      if(Array.isArray(oldVal)&&Array.isArray(newVal)){
        const index=new Map();
        for(let i=0;i<oldVal.length;i++) index.set(keyOf(oldVal[i]),i);
        let appendAt=oldVal.length;
        for(const item of newVal){
          const key=keyOf(item), at=index.get(key); stats.done++;
          if(at===undefined){index.set(key,appendAt);put(pathJoin(path,appendAt++),item,"added");}
          else if(at>=oldVal.length || stableStringify(oldVal[at])===stableStringify(item)){stats.skipped++;}
          else if(isPlain(oldVal[at])&&isPlain(item)){const before=Object.keys(ops).length;await walk(oldVal[at],item,pathJoin(path,at));if(Object.keys(ops).length===before)stats.skipped++;}
          else stats.skipped++;
          if(performance.now()-lastYield>YIELD_MS){report("analyze",stats.done/stats.total*.98);await pause();lastYield=performance.now();}
        } return;
      }
      if(isPlain(oldVal)&&isPlain(newVal)){
        for(const key of Object.keys(newVal)){stats.done++;await walk(oldVal[key],newVal[key],pathJoin(path,key));
          if(performance.now()-lastYield>YIELD_MS){report("analyze",stats.done/stats.total*.98);await pause();lastYield=performance.now();}}
        return;
      }
      if(stableStringify(oldVal)===stableStringify(newVal)){stats.skipped++;return;}
      put(path,newVal,"updated");
    }
    // Mismatch at root: merge by replacing root intentionally, never silently destroy existing tree.
    if(Array.isArray(root)!==Array.isArray(incoming)){
      throw new Error("Kiểu dữ liệu gốc không tương thích (object/array). Không ghi đè để tránh mất dữ liệu.");
    }
    await walk(root,incoming,"");
    report("analyze",1);
    const keys=Object.keys(ops), batches=[];
    for(let i=0;i<keys.length;i+=BATCH_SIZE)batches.push(keys.slice(i,i+BATCH_SIZE));
    let cursor=0,completed=0;
    async function worker(){while(cursor<batches.length){const batch=batches[cursor++],patch={};
      for(const k of batch)patch[k]=ops[k];
      await ref.update(patch);completed++;report("write",completed/Math.max(1,batches.length));}}
    await Promise.all(Array.from({length:Math.min(CONCURRENCY,batches.length)},worker));
    report("write",1);
    return stats;
  }
  global.MergeEngine={merge};
})(window);
