'use strict';

// ================= cards & rules =================
const COLORS = ['R', 'B', 'G', 'Y'];
const TRUMP = 'R';
const COLOR_NAME = { R: 'أحمر', Y: 'أصفر', G: 'أخضر', B: 'أزرق' };
const PREFIX = 'uno400-lb-';
const WIN_SCORE = 41;
const label = r => (r <= 9 ? String(r) : r === 10 ? '⊘' : r === 11 ? '⇄' : '+2');
// strength: 1 = ace (آص), skip = king (ري), +2 = queen (بنت), reverse = jack (شب), 0 = ten, then 9..2
const POW = [10, 14, 2, 3, 4, 5, 6, 7, 8, 9, 13, 11, 12];
const FACE = { 1: 'A', 10: 'K', 12: 'Q', 11: 'J', 0: '10' };
const pw = c => POW[c.r];
const face = r => FACE[r] || String(r);
const cid = c => c.c + c.r;
const partnerOf = s => (s + 2) % 4;
const bidPoints = b => (b >= 5 ? b * 2 : b);
const minTotalFor = scores => { const m = Math.max(...scores); return m >= 40 ? 13 : m >= 30 ? 12 : 11; };

function newDeck() {
  const d = [];
  for (const c of COLORS) for (let r = 0; r < 13; r++) d.push({ c, r });
  for (let i = d.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}
const ALL = COLORS.flatMap(c => Array.from({ length: 13 }, (_, r) => ({ c, r })));
const sortHand = h => h.slice().sort((a, b) => COLORS.indexOf(a.c) - COLORS.indexOf(b.c) || pw(b) - pw(a));
const beats = (a, b) => (a.c === b.c ? pw(a) > pw(b) : a.c === TRUMP);
function trickWinner(trick) {
  let best = trick[0];
  for (const t of trick.slice(1)) if (beats(t.card, best.card)) best = t;
  return best.seat;
}
function legalCards(hand, trick) {
  if (!trick.length) return hand;
  const led = trick[0].card.c;
  const follow = hand.filter(c => c.c === led);
  return follow.length ? follow : hand;
}

// ================= host engine =================
let G = null;              // authoritative game (host only)
let timers = [];

function freshGame() {
  return {
    phase: 'lobby', seats: [null, null, null, null], scores: [0, 0, 0, 0], dealer: 3,
    hands: [[], [], [], []], bids: [null, null, null, null], tricks: [0, 0, 0, 0],
    turn: 0, trick: [], lastTrick: null, round: 0, msg: '', lastRound: null, winner: null, clearing: false,
  };
}

function startRound() {
  G.round++;
  G.dealer = (G.dealer + 1) % 4;
  const deck = newDeck();
  G.hands = [0, 1, 2, 3].map(s => deck.slice(s * 13, s * 13 + 13));
  G.bids = [null, null, null, null];
  G.tricks = [0, 0, 0, 0];
  G.trick = []; G.lastTrick = null; G.clearing = false;
  G.played = []; G.voids = [[], [], [], []];
  G.turn = (G.dealer + 1) % 4;
  G.phase = 'bidding';
  G.msg = `الجولة ${G.round} — الطلب`;
}

function newGame() {
  G.scores = [0, 0, 0, 0]; G.dealer = 3; G.round = 0; G.winner = null; G.lastRound = null;
  startRound();
}

function placeBid(seat, v) {
  if (G.phase !== 'bidding' || G.turn !== seat) return 'مش دورك';
  v = Math.round(v);
  if (!(v >= 2 && v <= 13)) return 'الطلب لازم يكون بين 2 و13';
  G.bids[seat] = v;
  G.turn = (G.turn + 1) % 4;
  if (G.bids.every(b => b !== null)) {
    const total = G.bids.reduce((a, b) => a + b, 0), need = minTotalFor(G.scores);
    if (total < need) {
      G.msg = `مجموع الطلبات ${total} أقل من ${need} — منعيد التوزيع`;
      G.phase = 'redeal';
      later(() => { startRound(); changed(); }, 2200);
    } else {
      G.phase = 'playing';
      G.turn = (G.dealer + 1) % 4;
      G.msg = `مجموع الطلبات ${total}`;
    }
  }
  return null;
}

function playCard(seat, id) {
  if (G.phase !== 'playing' || G.clearing || G.turn !== seat) return 'مش دورك';
  const hand = G.hands[seat];
  const card = hand.find(c => cid(c) === id);
  if (!card) return 'ورقة غلط';
  if (!legalCards(hand, G.trick).includes(card)) return `لازم تلحق اللون ${COLOR_NAME[G.trick[0].card.c]}`;
  G.hands[seat] = hand.filter(c => c !== card);
  if (G.trick.length && card.c !== G.trick[0].card.c && !G.voids[seat].includes(G.trick[0].card.c)) G.voids[seat].push(G.trick[0].card.c);
  G.played.push(cid(card));
  G.trick.push({ seat, card });
  if (G.trick.length < 4) { G.turn = (G.turn + 1) % 4; return null; }

  const w = trickWinner(G.trick);
  G.tricks[w]++;
  G.lastTrick = { cards: G.trick.slice(), winner: w };
  G.clearing = true;
  G.turn = w;
  G.msg = `الأكلة لـ ${seatName(w)}`;
  later(() => {
    G.trick = []; G.clearing = false;
    if (G.hands.every(h => h.length === 0)) endRound();
    changed();
  }, 1400);
  return null;
}

function endRound() {
  const deltas = G.bids.map((b, s) => (G.tricks[s] >= b ? bidPoints(b) : -bidPoints(b)));
  deltas.forEach((d, s) => { G.scores[s] += d; });
  G.lastRound = { bids: G.bids.slice(), tricks: G.tricks.slice(), deltas };
  const q = team => { const [a, b] = team.map(s => G.scores[s]); return (a >= WIN_SCORE && b > 0) || (b >= WIN_SCORE && a > 0); };
  const t0 = q([0, 2]), t1 = q([1, 3]);
  if (t0 || t1) {
    const s0 = G.scores[0] + G.scores[2], s1 = G.scores[1] + G.scores[3];
    G.winner = t0 && t1 ? (s0 >= s1 ? 0 : 1) : t0 ? 0 : 1;
    G.phase = 'gameOver';
  } else {
    G.phase = 'roundEnd';
  }
}

const seatName = s => (G.seats[s] ? G.seats[s].name : '—');

// ---------- bots ----------
// Bots sample the hidden hands many times (respecting known voids), play each
// sample out with a fast card-counting policy, and pick the move with the best
// average team result.
const rnd = n => Math.floor(Math.random() * n);
const now = () => performance.now();
// cheaper-to-spend first: non-trumps before trumps, then low before high
const cheaper = (a, b) => (a.c === TRUMP) - (b.c === TRUMP) || pw(a) - pw(b);
const cheapest = cs => cs.reduce((m, c) => (cheaper(c, m) < 0 ? c : m));

function dealHidden(me, unknown, counts, voids) {
  for (let attempt = 0; attempt < 25; attempt++) {
    const hands = [[], [], [], []], need = counts.slice();
    need[me] = 0;
    const cards = unknown.slice();
    for (let i = cards.length - 1; i > 0; i--) { const j = rnd(i + 1); [cards[i], cards[j]] = [cards[j], cards[i]]; }
    const takers = c => [0, 1, 2, 3].filter(s => s !== me && !voids[s].includes(c.c));
    cards.sort((a, b) => takers(a).length - takers(b).length);
    let ok = true;
    for (const c of cards) {
      const o = takers(c).filter(s => need[s] > 0);
      if (!o.length) { ok = false; break; }
      let k = Math.random() * o.reduce((x, s) => x + need[s], 0), s = o[0];
      for (const x of o) { k -= need[x]; if (k < 0) { s = x; break; } }
      hands[s].push(c); need[s]--;
    }
    if (ok) return hands;
  }
  const hands = [[], [], [], []], cards = unknown.slice().sort(() => Math.random() - 0.5);
  let i = 0;
  for (let s = 0; s < 4; s++) if (s !== me) for (let k = 0; k < counts[s]; k++) hands[s].push(cards[i++]);
  return hands;
}

function topOf(hands, color, except) {
  let best = -1;
  for (let s = 0; s < 4; s++) if (s !== except) for (const c of hands[s]) if (c.c === color && pw(c) > best) best = pw(c);
  return best;
}

function policyCard(s, hands, trick) {
  const hand = hands[s], legal = legalCards(hand, trick);
  if (legal.length === 1) return legal[0];
  const p = partnerOf(s);
  if (!trick.length) {
    const oppTrump = hands[(s + 1) % 4].some(c => c.c === TRUMP) || hands[(s + 3) % 4].some(c => c.c === TRUMP);
    const masters = legal.filter(c => pw(c) > topOf(hands, c.c, s) && (c.c === TRUMP || !oppTrump || !voidOpp(hands, s, c.c)));
    const side = masters.filter(c => c.c !== TRUMP);
    if (side.length) return side[0];
    if (masters.length && oppTrump) return masters[0];
    const byLen = {};
    for (const c of legal) if (c.c !== TRUMP) (byLen[c.c] = byLen[c.c] || []).push(c);
    const suits = Object.values(byLen);
    if (!suits.length) return cheapest(legal);
    suits.sort((a, b) => b.length - a.length);
    return cheapest(suits[0]);
  }
  let w = trick[0];
  for (const t of trick) if (beats(t.card, w.card)) w = t;
  const later = [1, 2, 3].map(k => (s + k) % 4).slice(0, 3 - trick.length);
  const canBeat = (card, seats) => seats.some(x => legalCards(hands[x], trick).some(c => beats(c, card)));
  if (w.seat === p && !canBeat(w.card, later.filter(x => x !== p))) return cheapest(legal);
  const winners = legal.filter(c => beats(c, w.card));
  if (winners.length) {
    const opps = later.filter(x => x !== p);
    const safe = winners.filter(c => !canBeat(c, opps));
    return cheapest(safe.length ? safe : winners);
  }
  return cheapest(legal);
}

function voidOpp(hands, s, color) {
  return [(s + 1) % 4, (s + 3) % 4].some(x => hands[x].length && !hands[x].some(c => c.c === color));
}

function playOut(hands, trick, tricks, turn) {
  hands = hands.map(h => h.slice()); trick = trick.slice(); tricks = tricks.slice();
  for (;;) {
    if (trick.length === 4) {
      let w = trick[0];
      for (const t of trick) if (beats(t.card, w.card)) w = t;
      tricks[w.seat]++; trick = []; turn = w.seat;
      if (!hands[turn].length) return tricks;
    }
    const c = policyCard(turn, hands, trick);
    hands[turn].splice(hands[turn].indexOf(c), 1);
    trick.push({ seat: turn, card: c });
    turn = (turn + 1) % 4;
  }
}

function teamValue(seat, tricks, bids) {
  let v = 0;
  for (let s = 0; s < 4; s++) {
    const pts = tricks[s] >= bids[s] ? bidPoints(bids[s]) : -bidPoints(bids[s]);
    v += (s % 2 === seat % 2 ? 1 : -1) * pts;
  }
  return v + 0.05 * (tricks[seat] + tricks[partnerOf(seat)]);
}

function botCard(seat) {
  const hand = G.hands[seat], legal = legalCards(hand, G.trick);
  if (legal.length === 1) return legal[0];
  const known = new Set([...G.played, ...hand.map(cid)]);
  const unknown = ALL.filter(c => !known.has(cid(c)));
  const counts = G.hands.map(h => h.length);
  const score = legal.map(() => 0);
  const t0 = now();
  for (let n = 0; n < 600 && (n < 30 || now() - t0 < 300); n++) {
    const hands = dealHidden(seat, unknown, counts, G.voids);
    hands[seat] = hand;
    legal.forEach((c, i) => {
      const h = hands.slice(); h[seat] = hand.filter(x => x !== c);
      const tricks = playOut(h, [...G.trick, { seat, card: c }], G.tricks, (seat + 1) % 4);
      score[i] += teamValue(seat, tricks, G.bids);
    });
  }
  let best = 0;
  for (let i = 1; i < legal.length; i++) if (score[i] > score[best] + 1e-9 || (Math.abs(score[i] - score[best]) < 1e-9 && cheaper(legal[i], legal[best]) < 0)) best = i;
  return legal[best];
}

function botBid(seat) {
  const hand = G.hands[seat];
  const mine = new Set(hand.map(cid));
  const unknown = ALL.filter(c => !mine.has(cid(c)));
  const dist = new Array(14).fill(0), noVoids = [[], [], [], []];
  let n = 0;
  const t0 = now();
  for (; n < 800 && (n < 60 || now() - t0 < 350); n++) {
    const hands = dealHidden(seat, unknown, [13, 13, 13, 13], noVoids);
    hands[seat] = hand;
    dist[playOut(hands, [], [0, 0, 0, 0], (G.dealer + 1) % 4)[seat]]++;
  }
  const atLeast = b => dist.slice(b).reduce((x, y) => x + y, 0) / n;
  const ev = b => { const p = atLeast(b); return (2 * p - 1) * bidPoints(b); };
  let bid = 2;
  for (let b = 3; b <= 13; b++) if (ev(b) > ev(bid)) bid = b;
  const placed = G.bids.filter(b => b !== null);
  if (placed.length === 3) {
    const need = minTotalFor(G.scores) - placed.reduce((a, b) => a + b, 0);
    if (bid < need && need <= 13 && ev(need) > -1.5) bid = need;
  }
  return bid;
}

function botAct() {
  if (!G || G.clearing) return;
  const s = G.turn, seat = G.seats[s];
  if (!seat || seat.kind !== 'bot') return;
  if (G.phase === 'bidding') placeBid(s, botBid(s));
  else if (G.phase === 'playing') playCard(s, cid(botCard(s)));
  changed();
}

function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
let botTimer = null;
function changed() {
  broadcast();
  clearTimeout(botTimer);
  if (G && (G.phase === 'bidding' || G.phase === 'playing') && !G.clearing) {
    const seat = G.seats[G.turn];
    if (seat && seat.kind === 'bot') botTimer = setTimeout(botAct, G.phase === 'bidding' ? 700 : 850);
  }
}

// ---------- views ----------
function viewFor(s) {
  return {
    phase: G.phase, round: G.round, dealer: G.dealer, turn: G.turn, msg: G.msg,
    seats: G.seats.map(x => x && { name: x.name, kind: x.kind, on: x.kind !== 'human' || x.connected, peerId: x.peerId || null, mic: !!x.mic }),
    scores: G.scores, bids: G.bids, tricks: G.tricks, trick: G.trick, lastTrick: G.lastTrick,
    counts: G.hands.map(h => h.length), lastRound: G.lastRound, winner: G.winner, clearing: G.clearing,
    minTotal: minTotalFor(G.scores), you: s, hand: sortHand(G.hands[s] || []),
    legal: G.phase === 'playing' && G.turn === s && !G.clearing ? legalCards(G.hands[s], G.trick).map(cid) : [],
    room: net.code, isHost: s === 0,
  };
}

// ================= networking (PeerJS, host-authoritative) =================
const net = { mode: null, peer: null, code: '', conns: new Map(), hostConn: null, mySeat: 0 };
const pid = sessionStorage.getItem('400:pid') || (() => { const v = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('400:pid', v); return v; })();

function broadcast() {
  if (net.mode !== 'host' && net.mode !== 'solo') return;
  render(viewFor(0));
  for (const [conn, seat] of net.conns) if (conn.open && seat != null) conn.send({ t: 'state', v: viewFor(seat) });
}

function makeCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[crypto.getRandomValues(new Uint32Array(1))[0] % A.length];
  return s;
}

