// ============================================================================
//  Department Scheduler — frontend SPA (vanilla JS). Talks to the REST API.
// ============================================================================
const DAYS = ['Mon','Tue','Wed','Thu','Fri'];
const DAY_START = 8*60, DAY_END = 18*60, STEP = 30, PXM = 0.9;
const PALETTE = ['#2f6f6a','#3b6ea5','#7a5a9e','#a8632c','#4d7c3a','#9a3b5c','#506b8e','#856a2d'];

const state = { token: localStorage.getItem('ds_token') || null, user: null, view: null };

/* ---------- helpers ---------- */
const $ = (s, r=document) => r.querySelector(s);
const el = (t, c, h) => { const e=document.createElement(t); if(c)e.className=c; if(h!=null)e.innerHTML=h; return e; };
const fmt = (m) => { const h=Math.floor(m/60), mm=m%60, ap=h<12?'am':'pm'; let hh=h%12||12; return mm===0?`${hh}${ap}`:`${hh}:${String(mm).padStart(2,'0')}${ap}`; };
const esc = (s)=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function toast(msg, bad=false){ const t=$('#toast'); t.textContent=msg; t.className='toast show'+(bad?' bad':''); setTimeout(()=>t.className='toast',2400); }

async function api(path, opts={}){
  const headers = { 'Content-Type':'application/json', ...(opts.headers||{}) };
  if (state.token) headers.Authorization = 'Bearer '+state.token;
  const res = await fetch('/api'+path, { ...opts, headers, body: opts.body?JSON.stringify(opts.body):undefined });
  if (res.status === 401 && state.user){ logout(); throw new Error('Session expired'); }
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw Object.assign(new Error(data.error||'Request failed'), { data, status: res.status });
  return data;
}

/* ---------- auth ---------- */
function showAuthErr(m){ const e=$('#authErr'); e.textContent=m; e.classList.add('show'); }
$('#tabSignin').onclick = ()=>switchAuth(true);
$('#tabSignup').onclick = ()=>switchAuth(false);
function switchAuth(signin){
  $('#tabSignin').setAttribute('aria-selected',signin);
  $('#tabSignup').setAttribute('aria-selected',!signin);
  $('#paneSignin').style.display = signin?'block':'none';
  $('#paneSignup').style.display = signin?'none':'block';
  $('#authErr').classList.remove('show');
}
$('#doLogin').onclick = doLogin;
$('#li_pass').onkeydown = e=>{ if(e.key==='Enter') doLogin(); };
async function doLogin(){
  try{
    const { token, user } = await api('/auth/login',{ method:'POST', body:{ email:$('#li_email').value.trim(), password:$('#li_pass').value }});
    startSession(token, user);
  }catch(e){ showAuthErr(e.message); }
}
$('#doSignup').onclick = doSignup;
async function doSignup(){
  try{
    const { token, user } = await api('/auth/register',{ method:'POST', body:{ name:$('#su_name').value.trim(), email:$('#su_email').value.trim(), password:$('#su_pass').value }});
    startSession(token, user);
  }catch(e){ showAuthErr(e.message); }
}
$('#logout').onclick = logout;
function logout(){ state.token=null; state.user=null; localStorage.removeItem('ds_token'); document.body.classList.remove('authed'); switchAuth(true); }

function startSession(token, user){
  state.token = token; state.user = user; localStorage.setItem('ds_token', token);
  document.body.classList.add('authed');
  $('#whoAv').textContent = (user.name[0]||'?').toUpperCase();
  $('#whoName').textContent = user.name;
  $('#whoRole').textContent = user.role[0].toUpperCase()+user.role.slice(1);
  buildNav();
  go(defaultView());
}
function defaultView(){ return 'dashboard'; }

/* ---------- navigation (role-aware) ---------- */
const NAV = {
  admin:    [['dashboard','Dashboard'],['timetable','Timetable'],['scheduling','Scheduling'],['courses','Courses'],['rooms','Rooms'],['users','Users'],['audit','Activity']],
  lecturer: [['dashboard','Dashboard'],['timetable','My timetable'],['mycourses','My courses'],['availability','Availability']],
  student:  [['dashboard','Dashboard'],['catalogue','Course catalogue'],['timetable','My timetable']],
};
function buildNav(){
  const nav = $('#nav'); nav.innerHTML='';
  for (const [id,label] of NAV[state.user.role]){
    const b = el('button',null,label); b.dataset.view=id;
    b.onclick = ()=>go(id);
    nav.appendChild(b);
  }
}
function go(view){
  state.view = view;
  for (const b of $('#nav').children) b.classList.toggle('active', b.dataset.view===view);
  views[view]?.();
}

