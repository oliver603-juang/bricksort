// BrickSort — 全域常數與應用程式狀態
// 此檔案必須在所有其他 .js 之前載入

const APP_VERSION = '2026.04.20bh';
const FB_CONFIG = { apiKey:'AIzaSyDZltB8OQti4ZPkME-K95HXZL51oByXE10', projectId:'storesmart-7ae65' };
const FB_COL = 'lego_parts';
const FB_CONFIG_DOC = '_slot_config';
const DEFAULT_RB_KEY = '56ee6047eaeb92c40641ad70531deeed';

const SLOT_W=48,SLOT_L=68,SLOT_H=38;
const SLOT_ML=SLOT_W*SLOT_L*SLOT_H/1000; // ~124
const DRAWER_ML=SLOT_ML*2; // ~248
const LARGE_W=108,LARGE_L=136,LARGE_H=53;
const LARGE_ML=LARGE_W*LARGE_L*LARGE_H/1000; // ~778
const LARGE_COUNT=27;
const BAG_ML_DEFAULT=784;
const MERGE_LIMIT=62;
// ═══ 單件體積閾值 ═══
// 單件佔位體積 > MERGE_VOL1_MAX 的零件不參與融合（避免大件堆疊浪費空間）
const MERGE_VOL1_MAX=41; // SLOT_ML/3 ≈ 41ml
const MINIFIG_BAG_VOL1=1.2; // 人偶配件 vol1 ≥ 此值才進收納袋，更小的留小抽屜

// 動態融合上限：極小零件可以多裝
function getMergeMaxItems(binItems){
  if(!binItems||!binItems.length)return 8;
  var maxVol=Math.max.apply(null,binItems.map(function(it){return it._vt||it.estimateVolumeMl||0}));
  if(maxVol<5)return 8;   // 極小零件（<5ml）最多 8 個
  if(maxVol<20)return 6;  // 小零件（<20ml）最多 6 個
  return 4;               // 一般零件 最多 4 個
}
const BASE_DRAWERS=450;

const STUD_PITCH=8,PLATE_H=3.2,BRICK_H=9.6;

const LEGO_TAGS='Arch,Bar,Baseplate,Boat,Bracket,Brick,Brick Modified,Brick Round,Cone,Container,Cylinder,Dish,Door,Door Frame,Fence,Flag,Hinge,Hook,Hose,Ladder,Panel,Plant,Plate,Plate Modified,Plate Round,Projectile,Propeller,Rock,Roof,Slope,Slope Curved,Slope Inverted,Stairs,Support,Tail,Tap,Technic,Technic Axle,Technic Connector,Technic Gear,Technic Liftarm,Technic Link,Technic Panel,Technic Pin,Technic Plate,Tile,Tile Modified,Tile Round,Train,Turntable,Vehicle,Vehicle Base,Vehicle Mudguard,Wedge,Wedge Plate,Wheel,Wheel Tire,Window,Window Glass,Windscreen,Wing,Minifigure Utensil,Minifigure Weapon,Animal,Food,String Net,Human Tool,Riding Cycle,Motor,Pneumatic,Spring';

const CATEGORY_GROUPS={'Plate':'Plate','Plate Modified':'Plate Modified','Plate Round':'Plate Round','Brick':'Brick','Brick Modified':'Brick Modified','Brick Round':'Brick Round','Tile':'Tile','Tile Modified':'Tile Modified','Tile Round':'Tile Round','Slope':'Slope','Slope Curved':'Slope Curved','Slope Inverted':'Slope Inverted','Technic':'Technic','Technic Axle':'Technic Axle','Technic Pin':'Technic Pin','Technic Connector':'Technic Connector','Technic Gear':'Technic Gear','Technic Liftarm':'Technic Liftarm','Technic Link':'Technic Link','Technic Panel':'Technic Panel','Technic Plate':'Technic Plate','Bracket':'Bracket','Hinge':'Hinge','Arch':'Arch','Bar':'Bar','Wedge':'Wedge','Wedge Plate':'Wedge Plate','Wing':'Wing','Cone':'Cone','Cylinder':'Cylinder','Dish':'Dish','Support':'Support','Panel':'Panel','Baseplate':'Baseplate','Window':'門窗類','Window Glass':'門窗類','Windscreen':'門窗類','Door':'門窗類','Door Frame':'門窗類','Vehicle':'車輛類','Vehicle Base':'車輛類','Vehicle Mudguard':'車輛類','Wheel':'輪子類','Wheel Tire':'輪子類','Train':'軌道類','Turntable':'軌道類','Minifigure Utensil':'人偶工具','Minifigure Weapon':'人偶武器','Animal':'生物自然','Food':'生物自然','Plant':'生物自然','Flag':'小型配件','Hook':'小型配件','Tap':'小型配件','Ladder':'小型配件','String Net':'小型配件','Rock':'結構配件','Roof':'結構配件','Stairs':'結構配件','Fence':'結構配件','Hose':'結構配件','Boat':'載具配件','Propeller':'載具配件','Projectile':'載具配件','Human Tool':'小型配件','Riding Cycle':'車輛類','Motor':'結構配件','Pneumatic':'結構配件','Spring':'小型配件'};

