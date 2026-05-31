// BrickSort — AI 辨識
// Gemini API, 相機辨識, 裁切預覽, 建檔流程
// 全域作用域：使用傳統 <script src> 載入，禁止 ES Module

async function callGeminiAPI(prompt,base64Image=null,_retryIdx=0,systemInstruction=null,_429attempt=0){
  if(!cfg.apiKey)throw new Error('請先設定 Gemini API Key');
  let model=(_retryIdx===0&&_lastWorkingModel)?_lastWorkingModel:(GEMINI_MODELS[_retryIdx]||GEMINI_MODELS[0]);
  const parts=[{text:prompt}];if(base64Image)parts.push({inlineData:{mimeType:'image/jpeg',data:base64Image}});
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),30000);
  try{
    const resp=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent?key='+cfg.apiKey,{
      method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
      body:JSON.stringify({contents:[{parts}],generationConfig:{responseMimeType:"application/json",temperature:0},...(systemInstruction?{system_instruction:{parts:[{text:systemInstruction}]}}:{})})
    });
    clearTimeout(timeout);
    // 503 → try next model
    if(resp.status===503){_lastWorkingModel=null;const curIdx=GEMINI_MODELS.indexOf(model),nextIdx=curIdx>=0?curIdx+1:_retryIdx+1;if(nextIdx<GEMINI_MODELS.length){setProcessingMsg(model+' 過載，切換…');return callGeminiAPI(prompt,base64Image,nextIdx,systemInstruction)}}
    // 429 → smart retry with retryDelay parsing
    if(resp.status===429){
      if(_429attempt<2){let waitMs=Math.min(8000,2000*Math.pow(2,_429attempt));
        try{const ed=await resp.json();const ri=ed?.error?.details?.find(d=>d['@type']?.includes('RetryInfo'));if(ri?.retryDelay){const m=ri.retryDelay.match(/(\d+(?:\.\d+)?)s/);if(m&&parseFloat(m[1])<10)waitMs=Math.ceil(parseFloat(m[1])*1000)+200;}}catch(e){}
        setProcessingMsg('⏳ 配額限制，'+Math.ceil(waitMs/1000)+'秒後重試…');await new Promise(r=>setTimeout(r,waitMs));return callGeminiAPI(prompt,base64Image,_retryIdx,systemInstruction,_429attempt+1)}
      throw new Error('⏳ Gemini 配額用完，請稍後再試或明天 16:00 重置');
    }
    // 404 → try next model
    if(resp.status===404){_lastWorkingModel=null;const curIdx=GEMINI_MODELS.indexOf(model),nextIdx=curIdx>=0?curIdx+1:_retryIdx+1;if(nextIdx<GEMINI_MODELS.length){setProcessingMsg(model+' 不可用，切換…');return callGeminiAPI(prompt,base64Image,nextIdx,systemInstruction)}throw new Error('所有模型都不可用')}
    // 400 BAD KEY
    if(resp.status===400){try{const ed=await resp.json();if(ed?.error?.message?.includes('API key'))throw new Error('API Key 無效，請重新設定')}catch(e){if(e.message.includes('API Key'))throw e}}
    if(!resp.ok){const e=await resp.json().catch(()=>({}));throw new Error('Gemini '+resp.status+': '+(e?.error?.message||''))}
    _lastWorkingModel=model;const data=await resp.json();return data.candidates[0].content.parts[0].text;
  }catch(e){clearTimeout(timeout);if(e.name==='AbortError')throw new Error('Gemini API 逾時（30秒），請重試');throw e}
}


// 清洗 Base64 標頭，符合 Gemini inlineData 規範
function cleanBase64ForGemini(d){if(!d)return null;const p=d.split(',');return p.length===2?p[1]:d;}

// 粗篩：從全庫篩出「有本地實拍圖 + 屬性相近」的 Top-N 候選
function coarseFilterWithImage(target,maxN){
  maxN=maxN||5;
  const tCat=(target.bricklinkCategory||'').toLowerCase();
  const tTags=new Set((target.featureTags||[]).map(t=>t.toLowerCase()));
  const tVol=target.estimateVolumeMl||0;
  const tMini=tCat.includes('minifig');
  return allItems.filter(i=>i.id!==target.id && i.imageData && i.imageData.startsWith('data:') && i.imageData.length>500)
    .map(i=>{
      let s=0; const iCat=(i.bricklinkCategory||'').toLowerCase();
      if(iCat===tCat&&tCat)s+=50; else if(tMini&&iCat.includes('minifig'))s+=20;
      (i.featureTags||[]).forEach(t=>{if(tTags.has(t.toLowerCase()))s+=15;});
      const iVol=i.estimateVolumeMl||0;
      if(tVol>0&&iVol>0)s+=Math.min(tVol,iVol)/Math.max(tVol,iVol)*20;
      return {item:i,score:s};
    }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,maxN).map(x=>x.item);
}

// 多圖選美 Gemini 呼叫（複用 GEMINI_MODELS + 模型切換 + 逾時）
async function callGeminiParts(parts,systemInstruction,_retryIdx=0){
  const apiKey=(cfg.apiKey||'').trim();
  if(!apiKey)throw new Error('未設定 Gemini API Key');
  const model=GEMINI_MODELS[_retryIdx]||GEMINI_MODELS[0];
  const url='https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent?key='+apiKey;
  const body={contents:[{role:'user',parts}],generationConfig:{temperature:0.1,responseMimeType:'application/json'},...(systemInstruction?{system_instruction:{parts:[{text:systemInstruction}]}}:{})};
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),30000);
  try{
    const resp=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
    clearTimeout(timeout);
    if((resp.status===503||resp.status===404)&&_retryIdx+1<GEMINI_MODELS.length)return callGeminiParts(parts,systemInstruction,_retryIdx+1);
    if(!resp.ok)throw new Error('Gemini '+resp.status);
    const data=await resp.json();
    return data.candidates[0].content.parts[0].text;
  }catch(e){clearTimeout(timeout);if(e.name==='AbortError')throw new Error('多圖辨識逾時');throw e;}
}

async function rebrickableLookup(inputId){
  const key=cfg.rbKey||DEFAULT_RB_KEY;if(!key)return null;
  try{const isElem=/^\d{6,}$/.test(inputId);
    if(isElem){const resp=await fetch('https://rebrickable.com/api/v3/lego/elements/'+inputId+'/?key='+key);if(!resp.ok)return null;const d=await resp.json();return{designId:d.design_id||d.part?.part_num||'',name:d.part?.name||'',imgUrl:d.part?.part_img_url||''}}
    else{const resp=await fetch('https://rebrickable.com/api/v3/lego/parts/'+inputId+'/?key='+key);if(!resp.ok)return null;const d=await resp.json();return{designId:d.part_num||inputId,name:d.name||'',imgUrl:d.part_img_url||''}}
  }catch(e){return null}
}

// ═══════════════════════════════════════════════════
// REBRICKABLE POPULARITY (per-item fetch + threshold check)
// ═══════════════════════════════════════════════════
// Fetches a single item's num_sets from Rebrickable /colors/ endpoint.
// Returns the total num_sets across all colors, or null on failure.
async function fetchSingleItemPopularity(designId){
  if(!designId)return null;
  const key=cfg.rbKey||DEFAULT_RB_KEY;
  if(!key)return null;
  try{
    const resp=await fetch('https://rebrickable.com/api/v3/lego/parts/'+encodeURIComponent(designId)+'/colors/?key='+key);
    if(!resp.ok){
      // Retry with base design id (strip variant suffix)
      const base=designId.replace(/pr?\d+$/i,'').replace(/[a-z]+$/i,'');
      if(base&&base!==designId){
        const r2=await fetch('https://rebrickable.com/api/v3/lego/parts/'+encodeURIComponent(base)+'/colors/?key='+key);
        if(r2.ok){const d=await r2.json();return (d.results||[]).reduce((s,c)=>s+(c.num_sets||0),0)}
      }
      return null;
    }
    const d=await resp.json();
    return (d.results||[]).reduce((s,c)=>s+(c.num_sets||0),0);
  }catch(e){return null}
}

// Check if item should be flagged frequent + optionally fetch popularity
// Returns: { isFrequent, rebrickableSets, threshold } — never throws.
async function checkFrequentAndSuggest(item){
  const threshold=(slotConfig.rebrickableFrequentThreshold!=null)?slotConfig.rebrickableFrequentThreshold:200;
  // Skip if already has popularity data
  if(typeof item.rebrickableSets==='number'){
    return {
      isFrequent: threshold>0 && item.rebrickableSets>=threshold,
      rebrickableSets: item.rebrickableSets,
      threshold: threshold
    };
  }
  const sets=await fetchSingleItemPopularity(item.designId);
  if(sets===null)return {isFrequent:false,rebrickableSets:null,threshold};
  item.rebrickableSets=sets;
  const freq=threshold>0 && sets>=threshold;
  item.isFrequent=freq;
  return {isFrequent:freq, rebrickableSets:sets, threshold};
}

// Helper: determine if an item is frequent (with manual override support)
function isItemFrequent(item){
  if(!item)return false;
  if(item.manualFrequent===true)return true;
  if(item.manualFrequent===false)return false;
  return item.isFrequent===true;
}

// Toggle manualFrequent state on current item (3-state cycle)
// Cycle: if currently frequent → set manualFrequent=false (excluded)
//        if currently excluded (manualFrequent===false) → clear (manualFrequent=null, back to auto)
//        if currently not frequent (auto=false, manualFrequent=null) → set manualFrequent=true
async function toggleItemFrequent(){
  if(!currentItem)return;
  const i=currentItem;
  const isFreq=isItemFrequent(i);
  const manual=i.manualFrequent;
  let newManual;
  let msg;
  if(isFreq){
    // Currently frequent → exclude it manually
    newManual=false;
    msg='☆ 已手動排除常用標記';
  }else if(manual===false){
    // Manually excluded → clear override (back to auto)
    newManual=null;
    msg=i.isFrequent?'⭐ 已恢復自動常用':'☆ 已恢復自動 (非常用)';
  }else{
    // Not frequent → add manual ⭐
    newManual=true;
    msg='⭐ 已手動標記為常用';
  }
  i.manualFrequent=newManual;
  i.updatedAt=Date.now();
  markDirty(i.id);
  // Persist immediately (use set with null if clearing)
  try{
    const update={updatedAt:i.updatedAt};
    if(newManual===null){
      // Firebase doesn't accept undefined; write null explicitly to clear
      update.manualFrequent=null;
    }else{
      update.manualFrequent=newManual;
    }
    await db.collection(FB_COL).doc(i.id).update(update);
  }catch(e){console.warn('toggle failed:',e)}
  // Re-render badge
  populateModal(i);
  showToast(msg);
}



// ═══ CORS-free thumbnail finder (uses img.onload, works in APK WebView) ═══
function testImageUrl(url,timeout){
  return new Promise(resolve=>{
    const img=new Image();
    const t=setTimeout(()=>{img.src='';resolve(false)},timeout||3000);
    img.onload=()=>{clearTimeout(t);resolve(img.naturalWidth>1)};
    img.onerror=()=>{clearTimeout(t);resolve(false)};
    img.src=url;
  });
}

// ═══ MOLD VARIANT LOOKUP (Rebrickable) ═══
const _moldCache={};
async function getMoldVariants(designId){
  if(!designId)return[];
  if(_moldCache[designId])return _moldCache[designId];
  const key=cfg.rbKey||DEFAULT_RB_KEY;if(!key)return[];
  try{
    let resp=await fetch('https://rebrickable.com/api/v3/lego/parts/'+encodeURIComponent(designId)+'/?key='+key);
    if(resp.status===429){await new Promise(r=>setTimeout(r,1500));resp=await fetch('https://rebrickable.com/api/v3/lego/parts/'+encodeURIComponent(designId)+'/?key='+key)}
    // 404 → use search API to find variants (30367 → finds 30367a/b/c)
    if(resp.status===404&&/^\d+$/.test(designId)){
      try{
        const searchResp=await fetch('https://rebrickable.com/api/v3/lego/parts/?search='+encodeURIComponent(designId)+'&key='+key+'&page_size=20');
        if(searchResp.ok){
          const searchData=await searchResp.json();
          const candidates=(searchData.results||[]).filter(r=>{
            const pn=r.part_num||'';
            // Must start with the exact ID (30367a, 30367b, not 303670)
            return pn.startsWith(designId)&&/^[a-d]/.test(pn.slice(designId.length));
          });
          if(candidates.length){
            // Pick the base variant (no print suffix) with most external IDs, or first
            const base=candidates.find(c=>!/pr\d|pat\d|ps\d/.test(c.part_num))||candidates[0];
            // Re-fetch this specific part for full data
            const r2=await fetch('https://rebrickable.com/api/v3/lego/parts/'+encodeURIComponent(base.part_num)+'/?key='+key);
            if(r2.ok)resp=r2;
          }
        }
      }catch(e){}
    }
    if(!resp.ok){_moldCache[designId]=[];return[]}
    const data=await resp.json();
    const variants=new Set();
    (data.molds||[]).forEach(v=>variants.add(v));
    const legoIds=data.external_ids?.LEGO||[];
    legoIds.forEach(v=>variants.add(String(v)));
    const blIds=data.external_ids?.BrickLink||[];
    blIds.forEach(v=>variants.add(String(v)));
    const bsIds=data.external_ids?.Brickset||[];
    bsIds.forEach(v=>variants.add(String(v)));
    // Add the found part_num itself as variant (30367b for query 30367)
    if(data.part_num&&data.part_num!==designId)variants.add(data.part_num);
    variants.delete(designId);
    const result=[...variants];
    _moldCache[designId]=result;
    result.forEach(v=>{if(!_moldCache[v])_moldCache[v]=[designId,...result.filter(u=>u!==v)]});
    return result;
  }catch(e){_moldCache[designId]=[];return[]}
}

// Find a DB match by checking mold variants of a given designId
async function findByMoldVariant(designId){
  if(!designId)return null;
  // ═══ Step 1: Check local altIds (no API needed) ═══
  const localMatch=findByLocalAltIds(designId);
  if(localMatch){localMatch._altIdMatch=true;return localMatch}
  // ═══ Step 2: API fallback — query Rebrickable ═══
  let variants=await getMoldVariants(designId);
  if(!variants.length){
    const base=getBaseDesignId(designId);
    if(base&&base!==designId)variants=await getMoldVariants(base);
  }
  if(!variants.length){
    const num=getNumericBase(designId);
    if(num&&num!==designId)variants=await getMoldVariants(num);
  }
  if(!variants.length)return null;
  for(const v of variants){
    const match=allItems.find(i=>{
      const iId=(i.designId||'').toLowerCase();
      return iId===v.toLowerCase()||getBaseDesignId(i.designId)===getBaseDesignId(v);
    });
    if(match){
      // ═══ Save altIds to DB for future local lookups ═══
      saveAltIds(match,variants.concat([designId,getBaseDesignId(designId),getNumericBase(designId)].filter(Boolean)));
      return match;
    }
  }
  return null;
}

// ═══ LOCAL ALT-ID MATCHING (offline, instant) ═══
function findByLocalAltIds(queryId){
  if(!queryId)return null;
  const q=queryId.toLowerCase();
  const qBase=(getBaseDesignId(queryId)||'').toLowerCase();
  const qNum=(getNumericBase(queryId)||'').toLowerCase();
  for(const item of allItems){
    const alts=item.altIds;
    if(!alts||!alts.length)continue;
    for(const a of alts){
      const al=a.toLowerCase();
      if(al===q||al===qBase||al===qNum)return item;
    }
  }
  return null;
}

// Save alternative IDs to an item (dedup, persist)
function saveAltIds(item,newIds){
  if(!item||!newIds||!newIds.length)return;
  const existing=new Set((item.altIds||[]).map(s=>s.toLowerCase()));
  const self=(item.designId||'').toLowerCase();
  let changed=false;
  newIds.forEach(id=>{
    if(!id)return;
    const low=id.toLowerCase();
    if(low===self)return; // don't store self
    if(!existing.has(low)){existing.add(low);changed=true}
  });
  if(changed){
    item.altIds=[...existing];
    markDirty(item.id);
    fbSaveItem(item).catch(()=>{});
  }
}

async function brickognizePredict(base64Image){
  try{const byteStr=atob(base64Image),ab=new ArrayBuffer(byteStr.length),ia=new Uint8Array(ab);for(let i=0;i<byteStr.length;i++)ia[i]=byteStr.charCodeAt(i);
    const blob=new Blob([ab],{type:'image/jpeg'}),fd=new FormData();fd.append('query_image',blob,'photo.jpg');
    const resp=await fetch('https://api.brickognize.com/predict/',{method:'POST',headers:{accept:'application/json'},body:fd});
    if(!resp.ok)return null;const data=await resp.json();
    if(data.items&&data.items.length>0){const top=data.items[0];return{id:top.id||'',name:top.name||'',type:top.type||'part',score:Math.round((top.score||0)*100),imgUrl:top.img_url||''}}
    return null}catch(e){return null}
}

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════
function safeParseJSON(text){text=text.replace(/^```json\s*/i,'').replace(/```\s*$/,'').trim();try{return JSON.parse(text)}catch(e){}const m=text.match(/\{[\s\S]*\}/);if(!m)throw new Error('No JSON found');try{return JSON.parse(m[0])}catch(e){}throw new Error('JSON parse failed')}
async function buildExistingList(){if(!allItems.length)return'';const grouped={};allItems.forEach(i=>{const s=i.slot||'?';if(!grouped[s])grouped[s]=[];if(grouped[s].length<3)grouped[s].push('['+i.id+'] '+(i.designId||'')+' '+(i.nameCN||i.name))});let list='';for(const[slot,arr]of Object.entries(grouped))list+=slot+':'+arr.join(';')+'\n';return list}
async function resizeImage(dataUrl,maxDim){return new Promise(resolve=>{const img=new Image();img.onload=()=>{const scale=Math.min(1,maxDim/Math.max(img.width,img.height));const w=Math.round(img.width*scale),h=Math.round(img.height*scale);const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);resolve(c.toDataURL('image/jpeg',0.85))};img.src=dataUrl})}
async function cropLensThumb(dataUrl){return new Promise(resolve=>{const img=new Image();img.onload=()=>{const W=img.width,H=img.height;
  const cx=Math.floor(W*0.1),cy=Math.floor(H*0.08),cw=Math.floor(W*0.8),ch=Math.floor(H*0.30);
  const c=document.createElement('canvas');const maxDim=160;const scale=Math.min(1,maxDim/Math.max(cw,ch));c.width=Math.round(cw*scale);c.height=Math.round(ch*scale);c.getContext('2d').drawImage(img,cx,cy,cw,ch,0,0,c.width,c.height);resolve(c.toDataURL('image/jpeg',0.6))};img.src=dataUrl})}