function hostGame(solo) {
  G = freshGame();
  G.seats[0] = { name: myName(), kind: 'host', pid, connected: true };
  if (solo) {
    net.mode = 'solo'; net.code = '';
    for (let s = 1; s < 4; s++) G.seats[s] = { name: botName(s), kind: 'bot' };
    show('game');
    newGame();
    changed();
    return;
  }
  net.mode = 'host';
  net.code = makeCode();
  toast('عم جهّز الغرفة…');
  net.peer = new Peer(PREFIX + net.code);
  net.peer.on('open', () => { G.seats[0].peerId = net.peer.id; showLobby(); broadcast(); });
  net.peer.on('call', onIncomingCall);
  net.peer.on('error', e => {
    if (e.type === 'unavailable-id') { net.peer.destroy(); hostGame(false); return; }
    toast('مشكلة بالاتصال: ' + e.type);
  });
  net.peer.on('connection', conn => {
    net.conns.set(conn, null);
    conn.on('data', m => onClientMessage(conn, m));
    conn.on('close', () => {
      const seat = net.conns.get(conn);
      net.conns.delete(conn);
      if (seat != null && G.seats[seat] && G.seats[seat].kind === 'human') {
        if (G.phase === 'lobby') G.seats[seat] = null; else G.seats[seat].connected = false;
        changed();
        if (G.phase === 'lobby') showLobby();
      }
    });
  });
}

