// BrickSort — 抽屜地圖
// searchDrawer（含巢狀 renderSide）, renderDrawerMap, renderSlotNav 等
// 全域作用域：使用傳統 <script src> 載入，禁止 ES Module

function searchDrawer(d){
  const pad=String(d).padStart(3,'0'), plain=String(d);
  const matchSlot=s=>s===pad||s===plain||s===pad+'a'||s===pad+'b'||s===plain+'a'||s===plain+'b';
  const results=allItems.filter(i=>matchSlot(i.slot||''));

  // Group by side: a, b, or full drawer
  const sides={a:[],b:[],full:[]};
  results.forEach(i=>{
    const s=i.slot||'';
    if(s.endsWith('a'))sides.a.push(i);
    else if(s.endsWith('b'))sides.b.push(i);
    else sides.full.push(i);
  });
  // [v20am] Include pickup items in drawer detail
  allItems.forEach(i=>{
    const ps=i.pickupSlot||'';
    if(!matchSlot(ps))return;
    const w={designId:i.designId,name:'\u270B '+i.designId+' '+(i.nameCN||i.name||''),nameCN:i.nameCN,estimateVolumeMl:i.estimateVolumeMl,quantity:i.pickupQty||0,thumbnailUrl:i.thumbnailUrl,imageData:i.imageData,_isPickup:true,id:i.id,slot:i.slot,slotType:i.slotType||'small',overflowSlot:'',overflowQty:0};
    if(ps.endsWith('a'))sides.a.push(w);
    else if(ps.endsWith('b'))sides.b.push(w);
    else sides.full.push(w);
    results.push(w);
  });

  const totalVol=results.reduce((s,i)=>s+(i.estimateVolumeMl||0)*(i.quantity||1),0);
  const drawerCap=DRAWER_ML; // 248ml for full drawer
  const slotCap=SLOT_ML; // 124ml per side

  // Navigation: prev/next drawer (1-450)
  const prev=d>1?String(d-1):null;
  const next=d<450?String(d+1):null;
  let html=renderSlotNav({prev:prev,next:next,label:'抽屜 '+d});

  html+='<div style="margin-bottom:16px">';
  html+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span class="slot-badge slot-small" style="font-size:16px;padding:6px 14px">抽屜 '+d+'</span>';
  html+='<span style="font-family:var(--mono);font-size:13px;color:var(--muted)">'+results.length+' 種零件 · '+Math.round(totalVol)+'ml / '+Math.round(drawerCap)+'ml</span></div>';

  // Full drawer capacity bar
  const drawerPct=Math.min(100,Math.round(totalVol/drawerCap*100));
  const drawerColor=drawerPct>90?'var(--red)':drawerPct>70?'var(--orange)':'var(--green)';
  html+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><div style="flex:1;height:6px;background:var(--surface);border-radius:3px;overflow:hidden"><div style="width:'+drawerPct+'%;height:100%;background:'+drawerColor+';border-radius:3px"></div></div><span style="font-family:var(--mono);font-size:11px;color:var(--muted)">'+drawerPct+'%</span></div>';
  html+='</div>';

  function renderSide(label,items,cap){
    const vol=items.reduce((s,i)=>s+(i.estimateVolumeMl||0)*(i.quantity||1),0);
    const pct=Math.min(100,Math.round(vol/cap*100));
    const color=pct>90?'var(--red)':pct>70?'var(--orange)':'var(--green)';
    const border=vol>cap?'border:2px solid var(--red);box-shadow:0 0 8px rgba(239,68,68,0.3)':'border:1px solid var(--border)';
    let h='<div style="background:var(--card);'+border+';border-radius:10px;padding:12px;margin-bottom:8px">';
    h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-family:var(--mono);font-size:13px;font-weight:700;color:var(--accent)">'+label+'</span><span style="font-size:12px;color:var(--muted)">'+items.length+' 種</span></div>';
    h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><div style="flex:1;height:4px;background:var(--surface);border-radius:2px;overflow:hidden"><div style="width:'+pct+'%;height:100%;background:'+color+';border-radius:2px"></div></div><span style="font-family:var(--mono);font-size:10px;color:'+(vol>cap?'var(--red)':'var(--muted)')+'">'+Math.round(vol)+'/'+Math.round(cap)+'ml</span></div>';
    if(items.length){h+=items.map(partRowHTML).join('')}
    else{h+='<div style="color:var(--dim);font-size:12px;padding:8px 0">空</div>'}
    h+='</div>';
    return h;
  }

  if(sides.full.length>0){
    // Full drawer (no a/b split) — offer split button
    html+=renderSide(pad,sides.full,drawerCap);
    html+='<div style="background:var(--card);border:1px dashed var(--border);border-radius:10px;padding:10px;margin-bottom:8px;text-align:center">';
    html+='<button class="btn btn-sm btn-primary" onclick="splitDrawer('+d+')" style="font-size:12px;padding:8px 16px">✂️ 分割為 '+pad+'a / '+pad+'b（原物品→ '+pad+'a）</button>';
    html+='<div style="font-size:10px;color:var(--muted);margin-top:6px">分割後 b 分格為空，可放新物品</div>';
    html+='</div>';
  } else {
    html+=renderSide(pad+'a',sides.a,slotCap);
    html+=renderSide(pad+'b',sides.b,slotCap);
    // Offer "擴展獨佔" button only when:
    //   - One side has EXACTLY 1 item
    //   - The other side is EMPTY
    // This prevents multi-item full-drawer bugs.
    const aEmpty=sides.a.length===0, bEmpty=sides.b.length===0;
    const canExpand=(aEmpty&&sides.b.length===1)||(bEmpty&&sides.a.length===1);
    if(canExpand){
      const soleItem=aEmpty?sides.b[0]:sides.a[0];
      const fromSide=aEmpty?'b':'a';
      html+='<div style="background:var(--card);border:1px dashed var(--green);border-radius:10px;padding:10px;margin-bottom:8px;text-align:center">';
      html+='<button class="btn btn-sm btn-green" onclick="mergeDrawer('+d+')" style="font-size:12px;padding:8px 16px">🔗 擴展獨佔整格 '+pad+'（容量 124→248ml）</button>';
      html+='<div style="font-size:10px;color:var(--muted);margin-top:6px">「'+((soleItem.nameCN||soleItem.name||'').substring(0,20))+'」將從 '+pad+fromSide+' 移到 '+pad+'（整格）</div>';
      html+='</div>';
    }else if((aEmpty&&!bEmpty)||(!aEmpty&&bEmpty)){
      // Side has >1 items — can't merge (would create multi-item full-drawer bug)
      const occupiedSide=aEmpty?'b':'a';
      const cnt=aEmpty?sides.b.length:sides.a.length;
      html+='<div style="background:var(--card);border:1px dashed var(--border);border-radius:10px;padding:10px;margin-bottom:8px;text-align:center">';
      html+='<div style="font-size:11px;color:var(--orange)">⚠ '+pad+occupiedSide+' 有 '+cnt+' 件物品，無法擴展為獨佔整格</div>';
      html+='<div style="font-size:10px;color:var(--muted);margin-top:6px">獨佔整格只能放單一物品。請先移走其他物品</div>';
      html+='</div>';
    }
  }

  document.getElementById('search-title').textContent='抽屜 '+d+'：'+results.length+' 筆';
  document.getElementById('search-results').innerHTML=html;
  showScreen('s-search');
  attachSwipeNav(prev,next);
}