// Crop Lens text area (lower 55% of screenshot, below tabs and thumbnail)
async function cropLensText(dataUrl){return new Promise(resolve=>{const img=new Image();img.onload=()=>{const W=img.width,H=img.height;
  const cy=Math.floor(H*0.45),ch=Math.floor(H*0.50);
  const c=document.createElement('canvas');c.width=W;c.height=ch;c.getContext('2d').drawImage(img,0,cy,W,ch,0,0,W,ch);resolve(c.toDataURL('image/jpeg',0.85))};img.src=dataUrl})}
function calcVolFromAI(name,parsed){const mw=parseFloat(parsed.dim_mm_w),ml=parseFloat(parsed.dim_mm_l),mh=parseFloat(parsed.dim_mm_h);if(mw>0&&ml>0&&mh>0){parsed._dimW=Math.round(mw)/10;parsed._dimL=Math.round(ml)/10;parsed._dimH=Math.round(mh)/10;return Math.max(0.3,Math.round(mw*ml*mh/1000*10)/10)}return parseInt(parsed.estimate_volume_ml)||2}

function renderMiniMap(slot){
  const el=document.getElementById('result-minimap');if(!el)return;
  if(!slot){el.innerHTML='';return}
  const s=slot.replace(/^0+/,'');
  // Parse slot type
  const mSmall=s.match(/^(\d+)([ab])?$/);
  const mLarge=s.match(/^L0*(\d+)$/i);
  const mBag=s.match(/^B/i);
  if(mBag){el.innerHTML='<div style="text-align:center;font-size:12px;color:var(--muted);padding:8px">📦 收納袋區</div>';return}
  // Grid layout constants
  const COLS=18,TOP_ROWS=5,LARGE_ROWS=2,MAIN_ROWS=20;
  const TOTAL_ROWS=TOP_ROWS+LARGE_ROWS+MAIN_ROWS;
  const CW=5,CH=4,GAP=1; // cell width, height, gap
  const W=COLS*(CW+GAP)+40,H=TOTAL_ROWS*(CH+GAP)+16;
  // Reverse snake: drawer num → (row, col)
  function drawerToRC(d,cols){const idx=d-1;const row=Math.floor(idx/cols);const colInRow=idx%cols;const col=row%2===0?colInRow:(cols-1-colInRow);return{row,col}}
  let targetRow=-1,targetCol=-1,targetZone='';
  if(mSmall){
    const d=parseInt(mSmall[1]);
    if(d>=1&&d<=90){const rc=drawerToRC(d,COLS);targetRow=rc.row;targetCol=rc.col;targetZone='top'}
    else if(d>=91&&d<=450){const rc=drawerToRC(d-90,COLS);targetRow=TOP_ROWS+LARGE_ROWS+rc.row;targetCol=rc.col;targetZone='main'}
  }
  if(mLarge){
    const d=parseInt(mLarge[1]);const rc=drawerToRC(d,9);
    targetRow=TOP_ROWS+rc.row;targetCol=rc.col*2;targetZone='large'}
  // Build SVG
  let svg='<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg" style="display:block;margin:0 auto">';
  // Background
  svg+='<rect width="'+W+'" height="'+H+'" rx="8" fill="#1a1a1a"/>';
  // Zone labels
  svg+='<text x="2" y="'+(TOP_ROWS*(CH+GAP)/2+4)+'" font-size="5" fill="#666" font-family="monospace">頂</text>';
  svg+='<text x="2" y="'+(TOP_ROWS*(CH+GAP)+LARGE_ROWS*(CH+GAP)/2+4)+'" font-size="5" fill="#666" font-family="monospace">大</text>';
  svg+='<text x="2" y="'+((TOP_ROWS+LARGE_ROWS)*(CH+GAP)+MAIN_ROWS*(CH+GAP)/2+4)+'" font-size="5" fill="#666" font-family="monospace">主</text>';
  const OX=14; // left offset for labels
  // Draw top zone (1-90)
  for(let r=0;r<TOP_ROWS;r++)for(let c=0;c<COLS;c++){
    const x=OX+c*(CW+GAP),y=r*(CH+GAP);
    const isTarget=targetZone==='top'&&r===targetRow&&c===targetCol;
    svg+='<rect x="'+x+'" y="'+y+'" width="'+CW+'" height="'+CH+'" rx="1" fill="'+(isTarget?'#F5A623':'#333')+'"/>';
    if(isTarget)svg+='<rect x="'+(x-1)+'" y="'+(y-1)+'" width="'+(CW+2)+'" height="'+(CH+2)+'" rx="2" fill="none" stroke="#F5A623" stroke-width="1.5"/>';
  }
  // Draw large zone (9 cols, wider cells)
  const LCW=CW*2+GAP,LY0=TOP_ROWS*(CH+GAP);
  for(let r=0;r<3;r++)for(let c=0;c<9;c++){
    const x=OX+c*(LCW+GAP),y=LY0+r*(CH+GAP);
    const isTarget=targetZone==='large'&&r===(targetRow-TOP_ROWS)&&c===Math.floor(targetCol/2);
    svg+='<rect x="'+x+'" y="'+y+'" width="'+LCW+'" height="'+CH+'" rx="1" fill="'+(isTarget?'#F5A623':'#2a2a2a')+'"/>';
    if(isTarget)svg+='<rect x="'+(x-1)+'" y="'+(y-1)+'" width="'+(LCW+2)+'" height="'+(CH+2)+'" rx="2" fill="none" stroke="#F5A623" stroke-width="1.5"/>';
  }
  // Draw main zone (91-450)
  const MY0=(TOP_ROWS+LARGE_ROWS)*(CH+GAP);
  for(let r=0;r<MAIN_ROWS;r++)for(let c=0;c<COLS;c++){
    const x=OX+c*(CW+GAP),y=MY0+r*(CH+GAP);
    const isTarget=targetZone==='main'&&(TOP_ROWS+LARGE_ROWS+r)===targetRow&&c===targetCol;
    svg+='<rect x="'+x+'" y="'+y+'" width="'+CW+'" height="'+CH+'" rx="1" fill="'+(isTarget?'#F5A623':'#333')+'"/>';
    if(isTarget)svg+='<rect x="'+(x-1)+'" y="'+(y-1)+'" width="'+(CW+2)+'" height="'+(CH+2)+'" rx="2" fill="none" stroke="#F5A623" stroke-width="1.5"/>';
  }
  // Arrow pointing to target
  if(targetRow>=0){
    const ty=targetZone==='large'?LY0+(targetRow-TOP_ROWS)*(CH+GAP)+CH/2:
             targetZone==='top'?targetRow*(CH+GAP)+CH/2:
             MY0+(targetRow-TOP_ROWS-LARGE_ROWS)*(CH+GAP)+CH/2;
    const tx=targetZone==='large'?OX+Math.floor(targetCol/2)*(LCW+GAP)+LCW+4:OX+targetCol*(CW+GAP)+CW+4;
    svg+='<text x="'+Math.min(tx,W-20)+'" y="'+(ty+2)+'" font-size="5" fill="#F5A623" font-family="monospace" font-weight="bold">← '+s+'</text>';
  }
  svg+='</svg>';
  el.innerHTML='<div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px;text-align:center"><div style="font-size:10px;color:var(--muted);margin-bottom:6px">📍 抽屜位置（蛇形排列·頂→大→主區）</div>'+svg+'</div>';
}

// ═══════════════════════════════════════════════════
// LENS / CAMERA / PART ID
// ═══════════════════════════════════════════════════

async function parseLensScreenshot(dataUrl){
  showScreen('s-processing');setProcessingMsg('解析 Lens 截圖…');
  try{
    // Step 1: Crop two regions
    currentImageData=await cropLensThumb(dataUrl);
    const thumbBase64=currentImageData.split(',')[1];
    const textCropDataUrl=await cropLensText(dataUrl);
    const textBase64=textCropDataUrl.split(',')[1];

    // Step 2: OCR — Gemini reads the text area
    setProcessingMsg('📖 讀取 Lens 文字…');
    const ocrPrompt='讀取截圖中 Google Lens 的 AI 摘要文字。提取零件編號（Design ID，通常是4~6位數字）和零件名稱（中英文）。如果文字中有尺寸資訊也一併提取。回應純JSON：{"design_id":"完整零件編號(截圖上顯示什麼就輸出什麼，保留pb/pr/pat印刷後綴)","name":"英文名","name_cn":"中文名","series_tag":"\u7CFB\u5217\u540D\u7A31(\u5982Minecraft/Ninjago/Star Wars\u7B49\uFF0C\u6C92\u6709\u5247\u7559\u7A7A)","character_tag":"\u89D2\u8272\u540D\u7A31(\u5982Alex/Steve/Cole\u7B49\uFF0C\u6C92\u6709\u5247\u7559\u7A7A)","lens_summary":"完整文字摘要(150字以內)"}';
    const ocrResp=await callGeminiAPI(ocrPrompt,textBase64,0);
    const ocr=safeParseJSON(ocrResp);
    ocr.design_id='';
    const lensId='';
    const lensName=ocr.name||'';
    const lensNameCN=ocr.name_cn||'';
    const lensSummary=ocr.lens_summary||'';

    // Step 3: Classify — Gemini sees the clean thumbnail + Lens text + existing list
    setProcessingMsg('🤖 AI 分類中…');
    const existingList=await buildExistingList();
    const classifyPrompt='分析這個零件圖片，結合 Google Lens 辨識結果進行分類。\n\n【Lens 辨識結果】\nDesign ID: '+lensId+'\n名稱: '+lensName+' ('+lensNameCN+')\n摘要: '+lensSummary+'\n\n【重要】design_id 和 name/name_cn 請直接使用上方 Lens 辨識結果，不要自己猜。你只需要判斷：bricklink_category、feature_tags、尺寸dim、is_oversize、is_complete_minifig、matched_existing_id、series_tag、character_tag。\n\n【series_tag 判斷規則】從印花、顏色、設計特徵判斷所屬系列，若非明顯系列則回 null。可選值: "Ninjago"|"DreamZzz"|"Jurassic"|"Super Heroes"|"DC"|"Harry Potter"|"Star Wars"|"Monkie Kid"|"Disney"|null\n\n【character_tag 判斷規則】若能明顯辨識出特定角色才回傳，否則 null。範例: "Lloyd"|"Kai"|"Zane"|"Jay"|"Cole"|"Nya"|"Wu"|"Arin"|"Sora"|"Mateo"|"Zoey"|null。通用零件(武士刀/弓箭/普通頭髮)永遠回 null。\n\n回應純JSON：{"design_id":"'+lensId+'","name":"'+(lensName||'').replace(/"/g,'\\"')+'","name_cn":"'+(lensNameCN||'').replace(/"/g,'\\"')+'","bricklink_category":"BrickLink分類","description":"30字描述","feature_tags":["1~3個,限選:'+LEGO_TAGS+'"],"dim_mm_w":寬mm數,"dim_mm_l":長mm數,"dim_mm_h":高mm數,"is_oversize":bool,"is_complete_minifig":bool,"series_tag":"系列或null","character_tag":"角色或null","matched_existing_id":"同外型零件id或null。已有:'+existingList+'"}';
    const classifyResp=await callGeminiAPI(classifyPrompt,thumbBase64,0,GEMINI_LEGO_SYSTEM);
    const item=safeParseJSON(classifyResp);
    item.design_id='';item.matched_existing_id='';

    // Lens-derived fields always take priority
    if(lensId)item.design_id=lensId;
    if(lensName)item.name=lensName;
    if(lensNameCN)item.name_cn=lensNameCN;
    if(lensSummary)item.lens_summary=lensSummary;

    // Step 3.5: Construct thumbnail URL (skip API for invalid IDs)
    if(lensId&&/^\d{3,6}[a-d]?$/i.test(lensId)){
      try{
        const rb=await rebrickableLookup(lensId);
        if(rb&&rb.imgUrl)window._pendingRbImgUrl=rb.imgUrl;
      }catch(e){}
      if(!window._pendingRbImgUrl){
        const base=lensId.replace(/[a-e]\d*$/i,'');
        window._pendingRbImgUrl='https://img.bricklink.com/ItemImage/PN/86/'+base+'.png';
      }
    }

    if(window._bsKeepFullId){item._keepFullId=true;item._skipMoldCheck=true;window._bsKeepFullId=false}
    if(!(await _v20beChoiceThenProcess(item))){return;} await processResult(item);
  }catch(err){showTab('main');showToast('解析失敗：'+err.message,'error')}
}
// ═══════════════════════════════════════════════════
// UNIFIED PHOTO HANDLER (auto-detect: part / instruction / set)
// ═══════════════════════════════════════════════════
// ═══ GALLERY ROUTING ═══
let _galleryMode='lens';
function openGallery(mode){
  _galleryMode=mode;
  window._galleryMode=mode;
  document.getElementById('gallery-pick').click();
}
function handleGalleryPick(event){
  if(_galleryMode==='instruction')handleInstructionGallery(event);
  else handleLensGallery(event);
}

// ═══ CAMERA: only find location (Brickognize → Gemini fallback) ═══
async function handleCameraPhoto(event){
  const file=event.target.files[0];if(!file)return;event.target.value='';
  const reader=new FileReader();reader.onload=async e=>{
    const resized=await resizeImage(e.target.result,800);currentImageData=resized;
    showScreen('s-processing');
    try{await cameraRecognize(resized.split(',')[1],resized)}
    catch(err){showTab('main');showToast('辨識失敗：'+err.message,'error')}
  };reader.readAsDataURL(file);
}

