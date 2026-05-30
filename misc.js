// BrickSort — 其餘功能
// showAssignReport, 盤點, 套組核對, bsAuto 等
// 全域作用域：使用傳統 <script src> 載入，禁止 ES Module
// 依賴 js/config.js 中定義的全域常數與狀態變數

function showAssignReport(){
  // Apply results to memory immediately (no Firebase needed)
  applyAssignToMemory();

  const nd=window._nextAvailableDrawer||1,bc=window._bagCount||0;
  const smA=assignAssignments.filter(a=>a.slotType==='small'),lgA=assignAssignments.filter(a=>a.slotType==='large'),bgA=assignAssignments.filter(a=>a.slotType==='bag'),bxA=assignAssignments.filter(a=>a.slotType==='box');
  document.getElementById('assign-status').textContent='✅ 完成（已套用本機）';
  // Check for drawer gaps
  const drawerNums={};allItems.forEach(i=>{const m=(i.slot||'').match(/^(\d+)[ab]?$/);if(m)drawerNums[parseInt(m[1])]=true});
  const maxDrawer=Object.keys(drawerNums).length?Math.max(...Object.keys(drawerNums).map(Number)):0;
  const drawerGaps=[];for(let d=1;d<=maxDrawer;d++)if(!drawerNums[d])drawerGaps.push(d);
  const gapHtml=drawerGaps.length
    ?`<div style="background:var(--red-bg);border:1px solid var(--red);border-radius:10px;padding:12px;margin-bottom:12px;font-size:13px;color:var(--red)">❌ 小抽屜有 ${drawerGaps.length} 個空隙：${drawerGaps.join(', ')}<br><span style="font-size:11px">版本 v${APP_VERSION} — 如版本不正確請清除快取重新載入</span></div>`
    :`<div style="background:var(--green-bg);border:1px solid var(--green);border-radius:10px;padding:12px;margin-bottom:12px;font-size:13px;color:var(--green)">✅ 小抽屜 1~${maxDrawer}，0 空隙<br><span style="font-size:11px;color:var(--muted)">版本 v${APP_VERSION}</span></div>`;
  document.getElementById('assign-content').innerHTML=`
    ${gapHtml}
    <div class="stats-row">
      <div class="stat-card"><div class="stat-num">${allItems.length}</div><div class="stat-label">總數</div></div>
      <div class="stat-card"><div class="stat-num">${smA.length}</div><div class="stat-label">小抽屜</div></div>
      <div class="stat-card"><div class="stat-num">${lgA.length}/${LARGE_COUNT}</div><div class="stat-label">大抽屜</div></div>
      <div class="stat-card"><div class="stat-num">${bc}</div><div class="stat-label">收納袋</div></div>
    </div>
    <div style="background:var(--green-bg);border:1px solid var(--green);border-radius:10px;padding:12px;margin-bottom:12px;font-size:13px;color:var(--green)">✅ 分配結果已套用到本機記憶體。切換到其他分頁即可看到變化。<br><span style="color:var(--muted);font-size:12px">⚠ 尚未回寫 Firebase，重新整理頁面會還原。請在配額恢復後點下方按鈕同步。</span></div>
    <div class="card"><div class="card-title">📊 分配記錄</div><div class="log">${assignLogLines.map(l=>'<span class="'+l.cls+'">'+l.msg+'</span>').join('\n')}</div></div>
    <div style="display:flex;gap:12px;margin-top:16px;flex-wrap:wrap">
      <button class="btn btn-lg" onclick="startPipeline()">🔄 重新分配</button>
      <button class="btn btn-primary btn-lg" onclick="writeAssignToFirebase()">☁️ 回寫 Firebase</button>
    </div>
    <div style="margin-top:12px"><button class="btn btn-green" style="width:100%;padding:14px;font-size:15px" onclick="toggleLock()">🔒 鎖定編排（零件放入抽屜後點此）</button></div>`;
}

function applyAssignToMemory(){
  // Apply pipeline results directly to allItems (no Firebase write needed)
  const assignMap={};
  assignAssignments.forEach(a=>{assignMap[a.item.id]={slot:a.slot,slotType:a.slotType,mergedWith:a.mergedWith||[]}});
  allItems.forEach(item=>{
    const a=assignMap[item.id];
    if(a){item.slot=a.slot;item.slotType=a.slotType;item.mergedWith=a.mergedWith;
      item.overflowSlot='';item.overflowQty=0;item.isFull=false;
      // Apply bag overflow (item split across multiple bags)
      if(item._bagOverflow){
        item.overflowSlot=item._bagOverflow.slots.join(',');
        item.overflowQty=item._bagOverflow.qty;
        delete item._bagOverflow;
      }
      item.updatedAt=Date.now();markDirty(item.id)}
  });
  // Companion parts: copy master's slot to all companions
  allItems.forEach(item=>{
    if(item._companionOf){
      const master=allItems.find(m=>m.id===item._companionOf);
      if(master&&master.slot){
        item.slot=master.slot;item.slotType=master.slotType||'small';
        item.mergedWith=[];item.overflowSlot='';item.overflowQty=0;item.isFull=false;
        item.updatedAt=Date.now();markDirty(item.id);
      }
    }
  });
  // Update slotConfig
  const nextD=window._nextAvailableDrawer||1;
  slotConfig.nextSmallSlot=drawerNumToLabel(nextD)+'a';
  slotConfig.nextBagSlot='B'+String((window._bagCount||0)+1).padStart(2,'0');
  slotConfig.totalSmallDrawers=BASE_DRAWERS;
  slotConfig.bagCapacity=window._bagCapacity||BAG_ML_DEFAULT;
  markDirty('__config__');
  // Refresh UI
  renderStats();applyFilter();
}

async function writeAssignToFirebase(){
  // Collect companion items that need writing
  const companions=allItems.filter(i=>i._companionOf);
  const totalCount=assignAssignments.length+companions.length;
  if(!confirm('確定將 '+totalCount+' 筆分配結果寫入 Firebase？\n（含 '+companions.length+' 個配對零件，約需 '+Math.ceil(totalCount/100)+'秒）'))return;
  document.getElementById('assign-status').textContent='寫入中…';
  let written=0,errors=0;
  const BATCH=100;
  // Write main assignments
  for(let i=0;i<assignAssignments.length;i+=BATCH){
    const chunk=assignAssignments.slice(i,i+BATCH);
    try{
      const batch=db.batch();
      chunk.forEach(a=>{batch.update(db.collection(FB_COL).doc(a.item.id),{slot:a.slot,slotType:a.slotType,mergedWith:a.mergedWith||[],overflowSlot:a.item.overflowSlot||'',overflowQty:a.item.overflowQty||0,isFull:false,updatedAt:Date.now()})});
      await batch.commit();
      written+=chunk.length;
    }catch(e){
      for(const a of chunk){
        try{await db.collection(FB_COL).doc(a.item.id).update({slot:a.slot,slotType:a.slotType,mergedWith:a.mergedWith||[],overflowSlot:a.item.overflowSlot||'',overflowQty:a.item.overflowQty||0,isFull:false,updatedAt:Date.now()});written++}
        catch(e2){errors++}
      }
    }
    document.getElementById('assign-status').textContent='寫入中 '+written+'/'+totalCount+(errors?' ('+errors+'失敗)':'');
    if(i+BATCH<assignAssignments.length) await new Promise(r=>setTimeout(r,1000));
  }
  // Write companion items (same slot as master)
  for(let i=0;i<companions.length;i+=BATCH){
    const chunk=companions.slice(i,i+BATCH);
    try{
      const batch=db.batch();
      chunk.forEach(c=>{batch.update(db.collection(FB_COL).doc(c.id),{slot:c.slot,slotType:c.slotType||'small',mergedWith:[],overflowSlot:'',overflowQty:0,isFull:false,updatedAt:Date.now()})});
      await batch.commit();
      written+=chunk.length;
    }catch(e){
      for(const c of chunk){
        try{await db.collection(FB_COL).doc(c.id).update({slot:c.slot,slotType:c.slotType||'small',mergedWith:[],overflowSlot:'',overflowQty:0,isFull:false,updatedAt:Date.now()});written++}
        catch(e2){errors++}
      }
    }
    document.getElementById('assign-status').textContent='寫入中 '+written+'/'+totalCount+(errors?' ('+errors+'失敗)':'');
    if(i+BATCH<companions.length) await new Promise(r=>setTimeout(r,1000));
  }
  const nextD=window._nextAvailableDrawer||1;
  try{await db.collection(FB_COL).doc(FB_CONFIG_DOC).set({nextSmallSlot:drawerNumToLabel(nextD)+'a',nextBagSlot:'B'+String((window._bagCount||0)+1).padStart(2,'0'),totalSmallDrawers:BASE_DRAWERS,bagCapacity:window._bagCapacity||BAG_ML_DEFAULT,lastAssignedAt:Date.now()},{merge:true})}catch(e){}
  document.getElementById('assign-status').textContent='✅ 已寫入 '+written+'筆'+(errors?' ('+errors+'失敗)':'');
  showToast('Firebase 寫入完成：'+written+'筆');await loadData();
}

// ═══════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════
// ═══════════════════════════════════════════════════
// CHARACTER MANAGEMENT (Phase 1: Scan & Select)
// ═══════════════════════════════════════════════════
// slotConfig.characters = { [minifigNum]: { name, imgUrl, bagType:'dedicated'|'shared', partIds:[], enabled:true } }
window._scannedMinifigs={}; // { [minifigNum]: { minifigNum, name, imgUrl, setIds:[], partNums:[], dbPartCount } }
function renderCharactersPage(){
  const el=document.getElementById('characters-content');
  const savedChars=slotConfig.characters||{};
  const enabledChars=Object.values(savedChars).filter(c=>c.enabled);
  const savedCount=enabledChars.length;
  const dedicatedCount=enabledChars.filter(c=>c.bagType==='dedicated').length;
  const sharedCount=enabledChars.filter(c=>c.bagType==='shared').length;
  const scannedCount=Object.keys(window._scannedMinifigs).length;
  const taggedCount=allItems.filter(i=>i.characterTag).length;
  const seriesTaggedCount=allItems.filter(i=>i.seriesTag).length;
  // Count by series
  const seriesBreakdown={};
  allItems.forEach(i=>{if(i.seriesTag){seriesBreakdown[i.seriesTag]=(seriesBreakdown[i.seriesTag]||0)+1}});
  const seriesBags=slotConfig.seriesBags||{};
  const seriesRows=Object.entries(seriesBreakdown).sort((a,b)=>b[1]-a[1]).map(([s,n])=>{
    const bags=(seriesBags[s]||[]).join(', ')||'(未分配)';
    return `<div style="font-size:12px;color:var(--muted);padding:2px 0">🎬 ${s}: <b style="color:var(--text)">${n}</b> 件 → ${bags}</div>`;
  }).join('');
  el.innerHTML=`
    <div class="card">
      <div class="card-title">狀態</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.8">
        ▸ 已啟用角色：<b style="color:var(--accent)">${savedCount}</b> 個 (🌟獨佔 ${dedicatedCount} · 👥共用 ${sharedCount})<br>
        ▸ 已掃描人偶：<b style="color:var(--accent)">${scannedCount}</b> 個<br>
        ▸ DB 套件數：<b style="color:var(--accent)">${getUniqueSets().length}</b> 個<br>
        ▸ 已貼角色標籤：<b style="color:${taggedCount>0?'var(--green)':'var(--muted)'}">${taggedCount}</b> 件<br>
        ▸ 已貼系列標籤：<b style="color:${seriesTaggedCount>0?'var(--green)':'var(--muted)'}">${seriesTaggedCount}</b> 件
      </div>
      ${seriesRows?'<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">'+seriesRows+'</div>':''}
    </div>
    <div class="card">
      <div class="card-title">🔍 掃描套件（人偶/角色）</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.6">從 Rebrickable 拉取你擁有套件的所有人偶。第一次掃描需約 2 分鐘。掃描完成後可勾選角色並套用。</div>
      <button class="btn btn-primary" style="width:100%;margin-bottom:8px" onclick="scanCharactersFromSets()">🔍 開始掃描</button>
      <div id="char-scan-progress" style="font-size:12px;color:var(--muted);margin-top:6px"></div>
    </div>
    <div class="card">
      <div class="card-title">🏷 套用標籤</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.6">
        ▸ <b>系列標籤</b>：自動偵測 designId 前綴和名稱關鍵字（如 njo→Ninjago），不需掃描<br>
        ▸ <b>角色標籤</b>：需先掃描套件並勾選角色（通用件出現在 ≥4 個角色則不貼）
      </div>
      <button class="btn btn-green" style="width:100%;margin-bottom:6px" onclick="applySeriesOnlyTags()">🎬 只套用系列標籤</button>
      <button class="btn btn-primary" style="width:100%;margin-bottom:6px" onclick="applyCharacterTagsToItems()">🎭 套用角色+系列標籤</button>
      <button class="btn" style="width:100%;font-size:12px" onclick="clearAllCharacterTags()">🗑 清除所有標籤</button>
    </div>
    <div id="char-list-container"></div>`;
  if(scannedCount>0) renderCharactersList();
}