/* ---------- shared timetable grid ---------- */
function renderGrid(container, sessions, { colorBy='room', flagConflicts=false, onClickSession=null }={}){
  const bodyH = (DAY_END-DAY_START)*PXM;
  const wrap = el('div','grid-wrap'); const grid = el('div','grid');
  grid.appendChild(el('div','gh',''));
  DAYS.forEach(d=>grid.appendChild(el('div','gh',d)));
  const tcol = el('div','timecol'); tcol.style.height=bodyH+'px';
  for(let t=DAY_START;t<=DAY_END;t+=60){ const s=el('span',null,fmt(t)); s.style.top=((t-DAY_START)*PXM-7)+'px'; tcol.appendChild(s); }
  grid.appendChild(tcol);

  const colorKey = colorBy==='room' ? 'room_id' : 'course_id';
  const keys = [...new Set(sessions.map(s=>s[colorKey]))];
  const colorFor = (s)=>PALETTE[keys.indexOf(s[colorKey])%PALETTE.length];

  DAYS.forEach((d,di)=>{
    const col = el('div','daycol'); col.style.height=bodyH+'px';
    for(let t=DAY_START;t<DAY_END;t+=STEP){ const ln=el('div','slotline'+(t%60===0?' hour':'')); ln.style.top=((t-DAY_START)*PXM)+'px'; col.appendChild(ln); }
    sessions.filter(s=>s.day_of_week===di).forEach(s=>{
      const bad = flagConflicts && s.clash;
      const status = s.my_status || s.status; // lecturer sees their own; admin sees the merged one
      const ev = el('div','ev'+(bad?' conflict':'')+(status?' st-'+status:''));
      ev.style.top=((s.start_min-DAY_START)*PXM)+'px';
      ev.style.height=(s.duration_min*PXM-3)+'px';
      ev.style.background=colorFor(s);
      const badge = status==='confirmed'?'<span class="flag ok">✓</span>':status==='declined'?'<span class="flag bad">✕</span>':'';
      ev.innerHTML=`<div class="c">${esc(s.course_code)}</div><div class="m">${esc(s.room_name)} · ${fmt(s.start_min)}</div>`+(bad?'<span class="flag">⚠</span>':badge);
      ev.title=`${s.course_code} ${s.course_title}\n${s.lecturer_name||'—'} · ${s.room_name}\n${DAYS[di]} ${fmt(s.start_min)}–${fmt(s.start_min+s.duration_min)}`+(status?`\nStatus: ${status}`:'');
      if (onClickSession) { ev.onclick = () => onClickSession(s); ev.classList.add('clickable'); }
      col.appendChild(ev);
    });
    grid.appendChild(col);
  });
  wrap.appendChild(grid); container.appendChild(wrap);

  const legend = el('div','legend');
  const seen = new Map();
  sessions.forEach(s=>{ const k=s[colorKey]; if(!seen.has(k)) seen.set(k, colorBy==='room'?s.room_name:s.course_code); });
  [...seen].forEach(([k,name])=>legend.innerHTML+=`<span><i style="background:${PALETTE[keys.indexOf(k)%PALETTE.length]}"></i>${esc(name)}</span>`);
  if(flagConflicts) legend.innerHTML+=`<span><i style="background:#fff;outline:2px solid var(--warn);outline-offset:-2px"></i>clash</span>`;
  container.appendChild(legend);
}

function page(title, sub){ const c=$('#content'); c.innerHTML=''; c.appendChild(el('h1','page',title)); if(sub)c.appendChild(el('p','psub',sub)); return c; }

/* ---------- modal ---------- */
function modal(title, bodyHTML, onSave, saveLabel='Save'){
  const m=$('#modal');
  m.innerHTML=`<header><h3>${esc(title)}</h3></header><div class="mbody">${bodyHTML}</div>
    <footer><button class="btn" id="mCancel">Cancel</button><button class="btn primary" id="mSave">${esc(saveLabel)}</button></footer>`;
  $('#scrim').classList.add('open');
  $('#mCancel').onclick=closeModal;
  $('#mSave').onclick=async()=>{ try{ await onSave(); }catch(e){ toast(e.message,true); } };
}
function closeModal(){ $('#scrim').classList.remove('open'); }
$('#scrim').onclick=e=>{ if(e.target.id==='scrim') closeModal(); };