function onClientMessage(conn, m) {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'join') {
    const name = String(m.name || 'لاعب').slice(0, 14);
    let seat = G.seats.findIndex(x => x && x.kind === 'human' && x.pid === m.pid);
    if (seat < 0) {
      if (G.phase !== 'lobby') { conn.send({ t: 'err', msg: 'اللعبة بلّشت — ما في مكان' }); return; }
      seat = G.seats.findIndex(x => x === null);
      if (seat < 0) { conn.send({ t: 'err', msg: 'الغرفة مليانة' }); return; }
    }
    for (const [c, s] of net.conns) if (s === seat && c !== conn) { net.conns.delete(c); try { c.close(); } catch {} }
    G.seats[seat] = { name, kind: 'human', pid: m.pid, connected: true, peerId: conn.peer, mic: false };
    net.conns.set(conn, seat);
    conn.send({ t: 'welcome', seat });
    if (G.phase === 'lobby') showLobby();
    changed();
    return;
  }
  const seat = net.conns.get(conn);
  if (seat == null) return;
  if (m.t === 'mic') { if (G.seats[seat]) G.seats[seat].mic = !!m.on; changed(); if (G.phase === 'lobby') showLobby(); return; }
  const err = m.t === 'bid' ? placeBid(seat, m.v) : m.t === 'play' ? playCard(seat, m.id) : null;
  if (err) conn.send({ t: 'err', msg: err }); else changed();
}

