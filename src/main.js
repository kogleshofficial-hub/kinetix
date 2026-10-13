import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
const $ = (id) => document.getElementById(id);
const home = $('home'), arena = $('arena'), canvas = $('game-canvas'), ctx = canvas.getContext('2d');
const video = $('video'), cameraPanel = $('camera-panel'), setup = $('setup');
const modelUrl = '/models/pose_landmarker_lite.task';
const wasmUrl = '/mediapipe/wasm';
let soundOn = true, reducedMotion = false, cameraStatus = 'off', cameraMode = false, trackingOkay = false, paused = false;
let stream = null, landmarker = null, cameraRAF = 0, cameraLoopStarted = false, cameraStarting = false, lastVideoTime = -1, lastInference = 0;
let lastTrackingAt = 0;
let neutralLean = 0, calibrated = false, lastPose = null, secondPose = null, priorPose = null, priorPoseAt = 0, lastPulse = -9999, lastGuard = -9999, lastPhase = -9999, priorGuardPose = false, priorLeanSide = 0;
let cameraTargetMode='solo',neutralLeans=[0,0];
const motionMemory=[{priorPose:null,priorAt:0,lastPulse:-9999,lastGuard:-9999,lastPhase:-9999,guardPose:false,leanSide:0},{priorPose:null,priorAt:0,lastPulse:-9999,lastGuard:-9999,lastPhase:-9999,guardPose:false,leanSide:0}];
const DIFFICULTIES=Object.freeze({
 beginner:{label:'BEGINNER TRAINING',enemyHP:100,enemyDamage:15,firstWait:.82,telegraph:.92,opening:1.4,recovery:.38},
 normal:{label:'NORMAL',enemyHP:135,enemyDamage:25,firstWait:.68,telegraph:.52,opening:.78,recovery:.20},
 hard:{label:'HARD',enemyHP:165,enemyDamage:36,firstWait:.46,telegraph:.33,opening:.46,recovery:.10}
});
let difficulty='normal';
function difficultyRules(){return DIFFICULTIES[difficulty]||DIFFICULTIES.beginner;}
const MOTION_SENSITIVITY=Object.freeze({
 high:{label:'HIGH',minSpeed:1.15,minTravel:.12,extensionDelta:.032,travelGrowth:.018,minFrameStep:.065,globalCooldown:85,handCooldown:145,returnTravel:.13,rearmRecoil:.055,confirmFrames:2,strongTravel:.235,strongSpeed:2.7,reacquireTravel:.25},
 max:{label:'MAX',minSpeed:.78,minTravel:.09,extensionDelta:.022,travelGrowth:.012,minFrameStep:.048,globalCooldown:60,handCooldown:115,returnTravel:.115,rearmRecoil:.045,confirmFrames:2,strongTravel:.195,strongSpeed:2.3,reacquireTravel:.215}
});
let motionSensitivity='high';
function sensitivityRules(){return MOTION_SENSITIVITY[motionSensitivity]||MOTION_SENSITIVITY.max;}
let impactClearTimer=0;
let audioContext = null, raf = 0, previousFrame = 0, lastHudAt = 0, lastEventStamp = -1, eventFxAt = performance.now();
let bestRecord = 0;
try { bestRecord = Number(localStorage.getItem('kinetix-best-combo') || 0); } catch {}
$('best-combo').textContent = String(bestRecord).padStart(2,'0') + '×';
let g = freshGame();

