// BrickSort — 格位分派
// 零件格位分派演算法：fitsSmallSlot, gatewayAssign 等
// 全域作用域：使用傳統 <script src> 載入，禁止 ES Module

function fitsSmallSlot(item){const w=(item.dimW||0)*10,l=(item.dimL||0)*10,h=(item.dimH||0)*10;if(w<=0||l<=0||h<=0){const vol=item.estimateVolumeMl||0;return vol<=SLOT_ML}const d=[w,l,h].sort((a,b)=>a-b);return d[0]<=SLOT_H&&d[1]<=SLOT_W&&d[2]<=SLOT_L}
// v18a: 整格實體尺寸 48×136×38 (半格 a+b 拼起來，寬不變、長翻倍、高不變)
function fitsFullDrawer(item){const w=(item.dimW||0)*10,l=(item.dimL||0)*10,h=(item.dimH||0)*10;if(w<=0||l<=0||h<=0){const vol=item.estimateVolumeMl||0;return vol<=DRAWER_ML}const d=[w,l,h].sort((a,b)=>a-b);return d[0]<=SLOT_H&&d[1]<=SLOT_W&&d[2]<=SLOT_L*2}
function fitsLargeSlot(item){const w=(item.dimW||0)*10,l=(item.dimL||0)*10,h=(item.dimH||0)*10;if(w<=0||l<=0||h<=0){const vol=item.estimateVolumeMl||0;return vol<=LARGE_ML}const d=[w,l,h].sort((a,b)=>a-b);return d[0]<=53&&d[1]<=108&&d[2]<=136}

// ═══ SERIES TAG DETECTION ═══
// Maps from Rebrickable minifig prefix → series name
const SERIES_PREFIX_MAP={
  njo:'Ninjago',ang:'Ninjago', // Ninjago variants
  sw:'Star Wars',
  sh:'Super Heroes',mar:'Super Heroes',
  dc:'DC',
  hp:'Harry Potter',lor:'Lord of the Rings',
  jw:'Jurassic',dino:'Jurassic',
  dreamzzz:'DreamZzz',dzz:'DreamZzz',
  disney:'Disney',toy:'Toy Story',
  cty:'City',frnd:'Friends',idea:'Ideas',
  mk:'Monkie Kid',hs:'Hidden Side',tlm:'LEGO Movie',
  fst:'Fusion',col:'Collectible',
  hol:'Holiday',sp:'Space',cas:'Castle',pi:'Pirates'
};
// Keyword → series (for items without clear designId)
const SERIES_KEYWORDS={
  'Ninjago':['ninjago','忍者','幻影忍者','lloyd','kai','zane','cole','jay','nya','garmadon','arin','sora','spinjitzu','勞埃德','贊恩','冰忍','火忍','吳大師'],
  'DreamZzz':['dreamzzz','dream zzz','mateo','zoey','cooper','logan','izzie','zian'],
  'Jurassic':['jurassic','dinosaur','raptor','velociraptor','dilophosaurus','trex','brachio','恐龍','迅猛龍','雙冠龍'],
  'Super Heroes':['spider-man','iron man','hulk','thor','captain america','rocket','star-lord','groot','marvel','avenger'],
  'DC':['batman','superman','wonder woman','joker','harley','dc comics','robin'],
  'Harry Potter':['harry potter','hermione','ron weasley','dumbledore','voldemort','hogwarts','哈利波特','妙麗'],
  'Star Wars':['vader','luke skywalker','yoda','stormtrooper','jedi','sith','lightsaber','chewbacca','星戰','光劍'],
  'Monkie Kid':['monkie kid','sun wukong','悟空小俠','monkey king'],
  'Disney':['mickey','minnie','donald','disney'],
  'Minecraft':['minecraft','麥塊','我的世界','steve','alex','creeper','enderman','zombie']
};
function detectSeriesFromDesignId(did){
  if(!did)return null;
  const m=String(did).toLowerCase().match(/^([a-z]+)\d/);
  if(!m)return null;
  return SERIES_PREFIX_MAP[m[1]]||null;
}
function detectSeriesFromText(item){
  const txt=((item.name||'')+' '+(item.nameCN||'')+' '+(item.description||'')).toLowerCase();
  for(const series in SERIES_KEYWORDS){
    for(const kw of SERIES_KEYWORDS[series]){
      if(txt.includes(kw))return series;
    }
  }
  return null;
}
function detectSeries(item){
  // Explicit seriesTag wins
  if(item.seriesTag)return item.seriesTag;
  // Derive from characterTag (minifigNum)
  if(item.characterTag){
    const m=String(item.characterTag).toLowerCase().match(/^([a-z]+)-?\d/);
    if(m&&SERIES_PREFIX_MAP[m[1]])return SERIES_PREFIX_MAP[m[1]];
    // Also try: characterTag might be minifig entry with 'fig-' prefix → needs mapping
  }
  // Try designId prefix
  const byDid=detectSeriesFromDesignId(item.designId);
  if(byDid)return byDid;
  // Keyword fallback
  return detectSeriesFromText(item);
}

// Series bag management
function findSeriesBag(seriesTag,vol){
  const cap=BAG_ML_DEFAULT;
  const bags=(slotConfig.seriesBags||{})[seriesTag]||[];
  for(const slot of bags){if(getBagVol(slot)+vol<=cap)return slot}
  return null;
}
function allocateNewSeriesBag(seriesTag){
  const lastBag=slotConfig.nextBagSlot||'B01';
  slotConfig.nextBagSlot=advanceBag(lastBag);
  if(!slotConfig.seriesBags)slotConfig.seriesBags={};
  if(!slotConfig.seriesBags[seriesTag])slotConfig.seriesBags[seriesTag]=[];
  slotConfig.seriesBags[seriesTag].push(lastBag);
  markDirty('__config__');
  return lastBag;
}
function isBagSeriesTagged(bagSlot){
  const sb=slotConfig.seriesBags||{};
  for(const s in sb){if(sb[s].includes(bagSlot))return true}
  return false;
}
function getBagSeriesTag(bagSlot){
  const sb=slotConfig.seriesBags||{};
  for(const s in sb){if(sb[s].includes(bagSlot))return s}
  return null;
}


// ═══════════════════════════════════════════════════
// SORT & FILTER & TABLE (from editor)
// ═══════════════════════════════════════════════════
function sortBy(key){if(currentSort.key===key)currentSort.dir=currentSort.dir==='asc'?'desc':'asc';else{currentSort.key=key;currentSort.dir='asc'}applySort()}
function applySort(){const[key,dir]=(document.getElementById('sort-select').value||'createdAt-desc').split('-');currentSort={key,dir:dir||'asc'};applyFilter()}
function applyFilter(){
  const q=(document.getElementById('filter-input').value||'').toLowerCase().trim();
  filtered=allItems.filter(i=>{if(!q)return true;return[i.name,i.nameCN,i.designId,i.slot,i.overflowSlot,(i.featureTags||[]).join(' '),i.bricklinkCategory,i.description].join(' ').toLowerCase().includes(q)});
  const{key,dir}=currentSort,m=dir==='desc'?-1:1;
  filtered.sort((a,b)=>{let va,vb;
    if(key==='vol'){va=a.estimateVolumeMl||0;vb=b.estimateVolumeMl||0}
    else if(key==='totalVol'){va=(a.estimateVolumeMl||0)*(a.quantity||1);vb=(b.estimateVolumeMl||0)*(b.quantity||1)}
    else if(key==='dimW'){va=(a.dimW||0)*10;vb=(b.dimW||0)*10}
    else if(key==='dimL'){va=(a.dimL||0)*10;vb=(b.dimL||0)*10}
    else if(key==='dimH'){va=(a.dimH||0)*10;vb=(b.dimH||0)*10}
    else if(key==='quantity'){va=a.quantity||1;vb=b.quantity||1}
    else if(key==='createdAt'){va=a.createdAt||0;vb=b.createdAt||0}
    else if(key==='updatedAt'){va=a.updatedAt||a.createdAt||0;vb=b.updatedAt||b.createdAt||0}
    else if(key==='slot'){return(a.slot||'').localeCompare(b.slot||'',undefined,{numeric:true})*m}
    else if(key==='name'){return(a.name||a.nameCN||'').localeCompare(b.name||b.nameCN||'')*m}
    else if(key==='designId'){return(a.designId||'').localeCompare(b.designId||'',undefined,{numeric:true})*m}
    else if(key==='rank'){va=a.rebrickableRank||999999;vb=b.rebrickableRank||999999}
    else{va=0;vb=0}return typeof va==='number'?(va-vb)*m:0});
  document.getElementById('count-label').textContent=filtered.length+'/'+allItems.length;
  renderTable();
}
function renderTable(){
  document.getElementById('tbody').innerHTML=filtered.map(item=>{
    const did=item.designId||'',baseId=did.replace(/(pb|pr|pat)\d+.*$/i,'');
    const thumb=item.thumbnailUrl||item.imageData||(baseId?'https://cdn.rebrickable.com/media/parts/ldraw/7/'+baseId+'.png':'');
    const thumbFb=item.imageData||'';
    const vol=item.estimateVolumeMl?item.estimateVolumeMl.toFixed(1):'–';
    const st=item.slotType||'small',sc=st==='large'?'slot-large':st==='bag'?'slot-bag':st==='box'?'slot-box':'slot-small';
    const tags=(item.featureTags||[]).slice(0,2).map(t=>'<span class="tag">'+t+'</span>').join('');
    const dr=dirty.has(item.id)?' style="border-left:3px solid var(--accent)"':'';
    const ov=item.overflowSlot&&(item.overflowQty||0)>0?'<span class="overflow-tag">+'+item.overflowSlot+'('+item.overflowQty+'件)</span>':'';
    const thumbErr=thumbFb?'onerror="this.src=this.dataset.fb;this.onerror=null"':'onerror="this.style.display=\'none\'"';
    return'<tr onclick="openItem(\''+item.id+'\')"'+dr+'>'+
      '<td>'+(thumb?'<img class="thumb" src="'+thumb+'" data-fb="'+thumbFb+'" loading="lazy" '+thumbErr+'>':'🧱')+'</td>'+
      '<td><div style="font-weight:500">'+(item.name||item.nameCN||'未知')+'</div>'+(item.nameCN&&item.name?'<div style="font-size:11px;color:var(--muted)">'+item.nameCN+'</div>':'')+'</td>'+
      '<td class="mono" style="font-size:11px">'+did+'</td>'+
      '<td class="mono">'+vol+'</td><td class="mono">'+(item.quantity||1)+'</td>'+
      '<td><span class="slot-badge '+sc+'" onclick="event.stopPropagation();goToSlot(\''+item.slot+'\')" style="cursor:pointer">'+(item.slot||'?')+'</span>'+ov+'</td>'+
      '<td>'+tags+'</td></tr>';
  }).join('');
}