function joinGame(code) {
  net.mode = 'client';
  net.code = code;
  toast('عم إتصل بالغرفة…');
  net.peer = new Peer();
  net.peer.on('call', onIncomingCall);
  net.peer.on('open', () => {
    const conn = net.peer.connect(PREFIX + code, { reliable: true });
    net.hostConn = conn;
    const timeout = setTimeout(() => { if (!conn.open) toast('ما لقيت الغرفة — تأكد من الرابط أو إنو المضيف فاتح اللعبة'); }, 9000);
    conn.on('open', () => { clearTimeout(timeout); conn.send({ t: 'join', name: myName(), pid }); });
    conn.on('data', m => {
      if (m.t === 'welcome') { net.mySeat = m.seat; }
      else if (m.t === 'state') { if (m.v.phase === 'lobby') showClientLobby(m.v); else { show('game'); render(m.v); } }
      else if (m.t === 'err') toast(m.msg);
    });
    conn.on('close', () => showModal(`<h3>انقطع الاتصال بالمضيف</h3><p class="muted center">إذا المضيف سكّر اللعبة بتنتهي الغرفة.</p><button class="p" onclick="location.reload()">إعادة الاتصال</button>`));
  });
  net.peer.on('error', e => toast(e.type === 'peer-unavailable' ? 'الغرفة مش موجودة أو المضيف مسكّر' : 'مشكلة بالاتصال: ' + e.type));
}

