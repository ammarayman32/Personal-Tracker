/* ---------- Config ---------- */
const KEY = 'questlog:v1';
const CATS = ['Main Quest', 'Daily Quest', 'College', 'Personal'];
const XPD = {'Main Quest': 50, 'Daily Quest': 10, 'College': 20, 'Personal': 15}; // default XP per category
const GOAL = 20; // Quran pages per day
const QUOTES = ['Small steps, every day.', 'Discipline beats motivation.', 'One quest at a time.', 'Consistency builds legends.', 'Make today count.'];

/* LEVEL FORMULA: level = floor(sqrt(totalXP / 100)) + 1.
   Level L starts at 100 * (L-1)^2 XP: L1=0, L2=100, L3=400, L4=900, ... */
const levelInfo = xp => {
  const lvl = Math.floor(Math.sqrt(xp / 100)) + 1, lo = 100 * (lvl - 1) ** 2, hi = 100 * lvl ** 2;
  return {lvl, lo, hi, pct: (xp - lo) / (hi - lo) * 100};
};

/* ---------- Dates (local calendar dates, "YYYY-MM-DD") ---------- */
const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => dstr(new Date());
const pd = s => { const [a, b, c] = s.split('-').map(Number); return new Date(a, b - 1, c); };
const longDate = s => pd(s).toLocaleDateString(undefined, {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'});
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);

/* ---------- Supabase ----------
   SUPABASE_URL / SUPABASE_ANON_KEY live in config.js. The anon key is safe in front-end code only
   because Row Level Security (supabase.sql) restricts every row to its signed-in owner.
   Client-side shapes: tasks {id,title,desc,category,date,xp,done,xpAwarded,completedOn,pos},
   habits {id,name,pos}, habitLog {date:[habitId]}, quran {date:{pages,done}}.
   XP is never stored as a running total: total = sum of xpAwarded over completed tasks. */
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let me = null; // signed-in user id
const uid = () => crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
const taskFromRow = r => ({id: r.id, title: r.title, desc: r.description || '', category: CATS.includes(r.category) ? r.category : 'Personal', date: r.date, xp: r.xp, done: r.done, xpAwarded: r.done ? r.xp_awarded : 0, completedOn: r.done ? r.completed_on : null, pos: r.position});
const taskToRow = t => ({title: t.title, description: t.desc, category: t.category, date: t.date, xp: t.xp, done: t.done, xp_awarded: t.xpAwarded, completed_on: t.completedOn});
const ORDER = {tasks: ['id'], habits: ['id'], habit_log: ['habit_id', 'date'], quran_log: ['date']}; // unique sort keys per table
async function fetchAll(table) { // Supabase returns max 1000 rows per request, so page through
  let out = [], from = 0;
  for (;;) {
    let q = sb.from(table).select('*'); ORDER[table].forEach(c => { q = q.order(c); });
    const {data, error} = await q.range(from, from + 999);
    if (error) throw error;
    out = out.concat(data); if (data.length < 1000) return out; from += 1000;
  }
}
async function loadAll() {
  const [tasks, habits, hl, ql] = await Promise.all(['tasks', 'habits', 'habit_log', 'quran_log'].map(fetchAll));
  S = {tasks: tasks.map(taskFromRow).sort((a, b) => a.pos - b.pos), habits: habits.map(h => ({id: h.id, name: h.name, pos: h.position})).sort((a, b) => a.pos - b.pos), habitLog: {}, quran: {}};
  hl.forEach(r => (S.habitLog[r.date] || (S.habitLog[r.date] = [])).push(r.habit_id));
  ql.forEach(r => { S.quran[r.date] = {pages: r.pages, done: r.done}; });
}
function toast(m) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 3500); }
async function run(p) { // run a write; on failure, reload the true state from the server
  const {error} = await p;
  if (error) { console.error(error); toast('Could not save. Reloading from server…'); try { await loadAll(); } catch (e) {} render(); }
}
const nextPos = a => a.reduce((m, x) => Math.max(m, x.pos), 0) + 1;

let S = {tasks: [], habits: [], habitLog: {}, quran: {}}, view = 'dash', cat = 'All', tDate = today(), hDate = today(), curDay = today();