/* ======================================================================
   VIEWS
   ====================================================================== */
const views = {};

views.dashboard = async () => {
  const c = page('Dashboard', `Signed in as ${state.user.role}.`);
  const d = await api('/dashboard');
  const cards = {
    admin: [['users','Users'],['lecturers','Lecturers'],['students','Students'],['courses','Courses'],['rooms','Rooms'],['sessions','Scheduled sessions'],['confirmed','Confirmed'],['pending','Pending'],['declined','Declined'],['unscheduled','Courses with no sessions']],
    lecturer: [['myCourses','Courses you teach'],['mySessions','Your sessions'],['awaiting','Awaiting your confirmation'],['unavailable','Unavailable blocks']],
    student: [['enrolled','Enrolled courses'],['classes','Weekly classes']],
  }[d.role];
  const stats = el('div','stats');
  cards.forEach(([k,l])=> stats.appendChild(el('div','stat',`<div class="v">${d[k]??0}</div><div class="l">${l}</div>`)));
  c.appendChild(stats);
  if (d.role==='admin'){ c.appendChild(el('p','psub',`Term ${esc(d.term)}. Use Scheduling to add classes — every booking is checked for room, lecturer, availability, capacity and student clashes before it is saved.`)); }
  if (d.role==='lecturer' && d.awaiting>0){ c.appendChild(el('p','psub',`You have ${d.awaiting} class(es) awaiting confirmation — open My timetable and tap a class to confirm or decline it.`)); }
};

/* ---- timetable (all roles, scoped server-side) ---- */
views.timetable = async () => {
  const role = state.user.role;
  const c = page(role==='admin'?'Full timetable':'My timetable',
    role==='student'?'Your enrolled classes. Clashing classes are outlined.':
    role==='lecturer'?'Classes you teach. Tap a class to confirm, decline, or see who is enrolled.':
    'Every scheduled session across all rooms. Tap a class to see lecturer confirmations and the roster.');
  const sessions = await api('/timetable');
  if(!sessions.length){ c.appendChild(el('div','empty','Nothing scheduled yet.')); return; }
  const onClickSession = role==='student' ? null : (s)=> role==='lecturer' ? lecturerSessionModal(s) : adminSessionModal(s);
  renderGrid(c, sessions, { colorBy: role==='student'?'course':'room', flagConflicts: role==='student', onClickSession });
};

/* ---- lecturer: confirm/decline a class + see its roster ---- */
function lecturerSessionModal(s){
  modal(`${s.course_code} — ${DAYS[s.day_of_week]} ${fmt(s.start_min)}`, `
    <p class="muted">${esc(s.course_title)} · ${esc(s.room_name)} · ${fmt(s.start_min)}–${fmt(s.start_min+s.duration_min)}</p>
    <div class="field"><label class="f">Your status</label>
      <select id="cf_status">
        <option value="pending" ${s.my_status==='pending'?'selected':''}>Pending</option>
        <option value="confirmed" ${s.my_status==='confirmed'?'selected':''}>Confirmed — I'll be there</option>
        <option value="declined" ${s.my_status==='declined'?'selected':''}>Declined — I can't make it</option>
      </select>
    </div>
    <div class="field"><label class="f">Note (optional, shown to admin)</label><input id="cf_note" value="${esc(s.my_note||'')}" maxlength="200"/></div>
    <div id="cf_roster" class="muted">Loading roster…</div>
  `, async()=>{
    await api(`/sessions/${s.id}/confirm`,{method:'POST',body:{status:$('#cf_status').value, note:$('#cf_note').value.trim()}});
    closeModal(); toast('Saved'); go('timetable');
  }, 'Save');
  api(`/sessions/${s.id}/students`).then(list=>{
    const box=$('#cf_roster');
    box.innerHTML = list.length ? `<b>${list.length} student(s) enrolled:</b> ${list.map(x=>esc(x.name)).join(', ')}` : 'No students enrolled yet.';
  }).catch(()=>{ $('#cf_roster').textContent=''; });
}

