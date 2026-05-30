// BrickSort — 資料層
// Firebase 讀寫：loadData, fbSaveItem, saveAllToFirebase 等
// 全域作用域：使用傳統 <script src> 載入，禁止 ES Module

// ═══════════════════════════════════════════════════
// FIREBASE DATA LAYER
// ═══════════════════════════════════════════════════
async function loadData(){
  dataReady=false;
  document.getElementById('loading').style.display='';
  document.getElementById('tbody').innerHTML='';
  document.getElementById('status-text').textContent='載入中…';
  dirty.clear();
  try{
    const snap=await db.collection(FB_COL).get();
    allItems=[];
    snap.docs.forEach(d=>{
      if(d.id===FB_CONFIG_DOC) slotConfig={...slotConfig,...d.data()};
      else allItems.push({id:d.id,...d.data()});
    });
    document.getElementById('status-text').textContent='✅ '+allItems.length+'筆';
    // Clean runtime flags that may have leaked to Firebase
    allItems.forEach(item=>{Object.keys(item).filter(k=>k.startsWith('_')&&k!=='_id').forEach(k=>delete item[k])});
    // Also strip legacy fields (defensive - in case Firebase still has them from old versions)
    allItems.forEach(item=>{LEGACY_FIELDS.forEach(f=>delete item[f])});
    repairSlotConfig();
  }catch(e){document.getElementById('status-text').textContent='❌ '+e.message;allItems=[]}
  document.getElementById('loading').style.display='none';
  dataReady=true;
  renderStats();applySort();renderSyncStatus();renderLockStatus();
}

// Legacy fields that should never be written to Firebase (from old versions)
const LEGACY_FIELDS=['overflowBag','packedVolumeMl','packingFactor','dim_verified','dim_verified_at','fullPartNum','isIrregular','totalVol'];

async function fbSaveItem(item){
  if(db){const clean={};Object.keys(item).forEach(k=>{if(!k.startsWith('_')&&LEGACY_FIELDS.indexOf(k)<0)clean[k]=item[k]});await db.collection(FB_COL).doc(item.id).set(clean,{merge:true})}
}

// Auto-repair slotConfig pointers based on actual allItems data
// Fixes issues where nextSmallSlot / nextBagSlot points to already-used slots
function repairSlotConfig(){
  if(!allItems||!allItems.length)return;
  // Find max used small drawer number
  let maxDrawerNum=0;
  let maxBagNum=0;
  allItems.forEach(item=>{
    const slot=item.slot||'';
    const smallMatch=slot.match(/^(\d+)[ab]?$/);
    if(smallMatch){
      const n=parseInt(smallMatch[1]);
      if(n>maxDrawerNum)maxDrawerNum=n;
    }
    const bagMatch=slot.match(/^B(\d+)$/i);
    if(bagMatch){
      const n=parseInt(bagMatch[1]);
      if(n>maxBagNum)maxBagNum=n;
    }
    // Only count overflow bags if overflowQty > 0 (real overflow, not stale references)
    if((item.overflowQty||0)>0){
      (item.overflowSlot||'').split(',').forEach(s=>{
        const m=(s||'').trim().match(/^B(\d+)$/i);
        if(m){
          const n=parseInt(m[1]);
          if(n>maxBagNum)maxBagNum=n;
        }
      });
    }else if(item.overflowSlot){
      // Clean up stale overflowSlot when qty is 0 (defensive)
      item.overflowSlot='';
      markDirty(item.id);
    }
  });
  // Fix nextSmallSlot
  const curSmall=slotConfig.nextSmallSlot||'001a';
  const curSmallNum=parseInt(curSmall.replace(/[a-z]/g,''));
  if(curSmallNum<=maxDrawerNum){
    const newNext=String(maxDrawerNum+1).padStart(3,'0')+'a';
    console.warn('[repairSlotConfig] nextSmallSlot '+curSmall+' → '+newNext+' (max used: '+maxDrawerNum+')');
    slotConfig.nextSmallSlot=newNext;
    markDirty('__config__');
  }
  // Fix nextBagSlot
  const curBag=slotConfig.nextBagSlot||'B01';
  const curBagNum=parseInt(curBag.replace(/[^\d]/g,''));
  if(curBagNum<=maxBagNum){
    const newNext='B'+String(maxBagNum+1).padStart(2,'0');
    console.warn('[repairSlotConfig] nextBagSlot '+curBag+' → '+newNext+' (max used: B'+maxBagNum+')');
    slotConfig.nextBagSlot=newNext;
    markDirty('__config__');
  }
  // [v20ah] Detect and clear stale pickupSlot (slot claimed but physically occupied by others)
  try{
    let staleCount=0;
    allItems.forEach(item=>{
      const ps=item.pickupSlot||'';
      if(!ps)return;
      const isFullDrawer=/^\d+$/.test(ps);
      const candidates=isFullDrawer?[ps,ps+'a',ps+'b']:[ps];
      const others=allItems.some(o=>o!==item && candidates.indexOf(o.slot||'')>=0);
      if(others){
        console.warn('[repairSlotConfig] stale pickupSlot cleared for '+item.designId+': was '+ps);
        item.pickupSlot='';
        item.pickupType='';
        item.pickupQty=0;
        markDirty(item.id);
        staleCount++;
      }
    });
    if(staleCount>0)console.warn('[repairSlotConfig] cleared '+staleCount+' stale pickupSlot(s)');
  }catch(e){console.error('[repairSlotConfig] stale pickup scan error:',e);}
}
async function fbDeleteItem(id){
  if(db) await db.collection(FB_COL).doc(id).delete();
}