// Split a full drawer "249" into "249a" (keeps all original items) + "249b" (empty)
async function splitDrawer(d){
  const pad=String(d).padStart(3,'0'), plain=String(d);
  const items=allItems.filter(i=>i.slot===pad||i.slot===plain);
  // [v20aw] Pickup downgrade split
  const pickupItem=allItems.find(i=>i.pickupSlot===pad||i.pickupSlot===plain);
  if(pickupItem){
    const vol=pickupItem.estimateVolumeMl||0;
    const currentQty=pickupItem.pickupQty||0;
    const maxQtyHalf=vol>0?Math.floor(SLOT_ML/vol):0;
    if(maxQtyHalf===0){showToast('\u62BD\u5C5C '+pad+' \u70BA\u5FEB\u53D6\u9EDE\uFF0C\u96F6\u4EF6\u7121\u9AD4\u7A4D\u8CC7\u6599\uFF0C\u7121\u6CD5\u8A08\u7B97\u5206\u5272');return}
    const returnQty=Math.max(0,currentQty-maxQtyHalf);
    if(!confirm('\u62BD\u5C5C '+pad+' \u70BA\u5FEB\u53D6\u9EDE ('+pickupItem.designId+', '+currentQty+'\u4EF6)\n\n'+
      '\u5206\u5272\u5F8C\u5FEB\u53D6\u964D\u7D1A\u70BA '+pad+'a (\u7D04'+maxQtyHalf+'\u4EF6)\n'+
      returnQty+'\u4EF6\u9000\u56DE\u4E3B\u4F4D '+pickupItem.slot+'\n'+
      pad+'b \u91CB\u51FA\u4F9B\u65B0\u7269\u54C1\u4F7F\u7528\n\n'+
      '\u78BA\u5B9A\u5206\u5272\uFF1F')){return}
    pickupItem.pickupSlot=pad+'a';
    pickupItem.pickupQty=maxQtyHalf;
    const fbUrl='https://firestore.googleapis.com/v1/projects/'+cfg.fbProject+'/databases/(default)/documents/'+cfg.fbCol+'/'+pickupItem.id+'?updateMask.fieldPaths=pickupSlot&updateMask.fieldPaths=pickupQty&key='+cfg.fbApiKey;
    try{
      await fetch(fbUrl,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:{pickupSlot:{stringValue:pad+'a'},pickupQty:{integerValue:maxQtyHalf}}})});
      showToast('\u2705 \u5FEB\u53D6\u964D\u7D1A\u70BA '+pad+'a ('+maxQtyHalf+'\u4EF6)\n\u8ACB\u5F9E '+pad+' \u53D6\u51FA '+returnQty+' \u4EF6\u653E\u56DE '+pickupItem.slot);
    }catch(e){showToast('\u66F4\u65B0\u5931\u6557: '+e.message,'error')}
    searchDrawer(d);
    return;
  }
  if(items.length===0){showToast('\u62BD\u5C5C '+pad+' \u6C92\u6709\u7269\u54C1','error');return}
  if(!confirm('將抽屜 '+pad+' 分割為 '+pad+'a / '+pad+'b\n\n原 '+items.length+' 件物品會移到 '+pad+'a\n'+pad+'b 會空出來可放新物品\n\n繼續？'))return;
  const now=Date.now();
  items.forEach(i=>{i.slot=pad+'a';i.updatedAt=now;markDirty(i.id)});
  // Save to Firebase immediately
  try{
    const batch=db.batch();
    items.forEach(i=>{batch.update(db.collection(FB_COL).doc(i.id),{slot:pad+'a',updatedAt:now})});
    await batch.commit();
    showToast('✅ 抽屜 '+pad+' 已分割，'+items.length+' 件物品移到 '+pad+'a');
  }catch(e){showToast('已本地更新，Firebase 寫入失敗: '+e.message,'error')}
  // Re-render
  searchDrawer(d);
}

// Merge a split drawer back to full drawer (STRICT: only 1 item in occupied side, other empty)
async function mergeDrawer(d){
  const pad=String(d).padStart(3,'0'), plain=String(d);
  const aItems=allItems.filter(i=>i.slot===pad+'a'||i.slot===plain+'a');
  const bItems=allItems.filter(i=>i.slot===pad+'b'||i.slot===plain+'b');
  const fullItems=allItems.filter(i=>i.slot===pad||i.slot===plain);
  // Safety checks — prevent multi-item full-drawer bug
  if(aItems.length>0&&bItems.length>0){showToast('兩邊都有物品無法擴展','error');return}
  if(fullItems.length>0){showToast('整格已有物品，無法再擴展','error');return}
  const occupied=aItems.length>0?aItems:bItems;
  if(occupied.length===0){showToast('整個抽屜是空的，無需擴展','error');return}
  if(occupied.length>1){showToast('該分格有 '+occupied.length+' 件物品，獨佔整格只能放單一物品','error');return}
  const fromSide=aItems.length>0?'a':'b';
  const theItem=occupied[0];
  if(!confirm('擴展抽屜 '+pad+' 為獨佔整格\n\n物品「'+((theItem.nameCN||theItem.name||'').substring(0,20))+'」將從 '+pad+fromSide+' 移到 '+pad+'（整格）\n容量上限從 124ml → 248ml\n\n繼續？'))return;
  const now=Date.now();
  theItem.slot=pad;theItem.updatedAt=now;markDirty(theItem.id);
  try{
    await db.collection(FB_COL).doc(theItem.id).update({slot:pad,updatedAt:now});
    showToast('✅ 抽屜 '+pad+' 已擴展為獨佔整格');
  }catch(e){showToast('已本地更新，Firebase 寫入失敗: '+e.message,'error')}
  searchDrawer(d);
}

// View contents of a bag (B01-B999)
function searchBag(n){
  const label='B'+String(n).padStart(2,'0');
  const labelPlain='B'+n;
  // Items where slot OR overflowSlot includes this bag
  const results=allItems.filter(i=>{
    if(i.slot===label||i.slot===labelPlain)return true;
    return (i.overflowSlot||'').split(',').map(s=>s.trim()).includes(label)||
           (i.overflowSlot||'').split(',').map(s=>s.trim()).includes(labelPlain);
  });
  const totalVol=results.reduce((s,i)=>{
    // Only count primary items fully; overflow items count only their overflow portion
    const isPrimary=i.slot===label||i.slot===labelPlain;
    if(isPrimary)return s+(i.estimateVolumeMl||0)*(i.quantity||1);
    return s+(i.estimateVolumeMl||0)*(i.overflowQty||0);
  },0);
  const cap=BAG_ML_DEFAULT;
  const pct=Math.min(100,Math.round(totalVol/cap*100));
  const color=pct>90?'var(--red)':pct>70?'var(--orange)':'var(--green)';

  // Find max bag number used
  let maxBag=0;
  allItems.forEach(i=>{
    const m=(i.slot||'').match(/^B(\d+)$/i);if(m)maxBag=Math.max(maxBag,parseInt(m[1]));
    (i.overflowSlot||'').split(',').forEach(s=>{const m=s.trim().match(/^B(\d+)$/i);if(m)maxBag=Math.max(maxBag,parseInt(m[1]))});
  });
  const prev=n>1?'B'+String(n-1).padStart(2,'0'):null;
  const next=n<maxBag?'B'+String(n+1).padStart(2,'0'):null;

  let html=renderSlotNav({prev:prev,next:next,label:'收納袋 '+label});
  html+='<div style="margin-bottom:12px">';
  html+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span class="slot-badge slot-bag" style="font-size:16px;padding:6px 14px">'+label+'</span>';
  html+='<span style="font-family:var(--mono);font-size:13px;color:var(--muted)">'+results.length+' 種零件 · '+Math.round(totalVol)+'ml / '+cap+'ml</span></div>';
  html+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><div style="flex:1;height:6px;background:var(--surface);border-radius:3px;overflow:hidden"><div style="width:'+pct+'%;height:100%;background:'+color+';border-radius:3px"></div></div><span style="font-family:var(--mono);font-size:11px;color:var(--muted)">'+pct+'%</span></div>';
  html+='</div>';
  if(results.length===0){
    html+='<div style="text-align:center;padding:32px;color:var(--muted);background:var(--card);border-radius:10px">（此袋為空）</div>';
  }else{
    html+=results.map(partRowHTML).join('');
  }

  document.getElementById('search-title').textContent='收納袋 '+label+'：'+results.length+' 筆';
  document.getElementById('search-results').innerHTML=html;
  showScreen('s-search');
  attachSwipeNav(prev,next);
}