// ═══════════════════════════════════════════════════
// EDITOR MODAL (from editor)
// ═══════════════════════════════════════════════════
function openItem(id){currentItem=allItems.find(i=>i.id===id);if(!currentItem)return;isNewItem=false;populateModal(currentItem);const ml=document.getElementById('editor-move-list');if(ml)ml.innerHTML='';document.getElementById('overlay').classList.add('open')}

function populateModal(i){
  const did=i.designId||'',baseId=did.replace(/(pb|pr|pat)\d+.*$/i,'');
  const thumb=i.thumbnailUrl||i.imageData||'';
  const mImg=document.getElementById('m-img');
  mImg.style.display='';
  mImg.dataset.fb=i.imageData||'';
  mImg.src=thumb;
  document.getElementById('m-name').textContent=i.name||i.nameCN||(isNewItem?'新零件':'未知零件');
  document.getElementById('m-ids').textContent=isNewItem?'新建檔':'Design ID: '+did+' · '+(i.slot||'?')+' · '+(i.slotType||'small');
  // Frequent badge
  const fBadge=document.getElementById('m-frequent-badge');
  if(fBadge){
    const isFreq=isItemFrequent(i);
    const hasRebData=typeof i.rebrickableSets==='number';
    const rebSets=i.rebrickableSets||0;
    const rebRank=i.rebrickableRank||0;
    const manual=i.manualFrequent;
    let html='';
    if(isFreq){
      html='<button onclick="toggleItemFrequent()" style="background:var(--accent);color:#111;border:none;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;cursor:pointer">⭐ 常用零件</button>';
    }else{
      html='<button onclick="toggleItemFrequent()" style="background:transparent;color:var(--muted);border:1px solid var(--border);padding:3px 10px;border-radius:12px;font-size:11px;cursor:pointer">☆ 標為常用</button>';
    }
    if(hasRebData){
      html+=' <span style="font-size:10px;color:var(--muted);margin-left:6px">🌍 '+rebSets+' 盒組 (#'+rebRank+')</span>';
    }
    if(manual===true)html+=' <span style="font-size:9px;color:var(--orange);margin-left:4px">(手動)</span>';
    else if(manual===false)html+=' <span style="font-size:9px;color:var(--orange);margin-left:4px">(手動排除)</span>';
    fBadge.innerHTML=html;
  }
  document.getElementById('m-qty').value=i.quantity||1;
  document.getElementById('m-dimW').value=i.dimW?Math.round(i.dimW*10):'';
  document.getElementById('m-dimL').value=i.dimL?Math.round(i.dimL*10):'';
  document.getElementById('m-dimH').value=i.dimH?Math.round(i.dimH*10):'';
  document.getElementById('m-blcat').value=i.bricklinkCategory||'';
  document.getElementById('m-tags').value=(i.featureTags||[]).join(', ');
  document.getElementById('m-desc').value=i.description||'';
  document.getElementById('m-nameEN').value=i.name||'';
  document.getElementById('m-nameCN').value=i.nameCN||'';
  document.getElementById('m-did').value=did;
  document.getElementById('m-slot').value=i.slot||'';
  document.getElementById('m-slotType').value=i.slotType||'small';
  document.getElementById('m-bl-link').href=did?'https://www.bricklink.com/v2/catalog/catalogitem.page?P='+did:'#';
  document.getElementById('m-rb-link').href=did?'https://rebrickable.com/parts/'+did+'/':'#';
  const ovEl=document.getElementById('m-overflow-info');
  const locs=getItemLocations(i);
  if(locs.length>=1){
    // Always show locations (even just 1) — gives consistent UI
    const totalQty=locs.reduce((s,l)=>s+(l.qty||0),0);
    let html='<div style="font-size:12px;color:var(--accent);font-weight:700;margin-bottom:6px">📍 收納位置 ('+locs.length+' 處 · 共 '+totalQty+' 件)</div>';
    html+='<div style="display:flex;flex-direction:column;gap:4px">';
    locs.forEach((loc,idx)=>{
      const icon=locRoleIcon(loc.role);
      const typeLabel=locTypeLabel(loc.type);
      const isSpill=loc.role==='spill';
      html+='<div style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:var(--surface);border-radius:6px;font-size:12px">';
      html+='<span style="font-size:14px;width:18px;text-align:center">'+icon+'</span>';
      html+='<span style="font-family:var(--mono);font-weight:700;color:var(--accent);min-width:60px">'+loc.slot+'</span>';
      html+='<span style="font-size:10px;color:var(--muted);min-width:48px">'+typeLabel+'</span>';
      html+='<span style="flex:1;text-align:right;font-family:var(--mono);font-size:11px">'+loc.qty+' 件</span>';
      if(isSpill){
        html+='<button onclick="event.stopPropagation();removeOverflowBag(\''+loc.slot+'\')" style="background:transparent;border:none;color:var(--red);font-size:16px;line-height:1;cursor:pointer;padding:0 4px" title="移除此位置">×</button>';
      }
      if(loc.role==='pickup'){
        html+='<button onclick="event.stopPropagation();editPickupSlot(\''+loc.slot+'\')" style="background:transparent;border:none;color:var(--accent);font-size:13px;line-height:1;cursor:pointer;padding:0 4px" title="修改取用點位置">✏️</button>';
      }
      html+='</div>';
    });
    html+='</div>';
    if(locs.length>1){
      html+='<div style="font-size:10px;color:var(--muted);margin-top:6px">★主庫存 · ✋取用點 · ➕額外位置 (可移除)</div>';
    }
    ovEl.innerHTML=html;
    ovEl.style.display='';
    // Remove the old purple styling when showing single location
    if(locs.length===1){
      ovEl.style.background='var(--card)';
      ovEl.style.border='1px solid var(--border)';
      ovEl.style.color='var(--text)';
    }else{
      ovEl.style.background='';
      ovEl.style.border='';
      ovEl.style.color='';
    }
  }else ovEl.style.display='none';
  document.getElementById('m-overflow-warn').innerHTML='';recalcVol();
}