// Minifig body part sub-categories (checked via bricklinkCategory)
const MINIFIG_CAT_MAP={
  'minifigure, head':'人偶頭部','minifig head':'人偶頭部','minifig, head':'人偶頭部',
  'minifigure, hair':'人偶頭飾','minifigure, headwear':'人偶頭飾','minifigure, headgear':'人偶頭飾','minifig, headwear':'人偶頭飾','minifigure, headwear accessory':'人偶頭飾','minifigure headwear':'人偶頭飾',
  'minifigure, body part':'人偶身體','minifigure, body wear':'人偶身體','minifigure, armor':'人偶身體','minifigure, neckwear':'人偶身體','minifig, neck wear':'人偶身體',
  'minifigure, shield':'人偶武器','minifig weapon':'人偶武器','minifig, weapon':'人偶武器','minifigure weapon':'人偶武器',
  'minifigure, utensil':'人偶工具','minifig utensil':'人偶工具','minifig, utensil':'人偶工具','minifigure utensil':'人偶工具'
};
const TIER1_GROUPS=new Set(['Plate','Plate Modified','Plate Round','Brick','Brick Modified','Brick Round','Tile','Tile Modified','Tile Round','Slope','Slope Curved','Slope Inverted','Technic','Technic Axle','Technic Pin','Technic Connector','Technic Gear','Technic Liftarm','Technic Link','Technic Panel','Technic Plate','Bracket','Hinge','Arch','Bar','Wedge','Wedge Plate','Wing','Cone','Cylinder','Dish','Support','Panel','Baseplate']);
const TIER2_GROUPS=new Set(['門窗類','車輛類','輪子類','軌道類']);
const TIER3_GROUPS=new Set(['人偶配件','生物自然','小型配件','結構配件','載具配件']);

const ZONE_TOP={name:'頂層',start:1,end:90,cols:18,rows:5};
const ZONE_LARGE_MAP={name:'中層(大抽屜)',drawers:27,cols:9,rows:3};
const ZONE_MAIN={name:'主區',start:91,end:450,cols:18,rows:20};
const ZONE_EXT={name:'擴充區',start:451,end:630,cols:18,rows:10};

const GEMINI_MODELS=['gemini-2.5-flash','gemini-flash-latest','gemini-2.0-flash'];
const GEMINI_LEGO_SYSTEM=`你是一位專業的樂高零件資料庫工程師與 LDraw 3D 建模專家。請根據使用者提供的「樂高零件名稱與 Design ID」，精確推算或估算該零件的「實體外框極限尺寸 (Bounding Box)」與「佔位體積」。
【語言規則】：所有中文欄位（name_cn、description）必須使用繁體中文（臺灣正體），絕對不可使用簡體中文。例如：「圓頂蜘蛛網」而非「圆顶蜘蛛网」，「附桿和夾」而非「附杆和夹」。
【運算核心規則】：1. 基礎單位：1 顆粒 (Stud) = 8mm，標準磚高 (Brick) = 9.6mm，標準板高 (Plate) = 3.2mm，Stud突起 = 1.7mm。2. 方正零件處理：若為標準 Brick, Plate, Tile 等，請直接從名稱萃取數字進行嚴格數學相乘。高度必須包含Stud突起。3. 不規則零件處理：結合內部樂高實體知識，評估額外突出物對外框 X/Y/Z 軸的影響。4. 體積計算：直接用 dim_mm 的三邊相乘除以 1000 得到 ml。`;

// ═══════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════
let db=null, allItems=[], filtered=[], currentItem=null, isNewItem=false;
let currentSort={key:'createdAt',dir:'desc'};
let dirty=new Set();
let slotConfig={nextSmallSlot:'001a',nextBagSlot:'B01',totalSmallDrawers:450,bagCapacity:800,locked:false};
let cfg={apiKey:'',rbKey:DEFAULT_RB_KEY,pxPerMm:0};
let pendingPart=null, currentImageData=null, currentMode='storage';
let batchQueue=[], batchCancelled=false, batchRunning=false;
let _lastWorkingModel=null;
let currentTab='main';
let dataReady=false, _loadPromise=null;