async function cameraRecognize(base64,imgSrc){
  // APK instruction mode: redirect to instruction flow
  if(window._pendingInstructionMode){
    window._pendingInstructionMode=false;
    const resized=await resizeImage(imgSrc||('data:image/jpeg;base64,'+base64),1200);
    showInstructionCrop(resized);
    return;
  }
  // [強制自訂建檔快速通道] 使用者按「都不是」→ 跳過 BK + Gemini partPrompt 兩次重複請求，直接進非原廠建檔
  const _forceCustom=window._forceCustomBuild===true;
  let partInfo={name:'',name_cn:'',design_id:''};
  if(!_forceCustom){
  // Brickognize fast path
  setProcessingMsg('🔍 Brickognize 辨識中…');
  const bkResult=await brickognizePredict(base64);
  if(bkResult&&bkResult.score>=40){
    let match=null;let matchType='';
    const bkId=bkResult.id||'';const bkName=(bkResult.name||'').toLowerCase();const baseId=getBaseDesignId(bkId);const numBase=getNumericBase(bkId);
    if(bkId){match=allItems.find(i=>(i.designId||'').toLowerCase()===bkId.toLowerCase());if(match)matchType='exact'}
    if(!match&&baseId){match=allItems.find(i=>getBaseDesignId(i.designId)===baseId&&i.designId!==baseId);if(match)matchType='print-variant'}
    if(!match&&numBase){
      const candidate=allItems.find(i=>{const iBase=getNumericBase(i.designId);return iBase===numBase&&(i.designId||'').toLowerCase()!==bkId.toLowerCase()});
      if(candidate){const newImg=currentImageData||bkResult.imgUrl||'';const yes=await showVariantConfirm(bkId,bkResult.name,newImg,candidate);if(yes){match=candidate;matchType='variant-confirmed'}}
    }
    // Mold variant check via Rebrickable (e.g. 4589 → 59900)
    if(!match&&bkId){
      setProcessingMsg('🔍 模具變體查詢…');
      const moldMatch=window._bsKeepFullId?null:await findByMoldVariant(bkId);
      if(moldMatch){if(moldMatch._altIdMatch){match=moldMatch;matchType='mold-variant';delete moldMatch._altIdMatch}else{const newImg=currentImageData||bkResult.imgUrl||'';const yes=await showVariantConfirm(bkId,bkResult.name,newImg,moldMatch);if(yes){match=moldMatch;matchType='mold-variant'}}}
    }
    if(!match&&bkName.length>=3){const found=allItems.find(i=>i.brickognizeName&&i.brickognizeName.toLowerCase()===bkName);if(found){match=found;matchType='bk-name'}}
    if(!match&&bkName.length>=5){const found=allItems.find(i=>{const n=(i.name||'').toLowerCase();return n.length>=5&&(n.includes(bkName)||bkName.includes(n))});if(found){match=found;matchType='name-fuzzy'}}
    if(match){
      setProcessingMsg('✓ '+bkResult.name+' → '+match.slot);
      const thumbnailUrl=match.thumbnailUrl||bkResult.imgUrl||(bkId?'https://cdn.rebrickable.com/media/parts/ldraw/7/'+baseId+'.png':'');
      pendingPart={design_id:bkId||match.designId,name:match.name||bkResult.name,name_cn:match.nameCN||'',designId:bkId||match.designId,slot:match.slot,slotType:match.slotType||'small',thumbnailUrl,estimateVolumeMl:match.estimateVolumeMl||0,featureTags:match.featureTags||[],bricklinkCategory:match.bricklinkCategory||'',description:match.description||'',imageData:currentImageData||'',isUpdate:true,matchedId:match.id,_brickognize:{score:bkResult.score,id:bkId,name:bkResult.name}};
      document.getElementById('result-img').src=thumbnailUrl||currentImageData||'';
      document.getElementById('result-name').textContent=match.nameCN||match.name||bkResult.name;
      const matchMethod=matchType==='exact'?'ID: '+bkId:matchType==='variant-confirmed'?'變體: '+bkId+'→'+match.designId:matchType==='mold-variant'?'模具: '+bkId+'→'+match.designId:matchType==='bk-name'?'BK名稱':matchType==='name-fuzzy'?'名稱相似':'ID: '+bkId;
      document.getElementById('result-designid').innerHTML=(match.designId?'Design ID: '+match.designId:'')+' <span style="font-size:10px;padding:2px 6px;background:rgba(76,175,80,0.15);border:1px solid var(--green);color:var(--green);border-radius:4px">⚡ '+bkResult.score+'% '+matchMethod+'</span>';
      document.getElementById('result-desc').textContent=match.description||'';
      const lensEl1=document.getElementById('result-lens-summary');
      if(match.lens_summary&&lensEl1){lensEl1.textContent='🔍 Lens: '+match.lens_summary;lensEl1.style.display=''}
      else if(lensEl1){lensEl1.style.display='none'}
      document.getElementById('result-tags').innerHTML=(match.featureTags||[]).map(t=>'<span class="tag">'+t+'</span>').join('');
      document.getElementById('result-volume').textContent='佔位體積 ≈ '+(match.estimateVolumeMl||0)+'ml';
      // [v20au] Show pickup slot when available
      if(match.pickupSlot){
        document.getElementById('result-slot').textContent=match.pickupSlot;
        document.getElementById('result-slot-type').textContent='\u270B \u5FEB\u53D6\u9EDE \u2192 \u4E3B\u4F4D '+match.slot;
      }else{
        document.getElementById('result-slot').textContent=match.slot;
        document.getElementById('result-slot-type').textContent=match.slotType==='large'?'\u5927\u62BD\u5C5C':match.slotType==='bag'?'\u6536\u7D0D\u888B':'\u5C0F\u62BD\u5C5C\u5206\u683C';
      }
      renderMiniMap(match.slot);
      const banner=document.getElementById('match-banner');
      banner.style.display='block';banner.innerHTML='<div style="font-size:13px;font-weight:700;color:var(--green)">⚡ 快速辨識（'+Math.round(performance.now()-window._procStart)+'ms）</div><div style="font-size:12px;color:var(--muted)">Brickognize '+bkResult.score+'% → 「'+(match.nameCN||match.name)+'」已在 '+match.slot+'</div>';
      if(window._procTimer){clearInterval(window._procTimer);window._procTimer=null}
      document.getElementById('result-confirm-btn').textContent='← 返回';
      document.getElementById('result-confirm-btn').onclick=()=>goBack();
      document.getElementById('result-cancel-btn').style.display='none';
      // [v20az] Show move button in BK match
      document.getElementById('result-slot-override').style.display='';
      document.getElementById('result-dims-required').style.display='none';
      document.getElementById('result-qty-row').style.display='flex';
      document.getElementById('result-qty').value='1';
      document.getElementById('result-qty-save').textContent='✓ 追加';
      document.getElementById('result-qty-save').disabled=false;
      showScreen('s-result');return;
    }
    // Brickognize matched but NOT in DB → auto-register with Gemini enrichment
    setProcessingMsg('🤖 補充零件資訊…');
    try{
      // Use BK result directly (skip rebrickableLookup which is slow with 404+retry)
      const rbDid=bkId;
      const baseForThumb=getBaseDesignId(bkId)||bkId;
      const thumbnailUrl=bkResult.imgUrl||('https://cdn.rebrickable.com/media/parts/ldraw/7/'+baseForThumb+'.png');
      window._pendingRbImgUrl=thumbnailUrl;
      // Text-only Gemini call (no photo = fast ~2s)
      const regPrompt='你是LEGO零件專家。Brickognize辨識為「'+bkResult.name+'」('+bkId+'，信心'+bkResult.score+'%)。回應純JSON：{"design_id":"'+rbDid+'","name":"英文名","name_cn":"繁體中文名","bricklink_category":"BrickLink分類","description":"30字描述","feature_tags":["1~3個,限選:'+LEGO_TAGS+'"],"dim_mm_w":寬mm數,"dim_mm_l":長mm數,"dim_mm_h":高mm數,"is_oversize":bool,"is_complete_minifig":bool,"series_tag":"若為Ninjago/DreamZzz/Jurassic/SuperHeroes/DC/HarryPotter/StarWars系列回系列名,否則null","character_tag":"若能明確辨識為Lloyd/Kai/Zane/Jay/Cole/Nya/Wu/Arin/Sora/Mateo/Zoey等具體角色回名字,通用零件回null"}';
      const regResp=await callGeminiAPI(regPrompt,null,0,GEMINI_LEGO_SYSTEM);
      const regItem=safeParseJSON(regResp);
      regItem.design_id=regItem.design_id||rbDid;
      regItem.brickognizeName=bkResult.name||'';
if(window._bsKeepFullId){regItem.design_id=bkId;regItem._keepFullId=true;regItem._skipMoldCheck=true;window._bsKeepFullId=false}
      regItem._skipMoldCheck=true;       regItem._skipMoldCheck=true; // Already checked in cameraRecognize, skip slow API retry
      await processResult(regItem);
    }catch(e){
      if(window._procTimer){clearInterval(window._procTimer);window._procTimer=null}
      showTab('main');showToast('建檔失敗：'+e.message,'error');
    }
    return;
  }
  // Brickognize failed → Gemini fallback (part only, no instruction)
  setProcessingMsg('🤖 AI 辨識零件…');
  const existingList=await buildExistingList();
  const partPrompt='你是嚴格且專業的樂高零件鑑定專家。\n\n【非原廠與異物排除規則】(最高優先級)\n請嚴格檢視圖片，若該物品具備以下任一特徵，請判定為「非標準樂高零件」：\n1. 屬於一般生活用品或電子零件（如電池、硬幣、文具、瓶蓋）。\n2. 無明確樂高特徵（無標準卡扣/凸點、材質異常如軟矽膠、半透明橡膠、明顯為副廠或客製化物品）。\n若你判斷這「極可能不是」樂高原廠零件，或對其樂高編號信心極低，務必將 design_id 與 matched_existing_id 一律回傳 JSON 的 null（不加引號）。寧可不配對，也絕不允許硬湊外型相似的樂高編號（例如將矽膠吸盤誤認為科技銷）。\n\n【標準辨識任務】\n若確認是樂高零件或套件，辨識其 Design ID 與名稱。回應純JSON：{"design_id":"Design ID或套件編號，若非樂高或無法確定請回傳 null（不加引號）","name":"英文名","name_cn":"繁體中文名","matched_existing_id":"同外型物品id，若無匹配或非樂高請回傳 null（不加引號）。已有:'+existingList+'"}';
  const partResp=await callGeminiAPI(partPrompt,base64,0,GEMINI_LEGO_SYSTEM);
  partInfo=safeParseJSON(partResp);
  } // end if(!_forceCustom) — 強制自訂建檔時跳過 BK + partPrompt
  const geminiId=(partInfo.design_id||partInfo.designId||'').toString();
  const geminiMatchedId=partInfo.matched_existing_id||'';
  let dbMatch=null;
  // [強制自訂建檔] 使用者在交叉驗證按了「都不是」→ 跳過所有 dbMatch 配對，直接走非原廠建檔
  const _skipDbMatch=window._forceCustomBuild===true;
  if(_skipDbMatch){window._forceCustomBuild=false}
  if(!_skipDbMatch){
  if(geminiMatchedId&&geminiMatchedId!=='null'){dbMatch=allItems.find(i=>i.id===geminiMatchedId)}
  if(!dbMatch&&geminiId){dbMatch=allItems.find(i=>(i.designId||'').toLowerCase()===geminiId.toLowerCase())}
  if(!dbMatch&&geminiId){const base=getBaseDesignId(geminiId);if(base)dbMatch=allItems.find(i=>getBaseDesignId(i.designId)===base)}
  if(!dbMatch&&geminiId){const num=getNumericBase(geminiId);if(num)dbMatch=allItems.find(i=>getNumericBase(i.designId)===num)}
  // Mold variant check via Rebrickable
  if(!dbMatch&&geminiId){dbMatch=await findByMoldVariant(geminiId)}
  if(!dbMatch){const en=(partInfo.name||'');if(en.length>=5){const nl=en.toLowerCase();dbMatch=allItems.find(i=>{const n=(i.name||'').toLowerCase();return n.length>=5&&(n.includes(nl)||nl.includes(n))})}}
  } // end if(!_skipDbMatch)
  if(dbMatch){
    if(window._procTimer){clearInterval(window._procTimer);window._procTimer=null}
    const thumb=dbMatch.thumbnailUrl||(dbMatch.designId?'https://cdn.rebrickable.com/media/parts/ldraw/7/'+getBaseDesignId(dbMatch.designId)+'.png':'');
    pendingPart={design_id:dbMatch.designId,name:dbMatch.name,name_cn:dbMatch.nameCN||'',designId:dbMatch.designId,slot:dbMatch.slot,slotType:dbMatch.slotType||'small',thumbnailUrl:thumb,estimateVolumeMl:dbMatch.estimateVolumeMl||0,featureTags:dbMatch.featureTags||[],bricklinkCategory:dbMatch.bricklinkCategory||'',description:dbMatch.description||'',imageData:currentImageData||'',isUpdate:true,matchedId:dbMatch.id};
    document.getElementById('result-img').src=thumb||currentImageData||'';
    document.getElementById('result-name').textContent=dbMatch.nameCN||dbMatch.name||'';
    document.getElementById('result-designid').innerHTML='Design ID: '+(dbMatch.designId||'')+' <span style="font-size:10px;padding:2px 6px;background:rgba(76,175,80,0.15);border:1px solid var(--green);color:var(--green);border-radius:4px">🤖 AI 比對</span>';
    document.getElementById('result-desc').textContent=dbMatch.description||'';
    const lensEl2=document.getElementById('result-lens-summary');
    if(dbMatch.lens_summary&&lensEl2){lensEl2.textContent='🔍 Lens: '+dbMatch.lens_summary;lensEl2.style.display=''}
    else if(lensEl2){lensEl2.style.display='none'}
    document.getElementById('result-tags').innerHTML=(dbMatch.featureTags||[]).map(t=>'<span class="tag">'+t+'</span>').join('');
    document.getElementById('result-volume').textContent='佔位體積 ≈ '+(dbMatch.estimateVolumeMl||0)+'ml';
    // [v20au] Show pickup slot when available
    if(dbMatch.pickupSlot){
      document.getElementById('result-slot').textContent=dbMatch.pickupSlot;
      document.getElementById('result-slot-type').textContent='\u270B \u5FEB\u53D6\u9EDE \u2192 \u4E3B\u4F4D '+dbMatch.slot;
    }else{
      document.getElementById('result-slot').textContent=dbMatch.slot;
      document.getElementById('result-slot-type').textContent=dbMatch.slotType==='large'?'\u5927\u62BD\u5C5C':dbMatch.slotType==='bag'?'\u6536\u7D0D\u888B':'\u5C0F\u62BD\u5C5C\u5206\u683C';
    }
    window._cvData={base64:base64,imgSrc:imgSrc,dbMatch:dbMatch,partInfo:partInfo};
    renderMiniMap(dbMatch.slot);
    const banner=document.getElementById('match-banner');
    banner.style.display='block';banner.innerHTML='<div style="font-size:13px;font-weight:700;color:var(--green)">🤖 AI 辨識成功</div><div style="font-size:12px;color:var(--muted)">「'+(dbMatch.nameCN||dbMatch.name)+'」已在 '+dbMatch.slot+'</div><div style="margin-top:8px"><button onclick="crossVerifyMode()" style="background:var(--surface);border:1px solid var(--orange);color:var(--orange);padding:6px 14px;border-radius:8px;font-size:12px;cursor:pointer;width:100%">\u274C \u8FA8\u8B58\u932F\u8AA4\uFF0C\u9032\u5165\u4EA4\u53C9\u9A57\u8B49</button></div>';
    document.getElementById('result-confirm-btn').textContent='← 返回';
    document.getElementById('result-confirm-btn').onclick=()=>goBack();
    document.getElementById('result-cancel-btn').style.display='none';
    // [v20az] Show move button in AI match
    document.getElementById('result-slot-override').style.display='';
    document.getElementById('result-dims-required').style.display='none';
    document.getElementById('result-qty-row').style.display='flex';
    document.getElementById('result-qty').value='1';
    document.getElementById('result-qty-save').textContent='✓ 追加';
    document.getElementById('result-qty-save').disabled=false;
    showScreen('s-result');return;
  }
  // ═══ [C方案] 本地圖庫多圖選美（BK + dbMatch 皆失敗的特例軌）═══
  const cImgCands=coarseFilterWithImage(partInfo,5);
  if(cImgCands.length>0 && currentImageData && (cfg.apiKey||'').trim()){
    setProcessingMsg('🔍 本地圖庫比對中…');
    const sysInst='你是嚴格的樂高零件與人偶鑑定專家。比對【實拍圖】與【候選圖】。\n【最高指導原則】\n1.寧缺勿濫：若實拍圖與所有候選圖有任何肉眼可見差異(印刷/雙色成型/卡扣位置/顏色)，必須判定無匹配。誤判比找不到更嚴重。\n2.人偶特化：軀幹查正反面印刷、領口與手臂手掌顏色；腿部查雙色成型與印刷；頭部查表情、眉毛、雙面、配件。\n3.評分：形狀+所有印刷100%吻合給90-100；形狀吻合但受光線影響細節有10%不確定給80-89；任一特徵不符直接<80。\n輸出純JSON：{"matchedId":"候選id或null","confidenceScore":0-100數字,"reason":"繁中20字內"}';
    const parts=[{text:'請分析以下【實拍圖】：'},{inlineData:{mimeType:'image/jpeg',data:cleanBase64ForGemini(currentImageData)}},{text:'\n請與以下候選比對，找出唯一正確匹配：'}];
    cImgCands.forEach((c,i)=>{
      parts.push({text:'\n候選'+(i+1)+' ID:'+c.id+' 名稱:'+(c.nameCN||c.name)+' 分類:'+(c.bricklinkCategory||'')});
      parts.push({inlineData:{mimeType:'image/jpeg',data:cleanBase64ForGemini(c.imageData)}});
    });
    try{
      const raw=await callGeminiParts(parts,sysInst);
      const r=safeParseJSON(raw);
      if(r&&r.confidenceScore>=90&&r.matchedId){
        const m=allItems.find(i=>i.id===r.matchedId);
        if(m){
          if(window._procTimer){clearInterval(window._procTimer);window._procTimer=null}
          pendingPart={design_id:m.designId,name:m.name,name_cn:m.nameCN||'',designId:m.designId,slot:m.slot,slotType:m.slotType||'small',thumbnailUrl:m.thumbnailUrl||'',estimateVolumeMl:m.estimateVolumeMl||0,featureTags:m.featureTags||[],bricklinkCategory:m.bricklinkCategory||'',description:m.description||'',imageData:currentImageData||'',isUpdate:true,matchedId:m.id};
          document.getElementById('result-name').textContent=m.nameCN||m.name||'';
          document.getElementById('result-designid').innerHTML='<span style="font-size:10px;padding:2px 6px;background:rgba(76,175,80,0.15);border:1px solid var(--green);color:var(--green);border-radius:4px">📷 圖像比對 '+r.confidenceScore+'%</span>';
          document.getElementById('result-desc').textContent=r.reason||m.description||'';
          document.getElementById('result-tags').innerHTML=(m.featureTags||[]).map(t=>'<span class="tag">'+t+'</span>').join('');
          document.getElementById('result-volume').textContent='佔位體積 ≈ '+(m.estimateVolumeMl||0)+'ml';
          if(m.pickupSlot){document.getElementById('result-slot').textContent=m.pickupSlot;document.getElementById('result-slot-type').textContent='✋ 快取點 → 主位 '+m.slot;}
          else{document.getElementById('result-slot').textContent=m.slot;document.getElementById('result-slot-type').textContent=m.slotType==='large'?'大抽屜':m.slotType==='bag'?'收納袋':'小抽屜分格';}
          renderMiniMap(m.slot);
          showScreen('s-result');return;
        }
      } else if(r&&r.confidenceScore>=80&&r.matchedId){
        const m=allItems.find(i=>i.id===r.matchedId);
        if(m && confirm('圖像比對找到相似零件（信心'+r.confidenceScore+'%）：\n\n'+(m.nameCN||m.name)+' @ '+m.slot+'\n\n'+(r.reason||'')+'\n\n確定是同一個零件嗎？')){
          if(window._procTimer){clearInterval(window._procTimer);window._procTimer=null}
          pendingPart={design_id:m.designId,name:m.name,name_cn:m.nameCN||'',designId:m.designId,slot:m.slot,slotType:m.slotType||'small',thumbnailUrl:m.thumbnailUrl||'',estimateVolumeMl:m.estimateVolumeMl||0,featureTags:m.featureTags||[],bricklinkCategory:m.bricklinkCategory||'',description:m.description||'',imageData:currentImageData||'',isUpdate:true,matchedId:m.id};
          document.getElementById('result-name').textContent=m.nameCN||m.name||'';
          document.getElementById('result-designid').innerHTML='<span style="font-size:10px;padding:2px 6px;background:rgba(255,152,0,0.15);border:1px solid var(--orange);color:var(--orange);border-radius:4px">📷 人工確認 '+r.confidenceScore+'%</span>';
          document.getElementById('result-slot').textContent=m.pickupSlot||m.slot;
          document.getElementById('result-slot-type').textContent=m.slotType==='large'?'大抽屜':m.slotType==='bag'?'收納袋':'小抽屜分格';
          renderMiniMap(m.slot);
          showScreen('s-result');return;
        }
      }
      // <80 或人工否決 → 放行至新建檔
    }catch(e){console.error('[C方案] 多圖選美錯誤:',e);/* 不卡死，放行新建 */}
  }
  // ═══ [C方案結束] ═══
  // ═══ [非原廠件建檔] BK + C方案皆無匹配 → 人工確認 → 5mm 方格測量建檔 ═══
  const isCustomPartConfirmed=window.confirm('Brickognize 與本地圖庫皆查無匹配。\n\n請問是否確認此為「非原廠/自訂零件」，並直接透過背景 5mm 方格紙進行測量與建檔？');
  if(isCustomPartConfirmed){
    console.log('[自訂件建檔] 啟動 5mm 方格紙測量與特徵標籤分配');
    const availableTags=(typeof LEGO_TAGS!=='undefined')?LEGO_TAGS:'Cylinder, Cone, Dish, Tile Round, Brick Round, Bar, Container, Spring, Hose, Slope';
    const measureSystemInstruction='你是一個具備機器視覺與空間測量能力的「精密零件分析專家」。\n你的任務是分析照片中的未知零件（可能是非樂高物品），嚴格依據背景比例尺推算其實體尺寸，並賦予最接近的幾何外觀標籤。\n\n【絕對比例尺規則：5mm 方格】\n照片背景是標準方格紙。請嚴格執行以下測量步驟：\n1. 每一個正方形小格子的邊長精確等於 5mm。\n2. 請在畫面上數出該物件的最長邊（長度）與次長邊（寬度）分別跨越了「幾個方格」。\n3. 將跨越的方格數乘以 5，得出真實尺寸（例如：跨越 4 格 = 20mm）。\n4. 高度（厚度）若無法直接看見方格，請依據視角與物體比例進行合理推算。\n\n【強制標籤分類規則】\n即使該物品不是樂高，你也必須從以下提供的 [合法形狀標籤清單] 中，挑選 1 到 3 個最符合該物品「幾何外觀」的標籤。絕對禁止自創標籤，這攸關後續的實體抽屜分區。\n[合法形狀標籤清單]：'+availableTags+'\n\n【JSON 輸出規範】\n必須回傳乾淨的 JSON，包含以下欄位：\ncalculation_reasoning: "請先寫下你的數格子過程。例如：長度佔 4 格=20mm，寬度佔 4 格=20mm，厚度推估約 3mm。"\ndim_mm_l: 數字 (長度, mm)\ndim_mm_w: 數字 (寬度, mm)\ndim_mm_h: 數字 (高度/厚度, mm)\nfeature_tags: ["標籤1","標籤2"] (必須來自合法清單)\nbricklink_category: "" (請固定回傳空字串)\ndescription: "簡短的物品外觀描述"';
    const promptParts=[{text:'請分析這張【放在 5mm 方格紙上的實拍圖】，並嚴格依照系統指示輸出 JSON：'},{inlineData:{mimeType:'image/jpeg',data:cleanBase64ForGemini(currentImageData)}}];
    try{
      setProcessingMsg('📐 AI 方格測量中…');
      const rawJsonString=await callGeminiParts(promptParts,measureSystemInstruction);
      const measureResult=safeParseJSON(rawJsonString);
      if(!measureResult)throw new Error('AI 回傳格式無法解析');
      console.log('[自訂件建檔] AI 測量推理過程:',measureResult.calculation_reasoning);
      console.log('[自訂件建檔] AI 測量最終結果:',measureResult);
      const customItem={
        name:'自訂/非原廠件 - '+(measureResult.description||''),
        name_cn:'自訂件 - '+(measureResult.description||''),
        bricklink_category:measureResult.bricklink_category||'',
        dim_mm_l:measureResult.dim_mm_l,
        dim_mm_w:measureResult.dim_mm_w,
        dim_mm_h:measureResult.dim_mm_h,
        feature_tags:measureResult.feature_tags||[],
        description:measureResult.description||'',
        imageData:currentImageData,
        isCustom:true
      };
      await processResult(customItem);
      return;
    }catch(error){
      console.error('[自訂件建檔] 測量或建檔過程發生錯誤:',error);
      if(window._procTimer){clearInterval(window._procTimer);window._procTimer=null}
      showTab('main');
      showToast('AI 測量失敗，請重試或手動建檔\n'+error.message,'error',4000);
      return;
    }
  }
  console.log('[自訂件建檔] 使用者取消，放行至一般未建檔提示。');
  if(window._procTimer){clearInterval(window._procTimer);window._procTimer=null}
  showTab('main');
  showToast('⚠ 零件「'+(partInfo.name_cn||partInfo.name||geminiId||'未知')+'」未建檔\n請使用 🖼 建檔（Lens 截圖）','error',4000);
}

