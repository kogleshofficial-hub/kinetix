import { KinetixMotionEngine } from './engine/motion/KinetixMotionEngine.js';
import { KinetixCombatDirector } from './engine/combat/KinetixCombatDirector.js';
import { KinetixProgressionVault, LocalProfileAdapter } from './engine/progression/KinetixProgressionVault.js';
import { KinetixViewportCanvas } from './engine/viewport/KinetixViewportCanvas.js';
const $ = (id) => document.getElementById(id);
const home = $('home'), arena = $('arena'), canvas = $('game-canvas'), ctx = canvas.getContext('2d');
const video = $('video'), cameraPanel = $('camera-panel'), setup = $('setup');
const modelUrl = '/models/pose_landmarker_lite.task';
const wasmUrl = '/mediapipe/wasm';
let soundOn = true, reducedMotion = false, cameraStatus = 'off', cameraMode = false, trackingOkay = false, paused = false;
let stream = null, cameraStarting = false;
let lastTrackingAt = 0;
let calibrated = false;
let cameraTargetMode = 'lobby';
const DIFFICULTIES=Object.freeze({
 easy:{label:'EASY / TRAINING',enemyHP:100,enemyDamage:12,firstWait:1.05,telegraph:1.05,opening:1.65,recovery:.52,guardDuration:1.25,dodgeDuration:1.2},
 normal:{label:'NORMAL',enemyHP:210,enemyDamage:28,firstWait:.62,telegraph:.46,opening:.62,recovery:.16,guardDuration:1.0,dodgeDuration:.95},
 hard:{label:'HARD / RIFT MASTER',enemyHP:420,enemyDamage:48,firstWait:.3,telegraph:.24,opening:.36,recovery:.08,guardDuration:.72,dodgeDuration:.68}
});
let difficulty='normal';
function difficultyRules(){return DIFFICULTIES[difficulty]||DIFFICULTIES.easy;}
const MOTION_SENSITIVITY=Object.freeze({high:{label:'HIGH'},max:{label:'MAX'}});
let motionSensitivity='high';
let impactClearTimer=0;
let audioContext = null, raf = 0, previousFrame = 0, lastHudAt = 0, lastEventStamp = -1, eventFxAt = performance.now();
const PROFILE_STORAGE_KEY='kinetix-profile-v2';
const SOLO_REWARDS=Object.freeze({easy:15,normal:20,hard:30});
const USERNAME_CHANGE_COST=100;
const RANK_XP_BY_DIFFICULTY=Object.freeze({easy:10,normal:20,hard:35});
const RANKS=Object.freeze([
 {id:'recruit',name:'Rift Recruit',xp:0},
 {id:'initiate',name:'Kinetic Initiate',xp:100},
 {id:'adept',name:'Pulse Adept',xp:250},
 {id:'hunter',name:'Rift Hunter',xp:500},
 {id:'vanguard',name:'Void Vanguard',xp:850},
 {id:'champion',name:'Rift Champion',xp:1300},
 {id:'sovereign',name:'Kinetix Sovereign',xp:1900}
]);
const COMBO_BANNERS=Object.freeze({
 classic:{name:'COMBO',price:0},
 unstoppable:{name:'UNSTOPPABLE',price:100},
 riftbreaker:{name:'RIFT BREAKER',price:250}
});
function rankForXp(value){
 let current=RANKS[0];
 for(const rank of RANKS)if(value>=rank.xp)current=rank;
 return current;
}
const CHARACTER_STYLES=Object.freeze({
 starter:{name:'Rift Runner',rarity:'Starter',price:0,core:'#bac4ff',aura:'#7b8bff',accent:'#7df5ff',glow:'#71eaff',halo:false},
 elite:{name:'Pulse Knight',rarity:'Elite',price:120,core:'#b7ffe4',aura:'#42d9a4',accent:'#e0fff4',glow:'#65ffd0',halo:false},
 epic:{name:'Void Striker',rarity:'Epic',price:300,core:'#e0c6ff',aura:'#9361f6',accent:'#f8e8ff',glow:'#c18aff',halo:false},
 legendary:{name:'Rift Sovereign',rarity:'Legendary',price:600,core:'#ffe5a4',aura:'#d69b36',accent:'#fff4cf',glow:'#ffd16a',halo:true}
});
const progressionVault = new KinetixProgressionVault({
 adapter: new LocalProfileAdapter({ key: PROFILE_STORAGE_KEY, legacyKey: 'kinetix-profile-v1' }),
 characters: CHARACTER_STYLES,
 banners: COMBO_BANNERS
});
let profile = await progressionVault.load();
async function saveProfile(){ return progressionVault.save(profile); }
function refreshStore(message){
 const name=$('profile-username'),wallet=$('wallet-balance'),wins=$('profile-wins'),equipped=$('equipped-character'),input=$('profile-name-input'),status=$('store-status');
 const rankName=$('rank-name'),rankXpLabel=$('rank-xp-label'),rankFill=$('rank-progress-fill'),rankNext=$('rank-next-label');
 const currentRank=rankForXp(profile.rankXp),rankIndex=RANKS.findIndex(rank=>rank.id===currentRank.id),nextRank=RANKS[rankIndex+1]||null;
 if(rankName)rankName.textContent=currentRank.name;
 if(rankXpLabel)rankXpLabel.textContent=nextRank?profile.rankXp+' / '+nextRank.xp+' RANK XP':profile.rankXp+' RANK XP · MAX RANK';
 if(rankFill)rankFill.style.width=(nextRank?Math.max(0,Math.min(100,(profile.rankXp-currentRank.xp)/(nextRank.xp-currentRank.xp)*100)):100)+'%';
 if(rankNext)rankNext.textContent=nextRank?(nextRank.xp-profile.rankXp)+' XP TO '+nextRank.name.toUpperCase():'MAX RANK ACHIEVED';
 document.querySelectorAll('[data-rank-id]').forEach(card=>{
  const rank=RANKS.find(item=>item.id===card.dataset.rankId);if(!rank)return;
  card.classList.toggle('unlocked',profile.rankXp>=rank.xp);
  card.classList.toggle('current',rank.id===currentRank.id);
  const state=card.querySelector('[data-rank-state]');
  if(state)state.textContent=rank.id===currentRank.id?'CURRENT':profile.rankXp>=rank.xp?'UNLOCKED':'LOCKED';
 });
 if(name)name.textContent=profile.username;
 if(wallet)wallet.textContent=String(profile.kinets);
 if(wins)wins.textContent=profile.soloWins+' solo '+(profile.soloWins===1?'victory':'victories');
 if(equipped)equipped.textContent=CHARACTER_STYLES[profile.equippedCharacter]?.name||CHARACTER_STYLES.starter.name;
 if(input&&document.activeElement!==input)input.value=profile.username;
 document.querySelectorAll('[data-character-action]').forEach(button=>{
  const id=button.dataset.characterAction,style=CHARACTER_STYLES[id],owned=profile.ownedCharacters.includes(id);
  if(!style)return;
  const isEquipped=profile.equippedCharacter===id;
  button.textContent=isEquipped?'EQUIPPED':owned?'EQUIP':'UNLOCK · '+style.price+' KINETS';
  button.disabled=isEquipped;
  const card=button.closest('[data-character-card]');
  if(card)card.classList.toggle('equipped',isEquipped);
  if(card){const state=card.querySelector('[data-character-state]');if(state)state.textContent=isEquipped?'EQUIPPED':owned?'OWNED':style.rarity.toUpperCase();}
 });
 document.querySelectorAll('[data-banner-action]').forEach(button=>{
  const id=button.dataset.bannerAction,banner=COMBO_BANNERS[id],owned=profile.ownedBanners.includes(id);
  if(!banner)return;
  const isEquipped=profile.equippedBanner===id;
  button.textContent=isEquipped?'EQUIPPED':owned?'EQUIP':'UNLOCK · '+banner.price+' KINETS';
  button.disabled=isEquipped;
  const card=button.closest('[data-banner-card]');
  if(card)card.classList.toggle('equipped',isEquipped);
 });
 if(status&&message)status.textContent=message;
}
async function handleBannerAction(id){
 const banner=COMBO_BANNERS[id];if(!banner)return;
 try{
  const result=await progressionVault.purchaseBanner(id);
  if(!result.ok){refreshStore('You need '+(result.required-profile.kinets)+' more Kinets to unlock '+banner.name+'.');return;}
  profile=result.profile;
  refreshStore(result.alreadyOwned?banner.name+' banner equipped. It appears when your solo combo reaches 5.':banner.name+' banner unlocked and equipped.');
 }catch(error){console.error('[KINETIX STORE]',error);refreshStore('The style transaction could not be saved. Please retry.');}
}
async function handleCharacterAction(id){
 const style=CHARACTER_STYLES[id];if(!style)return;
 try{
  const result=await progressionVault.purchaseCharacter(id);
  if(!result.ok){refreshStore('You need '+(result.required-profile.kinets)+' more Kinets to unlock '+style.name+'. Win solo rounds to earn more.');return;}
  profile=result.profile;
  refreshStore(result.alreadyOwned?style.name+' equipped. Cosmetic only — combat stats are unchanged.':style.name+' unlocked and equipped. Enjoy your new style.');
 }catch(error){console.error('[KINETIX STORE]',error);refreshStore('The style transaction could not be saved. Please retry.');}
}
async function awardSoloWin(){
 if(g.mode!=='solo'||g.rewardGranted)return;
 g.rewardGranted=true;
 const result=await progressionVault.awardVictory(g.difficulty);
 profile=result.profile;
 g.rewardEarned=result.reward.kinets;g.rankXpEarned=result.reward.xp;
 g.rankUp=result.rankedUp;g.rankName=result.rankAfter.name;
 refreshStore('Victory! +'+g.rewardEarned+' Kinets and +'+g.rankXpEarned+' Rank XP earned'+(g.rankUp?' · RANK UP: '+g.rankName:'')+'.');
}
let bestRecord = 0;
try { bestRecord = Number(localStorage.getItem('kinetix-best-combo') || 0); } catch {}
$('best-combo').textContent = String(bestRecord).padStart(2,'0') + '×';
let g = freshGame();

const viewport = new KinetixViewportCanvas({
 canvas,
 frame: canvas.parentElement,
 getPalette: () => {
  const style=CHARACTER_STYLES[profile.equippedCharacter]||CHARACTER_STYLES.starter;
  return [style.core,style.aura,style.glow];
 },
 reducedMotion: () => reducedMotion
});

const combatDirector = new KinetixCombatDirector({
 tickRate: 60,
 maxFrameDelta: .25,
 maxCatchUpTicks: 8,
 isEnabled:()=>g.status==='playing'&&!paused&&(!cameraMode||trackingOkay)&&performance.now()>=(g.hitStopUntil||0),
 onTick: (dt) => simulateStep(dt),
 onCommand: (command) => resolveAction(command.kind,command.player),
 getSnapshot: () => ({
  status:g.status,phase:g.phase,hp:g.pHP,enemyHp:g.eHP,
  mana:g.energy,combo:g.combo,remainingSeconds:g.time
 })
});
viewport.connect(combatDirector.bus);
combatDirector.bus.on('ui:refresh', paintHud);
combatDirector.bus.on('ui:impact', paintImpact);
combatDirector.bus.on('ui:heal', paintHeal);
combatDirector.bus.on('ui:perfect-defense', paintPerfectDefense);
combatDirector.bus.on('ui:comeback', paintComeback);
combatDirector.bus.on('ui:result', showResult);