// Remove a single bag from current item's overflow list
function removeOverflowBag(bag){
  if(!currentItem)return;
  const i=currentItem;
  const existing=(i.overflowSlot||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(!existing.includes(bag)){showToast('找不到 '+bag,'error');return}
  if(!confirm('從溢出中移除 '+bag+' 嗎？\n\n注意：該位置若真的有物品，您需要實體手動移動。\n\n系統只會更新溢出紀錄。'))return;
  const filtered=existing.filter(s=>s!==bag);
  i.overflowSlot=filtered.join(',');
  // Recalculate overflowQty: how many pieces can fit in the remaining overflow bags
  const vol1=i.estimateVolumeMl||0;
  if(filtered.length===0){
    // No more overflow — reduce overflowQty to 0, but keep quantity (might overflow main slot)
    i.overflowQty=0;
  }else{
    // Keep overflow but cap qty to what remaining bags can hold
    const bagCap=BAG_ML_DEFAULT;
    const piecesPerBag=vol1>0?Math.max(1,Math.floor(bagCap/vol1)):(i.overflowQty||0);
    const maxOverQty=piecesPerBag*filtered.length;
    if((i.overflowQty||0)>maxOverQty){
      i.overflowQty=maxOverQty;
    }
  }
  i.updatedAt=Date.now();
  markDirty(i.id);
  // Refresh the modal UI
  populateModal(i);
  showToast('已從溢出中移除 '+bag);
}
function editPickupSlot(currentSlot){
  if(!currentItem)return;
  const i=currentItem;
  const val=prompt('修改取用點位置\n\n目前：'+currentSlot+'\n\n請輸入新位置（例：125a 半格、125 整格、L05 大抽屜）：',currentSlot);
  if(val===null)return; // 使用者取消
  const slot=val.trim();
  if(!slot){showToast('位置不可空白','error');return}
  // 驗證格式並判斷 pickupType
  let pickupType='small';
  if(/^L\d+$/i.test(slot)){
    pickupType='large';
    const n=parseInt(slot.replace(/[^\d]/g,''));
    if(n<1||n>LARGE_COUNT){showToast('大抽屜編號超出範圍 (L01-L'+String(LARGE_COUNT).padStart(2,'0')+')','error');return}
  }else if(/^\d+[ab]?$/.test(slot)){
    pickupType='small';
    const n=parseInt(slot.replace(/[a-z]/gi,''));
    if(n<1||n>450){showToast('小抽屜編號超出範圍 (1-450)','error');return}
  }else{
    showToast('格式錯誤（例：125a、125、L05）','error');return;
  }
  // 取用點不能放收納袋（取用點的用途就是方便拿取的抽屜）
  if(/^B\d+$/i.test(slot)){showToast('取用點不能設為收納袋，請用小抽屜或大抽屜','error');return}
  i.pickupSlot=slot.replace(/[A-Z]/g,c=>c.toLowerCase());
  i.pickupType=pickupType;
  i.updatedAt=Date.now();
  markDirty(i.id);
  populateModal(i);
  showToast('✏️ 取用點已改為 '+i.pickupSlot);
}

function closeModal(){
  document.getElementById('overlay').classList.remove('open');
  const el=document.getElementById('editor-move-list');if(el)el.innerHTML='';
  currentItem=null;isNewItem=false;
}
function recalcVol(){
  const w=parseFloat(document.getElementById('m-dimW').value)||0,l=parseFloat(document.getElementById('m-dimL').value)||0,h=parseFloat(document.getElementById('m-dimH').value)||0,qty=parseInt(document.getElementById('m-qty').value)||1;
  let vol=0;if(w>0&&l>0&&h>0)vol=Math.round(w*l*h/1000*10)/10;else if(currentItem)vol=currentItem.estimateVolumeMl||0;
  const tv=Math.round(vol*qty*10)/10,el=document.getElementById('m-vol-display');
  if(w>0&&l>0&&h>0)el.innerHTML='<div>佔位體積</div><div>'+w+' × '+l+' × '+h+' mm = <b>'+vol+' ml</b> × '+qty+' 件 = <b>'+tv+' ml</b></div>';
  else el.innerHTML='<div>佔位體積</div><div><b>'+vol+' ml</b> × '+qty+' 件 = <b>'+tv+' ml</b></div><div style="font-size:11px;color:var(--muted)">填入尺寸可精確計算</div>';
  if(currentItem&&!isNewItem&&currentItem.slot){
    // Calculate volume actually in the MAIN slot (excluding pickup and overflow)
    const pickupQty=currentItem.pickupQty||0;
    const overflowQty=currentItem.overflowQty||0;
    const mainQty=Math.max(0, qty - pickupQty - overflowQty);
    const mainVol=Math.round(vol*mainQty*10)/10;
    const cap=getSlotCap(currentItem.slot,currentItem.slotType),warnEl=document.getElementById('m-overflow-warn');
    const otherVol=allItems.filter(i=>i.slot===currentItem.slot&&i.id!==currentItem.id).reduce((s,i)=>s+(i.estimateVolumeMl||0)*((i.quantity||1) - (i.pickupQty||0) - (i.overflowQty||0)),0);
    const slotTotal=Math.round((otherVol+mainVol)*10)/10;
    const availCap=Math.max(0,cap-otherVol);
    if(slotTotal>cap&&cap<Infinity){
      const fq=Math.max(0,Math.floor(availCap/(vol||1)));const oq=mainQty-fq;
      let warn='⚠ 主位容量超出！<b>'+currentItem.slot+'</b> 上限 '+cap+'ml';
      if(otherVol>0)warn+='<br>同格其他物品佔 '+Math.round(otherVol*10)/10+'ml，剩餘空間 '+Math.round(availCap*10)/10+'ml';
      warn+='<br>主位需放 '+mainQty+' 件 ('+mainVol+'ml)，格子總計 <b>'+slotTotal+'ml</b>';
      if(pickupQty>0)warn+='<br><span style="font-size:11px">✋ 快取點 '+currentItem.pickupSlot+' 已分走 '+pickupQty+' 件</span>';
      if(overflowQty>0)warn+='<br><span style="font-size:11px">➕ 溢出 '+currentItem.overflowSlot+' 已分走 '+overflowQty+' 件</span>';
      if(oq>0){
        warn+='<br>建議留 '+fq+' 件，再溢出 '+oq+' 件<br>';
        warn+='<div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">';
        warn+='<button class="btn btn-sm btn-primary" onclick="showEditorMoveList(\'move_all\')" style="font-size:12px;padding:8px 10px">🔄 全部移到新位置（清除原格）</button>';
        warn+='<button class="btn btn-sm" onclick="showEditorMoveList(\'overflow\')" style="font-size:12px;padding:8px 10px">➕ 指派第二位置（部分溢出，保留原格）</button>';
        warn+='<span style="font-size:11px;color:var(--muted);text-align:center">💡 或直接儲存 → 系統自動溢出到最空的袋</span></div>';
      }
      else warn+='<br>此物品不需溢出，但同格其他物品可能需要調整';
      warnEl.innerHTML='<div class="overflow-warn">'+warn+'</div>';
    }else warnEl.innerHTML='';
  }
}

function pasteFromClipboard(){
  function parseDimText(text){
    if(!text)return;
    const m=text.match(/([\d.]+)\s*[x×X]\s*([\d.]+)\s*[x×X]\s*([\d.]+)\s*(cm|mm|in)?/i);
    if(m){let w=parseFloat(m[1]),l=parseFloat(m[2]),h=parseFloat(m[3]);const u=(m[4]||'cm').toLowerCase();if(u==='cm'){w*=10;l*=10;h*=10}else if(u==='in'){w*=25.4;l*=25.4;h*=25.4}document.getElementById('m-dimW').value=Math.round(w*10)/10;document.getElementById('m-dimL').value=Math.round(l*10)/10;document.getElementById('m-dimH').value=Math.round(h*10)/10;recalcVol();showToast('已貼上尺寸（'+u+'→mm）')}
    else showToast('無法解析尺寸格式','error');
  }
  // Try clipboard API first (Chrome)
  if(navigator.clipboard&&navigator.clipboard.readText&&!window._isAPK){
    navigator.clipboard.readText().then(parseDimText).catch(()=>showPasteDialog(parseDimText));
    return;
  }
  showPasteDialog(parseDimText);
}

function showPasteDialog(callback){
  let ov=document.getElementById('paste-overlay');
  if(!ov){
    ov=document.createElement('div');ov.id='paste-overlay';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px';
    ov.innerHTML='<div style="background:var(--card);border-radius:16px;padding:20px;width:100%;max-width:340px"><div style="font-size:14px;font-weight:700;color:var(--accent);margin-bottom:8px">📋 貼上尺寸</div><div style="font-size:12px;color:var(--muted);margin-bottom:12px">從 BrickLink 複製尺寸後，在下方長按貼上<br>格式：1.6 x 1.6 x 0.3 cm</div><input id="paste-input" type="text" placeholder="長按此處貼上…" style="width:100%;background:var(--surface);border:2px solid var(--accent);color:var(--text);padding:12px;border-radius:10px;font-size:16px;font-family:var(--mono);box-sizing:border-box;margin-bottom:12px"><div style="display:flex;gap:8px"><button onclick="closePasteDialog()" class="btn" style="flex:1;padding:10px">取消</button><button onclick="submitPasteDialog()" class="btn btn-primary" style="flex:1;padding:10px">✓ 確定</button></div></div>';
    document.body.appendChild(ov);
  }
  ov.style.display='flex';
  window._pasteCallback=callback;
  const inp=document.getElementById('paste-input');inp.value='';
  setTimeout(()=>inp.focus(),200);
}
function closePasteDialog(){const ov=document.getElementById('paste-overlay');if(ov)ov.style.display='none'}
function submitPasteDialog(){
  const text=document.getElementById('paste-input').value.trim();
  closePasteDialog();
  if(text&&window._pasteCallback)window._pasteCallback(text);
}
function pasteToInput(inputId){
  function applyPaste(text){
    if(!text)return;
    const el=document.getElementById(inputId);
    if(el){el.value=text.trim();el.type='text';showToast('已貼上')}
  }
  if(navigator.clipboard&&navigator.clipboard.readText&&!window._isAPK){
    navigator.clipboard.readText().then(applyPaste).catch(()=>showPasteDialog(applyPaste));
    return;
  }
  showPasteDialog(applyPaste);
}

function openExternalLink(url){
  if(!url||url==='#')return;
  if(window.BrickSortNative){
    // APK: try native bridge first, fallback to copy URL
    try{
      if(BrickSortNative.openExternal){BrickSortNative.openExternal(url);return}
    }catch(e){}
    // Fallback: copy URL to clipboard + toast
    try{navigator.clipboard.writeText(url)}catch(e){
      const ta=document.createElement('textarea');ta.value=url;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);
    }
    showToast('已複製連結，請在瀏覽器開啟');
    return;
  }
  window.open(url,'_blank');
}

function editorSaveItem(){
  if(!currentItem)return;const i=currentItem;
  const w=parseFloat(document.getElementById('m-dimW').value)||0,l=parseFloat(document.getElementById('m-dimL').value)||0,h=parseFloat(document.getElementById('m-dimH').value)||0;
  i.quantity=parseInt(document.getElementById('m-qty').value)||1;
  i.dimW=w>0?w/10:(i.dimW||0);i.dimL=l>0?l/10:(i.dimL||0);i.dimH=h>0?h/10:(i.dimH||0);
  if(w>0&&l>0&&h>0)i.estimateVolumeMl=Math.round(w*l*h/1000*10)/10;
  i.bricklinkCategory=normalizeCategory(document.getElementById('m-blcat').value.trim());
  i.featureTags=document.getElementById('m-tags').value.split(/[,，]/).map(s=>s.trim()).filter(Boolean);
  i.description=document.getElementById('m-desc').value.trim();
  i.name=document.getElementById('m-nameEN').value.trim();
  i.nameCN=document.getElementById('m-nameCN').value.trim();
  i.designId=document.getElementById('m-did').value.trim();i.updatedAt=Date.now();
  if(isNewItem){const r=gatewayAssign(i);i.slot=r.slot;i.slotType=r.slotType;i.createdAt=Date.now();allItems.unshift(i);showToast('新零件編入 '+i.slot+'（'+i.slotType+'）')}
  else{
    const oldSlot=i.slot;
    const oldOverflow=i.overflowSlot||'';
    const newSlot=document.getElementById('m-slot').value.trim();
    const newSlotType=document.getElementById('m-slotType').value;
    // Bounds check for manual slot edits
    if(newSlotType==='small'){
      const m=newSlot.match(/^0*(\d+)[ab]?$/);
      if(!m){showToast('小抽屜格式錯誤（例 420a）','error');return}
      const n=parseInt(m[1]);
      if(n<1||n>450){showToast('小抽屜編號超出範圍 (1-450)，超過請改用收納袋','error');return}
    }else if(newSlotType==='large'){
      const m=newSlot.match(/^L(\d+)$/i);
      if(!m){showToast('大抽屜格式錯誤（例 L05）','error');return}
      const n=parseInt(m[1]);
      if(n<1||n>27){showToast('大抽屜編號超出範圍 (L01-L27)','error');return}
    }else if(newSlotType==='bag'){
      if(!/^B\d+$/i.test(newSlot)){showToast('收納袋格式錯誤（例 B01）','error');return}
    }
    // If user manually changed slot → move ALL to new slot, clear overflow
    if(newSlot!==oldSlot||newSlotType!==i.slotType){
      i.slot=newSlot;i.slotType=newSlotType;
      i.overflowSlot='';i.overflowQty=0;
      // Mirror sync
      const partner=findMirrorPartner(i);
      let msg=(oldOverflow?'已移到 '+newSlot+'（清除原溢出 '+oldOverflow+'）':'已移到 '+newSlot);
      if(partner){
        const pOldSlot=partner.slot;
        partner.slot=newSlot;partner.slotType=newSlotType;
        partner.overflowSlot='';partner.overflowQty=0;
        partner.updatedAt=Date.now();
        markDirty(partner.id);
        msg+='\n🔗 鏡射件「'+((partner.nameCN||partner.name||'').substring(0,18))+'」同步 '+pOldSlot+'→'+newSlot;
      }
      showToast(msg);
    }else{
      // Slot unchanged → auto-overflow check (expand if qty increased)
      const ovResult=autoOverflowCheck(i);
      if(ovResult){showToast('已儲存 → 溢出 '+ovResult.overQty+' 件到 '+ovResult.bagSlot)}
      else{showToast('已暫存（點回傳上傳）')}
    }
  }
  markDirty(i.id);closeModal();renderStats();applyFilter();
}
function autoAssign(vt){
  return assignToBag(vt);
}
function deleteItem(){
  if(!currentItem)return;if(!confirm('確定刪除「'+(currentItem.name||currentItem.nameCN)+'」？'))return;
  fbDeleteItem(currentItem.id).then(()=>showToast('已刪除')).catch(e=>showToast('刪除失敗','error'));
  allItems=allItems.filter(i=>i.id!==currentItem.id);dirty.delete(currentItem.id);
  closeModal();renderStats();applyFilter();
}

// Case A/B: move ALL of this item to a new bag, releasing the original slot
function moveAllToBag(){
  if(!currentItem)return;
  const i=currentItem;
  const oldSlot=i.slot;
  const oldType=i.slotType;
  const oldOverflow=i.overflowSlot||'';
  const vt=(i.estimateVolumeMl||0)*(i.quantity||1);
  const cg=getCatGroup(i.featureTags||[],normalizeCategory(i.bricklinkCategory||''));
  const charTag=i.characterTag||null;
  const seriesTag=i.seriesTag||detectSeries(i)||null;
  const r=assignToBag(vt,cg,charTag,seriesTag);
  i.slot=r.slot;
  i.slotType='bag';
  i.overflowSlot='';
  i.overflowQty=0;
  i.updatedAt=Date.now();
  // Update modal display
  document.getElementById('m-slot').value=r.slot;
  document.getElementById('m-slotType').value='bag';
  recalcVol();
  markDirty(i.id);
  let msg='✅ 已全部移到 '+r.slot+'（原 '+oldSlot+'/'+oldType+' 釋出';
  if(oldOverflow)msg+='，清除原溢出 '+oldOverflow;
  msg+='）';
  // Mirror sync
  const partner=findMirrorPartner(i);
  if(partner){
    const pOldSlot=partner.slot;
    partner.slot=r.slot;partner.slotType='bag';
    partner.overflowSlot='';partner.overflowQty=0;
    partner.updatedAt=Date.now();
    markDirty(partner.id);
    msg+='\n🔗 鏡射件「'+((partner.nameCN||partner.name||'').substring(0,18))+'」同步 '+pOldSlot+'→'+r.slot;
  }
  showToast(msg);
}