// ═══ LENS GALLERY: build new item ═══
async function handleLensGallery(event){
  const file=event.target.files[0];if(!file)return;event.target.value='';
  const reader=new FileReader();reader.onload=async e=>{
    const dataUrl=e.target.result;
    showScreen('s-processing');
    try{
      // Reuse the same 2-step Lens flow
      await parseLensScreenshot(dataUrl);
    }catch(err){showTab('main');showToast('辨識失敗：'+err.message,'error')}
  };reader.readAsDataURL(file);
}

// ═══ INSTRUCTION: Camera → Manual Crop → BK/AI → Results ═══


// Open instruction: show camera/gallery/clipboard/capture menu (web) or APK gallery
function startInstructionCapture(mode){
  hideInstructionMenu();
  if(window.BrickSortNative){
    // APK: use native bridge (clipboard/capture not available on APK, fallback to gallery)
    window._galleryMode='instruction';
    if(mode==='camera'){
      BrickSortNative.openCamera();
      window._pendingInstructionMode=true;
    }else{
      BrickSortNative.openGalleryWithMode('instruction');
    }
  }else{
    // Chrome web
    if(mode==='clipboard'){pasteInstructionFromClipboard();return}
    if(mode==='capture'){captureScreenForInstruction();return}
    // camera / gallery: use file input
    document.getElementById(mode==='camera'?'instruction-camera':'instruction-gallery').click();
  }
}

// 📋 從剪貼簿讀取圖片 (Win+Shift+S 之後按這個)
async function pasteInstructionFromClipboard(){
  if(!navigator.clipboard||!navigator.clipboard.read){
    showToast('此瀏覽器不支援剪貼簿讀取','error');return;
  }
  try{
    const items=await navigator.clipboard.read();
    let imgBlob=null;
    for(const it of items){
      for(const type of it.types){
        if(type.startsWith('image/')){
          imgBlob=await it.getType(type);break;
        }
      }
      if(imgBlob)break;
    }
    if(!imgBlob){showToast('剪貼簿中沒有圖片 (先用 Win+Shift+S 截圖)','error');return}
    const reader=new FileReader();
    reader.onload=async e=>{
      const resized=await resizeImage(e.target.result,1200);
      showInstructionCrop(resized);
    };
    reader.readAsDataURL(imgBlob);
  }catch(err){
    if(err.name==='NotAllowedError'){
      showToast('需要剪貼簿權限 — 請點網址列旁的🔒圖示允許','error',4000);
    }else{
      showToast('讀取剪貼簿失敗: '+err.message,'error');
    }
  }
}

// 🖥 擷取螢幕 (Chrome 會跳出選視窗/分頁對話框, 選完進入框選 UI)
async function captureScreenForInstruction(){
  if(!navigator.mediaDevices||!navigator.mediaDevices.getDisplayMedia){
    showToast('此瀏覽器不支援螢幕擷取','error');return;
  }
  let stream=null;
  try{
    stream=await navigator.mediaDevices.getDisplayMedia({video:{cursor:'never'},audio:false,preferCurrentTab:false});
    // 擷取一幀
    const track=stream.getVideoTracks()[0];
    // Wait a tick for stream to stabilize
    await new Promise(r=>setTimeout(r,300));
    const video=document.createElement('video');
    video.srcObject=stream;video.muted=true;
    await video.play();
    const canvas=document.createElement('canvas');
    canvas.width=video.videoWidth;
    canvas.height=video.videoHeight;
    canvas.getContext('2d').drawImage(video,0,0);
    const dataUrl=canvas.toDataURL('image/jpeg',0.9);
    // Stop stream immediately
    track.stop();stream.getTracks().forEach(t=>t.stop());
    video.pause();video.srcObject=null;
    // 進入框選 UI
    const resized=await resizeImage(dataUrl,1600);
    showInstructionCrop(resized);
  }catch(err){
    if(stream)stream.getTracks().forEach(t=>t.stop());
    if(err.name==='NotAllowedError'){
      showToast('已取消螢幕擷取','error');
    }else{
      showToast('擷取失敗: '+err.message,'error');
    }
  }
}



function toggleInstructionMenu(){
  const m=document.getElementById('instruction-menu');
  m.style.display=m.style.display==='none'?'block':'none';
}
function hideInstructionMenu(){
  document.getElementById('instruction-menu').style.display='none';
}

// Web camera handler
function handleInstructionCamera(event){
  const file=event.target.files[0];if(!file)return;event.target.value='';
  const reader=new FileReader();
  reader.onload=async e=>{
    const resized=await resizeImage(e.target.result,1200);
    showInstructionCrop(resized);
  };
  reader.readAsDataURL(file);
}

// APK gallery handler (kept for backward compat - APK calls instructionRecognize)
async function handleInstructionGallery(event){
  const file=event.target.files[0];if(!file)return;event.target.value='';
  const reader=new FileReader();
  reader.onload=async e=>{
    const resized=await resizeImage(e.target.result,1200);
    showInstructionCrop(resized);
  };
  reader.readAsDataURL(file);
}

// APK backward compat: instructionRecognize now shows crop UI
async function instructionRecognize(base64,imgSrc){
  showInstructionCrop(imgSrc);
}

// ═══ Manual Crop Canvas ═══
let _cropImg=null;
let _cropBoxes=[];
let _cropDrawing=false;
let _cropStartX=0,_cropStartY=0,_cropCurX=0,_cropCurY=0;

function showInstructionCrop(imgSrc){
  _cropBoxes=[];
  _cropImg=new Image();
  _cropImg.onload=()=>{
    showScreen('s-instruction-crop');
    const canvas=document.getElementById('cropCanvas');
    // Set up touch/mouse events (remove old first)
    canvas.onmousedown=onCropStart;canvas.onmousemove=onCropMove;canvas.onmouseup=onCropEnd;
    canvas.ontouchstart=onCropStart;canvas.ontouchmove=onCropMove;canvas.ontouchend=onCropEnd;
    redrawCrop();
    updateCropUI();
  };
  _cropImg.src=imgSrc;
}

function cropToImgCoords(e){
  e.preventDefault();
  const canvas=document.getElementById('cropCanvas');
  const rect=canvas.getBoundingClientRect();
  const scaleX=canvas.width/rect.width;
  const scaleY=canvas.height/rect.height;
  const p=e.touches?e.touches[0]:e;
  return{x:Math.round((p.clientX-rect.left)*scaleX),y:Math.round((p.clientY-rect.top)*scaleY)};
}

function onCropStart(e){
  if(!_cropImg)return;
  const c=cropToImgCoords(e);
  _cropStartX=c.x;_cropStartY=c.y;_cropCurX=c.x;_cropCurY=c.y;
  _cropDrawing=true;
}
function onCropMove(e){
  if(!_cropDrawing)return;
  const c=cropToImgCoords(e);
  _cropCurX=c.x;_cropCurY=c.y;
  redrawCrop();
  // Draw active drag box (red dashed)
  const ctx=document.getElementById('cropCanvas').getContext('2d');
  ctx.setLineDash([6,4]);ctx.strokeStyle='#ef4444';ctx.lineWidth=2;
  ctx.strokeRect(Math.min(_cropStartX,_cropCurX),Math.min(_cropStartY,_cropCurY),Math.abs(_cropCurX-_cropStartX),Math.abs(_cropCurY-_cropStartY));
  ctx.setLineDash([]);
}
function onCropEnd(e){
  if(!_cropDrawing)return;
  _cropDrawing=false;
  const x1=Math.min(_cropStartX,_cropCurX),y1=Math.min(_cropStartY,_cropCurY);
  const x2=Math.max(_cropStartX,_cropCurX),y2=Math.max(_cropStartY,_cropCurY);
  if(x2-x1>20&&y2-y1>20){
    _cropBoxes.push({x1,y1,x2,y2});
  }
  redrawCrop();
  updateCropUI();
  renderCropPreviews();
}

function redrawCrop(){
  if(!_cropImg)return;
  const canvas=document.getElementById('cropCanvas');
  const ctx=canvas.getContext('2d');
  canvas.width=_cropImg.width;canvas.height=_cropImg.height;
  ctx.drawImage(_cropImg,0,0);
  // Draw confirmed boxes (green)
  _cropBoxes.forEach((b,i)=>{
    ctx.strokeStyle='#4ade80';ctx.lineWidth=3;
    ctx.strokeRect(b.x1,b.y1,b.x2-b.x1,b.y2-b.y1);
    ctx.fillStyle='#4ade80';ctx.font='bold 18px sans-serif';
    ctx.fillText('#'+(i+1),b.x1+4,b.y1-6);
  });
}

function updateCropUI(){
  document.getElementById('crop-box-count').textContent=_cropBoxes.length?_cropBoxes.length+' 個框':'';
  document.getElementById('btnCropUndo').disabled=!_cropBoxes.length;
  document.getElementById('btnCropConfirm').disabled=!_cropBoxes.length;
}

function undoCropBox(){
  _cropBoxes.pop();
  redrawCrop();updateCropUI();renderCropPreviews();
}

function renderCropPreviews(){
  const grid=document.getElementById('cropPreviewGrid');
  grid.innerHTML='';
  _cropBoxes.forEach((b,i)=>{
    const cw=b.x2-b.x1,ch=b.y2-b.y1;
    const cvs=document.createElement('canvas');
    cvs.width=cw;cvs.height=ch;
    cvs.getContext('2d').drawImage(_cropImg,b.x1,b.y1,cw,ch,0,0,cw,ch);
    const div=document.createElement('div');
    div.style.cssText='text-align:center';
    div.innerHTML='<img src="'+cvs.toDataURL('image/jpeg',0.9)+'" style="width:70px;height:70px;object-fit:contain;border-radius:6px;background:rgba(255,255,255,0.08)"><div style="font-size:9px;color:var(--dim);font-family:var(--mono)">#'+(i+1)+' '+cw+'×'+ch+'</div>';
    grid.appendChild(div);
  });
}

// ═══ Confirm Crops → BK/AI Recognition ═══
async function confirmCrops(){
  if(!_cropBoxes.length||!_cropImg)return;
  const imgSrc=_cropImg.src;
  const sw=_cropImg.width,sh=_cropImg.height;

  showScreen('s-processing');
  setProcessingMsg('🔍 辨識 '+_cropBoxes.length+' 個零件…');

  const results=[];
  for(let i=0;i<_cropBoxes.length;i++){
    const b=_cropBoxes[i];
    const cw=b.x2-b.x1,ch=b.y2-b.y1;
    if(cw<10||ch<10)continue;

    const canvas=document.createElement('canvas');
    canvas.width=cw;canvas.height=ch;
    canvas.getContext('2d').drawImage(_cropImg,b.x1,b.y1,cw,ch,0,0,cw,ch);
    const cropBase64=canvas.toDataURL('image/jpeg',0.9).split(',')[1];
    const cropDataUrl=canvas.toDataURL('image/png');

    // Brickognize
    setProcessingMsg('🔍 Brickognize ('+(i+1)+'/'+_cropBoxes.length+')…');
    const bkResult=await brickognizePredict(cropBase64);

    let match=null,matchMethod='',did='',name='';
    if(bkResult&&bkResult.score>=30){
      did=bkResult.id||'';name=bkResult.name||'';
      const baseId=getBaseDesignId(did);const numBase=getNumericBase(did);
      if(did){match=allItems.find(it=>(it.designId||'').toLowerCase()===did.toLowerCase());if(match)matchMethod='BK:'+bkResult.score+'%'}
      if(!match&&baseId){match=allItems.find(it=>getBaseDesignId(it.designId)===baseId);if(match)matchMethod='BK變體:'+bkResult.score+'%'}
      if(!match&&numBase){match=allItems.find(it=>getNumericBase(it.designId)===numBase);if(match)matchMethod='BK模具:'+bkResult.score+'%'}
      // Mold variant via Rebrickable
      if(!match&&did){const mv=await findByMoldVariant(did);if(mv){match=mv;matchMethod='BK模具變體:'+bkResult.score+'%'}}
      if(!match&&(bkResult.name||'').length>=3){const bkn=bkResult.name.toLowerCase();match=allItems.find(it=>it.brickognizeName&&it.brickognizeName.toLowerCase()===bkn);if(match)matchMethod='BK名稱'}}
    if(!match&&bkResult&&bkResult.score>=30)matchMethod='BK:'+bkResult.score+'% (未建檔)';

    // BK failed → Gemini AI fallback
    if(!match&&(!bkResult||bkResult.score<30)){
      try{
        setProcessingMsg('🤖 AI 辨識 ('+(i+1)+'/'+_cropBoxes.length+')…');
        const fbPrompt='這是一個樂高零件的裁切圖。請辨識這個零件的 Design ID（數字編號）和名稱。回應純JSON：{"design_id":"編號","name":"英文名","name_cn":"中文名"}';
        const fbResp=await callGeminiAPI(fbPrompt,cropBase64,0);
        const fbParsed=safeParseJSON(fbResp);
        if(fbParsed.design_id){
          did=fbParsed.design_id;name=fbParsed.name_cn||fbParsed.name||'';
          const baseId=getBaseDesignId(did);const numBase=getNumericBase(did);
          if(did){match=allItems.find(it=>(it.designId||'').toLowerCase()===did.toLowerCase());if(match)matchMethod='AI:'+did}
          if(!match&&baseId){match=allItems.find(it=>getBaseDesignId(it.designId)===baseId);if(match)matchMethod='AI變體:'+did}
          if(!match&&numBase){match=allItems.find(it=>getNumericBase(it.designId)===numBase);if(match)matchMethod='AI模具:'+did}
          // Mold variant via Rebrickable
          if(!match&&did){const mv=await findByMoldVariant(did);if(mv){match=mv;matchMethod='AI模具變體:'+did}}
          if(!match)matchMethod='AI:'+did+' (未建檔)';
        }
      }catch(e){console.log('[說明書] AI fallback failed:',e)}
    }

    const thumb=match?(match.thumbnailUrl||(match.designId?'https://cdn.rebrickable.com/media/parts/ldraw/7/'+getBaseDesignId(match.designId)+'.png':'')):(bkResult?.imgUrl||cropDataUrl);
    results.push({did:match?(match.designId||did):did,name:match?(match.nameCN||match.name||name):name,qty:1,match,matchMethod,thumb,bkScore:bkResult?.score||0});

    if(i<_cropBoxes.length-1)await new Promise(r=>setTimeout(r,800));
  }

  renderInstructionResults(results,imgSrc,sw,sh);
}

function renderInstructionResults(results,imgSrc,imgW,imgH){
  const found=results.filter(r=>r.match).length;
  const total=results.length;
  let html='';
  // Instruction image preview
  if(imgSrc)html+='<div style="margin-bottom:12px;text-align:center"><img src="'+imgSrc+'" style="max-width:100%;max-height:200px;border-radius:10px;border:1px solid var(--border)" onerror="this.style.display=\'none\'"><div style="font-size:10px;color:var(--dim);margin-top:4px">圖片 '+imgW+' × '+imgH+' px</div></div>';
  // Summary
  html+='<div class="stats-row" style="margin-bottom:12px"><div class="stat-card"><div class="stat-num">'+total+'</div><div class="stat-label">零件種類</div></div><div class="stat-card"><div class="stat-num" style="color:var(--green)">'+found+'</div><div class="stat-label">找到</div></div><div class="stat-card"><div class="stat-num" style="color:'+(total-found>0?'var(--red)':'var(--dim)')+'">'+( total-found)+'</div><div class="stat-label">缺少</div></div></div>';
  // Parts list
  results.forEach(r=>{
    const status=r.match?'✅':'❌';
    const slotBadge=r.match?'<span class="slot-badge slot-'+(r.match.slotType==='large'?'large':r.match.slotType==='bag'?'bag':'small')+'" style="font-size:13px;padding:4px 10px">'+r.match.slot+'</span>':'<span style="color:var(--red);font-size:12px">未找到</span>';
    const matchInfo=r.matchMethod?'<span style="font-size:10px;color:var(--dim)">('+r.matchMethod+')</span>':'';
    const nameDisplay=r.match?(r.match.nameCN||r.match.name||r.name):r.name;
    html+='<div style="background:var(--card);border:1px solid '+(r.match?'var(--border)':'var(--red)')+';border-radius:10px;padding:10px 12px;margin-bottom:6px;'+(r.match?'cursor:pointer':'')+'" '+(r.match?'onclick="searchDrawer('+parseInt((r.match.slot||'0').replace(/\D/g,''))+');"':'')+'>';
    html+='<div style="display:flex;align-items:center;gap:10px">';
    html+='<img src="'+r.thumb+'" style="width:44px;height:44px;object-fit:contain;border-radius:6px;background:rgba(255,255,255,0.08)" onerror="this.src=\'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2244%22 height=%2244%22><text x=%2210%22 y=%2230%22 font-size=%2224%22>🧱</text></svg>\'">';
    html+='<div style="flex:1;min-width:0">';
    html+='<div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+status+' '+nameDisplay+'</div>';
    html+='<div style="font-size:11px;color:var(--muted);font-family:var(--mono)">'+r.did+' '+matchInfo+'</div>';
    html+='</div>';
    html+=slotBadge;
    html+='</div></div>';
  });
  // Missing parts summary
  const missing=results.filter(r=>!r.match);
  if(missing.length){
    html+='<div style="margin-top:12px;padding:12px;background:rgba(239,68,68,0.1);border:1px solid var(--red);border-radius:10px">';
    html+='<div style="font-size:13px;font-weight:700;color:var(--red);margin-bottom:6px">⚠ 缺少 '+missing.length+' 種零件</div>';
    html+='<div style="font-size:12px;color:var(--muted)">'+missing.map(r=>r.did+' '+r.name).join('<br>')+'</div>';
    html+='</div>';
  }
  document.getElementById('instruction-results').innerHTML=html;
  showScreen('s-instruction');
  if(window._procTimer){clearInterval(window._procTimer);window._procTimer=null}
}