async function saveAllToFirebase(){
  if(dirty.size===0){if(!confirm('沒有修改。要全部'+allItems.length+'筆重新寫入？'))return}
  const needCfg=dirty.has('__config__');dirty.delete('__config__');
  const toSave=dirty.size>0?allItems.filter(i=>dirty.has(i.id)):allItems;
  const total=toSave.length+(needCfg?1:0);
  const st=document.getElementById('status-text');
  st.textContent='上傳中 0/'+total+'…';
  let written=0,errors=0;
  for(let i=0;i<toSave.length;i+=100){
    const chunk=toSave.slice(i,i+100);
    try{const b=db.batch();chunk.forEach(item=>{const clean={};Object.keys(item).forEach(k=>{if(!k.startsWith('_')&&LEGACY_FIELDS.indexOf(k)<0)clean[k]=item[k]});b.set(db.collection(FB_COL).doc(item.id),clean,{merge:true})});await b.commit();written+=chunk.length}
    catch(e){for(const item of chunk){try{const clean={};Object.keys(item).forEach(k=>{if(!k.startsWith('_')&&LEGACY_FIELDS.indexOf(k)<0)clean[k]=item[k]});await db.collection(FB_COL).doc(item.id).set(clean,{merge:true});written++}catch(e2){errors++}}}
    st.textContent='上傳中 '+written+'/'+total+(errors?' ('+errors+'失敗)':'')+'…';
    if(i+100<toSave.length) await new Promise(r=>setTimeout(r,1000));
  }
  if(needCfg){try{await db.collection(FB_COL).doc(FB_CONFIG_DOC).set({nextSmallSlot:slotConfig.nextSmallSlot,nextBagSlot:slotConfig.nextBagSlot,totalSmallDrawers:slotConfig.totalSmallDrawers,bagCapacity:slotConfig.bagCapacity||BAG_ML_DEFAULT,rebrickableFrequentThreshold:(slotConfig.rebrickableFrequentThreshold!=null?slotConfig.rebrickableFrequentThreshold:200),lastUpdatedAt:Date.now()},{merge:true});written++}catch(e){errors++}}
  dirty.clear();
  st.textContent='✅ 已上傳 '+written+'筆'+(errors?' ('+errors+'失敗)':'');
  document.getElementById('sync-badge').style.display='none';
  applyFilter();showToast('Firebase 同步完成：'+written+'筆');
}

function markDirty(id){dirty.add(id);document.getElementById('sync-badge').style.display=''}
function renderSyncStatus(){
  const el=document.getElementById('sync-status');
  const ok=!!db;
  const lockIcon=slotConfig.locked?'<span style="color:var(--green);font-size:11px;margin-right:4px">🔒 已鎖定</span>':'';
  el.innerHTML='<div class="sync-inner"><div class="sync-dot '+(ok?'online':'offline')+'"></div><span style="flex:1;font-family:var(--mono);font-size:11px;color:var(--muted)">'+lockIcon+'Firebase '+(ok?'已連線':'未連線')+' · 本機 '+allItems.length+' 件'+(dirty.size?' · ⚠ 待上傳':'')+' </span>'+(dirty.size?'<button class="btn btn-sm btn-primary" onclick="saveAllToFirebase()">☁ 上傳</button>':'')+'<button class="btn btn-sm" onclick="loadData()">↓ 下載</button></div>';
}