// Editor: show top-5 list for "move all" or "overflow" mode
function showEditorMoveList(mode){
  if(!currentItem)return;
  currentItem._moveMode=mode;
  const listEl=document.getElementById('editor-move-list');
  if(!listEl)return;
  const label=mode==='move_all'?'🔄 選擇新位置（會釋出原格）':'➕ 選擇第二位置（溢出去處）';
  let html='<div style="background:var(--card);border:1px solid var(--accent);border-radius:8px;padding:10px;margin-top:4px">';
  html+='<div style="font-size:12px;font-weight:700;color:var(--accent);margin-bottom:8px">'+label+'</div>';
  html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">';
  html+='<button class="btn btn-sm" onclick="renderEditorMoveOptions(\'bag\')" style="font-size:11px">📦 收納袋</button>';
  if(mode==='move_all'){
    html+='<button class="btn btn-sm" onclick="renderEditorMoveOptions(\'drawer\')" style="font-size:11px">🗄️ 格子 (a+b)</button>';
    html+='<button class="btn btn-sm" onclick="renderEditorMoveOptions(\'small\')" style="font-size:11px">🗄 小抽屜分格</button>';
  }
  html+='</div>';
  html+='<div id="editor-move-options"></div>';
  html+='<div style="display:flex;gap:6px;align-items:center;margin-top:8px"><input type="text" id="editor-manual-slot" placeholder="手動輸入（例 B01、421、421a、L05）" style="flex:1;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:6px 8px;border-radius:6px;font-size:12px;font-family:var(--mono)"><button class="btn btn-green btn-sm" onclick="applyEditorManual()" style="font-size:11px">✓</button></div>';
  html+='<div style="font-size:10px;color:var(--muted);margin-top:4px">💡 輸入 421 = 整個格子 (a+b)；421a = 單分格</div>';
  html+='<button class="btn btn-sm" onclick="cancelEditorMove()" style="width:100%;margin-top:6px;font-size:11px">取消</button>';
  html+='</div>';
  listEl.innerHTML=html;
}

function renderEditorMoveOptions(slotType){
  const topSlots=getTopEmptySlots(slotType,5);
  const el=document.getElementById('editor-move-options');
  if(!el)return;
  const title=slotType==='drawer'?'Top 5 全空抽屜 (整格 a+b)：':'Top 5 最空 (點選直接套用)：';
  let html='<div style="font-size:11px;color:var(--muted);margin:4px 0">'+title+'</div>';
  if(!topSlots.length){
    html+='<div style="font-size:11px;color:var(--muted);text-align:center;padding:6px">'+(slotType==='drawer'?'無完全空的整格抽屜':'無現有可用位置')+'</div>';
  }else{
    topSlots.forEach(s=>{
      const label=slotType==='drawer'?s.slot+' (整格)':s.slot;
      html+='<div onclick="applyEditorMove(\''+s.slot+'\',\''+slotType+'\')" style="display:flex;justify-content:space-between;padding:6px 8px;background:var(--surface);border-radius:6px;margin-bottom:3px;cursor:pointer">';
      html+='<span style="font-family:var(--mono);font-weight:700;color:var(--accent)">'+label+'</span>';
      html+='<span style="font-size:10px;color:var(--muted)">餘 '+s.remaining+'/'+s.cap+'ml</span>';
      html+='</div>';
    });
  }
  if(slotType==='small'){
    const ns=slotConfig.nextSmallSlot||'001a';
    html+='<div onclick="applyEditorMove(\''+ns+'\',\'small\')" style="padding:6px 8px;background:var(--green-bg);border:1px dashed var(--green);border-radius:6px;cursor:pointer;text-align:center;font-family:var(--mono);color:var(--green);font-weight:700;font-size:12px;margin-top:4px">✨ '+ns+' (新分格)</div>';
  }else if(slotType==='drawer'){
    const ns=slotConfig.nextSmallSlot||'001a';
    const nsBare=ns.replace(/[a-z]/g,'');
    html+='<div onclick="applyEditorMove(\''+nsBare+'\',\'drawer\')" style="padding:6px 8px;background:var(--green-bg);border:1px dashed var(--green);border-radius:6px;cursor:pointer;text-align:center;font-family:var(--mono);color:var(--green);font-weight:700;font-size:12px;margin-top:4px">✨ '+nsBare+' (新整格)</div>';
  }else if(slotType==='bag'){
    const ns=slotConfig.nextBagSlot||'B01';
    html+='<div onclick="applyEditorMove(\''+ns+'\',\'bag\')" style="padding:6px 8px;background:var(--green-bg);border:1px dashed var(--green);border-radius:6px;cursor:pointer;text-align:center;font-family:var(--mono);color:var(--green);font-weight:700;font-size:12px;margin-top:4px">✨ '+ns+' (新袋)</div>';
  }
  el.innerHTML=html;
}

// Find mirror partner (Left ↔ Right) by name matching
// Find mirror partner (paired item that should be stored together)
// Pairs recognized:
//   Left ↔ Right / 左 ↔ 右
//   Upper ↔ Lower / 上 ↔ 下 (hinges especially)
//   Top ↔ Bottom
//   Male ↔ Female / 公 ↔ 母 (connectors, hinges)
function findMirrorPartner(item){
  if(!item)return null;
  const name=(item.name||'').trim();
  const nameCN=(item.nameCN||'').trim();
  const candidates=[];
  // Helper: add EN pair (whole word case-insensitive)
  function addEnPair(w1, w2){
    const re1=new RegExp('\\b'+w1+'\\b','i');
    const re2=new RegExp('\\b'+w2+'\\b','i');
    if(re1.test(name)) candidates.push({name:name.replace(re1, w2)});
    else if(re2.test(name)) candidates.push({name:name.replace(re2, w1)});
  }
  // Helper: add CN pair (single char)
  function addCnPair(c1, c2){
    if(nameCN.indexOf(c1)>=0) candidates.push({nameCN:nameCN.split(c1).join(c2)});
    else if(nameCN.indexOf(c2)>=0) candidates.push({nameCN:nameCN.split(c2).join(c1)});
  }
  // English paired variants
  addEnPair('Left', 'Right');
  addEnPair('Upper', 'Lower');
  addEnPair('Top', 'Bottom');
  addEnPair('Male', 'Female');
  // Chinese paired variants
  addCnPair('左', '右');
  addCnPair('上', '下');
  addCnPair('公', '母');
  if(!candidates.length)return null;
  // Find matching item (exclude self)
  return allItems.find(j=>{
    if(j.id===item.id)return false;
    return candidates.some(c=>(c.name&&j.name===c.name)||(c.nameCN&&j.nameCN===c.nameCN));
  })||null;
}

function applyEditorMove(slot,slotType){
  if(!currentItem)return;
  const i=currentItem;
  const mode=i._moveMode||'move_all';
  // "drawer" = full drawer (no a/b suffix) — store as bare 3-digit number, slotType='small'
  // The slot string itself (e.g. "421") already has no suffix; slotType stays 'small'
  let storeSlot=slot;
  let storeType=slotType;
  if(slotType==='drawer'){
    storeSlot=String(parseInt(slot)).padStart(3,'0'); // ensure "421" not "421a"
    storeType='small';
  }
  // Auto-advance pointer if new slot
  if(storeType==='small'&&(slot===(slotConfig.nextSmallSlot||'')||slotType==='drawer')){
    const curNextNum=parseInt((slotConfig.nextSmallSlot||'001a').replace(/[a-z]/g,''));
    const targetNum=parseInt(storeSlot);
    if(targetNum>=curNextNum){
      slotConfig.nextSmallSlot=String(targetNum+1).padStart(3,'0')+'a';
      markDirty('__config__');
    }
  }else if(storeType==='bag'&&slot===(slotConfig.nextBagSlot||'')){
    slotConfig.nextBagSlot=advanceBag(slot);
    markDirty('__config__');
  }
  // Auto-split: if target is an a/b side (e.g. "249b") but the full drawer ("249") has items,
  // migrate the full-drawer items to the OPPOSITE side to free up the requested side.
  let splitMsg='';
  if(storeType==='small'){
    const abMatch=storeSlot.match(/^(\d+)([ab])$/);
    if(abMatch){
      const drawerNum=abMatch[1], targetSide=abMatch[2];
      const oppositeSide=targetSide==='a'?'b':'a';
      const bareDrawer=String(parseInt(drawerNum)).padStart(3,'0');
      const bareDrawerPlain=String(parseInt(drawerNum));
      // Find items stored at the bare (full-drawer) slot — excluding current item
      const fullDrawerItems=allItems.filter(x=>x.id!==i.id&&(x.slot===bareDrawer||x.slot===bareDrawerPlain));
      if(fullDrawerItems.length>0){
        // Migrate those items to opposite side
        fullDrawerItems.forEach(x=>{
          x.slot=bareDrawer+oppositeSide;
          x.updatedAt=Date.now();
          markDirty(x.id);
        });
        splitMsg='\n📦 抽屜 '+bareDrawer+' 自動拆分：原 '+fullDrawerItems.length+' 件物品移到 '+bareDrawer+oppositeSide;
      }
    }
    // Reverse: if selecting full-drawer (e.g. "249") but a or b has items, block unless confirmed
    else if(/^\d+$/.test(storeSlot)){
      const bareDrawer=String(parseInt(storeSlot)).padStart(3,'0');
      const sideItems=allItems.filter(x=>x.id!==i.id&&(x.slot===bareDrawer+'a'||x.slot===bareDrawer+'b'||x.slot===storeSlot+'a'||x.slot===storeSlot+'b'));
      if(sideItems.length>0){
        const ok=confirm('⚠ 抽屜 '+bareDrawer+' 的 a 或 b 分格已有 '+sideItems.length+' 件物品。\n\n選擇「整格」會與那些物品共用空間。\n\n繼續嗎？');
        if(!ok){delete i._moveMode;cancelEditorMove();return}
        splitMsg='\n⚠ 抽屜 '+bareDrawer+' 與 '+sideItems.length+' 件分格物品共用空間';
      }
    }
  }
  if(mode==='move_all'){
    const oldSlot=i.slot,oldOv=i.overflowSlot||'';
    i.slot=storeSlot;i.slotType=storeType;
    i.overflowSlot='';i.overflowQty=0;
    i.updatedAt=Date.now();
    document.getElementById('m-slot').value=storeSlot;
    document.getElementById('m-slotType').value=storeType;
    // Mirror sync: also move Left/Right partner
    const partner=findMirrorPartner(i);
    const destLabel=slotType==='drawer'?storeSlot+' (整格 a+b)':storeSlot;
    let msg='✅ 已全部移到 '+destLabel+'（原 '+oldSlot+' 釋出'+(oldOv?'，清除原溢出 '+oldOv:'')+'）';
    if(partner){
      const pOldSlot=partner.slot;
      partner.slot=storeSlot;partner.slotType=storeType;
      partner.overflowSlot='';partner.overflowQty=0;
      partner.updatedAt=Date.now();
      markDirty(partner.id);
      msg+='\n🔗 鏡射件「'+((partner.nameCN||partner.name||'').substring(0,18))+'」同步 '+pOldSlot+'→'+storeSlot;
    }
    if(splitMsg)msg+=splitMsg;
    showToast(msg);
  }else{
    // overflow: append to overflowSlot, compute overflow qty
    const cap=getSlotCap(i.slot,i.slotType);
    const v1=i.estimateVolumeMl||0;
    const otherVol=allItems.filter(x=>x.slot===i.slot&&x.id!==i.id).reduce((s,x)=>s+(x.estimateVolumeMl||0)*(x.quantity||1),0);
    const availCap=Math.max(0,cap-otherVol);
    const fitsQty=Math.max(0,Math.floor(availCap/(v1||1)));
    const overQty=Math.max(0,(i.quantity||1)-fitsQty);
    const existing=(i.overflowSlot||'').split(',').map(s=>s.trim()).filter(Boolean);
    if(!existing.includes(storeSlot))existing.push(storeSlot);
    i.overflowSlot=existing.join(',');
    i.overflowQty=overQty;
    showToast('✅ 溢出 '+overQty+' 件到 '+storeSlot+'（主位 '+i.slot+' 保留 '+fitsQty+' 件）');
  }
  delete i._moveMode;
  i.updatedAt=Date.now();
  markDirty(i.id);
  cancelEditorMove();
  recalcVol();
}