/* ---- admin: view confirmations + roster for a session ---- */
function adminSessionModal(s){
  const rows = (s.confirmations||[]).map(cf=>`<tr><td>${esc(cf.lecturer_name)}</td><td><span class="pill ${cf.status}">${cf.status}</span></td><td class="muted">${esc(cf.note||'')}</td></tr>`).join('');
  const m=$('#modal');
  m.innerHTML=`<header><h3>${esc(s.course_code)} — ${DAYS[s.day_of_week]} ${fmt(s.start_min)}</h3></header>
    <div class="mbody">
      <p class="muted">${esc(s.course_title)} · ${esc(s.room_name)} · ${fmt(s.start_min)}–${fmt(s.start_min+s.duration_min)}</p>
      <table><thead><tr><th>Lecturer</th><th>Status</th><th>Note</th></tr></thead><tbody>${rows||'<tr><td colspan="3" class="muted">No lecturer assigned.</td></tr>'}</tbody></table>
      <div id="ad_roster" class="muted" style="margin-top:12px">Loading roster…</div>
    </div>
    <footer><button class="btn" id="mCancel">Close</button></footer>`;
  $('#scrim').classList.add('open');
  $('#mCancel').onclick=closeModal;
  api(`/sessions/${s.id}/students`).then(list=>{
    const box=$('#ad_roster');
    box.innerHTML = list.length ? `<b>${list.length} student(s) enrolled:</b> ${list.map(x=>esc(x.name)).join(', ')}` : 'No students enrolled yet.';
  }).catch(()=>{ $('#ad_roster').textContent=''; });
}

/* ---- admin: scheduling (the core workflow) ---- */
views.scheduling = async () => {
  const c = page('Scheduling', 'Book a class into a room and time. Conflicts are detected live.');
  const [courses, rooms, sessions] = await Promise.all([api('/courses'), api('/rooms'), api('/sessions')]);
  const head = el('div',null,`<button class="btn primary" id="newSess">+ Schedule a class</button>`);
  head.style.marginBottom='18px';
  $('#newSess', head).onclick = ()=>scheduleModal(courses, rooms);
  c.appendChild(head);

  const panel = el('div','panel','<header><h3>Scheduled sessions</h3></header>');
  const tbl = el('table',null,`<thead><tr><th>Course</th><th>Lecturer</th><th>Room</th><th>When</th><th></th></tr></thead><tbody></tbody>`);
  const tb = $('tbody', tbl);
  sessions.forEach(s=>{
    const tr=el('tr',null,`<td><b>${esc(s.course_code)}</b> <span class="muted">${esc(s.course_title)}</span></td>
      <td>${esc(s.lecturer_name||'—')}</td><td>${esc(s.room_name)}</td>
      <td>${DAYS[s.day_of_week]} ${fmt(s.start_min)}–${fmt(s.start_min+s.duration_min)}</td>
      <td style="text-align:right"><button class="btn ghost sm" data-del="${s.id}">Delete</button></td>`);
    tb.appendChild(tr);
  });
  if(!sessions.length) tb.innerHTML=`<tr><td colspan="5"><div class="empty">No sessions yet.</div></td></tr>`;
  panel.appendChild(tbl); c.appendChild(panel);
  tb.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{ if(confirm('Delete this session?')){ await api('/sessions/'+b.dataset.del,{method:'DELETE'}); toast('Deleted'); go('scheduling'); }});
};