// View contents of a large drawer (L01-L27)
function searchLarge(n){
  const label='L'+String(n).padStart(2,'0');
  const labelPlain='L'+n;
  const results=allItems.filter(i=>i.slot===label||i.slot===labelPlain);
  const totalVol=results.reduce((s,i)=>s+(i.estimateVolumeMl||0)*(i.quantity||1),0);
  const cap=LARGE_ML;
  const pct=Math.min(100,Math.round(totalVol/cap*100));
  const color=pct>90?'var(--red)':pct>70?'var(--orange)':'var(--green)';

  const prev=n>1?'L'+String(n-1).padStart(2,'0'):null;
  const next=n<27?'L'+String(n+1).padStart(2,'0'):null;

  let html=renderSlotNav({prev:prev,next:next,label:'大抽屜 '+label});
  html+='<div style="margin-bottom:12px">';
  html+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span class="slot-badge slot-large" style="font-size:16px;padding:6px 14px">'+label+'</span>';
  html+='<span style="font-family:var(--mono);font-size:13px;color:var(--muted)">'+results.length+' 種零件 · '+Math.round(totalVol)+'ml / '+cap+'ml</span></div>';
  html+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><div style="flex:1;height:6px;background:var(--surface);border-radius:3px;overflow:hidden"><div style="width:'+pct+'%;height:100%;background:'+color+';border-radius:3px"></div></div><span style="font-family:var(--mono);font-size:11px;color:var(--muted)">'+pct+'%</span></div>';
  html+='</div>';
  if(results.length===0){
    html+='<div style="text-align:center;padding:32px;color:var(--muted);background:var(--card);border-radius:10px">（此大抽屜為空）</div>';
  }else{
    html+=results.map(partRowHTML).join('');
  }

  document.getElementById('search-title').textContent='大抽屜 '+label+'：'+results.length+' 筆';
  document.getElementById('search-results').innerHTML=html;
  showScreen('s-search');
  attachSwipeNav(prev,next);
}

// Attach horizontal swipe detection to search-results area
function attachSwipeNav(prevSlot,nextSlot){
  const el=document.getElementById('search-results');
  if(!el)return;
  // Remove old handlers
  if(el._swipeHandler){
    el.removeEventListener('touchstart',el._swipeStart);
    el.removeEventListener('touchend',el._swipeEnd);
  }
  let startX=0,startY=0,startT=0;
  el._swipeStart=function(e){
    if(!e.touches||!e.touches[0])return;
    startX=e.touches[0].clientX;startY=e.touches[0].clientY;startT=Date.now();
  };
  el._swipeEnd=function(e){
    if(!e.changedTouches||!e.changedTouches[0])return;
    const dx=e.changedTouches[0].clientX-startX;
    const dy=e.changedTouches[0].clientY-startY;
    const dt=Date.now()-startT;
    // Must be horizontal (|dx|>|dy|*2), >50px, <500ms
    if(Math.abs(dx)<50||Math.abs(dx)<Math.abs(dy)*2||dt>500)return;
    if(dx<0&&nextSlot){jumpToSlot(nextSlot)}    // swipe left → next
    else if(dx>0&&prevSlot){jumpToSlot(prevSlot)} // swipe right → prev
  };
  el.addEventListener('touchstart',el._swipeStart,{passive:true});
  el.addEventListener('touchend',el._swipeEnd,{passive:true});
  el._swipeHandler=true;
}
function partRowHTML(item){
  const thumbSrc=item.thumbnailUrl||item.imageData||'';const fb=item.imageData||'';
  const sc=item.slotType==='large'?'slot-large':item.slotType==='bag'?'slot-bag':'slot-small';
  const hasOv=item.overflowSlot&&(item.overflowQty||0)>0;
  const slotClick='event.stopPropagation();goToSlot(\''+item.slot+'\')';
  const onerr=fb?'onerror="this.src=this.dataset.fb;this.onerror=null"':'onerror="this.style.display=\'none\'"';
  // Badge: primary slot + overflow slot(s) each clickable
  let badge='<span class="slot-badge '+sc+'" onclick="'+slotClick+'" style="cursor:pointer">'+(item.slot||'?')+'</span>';
  if(hasOv){
    const ovSlots=item.overflowSlot.split(',').map(s=>s.trim()).filter(Boolean);
    const firstOv=ovSlots[0];
    const ovClick='event.stopPropagation();goToSlot(\''+firstOv+'\')';
    badge+='<span class="slot-badge slot-bag" onclick="'+ovClick+'" style="cursor:pointer;margin-left:2px;font-size:10px">'+item.overflowSlot+'</span>';
  }
  const metaOv=hasOv?'、'+item.overflowSlot:'';
  return'<div class="item-row" onclick="openItem(\''+item.id+'\')">'+(thumbSrc?'<img class="item-thumb" src="'+thumbSrc+'" data-fb="'+fb+'" loading="lazy" '+onerr+'>':'<div style="width:40px;height:40px;border-radius:8px;background:var(--surface);display:flex;align-items:center;justify-content:center;font-size:18px">🧱</div>')+'<div class="item-info"><div class="item-name">'+(item.name||item.nameCN||'未知')+'</div><div class="item-meta"><span style="color:var(--accent);font-family:var(--mono);font-weight:700">'+(item.slot||'?')+metaOv+'</span><span>'+(item.featureTags||[]).slice(0,2).join(', ')+'</span></div></div><div style="display:flex;flex-direction:column;gap:2px;align-items:flex-end">'+badge+'</div></div>';
}

function goToSlot(slot){
  if(!slot)return;
  const m=slot.match(/^(\d+)[ab]?$/);
  if(m){searchDrawer(parseInt(m[1]));return}
  if(slot.startsWith('L')){doSearch(slot);return}
  if(slot.startsWith('B')){doSearch(slot);return}
  doSearch(slot);
}

// ═══════════════════════════════════════════════════
// DRAWER MAP (snake layout)
// ═══════════════════════════════════════════════════
function gridToDrawerNum(col,row,cols){return row%2===0?row*cols+col+1:row*cols+(cols-1-col)+1}