function applyEditorManual(){
  const val=(document.getElementById('editor-manual-slot')?.value||'').trim();
  if(!val){showToast('請輸入位置','error');return}
  let slotType='small';
  let passVal=val;
  if(/^B\d+$/i.test(val))slotType='bag';
  else if(/^L\d+$/i.test(val)){
    slotType='large';
    const n=parseInt(val.replace(/[^\d]/g,''));
    if(n<1||n>27){showToast('大抽屜編號超出範圍 (L01-L27)','error');return}
  }
  else if(/^\d+$/.test(val)){
    // No suffix → whole drawer (a+b combined)
    slotType='drawer';
    const n=parseInt(val);
    if(n<1||n>450){showToast('小抽屜編號超出範圍 (1-450)，超過請改用收納袋','error');return}
    passVal=String(n).padStart(3,'0');
  }
  else if(/^\d+[ab]$/.test(val)){
    slotType='small';
    const n=parseInt(val.replace(/[a-z]/g,''));
    if(n<1||n>450){showToast('小抽屜編號超出範圍 (1-450)，超過請改用收納袋','error');return}
  }
  else{showToast('格式錯誤（例：B01、421、421a、L05）','error');return}
  applyEditorMove(passVal,slotType);
}

function cancelEditorMove(){
  if(currentItem)delete currentItem._moveMode;
  const el=document.getElementById('editor-move-list');
  if(el)el.innerHTML='';
}

// ═══════════════════════════════════════════════════
// GATEWAY ASSIGN (single-item, pointer-based)
// ═══════════════════════════════════════════════════
// ═══ 角色袋路由（Phase 0）═══
function findCharacterBag(charTag){
  // Find existing dedicated bag for this character
  const char=(slotConfig.characters||{})[charTag];
  if(!char||!char.enabled)return null;
  const cap=BAG_ML_DEFAULT;
  const bagSlots=char.bagSlots||[];
  for(const slot of bagSlots){if(getBagVol(slot)<cap)return slot}
  return null;
}
function findSharedCharacterBag(vt){
  const cap=BAG_ML_DEFAULT;
  const sharedBags=slotConfig.sharedCharacterBags||[];
  for(const slot of sharedBags){if(getBagVol(slot)+vt<=cap)return slot}
  return null;
}
function allocateNewCharacterBag(charTag,isShared){
  const lastBag=slotConfig.nextBagSlot||'B01';
  slotConfig.nextBagSlot=advanceBag(lastBag);
  markDirty('__config__');
  if(isShared){
    if(!slotConfig.sharedCharacterBags)slotConfig.sharedCharacterBags=[];
    slotConfig.sharedCharacterBags.push(lastBag);
  }else{
    const char=slotConfig.characters[charTag];
    if(!char.bagSlots)char.bagSlots=[];
    char.bagSlots.push(lastBag);
  }
  return lastBag;
}

function assignToBag(vt,catGroup,characterTag,seriesTag){
  const cap=BAG_ML_DEFAULT;const lastBag=slotConfig.nextBagSlot||'B01';const lastNum=parseInt((lastBag.match(/\d+/)||['1'])[0]);
  // Phase 0a: seriesTag routing (highest priority - series bags hold everything from that series)
  if(seriesTag){
    const existing=findSeriesBag(seriesTag,vt);
    if(existing)return{slot:existing,slotType:'bag'};
    return{slot:allocateNewSeriesBag(seriesTag),slotType:'bag'};
  }
  // Phase 0b: character-tag routing (only if no series)
  if(characterTag){
    // 自動註冊新角色 (不需手動勾選啟用)
    if(!slotConfig.characters) slotConfig.characters={};
    if(!slotConfig.characters[characterTag]){
      slotConfig.characters[characterTag]={enabled:true,bagType:'dedicated'};
      markDirty('__config__');
    }
    const char=slotConfig.characters[characterTag];
    if(char&&char.enabled){
      if(char.bagType==='dedicated'){
        const existing=findCharacterBag(characterTag);
        if(existing&&getBagVol(existing)+vt<=cap)return{slot:existing,slotType:'bag'};
        const newBag=allocateNewCharacterBag(characterTag,false);
        return{slot:newBag,slotType:'bag'};
      }
      if(char.bagType==='shared'){
        const existing=findSharedCharacterBag(vt);
        if(existing)return{slot:existing,slotType:'bag'};
        const newBag=allocateNewCharacterBag(characterTag,true);
        return{slot:newBag,slotType:'bag'};
      }
    }
  }
  const superGroup=catGroup?BAG_SUPER_GROUPS[catGroup]:null;
  
  
  // Phase 1: find bag with same super-group (but skip reserved bags)
  if(superGroup){
    for(let n=1;n<=lastNum;n++){const label='B'+String(n).padStart(2,'0');
      if(isBagSeriesTagged(label))continue;
      if(isBagCategoryTagged(label))continue;
      if(getBagSuperGroup(label)===superGroup&&getBagVol(label)+vt<=cap)return{slot:label,slotType:'bag'};
    }
  }
  // Phase 2: find bag with same catGroup (skip all reserved bags)
  if(catGroup){
    for(let n=1;n<=lastNum;n++){const label='B'+String(n).padStart(2,'0');
      if(isBagSeriesTagged(label))continue;
      if(isBagCategoryTagged(label))continue;
      const bagSG=getBagSuperGroup(label);if(bagSG)continue;
      if(isBagCharacterTagged(label))continue;
      const items=allItems.filter(i=>i.slot===label&&i.slotType==='bag');
      if(items.some(i=>getCatGroup(i.featureTags,i.bricklinkCategory)===catGroup)&&getBagVol(label)+vt<=cap)return{slot:label,slotType:'bag'};
    }
  }
  // Phase 3: any bag with space (skip all reserved bags)
  for(let n=1;n<=lastNum;n++){const label='B'+String(n).padStart(2,'0');
    if(isBagSeriesTagged(label))continue;
    if(isBagCategoryTagged(label))continue;
    if(getBagSuperGroup(label))continue;
    if(isBagCharacterTagged(label))continue;
    if(getBagVol(label)+vt<=cap)return{slot:label,slotType:'bag'};
  }
  
  // Phase 4: new bag
  slotConfig.nextBagSlot=advanceBag(lastBag);markDirty('__config__');
  return{slot:slotConfig.nextBagSlot,slotType:'bag'};
}
function isBagCharacterTagged(bagSlot){
  // Check if bag is reserved for characters (dedicated or shared)
  const chars=slotConfig.characters||{};
  for(const c of Object.values(chars)){
    if((c.bagSlots||[]).includes(bagSlot))return true;
  }
  return (slotConfig.sharedCharacterBags||[]).includes(bagSlot);
}

// ═══ Category Bag routing (neckwear / headwear / bodywear) ═══
// 根據 bricklinkCategory 分流到 3 個專用袋
// 條件: 無 characterTag 且無 seriesTag (character > series > category)
function getCategoryBagKey(item){
  if(!item)return null;
  if(item.characterTag||item.seriesTag)return null;
  var blCat=(item.bricklinkCategory||'').toLowerCase().trim();
  var name=(item.name||'').toLowerCase();
  // Neckwear (含分類怪的 Utensil 類 neckwear basket)
  if(blCat==='minifigure, neckwear'||blCat==='minifig, neck wear'||blCat==='minifigure, neck'||
     (name.indexOf('neckwear')>-1&&blCat.indexOf('minifig')>-1))return 'neckwear';
  // Headwear / Hair / Headgear / Head
  if(blCat==='minifigure, hair'||blCat==='minifigure, headwear'||blCat==='minifigure, headgear'||
     blCat==='minifigure, headwear accessory'||blCat==='minifig, headwear'||
     blCat==='minifigure, head'||blCat==='minifig head'||blCat==='minifig, head')return 'headwear';
  // Bodywear (限定 minifigure 類, 排除 Animal/Creature Body Part)
  if(blCat==='minifigure, body part'||blCat==='minifigure, body wear'||
     blCat==='minifigure, armor'||blCat==='minifig, body part')return 'bodywear';
  return null;
}

function findOrAllocateCategoryBag(catKey,newVt){
  if(!catKey)return null;
  var cap=BAG_ML_DEFAULT;
  if(!slotConfig.categoryBags)slotConfig.categoryBags={};
  var bagList=slotConfig.categoryBags[catKey]||[];
  // 依序嘗試現有袋
  for(var i=0;i<bagList.length;i++){
    if(getBagVol(bagList[i])+newVt<=cap)return bagList[i];
  }
  // 所有袋都滿 → 開新袋
  var newBag=slotConfig.nextBagSlot||'B01';
  slotConfig.nextBagSlot=advanceBag(newBag);
  bagList.push(newBag);
  slotConfig.categoryBags[catKey]=bagList;
  markDirty('__config__');
  return newBag;
}