function scheduleModal(courses, rooms){
  const opt=(arr,fn)=>arr.map(fn).join('');
  let times=''; for(let t=DAY_START;t<DAY_END;t+=STEP) times+=`<option value="${t}">${fmt(t)}</option>`;
  modal('Schedule a class', `
    <div class="field"><label class="f">Course</label><select id="s_course">${opt(courses,c=>`<option value="${c.id}">${esc(c.code)} — ${esc(c.title)} (${esc(c.lecturer_name||'no lecturer')})</option>`)}</select></div>
    <div class="field"><label class="f">Room</label><select id="s_room">${opt(rooms,r=>`<option value="${r.id}">${esc(r.name)} (${r.capacity} seats)</option>`)}</select></div>
    <div class="row2">
      <div class="field"><label class="f">Day</label><select id="s_day">${DAYS.map((d,i)=>`<option value="${i}">${d}</option>`).join('')}</select></div>
      <div class="field"><label class="f">Start</label><select id="s_start">${times}</select></div>
    </div>
    <div class="field"><label class="f">Duration</label><select id="s_dur">${[30,60,90,120,150,180].map(d=>`<option value="${d}">${d} min</option>`).join('')}</select></div>
    <div class="check" id="s_check"><span class="ic">·</span><span id="s_msg">Choose a slot to check.</span></div>
  `, saveSession, 'Confirm booking');

  const read=()=>({ course_id:+$('#s_course').value, room_id:+$('#s_room').value, day_of_week:+$('#s_day').value, start_min:+$('#s_start').value, duration_min:+$('#s_dur').value });
  let lastClean=false;
  async function check(){
    const cand=read(); const box=$('#s_check'); const msg=$('#s_msg'); const save=$('#mSave');
    try{
      const r=await api('/sessions/check',{method:'POST',body:cand});
      if(r.hard.length){
        box.className='check bad'; box.querySelector('.ic').textContent='⚠';
        msg.innerHTML=`<b>Conflict.</b> ${r.hard.map(h=>esc(h.message)).join(' ')}`+
          (r.suggestion?`<div class="suggest" id="useSug">↪ Next free slot: ${esc(r.suggestion.label)} — use it</div>`:'');
        if(r.suggestion) $('#useSug').onclick=()=>{ $('#s_day').value=r.suggestion.day_of_week; $('#s_start').value=r.suggestion.start_min; check(); };
        save.disabled=true; lastClean=false;
      } else if(r.soft.length){
        box.className='check warn'; box.querySelector('.ic').textContent='!';
        msg.innerHTML=`<b>Allowed, but check:</b> ${r.soft.map(s=>esc(s.message)).join(' ')}`;
        save.disabled=false; lastClean=true;
      } else {
        box.className='check ok'; box.querySelector('.ic').textContent='✓';
        msg.textContent='Slot is clear. Room and lecturer are both free.';
        save.disabled=false; lastClean=true;
      }
    }catch(e){ msg.textContent=e.message; save.disabled=true; }
  }
  ['s_course','s_room','s_day','s_start','s_dur'].forEach(id=>{ $('#'+id).onchange=check; });
  check();

  async function saveSession(){
    const r=await api('/sessions',{method:'POST',body:read()});
    closeModal(); toast(r.warnings?.length?'Booked (with warnings)':'Class scheduled'); go('scheduling');
  }
}

/* ---- admin: courses ---- */
views.courses = async () => {
  const c = page('Courses','Course catalogue and lecturer assignments.');
  const [courses, lecturers] = await Promise.all([api('/courses'), api('/lecturers')]);
  const head=el('div',null,'<button class="btn primary" id="newCourse">+ Add course</button>'); head.style.marginBottom='18px';
  $('#newCourse',head).onclick=()=>courseModal(lecturers); c.appendChild(head);
  const panel=el('div','panel'); const tbl=el('table',null,`<thead><tr><th>Code</th><th>Title</th><th>Level</th><th>Status</th><th>Lecturer(s)</th><th>Units</th><th>Enrolled</th><th>Sessions</th><th></th></tr></thead><tbody></tbody>`);
  const tb=$('tbody',tbl);
  courses.forEach(co=>{
    const tr=el('tr',null,`<td><b>${esc(co.code)}</b>${co.alias?`<div class="muted" style="font-size:11px">${esc(co.alias)}</div>`:''}</td><td>${esc(co.title)}</td>
      <td>${co.level||'—'}</td><td>${co.status==='E'?'Elective':'Compulsory'}</td>
      <td>${esc(co.lecturer_name||'—')}</td><td>${co.credit_units}</td><td>${co.enrolled}</td><td>${co.session_count}</td>
      <td style="text-align:right"><button class="btn ghost sm" data-edit="${co.id}">Edit</button> <button class="btn ghost sm" data-del="${co.id}">Delete</button></td>`);
    tb.appendChild(tr);
  });
  if(!courses.length) tb.innerHTML='<tr><td colspan="9"><div class="empty">No courses yet.</div></td></tr>';
  panel.appendChild(tbl); c.appendChild(panel);
  tb.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>courseModal(lecturers, courses.find(x=>x.id==b.dataset.edit)));
  tb.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{ if(confirm('Delete course and its sessions?')){ await api('/courses/'+b.dataset.del,{method:'DELETE'}); toast('Deleted'); go('courses'); }});
};
function courseModal(lecturers, existing=null){
  const lecOpts=(selected)=>lecturers.map(l=>`<option value="${l.id}" ${selected===l.id?'selected':''}>${esc(l.name)}</option>`).join('');
  const coIds = existing ? existing.lecturers.slice(1).map(l=>l.id) : [];
  modal(existing?'Edit course':'Add course',`
    <div class="row2"><div class="field"><label class="f">Code</label><input id="c_code" placeholder="CSC 350" value="${esc(existing?.code||'')}"/></div>
    <div class="field"><label class="f">Units</label><input id="c_units" type="number" value="${existing?.credit_units??3}"/></div></div>
    <div class="field"><label class="f">Title</label><input id="c_title" placeholder="Software Engineering" value="${esc(existing?.title||'')}"/></div>
    <div class="row2"><div class="field"><label class="f">Alias / cross-listed code</label><input id="c_alias" placeholder="e.g. CSC 302" value="${esc(existing?.alias||'')}"/></div>
    <div class="field"><label class="f">Level</label><input id="c_level" type="number" step="100" placeholder="e.g. 300" value="${existing?.level??''}"/></div></div>
    <div class="field"><label class="f">Status</label><select id="c_status"><option value="C" ${existing?.status!=='E'?'selected':''}>Compulsory</option><option value="E" ${existing?.status==='E'?'selected':''}>Elective</option></select></div>
    <div class="field"><label class="f">Lead lecturer</label><select id="c_lec"><option value="">— unassigned —</option>${lecOpts(existing?.lecturers?.[0]?.id)}</select></div>
    <div class="field"><label class="f">Co-lecturer(s)</label><select id="c_co" multiple size="4">${lecturers.map(l=>`<option value="${l.id}" ${coIds.includes(l.id)?'selected':''}>${esc(l.name)}</option>`).join('')}</select></div>
  `, async()=>{
    const body = { code:$('#c_code').value.trim(), title:$('#c_title').value.trim(), credit_units:+$('#c_units').value,
      alias:$('#c_alias').value.trim()||null, level:$('#c_level').value?+$('#c_level').value:null, status:$('#c_status').value,
      lecturer_id:$('#c_lec').value?+$('#c_lec').value:null, co_lecturer_ids:[...$('#c_co').selectedOptions].map(o=>+o.value) };
    const r = existing ? await api('/courses/'+existing.id,{method:'PATCH',body}) : await api('/courses',{method:'POST',body});
    closeModal();
    if (r.session_conflicts?.length) toast(`Saved, but ${r.session_conflicts.length} existing session(s) now conflict — check Scheduling.`, true);
    else toast(existing?'Course updated':'Course added');
    go('courses');
  }, existing?'Save changes':'Add course');
}