function renderDrawerMap(zone){
  // Build slot counts using BOTH padded and unpadded keys for robust lookup
  const slotCounts={};allItems.forEach(i=>{const s=i.slot||'?';slotCounts[s]=(slotCounts[s]||0)+1;const p=i.pickupSlot||'';if(p)slotCounts[p]=(slotCounts[p]||0)+1;const ov=i.overflowSlot||'';if(ov)ov.split(',').map(x=>x.trim()).filter(Boolean).forEach(x=>{slotCounts[x]=(slotCounts[x]||0)+1})});
  // Build slot volume map
  const slotVols={};allItems.forEach(i=>{
    const s=i.slot||'?';const v1=(i.estimateVolumeMl||0);const qMain=(i.quantity||1);
    slotVols[s]=(slotVols[s]||0)+v1*qMain;
    const p=i.pickupSlot||'';if(p)slotVols[p]=(slotVols[p]||0)+v1*(i.pickupQty||0);
    const ov=i.overflowSlot||'';if(ov){const parts=ov.split(',').map(x=>x.trim()).filter(Boolean);if(parts.length){const each=(i.overflowQty||0)/parts.length;parts.forEach(x=>{slotVols[x]=(slotVols[x]||0)+v1*each})}}
  });
  // Build thumbnail map: normalize drawer number to padded 3-digit string
  const drawerThumbs={};
  allItems.forEach(i=>{if(!i.slot)return;
    // Match "077a", "077b", or full-drawer "077" (no suffix)
    const m=i.slot.match(/^0*(\d+)(a|b)?$/);if(!m)return;
    const dPad=String(parseInt(m[1])).padStart(3,'0'), side=m[2]||'a';
    if(!drawerThumbs[dPad])drawerThumbs[dPad]={a:[],b:[]};
    const img=i.thumbnailUrl||'';if(img&&drawerThumbs[dPad][side].length<2)drawerThumbs[dPad][side].push(img);
  });

  // [v20ap] Also include pickup items in drawer thumbnail map
  allItems.forEach(i=>{
    const ps=i.pickupSlot||'';
    if(!ps)return;
    const m=ps.match(/^0*(\d+)(a|b)?$/);
    if(!m)return;
    const dPad=String(parseInt(m[1])).padStart(3,'0'),side=m[2]||'a';
    if(!drawerThumbs[dPad])drawerThumbs[dPad]={a:[],b:[]};
    const img=i.thumbnailUrl||i.imageData||'';
    if(img&&drawerThumbs[dPad][side].length<2)drawerThumbs[dPad][side].push(img);
  });

  // Helper: get item count for a drawer number (handles padded "077a", "77a", and full "077")
  function getDrawerCounts(dNum){
    const pad=String(dNum).padStart(3,'0'), plain=String(dNum);
    const ca=(slotCounts[pad+'a']||0)+(slotCounts[plain+'a']||0);
    const cb=(slotCounts[pad+'b']||0)+(slotCounts[plain+'b']||0);
    // Full-drawer (no a/b suffix): count as both a+b occupied
    const cf=(slotCounts[pad]||0)+(slotCounts[plain]||0);
    return {ca:ca+cf, cb:cb, total:ca+cb+cf};
  }
  // Helper: get volume usage for drawer number (both halves combined)
  function getDrawerVol(dNum){
    const pad=String(dNum).padStart(3,'0'), plain=String(dNum);
    return (slotVols[pad+'a']||0)+(slotVols[plain+'a']||0)+
           (slotVols[pad+'b']||0)+(slotVols[plain+'b']||0)+
           (slotVols[pad]||0)+(slotVols[plain]||0);
  }

  function renderSmallZone(z,offset){
    let h='<div class="drawer-grid" style="grid-template-columns:repeat('+z.cols+',1fr)">';
    for(let row=0;row<z.rows;row++){for(let col=0;col<z.cols;col++){
      const d=gridToDrawerNum(col,row,z.cols)+(offset||0);if(d>z.end)continue;
      const dPad=String(d).padStart(3,'0');
      const counts=getDrawerCounts(d);
      const usedVol=getDrawerVol(d);
      const drawerCap=DRAWER_ML; // full drawer capacity
      const remaining=Math.max(0,drawerCap-usedVol);
      const pct=Math.min(100,Math.round(usedVol/drawerCap*100));
      const cls=counts.total>0?'has-items':'';
      const t=drawerThumbs[dPad]||{a:[],b:[]},allImgs=[...(t.a||[]),...(t.b||[])];
      let thumbHtml='';if(allImgs.length>0){const sz=allImgs.length>=2?14:18;thumbHtml='<div style="display:flex;gap:1px;justify-content:center;margin-top:1px">';allImgs.slice(0,2).forEach(url=>{thumbHtml+='<img src="'+url+'" style="width:'+sz+'px;height:'+sz+'px;object-fit:contain;border-radius:2px;background:rgba(255,255,255,0.08)" onerror="this.style.display=\'none\'">'});thumbHtml+='</div>'}
      const remColor=remaining<20?'var(--red)':remaining<50?'var(--orange)':'var(--green)';
      h+='<div class="drawer-cell '+cls+'" onclick="searchDrawer('+d+')" title="'+d+'a:'+counts.ca+'件 '+d+'b:'+counts.cb+'件 | 用 '+Math.round(usedVol)+'ml/'+drawerCap+'ml ('+pct+'%)"><div style="font-size:11px">'+d+'</div>'+thumbHtml+'<div style="font-size:7px">'+counts.ca+'|'+counts.cb+'</div><div style="font-size:7px;color:'+remColor+'">餘'+Math.round(remaining)+'ml</div></div>';
    }}h+='</div>';return h;
  }

  if(zone==='small'){
    let html='<div style="font-size:13px;color:var(--muted);margin-bottom:8px">頂層 小抽屜 1~90（18×5，蛇形排列）</div>';
    html+=renderSmallZone(ZONE_TOP,0);
    html+='<div style="font-size:13px;color:var(--muted);margin:16px 0 8px">主區 小抽屜 91~450（18×20，蛇形排列）</div>';
    html+=renderSmallZone(ZONE_MAIN,90);
    const extUsed=allItems.some(i=>{const m=(i.slot||'').match(/^0*(\d+)/);return m&&parseInt(m[1])>450&&(i.slotType||'small')==='small'});
    if(extUsed){
      html+='<div style="font-size:13px;color:var(--muted);margin:16px 0 8px">擴充區 小抽屜 451~630（18×10，蛇形排列）</div>';
      html+=renderSmallZone(ZONE_EXT,450);
    }
    document.getElementById('map-small-content').innerHTML=html;
  }
  else if(zone==='large'){
    let html='<div style="font-size:13px;color:var(--muted);margin-bottom:8px">中層 大抽屜 L1~L27（9×3）· 容量 '+LARGE_ML+'ml/格</div>';
    html+='<div class="drawer-grid" style="grid-template-columns:repeat(9,1fr)">';
    for(let row=0;row<ZONE_LARGE_MAP.rows;row++){for(let col=0;col<ZONE_LARGE_MAP.cols;col++){
      const d=gridToDrawerNum(col,row,ZONE_LARGE_MAP.cols);if(d>ZONE_LARGE_MAP.drawers)continue;
      const lPlain='L'+d, lPad='L'+String(d).padStart(2,'0');
      const c=(slotCounts[lPlain]||0)+(slotCounts[lPad]||0),cls=c>0?'has-items':'';
      const usedV=(slotVols[lPlain]||0)+(slotVols[lPad]||0);
      const remainingL=Math.max(0,LARGE_ML-usedV);
      const pctL=Math.min(100,Math.round(usedV/LARGE_ML*100));
      const remColorL=remainingL<100?'var(--red)':remainingL<300?'var(--orange)':'var(--green)';
      const lItem=allItems.find(i=>i.slot===lPlain||i.slot===lPad||i.pickupSlot===lPlain||i.pickupSlot===lPad);const lThumb=lItem?(lItem.thumbnailUrl||''):'';
      const lThumbHtml=lThumb?'<img src="'+lThumb+'" style="width:24px;height:24px;object-fit:contain;border-radius:2px;background:rgba(255,255,255,0.08)" onerror="this.style.display=\'none\'">':'';
      html+='<div class="drawer-cell '+cls+'" style="min-height:62px" onclick="doSearch(\''+lPad+'\')" title="'+lPad+' · '+c+'件 · 用 '+Math.round(usedV)+'/'+LARGE_ML+'ml ('+pctL+'%)"><div style="font-size:11px">L'+d+'</div>'+lThumbHtml+'<div style="font-size:7px">'+c+'件</div><div style="font-size:8px;color:'+remColorL+'">餘'+Math.round(remainingL)+'ml</div></div>';
    }}html+='</div>';
    
    document.getElementById('map-large-content').innerHTML=html;
  }
  else if(zone==='bag'){
    const bagCap=slotConfig.bagCapacity||BAG_ML_DEFAULT;
    const bagsBySlot={};allItems.filter(i=>i.slotType==='bag').forEach(i=>{if(!bagsBySlot[i.slot])bagsBySlot[i.slot]=[];bagsBySlot[i.slot].push(i)});
    // Collect overflow references (handle comma-separated overflowSlot like "B07,B08,B89")
    const overflowToBag={};
    allItems.filter(i=>i.overflowSlot&&(i.overflowQty||0)>0).forEach(i=>{
      const slots=i.overflowSlot.split(',').map(s=>s.trim()).filter(Boolean);
      const vol1=i.estimateVolumeMl||0;
      const totalOvQty=i.overflowQty||0;
      const qtyPerBag=slots.length>1?Math.ceil(totalOvQty/slots.length):totalOvQty;
      slots.forEach((b,idx)=>{
        if(!overflowToBag[b])overflowToBag[b]=[];
        const batchQty=idx<slots.length-1?qtyPerBag:totalOvQty-qtyPerBag*idx;
        overflowToBag[b].push({item:i,qty:Math.max(0,batchQty),vol:vol1*Math.max(0,batchQty)});
        // Create bag entry if it doesn't exist (overflow-only bag)
        if(!bagsBySlot[b])bagsBySlot[b]=[];
      });
    });
    const bags=Object.entries(bagsBySlot).sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true}));
    const totalBagVol=bags.reduce((s,e)=>s+e[1].reduce((ss,i)=>ss+(i.estimateVolumeMl||0)*(i.quantity||1),0),0);
    let html='<div style="font-size:13px;color:var(--muted);margin-bottom:12px">收納袋 · '+bags.length+' 袋 · '+Math.round(totalBagVol)+'ml · 容量 '+bagCap+'ml/袋</div>';
    if(!bags.length)html+='<div style="color:var(--dim);text-align:center;padding:48px">尚無收納袋</div>';
    bags.forEach(([bag,items])=>{
      // Include overflow items in this bag
      const ovEntries=overflowToBag[bag]||[];
      const primaryVol=items.reduce((s,i)=>s+(i.estimateVolumeMl||0)*(i.quantity||1),0);
      const ovVol=ovEntries.reduce((s,e)=>s+e.vol,0);
      const vol=primaryVol+ovVol;
      const allDisplayItems=items.concat(ovEntries.map(e=>e.item));
      const pct=Math.min(100,Math.round(vol/bagCap*100));
      const isOver=vol>bagCap;
      const hasOverflow=ovEntries.length>0;
      const barColor=isOver?'var(--red)':pct>80?'var(--orange)':'var(--green)';
      const borderStyle=isOver?'border:2px solid var(--red);box-shadow:0 0 8px rgba(239,68,68,0.3)':'border:1px solid var(--border)';
      const thumbs=allDisplayItems.slice(0,3).map(i=>i.thumbnailUrl||'').filter(Boolean);
      const thumbHtml=thumbs.map(u=>'<img src="'+u+'" style="width:28px;height:28px;object-fit:contain;border-radius:4px;background:rgba(255,255,255,0.08)" onerror="this.style.display=\'none\'">').join('');
      const names=allDisplayItems.slice(0,3).map(i=>(i.nameCN||i.name||'').substring(0,12)).join(' · ');
      const extra=allDisplayItems.length>3?' +' +(allDisplayItems.length-3):'';
      const overflowLabel=hasOverflow?'<span style="font-size:9px;color:var(--purple);margin-left:4px">↗溢入</span>':'';
      html+='<div style="background:var(--card);'+borderStyle+';border-radius:10px;padding:10px 12px;margin-bottom:6px;cursor:pointer" onclick="doSearch(\''+bag+'\')">';
      html+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">';
      html+='<span class="slot-badge slot-bag" style="font-size:12px;padding:3px 8px;min-width:36px;text-align:center">'+bag+'</span>';
      html+='<div style="display:flex;gap:3px">'+thumbHtml+'</div>';
      html+='<div style="flex:1;min-width:0"><div style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+names+extra+'</div></div>';
      html+='<span style="font-size:10px;color:var(--dim)">'+allDisplayItems.length+'種</span>'+overflowLabel;
      html+='</div>';
      // Capacity bar
      html+='<div style="display:flex;align-items:center;gap:8px">';
      html+='<div style="flex:1;height:4px;background:var(--surface);border-radius:2px;overflow:hidden"><div style="width:'+Math.min(pct,100)+'%;height:100%;background:'+barColor+';border-radius:2px"></div></div>';
      html+='<span style="font-size:10px;font-family:var(--mono);color:'+(isOver?'var(--red)':'var(--muted)')+';min-width:70px;text-align:right">'+Math.round(vol)+'/'+bagCap+'ml</span>';
      html+='</div>';
      html+='</div>';
    });
    document.getElementById('map-bag-content').innerHTML=html;
  }
}