function applySeriesOnlyTags(){
  let tagged=0,skipped=0;
  allItems.forEach(item=>{
    const s=detectSeries(item);
    if(!s){skipped++;return}
    if(item.seriesTag===s)return;
    item.seriesTag=s;
    item.updatedAt=Date.now();
    markDirty(item.id);
    tagged++;
  });
  showToast(`✅ 已套用系列標籤 ${tagged} 件 | 跳過 ${skipped}`);
  renderCharactersPage();
}

function getUniqueSets(){
  const sets=new Set();
  allItems.forEach(i=>{(i.setSource||'').split(',').forEach(s=>{s=s.trim();if(s)sets.add(s)})});
  return Array.from(sets);
}

async function scanCharactersFromSets(){
  const sets=getUniqueSets();
  if(!sets.length){showToast('沒有套件資料可掃描','error');return}
  const rbKey=(cfg.rbKey||DEFAULT_RB_KEY);
  if(!rbKey){showToast('請先設定 Rebrickable API Key','error');return}
  const progressEl=document.getElementById('char-scan-progress');
  window._scannedMinifigs={};
  // Step 1: Fetch minifigs per set
  progressEl.innerHTML='📡 第一階段：讀取套件人偶清單...';
  for(let i=0;i<sets.length;i++){
    const setNum=sets[i];
    progressEl.innerHTML=`📡 [${i+1}/${sets.length}] 套件 ${setNum}...`;
    try{
      const r=await fetch(`https://rebrickable.com/api/v3/lego/sets/${setNum}/minifigs/?key=${rbKey}`);
      const data=await r.json();
      if(data.results){
        data.results.forEach(m=>{
          const mfNum=m.set_num;
          if(!window._scannedMinifigs[mfNum]){
            window._scannedMinifigs[mfNum]={minifigNum:mfNum,name:m.set_name,imgUrl:m.set_img_url||'',setIds:[],partNums:[],dbPartCount:0};
          }
          if(!window._scannedMinifigs[mfNum].setIds.includes(setNum))window._scannedMinifigs[mfNum].setIds.push(setNum);
        });
      }
    }catch(e){}
    await new Promise(r=>setTimeout(r,150)); // rate limit
  }
  const minifigs=Object.values(window._scannedMinifigs);
  // Step 2: Fetch parts per minifig
  progressEl.innerHTML=`📡 第二階段：讀取 ${minifigs.length} 個人偶的配件...`;
  for(let i=0;i<minifigs.length;i++){
    const mf=minifigs[i];
    progressEl.innerHTML=`📡 [${i+1}/${minifigs.length}] ${mf.name}...`;
    try{
      const r=await fetch(`https://rebrickable.com/api/v3/lego/minifigs/${mf.minifigNum}/parts/?key=${rbKey}&page_size=100`);
      const data=await r.json();
      if(data.results){
        mf.partNums=data.results.map(p=>(p.part||{}).part_num||'').filter(Boolean);
        // Count parts in DB
        const lcSet=new Set(mf.partNums.map(p=>p.toLowerCase()));
        mf.dbPartCount=allItems.filter(it=>{
          if(lcSet.has((it.designId||'').toLowerCase()))return true;
          if((it.altIds||[]).some(a=>lcSet.has((a||'').toLowerCase())))return true;
          return false;
        }).length;
      }
    }catch(e){}
    await new Promise(r=>setTimeout(r,150));
  }
  // Cache to localStorage to avoid re-scanning
  try{localStorage.setItem('bricksort_scanned_minifigs',JSON.stringify(window._scannedMinifigs))}catch(e){}
  // Auto-enable all scanned characters (user can untick unwanted ones)
  if(!slotConfig.characters)slotConfig.characters={};
  let autoEnabled=0;
  minifigs.forEach(mf=>{
    // Skip if already configured (respect user's previous choice)
    if(slotConfig.characters[mf.minifigNum])return;
    slotConfig.characters[mf.minifigNum]={
      enabled:true,
      name:mf.name,
      minifigNum:mf.minifigNum,
      imgUrl:mf.imgUrl,
      partNums:mf.partNums,
      bagType:mf.dbPartCount>=5?'dedicated':'shared'
    };
    autoEnabled++;
  });
  progressEl.innerHTML=`✅ 掃描完成！共 ${minifigs.length} 個人偶，自動啟用 ${autoEnabled} 個`;
  renderCharactersPage();
}

function loadCachedScan(){
  try{
    const cached=localStorage.getItem('bricksort_scanned_minifigs');
    if(cached){window._scannedMinifigs=JSON.parse(cached);return true}
  }catch(e){}
  return false;
}

function renderCharactersList(){
  const el=document.getElementById('char-list-container');
  if(!el)return;
  const minifigs=Object.values(window._scannedMinifigs);
  const savedChars=slotConfig.characters||{};
  // Sort: most parts first
  minifigs.sort((a,b)=>b.dbPartCount-a.dbPartCount);
  // Group by theme (minifigNum prefix)
  const themes={};
  minifigs.forEach(m=>{
    const mt=m.minifigNum.match(/^([a-z]+)/i);
    const theme=mt?mt[1].toLowerCase():'other';
    if(!themes[theme])themes[theme]=[];
    themes[theme].push(m);
  });
  const themeNames={njo:'Ninjago 忍者',sw:'Star Wars',jw:'Jurassic',dreamzzz:'DreamZzz',sh:'Super Heroes',hp:'Harry Potter',fst:'Fusion',col:'Collectible',cty:'City',frnd:'Friends',idea:'Ideas',mar:'Marvel',dc:'DC',disney:'Disney'};
  const sortedThemes=Object.entries(themes).sort((a,b)=>b[1].length-a[1].length);
  el.innerHTML=`
    <div class="card">
      <div class="card-title">🎭 角色清單（按配件數排序）</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:10px;line-height:1.6">
        ▸ 勾選=啟用角色標籤 ▸ 🌟=獨佔袋 👥=共用袋<br>
        ▸ 配件數 ≥5 建議獨佔，<5 建議共用<br>
        ▸ 未勾選的角色配件會走一般分類流程
      </div>
      <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">
        <button class="btn btn-sm" onclick="selectAllCharacters(true)" style="font-size:11px">☑ 全選</button>
        <button class="btn btn-sm" onclick="selectAllCharacters(false)" style="font-size:11px">☐ 全不選</button>
        <button class="btn btn-sm" onclick="autoSelectByPartCount(5)" style="font-size:11px">✨ ≥5件自動獨佔</button>
        <button class="btn btn-sm" onclick="clearAllCharacters()" style="font-size:11px">🗑 清除所有</button>
      </div>
      ${sortedThemes.map(([theme,items])=>`
        <div style="margin-top:12px;padding:8px;background:var(--surface);border-radius:8px">
          <div style="font-size:12px;color:var(--accent);margin-bottom:6px;font-weight:700">${themeNames[theme]||theme} (${items.length})</div>
          ${items.map(m=>{
            const saved=savedChars[m.minifigNum]||{};
            const enabled=!!saved.enabled;
            const bagType=saved.bagType||(m.dbPartCount>=5?'dedicated':'shared');
            return `
              <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--border)">
                <input type="checkbox" ${enabled?'checked':''} onchange="toggleCharacter('${m.minifigNum}',this.checked)" style="flex-shrink:0;width:18px;height:18px">
                ${m.imgUrl?`<img src="${m.imgUrl}" style="width:32px;height:32px;border-radius:4px;object-fit:cover;background:var(--bg);flex-shrink:0">`:'<div style="width:32px;height:32px;background:var(--card);border-radius:4px;flex-shrink:0"></div>'}
                <div style="flex:1;min-width:0">
                  <div style="font-size:12px;color:var(--text);font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.minifigNum}</div>
                  <div style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.name}</div>
                  <div style="font-size:10px;color:${m.dbPartCount>0?'var(--green)':'var(--dim)'}">DB 配件: ${m.dbPartCount} 個</div>
                </div>
                <div style="display:flex;flex-direction:column;gap:2px;flex-shrink:0">
                  <button class="btn" style="font-size:10px;padding:2px 6px;background:${bagType==='dedicated'?'var(--accent)':'var(--surface)'};color:${bagType==='dedicated'?'#111':'var(--text)'}" onclick="setCharacterBagType('${m.minifigNum}','dedicated')">🌟獨佔</button>
                  <button class="btn" style="font-size:10px;padding:2px 6px;background:${bagType==='shared'?'var(--accent)':'var(--surface)'};color:${bagType==='shared'?'#111':'var(--text)'}" onclick="setCharacterBagType('${m.minifigNum}','shared')">👥共用</button>
                </div>
              </div>`;
          }).join('')}
        </div>`).join('')}
      <button class="btn btn-primary" style="width:100%;margin-top:16px" onclick="saveCharacterConfig()">💾 儲存設定</button>
    </div>`;
}

function toggleCharacter(mfNum,enabled){
  if(!slotConfig.characters)slotConfig.characters={};
  const mf=window._scannedMinifigs[mfNum];
  if(!mf)return;
  if(enabled){
    const existing=slotConfig.characters[mfNum]||{};
    slotConfig.characters[mfNum]={
      ...existing,
      enabled:true,
      name:mf.name,
      minifigNum:mfNum,
      imgUrl:mf.imgUrl,
      partNums:mf.partNums,
      bagType:existing.bagType||(mf.dbPartCount>=5?'dedicated':'shared')
    };
  }else{
    if(slotConfig.characters[mfNum])slotConfig.characters[mfNum].enabled=false;
  }
}

function setCharacterBagType(mfNum,type){
  if(!slotConfig.characters)slotConfig.characters={};
  if(!slotConfig.characters[mfNum]){
    const mf=window._scannedMinifigs[mfNum];
    if(!mf)return;
    slotConfig.characters[mfNum]={enabled:false,name:mf.name,minifigNum:mfNum,imgUrl:mf.imgUrl,partNums:mf.partNums};
  }
  slotConfig.characters[mfNum].bagType=type;
  renderCharactersList();
}

function selectAllCharacters(enabled){
  if(!slotConfig.characters)slotConfig.characters={};
  let changed=0;
  Object.values(window._scannedMinifigs).forEach(mf=>{
    if(!slotConfig.characters[mf.minifigNum]){
      slotConfig.characters[mf.minifigNum]={
        enabled:enabled,
        name:mf.name,
        minifigNum:mf.minifigNum,
        imgUrl:mf.imgUrl,
        partNums:mf.partNums,
        bagType:mf.dbPartCount>=5?'dedicated':'shared'
      };
    }else{
      slotConfig.characters[mf.minifigNum].enabled=enabled;
    }
    changed++;
  });
  showToast(enabled?`已全選 ${changed} 個角色`:`已取消全選 ${changed} 個角色`);
  renderCharactersList();
}

function autoSelectByPartCount(minCount){
  if(!slotConfig.characters)slotConfig.characters={};
  let enabled=0;
  Object.values(window._scannedMinifigs).forEach(mf=>{
    if(mf.dbPartCount>=minCount){
      slotConfig.characters[mf.minifigNum]={enabled:true,name:mf.name,minifigNum:mf.minifigNum,imgUrl:mf.imgUrl,partNums:mf.partNums,bagType:'dedicated'};
      enabled++;
    }
  });
  showToast(`已自動啟用 ${enabled} 個角色（配件 ≥${minCount}）`);
  renderCharactersList();
}

function clearAllCharacters(){
  if(!confirm('清除所有角色設定？'))return;
  slotConfig.characters={};
  renderCharactersList();
  showToast('已清除所有角色設定');
}

async function saveCharacterConfig(){
  markDirty('__config__');
  try{
    await db.collection(FB_COL).doc(FB_CONFIG_DOC).set({characters:slotConfig.characters||{}},{merge:true});
    showToast('✅ 角色設定已儲存');
  }catch(e){
    showToast('❌ 儲存失敗：'+e.message,'error');
  }
}