/* ---------- Helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const totalXP = () => S.tasks.reduce((a, t) => a + (t.done ? t.xpAwarded : 0), 0);
const dayTasks = d => S.tasks.filter(t => t.date === d);
const hDone = d => (S.habitLog[d] || []).filter(id => S.habits.some(h => h.id === id));
const qp = d => (S.quran[d] && +S.quran[d].pages) || 0;
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const bar = p => `<div class="bar"><i style="width:${Math.min(100, Math.max(0, p))}%"></i></div>`;
const greet = () => { const h = new Date().getHours(); return (h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening') + ', adventurer'; };

/* ---------- Components ---------- */
function taskRow(t) {
  return `<li class="task ${t.done ? 'done' : ''}" data-id="${t.id}"><button class="grip" data-drag aria-label="Drag to reorder" title="Drag to reorder">⠿</button><button class="chk" data-a="tt" data-id="${t.id}" aria-label="Toggle complete">${t.done ? '✓' : ''}</button>
  <div class="tb"><div class="tt">${esc(t.title)}</div>${t.desc ? `<div class="mut sm">${esc(t.desc)}</div>` : ''}
  <div class="tags"><span class="tag">${t.category}</span><span class="tag xp">+${t.xp} XP</span></div></div>
  <div class="acts"><button class="ic" data-a="te" data-id="${t.id}" title="Edit">✏️</button><button class="ic" data-a="td" data-id="${t.id}" title="Delete">🗑️</button></div></li>`;
}
const taskList = ts => ts.length
  ? `<ul class="list" data-sort="tasks">${ts.map(taskRow).join('')}</ul>`
  : `<div class="empty">No quests here yet. Add one to start earning XP.</div>`;

function quranCard(d) {
  const p = qp(d), done = !!(S.quran[d] && S.quran[d].done);
  return `<section class="card"><div class="row"><h2>📖 Quran · ${p}/${GOAL} pages</h2><span class="mut">${pct(p, GOAL)}%</span></div>${bar(pct(p, GOAL))}
  <p class="mut sm">${GOAL - p} pages remaining · 4 pages after each of the five prayers</p>
  <div class="row gap" style="margin-top:8px"><button class="btn" data-a="qd" data-d="${d}">−1</button><button class="btn" data-a="qi" data-d="${d}">+1</button>
  <button class="btn" data-a="q4" data-d="${d}">+4 pages</button>
  <button class="btn pri" data-a="qc" data-d="${d}" ${p < GOAL || done ? 'disabled' : ''}>${done ? '✓ Goal completed' : 'Mark goal complete'}</button></div></section>`;
}