async function checkSetInventory(){
  let setNum=(document.getElementById('set-check-input')?.value||'').trim();
  if(!setNum){document.getElementById('set-check-input')?.focus();return}
  const key=cfg.rbKey||DEFAULT_RB_KEY;if(!key){showToast('請設定 Rebrickable API Key','error');return}
  // Support both set number (42115) and LEGO product code (6592882)
  if(!setNum.includes('-'))setNum+='-1';
  showScreen('s-processing');setProcessingMsg('查詢套組 '+setNum+'…');
  document.getElementById('set-check-input').value='';
  try{
    const setResp=await fetch('https://rebrickable.com/api/v3/lego/sets/'+setNum+'/?key='+key);
    if(!setResp.ok)throw new Error('找不到套組 '+setNum+'。請試試 Rebrickable 的 Set Number（如 42115-1）');
    const setInfo=await setResp.json();
    // Fetch all parts (paginated)
    let allParts=[],page=1;
    while(true){
      setProcessingMsg('讀取零件清單 (第'+page+'頁)…');
      const resp=await fetch('https://rebrickable.com/api/v3/lego/sets/'+setNum+'/parts/?key='+key+'&page_size=500&page='+page);
      const data=await resp.json();allParts=allParts.concat(data.results||[]);
      if(!data.next)break;page++;
    }
    setProcessingMsg('比對倉庫資料…');
    // Deduplicate by base design ID, skip stickers
    const partMap={};
    allParts.forEach(r=>{
      const rawId=r.part?.part_num||'';const baseId=getBaseDesignId(rawId)||rawId;
      if(!baseId)return;
      const pName=(r.part?.name||'').toLowerCase();
      if(pName.includes('sticker')||(r.part?.part_cat_id===160))return;
      if(partMap[baseId]){partMap[baseId].quantity+=r.quantity;if(!partMap[baseId].imgUrl&&r.part?.part_img_url)partMap[baseId].imgUrl=r.part.part_img_url}
      else{partMap[baseId]={designId:baseId,rawId,name:r.part?.name||'',quantity:r.quantity||1,imgUrl:r.part?.part_img_url||''}}
    });
    const uniqueParts=Object.values(partMap);
    const totalPieces=uniqueParts.reduce((s,p)=>s+p.quantity,0);
    // Match each part against allItems
    const results=[];
    for(const p of uniqueParts){
      const did=p.designId;const numBase=getNumericBase(did);
      let match=null,matchMethod='',inStock=0;
      // Exact ID
      match=allItems.find(i=>(i.designId||'').toLowerCase()===did.toLowerCase());
      if(match){matchMethod='ID精確'}
      // Base ID
      if(!match){match=allItems.find(i=>{const b=getBaseDesignId(i.designId);return b&&b.toLowerCase()===did.toLowerCase()});if(match)matchMethod='印刷變體'}
      // Numeric base
      if(!match&&numBase){match=allItems.find(i=>getNumericBase(i.designId)===numBase);if(match)matchMethod='模具變體'}
      // Mold variant via Rebrickable
      if(!match){const mv=await findByMoldVariant(did);if(mv){match=mv;matchMethod='模具變體(RB)'}}
      // Name fuzzy
      if(!match&&p.name.length>=5){const nl=p.name.toLowerCase();match=allItems.find(i=>{const n=(i.name||'').toLowerCase();return n.length>=5&&(n.includes(nl)||nl.includes(n))});if(match)matchMethod='名稱相似'}
      if(match)inStock=match.quantity||1;
      const needed=p.quantity;
      const enough=inStock>=needed;
      const thumb=match?(match.thumbnailUrl||(match.designId?'https://cdn.rebrickable.com/media/parts/ldraw/7/'+getBaseDesignId(match.designId)+'.png':'')):(p.imgUrl||(did?'https://cdn.rebrickable.com/media/parts/ldraw/7/'+did+'.png':''));
      results.push({did,name:p.name,needed,inStock,enough,match,matchMethod,thumb,nameCN:match?(match.nameCN||''):''});
    }
    // Sort: missing first, then insufficient, then OK
    results.sort((a,b)=>{
      if(!a.match&&b.match)return -1;if(a.match&&!b.match)return 1;
      if(!a.enough&&b.enough)return -1;if(a.enough&&!b.enough)return 1;
      return a.name.localeCompare(b.name);
    });
    renderSetCheckResults(setInfo,results,totalPieces);
  }catch(err){showTab('main');showToast('查詢失敗：'+err.message,'error')}
  if(window._procTimer){clearInterval(window._procTimer);window._procTimer=null}
}

function renderSetCheckResults(setInfo,results,totalPieces){
  const found=results.filter(r=>r.match);
  const enough=results.filter(r=>r.enough);
  const missing=results.filter(r=>!r.match);
  const insufficient=results.filter(r=>r.match&&!r.enough);
  const totalNeeded=results.reduce((s,r)=>s+r.needed,0);
  const totalHave=results.reduce((s,r)=>s+Math.min(r.inStock,r.needed),0);

  document.getElementById('setcheck-title').textContent='📦 '+(setInfo.name||setInfo.set_num);
  let html='';
  // Set info header
  const setImg=setInfo.set_img_url||'';
  html+='<div style="display:flex;gap:12px;margin-bottom:16px;align-items:center">';
  if(setImg)html+='<img src="'+setImg+'" style="width:80px;height:80px;object-fit:contain;border-radius:8px;background:rgba(255,255,255,0.08)">';
  html+='<div><div style="font-size:15px;font-weight:700">'+(setInfo.name||'')+'</div>';
  html+='<div style="font-size:12px;color:var(--muted);font-family:var(--mono)">'+setInfo.set_num+' · '+(setInfo.year||'')+' · '+totalPieces+'件</div></div></div>';
  // Summary stats
  const readyPct=results.length?Math.round(enough.length/results.length*100):0;
  const piecePct=totalNeeded?Math.round(totalHave/totalNeeded*100):0;
  const barColor=readyPct>=100?'var(--green)':readyPct>=80?'var(--orange)':'var(--red)';
  html+='<div style="background:var(--card);border-radius:10px;padding:14px;margin-bottom:12px">';
  html+='<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="font-size:13px;font-weight:600">零件齊全度</span><span style="font-family:var(--mono);font-size:13px;color:'+barColor+'">'+readyPct+'%</span></div>';
  html+='<div style="height:8px;background:var(--surface);border-radius:4px;overflow:hidden;margin-bottom:10px"><div style="width:'+readyPct+'%;height:100%;background:'+barColor+';border-radius:4px"></div></div>';
  html+='<div class="stats-row">';
  html+='<div class="stat-card"><div class="stat-num">'+results.length+'</div><div class="stat-label">零件種類</div></div>';
  html+='<div class="stat-card"><div class="stat-num" style="color:var(--green)">'+enough.length+'</div><div class="stat-label">齊全</div></div>';
  html+='<div class="stat-card"><div class="stat-num" style="color:var(--orange)">'+(insufficient.length)+'</div><div class="stat-label">不足</div></div>';
  html+='<div class="stat-card"><div class="stat-num" style="color:var(--red)">'+missing.length+'</div><div class="stat-label">缺少</div></div>';
  html+='</div></div>';
  // Filter tabs
  html+='<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">';
  html+='<button class="btn btn-sm" onclick="filterSetCheck(\'all\')" id="sc-f-all" style="background:var(--accent);color:#111">全部 '+results.length+'</button>';
  if(missing.length)html+='<button class="btn btn-sm" onclick="filterSetCheck(\'missing\')" id="sc-f-missing">❌ 缺少 '+missing.length+'</button>';
  if(insufficient.length)html+='<button class="btn btn-sm" onclick="filterSetCheck(\'low\')" id="sc-f-low">⚠ 不足 '+insufficient.length+'</button>';
  html+='<button class="btn btn-sm" onclick="filterSetCheck(\'ok\')" id="sc-f-ok">✅ 齊全 '+enough.length+'</button>';
  html+='</div>';
  // Parts list
  html+='<div id="sc-parts-list">';
  html+=renderSetCheckParts(results);
  html+='</div>';
  // Store results for filtering
  window._setCheckResults=results;
  document.getElementById('setcheck-results').innerHTML=html;
  showScreen('s-setcheck');
}

function renderSetCheckParts(results){
  let html='';
  results.forEach(r=>{
    const icon=!r.match?'❌':!r.enough?'⚠️':'✅';
    const border=!r.match?'var(--red)':!r.enough?'var(--orange)':'var(--border)';
    const slotBadge=r.match?'<span class="slot-badge slot-'+(r.match.slotType==='large'?'large':r.match.slotType==='bag'?'bag':'small')+'" style="font-size:11px;padding:2px 8px">'+r.match.slot+'</span>':'';
    const qtyInfo=r.match?'<span style="font-size:11px;font-family:var(--mono);color:'+(r.enough?'var(--green)':'var(--orange)')+'">庫存 '+r.inStock+'/需要 '+r.needed+'</span>':'<span style="font-size:11px;color:var(--red)">需要 '+r.needed+' · 未建檔</span>';
    const nameDisplay=r.nameCN||r.name;
    html+='<div style="background:var(--card);border:1px solid '+border+';border-radius:8px;padding:8px 10px;margin-bottom:4px;'+(r.match?'cursor:pointer':'')+'" '+(r.match?'onclick="doSearch(\''+r.match.designId+'\')"':'')+'>';
    html+='<div style="display:flex;align-items:center;gap:8px">';
    html+='<img src="'+r.thumb+'" style="width:36px;height:36px;object-fit:contain;border-radius:4px;background:rgba(255,255,255,0.06)" onerror="this.style.display=\'none\'">';
    html+='<div style="flex:1;min-width:0">';
    html+='<div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+icon+' '+nameDisplay+'</div>';
    html+='<div style="display:flex;align-items:center;gap:6px;margin-top:2px">'+qtyInfo+'</div>';
    html+='</div>';
    html+='<div style="text-align:right">'+slotBadge+'<div style="font-size:9px;color:var(--dim);font-family:var(--mono);margin-top:2px">'+r.did+'</div></div>';
    html+='</div></div>';
  });
  return html;
}

function filterSetCheck(mode){
  const results=window._setCheckResults||[];
  let filtered;
  if(mode==='missing')filtered=results.filter(r=>!r.match);
  else if(mode==='low')filtered=results.filter(r=>r.match&&!r.enough);
  else if(mode==='ok')filtered=results.filter(r=>r.enough);
  else filtered=results;
  document.getElementById('sc-parts-list').innerHTML=renderSetCheckParts(filtered);
  document.querySelectorAll('[id^="sc-f-"]').forEach(b=>{b.style.background='';b.style.color=''});
  const btn=document.getElementById('sc-f-'+mode);
  if(btn){btn.style.background='var(--accent)';btn.style.color='#111'}
}

async function handlePartIdBatch(){
  const input=document.getElementById('part-id-input'),raw=input.value.trim();if(!raw){input.focus();return}
  const ids=raw.split(/[\s,，、]+/).map(s=>s.trim()).filter(s=>s.length>0);input.value='';if(!ids.length)return;
  if(ids.length===1){await handleSinglePartId(ids[0]);return}
  currentImageData=null;batchCancelled=false;batchRunning=true;
  batchQueue=ids.map((id,i)=>({id:i,file:{name:id},status:'pending',result:null,error:null,name:id}));
  showScreen('s-batch');document.getElementById('batch-back-btn').textContent='✕ 取消';document.getElementById('batch-done-panel').style.display='none';
  renderBatchList();updateBatchProgress(0,ids.length);
  let done=0,errors=0;
  for(let idx=0;idx<ids.length;idx++){
    if(batchCancelled)break;const partId=ids[idx],item=batchQueue[idx];item.status='processing';renderBatchList();
    try{
      let rbResult=cfg.rbKey?await rebrickableLookup(partId):null;const did=rbResult?.designId||partId;
      const rbHint=rbResult?'此零件已確認為「'+rbResult.name+'」Design ID='+did+'。':'';
      const prompt='你是LEGO零件專家。'+rbHint+'零件編號「'+did+'」。回應純JSON：{"design_id":"'+did+'","name":"英文名","name_cn":"中文名","bricklink_category":"BrickLink分類","description":"30字描述","feature_tags":["1~3個,限選:'+LEGO_TAGS+'"],"dim_mm_w":寬mm數,"dim_mm_l":長mm數,"dim_mm_h":高mm數,"is_oversize":bool}';
      const textResp=await callGeminiAPI(prompt,null,0,GEMINI_LEGO_SYSTEM);const parsed=safeParseJSON(textResp);
      const designId=parsed.design_id||did,baseId=getBaseDesignId(designId);
      const thumbnailUrl=(rbResult?.imgUrl)||(baseId?'https://cdn.rebrickable.com/media/parts/ldraw/7/'+baseId+'.png':'');
      const vol=calcVolFromAI(parsed.name||'',parsed);
      let match=allItems.find(i=>(i.designId||'').toLowerCase()===designId.toLowerCase());
      if(!match&&baseId)match=allItems.find(i=>getBaseDesignId(i.designId)===baseId);
      let slotInfo;if(match)slotInfo={slot:match.slot,slotType:match.slotType||'small'};else slotInfo=gatewayAssign({...parsed,estimateVolumeMl:vol,quantity:1,featureTags:parsed.feature_tags||[],dimW:parsed._dimW||0,dimL:parsed._dimL||0,dimH:parsed._dimH||0});
      const now=Date.now();
      const savedItem={name:parsed.name||'',nameCN:parsed.name_cn||'',designId,description:parsed.description||'',featureTags:parsed.feature_tags||[],bricklinkCategory:normalizeCategory(parsed.bricklink_category||''),estimateVolumeMl:vol,slot:slotInfo.slot,slotType:slotInfo.slotType||'small',thumbnailUrl,imageData:'',quantity:1,dimW:parsed._dimW||0,dimL:parsed._dimL||0,dimH:parsed._dimH||0,id:match?match.id:'lego_'+now+'_'+Math.random().toString(36).slice(2,5),createdAt:match?(match.createdAt||now):now,updatedAt:now};
if(match){Object.assign(match,savedItem);markDirty(match.id)}else{allItems.unshift(savedItem);markDirty(savedItem.id)}
      await fbSaveItem(savedItem);item.result=savedItem;item.status='done';done++;
    }catch(err){item.error=err.message;item.status='error';errors++}
    renderBatchList();updateBatchProgress(done+errors,ids.length);if(!batchCancelled)await new Promise(r=>setTimeout(r,1500));
  }
  batchRunning=false;document.getElementById('batch-back-btn').textContent='← 返回';
  document.getElementById('batch-done-panel').style.display='block';
  document.getElementById('batch-done-icon').textContent=errors===0?'✓':'⚠';
  document.getElementById('batch-done-text').textContent=batchCancelled?'已取消':'完成！共建檔 '+done+' 件';
  document.getElementById('batch-done-sub').textContent=errors>0?'失敗 '+errors+' 件':'所有零件已儲存';
  renderStats();applyFilter();
}

async function handleSinglePartId(id){
  currentImageData=null;showScreen('s-processing');setProcessingMsg('查詢零件 '+id+'…');
  let rbResult=cfg.rbKey?await rebrickableLookup(id):null;if(rbResult)id=rbResult.designId||id;
  try{const existingList=await buildExistingList();
    const rbHint=rbResult?'此零件已確認為「'+rbResult.name+'」。':'';
    const prompt='你是LEGO零件專家。'+rbHint+'零件編號「'+id+'」。回應純JSON：{"design_id":"'+id+'","name":"英文名","name_cn":"中文名","bricklink_category":"BrickLink分類","description":"30字描述","feature_tags":["1~3個,限選:'+LEGO_TAGS+'"],"dim_mm_w":寬mm數,"dim_mm_l":長mm數,"dim_mm_h":高mm數,"is_oversize":bool,"matched_existing_id":"同外型零件id或null。已有:'+existingList+'"}';
    const textResp=await callGeminiAPI(prompt,null,0,GEMINI_LEGO_SYSTEM);const item=safeParseJSON(textResp);
    if(rbResult?.imgUrl)window._pendingRbImgUrl=rbResult.imgUrl;
    if(window._bsKeepFullId){item._keepFullId=true;item._skipMoldCheck=true;window._bsKeepFullId=false}
    if(!(await _v20beChoiceThenProcess(item))){return;} await processResult(item);
  }catch(err){showTab('main');showToast('查詢失敗：'+err.message,'error')}
}