function updateHud(){
 combatDirector.emit('ui:refresh',{tick:combatDirector.tick});
}
function showImpact(player,damage){
 combatDirector.emit('ui:impact',{player,damage});
}
function showHeal(player,amount){
 combatDirector.emit('ui:heal',{player,amount});
}
function triggerPerfectDefense(kind){
 g.perfectReads++;g.perfectFxUntil=performance.now()+650;g.hitStopUntil=performance.now()+100;
 announce('perfect',kind==='guard'?'PERFECT GUARD · +24 ENERGY':'PERFECT PHASE · +24 ENERGY','good');sfx('perfect');
 combatDirector.emit('ui:perfect-defense',{kind});
}
function checkAdrenaline(){
 if(g.mode!=='solo'||g.status!=='playing'||g.adrenalineTriggered||g.pHP<=0||g.pHP>difficultyRules().enemyDamage)return;
 g.adrenalineTriggered=true;g.adrenalineUntil=g.clock+5;g.energy=Math.min(100,g.energy+24);
 announce('comeback','LAST LIGHT — SPECIAL COUNTER READY','good');sfx('comeback');
 combatDirector.emit('ui:comeback',{});
}
function paintImpact({player,damage}){
 const flash=$('impact-flash'),number=$('hit-number');
 g.hitPlayer=player;g.damageFlashAt=performance.now();
 flash.className='impact-flash '+(player===1?'hit-p1':'');
 number.textContent='−'+damage+' HP';number.classList.remove('hidden','healing');
 number.animate([{opacity:0,transform:'translate3d(0,8px,0)'},{opacity:1,transform:'translate3d(0,0,0)',offset:.18},{opacity:0,transform:'translate3d(0,-5px,0)'}],{duration:760,easing:'ease-out'});
 viewport.impact({player,damage});
 clearTimeout(impactClearTimer);impactClearTimer=setTimeout(()=>number.classList.add('hidden'),760);
}
function paintHeal({player,amount}){
 const number=$('hit-number');
 number.textContent='+'+amount;number.classList.remove('hidden');number.classList.add('healing');
 number.animate([{opacity:0,transform:'translate3d(0,8px,0)'},{opacity:1,transform:'translate3d(0,0,0)',offset:.18},{opacity:0}],{duration:760,easing:'ease-out'});
 viewport.heal({player});
 setTimeout(()=>{number.classList.add('hidden');number.classList.remove('healing');},760);
}
function paintPerfectDefense(){
 const frame=canvas.parentElement;frame.classList.remove('perfect-hitstop');void frame.offsetWidth;frame.classList.add('perfect-hitstop');
}
function paintComeback(){
 canvas.parentElement.classList.add('comeback-active');
}

const motionEngine = new KinetixMotionEngine({
 modelUrl, wasmUrl,
 onAction: (kind,player,source) => action(kind,player,source),
 onTracking: handleMotionTracking,
 onError: (error) => {
  console.error('[KINETIX MOTION]',error);
  const label=$('camera-label');
  if(label)label.textContent='TRACKING RETRYING';
 }
});
motionEngine.attachKeyboard(window,{
 getMode:()=>g.mode,
 isEnabled:()=>!arena.classList.contains('hidden')&&!paused&&g.status==='playing'
});
refreshStore();