function renderLockStatus(){
  const el=document.getElementById('lock-status');
  if(!el)return;
  if(slotConfig.locked){
    el.innerHTML='<div style="background:var(--green-bg);border:1px solid var(--green);border-radius:8px;padding:12px;margin-bottom:12px"><div style="font-size:14px;font-weight:700;color:var(--green);margin-bottom:6px">🔒 編排已鎖定</div><div style="font-size:12px;color:var(--muted);line-height:1.6">零件已放入實體抽屜。<br>• 新零件會自動分配到下一個空格（'+slotConfig.nextSmallSlot+'）或收納袋（'+slotConfig.nextBagSlot+'）<br>• 不會移動任何已有零件的格子<br>• 重新分配功能已停用</div></div><button class="btn btn-danger" style="width:100%" onclick="toggleLock()">🔓 解除鎖定（允許重新編排）</button>';
  } else {
    el.innerHTML='<div style="background:var(--orange-bg);border:1px solid var(--orange);border-radius:8px;padding:12px;margin-bottom:12px"><div style="font-size:14px;font-weight:700;color:var(--orange);margin-bottom:6px">🔓 編排未鎖定</div><div style="font-size:12px;color:var(--muted);line-height:1.6">完成分配並將零件放入實體抽屜後，請鎖定編排。<br>鎖定後新零件只會往後追加，不會動到已有的格子。</div></div><button class="btn btn-green" style="width:100%" onclick="toggleLock()">🔒 鎖定編排（零件已放入抽屜）</button>';
  }
}

async function toggleLock(){
  if(!slotConfig.locked){
    if(!confirm('確定鎖定？\n\n鎖定後：\n• 新零件追加到 '+slotConfig.nextSmallSlot+' 之後\n• 不能重新分配（避免抽屜大風吹）\n• 可隨時在設定中解鎖'))return;
    slotConfig.locked=true;
    showToast('🔒 編排已鎖定');
  } else {
    if(!confirm('⚠ 解除鎖定？\n\n解除後可以重新分配所有格子。\n如果零件已放入實體抽屜，重新分配後需要重新擺放所有零件！'))return;
    slotConfig.locked=false;
    showToast('🔓 已解除鎖定');
  }
  markDirty('__config__');
  // Write lock state to Firebase immediately
  try{await db.collection(FB_COL).doc(FB_CONFIG_DOC).set({locked:slotConfig.locked,lastUpdatedAt:Date.now()},{merge:true})}catch(e){}
  renderLockStatus();renderSyncStatus();
}

// ═══════════════════════════════════════════════════
// RENDER STATS
// ═══════════════════════════════════════════════════
function renderStats(){
  const s=allItems.length,sm=allItems.filter(i=>(i.slotType||'small')==='small').length;
  const lg=allItems.filter(i=>i.slotType==='large').length,bg=allItems.filter(i=>i.slotType==='bag').length;
  document.getElementById('stats-row').innerHTML=
    '<div class="stat-card" onclick="showTab(\'allparts\')" style="cursor:pointer"><div class="stat-num">'+s+'</div><div class="stat-label">零件總數</div></div>'+
    '<div class="stat-card" onclick="showTab(\'map-small\')" style="cursor:pointer"><div class="stat-num">'+sm+'</div><div class="stat-label">小抽屜</div></div>'+
    '<div class="stat-card" onclick="showTab(\'map-large\')" style="cursor:pointer"><div class="stat-num">'+lg+'</div><div class="stat-label">大抽屜</div></div>'+
    '<div class="stat-card" onclick="showTab(\'map-bag\')" style="cursor:pointer"><div class="stat-num">'+bg+'</div><div class="stat-label">收納袋</div></div>';
}

// ═══════════════════════════════════════════════════
// SLOT POINTER SYSTEM (from editor)
// ═══════════════════════════════════════════════════
function parseSlot(s){const m=(s||'').match(/^(\d+)(a|b)?$/);return m?{drawer:parseInt(m[1]),sub:m[2]||null}:{drawer:1,sub:'a'}}
function slotStr(d,sub){return String(d).padStart(3,'0')+(sub||'')}

