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
    // broadcast en stor "erase" ved at tømme – valgfrit: kunne også sende sær-event til server
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

function sendGuess(){
  const m = $('msg'); const t = (m.value||"").trim();
  if(!t) return;
  socket.emit('guess', {roomId, msg:t});
  m.value="";
}

$('startBtn').onclick  = ()=> socket.emit('startGame',   {roomId});
$('restartBtn').onclick= ()=> socket.emit('restartGame', {roomId});

function setLoginMsg(t){ $('loginMsg').textContent = t || ""; }
function postJoin(players){
  $('login').style.display='none';
  $('app').style.display='grid';
  $('roomBadge').textContent = "Hold: " + roomId + (isHost ? " (Vært)" : "");
  if (isHost) {
    $('hostCtl').style.display = 'block';
    $('roundCtl').style.display = 'block';
  }
  renderPlayers(players);
  setupCanvas();

  // fokus på gæt-felt
  setTimeout(()=>{ $('msg')?.focus(); }, 100);

  $('palette').addEventListener('click', e=>{
    const c = e.target.getAttribute('data-color');
    if(c){
      isErasing = false;
      currentColor = c;
      const ctx = $('canvas').getContext('2d');
      ctx.strokeStyle = currentColor;
    }
  });

  $('setRoundsBtn').onclick = ()=>{
    const r = parseInt($('roundsInput').value);
    if(r > 0){
      socket.emit('setRounds',{ roomId, rounds:r });
    }
  };

  // del / kopiér
  $('shareBtn').onclick = async ()=>{
    const url = addRoomToUrl(roomId);
    try{
      if(navigator.share){
        await navigator.share({ title:"Klassens Skribbl", text:"Join mit hold:", url });
      }else{
        await navigator.clipboard.writeText(url);
        flashMsg("Link kopieret!");
      }
    }catch{}
  };
  $('copyBtn').onclick = async ()=>{
    const url = addRoomToUrl(roomId);
    try{ await navigator.clipboard.writeText(url); flashMsg("Link kopieret!"); }catch{}
  };
}