/* autoAssignLargeDrawers removed in v20aj */

// ═══════════════════════════════════════════════════
// MERGED VIEW
// ═══════════════════════════════════════════════════
function renderMergedView(){
  // Detect merged items TWO ways:
  // 1. mergedWith field from pipeline
  // 2. Multiple items sharing the same slot (runtime detection - works without pipeline)
  const slotGroups={};
  allItems.forEach(i=>{
    if(!i.slot||(i.slotType||'small')!=='small')return;
    // Normalize: "077a" → "077a", "077" → "077" (full drawer = not merged)
    const s=i.slot;
    if(!slotGroups[s])slotGroups[s]=[];
    slotGroups[s].push(i);
  });

  // A slot is "merged" if it has 2+ items, OR any item has mergedWith
  const mergedSlots=Object.entries(slotGroups).filter(([slot,items])=>{
    if(items.length>=2)return true;
    return items.some(i=>i.mergedWith&&i.mergedWith.length>0);
  }).sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true}));

  const totalMergedItems=mergedSlots.reduce((s,e)=>s+e[1].length,0);
  let html='<div style="font-size:13px;color:var(--muted);margin-bottom:12px">已融合格子：'+mergedSlots.length+' 格（'+totalMergedItems+' 件零件共用格子）</div>';

  if(!mergedSlots.length)html+='<div style="color:var(--dim);text-align:center;padding:48px">尚無融合零件<br><span style="font-size:12px">執行「格子自動分配」後，體積 ≤'+MERGE_LIMIT+'ml 的零件會被融合到同一格</span></div>';
  else{
    mergedSlots.forEach(([slot,items])=>{
      const totalVol=items.reduce((s,i)=>s+(i.estimateVolumeMl||0)*(i.quantity||1),0);
      const pct=Math.min(100,Math.round(totalVol/SLOT_ML*100));
      const barColor=pct>80?'var(--red)':pct>50?'var(--orange)':'var(--green)';
      html+='<div class="card"><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span class="slot-badge slot-small" style="font-size:13px;cursor:pointer" onclick="event.stopPropagation();searchDrawer('+parseInt(slot)+')">'+slot+' →</span><span style="font-size:12px;color:var(--muted)">'+items.length+' 件 · '+Math.round(totalVol)+'ml/'+SLOT_ML+'ml</span></div>';
      html+='<div style="height:4px;background:var(--surface);border-radius:2px;overflow:hidden;margin-bottom:8px"><div style="width:'+pct+'%;height:100%;background:'+barColor+';border-radius:2px"></div></div>';
      items.forEach(i=>{
        const thumb=i.thumbnailUrl||(i.designId?'https://cdn.rebrickable.com/media/parts/ldraw/7/'+getBaseDesignId(i.designId)+'.png':'');
        const vol=Math.round((i.estimateVolumeMl||0)*(i.quantity||1));
        html+='<div class="item-row" onclick="openItem(\''+i.id+'\')">'+(thumb?'<img class="item-thumb" src="'+thumb+'" loading="lazy" onerror="this.style.display=\'none\'">':'<div style="width:40px;height:40px;border-radius:8px;background:var(--surface);display:flex;align-items:center;justify-content:center">🧱</div>')+'<div class="item-info"><div class="item-name">'+(i.name||i.nameCN||'未知')+'</div><div class="item-meta"><span class="mono" style="font-size:11px">'+(i.designId||'')+'</span><span>'+vol+'ml</span><span>'+(i.featureTags||[]).slice(0,1).join('')+'</span></div></div></div>';
      });
      html+='</div>';
    });
  }
  document.getElementById('merged-content').innerHTML=html;
}

