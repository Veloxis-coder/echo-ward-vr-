/* ECHO WARD v0.3 — complete replacement game.js
Requires index.html/config.js in this bundle. No old patch is needed.
Original prototype code: MIT. Dependencies keep their own licenses.
*/
(()=>{'use strict';
if(window.__echoWardV3)return;window.__echoWardV3=true;
const $=id=>document.getElementById(id),T=AFRAME.THREE,V=()=>new T.Vector3();
const server=(window.ECHO_CONFIG?.signalingURL||location.origin).replace(/\/$/,'');
const S={started:false,mode:'solo',connected:false,room:'SOLO',peers:new Set(),players:new Map(),ink:8,dead:false,won:false,unlocked:false,muted:false,db:-80,notice:'Draw a closed floor circle. A submits it. X lures The Echo.',strokes:new Map(),runes:[],candidate:[],broken:false,active:null,seq:0};
let scene,rig,head,left,right,echo,face,mask,vrHUD,diagnostic='Enter VR to detect controllers';
let monster={x:0,y:0,z:-9,state:'patrol',timer:0,target:null};
let held=false,spyKey=false,snapReady=true,keys={},inputStates=new Map(),stick={x:0,y:0};
let lastPoint,lastDrawTime=0,lastPose=0,lastWorld=0,lastNoise=0,lastBait=0,lastHUD=0;
let context,stream,analyser,samples,recorder,recordTimer,baitURL,baitAudio,generation=0;
const avatars=new Map(),obstacles=[{x:-3,z:-5,w:1.6,d:1},{x:3,z:-9,w:1.6,d:1}];
const position=()=>head.object3D.getWorldPosition(V());
const plain=p=>({x:p.x,y:p.y,z:p.z});
const valid=p=>p&&['x','y','z'].every(k=>Number.isFinite(p[k])&&Math.abs(p[k])<100);
const host=()=>[window.NAF?.clientId,...S.peers].filter(Boolean).sort()[0];
const authority=()=>S.mode==='solo'||(S.connected&&host()===NAF.clientId);
const send=(name,data)=>{if(S.connected)NAF.connection.broadcastDataGuaranteed('ew3-'+name,data);};
const status=text=>{if($('status'))$('status').textContent=text;};
function entity(tag,attrs,parent=scene){const el=document.createElement(tag);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,v);parent.appendChild(el);return el;}
function material(c){return new T.MeshStandardMaterial({color:c,roughness:.9});}
const cloth=material(0x354342),skin=material(0xb18d76),boots=material(0x151a1b);
const ball=new T.SphereGeometry(1,12,8),cylinder=new T.CylinderGeometry(1,1,1,10);
function mesh(geometry,mat,parent){const m=new T.Mesh(geometry,mat);parent.add(m);return m;}
function segment(a,b,r,m){const d=b.clone().sub(a);m.position.copy(a).add(b).multiplyScalar(.5);m.scale.set(r,d.length(),r);if(d.lengthSq()>.00001)m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());}
function makeBody(root){
 const group=new T.Group();scene.object3D.add(group);
 const b={root,group,torso:mesh(ball,cloth,group),hips:mesh(ball,cloth,group),skull:mesh(ball,skin,group),neck:mesh(cylinder,skin,group),last:null,phase:0};
 b.arms=[0,1].map(()=>({upper:mesh(cylinder,cloth,group),lower:mesh(cylinder,skin,group),hand:mesh(ball,skin,group)}));
 b.legs=[0,1].map(()=>({upper:mesh(cylinder,cloth,group),lower:mesh(cylinder,cloth,group),foot:mesh(ball,boots,group)}));
 b.skull.scale.set(.095,.125,.105);avatars.set(root,b);return b;
}
function updateBody(b,dt){
 const h=b.root.querySelector('.head'),l=b.root.querySelector('.left'),r=b.root.querySelector('.right');if(!h||!l||!r)return;
 const p=h.object3D.getWorldPosition(V()),q=h.object3D.getWorldQuaternion(new T.Quaternion()),local=b.root===rig;
 const f=new T.Vector3(0,0,-1).applyQuaternion(q);f.y=0;if(f.lengthSq()<.001)f.set(0,0,-1);f.normalize();
 const side=new T.Vector3(-f.z,0,f.x),floor=b.root.object3D.getWorldPosition(V()).y;
 const height=T.MathUtils.clamp(p.y-floor,.8,2.2),yaw=Math.atan2(-f.x,-f.z);
 const hips=new T.Vector3(p.x,floor+height*.49,p.z).addScaledVector(f,-.045);
 const chest=new T.Vector3(p.x,p.y-.34,p.z).addScaledVector(f,-.025);
 b.torso.position.copy(chest);b.torso.rotation.set(0,yaw,0);b.torso.scale.set(.20,Math.max(.13,height*.17),.12);
 b.hips.position.copy(hips);b.hips.rotation.set(0,yaw,0);b.hips.scale.set(.17,.13,.115);
 b.skull.position.copy(p);b.skull.quaternion.copy(q);b.skull.visible=!local;
 segment(chest.clone().add(new T.Vector3(0,.18,0)),p.clone().add(new T.Vector3(0,-.1,0)),.045,b.neck);b.neck.visible=!local;
 [l,r].forEach((hand,i)=>{
  const sign=i?1:-1,wrist=hand.object3D.getWorldPosition(V());
  const shoulder=chest.clone().add(new T.Vector3(0,.14,0)).addScaledVector(side,sign*.21);
  const delta=wrist.clone().sub(shoulder),dist=Math.min(.619,Math.max(.01,delta.length())),axis=delta.normalize();
  let bend=side.clone().multiplyScalar(sign*.6).addScaledVector(f,-.5).add(new T.Vector3(0,-1,0));bend.addScaledVector(axis,-bend.dot(axis)).normalize();
  const elbow=shoulder.clone().addScaledVector(axis,dist*.5).addScaledVector(bend,Math.sqrt(Math.max(0,.31*.31-dist*dist*.25)));
  const a=b.arms[i];segment(shoulder,elbow,.055,a.upper);segment(elbow,wrist,.039,a.lower);
  a.hand.position.copy(wrist);a.hand.quaternion.copy(hand.object3D.getWorldQuaternion(new T.Quaternion()));a.hand.scale.set(.04,.035,.075);
 });
 const speed=b.last?Math.hypot(p.x-b.last.x,p.z-b.last.z)/Math.max(.001,dt):0;b.last=p.clone();if(speed>.08)b.phase+=Math.min(speed,2)*dt*6;
 b.legs.forEach((leg,i)=>{
  const stride=speed>.08?Math.sin(b.phase+i*Math.PI)*.15:0;
  const hip=hips.clone().addScaledVector(side,i?.1:-.1);
  const foot=new T.Vector3(p.x,floor+.06,p.z).addScaledVector(side,i?.105:-.105).addScaledVector(f,stride);
  const knee=hip.clone().lerp(foot,.5).addScaledVector(f,.065+Math.abs(stride)*.2);
  segment(hip,knee,.065,leg.upper);segment(knee,foot,.05,leg.lower);leg.foot.position.copy(foot).addScaledVector(f,.04);leg.foot.rotation.set(0,yaw,0);leg.foot.scale.set(.06,.05,.13);
 });
}
AFRAME.registerComponent('echo-v3-loop',{tick(time,ms){if(S.started&&head)update(time,Math.min(.05,ms/1000));}});
AFRAME.registerComponent('echo-info',{schema:{name:{default:'Wanderer'}},update(){const label=this.el.querySelector('.label');if(label)label.setAttribute('text',{value:this.data.name.slice(0,20),align:'center',width:2,color:'#b7dcc5'});}});
function build(){
 scene=entity('a-scene',{'echo-v3-loop':'',renderer:'antialias:false;colorManagement:true',background:'color:#050a0d',fog:'type:exponential;color:#050a0d;density:.04'},document.body);
 const assets=entity('a-assets',{});const template=document.createElement('template');template.id='avatar-template';
 template.innerHTML='<a-entity networked-audio-source><a-entity class="head"><a-entity class="label" position="0 .32 0"></a-entity></a-entity><a-entity class="left"></a-entity><a-entity class="right"></a-entity></a-entity>';assets.appendChild(template);
 entity('a-entity',{light:'type:ambient;intensity:.55;color:#b5c7c4'});
 entity('a-plane',{class:'surface',rotation:'-90 0 0',width:12,height:20,position:'0 0 -5',color:'#283537'});
 entity('a-plane',{rotation:'90 0 0',width:12,height:20,position:'0 3 -5',color:'#10191b'});
 for(const x of[-6,6])entity('a-box',{class:'surface',position:`${x} 1.5 -5`,width:.2,height:3,depth:20,color:'#354446'});
 for(const z of[-15,5])entity('a-box',{class:'surface',position:`0 1.5 ${z}`,width:12,height:3,depth:.2,color:'#354446'});
 for(const o of obstacles)entity('a-box',{class:'surface',position:`${o.x} .4 ${o.z}`,width:o.w,height:.8,depth:o.d,color:'#4b5550'});
 // Low-cost wall tile seams instead of image downloads.
 for(let z=-14;z<=4;z+=2)for(const x of[-5.88,5.88])entity('a-box',{position:`${x} 1.5 ${z}`,width:.012,height:3,depth:.018,color:'#152226'});
 entity('a-plane',{id:'exit-door',position:'0 1.1 -14.85',width:1.4,height:2.2,color:'#16412d'});
 entity('a-entity',{id:'exit-label',position:'0 2.5 -14.7',text:'value:ECHO WARD - EXIT SEALED;align:center;width:5;color:#b1d2ba'});
 rig=entity('a-entity',{id:'rig','echo-info':'name:Wanderer'});
 head=entity('a-entity',{id:'head',class:'head',camera:'',position:'0 1.6 0','look-controls':'pointerLockEnabled:false'},rig);
 entity('a-entity',{position:'0 0 -1',geometry:'primitive:ring;radiusInner:.003;radiusOuter:.004',material:'shader:flat;color:#b7d7c3'},head);
 vrHUD=entity('a-entity',{position:'0 .23 -.95',text:'value:ECHO WARD;align:center;width:1.05;wrapCount:62;color:#a8d8bd'},head);
 left=entity('a-entity',{id:'left',class:'left',position:'-.25 1.2 -.35','oculus-touch-controls':'hand:left;model:false'},rig);
 right=entity('a-entity',{id:'right',class:'right',position:'.25 1.2 -.35','oculus-touch-controls':'hand:right;model:false'},rig);
 entity('a-cylinder',{radius:.025,height:.14,rotation:'90 0 0',color:'#687b6d'},left);
 entity('a-cylinder',{id:'chalk-stick',radius:.008,height:.07,rotation:'90 0 0',color:'#ede5c9'},right);
 echo=entity('a-entity',{id:'echo',position:'0 0 -9'});
 entity('a-cone',{position:'0 1.05 0','radius-bottom':.13,'radius-top':.24,height:1.05,color:'#392e2a'},echo);
 face=entity('a-sphere',{position:'0 1.95 0',radius:.16,scale:'.8 1.2 .9',color:'#b8af97'},echo);
 entity('a-box',{position:'0 1.79 .1',width:.12,height:.13,depth:.08,color:'#160e0e'},echo);
 for(const x of[-.3,.3])entity('a-cylinder',{position:`${x} .8 0`,radius:.035,height:1.5,color:'#493b33'},echo);
 for(const x of[-.1,.1])entity('a-cylinder',{position:`${x} .35 0`,radius:.045,height:.7,color:'#302724'},echo);
 const ready=()=>{
  echo.object3D.visible=false;
  const shape=new T.Shape();shape.moveTo(-20,-20);shape.lineTo(20,-20);shape.lineTo(20,20);shape.lineTo(-20,20);shape.closePath();const hole=new T.Path();hole.absarc(0,0,.19,0,Math.PI*2,true);shape.holes.push(hole);
  mask=mesh(new T.ShapeGeometry(shape),new T.MeshBasicMaterial({color:0,side:T.DoubleSide,depthTest:false,depthWrite:false,fog:false}),head.object3D);mask.position.z=-1;mask.renderOrder=900;mask.visible=false;
  $('solo').onclick=()=>start('solo');$('create').onclick=()=>join(true);$('join').onclick=()=>join(false);
  $('threshold').oninput=()=>$('level').textContent=$('threshold').value+' dBFS';status('Ready. Test solo first; multiplayer needs your configured Node server.');
 };
 scene.addEventListener('exit-vr',()=>{held=false;spyKey=false;stick={x:0,y:0};inputStates.clear();endStroke();});
 if(scene.hasLoaded)ready();else scene.addEventListener('loaded',ready,{once:true});
}
function start(mode){
 if(S.started)return;S.mode=mode;S.started=true;$('menu').style.display='none';
 if(!context)context=new(window.AudioContext||window.webkitAudioContext)();context.resume().catch(()=>{});
 if(mode==='solo'&&$('mic').checked)navigator.mediaDevices.getUserMedia({audio:true,video:false}).then(s=>setupAudio(s)).catch(()=>{S.notice='Microphone denied. X / N still works.';});
}
function updatePose(source,el){
 const frame=scene.frame,reference=scene.renderer.xr.getReferenceSpace();if(!frame||!reference)return;
 try{const p=frame.getPose(source.gripSpace||source.targetRaySpace,reference);if(p){const a=p.transform.position,q=p.transform.orientation;el.object3D.position.set(a.x,a.y,a.z);el.object3D.quaternion.set(q.x,q.y,q.z,q.w);}}catch{}
}
function pollInput(){
 const session=scene.renderer.xr.getSession();stick={x:0,y:0};
 if(!session){inputStates.clear();diagnostic='Desktop mode — use VR button for Quest controllers';return;}
 const lines=[];
 for(const handedness of['left','right']){
  const source=[...session.inputSources].find(s=>s.handedness===handedness&&s.gamepad);
  if(!source){if(handedness==='right'){held=false;endStroke();}inputStates.delete(handedness);lines.push(handedness+': no controller');continue;}
  updatePose(source,handedness==='left'?left:right);
  const pad=source.gamepad,old=inputStates.get(handedness)||{};
  if(pad.mapping!=='xr-standard'){lines.push(handedness+': unsupported mapping '+pad.mapping);continue;}
  const x=pad.axes.length>=4?pad.axes[2]:(pad.axes[0]||0),y=pad.axes.length>=4?pad.axes[3]:(pad.axes[1]||0);
  const trigger=(pad.buttons[0]?.value||0)>.55,a=!!pad.buttons[4]?.pressed,b=!!pad.buttons[5]?.pressed;
  if(handedness==='left'){
   stick={x:Math.abs(x)>.15?x:0,y:Math.abs(y)>.15?y:0};
   if(a&&!old.a)makeNoise();if(b&&!old.b)toggleMic();
  }else{
   held=trigger;if(!trigger&&old.trigger)endStroke();if(a&&!old.a)submitRune();
   if(Math.abs(x)<.3)snapReady=true;if(Math.abs(x)>.75&&snapReady){turn(-Math.sign(x)*Math.PI/6);snapReady=false;}
  }
  inputStates.set(handedness,{trigger,a,b});lines.push(`${handedness}: stick ${x.toFixed(1)},${y.toFixed(1)} trigger ${trigger?'ON':'off'}`);
 }
 diagnostic=lines.join('\n');
}
function turn(angle){const before=position();rig.object3D.rotation.y+=angle;const after=position();rig.object3D.position.x+=before.x-after.x;rig.object3D.position.z+=before.z-after.z;}
function collision(x,z){return x< -5.5||x>5.5||z< -14.2||z>4.5||obstacles.some(o=>Math.abs(x-o.x)<o.w/2+.22&&Math.abs(z-o.z)<o.d/2+.22);}
function move(dt){
 const forward=new T.Vector3(0,0,-1).applyQuaternion(head.object3D.getWorldQuaternion(new T.Quaternion()));forward.y=0;forward.normalize();const side=new T.Vector3(-forward.z,0,forward.x);
 const f=(keys.KeyW?1:0)-(keys.KeyS?1:0)-stick.y,s=(keys.KeyD?1:0)-(keys.KeyA?1:0)+stick.x;
 forward.multiplyScalar(f).addScaledVector(side,s);if(forward.length()>1)forward.normalize();forward.multiplyScalar(dt*1.25);
 const p=rig.object3D.position,h=position();if(!collision(h.x+forward.x,h.z))p.x+=forward.x;const n=position();if(!collision(n.x,n.z+forward.z))p.z+=forward.z;
}
function drawLine(d){
 if(!Array.isArray(d.points)||!d.points.length||d.points.length>150||!d.points.every(valid))return;
 const old=S.strokes.get(d.id);if(!old&&S.strokes.size>=80)return;
 if(old){scene.object3D.remove(old.mesh);old.mesh.geometry.dispose();old.mesh.material.dispose();}
 const m=new T.Line(new T.BufferGeometry().setFromPoints(d.points.map(p=>new T.Vector3(p.x,p.y,p.z))),new T.LineBasicMaterial({color:0xe9e2ca}));scene.object3D.add(m);S.strokes.set(d.id,{points:d.points.map(p=>({...p})),mesh:m});
}
function flush(){if(S.active)send('stroke',{id:S.active.id,points:S.active.points});}
function endStroke(){flush();S.active=null;lastPoint=null;}
function chalk(time){
 if(!held||S.ink<=0||S.dead||S.won){endStroke();return;}
 const vr=scene.is('vr-mode'),source=vr?right:head;
 const ray=new T.Raycaster(source.object3D.getWorldPosition(V()),new T.Vector3(0,0,-1).applyQuaternion(source.object3D.getWorldQuaternion(new T.Quaternion())),0,vr?.22:3);
 const hit=ray.intersectObjects([...scene.querySelectorAll('.surface')].map(e=>e.object3D),true)[0];
 if(!hit){if(S.active)S.broken=true;endStroke();return;}
 const normal=hit.face.normal.clone().transformDirection(hit.object.matrixWorld),p=hit.point.clone().addScaledVector(normal,.003);
 if(lastPoint){const distance=p.distanceTo(lastPoint),elapsed=Math.max(.001,(time-lastDrawTime)/1000);if(distance/elapsed>1.1){S.broken=true;endStroke();S.notice='Chalk broke — draw more slowly.';return;}if(distance<.01)return;S.ink=Math.max(0,S.ink-distance);}
 if(S.candidate.reduce((n,s)=>n+s.length,0)>=1200){S.broken=true;endStroke();return;}
 const tangent=new T.Vector3(1,0,0).projectOnPlane(normal).normalize();p.addScaledVector(tangent,T.MathUtils.clamp((S.db+45)/30,0,1)*.006*Math.sin(time*.035));
 if(!S.active){if(S.strokes.size>=80){S.notice='Stroke limit reached.';return;}const points=[];S.active={id:(window.NAF?.clientId||'solo')+':'+(++S.seq),points,sent:0};S.candidate.push(points);}
 S.active.points.push(plain(p));drawLine(S.active);if(time-S.active.sent>100){flush();S.active.sent=time;}lastPoint=p;lastDrawTime=time;
 if(S.active.points.length>=140)endStroke();$('chalk-stick').object3D.scale.y=Math.max(.05,S.ink/8);
}
function submitRune(){
 endStroke();const points=S.candidate.flat(),broken=S.broken;S.candidate=[];S.broken=false;
 if(broken||points.length<16){S.notice='Rune rejected: broken or incomplete.';return;}
 const p=points.reduce((a,b)=>a.add(new T.Vector3(b.x,b.y,b.z)),V()).multiplyScalar(1/points.length),radii=points.map(a=>Math.hypot(a.x-p.x,a.z-p.z));
 const radius=radii.reduce((a,b)=>a+b,0)/radii.length,deviation=radii.reduce((n,r)=>n+Math.abs(r-radius),0)/radii.length;
 const first=points[0],last=points.at(-1),gap=Math.hypot(first.x-last.x,first.y-last.y,first.z-last.z),ys=points.map(a=>a.y);
 const bins=new Set(points.map(a=>Math.floor((Math.atan2(a.z-p.z,a.x-p.x)+Math.PI)/(2*Math.PI)*12)%12));
 if(radius<.12||radius>1.2||deviation/radius>.25||gap>radius*.5||Math.max(...ys)-Math.min(...ys)>.08||p.y>.2||bins.size<11){S.notice='Draw a closed, round loop on the floor.';return;}
 addRune(plain(p),radius);send('rune',{p:plain(p),radius});S.notice='Trap ready! Stand beyond it and make noise with X / N.';
}
function addRune(p,radius){
 if(!valid(p)||!Number.isFinite(radius)||S.runes.length>=12||S.runes.some(r=>Math.hypot(r.p.x-p.x,r.p.z-p.z)<.15))return;
 radius=T.MathUtils.clamp(radius,.12,1.2);const m=mesh(new T.RingGeometry(radius*.95,radius,48),new T.MeshBasicMaterial({color:0x87d5aa,side:T.DoubleSide}),scene.object3D);m.rotation.x=-Math.PI/2;m.position.set(p.x,p.y+.012,p.z);S.runes.push({p,radius,spent:false,mesh:m});
}
function makeNoise(){
 if(S.dead||S.won)return;context?.resume().catch(()=>{});const p=plain(position());send('noise',{p});if(authority())hear(window.NAF?.clientId||'solo',p);
}
function hear(id,p){if(monster.state==='banished')return;monster.target={id,p:plain(p)};monster.state=Math.hypot(p.x-monster.x,p.z-monster.z)<.65?'lunge':'investigate';monster.timer=monster.state==='lunge'?1.2:8;}
function ai(dt){
 monster.timer=Math.max(0,monster.timer-dt);
 if(monster.state==='banished'){if(!monster.timer){monster.state='patrol';monster.target=null;}return;}
 if(!monster.target)monster.target={id:null,p:{x:0,y:1.6,z:-5}};
 const target=monster.target.p,dx=target.x-monster.x,dz=target.z-monster.z,d=Math.hypot(dx,dz);
 if(monster.state==='investigate'&&d<1.2)monster.state='stalk';
 if(monster.state==='stalk'){
  const mine=monster.target.id===(window.NAF?.clientId||'solo'),live=mine?{p:plain(position())}:S.players.get(monster.target.id);
  if(live&&Math.hypot(live.p.x-target.x,live.p.z-target.z)>.35&&d<.8){monster.target.p=plain(live.p);monster.state='lunge';monster.timer=1.2;}
 }
 const speed=monster.state==='lunge'?2.5:monster.state==='stalk'?.28:.45,stop=monster.state==='stalk'?.38:.25;
 if(d>stop){monster.x+=dx/d*speed*dt;monster.z+=dz/d*speed*dt;}
 if((monster.state==='investigate'||monster.state==='lunge')&&!monster.timer){monster.state='patrol';monster.target=null;}
 for(const r of S.runes)if(!r.spent&&Math.hypot(monster.x-r.p.x,monster.z-r.p.z)<r.radius){r.spent=true;monster.state='banished';monster.timer=12;monster.x=4;monster.z=-12;monster.target=null;S.unlocked=true;break;}
}
async function setupAudio(s){
 stream=s;const source=context.createMediaStreamSource(stream);analyser=context.createAnalyser();analyser.fftSize=1024;samples=new Float32Array(analyser.fftSize);source.connect(analyser);
 if($('theft').checked&&window.MediaRecorder)recordTimer=setInterval(recordVoice,4000);
}
function recordVoice(){
 if(S.muted||document.hidden||!stream||recorder?.state==='recording')return;const token=generation,chunks=[];
 try{const current=new MediaRecorder(stream);recorder=current;current.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};current.onstop=()=>{if(token!==generation||S.muted||!chunks.length)return;if(baitURL)URL.revokeObjectURL(baitURL);baitURL=URL.createObjectURL(new Blob(chunks,{type:current.mimeType}));};current.start();setTimeout(()=>{if(current.state==='recording')current.stop();},3000);}catch{}
}
function clearBait(){generation++;if(recorder?.state==='recording')recorder.stop();baitAudio?.pause();if(baitURL)URL.revokeObjectURL(baitURL);baitURL=null;}
function toggleMic(){S.muted=!S.muted;if(S.mode==='multiplayer'&&S.connected)NAF.connection.adapter.enableMicrophone(!S.muted);else stream?.getAudioTracks().forEach(t=>t.enabled=!S.muted);if(S.muted){S.db=-80;clearBait();}}
function playBait(){if(!baitURL||S.muted)return;baitAudio?.pause();baitAudio=new Audio(baitURL);baitAudio.playbackRate=.78;baitAudio.volume=.45;baitAudio.play().catch(()=>{});}
function load(url){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=url;s.onload=resolve;s.onerror=()=>reject(Error('Could not load '+url));document.head.appendChild(s);});}
let joining=false;
async function join(create){
 if(joining||S.started)return;joining=true;status('Connecting to room service…');
 try{
  const wanted=$('code').value.trim().toUpperCase();if(!create&&!/^[A-Z]{4}$/.test(wanted))throw Error('Enter a four-letter room code.');
  const response=await fetch(server+'/api/rooms'+(create?'':'/'+wanted),{method:create?'POST':'GET',signal:AbortSignal.timeout(15000)}),data=await response.json();if(!response.ok)throw Error(data.error||'Room server error');if(!/^[A-Z]{4}$/.test(data.code))throw Error('Invalid room response');
  if(!window.NAF){await load(server+'/socket.io/socket.io.js');await load(server+'/easyrtc/easyrtc.js');await load('https://unpkg.com/networked-aframe@0.12.2/dist/networked-aframe.min.js');}
  NAF.schemas.add({template:'#avatar-template',components:['position','rotation',{component:'echo-info',property:'name'},...['.head','.left','.right'].flatMap(selector=>[{selector,component:'position'},{selector,component:'rotation'}])]});
  channels();S.room=data.code;
  rig.setAttribute('echo-info',{name:($('name').value||'Wanderer').replace(/[^a-z0-9 _-]/gi,'').slice(0,20)});
  rig.setAttribute('networked','template:#avatar-template;attachTemplateToLocal:false');
  start('multiplayer');
  scene.setAttribute('networked-scene',{serverURL:server,app:'echo-ward',room:'ward-'+S.room,adapter:'easyrtc',audio:$('mic').checked,video:false,debug:false});
  S.notice='Connecting multiplayer. Controls work locally while connecting.';
 }catch(e){status(e.message+' You can still use Play solo.');}finally{joining=false;}
}
function snapshot(){for(const[id,s]of S.strokes)send('stroke',{id,points:s.points});for(const r of S.runes)send('rune',{p:r.p,radius:r.radius});send('world',{m:monster,unlocked:S.unlocked});}
function channels(){
 NAF.connection.subscribeToDataChannel('ew3-pose',(id,type,d)=>{if(valid(d?.p))S.players.set(id,{p:d.p});});
 NAF.connection.subscribeToDataChannel('ew3-noise',(id,type,d)=>{if(authority()&&valid(d?.p))hear(id,d.p);});
 NAF.connection.subscribeToDataChannel('ew3-world',(id,type,d)=>{if(id===host()&&valid(d?.m)&&['patrol','investigate','stalk','lunge','banished'].includes(d.m.state)){monster={...d.m};S.unlocked=!!d.unlocked;}});
 NAF.connection.subscribeToDataChannel('ew3-stroke',(id,type,d)=>{if(d&&typeof d.id==='string'&&(d.id.startsWith(id+':')||id===host()))drawLine(d);});
 NAF.connection.subscribeToDataChannel('ew3-rune',(id,type,d)=>{if(d)addRune(d.p,d.radius);});
 NAF.connection.subscribeToDataChannel('ew3-snapshot',()=>{if(authority())snapshot();});
}
function update(time,dt){
 pollInput();if(!S.dead&&!S.won)move(dt);chalk(time);
 if(analyser&&!S.muted){analyser.getFloatTimeDomainData(samples);S.db=Math.max(-80,20*Math.log10(Math.max(.00001,Math.sqrt(samples.reduce((s,v)=>s+v*v,0)/samples.length))));if(S.db>Number($('threshold').value)&&time-lastNoise>800&&(!baitAudio||baitAudio.paused)){makeNoise();lastNoise=time;}}
 if(time-lastPose>100){send('pose',{p:plain(position())});lastPose=time;}
 if(authority()){ai(dt);if(time-lastWorld>100){send('world',{m:monster,unlocked:S.unlocked});lastWorld=time;}}
 echo.object3D.position.set(monster.x,0,monster.z);const p=position();echo.object3D.lookAt(p.x,0,p.z);
 const spy=spyKey||(scene.is('vr-mode')&&inputStates.has('left')&&left.object3D.getWorldPosition(V()).distanceTo(p)<.23),near=face.object3D.getWorldPosition(V()).distanceTo(p)<=.5;
 echo.object3D.visible=monster.state!=='banished'&&(near||spy)&&!S.dead&&!S.won;mask.visible=spy&&!S.dead&&!S.won;
 if(near&&time-lastBait>8000){playBait();lastBait=time;}
 if(monster.state==='lunge'&&Math.hypot(p.x-monster.x,p.z-monster.z)<.28)S.dead=true;
 if(S.unlocked){$('exit-door').setAttribute('color','#3b9865');$('exit-label').setAttribute('text','value','EXIT OPEN');if(p.z< -13&&Math.abs(p.x)<1)S.won=true;}
 if(S.dead||S.won){held=false;endStroke();mask.visible=false;echo.object3D.visible=false;}
 const roots=new Set([rig,...scene.querySelectorAll('[networked]')]);for(const root of roots)if(root.querySelector('.head'))updateBody(avatars.get(root)||makeBody(root),dt);
 for(const[root,b]of avatars)if(!root.isConnected){scene.object3D.remove(b.group);avatars.delete(root);}
 if(time-lastHUD>200){
  const network=S.mode==='solo'?'SOLO':S.connected?'NETWORK CONNECTED':'NETWORK CONNECTING / FAILED';
  const notice=S.won?'ESCAPED — reload to play again':S.dead?'THE ECHO FOUND YOU — reload to retry':S.notice;
  const text=`${S.room} | ${network}\n${diagnostic}\nChalk ${S.ink.toFixed(1)}m | Mic ${S.muted?'MUTED':Math.round(S.db)+' dBFS'}\n${notice}`;
  $('hud').textContent=text;vrHUD.setAttribute('text','value',text);lastHUD=time;
 }
}
document.body.addEventListener('connected',()=>{
 S.connected=true;S.notice='Connected. Draw a circle and lure The Echo.';setTimeout(()=>send('snapshot',{}),1500);
 if($('mic').checked)(async()=>{for(let i=0;i<60;i++){let s;try{s=easyrtc.getLocalStream();}catch{}if(s?.getAudioTracks().length){await setupAudio(s);return;}await new Promise(r=>setTimeout(r,250));}S.notice='Mic unavailable. X / N still works.';})();
});
document.body.addEventListener('clientConnected',e=>{if(e.detail?.clientId)S.peers.add(e.detail.clientId);setTimeout(()=>{if(authority())snapshot();},1500);});
document.body.addEventListener('clientDisconnected',e=>{S.peers.delete(e.detail?.clientId);S.players.delete(e.detail?.clientId);});
window.addEventListener('keydown',e=>{if(!S.started||/INPUT|TEXTAREA/.test(e.target.tagName))return;keys[e.code]=true;if(e.repeat)return;if(e.code==='KeyC')held=true;if(e.code==='KeyV')spyKey=true;if(e.code==='Enter')submitRune();if(e.code==='KeyN')makeNoise();if(e.code==='KeyM')toggleMic();if(e.code==='KeyR')location.reload();});
window.addEventListener('keyup',e=>{keys[e.code]=false;if(e.code==='KeyC'){held=false;endStroke();}if(e.code==='KeyV')spyKey=false;});
window.addEventListener('blur',()=>{keys={};held=false;spyKey=false;stick={x:0,y:0};endStroke();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&S.started){held=false;endStroke();clearBait();if(!S.muted)toggleMic();}});
window.addEventListener('pagehide',()=>{clearInterval(recordTimer);clearBait();stream?.getTracks().forEach(t=>t.stop());context?.close().catch(()=>{});});
build();
})();