function freshFighter(){return {hp:100,mana:70,combo:0,best:0,lane:0,guardUntil:0,dodgeUntil:0,lastPulse:-9999,lastNova:-9999,lastPhase:-9999,attackUntil:0,hurtUntil:0,medkits:1,collectCooldown:0,pulses:0,clean:0,dodges:0,blocks:0,hits:0,damage:0};}
function freshGame(mode='solo'){
 const p1=freshFighter(),p2=freshFighter();
 return {status:'ready',mode:mode,difficulty:difficulty,phase:mode==='duo'?'duel':'idle',time:mode==='duo'?60:75,clock:0,pHP:mode==='duo'?100:120,playerMaxHP:mode==='duo'?100:120,eHP:mode==='duo'?100:difficultyRules().enemyHP,enemyMaxHP:mode==='duo'?100:difficultyRules().enemyHP,energy:72,playerHurtUntil:0,playerAttackUntil:0,playerAttackSide:1,enemyHurtUntil:0,combo:0,best:0,lane:0,target:0,attackIndex:0,phaseTimer:mode==='duo'?1.35:difficultyRules().firstWait,guardUntil:0,dodgeUntil:0,lastPulse:-9999,lastNova:-9999,lastPhase:-9999,event:'none',eventAt:0,msg:mode==='duo'?'LOCAL DUEL READY':'THE RIFT IS STIRRING',tone:'neutral',pulses:0,clean:0,dodges:0,blocks:0,hits:0,damage:0,p1:p1,p2:p2,winner:null,medkits:1,pickup:null,nextSupplyAt:8,supplyCount:0,damageFlashAt:0,hitPlayer:0};
}
function beginGame(mode='solo'){
 g=freshGame(mode);g.status='playing';g.msg=mode==='duo'?'DUEL ONLINE — MAKE YOUR MOVE':'READ THE RIFT. FIND YOUR MOMENT.';
 paused=false;lastEventStamp=-1;$('overlay').classList.add('hidden');eventFxAt=performance.now();previousFrame=performance.now();showScreen('arena');
 $('moves-main').classList.toggle('hidden',mode==='duo');$('duo-controls').classList.toggle('hidden',mode!=='duo');
 $('mode-pill').innerHTML='<b></b>'+(mode==='duo'?(cameraMode?'2P MOTION ONLINE':'2P LOCAL DUEL'):(cameraMode?'MOTION ONLINE':'SOLO VS AI'));
 $('mode-pill').classList.add('live');$('move-mode').textContent=mode==='duo'?'TWO PLAYER TOUCH CONTROLS':'KEYBOARD / CLICK CONTROLS';updateHud();
}
function showScreen(which) { home.classList.toggle('hidden',which!=='home'); arena.classList.toggle('hidden',which!=='arena'); }
function announce(event,msg,tone) { g.event=event; g.eventAt=g.clock; eventFxAt=performance.now(); g.msg=msg; g.tone=tone||'neutral'; }
function sfx(name) {
  if(!soundOn) return;
  try {
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
    audioContext=audioContext||new AC();if(audioContext.state==='suspended')audioContext.resume();
    const defs={pulse:[440,.09,'triangle'],hit:[105,.19,'sawtooth'],block:[720,.14,'sine'],dodge:[610,.12,'triangle'],nova:[72,.42,'sawtooth'],win:[660,.34,'sine'],lose:[130,.35,'triangle'],miss:[240,.07,'sine']};
    const [freq,dur,wave]=defs[name]||[330,.06,'sine'];const now=audioContext.currentTime,o=audioContext.createOscillator(),a=audioContext.createGain();
    o.type=wave;o.frequency.setValueAtTime(freq,now);if(name==='nova')o.frequency.exponentialRampToValueAtTime(28,now+dur);if(name==='win')o.frequency.exponentialRampToValueAtTime(990,now+dur);
    a.gain.setValueAtTime(.0001,now);a.gain.exponentialRampToValueAtTime(name==='nova'?.25:.12,now+.012);a.gain.exponentialRampToValueAtTime(.0001,now+dur);o.connect(a);a.connect(audioContext.destination);o.start(now);o.stop(now+dur+.02);
  } catch {}
}
function showImpact(player,damage){
 const flash=$('impact-flash'),number=$('hit-number'),frame=canvas.parentElement;g.hitPlayer=player;g.damageFlashAt=performance.now();
 flash.className='impact-flash '+(player===1?'hit-p1':'');number.textContent='−'+damage+' HP';number.classList.remove('hidden','healing');
 number.style.animation='none';void number.offsetWidth;number.style.animation='';
 frame.classList.remove('shake');void frame.offsetWidth;frame.classList.add('shake');flash.classList.remove('active');void flash.offsetWidth;flash.classList.add('active');
 clearTimeout(impactClearTimer);impactClearTimer=setTimeout(()=>{number.classList.add('hidden');frame.classList.remove('shake');},760);
}
function showHeal(player,amount){const flash=$('impact-flash'),number=$('hit-number'),frame=canvas.parentElement;flash.className='impact-flash healing '+(player===1?'hit-p1':'');number.textContent='+'+amount;number.classList.remove('hidden','healing');number.classList.add('healing');frame.classList.remove('shake');flash.classList.remove('active');void flash.offsetWidth;flash.classList.add('active');setTimeout(()=>{number.classList.add('hidden');number.classList.remove('healing');},760);}
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
function action(kind,player=1){
 if(g.status!=='playing'||paused||(cameraMode&&!trackingOkay))return;if(g.mode==='duo'){dualAction(kind,player);return;}if(kind==='COLLECT'){pickupDrop(1);return;}if(kind==='MEDKIT'){useMedkit(1);return;}
 const before=g.event+':'+g.eventAt;if(kind==='GUARD'){g.guardUntil=Math.max(g.guardUntil,g.clock+1.05);return;}
 if(kind==='PHASE_LEFT'||kind==='PHASE_RIGHT'){if(g.clock-g.lastPhase<.3)return;g.lastPhase=g.clock;g.lane=kind==='PHASE_LEFT'?-1:1;g.dodgeUntil=g.clock+1.05;if(g.phase==='telegraph'&&g.target!==g.lane){g.energy=Math.min(100,g.energy+3);announce('dodge','PHASE SHIFT','good');sfx('dodge');}updateHud();return;}
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
   const damage=Math.min(powered?5:2,g.eHP);
   g.eHP=Math.max(0,g.eHP-damage);g.damage+=damage;g.combo=0;g.enemyHurtUntil=g.clock+.2;showImpact(2,damage);
   announce('pulse','GLANCING HIT  −'+damage+' HP · FIND THE OPENING','neutral');
  }
 }
 if(kind==='NOVA'){if(g.energy<100){announce('none','NOVA NEEDS 100 ENERGY','neutral');updateHud();return;}if(g.clock-g.lastNova<1.3)return;const damage=g.phase==='vulnerable'?48:28,d=Math.min(damage,g.eHP);g.eHP=Math.max(0,g.eHP-d);g.damage+=d;g.energy=0;g.lastNova=g.clock;g.combo+=2;g.best=Math.max(g.best,g.combo);announce('nova',g.eHP<=0?'NOVA FINISHER':'NOVA RELEASED  −'+damage,'good');}
 if(g.event+':'+g.eventAt!==before&&g.event!=='none')sfx(g.event);updateHud();
}
function enemyAttack(){
 if(g.guardUntil>g.clock){g.energy=Math.min(100,g.energy+17);g.blocks++;g.combo++;g.best=Math.max(g.best,g.combo);g.phase='vulnerable';g.phaseTimer=difficultyRules().opening;announce('block','PERFECT GUARD  +17 ENERGY','good');sfx('block');return;}
 if(g.lane!==g.target||g.dodgeUntil>g.clock){g.energy=Math.min(100,g.energy+18);g.dodges++;g.combo++;g.best=Math.max(g.best,g.combo);g.phase='vulnerable';g.phaseTimer=difficultyRules().opening;announce('dodge','PHASE SHIFT  +18 ENERGY','good');sfx('dodge');return;}
 const damage=difficultyRules().enemyDamage;g.pHP=Math.max(0,g.pHP-damage);g.playerHurtUntil=g.clock+.48;g.hits++;g.combo=0;g.phase='vulnerable';g.phaseTimer=difficultyRules().opening;announce('hit','RIFT IMPACT  −'+damage+' HP','danger');sfx('hit');showImpact(1,damage);if(g.pHP<=0)finish('lost');
}
function finish(status){
 g.status=status;g.winner=status==='won'?1:status==='lost'?2:null;if(status==='won'){g.event='win';g.msg='RIFT COLLAPSED';g.tone='good';}else if(status==='lost'){g.event='lose';g.msg='SIGNAL LOST';g.tone='danger';}else{g.msg='TIME FRACTURED';g.tone='danger';}
 g.eventAt=g.clock;eventFxAt=performance.now();sfx(status==='won'?'win':'lose');if(g.best>bestRecord){bestRecord=g.best;try{localStorage.setItem('kinetix-best-combo',String(bestRecord));}catch{}}updateHud();showResult();
}
function finishDuel(winner){
 if(g.status!=='playing')return;g.winner=winner;g.status='won';g.event=winner===0?'none':'win';g.tone=winner===0?'neutral':'good';g.msg=winner===0?'DUEL DRAW':'PLAYER '+winner+' WINS';g.eventAt=g.clock;eventFxAt=performance.now();g.best=Math.max(g.p1.best,g.p2.best);
 try{bestRecord=Math.max(bestRecord,g.best);localStorage.setItem('kinetix-best-combo',String(bestRecord));}catch{}sfx(winner===0?'miss':'win');syncDuelState();updateHud();showResult();
}
function stepDuo(dt){
 if(g.status!=='playing'||paused||(cameraMode&&!trackingOkay))return;dt=Math.min(Math.max(dt,0),.05);g.clock+=dt;g.time=Math.max(0,g.time-dt);g.p1.mana=Math.min(100,g.p1.mana+2.7*dt);g.p2.mana=Math.min(100,g.p2.mana+2.7*dt);stepSupplyDrops();syncDuelState();
 if(g.p1.hp<=0){finishDuel(2);return;}if(g.p2.hp<=0){finishDuel(1);return;}if(g.time<=0){finishDuel(g.p1.hp===g.p2.hp?0:g.p1.hp>g.p2.hp?1:2);return;}
}
function step(dt){
 if(g.mode==='duo'){stepDuo(dt);return;}if(g.status!=='playing'||paused||(cameraMode&&!trackingOkay))return;
 dt=Math.min(Math.max(dt,0),.05);g.clock+=dt;g.time=Math.max(0,g.time-dt);g.phaseTimer-=dt;g.energy=Math.min(100,g.energy+1.4*dt);stepSupplyDrops();
 if(g.time<=0){finish(g.eHP<=0?'won':'time-up');return;}if(g.eHP<=0){finish('won');return;}
 if(g.phaseTimer<=0){if(g.phase==='idle'){const pattern=[0,1,-1,0,-1,1];g.target=pattern[g.attackIndex%pattern.length];g.attackIndex++;g.phase='telegraph';g.phaseTimer=difficultyRules().telegraph;announce('none',g.target===-1?'LEFT-LANE SURGE':g.target===1?'RIGHT-LANE SURGE':'CENTER-LANE SURGE','danger');}else if(g.phase==='telegraph'){g.phase='strike';enemyAttack();}else if(g.phase==='strike'){g.phase='vulnerable';g.phaseTimer=1.2;}else if(g.phase==='vulnerable'){g.phase='idle';g.phaseTimer=difficultyRules().recovery;g.guardUntil=Math.min(g.guardUntil,g.clock);g.msg='NEXT WINDOW APPROACHING';g.tone='neutral';}}
 if(g.pHP<=0)finish('lost');
}
function updateHud(){
 $('player-hp').textContent=g.pHP;$('enemy-hp').textContent=g.eHP;$('player-hp-bar').style.width=Math.max(0,Math.min(100,g.pHP/Math.max(1,g.playerMaxHP||100)*100))+'%';$('enemy-hp-bar').style.width=Math.max(0,Math.min(100,g.eHP/Math.max(1,g.enemyMaxHP)*100))+'%';const playerHpMeta=document.querySelector('.fighter:not(.enemy) .fighter-data small span');if(playerHpMeta)playerHpMeta.textContent=' / '+(g.playerMaxHP||100)+' HP';const enemyHpMeta=document.querySelector('.fighter.enemy .fighter-data small span');if(enemyHpMeta)enemyHpMeta.textContent=' / '+g.enemyMaxHP+' HP';const timeLeft=Math.max(0,Math.ceil(g.time));$('timer').textContent=String(Math.floor(timeLeft/60)).padStart(2,'0')+':'+String(timeLeft%60).padStart(2,'0');$('timer').classList.toggle('urgent',g.time<=10);
 $('phase-label').textContent=g.mode==='duo'?'LOCAL DUEL':g.phase==='telegraph'?'THREAT INCOMING':g.phase==='vulnerable'?'OPENING FOUND':g.phase==='strike'?'IMPACT':'READ THE PATTERN';
 $('combo').textContent=String(g.combo).padStart(2,'0')+'×';$('combo').style.color=g.combo>=3?'#67e8ef':'';$('energy').textContent=String(Math.round(g.energy)).padStart(3,'0');$('energy-bar').style.width=g.energy+'%';$('lane').textContent=g.lane===-1?'LEFT':g.lane===1?'RIGHT':'CENTER';$('feed-text').textContent=(cameraMode&&!trackingOkay)?(g.mode==='duo'?'TRACKING PAUSED — KEEP BOTH PLAYERS IN FRAME':'TRACKING PAUSED — RETURN TO CAMERA FRAME'):g.msg;$('feed').className='feed '+((cameraMode&&!trackingOkay)?'danger':(g.tone==='good'?'good':g.tone==='danger'?'danger':''));if(cameraMode&&!trackingOkay)$('phase-label').textContent='TRACKING PAUSED';
 $('nova-button').disabled=g.energy<100||g.status!=='playing'||paused;$('nova-button').classList.toggle('ready',g.energy>=100);$('nova-label').textContent=g.energy>=100?'READY TO RELEASE':(100-Math.round(g.energy))+'% TO CHARGE';document.querySelectorAll('.move[data-action]').forEach(b=>{b.disabled=g.status!=='playing'||paused||(b.dataset.action==='NOVA'&&g.energy<100)||(b.dataset.action==='MEDKIT'&&(!g.medkits||g.pHP>=(g.playerMaxHP||100)))||(b.dataset.action==='COLLECT'&&!g.pickup);});
 if(g.mode==='duo'){
   $('p1-mini-hp').textContent=g.p1.hp+' HP';$('p2-mini-hp').textContent=g.p2.hp+' HP';$('p1-mana').textContent=Math.round(g.p1.mana);$('p2-mana').textContent=Math.round(g.p2.mana);$('p1-mana-bar').style.width=g.p1.mana+'%';$('p2-mana-bar').style.width=g.p2.mana+'%';$('p1-kit').textContent='MED KITS · '+g.p1.medkits;$('p2-kit').textContent='MED KITS · '+g.p2.medkits;
   const labels=document.querySelectorAll('.fighter-label');if(labels[1])labels[1].innerHTML='PLAYER TWO <i>● CHALLENGER</i>';const names=document.querySelectorAll('.fighter-data strong');if(names[1])names[1].textContent='RIFT RUNNER II';
   document.querySelectorAll('.duo-action-grid button').forEach(b=>{const p=b.dataset.player==='2'?g.p2:g.p1,k=b.dataset.duoAction;b.disabled=g.status!=='playing'||paused||(k==='NOVA'&&p.mana<60)||(k==='MEDKIT'&&(!p.medkits||p.hp>=100));});
 }else{const labels=document.querySelectorAll('.fighter-label');if(labels[1])labels[1].innerHTML='RIFT ENTITY <i>● HOSTILE</i>';const names=document.querySelectorAll('.fighter-data strong');if(names[1])names[1].textContent='THE HOLLOW';}
 const ps=$('pickup-status');if(g.pickup){ps.textContent=(g.pickup.type==='medkit'?'MED KIT SUPPLY DROP':'MANA ORB SUPPLY DROP')+' · CLAIM NOW · '+Math.ceil(g.pickup.expires-g.clock)+'s LEFT'+(g.mode==='solo'?' · MED KITS '+g.medkits:'');ps.classList.add('active');}else{ps.textContent='NEXT SUPPLY DROP · '+Math.max(0,Math.ceil(g.nextSupplyAt-g.clock))+'s'+(g.mode==='solo'?' · MED KITS '+g.medkits:'');ps.classList.remove('active');}
 $('best-combo').textContent=String(bestRecord).padStart(2,'0')+'×';
}
function showOverlay(title,desc,tag,buttons,stats) {
 const overlay=$('overlay'),dialog=$('dialog');overlay.classList.remove('hidden');dialog.className='dialog'+(stats?' result':'');
 let html='<span class="tag">'+tag+'</span><h2>'+title+'</h2><p>'+desc+'</p>';
 if(stats)html+='<div class="stats"><div><span>BEST COMBO</span><b>'+String(g.best).padStart(2,'0')+'×</b></div><div><span>DAMAGE</span><b>'+String(g.damage).padStart(3,'0')+'</b></div><div><span>ACCURACY</span><b>'+accuracy()+'%</b></div><div><span>DODGES</span><b>'+String(g.dodges).padStart(2,'0')+'</b></div></div>';
 buttons.forEach(b=>html+='<button class="btn '+b.style+'" data-overlay="'+b.action+'">'+b.label+'</button>');
 if(!stats)html+='<button class="text-btn" data-overlay="home">EXIT TO MAIN MENU</button>';
 dialog.innerHTML=html;
 dialog.querySelectorAll('[data-overlay]').forEach(b=>b.addEventListener('click',()=>{const action=b.dataset.overlay;if(action==='resume'){paused=false;$('overlay').classList.add('hidden');updateHud();}else if(action==='restart'){beginGame(g.mode);}else if(action==='home'){stopCamera(true);paused=false;g=freshGame();showScreen('home');$('overlay').classList.add('hidden');}else if(action==='card')downloadCard();}));
}
function accuracy(){return g.pulses?Math.round(g.clean/g.pulses*100):0;}
function showResult(){
 if(g.mode==='duo'){const winner=g.winner;const title=winner===0?'PERFECTLY EVEN.':'PLAYER '+winner+' WINS.';const desc=winner===0?'Both fighters end the round with the same health. Run it back.':(winner===1?'Player One controlled the arena this round.':'Player Two controlled the arena this round.');
 showOverlay(title,desc,'LOCAL DUEL / SESSION REPORT',[{label:'RUN IT BACK →',style:'primary',action:'restart'},{label:'EXPORT RESULT CARD',style:'secondary',action:'card'},{label:'BACK TO MAIN MENU',style:'secondary',action:'home'}],true);return;}
 const won=g.status==='won';showOverlay(won?'RIFT COLLAPSED.':g.status==='time-up'?'TIME FRACTURED.':'SIGNAL LOST',won?'You read the pattern and closed the breach on '+difficultyRules().label+'.':g.status==='time-up'?'The rift is still open. Change your timing and try again.':'The Hollow won this round. Try '+(difficulty==='hard'?'Normal or Beginner Training':difficulty==='normal'?'Beginner Training':'the round again')+' when ready.','RIFT DUEL / '+difficultyRules().label+' / SESSION REPORT',[{label:'RUN IT BACK →',style:'primary',action:'restart'},{label:'EXPORT RESULT CARD',style:'secondary',action:'card'},{label:'BACK TO MAIN MENU',style:'secondary',action:'home'}],true);
}
function pauseGame(){if(g.status!=='playing')return;paused=true;showOverlay('Catch your breath.','The rift is frozen. Your progress is still here.','SESSION PAUSED',[{label:'RESUME ROUND →',style:'primary',action:'resume'},{label:'RESTART ROUND',style:'secondary',action:'restart'}],false);}
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
   ctx.save();const hurt=g.playerHurtUntil>g.clock,attacking=g.playerAttackUntil>g.clock;const px=x+(g.lane===-1?-scale*.23:g.lane===1?scale*.23:0)+Math.sin(tm*.002)*2;ctx.translate(px,floor);ctx.globalAlpha=hurt&&!reducedMotion&&Math.floor(tm/65)%2===0?.52:1;ctx.shadowBlur=hurt?32:attacking?36:20;ctx.shadowColor=hurt?'#ff536d':attacking?'#66f1ff':'#7c8bff';ctx.strokeStyle=hurt?'#ff9aa8':'#bac4ff';ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=scale*.115;ctx.strokeStyle='#7b8bff';ctx.beginPath();ctx.ellipse(0,-3,scale*.54,scale*.12,0,0,Math.PI*2);ctx.stroke();ctx.strokeStyle='#bac4ff';ctx.beginPath();ctx.moveTo(-scale*.1,-scale*.72);ctx.lineTo(-scale*.29,-scale*.08);ctx.lineTo(-scale*.45,-scale*.02);ctx.moveTo(scale*.1,-scale*.72);ctx.lineTo(scale*.3,-scale*.08);ctx.lineTo(scale*.44,-scale*.02);ctx.moveTo(0,-scale*1.58);ctx.lineTo(0,-scale*.76);ctx.moveTo(-scale*.28,-scale*1.48);ctx.lineTo(scale*.28,-scale*1.48);ctx.stroke();if(g.guardUntil>g.clock){ctx.strokeStyle='#61f0ff';ctx.beginPath();ctx.moveTo(-scale*.25,-scale*1.38);ctx.lineTo(-scale*.04,-scale*1.08);ctx.lineTo(scale*.04,-scale*1.08);ctx.lineTo(scale*.25,-scale*1.38);ctx.stroke();ctx.beginPath();ctx.arc(0,-scale*1.3,scale*.48,Math.PI*1.05,Math.PI*1.95);ctx.stroke();}else if(attacking){const side=g.playerAttackSide||1,other=-side;ctx.strokeStyle='#7df5ff';ctx.lineWidth=scale*.13;ctx.beginPath();ctx.moveTo(side*scale*.28,-scale*1.48);ctx.lineTo(side*scale*.5,-scale*1.3);ctx.lineTo(side*scale*.82,-scale*1.25);ctx.stroke();ctx.beginPath();ctx.arc(side*scale*.82,-scale*1.25,scale*.2,0,Math.PI*2);ctx.stroke();ctx.strokeStyle=hurt?'#ff9aa8':'#bac4ff';ctx.lineWidth=scale*.115;ctx.beginPath();ctx.moveTo(other*scale*.28,-scale*1.48);ctx.lineTo(other*scale*.47,-scale*1.08);ctx.lineTo(other*scale*.35,-scale*.9);ctx.stroke();}else{const swing=Math.sin(tm*.003)*scale*.06;ctx.beginPath();ctx.moveTo(-scale*.28,-scale*1.48);ctx.lineTo(-scale*.48,-scale*1.08+swing);ctx.lineTo(-scale*.35,-scale*.9+swing);ctx.moveTo(scale*.28,-scale*1.48);ctx.lineTo(scale*.49,-scale*1.14-swing);ctx.lineTo(scale*.38,-scale*.96-swing);ctx.stroke();}ctx.fillStyle='#10152a';ctx.beginPath();ctx.ellipse(0,-scale*1.86,scale*.17,scale*.21,0,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.strokeStyle='#71eaff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-scale*.1,-scale*1.9);ctx.lineTo(scale*.1,-scale*1.9);ctx.stroke();ctx.restore();
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
 const vignette=ctx.createRadialGradient(w*.5,h*.48,Math.min(w,h)*.22,w*.5,h*.48,Math.max(w,h)*.72);vignette.addColorStop(.45,'rgba(2,3,12,0)');vignette.addColorStop(1,'rgba(1,2,8,.6)');ctx.fillStyle=vignette;ctx.fillRect(0,0,w,h);
}
function loop(t){
 if(previousFrame&&g.status==='playing'&&!paused){step((t-previousFrame)/1000);}
 draw(t);if(t-lastHudAt>110){updateHud();lastHudAt=t;}
 previousFrame=t;raf=requestAnimationFrame(loop);
}
raf=requestAnimationFrame(loop);
document.querySelectorAll('[data-difficulty]').forEach(button=>button.addEventListener('click',()=>{
 const next=button.dataset.difficulty;if(!DIFFICULTIES[next])return;difficulty=next;
 document.querySelectorAll('[data-difficulty]').forEach(option=>{const selected=option===button;option.classList.toggle('active',selected);option.setAttribute('aria-pressed',String(selected));});
 const summaries={beginner:'Beginner Training selected — slower bot attacks and longer openings.',normal:'Normal selected — balanced speed, damage and recovery.',hard:'Hard selected — faster attacks, stronger hits and shorter openings.'};
 $('difficulty-summary').textContent=summaries[difficulty];
}));
document.querySelectorAll('[data-sensitivity]').forEach(button=>button.addEventListener('click',()=>{
 const next=button.dataset.sensitivity;if(!MOTION_SENSITIVITY[next])return;motionSensitivity=next;
 document.querySelectorAll('[data-sensitivity]').forEach(option=>{
  const selected=option.dataset.sensitivity===motionSensitivity;option.classList.toggle('active',selected);option.setAttribute('aria-pressed',String(selected));
 });
 const summaries={max:'MAX sensitivity selected — catches shorter jabs, but may also count more incidental arm movement.',high:'HIGH sensitivity selected — looks for more deliberate punches and filters small wrist jitter.'};
 document.querySelectorAll('[data-sensitivity-summary]').forEach(node=>node.textContent=summaries[motionSensitivity]);
}));
$('play-keyboard').addEventListener('click',()=>chooseGameMode('solo'));
$('play-duo-camera').addEventListener('click',()=>chooseGameMode('duo'));
$('enable-camera').addEventListener('click',()=>{void startCamera('lobby');});
$('gate-retry').addEventListener('click',()=>{void startCamera('lobby');});
$('calibrate-start').addEventListener('click',()=>{
 const one=shape(lastPose),two=shape(secondPose);
 if(!trackingOkay||!one||(cameraTargetMode==='duo'&&!two)){
  $('calibrate-start').disabled=true;
  showError(cameraTargetMode==='duo'?'Waiting for both players. Stand apart and keep shoulders and hips visible in the camera.':'Waiting for a clear body track. Step back slightly and keep your shoulders and hips in frame.');
  return;
 }
 neutralLean=one.lean;neutralLeans=[one.lean,two?two.lean:0];calibrated=true;cameraMode=true;priorGuardPose=false;priorLeanSide=0;
 motionMemory.forEach(m=>{m.priorPose=null;m.guardPose=false;m.leanSide=0;});
 showError('');
 $('setup-title').textContent='MOTION CALIBRATED';
 $('setup-copy').textContent=cameraTargetMode==='duo'?'Both players are calibrated. Use comfortable air jabs to trigger PULSE, cross your forearms in an X to hold the shield, and lean slightly to PHASE.':'Ready. Use comfortable air jabs to trigger PULSE, cross your forearms in an X to hold the shield, and lean slightly to PHASE. Buttons remain available as backup.';
 beginGame(cameraTargetMode);$('mode-pill').classList.add('live');
 $('move-mode').textContent=cameraTargetMode==='duo'?'TWO PLAYERS · GESTURES + TOUCH':'GESTURES + BUTTON BACKUP · '+difficultyRules().label;
 $('camera-hint').classList.add('hidden');
});
$('duo-touch-start').addEventListener('click',()=>{stopCamera(false);cameraMode=false;calibrated=false;beginGame('duo');$('mode-pill').innerHTML='<b></b>2P TOUCH DUEL';$('move-mode').textContent='SPLIT TOUCH CONTROLS';$('camera-hint').classList.add('hidden');});
$('stop-camera').addEventListener('click',()=>lockToCameraGate('Camera stopped. Re-enable camera access to continue.'));$('camera-close').addEventListener('click',()=>lockToCameraGate('Camera stopped. Re-enable camera access to continue.'));$('brand-home').addEventListener('click',()=>returnToModeSelection());$('pause').addEventListener('click',pauseGame);
$('sound-toggle').addEventListener('click',()=>{soundOn=!soundOn;$('sound-toggle').innerHTML=soundOn?'<svg viewBox="0 0 24 24"><path d="M4 10v4h4l5 4V6l-5 4H4Z"/><path d="M16 9a4.5 4.5 0 0 1 0 6"/></svg>':'<svg viewBox="0 0 24 24"><path d="M4 10v4h4l5 4V6l-5 4H4Z"/><path d="m17 9 5 6m0-6-5 6"/></svg>';});
$('motion-toggle').addEventListener('click',()=>{reducedMotion=!reducedMotion;document.body.classList.toggle('reduced',reducedMotion);});
document.querySelectorAll('.move[data-action]').forEach(b=>b.addEventListener('click',()=>action(b.dataset.action)));
document.querySelectorAll('.duo-action-grid button[data-duo-action]').forEach(b=>b.addEventListener('click',()=>action(b.dataset.duoAction,Number(b.dataset.player))));
window.addEventListener('keydown',e=>{if(arena.classList.contains('hidden'))return;const k=e.key.toLowerCase();if([' ','arrowleft','arrowright','enter'].includes(k))e.preventDefault();if(e.repeat)return;if(k==='escape'){if(g.status==='playing')pauseGame();else if(paused){paused=false;$('overlay').classList.add('hidden');}return;}if(paused)return;if(g.mode==='duo'){if(k===' ')action('PULSE',1);if(k==='g')action('GUARD',1);if(k==='a')action('PHASE_LEFT',1);if(k==='d')action('PHASE_RIGHT',1);if(k==='q')action('NOVA',1);if(k==='r')action('COLLECT',1);if(k==='e')action('MEDKIT',1);if(k==='j')action('PULSE',2);if(k==='l')action('GUARD',2);if(k==='arrowleft')action('PHASE_LEFT',2);if(k==='arrowright')action('PHASE_RIGHT',2);if(k==='u')action('NOVA',2);if(k==='i')action('COLLECT',2);if(k==='o')action('MEDKIT',2);return;}if(k===' '||k==='j')action('PULSE');if(k==='g'||k==='shift')action('GUARD');if(k==='a'||k==='arrowleft')action('PHASE_LEFT');if(k==='d'||k==='arrowright')action('PHASE_RIGHT');if(k==='q'||k==='enter')action('NOVA');if(k==='r')action('COLLECT');if(k==='e')action('MEDKIT');});
window.addEventListener('resize',()=>{canvas.width=0;canvas.height=0;});
function chooseGameMode(mode){
 if(cameraStatus!=='ready'||!stream||!landmarker){
  $('camera-gate').classList.remove('hidden');
  $('gate-title').textContent='Enable your camera to continue.';
  $('gate-copy').textContent='Both Solo and Duo use your camera for motion controls. Allow camera access and wait for motion tracking to load.';
  if(!cameraStarting)void startCamera('lobby');
  return;
 }
 cameraTargetMode=mode;calibrated=false;trackingOkay=false;lastTrackingAt=0;lastPose=null;secondPose=null;priorPose=null;
 motionMemory.forEach(m=>{m.priorPose=null;m.guardPose=false;m.leanSide=0;});
 $('camera-gate').classList.add('hidden');$('setup').classList.remove('hidden');
 $('setup-title').textContent=mode==='duo'?'LOOKING FOR BOTH PLAYERS':'LOOKING FOR PLAYER';
 $('setup-copy').textContent=mode==='duo'?'Stand side by side with space between you. Keep both shoulders and hips visible. The start button unlocks automatically when both bodies are detected.':'Keep your shoulders and hips inside the camera frame. The start button unlocks automatically when your body is detected.';
 $('calibrate-start').disabled=true;
 $('calibrate-start').textContent=mode==='duo'?'WAITING FOR TWO PLAYERS…':'WAITING FOR PLAYER…';
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
 if(cameraStatus!=='ready'||!stream||!landmarker){lockToCameraGate('Reconnect your camera to return to the arena.');return;}
 paused=false;calibrated=false;g=freshGame('solo');showScreen('home');$('overlay').classList.add('hidden');cameraTargetMode='lobby';$('setup').classList.remove('hidden');
 $('setup-title').textContent='CAMERA CONNECTED';$('setup-copy').textContent='Choose Solo or Duo, then calibrate your movement before the fight.';$('calibrate-start').classList.add('hidden');$('enable-camera').classList.add('hidden');$('camera-hint').classList.add('hidden');
}
function showError(text){$('setup-error').textContent=text;$('setup-error').classList.toggle('hidden',!text);}
async function startCamera(targetMode='lobby'){
 if(cameraStarting)return;
 if(cameraStatus==='ready'&&stream&&landmarker){cameraTargetMode=targetMode;return;}
 cameraStarting=true;cameraTargetMode=targetMode;secondPose=null;
 $('camera-gate').classList.remove('hidden');$('gate-title').textContent='Your camera is your controller.';$('gate-copy').textContent='Requesting camera permission. Allow access to use Solo and Duo. Camera frames stay on this device.';$('gate-status').className='gate-status';$('gate-status').innerHTML='<span class="gate-spin"></span> REQUESTING CAMERA PERMISSION…';$('gate-retry').disabled=true;
 $('setup').classList.remove('hidden');$('setup-title').textContent='REQUESTING CAMERA';$('setup-copy').textContent='Your browser will ask for permission. Frames stay in your browser and are never recorded.';$('calibrate-start').classList.add('hidden');$('duo-touch-start').classList.add('hidden');showError('');
 $('enable-camera').disabled=true;
 try{
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw new Error('Camera access is unavailable. Open Kinetix over HTTPS and retry.');
  stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480},frameRate:{ideal:60,max:60}},audio:false});
  stream.getVideoTracks().forEach(track=>track.addEventListener('ended',()=>{if(cameraStatus==='ready'&&!cameraStarting)lockToCameraGate('Your camera disconnected or stopped sharing.');}));
  video.srcObject=stream;await video.play();
  cameraPanel.classList.remove('off');cameraStatus='loading';$('camera-label').textContent='LOADING MOTION AI';$('setup-title').textContent='INITIALIZING MOTION TRACKING';$('setup-copy').textContent='Loading the locally hosted motion engine and pose model. Camera frames stay on this device.';
  const files=await FilesetResolver.forVisionTasks(wasmUrl);
  const options={baseOptions:{modelAssetPath:modelUrl,delegate:'GPU'},runningMode:'VIDEO',numPoses:cameraTargetMode==='solo'?1:2,minPoseDetectionConfidence:.55,minPosePresenceConfidence:.5,minTrackingConfidence:.5};
  let pose;
  try{pose=await PoseLandmarker.createFromOptions(files,options);}
  catch(gpuError){pose=await PoseLandmarker.createFromOptions(files,{...options,baseOptions:{...options.baseOptions,delegate:'CPU'}});}
  landmarker=pose;cameraStatus='ready';cameraStarting=false;cameraMode=true;calibrated=false;trackingOkay=false;lastTrackingAt=0;lastPose=null;secondPose=null;priorPose=null;motionMemory.forEach(m=>{m.priorPose=null;m.guardPose=false;m.leanSide=0;});$('camera-gate').classList.add('hidden');$('gate-retry').disabled=false;$('setup').classList.remove('hidden');if(cameraTargetMode==='lobby'){$('setup-title').textContent='CAMERA CONNECTED';$('setup-copy').textContent='Camera permission is active. Choose Solo or Duo, then calibrate your movement before the fight.';$('calibrate-start').classList.add('hidden');$('enable-camera').classList.add('hidden');$('duo-touch-start').classList.add('hidden');}else{$('setup-title').textContent=cameraTargetMode==='duo'?'CAMERA READY — FIND TWO PLAYERS':'CAMERA READY — FIND PLAYER';$('setup-copy').textContent=cameraTargetMode==='duo'?'Both players should stand apart and keep head, shoulders, wrists and hips visible. Safe air gestures only—no contact. Calibrate when both are tracked.':'Keep head, shoulders, wrists and hips in frame. Stand comfortably and calibrate when ready.';$('calibrate-start').textContent=cameraTargetMode==='duo'?'CALIBRATE BOTH PLAYERS & START':'CALIBRATE & START';$('calibrate-start').classList.remove('hidden');$('enable-camera').classList.add('hidden');$('duo-touch-start').classList.add('hidden');}$('camera-label').textContent='CAMERA PREVIEW';$('camera-dot').classList.remove('live');$('camera-hint').textContent='CHOOSE SOLO OR DUO TO CALIBRATE';$('camera-hint').classList.remove('hidden');runCameraLoop();
 }catch(err){stopCamera(false);cameraStarting=false;cameraStatus='error';cameraMode=false;$('camera-gate').classList.remove('hidden');$('gate-title').textContent='Camera access is required.';$('gate-copy').textContent='Kinetix cannot start a round until the browser allows camera access. Check site permissions, then retry. Your camera is not recorded.';$('gate-status').className='gate-status error';$('gate-status').textContent=(err&&err.name==='NotAllowedError')?'CAMERA PERMISSION DENIED — ALLOW IT IN BROWSER SETTINGS':(err&&err.message?err.message:'CAMERA SETUP FAILED');$('gate-retry').disabled=false;$('setup-title').textContent='CAMERA UNAVAILABLE';showError(err&&err.message?err.message:'Camera setup failed. Please retry.');$('setup-copy').textContent='Allow camera access in your browser, then select Retry. Solo and Duo both require a working camera.';$('enable-camera').disabled=false;$('enable-camera').textContent='RETRY CAMERA ACCESS';$('enable-camera').classList.remove('hidden');}
}
function stopCamera(resetUI){
 cancelAnimationFrame(cameraRAF);cameraLoopStarted=false;stream&&stream.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;try{landmarker&&landmarker.close();}catch{}landmarker=null;cameraPanel.classList.add('off');cameraStatus='off';cameraMode=false;calibrated=false;trackingOkay=false;lastTrackingAt=0;lastPose=null;priorPose=null;$('calibrate-start').classList.add('hidden');$('enable-camera').disabled=false;$('enable-camera').innerHTML='<svg viewBox="0 0 24 24"><path d="M4 7.5h3l1.7-2h6.6l1.7 2h3A1.5 1.5 0 0 1 21.5 9v9a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18V9A1.5 1.5 0 0 1 4 7.5Z"/><circle cx="12" cy="13" r="3.5"/></svg> PLAY WITH CAMERA';$('mode-pill').innerHTML='<b></b>KEYBOARD MODE';$('mode-pill').classList.remove('live');$('move-mode').textContent='KEYBOARD / CLICK CONTROLS';if(resetUI){$('setup').classList.add('hidden');}$('duo-touch-start').classList.add('hidden');secondPose=null;motionMemory.forEach(m=>{m.priorPose=null;m.guardPose=false;m.leanSide=0;}); }