async function processResult(item){
  setProcessingMsg('分配收納位置…');
  let match=null;const did=(item.design_id||'').toLowerCase();
  if(item.matched_existing_id&&item.matched_existing_id!=='null')match=allItems.find(i=>i.id===item.matched_existing_id);
  if(!match&&did)match=allItems.find(i=>(i.designId||'').toLowerCase()===did);
  if(!match){const baseDid=getBaseDesignId(item.design_id);if(baseDid)match=allItems.find(i=>getBaseDesignId(i.designId)===baseDid)}
  // Variant check: 3062 vs 3062b — ask user
  if(!match){const numBase=getNumericBase(item.design_id);if(numBase){
    const candidate=allItems.find(i=>{const iBase=getNumericBase(i.designId);return iBase===numBase&&(i.designId||'').toLowerCase()!==(item.design_id||'').toLowerCase()});
    if(candidate){
      const newImg=currentImageData||window._pendingRbImgUrl||(item.design_id?'https://cdn.rebrickable.com/media/parts/ldraw/7/'+getBaseDesignId(item.design_id)+'.png':'');
      const yes=await showVariantConfirm(item.design_id,item.name_cn||item.name||'',newImg,candidate);
      if(yes)match=candidate;
    }
  }}
  // Mold variant check via Rebrickable (e.g. 4589 → 59900)
  if(!match&&item.design_id&&!item._skipMoldCheck){
    setProcessingMsg('🔍 模具變體查詢…');
    const moldMatch=await findByMoldVariant(item.design_id);
    if(moldMatch){
      if(moldMatch._altIdMatch){match=moldMatch;delete moldMatch._altIdMatch}
      else{
        const newImg=currentImageData||window._pendingRbImgUrl||(item.design_id?'https://cdn.rebrickable.com/media/parts/ldraw/7/'+getBaseDesignId(item.design_id)+'.png':'');
        const yes=await showVariantConfirm(item.design_id,item.name_cn||item.name||'',newImg,moldMatch);
        if(yes)match=moldMatch;
      }
    }
  }
  const designId=item.design_id||'';
  // Thumbnail priority: Rebrickable API → matched item's existing thumbnail → Lens crop → empty
  const thumbnailUrl=(item.lens_summary&&typeof currentImageData==='string'&&currentImageData.indexOf('data:')===0&&(!match||!match.thumbnailUrl||match.thumbnailUrl.indexOf('cdn.rebrickable.com')>=0||match.thumbnailUrl.indexOf('img.bricklink.com')>=0))?currentImageData:(window._pendingRbImgUrl||(match?match.thumbnailUrl:'')||'');window._pendingRbImgUrl='';
  const vol=calcVolFromAI(item.name||item.name_cn||'',item);
  const seriesTag=item.series_tag||detectSeriesFromDesignId(item.design_id||'')||detectSeriesFromText({name:item.name,nameCN:item.name_cn,description:item.description})||'';
  const characterTag=item.character_tag||'';
  // === v17u: 同步取得 Rebrickable 熱門度，再做分派 (確保 isFrequent 正確) ===
  // 只對新物品查詢 (match 已有資料)
  let freqInfo=null;
  if(!match && designId){
    try{
      // 顯示暫時 banner 提示正在查詢
      document.getElementById('result-slot').textContent='查詢熱門度中...';
      freqInfo=await checkFrequentAndSuggest({designId, rebrickableSets:null});
    }catch(e){console.warn('Rebrickable 查詢失敗:', e)}
  }
  const baseItem={...item,estimateVolumeMl:vol,quantity:1,featureTags:item.feature_tags||[],dimW:item._dimW||0,dimL:item._dimL||0,dimH:item._dimH||0,seriesTag,characterTag,designId};
  if(freqInfo){
    baseItem.rebrickableSets=freqInfo.rebrickableSets;
    baseItem.isFrequent=freqInfo.isFrequent;
  }
  let slotInfo;
if(item._keepFullId){match=null}
    if(match){
    // 已存在物品: 保留原位置 (包含 pickup/overflow)
    slotInfo={slot:match.slot,slotType:match.slotType||'small',pickupSlot:match.pickupSlot||'',pickupType:match.pickupType||'',pickupQty:match.pickupQty||0,overflowSlot:match.overflowSlot||'',overflowQty:match.overflowQty||0};
  } else {
    slotInfo=gatewayAssign(baseItem);
    // Handle manual-needed fallback (常用零件找不到抽屜)
    if(slotInfo._needsManual){
      const vt=vol*1;
      const catGroup=getCatGroup(baseItem.featureTags||[],normalizeCategory(item.bricklink_category||''));
      const fb=assignToBag(vt,catGroup,characterTag||null,seriesTag||null);
      slotInfo={slot:fb.slot,slotType:fb.slotType,_manualReason:slotInfo._reason};
    }
  }
  pendingPart={...item,...slotInfo,designId,thumbnailUrl,dimW:item._dimW||0,dimL:item._dimL||0,dimH:item._dimH||0,featureTags:item.feature_tags||[],bricklinkCategory:item.bricklink_category||'',estimateVolumeMl:vol,imageData:currentImageData||'',nameCN:item.name_cn||'',seriesTag,characterTag,isUpdate:!!match,matchedId:match?match.id:null};
  if(freqInfo){
    pendingPart.rebrickableSets=freqInfo.rebrickableSets;
    pendingPart.isFrequent=freqInfo.isFrequent;
  }
  // Render — use Lens crop as visual fallback if no thumbnail URL
  const resultImg=document.getElementById('result-img');
  resultImg.dataset.fb=currentImageData||'';
  resultImg.src=thumbnailUrl||currentImageData||'';
  document.getElementById('result-name').textContent=item.name_cn||item.name||'未知零件';
  document.getElementById('result-designid').textContent=designId?'Design ID: '+designId:'';
  document.getElementById('result-desc').textContent=item.description||'';
  const lensEl=document.getElementById('result-lens-summary');
  if(item.lens_summary&&lensEl){
    lensEl.textContent='🔍 Lens: '+item.lens_summary;
    lensEl.style.display='';
  }else if(lensEl){lensEl.style.display='none'}
  document.getElementById('result-tags').innerHTML=(item.feature_tags||[]).map(t=>'<span class="tag">'+t+'</span>').join('');
  // Series + character badges
  const badgeHtml=[];
  if(seriesTag)badgeHtml.push('<span style="display:inline-block;background:var(--accent);color:#111;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;margin-right:4px">🎬 '+seriesTag+'</span>');
  if(characterTag)badgeHtml.push('<span style="display:inline-block;background:var(--green);color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">🎭 '+characterTag+'</span>');
  document.getElementById('result-series-char').innerHTML=badgeHtml.join('');
  document.getElementById('result-volume').textContent='佔位體積 ≈ '+vol+'ml';
  document.getElementById('result-slot').textContent=slotInfo.slot;
  const isCompleteMF=item.is_complete_minifig;
  document.getElementById('result-slot-type').textContent=isCompleteMF?'🧑 完整人偶 → 收納袋':slotInfo.slotType==='large'?'大抽屜':slotInfo.slotType==='bag'?'收納袋':'小抽屜分格';
  renderMiniMap(slotInfo.slot);
  const banner=document.getElementById('match-banner');
  if(match){banner.style.display='block';banner.innerHTML='<div style="font-size:13px;font-weight:700;color:var(--green)">✓ 找到相同外型零件</div><div style="font-size:12px;color:var(--muted)">「'+(match.name||match.nameCN)+'」已在 '+match.slot+'</div>'}else{banner.style.display='none'}
  if(window._procTimer){clearInterval(window._procTimer);window._procTimer=null}
  // Reset buttons to default (catalog mode)
  document.getElementById('result-confirm-btn').textContent='✓ 確認儲存';
  document.getElementById('result-confirm-btn').onclick=()=>confirmPart();
  document.getElementById('result-cancel-btn').style.display='';
  document.getElementById('result-qty-row').style.display='none';
  // New item → always require dims confirmation (pre-fill with AI values if any, display in mm)
  if(!match){
    document.getElementById('rdim-w').value=pendingPart.dimW>0?Math.round(pendingPart.dimW*10):'';
    document.getElementById('rdim-l').value=pendingPart.dimL>0?Math.round(pendingPart.dimL*10):'';
    document.getElementById('rdim-h').value=pendingPart.dimH>0?Math.round(pendingPart.dimH*10):'';
    const hasAI=(pendingPart.dimW||0)>0&&(pendingPart.dimL||0)>0&&(pendingPart.dimH||0)>0;
    document.getElementById('rdim-hint').textContent=hasAI?'AI 估算：請確認或修正尺寸（mm）':'AI 未提供尺寸，請輸入（單位：公釐）';
    document.getElementById('result-dims-required').style.display='';
    document.getElementById('result-confirm-btn').style.display='none';
    document.getElementById('result-slot-override').style.display='none';
  }else{
    document.getElementById('result-dims-required').style.display='none';
    document.getElementById('result-confirm-btn').style.display='';
    document.getElementById('result-slot-override').style.display='';cancelSlotOverride();
  }
  // Frequent part banner: use pre-fetched freqInfo from sync call above
  const freqBanner=document.getElementById('frequent-banner');
  if(freqBanner){freqBanner.style.display='none';freqBanner.innerHTML=''}
  if(!match && freqBanner){
    if(pendingPart.isFrequent){
      let bannerHtml='⭐ <b>常用零件</b>（Rebrickable: '+pendingPart.rebrickableSets+' 盒組使用）<br>'+
        '<span style="font-size:11px;color:var(--muted)">已配抽屜快取位置</span>';
      if(pendingPart.pickupSlot){
        bannerHtml+='<br><span style="font-size:11px">✋ 快取: '+pendingPart.pickupSlot+' · '+pendingPart.pickupQty+' 件 · 主位: '+pendingPart.slot+'</span>';
      }
      if(pendingPart._manualReason){
        bannerHtml+='<br><span style="font-size:11px;color:var(--red)">⚠ '+pendingPart._manualReason+'，暫置袋內請手動調整</span>';
      }
      freqBanner.innerHTML=bannerHtml;
      freqBanner.style.display='';
    }
  }
  showScreen('s-result');
}

// Get top-N slots with most remaining capacity of a given type
// slotType: 'small' | 'large' | 'bag'
// Returns: [{slot, used, remaining, cap}]
function getTopEmptySlots(slotType, limit){
  limit=limit||5;
  const results=[];
  if(slotType==='small'){
    const maxD=parseInt((slotConfig.nextSmallSlot||'001a').replace(/[a-z]/g,''));
    for(let d=1;d<maxD;d++){
      const pad=String(d).padStart(3,'0');
      const plain=String(d);
      const fullOccupied=allItems.some(i=>{
        const s=i.slot||'',p=i.pickupSlot||'',o=i.overflowSlot||'';
        const parts=o?o.split(',').map(z=>z.trim()):[];
        return s===pad||s===plain||p===pad||p===plain||parts.indexOf(pad)>=0||parts.indexOf(plain)>=0;
      });
      if(fullOccupied) continue;
      ['a','b'].forEach(side=>{
        const slot=pad+side;
        // [v20ao] Skip half-slots claimed as pickup or overflow (even if vol=0)
        const halfClaimed=allItems.some(i=>{
          if(i.pickupSlot===slot)return true;
          const ov=i.overflowSlot||'';
          return ov===slot||ov.split(',').map(z=>z.trim()).indexOf(slot)>=0;
        });
        if(halfClaimed)return;
        const used=getSlotVol(slot);
        const cap=SLOT_ML;
        const remaining=cap-used;
        if(remaining>=5) results.push({slot,used:Math.round(used*10)/10,remaining:Math.round(remaining*10)/10,cap});
      });
    }
  }else if(slotType==='drawer'){
    const maxD=parseInt((slotConfig.nextSmallSlot||'001a').replace(/[a-z]/g,''));
    for(let d=1;d<=Math.min(maxD,450);d++){
      const pad=String(d).padStart(3,'0');
      const plain=String(d);
      const occupied=allItems.some(i=>{
        const s=i.slot||'',p=i.pickupSlot||'',o=i.overflowSlot||'';
        const parts=o?o.split(',').map(z=>z.trim()):[];
        const candidates=[pad,plain,pad+'a',pad+'b',plain+'a',plain+'b'];
        return candidates.some(x=>s===x||p===x||parts.indexOf(x)>=0);
      });
      if(!occupied){
        results.push({slot:pad,used:0,remaining:DRAWER_ML,cap:DRAWER_ML});
      }
    }
  }
  results.sort((a,b)=>b.remaining-a.remaining);
  return results.slice(0,limit);
}

function showSlotOverride(){
  if(!pendingPart)return;
  const current=pendingPart.slot||'?';
  const el=document.getElementById('result-slot-override');
  el.innerHTML=`
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px;margin-top:8px" onclick="event.stopPropagation()">
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px">變更收納位置（目前：${current}）</div>
      <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
        <button class="btn btn-sm" onclick="event.stopPropagation();showOverrideList('bag')" style="font-size:12px;flex:1">📦 收納袋</button>
        <button class="btn btn-sm" onclick="event.stopPropagation();showOverrideList('small')" style="font-size:12px;flex:1">🗄 小抽屜</button>
      </div>
      <div id="override-list" style="margin-bottom:8px"></div>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="text" id="slot-override-input" placeholder="手動輸入（如 B01、420a、L05）" value="" onclick="event.stopPropagation()" style="flex:1;background:var(--card);border:1px solid var(--border);color:var(--text);padding:8px;border-radius:8px;font-size:13px;font-family:var(--mono)">
        <button class="btn btn-green btn-sm" onclick="event.stopPropagation();applySlotOverrideManual()" style="font-size:12px;padding:8px 12px">✓</button>
      </div>
      <button class="btn btn-sm" onclick="event.stopPropagation();cancelSlotOverride()" style="margin-top:6px;font-size:11px;width:100%">取消</button>
    </div>`;
}

function showOverrideList(slotType){
  const topSlots=getTopEmptySlots(slotType,5);
  const listEl=document.getElementById('override-list');
  if(!listEl)return;
  let html='<div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px;margin-top:4px">';
  html+='<div style="font-size:11px;color:var(--muted);margin-bottom:6px">Top 5 最空'+(slotType==='small'?'小抽屜分格':slotType==='large'?'大抽屜':'收納袋')+' (點選直接套用)：</div>';
  if(!topSlots.length){
    html+='<div style="font-size:12px;color:var(--muted);text-align:center;padding:8px">無可用位置，請用下方手動輸入新的</div>';
  }else{
    topSlots.forEach(s=>{
      const pct=Math.round(s.used/s.cap*100);
      const bar='<div style="width:30%;height:4px;background:var(--border);border-radius:2px;overflow:hidden;margin-top:2px"><div style="width:'+pct+'%;height:100%;background:'+(pct>80?'var(--red)':pct>50?'var(--orange)':'var(--green)')+'"></div></div>';
      html+='<div onclick="event.stopPropagation();pickOverrideSlot(\''+s.slot+'\',\''+slotType+'\')" style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:var(--surface);border-radius:6px;margin-bottom:4px;cursor:pointer" onmouseover="this.style.background=\'var(--accent-bg)\'" onmouseout="this.style.background=\'var(--surface)\'">';
      html+='<span style="font-family:var(--mono);font-weight:700;color:var(--accent)">'+s.slot+'</span>';
      html+='<span style="font-size:11px;color:var(--muted)">餘 '+s.remaining+'ml / '+s.cap+'ml</span>';
      html+='</div>';
    });
    // "New slot" option
    if(slotType==='small'){
      const newSlot=(slotConfig.nextSmallSlot||'001a');
      html+='<div onclick="event.stopPropagation();pickOverrideSlot(\''+newSlot+'\',\'small\')" style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:var(--green-bg);border:1px dashed var(--green);border-radius:6px;cursor:pointer"><span style="font-family:var(--mono);font-weight:700;color:var(--green)">✨ '+newSlot+'</span><span style="font-size:11px;color:var(--muted)">新抽屜（全空）</span></div>';
    }else if(slotType==='bag'){
      const newSlot=(slotConfig.nextBagSlot||'B01');
      html+='<div onclick="event.stopPropagation();pickOverrideSlot(\''+newSlot+'\',\'bag\')" style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:var(--green-bg);border:1px dashed var(--green);border-radius:6px;cursor:pointer"><span style="font-family:var(--mono);font-weight:700;color:var(--green)">✨ '+newSlot+'</span><span style="font-size:11px;color:var(--muted)">新收納袋（全空）</span></div>';
    }
  }
  html+='</div>';
  listEl.innerHTML=html;
}