function connect(onReady){
  myName = (($('name').value||"").trim());
  const code = (($('code').value||"").trim());
  const avatar = $('avatar').value;
  if(!myName || !code) return setLoginMsg("Udfyld navn og klassekode.");

  socket = io({ autoConnect:false, auth:{ name: myName, classCode: code } });
  socket = io({ autoConnect:false, auth:{ name: myName, classCode: code, avatar } });
  socket.connect();

  socket.on('connect_error', (e)=> setLoginMsg(e && e.message || "Forbindelsesfejl."));
  socket.on('playerList', renderPlayers);

  socket.on('turnInfo', ({drawerName})=>{
    canDraw=false;
    $('phase').textContent = drawerName + " vælger et ord…";
    $('timer').textContent = '';
    clearInterval(drawTimerInt);
    clearInterval(chooseTimerInt);
  });

  socket.on('chooseWordFree', ({maxLen, chooseTime})=>{
    const modal = $('chooseModal');
     const fw = $('freeWord');
    const submit = $('submitWord');
    const cancel = $('cancelWord');

    if (fw) fw.value = "";

    submit.onclick = ()=>{
      const w = (fw.value||"").trim();
      if (!w) return;
      let clean = w.replace(/\s+/g, ' ').slice(0, maxLen || 20);
      socket.emit('wordChosen', {roomId, word: clean});
      modal.style.display='none';
    };
    cancel.onclick = ()=>{ modal.style.display='none'; };
    fw.onkeydown = (e)=>{ if(e.key === 'Enter'){ submit.onclick(); } };
    modal.style.display='flex';
    fw.focus();

    clearInterval(chooseTimerInt);
    let remaining = Math.round(chooseTime || 20);
    $('timer').textContent = "Tid til ordvalg: " + remaining + "s";
    chooseTimerInt = setInterval(()=>{
      remaining--;
      $('timer').textContent = "Tid til ordvalg: " + remaining + "s";
      if(remaining <= 0){
        clearInterval(chooseTimerInt); chooseTimerInt = null;
        modal.style.display = 'none';   // luk modal
      }
    }, 1000);
  });

  socket.on('youDraw', ({word})=>{
    canDraw = true;
    $('phase').textContent = "Du tegner: " + word;
    // fallback: hvis drawTimer ikke er startet via roundStart (skulle den være), start en lokal
    if(!drawTimerInt){
      let remaining = 80;
      $('timer').textContent = "Tid tilbage: " + remaining + "s";
      drawTimerInt = setInterval(()=>{
        remaining--;
        $('timer').textContent = "Tid tilbage: " + remaining + "s";
     });
  socket.on('roundStart', ({drawerName, hint})=>{
    $('phase').textContent = drawerName + " tegner – gæt i chatten! Ord: " + (hint || '');
    const cv=$('canvas'); cv.getContext('2d').clearRect(0,0,cv.width,cv.height);

    clearInterval(drawTimerInt); drawTimerInt=null;
    clearInterval(chooseTimerInt); chooseTimerInt=null;
    let remaining = 80;
    $('timer').textContent = "Tid tilbage: " + remaining + "s";
    drawTimerInt = setInterval(()=>{
      remaining--;
      $('timer').textContent = "Tid tilbage: " + remaining + "s";
      if(remaining <= 0){
        clearInterval(drawTimerInt); drawTimerInt=null;
      }
    }, 1000);
  });

  socket.on('roundEnd', ({reason, word})=>{
    canDraw=false;
    clearInterval(drawTimerInt); drawTimerInt=null;
    clearInterval(chooseTimerInt); chooseTimerInt=null;
    $('timer').textContent = '';
    $('phase').textContent = "Runden sluttede (" + reason + "). Ordet var: " + word;
    addChat("Ordet var: " + word);
  });

  socket.on('hintUpdate', ({hint})=>{
    const txt = $('phase').textContent;
    const idx = txt.indexOf("Ord:");
    if(idx >= 0){
      $('phase').textContent = txt.substring(0, idx + 4) + " " + hint;
    }
  });

  socket.on('chat', ({from, msg})=> addChat(from + ": " + msg));

  socket.on('gameOver', ({ podium, players })=>{
    const wrap = $('podiumList'); wrap.innerHTML = "";
    const classes = ['gold','silver','bronze'];
    (podium||[]).forEach((p,idx)=>{
      const div = document.createElement('div');
      div.className = 'pod ' + (classes[idx]||'');
      div.innerHTML = `<div style="font-size:20px;font-weight:800">${idx+1}. plads</div>
        <div style="font-size:18px">${p.name||'?'}</div>
        <div class="muted">Point: ${p.score||0}</div>`;
      wrap.appendChild(div);
    });
    $('podiumModal').style.display='flex';
  });
  });
  $('closePodium').onclick = ()=>{ $('podiumModal').style.display='none'; };

  socket.on('connect', ()=> { if (onReady) onReady(); });
}

// delbar URL: ?room=XXXX
function addRoomToUrl(rid){
  const u = new URL(window.location.href);
  u.searchParams.set('room', rid);
  return u.toString();
}
function fromUrlRoom(){
  const u = new URL(window.location.href);
  return (u.searchParams.get('room')||"").toUpperCase();
}
function updateShareUI(){
  $('shareBtn').style.display = 'inline-block';
  $('copyBtn').style.display = 'inline-block';
}
function flashMsg(t){
  const old = $('loginMsg').textContent;
  $('loginMsg').textContent = t;
  setTimeout(()=>{ $('loginMsg').textContent = old; }, 1200);
}

// auto-udfyld holdkode fra URL
window.addEventListener('DOMContentLoaded', ()=>{
  const r = fromUrlRoom();
  if(r){ $('roomIn').value = r; }
  // Enter til join/create i loginfelter
  $('name').addEventListener('keydown', e=>{ if(e.key==='Enter'){ $('btnCreate').click(); } });
  $('code').addEventListener('keydown', e=>{ if(e.key==='Enter'){ $('btnCreate').click(); } });
  $('roomIn').addEventListener('keydown', e=>{ if(e.key==='Enter'){ $('btnJoin').click(); } });
});