// ═══════════════════════════════════════════════════
// ALL PARTS VIEW
// ═══════════════════════════════════════════════════
function renderAllParts(){
  const sorted=[...allItems].sort((a,b)=>(a.slot||'').localeCompare(b.slot||'',undefined,{numeric:true}));
  document.getElementById('allparts-content').innerHTML='<div style="font-size:13px;color:var(--muted);margin-bottom:12px">全部零件：'+sorted.length+' 件</div>'+sorted.map(partRowHTML).join('');
}

// ═══════════════════════════════════════════════════
// ASSIGN PIPELINE (from assign file)
// ═══════════════════════════════════════════════════
let assignLogLines=[], assignAssignments=[], assignBuckets={};

function assignLog(msg,cls=''){assignLogLines.push({msg,cls})}
function drawerNumToLabel(n){return String(n).padStart(3,'0')}

function openAssignPage(){
  showScreen('s-assign');
  if(slotConfig.locked){
    document.getElementById('assign-content').innerHTML='<div class="card" style="text-align:center;padding:32px"><div style="font-size:48px;margin-bottom:12px">🔒</div><h2 style="margin-bottom:8px;color:var(--green)">編排已鎖定</h2><p style="color:var(--muted);margin-bottom:16px;font-size:13px;line-height:1.6">零件已放入實體抽屜，重新分配功能已停用。<br>新零件會自動追加到 <b style="color:var(--accent)">'+slotConfig.nextSmallSlot+'</b> 之後。<br>收納袋從 <b style="color:var(--accent)">'+slotConfig.nextBagSlot+'</b> 繼續。</p><p style="color:var(--orange);font-size:12px;margin-bottom:24px">如需重新編排，請先到設定頁解除鎖定。</p><button class="btn btn-lg" onclick="goBack()">← 返回</button></div>';
  } else {
    document.getElementById('assign-content').innerHTML='<div class="card" style="text-align:center;padding:32px"><div style="font-size:48px;margin-bottom:12px">🧱</div><h2 style="margin-bottom:8px">BrickSort 格子自動分配</h2><p style="color:var(--muted);margin-bottom:8px;font-size:13px">從 Firebase 讀取所有零件 → 依體積/分類自動分配格子 → 回寫 Firebase</p><p style="color:var(--orange);font-size:12px;margin-bottom:24px">⚠ 會重新編排所有格子！如果零件已放入實體抽屜，需要重新擺放。</p><button class="btn btn-primary btn-lg" onclick="startPipeline()">▶ 開始分配</button></div>';
  }
}

async function startPipeline(){
  if(slotConfig.locked){
    if(!confirm('⚠ 編排已鎖定！\n\n重新分配會打亂所有格子編號，已放入實體抽屜的零件需要全部重新擺放。\n\n確定要解鎖並重新分配？')){return}
    slotConfig.locked=false;
    try{await db.collection(FB_COL).doc(FB_CONFIG_DOC).set({locked:false},{merge:true})}catch(e){}
    showToast('🔓 已解除鎖定');
  }
  assignLogLines=[];assignAssignments=[];
  document.getElementById('assign-status').textContent='載入中…';
  document.getElementById('assign-content').innerHTML='<div class="loading"><div class="spinner"></div>載入中…</div>';
  // Try Firebase reload; if offline, use local data
  try{const snap=await db.collection(FB_COL).get();allItems=[];snap.docs.forEach(d=>{if(d.id===FB_CONFIG_DOC)slotConfig={...slotConfig,...d.data()};else allItems.push({id:d.id,...d.data()})});assignLog('Firebase 載入：'+allItems.length+' 個零件','ok')}catch(e){if(allItems.length>0){assignLog('Firebase 離線，使用本機 '+allItems.length+' 個零件','warn')}else{document.getElementById('assign-content').innerHTML='<div class="card" style="color:var(--red)">❌ 無資料：'+e.message+'</div>';return}}
  // Clean runtime flags (may have been saved to Firebase by saveAllToFirebase)
  allItems.forEach(item=>{Object.keys(item).filter(k=>k.startsWith('_')&&k!=='_id').forEach(k=>delete item[k])});
  repairSlotConfig();
  allItems.forEach(item=>{item._catGroup=getCatGroup(item.featureTags,item.bricklinkCategory);item._tier=getTier(item._catGroup);item._isMinifig=isMinifigure(item);item._fitsSmall=fitsSmallSlot(item);item._vt=Math.round((item.estimateVolumeMl||0)*(item.quantity||1)*10)/10});
  classifyAssign();mergeCompanionParts();assignLargeDrawers();assignSmallDrawers();assignBagsStep();showAssignReport();
}

// ═══ COMPANION PARTS (鏡像 + 鉸鏈配對) ═══
// Groups: items sharing a group array will be assigned to the same slot
const COMPANION_GROUPS=[
  // Hinge Brick 1x4 Swivel (Base/Top)
  ['3831','3830'],
  // Hinge Plate 1x2 with Fingers (2 Fingers / 3 Fingers, all mold variants)
  ['4276','4276a','4276b','4275','4275a','4275b'],
  // Hinge Plate 1x4 Swivel (Base/Top)
  ['2429','2430'],
  // Hinge Plate 2x4 Articulated Joint (Female/Male)
  ['3640','3639'],
  // Hinge Plate 2x4 with Pin Hole (43045 Top / 98285 Bottom / 98286 Top)
  ['43045','98285','98286'],
];

function getMirrorKey(name){
  if(!name)return'';
  return name.replace(/\b(Left|Right|左|右)\b/gi,'').replace(/\s+/g,' ').trim().toLowerCase();
}