function freshFighter(){return {hp:100,mana:70,combo:0,best:0,lane:0,guardUntil:0,dodgeUntil:0,lastPulse:-9999,lastNova:-9999,lastPhase:-9999,attackUntil:0,hurtUntil:0,medkits:1,collectCooldown:0,pulses:0,clean:0,dodges:0,blocks:0,hits:0,damage:0};}
function freshGame(mode='solo'){
 const p1=freshFighter(),p2=freshFighter();
 return {status:'ready',mode:mode,difficulty:difficulty,phase:mode==='duo'?'duel':'idle',time:mode==='duo'?60:75,clock:0,pHP:mode==='duo'?100:120,playerMaxHP:mode==='duo'?100:120,eHP:mode==='duo'?100:difficultyRules().enemyHP,enemyMaxHP:mode==='duo'?100:difficultyRules().enemyHP,energy:72,playerHurtUntil:0,playerAttackUntil:0,playerAttackSide:1,enemyHurtUntil:0,combo:0,best:0,lane:0,target:0,attackIndex:0,phaseTimer:mode==='duo'?1.35:difficultyRules().firstWait,guardUntil:0,dodgeUntil:0,lastPulse:-9999,lastNova:-9999,lastPhase:-9999,event:'none',eventAt:0,msg:mode==='duo'?'LOCAL DUEL READY':'THE RIFT IS STIRRING',tone:'neutral',pulses:0,clean:0,dodges:0,blocks:0,hits:0,damage:0,p1:p1,p2:p2,winner:null,medkits:1,pickup:null,nextSupplyAt:8,supplyCount:0,damageFlashAt:0,hitPlayer:0,rewardGranted:false,rewardEarned:0,rankXpEarned:0,rankUp:false,rankName:'',perfectGuardArmedUntil:-9999,perfectPhaseArmedUntil:-9999,perfectReads:0,perfectFxUntil:0,hitStopUntil:0,adrenalineTriggered:false,adrenalineUsed:false,adrenalineUntil:0};
}
function beginGame(mode='solo'){
 g=freshGame(mode);g.status='playing';g.msg=mode==='duo'?'DUEL ONLINE — MAKE YOUR MOVE':'READ THE RIFT. FIND YOUR MOMENT.';
 paused=false;lastEventStamp=-1;combatDirector.beginMatch();$('overlay').classList.add('hidden');eventFxAt=performance.now();previousFrame=performance.now();showScreen('arena');
 $('moves-main').classList.toggle('hidden',mode==='duo');$('duo-controls').classList.toggle('hidden',mode!=='duo');
 $('mode-pill').innerHTML='<b></b>'+(mode==='duo'?(cameraMode?'2P MOTION ONLINE':'2P LOCAL DUEL'):(cameraMode?'MOTION ONLINE':'SOLO VS AI'));
 $('mode-pill').classList.add('live');$('move-mode').textContent=mode==='duo'?'TWO PLAYER TOUCH CONTROLS':'KEYBOARD / CLICK CONTROLS';updateHud();
}
function showScreen(which) { home.classList.toggle('hidden',which!=='home'); arena.classList.toggle('hidden',which!=='arena'); }
function announce(event,msg,tone) { g.event=event; g.eventAt=g.clock; eventFxAt=performance.now(); g.msg=msg; g.tone=tone||'neutral'; combatDirector.emit('combat:notice',{event,msg,tone:tone||'neutral',tick:combatDirector.tick}); }
function sfx(name) {
  if(!soundOn) return;
  try {
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
    audioContext=audioContext||new AC();if(audioContext.state==='suspended')audioContext.resume();
    const defs={pulse:[440,.09,'triangle'],hit:[105,.19,'sawtooth'],block:[720,.14,'sine'],dodge:[610,.12,'triangle'],nova:[72,.42,'sawtooth'],win:[660,.34,'sine'],lose:[130,.35,'triangle'],miss:[240,.07,'sine'],perfect:[920,.18,'sawtooth'],comeback:[190,.32,'triangle']};
    const [freq,dur,wave]=defs[name]||[330,.06,'sine'];const now=audioContext.currentTime,o=audioContext.createOscillator(),a=audioContext.createGain();
    o.type=wave;o.frequency.setValueAtTime(freq,now);if(name==='nova')o.frequency.exponentialRampToValueAtTime(28,now+dur);if(name==='win')o.frequency.exponentialRampToValueAtTime(990,now+dur);
    a.gain.setValueAtTime(.0001,now);a.gain.exponentialRampToValueAtTime(name==='nova'?.25:.12,now+.012);a.gain.exponentialRampToValueAtTime(.0001,now+dur);o.connect(a);a.connect(audioContext.destination);o.start(now);o.stop(now+dur+.02);
  } catch {}
}
function stepSupplyDrops(){
 if(!g.pickup&&g.clock>=g.nextSupplyAt){const type=g.supplyCount%3===1?'medkit':'mana';g.pickup={type:type,expires:g.clock+8};g.supplyCount++;g.nextSupplyAt=g.clock+13;announce('pickup',type==='medkit'?'SUPPLY DROP — MED KIT':'SUPPLY DROP — MANA ORB','good');}
 if(g.pickup&&g.clock>=g.pickup.expires){g.pickup=null;announce('none','SUPPLY DROP EXPIRED — NEXT ONE SOON','neutral');}
}
function pickupDrop(player=1){
 if(!g.pickup){announce('miss','NO DROP AVAILABLE — WATCH THE ARENA','neutral');updateHud();return;}
 if(g.mode==='duo'){
   const p=player===2?g.p2:g.p1;
   if(g.pickup.type==='medkit'){if(p.medkits>=2){announce('miss','MED KIT SLOTS FULL — USE ONE FIRST','neutral');updateHud();return;}p.medkits++;announce('pickup','P'+player+' CLAIMED A MED KIT','good');}
   else{const gained=Math.min(30,100-p.mana);if(gained<=0){announce('miss','MANA ALREADY FULL — DROP LEFT IN ARENA','neutral');updateHud();return;}p.mana+=gained;announce('pickup','P'+player+' CLAIMED +'+gained+' MANA','good');}
   g.pickup=null;syncDuelState();sfx('block');updateHud();return;
 }
 if(g.pickup.type==='medkit'){if(g.medkits>=2){announce('miss','MED KIT SLOTS FULL — USE ONE FIRST','neutral');updateHud();return;}g.medkits++;g.p1.medkits=g.medkits;announce('pickup','MED KIT SECURED — PRESS E TO HEAL','good');}
 else{const gained=Math.min(30,100-g.energy);if(gained<=0){announce('miss','MANA ALREADY FULL — ORB LEFT IN ARENA','neutral');updateHud();return;}g.energy+=gained;announce('pickup','MANA ORB +'+gained,'good');}
 g.pickup=null;sfx('block');updateHud();
}
function useMedkit(player=1){
 if(g.mode==='duo'){
   const p=player===2?g.p2:g.p1;if(!p.medkits){announce('miss','NO MED KITS — CLAIM THE NEXT DROP','neutral');updateHud();return;}
   if(p.hp>=100){announce('miss','HEALTH ALREADY FULL — SAVE THE KIT','neutral');updateHud();return;}if(g.clock-p.collectCooldown<1)return;
   const healed=Math.min(28,100-p.hp);p.hp+=healed;p.medkits--;p.collectCooldown=g.clock;announce('heal','P'+player+' MED KIT +'+healed+' HP','good');showHeal(player,healed);syncDuelState();sfx('block');updateHud();return;
 }
 if(!g.medkits){announce('miss','NO MED KITS — CLAIM THE NEXT DROP','neutral');updateHud();return;}const healthCap=g.playerMaxHP||100;if(g.pHP>=healthCap){announce('miss','HEALTH ALREADY FULL — SAVE THE KIT','neutral');updateHud();return;}
 const healed=Math.min(28,healthCap-g.pHP);g.pHP+=healed;g.medkits--;g.p1.medkits=g.medkits;announce('heal','MED KIT +'+healed+' HP','good');showHeal(1,healed);sfx('block');updateHud();
}
function syncDuelState(){g.pHP=g.p1.hp;g.eHP=g.p2.hp;g.energy=g.p1.mana;g.combo=g.p1.combo;g.best=Math.max(g.p1.best,g.p2.best);g.damage=g.p1.damage+g.p2.damage;g.dodges=g.p1.dodges+g.p2.dodges;g.blocks=g.p1.blocks+g.p2.blocks;g.hits=g.p1.hits+g.p2.hits;g.pulses=g.p1.pulses+g.p2.pulses;g.clean=g.p1.clean+g.p2.clean;}
function dualAction(kind,player=1){
 if(g.status!=='playing'||paused)return;const actor=player===2?g.p2:g.p1,target=player===2?g.p1:g.p2,targetNum=player===2?1:2;
 if(kind==='COLLECT'){pickupDrop(player);return;}if(kind==='MEDKIT'){useMedkit(player);return;}
 if(kind==='GUARD_RELEASE'){actor.guardUntil=g.clock;return;}
 if(kind==='GUARD'){const wasGuarding=actor.guardUntil>g.clock;actor.guardUntil=Math.max(actor.guardUntil,g.clock+1.05);if(!wasGuarding)announce('block','P'+player+' SHIELD ACTIVE','good');updateHud();return;}
 if(kind==='PHASE_LEFT'||kind==='PHASE_RIGHT'){if(g.clock-actor.lastPhase<.3)return;actor.lastPhase=g.clock;actor.lane=kind==='PHASE_LEFT'?-1:1;actor.dodgeUntil=g.clock+.68;actor.attackUntil=g.clock+.15;actor.mana=Math.min(100,actor.mana+2);announce('dodge','P'+player+' PHASE SHIFT','good');sfx('dodge');syncDuelState();updateHud();return;}
 if(kind==='PULSE'){
   if(!cameraMode&&g.clock-actor.lastPulse<.02)return;
   actor.lastPulse=g.clock;
   // Low mana weakens a pulse; it no longer makes a clearly detected punch disappear.
   const powered=actor.mana>=10;
   actor.mana=Math.max(0,actor.mana-(powered?10:3));
   actor.attackUntil=g.clock+.22;actor.pulses++;
   if(target.dodgeUntil>g.clock){
    actor.combo=0;target.dodges++;target.mana=Math.min(100,target.mana+3);
    announce('miss','P'+player+' PULSE EVADED','neutral');sfx('miss');
   }else if(target.guardUntil>g.clock){
    const damage=Math.min(powered?3:1,target.hp);target.hp-=damage;target.hurtUntil=g.clock+.18;
    target.mana=Math.min(100,target.mana+(powered?9:4));target.blocks++;actor.damage+=damage;actor.combo=0;
    announce('block','P'+targetNum+' BLOCKED — '+damage+' CHIP DAMAGE','good');sfx('block');if(damage>0)showImpact(targetNum,damage);
   }else{
    const comboBonus=actor.combo>0&&actor.combo%3===2?5:0;
    const raw=(powered?8:4)+Math.min(powered?5:2,actor.combo)+comboBonus;
    const damage=Math.min(raw,target.hp);target.hp-=damage;target.hurtUntil=g.clock+.34;actor.damage+=damage;
    actor.combo++;actor.best=Math.max(actor.best,actor.combo);actor.clean++;actor.mana=Math.min(100,actor.mana+2);
    announce('pulse','P'+player+' HIT  −'+damage+' HP'+(actor.combo%3===0?' · COMBO HIT':''),'good');sfx('hit');showImpact(targetNum,damage);
   }
 }else if(kind==='NOVA'){
   if(g.clock-actor.lastNova<1.15)return;if(actor.mana<60){announce('miss','NOVA NEEDS 60 MANA — BUILD YOUR METER','neutral');updateHud();return;}actor.lastNova=g.clock;actor.mana-=60;actor.attackUntil=g.clock+.52;
   if(target.dodgeUntil>g.clock){actor.combo=0;target.dodges++;target.mana=Math.min(100,target.mana+5);announce('miss','NOVA MISSED — OPPONENT PHASED OUT','danger');sfx('miss');}
   else{const raw=target.guardUntil>g.clock?8:26,damage=Math.min(raw,target.hp);target.hp-=damage;target.hurtUntil=g.clock+.48;actor.damage+=damage;actor.combo+=2;actor.best=Math.max(actor.best,actor.combo);if(target.guardUntil>g.clock){target.mana=Math.min(100,target.mana+12);target.blocks++;announce('block','NOVA DEFLECTED — '+damage+' HP CHIP','good');}else announce('nova','NOVA RELEASED  −'+damage+' HP','good');sfx('nova');showImpact(targetNum,damage);}
 }
 syncDuelState();if(g.p1.hp<=0){finishDuel(2);return;}if(g.p2.hp<=0){finishDuel(1);return;}updateHud();
}
function resolveAction(kind,player=1){
 if(g.status!=='playing'||paused||(cameraMode&&!trackingOkay))return;if(g.mode==='duo'){dualAction(kind,player);return;}if(kind==='COLLECT'){pickupDrop(1);return;}if(kind==='MEDKIT'){useMedkit(1);return;}
 const before=g.event+':'+g.eventAt;if(kind==='GUARD_RELEASE'){g.guardUntil=g.clock;return;}if(kind==='GUARD'){g.guardUntil=Math.max(g.guardUntil,g.clock+difficultyRules().guardDuration);return;}
 if(kind==='PHASE_LEFT'||kind==='PHASE_RIGHT'){if(g.clock-g.lastPhase<.3)return;g.lastPhase=g.clock;g.lane=kind==='PHASE_LEFT'?-1:1;g.dodgeUntil=g.clock+difficultyRules().dodgeDuration;if(g.phase==='telegraph'&&g.target!==g.lane){g.energy=Math.min(100,g.energy+3);announce('dodge','PHASE SHIFT','good');sfx('dodge');}updateHud();return;}
 if(kind==='PULSE'){
  if(!cameraMode&&g.clock-g.lastPulse<.02)return;
  g.lastPulse=g.clock;
  const powered=g.energy>=4;
  g.energy=Math.max(0,g.energy-(powered?4:1));
  g.playerAttackUntil=g.clock+.2;
  g.playerAttackSide=g.pulses%2===0?1:-1;
  g.pulses++;
  if(g.phase==='vulnerable'){
   const comboBonus=g.combo>0&&g.combo%3===2?5:0;
   const damage=Math.min(powered?16+comboBonus:8+comboBonus,g.eHP);
   g.eHP=Math.max(0,g.eHP-damage);g.damage+=damage;g.energy=Math.min(100,g.energy+(powered?10:4));g.enemyHurtUntil=g.clock+.24;
   g.combo++;g.best=Math.max(g.best,g.combo);g.clean++;showImpact(2,damage);
   announce('pulse',g.eHP<=0?'FINISHER CONFIRMED':'RIFT HIT  −'+damage+' HP'+(comboBonus?' · COMBO BONUS':''),'good');
  }else{
   const glancingDamage=difficulty==='hard'?(powered?2:1):difficulty==='normal'?(powered?5:2):(powered?7:4);const damage=Math.min(glancingDamage,g.eHP);
   g.eHP=Math.max(0,g.eHP-damage);g.damage+=damage;g.combo=0;g.enemyHurtUntil=g.clock+.2;showImpact(2,damage);
   announce('pulse','GLANCING HIT  −'+damage+' HP · FIND THE OPENING','neutral');
  }
 }
 if(kind==='NOVA'){if(g.energy<100){announce('none','NOVA NEEDS 100 ENERGY','neutral');updateHud();return;}if(g.clock-g.lastNova<1.3)return;const damage=g.phase==='vulnerable'?48:28,d=Math.min(damage,g.eHP);g.eHP=Math.max(0,g.eHP-d);g.damage+=d;g.energy=0;g.lastNova=g.clock;g.combo+=2;g.best=Math.max(g.best,g.combo);announce('nova',g.eHP<=0?'NOVA FINISHER':'NOVA RELEASED  −'+damage,'good');}
 if(g.event+':'+g.eventAt!==before&&g.event!=='none')sfx(g.event);updateHud();
}
function action(kind,player=1,source='ui'){
 if(g.status!=='playing'||(paused&&kind!=='GUARD_RELEASE')||(cameraMode&&!trackingOkay&&kind!=='GUARD_RELEASE'))return false;
 return combatDirector.enqueueAction(kind,player,source);
}