// ---------- voice chat: each player with the mic on calls every other human ----------
const voice = { stream: null, on: false, out: new Map(), audio: new Map() };

function onIncomingCall(call) {
  call.answer();
  call.on('stream', s => {
    let a = voice.audio.get(call.peer);
    if (!a) { a = document.createElement('audio'); a.autoplay = true; a.setAttribute('playsinline', ''); document.body.appendChild(a); voice.audio.set(call.peer, a); }
    a.srcObject = s;
    a.play().catch(() => {});
  });
}

function dialPeers() {
  if (!voice.stream || !net.peer || !net.peer.id || !lastView || !lastView.seats) return;
  for (const x of lastView.seats) {
    if (!x || !x.peerId || x.peerId === net.peer.id || !x.on || voice.out.has(x.peerId)) continue;
    const call = net.peer.call(x.peerId, voice.stream);
    if (!call) continue;
    voice.out.set(x.peerId, call);
    const drop = () => { if (voice.out.get(x.peerId) === call) voice.out.delete(x.peerId); };
    call.on('close', drop);
    call.on('error', drop);
  }
}

async function toggleMic() {
  if (!voice.stream) {
    try {
      voice.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      toast('ما قدرت افتح الميكروفون — اسمحلو من إعدادات المتصفح');
      return;
    }
  }
  voice.on = !voice.on;
  voice.stream.getAudioTracks().forEach(t => { t.enabled = voice.on; });
  for (const a of voice.audio.values()) a.play().catch(() => {});
  document.querySelectorAll('.micBtn').forEach(b => { b.classList.toggle('live', voice.on); b.textContent = voice.on ? '🎤' : '🔇'; });
  toast(voice.on ? 'الميكروفون شغّال — أصحابك عم يسمعوك' : 'سكّرت الميكروفون');
  if (net.mode === 'host') { G.seats[0].mic = voice.on; changed(); if (G.phase === 'lobby') showLobby(); }
  else if (net.hostConn && net.hostConn.open) net.hostConn.send({ t: 'mic', on: voice.on });
  dialPeers();
}