// Phase 2: Apply character tags to existing DB parts
function applyCharacterTagsToItems(){
  const chars=slotConfig.characters||{};
  const enabledChars=Object.values(chars).filter(c=>c.enabled);
  if(!enabledChars.length){showToast('沒有啟用的角色','error');return}
  // Build part → [characters] mapping to detect exclusivity
  const partToChars={};
  enabledChars.forEach(c=>{
    (c.partNums||[]).forEach(pn=>{
      const key=pn.toLowerCase();
      if(!partToChars[key])partToChars[key]=[];
      partToChars[key].push(c.minifigNum);
    });
  });
  // Apply tags: a part belongs to a character if exclusive OR if it appears in only this character's list
  let tagged=0, skippedGeneric=0, alreadyTagged=0, seriesOnly=0;
  const EXCLUSIVITY_THRESHOLD=4; // Appears in ≥4 characters → generic
  allItems.forEach(item=>{
    const didLC=(item.designId||'').toLowerCase();
    const altLC=(item.altIds||[]).map(a=>(a||'').toLowerCase());
    const allLC=[didLC,...altLC].filter(Boolean);
    // Find which characters this item matches
    const matchedChars=new Set();
    allLC.forEach(lc=>{(partToChars[lc]||[]).forEach(ch=>matchedChars.add(ch))});
    // Also detect series independently (keyword/prefix)
    const derivedSeries=detectSeries(item);
    if(matchedChars.size===0){
      // No character match - try series only
      if(derivedSeries&&item.seriesTag!==derivedSeries){
        item.seriesTag=derivedSeries;
        item.updatedAt=Date.now();
        markDirty(item.id);
        seriesOnly++;
      }
      return;
    }
    if(matchedChars.size>=EXCLUSIVITY_THRESHOLD){
      // Generic - skip characterTag but still set seriesTag
      if(derivedSeries&&item.seriesTag!==derivedSeries){
        item.seriesTag=derivedSeries;
        item.updatedAt=Date.now();
        markDirty(item.id);
        seriesOnly++;
      }
      skippedGeneric++;
      return;
    }
    // Assign to first matched character (by user's enable order)
    const firstMatch=Array.from(matchedChars)[0];
    // Derive series from the matched character's minifig prefix
    const charSeries=derivedSeries||detectSeriesFromDesignId(firstMatch);
    if(item.characterTag===firstMatch&&item.seriesTag===charSeries){alreadyTagged++;return}
    item.characterTag=firstMatch;
    if(charSeries)item.seriesTag=charSeries;
    item.updatedAt=Date.now();
    markDirty(item.id);
    tagged++;
  });
  showToast(`✅ 貼角色 ${tagged} 件 | 通用 ${skippedGeneric} | 僅系列 ${seriesOnly} | 已存在 ${alreadyTagged}`);
  renderCharactersPage();
}

function clearAllCharacterTags(){
  if(!confirm('清除所有零件的角色和系列標籤？（不會刪除角色設定）'))return;
  let cleared=0;
  allItems.forEach(item=>{
    if(item.characterTag||item.seriesTag){
      delete item.characterTag;
      delete item.seriesTag;
      item.updatedAt=Date.now();
      markDirty(item.id);
      cleared++;
    }
  });
  showToast(`已清除 ${cleared} 個零件的標籤`);
}

// Load cached scan on page init
loadCachedScan();

function exportForLabels(){
  if(!allItems.length){showToast('沒有資料可匯出','error');return}
  const data=allItems.map(i=>({slot:i.slot||'',slotType:i.slotType||'small',name:i.name||'',nameCN:i.nameCN||'',designId:i.designId||'',thumbnailUrl:i.thumbnailUrl||'',quantity:i.quantity||1}));
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='bricksort-labels-'+new Date().toISOString().slice(0,10)+'.json';a.click();
  showToast('已匯出 '+data.length+' 筆標籤資料');
}

function exportFullData(){
  if(!allItems.length){showToast('沒有資料可匯出','error');return}
  const exportObj={
    version:2,
    exportedAt:new Date().toISOString(),
    slotConfig:{nextSmallSlot:slotConfig.nextSmallSlot,nextBagSlot:slotConfig.nextBagSlot,totalSmallDrawers:slotConfig.totalSmallDrawers,bagCapacity:slotConfig.bagCapacity,locked:slotConfig.locked},
    items:allItems
  };
  const blob=new Blob([JSON.stringify(exportObj)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='bricksort-full-'+new Date().toISOString().slice(0,10)+'.json';a.click();
  showToast('已匯出 '+allItems.length+' 筆完整資料');
}

function importFullData(event){
  const file=event.target.files[0];if(!file)return;
  const statusEl=document.getElementById('import-status');
  statusEl.textContent='讀取中…';statusEl.style.color='var(--accent)';
  const reader=new FileReader();
  reader.onload=function(e){
    try{
      const raw=JSON.parse(e.target.result);
      let items,cfg;
      // Support both formats: {version,items,slotConfig} or plain array
      if(raw.version&&raw.items){
        items=raw.items;cfg=raw.slotConfig;
        statusEl.textContent='格式：BrickSort 完整備份 v'+raw.version+' ('+raw.exportedAt+')';
      } else if(Array.isArray(raw)){
        items=raw;cfg=null;
        statusEl.textContent='格式：JSON 陣列';
      } else {
        statusEl.textContent='❌ 無法辨識的 JSON 格式';statusEl.style.color='var(--red)';return;
      }
      if(!items.length){statusEl.textContent='❌ JSON 中沒有零件資料';statusEl.style.color='var(--red)';return}
      // Validate: items should have slot field
      const hasSlot=items.filter(i=>i.slot).length;
      const mode=allItems.length>0?'merge':'replace';
      // Helper: extract timestamp from id, fallback to now
      const nowTs=Date.now();
      const idTs=(id)=>{const m=(id||'').match(/^lego_(\d+)/);return m?parseInt(m[1]):nowTs};
      // Sanitize: reject out-of-range slots (but DON'T move to avoid reshuffling physical drawers)
      let outOfRange=0;
      items.forEach(item=>{
        const s=item.slot||'';
        if(item.slotType==='small'||/^\d+[ab]?$/.test(s)){
          const m=s.match(/^0*(\d+)[ab]?$/);
          if(m){
            const n=parseInt(m[1]);
            if(n>450||n<1){
              // Skip: don't import this slot assignment, warn
              outOfRange++;
              // Preserve item but mark for manual review (move to placeholder bag)
              item._slotOutOfRange=true;
              item.slot='B01';  // temporary - user must manually reassign
              item.slotType='bag';
            }
          }
        }else if(item.slotType==='large'||/^L\d+$/i.test(s)){
          const m=s.match(/^L(\d+)$/i);
          if(m){
            const n=parseInt(m[1]);
            if(n>27||n<1){outOfRange++;item._slotOutOfRange=true;item.slot='B01';item.slotType='bag'}
          }
        }
      });
      if(outOfRange>0){
        statusEl.innerHTML+='<br><span style="color:var(--orange)">⚠ '+outOfRange+' 筆超出範圍的 slot 已移到 B01 (請手動處理)</span>';
      }
      if(mode==='merge'){
        if(!confirm('目前已有 '+allItems.length+' 筆資料。\n\n選擇匯入模式：\n• 確定 = 合併（保留現有 + 加入新的，按 designId 比對避免重複）\n• 取消 = 放棄匯入')){
          statusEl.textContent='已取消';statusEl.style.color='var(--muted)';return;
        }
        // Merge: by designId (not by id) to prevent duplicates
        let added=0,updated=0,skippedDup=0;
        const existingByDesign=new Map();
        allItems.forEach(i=>{
          const did=(i.designId||'').trim();
          if(did&&!existingByDesign.has(did))existingByDesign.set(did,i);
        });
        items.forEach(item=>{
          // Ensure createdAt (critical - missing createdAt caused epoch-0 duplicates)
          if(!item.createdAt||item.createdAt<86400000)item.createdAt=idTs(item.id);
          if(!item.updatedAt)item.updatedAt=item.createdAt;
          const did=(item.designId||'').trim();
          if(did&&existingByDesign.has(did)){
            // Same designId exists - keep newer, skip old
            const existing=existingByDesign.get(did);
            if((item.updatedAt||0)>(existing.updatedAt||0)){
              // Update existing with newer data (but keep id/slot/createdAt)
              Object.assign(existing,item,{id:existing.id,slot:existing.slot,createdAt:existing.createdAt});
              markDirty(existing.id);updated++;
            }else{
              skippedDup++;
            }
          }else{
            // New item
            if(!item.id)item.id='lego_'+nowTs+'_'+Math.random().toString(36).slice(2,5);
            allItems.push(item);
            if(did)existingByDesign.set(did,item);
            markDirty(item.id);added++;
          }
        });
        statusEl.innerHTML='<span style="color:var(--green)">✅ 合併完成：新增 '+added+'，更新 '+updated+'，跳過重複 '+skippedDup+'（共 '+allItems.length+' 筆）</span>';
      } else {
        // Replace: clear and load, ensure all have createdAt
        allItems=items.map(i=>{
          if(!i.id)i.id='lego_'+nowTs+'_'+Math.random().toString(36).slice(2,5);
          if(!i.createdAt||i.createdAt<86400000)i.createdAt=idTs(i.id);
          if(!i.updatedAt)i.updatedAt=i.createdAt;
          return i;
        });
        allItems.forEach(i=>markDirty(i.id));
        statusEl.innerHTML='<span style="color:var(--green)">✅ 已載入 '+allItems.length+' 筆零件</span>';
      }
      // Restore slotConfig if available
      if(cfg){
        slotConfig={...slotConfig,...cfg};
        markDirty('__config__');
        statusEl.innerHTML+='<br><span style="color:var(--accent)">📌 slotConfig 已還原：next='+slotConfig.nextSmallSlot+'</span>';
      }
      renderStats();applyFilter();renderSyncStatus();renderLockStatus();
      showToast('JSON 匯入成功：'+allItems.length+' 筆');
    }catch(err){
      statusEl.textContent='❌ 解析失敗：'+err.message;statusEl.style.color='var(--red)';
    }
  };
  reader.readAsText(file);
  event.target.value='';
}

function showToast(msg,type,duration){const t=document.getElementById('toast');t.innerHTML=msg.replace(/\n/g,'<br>');t.style.background=type==='error'?'var(--red)':'var(--green)';t.style.color=type==='error'?'#fff':'#0a0a0a';t.classList.add('show');setTimeout(()=>t.classList.remove('show'),duration||2500)}

// ═══════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════
init();

// [v20as] Multi-image Gemini call for cross-verification
async function callGeminiMultiImage(prompt,base64Images,systemInstruction,_retryIdx=0,_429attempt=0){
  if(!cfg.apiKey)throw new Error('請先設定 Gemini API Key');
  const model=(_retryIdx===0&&_lastWorkingModel)?_lastWorkingModel:(GEMINI_MODELS[_retryIdx]||GEMINI_MODELS[0]);
  const parts=[{text:prompt}];
  for(const img of base64Images){const raw=img.includes(',')?img.split(',')[1]:img;parts.push({inlineData:{mimeType:'image/jpeg',data:raw}})}
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),60000);
  try{
    const resp=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent?key='+cfg.apiKey,{
      method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
      body:JSON.stringify({contents:[{parts}],generationConfig:{temperature:0},...(systemInstruction?{system_instruction:{parts:[{text:systemInstruction}]}}:{})})
    });
    clearTimeout(timeout);
    if(resp.status===503||resp.status===404){_lastWorkingModel=null;const nextIdx=Math.max(GEMINI_MODELS.indexOf(model),_retryIdx)+1;if(nextIdx<GEMINI_MODELS.length)return callGeminiMultiImage(prompt,base64Images,systemInstruction,nextIdx);throw new Error('所有模型都不可用')}
    if(resp.status===429){if(_429attempt<2){let waitMs=Math.min(8000,2000*Math.pow(2,_429attempt));try{const ed=await resp.json();const ri=ed?.error?.details?.find(d=>d['@type']?.includes('RetryInfo'));if(ri?.retryDelay){const mm=ri.retryDelay.match(/(\\d+(?:\\.\\d+)?)s/);if(mm&&parseFloat(mm[1])<10)waitMs=Math.ceil(parseFloat(mm[1])*1000)+200;}}catch(e){}await new Promise(r=>setTimeout(r,waitMs));return callGeminiMultiImage(prompt,base64Images,systemInstruction,_retryIdx,_429attempt+1)}throw new Error('Gemini 配額用完')}
    if(!resp.ok)throw new Error('Gemini API '+resp.status);
    _lastWorkingModel=model;const data=await resp.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text||'[]';
  }catch(e){clearTimeout(timeout);throw e}
}

