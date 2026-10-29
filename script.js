/* ============ CONFIG ============ */
const W=6,H=10,T=60,WIN=3,TICK=40,MOVE=.17,STAND=3; // WIN = rodadas para vencer; STAND = segundos parado até o piso quebrar
const DX=[0,1,0,-1],DY=[-1,0,1,0];                 // 0 cima,1 direita,2 baixo,3 esquerda
const COL=[{c:'#00c2f2',l:'#6ee3ff'},{c:'#78c63c',l:'#a0ee6d'},{c:'#fcbb2f',l:'#ffdc84'},{c:'#ff6054',l:'#ff8a80'},{c:'#a463f2',l:'#c79bff'},{c:'#ff8a2b',l:'#ffb36b'}];
const SP=[[1,1,2],[4,1,2],[1,8,0],[4,8,0],[0,4,1],[5,5,3]]; // x,y,direção inicial
const $=id=>document.getElementById(id);
function show(id){document.querySelectorAll('.scr').forEach(e=>e.classList.toggle('on',e.id===id))}

/* ============ SIMULAÇÃO (roda no anfitrião / local) ============ */
// Piso: 0 inteiro, 1 rachado, 2 quase quebrando, 3 quebrado (sem piso)
const inb=(x,y)=>x>=0&&x<W&&y>=0&&y<H;
const occ=(s,x,y,i)=>s.p.some((q,j)=>q&&j!==i&&q.alive&&q.x===x&&q.y===y);
function resetRound(s){
  s.tile.fill(0);
  s.p.forEach((p,i)=>{if(!p)return;const [x,y,d]=SP[i];Object.assign(p,{x,y,d,alive:true,cool:0,hold:-1,want:-1,wt:0,stand:0,fl:0})});
  s.phase='count';s.cd=3;
}
function newState(slots){
  const s={tile:Array(W*H).fill(0),p:slots.map(sl=>sl&&{sc:0,bot:sl.bot}),phase:'count',cd:3,win:-1,rw:-1,rt:0,round:1};
  resetRound(s);return s;
}
function land(s,i){ // pisou: o piso avança um estágio; se já era o 3º, quebra e o jogador cai
  const p=s.p[i],k=p.y*W+p.x;p.stand=0;
  if(++s.tile[k]>=3){s.tile[k]=3;p.alive=false;p.fl=0}
}
function botAI(s,i){
  const p=s.p[i];let best=-1,bs=-1e9;
  for(let d=-1;d<4;d++){
    let sc=Math.random()*2;
    if(d<0)sc+=p.stand<1.2?2:-8-p.stand*3;
    else{
      const x=p.x+DX[d],y=p.y+DY[d];
      if(!inb(x,y)||occ(s,x,y,i))continue;
      sc+=[4,1.5,-12,-60][s.tile[y*W+x]];
      for(let e=0;e<4;e++){const a=x+DX[e],b=y+DY[e];if(inb(a,b)&&s.tile[b*W+a]<2)sc+=.6}
    }
    if(sc>bs){bs=sc;best=d}
  }
  if(best>=0){p.want=best;p.wt=.3}
}
function step(s,dt){
  if(s.phase==='over')return;
  if(s.phase==='count'){if((s.cd-=dt)<=0)s.phase='play';return}
  if(s.phase==='round'){if((s.rt-=dt)<=0){s.round++;resetRound(s)}return}
  s.p.forEach((p,i)=>{
    if(!p)return;
    if(!p.alive){p.fl+=dt;return}
    p.cool-=dt;if((p.wt-=dt)<=0)p.want=-1;
    if(p.bot&&p.cool<=0&&p.want<0&&Math.random()<.25)botAI(s,i);
    const d=p.want>=0?p.want:p.hold;
    if(d>=0&&p.cool<=0){
      p.d=d;p.want=-1;const x=p.x+DX[d],y=p.y+DY[d];
      if(inb(x,y)&&!occ(s,x,y,i)){p.x=x;p.y=y;p.cool=MOVE;land(s,i);return}
    }
    if((p.stand+=dt)>=STAND){s.tile[p.y*W+p.x]=3;p.alive=false;p.fl=0} // ficou parado 3s: piso quebra
  });
  const ps=s.p.filter(Boolean),al=ps.filter(p=>p.alive);
  if(al.length<=(ps.length>1?1:0)){
    s.phase='round';s.rt=2.6;s.rw=-1;
    if(al.length===1){const w=s.p.indexOf(al[0]);s.rw=w;al[0].sc++;if(al[0].sc>=WIN){s.phase='over';s.win=w}}
  }
}