/* ---------- Views ---------- */
function dashV() {
  const t = today(), ts = dayTasks(t), td = ts.filter(x => x.done).length, xp = totalXP(), L = levelInfo(xp), hs = hDone(t).length, hn = S.habits.length;
  return `<section class="card hero"><div><div class="mut">${longDate(t)}</div><h1>${greet()}</h1><p class="mut">${QUOTES[pd(t).getDate() % QUOTES.length]}</p></div>
  <div class="lvl"><div class="row"><span class="big">Level ${L.lvl}</span><span class="mut">${xp} XP</span></div>${bar(L.pct)}<div class="mut sm">${L.hi - xp} XP to level ${L.lvl + 1}</div></div></section>
  <div class="grid"><section class="card"><div class="row"><h2>✅ Today's quests</h2><span class="mut">${td}/${ts.length}</span></div>${bar(pct(td, ts.length))}</section>
  <section class="card"><div class="row"><h2>🔁 Habits</h2><span class="mut">${hs}/${hn}</span></div>${bar(pct(hs, hn))}</section></div>
  ${quranCard(t)}
  <section class="card"><div class="row" style="margin-bottom:10px"><h2>Today's quests</h2><button class="btn pri" data-a="ta">+ Add quest</button></div>${taskList(ts)}</section>`;
}
function tasksV() {
  const all = dayTasks(tDate), ts = cat === 'All' ? all : all.filter(t => t.category === cat);
  return `<div class="row"><h2>Quests</h2><button class="btn pri" data-a="ta">+ Add quest</button></div>
  <div class="row gap" style="margin-top:12px"><input type="date" id="tdate" value="${tDate}"><button class="btn" data-a="tdy">Today</button><span class="mut sm">${all.filter(t => t.done).length}/${all.length} done</span></div>
  <div class="chips">${['All', ...CATS].map(c => `<button class="chip ${cat === c ? 'on' : ''}" data-a="cat" data-c="${c}">${c}</button>`).join('')}</div>${taskList(ts)}`;
}
function habitsV() {
  const t = today(), done = hDone(t);
  return `<div class="row"><h2>Habits · ${done.length}/${S.habits.length} today</h2><button class="btn pri" data-a="ha">+ Add habit</button></div>${bar(pct(done.length, S.habits.length))}
  ${S.habits.length ? `<ul class="list" data-sort="habits">${S.habits.map(h => { const on = done.includes(h.id); return `<li class="task ${on ? 'done' : ''}" data-id="${h.id}"><button class="grip" data-drag aria-label="Drag to reorder" title="Drag to reorder">⠿</button><button class="chk" data-a="ht" data-id="${h.id}" aria-label="Toggle habit">${on ? '✓' : ''}</button><div class="tb"><div class="tt">${esc(h.name)}</div></div><div class="acts"><button class="ic" data-a="he" data-id="${h.id}">✏️</button><button class="ic" data-a="hd" data-id="${h.id}">🗑️</button></div></li>`; }).join('')}</ul>` : '<div class="empty">No habits yet. Add your first one.</div>'}`;
}
function histV() {
  const d = hDate, ts = dayTasks(d), xp = S.tasks.filter(t => t.done && t.completedOn === d).reduce((a, t) => a + t.xpAwarded, 0), hd = hDone(d);
  return `<div class="row"><h2>History</h2><input type="date" id="hdate" value="${d}"></div><p class="mut">${longDate(d)}</p>
  <div class="grid"><div class="card"><div class="mut">XP earned</div><div class="big">+${xp}</div></div><div class="card"><div class="mut">Quran pages</div><div class="big">${qp(d)}/${GOAL}</div></div></div>
  <section class="card"><h3>Quests (${ts.filter(t => t.done).length}/${ts.length})</h3>${ts.length ? `<ul class="plain">${ts.map(t => `<li>${t.done ? '✅' : '⬜'} ${esc(t.title)} <span class="mut sm">· ${t.category} · ${t.xp} XP</span></li>`).join('')}</ul>` : '<p class="mut">No quests on this day.</p>'}</section>
  <section class="card"><h3>Habits (${hd.length}/${S.habits.length})</h3>${S.habits.length ? `<ul class="plain">${S.habits.map(h => `<li>${hd.includes(h.id) ? '✅' : '⬜'} ${esc(h.name)}</li>`).join('')}</ul>` : '<p class="mut">No habits.</p>'}</section>`;
}
function render() {
  const tabs = [['dash', 'Today'], ['tasks', 'Quests'], ['habits', 'Habits'], ['history', 'History']];
  $('#app').innerHTML = `<nav>${tabs.map(([k, n]) => `<button class="tab ${view === k ? 'on' : ''}" data-a="nav" data-v="${k}">${n}</button>`).join('')}<button class="tab" data-a="out" style="margin-left:auto">Sign out</button></nav>` +
    ({dash: dashV, tasks: tasksV, habits: habitsV, history: histV}[view])();
}