function advanceBag(cur){const m=(cur||'').match(/^B(\d+)$/);const n=m?parseInt(m[1]):1;return'B'+String(n+1).padStart(2,'0')}
function ensureCap(n){/* hard cap at BASE_DRAWERS — no expansion */}

function getSlotCap(slot,type){
  if(type==='bag')return slotConfig.bagCapacity||BAG_ML_DEFAULT;
  if(type==='large')return LARGE_ML;
  if(type==='box')return Infinity;
  if(!slot)return SLOT_ML;
  if(/\d+[ab]$/.test(slot))return SLOT_ML;
  if(/^\d+$/.test(slot))return DRAWER_ML;
  return SLOT_ML;
}
function getBagVol(bagSlot){return allItems.reduce((s,i)=>{let v=0;const vol1=i.estimateVolumeMl||0;
  // Primary bag: subtract overflow qty (those items are in other bags)
  if(i.slot===bagSlot&&i.slotType==='bag'){const mainQty=Math.max(0,(i.quantity||1)-(i.overflowQty||0));v+=vol1*mainQty}
  // Overflow bag: calculate per-bag qty
  if(i.overflowSlot){const ovBags=i.overflowSlot.split(',').map(s=>s.trim()).filter(Boolean);const idx=ovBags.indexOf(bagSlot);if(idx>=0){const piecesPerBag=vol1>0?Math.max(1,Math.floor((BAG_ML_DEFAULT)/vol1)):1;const ovQty=i.overflowQty||0;const bagQty=idx<ovBags.length-1?Math.min(piecesPerBag,ovQty):Math.max(0,ovQty-piecesPerBag*(ovBags.length-1));v+=vol1*bagQty}}
  return s+v},0)}

// ═══════════════════════════════════════════════════
// LOCATIONS SYSTEM (v17q+) - unified position tracking
// ═══════════════════════════════════════════════════
// New data model: item.locations = [{slot, type, qty, role}]
// role: 'main' (primary stock) | 'pickup' (小量取用) | 'spill' (額外位置)
// Backward compat: if item.locations missing, derive from slot/overflowSlot/overflowQty

function detectSlotType(slot){
  if(!slot)return 'small';
  if(/^B\d+$/i.test(slot))return 'bag';
  if(/^L\d+$/i.test(slot))return 'large';
  if(/^\d+[ab]?$/.test(slot))return 'small';
  return 'small';
}

// Build locations array from legacy fields (slot/overflowSlot/overflowQty)
function buildLocationsFromLegacy(item){
  if(!item||!item.slot)return [];
  const totalQty=item.quantity||1;
  const overflowQty=item.overflowQty||0;
  const pickupQty=item.pickupQty||0;
  // Main qty = total - pickup - overflow
  const mainQty=Math.max(0,totalQty-overflowQty-pickupQty);
  const locations=[];
  // Pickup position (if any) — show FIRST as it's the convenient one
  if(item.pickupSlot && pickupQty>0){
    locations.push({
      slot:item.pickupSlot,
      type:item.pickupType||detectSlotType(item.pickupSlot),
      qty:pickupQty,
      role:'pickup'
    });
  }
  // Main position
  locations.push({
    slot:item.slot,
    type:item.slotType||detectSlotType(item.slot),
    qty:mainQty,
    role:'main'
  });
  // Overflow positions
  if(item.overflowSlot&&overflowQty>0){
    const ovBags=item.overflowSlot.split(',').map(s=>s.trim()).filter(Boolean);
    const vol1=item.estimateVolumeMl||0;
    const piecesPerBag=vol1>0?Math.max(1,Math.floor(BAG_ML_DEFAULT/vol1)):overflowQty;
    let remaining=overflowQty;
    ovBags.forEach((bag,idx)=>{
      const isLast=idx===ovBags.length-1;
      const q=isLast?remaining:Math.min(piecesPerBag,remaining);
      if(q>0){
        locations.push({
          slot:bag,
          type:detectSlotType(bag),
          qty:q,
          role:'spill'
        });
        remaining-=q;
      }
    });
  }
  return locations;
}

// Get locations array for an item (prefer new locations, fallback to legacy)
function getItemLocations(item){
  if(!item)return [];
  if(Array.isArray(item.locations)&&item.locations.length>0){
    // Return deep-copy so mutations don't corrupt
    return item.locations.map(l=>({slot:l.slot,type:l.type,qty:l.qty||0,role:l.role||'main'}));
  }
  return buildLocationsFromLegacy(item);
}