function isBagCategoryTagged(bagSlot){
  var cb=slotConfig.categoryBags||{};
  for(var k in cb){
    if((cb[k]||[]).indexOf(bagSlot)>=0)return true;
  }
  return false;
}

// ═══ 智慧分流：小抽屜優先，滿了才進袋 ═══

// 取得某個格子的已用體積
function getSlotVol(slot){
  return allItems.reduce((s,i)=>{
    const v=i.estimateVolumeMl||0;
    let q=0;
    if(i.slot===slot)q+=(i.quantity||1);
    if(i.pickupSlot===slot)q+=(i.pickupQty||0);
    const ov=i.overflowSlot||'';
    if(ov===slot||ov.split(',').indexOf(slot)>=0)q+=(i.overflowQty||0);
    return s+v*q;
  },0);
}

// [v20ak] Mirror pair detection: find paired Left/Right or [Upper]/[Lower] item
function getMirrorBaseName(name){
  if(!name)return '';
  return String(name)
    .replace(/\s*\[(Upper|Lower)\]/gi,'')
    .replace(/\s+(Left|Right)\s*$/i,'')
    .replace(/\s+(Left|Right)\s*,/i,',')
    .trim();
}
function findMirrorPartner(item,pool){
  const list=pool||allItems;
  const n=item.name||'';
  const base=getMirrorBaseName(n);
  if(base===n||!base)return null;
  return list.find(o=>o&&o.designId!==item.designId&&getMirrorBaseName(o.name||'')===base)||null;
}
// 取得某個格子的零件數
function getSlotItemCount(slot){
  return allItems.filter(i=>{
    if(i.slot===slot)return true;
    if(i.pickupSlot===slot)return true;
    const ov=i.overflowSlot||'';
    return ov===slot||ov.split(',').indexOf(slot)>=0;
  }).length;
}
// 取得某個格子裡最大零件的體積（用於動態 merge max）
function getSlotMaxVol(slot){
  return allItems.reduce((mx,i)=>{
    if(i.slot!==slot)return mx;
    const v=(i.estimateVolumeMl||0)*(i.quantity||1);
    return v>mx?v:mx;
  },0);
}

// ═══════════════════════════════════════════════════
// FREQUENT ITEM ASSIGNMENT (v17t+) - 常用零件雙層分派
// ═══════════════════════════════════════════════════
// 策略: 快取點 (抽屜，方便取用) + 主庫存 (袋子/抽屜，大批量)
// PICKUP_TARGET: 快取點目標件數 (48 件剛好超過半格臨界 v1>2.58)
//   v1 ≤ 2.58ml → 半格快取 (48 件 × v1 ≤ 124ml)
//   v1 ≤ 5.17ml → 整格快取 (48 件 × v1 ≤ 248ml)
//   v1 > 5.17ml → 大抽屜快取
const PICKUP_TARGET_QTY = 48;
const PICKUP_FILL_RATIO = 0.9;  // 90% 填滿規則

// 找完全空的半格小抽屜 (a 或 b)
function findEmptyHalfSlot(){
  const maxD = parseInt((slotConfig.nextSmallSlot||'001a').replace(/[a-z]/g,''));
  for(let d=1; d<=Math.max(maxD, 450); d++){
    const pad = String(d).padStart(3,'0');
    for(const suffix of ['a','b']){
      const slot = pad + suffix;
      const otherHalf = pad + (suffix==='a'?'b':'a');
      // 半格空 + 對應整格沒人占 + 另一半占用不阻止 (另一半有物品時這半還能用)
      const hasItems = allItems.some(i => i.slot===slot || i.slot===pad || i.slot===String(d));
      const hasPickup = allItems.some(i => i.pickupSlot===slot || i.pickupSlot===pad);
      if(!hasItems && !hasPickup) return slot;
    }
  }
  return null;
}

// 找完全空的整格小抽屜 (a+b 都空)
function findEmptyFullDrawer(){
  const maxD = parseInt((slotConfig.nextSmallSlot||'001a').replace(/[a-z]/g,''));
  for(let d=1; d<=Math.max(maxD, 450); d++){
    const pad = String(d).padStart(3,'0');
    const plain = String(d);
    const hasItems = allItems.some(i => {
      const s = i.slot||'';
      return s===pad || s===plain || s===pad+'a' || s===pad+'b' || s===plain+'a' || s===plain+'b';
    });
    const hasPickup = allItems.some(i => {
      const p = i.pickupSlot||'';
      return p===pad || p===pad+'a' || p===pad+'b';
    });
    if(!hasItems && !hasPickup) return pad;
  }
  return null;
}

// 找空大抽屜 (完全沒 main 物品也沒 pickup)
function findEmptyLargeSlot(){
  for(let n=1; n<=27; n++){
    const slot = 'L' + String(n).padStart(2,'0');
    const hasItems = allItems.some(i => i.slot===slot && i.slotType==='large');
    const hasPickup = allItems.some(i => i.pickupSlot===slot);
    if(!hasItems && !hasPickup) return slot;
  }
  return null;
}

// 常用零件雙層分派 (v17u: 48件 + 90% 填滿 + 手動處理 fallback)
// 回傳: {slot, slotType, pickupSlot, pickupType, pickupQty, overflowSlot, overflowQty, _needsManual?}
function assignFrequent(item){
  const v1 = item.estimateVolumeMl || 2;
  const qty = item.quantity || 1;
  const totalVol = v1 * qty;
  const catGroup = getCatGroup(item.featureTags||[], normalizeCategory(item.bricklinkCategory||''));
  const charTag = item.characterTag || null;
  // [v20ak/al] Mirror pair: share slot + overflow with partner
  try{
    const mp=findMirrorPartner(item);
    if(mp&&mp.slot){
      const slotCap=getSlotCap(mp.slot, mp.slotType||'small');
      const partnerVol=(mp.estimateVolumeMl||0)*(mp.quantity||0);
      const remaining=Math.max(0, slotCap-partnerVol);
      const mainQty=Math.min(qty, Math.floor(remaining/v1));
      const overQty=qty-mainQty;
      let ovSlot=mp.overflowSlot||'';
      if(overQty>0 && !ovSlot){
        const fb=assignToBag(overQty*v1, catGroup, charTag, item.seriesTag||null);
        ovSlot=fb.slot||'';
        if(ovSlot){
          mp.overflowSlot=ovSlot;
          if(typeof markDirty==='function')markDirty(mp.id);
        }
      }
      return {
        slot: mp.slot,
        slotType: mp.slotType||'small',
        pickupSlot: mp.pickupSlot||null,
        pickupType: mp.pickupType||null,
        pickupQty: 0,
        overflowSlot: overQty>0?ovSlot:'',
        overflowQty: overQty,
        _mirrorInherited: true,
        _mirrorPartnerId: mp.designId
      };
    }
  }catch(e){console.warn('[mirror] assignFrequent error',e);}
  if(!fitsSmallSlot(item)){return assignToBag(totalVol,catGroup,charTag,item.seriesTag||null)}
  // v17y: 只用明確 seriesTag，避免 detectSeries 誤判通用零件為某系列
  const seriesTag = item.seriesTag || null;
  
  // === 情境 A: 總量夠小，全量進抽屜 (無 pickup) ===
  // 依總體積選最小合適抽屜
  if(totalVol <= SLOT_ML){
    const halfSlot = findEmptyHalfSlot();
    if(halfSlot) return { slot: halfSlot, slotType: 'small', pickupSlot: null, pickupType: null, pickupQty: 0, overflowSlot: '', overflowQty: 0 };
  }
  if(totalVol <= DRAWER_ML){
    const fullDrawer = findEmptyFullDrawer();
    if(fullDrawer) return { slot: fullDrawer, slotType: 'small', pickupSlot: null, pickupType: null, pickupQty: 0, overflowSlot: '', overflowQty: 0 };
  }
  if(totalVol <= LARGE_ML){
    const largeSlot = findEmptyLargeSlot();
    if(largeSlot) return { slot: largeSlot, slotType: 'large', pickupSlot: null, pickupType: null, pickupQty: 0, overflowSlot: '', overflowQty: 0 };
  }
  
  // === 情境 B: 需要 pickup + 主袋 (totalVol > LARGE_ML 或 情境 A 找不到空位) ===
  // 依「48 件需多少 ml」決定 pickup 容器尺寸
  const pickupTargetVol = v1 * PICKUP_TARGET_QTY;
  let pickupSlot = null;
  let pickupType = null;
  let pickupCap = 0;
  
  if(pickupTargetVol <= SLOT_ML){
    // 48件 ≤ 124ml → 半格 (小 v1)
    pickupSlot = findEmptyHalfSlot();
    pickupType = 'small';
    pickupCap = SLOT_ML;
    if(!pickupSlot){
      // 升級整格
      pickupSlot = findEmptyFullDrawer();
      pickupCap = DRAWER_ML;
    }
    if(!pickupSlot){
      // 再升級大抽屜
      pickupSlot = findEmptyLargeSlot();
      pickupType = 'large';
      pickupCap = LARGE_ML;
    }
  } else if(pickupTargetVol <= DRAWER_ML){
    // 48件 ≤ 248ml → 整格 (中 v1)
    pickupSlot = findEmptyFullDrawer();
    pickupType = 'small';
    pickupCap = DRAWER_ML;
    if(!pickupSlot){
      // 升級大抽屜
      pickupSlot = findEmptyLargeSlot();
      pickupType = 'large';
      pickupCap = LARGE_ML;
    }
    if(!pickupSlot){
      // 降級半格 (48件裝不下，但塞部分也比沒快取好)
      pickupSlot = findEmptyHalfSlot();
      pickupType = 'small';
      pickupCap = SLOT_ML;
    }
  } else {
    // 48件 > 248ml → 大抽屜 (大 v1)
    pickupSlot = findEmptyLargeSlot();
    pickupType = 'large';
    pickupCap = LARGE_ML;
    if(!pickupSlot){
      // 降級整格 (快取件數變少)
      pickupSlot = findEmptyFullDrawer();
      pickupType = 'small';
      pickupCap = DRAWER_ML;
    }
    if(!pickupSlot){
      // 再降級半格 (快取件數很少，但仍有快取)
      pickupSlot = findEmptyHalfSlot();
      pickupType = 'small';
      pickupCap = SLOT_ML;
    }
  }
  
  if(!pickupSlot){
    // ❌ 所有合適抽屜都滿 → 標記待手動處理 (不 fallback 到 assignRegular)
    return {
      slot: '',
      slotType: '',
      pickupSlot: null,
      pickupType: null,
      pickupQty: 0,
      overflowSlot: '',
      overflowQty: 0,
      _needsManual: true,
      _reason: '沒有合適空抽屜 (需要 ' + (pickupTargetVol <= SLOT_ML ? '半格' : pickupTargetVol <= DRAWER_ML ? '整格' : '大抽屜') + ')'
    };
  }
  
  // === 計算 pickupQty: 塞到 90% 滿 ===
  const pickupMaxByCap = Math.floor(pickupCap * PICKUP_FILL_RATIO / v1);
  const actualPickupQty = Math.min(qty, pickupMaxByCap);
  const remainQty = qty - actualPickupQty;
  
  // === 主庫存 (剩餘) 放袋，計算是否需要溢出 ===
  let mainBag = '';
  let overflowBags = '';
  let overflowQtyCalc = 0;
  if(remainQty > 0){
    const bagCap = BAG_ML_DEFAULT;
    const piecesPerBag = v1 > 0 ? Math.max(1, Math.floor(bagCap / v1)) : remainQty;
    // 第一個袋 (主位)
    mainBag = findBagForOverflow(Math.min(bagCap, v1 * remainQty), catGroup, charTag, seriesTag, item);
	// 若一袋裝不下 → 計算需要幾個溢出袋
    if(remainQty > piecesPerBag){
      const totalBagsNeeded = Math.ceil(remainQty / piecesPerBag);
      const overflowBagsNeeded = totalBagsNeeded - 1;
      overflowQtyCalc = remainQty - piecesPerBag;
      const ovBagList = [];
      // v17x: 本地已用袋黑名單 (避免 findBagForOverflow 回傳相同袋)
      const usedBags = [mainBag];
      for(let b = 0; b < overflowBagsNeeded; b++){
        const piecesLeft = remainQty - piecesPerBag - b * piecesPerBag;
        const volNeed = Math.min(bagCap, piecesLeft * v1);
		let ovBag = findBagForOverflow(volNeed, catGroup, charTag, seriesTag, item);
        // 檢查是否重複 (findBagForOverflow 可能回傳 mainBag 或剛加的 ovBag)
        if(!ovBag || usedBags.indexOf(ovBag) >= 0){
          // 強制開新袋，跳過已用的
          let nextBag = slotConfig.nextBagSlot || 'B01';
          while(usedBags.indexOf(nextBag) >= 0){
            nextBag = advanceBag(nextBag);
          }
          slotConfig.nextBagSlot = advanceBag(nextBag);
          markDirty('__config__');
          ovBag = nextBag;
        }
        ovBagList.push(ovBag);
        usedBags.push(ovBag);
      }
      overflowBags = ovBagList.join(',');
    }
  } else {
    // 全部放快取 (不應該發生，因為 totalVol > LARGE_ML 時才走到這)
    // 但可能情境 A 找不到空位而降級到這，此時 pickup 就夠了
    mainBag = pickupSlot;
    return {
      slot: pickupSlot,
      slotType: pickupType,
      pickupSlot: null,
      pickupType: null,
      pickupQty: 0,
      overflowSlot: '',
      overflowQty: 0
    };
  }
  
  return {
    slot: mainBag,
    slotType: 'bag',
    pickupSlot: pickupSlot,
    pickupType: pickupType,
    pickupQty: actualPickupQty,
    overflowSlot: overflowBags,
    overflowQty: overflowQtyCalc
  };
}