/* ---- admin: rooms ---- */
function roomModal(existing=null){
  modal(existing?'Edit room':'Add room',`
    <div class="field"><label class="f">Room name</label><input id="r_name" placeholder="LT 2" value="${esc(existing?.name||'')}"/></div>
    <div class="field"><label class="f">Building</label><input id="r_bld" placeholder="Main Block" value="${esc(existing?.building||'')}"/></div>
    <div class="field"><label class="f">Capacity</label><input id="r_cap" type="number" placeholder="60" value="${existing?.capacity??''}"/></div>
  `, async()=>{
    const body={name:$('#r_name').value.trim(),building:$('#r_bld').value.trim(),capacity:+$('#r_cap').value||0};
    if(existing) await api('/rooms/'+existing.id,{method:'PATCH',body}); else await api('/rooms',{method:'POST',body});
    closeModal(); toast(existing?'Room updated':'Room added'); go('rooms');
  }, existing?'Save changes':'Add room');
}
views.rooms = async () => {
  const c=page('Rooms','Teaching spaces available for scheduling.');
  const rooms=await api('/rooms');
  const head=el('div',null,'<button class="btn primary" id="newRoom">+ Add room</button>'); head.style.marginBottom='18px';
  $('#newRoom',head).onclick=()=>roomModal();
  c.appendChild(head);
  const panel=el('div','panel'); const tbl=el('table',null,`<thead><tr><th>Name</th><th>Building</th><th>Capacity</th><th></th></tr></thead><tbody></tbody>`); const tb=$('tbody',tbl);
  rooms.forEach(r=>tb.appendChild(el('tr',null,`<td><b>${esc(r.name)}</b></td><td>${esc(r.building||'—')}</td><td>${r.capacity}</td><td style="text-align:right"><button class="btn ghost sm" data-edit="${r.id}">Edit</button> <button class="btn ghost sm" data-del="${r.id}">Delete</button></td>`)));
  if(!rooms.length) tb.innerHTML='<tr><td colspan="4"><div class="empty">No rooms yet.</div></td></tr>';
  panel.appendChild(tbl); c.appendChild(panel);
  tb.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>roomModal(rooms.find(x=>x.id==b.dataset.edit)));
  tb.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{ try{ await api('/rooms/'+b.dataset.del,{method:'DELETE'}); toast('Deleted'); go('rooms'); }catch(e){ toast(e.message,true); }});
};