/* ============ ESTADO DO APP ============ */
let mode='',s=null,me=0,hum=1,cfg=null,timer=null,lastTick=0,inGame=false;
let peer=null,conns=[],conn=null,started=false;
function begin(slots){cfg=slots;s=newState(slots);started=true;lastTick=performance.now();enterGame();clearInterval(timer);timer=setInterval(tick,TICK)}
function enterGame(){
  document.body.classList.toggle('two',mode==='local'&&hum>1);
  if(inGame){buildHud();return}
  inGame=true;buildHud();
  document.querySelectorAll('.scr').forEach(e=>e.classList.remove('on'));
  $('game').style.display='flex';resize();requestAnimationFrame(frame);
}
function tick(){
  const n=performance.now(),dt=Math.min(.1,(n-lastTick)/1000);lastTick=n;
  const ff=s.phase==='play'&&!s.p.some(p=>p&&p.alive&&!p.bot)?4:1; // só bots vivos: acelera
  for(let k=0;k<ff;k++)step(s,dt);
  updateHud();
  if(mode==='host')conns.forEach(c=>c.open&&c.send({t:'state',s}));
}
function again(){begin(cfg)}

/* ============ LOCAL ============ */
function startLocal(){
  const h=+$('lh').value,t=Math.max(h,+$('lt').value);
  mode='local';hum=h;me=0;
  begin(Array.from({length:6},(_,i)=>i<t?{bot:i>=h}:null));
}