// Role display helpers
function locRoleIcon(role){return role==='main'?'★':role==='pickup'?'✋':role==='spill'?'➕':'•'}
function locRoleLabel(role){return role==='main'?'主庫存':role==='pickup'?'取用點':role==='spill'?'額外位置':'位置'}
function locTypeLabel(type){return type==='bag'?'收納袋':type==='large'?'大抽屜':'小抽屜'}


// Get the bag super-group for a bag slot (checks what's already inside)
function getBagSuperGroup(bagSlot){
  const items=allItems.filter(i=>i.slot===bagSlot&&i.slotType==='bag');
  for(const i of items){
    const cg=getCatGroup(i.featureTags,i.bricklinkCategory);
    const sg=BAG_SUPER_GROUPS[cg];
    if(sg)return sg; // e.g. '人偶身體部件'
  }
  return null; // no super-group items in this bag
}

function findBagForOverflow(vol,catGroup,characterTag,seriesTag,item){
  const cap=BAG_ML_DEFAULT;const lastBag=slotConfig.nextBagSlot||'B01';const lastNum=parseInt((lastBag.match(/\d+/)||['1'])[0]);
  // Phase 0c: 🆕 分類專用袋優先 (無 char/series 才會觸發)
  if(item){
    const catBagKey=getCategoryBagKey(item);
    if(catBagKey){
      const catBag=findOrAllocateCategoryBag(catBagKey,vol);
      if(catBag)return catBag;
    }
  }
  // Phase 0a: seriesTag routing
// Phase 0a: seriesTag routing
  if(seriesTag){
    const existing=findSeriesBag(seriesTag,vol);
    if(existing)return existing;
    return allocateNewSeriesBag(seriesTag);
  }
  // Phase 0b: character-tag routing
  if(characterTag){
    const char=(slotConfig.characters||{})[characterTag];
    if(char&&char.enabled){
      if(char.bagType==='dedicated'){
        const existing=findCharacterBag(characterTag);
        if(existing&&getBagVol(existing)+vol<=cap)return existing;
        return allocateNewCharacterBag(characterTag,false);
      }
      if(char.bagType==='shared'){
        const existing=findSharedCharacterBag(vol);
        if(existing)return existing;
        return allocateNewCharacterBag(characterTag,true);
      }
    }
  }
  const superGroup=catGroup?BAG_SUPER_GROUPS[catGroup]:null;
  
  
  // Phase 1: find bag with same super-group (for minifig parts)
  if(superGroup){
    for(let n=1;n<=lastNum;n++){const label='B'+String(n).padStart(2,'0');
      if(isBagSeriesTagged(label))continue;
      if(isBagCategoryTagged(label))continue;
      if(getBagSuperGroup(label)===superGroup&&getBagVol(label)+vol<=cap)return label;
    }
  }
  // Phase 2: find bag with same catGroup (skip reserved bags)
  if(catGroup){
    for(let n=1;n<=lastNum;n++){const label='B'+String(n).padStart(2,'0');
      if(isBagSeriesTagged(label))continue;
      if(isBagCategoryTagged(label))continue;
      const bagSG=getBagSuperGroup(label);
      if(bagSG)continue;
      if(isBagCharacterTagged(label))continue;
      const items=allItems.filter(i=>i.slot===label&&i.slotType==='bag');
      const hasSameCat=items.some(i=>getCatGroup(i.featureTags,i.bricklinkCategory)===catGroup);
      if(hasSameCat&&getBagVol(label)+vol<=cap)return label;
    }
  }
  // Phase 3: find any bag with space (skip all reserved bags)
  for(let n=1;n<=lastNum;n++){const label='B'+String(n).padStart(2,'0');
    if(isBagSeriesTagged(label))continue;
    if(isBagCategoryTagged(label))continue;
    if(getBagSuperGroup(label))continue;
    if(isBagCharacterTagged(label))continue;
    if(getBagVol(label)+vol<=cap)return label;
  }
  // Phase 4: allocate new bag
  const newBag=lastBag;slotConfig.nextBagSlot=advanceBag(newBag);markDirty('__config__');return newBag;
}

// ═══════════════════════════════════════════════════
// CLASSIFICATION HELPERS
// ═══════════════════════════════════════════════════