/* ---- admin: users ---- */
views.users = async () => {
  const c=page('Users','All accounts that can sign in.');
  const users=await api('/users');
  const head=el('div',null,'<button class="btn primary" id="newUser">+ Add user</button>'); head.style.marginBottom='18px';
  $('#newUser',head).onclick=()=>modal('Add user',`
    <div class="field"><label class="f">Full name</label><input id="u_name"/></div>
    <div class="field"><label class="f">Email</label><input id="u_email" type="email"/></div>
    <div class="field"><label class="f">Password</label><input id="u_pass" type="password"/></div>
    <div class="field"><label class="f">Role</label><select id="u_role"><option value="student">Student</option><option value="lecturer">Lecturer</option><option value="admin">Admin</option></select></div>
  `, async()=>{ await api('/users',{method:'POST',body:{name:$('#u_name').value.trim(),email:$('#u_email').value.trim(),password:$('#u_pass').value,role:$('#u_role').value}}); closeModal(); toast('User created'); go('users'); },'Create user');
  c.appendChild(head);
  const panel=el('div','panel'); const tbl=el('table',null,`<thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody></tbody>`); const tb=$('tbody',tbl);
  users.forEach(u=>{
    const me=u.id===state.user.id;
    const tr=el('tr',null,`<td><b>${esc(u.name)}</b>${me?' <span class="muted">(you)</span>':''}</td><td class="muted">${esc(u.email)}</td>
      <td><select data-role="${u.id}" ${me?'disabled':''}>${['student','lecturer','admin'].map(r=>`<option value="${r}" ${u.role===r?'selected':''}>${r[0].toUpperCase()+r.slice(1)}</option>`).join('')}</select></td>
      <td style="text-align:right"><button class="btn ghost sm" data-reset="${u.id}">Reset password</button> ${me?'':`<button class="btn ghost sm" data-del="${u.id}">Remove</button>`}</td>`);
    tb.appendChild(tr);
  });
  panel.appendChild(tbl); c.appendChild(panel);
  tb.querySelectorAll('[data-role]').forEach(s=>s.onchange=async()=>{ try{ await api('/users/'+s.dataset.role,{method:'PATCH',body:{role:s.value}}); toast('Role updated'); }catch(e){ toast(e.message,true); go('users'); }});
  tb.querySelectorAll('[data-reset]').forEach(b=>b.onclick=()=>modal('Reset password',
    `<div class="field"><label class="f">New password</label><input id="u_newpass" type="password" placeholder="min 6 characters"/></div>`,
    async()=>{ await api('/users/'+b.dataset.reset,{method:'PATCH',body:{password:$('#u_newpass').value}}); closeModal(); toast('Password reset'); },'Reset'));
  tb.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{ if(confirm('Remove this user?')){ try{ await api('/users/'+b.dataset.del,{method:'DELETE'}); toast('Removed'); go('users'); }catch(e){ toast(e.message,true); }}});
};

/* ---- admin: audit ---- */
views.audit = async () => {
  const c=page('Activity log','Recent actions across the system.');
  const log=await api('/audit');
  const panel=el('div','panel'); const tbl=el('table',null,`<thead><tr><th>When</th><th>User</th><th>Action</th><th>Detail</th></tr></thead><tbody></tbody>`); const tb=$('tbody',tbl);
  log.forEach(a=>tb.appendChild(el('tr',null,`<td class="muted">${esc(a.created_at)}</td><td>${esc(a.user_name||'—')}</td><td><span class="pill">${esc(a.action)}</span></td><td class="muted">${esc(a.detail||'')}</td>`)));
  if(!log.length) tb.innerHTML='<tr><td colspan="4"><div class="empty">No activity yet.</div></td></tr>';
  panel.appendChild(tbl); c.appendChild(panel);
};

/* ---- lecturer: my courses ---- */
views.mycourses = async () => {
  const c=page('My courses','Courses you are assigned to teach.');
  const courses=(await api('/courses')).filter(co=>co.lecturers.some(l=>l.id===state.user.id));
  const panel=el('div','panel'); const tbl=el('table',null,`<thead><tr><th>Code</th><th>Title</th><th>Your role</th><th>Enrolled</th><th>Sessions</th></tr></thead><tbody></tbody>`); const tb=$('tbody',tbl);
  courses.forEach(co=>tb.appendChild(el('tr',null,`<td><b>${esc(co.code)}</b></td><td>${esc(co.title)}</td><td>${co.lecturers[0].id===state.user.id?'Lead':'Co-lecturer'}</td><td>${co.enrolled}</td><td>${co.session_count}</td>`)));
  if(!courses.length) tb.innerHTML='<tr><td colspan="4"><div class="empty">No courses assigned to you.</div></td></tr>';
  panel.appendChild(tbl); c.appendChild(panel);
};