/* ---------- Dialog forms ---------- */
const dlg = $('#dlg');
function openDlg(kind, id, html) {
  dlg.innerHTML = `<form>${html}<div class="row end gap"><button type="button" class="btn" data-a="close">Cancel</button><button class="btn pri">Save</button></div></form>`;
  dlg.dataset.kind = kind; dlg.dataset.id = id || ''; dlg.showModal();
}
function taskForm(id) {
  const t = id ? S.tasks.find(x => x.id === id) : null;
  const x = t || {title: '', desc: '', category: 'Daily Quest', date: view === 'tasks' ? tDate : today(), xp: XPD['Daily Quest'], done: false};
  openDlg('task', id, `<h2>${t ? 'Edit' : 'New'} quest</h2>
  <label>Title<input name="title" required maxlength="100" value="${esc(x.title)}"></label>
  <label>Description (optional)<textarea name="desc" rows="2">${esc(x.desc)}</textarea></label>
  <div class="two"><label>Category<select name="category">${CATS.map(c => `<option ${c === x.category ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
  <label>Date<input type="date" name="date" required value="${x.date}"></label></div>
  <label>XP reward<input type="number" name="xp" min="0" max="1000" value="${x.xp}" ${x.done ? 'disabled' : ''}></label>
  ${x.done ? '<p class="mut sm">XP already earned stays unchanged. Undo completion to change the reward.</p>' : ''}`);
}
function habitForm(id) {
  const h = id ? S.habits.find(x => x.id === id) : null;
  openDlg('habit', id, `<h2>${h ? 'Edit' : 'New'} habit</h2><label>Name<input name="name" required maxlength="80" value="${h ? esc(h.name) : ''}"></label>`);
}
dlg.addEventListener('submit', e => {
  e.preventDefault();
  const f = new FormData(e.target), kind = dlg.dataset.kind, id = dlg.dataset.id;
  if (kind === 'task') {
    const title = (f.get('title') || '').trim(), date = f.get('date');
    if (!title || !isDate(date)) return;
    const base = {title, desc: (f.get('desc') || '').trim(), category: CATS.includes(f.get('category')) ? f.get('category') : 'Personal', date};
    const xp = Math.max(0, Math.min(1000, parseInt(f.get('xp')) || 0));
    const t = id && S.tasks.find(x => x.id === id);
    if (t) { Object.assign(t, base); if (!t.done) t.xp = xp; run(sb.from('tasks').update(taskToRow(t)).eq('id', t.id)); }
    else {
      const n = {id: uid(), ...base, xp, done: false, xpAwarded: 0, completedOn: null, pos: nextPos(S.tasks)};
      S.tasks.push(n); run(sb.from('tasks').insert({id: n.id, user_id: me, position: n.pos, ...taskToRow(n)}));
    }
  } else {
    const name = (f.get('name') || '').trim();
    if (!name) return;
    const h = id && S.habits.find(x => x.id === id);
    if (h) { h.name = name; run(sb.from('habits').update({name}).eq('id', h.id)); }
    else { const n = {id: uid(), name, pos: nextPos(S.habits)}; S.habits.push(n); run(sb.from('habits').insert({id: n.id, user_id: me, name, position: n.pos})); }
  }
  dlg.close(); render();
});

/* ---------- Actions ---------- */
const setQ = (d, p) => {
  p = Math.max(0, Math.min(GOAL, p));
  const q = S.quran[d] || (S.quran[d] = {pages: 0, done: false});
  q.pages = p; if (p < GOAL) q.done = false;
  render(); run(sb.from('quran_log').upsert({user_id: me, date: d, pages: q.pages, done: q.done}, {onConflict: 'user_id,date'}));
};
function moveItem(kind, id, refId, before) { // new position = midpoint between the new neighbours
  const arr = kind === 'habits' ? S.habits : S.tasks;
  reorder(arr, id, refId, before);
  const i = arr.findIndex(x => x.id === id), prev = arr[i - 1], next = arr[i + 1], it = arr[i];
  it.pos = prev && next ? (prev.pos + next.pos) / 2 : prev ? prev.pos + 1 : next ? next.pos - 1 : it.pos;
  run(sb.from(kind === 'habits' ? 'habits' : 'tasks').update({position: it.pos}).eq('id', id));
}
const A = {
  nav: (i, d, v) => { view = v; render(); },
  close: () => dlg.close(),
  retry: () => boot(),
  out: async () => { await sb.auth.signOut(); me = null; S = {tasks: [], habits: [], habitLog: {}, quran: {}}; loginV(); },
  ta: () => taskForm(null),
  te: id => taskForm(id),
  td: id => { if (confirm('Delete this quest? XP earned from it will be removed.')) { S.tasks = S.tasks.filter(t => t.id !== id); render(); run(sb.from('tasks').delete().eq('id', id)); } },
  tt: id => { // award XP once on completion, reverse it on undo
    const t = S.tasks.find(x => x.id === id); if (!t) return;
    if (t.done) { t.done = false; t.xpAwarded = 0; t.completedOn = null; }
    else { t.done = true; t.xpAwarded = t.xp; t.completedOn = today(); }
    render(); run(sb.from('tasks').update({done: t.done, xp_awarded: t.xpAwarded, completed_on: t.completedOn}).eq('id', id));
  },
  tdy: () => { tDate = today(); render(); },
  cat: (i, d, v, c) => { cat = c; render(); },
  ha: () => habitForm(null),
  he: id => habitForm(id),
  hd: id => { if (confirm('Delete this habit? Past records for it will no longer be shown.')) { S.habits = S.habits.filter(h => h.id !== id); render(); run(sb.from('habits').delete().eq('id', id)); } },
  ht: id => {
    const t = today(), log = S.habitLog[t] || [], on = log.includes(id);
    S.habitLog[t] = on ? log.filter(x => x !== id) : [...log, id]; render();
    run(on ? sb.from('habit_log').delete().eq('habit_id', id).eq('date', t) : sb.from('habit_log').insert({user_id: me, habit_id: id, date: t}));
  },
  qi: (i, d) => setQ(d, qp(d) + 1),
  qd: (i, d) => setQ(d, qp(d) - 1),
  q4: (i, d) => setQ(d, qp(d) + 4),
  qc: (i, d) => { if (qp(d) >= GOAL) { S.quran[d].done = true; render(); run(sb.from('quran_log').update({done: true}).eq('date', d)); } }
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const {a, id, d, v, c} = b.dataset; if (A[a]) A[a](id, d, v, c);
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'tdate') { tDate = isDate(el.value) ? el.value : today(); render(); }
  if (el.id === 'hdate') { hDate = isDate(el.value) ? el.value : today(); render(); }
  if (el.name === 'category' && dlg.dataset.kind === 'task' && !dlg.dataset.id) { const x = dlg.querySelector('[name=xp]'); if (x) x.value = XPD[el.value] || 10; }
});

/* ---------- Drag & drop reordering (pointer events: works with mouse and touch) ----------
   The order of S.tasks / S.habits IS the manual order. Quests are filtered by date/category
   for display, so a drop moves the item next to the target inside the full array. */
let dragging = false;
function reorder(arr, id, refId, before) {
  const from = arr.findIndex(x => x.id === id); if (from < 0) return;
  const [item] = arr.splice(from, 1);
  const to = arr.findIndex(x => x.id === refId);
  if (to < 0) { arr.splice(from, 0, item); return; }
  arr.splice(before ? to : to + 1, 0, item);
}
document.addEventListener('pointerdown', e => {
  const grip = e.target.closest('[data-drag]');
  if (!grip || dragging || (e.pointerType === 'mouse' && e.button !== 0)) return;
  e.preventDefault();
  const li = grip.closest('li'), list = li.parentElement, kind = list.dataset.sort;
  const others = [...list.children].filter(x => x !== li), startY = e.clientY;
  let drop = null;
  dragging = true; li.classList.add('dragging'); grip.setPointerCapture(e.pointerId);
  const clear = () => others.forEach(x => x.classList.remove('drop-before', 'drop-after'));
  const move = ev => {
    li.style.transform = `translateY(${ev.clientY - startY}px)`;
    clear(); drop = null;
    const ref = others.find(x => { const r = x.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
    if (ref) { drop = {id: ref.dataset.id, before: true}; ref.classList.add('drop-before'); }
    else if (others.length) { const last = others[others.length - 1]; drop = {id: last.dataset.id, before: false}; last.classList.add('drop-after'); }
  };
  const end = ev => {
    grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', end); grip.removeEventListener('pointercancel', end);
    dragging = false; clear(); li.classList.remove('dragging'); li.style.transform = '';
    if (ev.type === 'pointerup' && drop) { moveItem(kind, li.dataset.id, drop.id, drop.before); render(); }
  };
  grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
});

/* Roll over at midnight: only the "today" views move; old records are untouched */
setInterval(() => {
  const n = today(); if (n === curDay || !me) return;
  if (tDate === curDay) tDate = n; if (hDate === curDay) hDate = n;
  curDay = n; if (!dlg.open && !dragging) render();
}, 30000);

/* ---------- Login & startup ---------- */
function loginV(msg) {
  $('#app').innerHTML = `<section class="card" style="max-width:360px;margin:12vh auto"><h1>⚔️ QuestLog</h1><p class="mut">Sign in to continue</p>
  <form id="login"><label>Email<input name="email" type="email" required autocomplete="username"></label>
  <label>Password<input name="password" type="password" required autocomplete="current-password"></label>
  ${msg ? `<p style="color:var(--bad)">${esc(msg)}</p>` : ''}<div class="row end"><button class="btn pri">Sign in</button></div></form></section>`;
}
document.addEventListener('submit', async e => {
  if (e.target.id !== 'login') return;
  e.preventDefault();
  const f = new FormData(e.target);
  const {error} = await sb.auth.signInWithPassword({email: f.get('email'), password: f.get('password')});
  if (error) loginV(error.message); else boot();
});
async function boot() {
  $('#app').innerHTML = '<p class="mut" style="text-align:center;margin-top:20vh">Loading…</p>';
  const {data: {session}} = await sb.auth.getSession();
  if (!session) return loginV();
  me = session.user.id;
  try { await loadAll(); render(); }
  catch (e) { console.error(e); $('#app').innerHTML = `<div class="card"><p>Could not load data: ${esc(e.message || e)}</p><button class="btn" data-a="retry">Retry</button></div>`; }
}
// Refresh when you come back to the app (e.g. after using it on another device)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && me && !dlg.open && !dragging) loadAll().then(render).catch(() => {});
});
boot();