// [v20as] Cross-verification mode - image-to-image comparison
async function crossVerifyMode(){
  const cv=window._cvData;
  if(!cv){alert("\u7121\u4EA4\u53C9\u9A57\u8B49\u8CC7\u6599");return}
  const userBase64=cv.base64;
  const partInfo=cv.partInfo;
  const banner=document.getElementById("match-banner");
  banner.innerHTML='<div style="color:var(--orange);font-weight:700">\u26A1 \u4EA4\u53C9\u9A57\u8B49\u4E2D...</div><div style="font-size:12px;color:var(--muted)">\u6B63\u5728\u6BD4\u5C0D\u6709\u5BE6\u62CD\u7167\u7684\u96F6\u4EF6 (\u5716\u5C0D\u5716)...</div>';

  try{
    // Step A: Filter candidates WITH imageData only
    const withImg=allItems.filter(i=>i.imageData&&i.imageData.startsWith('data:image')&&i.imageData.length>200);
    if(withImg.length===0){
      banner.innerHTML='<div style="color:var(--red)">\u8CC7\u6599\u5EAB\u4E2D\u6C92\u6709\u5E36\u5BE6\u62CD\u7167\u7684\u96F6\u4EF6\uFF0C\u7121\u6CD5\u4EA4\u53C9\u9A57\u8B49</div>';
      return;
    }

    // Step B: Pre-filter by keywords (narrow from all imageData items)
    const desc=((partInfo.name||"")+" "+(partInfo.nameCN||"")+" "+(partInfo.description||"")+" "+(partInfo.category||"")).toLowerCase();
    const keywords=desc.split(/[\s,;.]+/).filter(w=>w.length>2);
    let cands=withImg.filter(item=>{
      const t=((item.name||"")+" "+(item.nameCN||"")+" "+(item.bricklinkCategory||"")).toLowerCase();
      return keywords.filter(k=>t.includes(k)).length>=1;
    });
    // If too few candidates from keyword match, use all imageData items
    if(cands.length<3)cands=withImg;
    // Limit to 8 for API call (Gemini multi-image limit)
    cands=cands.slice(0,8);

    // Step C: Build multi-image Gemini call
    // Image 0 = user's photo, Images 1-N = candidate imageData
    const images=[userBase64,...cands.map(c=>c.imageData)];
    const candDesc=cands.map((c,i)=>"Image "+(i+1)+": "+c.designId+" "+(c.nameCN||c.name||"")).join("\n");

    const prompt="Image 0 is a photo of a LEGO part taken by the user.\n"+
      "Images 1-"+cands.length+" are reference photos of known parts from the database.\n\n"+
      candDesc+"\n\n"+
      "Compare Image 0 with each reference image VISUALLY.\n"+
      "Focus on: shape, color, printed/decorated patterns, size, distinctive features.\n"+
      "Rank which reference image is most likely the SAME part as Image 0.\n\n"+
      "Return ONLY a JSON array sorted by visual similarity (confidence 0-100):\n"+
      '[{"rank":1,"imgIdx":2,"designId":"xxx","confidence":85,"reason":"..."}]\n'+
      "If NONE match visually, return [].";

    banner.innerHTML='<div style="color:var(--orange);font-weight:700">\u26A1 Gemini \u591A\u5716\u6BD4\u5C0D\u4E2D...</div><div style="font-size:12px;color:var(--muted)">\u6B63\u5728\u6BD4\u5C0D '+cands.length+' \u500B\u5019\u9078\u96F6\u4EF6\u7684\u5BE6\u62CD\u7167...</div>';

    const resp=await callGeminiMultiImage(prompt,images,null);
    let results=[];
    try{results=JSON.parse(resp.replace(/```json|```/g,"").trim())}catch(e){}

    // Step D: Show results
    let h='<div style="font-weight:700;color:var(--accent);margin-bottom:8px">\uD83D\uDD0D \u4EA4\u53C9\u9A57\u8B49\u7D50\u679C (\u5716\u5C0D\u5716)</div>';
    h+='<div style="font-size:11px;color:var(--muted);margin-bottom:8px">\u9EDE\u9078\u6B63\u78BA\u7684\u96F6\u4EF6\uFF0C\u6216\u6ED1\u5230\u5E95\u90E8\u9078\u300C\u90FD\u4E0D\u662F\u300D</div>';

    const ranked=results.length>0?results:cands.map((c,i)=>({imgIdx:i+1,designId:c.designId,confidence:50,reason:""}));

    for(const r of ranked.slice(0,8)){
      const idx=(r.imgIdx||1)-1;
      const item=cands[idx]||cands.find(c=>c.designId===r.designId);
      if(!item)continue;
      const conf=r.confidence||0;
      const cc=conf>=70?"var(--green)":conf>=40?"var(--orange)":"var(--muted)";
      const thumbSrc=item.imageData||item.thumbnailUrl||"";
      h+='<div onclick="crossVerifySelect(\''+item.designId+'\',\''+item.id+'\')" '+
        'style="display:flex;gap:8px;align-items:center;padding:8px;margin-bottom:4px;background:var(--surface);border-radius:8px;cursor:pointer;border:1px solid var(--border)">';
      h+='<img src="'+thumbSrc+'" style="width:48px;height:48px;object-fit:contain;border-radius:4px;background:#fff" onerror="this.style.display=\'none\'">';
      h+='<div style="flex:1"><div style="font-size:13px;font-weight:600">'+(item.nameCN||item.name||"")+'</div>';
      h+='<div style="font-size:11px;color:var(--muted)">'+item.designId+' \u00B7 '+item.slot+'</div>';
      if(r.reason)h+='<div style="font-size:10px;color:var(--dim);margin-top:2px">'+r.reason+'</div>';
      h+='</div>';
      h+='<div style="font-size:14px;font-weight:700;color:'+cc+'">'+conf+'%</div></div>';
    }

    h+='<button onclick="crossVerifyNew()" style="width:100%;margin-top:8px;padding:10px;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;cursor:pointer;font-size:13px">\u2795 \u90FD\u4E0D\u662F\uFF0C\u5EFA\u7ACB\u65B0\u96F6\u4EF6</button>';

    banner.innerHTML=h;
    banner.style.maxHeight="60vh";
    banner.style.overflowY="auto";
  }catch(e){
    banner.innerHTML='<div style="color:var(--red)">\u4EA4\u53C9\u9A57\u8B49\u5931\u6557: '+e.message+'</div>';
  }
}

function crossVerifySelect(designId,itemId){
  const item=allItems.find(i=>i.id===itemId||i.designId===designId);
  if(!item)return;
  const cv=window._cvData;if(cv)cv.dbMatch=item;
  renderMiniMap(item.slot);
  const banner=document.getElementById("match-banner");
  banner.style.maxHeight="";banner.style.overflowY="";
  banner.innerHTML='<div style="font-size:13px;font-weight:700;color:var(--green)">\u2705 \u5DF2\u9078\u64C7: '+(item.nameCN||item.name)+'</div><div style="font-size:12px;color:var(--muted)">'+item.designId+' \u00B7 '+item.slot+'</div>';
  document.getElementById("result-confirm-card").style.display="none";
  document.getElementById("result-dims-required").style.display="none";
  document.getElementById("result-qty-row").style.display="flex";
  document.getElementById("result-qty").value="1";
  document.getElementById("result-qty-save").textContent="\u2714 \u8FFD\u52A0";
}

function crossVerifyNew(){
  const banner=document.getElementById("match-banner");
  banner.style.maxHeight="";banner.style.overflowY="";
  banner.innerHTML='<div style="font-size:13px;font-weight:700;color:var(--accent)">\u2795 \u5EFA\u7ACB\u65B0\u96F6\u4EF6</div>';
  document.getElementById("result-confirm-card").style.display="block";
  document.getElementById("result-dims-required").style.display="block";
  document.getElementById("result-qty-row").style.display="none";
}

// [v20at] Share route selection dialog
function showSharedImageDialog(base64,imgSrc){
  return new Promise(resolve=>{
    const ov=document.createElement('div');
    ov.id='share-route-dialog';
    ov.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    const c=document.createElement('div');
    c.style.cssText='background:var(--card);border-radius:16px;padding:20px;max-width:340px;width:100%;text-align:center';
    c.innerHTML='<div style="margin-bottom:12px"><img src="'+imgSrc+'" style="max-height:120px;max-width:100%;border-radius:8px;object-fit:contain"></div>'+
      '<div style="font-size:15px;font-weight:700;margin-bottom:4px">\u8ACB\u9078\u64C7\u8655\u7406\u65B9\u5F0F</div>'+
      '<div style="font-size:12px;color:var(--muted);margin-bottom:16px">\u5206\u4EAB\u7684\u5716\u7247\u662F\u54EA\u7A2E\u985E\u578B\uFF1F</div>'+
      '<button id="sr-camera" style="width:100%;padding:12px;margin-bottom:8px;background:var(--accent);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">\uD83D\uDCF7 \u76F4\u63A5\u8FA8\u8B58 (BK+Gemini)</button>'+
      '<div style="font-size:11px;color:var(--muted);margin-bottom:12px">\u9069\u7528\uFF1A\u5BE6\u7269\u7167\u7247\u3001\u975E Lens \u622A\u5716</div>'+
      '<button id="sr-lens" style="width:100%;padding:12px;margin-bottom:8px;background:var(--surface);color:var(--text);border:1px solid var(--accent);border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">\uD83D\uDD0D Lens \u622A\u5716\u5EFA\u6A94 (\u88C1\u5207+OCR)</button>'+
      '<div style="font-size:11px;color:var(--muted);margin-bottom:12px">\u9069\u7528\uFF1A\u667A\u6167\u93E1\u982D\u622A\u5716\uFF0C\u4FDD\u5B58\u5BE6\u62CD\u7E2E\u5716\uFF0CID\u5F37\u5236\u6E05\u9664</div>'+
      '<button id="sr-cancel" style="width:100%;padding:10px;background:none;border:1px solid var(--border);color:var(--muted);border-radius:10px;font-size:13px;cursor:pointer">\u53D6\u6D88</button>';
    ov.appendChild(c);
    document.body.appendChild(ov);
    document.getElementById('sr-camera').onclick=function(){document.body.removeChild(ov);cameraRecognize(base64,imgSrc).then(resolve)};
    document.getElementById('sr-lens').onclick=function(){document.body.removeChild(ov);currentImageData=imgSrc;parseLensScreenshot(imgSrc).then(resolve)};
    document.getElementById('sr-cancel').onclick=function(){document.body.removeChild(ov);resolve()};
  });
}

// [v20bb] Custom numeric keypad for slot inputs (0-9, a, b, B, L)
const SLOT_KEYPAD_IDS = ['m-slot', 'slot-override-input', 'editor-manual-slot'];

function showSlotKeypad(inputEl) {
  // Remove existing keypad
  const existing = document.getElementById('slot-keypad');
  if (existing) existing.remove();
  
  // Prevent native keyboard
  inputEl.setAttribute('readonly', 'readonly');
  inputEl.blur();
  
  // Clear input (user can press numbers directly)
  inputEl.value = '';
  
  const kp = document.createElement('div');
  kp.id = 'slot-keypad';
  kp.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:var(--card);border-top:2px solid var(--accent);padding:12px;z-index:10000;box-shadow:0 -4px 20px rgba(0,0,0,0.6);max-width:500px;margin:0 auto';
  
  // Display area (shows current input value)
  const dis = document.createElement('div');
  dis.id = 'kp-display';
  dis.style.cssText = 'font-family:var(--mono,monospace);font-size:28px;font-weight:700;text-align:center;padding:12px;background:var(--surface);border-radius:10px;margin-bottom:10px;min-height:50px;color:var(--accent);letter-spacing:2px';
  dis.textContent = '_';
  kp.appendChild(dis);
  
  // Key grid 4x4
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:8px';
  
  const keys = ['7','8','9','a','4','5','6','b','1','2','3','\u232B','B','0','L','\u2713'];
  
  for (const k of keys) {
    const btn = document.createElement('button');
    btn.textContent = k;
    btn.type = 'button';
    const isOK = k === '\u2713';
    const isBack = k === '\u232B';
    const isLetter = /^[abBL]$/.test(k);
    btn.style.cssText = 'padding:18px 0;font-size:22px;font-weight:700;border:none;border-radius:10px;cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent;' + 
      (isOK ? 'background:var(--green,#4caf50);color:#fff' :
       isBack ? 'background:#e74c3c;color:#fff' :
       isLetter ? 'background:var(--accent);color:#000' :
       'background:var(--surface);color:var(--text);border:1px solid var(--border)');
    
    btn.addEventListener('click', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (isBack) {
        inputEl.value = inputEl.value.slice(0, -1);
      } else if (isOK) {
        inputEl.removeAttribute('readonly');
        kp.remove();
        // Auto-trigger confirm action for override input
        if (inputEl.id === 'slot-override-input' && typeof applySlotOverrideManual === 'function') {
          applySlotOverrideManual();
        } else if (inputEl.id === 'editor-manual-slot' && typeof applyEditorManual === 'function') {
          applyEditorManual();
        }
        return;
      } else {
        inputEl.value += k;
      }
      dis.textContent = inputEl.value || '_';
    });
    grid.appendChild(btn);
  }
  kp.appendChild(grid);
  
  // Close button
  const close = document.createElement('button');
  close.textContent = '\u95DC\u9589';
  close.type = 'button';
  close.style.cssText = 'width:100%;margin-top:10px;padding:10px;background:none;border:1px solid var(--border);color:var(--muted);border-radius:10px;font-size:13px;cursor:pointer';
  close.addEventListener('click', function() { inputEl.removeAttribute('readonly'); kp.remove(); });
  kp.appendChild(close);
  
  document.body.appendChild(kp);
}