/* ============ ONLINE (salas via PeerJS / WebRTC, qualquer aparelho) ============ */
const DEV=matchMedia('(pointer:coarse)').matches?'📱':'💻';
const ICE={config:{iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'},{urls:'stun:global.stun.twilio.com:3478'}]}};
let roomCode='';
const status=t=>$('st').textContent=t;
const mkCode=()=>Array.from({length:4},()=>'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random()*24|0]).join('');
function lobbyInit(code,isHost){
  roomCode=code;show('lobby');$('code').textContent=code;
  $('hostopts').style.display=$('startbtn').style.display=isHost?'':'none';
  $('waitmsg').textContent=isHost?'':'Aguardando o anfitrião começar…';
  lobbyRender(1,[DEV]);
}
function lobbyRender(n,devs=[]){
  $('plist').innerHTML=Array.from({length:6},(_,i)=>`<div class="pl ${i<n?'':'off'}" style="--c:${COL[i].c}"><i></i>${i<n?(devs[i]||'💻')+' J'+(i+1)+(i===me?' (você)':''):'vaga livre'}</div>`).join('');
}
function inviteLink(){return location.origin+location.pathname+'?sala='+roomCode}
async function copyInvite(){
  const u=inviteLink(),b=$('cpy');
  try{
    if(navigator.share&&matchMedia('(pointer:coarse)').matches){await navigator.share({title:'Broken Tails',text:'Entre na minha sala!',url:u});return}
    await navigator.clipboard.writeText(u);b.textContent='Link copiado!';setTimeout(()=>b.textContent='Copiar link de convite',1800);
  }catch(e){prompt('Copie o link:',u)}
}
function broadcastLobby(){
  const n=conns.length+1,devs=[DEV,...conns.map(c=>c.dev||'💻')];lobbyRender(n,devs);
  conns.forEach((c,k)=>c.open&&c.send({t:'lobby',n,you:k+1,devs}));
}
function hostRoom(){
  if(typeof Peer==='undefined')return status('Sem conexão com o servidor de salas.');
  mode='host';me=0;const code=mkCode();status('Criando sala…');
  peer=new Peer('bt-'+code,ICE);
  peer.on('open',()=>lobbyInit(code,true));
  peer.on('error',e=>{if(e.type==='unavailable-id'){peer.destroy();hostRoom()}else status('Erro: '+e.type)});
  peer.on('connection',c=>{
    if(started||conns.length>=5){c.on('open',()=>{c.send({t:'full'});setTimeout(()=>c.close(),400)});return}
    conns.push(c);
    c.on('open',broadcastLobby);
    c.on('data',m=>{
      if(m.t==='dir'){inp(conns.indexOf(c)+1,m.d)}
      else if(m.t==='hi'){c.dev=m.dev;broadcastLobby()}
    });
    c.on('close',()=>{
      if(!started){conns=conns.filter(x=>x!==c);broadcastLobby()}
      else{const i=conns.indexOf(c)+1;if(s&&s.p[i])s.p[i].bot=true}
    });
  });
}
function startOnline(){
  const n=conns.length+1,tot=Math.max(n,+$('ot').value);
  begin(Array.from({length:6},(_,i)=>i<n?{bot:false}:i<tot?{bot:true}:null));
}
function joinRoom(){
  const code=$('jc').value.trim().toUpperCase();
  if(code.length!==4)return status('Digite o código de 4 letras.');
  if(typeof Peer==='undefined')return status('Sem conexão com o servidor de salas.');
  mode='client';status('Entrando…');
  if(peer)peer.destroy();
  peer=new Peer(ICE);
  const fail=setTimeout(()=>status('Sala não encontrada ou sem conexão.'),10000);
  peer.on('open',()=>{
    conn=peer.connect('bt-'+code,{reliable:true});
    conn.on('open',()=>{clearTimeout(fail);conn.send({t:'hi',dev:DEV});lobbyInit(code,false)});
    conn.on('data',onMsg);
    conn.on('close',()=>{if(inGame||$('lobby').classList.contains('on')){alert('Conexão encerrada.');location.reload()}});
  });
  peer.on('error',e=>{clearTimeout(fail);status(e.type==='peer-unavailable'?'Sala não encontrada.':'Erro: '+e.type)});
}
function onMsg(m){
  if(m.t==='lobby'){me=m.you;lobbyRender(m.n,m.devs)}
  else if(m.t==='full'){alert('Sala cheia ou partida já iniciada.');location.reload()}
  else if(m.t==='state'){s=m.s;lastTick=performance.now();if(!inGame)enterGame();updateHud()}
}

/* ============ HUD ============ */
function buildHud(){
  [['top',[0,4,1]],['bot',[2,5,3]]].forEach(([id,ord])=>{
    $(id).innerHTML=ord.filter(i=>s.p[i]).map(i=>`<div class="slot" id="h${i}" style="--c:${COL[i].c}"><div class="ring" style="--c:${COL[i].c};--l:${COL[i].l}"></div><div class="pill" style="color:${COL[i].c}">0</div></div>`).join('');
  });
  updateHud();
}
function updateHud(){
  s.p.forEach((p,i)=>{
    if(!p)return;const e=$('h'+i);if(!e)return;
    e.querySelector('.pill').textContent=p.sc;e.classList.toggle('dead',!p.alive);
  });
}

/* ============ DESENHO ============ */
const cv=$('cv'),ctx=cv.getContext('2d');
function resize(){
  const st=$('stage'),pad=8,w=Math.max(120,Math.min(st.clientWidth-pad,(st.clientHeight-pad)*W/H)),dpr=Math.min(devicePixelRatio||1,2);
  cv.style.width=w+'px';cv.style.height=w*H/W+'px';
  cv.width=Math.round(W*T*dpr);cv.height=Math.round(H*T*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
}
addEventListener('resize',()=>inGame&&resize());
addEventListener('orientationchange',()=>setTimeout(()=>inGame&&resize(),250));
if(window.ResizeObserver)new ResizeObserver(()=>inGame&&resize()).observe($('stage'));
function rr(x,y,w,h,r){ctx.beginPath();ctx.roundRect?ctx.roundRect(x,y,w,h,r):ctx.rect(x,y,w,h)}
function penguin(x,y,d,i,me_){
  const c=COL[i].c;
  ctx.save();ctx.translate(x,y);ctx.rotate(d*Math.PI/2);
  ctx.shadowColor=c;ctx.shadowBlur=5;ctx.lineWidth=2.5;ctx.strokeStyle='rgba(255,255,255,.92)';
  ctx.fillStyle=c;
  for(const sx of[-1,1]){ctx.beginPath();ctx.ellipse(sx*20,3,6,11,sx*.35,0,7);ctx.fill();ctx.stroke()}
  ctx.fillStyle='#16203a';ctx.beginPath();ctx.ellipse(0,0,18,21,0,0,7);ctx.fill();ctx.stroke();
  ctx.shadowBlur=0;ctx.fillStyle='#e9fbff';ctx.beginPath();ctx.ellipse(0,-3,11,14,0,0,7);ctx.fill();
  ctx.fillStyle=c;ctx.beginPath();ctx.moveTo(-5,-10);ctx.lineTo(5,-10);ctx.lineTo(0,-18);ctx.closePath();ctx.fill();
  ctx.fillStyle='#05101f';[-6,6].forEach(ex=>{ctx.beginPath();ctx.arc(ex,-6,2.2,0,7);ctx.fill()});
  ctx.restore();
  if(me_){ctx.save();ctx.translate(x,y-36);ctx.fillStyle='#00e5ff';ctx.shadowColor='#00e5ff';ctx.shadowBlur=10;
    ctx.beginPath();ctx.moveTo(-8,-8);ctx.lineTo(8,-8);ctx.lineTo(0,3);ctx.closePath();ctx.fill();ctx.restore()}
}
const TS=[];
function mkTile(t){
  const c=document.createElement('canvas');c.width=c.height=(T+16)*2;
  const ctx=c.getContext('2d');ctx.scale(2,2);ctx.translate(8,8);
  const px=3,py=3,w=T-6;
  if(t>=3){ctx.fillStyle='rgba(0,4,14,.9)';rr2(ctx,5,5,T-10,T-10,8);ctx.fill();ctx.strokeStyle='rgba(0,229,255,.14)';ctx.lineWidth=1;ctx.setLineDash([4,5]);ctx.stroke();return c}
    const gr=ctx.createLinearGradient(px,py,px+w,py+w),cs=[['#17356b','#0a1a3c'],['#1a3f73','#0d2147'],['#3a2a48','#1d1430']][t];
    gr.addColorStop(0,cs[0]);gr.addColorStop(1,cs[1]);
    const ec=['rgba(0,229,255,.7)','rgba(140,225,255,.8)','rgba(255,140,90,.95)'][t];
    ctx.save();ctx.shadowColor=ec;ctx.shadowBlur=t===2?14:8;ctx.fillStyle=gr;rr2(ctx,px,py,w,w,10);ctx.fill();ctx.strokeStyle=ec;ctx.lineWidth=2;ctx.stroke();ctx.restore();
    ctx.strokeStyle='rgba(255,255,255,.14)';ctx.lineWidth=1.5;rr2(ctx,px+5,py+5,w-10,w-10,7);ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,.07)';ctx.beginPath();ctx.moveTo(px+6,py+6);ctx.lineTo(px+w*.55,py+6);ctx.lineTo(px+6,py+w*.55);ctx.fill();
    ctx.strokeStyle=ec;ctx.lineWidth=2;ctx.beginPath();[[0,0,1,1],[w,0,-1,1],[0,w,1,-1],[w,w,-1,-1]].forEach(([a,b,u,v])=>{ctx.moveTo(px+a+u*12,py+b);ctx.lineTo(px+a,py+b);ctx.lineTo(px+a,py+b+v*12)});ctx.stroke();
    if(t>=1){
      ctx.strokeStyle=t===1?'rgba(255,255,255,.7)':'rgba(255,170,120,.95)';ctx.lineWidth=2;ctx.beginPath();
      ctx.moveTo(px+12,py+10);ctx.lineTo(px+28,py+28);ctx.lineTo(px+22,py+44);ctx.moveTo(px+28,py+28);ctx.lineTo(px+46,py+34);
      if(t===2){ctx.moveTo(px+46,py+8);ctx.lineTo(px+36,py+22);ctx.moveTo(px+10,py+48);ctx.lineTo(px+24,py+36);ctx.moveTo(px+28,py+28);ctx.lineTo(px+8,py+26);ctx.moveTo(px+46,py+34);ctx.lineTo(px+50,py+50)}
      ctx.stroke();
  }
  return c;
}
function rr2(c,x,y,w,h,r){c.beginPath();c.roundRect?c.roundRect(x,y,w,h,r):c.rect(x,y,w,h)}
function frame(now){
  requestAnimationFrame(frame);
  if(!s)return;
  const dt=Math.min(.05,(now-(frame.l||now))/1000);frame.l=now;
  ctx.clearRect(0,0,W*T,H*T);
  const st={};s.p.forEach(p=>{if(p&&p.alive)st[p.y*W+p.x]=p.stand/STAND});
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const k=y*W+x,t=s.tile[k];
    const a=st[k]||0,sh=a>.2?Math.sin(now/35)*a*2.5:(t===2?Math.sin(now/60):0);
    ctx.drawImage(TS[t]||(TS[t]=mkTile(t)),x*T-8+sh,y*T-8,T+16,T+16);
    if(t===2){ctx.globalAlpha=.14+.1*Math.sin(now/120);ctx.fillStyle='#ff5a3c';rr(x*T+3+sh,y*T+3,T-6,T-6,10);ctx.fill();ctx.globalAlpha=1}
  }
  s.p.forEach((p,i)=>{
    if(!p)return;
    const v=frame.v||(frame.v=[]);v[i]=v[i]||{x:p.x,y:p.y};const q=v[i];
    if(Math.abs(p.x-q.x)+Math.abs(p.y-q.y)>2){q.x=p.x;q.y=p.y}
    const f=1-Math.exp(-dt*24);q.x+=(p.x-q.x)*f;q.y+=(p.y-q.y)*f;
    const cx=(q.x+.5)*T,cy=(q.y+.5)*T;
    if(!p.alive){
      if(p.fl>.7)return;const sc=1-p.fl/.7;
      ctx.save();ctx.globalAlpha=sc;ctx.translate(cx,cy);ctx.scale(sc,sc);ctx.rotate(p.fl*7);ctx.translate(-cx,-cy);penguin(cx,cy,p.d,i,false);ctx.restore();return;
    }
    const hg=ctx.createRadialGradient(cx,cy,4,cx,cy,34);hg.addColorStop(0,COL[i].c+'66');hg.addColorStop(1,COL[i].c+'00');ctx.fillStyle=hg;ctx.beginPath();ctx.arc(cx,cy,34,0,7);ctx.fill();
    penguin(cx,cy,p.d,i,i===me&&(mode!=='local'||hum===1));
    if(p.stand>.6){ // contagem regressiva do piso
      ctx.save();ctx.strokeStyle=p.stand>2?'#ff3c3c':'#ffd23c';ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=10;ctx.lineWidth=4;ctx.lineCap='round';
      ctx.beginPath();ctx.arc(cx,cy,29,-Math.PI/2,-Math.PI/2+Math.PI*2*(1-p.stand/STAND));ctx.stroke();ctx.restore();
    }
  });
  ctx.fillStyle='rgba(0,229,255,.05)';ctx.fillRect(0,(now/22)%(H*T+40)-20,W*T,20);
  let h='';
  const mp=s.p[me],lose=mp&&!mp.alive&&s.phase==='play'&&(mode!=='local'||hum===1);
  if(s.phase==='count')h=`<div class="big">${Math.ceil(s.cd)}</div><div class="mid" style="color:#9fc4d8;font-size:16px">Rodada ${s.round} · ${WIN} vitórias</div>`;
  else if(s.phase==='round')h=s.rw>=0?`<div class="mid" style="color:${COL[s.rw].c}">Jogador ${s.rw+1} venceu a rodada!</div>`:`<div class="mid" style="color:#9fc4d8">Ninguém sobreviveu!</div>`;
  else if(s.phase==='over'){
    const own=mode==='host'||mode==='local';
    h=`<div class="mid" style="color:${COL[s.win].c}">Jogador ${s.win+1} venceu a partida!</div>`+
      (own?'<button class="btn g" onclick="again()">Jogar de novo</button>':'<div class="mid" style="color:#9fc4d8;font-size:16px">Aguardando o anfitrião…</div>');
  }else if(lose)h='<div class="mid" style="color:#ff8aa0;font-size:16px">Você caiu! Aguarde a rodada acabar…</div>';
  if($('msg').dataset.h!==h){$('msg').dataset.h=h;$('msg').innerHTML=h}
}

/* ============ CONTROLES ============ */
// d: 0 cima,1 direita,2 baixo,3 esquerda, -1 soltou. Tocar = 1 passo; segurar = continua andando; soltar = para.
function inp(i,d){
  if(!s)return;
  if(mode==='client'){conn&&conn.open&&conn.send({t:'dir',d});return}
  const p=s.p[i];if(p&&!p.bot){p.hold=d;if(d>=0){p.want=d;p.wt=.25}}
}
const two=()=>mode==='local'&&hum>1;
const KD={ArrowUp:[0,0],ArrowRight:[0,1],ArrowDown:[0,2],ArrowLeft:[0,3],w:[1,0],d:[1,1],s:[1,2],a:[1,3]},hd=[-1,-1];
const kk=e=>KD[e.key.length>1?e.key:e.key.toLowerCase()];
addEventListener('keydown',e=>{
  const m=kk(e);if(!m||!inGame)return;e.preventDefault();if(e.repeat)return;
  const i=two()?m[0]:me;hd[i]=m[1];inp(i,m[1]);
});
addEventListener('keyup',e=>{
  const m=kk(e);if(!m||!inGame)return;
  const i=two()?m[0]:me;if(hd[i]===m[1]){hd[i]=-1;inp(i,-1)}
});
addEventListener('blur',()=>{hd.fill(-1);if(inGame)[0,1].forEach(i=>inp(i,-1))});

/* deslizar o dedo no tabuleiro = 1 passo (1 jogador por aparelho) */
let sw=null;const stg=$('stage');
stg.addEventListener('pointerdown',e=>{sw={x:e.clientX,y:e.clientY}});
stg.addEventListener('pointermove',e=>{
  if(!sw||two())return;const dx=e.clientX-sw.x,dy=e.clientY-sw.y;
  if(Math.hypot(dx,dy)<28)return;
  inp(me,Math.abs(dx)>Math.abs(dy)?(dx>0?1:3):(dy>0?2:0));inp(me,-1);sw={x:e.clientX,y:e.clientY};
});
['pointerup','pointercancel'].forEach(n=>stg.addEventListener(n,()=>sw=null));

/* botões na tela: #pad0 = jogador deste aparelho (setas); #pad1 = jogador 2 no modo local */
document.querySelectorAll('.pad').forEach(pd=>{
  const who=()=>+pd.dataset.p?1:(two()?0:me);
  pd.addEventListener('pointerdown',e=>e.stopPropagation());
  pd.addEventListener('contextmenu',e=>e.preventDefault());
  pd.querySelectorAll('button').forEach(b=>{
    const up=()=>{if(b.on){b.on=0;b.classList.remove('on');inp(who(),-1)}};
    b.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();try{b.setPointerCapture(e.pointerId)}catch(_){}b.on=1;b.classList.add('on');inp(who(),+b.dataset.d)});
    ['pointerup','pointercancel','lostpointercapture'].forEach(n=>b.addEventListener(n,up));
  });
});
if(matchMedia('(pointer:coarse)').matches)document.body.classList.add('pads');

/* entrar direto pelo link de convite (?sala=ABCD) */
(()=>{
  const q=(new URLSearchParams(location.search).get('sala')||'').toUpperCase().slice(0,4);
  if(q.length===4){show('online');$('jc').value=q;setTimeout(joinRoom,400)}
})();