function mergeCompanionParts(){
  // Build lookup: designId → group index
  const idToGroup={};
  COMPANION_GROUPS.forEach((grp,gi)=>{
    grp.forEach(id=>{idToGroup[id.toLowerCase()]=gi;idToGroup[getBaseDesignId(id).toLowerCase()]=gi;idToGroup[getNumericBase(id).toLowerCase()]=gi});
  });

  // Phase 1: Table-based companion groups
  const groupMap={};// groupKey → [items]
  allItems.forEach(item=>{
    const did=(item.designId||'').toLowerCase();
    const base=getBaseDesignId(item.designId).toLowerCase();
    const num=getNumericBase(item.designId).toLowerCase();
    const gi=idToGroup[did]??idToGroup[base]??idToGroup[num];
    if(gi!==undefined){
      const key='companion_'+gi;
      if(!groupMap[key])groupMap[key]=[];
      groupMap[key].push(item);
    }
  });

  // Phase 2: Mirror name detection (Left/Right)
  const mirrorMap={};// mirrorKey → [items]
  allItems.forEach(item=>{
    const n=item.name||item.nameCN||'';
    if(!/\b(Left|Right|左|右)\b/i.test(n))return;
    // Skip if already in a companion group
    if(item._companionOf||item._isCompanionMaster)return;
    const mk=getMirrorKey(n);
    if(!mk)return;
    if(!mirrorMap[mk])mirrorMap[mk]=[];
    mirrorMap[mk].push(item);
  });
  // Only keep groups with 2+ items
  Object.entries(mirrorMap).forEach(([mk,items])=>{
    if(items.length>=2){groupMap['mirror_'+mk]=items}
  });

  // Phase 3: For each group, pick master (largest _vt) and mark companions
  let companionCount=0,mirrorCount=0;
  Object.entries(groupMap).forEach(([key,items])=>{
    if(items.length<2)return;
    // Filter out items forced into bag bucket (minifig body parts, oversize, etc.)
    const bagSet=new Set(assignBuckets.bag.map(i=>i.id));
    const eligible=items.filter(i=>!bagSet.has(i.id));
    if(eligible.length<2){
      // All or most items are in bags — skip companion merge for this group
      return;
    }
    eligible.sort((a,b)=>b._vt-a._vt);
    const master=eligible[0];
    master._isCompanionMaster=true;
    master._companions=[];
    for(let i=1;i<eligible.length;i++){
      const comp=eligible[i];
      comp._companionOf=master.id;
      master._vt+=comp._vt; // Merge volume into master
      master._companions.push(comp.id);
      // Remove companion from non-bag buckets only
      ['merge','slot','drawer','large'].forEach(bk=>{
        const arr=assignBuckets[bk];
        const idx=arr.indexOf(comp);
        if(idx>=0)arr.splice(idx,1);
      });
    }
    // Reclassify master with merged volume
    const oldBuckets=['merge','slot','drawer','large'];
    oldBuckets.forEach(bk=>{const arr=assignBuckets[bk];const idx=arr.indexOf(master);if(idx>=0)arr.splice(idx,1)});
    const vt=master._vt;
    if(vt>DRAWER_ML){master._reason='配對合併'+Math.round(vt)+'ml>248→收納袋';assignBuckets.bag.push(master)}
    else if(vt>SLOT_ML){master._reason='配對合併'+Math.round(vt)+'ml→小抽屜(a+b)';assignBuckets.drawer.push(master)}
    else if(vt>MERGE_LIMIT){master._reason='配對合併'+Math.round(vt)+'ml→獨佔格子';assignBuckets.slot.push(master)}
    else{master._reason='配對合併'+Math.round(vt)+'ml→融合';assignBuckets.merge.push(master)}
    if(key.startsWith('mirror_'))mirrorCount++;else companionCount++;
  });

  assignLog('配對：'+mirrorCount+' 組鏡像 + '+companionCount+' 組鉸鏈/子件','ok');
}

function classifyAssign(){
  assignBuckets={merge:[],slot:[],drawer:[],large:[],bag:[],box:[]};
  allItems.forEach(item=>{const vt=item._vt;
    if(item._isMinifig){item._reason='Minifigure→收納袋';assignBuckets.bag.push(item);return}
    // Force minifig body parts to bags (headwear, body, head, matching creatures)
    if(BAG_SUPER_GROUPS[item._catGroup]&&(item.estimateVolumeMl||0)>=MINIFIG_BAG_VOL1){item._reason=item._catGroup+'→人偶身體部件收納袋';assignBuckets.bag.push(item);return}

    if(!item._fitsSmall){item._reason='尺寸超過小格口→收納袋';assignBuckets.bag.push(item);return}
    if(vt>LARGE_ML){item._reason='體積'+vt+'ml>778→收納袋';assignBuckets.bag.push(item);return}
    if(vt>DRAWER_ML){item._reason='體積'+vt+'ml→大抽屜候選';assignBuckets.large.push(item);return}
    if(vt>SLOT_ML){item._reason='體積'+vt+'ml→小抽屜(a+b)';assignBuckets.drawer.push(item);return}
    if(vt>MERGE_LIMIT){item._reason='體積'+vt+'ml→獨佔格子';assignBuckets.slot.push(item);return}
    // 單件體積 > 41ml → 不融合（大件堆疊浪費空間）
    const vol1=item.estimateVolumeMl||0;
    if(vol1>MERGE_VOL1_MAX){item._reason='單件'+vol1+'ml>'+MERGE_VOL1_MAX+'→獨佔格子';assignBuckets.slot.push(item);return}
    item._reason='體積'+vt+'ml→融合候選';assignBuckets.merge.push(item)});
  assignLog('分流：融合'+assignBuckets.merge.length+' 格子'+assignBuckets.slot.length+' 小抽屜'+assignBuckets.drawer.length+' 大抽屜'+assignBuckets.large.length+' 收納袋'+assignBuckets.bag.length,'info');
}
function assignLargeDrawers(){
  assignBuckets.large.sort((a,b)=>b._vt-a._vt);
  const assigned=assignBuckets.large.slice(0,LARGE_COUNT),overflow=assignBuckets.large.slice(LARGE_COUNT);
  assigned.forEach((item,i)=>{const label='L'+String(i+1).padStart(2,'0');assignAssignments.push({item,slot:label,slotType:'large',mergedWith:[]})});
  overflow.forEach(item=>{item._reason='大抽屜溢出→收納袋';assignBuckets.bag.push(item)});
  assignLog('大抽屜：'+assigned.length+'/'+LARGE_COUNT,'ok');
}
function assignSmallDrawers(){
  // ═══ UNIFIED: drawer + slot + merge by catGroup ═══
  // Collect all items by catGroup
  const catItems={};
  function addToCat(item,bucket){const g=item._catGroup;if(!catItems[g])catItems[g]={drawers:[],slots:[],merges:[]};catItems[g][bucket].push(item)}
  assignBuckets.drawer.forEach(item=>addToCat(item,'drawers'));
  assignBuckets.slot.forEach(item=>addToCat(item,'slots'));
  assignBuckets.merge.forEach(item=>addToCat(item,'merges'));

  // Sort within each catGroup
  Object.values(catItems).forEach(g=>{
    g.drawers.sort((a,b)=>a._vt-b._vt);
    g.slots.sort((a,b)=>a._vt-b._vt);
    g.merges.sort((a,b)=>b._vt-a._vt);// desc for FFD
  });

  // FFD bin-packing for merge items within each catGroup
  Object.entries(catItems).forEach(([group,g])=>{
    const bins=[];
    g.merges.forEach(item=>{
      let placed=false;
      for(const bin of bins){
        if(bin.items.length>=getMergeMaxItems(bin.items))continue;
        if(bin.totalVt+item._vt<=SLOT_ML){bin.items.push(item);bin.totalVt+=item._vt;placed=true;break}
      }
      if(!placed)bins.push({items:[item],totalVt:item._vt,catGroup:group});
    });
    g.mergeBins=bins;
  });

  // Order catGroups: Tier3 → Tier2 → Tier1, then alphabetical
  const groupOrder=Object.keys(catItems).sort((a,b)=>{
    const ta=getTier(a),tb=getTier(b);
    if(ta!==tb)return tb-ta;
    return a.localeCompare(b);
  });

  // Assign drawers sequentially, all types within same catGroup together
  let nextDrawer=1;
  let overflowToBag=0;
  groupOrder.forEach(group=>{
    const g=catItems[group];

    // Phase 1: drawer items (each needs whole drawer a+b)
    g.drawers.forEach(item=>{
      if(nextDrawer>BASE_DRAWERS){item._reason='小抽屜已滿→收納袋';assignBuckets.bag.push(item);overflowToBag++;return}
      const label=drawerNumToLabel(nextDrawer);
      assignAssignments.push({item,slot:label,slotType:'small',mergedWith:[]});
      nextDrawer++;
    });

    // Phase 2: slot items (pair into a/b)
    for(let i=0;i<g.slots.length;i+=2){
      if(nextDrawer>BASE_DRAWERS){
        for(let j=i;j<g.slots.length;j++){g.slots[j]._reason='小抽屜已滿→收納袋';assignBuckets.bag.push(g.slots[j]);overflowToBag++}
        break;
      }
      const label=drawerNumToLabel(nextDrawer);
      assignAssignments.push({item:g.slots[i],slot:label+'a',slotType:'small',mergedWith:[]});
      if(i+1<g.slots.length){
        assignAssignments.push({item:g.slots[i+1],slot:label+'b',slotType:'small',mergedWith:[]});
      }
      nextDrawer++;
    }

    // Phase 3: merge bins (pair into a/b)
    const bins=g.mergeBins||[];
    for(let i=0;i<bins.length;i+=2){
      if(nextDrawer>BASE_DRAWERS){
        for(let j=i;j<bins.length;j++){bins[j].items.forEach(item=>{item._reason='小抽屜已滿→收納袋';assignBuckets.bag.push(item);overflowToBag++})}
        break;
      }
      const label=drawerNumToLabel(nextDrawer);
      const binA=bins[i];
      binA.items.forEach(item=>{
        assignAssignments.push({item,slot:label+'a',slotType:'small',mergedWith:binA.items.filter(x=>x.id!==item.id).map(x=>x.id)});
      });
      if(i+1<bins.length){
        const binB=bins[i+1];
        binB.items.forEach(item=>{
          assignAssignments.push({item,slot:label+'b',slotType:'small',mergedWith:binB.items.filter(x=>x.id!==item.id).map(x=>x.id)});
        });
      }
      nextDrawer++;
    }
  });

  window._nextAvailableDrawer=Math.min(nextDrawer,BASE_DRAWERS+1);
  const totalDrawers=Math.min(nextDrawer-1,BASE_DRAWERS);
  if(overflowToBag>0)assignLog('小抽屜：使用 '+totalDrawers+'/'+BASE_DRAWERS+' 個抽屜，'+overflowToBag+' 個零件溢出到收納袋','warn');
  else assignLog('小抽屜：使用 '+totalDrawers+'/'+BASE_DRAWERS+' 個抽屜','ok');

  // ═══ Compaction: eliminate any gaps in drawer numbering ═══
  const smallAssigns=assignAssignments.filter(a=>a.slotType==='small');
  const usedDrawerNums=new Set();
  smallAssigns.forEach(a=>{const m=a.slot.match(/^(\d+)/);if(m)usedDrawerNums.add(parseInt(m[1]))});
  const sortedNums=[...usedDrawerNums].sort((a,b)=>a-b);
  // Build renumber map: old→new (close gaps)
  const renumberMap={};let newNum=1;
  sortedNums.forEach(oldNum=>{renumberMap[oldNum]=newNum;newNum++});
  // Check if any renumbering needed
  const needsRenumber=sortedNums.some(n=>renumberMap[n]!==n);
  if(needsRenumber){
    let renumbered=0;
    smallAssigns.forEach(a=>{
      const m=a.slot.match(/^(\d+)([ab]?)$/);
      if(m){
        const oldNum=parseInt(m[1]),suffix=m[2];
        const mapped=renumberMap[oldNum];
        if(mapped&&mapped!==oldNum){
          a.slot=String(mapped).padStart(3,'0')+suffix;
          renumbered++;
        }
      }
    });
    window._nextAvailableDrawer=newNum;
    assignLog('壓縮：消除 '+(sortedNums.length-(newNum-1))+' 個空隙，'+renumbered+' 個位置重編','ok');
  }
}