// Event delegation: trigger keypad on click/focus of slot input fields
document.addEventListener('focusin', function(ev) {
  if (SLOT_KEYPAD_IDS.indexOf(ev.target.id) >= 0) {
    setTimeout(function() { showSlotKeypad(ev.target); }, 10);
  }
});
document.addEventListener('click', function(ev) {
  if (SLOT_KEYPAD_IDS.indexOf(ev.target.id) >= 0) {
    ev.preventDefault();
    showSlotKeypad(ev.target);
  }
}, true);

// [v20bd] Non-official thumbnail audit + visual matching
const LENS_CROP_W = 160;
const LENS_CROP_H = 135;
const DIM_TOLERANCE = 3;

async function getImageDims(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({w: img.width, h: img.height, ok: true});
    img.onerror = () => resolve({w: 0, h: 0, ok: false});
    img.src = dataUrl;
  });
}

function isLensCropThumb(dims) {
  if (!dims || !dims.ok) return false;
  return Math.abs(dims.w - LENS_CROP_W) <= DIM_TOLERANCE &&
         Math.abs(dims.h - LENS_CROP_H) <= DIM_TOLERANCE;
}

async function auditNonOfficialThumbs() {
  const noId = (typeof allItems !== 'undefined' ? allItems : []).filter(i => !i.designId);
  const result = { valid: [], missing: [], wrongSize: [] };
  for (const i of noId) {
    const entry = {
      internalId: i.id,
      name: (i.nameCN || i.name || '(未命名)').substring(0, 30),
      slot: i.slot || '(未配置)',
      createdAt: i.createdAt ? new Date(i.createdAt).toISOString().substring(0,10) : null
    };
    if (!i.imageData || i.imageData.length < 100) { result.missing.push(entry); continue; }
    const dims = await getImageDims(i.imageData);
    if (!dims.ok) { result.missing.push(Object.assign({}, entry, {reason: 'load error'})); continue; }
    entry.width = dims.w; entry.height = dims.h;
    if (isLensCropThumb(dims)) result.valid.push(entry);
    else result.wrongSize.push(Object.assign({}, entry, {expected: LENS_CROP_W+'x'+LENS_CROP_H}));
  }
  return result;
}

async function matchNonOfficialV2(queryBase64) {
  const qDims = await getImageDims(queryBase64);
  if (!isLensCropThumb(qDims)) {
    return { error: 'QUERY_NOT_LENS_CROP', actualDims: qDims,
             message: '查詢圖不是智慧鏡頭裁切格式（' + qDims.w + 'x' + qDims.h + '），無法比對。請用智慧鏡頭流程重新拍攝。' };
  }
  const all = allItems.filter(i => !i.designId && i.imageData && i.imageData.length > 100);
  const valid = [], invalid = [];
  for (const c of all) {
    const dims = await getImageDims(c.imageData);
    if (isLensCropThumb(dims)) valid.push(c);
    else invalid.push({ internalId: c.id, name: (c.nameCN||c.name||'').substring(0,20), slot: c.slot, actualDims: dims.w+'x'+dims.h });
  }
  if (valid.length === 0) {
    return { error: 'NO_VALID_CANDIDATES', allCandidatesCount: all.length, invalidCandidates: invalid,
             message: '沒有任何合格的非原廠縮圖（需要 '+LENS_CROP_W+'x'+LENS_CROP_H+' 智慧鏡頭格式）。請重新建檔所有非原廠零件。' };
  }
  const candInfo = valid.map((c, idx) => ({ index: idx, name: (c.nameCN || c.name || '未命名').substring(0, 30), slot: c.slot || '未配置' }));
  const SYS = '你是樂高非原廠零件視覺辨識專家。嚴格比對，寧可回報無匹配也不猜測。人偶識別依序：頭部印花→軀幹印花→配件→髮飾。回應強制 JSON，不得有前後綴或 markdown。';
  const prompt = '任務：縮圖比對\n第 1 張=查詢圖，第 2 張起=資料庫非原廠零件（共 ' + valid.length + ' 張）\n\n候選：\n' + JSON.stringify(candInfo, null, 2) + '\n\n回傳 JSON:\n{"bestMatch":{"index":0,"name":"","slot":"","confidence":78,"reason":"20字內"},"allScores":[{"index":0,"confidence":5}],"decision":"match"}\n門檻：>=70 match, 40-70 uncertain, <40 no_match (index=-1)';
  try {
    const images = [queryBase64].concat(valid.map(c => c.imageData));
    const resp = await callGeminiMultiImage(prompt, images, SYS);
    const cleaned = resp.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const r = JSON.parse(cleaned);
    if (r.bestMatch && r.bestMatch.index >= 0 && r.bestMatch.index < valid.length) {
      r.bestMatch._internalId = valid[r.bestMatch.index].id;
    }
    r.meta = { validCandidatesUsed: valid.length, invalidCandidatesSkipped: invalid.length, skipped: invalid };
    return r;
  } catch (e) {
    return { error: 'AI_CALL_FAILED', message: e.message };
  }
}

async function autoAuditOnLoad() {
  if (typeof allItems === 'undefined' || !allItems.length) { setTimeout(autoAuditOnLoad, 2000); return; }
  try {
    const r = await auditNonOfficialThumbs();
    const needsFix = r.missing.length + r.wrongSize.length;
    if (needsFix > 0 && typeof showToast === 'function') {
      showToast('⚠️ ' + needsFix + ' 個非原廠零件需重新建檔（無智慧鏡頭縮圖）', 'error');
      console.warn('[v20bd] thumbnail audit:', {missing: r.missing, wrongSize: r.wrongSize});
    }
  } catch (e) { console.warn('[v20bd] audit error:', e); }
}
setTimeout(autoAuditOnLoad, 3000);

