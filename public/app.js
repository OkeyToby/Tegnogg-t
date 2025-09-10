let socket;
let roomId = null, isHost = false, myId = null, myName = "";
let canDraw = false;
let currentColor = '#111827';
let chooseTimerInt = null;
let drawTimerInt = null;
let isErasing = false;
let brushSize = 4;

const $ = (id) => document.getElementById(id);
function addChat(text) {
  const c = $('chat'); const p = document.createElement('div'); p.textContent = text;
  c.appendChild(p); c.scrollTop = c.scrollHeight;
}
function renderPlayers(players) {
  const box = $('players'); box.innerHTML = "";
  players.forEach(p => {
    const d = document.createElement('div');
    d.className = 'player';
    const info = document.createElement('span');
    const av = document.createElement('span');
    av.textContent = p.avatar || '';
    av.style.marginRight = '6px';
    const n = document.createElement('span');
    n.textContent = p.name;
    info.appendChild(av);
    info.appendChild(n);
    const s = document.createElement('span');
    s.textContent = p.score;
    d.appendChild(info);
    d.appendChild(s);
    box.appendChild(d);
  });
}

function setupCanvas(){
  const cv = $('canvas');
  const ctx = cv.getContext('2d');
  ctx.lineCap='round'; ctx.lineJoin='round'; ctx.lineWidth=brushSize; ctx.strokeStyle=currentColor;
  let drawing=false, last=null;

  const drawSeg=(a,b,erase,color,size)=>{
    ctx.save();
    if(erase){ ctx.globalCompositeOperation='destination-out'; ctx.lineWidth=size||18; }
    else { ctx.globalCompositeOperation='source-over'; ctx.strokeStyle=color||currentColor; ctx.lineWidth=size||brushSize; }
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    ctx.restore();
  };
  const sendStroke=(a,b)=>{
    if(!canDraw) return;
    const payload = isErasing
      ? { a, b, erase:true, size: Math.max(brushSize*3, 12) }
      : { a, b, color: currentColor, size: brushSize };
    socket.emit('drawStroke',{roomId, stroke: payload});
    drawSeg(a,b, payload.erase, payload.color, payload.size);
  };

  const getPos = (e)=>{
    const r=cv.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    const x = (src.clientX - r.left) * (cv.width / r.width);
    const y = (src.clientY - r.top ) * (cv.height / r.height);
    return {x,y};
  };

  cv.addEventListener('mousedown', e=>{ if(!canDraw) return; drawing=true; last=getPos(e); });
  cv.addEventListener('mousemove', e=>{
    if(!drawing) return;
    const pos=getPos(e); sendStroke(last,pos); last=pos;
  });
  window.addEventListener('mouseup', ()=> drawing=false);

  cv.addEventListener('touchstart', e=>{ if(!canDraw) return; drawing=true; last=getPos(e); });
  cv.addEventListener('touchmove', e=>{
    if(!drawing) return;
    const pos=getPos(e); sendStroke(last,pos); last=pos; e.preventDefault();
  }, {passive:false});
  window.addEventListener('touchend', ()=> drawing=false);

  socket.on('drawStroke', data => {
    const {a,b,color,erase,size} = data;
    drawSeg(a,b,erase,color,size);
  });

  $('penBtn').onclick = ()=>{ isErasing=false; };
  $('eraserBtn').onclick = ()=>{ isErasing=true; };
  $('sizeRange').oninput = (e)=>{ brushSize = parseInt(e.target.value||"4",10); };
  $('clearBtn').onclick = ()=>{
    if(!canDraw) return;
    const cv = $('canvas'); cv.getContext('2d').clearRect(0,0,cv.width,cv.height);
  };
}

$('btnCreate').onclick = ()=>{
  connect(()=>{
    socket.emit('createHold', (res)=>{
      if(!res.ok) return setLoginMsg(res.error||'Fejl.');
      ({roomId, isHost} = res); myId = socket.id; postJoin(res.players);
      updateShareUI();
      history.replaceState({}, "", addRoomToUrl(roomId));
    });
  });
};

$('btnJoin').onclick = ()=>{
  const rid = (($('roomIn').value||"").trim().toUpperCase());
  if(!rid) return setLoginMsg("Skriv en holdkode.");
  connect(()=>{
    socket.emit('joinHold', {roomId: rid}, (res)=>{
      if(!res.ok) return setLoginMsg(res.error||'Fejl.');
      roomId = rid; isHost = res.isHost; myId = socket.id; postJoin(res.players);
      updateShareUI();
      history.replaceState({}, "", addRoomToUrl(roomId));
    });
  });
};

$('send').onclick = sendGuess;
$('msg').addEventListener('keydown', (e)=>{
  if(e.key === 'Enter'){ e.preventDefault(); sendGuess(); }
});

/* ... rest of app.js omitted for brevity (contains word selection,
   drawing timer, chat handling, game-over modal etc.) */
