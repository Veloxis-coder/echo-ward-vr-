"use strict";
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const easyrtc = require('open-easyrtc');
const crypto = require('crypto');
const app = express();
const origins = (process.env.ALLOWED_ORIGINS || 'http://localhost:8080').split(',').map(s=>s.trim());
app.set('trust proxy', 1);
app.use((req,res,next)=>{
  const origin=req.headers.origin;
  if(origin && !origins.includes(origin)) return res.status(403).json({error:'Origin not allowed'});
  if(origin) res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({limit:'1kb'}));
const rooms=new Map(), limits=new Map();
app.use('/api',(req,res,next)=>{
  const now=Date.now(), key=req.ip;
  let item=limits.get(key);
  if(!item || now-item.start>60000) { item={start:now,n:0}; limits.set(key,item); }
  if(++item.n>40) return res.status(429).json({error:'Please wait before trying again'});
  next();
});
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ';
app.post('/api/rooms',(req,res)=>{
  let code;
  do {code=Array.from(crypto.randomBytes(4),n=>alphabet[n%alphabet.length]).join('');} while(rooms.has(code));
  rooms.set(code,Date.now()+6*60*60*1000);
  res.json({code});
});
app.get('/api/rooms/:code',(req,res)=>{
  const code=String(req.params.code).toUpperCase();
  if(!rooms.has(code) || rooms.get(code)<Date.now()) return res.status(404).json({error:'Room not found or expired'});
  res.json({code});
});
setInterval(()=>{
 const now=Date.now();
 for(const [k,v] of rooms) if(v<now) rooms.delete(k);
 for(const [k,v] of limits) if(now-v.start>60000) limits.delete(k);
},60000).unref();
app.get('/health',(_,res)=>res.json({ok:true}));
app.use(express.static(require('path').join(__dirname,'../docs')));
const server=http.createServer(app);
const io=socketIO(server,{origins:(origin,callback)=>callback(null, origins.includes(origin))});
let ice=[{urls:'stun:stun.l.google.com:19302'}];
if(process.env.ICE_SERVERS_JSON) ice=JSON.parse(process.env.ICE_SERVERS_JSON);
easyrtc.setOption('appIceServers',ice);
easyrtc.setOption('logLevel','warning');
easyrtc.listen(app,io,null,()=>console.log('EasyRTC signaling ready'));
server.listen(process.env.PORT||8080,'0.0.0.0',()=>console.log('HTTP server ready; use HTTPS in production'));