// 分類名稱標準化映射（解決 Gemini 命名飄移）
const CATEGORY_NORMALIZE={
  // 武器
  'minifigure weapon':'Minifigure, Weapon','minifig weapon':'Minifigure, Weapon','minifig, weapon':'Minifigure, Weapon','weapon':'Minifigure, Weapon',
  // 工具
  'minifigure utensil':'Minifigure, Utensil','minifig utensil':'Minifigure, Utensil','minifig, utensil':'Minifigure, Utensil',
  // 頭飾（統一到 Headwear）
  'minifigure headwear':'Minifigure, Headwear','minifig headwear':'Minifigure, Headwear','minifig, headwear':'Minifigure, Headwear',
  'minifigure headgear':'Minifigure, Headwear','minifig headgear':'Minifigure, Headwear','minifig, headgear':'Minifigure, Headwear',
  'headwear accessory':'Minifigure, Headwear Accessory','minifigure headwear accessory':'Minifigure, Headwear Accessory',
  // 頭
  'minifig head':'Minifigure, Head','minifig, head':'Minifigure, Head','minifigure head':'Minifigure, Head',
  // 盾牌
  'minifigure shield':'Minifigure, Shield','minifig shield':'Minifigure, Shield','minifig, shield':'Minifigure, Shield',
  // 頸飾
  'minifigure neckwear':'Minifigure, Neckwear','minifig neckwear':'Minifigure, Neckwear','minifig, neckwear':'Minifigure, Neckwear',
  // 身體
  'minifigure body part':'Minifigure, Body Part','minifig body part':'Minifigure, Body Part','minifig, body part':'Minifigure, Body Part',
  'minifigure body wear':'Minifigure, Body Wear','minifig body wear':'Minifigure, Body Wear','minifig, body wear':'Minifigure, Body Wear',
  // 頭髮
  'minifigure hair':'Minifigure, Hair','minifig hair':'Minifigure, Hair','minifig, hair':'Minifigure, Hair',
  // 腿
  'minifigure leg':'Minifigure, Leg','minifig leg':'Minifigure, Leg','minifig, leg':'Minifigure, Leg',
  // 科技類
  'technic connector':'Technic, Connector','technic gear':'Technic, Gear','technic axle':'Technic, Axle',
  'technic panel':'Technic, Panel','technic pin':'Technic, Pin','technic bush':'Technic, Bush',
  'technic brick':'Technic, Brick','technic brick modified':'Technic, Brick Modified',
  'technic liftarm':'Technic, Liftarm','technic liftarm thin':'Technic, Liftarm Thin',
  'technic beam':'Technic, Beam','technic link':'Technic, Link',
  'technic pin connector':'Technic, Pin Connector','technic plate':'Technic, Plate',
  'technic ball joint':'Technic, Ball Joint','technic gearbox':'Technic, Gearbox',
  'technic steering':'Technic, Steering',
  // 動物
  'animal body part':'Animal, Body Part','animal land':'Animal, Land',
  // 車輛
  'vehicle mudguard':'Vehicle, Mudguard','vehicle':'Vehicle',
  // 楔形
  'wedge plate':'Wedge, Plate','wedge curved':'Wedge, Curved',
  // 圓磚
  'brick round':'Brick, Round',
  // 坡
  'slope inverted':'Slope, Inverted','slope curved':'Slope, Curved','slope wedge':'Slope, Wedge',
  // 板
  'plate modified':'Plate, Modified','plate modified round':'Plate, Modified Round',
  'plate modified hinge':'Plate, Modified Hinge','plate modified wedge':'Plate, Modified Wedge',
  'plate round':'Plate, Round',
  // 磚
  'brick modified':'Brick, Modified','brick arch':'Brick, Arch',
  // 磚片
  'tile modified':'Tile, Modified','tile round':'Tile, Round',
  // 軟管
  'hose flexible':'Hose, Flexible',
  // 輪胎
  'wheel tire':'Wheel, Tire',
};
function normalizeCategory(cat){
  if(!cat)return'';
  const key=cat.trim().toLowerCase().replace(/\s+/g,' ');
  return CATEGORY_NORMALIZE[key]||cat.trim();
}