function pickOverrideSlot(slot,slotType){
  if(!pendingPart)return;
  pendingPart.slot=slot;pendingPart.slotType=slotType;
  pendingPart.overflowSlot='';pendingPart.overflowQty=0;
  // If this is a new slot, advance the pointer
  if(slotType==='small'&&slot===(slotConfig.nextSmallSlot||'')){
    const num=parseInt(slot.replace(/[a-z]/g,''));
    slotConfig.nextSmallSlot=String(num+1).padStart(3,'0')+'a';
    markDirty('__config__');
  }else if(slotType==='bag'&&slot===(slotConfig.nextBagSlot||'')){
    slotConfig.nextBagSlot=advanceBag(slot);
    markDirty('__config__');
  }
  document.getElementById('result-slot').textContent=slot;
  document.getElementById('result-slot-type').textContent=slotType==='large'?'大抽屜':slotType==='bag'?'收納袋':'小抽屜分格';
  cancelSlotOverride();
  renderMiniMap(slot,slotType);
  showToast('已選 '+slot);
}
function pasteResultDims(){
  pasteFromClipboard(function(text){
    const m=text.match(/([\d.]+)\s*[x×X]\s*([\d.]+)\s*[x×X]\s*([\d.]+)/);
    if(!m){showToast('格式錯誤，需要 W x L x H','error');return}
    // Auto-detect: if any value < 10, assume it was cm — convert to mm
    let w=parseFloat(m[1]),l=parseFloat(m[2]),h=parseFloat(m[3]);
    if(w<10&&l<10&&h<10){w*=10;l*=10;h*=10}  // cm → mm
    document.getElementById('rdim-w').value=Math.round(w);
    document.getElementById('rdim-l').value=Math.round(l);
    document.getElementById('rdim-h').value=Math.round(h);
    showToast('已貼上尺寸 '+Math.round(w)+'×'+Math.round(l)+'×'+Math.round(h)+' mm');
  });
}
function applyResultDims(){
  if(!pendingPart)return;
  // Inputs are in mm (consistent with editor modal), internal storage is cm
  const w=parseFloat(document.getElementById('rdim-w').value)||0;
  const l=parseFloat(document.getElementById('rdim-l').value)||0;
  const h=parseFloat(document.getElementById('rdim-h').value)||0;
  if(w<=0||l<=0||h<=0){showToast('請輸入完整尺寸（寬×長×高 mm）','error');return}
  // Store as cm (divide by 10)
  pendingPart.dimW=w/10;pendingPart.dimL=l/10;pendingPart.dimH=h/10;
  // Volume: w*l*h mm³ / 1000 = ml
  pendingPart.estimateVolumeMl=Math.round(w*l*h/1000*10)/10;
  // Re-assign slot with correct dims
  const slotInfo=gatewayAssign(pendingPart);
  pendingPart.slot=slotInfo.slot;pendingPart.slotType=slotInfo.slotType;
  document.getElementById('result-slot').textContent=slotInfo.slot;
  document.getElementById('result-slot-type').textContent=slotInfo.slotType==='large'?'大抽屜':slotInfo.slotType==='bag'?'收納袋':'小抽屜分格';
  document.getElementById('result-volume').textContent='佔位體積 ≈ '+pendingPart.estimateVolumeMl+'ml';
  renderMiniMap(slotInfo.slot,slotInfo.slotType);
  // Hide dims prompt, show confirm button
  document.getElementById('result-dims-required').style.display='none';
  document.getElementById('result-confirm-btn').style.display='';
  document.getElementById('result-slot-override').style.display='';cancelSlotOverride();
  showToast('尺寸 '+w+'×'+l+'×'+h+'mm → '+slotInfo.slot);
}
function cancelSlotOverride(){
  document.getElementById('result-slot-override').innerHTML='<button class="btn btn-sm" onclick="event.stopPropagation();showSlotOverride()" style="font-size:11px;padding:4px 10px">✏️ 變更收納位置</button>';
}
function applySlotOverride(type){
  if(!pendingPart)return;
  const cg=getCatGroup(pendingPart.featureTags||[],normalizeCategory(pendingPart.bricklinkCategory||''));
  const vol=(pendingPart.estimateVolumeMl||2)*(pendingPart.quantity||1);
  const charTag=pendingPart.characterTag||null;
  const seriesTag=pendingPart.seriesTag||detectSeries(pendingPart)||null;
  let slot,slotType;
  if(type==='bag'){
    const r=assignToBag(vol,cg,charTag,seriesTag);slot=r.slot;slotType='bag';
  }else if(type==='large'){
    // Find first available large drawer
    const usedL=new Set(allItems.filter(i=>i.slotType==='large').map(i=>i.slot));
    for(let n=1;n<=LARGE_COUNT;n++){const l='L'+String(n).padStart(2,'0');if(!usedL.has(l)){slot=l;break}}
    if(!slot){showToast('大抽屜已滿，改分配到收納袋','warn');const r=assignToBag(vol,cg,charTag,seriesTag);slot=r.slot;slotType='bag'}
    else slotType='large';
  }else{
    const r=gatewayAssign(pendingPart);slot=r.slot;slotType=r.slotType;
  }
  pendingPart.slot=slot;pendingPart.slotType=slotType;
  // Manual override = move ALL to new slot, clear overflow
  pendingPart.overflowSlot='';pendingPart.overflowQty=0;
  document.getElementById('result-slot').textContent=slot;
  document.getElementById('result-slot-type').textContent=slotType==='large'?'大抽屜':slotType==='bag'?'收納袋':'小抽屜分格';
  cancelSlotOverride();
  // [v20ba] Firebase write for existing items (Top5)
  const existItem=allItems.find(i=>i.designId===(pendingPart.designId||pendingPart.design_id));
  if(existItem&&existItem.id){
    existItem.slot=slot;existItem.slotType=slotType;existItem.overflowSlot='';existItem.overflowQty=0;
    fetch('https://firestore.googleapis.com/v1/projects/'+cfg.fbProject+'/databases/(default)/documents/'+cfg.fbCol+'/'+existItem.id+'?updateMask.fieldPaths=slot&updateMask.fieldPaths=slotType&updateMask.fieldPaths=overflowSlot&updateMask.fieldPaths=overflowQty&key='+cfg.fbApiKey,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:{slot:{stringValue:slot},slotType:{stringValue:slotType},overflowSlot:{stringValue:''},overflowQty:{integerValue:0}}})})
    .then(r=>{if(r.ok)showToast('\u2705 '+existItem.designId+' \u5DF2\u79FB\u52D5\u5230 '+slot);else showToast('\u5BEB\u5165\u5931\u6557','error')});
  }else{showToast('\u2705 \u4F4D\u7F6E\u5DF2\u8B8A\u66F4\u70BA '+slot)}
  renderMiniMap(slot,slotType);
}
function applySlotOverrideManual(){
  if(!pendingPart)return;
  const val=(document.getElementById('slot-override-input').value||'').trim();
  if(!val){showToast('請輸入收納位置','error');return}
  let slotType='small';
  if(/^B\d+$/i.test(val))slotType='bag';
  else if(/^L\d+$/i.test(val)){
    slotType='large';
    const n=parseInt(val.replace(/[^\d]/g,''));
    if(n<1||n>27){showToast('大抽屜編號超出範圍 (L01-L27)','error');return}
  }
  else if(/^\d+[ab]?$/.test(val)){
    slotType='small';
    const n=parseInt(val.replace(/[a-z]/g,''));
    if(n<1||n>450){showToast('小抽屜編號超出範圍 (1-450)，超過請改用收納袋','error');return}
  }
  else{showToast('格式錯誤（例：B01、420a、L05）','error');return}
  pendingPart.slot=val;pendingPart.slotType=slotType;
  // Manual override = move ALL to new slot, clear overflow
  pendingPart.overflowSlot='';pendingPart.overflowQty=0;
  document.getElementById('result-slot').textContent=val;
  const isFullDrawer=slotType==='small'&&/^\d+$/.test(val);
  document.getElementById('result-slot-type').textContent=slotType==='large'?'大抽屜':slotType==='bag'?'收納袋':isFullDrawer?'小抽屜（整格 a+b）':'小抽屜分格';
  cancelSlotOverride();
  // [v20ba] Firebase write for existing items (Manual)
  const existingItem=allItems.find(i=>i.designId===(pendingPart.designId||pendingPart.design_id));
  if(existingItem&&existingItem.id){
    existingItem.slot=val;existingItem.slotType=slotType;existingItem.overflowSlot='';existingItem.overflowQty=0;
    fetch('https://firestore.googleapis.com/v1/projects/'+cfg.fbProject+'/databases/(default)/documents/'+cfg.fbCol+'/'+existingItem.id+'?updateMask.fieldPaths=slot&updateMask.fieldPaths=slotType&updateMask.fieldPaths=overflowSlot&updateMask.fieldPaths=overflowQty&key='+cfg.fbApiKey,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:{slot:{stringValue:val},slotType:{stringValue:slotType},overflowSlot:{stringValue:''},overflowQty:{integerValue:0}}})})
    .then(r=>{if(r.ok)showToast('\u2705 '+existingItem.designId+' \u5DF2\u79FB\u52D5\u5230 '+val);else showToast('\u5BEB\u5165\u5931\u6557','error')});
  }else{showToast('\u2705 \u4F4D\u7F6E\u5DF2\u8B8A\u66F4\u70BA '+val)}
  renderMiniMap(val,slotType);
}

async function confirmPart(){
  if(!pendingPart)return;
  const now=Date.now();
  const item={name:pendingPart.name||'',nameCN:pendingPart.nameCN||pendingPart.name_cn||'',designId:pendingPart.designId||'',description:pendingPart.description||'',featureTags:pendingPart.featureTags||[],bricklinkCategory:normalizeCategory(pendingPart.bricklinkCategory||''),estimateVolumeMl:pendingPart.estimateVolumeMl||2,slot:pendingPart.slot,slotType:pendingPart.slotType||'small',dimW:pendingPart.dimW||0,dimL:pendingPart.dimL||0,dimH:pendingPart.dimH||0,is_complete_minifig:pendingPart.is_complete_minifig||false,seriesTag:pendingPart.seriesTag||'',characterTag:pendingPart.characterTag||'',brickognizeName:pendingPart._brickognize?.name||pendingPart.brickognizeName||'',thumbnailUrl:pendingPart.thumbnailUrl||'',imageData:pendingPart.imageData||'',altIds:pendingPart.altIds||[],lens_summary:pendingPart.lens_summary||'',rebrickableSets:(typeof pendingPart.rebrickableSets==='number'?pendingPart.rebrickableSets:null),isFrequent:pendingPart.isFrequent||false,pickupSlot:pendingPart.pickupSlot||'',pickupType:pendingPart.pickupType||'',pickupQty:pendingPart.pickupQty||0,overflowSlot:pendingPart.overflowSlot||'',overflowQty:pendingPart.overflowQty||0,isCustom:pendingPart.isCustom||false,quantity:1,updatedAt:now};
  if(pendingPart.isUpdate&&pendingPart.matchedId){
    item.id=pendingPart.matchedId;const existing=allItems.find(i=>i.id===item.id);
    item.createdAt=existing?.createdAt||now;item.quantity=(existing?.quantity||1)+1;
    item.altIds=existing?.altIds||[];
    if(existing)Object.assign(existing,item);
    // Auto-overflow check after qty+1
    const ovResult=autoOverflowCheck(existing||item);
    if(ovResult){showToast('已更新 +1 → 溢出 '+ovResult.overQty+' 件到 '+ovResult.bagSlot)}
    else{showToast('已更新：'+item.slot+'（數量 +1）')}
  }else{
    item.id='lego_'+now+'_'+Math.random().toString(36).slice(2,5);item.createdAt=now;allItems.unshift(item);showToast('已儲存到 '+item.slot);
    // Fetch altIds for new item (background, non-blocking)
    if(item.designId){fetchAndSaveAltIds(item)}
  }
  markDirty(item.id);await fbSaveItem(item);
  pendingPart=null;currentImageData=null;showTab('main');renderStats();applyFilter();
}

// Background: fetch mold variants from Rebrickable and save as altIds
async function fetchAndSaveAltIds(item){
  try{
    const variants=await getMoldVariants(item.designId);
    if(variants.length)saveAltIds(item,variants);
  }catch(e){}
}
function openResultItem(){
  if(pendingPart&&pendingPart.matchedId){
    openItem(pendingPart.matchedId);
  }else{
    showToast('新零件，儲存後才能查看詳情');
  }
}
function cancelResult(){pendingPart=null;currentImageData=null;if(window._procTimer){clearInterval(window._procTimer);window._procTimer=null}goBack()}
// ═══════════════════════════════════════════════════
// STOCKTAKE (清點庫存)
// ═══════════════════════════════════════════════════
let _stItems=[],_stIdx=0,_stSaved=0,_stChanged=0;

function showStocktakeSetup(){
  const overlay=document.getElementById('stocktake-setup');
  overlay.style.display='flex';
  // Update zone change handler
  document.querySelectorAll('input[name="st-zone"]').forEach(r=>r.onchange=onStZoneChange);
  onStZoneChange();
}
function hideStocktakeSetup(){document.getElementById('stocktake-setup').style.display='none'}

function onStZoneChange(){
  const zone=document.querySelector('input[name="st-zone"]:checked').value;
  const sideField=document.getElementById('st-side-field');
  sideField.style.display=zone==='small'?'block':'none';
  // Auto-set range
  const toInput=document.getElementById('st-to');
  if(zone==='small')toInput.value='450';
  else if(zone==='large')toInput.value='27';
  else{
    let maxBag=1;allItems.forEach(i=>{const m=(i.slot||'').match(/^B(\d+)$/);if(m)maxBag=Math.max(maxBag,parseInt(m[1]))});
    toInput.value=maxBag;
  }
  document.getElementById('st-from').value='1';
  updateStSetupCount();
}

function updateStSetupCount(){
  const items=getStocktakeItems();
  document.getElementById('st-setup-count').textContent='共 '+items.length+' 個零件待清點';
}

function getStocktakeItems(){
  const zone=document.querySelector('input[name="st-zone"]:checked').value;
  const side=zone==='small'?(document.querySelector('input[name="st-side"]:checked')?.value||'all'):'all';
  const from=parseInt(document.getElementById('st-from').value)||1;
  const to=parseInt(document.getElementById('st-to').value)||999;

  return allItems.filter(item=>{
    const slot=item.slot||'';
    if(zone==='small'){
      const m=slot.match(/^(\d+)([ab])$/);
      if(!m)return false;
      const num=parseInt(m[1]),face=m[2];
      if(num<from||num>to)return false;
      if(side!=='all'&&face!==side)return false;
      return true;
    }else if(zone==='large'){
      const m=slot.match(/^L(\d+)$/);
      if(!m)return false;
      const num=parseInt(m[1]);
      return num>=from&&num<=to;
    }else{
      const m=slot.match(/^B(\d+)$/);
      if(!m)return false;
      const num=parseInt(m[1]);
      return num>=from&&num<=to;
    }
  }).sort((a,b)=>{
    const sa=a.slot||'',sb=b.slot||'';
    // Natural sort by slot
    const na=sa.match(/\d+/),nb=sb.match(/\d+/);
    if(na&&nb){
      const diff=parseInt(na[0])-parseInt(nb[0]);
      if(diff!==0)return diff;
    }
    return sa.localeCompare(sb);
  });
}

function startStocktake(){
  _stItems=getStocktakeItems();
  if(!_stItems.length){showToast('該範圍沒有零件','error');return}
  _stIdx=0;_stSaved=0;_stChanged=0;
  hideStocktakeSetup();
  showScreen('s-stocktake');
  renderStocktakeItem();
}

function renderStocktakeItem(){
  if(_stIdx>=_stItems.length){finishStocktake();return}
  const item=_stItems[_stIdx];
  const thumb=item.thumbnailUrl||item.imageData||'';
  const img=document.getElementById('st-img');
  img.dataset.fb=item.imageData||'';
  img.src=thumb;
  document.getElementById('st-name').textContent=item.nameCN||item.name||'未知零件';
  document.getElementById('st-ids').textContent=(item.designId?'ID: '+item.designId+' · ':'')+item.slot+' · '+(item.slotType||'small');
  document.getElementById('st-desc').textContent=item.description||'';
  document.getElementById('st-tags').innerHTML=(item.featureTags||[]).map(t=>'<span class="tag">'+t+'</span>').join('');
  const w=(item.dimW||0)*10,l=(item.dimL||0)*10,h=(item.dimH||0)*10;
  const volStr=w>0&&l>0&&h>0?w+'×'+l+'×'+h+'mm = '+(item.estimateVolumeMl||0)+'ml':'佔位體積 ≈ '+(item.estimateVolumeMl||0)+'ml';
  document.getElementById('st-vol').textContent=volStr;
  document.getElementById('st-qty').value=item.quantity||0;
  document.getElementById('st-diff').textContent='';
  document.getElementById('st-progress').textContent=(_stIdx+1)+'/'+_stItems.length+' ('+Math.round((_stIdx/_stItems.length)*100)+'%)';
  // Auto-focus and select the quantity input
  setTimeout(()=>{const q=document.getElementById('st-qty');q.focus();q.select()},200);
}

function saveAndNextStocktake(){
  const item=_stItems[_stIdx];
  const newQty=parseInt(document.getElementById('st-qty').value)||0;
  const oldQty=item.quantity||0;
  if(newQty!==oldQty){
    item.quantity=newQty;
    item.updatedAt=Date.now();
    markDirty(item.id);
    fbSaveItem(item).catch(()=>{});
    _stChanged++;
  }
  _stSaved++;_stIdx++;
  renderStocktakeItem();
}

function skipStocktakeItem(){
  _stSaved++;_stIdx++;
  renderStocktakeItem();
}

function cancelStocktake(){
  if(_stChanged>0&&!confirm('已修改 '+_stChanged+' 個零件的數量，確定結束清點？'))return;
  showTab('main');renderStats();applyFilter();
}

function finishStocktake(){
  showTab('main');renderStats();applyFilter();
  showToast('✅ 清點完成！檢查 '+_stSaved+' 個，修改 '+_stChanged+' 個');
}

function cancelBatch(){if(batchRunning){batchCancelled=true}else showTab('main')}
function renderBatchList(){document.getElementById('batch-item-list').innerHTML=batchQueue.map(item=>'<div class="item-row" style="border-left:3px solid '+(item.status==='done'?'var(--green)':item.status==='error'?'var(--red)':item.status==='processing'?'var(--accent)':'var(--border)')+'"><div class="item-info"><div class="item-name">'+item.name+'</div><div class="item-meta">'+(item.status==='done'?'✅ '+(item.result?.slot||''):(item.status==='error'?'❌ '+item.error:item.status==='processing'?'⏳ 處理中…':'⏸ 等待中'))+'</div></div></div>').join('')}
function updateBatchProgress(done,total){document.getElementById('batch-status-text').textContent=done+'/'+total;document.getElementById('batch-count-badge').textContent=Math.round(done/total*100)+'%';document.getElementById('batch-progress-bar').style.width=(done/total*100)+'%'}

// ═══════════════════════════════════════════════════
// SET IMPORT
// ═══════════════════════════════════════════════════
async function importSet(){
  let setNum=(document.getElementById('set-id-input')?.value||'').trim();if(!setNum){document.getElementById('set-id-input')?.focus();return}
  const key=cfg.rbKey||DEFAULT_RB_KEY;if(!key){showToast('請設定 Rebrickable API Key','error');return}
  document.getElementById('set-id-input').value='';if(!setNum.includes('-'))setNum+='-1';
  showScreen('s-processing');setProcessingMsg('查詢套組 '+setNum+'…');
  try{
    const setResp=await fetch('https://rebrickable.com/api/v3/lego/sets/'+setNum+'/?key='+key);if(!setResp.ok)throw new Error('找不到套組 '+setNum);const setInfo=await setResp.json();
    let allParts=[],page=1;while(true){setProcessingMsg('讀取零件清單 (第'+page+'頁)…');const resp=await fetch('https://rebrickable.com/api/v3/lego/sets/'+setNum+'/parts/?key='+key+'&page_size=500&page='+page);const data=await resp.json();allParts=allParts.concat(data.results||[]);if(!data.next)break;page++}
    const partMap={};allParts.forEach(r=>{const baseId=getBaseDesignId(r.part?.part_num)||r.part?.part_num||'';if(!baseId)return;const pName=(r.part?.name||'').toLowerCase();if(pName.includes('sticker')||(r.part?.part_cat_id===160))return;if(partMap[baseId]){partMap[baseId].quantity+=r.quantity;if(!partMap[baseId].imgUrl&&r.part?.part_img_url)partMap[baseId].imgUrl=r.part.part_img_url}else{partMap[baseId]={designId:baseId,name:r.part?.name||'',quantity:r.quantity||1,imgUrl:r.part?.part_img_url||''}}});
    const uniqueParts=Object.values(partMap),totalPieces=uniqueParts.reduce((s,p)=>s+p.quantity,0);
    setProcessingMsg('比對已建檔零件…');
    const existingIds=new Set();allItems.forEach(i=>{if(i.designId)existingIds.add(i.designId.toLowerCase());const base=getBaseDesignId(i.designId);if(base)existingIds.add(base.toLowerCase())});
    const newParts=uniqueParts.filter(p=>!existingIds.has(p.designId.toLowerCase()));
    const existingParts=uniqueParts.filter(p=>existingIds.has(p.designId.toLowerCase()));
    // Update existing qty
    for(const p of existingParts){const match=allItems.find(i=>{const base=getBaseDesignId(i.designId);return(i.designId||'').toLowerCase()===p.designId.toLowerCase()||(base&&base.toLowerCase()===p.designId.toLowerCase())});if(match){match.quantity=(match.quantity||0)+p.quantity;match.updatedAt=Date.now();markDirty(match.id);await fbSaveItem(match)}}
    const msg='套組：'+(setInfo.name||setNum)+'\n零件種類：'+uniqueParts.length+'種（共'+totalPieces+'件）\n已建檔：'+existingParts.length+'種（已累加數量）\n需建檔：'+newParts.length+'種\n\n開始建檔？';
    if(!confirm(msg)){showTab('main');return}
    if(newParts.length===0){showToast('已更新 '+existingParts.length+' 種零件數量！');showTab('main');renderStats();applyFilter();return}
    batchCancelled=false;batchRunning=true;batchQueue=newParts.map((p,i)=>({id:i,file:{name:p.designId+' '+p.name},status:'pending',result:null,error:null,name:p.designId+' '+p.name}));
    showScreen('s-batch');document.getElementById('batch-back-btn').textContent='✕ 取消';document.getElementById('batch-done-panel').style.display='none';renderBatchList();updateBatchProgress(0,newParts.length);
    let done=0,errors=0;
    for(let i=0;i<newParts.length;i++){
      if(batchCancelled)break;const p=newParts[i],item=batchQueue[i];item.status='processing';renderBatchList();
      let retries=0,success=false;
      while(retries<3&&!success){
        try{
          const prompt='LEGO零件「'+p.name+'」Design ID='+p.designId+'。回應純JSON：{"bricklink_category":"BrickLink分類","feature_tags":["1~3個,限選:'+LEGO_TAGS+'"],"dim_mm_w":寬mm數,"dim_mm_l":長mm數,"dim_mm_h":高mm數,"is_oversize":bool,"name_cn":"中文名","description":"15字描述"}';
          const textResp=await callGeminiAPI(prompt,null,0,GEMINI_LEGO_SYSTEM);const parsed=safeParseJSON(textResp);
          const baseId=getBaseDesignId(p.designId)||p.designId,thumbnailUrl=p.imgUrl||(baseId?'https://cdn.rebrickable.com/media/parts/ldraw/7/'+baseId+'.png':'');
          const vol=calcVolFromAI(p.name,parsed);
          const slotInfo=gatewayAssign({estimateVolumeMl:vol,quantity:p.quantity,featureTags:parsed.feature_tags||[],name:p.name,dimW:parsed._dimW||0,dimL:parsed._dimL||0,dimH:parsed._dimH||0});
          const now=Date.now();
          const savedItem={id:'lego_'+now+'_'+Math.random().toString(36).slice(2,5),name:p.name,nameCN:parsed.name_cn||'',designId:p.designId,description:parsed.description||'',dimW:parsed._dimW||0,dimL:parsed._dimL||0,dimH:parsed._dimH||0,featureTags:parsed.feature_tags||[],bricklinkCategory:normalizeCategory(parsed.bricklink_category||''),estimateVolumeMl:vol,slot:slotInfo.slot,slotType:slotInfo.slotType||'small',thumbnailUrl,imageData:'',quantity:p.quantity,createdAt:now,updatedAt:now,setSource:setNum};
    allItems.unshift(savedItem);markDirty(savedItem.id);await fbSaveItem(savedItem);item.result=savedItem;item.status='done';done++;success=true;
        }catch(err){
          retries++;
          if(retries<3){item.name=p.designId+' '+p.name+' (重試'+retries+')';renderBatchList();await new Promise(r=>setTimeout(r,3000*retries))}
          else{item.error=err.message;item.status='error';errors++}
        }
      }
      renderBatchList();updateBatchProgress(done+errors,newParts.length);if(!batchCancelled)await new Promise(r=>setTimeout(r,1500));
    }
    batchRunning=false;document.getElementById('batch-back-btn').textContent='← 返回';document.getElementById('batch-done-panel').style.display='block';
    document.getElementById('batch-done-icon').textContent=errors===0?'✓':'⚠';
    document.getElementById('batch-done-text').textContent=batchCancelled?'已取消':'套組匯入完成！';
    document.getElementById('batch-done-sub').textContent='新建 '+done+' 種，已有 '+existingParts.length+' 種'+(errors?'，失敗 '+errors+' 種':'');
    renderStats();applyFilter();
  }catch(err){showTab('main');showToast('匯入失敗：'+err.message,'error')}
}