// local actions: host applies directly, client sends to host
function act(msg) {
  if (net.mode === 'client') { if (net.hostConn && net.hostConn.open) net.hostConn.send(msg); return; }
  const err = msg.t === 'bid' ? placeBid(0, msg.v) : msg.t === 'play' ? playCard(0, msg.id) : null;
  if (err) toast(err); else changed();
}

// ================= UI =================
const $ = id => document.getElementById(id);
const myName = () => ($('name').value.trim() || 'أنا').slice(0, 14);
const botName = s => ['', 'بوت سامي', 'بوت رنا', 'بوت جاد'][s];
function show(id) { document.querySelectorAll('.screen').forEach(e => e.classList.toggle('on', e.id === id)); }
let toastT;
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('on'), 2600); }
function showModal(html) { $('sheet').innerHTML = html; $('modal').classList.remove('hidden'); }
function hideModal() { $('modal').classList.add('hidden'); }
$('modal').onclick = e => { if (e.target.id === 'modal' && !$('modal').dataset.lock) hideModal(); };

function cardHTML(c, extra = '') {
  return `<div class="card c-${c.c} ${extra}" data-id="${cid(c)}"><span class="cr">${face(c.r)}</span><div class="mid"><span>${label(c.r)}</span></div>${c.c === TRUMP ? '<span class="tr">★</span>' : ''}</div>`;
}

function roomLink() { return location.origin + location.pathname + '?room=' + net.code; }

function showLobby() {
  show('lobby');
  $('shareBox').classList.remove('hidden');
  $('roomCode').textContent = net.code;
  $('roomLink').value = roomLink();
  $('btnStart').classList.remove('hidden');
  $('lobbyWait').classList.add('hidden');
  const filled = G.seats.filter(Boolean).length;
  $('btnStart').disabled = filled < 4;
  $('btnStart').textContent = filled < 4 ? `ابدأ (${filled}/4) — زيد بوتات أو استنى أصحابك` : 'ابدأ اللعبة';
  $('seats').innerHTML = G.seats.map((x, s) => {
    const right = x ? (x.kind === 'bot' ? `<button data-rm="${s}">شيل</button>` : x.kind === 'host' ? '<span class="muted">أنت</span>' : '<span class="muted">متصل</span>')
      : `<button data-bot="${s}">+ بوت</button>`;
    return `<div class="seatRow ${s % 2 ? 't1' : ''}"><span class="num">${s + 1}</span><span class="nm">${x ? x.name + (x.mic ? ' 🎤' : '') : '<span class="muted">فاضي…</span>'}</span>${right}</div>`;
  }).join('');
  $('seats').querySelectorAll('[data-bot]').forEach(b => b.onclick = () => { const s = +b.dataset.bot; G.seats[s] = { name: botName(s), kind: 'bot' }; showLobby(); broadcast(); });
  $('seats').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { G.seats[+b.dataset.rm] = null; showLobby(); broadcast(); });
}

function showClientLobby(v) {
  lastView = v;
  dialPeers();
  show('lobby');
  $('shareBox').classList.add('hidden');
  $('roomCode').textContent = v.room;
  $('btnStart').classList.add('hidden');
  $('lobbyWait').classList.remove('hidden');
  $('seats').innerHTML = v.seats.map((x, s) => `<div class="seatRow ${s % 2 ? 't1' : ''}"><span class="num">${s + 1}</span><span class="nm">${x ? x.name + (x.mic ? ' 🎤' : '') : '<span class="muted">فاضي…</span>'}</span>${s === v.you ? '<span class="muted">أنت</span>' : ''}</div>`).join('');
}