function enemyAttack(){
 if(g.guardUntil>g.clock){
  const perfect=g.perfectGuardArmedUntil>=g.clock;g.perfectGuardArmedUntil=-9999;
  g.energy=Math.min(100,g.energy+(perfect?24:17));g.blocks++;g.combo++;g.best=Math.max(g.best,g.combo);g.phase='vulnerable';g.phaseTimer=difficultyRules().opening;
  if(perfect){triggerPerfectDefense('guard');return;}
  announce('block','GUARD  +17 ENERGY','good');sfx('block');return;
 }
 if(g.lane!==g.target||g.dodgeUntil>g.clock){
  const perfect=g.perfectPhaseArmedUntil>=g.clock;g.perfectPhaseArmedUntil=-9999;
  g.energy=Math.min(100,g.energy+(perfect?25:18));g.dodges++;g.combo++;g.best=Math.max(g.best,g.combo);g.phase='vulnerable';g.phaseTimer=difficultyRules().opening;
  if(perfect){triggerPerfectDefense('phase');return;}
  announce('dodge','PHASE SHIFT  +18 ENERGY','good');sfx('dodge');return;
 }
 const damage=difficultyRules().enemyDamage;g.pHP=Math.max(0,g.pHP-damage);g.playerHurtUntil=g.clock+.48;g.hits++;g.combo=0;g.phase='vulnerable';g.phaseTimer=difficultyRules().opening;announce('hit','RIFT IMPACT  −'+damage+' HP','danger');sfx('hit');showImpact(1,damage);
 if(g.pHP>0)checkAdrenaline();
 if(g.pHP<=0)void finish('lost');
}
async function finish(status){
 if(g.status!=='playing')return;
 g.status=status;g.winner=status==='won'?1:status==='lost'?2:null;
 if(status==='won'&&g.mode==='solo'){
  try{await awardSoloWin();}catch(error){console.error('[KINETIX REWARDS]',error);refreshStore('Victory registered, but local reward storage could not be updated.');}
 }else if(g.mode==='solo'&&(status==='lost'||status==='time-up')){
  try{const result=await progressionVault.awardLoss();profile=result.profile;}catch(error){console.error('[KINETIX PROFILE]',error);}
 }
 if(status==='won'){g.event='win';g.msg='RIFT COLLAPSED';g.tone='good';}
 else if(status==='lost'){g.event='lose';g.msg='SIGNAL LOST';g.tone='danger';}
 else{g.msg='TIME FRACTURED';g.tone='danger';}
 g.eventAt=g.clock;eventFxAt=performance.now();sfx(status==='won'?'win':'lose');
 if(g.best>bestRecord){bestRecord=g.best;try{localStorage.setItem('kinetix-best-combo',String(bestRecord));}catch{}}
 updateHud();showResult();
}
function finishDuel(winner){
 if(g.status!=='playing')return;g.winner=winner;g.status='won';g.event=winner===0?'none':'win';g.tone=winner===0?'neutral':'good';g.msg=winner===0?'DUEL DRAW':'PLAYER '+winner+' WINS';g.eventAt=g.clock;eventFxAt=performance.now();g.best=Math.max(g.p1.best,g.p2.best);
 try{bestRecord=Math.max(bestRecord,g.best);localStorage.setItem('kinetix-best-combo',String(bestRecord));}catch{}sfx(winner===0?'miss':'win');syncDuelState();updateHud();combatDirector.emit('ui:result',{});
}
function stepDuo(dt){
 if(g.status!=='playing'||paused||(cameraMode&&!trackingOkay))return;dt=Math.min(Math.max(dt,0),.05);g.clock+=dt;g.time=Math.max(0,g.time-dt);g.p1.mana=Math.min(100,g.p1.mana+2.7*dt);g.p2.mana=Math.min(100,g.p2.mana+2.7*dt);stepSupplyDrops();syncDuelState();
 if(g.p1.hp<=0){finishDuel(2);return;}if(g.p2.hp<=0){finishDuel(1);return;}if(g.time<=0){finishDuel(g.p1.hp===g.p2.hp?0:g.p1.hp>g.p2.hp?1:2);return;}
}
function simulateStep(dt){
 if(g.mode==='duo'){stepDuo(dt);return;}if(g.status!=='playing'||paused||(cameraMode&&!trackingOkay))return;
 dt=Math.min(Math.max(dt,0),.05);g.clock+=dt;g.time=Math.max(0,g.time-dt);g.phaseTimer-=dt;g.energy=Math.min(100,g.energy+1.4*dt);stepSupplyDrops();
 if(g.time<=0){void finish(g.eHP<=0?'won':'time-up');return;}if(g.eHP<=0){void finish('won');return;}
 if(g.phaseTimer<=0){if(g.phase==='idle'){const pattern=difficulty==='easy'?[0,0,1,0,-1,0]:[0,1,-1,0,-1,1];if(difficulty==='hard'){const lanes=[-1,0,1].filter(lane=>lane!==g.target);g.target=lanes[Math.floor(combatDirector.random()*lanes.length)];}else g.target=pattern[g.attackIndex%pattern.length];g.attackIndex++;g.phase='telegraph';g.phaseTimer=difficultyRules().telegraph;announce('none',g.target===-1?'LEFT-LANE SURGE':g.target===1?'RIGHT-LANE SURGE':'CENTER-LANE SURGE','danger');}else if(g.phase==='telegraph'){g.phase='strike';enemyAttack();}else if(g.phase==='strike'){g.phase='vulnerable';g.phaseTimer=1.2;}else if(g.phase==='vulnerable'){g.phase='idle';g.phaseTimer=difficultyRules().recovery;g.guardUntil=Math.min(g.guardUntil,g.clock);g.msg='NEXT WINDOW APPROACHING';g.tone='neutral';}}
 if(g.pHP<=0)void finish('lost');
}
function paintHud(){
 $('player-hp').textContent=g.pHP;$('enemy-hp').textContent=g.eHP;$('player-hp-bar').style.transform='scaleX('+Math.max(0,Math.min(1,g.pHP/Math.max(1,g.playerMaxHP||100)))+')';$('enemy-hp-bar').style.transform='scaleX('+Math.max(0,Math.min(1,g.eHP/Math.max(1,g.enemyMaxHP)))+')';const playerHpMeta=document.querySelector('.fighter:not(.enemy) .fighter-data small span');if(playerHpMeta)playerHpMeta.textContent=' / '+(g.playerMaxHP||100)+' HP';const enemyHpMeta=document.querySelector('.fighter.enemy .fighter-data small span');if(enemyHpMeta)enemyHpMeta.textContent=' / '+g.enemyMaxHP+' HP';const timeLeft=Math.max(0,Math.ceil(g.time));$('timer').textContent=String(Math.floor(timeLeft/60)).padStart(2,'0')+':'+String(timeLeft%60).padStart(2,'0');$('timer').classList.toggle('urgent',g.time<=10);
 $('phase-label').textContent=g.mode==='duo'?'LOCAL DUEL':g.phase==='telegraph'?'THREAT INCOMING':g.phase==='vulnerable'?'OPENING FOUND':g.phase==='strike'?'IMPACT':'READ THE PATTERN';
 const banner=COMBO_BANNERS[profile.equippedBanner]||COMBO_BANNERS.classic;const comboTitle=document.querySelector('.bottom-hud span:first-child');if(comboTitle&&comboTitle.firstChild)comboTitle.firstChild.textContent=(g.mode==='solo'&&g.combo>=5&&profile.equippedBanner!=='classic'?banner.name+' ':'COMBO ');$('combo').textContent=String(g.combo).padStart(2,'0')+'×';$('combo').style.color=g.combo>=3?'#67e8ef':'';$('energy').textContent=String(Math.round(g.energy)).padStart(3,'0');$('energy-bar').style.transform='scaleX('+Math.max(0,Math.min(1,g.energy/100))+')';$('lane').textContent=g.lane===-1?'LEFT':g.lane===1?'RIGHT':'CENTER';$('feed-text').textContent=(cameraMode&&!trackingOkay)?(g.mode==='duo'?'TRACKING PAUSED — KEEP BOTH PLAYERS IN FRAME':'TRACKING PAUSED — RETURN TO CAMERA FRAME'):g.msg;$('feed').className='feed '+((cameraMode&&!trackingOkay)?'danger':(g.tone==='good'?'good':g.tone==='danger'?'danger':''));if(cameraMode&&!trackingOkay)$('phase-label').textContent='TRACKING PAUSED';
 $('nova-button').disabled=g.energy<100||g.status!=='playing'||paused;$('nova-button').classList.toggle('ready',g.energy>=100);$('nova-label').textContent=g.energy>=100?'READY TO RELEASE':(100-Math.round(g.energy))+'% TO CHARGE';
 const lastLight=$('last-light-button'),lastLightLabel=$('last-light-label'),lastLightAvailable=g.mode==='solo'&&g.adrenalineTriggered&&!g.adrenalineUsed&&g.clock<=g.adrenalineUntil;
 lastLight.disabled=!lastLightAvailable||g.phase!=='vulnerable'||g.status!=='playing'||paused;
 lastLight.classList.toggle('ready',lastLightAvailable&&g.phase==='vulnerable');
 lastLightLabel.textContent=!g.adrenalineTriggered?'UNLOCKS AT CRITICAL HP':g.adrenalineUsed?'USED THIS ROUND':g.clock>g.adrenalineUntil?'WINDOW CLOSED':g.phase==='vulnerable'?'COUNTER NOW':'WAIT FOR OPENING · '+Math.ceil(g.adrenalineUntil-g.clock)+'s';document.querySelectorAll('.move[data-action]').forEach(b=>{b.disabled=g.status!=='playing'||paused||(b.dataset.action==='NOVA'&&g.energy<100)||(b.dataset.action==='MEDKIT'&&(!g.medkits||g.pHP>=(g.playerMaxHP||100)))||(b.dataset.action==='COLLECT'&&!g.pickup);});
 if(g.mode==='duo'){
   $('p1-mini-hp').textContent=g.p1.hp+' HP';$('p2-mini-hp').textContent=g.p2.hp+' HP';$('p1-mana').textContent=Math.round(g.p1.mana);$('p2-mana').textContent=Math.round(g.p2.mana);$('p1-mana-bar').style.transform='scaleX('+Math.max(0,Math.min(1,g.p1.mana/100))+')';$('p2-mana-bar').style.transform='scaleX('+Math.max(0,Math.min(1,g.p2.mana/100))+')';$('p1-kit').textContent='MED KITS · '+g.p1.medkits;$('p2-kit').textContent='MED KITS · '+g.p2.medkits;
   const labels=document.querySelectorAll('.fighter-label');if(labels[1])labels[1].innerHTML='PLAYER TWO <i>● CHALLENGER</i>';const names=document.querySelectorAll('.fighter-data strong');if(names[1])names[1].textContent='RIFT RUNNER II';
   document.querySelectorAll('.duo-action-grid button').forEach(b=>{const p=b.dataset.player==='2'?g.p2:g.p1,k=b.dataset.duoAction;b.disabled=g.status!=='playing'||paused||(k==='NOVA'&&p.mana<60)||(k==='MEDKIT'&&(!p.medkits||p.hp>=100));});
 }else{const labels=document.querySelectorAll('.fighter-label');if(labels[1])labels[1].innerHTML='RIFT ENTITY <i>● HOSTILE</i>';const names=document.querySelectorAll('.fighter-data strong');if(names[0])names[0].textContent=profile.username;if(names[1])names[1].textContent='THE HOLLOW';}
 const ps=$('pickup-status');if(g.pickup){ps.textContent=(g.pickup.type==='medkit'?'MED KIT SUPPLY DROP':'MANA ORB SUPPLY DROP')+' · CLAIM NOW · '+Math.ceil(g.pickup.expires-g.clock)+'s LEFT'+(g.mode==='solo'?' · MED KITS '+g.medkits:'');ps.classList.add('active');}else{ps.textContent='NEXT SUPPLY DROP · '+Math.max(0,Math.ceil(g.nextSupplyAt-g.clock))+'s'+(g.mode==='solo'?' · MED KITS '+g.medkits:'');ps.classList.remove('active');}
 $('best-combo').textContent=String(bestRecord).padStart(2,'0')+'×';
}
function showOverlay(title,desc,tag,buttons,stats) {
 const overlay=$('overlay'),dialog=$('dialog');
 if(stats){
  // Results can contain long descriptions, four stats, rewards and several actions.
  // Render them against the viewport rather than inside the clipped arena canvas.
  overlay.classList.add('overlay-global');
  document.body.appendChild(overlay);
 }else{
  // Pause dialogs stay attached to the arena; move the shared overlay back from
  // the viewport portal so existing in-game pause behavior remains unchanged.
  overlay.classList.remove('overlay-global');
  const frame=canvas.closest('.game-frame');
  if(frame&&overlay.parentElement!==frame)frame.appendChild(overlay);
 }
 overlay.classList.remove('hidden');
 dialog.className='dialog'+(stats?' result':'');
 let html='<span class="tag">'+tag+'</span><h2>'+title+'</h2><p>'+desc+'</p>';
 if(stats)html+='<div class="stats"><div><span>BEST COMBO</span><b>'+String(g.best).padStart(2,'0')+'×</b></div><div><span>DAMAGE</span><b>'+String(g.damage).padStart(3,'0')+'</b></div><div><span>ACCURACY</span><b>'+accuracy()+'%</b></div><div><span>DODGES</span><b>'+String(g.dodges).padStart(2,'0')+'</b></div></div>';
 if(stats&&g.mode==='solo'&&g.rewardEarned>0)html+='<div class="reward-earned"><span>SOLO VICTORY REWARD</span><b>+'+g.rewardEarned+' KINETS</b><small>+'+g.rankXpEarned+' RANK XP · '+rankForXp(profile.rankXp).name+' · Wallet: '+profile.kinets+' Kinets</small></div>';
 if(stats&&g.mode==='solo'&&g.rankUp)html+='<div class="rank-up-banner"><span>RANK PROMOTED</span><b>✧ '+g.rankName.toUpperCase()+' ✧</b><small>Keep winning solo rounds to reach the next tier.</small></div>';
 buttons.forEach(b=>html+='<button class="btn '+b.style+'" data-overlay="'+b.action+'">'+b.label+'</button>');
 if(!stats)html+='<button class="text-btn" data-overlay="home">EXIT TO MAIN MENU</button>';
 dialog.innerHTML=html;
 dialog.querySelectorAll('[data-overlay]').forEach(b=>b.addEventListener('click',()=>{const action=b.dataset.overlay;if(action==='resume'){paused=false;$('overlay').classList.add('hidden');updateHud();}else if(action==='restart'){beginGame(g.mode);}else if(action==='home'){stopCamera(true);paused=false;g=freshGame();showScreen('home');$('overlay').classList.add('hidden');}else if(action==='store'){stopCamera(true);paused=false;g=freshGame();showScreen('home');$('overlay').classList.add('hidden');$('kinet-store').scrollIntoView({behavior:'smooth',block:'start'});}else if(action==='card')downloadCard();}));
}
function accuracy(){return g.pulses?Math.round(g.clean/g.pulses*100):0;}
function showResult(){
 if(g.mode==='duo'){const winner=g.winner;const title=winner===0?'PERFECTLY EVEN.':'PLAYER '+winner+' WINS.';const desc=winner===0?'Both fighters end the round with the same health. Local Duo is practice play: no Kinets or Rank XP are awarded.':(winner===1?'Player One controlled the arena this round.':'Player Two controlled the arena this round.')+' No progression currency is awarded in local Duo.'
 showOverlay(title,desc,'LOCAL DUEL / SESSION REPORT',[{label:'RUN IT BACK →',style:'primary',action:'restart'},{label:'EXPORT RESULT CARD',style:'secondary',action:'card'},{label:'BACK TO MAIN MENU',style:'secondary',action:'home'}],true);return;}
 const won=g.status==='won';
  const title=won?(difficulty==='hard'?'HARD CLEAR — RIFT COLLAPSED.':'RIFT COLLAPSED.'):g.status==='time-up'?'TIME FRACTURED.':'SIGNAL LOST';
  const description=won?(difficulty==='hard'?'You survived the 420 HP Rift Master. Every counter, guard and phase mattered.':'You read the pattern and closed the breach on '+difficultyRules().label+'.'):g.status==='time-up'?'The Rift is still standing. Review your timing and try a different approach.':'The Hollow won this round. Try '+(difficulty==='hard'?'Normal to practice your timing, then return to Hard':difficulty==='normal'?'Easy to learn the moves, then return to Normal':'the round again')+' when ready.';
  showOverlay(title,description,'RIFT DUEL / '+difficultyRules().label+' / SESSION REPORT',[{label:'RUN IT BACK →',style:'primary',action:'restart'},{label:'OPEN KINET STORE ◈',style:'secondary',action:'store'},{label:'EXPORT RESULT CARD',style:'secondary',action:'card'},{label:'BACK TO MAIN MENU',style:'secondary',action:'home'}],true);
}
function pauseGame(){if(g.status!=='playing')return;paused=true;combatDirector.clearCommands('paused');showOverlay('Catch your breath.','The rift is frozen. Your progress is still here.','SESSION PAUSED',[{label:'RESUME ROUND →',style:'primary',action:'resume'},{label:'RESTART ROUND',style:'secondary',action:'restart'}],false);}
function downloadCard(){
 const c=document.createElement('canvas');c.width=1200;c.height=630;const x=c.getContext('2d');if(!x)return;
 const bg=x.createLinearGradient(0,0,1200,630);bg.addColorStop(0,'#0b0d20');bg.addColorStop(.55,'#171632');bg.addColorStop(1,'#080a14');x.fillStyle=bg;x.fillRect(0,0,1200,630);
 const glow=x.createRadialGradient(880,270,5,880,270,430);glow.addColorStop(0,g.status==='won'?'rgba(85,240,215,.24)':'rgba(143,111,255,.22)');glow.addColorStop(1,'rgba(10,12,25,0)');x.fillStyle=glow;x.fillRect(0,0,1200,630);
 x.strokeStyle='rgba(145,160,255,.12)';for(let xx=0;xx<1200;xx+=42){x.beginPath();x.moveTo(xx,0);x.lineTo(xx,630);x.stroke();}
 x.fillStyle='#a99bff';x.font='500 23px monospace';x.fillText('KINETIX / RIFT DUEL',74,83);x.fillStyle='#f7f5ff';x.font='700 77px sans-serif';x.fillText(g.mode==='duo'?(g.winner===0?'DUEL DRAW':'PLAYER '+g.winner+' WINS'):g.status==='won'?'RIFT COLLAPSED':g.status==='time-up'?'TIME FRACTURED':'SIGNAL LOST',72,205);x.fillStyle='#9aa3c6';x.font='500 24px sans-serif';x.fillText('YOUR BODY. YOUR POWER. YOUR ARENA.',76,251);
 [['BEST COMBO',String(g.best).padStart(2,'0')],['DAMAGE DEALT',String(g.damage).padStart(3,'0')],['CLEAN PULSES',accuracy()+'%'],['PHASE DODGES',String(g.dodges).padStart(2,'0')]].forEach((item,i)=>{const xx=76+i*274;x.fillStyle='rgba(255,255,255,.045)';x.beginPath();x.roundRect(xx,346,245,116,18);x.fill();x.fillStyle='#8c96bc';x.font='14px monospace';x.fillText(item[0],xx+19,379);x.fillStyle='#f7f5ff';x.font='700 43px sans-serif';x.fillText(item[1],xx+19,432);});
 if(g.mode==='duo'){x.fillStyle='#b3a2ff';x.font='18px monospace';x.fillText('P1 HP '+g.p1.hp+'   /   P2 HP '+g.p2.hp,77,505);}x.fillStyle='#6c7395';x.font='17px monospace';x.fillText('A PLAYABLE PROTOTYPE BY KOGLESH R. MURUGAN',77,564);const a=document.createElement('a');a.download='kinetix-rift-duel.png';a.href=c.toDataURL('image/png');a.click();
}
function draw(t) {
 const r=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
 if(canvas.width!==Math.floor(r.width*dpr)||canvas.height!==Math.floor(r.height*dpr)){canvas.width=Math.max(1,Math.floor(r.width*dpr));canvas.height=Math.max(1,Math.floor(r.height*dpr));}
 ctx.setTransform(dpr,0,0,dpr,0,0);const w=r.width,h=r.height;ctx.clearRect(0,0,w,h);
 const tm=reducedMotion?4000:t;const bg=ctx.createLinearGradient(0,0,w,h);bg.addColorStop(0,'#0b0c20');bg.addColorStop(.5,'#11122a');bg.addColorStop(1,'#080a14');ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
 let glow=ctx.createRadialGradient(w*.2,h*.56,0,w*.2,h*.56,w*.4);glow.addColorStop(0,'rgba(81,94,231,.23)');glow.addColorStop(1,'rgba(81,94,231,0)');ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
 glow=ctx.createRadialGradient(w*.8,h*.45,0,w*.8,h*.45,w*.42);glow.addColorStop(0,'rgba(136,71,220,.25)');glow.addColorStop(1,'rgba(136,71,220,0)');ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
 ctx.strokeStyle='rgba(140,159,255,.055)';ctx.lineWidth=1;const grid=42,offset=(tm*.007)%grid;for(let xx=-grid+offset;xx<w+grid;xx+=grid){ctx.beginPath();ctx.moveTo(xx,0);ctx.lineTo(xx,h);ctx.stroke();}for(let yy=0;yy<h+grid;yy+=grid){ctx.beginPath();ctx.moveTo(0,yy);ctx.lineTo(w,yy);ctx.stroke();}
 for(let i=0;i<42;i++){const xx=((i*97.31+tm*(.006+(i%4)*.003))%(w+20))-10,yy=((i*53.77+Math.sin(tm*.0004+i)*12)%(h+20))-10;ctx.fillStyle='rgba(186,205,255,'+(.14+(Math.sin(tm*.001+i*1.7)+1)*.09)+')';ctx.beginPath();ctx.arc(xx,yy,i%7===0?1.5:.8,0,Math.PI*2);ctx.fill();}
 const horizon=h*.71;ctx.strokeStyle='rgba(105,143,255,.17)';for(let i=-9;i<=9;i++){ctx.beginPath();ctx.moveTo(w*.5+i*19,horizon);ctx.lineTo(w*.5+i*w*.12,h);ctx.stroke();}for(let i=0;i<7;i++){let yy=horizon+(h-horizon)*Math.pow(i/6,2);ctx.beginPath();ctx.moveTo(0,yy);ctx.lineTo(w,yy);ctx.stroke();}
 ctx.save();ctx.translate(w*.5,h*.59);ctx.rotate(tm*.00015);ctx.strokeStyle='rgba(155,132,255,.2)';ctx.beginPath();ctx.ellipse(0,0,Math.min(w*.125,110),Math.min(h*.31,130),0,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.ellipse(0,0,Math.min(w*.095,80),Math.min(h*.25,106),.3,0,Math.PI*2);ctx.stroke();for(let i=0;i<8;i++){const a=i*Math.PI/4+tm*.0003;ctx.fillStyle=i%2?'#9a8cff':'#54dfea';ctx.beginPath();ctx.arc(Math.cos(a)*Math.min(w*.125,110),Math.sin(a)*Math.min(h*.31,130),2.3,0,Math.PI*2);ctx.fill();}ctx.restore();
 if(g.phase==='telegraph'){ctx.save();const lx=g.target===-1?w*.22:g.target===1?w*.36:w*.29;ctx.globalAlpha=.5+(Math.sin(tm*.008)+1)*.23;ctx.strokeStyle='#ffba75';ctx.lineWidth=2;ctx.shadowBlur=16;ctx.shadowColor='#ffba75';ctx.beginPath();ctx.ellipse(lx,h*.9+5,48+Math.sin(tm*.01)*5,13,0,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#ffba75';ctx.font='10px monospace';ctx.textAlign='center';ctx.fillText(g.target===-1?'LEFT':g.target===1?'RIGHT':'CENTER',lx,h*.9+35);ctx.restore();}
 const floor=h*.89,scale=Math.min(w*.21,h*.29,110);
 function player(x){
   const style=CHARACTER_STYLES[profile.equippedCharacter]||CHARACTER_STYLES.starter;
   ctx.save();const hurt=g.playerHurtUntil>g.clock,attacking=g.playerAttackUntil>g.clock;const px=x+(g.lane===-1?-scale*.23:g.lane===1?scale*.23:0)+Math.sin(tm*.002)*2;ctx.translate(px,floor);ctx.globalAlpha=hurt&&!reducedMotion&&Math.floor(tm/65)%2===0?.52:1;ctx.shadowBlur=hurt?32:attacking?36:20;ctx.shadowColor=hurt?'#ff536d':attacking?style.glow:style.aura;ctx.strokeStyle=hurt?'#ff9aa8':style.core;ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=scale*.115;ctx.strokeStyle=style.aura;ctx.beginPath();ctx.ellipse(0,-3,scale*.54,scale*.12,0,0,Math.PI*2);ctx.stroke();ctx.strokeStyle=style.core;ctx.beginPath();ctx.moveTo(-scale*.1,-scale*.72);ctx.lineTo(-scale*.29,-scale*.08);ctx.lineTo(-scale*.45,-scale*.02);ctx.moveTo(scale*.1,-scale*.72);ctx.lineTo(scale*.3,-scale*.08);ctx.lineTo(scale*.44,-scale*.02);ctx.moveTo(0,-scale*1.58);ctx.lineTo(0,-scale*.76);ctx.moveTo(-scale*.28,-scale*1.48);ctx.lineTo(scale*.28,-scale*1.48);ctx.stroke();if(g.guardUntil>g.clock){ctx.strokeStyle='#61f0ff';ctx.beginPath();ctx.moveTo(-scale*.25,-scale*1.38);ctx.lineTo(-scale*.04,-scale*1.08);ctx.lineTo(scale*.04,-scale*1.08);ctx.lineTo(scale*.25,-scale*1.38);ctx.stroke();ctx.beginPath();ctx.arc(0,-scale*1.3,scale*.48,Math.PI*1.05,Math.PI*1.95);ctx.stroke();}else if(attacking){const side=g.playerAttackSide||1,other=-side;ctx.strokeStyle=style.accent;ctx.lineWidth=scale*.13;ctx.beginPath();ctx.moveTo(side*scale*.28,-scale*1.48);ctx.lineTo(side*scale*.5,-scale*1.3);ctx.lineTo(side*scale*.82,-scale*1.25);ctx.stroke();ctx.beginPath();ctx.arc(side*scale*.82,-scale*1.25,scale*.2,0,Math.PI*2);ctx.stroke();ctx.strokeStyle=hurt?'#ff9aa8':style.core;ctx.lineWidth=scale*.115;ctx.beginPath();ctx.moveTo(other*scale*.28,-scale*1.48);ctx.lineTo(other*scale*.47,-scale*1.08);ctx.lineTo(other*scale*.35,-scale*.9);ctx.stroke();}else{const swing=Math.sin(tm*.003)*scale*.06;ctx.beginPath();ctx.moveTo(-scale*.28,-scale*1.48);ctx.lineTo(-scale*.48,-scale*1.08+swing);ctx.lineTo(-scale*.35,-scale*.9+swing);ctx.moveTo(scale*.28,-scale*1.48);ctx.lineTo(scale*.49,-scale*1.14-swing);ctx.lineTo(scale*.38,-scale*.96-swing);ctx.stroke();}ctx.fillStyle='#10152a';ctx.beginPath();ctx.ellipse(0,-scale*1.86,scale*.17,scale*.21,0,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.strokeStyle=style.glow;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-scale*.1,-scale*1.9);ctx.lineTo(scale*.1,-scale*1.9);ctx.stroke();if(g.adrenalineTriggered&&!g.adrenalineUsed&&g.clock<=g.adrenalineUntil){ctx.save();ctx.strokeStyle='#ff6aa7';ctx.lineWidth=2.4;ctx.shadowBlur=22;ctx.shadowColor='#ff4d93';ctx.globalAlpha=.82;ctx.beginPath();ctx.arc(0,-scale*1.32,scale*.88+Math.sin(tm*.04)*4,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(0,-scale*1.32,scale*1.06+Math.sin(tm*.04)*4,0,Math.PI*2);ctx.stroke();ctx.restore();}if(style.halo){ctx.save();ctx.globalAlpha=.72;ctx.strokeStyle=style.glow;ctx.lineWidth=1.7;ctx.shadowBlur=16;ctx.shadowColor=style.glow;ctx.beginPath();ctx.arc(0,-scale*1.32,scale*.7,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(0,-scale*1.32,scale*.84,0,Math.PI*2);ctx.stroke();ctx.restore();}ctx.restore();
 }
 function monster(x){
   const vulnerable=g.phase==='vulnerable',tele=g.phase==='telegraph',hurt=g.enemyHurtUntil>g.clock,tint=hurt?'#ff6b8b':vulnerable?'#65f4dc':tele?'#ffb56b':'#c8a4ff';const aura=ctx.createRadialGradient(x,floor-scale*1.7,scale*.1,x,floor-scale*1.7,scale*1.6);aura.addColorStop(0,hurt?'rgba(255,67,110,.30)':vulnerable?'rgba(68,242,202,.24)':'rgba(150,97,255,.28)');aura.addColorStop(1,'rgba(115,75,208,0)');ctx.fillStyle=aura;ctx.fillRect(x-scale*1.7,floor-scale*3.5,scale*3.4,scale*3.6);
   ctx.save();ctx.translate(x,floor+Math.sin(tm*.0022)*scale*.035);ctx.shadowBlur=tele?30:21;ctx.shadowColor=tint;ctx.lineJoin='round';const b=ctx.createLinearGradient(-scale*.7,-scale*2.6,scale*.7,-scale*.2);b.addColorStop(0,vulnerable?'#2d8d9f':'#a36af5');b.addColorStop(.48,'#29264e');b.addColorStop(1,'#111429');ctx.fillStyle=b;ctx.strokeStyle=tint;ctx.lineWidth=2;for(let i=0;i<5;i++){let yy=-scale*(1.2+i*.25);ctx.beginPath();ctx.moveTo(-scale*.25,yy);ctx.lineTo(-scale*(.55+(i%2)*.15),yy-scale*.32);ctx.lineTo(-scale*.05,yy+scale*.11);ctx.closePath();ctx.fill();ctx.stroke();}ctx.beginPath();ctx.moveTo(-scale*.55,-scale*1.45);ctx.lineTo(-scale*.4,-scale*.5);ctx.lineTo(-scale*.12,-scale*.12);ctx.lineTo(scale*.37,-scale*.12);ctx.lineTo(scale*.54,-scale*.67);ctx.lineTo(scale*.42,-scale*1.55);ctx.closePath();ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(-scale*.42,-scale*1.43);ctx.lineTo(-scale*.78,-scale*.9);ctx.lineTo(-scale*.66,-scale*.62);ctx.lineTo(-scale*.48,-scale*.76);ctx.lineTo(-scale*.18,-scale*1.2);ctx.closePath();ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(scale*.4,-scale*1.44);ctx.lineTo(scale*.72,-scale*1.02);ctx.lineTo(scale*.64,-scale*.75);ctx.lineTo(scale*.49,-scale*.86);ctx.lineTo(scale*.2,-scale*1.2);ctx.closePath();ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(-scale*.42,-scale*1.63);ctx.lineTo(-scale*.32,-scale*2.13);ctx.lineTo(0,-scale*2.4);ctx.lineTo(scale*.35,-scale*2.12);ctx.lineTo(scale*.43,-scale*1.64);ctx.lineTo(0,-scale*1.44);ctx.closePath();ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(-scale*.24,-scale*2.22);ctx.lineTo(-scale*.47,-scale*2.55);ctx.lineTo(-scale*.12,-scale*2.34);ctx.closePath();ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(scale*.2,-scale*2.22);ctx.lineTo(scale*.46,-scale*2.54);ctx.lineTo(scale*.11,-scale*2.34);ctx.closePath();ctx.fill();ctx.stroke();ctx.shadowBlur=20;ctx.shadowColor=tint;ctx.fillStyle=tint;ctx.beginPath();ctx.moveTo(-scale*.19,-scale*1.86);ctx.lineTo(-scale*.05,-scale*1.91);ctx.lineTo(scale*.02,-scale*1.78);ctx.lineTo(-scale*.1,-scale*1.68);ctx.closePath();ctx.fill();ctx.beginPath();ctx.moveTo(scale*.12,-scale*1.86);ctx.lineTo(scale*.26,-scale*1.81);ctx.lineTo(scale*.15,-scale*1.68);ctx.lineTo(scale*.08,-scale*1.76);ctx.closePath();ctx.fill();ctx.restore();
 }
 function duelHero(x,side){
 const actor=side===1?g.p1:g.p2,base=side===1?'#78dff5':'#d0a0ff',glowColor=side===1?'#65edf4':'#c28bff';
 const hurt=actor.hurtUntil>g.clock,attacking=actor.attackUntil>g.clock,guarding=actor.guardUntil>g.clock,dodging=actor.dodgeUntil>g.clock,scale2=Math.min(w*.19,h*.27,98),floorY=h*.89,dir=side===1?1:-1,shift=(actor.lane===-1?-1:actor.lane===1?1:0)*scale2*.24,jitter=hurt&&!reducedMotion?Math.sin(tm*.07)*scale2*.05:0,drift=dodging?dir*scale2*.12:0;
 ctx.save();ctx.translate(x+shift+drift+jitter,floorY);ctx.globalAlpha=hurt&&Math.floor(tm/65)%2===0?.52:1;
 const aura=ctx.createRadialGradient(0,-scale2*.95,3,0,-scale2*.95,scale2*1.25);aura.addColorStop(0,hurt?'rgba(255,74,109,.35)':side===1?'rgba(83,218,255,.2)':'rgba(189,111,255,.2)');aura.addColorStop(1,'rgba(10,11,28,0)');ctx.fillStyle=aura;ctx.fillRect(-scale2*1.35,-scale2*2.5,scale2*2.7,scale2*2.7);
 ctx.shadowBlur=18;ctx.shadowColor=hurt?'#ff536d':glowColor;ctx.strokeStyle=hurt?'#ff9aa8':base;ctx.lineWidth=scale2*.105;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.ellipse(0,-3,scale2*.5,scale2*.11,0,0,Math.PI*2);ctx.stroke();
 ctx.beginPath();ctx.moveTo(-scale2*.12,-scale2*.7);ctx.lineTo(-scale2*.26,-scale2*.12);ctx.lineTo(-scale2*.43,-scale2*.05);ctx.moveTo(scale2*.12,-scale2*.7);ctx.lineTo(scale2*.27,-scale2*.12);ctx.lineTo(scale2*.43,-scale2*.05);ctx.moveTo(0,-scale2*1.52);ctx.lineTo(0,-scale2*.72);
 if(attacking){ctx.moveTo(-dir*scale2*.16,-scale2*1.32);ctx.lineTo(dir*scale2*.48,-scale2*1.18);ctx.lineTo(dir*scale2*.81,-scale2*1.25);ctx.moveTo(-dir*scale2*.16,-scale2*1.34);ctx.lineTo(-dir*scale2*.37,-scale2*1.06);}else{ctx.moveTo(-scale2*.26,-scale2*1.4);ctx.lineTo(-scale2*.47,-scale2*1.02);ctx.moveTo(scale2*.26,-scale2*1.4);ctx.lineTo(scale2*.47,-scale2*1.02);}ctx.stroke();
 ctx.fillStyle=hurt?'#ff8395':'#14172c';ctx.beginPath();ctx.arc(0,-scale2*1.78,scale2*.19,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.strokeStyle=glowColor;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-scale2*.1,-scale2*1.8);ctx.lineTo(scale2*.1,-scale2*1.8);ctx.stroke();
 if(guarding){ctx.strokeStyle='#7af7e7';ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(dir*scale2*.24,-scale2*1.15,scale2*.52,side===1?-1.05:2.1,side===1?1.05:4.2);ctx.stroke();}
 if(hurt){ctx.fillStyle='#ff637a';ctx.font='bold '+Math.max(10,scale2*.24)+'px monospace';ctx.textAlign='center';ctx.fillText('−HP',0,-scale2*2.1);}ctx.restore();
}
if(g.mode==='duo'){duelHero(w*.25,1);duelHero(w*.75,2);}else{player(w*.25);monster(w*.74);}
if(g.pickup){const px=w*.5,py=h*.68+Math.sin(tm*.004)*6;ctx.save();ctx.translate(px,py);ctx.shadowBlur=24;ctx.shadowColor=g.pickup.type==='medkit'?'#64f0d1':'#a396ff';ctx.fillStyle=g.pickup.type==='medkit'?'rgba(100,240,209,.16)':'rgba(163,150,255,.16)';ctx.beginPath();ctx.arc(0,0,21,0,Math.PI*2);ctx.fill();ctx.strokeStyle=g.pickup.type==='medkit'?'#64f0d1':'#a396ff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,14+Math.sin(tm*.005)*2,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#f7f5ff';ctx.font='bold 15px monospace';ctx.textAlign='center';ctx.fillText(g.pickup.type==='medkit'?'+':'✧',0,5);ctx.fillStyle='#aab1ce';ctx.font='8px monospace';ctx.fillText(g.pickup.type==='medkit'?'MED KIT':'MANA ORB',0,35);ctx.restore();}
 const age=tm-eventFxAt;
 if(g.mode==='duo'&&g.event==='pulse'&&age<260){ctx.save();const from=g.hitPlayer===2?w*.25:w*.75,to=g.hitPlayer===2?w*.75:w*.25,end=from+(to-from)*Math.min(1,age/240);const bolt=ctx.createLinearGradient(from,h*.58,end,h*.58);bolt.addColorStop(0,'rgba(115,230,255,0)');bolt.addColorStop(.5,'rgba(119,245,255,.95)');bolt.addColorStop(1,'rgba(209,190,255,.8)');ctx.strokeStyle=bolt;ctx.lineWidth=4;ctx.shadowBlur=20;ctx.shadowColor='#7feaff';ctx.beginPath();ctx.moveTo(from,h*.58);ctx.lineTo(end,h*.58);ctx.stroke();ctx.restore();}
 if(g.event==='nova'&&age<720){ctx.save();ctx.globalAlpha=Math.max(0,1-age/720);const reverse=g.mode==='duo'&&g.hitPlayer===1,grad=ctx.createLinearGradient(reverse?w*.9:w*.2,h*.52,reverse?w*.2:w*.9,h*.52);grad.addColorStop(0,'rgba(139,133,255,0)');grad.addColorStop(.3,'rgba(116,233,255,.85)');grad.addColorStop(.6,'rgba(214,189,255,.95)');grad.addColorStop(1,'rgba(139,133,255,0)');ctx.fillStyle=grad;ctx.shadowBlur=45;ctx.shadowColor='#bba5ff';ctx.fillRect(w*.18,h*.49,w*.7,25+Math.sin(age*.03)*5);ctx.restore();}
 if(['pulse','hit','block'].includes(g.event)&&age<720){ctx.save();ctx.globalAlpha=Math.max(0,1-age/720)*.8;ctx.strokeStyle=g.event==='block'?'#66f1ff':'#c2acff';ctx.lineWidth=2;ctx.shadowBlur=20;ctx.shadowColor=ctx.strokeStyle;const hitX=g.mode==='duo'?(g.hitPlayer===1?w*.25:w*.75):w*.72;ctx.beginPath();ctx.ellipse(hitX,h*.51,(15+age*.12)*1.5,15+age*.12,-.2,0,Math.PI*2);ctx.stroke();ctx.restore();}
 if(g.perfectFxUntil>t){ctx.save();const alpha=Math.min(1,(g.perfectFxUntil-t)/180);ctx.globalAlpha=alpha;ctx.fillStyle='rgba(110,245,230,.09)';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#86fff2';ctx.lineWidth=2;ctx.shadowBlur=24;ctx.shadowColor='#80fff1';ctx.beginPath();ctx.arc(w*.5,h*.4,38+(650-(g.perfectFxUntil-t))*.13,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#d8fff9';ctx.font='600 13px monospace';ctx.textAlign='center';ctx.fillText('PERFECT READ',w*.5,h*.32);ctx.restore();}
 const vignette=ctx.createRadialGradient(w*.5,h*.48,Math.min(w,h)*.22,w*.5,h*.48,Math.max(w,h)*.72);vignette.addColorStop(.45,'rgba(2,3,12,0)');vignette.addColorStop(1,'rgba(1,2,8,.6)');ctx.fillStyle=vignette;ctx.fillRect(0,0,w,h);
}
function loop(t){
 draw(t);viewport.render(t);if(t-lastHudAt>110){updateHud();lastHudAt=t;}
 previousFrame=t;raf=requestAnimationFrame(loop);
}
raf=requestAnimationFrame(loop);
document.querySelectorAll('[data-difficulty]').forEach(button=>button.addEventListener('click',()=>{
 const next=button.dataset.difficulty;if(!DIFFICULTIES[next])return;difficulty=next;
 document.querySelectorAll('[data-difficulty]').forEach(option=>{const selected=option===button;option.classList.toggle('active',selected);option.setAttribute('aria-pressed',String(selected));});
 const summaries={easy:'Easy selected — generous warnings, light damage and wide counter windows.',normal:'Normal selected — 210 HP, 28-damage hits and a tighter practice rhythm.',hard:'Hard selected — THE RIFT MASTER: 420 HP, 48-damage hits, shifting lanes and tiny counter windows. Brutal, but beatable with clean timing.'};
 $('difficulty-summary').textContent=summaries[difficulty];
}));
document.querySelectorAll('[data-character-action]').forEach(button=>button.addEventListener('click',()=>handleCharacterAction(button.dataset.characterAction)));
document.querySelectorAll('[data-banner-action]').forEach(button=>button.addEventListener('click',()=>handleBannerAction(button.dataset.bannerAction)));
$('username-form').addEventListener('submit',async event=>{
 event.preventDefault();
 const input=$('profile-name-input'),next=input.value.trim();
 if(!/^[A-Za-z0-9 _-]{3,18}$/.test(next)){refreshStore('Use 3–18 characters: letters, numbers, spaces, underscores or hyphens.');return;}
 if(next===profile.username){refreshStore('That is already your username. No Kinets spent.');return;}
 try{
  const result=await progressionVault.rename(next,USERNAME_CHANGE_COST);
  if(!result.ok){refreshStore('Changing your username costs '+USERNAME_CHANGE_COST+' Kinets. You need '+(result.required-profile.kinets)+' more.');return;}
  profile=result.profile;refreshStore('Username updated. −'+USERNAME_CHANGE_COST+' Kinets.');updateHud();
 }catch(error){console.error('[KINETIX PROFILE]',error);refreshStore('The profile update could not be saved. Please retry.');}
});
document.querySelectorAll('[data-sensitivity]').forEach(button=>button.addEventListener('click',()=>{
 const next=button.dataset.sensitivity;if(!MOTION_SENSITIVITY[next])return;motionSensitivity=next;motionEngine.setSensitivity(next);
 document.querySelectorAll('[data-sensitivity]').forEach(option=>{
  const selected=option.dataset.sensitivity===motionSensitivity;option.classList.toggle('active',selected);option.setAttribute('aria-pressed',String(selected));
 });
 const summaries={max:'MAX sensitivity selected — detects smaller hand raises, but may also register incidental movement.',high:'HIGH sensitivity selected — looks for deliberate hand raises and filters small wrist jitter.'};
 document.querySelectorAll('[data-sensitivity-summary]').forEach(node=>node.textContent=summaries[motionSensitivity]);
}));
$('play-keyboard').addEventListener('click',()=>chooseGameMode('solo'));
$('play-duo-camera').addEventListener('click',()=>chooseGameMode('duo'));
$('enable-camera').addEventListener('click',()=>{void startCamera('lobby');});
$('gate-retry').addEventListener('click',()=>{void startCamera('lobby');});
$('calibrate-start').addEventListener('click',async()=>{
 if(!trackingOkay||!motionEngine.isReady){
  $('calibrate-start').disabled=true;
  showError(cameraTargetMode==='duo'?'Waiting for both players. Stand apart and keep shoulders and hips visible in the camera.':'Waiting for a clear body track. Keep your shoulders and hips in frame.');
  return;
 }
 $('calibrate-start').disabled=true;
 combatDirector.beginCalibration();
 try{
  const result=await motionEngine.calibrate();
  if(!result.ok)throw new Error(result.reason||'Calibration could not complete.');
  calibrated=true;cameraMode=true;showError('');
  $('setup-title').textContent='MOTION CALIBRATED';
  $('setup-copy').textContent=cameraTargetMode==='duo'
   ?'Both players are calibrated. Small, comfortable hand raises trigger PULSE, hands held near the chest activate GUARD, and slight torso shifts PHASE between lanes.'
   :'Ready. Small, comfortable hand raises trigger PULSE, hands held near the chest activate GUARD, and slight torso shifts PHASE between lanes. Buttons remain available as backup.';
  beginGame(cameraTargetMode);$('mode-pill').classList.add('live');
  $('move-mode').textContent=cameraTargetMode==='duo'?'TWO PLAYERS · MOTION + TOUCH':'MOTION + BUTTON BACKUP · '+difficultyRules().label;
  $('camera-hint').classList.add('hidden');
 }catch(error){
  $('calibrate-start').disabled=false;
  showError(error?.message||'Calibration failed. Please try again.');
 }
});
$('duo-touch-start').addEventListener('click',()=>{stopCamera(false);cameraMode=false;calibrated=false;beginGame('duo');$('mode-pill').innerHTML='<b></b>2P TOUCH DUEL';$('move-mode').textContent='SPLIT TOUCH CONTROLS';$('camera-hint').classList.add('hidden');});
$('stop-camera').addEventListener('click',()=>lockToCameraGate('Camera stopped. Re-enable camera access to continue.'));$('camera-close').addEventListener('click',()=>lockToCameraGate('Camera stopped. Re-enable camera access to continue.'));$('brand-home').addEventListener('click',()=>returnToModeSelection());$('pause').addEventListener('click',pauseGame);
$('sound-toggle').addEventListener('click',()=>{soundOn=!soundOn;$('sound-toggle').innerHTML=soundOn?'<svg viewBox="0 0 24 24"><path d="M4 10v4h4l5 4V6l-5 4H4Z"/><path d="M16 9a4.5 4.5 0 0 1 0 6"/></svg>':'<svg viewBox="0 0 24 24"><path d="M4 10v4h4l5 4V6l-5 4H4Z"/><path d="m17 9 5 6m0-6-5 6"/></svg>';});
$('motion-toggle').addEventListener('click',()=>{reducedMotion=!reducedMotion;document.body.classList.toggle('reduced',reducedMotion);});
document.querySelectorAll('.move[data-action]').forEach(b=>b.addEventListener('click',()=>action(b.dataset.action)));
document.querySelectorAll('.duo-action-grid button[data-duo-action]').forEach(b=>b.addEventListener('click',()=>action(b.dataset.duoAction,Number(b.dataset.player))));
window.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&!arena.classList.contains('hidden')){
  e.preventDefault();
  if(g.status==='playing')pauseGame();
  else if(paused){paused=false;$('overlay').classList.add('hidden');}
 }
});
window.addEventListener('resize',()=>{canvas.width=0;canvas.height=0;});
function chooseGameMode(mode){
 if(cameraStatus!=='ready'||!stream||!motionEngine.isReady){
  $('camera-gate').classList.remove('hidden');$('gate-title').textContent='Enable your camera to continue.';
  $('gate-copy').textContent='Both Solo and Duo use your camera for motion controls. Allow camera access and wait for motion tracking to load.';
  if(!cameraStarting)void startCamera('lobby');return;
 }
 cameraTargetMode=mode;
 motionEngine.configure({players:mode==='duo'?2:1,requiredPlayers:mode==='duo'?2:1});
 trackingOkay=false;calibrated=false;lastTrackingAt=0;
 $('camera-gate').classList.add('hidden');$('setup').classList.remove('hidden');
 $('setup-title').textContent=mode==='duo'?'LOOKING FOR BOTH PLAYERS':'LOOKING FOR PLAYER';
 $('setup-copy').textContent=mode==='duo'?'Stand side by side with space between you. Keep both shoulders and hips visible. The start button unlocks automatically when both bodies are detected.':'Keep your shoulders and hips inside the camera frame. The start button unlocks automatically when your body is detected.';
 $('calibrate-start').disabled=true;$('calibrate-start').textContent=mode==='duo'?'WAITING FOR TWO PLAYERS…':'WAITING FOR PLAYER…';
 $('calibrate-start').classList.remove('hidden');$('enable-camera').classList.add('hidden');$('duo-touch-start').classList.add('hidden');
 $('camera-hint').textContent=mode==='duo'?'P1 LEFT · P2 RIGHT · KEEP BOTH BODIES IN FRAME':'KEEP SHOULDERS AND HIPS IN FRAME';
 $('camera-hint').classList.remove('hidden');showError('');
}
function lockToCameraGate(message){
 stopCamera(true);cameraStarting=false;cameraMode=false;calibrated=false;paused=false;g=freshGame('solo');showScreen('home');$('overlay').classList.add('hidden');
 $('camera-gate').classList.remove('hidden');$('gate-title').textContent='Camera access is required.';$('gate-copy').textContent=message+' Kinetix cannot start a round without the camera.';
 $('gate-status').className='gate-status error';$('gate-status').textContent='CAMERA DISCONNECTED';$('gate-retry').disabled=false;
}
function returnToModeSelection(){
 if(cameraStatus!=='ready'||!stream||!motionEngine.isReady){lockToCameraGate('Reconnect your camera to return to the arena.');return;}
 combatDirector.reset();paused=false;calibrated=false;g=freshGame('solo');showScreen('home');$('overlay').classList.add('hidden');cameraTargetMode='lobby';$('setup').classList.remove('hidden');
 $('setup-title').textContent='CAMERA CONNECTED';$('setup-copy').textContent='Choose Solo or Duo, then calibrate your movement before the fight.';$('calibrate-start').classList.add('hidden');$('enable-camera').classList.add('hidden');$('camera-hint').classList.add('hidden');
}
function showError(text){$('setup-error').textContent=text;$('setup-error').classList.toggle('hidden',!text);}
async function startCamera(targetMode='lobby'){
 if(cameraStarting)return;
 if(cameraStatus==='ready'&&stream&&motionEngine.isReady){cameraTargetMode=targetMode;return;}
 cameraStarting=true;cameraTargetMode=targetMode;combatDirector.connectCamera();
 $('camera-gate').classList.remove('hidden');$('gate-title').textContent='Your camera is your controller.';
 $('gate-copy').textContent='Requesting camera permission. Camera frames are processed locally in a dedicated worker and are not recorded.';
 $('gate-status').className='gate-status';$('gate-status').innerHTML='<span class="gate-spin"></span> REQUESTING CAMERA PERMISSION…';$('gate-retry').disabled=true;
 $('setup').classList.remove('hidden');$('setup-title').textContent='REQUESTING CAMERA';
 $('setup-copy').textContent='Your browser will ask for permission. Camera processing stays on this device.';
 $('calibrate-start').classList.add('hidden');$('duo-touch-start').classList.add('hidden');showError('');
 $('enable-camera').disabled=true;
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera access is unavailable. Open Kinetix over HTTPS and retry.');
  stream=await navigator.mediaDevices.getUserMedia({
   video:{facingMode:'user',width:{ideal:640},height:{ideal:480},frameRate:{ideal:60,max:60}},
   audio:false
  });
  stream.getVideoTracks().forEach(track=>track.addEventListener('ended',()=>{
   if(cameraStatus==='ready'&&!cameraStarting)lockToCameraGate('Your camera disconnected or stopped sharing.');
  }));
  video.srcObject=stream;await video.play();cameraPanel.classList.remove('off');cameraStatus='loading';
  $('camera-label').textContent='LOADING MOTION WORKER';$('setup-title').textContent='INITIALIZING MOTION TRACKING';
  $('setup-copy').textContent='Loading the locally hosted pose model in a dedicated worker. Camera frames stay on this device.';
  await motionEngine.start(video,{players:2,requiredPlayers:1,sensitivity:motionSensitivity});
  cameraStatus='ready';cameraStarting=false;cameraMode=true;calibrated=false;trackingOkay=false;lastTrackingAt=0;
  $('camera-gate').classList.add('hidden');$('gate-retry').disabled=false;$('setup').classList.remove('hidden');
  $('setup-title').textContent='CAMERA CONNECTED';
  $('setup-copy').textContent='Camera permission is active. Choose Solo or Duo, then calibrate your movement before the fight.';
  $('calibrate-start').classList.add('hidden');$('enable-camera').classList.add('hidden');$('duo-touch-start').classList.add('hidden');
  $('camera-label').textContent='CAMERA PREVIEW';$('camera-dot').classList.remove('live');
  $('camera-hint').textContent='CHOOSE SOLO OR DUO TO CALIBRATE';$('camera-hint').classList.remove('hidden');
 }catch(err){
  await motionEngine.stop().catch(()=>{});
  stopCamera(false);cameraStarting=false;cameraStatus='error';cameraMode=false;
  $('camera-gate').classList.remove('hidden');$('gate-title').textContent='Camera access is required.';
  $('gate-copy').textContent='Kinetix cannot start a round until the browser allows camera access. Check site permissions, then retry. Your camera is not recorded.';
  $('gate-status').className='gate-status error';
  $('gate-status').textContent=err?.name==='NotAllowedError'?'CAMERA PERMISSION DENIED — ALLOW IT IN BROWSER SETTINGS':(err?.message||'CAMERA SETUP FAILED');
  $('gate-retry').disabled=false;$('setup-title').textContent='CAMERA UNAVAILABLE';
  showError(err?.message||'Camera setup failed. Please retry.');
  $('setup-copy').textContent='Allow camera access in your browser, then select Retry.';
  $('enable-camera').disabled=false;$('enable-camera').textContent='RETRY CAMERA ACCESS';$('enable-camera').classList.remove('hidden');
 }
}
function stopCamera(resetUI){
 void motionEngine.stop();
 stream?.getTracks().forEach(track=>track.stop());stream=null;video.srcObject=null;
 cameraPanel.classList.add('off');cameraStatus='off';cameraMode=false;calibrated=false;trackingOkay=false;lastTrackingAt=0;
 $('calibrate-start').classList.add('hidden');$('enable-camera').disabled=false;
 $('enable-camera').innerHTML='<svg viewBox="0 0 24 24"><path d="M4 7.5h3l1.7-2h6.6l1.7 2h3A1.5 1.5 0 0 1 21.5 9v9a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18V9A1.5 1.5 0 0 1 4 7.5Z"/><circle cx="12" cy="13" r="3.5"/></svg> PLAY WITH CAMERA';
 $('mode-pill').innerHTML='<b></b>KEYBOARD MODE';$('mode-pill').classList.remove('live');$('move-mode').textContent='KEYBOARD / CLICK CONTROLS';
 if(resetUI)$('setup').classList.add('hidden');$('duo-touch-start').classList.add('hidden');
 combatDirector.reset();
}
function handleMotionTracking(info){
 trackingOkay=Boolean(info.ready);
 if(trackingOkay){
  lastTrackingAt=performance.now();$('camera-dot').classList.add('live');
  $('camera-label').textContent=info.count>=2?'TWO PLAYERS TRACKED':'MOTION LIVE';$('camera-hint').classList.add('hidden');
  if(cameraTargetMode!=='lobby'&&!home.classList.contains('hidden')&&!setup.classList.contains('hidden')){
   $('calibrate-start').disabled=false;
   $('calibrate-start').textContent=cameraTargetMode==='duo'?'CALIBRATE BOTH PLAYERS & START':'CALIBRATE & START';
   $('setup-title').textContent=cameraTargetMode==='duo'?'BOTH PLAYERS DETECTED':'PLAYER DETECTED';
   $('setup-copy').textContent=cameraTargetMode==='duo'?'Both players are visible. Calibrate now to begin the local duel.':'Your body is visible. Calibrate now to start '+difficultyRules().label+' mode.';
   showError('');
  }
 }else{
  combatDirector.clearCommands('tracking-lost');
  $('camera-dot').classList.remove('live');
  $('camera-label').textContent=cameraTargetMode==='duo'?'NEED TWO PLAYERS':'FINDING PLAYER';
  $('camera-hint').textContent=cameraTargetMode==='duo'?'BOTH PLAYERS MUST BE VISIBLE':'KEEP SHOULDERS AND HIPS IN FRAME';
  $('camera-hint').classList.remove('hidden');
  if(cameraTargetMode!=='lobby'&&!home.classList.contains('hidden')&&!setup.classList.contains('hidden')){
   $('calibrate-start').disabled=true;
   $('calibrate-start').textContent=cameraTargetMode==='duo'?'WAITING FOR TWO PLAYERS…':'WAITING FOR PLAYER…';
   $('setup-title').textContent=cameraTargetMode==='duo'?'LOOKING FOR BOTH PLAYERS':'LOOKING FOR PLAYER';
   $('setup-copy').textContent=cameraTargetMode==='duo'?'Move apart and keep both shoulders and hips in frame.':'Step back enough for your shoulders and hips to fit in frame, and face the camera.';
  }
 }
}
window.addEventListener('beforeunload',()=>{void motionEngine.stop();stream?.getTracks().forEach(track=>track.stop());if(audioContext)audioContext.close();viewport.destroy();});
void startCamera('lobby');