function _v20beClassify(item) {
  const nameEN = (item.name || '').toLowerCase();
  const nameCN = (item.name_cn || item.nameCN || '').toLowerCase();
  const allText = nameEN + ' ' + nameCN;
  const designId = (item.design_id || item.designId || '').trim();
  const customKW = ['jsltcustoms','custom','handmade','print','客製','客制','自制','非官方','副廠','brickowl','第三方','副厂'];
  for (const kw of customKW) {
    if (allText.indexOf(kw) >= 0) return { guess: 'custom', reason: '名稱包含 "' + kw + '"', confidence: 'high' };
  }
  if (designId && /^\d{3,7}([a-z]{1,3}\d*)?$/i.test(designId)) {
    return { guess: 'official', reason: 'Design ID "' + designId + '" 符合樂高格式', confidence: 'high' };
  }
  const series = ['minecraft','ninjago','bionicle','star wars','technic','duplo','friends'];
  for (const s of series) {
    if (allText.indexOf(s) >= 0) return { guess: 'official', reason: '系列為 "' + s + '"', confidence: 'medium' };
  }
  if (/minifigure|人偶|公仔/i.test(allText) && !designId) {
    return { guess: 'custom', reason: '人偶但無 Design ID', confidence: 'medium' };
  }
  return { guess: 'custom', reason: '預設（無明確信號）', confidence: 'low' };
}
function _v20beShowDialog(item) {
  return new Promise(function(resolve) {
    const cls = _v20beClassify(item);
    const thumbRaw = window.currentImageData || '';
    const thumbSrc = thumbRaw.indexOf('data:') === 0 ? thumbRaw : (thumbRaw ? 'data:image/jpeg;base64,' + thumbRaw : '');
    const escHtml = function(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
    const nameEN = escHtml(String(item.name || '(未命名)').substring(0, 50));
    const nameCN = escHtml(String(item.name_cn || item.nameCN || '(未命名)').substring(0, 50));
    const designId = escHtml(item.design_id || item.designId || '(無)');
    const officialSel = cls.guess === 'official' ? 'checked' : '';
    const customSel = cls.guess === 'custom' ? 'checked' : '';
    const badgeCol = cls.confidence === 'high' ? '#4caf50' : (cls.confidence === 'medium' ? '#ff9800' : '#9e9e9e');
    const offBorder = cls.guess === 'official' ? 'var(--accent,#ffa726)' : 'var(--border,#444)';
    const cusBorder = cls.guess === 'custom' ? 'var(--accent,#ffa726)' : 'var(--border,#444)';
    const offBg = cls.guess === 'official' ? 'rgba(255,167,38,0.08)' : 'transparent';
    const cusBg = cls.guess === 'custom' ? 'rgba(255,167,38,0.08)' : 'transparent';
    const ov = document.createElement('div');
    ov.id = 'official-choice-dialog';
    ov.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px';
    ov.innerHTML = [
      '<div style="background:var(--card,#222);border-radius:14px;padding:18px;max-width:440px;width:100%;color:var(--text,#eee);border:1px solid var(--border,#444);max-height:92vh;overflow-y:auto">',
      '<h3 style="margin:0 0 12px 0;font-size:18px">📦 建檔分類確認</h3>',
      '<div style="display:flex;gap:10px;margin-bottom:12px;align-items:flex-start">',
      (thumbSrc ? '<img src="' + thumbSrc + '" style="width:90px;height:auto;border-radius:8px;border:1px solid var(--border,#555);flex-shrink:0">' : ''),
      '<div style="flex:1;font-size:12px;line-height:1.6">',
      '<div><strong>EN:</strong> ' + nameEN + '</div>',
      '<div><strong>CN:</strong> ' + nameCN + '</div>',
      '<div style="font-family:var(--mono,monospace);color:var(--muted,#888);margin-top:4px"><strong>Design ID:</strong> ' + designId + '</div>',
      '</div></div>',
      '<div style="background:var(--surface,#2a2a2a);border-radius:8px;padding:10px;margin-bottom:12px;font-size:12px;border-left:3px solid ' + badgeCol + '">',
      '<div style="color:' + badgeCol + ';font-weight:600;margin-bottom:4px">🤖 系統建議：' + (cls.guess === 'official' ? '原廠樂高' : '非原廠/客製') + '（信心 ' + cls.confidence + '）</div>',
      '<div style="color:var(--muted,#aaa)">原因：' + escHtml(cls.reason) + '</div></div>',
      '<div style="margin-bottom:14px">',
      '<label style="display:flex;align-items:center;gap:8px;padding:12px;border-radius:8px;border:1px solid ' + offBorder + ';margin-bottom:8px;cursor:pointer;background:' + offBg + '">',
      '<input type="radio" name="oc-choice" value="official" ' + officialSel + ' style="width:18px;height:18px">',
      '<div><div style="font-weight:600">🧱 原廠樂高</div><div style="font-size:11px;color:var(--muted,#aaa)">保留 Design ID，走 BK API 辨識</div></div>',
      '</label>',
      '<label style="display:flex;align-items:center;gap:8px;padding:12px;border-radius:8px;border:1px solid ' + cusBorder + ';cursor:pointer;background:' + cusBg + '">',
      '<input type="radio" name="oc-choice" value="custom" ' + customSel + ' style="width:18px;height:18px">',
      '<div><div style="font-weight:600">🎨 非原廠 / 客製零件</div><div style="font-size:11px;color:var(--muted,#aaa)">清除 Design ID，走視覺比對</div></div>',
      '</label></div>',
      '<div style="display:flex;gap:8px">',
      '<button id="oc-cancel" style="flex:1;padding:10px;background:none;border:1px solid var(--border,#555);color:var(--text,#ccc);border-radius:8px;font-size:14px;cursor:pointer">取消</button>',
      '<button id="oc-confirm" style="flex:2;padding:10px;background:var(--accent,#ffa726);border:none;color:#000;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">確認建檔</button>',
      '</div></div>'
    ].join('');
    document.body.appendChild(ov);
    ov.querySelector('#oc-cancel').onclick = function() { ov.remove(); resolve({ cancelled: true }); };
    ov.querySelector('#oc-confirm').onclick = function() {
      const sel = ov.querySelector('input[name="oc-choice"]:checked');
      const choice = sel ? sel.value : cls.guess;
      ov.remove();
      resolve({ choice: choice, suggestion: cls });
    };
  });
}
async function _v20beApply(item, choice) {
  if (choice === 'custom') {
    item.design_id = '';
    item.designId = '';
    item.altIds = [];
    item.alt_ids = [];
    item.brickognizeName = '';
    item.brickognize_name = '';
    item._isCustom = true;
    if (typeof showToast === 'function') showToast('🎨 已設為非原廠零件', 'info');
  } else {
    item._userConfirmedOfficial = true;
    if (typeof showToast === 'function') showToast('🧱 已設為原廠樂高', 'info');
  }
  return item;
}
async function _v20beChoiceThenProcess(item) {
  const r = await _v20beShowDialog(item);
  if (r.cancelled) { if (typeof showTab === 'function') showTab('main'); return false; }
  await _v20beApply(item, r.choice);
  return true;
}

// [v20bf] Visual match fallback: hook cameraRecognize to try matchNonOfficialV2 when no match found
(function() {
  if (typeof cameraRecognize !== 'function') { console.warn('[v20bf] cameraRecognize not found'); return; }
  const _v20bf_origCR = cameraRecognize;
  async function _v20bfFallbackMatch(base64, imgSrc) {
    await new Promise(r => setTimeout(r, 100));
    const pp = window.pendingPart;
    if (pp && pp.matchedId) return;
    if (typeof matchNonOfficialV2 !== 'function') return;
    let queryImg = window.currentImageData || '';
    if (!queryImg && base64) {
      queryImg = base64.indexOf('data:') === 0 ? base64 : 'data:image/jpeg;base64,' + base64;
    }
    if (!queryImg) return;
    const banner = document.getElementById('match-banner');
    if (banner) {
      banner.style.display = 'block';
      banner.innerHTML = '<div style="font-size:13px;color:var(--accent,#ffa726)">🔍 搜尋非原廠資料庫中...</div>';
    }
    try {
      const result = await matchNonOfficialV2(queryImg);
      if (result.error) {
        if (banner) {
          banner.style.display = 'block';
          banner.innerHTML = '<div style="font-size:12px;color:var(--muted,#888)">⚠️ ' + (result.message || result.error) + '</div>';
        }
        return;
      }
      const best = result.bestMatch;
      if (!best || best.index < 0 || result.decision === 'no_match') {
        if (banner) {
          banner.style.display = 'block';
          banner.innerHTML = '<div style="font-size:12px;color:var(--muted,#888)">📭 非原廠資料庫中也找不到匹配</div>';
        }
        return;
      }
      const matchedItem = allItems.find(i => i.id === best._internalId);
      if (!matchedItem) return;
      const confColor = result.decision === 'match' ? 'var(--green,#4caf50)' : 'var(--accent,#ffa726)';
      const confLabel = result.decision === 'match' ? '✅ 視覺匹配' : '❓ 疑似匹配';
      const slotInfo = matchedItem.slot ? (matchedItem.slot + ' (' + (matchedItem.slotType || '') + ')') : '未配置';
      const pickupInfo = matchedItem.pickupSlot ? (' · 快取 ' + matchedItem.pickupSlot) : '';
      if (banner) {
        banner.style.display = 'block';
        banner.innerHTML = [
          '<div style="font-size:13px;font-weight:700;color:' + confColor + '">🧠 ' + confLabel + '（信心 ' + best.confidence + '%）</div>',
          '<div style="font-size:12px;color:var(--muted,#aaa);margin-top:4px">「' + (matchedItem.nameCN || matchedItem.name || '').substring(0, 40) + '」</div>',
          '<div style="font-size:13px;color:var(--accent,#ffa726);margin-top:4px">📍 ' + slotInfo + pickupInfo + '</div>',
          (best.reason ? '<div style="font-size:11px;color:var(--muted,#888);margin-top:4px;font-style:italic">' + String(best.reason).substring(0, 60) + '</div>' : ''),
          '<div style="margin-top:8px;display:flex;gap:6px">',
          '  <button onclick="_v20bfAcceptMatch(\'' + matchedItem.id + '\')" style="flex:1;padding:8px;background:var(--accent,#ffa726);color:#000;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">✓ 採用此匹配</button>',
          '  <button onclick="_v20bfRejectMatch()" style="flex:1;padding:8px;background:none;color:var(--muted,#ccc);border:1px solid var(--border,#555);border-radius:6px;font-size:12px;cursor:pointer">✕ 不是這個</button>',
          '</div>'
        ].join('');
      }
      window._v20bfPendingMatch = { item: matchedItem, bestMatch: best, result };
    } catch (e) {
      console.error('[v20bf] fallback error:', e);
      if (banner) {
        banner.innerHTML = '<div style="font-size:12px;color:#e74c3c">視覺比對失敗：' + e.message + '</div>';
      }
    }
  }
  window._v20bfAcceptMatch = function(internalId) {
    const item = allItems.find(i => i.id === internalId);
    if (!item) return;
    window.pendingPart = Object.assign({}, window.pendingPart || {}, {
      design_id: item.designId || '',
      designId: item.designId || '',
      name: item.name || '',
      name_cn: item.nameCN || '',
      nameCN: item.nameCN || '',
      slot: item.slot,
      slotType: item.slotType,
      thumbnailUrl: item.thumbnailUrl || item.imageData,
      matchedId: item.id,
      _v20bfVisualMatch: true
    });
    const setText = function(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; };
    setText('result-name', item.nameCN || item.name || '');
    setText('result-designid', item.designId || '(非原廠)');
    setText('result-slot-display', item.slot ? (item.slot + ' · ' + (item.slotType || '')) : '未配置');
    if (typeof showToast === 'function') showToast('✅ 已採用視覺匹配', 'info');
    const banner = document.getElementById('match-banner');
    if (banner) {
      banner.innerHTML = '<div style="font-size:13px;font-weight:700;color:var(--green,#4caf50)">✅ 已採用：' + (item.nameCN || item.name || '').substring(0, 30) + '</div>';
    }
  };
  window._v20bfRejectMatch = function() {
    window._v20bfPendingMatch = null;
    const banner = document.getElementById('match-banner');
    if (banner) {
      banner.innerHTML = '<div style="font-size:12px;color:var(--muted,#888)">已拒絕視覺匹配，繼續建新零件流程</div>';
    }
  };
  window.cameraRecognize = async function(base64, imgSrc) {
    window._v20bfPendingMatch = null;
    const result = await _v20bf_origCR(base64, imgSrc);
    /* [v20bg] auto-trigger disabled, use 🧠 視覺比對 button manually */
    return result;
  };
  console.log('[v20bf] cameraRecognize wrapper installed');
})();
// [v20bg] Pure visual match mode (ignores dimension check, any image OK)
async function matchVisualOnly(queryBase64) {
  const all = (typeof allItems !== 'undefined' ? allItems : []).filter(i => i.imageData && i.imageData.length > 100);
  if (all.length === 0) {
    return { error: 'NO_CANDIDATES', message: '資料庫中沒有任何帶縮圖的零件' };
  }
  const MAX = 30;
  let candidates = all;
  if (all.length > MAX) {
    const nonOff = all.filter(i => !i.designId);
    const off = all.filter(i => i.designId);
    candidates = nonOff.concat(off).slice(0, MAX);
  }
  const info = candidates.map((c, idx) => ({
    index: idx,
    name: (c.nameCN || c.name || '').substring(0, 30),
    slot: c.slot || '未配置',
    designId: c.designId || '(非原廠)'
  }));
  const SYS = '你是樂高零件視覺辨識專家。嚴格比對，寧可回報無匹配也不猜測。回應強制 JSON，不得有前後綴文字或 markdown 標記。';
  const prompt = '任務：縮圖比對\n第 1 張=查詢圖，第 2 張起=資料庫候選零件（共 ' + candidates.length + ' 張）\n\n候選：\n' + JSON.stringify(info, null, 2) + '\n\n回傳 JSON:\n{"bestMatch":{"index":0,"name":"","slot":"","confidence":78,"reason":"20字內"},"allScores":[{"index":0,"confidence":5}],"decision":"match"}\n門檻：>=70 match, 40-70 uncertain, <40 no_match (index=-1)';
  try {
    const images = [queryBase64].concat(candidates.map(c => c.imageData));
    const resp = await callGeminiMultiImage(prompt, images, SYS);
    const cleaned = resp.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const r = JSON.parse(cleaned);
    if (r.bestMatch && r.bestMatch.index >= 0 && r.bestMatch.index < candidates.length) {
      r.bestMatch._internalId = candidates[r.bestMatch.index].id;
    }
    r.meta = { totalCandidates: all.length, usedCandidates: candidates.length };
    return r;
  } catch (e) {
    return { error: 'AI_ERROR', message: e.message };
  }
}

async function runVisualOnlyMatch() {
  let queryImg = window.currentImageData || '';
  if (!queryImg) {
    if (typeof showToast === 'function') showToast('⚠️ 沒有查詢圖。請先拍照或分享截圖', 'error');
    return;
  }
  if (queryImg.indexOf('data:') !== 0) queryImg = 'data:image/jpeg;base64,' + queryImg;
  if (typeof showToast === 'function') showToast('🔍 純視覺比對中（~10 秒）...', 'info');
  const result = await matchVisualOnly(queryImg);
  if (result.error) {
    if (typeof showToast === 'function') showToast('❌ ' + (result.message || result.error), 'error');
    return;
  }
  const best = result.bestMatch;
  if (!best || best.index < 0 || result.decision === 'no_match') {
    if (typeof showToast === 'function') showToast('📭 找不到任何匹配', 'info');
    return;
  }
  const item = allItems.find(i => i.id === best._internalId);
  if (!item) return;
  _v20bgShowDialog(item, best, result);
}

function _v20bgShowDialog(item, best, fullResult) {
  const existing = document.getElementById('v20bg-match-dialog');
  if (existing) existing.remove();
  const confColor = fullResult.decision === 'match' ? '#4caf50' : (fullResult.decision === 'uncertain' ? '#ff9800' : '#9e9e9e');
  const confLabel = fullResult.decision === 'match' ? '✅ 強烈匹配' : (fullResult.decision === 'uncertain' ? '❓ 疑似匹配' : '📭 無匹配');
  const slotDisplay = item.slot ? (item.slot + ' (' + (item.slotType || '') + ')') : '未配置';
  const pickupDisplay = item.pickupSlot ? (' · 快取 ' + item.pickupSlot) : '';
  const escHtml = function(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); };
  const ov = document.createElement('div');
  ov.id = 'v20bg-match-dialog';
  ov.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px';
  const thumbSrc = item.imageData || item.thumbnailUrl || '';
  ov.innerHTML = [
    '<div style="background:var(--card,#222);border-radius:14px;padding:18px;max-width:440px;width:100%;color:var(--text,#eee);border:1px solid var(--border,#444);max-height:92vh;overflow-y:auto">',
    '<h3 style="margin:0 0 12px 0;font-size:18px;color:' + confColor + '">🧠 ' + confLabel + '（信心 ' + best.confidence + '%）</h3>',
    '<div style="display:flex;gap:10px;margin-bottom:12px;align-items:flex-start">',
    (thumbSrc ? '<img src="' + thumbSrc + '" style="width:100px;height:auto;border-radius:8px;border:1px solid var(--border,#555);flex-shrink:0">' : ''),
    '<div style="flex:1;font-size:13px;line-height:1.6">',
    '<div style="font-weight:700;font-size:14px">' + escHtml((item.nameCN || item.name || '').substring(0, 40)) + '</div>',
    '<div style="color:var(--muted,#aaa);font-family:var(--mono,monospace);font-size:11px;margin-top:2px">ID: ' + escHtml(item.designId || '(非原廠)') + '</div>',
    '<div style="color:var(--accent,#ffa726);margin-top:8px;font-weight:600">📍 ' + escHtml(slotDisplay + pickupDisplay) + '</div>',
    '</div></div>',
    (best.reason ? '<div style="background:var(--surface,#2a2a2a);border-radius:8px;padding:10px;margin-bottom:12px;font-size:12px;color:var(--muted,#aaa);font-style:italic">💬 ' + escHtml(String(best.reason).substring(0, 80)) + '</div>' : ''),
    '<div style="font-size:11px;color:var(--muted,#888);margin-bottom:10px">比對範圍：' + fullResult.meta.usedCandidates + '/' + fullResult.meta.totalCandidates + ' 張縮圖</div>',
    '<div style="display:flex;gap:8px">',
    '<button onclick="document.getElementById(\'v20bg-match-dialog\').remove()" style="flex:1;padding:10px;background:none;border:1px solid var(--border,#555);color:var(--text,#ccc);border-radius:8px;font-size:14px;cursor:pointer">關閉</button>',
    '<button onclick="_v20bgAcceptMatch(\'' + item.id + '\')" style="flex:2;padding:10px;background:var(--accent,#ffa726);border:none;color:#000;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">✓ 就是這個</button>',
    '</div></div>'
  ].join('');
  document.body.appendChild(ov);
}