// 原本的分派 (非常用物品走這裡) - 即現有的 gatewayAssign 內容
function assignRegular(item){
  const vol=item.estimateVolumeMl||2,qty=item.quantity||1;
  const catGroup=getCatGroup(item.featureTags||[],normalizeCategory(item.bricklinkCategory||''));
  const vt=Math.round(vol*qty*10)/10;
  const charTag=item.characterTag||null;
  // [v20ak/al] Mirror pair: share slot + overflow with partner
  try{
    const mp=findMirrorPartner(item);
    if(mp&&mp.slot){
      const slotCap=getSlotCap(mp.slot, mp.slotType||'small');
      const partnerVol=(mp.estimateVolumeMl||0)*(mp.quantity||0);
      const remaining=Math.max(0, slotCap-partnerVol);
      const mainQty=Math.min(qty, Math.floor(remaining/vol));
      const overQty=qty-mainQty;
      let ovSlot=mp.overflowSlot||'';
      if(overQty>0 && !ovSlot){
        const fb=assignToBag(overQty*vol, catGroup, charTag, item.seriesTag||null);
        ovSlot=fb.slot||'';
        if(ovSlot){
          mp.overflowSlot=ovSlot;
          if(typeof markDirty==='function')markDirty(mp.id);
        }
      }
      return {
        slot: mp.slot,
        slotType: mp.slotType||'small',
        pickupSlot: mp.pickupSlot||null,
        pickupType: mp.pickupType||null,
        pickupQty: 0,
        overflowSlot: overQty>0?ovSlot:'',
        overflowQty: overQty,
        _mirrorInherited: true,
        _mirrorPartnerId: mp.designId
      };
    }
  }catch(e){console.warn('[mirror] assignRegular error',e);}
  // v17y: 只用明確的 seriesTag，不要 detectSeries 猜測
  //       (避免把「忍者頭盔」這種通用零件誤判為 Ninjago 系列)
  const seriesTag=item.seriesTag||null;

  // 0. 有角色標籤 → 優先進角色袋 (即使同時有系列標籤)
  //    自動啟用: 若 slotConfig.characters 沒該角色設定，自動建 enabled:true, dedicated
  if(charTag){
    if(!slotConfig.characters) slotConfig.characters={};
    if(!slotConfig.characters[charTag]){
      slotConfig.characters[charTag]={enabled:true,bagType:'dedicated'};
      markDirty('__config__');
    } else if(!slotConfig.characters[charTag].enabled){
      slotConfig.characters[charTag].enabled=true;
      markDirty('__config__');
    }
    return assignToBag(vt,catGroup,charTag,null); // 傳 null 阻止 seriesBag 優先
  }
  // 0b. 有明確系列標籤但無角色 → 進系列袋
  if(seriesTag){return assignToBag(vt,catGroup,null,seriesTag)}
  // 0c. 🆕 分類專用袋 (neckwear/headwear/bodywear, 無角色無系列)
  const catBagKey=getCategoryBagKey(item);
  if(catBagKey){
    const catBag=findOrAllocateCategoryBag(catBagKey,vt);
    if(catBag)return{slot:catBag,slotType:'bag'};
  }
  // 1. 人偶 → 收納袋 (人偶實體太複雜)
  if(isMinifigure(item)){return assignToBag(vt,catGroup,charTag,seriesTag)}
  
  // 1c. 總體積超過大抽屜 → 收納袋 (非常用大體積)
  if(vt>LARGE_ML){return assignToBag(vt,catGroup,charTag,seriesTag)}
  // 1d. 塞不下半格但能塞整格 → 獨佔整格 (新 v17z)
  if(!fitsSmallSlot(item)){
    // [v17aa] 超過半格尺寸 → 直接進裋
    return assignToBag(vt,catGroup,charTag,seriesTag);
  }
  // 1e. 總體積超過整格但塞得下半格 (不太可能) → 進袋
  if(vt>DRAWER_ML){return assignToBag(vt,catGroup,charTag,seriesTag)}
  // 2. 單件體積 > 41ml 或 總體積 > MERGE_LIMIT → 不融合
  if(vt<=MERGE_LIMIT&&vol<=MERGE_VOL1_MAX){
    const mergeSlot=findMergeSlot(vt,catGroup,true);
    if(mergeSlot)return{slot:mergeSlot,slotType:'small'};
    const anySlot=findMergeSlot(vt,catGroup,false);
    if(anySlot)return{slot:anySlot,slotType:'small'};
    const newSlot=allocateNewSmallSlot();
    if(newSlot)return{slot:newSlot+'a',slotType:'small'};
    return assignToBag(vt,catGroup,charTag,seriesTag);
  }
  // 3. 體積 MERGE_LIMIT~SLOT_ML → 獨佔半格(a/b)
  if(vt<=SLOT_ML){
    const halfSlot=findEmptyHalf(catGroup);
    if(halfSlot)return{slot:halfSlot,slotType:'small'};
    const newSlot=allocateNewSmallSlot();
    if(newSlot)return{slot:newSlot+'a',slotType:'small'};
    return assignToBag(vt,catGroup,charTag,seriesTag);
  }
  // 4. 體積 SLOT_ML~DRAWER_ML → 獨佔整抽屜
  if(vt<=DRAWER_ML){
    const newSlot=allocateNewSmallSlot();
    if(newSlot)return{slot:newSlot,slotType:'small'};
    return assignToBag(vt,catGroup,charTag,seriesTag);
  }
  return assignToBag(vt,catGroup,charTag,seriesTag);
}

// 主分派 Gateway - 依常用度路由
function gatewayAssign(item){
  if(isItemFrequent(item)){
    return assignFrequent(item);
  }
  return assignRegular(item);
}

