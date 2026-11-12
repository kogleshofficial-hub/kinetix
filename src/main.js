import './kinetix-game-world.css';
import { CAMPAIGN_RANKS, KINETIX_MISSIONS, KINETIX_WORLDS, calculateMissionStars, getMissionById, rankForCampaign } from './engine/campaign/KinetixCampaign.js';
import { KinetixMotionEngine } from './engine/motion/KinetixMotionEngine.js';
import { KinetixCombatDirector } from './engine/combat/KinetixCombatDirector.js';
import { KinetixProgressionVault, LocalProfileAdapter } from './engine/progression/KinetixProgressionVault.js';
import { KinetixViewportCanvas } from './engine/viewport/KinetixViewportCanvas.js';
import { setupKinetixPWA } from './engine/platform/KinetixPWA.js';
import { createDailyChallenge, selectDailyLane } from './engine/challenge/KinetixDailyChallenge.js';
import { DailyRiftRecords } from './engine/challenge/DailyRiftRecords.js';
const $ = (id) => document.getElementById(id);
const home = $('home'), arena = $('arena'), canvas = $('game-canvas'), ctx = canvas.getContext('2d');
const video = $('video'), cameraPanel = $('camera-panel'), setup = $('setup');
const cameraSkeleton = $('camera-skeleton');
const cameraHomeParent = cameraPanel.parentNode, cameraHomeNextSibling = cameraPanel.nextSibling;
const modelUrl = '/models/pose_landmarker_lite.task';
const wasmUrl = '/mediapipe/wasm';
let soundOn = true, reducedMotion = false, cameraStatus = 'off', cameraMode = false, trackingOkay = false, paused = false;
let stream = null, cameraStarting = false;
let lastTrackingAt = 0, lastCameraActionAt = 0;
let calibrated = false;
let cameraTargetMode = 'lobby';
let pendingDailyChallenge = null;
const DIFFICULTIES=Object.freeze({
 easy:{label:'EASY / TRAINING',enemyHP:100,enemyDamage:12,firstWait:1.05,telegraph:1.05,opening:1.65,recovery:.52,guardDuration:1.25,dodgeDuration:1.2},
 normal:{label:'NORMAL',enemyHP:210,enemyDamage:28,firstWait:.62,telegraph:.46,opening:.62,recovery:.16,guardDuration:1.0,dodgeDuration:.95},
 hard:{label:'HARD / RIFT MASTER',enemyHP:420,enemyDamage:48,firstWait:.3,telegraph:.24,opening:.36,recovery:.08,guardDuration:.72,dodgeDuration:.68}
});
let difficulty='normal';
let activeMission=null, selectedMissionId=0, pendingCampaignMission=null;
function difficultyRules(){return DIFFICULTIES[difficulty]||DIFFICULTIES.easy;}
const MOTION_SENSITIVITY=Object.freeze({high:{label:'HIGH'},max:{label:'MAX'}});
let motionSensitivity='max';
let impactClearTimer=0;
let audioContext = null, raf = 0, previousFrame = 0, lastHudAt = 0, lastEventStamp = -1, eventFxAt = performance.now();
const PROFILE_STORAGE_KEY='kinetix-profile-v2';
const SOLO_REWARDS=Object.freeze({easy:15,normal:20,hard:30});
const USERNAME_CHANGE_COST=100;
const RANK_XP_BY_DIFFICULTY=Object.freeze({easy:10,normal:20,hard:35});
// Campaign rank catalogue: Rift Recruit, Kinetic Initiate, Pulse Adept, Rift Hunter, Void Vanguard, Rift Champion, Kinetix Sovereign.
const RANKS=CAMPAIGN_RANKS;
function rankForXp(value, activeProfile=null){
 const cleared=activeProfile?.campaign?.clearedMissions?.length||0;
 return rankForCampaign(value,cleared);
}
const COMBO_BANNERS=Object.freeze({
 classic:{name:'COMBO',price:0},
 unstoppable:{name:'UNSTOPPABLE',price:100},
 riftbreaker:{name:'RIFT BREAKER',price:250}
});
const CHARACTER_STYLES=Object.freeze({
 starter:{name:'Rift Runner',rarity:'Starter',price:0,core:'#bac4ff',aura:'#7b8bff',accent:'#7df5ff',glow:'#71eaff',halo:false},
 elite:{name:'Pulse Knight',rarity:'Elite',price:120,core:'#b7ffe4',aura:'#42d9a4',accent:'#e0fff4',glow:'#65ffd0',halo:false},
 epic:{name:'Void Striker',rarity:'Epic',price:300,core:'#e0c6ff',aura:'#9361f6',accent:'#f8e8ff',glow:'#c18aff',halo:false},
 legendary:{name:'Rift Sovereign',rarity:'Legendary',price:600,core:'#ffe5a4',aura:'#d69b36',accent:'#fff4cf',glow:'#ffd16a',halo:true}
});
const dailyRiftRecords = new DailyRiftRecords();
const progressionVault = new KinetixProgressionVault({
 adapter: new LocalProfileAdapter({ key: PROFILE_STORAGE_KEY, legacyKey: 'kinetix-profile-v1' }),
 characters: CHARACTER_STYLES,
 banners: COMBO_BANNERS
});
async function initializeKinetix() {
setupKinetixPWA({
  installButton: document.getElementById('pwa-install'),
  updateButton: document.getElementById('pwa-update')
});
let profile = await progressionVault.load();
async function saveProfile(){ return progressionVault.save(profile); }
const worldImages=Object.fromEntries(Object.entries(KINETIX_WORLDS).map(([id,world])=>{
 const image=new Image();image.decoding='async';image.src=world.art;return [id,image];
}));
function refreshStore(message){
 const name=$('profile-username'),wallet=$('wallet-balance'),wins=$('profile-wins'),equipped=$('equipped-character'),input=$('profile-name-input'),status=$('store-status');
 const rankName=$('rank-name'),rankXpLabel=$('rank-xp-label'),rankFill=$('rank-progress-fill'),rankNext=$('rank-next-label');
 const clearedCount=profile.campaign?.clearedMissions?.length||0;
 const currentRank=rankForXp(profile.rankXp,profile),rankIndex=RANKS.findIndex(rank=>rank.id===currentRank.id),nextRank=RANKS[rankIndex+1]||null;
 if(rankName)rankName.textContent=currentRank.name;
 if(rankXpLabel)rankXpLabel.textContent=nextRank?profile.rankXp+' / '+nextRank.xp+' XP · '+clearedCount+' / '+nextRank.clears+' LEVELS':profile.rankXp+' XP · '+clearedCount+' / 12 LEVELS';
 if(rankFill){
  const xpProgress=nextRank?Math.max(0,Math.min(1,(profile.rankXp-currentRank.xp)/Math.max(1,nextRank.xp-currentRank.xp))):1;
  const levelProgress=nextRank?Math.max(0,Math.min(1,(clearedCount-currentRank.clears)/Math.max(1,nextRank.clears-currentRank.clears))):1;
  rankFill.style.width=(Math.min(xpProgress,levelProgress)*100)+'%';
 }
 if(rankNext)rankNext.textContent=nextRank?Math.max(0,nextRank.xp-profile.rankXp)+' XP + '+Math.max(0,nextRank.clears-clearedCount)+' MISSION CLEAR(S) TO '+nextRank.name.toUpperCase():'CAMPAIGN COMPLETE · MAX RANK';
 document.querySelectorAll('[data-rank-id]').forEach(card=>{
  const rank=RANKS.find(item=>item.id===card.dataset.rankId);if(!rank)return;
  const unlocked=profile.rankXp>=rank.xp&&clearedCount>=rank.clears;
  card.classList.toggle('unlocked',unlocked);
  card.classList.toggle('current',rank.id===currentRank.id);
  const state=card.querySelector('[data-rank-state]');
  if(state)state.textContent=rank.id===currentRank.id?'CURRENT':unlocked?'UNLOCKED':'LOCKED';
 });
 renderCampaignMap();
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
 const stars=g.mission?calculateMissionStars({
  healthRatio:g.pHP/Math.max(1,g.playerMaxHP||120),accuracy:accuracy(),bestCombo:g.best
 }):0;
 g.missionStars=stars;
 const result=g.mission
  ?await progressionVault.awardMissionClear(g.mission.id,stars)
  :await progressionVault.awardPracticeVictory();
 if(!result.ok)throw new Error('This campaign mission is not unlocked yet.');
 profile=result.profile;
 g.rewardEarned=result.reward.kinets;g.rankXpEarned=result.reward.xp;
 g.missionFirstClear=Boolean(result.firstClear);
 g.missionBestStars=result.stars||stars;
 g.missionNextId=result.nextMissionId||null;
 g.rankUp=Boolean(result.rankedUp);g.rankName=(result.rankAfter||rankForXp(profile.rankXp,profile)).name;
 const message=g.mission
  ?(g.missionFirstClear?'Mission cleared. ':'Replay complete. ')+(g.missionFirstClear?'+'+g.rewardEarned+' Kinets · +'+g.rankXpEarned+' Rank XP earned.':'Best stars updated; first-clear rewards are not repeated.')
  :'Practice victory. +'+g.rewardEarned+' Kinets. Clear campaign missions to earn Rank XP.';
 refreshStore(message+(g.rankUp?' · RANK UP: '+g.rankName:''));
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
 onAction: (kind,player,source,details) => {
  if(source==='camera'&&kind!=='GUARD_RELEASE'){
   lastCameraActionAt=performance.now();
   const labels={PULSE:'PULSE DETECTED',GUARD:'GUARD ACTIVE',PHASE_LEFT:'PHASE LEFT',PHASE_RIGHT:'PHASE RIGHT',NOVA:'NOVA RELEASED'};
   const label=$('camera-label');if(label)label.textContent=labels[kind]||'MOTION DETECTED';
  }
  action(kind,player,source,details);
 },
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
function refreshDailyChallengePanel(){
 const challenge=createDailyChallenge(),record=dailyRiftRecords.get(challenge.date),label=$('daily-challenge-record');
 $('daily-challenge-date').textContent=challenge.date+' UTC · SEED '+challenge.code;
 label.textContent=record?'PERSONAL BEST · '+(record.best.cleared?'CLEAR':'BEST ATTEMPT')+' · '+record.best.combo+'× COMBO · '+record.attempts+' RUNS':'NO PERSONAL RECORD YET · YOUR FIRST RUN SETS IT';
}
refreshDailyChallengePanel();

function freshFighter(){return {hp:100,mana:70,combo:0,best:0,lane:0,guardUntil:0,dodgeUntil:0,lastPulse:-9999,lastNova:-9999,lastPhase:-9999,attackUntil:0,hurtUntil:0,medkits:1,collectCooldown:0,pulses:0,clean:0,dodges:0,blocks:0,hits:0,damage:0};}
function freshGame(mode='solo'){
 const p1=freshFighter(),p2=freshFighter();
 return {
 status:'ready',mode:mode,difficulty:difficulty,phase:mode==='duo'?'duel':'idle',
 time:mode==='duo'?60:(activeMission?.time||75),clock:0,
 pHP:mode==='duo'?100:120,playerMaxHP:mode==='duo'?100:120,
 eHP:mode==='duo'?100:(activeMission?.enemyHp||difficultyRules().enemyHP),
 enemyMaxHP:mode==='duo'?100:(activeMission?.enemyHp||difficultyRules().enemyHP),
 energy:72,playerHurtUntil:0,playerAttackUntil:0,playerAttackSide:1,enemyHurtUntil:0,
 combo:0,best:0,lane:0,target:0,attackIndex:0,
 phaseTimer:mode==='duo'?1.35:(activeMission?.firstWait||difficultyRules().firstWait),
 guardUntil:0,dodgeUntil:0,lastPulse:-9999,lastNova:-9999,lastPhase:-9999,
 event:'none',eventAt:0,msg:mode==='duo'?'LOCAL DUEL READY':'THE RIFT IS STIRRING',tone:'neutral',
 pulses:0,clean:0,dodges:0,blocks:0,hits:0,damage:0,p1:p1,p2:p2,winner:null,
 medkits:1,pickup:null,nextSupplyAt:8,supplyCount:0,damageFlashAt:0,hitPlayer:0,
 rewardGranted:false,rewardEarned:0,rankXpEarned:0,rankUp:false,rankName:'',
 perfectGuardArmedUntil:-9999,perfectPhaseArmedUntil:-9999,perfectReads:0,perfectFxUntil:0,hitStopUntil:0,
 adrenalineTriggered:false,adrenalineUsed:false,adrenalineUntil:0,
 mission:mode==='solo'&&activeMission?{...activeMission}:null,missionStars:0,missionFirstClear:false,
 missionBestStars:0,missionNextId:null
 };
}
function beginGame(mode='solo',dailyChallenge=null){
 g=freshGame(mode);g.dailyChallenge=mode==='solo'&&dailyChallenge?dailyChallenge:null;g.status='playing';
 if(g.mission)activeMission=g.mission;
 const arenaKicker=document.querySelector('.arena-head .kicker');
 if(arenaKicker)arenaKicker.textContent=g.mission?'CAMPAIGN / CHAPTER '+String(g.mission.chapter).padStart(2,'0')+' / LEVEL '+String(g.mission.id).padStart(2,'0'):g.dailyChallenge?'DAILY RIFT / UTC '+g.dailyChallenge.date:'RIFT DUEL / FREE PLAY';
 const arenaTitle=$('arena-title');if(arenaTitle)arenaTitle.textContent=g.mission?g.mission.title:g.dailyChallenge?'THE DAILY BREACH':'THE FIRST BREACH';
 canvas.parentElement.dataset.world=g.mission?.world||'verdant';g.msg=g.dailyChallenge?'DAILY RIFT '+g.dailyChallenge.date+' — READ THE PATTERN':mode==='duo'?'DUEL ONLINE — MAKE YOUR MOVE':'READ THE RIFT. FIND YOUR MOMENT.';
 paused=false;lastEventStamp=-1;combatDirector.beginMatch(g.dailyChallenge?{seed:g.dailyChallenge.seed}:undefined);$('overlay').classList.add('hidden');eventFxAt=performance.now();previousFrame=performance.now();showScreen('arena');setCameraPanelInArena(cameraMode&&cameraStatus==='ready');
 $('moves-main').classList.toggle('hidden',mode==='duo');$('duo-controls').classList.toggle('hidden',mode!=='duo');
 $('mode-pill').innerHTML='<b></b>'+(mode==='duo'?(cameraMode?'2P MOTION ONLINE':'2P LOCAL DUEL'):(cameraMode?'MOTION ONLINE':'SOLO VS AI'));
 $('mode-pill').classList.toggle('live',cameraMode&&cameraStatus==='ready');$('move-mode').textContent=mode==='duo'?'TWO PLAYER TOUCH CONTROLS':'KEYBOARD / CLICK CONTROLS';updateHud();
}
function setCameraPanelInArena(inArena){
 const frame=document.querySelector('.game-frame');
 if(inArena&&frame&&cameraPanel.parentNode!==frame)frame.appendChild(cameraPanel);
 else if(!inArena&&cameraPanel.parentNode!==cameraHomeParent)cameraHomeParent.insertBefore(cameraPanel,cameraHomeNextSibling);
 cameraPanel.classList.toggle('in-arena',Boolean(inArena));
}
function showScreen(which) {
 home.classList.toggle('hidden',which!=='home');
 arena.classList.toggle('hidden',which!=='arena');
 if(which!=='arena')setCameraPanelInArena(false);
}
function announce(event,msg,tone) { g.event=event; g.eventAt=g.clock; eventFxAt=performance.now(); g.msg=msg; g.tone=tone||'neutral'; combatDirector.emit('combat:notice',{event,msg,tone:tone||'neutral',tick:combatDirector.tick}); }
function sfx(name) {
  if(!soundOn) return;
  try {
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
    audioContext=audioContext||new AC();if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});
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
function action(kind,player=1,source='ui',details=null){
 if(g.status!=='playing'||(paused&&kind!=='GUARD_RELEASE')||(cameraMode&&!trackingOkay&&kind!=='GUARD_RELEASE'))return false;
 return combatDirector.enqueueAction(kind,player,source,details);
}


function enemyAttack(){
 if(g.guardUntil>g.clock){
  const perfect=g.perfectGuardArmedUntil>=g.clock;g.perfectGuardArmedUntil=-9999;
  g.energy=Math.min(100,g.energy+(perfect?24:17));g.blocks++;g.combo++;g.best=Math.max(g.best,g.combo);g.phase='vulnerable';g.phaseTimer=g.mission?.opening||difficultyRules().opening;
  if(perfect){triggerPerfectDefense('guard');return;}
  announce('block','GUARD  +17 ENERGY','good');sfx('block');return;
 }
 if(g.lane!==g.target||g.dodgeUntil>g.clock){
  const perfect=g.perfectPhaseArmedUntil>=g.clock;g.perfectPhaseArmedUntil=-9999;
  g.energy=Math.min(100,g.energy+(perfect?25:18));g.dodges++;g.combo++;g.best=Math.max(g.best,g.combo);g.phase='vulnerable';g.phaseTimer=g.mission?.opening||difficultyRules().opening;
  if(perfect){triggerPerfectDefense('phase');return;}
  announce('dodge','PHASE SHIFT  +18 ENERGY','good');sfx('dodge');return;
 }
 const damage=g.mission?.enemyDamage||difficultyRules().enemyDamage;g.pHP=Math.max(0,g.pHP-damage);g.playerHurtUntil=g.clock+.48;g.hits++;g.combo=0;g.phase='vulnerable';g.phaseTimer=g.mission?.opening||difficultyRules().opening;announce('hit','RIFT IMPACT  −'+damage+' HP','danger');sfx('hit');showImpact(1,damage);
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
 if(g.dailyChallenge&&g.mode==='solo'){
   try{
    const saved=dailyRiftRecords.record(g.dailyChallenge,{status,bestCombo:g.best,damage:g.damage,accuracy:accuracy()});
    g.dailyRecord=saved.record;g.dailyRecordPersisted=saved.persisted;refreshDailyChallengePanel();
   }catch(error){console.error('[KINETIX DAILY RIFT]',error);}
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
 if(g.phaseTimer<=0){if(g.phase==='idle'){const patterns={
 scout:[0,0,1,0,-1,0],stalker:[-1,1,-1,0,1,0],watcher:[0,-1,0,1,0,-1],
 warden:[0,1,-1,1,0,-1],tide:[1,0,-1,1,-1,0],echo:[-1,0,1,0,-1,1],
 heavy:[0,1,1,-1,0,-1], 'drowned-boss':[1,-1,0,-1,1,0],fortress:[0,0,-1,1,0,1],
 furnace:[1,0,1,-1,0,-1],champion:[-1,1,0,1,-1,0],sovereign:[0,1,-1,0,1,-1]
 };
 const basePattern=difficulty==='easy'?[0,0,1,0,-1,0]:[0,1,-1,0,-1,1];
 const encounterPattern=g.mission?(patterns[g.mission.pattern]||basePattern):basePattern;
 if(g.dailyChallenge||(!g.mission&&difficulty==='hard')){g.target=selectDailyLane(()=>combatDirector.random(),g.target);}
 else{g.target=encounterPattern[g.attackIndex%encounterPattern.length];}g.attackIndex++;g.phase='telegraph';g.phaseTimer=g.mission?.telegraph||difficultyRules().telegraph;announce('none',g.target===-1?'LEFT-LANE SURGE':g.target===1?'RIGHT-LANE SURGE':'CENTER-LANE SURGE','danger');}else if(g.phase==='telegraph'){g.phase='strike';enemyAttack();}else if(g.phase==='strike'){g.phase='vulnerable';g.phaseTimer=1.2;}else if(g.phase==='vulnerable'){g.phase='idle';g.phaseTimer=g.mission?.recovery||difficultyRules().recovery;g.guardUntil=Math.min(g.guardUntil,g.clock);g.msg='NEXT WINDOW APPROACHING';g.tone='neutral';}}
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
 }else{const labels=document.querySelectorAll('.fighter-label');if(labels[1])labels[1].innerHTML='RIFT ENTITY <i>● HOSTILE</i>';const names=document.querySelectorAll('.fighter-data strong');if(names[0])names[0].textContent=profile.username;if(names[1])names[1].textContent=g.mission?.enemyName||'THE HOLLOW';}
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
 if(stats&&g.mode==='solo'&&g.rewardEarned>0)html+='<div class="reward-earned"><span>'+(g.mission?'MISSION REWARD':'PRACTICE REWARD')+'</span><b>+'+g.rewardEarned+' KINETS</b><small>'+(g.rankXpEarned?'+'+g.rankXpEarned+' RANK XP · ':'NO RANK XP · ')+rankForXp(profile.rankXp,profile).name+' · Wallet: '+profile.kinets+' Kinets</small></div>';
 if(stats&&g.mission&&g.status==='won'){
  const stars=g.missionBestStars||g.missionStars||1;
  html+='<div class="mission-result"><span>MISSION PERFORMANCE / LEVEL '+String(g.mission.id).padStart(2,'0')+'</span><div class="mission-result-stars">'+[1,2,3].map(index=>'<b class="'+(index<=stars?'earned':'')+'">★</b>').join('')+'</div><strong>'+stars+' / 3 STARS</strong><small>'+(g.missionFirstClear?'FIRST CLEAR · NEXT LEVEL UNLOCKED':'REPLAY · FIRST-CLEAR REWARDS ALREADY CLAIMED')+'</small></div>';
 }
 if(stats&&g.mode==='solo'&&g.rankUp)html+='<div class="rank-up-banner"><span>RANK PROMOTED</span><b>✧ '+g.rankName.toUpperCase()+' ✧</b><small>Keep winning solo rounds to reach the next tier.</small></div>';
 buttons.forEach(b=>html+='<button class="btn '+b.style+'" data-overlay="'+b.action+'">'+b.label+'</button>');
 if(!stats)html+='<button class="text-btn" data-overlay="home">EXIT TO MAIN MENU</button>';
 dialog.innerHTML=html;
 dialog.querySelectorAll('[data-overlay]').forEach(b=>b.addEventListener('click',()=>{const action=b.dataset.overlay;if(action==='resume'){if(soundOn&&audioContext&&audioContext.state==='suspended')audioContext.resume().catch(()=>{});paused=false;$('overlay').classList.add('hidden');updateHud();}else if(action==='restart'){beginGame(g.mode,g.dailyChallenge||null);}else if(action==='next-mission'){
 const next=getMissionById(g.missionNextId);if(next){activeMission=next;selectedMissionId=next.id;setDifficulty(next.difficulty);beginGame('solo');}
 }else if(action==='campaign'){
 stopCamera(true);paused=false;activeMission=null;selectedMissionId=profile.campaign?.highestUnlocked||1;g=freshGame();showScreen('home');$('overlay').classList.add('hidden');renderCampaignMap();$('campaign-panel').scrollIntoView({behavior:'smooth',block:'start'});
 }else if(action==='home'){stopCamera(true);paused=false;activeMission=null;g=freshGame();showScreen('home');$('overlay').classList.add('hidden');renderCampaignMap();}else if(action==='store'){stopCamera(true);paused=false;activeMission=null;g=freshGame();showScreen('home');$('overlay').classList.add('hidden');$('kinet-store').scrollIntoView({behavior:'smooth',block:'start'});}else if(action==='card')downloadCard();}));
}
function accuracy(){return g.pulses?Math.round(g.clean/g.pulses*100):0;}
function setDifficulty(next){
 if(!DIFFICULTIES[next])return;
 difficulty=next;
 document.querySelectorAll('[data-difficulty]').forEach(option=>{
  const selected=option.dataset.difficulty===next;option.classList.toggle('active',selected);option.setAttribute('aria-pressed',String(selected));
 });
}
function renderCampaignMap(){
 const root=$('campaign-missions');if(!root||!profile)return;
 const cleared=new Set(profile.campaign?.clearedMissions||[]);
 const highest=profile.campaign?.highestUnlocked||1;
 const firstUncleared=KINETIX_MISSIONS.find(m=>!cleared.has(m.id))||KINETIX_MISSIONS[KINETIX_MISSIONS.length-1];
 if(!getMissionById(selectedMissionId)||selectedMissionId>highest)selectedMissionId=firstUncleared.id;
 const selected=getMissionById(selectedMissionId)||firstUncleared;
 const stars=profile.campaign?.stars||{};
 const completed=cleared.size;
 root.innerHTML=[1,2,3].map(chapter=>{
  const missions=KINETIX_MISSIONS.filter(m=>m.chapter===chapter);
  const world=KINETIX_WORLDS[missions[0].world];
  const clearedInChapter=missions.filter(m=>cleared.has(m.id)).length;
  return '<section class="campaign-chapter"><div class="campaign-chapter-head"><div><small>REGION 0'+chapter+'</small><strong>'+missions[0].chapterName+'</strong><em>'+world.subtitle+'</em></div><span>'+clearedInChapter+' / 4 CLEARED</span></div><div class="mission-grid">'+missions.map(m=>{
   const isCleared=cleared.has(m.id),locked=m.id>highest,selectedMission=m.id===selected.id,score=Number(stars[m.id]||0);
   return '<button type="button" class="mission-card'+(isCleared?' cleared':'')+(locked?' locked':'')+(selectedMission?' selected':'')+'" data-mission-id="'+m.id+'" aria-pressed="'+selectedMission+'" '+(locked?'disabled':'')+'><span class="mission-thumb" style="background-image:linear-gradient(180deg,rgba(4,9,9,.08),rgba(4,9,9,.82)),url('+world.art+')"></span><span class="mission-card-top"><small>LEVEL '+String(m.id).padStart(2,'0')+'</small><b>'+(locked?'LOCKED':isCleared?'CLEARED':'AVAILABLE')+'</b></span><strong>'+m.title+'</strong><small class="mission-location">'+m.location+'</small><span class="mission-card-bottom"><em>'+m.threat+'</em><span class="mission-card-stars">'+[1,2,3].map(i=>'<i class="'+(i<=score?'earned':'')+'">★</i>').join('')+'</span></span></button>';
  }).join('')+'</div></section>';
 }).join('');
 const world=KINETIX_WORLDS[selected.world];
 $('campaign-progress').textContent=completed+' / 12 MISSIONS COMPLETE';
 $('campaign-progress-fill').style.width=(completed/12*100)+'%';
 $('campaign-selected-world').textContent='REGION 0'+selected.chapter+' / '+selected.chapterName;
 $('campaign-selected-title').textContent=selected.title;
 $('campaign-selected-description').textContent=selected.description;
 $('campaign-selected-location').textContent=selected.location+' · THREAT: '+selected.threat+' · '+selected.difficulty.toUpperCase();
 $('campaign-selected-objective').textContent=selected.objective;
 $('campaign-selected-scene').src=world.art;
 $('campaign-selected-scene').alt=world.name+' environment';
 $('campaign-play').textContent=cleared.has(selected.id)?'REPLAY LEVEL →':'DEPLOY LEVEL →';
 $('campaign-play').disabled=selected.id>highest;
 $('campaign-camera').disabled=selected.id>highest;
 $('campaign-next-hint').textContent=cleared.has(selected.id)?'BEST RECORD · '+(stars[selected.id]||1)+' / 3 STARS':'CLEAR THIS LEVEL TO UNLOCK THE NEXT';
 $('campaign-complete').textContent=completed===12?'FIRST CAMPAIGN COMPLETE · ALL REGIONS CLEARED':'NEXT UNLOCK · '+String(highest).padStart(2,'0')+' / 12';
}
function startCampaignMission(id,useCamera=false){
 const mission=getMissionById(id);
 if(!mission||mission.id>(profile.campaign?.highestUnlocked||1))return;
 selectedMissionId=mission.id;activeMission=mission;setDifficulty(mission.difficulty);renderCampaignMap();
 if(useCamera){chooseGameMode('solo');return;}
 pendingCampaignMission=mission;
 startSoloWithoutCamera();
}

function showResult(){
 if(g.mode==='duo'){const winner=g.winner;const title=winner===0?'PERFECTLY EVEN.':'PLAYER '+winner+' WINS.';const desc=winner===0?'Both fighters end the round with the same health. Local Duo is practice play: no Kinets or Rank XP are awarded.':(winner===1?'Player One controlled the arena this round.':'Player Two controlled the arena this round.')+' No progression currency is awarded in local Duo.'
 showOverlay(title,desc,'LOCAL DUEL / SESSION REPORT',[{label:'RUN IT BACK →',style:'primary',action:'restart'},{label:'EXPORT RESULT CARD',style:'secondary',action:'card'},{label:'BACK TO MAIN MENU',style:'secondary',action:'home'}],true);return;}
 const won=g.status==='won';
 if(g.mission){
  if(won){
   const next=KINETIX_MISSIONS.find(m=>!profile.campaign.clearedMissions.includes(m.id))||null;
   g.missionNextId=next?.id||null;
   const buttons=next
    ?[{label:'CONTINUE CAMPAIGN →',style:'primary',action:'next-mission'},{label:'REPLAY THIS LEVEL',style:'secondary',action:'restart'},{label:'CAMPAIGN MAP',style:'secondary',action:'campaign'}]
    :[{label:'REPLAY FINAL LEVEL',style:'primary',action:'restart'},{label:'CAMPAIGN MAP',style:'secondary',action:'campaign'},{label:'BACK TO MENU',style:'secondary',action:'home'}];
   showOverlay(next?'MISSION COMPLETE':'CAMPAIGN COMPLETE',g.mission.description+' '+(next?'Next objective: '+next.title+'.':'You have closed the first KINETIX campaign.'),'CHAPTER '+g.mission.chapter+' / LEVEL '+String(g.mission.id).padStart(2,'0'),buttons,true);
  }else{
   showOverlay('MISSION FAILED',g.mission.description+' Study the warning, adjust your timing and try again. No level progress or first-clear rewards are awarded for an unfinished mission.','CAMPAIGN / '+g.mission.title.toUpperCase(),[{label:'RETRY MISSION →',style:'primary',action:'restart'},{label:'CAMPAIGN MAP',style:'secondary',action:'campaign'},{label:'BACK TO MENU',style:'secondary',action:'home'}],true);
  }
  return;
 }
  const title=won?(difficulty==='hard'?'HARD CLEAR — RIFT COLLAPSED.':'RIFT COLLAPSED.'):g.status==='time-up'?'TIME FRACTURED.':'SIGNAL LOST';
  const description=won?(difficulty==='hard'?'You survived the 420 HP Rift Master. Every counter, guard and phase mattered.':'You read the pattern and closed the breach on '+difficultyRules().label+'.'):g.status==='time-up'?'The Rift is still standing. Review your timing and try a different approach.':'The Hollow won this round. Try '+(difficulty==='hard'?'Normal to practice your timing, then return to Hard':difficulty==='normal'?'Easy to learn the moves, then return to Normal':'the round again')+' when ready.';
  const dailyTag=g.dailyChallenge?'DAILY RIFT / UTC '+g.dailyChallenge.date+' / SEED '+g.dailyChallenge.code:'RIFT DUEL / '+difficultyRules().label+' / SESSION REPORT';
  const dailyCopy=g.dailyChallenge?' Daily seed: '+g.dailyChallenge.code+'. Personal best: '+(g.dailyRecord?.best.cleared?'CLEAR':'ATTEMPT')+', '+(g.dailyRecord?.best.combo||0)+'× combo across '+(g.dailyRecord?.attempts||1)+' local runs. This is a device-only record, not an online leaderboard or verified score.'+(g.dailyRecordPersisted===false?' Browser storage was unavailable, so this record lasts only for this page session.':''):'';
  showOverlay(title,description+dailyCopy,dailyTag,[{label:g.dailyChallenge?'REPLAY DAILY RIFT →':'RUN IT BACK →',style:'primary',action:'restart'},{label:'OPEN KINET STORE ◈',style:'secondary',action:'store'},{label:'EXPORT RESULT CARD',style:'secondary',action:'card'},{label:'BACK TO MAIN MENU',style:'secondary',action:'home'}],true);
}
function pauseGame(){if(g.status!=='playing')return;paused=true;combatDirector.clearCommands('paused');showOverlay('Catch your breath.','The rift is frozen. Your progress is still here.','SESSION PAUSED',[{label:'RESUME ROUND →',style:'primary',action:'resume'},{label:'RESTART ROUND',style:'secondary',action:'restart'}],false);}
function pauseForPageExit(){
 if(audioContext&&audioContext.state!=='suspended'&&audioContext.state!=='closed')audioContext.suspend().catch(()=>{});
 if(!paused&&!arena.classList.contains('hidden')&&g.status==='playing')pauseGame();
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseForPageExit();});
window.addEventListener('blur',pauseForPageExit);
function downloadCard(){
 const c=document.createElement('canvas');c.width=1200;c.height=630;const x=c.getContext('2d');if(!x)return;
 const bg=x.createLinearGradient(0,0,1200,630);bg.addColorStop(0,'#0b0d20');bg.addColorStop(.55,'#171632');bg.addColorStop(1,'#080a14');x.fillStyle=bg;x.fillRect(0,0,1200,630);
 const glow=x.createRadialGradient(880,270,5,880,270,430);glow.addColorStop(0,g.status==='won'?'rgba(85,240,215,.24)':'rgba(143,111,255,.22)');glow.addColorStop(1,'rgba(10,12,25,0)');x.fillStyle=glow;x.fillRect(0,0,1200,630);
 x.strokeStyle='rgba(145,160,255,.12)';for(let xx=0;xx<1200;xx+=42){x.beginPath();x.moveTo(xx,0);x.lineTo(xx,630);x.stroke();}
 x.fillStyle='#a99bff';x.font='500 23px monospace';x.fillText('KINETIX / RIFT DUEL',74,83);x.fillStyle='#f7f5ff';x.font='700 77px sans-serif';x.fillText(g.mode==='duo'?(g.winner===0?'DUEL DRAW':'PLAYER '+g.winner+' WINS'):g.status==='won'?'RIFT COLLAPSED':g.status==='time-up'?'TIME FRACTURED':'SIGNAL LOST',72,205);x.fillStyle='#9aa3c6';x.font='500 24px sans-serif';x.fillText('YOUR BODY. YOUR POWER. YOUR ARENA.',76,251);
 [['BEST COMBO',String(g.best).padStart(2,'0')],['DAMAGE DEALT',String(g.damage).padStart(3,'0')],['CLEAN PULSES',accuracy()+'%'],['PHASE DODGES',String(g.dodges).padStart(2,'0')]].forEach((item,i)=>{const xx=76+i*274;x.fillStyle='rgba(255,255,255,.045)';x.beginPath();x.roundRect(xx,346,245,116,18);x.fill();x.fillStyle='#8c96bc';x.font='14px monospace';x.fillText(item[0],xx+19,379);x.fillStyle='#f7f5ff';x.font='700 43px sans-serif';x.fillText(item[1],xx+19,432);});
 if(g.mode==='duo'){x.fillStyle='#b3a2ff';x.font='18px monospace';x.fillText('P1 HP '+g.p1.hp+'   /   P2 HP '+g.p2.hp,77,505);}x.fillStyle='#6c7395';x.font='17px monospace';if(g.dailyChallenge){x.fillStyle='#67e8ef';x.font='500 18px monospace';x.fillText('DAILY RIFT · '+g.dailyChallenge.date+' · SEED '+g.dailyChallenge.code,77,518);x.fillStyle='#aab2d0';x.font='14px monospace';x.fillText('PERSONAL BEST · '+(g.dailyRecord?.best.cleared?'CLEAR':'ATTEMPT')+' · '+(g.dailyRecord?.best.combo||0)+'× COMBO',77,540);}x.fillStyle='#6c7395';x.font='17px monospace';x.fillText('A PLAYABLE PROTOTYPE BY KOGLESH R. MURUGAN',77,564);const a=document.createElement('a');a.download='kinetix-rift-duel.png';a.href=c.toDataURL('image/png');a.click();
}
function draw(t) {
 const r=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
 if(!r.width||!r.height)return;
 if(canvas.width!==Math.floor(r.width*dpr)||canvas.height!==Math.floor(r.height*dpr)){
  canvas.width=Math.max(1,Math.floor(r.width*dpr));canvas.height=Math.max(1,Math.floor(r.height*dpr));
 }
 ctx.setTransform(dpr,0,0,dpr,0,0);
 const w=r.width,h=r.height,tm=reducedMotion?4000:t;
 ctx.clearRect(0,0,w,h);

 const floor=h*.875,horizon=h*.55;
 const acid='#c8ff3d',ice='#9ce9e2',steel='#26373b',violet='#a98bff';
 const poly=(points,fill,stroke='rgba(190,216,203,.18)',width=1)=>{
  ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));
  ctx.closePath();ctx.fillStyle=fill;ctx.fill();
  if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}
 };
 const beam=(x,top,spread,color,alpha)=>{
  ctx.save();ctx.globalAlpha=alpha;
  const g=ctx.createLinearGradient(x,top,x+spread,horizon);
  g.addColorStop(0,color);g.addColorStop(1,'rgba(150,190,170,0)');
  poly([[x-5,top],[x+5,top],[x+spread,horizon],[x-spread,horizon]],g,null);
  ctx.restore();
 };

 // The world: a deep, enclosed arena rather than a floating grid.
 const worldId=g.mission?.world||'verdant';
 const worldImage=worldImages[worldId];
 if(worldImage?.complete&&worldImage.naturalWidth)ctx.drawImage(worldImage,0,0,w,h);
 else{
  const fallback=ctx.createLinearGradient(0,0,0,h);
  fallback.addColorStop(0,'#819a91');fallback.addColorStop(.55,'#364e48');fallback.addColorStop(1,'#111a18');
  ctx.fillStyle=fallback;ctx.fillRect(0,0,w,h);
 }
 const worldPalette=KINETIX_WORLDS[worldId]?.palette||KINETIX_WORLDS.verdant.palette;
 const atmosphere=ctx.createLinearGradient(0,0,0,h);
 atmosphere.addColorStop(0,'rgba(5,11,12,.08)');atmosphere.addColorStop(.48,'rgba(5,11,12,.12)');atmosphere.addColorStop(1,'rgba(4,9,9,.72)');
 ctx.fillStyle=atmosphere;ctx.fillRect(0,0,w,h);
 const horizonGlow=ctx.createRadialGradient(w*.52,horizon*.74,2,w*.52,horizon*.74,Math.min(w,h)*.58);
 horizonGlow.addColorStop(0,worldId==='ashen'?'rgba(255,190,115,.15)':worldId==='drowned'?'rgba(128,221,214,.14)':'rgba(200,255,61,.12)');
 horizonGlow.addColorStop(1,'rgba(3,8,9,0)');ctx.fillStyle=horizonGlow;ctx.fillRect(0,0,w,h);
 const lowMist=ctx.createLinearGradient(0,horizon-24,0,horizon+115);
 lowMist.addColorStop(0,'rgba(190,211,190,0)');lowMist.addColorStop(.55,worldId==='ashen'?'rgba(193,164,133,.11)':'rgba(178,204,192,.12)');lowMist.addColorStop(1,'rgba(8,15,14,0)');
 ctx.fillStyle=lowMist;ctx.fillRect(0,horizon-24,w,145);
 for(let i=0;i<28;i++){
  const x=((i*97.3+tm*(.003+(i%4)*.0012))%(w+24))-12;
  const y=((i*59.1+Math.sin(tm*.0004+i)*10)%(h*.72));
  ctx.fillStyle=worldId==='ashen'?'rgba(242,205,160,.16)':'rgba(221,236,215,.15)';
  ctx.beginPath();ctx.arc(x,y,i%8===0?1.35:.65,0,Math.PI*2);ctx.fill();
 }
 // Arena floor with physical perspective, floor seams and a central ring.
 const floorGrad=ctx.createLinearGradient(0,horizon,0,h);
 floorGrad.addColorStop(0,worldPalette.floor);floorGrad.addColorStop(.18,'#111d1d');floorGrad.addColorStop(1,'#070d0f');
 poly([[w*.18,horizon],[w*.82,horizon],[w*1.12,h],[-w*.12,h]],floorGrad,'rgba(178,204,185,.22)',1);
 for(let i=-8;i<=8;i++){
  ctx.strokeStyle=i===0?'rgba(200,255,61,.23)':'rgba(176,204,186,.1)';
  ctx.lineWidth=i===0?1.4:1;
  ctx.beginPath();ctx.moveTo(w*.5+i*w*.018,horizon);ctx.lineTo(w*.5+i*w*.105,h);ctx.stroke();
 }
 for(let i=1;i<=9;i++){
  const p=i/9,y=horizon+(h-horizon)*p*p;
  ctx.strokeStyle='rgba(178,204,185,'+(0.1-p*.045)+')';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(w*.18-p*w*.3,y);ctx.lineTo(w*.82+p*w*.3,y);ctx.stroke();
 }
 ctx.save();ctx.translate(w*.5,h*.81);ctx.scale(1,.23);
 ctx.strokeStyle='rgba(200,255,61,.28)';ctx.lineWidth=2;
 ctx.beginPath();ctx.ellipse(0,0,w*.25,h*.26,0,0,Math.PI*2);ctx.stroke();
 ctx.strokeStyle='rgba(183,207,194,.18)';ctx.lineWidth=1;
 ctx.beginPath();ctx.ellipse(0,0,w*.31,h*.34,0,0,Math.PI*2);ctx.stroke();
 ctx.restore();

 // Low fog, ambient specks and drifting sparks.
 const fog=ctx.createLinearGradient(0,horizon-35,0,horizon+90);
 fog.addColorStop(0,'rgba(143,174,151,0)');fog.addColorStop(.55,'rgba(143,174,151,.075)');fog.addColorStop(1,'rgba(143,174,151,0)');
 ctx.fillStyle=fog;ctx.fillRect(0,horizon-35,w,125);
 for(let i=0;i<55;i++){
  const x=((i*83.17+tm*(.004+(i%5)*.0015))%(w+30))-15;
  const y=((i*47.3+Math.sin(tm*.00035+i)*13)%(h+18))-9;
  const a=.12+((Math.sin(tm*.001+i*1.4)+1)*.08);
  ctx.fillStyle='rgba(215,232,207,'+a+')';ctx.beginPath();ctx.arc(x,y,i%9===0?1.5:.7,0,Math.PI*2);ctx.fill();
 }

 const baseScale=Math.min(w*.18,h*.32,148);
 function drawFighter(x,side,actor=null){
  const isEnemy=side===2,isOpponent=isEnemy&&g.mode!=='duo';
  const style=isOpponent?null:(CHARACTER_STYLES[profile.equippedCharacter]||CHARACTER_STYLES.starter);
  const soloPlayer=side===1&&g.mode!=='duo';
  const lane=soloPlayer?g.lane:(actor?.lane||0);
  const hurt=isOpponent?g.enemyHurtUntil>g.clock:(soloPlayer?g.playerHurtUntil>g.clock:actor.hurtUntil>g.clock);
  const attacking=isOpponent?g.phase==='strike':(soloPlayer?g.playerAttackUntil>g.clock:actor.attackUntil>g.clock);
  const guarding=isOpponent?false:(soloPlayer?g.guardUntil>g.clock:actor.guardUntil>g.clock);
  const dodging=!isOpponent&&!soloPlayer&&actor.dodgeUntil>g.clock;
  const accent=isOpponent?(hurt?'#ff9a83':g.phase==='vulnerable'?worldPalette.accent:g.phase==='telegraph'?'#ffbd79':violet):(side===2?'#c2a7ff':(style?.glow||acid));
  const trim=isOpponent?'#bca7e8':(side===2?'#e2d2ff':(style?.accent||ice));
  const threatScale={SCOUT:.88,STALKER:1.02,ELITE:1.12,BOSS:1.24,HEAVY:1.2,VETERAN:1.13,CHAMPION:1.27,'FINAL BOSS':1.36};
  const scale=baseScale*(isOpponent?(threatScale[g.mission?.threat]||1.11):1);
  const laneShift=lane===-1?-1:lane===1?1:0;
  const bob=reducedMotion?0:Math.sin(tm*.0025+(isEnemy?1:0))*scale*.018;
  const sway=reducedMotion?0:Math.sin(tm*.002+(isEnemy?1.8:0))*scale*.025;
  const shift=laneShift*scale*.31+(dodging?(side===1?1:-1)*scale*.12:0);
  const facing=side===1?1:-1;
  const floorY=floor+bob;

  ctx.save();ctx.translate(x+shift,floorY);ctx.scale(facing,1);
  ctx.globalAlpha=hurt&&!reducedMotion&&Math.floor(tm/70)%2===0?.62:1;

  // Ground contact shadow and a faint character rim.
  ctx.save();ctx.scale(1,.28);
  const shadow=ctx.createRadialGradient(0,0,scale*.08,0,0,scale*.92);
  shadow.addColorStop(0,'rgba(0,0,0,.62)');shadow.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=shadow;ctx.beginPath();ctx.ellipse(0,0,scale*.95,scale*.42,0,0,Math.PI*2);ctx.fill();ctx.restore();

  const aura=ctx.createRadialGradient(0,-scale*1.45,scale*.05,0,-scale*1.42,scale*1.48);
  aura.addColorStop(0,isEnemy?'rgba(169,139,255,.19)':'rgba(200,255,61,.14)');
  aura.addColorStop(1,'rgba(5,10,12,0)');
  ctx.fillStyle=aura;ctx.fillRect(-scale*1.5,-scale*3.1,scale*3,scale*3.1);

  const armor=ctx.createLinearGradient(-scale*.6,-scale*2.1,scale*.55,-scale*.1);
  armor.addColorStop(0,isEnemy?'#9c91b5':'#b7c7b6');
  armor.addColorStop(.24,isEnemy?'#4c4963':'#526b60');
  armor.addColorStop(.58,isEnemy?'#202435':'#1c2a2a');
  armor.addColorStop(1,'#0b1215');
  const armorDark=ctx.createLinearGradient(-scale*.5,-scale*1.2,scale*.6,-scale*.1);
  armorDark.addColorStop(0,isEnemy?'#7f779b':'#8ca18b');armorDark.addColorStop(1,'#10191c');
  const edge=hurt?'#ff9a91':isEnemy?'rgba(193,174,232,.72)':'rgba(200,255,61,.62)';

  // Rear mantle and back plates.
  poly([[-scale*.25,-scale*1.9],[-scale*.52,-scale*1.78],[-scale*.62,-scale*.95],[-scale*.34,-scale*.72],[-scale*.18,-scale*1.18]],armorDark,'rgba(193,211,196,.17)',1);
  if(isOpponent){
   poly([[-scale*.36,-scale*2.05],[-scale*.63,-scale*2.42],[-scale*.44,-scale*2.13],[-scale*.14,-scale*2.2]],armorDark,edge,1);
   poly([[scale*.36,-scale*2.05],[scale*.63,-scale*2.42],[scale*.44,-scale*2.13],[scale*.14,-scale*2.2]],armorDark,edge,1);
   if(['BOSS','CHAMPION','FINAL BOSS'].includes(g.mission?.threat)){
    poly([[-scale*.39,-scale*2.02],[-scale*.78,-scale*2.28],[-scale*.62,-scale*1.83],[-scale*.32,-scale*1.74]],armorDark,edge,1.2);
    poly([[scale*.39,-scale*2.02],[scale*.78,-scale*2.28],[scale*.62,-scale*1.83],[scale*.32,-scale*1.74]],armorDark,edge,1.2);
   }
  }

  // Legs: segmented greaves, knees and planted boots.
  const gait=attacking?(reducedMotion?0:Math.sin(tm*.012)*.12):sway/scale;
  const drawLeg=(sideSign)=>{
   const hipX=sideSign*scale*.19,kneeX=sideSign*scale*(.24+gait),ankleX=sideSign*scale*(.31+gait*.35);
   const leg=ctx.createLinearGradient(hipX,-scale*.95,ankleX,-scale*.06);
   leg.addColorStop(0,'#a4b1a3');leg.addColorStop(.36,'#4a605c');leg.addColorStop(1,'#172225');
   poly([[hipX-scale*.13,-scale*.99],[hipX+scale*.13,-scale*.99],[kneeX+scale*.15,-scale*.5],[ankleX+scale*.105,-scale*.12],[ankleX-scale*.12,-scale*.08],[kneeX-scale*.16,-scale*.45]],leg,'rgba(200,218,201,.28)',1);
   poly([[kneeX-scale*.14,-scale*.56],[kneeX,-scale*.69],[kneeX+scale*.14,-scale*.55],[kneeX+scale*.11,-scale*.39],[kneeX-scale*.1,-scale*.39]],armorDark,edge,.8);
   poly([[ankleX-scale*.13,-scale*.2],[ankleX+scale*.12,-scale*.2],[ankleX+scale*.22,-scale*.04],[ankleX-scale*.2,-scale*.02]],'#172326','rgba(195,214,199,.26)',1);
   ctx.strokeStyle='rgba(220,233,217,.3)';ctx.lineWidth=1;
   ctx.beginPath();ctx.moveTo(kneeX+sideSign*scale*.03,-scale*.45);ctx.lineTo(ankleX+sideSign*scale*.04,-scale*.23);ctx.stroke();
  };
  drawLeg(-1);drawLeg(1);

  // Waist, belt and central chassis.
  poly([[-scale*.3,-scale*1.3],[scale*.3,-scale*1.3],[scale*.25,-scale*.91],[scale*.14,-scale*.82],[-scale*.14,-scale*.82],[-scale*.25,-scale*.91]],armorDark,'rgba(201,218,201,.28)',1);
  ctx.fillStyle='#0b1416';ctx.fillRect(-scale*.28,-scale*1.02,scale*.56,scale*.09);
  ctx.fillStyle=accent;ctx.shadowBlur=12;ctx.shadowColor=accent;ctx.fillRect(-scale*.045,-scale*1.03,scale*.09,scale*.1);ctx.shadowBlur=0;

  // Arms in three articulated sections.
  const arm=(sign)=>{
   const shoulderX=sign*scale*.38,shoulderY=-scale*1.98;
   const elbowX=sign*scale*(attacking?.57:.56),elbowY=-scale*(attacking?1.54:1.49);
   const handX=attacking?sign*scale*.78:sign*scale*.47;
   const handY=attacking?-scale*1.48:guarding?-scale*1.47:-scale*1.13+(sign*sway*.25);
   const upper=ctx.createLinearGradient(shoulderX,shoulderY,elbowX,elbowY);
   upper.addColorStop(0,'#8d9f94');upper.addColorStop(1,'#29393a');
   ctx.lineCap='round';ctx.lineJoin='round';
   ctx.strokeStyle=upper;ctx.lineWidth=scale*.19;ctx.beginPath();ctx.moveTo(shoulderX,shoulderY);ctx.lineTo(elbowX,elbowY);ctx.stroke();
   ctx.strokeStyle='rgba(220,232,216,.24)';ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(shoulderX-sign*scale*.035,shoulderY);ctx.lineTo(elbowX-sign*scale*.035,elbowY);ctx.stroke();
   const lower=ctx.createLinearGradient(elbowX,elbowY,handX,handY);
   lower.addColorStop(0,'#536963');lower.addColorStop(1,'#172326');
   ctx.strokeStyle=lower;ctx.lineWidth=scale*.16;ctx.beginPath();ctx.moveTo(elbowX,elbowY);ctx.lineTo(handX,handY);ctx.stroke();
   ctx.fillStyle=armorDark;ctx.strokeStyle='rgba(212,226,211,.25)';ctx.lineWidth=1;
   ctx.beginPath();ctx.ellipse(elbowX,elbowY,scale*.105,scale*.105,0,0,Math.PI*2);ctx.fill();ctx.stroke();
   ctx.save();ctx.translate(handX,handY);ctx.rotate(sign*.12);
   poly([[-scale*.105,-scale*.12],[scale*.105,-scale*.12],[scale*.13,scale*.075],[0,scale*.14],[-scale*.13,scale*.075]],'#243436',edge,.9);
   ctx.strokeStyle=accent;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(-scale*.07,-scale*.04);ctx.lineTo(scale*.07,-scale*.04);ctx.stroke();
   ctx.restore();
  };
  arm(-1);arm(1);

  // Chest shell: layered breastplate, collar and luminous core.
  poly([[-scale*.39,-scale*2.03],[-scale*.26,-scale*2.22],[scale*.26,-scale*2.22],[scale*.39,-scale*2.03],[scale*.32,-scale*1.47],[scale*.16,-scale*1.27],[-scale*.16,-scale*1.27],[-scale*.32,-scale*1.47]],armor,edge,1.2);
  poly([[-scale*.27,-scale*1.99],[0,-scale*2.12],[scale*.27,-scale*1.99],[scale*.2,-scale*1.65],[0,-scale*1.53],[-scale*.2,-scale*1.65]],armorDark,'rgba(220,235,217,.25)',1);
  ctx.strokeStyle='rgba(223,237,218,.3)';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(0,-scale*2.11);ctx.lineTo(0,-scale*1.57);ctx.stroke();
  ctx.save();ctx.shadowBlur=18;ctx.shadowColor=accent;ctx.fillStyle=accent;
  ctx.beginPath();ctx.moveTo(0,-scale*1.99);ctx.lineTo(scale*.09,-scale*1.82);ctx.lineTo(0,-scale*1.65);ctx.lineTo(-scale*.09,-scale*1.82);ctx.closePath();ctx.fill();ctx.restore();
  // Shoulder guards with layered bevels.
  for(const sign of [-1,1]){
   ctx.save();ctx.translate(sign*scale*.39,-scale*2.02);
   const guard=ctx.createLinearGradient(-scale*.16,-scale*.13,scale*.16,scale*.13);
   guard.addColorStop(0,'#b4c1ad');guard.addColorStop(.4,'#506761');guard.addColorStop(1,'#172225');
   ctx.fillStyle=guard;ctx.strokeStyle=edge;ctx.lineWidth=1;
   ctx.beginPath();ctx.moveTo(-scale*.16,-scale*.06);ctx.quadraticCurveTo(-scale*.12,-scale*.23,scale*.08,-scale*.2);ctx.lineTo(scale*.2,-scale*.02);ctx.lineTo(scale*.12,scale*.12);ctx.lineTo(-scale*.1,scale*.1);ctx.closePath();ctx.fill();ctx.stroke();
   ctx.strokeStyle='rgba(224,236,218,.24)';ctx.beginPath();ctx.moveTo(-scale*.08,-scale*.1);ctx.lineTo(scale*.09,-scale*.09);ctx.stroke();
   ctx.restore();
  }

  // Helmet and faceplate; the enemy has a broader crown silhouette.
  ctx.save();ctx.translate(0,-scale*2.42);
  const head=ctx.createLinearGradient(-scale*.25,-scale*.25,scale*.25,scale*.28);
  head.addColorStop(0,'#c0cbbb');head.addColorStop(.25,'#60756d');head.addColorStop(.75,'#233438');head.addColorStop(1,'#111b1f');
  ctx.fillStyle=head;ctx.strokeStyle=edge;ctx.lineWidth=1.2;
  ctx.beginPath();ctx.moveTo(-scale*.22,-scale*.17);ctx.quadraticCurveTo(-scale*.18,-scale*.42,0,-scale*.44);ctx.quadraticCurveTo(scale*.2,-scale*.41,scale*.23,-scale*.17);ctx.lineTo(scale*.18,scale*.18);ctx.lineTo(0,scale*.31);ctx.lineTo(-scale*.18,scale*.18);ctx.closePath();ctx.fill();ctx.stroke();
  if(isEnemy){
   poly([[-scale*.12,-scale*.34],[-scale*.32,-scale*.6],[-scale*.2,-scale*.27]],'#39464f',edge,.8);
   poly([[scale*.12,-scale*.34],[scale*.32,-scale*.6],[scale*.2,-scale*.27]],'#39464f',edge,.8);
  }else{
   poly([[-scale*.1,-scale*.37],[0,-scale*.53],[scale*.1,-scale*.37]],'#75877b',edge,.7);
  }
  ctx.fillStyle='#071012';ctx.beginPath();ctx.moveTo(-scale*.18,-scale*.07);ctx.lineTo(scale*.18,-scale*.07);ctx.lineTo(scale*.14,scale*.12);ctx.lineTo(0,scale*.21);ctx.lineTo(-scale*.14,scale*.12);ctx.closePath();ctx.fill();
  ctx.save();ctx.shadowBlur=14;ctx.shadowColor=accent;ctx.fillStyle=accent;
  ctx.beginPath();ctx.moveTo(-scale*.13,-scale*.045);ctx.lineTo(-scale*.015,-scale*.005);ctx.lineTo(-scale*.02,scale*.025);ctx.lineTo(-scale*.14,scale*.012);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.moveTo(scale*.13,-scale*.045);ctx.lineTo(scale*.015,-scale*.005);ctx.lineTo(scale*.02,scale*.025);ctx.lineTo(scale*.14,scale*.012);ctx.closePath();ctx.fill();ctx.restore();
  ctx.restore();

  // Active shield / pulse effects are visual feedback, not extra controls.
  if(guarding){
   ctx.save();ctx.strokeStyle=ice;ctx.lineWidth=2.4;ctx.shadowBlur=18;ctx.shadowColor=ice;
   ctx.globalAlpha=.65+(Math.sin(tm*.014)+1)*.12;
   ctx.beginPath();ctx.arc(scale*.32,-scale*1.55,scale*.6,Math.PI*1.1,Math.PI*1.92);ctx.stroke();
   ctx.restore();
  }else if(attacking){
   ctx.save();ctx.strokeStyle=trim;ctx.lineWidth=3;ctx.shadowBlur=22;ctx.shadowColor=accent;
   ctx.globalAlpha=.8;ctx.beginPath();ctx.arc(scale*.62,-scale*1.55,scale*.48,-.8,.85);ctx.stroke();
   ctx.restore();
  }
  if(hurt){
   ctx.fillStyle='#ffb0a1';ctx.font='600 '+Math.max(10,scale*.16)+'px '+ 'monospace';ctx.textAlign='center';ctx.fillText('−HP',0,-scale*2.95);
  }
  ctx.restore();
 }

 // Readable strike telegraph painted onto the arena floor before an incoming lane event.
 if(g.phase==='telegraph'){
  const laneX=g.target===-1?w*.25:g.target===1?w*.75:w*.5;
  ctx.save();ctx.globalAlpha=.72+(Math.sin(tm*.009)+1)*.11;
  ctx.strokeStyle='#ffb36e';ctx.lineWidth=2;ctx.shadowBlur=19;ctx.shadowColor='#ff9c65';
  ctx.beginPath();ctx.ellipse(laneX,floor-3,Math.max(28,w*.055),Math.max(8,h*.018),0,0,Math.PI*2);ctx.stroke();
  ctx.fillStyle='rgba(255,158,101,.1)';ctx.beginPath();ctx.ellipse(laneX,floor-3,Math.max(24,w*.048),Math.max(6,h*.014),0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#ffd0a4';ctx.font='600 9px monospace';ctx.textAlign='center';
  ctx.fillText(g.target===-1?'LEFT LANE':g.target===1?'RIGHT LANE':'CENTER LANE',laneX,floor-21);
  ctx.restore();
 }

 if(g.mode==='duo'){
  drawFighter(w*.27,1,g.p1);drawFighter(w*.73,2,g.p2);
 }else{
  drawFighter(w*.27,1,null);drawFighter(w*.75,2,null);
 }

 // Supply drops hover just above the arena surface with a visible landing shadow.
 if(g.pickup){
  const px=w*.5,py=h*.69+Math.sin(tm*.0035)*5;
  ctx.save();ctx.globalAlpha=.88;ctx.fillStyle='rgba(0,0,0,.45)';
  ctx.beginPath();ctx.ellipse(px,floor-3,18,5,0,0,Math.PI*2);ctx.fill();
  ctx.translate(px,py);ctx.shadowBlur=22;ctx.shadowColor=g.pickup.type==='medkit'?acid:violet;
  const itemGrad=ctx.createLinearGradient(-14,-14,14,14);
  itemGrad.addColorStop(0,g.pickup.type==='medkit'?'#e0ffad':'#e7d9ff');
  itemGrad.addColorStop(1,g.pickup.type==='medkit'?'#629a25':'#6c53a2');
  poly([[-12,-11],[0,-17],[12,-11],[12,8],[0,16],[-12,8]],itemGrad,'rgba(239,255,223,.6)',1);
  ctx.fillStyle='#0a1212';ctx.font='bold 13px monospace';ctx.textAlign='center';ctx.fillText(g.pickup.type==='medkit'?'+':'✦',0,5);
  ctx.fillStyle='#d8e4d7';ctx.font='7px monospace';ctx.fillText(g.pickup.type==='medkit'?'MED SUPPLY':'ENERGY CELL',0,29);
  ctx.restore();
 }

 const age=tm-eventFxAt;
 if(g.mode==='duo'&&g.event==='pulse'&&age<260){
  ctx.save();const from=g.hitPlayer===2?w*.27:w*.73,to=g.hitPlayer===2?w*.73:w*.27;
  const end=from+(to-from)*Math.min(1,age/240);
  const bolt=ctx.createLinearGradient(from,h*.58,end,h*.58);
  bolt.addColorStop(0,'rgba(200,255,61,0)');bolt.addColorStop(.5,'rgba(210,255,148,.95)');bolt.addColorStop(1,'rgba(220,242,210,.8)');
  ctx.strokeStyle=bolt;ctx.lineWidth=4;ctx.shadowBlur=22;ctx.shadowColor=acid;
  ctx.beginPath();ctx.moveTo(from,h*.58);ctx.lineTo(end,h*.58);ctx.stroke();ctx.restore();
 }
 if(g.event==='nova'&&age<720){
  ctx.save();ctx.globalAlpha=Math.max(0,1-age/720);const reverse=g.mode==='duo'&&g.hitPlayer===1;
  const grad=ctx.createLinearGradient(reverse?w*.9:w*.1,h*.52,reverse?w*.1:w*.9,h*.52);
  grad.addColorStop(0,'rgba(200,255,61,0)');grad.addColorStop(.32,'rgba(200,255,61,.8)');
  grad.addColorStop(.64,'rgba(226,255,189,.9)');grad.addColorStop(1,'rgba(200,255,61,0)');
  ctx.fillStyle=grad;ctx.shadowBlur=42;ctx.shadowColor=acid;ctx.fillRect(w*.12,h*.48,w*.76,22+Math.sin(age*.03)*5);ctx.restore();
 }
 if(['pulse','hit','block'].includes(g.event)&&age<720){
  ctx.save();ctx.globalAlpha=Math.max(0,1-age/720)*.8;ctx.strokeStyle=g.event==='block'?ice:'#d6ffaa';
  ctx.lineWidth=2;ctx.shadowBlur=22;ctx.shadowColor=ctx.strokeStyle;
  const hitX=g.mode==='duo'?(g.hitPlayer===1?w*.27:w*.73):w*.75;
  ctx.beginPath();ctx.ellipse(hitX,h*.53,(18+age*.12)*1.4,14+age*.12,-.2,0,Math.PI*2);ctx.stroke();ctx.restore();
 }
 if(g.perfectFxUntil>t){
  ctx.save();const alpha=Math.min(1,(g.perfectFxUntil-t)/180);ctx.globalAlpha=alpha;
  ctx.fillStyle='rgba(200,255,61,.075)';ctx.fillRect(0,0,w,h);
  ctx.strokeStyle=acid;ctx.lineWidth=2;ctx.shadowBlur=26;ctx.shadowColor=acid;
  ctx.beginPath();ctx.arc(w*.5,h*.43,38+(650-(g.perfectFxUntil-t))*.13,0,Math.PI*2);ctx.stroke();
  ctx.fillStyle='#efffd3';ctx.font='600 12px monospace';ctx.textAlign='center';ctx.fillText('PERFECT READ',w*.5,h*.34);ctx.restore();
 }

 // Edge falloff and subtle film grain keep the action legible.
 const vignette=ctx.createRadialGradient(w*.5,h*.48,Math.min(w,h)*.22,w*.5,h*.48,Math.max(w,h)*.76);
 vignette.addColorStop(.46,'rgba(1,4,6,0)');vignette.addColorStop(1,'rgba(1,3,5,.72)');
 ctx.fillStyle=vignette;ctx.fillRect(0,0,w,h);
}
function loop(t){
 draw(t);viewport.render(t);if(t-lastHudAt>110){updateHud();lastHudAt=t;}
 previousFrame=t;raf=requestAnimationFrame(loop);
}
raf=requestAnimationFrame(loop);
document.querySelectorAll('[data-difficulty]').forEach(button=>button.addEventListener('click',()=>setDifficulty(button.dataset.difficulty)));
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
 const summaries={max:'MAX sensitivity selected — a modest hand raise is enough. Lower your hand to reset before the next input.',high:'HIGH sensitivity selected — a clearer raise above shoulder level is required. Lower your hand to reset before the next input.'};
 document.querySelectorAll('[data-sensitivity-summary]').forEach(node=>node.textContent=summaries[motionSensitivity]);
}));
$('play-keyboard').addEventListener('click',()=>startSoloWithoutCamera());
$('play-camera').addEventListener('click',()=>chooseGameMode('solo'));
$('campaign-missions').addEventListener('click',event=>{
 const card=event.target.closest('[data-mission-id]');if(!card||card.disabled)return;
 selectedMissionId=Number(card.dataset.missionId);renderCampaignMap();
});
$('campaign-play').addEventListener('click',()=>startCampaignMission(selectedMissionId,false));
$('campaign-camera').addEventListener('click',()=>startCampaignMission(selectedMissionId,true));
$('play-duo-touch').addEventListener('click',()=>startTouchDuel());
$('play-duo-camera').addEventListener('click',()=>chooseGameMode('duo'));
$('play-daily').addEventListener('click',()=>startSoloWithoutCamera(createDailyChallenge()));
$('play-daily-camera').addEventListener('click',()=>chooseGameMode('solo',createDailyChallenge()));
$('enable-camera').addEventListener('click',()=>{void startCamera(cameraTargetMode);});
$('gate-retry').addEventListener('click',()=>{void startCamera(cameraTargetMode);});
$('gate-skip').addEventListener('click',()=>continueWithoutCamera());
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
   ?'Raise one hand comfortably above shoulder level, then lower it to trigger one PULSE per raise cycle. Hands near the chest activate GUARD, and slight torso shifts PHASE between lanes.'
   :'Ready. Raise one hand comfortably above shoulder level, then lower it to trigger one PULSE per raise cycle. Hands near the chest activate GUARD, and slight torso shifts PHASE between lanes. Buttons remain available as backup.';
  beginGame(cameraTargetMode,pendingDailyChallenge);pendingDailyChallenge=null;$('mode-pill').classList.add('live');
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
function startSoloWithoutCamera(dailyChallenge=null){
 activeMission=pendingCampaignMission;pendingCampaignMission=null;pendingDailyChallenge=null;
 stopCamera(true);
 cameraMode=false;calibrated=false;cameraTargetMode='lobby';
 $('camera-gate').classList.add('hidden');$('setup').classList.add('hidden');
 beginGame('solo',dailyChallenge);
 $('mode-pill').innerHTML='<b></b>KEYBOARD / TOUCH MODE';
 $('move-mode').textContent='KEYBOARD / TOUCH CONTROLS';
}
function startTouchDuel(){
 pendingDailyChallenge=null;
 stopCamera(true);
 cameraMode=false;calibrated=false;cameraTargetMode='lobby';
 $('camera-gate').classList.add('hidden');$('setup').classList.add('hidden');
 beginGame('duo');
 $('mode-pill').innerHTML='<b></b>2P TOUCH DUEL';
 $('move-mode').textContent='SPLIT TOUCH CONTROLS';
 $('camera-hint').classList.add('hidden');
}
function continueWithoutCamera(){
 if(cameraStarting)return;
 if(cameraTargetMode==='solo'&&activeMission){
  const mission=activeMission,daily=pendingDailyChallenge;pendingDailyChallenge=null;
  pendingCampaignMission=mission;
  startSoloWithoutCamera(daily);return;
 }
 $('camera-gate').classList.add('hidden');
 $('setup').classList.add('hidden');
 cameraTargetMode='lobby';
 $('gate-status').className='gate-status';
 $('gate-status').textContent='CAMERA OFF · TOUCH / KEYBOARD READY';
}
async function chooseGameMode(mode,dailyChallenge=null){
 if(dailyChallenge)activeMission=null;
 cameraTargetMode=mode;
 pendingDailyChallenge=mode==='solo'&&dailyChallenge?dailyChallenge:null;
 if(cameraStatus!=='ready'||!stream||!motionEngine.isReady){
  $('camera-gate').classList.remove('hidden');$('gate-title').textContent='Enable optional camera motion.';
  $('gate-copy').textContent='Allow camera access to play with body movement. Your camera stays local. You can continue without camera and use touch or keyboard instead.';
  $('gate-status').className='gate-status';
  $('gate-status').textContent='CAMERA PERMISSION NEEDED FOR MOTION CONTROLS';
  $('gate-skip').disabled=false;
  if(!cameraStarting)void startCamera(mode);
  return;
 }
 try{await ensureMotionPlayerCount(mode);}
 catch(error){lockToCameraGate(error?.message||'Motion tracking could not be configured.');return;}
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
 $('camera-gate').classList.remove('hidden');$('gate-title').textContent='Camera motion is unavailable.';
 $('gate-copy').textContent=message+' Retry camera setup for motion controls, or continue without camera and play with touch/keyboard.';
 $('gate-status').className='gate-status error';$('gate-status').textContent='CAMERA DISCONNECTED · NON-CAMERA PLAY IS AVAILABLE';
 $('gate-retry').disabled=false;$('gate-skip').disabled=false;
}
function returnToModeSelection(){
 if(cameraStatus!=='ready'||!stream||!motionEngine.isReady){
  combatDirector.reset();paused=false;calibrated=false;cameraMode=false;g=freshGame('solo');
  showScreen('home');$('overlay').classList.add('hidden');$('camera-gate').classList.add('hidden');
  $('setup').classList.add('hidden');cameraTargetMode='lobby';return;
 }
 combatDirector.reset();paused=false;calibrated=false;g=freshGame('solo');showScreen('home');$('overlay').classList.add('hidden');cameraTargetMode='lobby';$('setup').classList.remove('hidden');
 $('setup-title').textContent='CAMERA CONNECTED';$('setup-copy').textContent='Choose a camera-motion mode, then calibrate your movement before the fight.';$('calibrate-start').classList.add('hidden');$('enable-camera').classList.add('hidden');$('camera-hint').classList.add('hidden');
}
function showError(text){$('setup-error').textContent=text;$('setup-error').classList.toggle('hidden',!text);}
async function ensureMotionPlayerCount(mode){
 const players=mode==='duo'?2:1;
 if(motionEngine.players!==players||motionEngine.requiredPlayers!==players){
  trackingOkay=false;
  await motionEngine.stop();
  await motionEngine.start(video,{players,requiredPlayers:players,sensitivity:motionSensitivity});
 }
}
async function startCamera(targetMode='lobby'){
 if(cameraStarting)return;
 if(cameraStatus==='ready'&&stream&&motionEngine.isReady){cameraTargetMode=targetMode;return;}
 cameraStarting=true;cameraTargetMode=targetMode;combatDirector.connectCamera();
 $('camera-gate').classList.remove('hidden');$('gate-title').textContent='Your camera is your controller.';
 $('gate-copy').textContent='Requesting camera permission for the motion mode you selected. Camera frames are processed locally in a dedicated worker and are not recorded.';
 $('gate-status').className='gate-status';$('gate-status').innerHTML='<span class="gate-spin"></span> REQUESTING CAMERA PERMISSION…';$('gate-retry').disabled=true;$('gate-skip').disabled=true;
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
  await motionEngine.start(video,{players:targetMode==='duo'?2:1,requiredPlayers:targetMode==='duo'?2:1,sensitivity:motionSensitivity});
  const selectedMode=cameraTargetMode;
  await ensureMotionPlayerCount(selectedMode);
  cameraStatus='ready';cameraStarting=false;cameraMode=true;calibrated=false;trackingOkay=false;lastTrackingAt=0;
  $('camera-gate').classList.add('hidden');$('gate-retry').disabled=false;$('gate-skip').disabled=false;$('setup').classList.remove('hidden');
  $('setup-title').textContent='CAMERA CONNECTED';
  $('setup-copy').textContent='Camera permission is active. Choose Solo or Duo, then calibrate your movement before the fight.';
  $('calibrate-start').classList.add('hidden');$('enable-camera').classList.add('hidden');$('duo-touch-start').classList.add('hidden');
  $('camera-label').textContent='CAMERA PREVIEW';$('camera-dot').classList.remove('live');
  $('camera-hint').textContent='CHOOSE SOLO OR DUO TO CALIBRATE';$('camera-hint').classList.remove('hidden');
 }catch(err){
  await motionEngine.stop().catch(()=>{});
  stopCamera(false);cameraStarting=false;cameraStatus='error';cameraMode=false;
  $('camera-gate').classList.remove('hidden');$('gate-title').textContent='Camera setup did not finish.';
  $('gate-copy').textContent='Motion controls could not start. Check browser camera permissions and retry, or continue with keyboard/touch. Camera footage is never uploaded by this prototype.';
  $('gate-status').className='gate-status error';
  $('gate-status').textContent=err?.name==='NotAllowedError'?'CAMERA PERMISSION DENIED — TOUCH / KEYBOARD STILL AVAILABLE':(err?.message||'CAMERA SETUP FAILED');
  $('gate-retry').disabled=false;$('gate-skip').disabled=false;$('setup-title').textContent='CAMERA UNAVAILABLE';
  showError(err?.message||'Camera setup failed. Please retry.');
  $('setup-copy').textContent='Allow camera access in your browser, then select Retry.';
  $('enable-camera').disabled=false;$('enable-camera').textContent='RETRY CAMERA ACCESS';$('enable-camera').classList.remove('hidden');
 }
}
function stopCamera(resetUI){
 void motionEngine.stop();
 stream?.getTracks().forEach(track=>track.stop());stream=null;video.srcObject=null;
 setCameraPanelInArena(false);cameraPanel.classList.add('off');cameraStatus='off';cameraMode=false;calibrated=false;trackingOkay=false;lastTrackingAt=0;
 $('calibrate-start').classList.add('hidden');$('enable-camera').disabled=false;
 $('enable-camera').innerHTML='<svg viewBox="0 0 24 24"><path d="M4 7.5h3l1.7-2h6.6l1.7 2h3A1.5 1.5 0 0 1 21.5 9v9a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18V9A1.5 1.5 0 0 1 4 7.5Z"/><circle cx="12" cy="13" r="3.5"/></svg> PLAY WITH CAMERA';
 $('mode-pill').innerHTML='<b></b>KEYBOARD MODE';$('mode-pill').classList.remove('live');$('move-mode').textContent='KEYBOARD / CLICK CONTROLS';
 if(resetUI)$('setup').classList.add('hidden');$('duo-touch-start').classList.add('hidden');
 $('gate-skip').disabled=false;
 combatDirector.reset();
}
const CAMERA_POSE_LINKS=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24]];
function drawCameraSkeleton(poses){
 if(!cameraSkeleton)return;
 const width=cameraSkeleton.clientWidth||video.clientWidth||1;
 const height=cameraSkeleton.clientHeight||video.clientHeight||1;
 const dpr=Math.min(window.devicePixelRatio||1,2);
 if(cameraSkeleton.width!==Math.round(width*dpr)||cameraSkeleton.height!==Math.round(height*dpr)){
  cameraSkeleton.width=Math.max(1,Math.round(width*dpr));
  cameraSkeleton.height=Math.max(1,Math.round(height*dpr));
 }
 const overlay=cameraSkeleton.getContext('2d');if(!overlay)return;
 overlay.setTransform(dpr,0,0,dpr,0,0);overlay.clearRect(0,0,width,height);
 (Array.isArray(poses)?poses:[]).forEach((points,index)=>{
  if(!Array.isArray(points))return;
  const usable=(p)=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&(p.visibility===undefined||p.visibility>=.15);
  overlay.save();overlay.lineWidth=2;overlay.lineCap='round';overlay.lineJoin='round';
  overlay.strokeStyle=index===0?'rgba(200,255,61,.92)':'rgba(177,151,255,.92)';
  overlay.shadowBlur=8;overlay.shadowColor=overlay.strokeStyle;
  for(const [a,b] of CAMERA_POSE_LINKS){
   const p=points[a],q=points[b];if(!usable(p)||!usable(q))continue;
   overlay.beginPath();overlay.moveTo(p.x*width,p.y*height);overlay.lineTo(q.x*width,q.y*height);overlay.stroke();
  }
  overlay.shadowBlur=5;overlay.fillStyle=overlay.strokeStyle;
  for(const joint of [11,12,13,14,15,16,23,24]){
   const p=points[joint];if(!usable(p))continue;
   overlay.beginPath();overlay.arc(p.x*width,p.y*height,2.8,0,Math.PI*2);overlay.fill();
  }
  overlay.restore();
 });
}
function handleMotionTracking(info){
 drawCameraSkeleton(info?.poses||[]);
 trackingOkay=Boolean(info.ready);
 if(trackingOkay){
  lastTrackingAt=performance.now();$('camera-dot').classList.add('live');
  if(performance.now()-lastCameraActionAt>900)$('camera-label').textContent=info.count>=2?'TWO PLAYERS TRACKED':'BODY TRACKED';$('camera-hint').classList.add('hidden');
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
  $('camera-label').textContent=cameraTargetMode==='duo'?'SEARCHING FOR TWO PLAYERS':'SEARCHING FOR BODY';
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
$('gate-title').textContent = 'Choose how to play.';
$('gate-copy').textContent = 'Camera motion is optional. Continue without camera for keyboard/touch play, or enable camera motion to use body gestures. Camera frames stay on this device and are not recorded or uploaded.';
$('gate-status').className = 'gate-status';
$('gate-status').textContent = 'CAMERA OFF · WAITING FOR YOUR PERMISSION';
$('gate-retry').innerHTML = 'ENABLE OPTIONAL CAMERA MOTION <svg viewBox="0 0 24 24"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>';
}

void initializeKinetix().catch((error) => {
  console.error('[KINETIX BOOT]', error);
  const message = document.getElementById('setup-error');
  if (message) {
    message.textContent = 'KINETIX COULD NOT INITIALIZE. Please reload the page and try again.';
    message.classList.remove('hidden');
  }
});