function poseCenterX(p){return ((p[11]?.x||0)+(p[12]?.x||0))/2;}
function runCameraLoop(){
 if(cameraLoopStarted)return;cameraLoopStarted=true;
 const track=now=>{
  if(!landmarker||cameraStatus!=='ready')return;
  if(video.readyState>=2&&now-lastInference>12&&video.currentTime!==lastVideoTime){
   lastInference=now;lastVideoTime=video.currentTime;
   try{
    const result=landmarker.detectForVideo(video,now);
    // Keep player assignment consistent with the labels: Player 1 is on the left.
    const poses=(result.landmarks||[]).filter(p=>p&&p.length>24).sort((a,b)=>poseCenterX(a)-poseCenterX(b));
    lastPose=poses[0]||null;secondPose=cameraTargetMode==='duo'?(poses[1]||null):null;
    const oneReady=!!shape(lastPose),twoReady=cameraTargetMode!=='duo'||!!shape(secondPose);
    if(oneReady&&twoReady){lastTrackingAt=now;trackingOkay=true;}
    else trackingOkay=!!lastTrackingAt&&now-lastTrackingAt<650;

    if(trackingOkay){
     $('camera-dot').classList.add('live');
     $('camera-label').textContent=cameraTargetMode==='duo'?'TWO PLAYERS TRACKED':'MOTION LIVE';
     $('camera-hint').classList.add('hidden');
     if(cameraTargetMode!=='lobby'&&!home.classList.contains('hidden')&&!setup.classList.contains('hidden')){
      $('calibrate-start').disabled=false;
      $('calibrate-start').textContent=cameraTargetMode==='duo'?'CALIBRATE BOTH PLAYERS & START':'CALIBRATE & START';
      $('setup-title').textContent=cameraTargetMode==='duo'?'BOTH PLAYERS DETECTED':'PLAYER DETECTED';
      $('setup-copy').textContent=cameraTargetMode==='duo'?'Both bodies are visible. Calibrate now to begin the local duel.':'Your body is visible. Calibrate now to start '+difficultyRules().label+' mode.';
      showError('');
     }
     if(calibrated&&g.status==='playing'&&!paused){detectMotion(lastPose,now,1);if(cameraTargetMode==='duo')detectMotion(secondPose,now,2);}
    }else{
     $('camera-dot').classList.remove('live');
     $('camera-label').textContent=cameraTargetMode==='duo'?'NEED TWO PLAYERS':'FINDING PLAYER';
     $('camera-hint').textContent=cameraTargetMode==='duo'?'BOTH PLAYERS MUST BE VISIBLE':'KEEP SHOULDERS AND HIPS IN FRAME';
     $('camera-hint').classList.remove('hidden');
     if(cameraTargetMode!=='lobby'&&!home.classList.contains('hidden')&&!setup.classList.contains('hidden')){
      $('calibrate-start').disabled=true;
      $('calibrate-start').textContent=cameraTargetMode==='duo'?'WAITING FOR TWO PLAYERS…':'WAITING FOR PLAYER…';
      $('setup-title').textContent=cameraTargetMode==='duo'?'LOOKING FOR BOTH PLAYERS':'LOOKING FOR PLAYER';
      $('setup-copy').textContent=cameraTargetMode==='duo'?'Move apart and keep both shoulders and hips in frame. Avoid standing directly in front of one another.':'Step back enough for your shoulders and hips to fit in frame, and face the camera.';
     }
     if(!trackingOkay){motionMemory.forEach(m=>{m.priorPose=null;m.guardPose=false;m.leanSide=0;});priorPose=null;priorGuardPose=false;priorLeanSide=0;}
    }
   }catch(error){
    console.error('Kinetix pose detection failed:',error);
    $('camera-label').textContent='TRACKING RETRYING';
   }
  }
  cameraRAF=requestAnimationFrame(track);
 };
 cameraRAF=requestAnimationFrame(track);
}
function landmarkVisible(point,threshold=.22){
 return !!point&&(point.visibility===undefined||point.visibility>=threshold);
}
function shape(p){
 if(!p||p.length<=24)return null;
 const ls=p[11],rs=p[12],lh=p[23],rh=p[24];
 // Tracking readiness is based on the torso, not a visible nose and two perfectly visible wrists.
 if(![ls,rs,lh,rh].every(point=>landmarkVisible(point,.2)))return null;
 const sc={x:(ls.x+rs.x)/2,y:(ls.y+rs.y)/2};
 const hc={x:(lh.x+rh.x)/2,y:(lh.y+rh.y)/2};
 const sw=Math.hypot(ls.x-rs.x,ls.y-rs.y),torsoHeight=hc.y-sc.y;
 if(sw<.035||torsoHeight<.035||torsoHeight>.8)return null;
 const lw=landmarkVisible(p[15],.2)?p[15]:null;
 const rw=landmarkVisible(p[16],.2)?p[16]:null;
 return{sw,sy:sc.y,hy:hc.y,lean:(sc.x-hc.x)/sw,lw,rw,wristsReady:!!(lw&&rw)};
}
function vectorDistance(a,b){
 if(!a||!b)return 0;
 const dx=a.x-b.x,dy=a.y-b.y,dz=(a.z||0)-(b.z||0);
 return Math.sqrt(dx*dx+dy*dy+dz*dz*.65);
}
function armMotionSignature(points,side,shoulderWidth){
 const shoulder=points[side===0?11:12],elbow=points[side===0?13:14],wrist=points[side===0?15:16];
 if(!landmarkVisible(shoulder,.10)||!landmarkVisible(wrist,.08))return null;
 const position={x:(wrist.x-shoulder.x)/shoulderWidth,y:(wrist.y-shoulder.y)/shoulderWidth,z:((wrist.z||0)-(shoulder.z||0))/shoulderWidth};
 const hasElbow=landmarkVisible(elbow,.1),upper=hasElbow?vectorDistance(shoulder,elbow):0,lower=hasElbow?vectorDistance(elbow,wrist):0,reach=vectorDistance(shoulder,wrist);
 return{position,extension:hasElbow?reach/Math.max(upper+lower,.001):0,hasElbow,wrist,shoulder};
}
function detectMotion(points,now,player=1){
 const mem=motionMemory[player-1]||motionMemory[0],s=shape(points),tuning=sensitivityRules();
 if(!s){
  mem.priorPose=null;mem.guardPose=false;mem.leanSide=0;
  if(mem.punchHands)mem.punchHands.forEach(hand=>{hand.base=null;hand.prev=null;hand.lastTravel=0;hand.peakTravel=0;hand.lastPunchDirection=null;hand.candidateFrames=0;hand.armed=true;});
  return;
 }
 if(!mem.punchHands)mem.punchHands=[
  {armed:true,base:null,prev:null,lastPunchAt:-9999,restFrames:0,lastTravel:0,peakTravel:0,lastPunchDirection:null,candidateFrames:0},
  {armed:true,base:null,prev:null,lastPunchAt:-9999,restFrames:0,lastTravel:0,peakTravel:0,lastPunchDirection:null,candidateFrames:0}
 ];
 if(!mem.priorPose){
  mem.priorPose=points;mem.priorAt=now;
  mem.punchHands.forEach((hand,side)=>{
   const snap=armMotionSignature(points,side,s.sw);
   hand.base=snap;hand.prev=snap;hand.prevAt=now;hand.armed=true;hand.restFrames=0;
   hand.lastTravel=0;hand.peakTravel=0;hand.lastPunchDirection=null;hand.candidateFrames=0;
  });
  return;
 }
 const dt=(now-mem.priorAt)/1000;
 const wristsReady=!!(s.lw&&s.rw);
 let guard=false;
 if(wristsReady){
  const ls=points[11],rs=points[12],cx=(ls.x+rs.x)/2;
  const gap=Math.hypot(s.lw.x-s.rw.x,s.lw.y-s.rw.y);
  const top=s.sy-s.sw*.42,bottom=s.hy+s.sw*.16;
  const inGuardZone=[s.lw,s.rw].every(w=>w.y>=top&&w.y<=bottom);
  const leftWristCrosses=(s.lw.x-cx)*(ls.x-cx)<0;
  const rightWristCrosses=(s.rw.x-cx)*(rs.x-cx)<0;
  const crossedX=leftWristCrosses&&rightWristCrosses&&gap<s.sw*1.28;
  const handsTogether=gap<s.sw*.78;
  guard=inGuardZone&&(crossedX||handsTogether);
 }
 const wasGuarding=mem.guardPose;
 if(guard){
  if(now-mem.lastGuard>460){action('GUARD',player);mem.lastGuard=now;}
  mem.guardPose=true;
  mem.punchHands.forEach((hand,side)=>{
   const snap=armMotionSignature(points,side,s.sw);
   if(snap){hand.base=snap;hand.prev=snap;hand.prevAt=now;}
   hand.armed=true;hand.restFrames=0;hand.lastTravel=0;hand.peakTravel=0;hand.lastPunchDirection=null;hand.candidateFrames=0;
  });
 }else{
  mem.guardPose=false;
  if(wasGuarding){
   mem.punchHands.forEach((hand,side)=>{
    const snap=armMotionSignature(points,side,s.sw);
    if(snap){hand.base=snap;hand.prev=snap;hand.prevAt=now;}
    hand.armed=true;hand.restFrames=0;hand.lastTravel=0;hand.peakTravel=0;hand.lastPunchDirection=null;hand.candidateFrames=0;
   });
  }else if(dt>=.008&&dt<=.35){
   for(let side=0;side<2;side++){
    const hand=mem.punchHands[side],current=armMotionSignature(points,side,s.sw),previous=hand.prev;
    if(!current){
     hand.prev=null;hand.prevAt=now;hand.lastTravel=0;hand.candidateFrames=0;
     continue;
    }
    const canFire=now-hand.lastPunchAt>=tuning.handCooldown;

    // Losing and regaining a wrist alone is not enough to deal damage. A reacquisition
    // only counts when there is a clear, large reach change from the ready position.
    if(!previous||!hand.base){
     if(previous===null&&hand.armed&&hand.base&&canFire){
      const dx=current.position.x-hand.base.position.x,dy=current.position.y-hand.base.position.y,dz=current.position.z-hand.base.position.z;
      const reacquiredTravel=Math.hypot(dx,dy,dz*.8);
      const reacquiredExtension=current.extension-hand.base.extension;
      if(reacquiredTravel>=tuning.reacquireTravel&&reacquiredExtension>=tuning.extensionDelta*1.5){
       action('PULSE',player);mem.lastPulse=now;hand.lastPunchAt=now;hand.armed=false;
       hand.peakTravel=reacquiredTravel;hand.lastTravel=reacquiredTravel;hand.candidateFrames=0;
       const magnitude=Math.hypot(dx,dy,dz);
       if(magnitude>.001)hand.lastPunchDirection={x:dx/magnitude,y:dy/magnitude,z:dz/magnitude};
      }
     }
     hand.prev=current;hand.prevAt=now;if(!hand.base)hand.base=current;
     hand.lastTravel=hand.base?vectorDistance(current.position,hand.base.position):0;
     continue;
    }

    const elapsed=Math.max(.008,(now-(hand.prevAt??(now-33)))/1000);
    const dx=current.position.x-previous.position.x,dy=current.position.y-previous.position.y,dz=current.position.z-previous.position.z;
    const stepTravel=Math.hypot(dx,dy,dz*.8),speed=stepTravel/elapsed;
    const dirLength=Math.hypot(dx,dy,dz);
    const alignment=hand.lastPunchDirection&&dirLength>.001
      ?(dx*hand.lastPunchDirection.x+dy*hand.lastPunchDirection.y+dz*hand.lastPunchDirection.z)/(dirLength||1)
      :0;
    const travel=vectorDistance(current.position,hand.base.position);
    const previousTravel=Number.isFinite(hand.lastTravel)?hand.lastTravel:travel;
    const extensionDelta=current.extension-hand.base.extension;
    hand.peakTravel=Math.max(hand.peakTravel||0,travel);

    if(!hand.armed){
     const settledNearReady=travel<tuning.returnTravel&&speed<.48;
     const slowReset=travel<tuning.returnTravel*1.2&&speed<.24&&now-hand.lastPunchAt>240;
     if(canFire&&(settledNearReady||slowReset)){
      hand.armed=true;hand.base=current;hand.lastTravel=0;hand.peakTravel=0;
      hand.restFrames=0;hand.lastPunchDirection=null;hand.candidateFrames=0;
     }
    }else{
     // Adapt to tiny idle drift only. Baseline must stay fixed during purposeful movement.
     if(speed<tuning.minSpeed*.42&&travel<tuning.minTravel*1.25){
      const mix=(a,b)=>a+(b-a)*.06;
      hand.base={position:{x:mix(hand.base.position.x,current.position.x),y:mix(hand.base.position.y,current.position.y),z:mix(hand.base.position.z,current.position.z)},extension:mix(hand.base.extension,current.extension),hasElbow:current.hasElbow,wrist:current.wrist,shoulder:current.shoulder};
     }
     const nowTravel=vectorDistance(current.position,hand.base.position);
     const outwardGrowth=nowTravel>previousTravel+tuning.travelGrowth;
     const forwardReach=nowTravel>=tuning.minTravel;
     const directionNotReturn=!hand.lastPunchDirection||alignment>-.38;
     const fastOutward=forwardReach&&speed>=tuning.minSpeed&&outwardGrowth;
     const extensionOutward=forwardReach&&extensionDelta>=tuning.extensionDelta&&speed>=tuning.minSpeed*.85;
     const candidate=directionNotReturn&&(fastOutward||extensionOutward);

     hand.candidateFrames=candidate?hand.candidateFrames+1:0;
     const confirmed=hand.candidateFrames>=tuning.confirmFrames;
     const strongSingleFrame=directionNotReturn&&nowTravel>=tuning.strongTravel&&speed>=tuning.strongSpeed&&outwardGrowth;
     if((confirmed||strongSingleFrame)&&canFire){
      action('PULSE',player);mem.lastPulse=now;hand.lastPunchAt=now;hand.armed=false;hand.restFrames=0;
      hand.peakTravel=Math.max(hand.peakTravel,nowTravel);hand.candidateFrames=0;
      if(dirLength>.001)hand.lastPunchDirection={x:dx/dirLength,y:dy/dirLength,z:dz/dirLength};
     }
     hand.lastTravel=nowTravel;
    }
    hand.prev=current;hand.prevAt=now;
    if(!hand.armed)hand.lastTravel=vectorDistance(current.position,hand.base.position);
   }
  }else{
   // Timing gaps reset velocity and pending candidates rather than creating a false speed spike.
   mem.punchHands.forEach((hand,side)=>{
    const snap=armMotionSignature(points,side,s.sw);
    if(snap){hand.prev=snap;hand.prevAt=now;if(hand.base)hand.lastTravel=vectorDistance(snap.position,hand.base.position);}
    hand.candidateFrames=0;
   });
  }
 }
 const lean=s.lean-neutralLeans[player-1],leanSide=lean<-.2?-1:lean>.2?1:0;
 if(!guard&&leanSide!==0&&mem.leanSide===0&&now-mem.lastPhase>650){action(leanSide<0?'PHASE_LEFT':'PHASE_RIGHT',player);mem.lastPhase=now;}
 mem.leanSide=guard?0:leanSide;
 mem.priorPose=points;mem.priorAt=now;
}
window.addEventListener('beforeunload',()=>{cancelAnimationFrame(cameraRAF);stream&&stream.getTracks().forEach(t=>t.stop());try{landmarker&&landmarker.close();}catch{}if(audioContext)audioContext.close();});
void startCamera('lobby');