/* ---- lecturer: availability ---- */
views.availability = async () => {
  const c=page('Availability','Mark times you are unavailable. Scheduling will refuse to book you then.');
  const blocks=await api('/availability');
  const head=el('div',null,'<button class="btn primary" id="newBlk">+ Add unavailable block</button>'); head.style.marginBottom='18px';
  let times=''; for(let t=DAY_START;t<=DAY_END;t+=STEP) times+=`<option value="${t}">${fmt(t)}</option>`;
  $('#newBlk',head).onclick=()=>modal('Unavailable block',`
    <div class="field"><label class="f">Day</label><select id="a_day">${DAYS.map((d,i)=>`<option value="${i}">${d}</option>`).join('')}</select></div>
    <div class="row2"><div class="field"><label class="f">From</label><select id="a_from">${times}</select></div>
    <div class="field"><label class="f">To</label><select id="a_to">${times}</select></div></div>
  `, async()=>{ await api('/availability',{method:'POST',body:{day_of_week:+$('#a_day').value,start_min:+$('#a_from').value,end_min:+$('#a_to').value}}); closeModal(); toast('Saved'); go('availability'); },'Save');
  c.appendChild(head);
  const panel=el('div','panel'); const tbl=el('table',null,`<thead><tr><th>Day</th><th>From</th><th>To</th><th></th></tr></thead><tbody></tbody>`); const tb=$('tbody',tbl);
  blocks.forEach(b=>tb.appendChild(el('tr',null,`<td>${DAYS[b.day_of_week]}</td><td>${fmt(b.start_min)}</td><td>${fmt(b.end_min)}</td><td style="text-align:right"><button class="btn ghost sm" data-del="${b.id}">Remove</button></td>`)));
  if(!blocks.length) tb.innerHTML='<tr><td colspan="4"><div class="empty">You are available all week.</div></td></tr>';
  panel.appendChild(tbl); c.appendChild(panel);
  tb.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{ await api('/availability/'+b.dataset.del,{method:'DELETE'}); toast('Removed'); go('availability'); });
};

/* ---- student: catalogue ---- */
views.catalogue = async () => {
  const c=page('Course catalogue','Enrol in courses to build your timetable.');
  const [courses, mine]=await Promise.all([api('/courses'), api('/enrollments')]);
  const enrolledIds=new Set(mine.map(m=>m.course_id));
  const panel=el('div','panel'); const tbl=el('table',null,`<thead><tr><th>Code</th><th>Title</th><th>Lecturer</th><th>Units</th><th></th></tr></thead><tbody></tbody>`); const tb=$('tbody',tbl);
  courses.forEach(co=>{
    const enrolled=enrolledIds.has(co.id);
    const tr=el('tr',null,`<td><b>${esc(co.code)}</b></td><td>${esc(co.title)}</td><td>${esc(co.lecturer_name||'—')}</td><td>${co.credit_units}</td>
      <td style="text-align:right">${enrolled?`<button class="btn ghost sm" data-drop="${co.id}">Drop</button>`:`<button class="btn sm" data-add="${co.id}">Enrol</button>`}</td>`);
    tb.appendChild(tr);
  });
  panel.appendChild(tbl); c.appendChild(panel);
  tb.querySelectorAll('[data-add]').forEach(b=>b.onclick=async()=>{
    const r=await api('/enrollments',{method:'POST',body:{course_id:+b.dataset.add}});
    if (r.warnings?.length) toast('Enrolled — but: '+r.warnings.map(w=>w.message).join(' '), true);
    else toast('Enrolled');
    go('catalogue');
  });
  tb.querySelectorAll('[data-drop]').forEach(b=>b.onclick=async()=>{ await api('/enrollments/'+b.dataset.drop,{method:'DELETE'}); toast('Dropped'); go('catalogue'); });
};

/* ---------- boot ---------- */
(async function boot(){
  if (state.token){
    try{ const { user } = await api('/auth/me'); startSession(state.token, user); }
    catch{ logout(); }
  }
})();