let lastView = null;
function render(v) {
  lastView = v;
  dialPeers();
  document.querySelectorAll('.micBtn').forEach(b => b.classList.toggle('hidden', !v.room));
  if (v.phase === 'lobby') return;
  const me = v.you;
  const rel = s => (s - me + 4) % 4;      // 0 bottom, 1 right, 2 top, 3 left

  const teamBox = t => {
    const [a, b] = t === 0 ? [0, 2] : [1, 3];
    const nm = s => (v.seats[s] ? v.seats[s].name : '—');
    return `<div class="team ${me % 2 === t ? 'mine' : ''}">${nm(a)}: <b>${v.scores[a]}</b><br>${nm(b)}: <b>${v.scores[b]}</b></div>`;
  };
  $('teams').innerHTML = teamBox(me % 2) + teamBox(1 - me % 2);

  for (let s = 0; s < 4; s++) {
    const el = $('p' + rel(s)), x = v.seats[s];
    const bid = v.bids[s] == null ? '—' : v.bids[s];
    const st = v.phase === 'bidding' && v.bids[s] == null ? (v.turn === s ? 'عم يطلب…' : '') : `طلب ${bid} · أكل ${v.tricks[s]}`;
    const backs = rel(s) === 0 ? '' : `<div class="backs">${'<i></i>'.repeat(Math.min(v.counts[s], 13))}</div>`;
    el.className = `seat s-${['bottom', 'right', 'top', 'left'][rel(s)]} ${v.turn === s && (v.phase === 'bidding' || v.phase === 'playing') && !v.clearing ? 'turn' : ''} ${x && !x.on ? 'off' : ''}`;
    el.innerHTML = `<span class="nm">${x ? x.name : '—'}${x && x.mic ? ' 🎤' : ''}${s === v.dealer ? ' 🂠' : ''}</span><span class="st">${st}</span>${backs}`;
  }

  const shownTrick = v.trick.length ? v.trick : [];
  const winSeat = v.clearing && v.lastTrick ? v.lastTrick.winner : -1;
  $('trick').innerHTML = shownTrick.map(t => cardHTML(t.card, `pos${rel(t.seat)} ${t.seat === winSeat ? 'win' : ''}`)).join('');
  $('center').textContent = v.msg || '';

  const myTurnBid = v.phase === 'bidding' && v.turn === me;
  $('bidPanel').classList.toggle('hidden', !myTurnBid);
  if (myTurnBid) {
    const sum = v.bids.reduce((a, b) => a + (b || 0), 0);
    $('bidInfo').textContent = `قديش رح تاكل؟ مجموع الطلبات لهلأ ${sum} — لازم يوصل المجموع لـ ${v.minTotal} وإلا منعيد التوزيع. الأحمر طرنيب ★`;
    $('bidBtns').innerHTML = Array.from({ length: 12 }, (_, i) => i + 2).map(n => `<button data-b="${n}">${n}${n >= 5 ? '<small style="display:block;font-size:10px">×2</small>' : ''}</button>`).join('');
    $('bidBtns').querySelectorAll('button').forEach(b => b.onclick = () => act({ t: 'bid', v: +b.dataset.b }));
  }

  const myTurnPlay = v.legal.length > 0;
  $('hand').className = 'hand' + (myTurnPlay ? ' myturn' : '');
  $('hand').innerHTML = v.hand.map(c => cardHTML(c, v.legal.includes(cid(c)) ? 'legal' : '')).join('');
  $('hand').querySelectorAll('.card').forEach(el => el.onclick = () => {
    if (!myTurnPlay) { toast(v.phase === 'bidding' ? 'استنى خلص الطلب' : 'مش دورك'); return; }
    if (!v.legal.includes(el.dataset.id)) { toast(`لازم تلحق اللون ${COLOR_NAME[v.trick[0].card.c]}`); return; }
    act({ t: 'play', id: el.dataset.id });
  });

  if (v.phase === 'roundEnd' || v.phase === 'gameOver') showRoundResult(v); else if (!$('modal').dataset.rules) hideModal();
}

function showRoundResult(v) {
  const r = v.lastRound;
  const rows = [0, 1, 2, 3].map(s => {
    const d = r.deltas[s];
    return `<tr><td>${v.seats[s] ? v.seats[s].name : '—'}</td><td>${r.bids[s]}</td><td>${r.tricks[s]}</td><td class="${d >= 0 ? 'plus' : 'minus'}">${d >= 0 ? '+' : ''}${d}</td><td><b>${v.scores[s]}</b></td></tr>`;
  }).join('');
  let head = `<h3>نتيجة الجولة ${v.round}</h3>`;
  if (v.phase === 'gameOver') {
    const [a, b] = v.winner === 0 ? [0, 2] : [1, 3];
    const mine = v.winner === v.you % 2;
    head = `<h3>${mine ? '🎉 ربحتوا!' : 'خسرتوا 😅'}</h3><p class="center">الفريق الرابح: ${v.seats[a].name} و${v.seats[b].name}</p>`;
  }
  const btn = v.isHost
    ? `<button class="p" id="btnNext">${v.phase === 'gameOver' ? 'لعبة جديدة' : 'الجولة التالية'}</button>`
    : `<p class="muted center">ناطرين المضيف…</p>`;
  $('modal').dataset.rules = '';
  showModal(`${head}<table><tr><th>اللاعب</th><th>طلب</th><th>أكل</th><th>±</th><th>المجموع</th></tr>${rows}</table>${btn}`);
  const nb = $('btnNext');
  if (nb) nb.onclick = () => { hideModal(); if (G.phase === 'gameOver') newGame(); else startRound(); changed(); };
}