window._v20bgAcceptMatch = function(internalId) {
  const item = allItems.find(i => i.id === internalId);
  if (!item) return;
  const dlg = document.getElementById('v20bg-match-dialog');
  if (dlg) dlg.remove();
  if (typeof showToast === 'function') showToast('📍 已定位：' + (item.nameCN || item.name || '').substring(0,20) + ' → ' + item.slot, 'info');
  if (typeof searchDrawer === 'function') {
    const m = (item.slot || '').match(/^0*(\d+)/);
    if (m) setTimeout(function() { searchDrawer(parseInt(m[1])); }, 800);
  }
};

// [v20bh] Upgraded registration dialog with BrickLink thumbnail comparison + visual match file picker
async function _v20bhLookupThumb(designId) {
  if (!designId) return null;
  // Try rebrickableLookup first (more reliable for minifigs)
  try {
    if (typeof rebrickableLookup === 'function') {
      const rb = await rebrickableLookup(designId);
      if (rb && rb.imgUrl) return { url: rb.imgUrl, source: 'Rebrickable' };
    }
  } catch(e) {}
  // Fallback to BrickLink color-86 URL
  const base = String(designId).replace(/[a-e]\d*$/i, '');
  return { url: 'https://img.bricklink.com/ItemImage/PN/86/' + base + '.png', source: 'BrickLink' };
}