// Bag super-groups: merge related catGroups into same bag(s)
const BAG_SUPER_GROUPS={
  '人偶身體':'人偶身體部件','人偶頭飾':'人偶身體部件','人偶頭部':'人偶身體部件'
};
// Keywords that indicate an item is a body/creature part (for 生物自然 and 人偶工具)

// Check if a 生物自然 or 人偶工具 item should go to the 人偶身體部件 bag

function getBagGroup(catGroup,item){
  // Static mappings (always merge)
  if(BAG_SUPER_GROUPS[catGroup])return BAG_SUPER_GROUPS[catGroup];
  // Dynamic: 生物自然 items with body/creature keywords → 人偶身體部件

  // Dynamic: 人偶工具 items with body keywords → 人偶身體部件
  // 人偶工具: stays independent
  return catGroup;
}

function assignBagsStep(){
  const candidates=assignBuckets.bag;if(!candidates.length){assignLog('無收納袋候選','info');return}
  let bagCapacity=BAG_ML_DEFAULT;const boxItems=[],bagItems=[];
  // Bags use RAW volume (flexible container, no packing factor)
  candidates.forEach(item=>{item._rawVt=Math.round((item.estimateVolumeMl||0)*(item.quantity||1)*10)/10;if((item.estimateVolumeMl||0)>bagCapacity)boxItems.push(item);else bagItems.push(item)});
  boxItems.forEach(item=>{assignAssignments.push({item,slot:'BOX',slotType:'box',mergedWith:[]})});
  const catGroups2={};bagItems.forEach(item=>{const g=getBagGroup(item._catGroup,item);if(!catGroups2[g])catGroups2[g]=[];catGroups2[g].push(item)});
  Object.values(catGroups2).forEach(arr=>arr.sort((a,b)=>b._rawVt-a._rawVt));
  const bags=[];
  Object.entries(catGroups2).forEach(([group,items])=>{items.forEach(item=>{
    const vol1=item.estimateVolumeMl||0;
    // Split high-quantity items across multiple bags
    if(item._rawVt>bagCapacity&&vol1>0){
      const piecesPerBag=Math.max(1,Math.floor(bagCapacity/vol1));
      let remaining=item.quantity||1;
      let isFirst=true;
      while(remaining>0){
        const batchQty=Math.min(remaining,piecesPerBag);
        const batchVol=Math.round(vol1*batchQty*10)/10;
        // Split bags are sealed — don't try to fit into existing bags
        bags.push({items:[{item,splitQty:batchQty,isFirst,_isSplit:true}],totalVt:batchVol,catGroups:new Set([group]),sealed:true});
        remaining-=batchQty;isFirst=false;
      }
    }else{
      // Normal FFD: fit whole item into a bag
      let placed=false;
      for(const bag of bags){if(bag.sealed)continue;if(!bag.catGroups.has(group)&&bag.catGroups.size>0)continue;if(bag.totalVt+item._rawVt<=bagCapacity){bag.items.push({item,splitQty:item.quantity||1,isFirst:true});bag.totalVt+=item._rawVt;bag.catGroups.add(group);placed=true;break}}
      if(!placed)bags.push({items:[{item,splitQty:item.quantity||1,isFirst:true}],totalVt:item._rawVt,catGroups:new Set([group])});
    }
  })});
  // Assign bag labels and build overflow map
  const itemBags={};// itemId → [{label, qty}]
  bags.forEach((bag,i)=>{const label='B'+String(i+1).padStart(2,'0');bag.items.forEach(entry=>{
    if(!itemBags[entry.item.id])itemBags[entry.item.id]=[];
    itemBags[entry.item.id].push({label,qty:entry.splitQty,isFirst:entry.isFirst});
  })});
  // Create assignments: first bag = slot, additional bags = overflow
  Object.entries(itemBags).forEach(([id,bagList])=>{
    const item=allItems.find(i=>i.id===id);if(!item)return;
    const first=bagList.find(b=>b.isFirst)||bagList[0];
    const overflows=bagList.filter(b=>b!==first);
    assignAssignments.push({item,slot:first.label,slotType:'bag',mergedWith:[]});
    if(overflows.length>0){
      const totalOvQty=overflows.reduce((s,b)=>s+b.qty,0);
      item._bagOverflow={slots:overflows.map(b=>b.label),qty:totalOvQty};
    }
  });
  window._bagCount=bags.length;window._bagCapacity=bagCapacity;window._bags=bags;
  assignLog('收納袋：'+bags.length+'袋（'+bagCapacity+'ml，原始體積）','ok');
}