function showRules() {
  $('modal').dataset.rules = '1';
  showModal(`<h3>قواعد الـ 400 بورق الأونو</h3><ul>
<li>4 لاعبين بفريقين: الشريك بيقعد مقابلك.</li>
<li>الورق: 4 ألوان × 13 ورقة. كل لاعب بياخد 13 ورقة.</li>
<li><b>القوة من الأكبر للأصغر:</b> 1 = الآص (A)، ⊘ التوقيف = الري (K)، +2 = البنت (Q)، ⇄ وردة الدور = الشب (J)، 0 = العشرة (10)، وبعدين 9، 8 … 2. الحرف بزاوية الورقة بيذكّرك.</li>
<li><b>الأحمر ★ طرنيب دايماً</b> (بدل الكبة).</li>
<li>كل لاعب بيطلب قديش أكلة رح ياكل (من 2 لـ 13). إذا مجموع الطلبات أقل من 11 بينعاد التوزيع (12 إذا حدا وصل 30، و13 إذا حدا وصل 40).</li>
<li>لازم تلحق اللون الملعوب إذا معك منه، وإلا فيك تطرنب أو ترمي أي ورقة. أعلى طرنيب بياكل، وإلا أعلى ورقة من اللون الملعوب.</li>
<li>إذا أكلت قد طلبك أو أكتر بتاخد نقاط الطلب، وإذا ما أكلت بتنقص منك. الطلب 5 وما فوق نقاطو دبل (5 = 10، 6 = 12 …).</li>
<li>الفريق بيربح لما لاعب منو يوصل 41 أو أكتر وشريكو نتيجتو فوق الصفر.</li>
</ul><button class="p" onclick="document.getElementById('modal').dataset.rules='';document.getElementById('modal').classList.add('hidden');if(lastView)render(lastView)">فهمت</button>`);
}

// ================= wiring =================
$('name').value = localStorage.getItem('400:name') || '';
$('name').oninput = () => localStorage.setItem('400:name', $('name').value);
const params = new URLSearchParams(location.search);
let joinCode = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// installing from an invite opens the app without ?room, so remember the invite for a while
if (joinCode) localStorage.setItem('400:invite', JSON.stringify({ code: joinCode, t: Date.now() }));
else {
  try {
    const inv = JSON.parse(localStorage.getItem('400:invite'));
    if (inv && Date.now() - inv.t < 3 * 3600e3) joinCode = inv.code;
  } catch {}
}
if (joinCode) { $('joinBox').classList.remove('hidden'); $('joinCode').textContent = joinCode; $('btnHost').classList.remove('p'); }

const needName = () => { if (!$('name').value.trim()) { toast('اكتب اسمك أول'); $('name').focus(); return true; } return false; };
$('btnJoin').onclick = () => { if (!needName()) joinGame(joinCode); };
$('btnHost').onclick = () => { if (!needName()) { localStorage.removeItem('400:invite'); hostGame(false); } };
$('btnBots').onclick = () => { localStorage.removeItem('400:invite'); hostGame(true); };
$('btnRules').onclick = showRules;
$('btnRules2').onclick = showRules;
$('btnStart').onclick = () => { show('game'); newGame(); changed(); };
$('btnLeave').onclick = () => { location.href = location.pathname; };
$('btnCopy').onclick = async () => { try { await navigator.clipboard.writeText(roomLink()); toast('انسخ الرابط ✓'); } catch { $('roomLink').select(); document.execCommand('copy'); toast('انسخ الرابط ✓'); } };
const inviteText = () => `تعا العب معي 400 بورق الأونو 🃏\n${roomLink()}`;
$('btnWa').onclick = () => window.open('https://wa.me/?text=' + encodeURIComponent(inviteText()), '_blank');
$('btnShare').onclick = () => { if (navigator.share) navigator.share({ title: '400 أونو', text: inviteText() }).catch(() => {}); else $('btnCopy').onclick(); };
document.querySelectorAll('.micBtn').forEach(b => b.onclick = toggleMic);

if (!window.pwaInstall || !pwaInstall.standalone) $('btnInstall').classList.remove('hidden');
$('btnInstall').onclick = () => window.pwaInstall && pwaInstall.open();

window.addEventListener('beforeunload', e => { if (net.mode === 'host' && G && G.phase !== 'lobby') { e.preventDefault(); e.returnValue = ''; } });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
