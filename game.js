/* ECHO WARD WebXR prototype. Client-trusting networking; not production security. */
(() => {
'use strict';
const $=id=>document.getElementById(id);
const state={joined:false,connected:false,code:'',players:new Map(),peers:new Set(),strokes:new Map(),runes:[],candidate:[],active:null,ink:8,spy:false,muted:false,micDb:-80,noiseAt:0,banished:false,won:false,dead:false};
const V=()=>new THREE.Vector3();
let scene,rig,head,left,right,echo,echoHead,exit,mask,dt=0,hostClock=0,poseClock=0,baitClock=0;
let audioContext,analyser,micSource,recorder,baitAudio,recordTimer,chunks=[],captureStream;
let monster={x:0,y:0,z:-8,state:'patrol',target:null,until:0};
let draw=false,desktopSpy=false,stickMove={x:0,y:0},snapReady=true,keys={};
let lastStrokePoint=null,lastStrokeTime=0,lastSend=0,strokeSeq=0;
const own=()=>NAF.clientId;
const isHost=()=>[own(),...state.peers].filter(Boolean).sort()[0]===own();
const vec=p=>({x:p.x,y:p.y,z:p.z});
const bounded=p=>p && ['x','y','z'].every(k=>Number.isFinite(p[k])&&Math.abs(p[k])<100);
function message(s){$('status').textContent=s;}
function send(type,data){if(state.connected) NAF.connection.broadcastDataGuaranteed(type,data);}
function headPosition(){return head.object3D.getWorldPosition(V());}
function registerChannels(){
 NAF.connection.subscribeToDataChannel('pose',(sender,type,d)=>{
  if(!bounded(d.p)||!Number.isFinite(d.db))return;
  state.players.set(sender,{p:d.p,db:Math.max(-80,Math.min(0,d.db)),time:performance.now()});
 });
 NAF.connection.subscribeToDataChannel('noise',(sender,type,d)=>{if(isHost()&&bounded(d.p)) hear(sender,d.p);});
 NAF.connection.subscribeToDataChannel('world',(sender,type,d)=>{
  if(sender!==[own(),...state.peers].filter(Boolean).sort()[0])return;
  if(!bounded(d.m)||!['patrol','investigate','stalk','lunge','banished'].includes(d.m.state))return;
  monster=d.m;state.banished=!!d.b;
 });
 NAF.connection.subscribeToDataChannel('chalk',(sender,type,d)=>{
  const host=[own(),...state.peers].filter(Boolean).sort()[0];
  if(!d||typeof d.id!=='string'||(!d.id.startsWith(sender+':')&&sender!==host)||!Array.isArray(d.points)||d.points.length>150)return;
  receiveStroke(d);
 });
 NAF.connection.subscribeToDataChannel('rune',(sender,type,d)=>{
  // Prototype only: remote geometric validation is not implemented.
  if(!bounded(d.p))return;
  addRune(d.p);
 });
 NAF.connection.subscribeToDataChannel('snapshot-request',()=>{
  if(!isHost())return;
  for(const [id,s] of state.strokes)send('chalk',{id,points:s.points});
  for(const r of state.runes)send('rune',{p:r.p});
 });
}
AFRAME.registerComponent('echo-info',{
 schema:{name:{default:'Wanderer'}},
 update(){const label=this.el.querySelector('.label');if(label)label.setAttribute('text',{value:this.data.name.slice(0,20),align:'center',width:2,color:'#c8e8df'});}
});
AFRAME.registerComponent('echo-loop',{tick(t,ms){if(state.joined)update(t,Math.min(ms/1000,.05));}});
function buildScene(){
 const template=document.createElement('template');template.id='avatar-template';
 template.innerHTML='<a-entity><a-entity class="head"><a-sphere radius="0.13" material="color:#a9bfb7;roughness:1"></a-sphere><a-entity class="label" position="0 .3 0"></a-entity></a-entity><a-box class="left" width=".07" height=".1" depth=".13" color="#8ab4a1"></a-box><a-box class="right" width=".07" height=".1" depth=".13" color="#e5ddba"></a-box></a-entity>';
 const assets=document.createElement('a-assets');assets.appendChild(template);
 scene=document.createElement('a-scene');scene.setAttribute('echo-loop','');scene.setAttribute('renderer','antialias: false; colorManagement: true');
 scene.setAttribute('background','color:#030608');scene.setAttribute('fog','type: exponential; color: #030608; density: 0.045');
 scene.appendChild(assets);
 scene.insertAdjacentHTML('beforeend',`
 <a-entity light="type:ambient;color:#94b0b7;intensity:.45"></a-entity>
 <a-plane rotation="-90 0 0" width="12" height="20" position="0 0 -5" color="#18252a" roughness="1"></a-plane>
 <a-box position="-6 1.5 -5" width=".2" height="3" depth="20" color="#25343b" class="surface"></a-box>
 <a-box position="6 1.5 -5" width=".2" height="3" depth="20" color="#25343b" class="surface"></a-box>
 <a-box position="0 1.5 -15" width="12" height="3" depth=".2" color="#25343b" class="surface"></a-box>
 <a-box position="0 1.5 5" width="12" height="3" depth=".2" color="#25343b" class="surface"></a-box>
 <a-plane rotation="90 0 0" width="12" height="20" position="0 3 -5" color="#11191d"></a-plane>
 <a-box position="-2 .4 -4" width="2" height=".8" depth="1" color="#37494a" class="surface"></a-box>
 <a-box position="3 .4 -8" width="2" height=".8" depth="1" color="#37494a" class="surface"></a-box>
 <a-entity position="0 2.2 -14.8" text="value:ECHO WARD\nDraw a circle. Lure it in. Escape.;align:center;width:6;color:#93c5b4"></a-entity>
 <a-entity id="exit" position="0 1.2 -14.7"><a-plane width="1.4" height="2.4" color="#15392c"></a-plane><a-entity position="0 1.4 .02" text="value:EXIT - SEALED;align:center;width:3;color:#78b39b"></a-entity></a-entity>
 <a-entity id="rig" echo-info="name:Wanderer">
  <a-entity id="head" class="head" camera position="0 1.6 0" look-controls="pointerLockEnabled:false"><a-entity position="0 0 -1" geometry="primitive:ring;radiusInner:.003;radiusOuter:.004" material="color:#aaccc0;shader:flat"></a-entity></a-entity>
  <a-entity id="left" class="left" oculus-touch-controls="hand:left"><a-cylinder radius=".025" height=".14" rotation="90 0 0" color="#657b72"></a-cylinder></a-entity>
  <a-entity id="right" class="right" oculus-touch-controls="hand:right"><a-cylinder id="chalk-stick" radius=".008" height=".07" rotation="90 0 0" color="#ece7cc"></a-cylinder></a-entity>
 </a-entity>
 <a-entity id="echo" position="0 0 -8">
  <a-cone position="0 1.1 0" radius-bottom=".14" radius-top=".25" height="1.1" color="#352c2b"></a-cone>
  <a-sphere id="echo-head" position="0 1.95 0" radius=".16" scale=".8 1.2 .9" color="#b1a993"></a-sphere>
  <a-box position="0 1.8 -.11" width=".12" height=".14" depth=".08" color="#171012"></a-box>
  <a-cylinder position="-.31 .8 0" radius=".035" height="1.5" rotation="0 0 -9" color="#4a3c36"></a-cylinder>
  <a-cylinder position=".31 .8 0" radius=".035" height="1.5" rotation="0 0 9" color="#4a3c36"></a-cylinder>
  <a-cylinder position="-.1 .35 0" radius=".045" height=".7" color="#2f2929"></a-cylinder>
  <a-cylinder position=".1 .35 0" radius=".045" height=".7" color="#2f2929"></a-cylinder>
 </a-entity>`);
 document.body.appendChild(scene);
}
function setupScene(){
 rig=$('rig');head=$('head');left=$('left');right=$('right');echo=$('echo');echoHead=$('echo-head');exit=$('exit');
 scene.querySelector('a-plane').classList.add('surface');
 const shape=new THREE.Shape();shape.moveTo(-20,-20);shape.lineTo(20,-20);shape.lineTo(20,20);shape.lineTo(-20,20);shape.closePath();
 const hole=new THREE.Path();hole.absarc(0,0,.19,0,Math.PI*2,true);shape.holes.push(hole);
 mask=new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshBasicMaterial({color:0,side:THREE.DoubleSide,depthTest:false,depthWrite:false,fog:false}));
 mask.position.z=-1;mask.renderOrder=999;mask.visible=false;head.object3D.add(mask);
 // No rays, shadows or depth occluders from an invisible monster.
 echo.object3D.traverse(o=>{o.castShadow=false;});
 right.addEventListener('triggerdown',()=>draw=true);right.addEventListener('triggerup',()=>{draw=false;endStroke();});
 right.addEventListener('abuttondown',submitRune);
 left.addEventListener('xbuttondown',manualNoise);left.addEventListener('ybuttondown',toggleMic);
 left.addEventListener('thumbstickmoved',e=>stickMove=e.detail);
 right.addEventListener('thumbstickmoved',e=>{
  if(Math.abs(e.detail.x)<.3)snapReady=true;
  if(Math.abs(e.detail.x)>.75&&snapReady){turn(-Math.sign(e.detail.x)*Math.PI/6);snapReady=false;}
 });
 window.addEventListener('keydown',e=>{
  if(!state.joined)return;
  keys[e.code]=true;
  if(e.repeat)return;
  if(e.code==='KeyC')draw=true;
  if(e.code==='Enter')submitRune();
  if(e.code==='KeyN')manualNoise();
  if(e.code==='KeyM')toggleMic();
  if(e.code==='KeyV')desktopSpy=true;
 });
 window.addEventListener('keyup',e=>{keys[e.code]=false;if(e.code==='KeyC'){draw=false;endStroke();}if(e.code==='KeyV')desktopSpy=false;});
 window.addEventListener('blur',()=>{keys={};draw=false;desktopSpy=false;stickMove={x:0,y:0};endStroke();});
 scene.addEventListener('exit-vr',()=>{draw=false;endStroke();});
}
function turn(angle){
 const before=headPosition();rig.object3D.rotation.y+=angle;
 const after=headPosition();rig.object3D.position.x+=before.x-after.x;rig.object3D.position.z+=before.z-after.z;
}
async function join(create){
 if(state.joined)return;
 $('create').disabled=$('join').disabled=true;
 try{
  const wanted=$('code').value.trim().toUpperCase();
  if(!create&&!/^[A-Z]{4}$/.test(wanted))throw Error('Enter a four-letter code.');
  const response=await fetch(ECHO_SERVER+'/api/rooms'+(create?'':'/'+wanted),{method:create?'POST':'GET'});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Room service error');
  state.code=data.code;
  // Prime browser audio during joining; VR controller input can also resume it.
  audioContext=new (window.AudioContext||window.webkitAudioContext)();await audioContext.resume();
  registerChannels();
  const name=$('name').value.replace(/[^a-z0-9 _-]/gi,'').slice(0,20)||'Wanderer';
  rig.setAttribute('echo-info',{name});
  rig.setAttribute('networked','template:#avatar-template;attachTemplateToLocal:false');
  scene.setAttribute('networked-scene',{serverURL:ECHO_SERVER,app:'echo-ward',room:'ward-'+state.code,adapter:'easyrtc',audio:$('mic').checked,video:false,debug:false});
  state.joined=true;
  $('menu').style.display='none';
  $('hud').textContent='Connecting room '+state.code+'…';
  if($('mic').checked) startAnalyser().catch(e=>{console.warn(e);$('hud').textContent='Mic unavailable: use X / N to lure.';});
  const saved=JSON.parse(localStorage.getItem('echoRooms')||'[]');
  localStorage.setItem('echoRooms',JSON.stringify([{code:state.code,name,date:Date.now()},...saved.filter(r=>r.code!==state.code)].slice(0,8)));
 }catch(e){message(e.message);$('create').disabled=$('join').disabled=false;}
}
async function startAnalyser(){
 // Reuse NAF's existing microphone stream: do not open a second capture device.
 for(let i=0;i<60;i++){
  captureStream=window.easyrtc&&easyrtc.getLocalStream();
  if(captureStream&&captureStream.getAudioTracks().length)break;
  await new Promise(r=>setTimeout(r,250));
 }
 if(!captureStream||!captureStream.getAudioTracks().length)throw Error('No shared microphone stream');
 micSource=audioContext.createMediaStreamSource(captureStream);
 analyser=audioContext.createAnalyser();analyser.fftSize=1024;micSource.connect(analyser);
 state.audioSamples=new Float32Array(analyser.fftSize);
 if($('theft').checked&&window.MediaRecorder)recordTimer=setInterval(recordVoice,4000);
}
function recordVoice(){
 if(state.muted||!captureStream||document.hidden)return;
 try{
  chunks=[];recorder=new MediaRecorder(captureStream);
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  recorder.onstop=()=>{
   if(!chunks.length||state.muted)return;
   if(state.baitURL)URL.revokeObjectURL(state.baitURL);
   state.baitURL=URL.createObjectURL(new Blob(chunks,{type:recorder.mimeType}));chunks=[];
  };
  recorder.start();setTimeout(()=>{if(recorder&&recorder.state==='recording')recorder.stop();},3000);
 }catch(e){console.warn('Optional voice theft unavailable',e);}
}
function toggleMic(){
 if(!state.connected)return;
 state.muted=!state.muted;
 NAF.connection.adapter.enableMicrophone(!state.muted);
 if(state.muted){state.micDb=-80;chunks=[];if(recorder&&recorder.state==='recording')recorder.stop();if(baitAudio)baitAudio.pause();if(state.baitURL)URL.revokeObjectURL(state.baitURL);state.baitURL=null;}
}
function manualNoise(){if(!state.dead){audioContext&&audioContext.resume();const p=headPosition();send('noise',{p:vec(p)});if(isHost())hear(own(),p);}}
function hear(id,p){
 if(monster.state==='banished')return;
 monster.target={id,p:vec(p)};monster.state='investigate';monster.until=performance.now()+8000;
}
function playBait(){
 if(!state.baitURL||state.muted)return;
 if(baitAudio)baitAudio.pause();baitAudio=new Audio(state.baitURL);baitAudio.playbackRate=.78;
 baitAudio.volume=.5; // Local nonspatial prototype; positional voice theft remains future work.
 baitAudio.play().catch(()=>{});
}
function makeLine(points){
 const geometry=new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(p.x,p.y,p.z)));
 return new THREE.Line(geometry,new THREE.LineBasicMaterial({color:0xe2ddbf}));
}
function receiveStroke(d){
 if(!d.points.every(bounded))return;
 if(!state.strokes.has(d.id)&&state.strokes.size>=80)return;
 const old=state.strokes.get(d.id);
 if(old){scene.object3D.remove(old.mesh);old.mesh.geometry.dispose();old.mesh.material.dispose();}
 const mesh=makeLine(d.points);scene.object3D.add(mesh);state.strokes.set(d.id,{points:d.points,mesh});
}
function endStroke(){if(state.active){send('chalk',{id:state.active.id,points:state.active.points});state.active=null;}lastStrokePoint=null;}
function chalk(t){
 if(!draw||state.ink<=0||state.dead){endStroke();return;}
 const vr=scene.is('vr-mode'), source=vr?right:head;
 const origin=source.object3D.getWorldPosition(V());
 const direction=new THREE.Vector3(0,0,-1).applyQuaternion(source.object3D.getWorldQuaternion(new THREE.Quaternion()));
 const ray=new THREE.Raycaster(origin,direction,0,vr?.16:3);
 const targets=[...scene.querySelectorAll('.surface')].map(e=>e.object3D);
 const hit=ray.intersectObjects(targets,true)[0];
 if(!hit){if(state.active)state.candidateBroken=true;endStroke();return;}
 let p=hit.point.clone();
 const normal=hit.face.normal.clone().transformDirection(hit.object.matrixWorld);p.addScaledVector(normal,.003);
 if(lastStrokePoint){
  const distance=p.distanceTo(lastStrokePoint), elapsed=Math.max(.001,(t-lastStrokeTime)/1000);
  if(distance/elapsed>1.1){state.candidateBroken=true;endStroke();return;}
  if(distance<.01)return;
  state.ink-=distance;
 }
 if(state.candidate.reduce((n,s)=>n+s.length,0)>=ECHO_CONFIG.maxChalkPoints){state.candidateBroken=true;endStroke();return;}
 const tremor=Math.max(0,(state.micDb+45)/30)*.006;
 // Tangential noise does not push the mark through its surface.
 const tangent=new THREE.Vector3(1,0,0).projectOnPlane(normal).normalize();
 p.addScaledVector(tangent,Math.sin(t*.035)*tremor);
 if(!state.active){
  if(state.strokes.size>=80)return;
  const points=[];state.active={id:own()+':'+(++strokeSeq),points};state.candidate.push(points);
 }
 state.active.points.push(vec(p));receiveStroke(state.active);
 if(t-lastSend>100){send('chalk',{id:state.active.id,points:state.active.points});lastSend=t;}
 lastStrokePoint=p;lastStrokeTime=t;
 if(state.active.points.length>=140)endStroke();
 const stick=$('chalk-stick');stick.object3D.scale.y=Math.max(.05,state.ink/8);
}
function submitRune(){
 endStroke();
 const points=state.candidate.flat();state.candidate=[];
 const broken=state.candidateBroken;state.candidateBroken=false;
 if(broken||points.length<16){state.notice='Broken / incomplete circle';return;}
 const center=points.reduce((v,p)=>v.add(new THREE.Vector3(p.x,p.y,p.z)),V()).multiplyScalar(1/points.length);
 const radius=points.reduce((s,p)=>s+Math.hypot(p.x-center.x,p.z-center.z),0)/points.length;
 const variance=points.reduce((s,p)=>s+Math.abs(Math.hypot(p.x-center.x,p.z-center.z)-radius),0)/points.length;
 const gap=new THREE.Vector3(...Object.values(points[0])).distanceTo(new THREE.Vector3(...Object.values(points[points.length-1])));
 const heights=points.map(p=>p.y);
 if(radius<.12||radius>1.2||variance/radius>.25||gap>radius*.5||Math.max(...heights)-Math.min(...heights)>.08||center.y>.2){state.notice='Rune rejected: draw a closed floor circle';return;}
 // Require coverage around the entire circle, not a small curved scribble.
 const bins=new Set(points.map(p=>Math.floor((Math.atan2(p.z-center.z,p.x-center.x)+Math.PI)/(2*Math.PI)*12)%12));
 if(bins.size<11){state.notice='Circle not complete';return;}
 addRune(vec(center));send('rune',{p:vec(center)});state.notice='Trap ready — make noise beyond the circle';
}
function addRune(p){
 if(state.runes.length>=12||state.runes.some(r=>new THREE.Vector3(r.p.x,r.p.y,r.p.z).distanceTo(new THREE.Vector3(p.x,p.y,p.z))<.15))return;
 const mesh=new THREE.Mesh(new THREE.RingGeometry(.25,.27,32),new THREE.MeshBasicMaterial({color:0x70bd9e,side:THREE.DoubleSide}));
 mesh.rotation.x=-Math.PI/2;mesh.position.set(p.x,p.y+.01,p.z);scene.object3D.add(mesh);state.runes.push({p,mesh,spent:false});
}
function hostUpdate(t,seconds){
 if(monster.state==='banished'){if(t>monster.until){monster.state='patrol';monster.x=4;monster.z=-11;}return;}
 const candidates=[{id:own(),p:vec(headPosition())},...[...state.players].filter(([id,p])=>t-p.time<3000).map(([id,p])=>({id,p:p.p}))];
 if(!monster.target){const p=candidates[0];monster.target={id:p.id,p:{x:0,y:1.6,z:-5}};}
 const target=monster.target.p;
 const dx=target.x-monster.x,dz=target.z-monster.z,d=Math.hypot(dx,dz);
 if(monster.state==='investigate'&&d<1.3)monster.state='stalk';
 if(monster.state==='stalk'&&d<.38){monster.state='lunge';monster.until=t+900;}
 const speed=monster.state==='lunge'?2.5:monster.state==='stalk'?.28:.55;
 if(d>.25){monster.x+=dx/d*speed*seconds;monster.z+=dz/d*speed*seconds;}
 if(monster.state==='lunge'&&t>monster.until){monster.state='patrol';monster.target=null;}
 if(monster.state==='investigate'&&t>monster.until){monster.state='patrol';monster.target=null;}
 for(const r of state.runes){
  if(!r.spent&&Math.hypot(monster.x-r.p.x,monster.z-r.p.z)<.4){r.spent=true;monster.state='banished';monster.until=t+12000;monster.x=4;monster.z=-12;state.banished=true;}
 }
}
function update(t,seconds){
 if(!head)return;
 if(audioContext&&audioContext.state==='suspended')audioContext.resume().catch(()=>{});
 if(analyser&&!state.muted){
  analyser.getFloatTimeDomainData(state.audioSamples);
  const rms=Math.sqrt(state.audioSamples.reduce((s,v)=>s+v*v,0)/state.audioSamples.length);
  state.micDb=Math.max(-80,20*Math.log10(Math.max(rms,.00001)));
  if(state.micDb>Number($('threshold').value)&&t-state.noiseAt>800){manualNoise();state.noiseAt=t;}
 }
 if(!state.dead&&!state.won){
  const direction=new THREE.Vector3(0,0,-1).applyQuaternion(head.object3D.getWorldQuaternion(new THREE.Quaternion()));direction.y=0;direction.normalize();
  const sideways=new THREE.Vector3(-direction.z,0,direction.x);
  const forward=(keys.KeyW?1:0)-(keys.KeyS?1:0)-stickMove.y;
  const side=(keys.KeyD?1:0)-(keys.KeyA?1:0)+stickMove.x;
  const move=direction.multiplyScalar(forward).addScaledVector(sideways,side);if(move.length()>1)move.normalize();
  rig.object3D.position.addScaledVector(move,seconds*1.25);
  // Boundary clamp only; furniture collision/navigation remains future work.
  rig.object3D.position.x=THREE.MathUtils.clamp(rig.object3D.position.x,-5.5,5.5);
  rig.object3D.position.z=THREE.MathUtils.clamp(rig.object3D.position.z,-14.2,4.5);
 }
 state.spy=desktopSpy||(scene.is('vr-mode')&&left.object3D.getWorldPosition(V()).distanceTo(headPosition())<.23);
 mask.visible=state.spy;
 chalk(t);
 if(t-poseClock>100){const p=vec(headPosition());send('pose',{p,db:state.micDb});poseClock=t;}
 if(state.connected&&isHost()){
  hostUpdate(t,seconds);
  if(t-hostClock>100){send('world',{m:monster,b:state.banished});hostClock=t;}
 }
 echo.object3D.position.set(monster.x,0,monster.z);
 const p=headPosition();echo.object3D.lookAt(p.x,0,p.z);
 const face=echoHead.object3D.getWorldPosition(V());
 const near=face.distanceTo(p)<.5;
 echo.object3D.visible=monster.state!=='banished'&&(near||state.spy);
 if(near&&t-baitClock>8000){playBait();baitClock=t;}
 if(state.banished){exit.querySelector('a-plane').setAttribute('color','#398e60');exit.querySelector('[text]').setAttribute('text','value','EXIT - OPEN');if(p.z<-13&&Math.abs(p.x)<1)state.won=true;}
 if(monster.state==='lunge'&&Math.hypot(p.x-monster.x,p.z-monster.z)<.28)state.dead=true;
 if(state.dead||state.won){draw=false;endStroke();mask.visible=false;echo.object3D.visible=false;}
 $('hud').textContent=`ECHO WARD | ${state.code} | ${state.connected?'connected':'connecting'} | ${state.peers.size+1} players\nChalk ${Math.max(0,state.ink).toFixed(1)}m | Mic ${state.muted?'MUTED':Math.round(state.micDb)+' dBFS'}\n${state.won?'ESCAPED — reload to play again':state.dead?'THE ECHO FOUND YOU — reload to retry':state.notice||'Draw a closed floor circle. X / N to lure.'}`;
}
function stopCapture(){
 clearInterval(recordTimer);recordTimer=null;
 if(recorder&&recorder.state==='recording')recorder.stop();
 if(captureStream)captureStream.getTracks().forEach(t=>t.stop());
 chunks=[];if(state.baitURL)URL.revokeObjectURL(state.baitURL);state.baitURL=null;
 if(baitAudio)baitAudio.pause();if(audioContext)audioContext.close();
}
window.addEventListener('pagehide',stopCapture);
document.addEventListener('visibilitychange',()=>{
 if(document.hidden&&state.joined){draw=false;endStroke();if(!state.muted)toggleMic();}
});
document.body.addEventListener('connected',()=>{
 state.connected=true;
 // Remote template contains its own positional audio receiver.
 send('snapshot-request',{});
});
document.body.addEventListener('clientConnected',e=>{
 state.peers.add(e.detail.clientId);
 // Re-send a bounded snapshot after the new data channel is available.
 setTimeout(()=>{if(isHost()){for(const [id,s] of state.strokes)send('chalk',{id,points:s.points});for(const r of state.runes)send('rune',{p:r.p});}},1500);
});
document.body.addEventListener('clientDisconnected',e=>{state.peers.delete(e.detail.clientId);state.players.delete(e.detail.clientId);});
buildScene();
function ready(){
 setupScene();
 NAF.schemas.add({template:'#avatar-template',components:[
  'position','rotation',{component:'echo-info',property:'name'},
  {selector:'.head',component:'position'},{selector:'.head',component:'rotation'},
  {selector:'.left',component:'position'},{selector:'.left',component:'rotation'},
  {selector:'.right',component:'position'},{selector:'.right',component:'rotation'}
 ]});
 // Positional remote voice must live inside the networked template.
 document.querySelector('#avatar-template').content.firstElementChild.setAttribute('networked-audio-source','');
 $('create').onclick=()=>join(true);$('join').onclick=()=>join(false);
 $('threshold').oninput=()=>$('thresholdValue').textContent=$('threshold').value;
 try{for(const r of JSON.parse(localStorage.getItem('echoRooms')||'[]')){const b=document.createElement('button');b.textContent=r.code+' — '+r.name;b.onclick=()=>$('code').value=r.code;$('saved').appendChild(b);}}catch(e){console.warn(e);}
 message('Ready. Create a room or enter a four-letter code.');
}
if(scene.hasLoaded)ready();else scene.addEventListener('loaded',ready,{once:true});
})();