// 一次性重新分派所有常用零件
async function reassignAllFrequent(){
  const allToReassign = allItems.slice();
  if(!allToReassign.length){showToast('沒有物品可重新分派','error');return}
  
  const freqCount = allToReassign.filter(i => isItemFrequent(i)).length;
  const nonFreqCount = allToReassign.length - freqCount;
  
  if(!confirm('將對全部 ' + allToReassign.length + ' 筆物品重新分派 (2-pass):\n\n' +
              '• Phase 1: ' + freqCount + ' 筆常用 → 優先配抽屜 (含快取)\n' +
              '• Phase 2: ' + nonFreqCount + ' 筆非常用 → 剩餘空格\n\n' +
              '所有現有位置會被重算，實體大搬運。\n完成後顯示搬運清單。\n\n繼續？'))return;
  
  const statusEl = document.getElementById('reassign-status');
  statusEl.textContent = '規劃中...';
  
  // 快照原位置
  const snapshot = allToReassign.map(i => ({
    id: i.id,
    designId: i.designId,
    name: i.nameCN || i.name || '',
    qty: i.quantity || 0,
    oldSlot: i.slot,
    oldSlotType: i.slotType,
    oldPickup: i.pickupSlot || '',
    oldPickupType: i.pickupType || '',
    oldPickupQty: i.pickupQty || 0,
    oldOverflow: i.overflowSlot || '',
    oldOverflowQty: i.overflowQty || 0,
    isFrequent: isItemFrequent(i)
  }));
  
  // === 全清: 清空所有位置 (in-memory) ===
  allToReassign.forEach(i => {
    i.slot = '';
    i.slotType = '';
    i.pickupSlot = '';
    i.pickupType = '';
    i.pickupQty = 0;
    i.overflowSlot = '';
    i.overflowQty = 0;
  });
  
  // Reset slot config pointers so allocation starts fresh (從 001a / B01 開始)
  const origNextSmall = slotConfig.nextSmallSlot;
  const origNextBag = slotConfig.nextBagSlot;
  slotConfig.nextSmallSlot = '001a';
  slotConfig.nextBagSlot = 'B01';
  
  // 清空舊的 series/character bag 記錄 (讓 bag 從 B01 重新分配)
  slotConfig.seriesBags = {};
  // 清空每個 character 的 bagSlots (保留 enabled/bagType)
  Object.keys(slotConfig.characters || {}).forEach(function(c){
    if(slotConfig.characters[c]){
      slotConfig.characters[c].bagSlots = [];
    }
  });
  
  // === Phase 1: 常用零件按 rank 分派 ===
  const freq = allToReassign.filter(i => isItemFrequent(i))
    .sort((a,b) => (a.rebrickableRank||9999) - (b.rebrickableRank||9999));
  
  const manualNeeded = [];
  statusEl.textContent = 'Phase 1: 分派常用 0/' + freq.length;
  
  for(let idx=0; idx<freq.length; idx++){
    const item = freq[idx];
    const r = assignFrequent(item);
    if(r._needsManual){
      manualNeeded.push({item, reason: r._reason});
      // 暫時塞袋作為應急位 (使用者之後手動調整)
      const vt = (item.estimateVolumeMl||2) * (item.quantity||1);
      const catGroup = getCatGroup(item.featureTags||[], normalizeCategory(item.bricklinkCategory||''));
      const fallback = assignToBag(vt, catGroup, item.characterTag||null, item.seriesTag||null);
      item.slot = fallback.slot;
      item.slotType = fallback.slotType;
    } else {
      item.slot = r.slot;
      item.slotType = r.slotType;
      item.pickupSlot = r.pickupSlot || '';
      item.pickupType = r.pickupType || '';
      item.pickupQty = r.pickupQty || 0;
      item.overflowSlot = r.overflowSlot || '';
      item.overflowQty = r.overflowQty || 0;
    }
    if(idx % 50 === 0) statusEl.textContent = 'Phase 1: 分派常用 ' + idx + '/' + freq.length;
  }
  
  // === Phase 2: 非常用零件走 assignRegular (用剩餘空間) ===
  const nonFreq = allToReassign.filter(i => !isItemFrequent(i));
  statusEl.textContent = 'Phase 2: 分派非常用 0/' + nonFreq.length;
  
  for(let idx=0; idx<nonFreq.length; idx++){
    const item = nonFreq[idx];
    const r = assignRegular(item);
    item.slot = r.slot;
    item.slotType = r.slotType;
    item.pickupSlot = '';
    item.pickupType = '';
    item.pickupQty = 0;
    item.overflowSlot = '';
    item.overflowQty = 0;
    if(idx % 100 === 0) statusEl.textContent = 'Phase 2: 分派非常用 ' + idx + '/' + nonFreq.length;
  }
  
  // === 寫入 Firebase ===
  statusEl.textContent = '寫入 Firebase 中...';
  const now = Date.now();
  let written = 0;
  for(let i=0; i<allToReassign.length; i+=400){
    const chunk = allToReassign.slice(i, i+400);
    try{
      const batch = db.batch();
      chunk.forEach(item => {
        item.updatedAt = now;
        batch.update(db.collection(FB_COL).doc(item.id), {
          slot: item.slot,
          slotType: item.slotType,
          pickupSlot: item.pickupSlot,
          pickupType: item.pickupType,
          pickupQty: item.pickupQty,
          overflowSlot: item.overflowSlot,
          overflowQty: item.overflowQty,
          updatedAt: now
        });
      });
      await batch.commit();
      written += chunk.length;
    }catch(e){console.error('batch fail:',e)}
  }
  
  // Write slot config if changed
  try{
    await db.collection(FB_COL).doc(FB_CONFIG_DOC).set({
      nextSmallSlot: slotConfig.nextSmallSlot,
      nextBagSlot: slotConfig.nextBagSlot
    }, {merge: true});
  }catch(e){}
  
  // === 產生搬運報告 ===
  const moves = [];
  snapshot.forEach(snap => {
    const item = allToReassign.find(i => i.id === snap.id);
    if(!item) return;
    const oldPos = snap.oldSlot + (snap.oldPickup ? ' ✋'+snap.oldPickup : '') + (snap.oldOverflow ? ' ➕'+snap.oldOverflow : '');
    const newPos = item.slot + (item.pickupSlot ? ' ✋'+item.pickupSlot+'('+item.pickupQty+')' : '') + (item.overflowSlot ? ' ➕'+item.overflowSlot : '');
    if(oldPos !== newPos){
      moves.push({
        did: snap.designId,
        name: snap.name.substring(0,20),
        qty: snap.qty,
        from: oldPos,
        to: newPos,
        isFrequent: snap.isFrequent
      });
    }
  });
  
  window._reassignMoves = moves;
  window._reassignManualNeeded = manualNeeded;
  
  let msg = '✅ 完成!<br>' +
    '  Phase 1 (常用): ' + freq.length + '<br>' +
    '  Phase 2 (非常用): ' + nonFreq.length + '<br>' +
    '  Firebase 寫入: ' + written + '<br>' +
    '  需搬運: ' + moves.length + ' 件';
  if(manualNeeded.length > 0){
    msg += '<br>⚠ 待手動處理: ' + manualNeeded.length + ' 件 ' +
      '<a href="#" onclick="event.preventDefault();showManualNeeded();return false">[查看]</a>';
  }
  msg += '<br><a href="#" onclick="event.preventDefault();showReassignMoves();return false">[搬運清單]</a>';
  statusEl.innerHTML = msg;
  showToast('重新分派完成 · 搬運 ' + moves.length + ' 件' + (manualNeeded.length ? ', 待手動 ' + manualNeeded.length : ''));
}

// 顯示搬運清單
function showReassignMoves(){
  const moves = window._reassignMoves || [];
  const freqMoves = moves.filter(m => m.isFrequent);
  const nonFreqMoves = moves.filter(m => !m.isFrequent);
  const html = '📋 搬運清單 (共 ' + moves.length + ' 件)\n' +
    '  ⭐ 常用: ' + freqMoves.length + ' 件\n' +
    '  ⚪ 非常用: ' + nonFreqMoves.length + ' 件\n\n' +
    '=== 常用零件 (優先搬) ===\n' +
    freqMoves.slice(0, 80).map(m =>
      '⭐ ' + m.did + ' ×' + m.qty + ' ' + m.name + '\n    ' + m.from + ' → ' + m.to
    ).join('\n') +
    (freqMoves.length > 80 ? '\n  ...還有 ' + (freqMoves.length-80) + ' 筆' : '') +
    '\n\n=== 非常用 (可延後) ===\n' +
    nonFreqMoves.slice(0, 20).map(m =>
      m.did + ' ×' + m.qty + ' ' + m.name + '\n    ' + m.from + ' → ' + m.to
    ).join('\n') +
    (nonFreqMoves.length > 20 ? '\n  ...還有 ' + (nonFreqMoves.length-20) + ' 筆，見 window._reassignMoves' : '');
  alert(html);
}

// 顯示待手動處理清單
function showManualNeeded(){
  const list = window._reassignManualNeeded || [];
  if(!list.length){alert('沒有待手動處理的物品');return}
  const html = '⚠ 待手動處理清單 (' + list.length + ' 件)\n\n' +
    '這些常用零件找不到合適空抽屜，暫時塞袋。請手動調整位置。\n\n' +
    list.slice(0, 50).map(x => {
      const i = x.item;
      return '⭐ #' + i.rebrickableRank + ' ' + i.designId + ' ×' + i.quantity + ' ' +
        (i.nameCN||i.name||'').substring(0,20) + ' @ ' + i.slot + '\n    原因: ' + x.reason;
    }).join('\n') +
    (list.length > 50 ? '\n  ...還有 ' + (list.length-50) + ' 筆，見 window._reassignManualNeeded' : '');
  alert(html);
}

// 找有空間的融合格子
function findMergeSlot(newVt,catGroup,sameCategory){
  const maxDrawer=parseInt((slotConfig.nextSmallSlot||'450a').replace(/[a-z]/g,''));
  for(let d=1;d<maxDrawer;d++){
    for(const suffix of['a','b']){
      const slot=String(d).padStart(3,'0')+suffix;
      const slotItems=allItems.filter(i=>i.slot===slot);
      if(slotItems.length===0)continue;
      if(slotItems.some(i=>isItemFrequent(i)))continue; // 排除常用
      const vol=slotItems.reduce((s,i)=>s+(i.estimateVolumeMl||0)*(i.quantity||1),0);
      if(vol+newVt>SLOT_ML)continue;
      // ★ Fix 4: 件數上限 (模擬加入新物件後)
      const predicted=slotItems.concat([{_vt:newVt}]);
      const maxItems=getMergeMaxItems(predicted);
      if(predicted.length>maxItems)continue;
      if(sameCategory){
        if(!slotItems.some(i=>getCatGroup(i.featureTags||[],i.bricklinkCategory||'')===catGroup))continue;
      }
      return slot;
    }
  }
  return null;
}

// 找同分類抽屜中空的 b 格
function findEmptyHalf(catGroup){
  const maxDrawer=parseInt((slotConfig.nextSmallSlot||'450a').replace(/[a-z]/g,''));
  const hasFreq=slot=>allItems.some(i=>i.slot===slot&&isItemFrequent(i));
  // Phase 1: 同分類抽屜中空的 b 格 (跳過含常用的抽屜)
  for(let d=1;d<maxDrawer;d++){
    const slotA=String(d).padStart(3,'0')+'a';
    const slotB=String(d).padStart(3,'0')+'b';
    if(hasFreq(slotA)||hasFreq(slotB))continue; // ★ 常用獨佔
    if(getSlotItemCount(slotA)>0&&getSlotItemCount(slotB)===0){
      const aItem=allItems.find(i=>i.slot===slotA);
      if(aItem){
        const aCat=getCatGroup(aItem.featureTags||[],normalizeCategory(aItem.bricklinkCategory||''));
        if(aCat===catGroup)return slotB;
      }
    }
  }
  // Phase 2: 任何空 b 格 (仍避開常用)
  for(let d=1;d<maxDrawer;d++){
    const slotA=String(d).padStart(3,'0')+'a';
    const slotB=String(d).padStart(3,'0')+'b';
    if(hasFreq(slotA)||hasFreq(slotB))continue; // ★ 常用獨佔
    if(getSlotItemCount(slotB)===0&&getSlotItemCount(slotA)>0)return slotB;
  }
  return null;
}

// 分配新的空抽屜（從 nextSmallSlot 遞增）
function allocateNewSmallSlot(){
  let num=parseInt((slotConfig.nextSmallSlot||'001a').replace(/[a-z]/g,''));
  const maxDrawers=slotConfig.totalSmallDrawers||450;
  // 掃描指標位置開始，跳過任何已被佔用的抽屜（含 a/b/整格）
  while(num<=maxDrawers){
    const label=String(num).padStart(3,'0');
    const occupied=allItems.some(i=>{
      const s=i.slot||'';
      const p=i.pickupSlot||'';
      const o=i.overflowSlot||'';
      return s===label||s===label+'a'||s===label+'b'||p===label||p===label+'a'||p===label+'b'||o===label||o===label+'a'||o===label+'b';
    });
    if(!occupied){
      slotConfig.nextSmallSlot=String(num+1).padStart(3,'0')+'a';
      ensureCap(num+1);
      markDirty('__config__');
      return label;
    }
    num++;
  }
  return null; // 全滿
}

// ═══════════════════════════════════════════════════
// API LAYER
// ═══════════════════════════════════════════════════