// Specificity priority: higher number = checked first (more specific wins)
const CAT_PRIORITY={'Wedge Plate':90,'Wedge':85,'Wing':85,'Slope Curved':80,'Slope Inverted':80,'Brick Modified':70,'Brick Round':70,'Plate Modified':70,'Plate Round':70,'Tile Modified':70,'Tile Round':70,'Technic Axle':60,'Technic Pin':60,'Technic Connector':60,'Technic Gear':60,'Technic Liftarm':60,'Technic Link':60,'Technic Panel':60,'Technic Plate':60,'Brick':10,'Plate':10,'Tile':10,'Slope':10,'Technic':10};
function getCatGroup(tags,blCat){
  if(blCat){const norm=normalizeCategory(blCat);const mfGroup=MINIFIG_CAT_MAP[norm.toLowerCase()];if(mfGroup)return mfGroup}
  if(!tags||!tags.length)return'未分類';
  const sorted=[...tags].sort((a,b)=>(CAT_PRIORITY[b]||50)-(CAT_PRIORITY[a]||50));
  for(const t of sorted){if(CATEGORY_GROUPS[t])return CATEGORY_GROUPS[t]}
  return tags[0]||'未分類';
}
function getTier(group){if(TIER1_GROUPS.has(group))return 1;if(TIER2_GROUPS.has(group))return 2;if(TIER3_GROUPS.has(group))return 3;return 3}
function getBaseDesignId(id){if(!id)return'';return id.replace(/(pb|pr|pat)\d+.*$/i,'').trim()}
function getNumericBase(id){if(!id)return'';return id.replace(/(pb|pr|pat)\d+.*$/i,'').replace(/^(\d+)[a-d]$/i,'$1').trim()}

let _variantResolve=null;
function showVariantConfirm(newId,newName,newImg,candidate){
  return new Promise(resolve=>{
    _variantResolve=resolve;
    // DB image: try thumbnailUrl → Rebrickable CDN with base ID → numeric base
    const dbBase=getBaseDesignId(candidate.designId);
    const dbNum=getNumericBase(candidate.designId);
    const dbImg=candidate.thumbnailUrl||
      (dbBase?'https://cdn.rebrickable.com/media/parts/ldraw/7/'+dbBase+'.png':'');
    const dbFallback=dbNum&&dbNum!==dbBase?'https://cdn.rebrickable.com/media/parts/ldraw/7/'+dbNum+'.png':'';
    // New image: camera photo (dataURL) → brickognize → Rebrickable CDN
    const newThumb=newImg||(newId?'https://cdn.rebrickable.com/media/parts/ldraw/7/'+getBaseDesignId(newId)+'.png':'');
    const elNewImg=document.getElementById('vc-new-img');
    const elDbImg=document.getElementById('vc-db-img');
    elNewImg.style.display='';elNewImg.src=newThumb;
    elNewImg.onerror=function(){this.style.display='none'};
    elDbImg.style.display='';elDbImg.src=dbImg;
    elDbImg.onerror=function(){if(dbFallback&&this.src!==dbFallback){this.src=dbFallback}else{this.style.display='none'}};
    document.getElementById('vc-new-id').textContent=newId;
    var _kcb=document.getElementById('vc-keep-full-id');if(_kcb){_kcb.checked=false}var _klbl=document.getElementById('vc-keep-text');if(_klbl){_klbl.textContent='保留完整 ID（'+newId+'）另建新檔'}
    document.getElementById('vc-new-name').textContent=newName;
    document.getElementById('vc-db-id').textContent=candidate.designId;
    document.getElementById('vc-db-name').textContent=candidate.nameCN||candidate.name||'';
    document.getElementById('vc-db-meta').textContent='位置 '+candidate.slot+' · '+(candidate.estimateVolumeMl||0)+'ml · '+candidate.quantity+'件';
    document.getElementById('vc-slot').textContent=candidate.slot;
    document.getElementById('variant-overlay').classList.add('open');
  });
}
function resolveVariant(yes){
  document.getElementById('variant-overlay').classList.remove('open');
  if(_variantResolve){window._bsKeepFullId=(!yes&&!!(document.getElementById("vc-keep-full-id")||{}).checked);_variantResolve(yes);_variantResolve=null}
}

function isMinifigure(item){
  // Only TRUE for complete assembled minifigures (head+torso+legs), NOT body-only parts
  if(item.is_complete_minifig) return true;
  const cat=(item.bricklinkCategory||'').trim();
  // Exact "Minifigure" with no sub-category = complete minifig
  if(cat==='Minifigure') return true;
  // Minifig ID format: 2-4 letters + 3-4 digits (njo788, sw0001, sh001, cty1234)
  const did=(item.designId||'');
  if(/^[a-z]{2,4}\d{3,5}$/i.test(did)) return true;
  return false;
}