// Override _v20beShowDialog to include BK thumbnail when OCR got ID
const _v20bh_origShowDialog = _v20beShowDialog;
window._v20beShowDialog = function(item) {
  const designId = item.design_id || item.designId || '';
  if (!designId) {
    // No OCR'd ID, use original dialog (no BK thumbnail possible)
    return _v20bh_origShowDialog(item);
  }
  
  // Has OCR'd ID → upgrade dialog with BK thumbnail side-by-side
  return new Promise(async function(resolve) {
    const cls = _v20beClassify(item);
    const thumbRaw = window.currentImageData || '';
    const thumbSrc = thumbRaw.indexOf('data:') === 0 ? thumbRaw : (thumbRaw ? 'data:image/jpeg;base64,' + thumbRaw : '');
    const escHtml = function(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
    const nameEN = escHtml(String(item.name || '(未命名)').substring(0, 50));
    const nameCN = escHtml(String(item.name_cn || item.nameCN || '(未命名)').substring(0, 50));
    const designIdDisp = escHtml(designId);
    
    // Fetch BK/Rebrickable thumbnail asynchronously
    const refThumb = await _v20bhLookupThumb(designId);
    const refThumbSrc = refThumb ? refThumb.url : '';
    const refSource = refThumb ? refThumb.source : '';
    
    const ov = document.createElement('div');
    ov.id = 'official-choice-dialog';
    ov.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px';
    
    ov.innerHTML = [
      '<div style="background:var(--card,#222);border-radius:14px;padding:18px;max-width:500px;width:100%;color:var(--text,#eee);border:1px solid var(--border,#444);max-height:92vh;overflow-y:auto">',
      '<h3 style="margin:0 0 8px 0;font-size:18px">📦 建檔分類確認</h3>',
      '<div style="color:var(--muted,#aaa);font-size:12px;margin-bottom:12px">OCR 找到 Design ID: <strong style="color:var(--accent,#ffa726);font-family:var(--mono,monospace)">' + designIdDisp + '</strong></div>',
      // Side-by-side comparison
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">',
      '  <div style="text-align:center;background:var(--surface,#2a2a2a);padding:8px;border-radius:8px">',
      '    <div style="font-size:11px;color:var(--muted,#888);margin-bottom:4px">📷 你的圖</div>',
      (thumbSrc ? '    <img src="' + thumbSrc + '" style="width:100%;max-width:140px;height:auto;border-radius:6px;background:#000">' : '<div style="padding:40px;color:#555">無</div>'),
      '  </div>',
      '  <div style="text-align:center;background:var(--surface,#2a2a2a);padding:8px;border-radius:8px">',
      '    <div style="font-size:11px;color:var(--muted,#888);margin-bottom:4px">🌐 ' + refSource + ' 官方圖</div>',
      (refThumbSrc ? '    <img src="' + refThumbSrc + '" referrerpolicy="no-referrer" style="width:100%;max-width:140px;height:auto;border-radius:6px;background:#fff" onerror="this.parentNode.innerHTML=\'<div style=padding:40px;color:#555>載入失敗<br>' + designIdDisp + '</div>\'">' : '<div style="padding:40px;color:#555">無資料</div>'),
      '  </div>',
      '</div>',
      // Item info
      '<div style="font-size:12px;line-height:1.5;margin-bottom:12px">',
      '  <div><strong>EN:</strong> ' + nameEN + '</div>',
      '  <div><strong>CN:</strong> ' + nameCN + '</div>',
      '</div>',
      // Action choices (3 options now)
      '<div style="margin-bottom:14px">',
      '  <label style="display:flex;align-items:center;gap:8px;padding:10px;border-radius:8px;border:1px solid var(--accent,#ffa726);margin-bottom:6px;cursor:pointer;background:rgba(255,167,38,0.08)">',
      '    <input type="radio" name="oc-choice" value="official" checked style="width:18px;height:18px">',
      '    <div><div style="font-weight:600">✅ 同一個零件 → 用此 ID 建檔</div><div style="font-size:11px;color:var(--muted,#aaa)">保留 ID + BrickLink 標籤</div></div>',
      '  </label>',
      '  <label style="display:flex;align-items:center;gap:8px;padding:10px;border-radius:8px;border:1px solid var(--border,#444);margin-bottom:6px;cursor:pointer">',
      '    <input type="radio" name="oc-choice" value="custom" style="width:18px;height:18px">',
      '    <div><div style="font-weight:600">❌ 不是同一個 → 清空 ID</div><div style="font-size:11px;color:var(--muted,#aaa)">縮圖+其他資訊建檔，走視覺比對</div></div>',
      '  </label>',
      '  <label style="display:flex;align-items:center;gap:8px;padding:10px;border-radius:8px;border:1px solid var(--border,#444);cursor:pointer">',
      '    <input type="radio" name="oc-choice" value="cancel" style="width:18px;height:18px">',
      '    <div><div style="font-weight:600">⚠️ 不確定 → 取消</div><div style="font-size:11px;color:var(--muted,#aaa)">請用智慧鏡頭重新建檔</div></div>',
      '  </label>',
      '</div>',
      '<div style="display:flex;gap:8px">',
      '  <button id="oc-cancel" style="flex:1;padding:10px;background:none;border:1px solid var(--border,#555);color:var(--text,#ccc);border-radius:8px;font-size:14px;cursor:pointer">取消</button>',
      '  <button id="oc-confirm" style="flex:2;padding:10px;background:var(--accent,#ffa726);border:none;color:#000;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">確認建檔</button>',
      '</div>',
      '</div>'
    ].join('');
    
    document.body.appendChild(ov);
    ov.querySelector('#oc-cancel').onclick = function() { ov.remove(); resolve({ cancelled: true }); };
    ov.querySelector('#oc-confirm').onclick = function() {
      const sel = ov.querySelector('input[name="oc-choice"]:checked');
      const choice = sel ? sel.value : 'official';
      ov.remove();
      if (choice === 'cancel') {
        if (typeof showToast === 'function') showToast('⚠️ 請用智慧鏡頭分享建檔', 'info');
        resolve({ cancelled: true });
      } else {
        resolve({ choice: choice, suggestion: cls });
      }
    };
  });
};

// [v20bh] Hot-fix the 視覺比對 button: support file picker when no currentImageData
(function() {
  if (!document.getElementById('v20bg-visual-pick')) {
    const fi = document.createElement('input');
    fi.type = 'file';
    fi.id = 'v20bg-visual-pick';
    fi.accept = 'image/*';
    fi.style.display = 'none';
    fi.addEventListener('change', async function(ev) {
      const file = ev.target.files[0];
      if (!file) return;
      ev.target.value = '';
      if (typeof showToast === 'function') showToast('📤 讀取圖片中...', 'info');
      const reader = new FileReader();
      reader.onload = async function(e) {
        const dataUrl = e.target.result;
        if (typeof showToast === 'function') showToast('🔍 純視覺比對中（~10 秒）...', 'info');
        try {
          const result = await matchVisualOnly(dataUrl);
          if (result.error) {
            if (typeof showToast === 'function') showToast('❌ ' + (result.message || result.error), 'error');
            return;
          }
          const best = result.bestMatch;
          if (!best || best.index < 0 || result.decision === 'no_match') {
            if (typeof showToast === 'function') showToast('📭 找不到任何匹配', 'info');
            return;
          }
          const item = allItems.find(i => i.id === best._internalId);
          if (!item) return;
          _v20bgShowDialog(item, best, result);
        } catch (err) {
          if (typeof showToast === 'function') showToast('❌ 錯誤：' + err.message, 'error');
        }
      };
      reader.readAsDataURL(file);
    });
    document.body.appendChild(fi);
  }
})();

window.runVisualOnlyMatch = function() {
  if (window.currentImageData) {
    (async function() {
      let queryImg = window.currentImageData;
      if (queryImg.indexOf('data:') !== 0) queryImg = 'data:image/jpeg;base64,' + queryImg;
      if (typeof showToast === 'function') showToast('🔍 用上次的查詢圖比對中...', 'info');
      const result = await matchVisualOnly(queryImg);
      if (result.error) {
        if (typeof showToast === 'function') showToast('❌ ' + (result.message || result.error), 'error');
        return;
      }
      const best = result.bestMatch;
      if (!best || best.index < 0 || result.decision === 'no_match') {
        if (typeof showToast === 'function') showToast('📭 找不到任何匹配', 'info');
        return;
      }
      const item = allItems.find(i => i.id === best._internalId);
      if (!item) return;
      _v20bgShowDialog(item, best, result);
    })();
  } else {
    document.getElementById('v20bg-visual-pick').click();
  }
};








// ════════════════════════════════════════════════════════════════
// v2026.04.20bi — 自動辨識模式（Auto Detect Still → Shutter）
// ════════════════════════════════════════════════════════════════
// 使用方式：
//   1. 手機/筆電架著相機對準 5mm 方格白紙
//   2. 點主畫面「🎯 自動辨識」按鈕
//   3. 把樂高零件放在中央方框內保持靜止
//   4. 0.8 秒勿動 → 自動拍照 → Brickognize 辨識 → 顯示位置 + TTS 播報
//   5. 顯示 5 秒後自動回到偵測模式（連拍多個零件）
// ════════════════════════════════════════════════════════════════
window.bsAuto = {
  // ─── 可調參數 ────────────────────────────────────
  STABLE_MS: 800,
  COOLDOWN_MS: 5000,
  ROI_RATIO: 0.60,
  SAD_THRESHOLD: 12,
  ANALYZE_W: 80,
  ANALYZE_H: 60,
  ANALYZE_FPS: 15,
  CAPTURE_W: 1280,

  // ─── State ──────────────────────────────────────
  state: 'idle',
  videoEl: null, canvasAnalyze: null, canvasCapture: null,
  ctxAnalyze: null, ctxCapture: null,
  stream: null, prevPixels: null,
  stableStartTime: 0, rafId: null, lastAnalyzeTime: 0,

  open() {
    if (document.getElementById('bs-auto-overlay')) return;
    this._buildUI();
    this._startCamera();
  },

  close() {
    this._stopCamera();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    const ov = document.getElementById('bs-auto-overlay');
    if (ov) ov.remove();
    this.state = 'idle';
    this.prevPixels = null;
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch(e){}
  },

  _buildUI() {
    const ov = document.createElement('div');
    ov.id = 'bs-auto-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#000;font-family:-apple-system,sans-serif;color:#fff;';
    ov.innerHTML = [
      '<video id="bs-auto-video" autoplay playsinline muted style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;"></video>',
      '<div id="bs-auto-roi" style="position:absolute;border:3px solid #22c55e;border-radius:12px;box-shadow:0 0 0 9999px rgba(0,0,0,0.45);pointer-events:none;transition:border-color 0.3s;"></div>',
      '<div style="position:absolute;top:0;left:0;right:0;padding:14px 16px;background:linear-gradient(180deg,rgba(0,0,0,0.8),transparent);display:flex;align-items:center;gap:12px;z-index:1;">',
        '<div id="bs-auto-status" style="font-size:14px;flex:1;font-weight:600;">啟動中…</div>',
        '<button id="bs-auto-close" style="background:rgba(0,0,0,0.6);color:#fff;border:1px solid rgba(255,255,255,0.3);border-radius:50%;width:36px;height:36px;font-size:20px;cursor:pointer;">×</button>',
      '</div>',
      '<div id="bs-auto-slot-top" style="position:absolute;top:54px;left:8px;right:8px;display:none;justify-content:center;align-items:center;z-index:2;pointer-events:none;"><div id="bs-auto-slot-text" style="font-size:84px;font-weight:900;color:#22c55e;text-shadow:0 3px 10px rgba(0,0,0,0.95),0 0 24px rgba(0,0,0,0.6);letter-spacing:1px;line-height:1;text-align:center;background:rgba(0,0,0,0.35);padding:8px 18px;border-radius:14px;backdrop-filter:blur(4px);"></div></div>',
      '<div style="position:absolute;bottom:0;left:0;right:0;padding:14px 16px 20px;background:linear-gradient(0deg,rgba(0,0,0,0.85),transparent);z-index:1;">',
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">',
          '<div style="font-size:11px;color:#aaa;width:50px;">穩定度</div>',
          '<div style="flex:1;height:8px;background:rgba(255,255,255,0.15);border-radius:4px;overflow:hidden;">',
            '<div id="bs-auto-bar" style="height:100%;background:#22c55e;width:0%;transition:width 0.1s linear;"></div>',
          '</div>',
          '<div id="bs-auto-pct" style="font-size:11px;color:#aaa;width:36px;text-align:right;">0%</div>',
        '</div>',
        '<div id="bs-auto-result" style="min-height:auto;padding:14px;background:rgba(0,0,0,0.7);border-radius:12px;font-size:14px;line-height:1.4;display:none;backdrop-filter:blur(6px);max-width:100%;box-sizing:border-box;"></div>',
      '</div>',
      '<canvas id="bs-auto-c-analyze" width="80" height="60" style="display:none;"></canvas>',
      '<canvas id="bs-auto-c-capture" style="display:none;"></canvas>'
    ].join('');
    document.body.appendChild(ov);

    this.videoEl = document.getElementById('bs-auto-video');
    this.canvasAnalyze = document.getElementById('bs-auto-c-analyze');
    this.canvasCapture = document.getElementById('bs-auto-c-capture');
    this.ctxAnalyze = this.canvasAnalyze.getContext('2d', {willReadFrequently: true});
    this.ctxCapture = this.canvasCapture.getContext('2d');

    document.getElementById('bs-auto-close').onclick = () => this.close();
    this.videoEl.addEventListener('loadedmetadata', () => this._positionROI());
    window.addEventListener('resize', () => this._positionROI());
  },

  _positionROI() {
    const v = this.videoEl;
    if (!v) return;
    const r = v.getBoundingClientRect();
    const w = r.width * this.ROI_RATIO;
    const h = r.height * this.ROI_RATIO;
    const roi = document.getElementById('bs-auto-roi');
    if (!roi) return;
    roi.style.left = ((r.width - w) / 2) + 'px';
    roi.style.top = ((r.height - h) / 2) + 'px';
    roi.style.width = w + 'px';
    roi.style.height = h + 'px';
  },

  async _startCamera() {
    try {
      this._setStatus('啟動相機中…');
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {facingMode: {ideal: 'environment'}, width: {ideal: 1280}, height: {ideal: 960}},
        audio: false
      });
      this.videoEl.srcObject = this.stream;
      await new Promise(r => {
        if (this.videoEl.readyState >= 2) r();
        else this.videoEl.onloadeddata = r;
      });
      this._positionROI();
      this.state = 'scanning';
      this._setStatus('🎯 對準零件並保持靜止');
      this._tickAnalyze();
    } catch (e) {
      this._setStatus('❌ 相機啟動失敗：' + e.message);
    }
  },

  _stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  },

  _setStatus(t) { const el = document.getElementById('bs-auto-status'); if (el) el.textContent = t; },

  _setBar(pct, color) {
    const b = document.getElementById('bs-auto-bar');
    const p = document.getElementById('bs-auto-pct');
    const roi = document.getElementById('bs-auto-roi');
    if (b) { b.style.width = Math.max(0, Math.min(100, pct)) + '%'; if (color) b.style.background = color; }
    if (p) p.textContent = Math.round(pct) + '%';
    if (roi && color) roi.style.borderColor = color;
  },

  _showResult(html) { const r = document.getElementById('bs-auto-result'); if (r) { r.innerHTML = html; r.style.display = 'block'; } },
  _hideResult() { const r = document.getElementById('bs-auto-result'); if (r) r.style.display = 'none'; var st = document.getElementById('bs-auto-slot-top'); if (st) st.style.display = 'none'; },

  _tickAnalyze() {
    this.rafId = requestAnimationFrame(() => this._tickAnalyze());
    const now = performance.now();
    if (now - this.lastAnalyzeTime < 1000 / this.ANALYZE_FPS) return;
    this.lastAnalyzeTime = now;
    if (this.state !== 'scanning') return;
    const v = this.videoEl;
    if (!v || !v.videoWidth) return;

    const vw = v.videoWidth, vh = v.videoHeight;
    const sw = vw * this.ROI_RATIO, sh = vh * this.ROI_RATIO;
    const sx = (vw - sw) / 2, sy = (vh - sh) / 2;
    this.ctxAnalyze.drawImage(v, sx, sy, sw, sh, 0, 0, this.ANALYZE_W, this.ANALYZE_H);
    const imgData = this.ctxAnalyze.getImageData(0, 0, this.ANALYZE_W, this.ANALYZE_H);
    const px = imgData.data;
    const n = this.ANALYZE_W * this.ANALYZE_H;
    const gray = new Uint8Array(n);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      gray[j] = (px[i] * 77 + px[i+1] * 150 + px[i+2] * 29) >> 8;
    }
    if (!this.prevPixels) { this.prevPixels = gray; return; }

    let sad = 0;
    for (let i = 0; i < n; i++) sad += Math.abs(gray[i] - this.prevPixels[i]);
    const avgDiff = sad / n;
    this.prevPixels = gray;

    if (avgDiff > this.SAD_THRESHOLD) {
      this.stableStartTime = 0;
      this._setBar(0, '#ef4444');
      this._setStatus('🏃 偵測到動作…');
    } else {
      if (this.stableStartTime === 0) this.stableStartTime = now;
      const elapsed = now - this.stableStartTime;
      const pct = Math.min(100, (elapsed / this.STABLE_MS) * 100);
      this._setBar(pct, '#22c55e');
      this._setStatus('⏳ 穩定中 ' + (elapsed/1000).toFixed(1) + 's / ' + (this.STABLE_MS/1000).toFixed(1) + 's');
      if (elapsed >= this.STABLE_MS) this._capture();
    }
  },

  async _capture() {
    if (this.state !== 'scanning') return;
    this.state = 'capturing';
    this._setStatus('📸 拍照中…');
    this._setBar(100, '#3b82f6');

    const v = this.videoEl;
    const cw = Math.min(this.CAPTURE_W, v.videoWidth);
    const ch = Math.round(cw * v.videoHeight / v.videoWidth);
    this.canvasCapture.width = cw;
    this.canvasCapture.height = ch;
    this.ctxCapture.drawImage(v, 0, 0, cw, ch);
    const dataUrl = this.canvasCapture.toDataURL('image/jpeg', 0.85);

    this._setStatus('🔍 辨識中…');
    try {
      const result = await this._identify(dataUrl);
      this._setStatus('✅ 完成');
      this._showResult(this._formatResult(result));
      this._speak(result.voiceText);
    } catch (e) {
      this._setStatus('⚠️ 辨識失敗：' + e.message);
      this._showResult('<div style="color:#fca5a5;">⚠️ ' + e.message + '</div>');
    }

    this.state = 'cooldown';
    this._setBar(0, '#6b7280');
    setTimeout(() => {
      this._hideResult();
      this.prevPixels = null;
      this.stableStartTime = 0;
      this.state = 'scanning';
      this._setStatus('🎯 對準下一個零件');
    }, this.COOLDOWN_MS);
  },

  async _identify(dataUrl) {
    const b64 = dataUrl.split(',')[1] || dataUrl;
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], {type: 'image/jpeg'});

    const form = new FormData();
    form.append('query_image', blob, 'q.jpg');

    const resp = await fetch('https://api.brickognize.com/predict/', {method: 'POST', body: form});
    if (!resp.ok) throw new Error('Brickognize HTTP ' + resp.status);
    const data = await resp.json();
    const predictions = data.items || [];
    if (predictions.length === 0) {
      return {type: 'no_match', displayText: '📭 找不到匹配', voiceText: '找不到此物品'};
    }
    const top = predictions[0];
    const designId = top.id;
    const score = top.score || 0;
    const item = (typeof allItems !== 'undefined' ? allItems : []).find(i =>
      i.designId === designId || (i.altIds || []).includes(designId)
    );
    if (!item) {
      return {
        type: 'unknown',
        designId: designId, score: score, bkName: top.name,
        displayText: '🆕 未建檔零件\nID: ' + designId + '\n' + (top.name || ''),
        voiceText: '識別到新零件 ' + designId + '，尚未建檔'
      };
    }
    return {
      type: 'match',
      item: item, designId: designId, score: score,
      displayText: '📍 ' + item.slot + (item.pickupSlot ? ' · 快取 ' + item.pickupSlot : '') + '\n' + (item.nameCN || item.name || '') + '\nID: ' + designId + ' · ' + Math.round(score*100) + '%',
      voiceText: (item.nameCN || item.name || '此零件') + ' 在 ' + this._slotToVoice(item.slot, item.slotType) + (item.pickupSlot ? '，快取在 ' + this._slotToVoice(item.pickupSlot, '') : '')
    };
  },

  _slotToVoice(slot, slotType) {
    if (!slot) return '沒有收納位置';
    let m = slot.match(/^([BL])(\d+)$/);
    if (m) {
      const zone = m[1] === 'B' ? 'B' : 'L';
      const num = parseInt(m[2]);
      const typ = slotType === 'large' ? '大袋' : '袋';
      return zone + ' 區 ' + num + ' 號' + typ;
    }
    m = slot.match(/^(\d+)([a-z])$/);
    if (m) return parseInt(m[1]) + ' 號抽屜 ' + m[2].toUpperCase() + ' 格';
    m = slot.match(/^(\d+)$/);
    if (m) return parseInt(m[1]) + ' 號抽屜';
    return slot;
  },

  _formatResult(r) {
    if (r.type === 'match') {
      var st = document.getElementById('bs-auto-slot-top');
      var stText = document.getElementById('bs-auto-slot-text');
      if (st && stText) { stText.textContent = '📍 ' + r.item.slot; st.style.display = 'flex'; }
      return [
        '<div style="font-size:22px;font-weight:700;margin-bottom:6px;color:#fff;word-break:break-all;">' + (r.item.nameCN || r.item.name || '') + '</div>',
        r.item.pickupSlot ? '<div style="font-size:18px;font-weight:700;color:#fcd34d;margin-bottom:4px;">⚡ 快取 ' + r.item.pickupSlot + '</div>' : '',
        '<div style="font-size:14px;color:#9ca3af;">ID: ' + r.designId + ' · 信心 ' + Math.round(r.score*100) + '%</div>'
      ].join('');
    }
    if (r.type === 'unknown') {
      return [
        '<div style="font-size:18px;color:#fbbf24;margin-bottom:6px;">🆕 未建檔零件</div>',
        '<div style="font-size:14px;">ID: ' + r.designId + '</div>',
        r.bkName ? '<div style="font-size:13px;color:#9ca3af;">' + r.bkName + '</div>' : ''
      ].join('');
    }
    return '<div style="font-size:18px;color:#9ca3af;">📭 找不到匹配</div>';
  },

  _speak(text) {
    try {
      if (!('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-TW';
      u.rate = 1.1;
      window.speechSynthesis.speak(u);
    } catch(e) {}
  }
};

// ─── 在主畫面加「🎯 自動辨識」按鈕 ───────────────────