async function startBatch(files){
  currentImageData=null;batchCancelled=false;batchRunning=true;
  batchQueue=files.map((f,i)=>({id:i,file:f,status:'pending',result:null,error:null,name:f.name,dataUrl:null}));
  showScreen('s-batch');document.getElementById('batch-back-btn').textContent='✕ 取消';document.getElementById('batch-done-panel').style.display='none';renderBatchList();updateBatchProgress(0,files.length);
  let done=0,errors=0;
  for(let idx=0;idx<files.length;idx++){
    if(batchCancelled)break;const item=batchQueue[idx];item.status='processing';renderBatchList();
    try{
      const dataUrl=await new Promise(r=>{const rd=new FileReader();rd.onload=e=>r(e.target.result);rd.readAsDataURL(item.file)});
      // Step 1: Crop thumbnail + text area
      currentImageData=await cropLensThumb(dataUrl);
      const thumbBase64=currentImageData.split(',')[1];
      const textCropDataUrl=await cropLensText(dataUrl);
      const textBase64=textCropDataUrl.split(',')[1];

      // Step 2: OCR text area
      item.name='📖 OCR…';renderBatchList();
      const ocrPrompt='讀取截圖中 Google Lens 的 AI 摘要文字。提取零件編號和名稱。回應純JSON：{"design_id":"完整零件編號(截圖上顯示什麼就輸出什麼，保留pb/pr/pat印刷後綴)","name":"英文名","name_cn":"中文名","lens_summary":"完整文字摘要(150字以內)"}';
      const ocrResp=await callGeminiAPI(ocrPrompt,textBase64,0);
      const ocr=safeParseJSON(ocrResp);
      const lensId=(ocr.design_id||'').replace(/[^a-zA-Z0-9]/g,'');
      const lensName=ocr.name||'';
      const lensNameCN=ocr.name_cn||'';
      const lensSummary=ocr.lens_summary||'';
      item.name=lensNameCN||lensName||lensId||'未知';renderBatchList();

      // Step 3: Classify with thumbnail
      const existingList=await buildExistingList();
      const classifyPrompt='分析這個零件圖片，結合 Google Lens 辨識結果進行分類。\n\n【Lens 辨識結果】\nDesign ID: '+lensId+'\n名稱: '+lensName+' ('+lensNameCN+')\n摘要: '+lensSummary+'\n\n【重要】design_id 和 name/name_cn 請直接使用上方 Lens 結果。你只需要判斷：bricklink_category、feature_tags、尺寸dim、is_oversize、is_complete_minifig、matched_existing_id。\n\n回應純JSON：{"design_id":"'+lensId+'","name":"'+(lensName||'').replace(/"/g,'\\"')+'","name_cn":"'+(lensNameCN||'').replace(/"/g,'\\"')+'","bricklink_category":"BrickLink分類","description":"30字描述","feature_tags":["1~3個,限選:'+LEGO_TAGS+'"],"dim_mm_w":寬mm數,"dim_mm_l":長mm數,"dim_mm_h":高mm數,"is_oversize":bool,"is_complete_minifig":bool,"matched_existing_id":"同外型id或null。已有:'+existingList+'"}';
      const classifyResp=await callGeminiAPI(classifyPrompt,thumbBase64,0,GEMINI_LEGO_SYSTEM);
      const parsed=safeParseJSON(classifyResp);

      // Lens fields take priority
      if(lensId)parsed.design_id=lensId;
      if(lensName)parsed.name=lensName;
      if(lensNameCN)parsed.name_cn=lensNameCN;

      // Fetch correct thumbnail
      let rbImgUrl='';
      if(lensId){
        try{const rb=await rebrickableLookup(lensId);if(rb&&rb.imgUrl)rbImgUrl=rb.imgUrl}catch(e){}
        if(!rbImgUrl){const base=lensId.replace(/[a-e]\d*$/i,'');rbImgUrl='https://img.bricklink.com/ItemImage/PN/86/'+base+'.png'}
      }

      const designId=parsed.design_id||'',baseId=getBaseDesignId(designId);
      const vol=calcVolFromAI(parsed.name||'',parsed);
      let match=allItems.find(i=>(i.designId||'').toLowerCase()===designId.toLowerCase());
      if(!match&&baseId)match=allItems.find(i=>getBaseDesignId(i.designId)===baseId);
      // Thumbnail: Rebrickable → match's existing → Lens crop → empty
      const thumbnailUrl=rbImgUrl||(match?match.thumbnailUrl:'')||'';
      let slotInfo;if(match)slotInfo={slot:match.slot,slotType:match.slotType||'small'};else slotInfo=gatewayAssign({...parsed,estimateVolumeMl:vol,quantity:1,featureTags:parsed.feature_tags||[],dimW:parsed._dimW||0,dimL:parsed._dimL||0,dimH:parsed._dimH||0});
      const now=Date.now();
      const savedItem={name:parsed.name||'',nameCN:parsed.name_cn||'',designId,description:parsed.description||'',featureTags:parsed.feature_tags||[],bricklinkCategory:normalizeCategory(parsed.bricklink_category||''),estimateVolumeMl:vol,slot:slotInfo.slot,slotType:slotInfo.slotType||'small',thumbnailUrl,imageData:thumbnailUrl?'':(currentImageData||''),quantity:1,dimW:parsed._dimW||0,dimL:parsed._dimL||0,dimH:parsed._dimH||0,lens_summary:lensSummary||'',id:match?match.id:'lego_'+now+'_'+Math.random().toString(36).slice(2,5),createdAt:match?(match.createdAt||now):now,updatedAt:now};
if(match)Object.assign(match,savedItem);else allItems.unshift(savedItem);
      markDirty(savedItem.id);await fbSaveItem(savedItem);item.result=savedItem;item.status='done';done++;
    }catch(err){item.error=err.message;item.status='error';errors++}
    renderBatchList();updateBatchProgress(done+errors,files.length);if(!batchCancelled)await new Promise(r=>setTimeout(r,1500));
  }
  batchRunning=false;document.getElementById('batch-back-btn').textContent='← 返回';document.getElementById('batch-done-panel').style.display='block';
  document.getElementById('batch-done-icon').textContent=errors===0?'✓':'⚠';
  document.getElementById('batch-done-text').textContent=batchCancelled?'已取消':'完成！共建檔 '+done+' 件';
  document.getElementById('batch-done-sub').textContent=errors>0?'失敗 '+errors+' 件':'所有零件已儲存';
  renderStats();applyFilter();
}

// ═══════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════
function doSearch(q){
  q=(q||'').trim();if(!q)return;
  // Detect slot-pattern queries and route to slot detail view
  // Small drawer: "077", "77", "077a", "077b"
  const smallM=q.match(/^0*(\d{1,3})[ab]?$/i);
  if(smallM){
    const n=parseInt(smallM[1]);
    if(n>=1&&n<=450){searchDrawer(n);return}
  }
  // Bag: "B01", "B36"
  const bagM=q.match(/^B(\d+)$/i);
  if(bagM){searchBag(parseInt(bagM[1]));return}
  // Large drawer: "L01", "L05"
  const largeM=q.match(/^L(\d+)$/i);
  if(largeM){searchLarge(parseInt(largeM[1]));return}
  // Otherwise: text search
  const ql=q.toLowerCase();
  const results=allItems.filter(i=>[i.name,i.nameCN,i.designId,i.slot,i.overflowSlot,(i.featureTags||[]).join(' ')].join(' ').toLowerCase().includes(ql));
  document.getElementById('search-title').textContent='搜尋「'+q+'」：'+results.length+' 筆';
  document.getElementById('search-results').innerHTML=results.length?renderSlotNav(null)+results.map(partRowHTML).join(''):'<div style="text-align:center;padding:48px;color:var(--muted)">找不到結果</div>';
  showScreen('s-search');
}

// Render prev/next slot navigation buttons
function renderSlotNav(current){
  if(!current)return '';
  const prev=current.prev, next=current.next, label=current.label;
  return '<div style="display:flex;gap:8px;padding:8px 0 12px 0;background:var(--bg);position:sticky;top:0;z-index:5">'
    +(prev?'<button class="btn btn-sm" onclick="jumpToSlot(\''+prev+'\')" style="flex:1;font-size:13px;padding:10px">← '+prev+'</button>':'<div style="flex:1"></div>')
    +'<div style="flex:1.5;text-align:center;font-family:var(--mono);font-size:14px;color:var(--accent);font-weight:700;padding:10px">'+label+'</div>'
    +(next?'<button class="btn btn-sm" onclick="jumpToSlot(\''+next+'\')" style="flex:1;font-size:13px;padding:10px">'+next+' →</button>':'<div style="flex:1"></div>')
    +'</div>';
}

// Unified jump: accepts "103", "103a", "B36", "L05"
function jumpToSlot(s){
  doSearch(s);
  // scroll results area to top
  const sr=document.getElementById('search-results');if(sr)sr.scrollTop=0;
}
function jumpToSlotFromResult(){
  const slot=(document.getElementById('result-slot').textContent||'').trim();
  if(!slot)return;
  // For any slot type (bag/large/small), show its contents via search
  doSearch(slot);
}
async function saveResultQty(){
  const qty=parseInt(document.getElementById('result-qty').value)||0;
  if(qty<=0){showToast('數量為 0，未追加');return}
  if(!pendingPart||!pendingPart.matchedId){showToast('找不到對應零件','error');return}
  const item=allItems.find(i=>i.id===pendingPart.matchedId);
  if(!item){showToast('找不到零件','error');return}
  item.quantity=(item.quantity||1)+qty;
  item.updatedAt=Date.now();
  // Auto-overflow check
  const ovResult=autoOverflowCheck(item);
  markDirty(item.id);
  try{await fbSaveItem(item)}catch(e){}
  document.getElementById('result-qty-save').textContent='✓ 已追加 +'+qty;
  document.getElementById('result-qty-save').disabled=true;
  if(ovResult){
    showToast('已追加 '+qty+' 件 → 溢出 '+ovResult.overQty+' 件到 '+ovResult.bagSlot);
    // Update result screen to show overflow
    document.getElementById('result-slot').textContent=item.slot+'、'+ovResult.bagSlot;
    const banner=document.getElementById('match-banner');
    banner.style.display='block';
    banner.innerHTML='<div style="font-size:13px;font-weight:700;color:var(--orange)">📦 溢出分配</div><div style="font-size:12px;color:var(--muted)">留 '+ovResult.fitsQty+' 件在 '+item.slot+'，溢出 '+ovResult.overQty+' 件到 '+ovResult.bagSlot+'</div>';
  }else{
    showToast('已追加 '+qty+' 件，庫存 '+item.quantity+' 件');
  }
}

// Auto overflow: check if slot total exceeds cap, auto-assign bag
// v17u: 常用零件的 pickupQty 永不被此函數改變 (快取固定)
//       主位/overflow 只負責 (qty - pickupQty)
function autoOverflowCheck(item){
  if(!item||!item.slot)return null;
  const vol1=item.estimateVolumeMl||0;
  const pickupQty=item.pickupQty||0;
  // 扣除 pickupQty: 主位 + overflow 只負責剩餘件數
  const qty=Math.max(0,(item.quantity||1)-pickupQty);
  const cap=getSlotCap(item.slot,item.slotType);
  if(cap===Infinity)return null;

  // BAG items: expand OR shrink overflow based on current qty
  if(item.slotType==='bag'&&vol1>0){
    const piecesPerBag=Math.max(1,Math.floor(cap/vol1));
    if(qty<=piecesPerBag){
      // Fits in one bag — clear stale overflow
      if(item.overflowSlot||item.overflowQty){
        const released=(item.overflowSlot||'').split(',').map(s=>s.trim()).filter(Boolean);
        item.overflowSlot='';
        item.overflowQty=0;
        markDirty(item.id);
        if(released.length>0){
          console.log('[autoOverflowCheck] '+item.designId+' released bags: '+released.join(','));
        }
      }
      return null;
    }
    const bagsNeeded=Math.ceil(qty/piecesPerBag);
    const ovBagsNeeded=bagsNeeded-1;
    const existingOvBags=item.overflowSlot?item.overflowSlot.split(',').map(s=>s.trim()).filter(Boolean):[];
    // Expand if needed
    while(existingOvBags.length<ovBagsNeeded){
      const nextBag=slotConfig.nextBagSlot||'B01';
      slotConfig.nextBagSlot=advanceBag(nextBag);
      markDirty('__config__');
      existingOvBags.push(nextBag);
    }
    // Shrink if too many (qty went down)
    if(existingOvBags.length>ovBagsNeeded){
      existingOvBags.length=ovBagsNeeded;
    }
    const overQty=qty-piecesPerBag;
    item.overflowSlot=existingOvBags.join(',');
    item.overflowQty=overQty;
    return{bagSlot:existingOvBags.join(','),overQty,fitsQty:piecesPerBag};
  }

  // DRAWER items: expand OR shrink overflow based on current qty
  const otherVol=allItems.filter(i=>i.slot===item.slot&&i.id!==item.id).reduce((s,i)=>s+(i.estimateVolumeMl||0)*(i.quantity||1),0);
  const availCap=Math.max(0,cap-otherVol);
  const tv=vol1*qty;
  if(otherVol+tv<=cap){
    // Fits in primary slot now — release all overflow
    if(item.overflowSlot||item.overflowQty){
      const released=(item.overflowSlot||'').split(',').map(s=>s.trim()).filter(Boolean);
      item.overflowSlot='';
      item.overflowQty=0;
      markDirty(item.id);
      if(released.length>0){
        console.log('[autoOverflowCheck] '+item.designId+' released bags: '+released.join(','));
      }
    }
    return null;
  }
  const fitsQty=Math.max(0,Math.floor(availCap/(vol1||1)));
  const overQty=qty-fitsQty;
  if(overQty<=0){
    // Same as above — release overflow
    if(item.overflowSlot||item.overflowQty){
      item.overflowSlot='';item.overflowQty=0;markDirty(item.id);
    }
    return null;
  }
  const ovVol=vol1*overQty;
  const itemCg2=getCatGroup(item.featureTags||[],normalizeCategory(item.bricklinkCategory||''));
  const itemTag=item.characterTag||null;
  const itemSeries=item.seriesTag||null; // v17y: 不用 detectSeries 猜測
  const bagCap=BAG_ML_DEFAULT;
  const piecesPerBag=vol1>0?Math.max(1,Math.floor(bagCap/vol1)):overQty;
  const ovBagsNeeded=Math.ceil(overQty/piecesPerBag);
  const existingOvBags=item.overflowSlot?item.overflowSlot.split(',').map(s=>s.trim()).filter(Boolean):[];

  if(ovBagsNeeded===1&&existingOvBags.length===0){
    // Single bag: find existing bag with capacity, or allocate new
	const bagSlot=findBagForOverflow(ovVol,itemCg2,itemTag,itemSeries,item);
    item.overflowSlot=bagSlot;
    item.overflowQty=overQty;
    return{bagSlot,overQty,fitsQty};
  }
  if(ovBagsNeeded===1&&existingOvBags.length>=1){
    // Already has overflow bag(s) — shrink if too many, reuse if fits
    const eb=existingOvBags[0];
    const currentOvVol=vol1*(item.overflowQty||0);
    const bagVolWithout=getBagVol(eb)-currentOvVol;
    if(bagVolWithout+ovVol<=bagCap){
      // Shrink if we had more bags previously
      existingOvBags.length=1;
      item.overflowSlot=existingOvBags.join(',');
      item.overflowQty=overQty;
      return{bagSlot:existingOvBags.join(','),overQty,fitsQty};
    }
    // Existing bag full → allocate new
    const newBag=findBagForOverflow(ovVol,itemCg2,itemTag,itemSeries,item);
	existingOvBags.push(newBag);
    item.overflowSlot=existingOvBags.join(',');
    item.overflowQty=overQty;
    return{bagSlot:existingOvBags.join(','),overQty,fitsQty};
  }
  // Multi-bag needed
  while(existingOvBags.length<ovBagsNeeded){
    const nextBag=slotConfig.nextBagSlot||'B01';
    slotConfig.nextBagSlot=advanceBag(nextBag);
    markDirty('__config__');
    existingOvBags.push(nextBag);
  }
  // Shrink if too many
  if(existingOvBags.length>ovBagsNeeded){
    existingOvBags.length=ovBagsNeeded;
  }
  item.overflowSlot=existingOvBags.join(',');
  item.overflowQty=overQty;
  return{bagSlot:existingOvBags.join(','),overQty,fitsQty};
}