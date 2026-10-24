#!/usr/bin/env node
// tools/lan-server.mjs — FATEBLADE LAN DUEL SERVER v5 (v0.38, zero dependencies)
//
// v5 (v0.38 installer rebuild): continuation-frame reassembly — fragmented
// ws text messages (opcode 1 FIN=0 + opcode 0 frames) are now reassembled
// and delivered instead of silently dropped (8MB cap; control frames still
// interleave per RFC 6455). No wire-protocol change; v0.37 clients unaffected.
//
// v4 (v0.37.0 session-integrity pass): WELCOME now carries graceMs (the
// server's real reconnect window) so v0.37 clients show true grace countdowns
// and retry for the full window instead of a hardcoded 5 attempts. Relay
// semantics otherwise unchanged — the client owns resume (RESYNC→STATE).
//
// v3 = LIFECYCLE + REACHABILITY (the deep-dive rebuild; see docs/lan-deep-dive.md):
//   • keepalive fixed: pings every 15s, PONGS PARSED, silent sockets destroyed
//     after 2 missed sweeps → crashed clients free their seats like clean exits
//   • room GC: any room with ZERO connected clients for 120s is deleted
//     (empty "hosted but never joined" rooms, abandoned rooms, spec-only
//     rooms); lobby rooms idle >30min also deleted
//   • MATCHEND → room returns to 'lobby' (JOIN reappears after a duel ends);
//     both seats re-READY during a match also reopens the lobby
//   • GET /del?room=  → the host client deletes a room it failed to enter
//   • multi-address advertisement: beacon + rooms.json carry `addrs`
//     (every plausible LAN IPv4, virtual adapters filtered) so JOIN can try
//     each — fixes the wrong-adapter LAN-join failure class
//
// GAME BROWSER UX (v2 flow unchanged):
//   GET /            → game browser page (rooms via UDP beacons — JOIN/SPECTATE)
//   GET /rooms.json  → { me: {host, addrs, port, rooms}, peers: [...] }
//   GET /host?name=  → creates a room, 302 into game.html with hash params
//   WebSocket /ws    → per-room relay: HELLO seats you A → B → spectator;
//                      WELCOME carries side + reconnect token; the rest relays
//                      verbatim. MATCHEND/START/RESUME manage room.state.
//
// UDP BEACON (port 7778): {host, addrs, port, rooms} every 2s.
// Usage: node tools/lan-server.mjs [port]  (default 7777)

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, resolve, normalize } from 'node:path';
import { networkInterfaces, hostname } from 'node:os';
import { createSocket } from 'node:dgram';

const PORT = Number(process.argv[2]) || 7777;
// Test-tunable lifecycle timers (env overrides; defaults = production values)
const KEEPALIVE_MS = Number(process.env.LAN_KEEPALIVE_MS) || 15000; // ping interval
const DEAD_MS = Number(process.env.LAN_DEAD_MS) || 35000;           // silence → destroy
const SEAT_GRACE_MS = Number(process.env.LAN_SEAT_GRACE_MS) || 120000; // reconnect grace
const GC_SWEEP_MS = Number(process.env.LAN_GC_SWEEP_MS) || 30000;  // room GC interval
const ROOM_EMPTY_MS = Number(process.env.LAN_ROOM_EMPTY_MS) || 120000; // zero clients → delete
const LOBBY_IDLE_MS = Number(process.env.LAN_LOBBY_IDLE_MS) || 1800000; // idle lobby → delete
const BEACON_PORT = 7778;
const ROOT = resolve(process.cwd());
const HOSTNAME = hostname();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };

const rnd = (n) => Array.from({ length: n }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('');

// ---- ADDRESSES: all plausible LAN IPv4s, virtual adapters filtered --------
// v3: advertising ONE adapter was the classic join failure (VPN/WSL/Hyper-V
// adapters sort first). We advertise every plausible one; clients try each.
const VIRT = /virtual|vmnet|vmware|vethernet|wsl|hyper-v|docker|veth |br-|virbr|loopback|tap-?|tun |tailscale|zerotier|utun|hamachi|rangeme|officevpn|pcvpn|wg-/i;
function lanAddrs() {
  const out = [];
  for (const [iname, list] of Object.entries(networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      const a = ni.address;
      const priv = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
      if (!priv) continue;                    // LAN parties are on private nets
      if (VIRT.test(iname)) continue;         // skip VPN/virtual bridges
      if (!out.includes(a)) out.push(a);
    }
  }
  return out.length ? out : ['127.0.0.1'];
}
function lanAddr() { return lanAddrs()[0]; } // single-addr back-compat

// ---- ROOM REGISTRY --------------------------------------------------------
const rooms = new Map(); // id → { id, name, seats, specCount, state, created, lastEmpty }
const seat = (name) => ({ name, token: rnd(12), connected: true, since: Date.now() });
const seatS = (s) => (s ? { name: s.name, connected: !!s.connected } : null);
function roomSummary(r) {
  return { id: r.id, name: r.name, state: r.state, specCount: r.specCount,
    seats: { A: seatS(r.seats.A), B: seatS(r.seats.B) } };
}
function roomConnectedCount(r) {
  let n = r.specCount;
  for (const s of ['A', 'B']) if (r.seats[s] && r.seats[s].connected) n++;
  return n;
}
function emptyRoom(r) { return !r.seats.A && !r.seats.B && r.specCount === 0; }

// ---- HTTP -----------------------------------------------------------------
const httpServer = createServer((req, res) => {
  const CORS = { 'access-control-allow-origin': '*' }; // desktop exe renders from file:// and polls this server directly
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  if (path === '/' || path === '/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...CORS }); res.end(browserPage()); return; }
  if (path === '/rooms.json') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS });
    res.end(JSON.stringify({
      me: { host: HOSTNAME, addr: lanAddr(), addrs: lanAddrs(), port: PORT, rooms: [...rooms.values()].map(roomSummary) },
      peers: [...peers.values()].map((p) => ({ host: p.host, addr: p.addr, addrs: p.addrs, port: p.port, rooms: p.rooms }))
    }));
    return;
  }
  if (path === '/host') {
    const name = (url.searchParams.get('name') || '').slice(0, 40) || 'Fateblade duel';
    const id = rnd(5);
    rooms.set(id, { id, name, seats: { A: null, B: null }, specCount: 0, state: 'lobby', created: Date.now(), lastEmpty: Date.now() });
    console.log('[room] created ' + id + ' "' + name + '"');
    const loc = '/src/game.html#srv=' + encodeURIComponent(lanAddrs().map(a => a + ':' + PORT).join(',')) + '&room=' + id + '&role=player';
    res.writeHead(302, { location: loc, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'location' }); res.end();
    return;
  }
  if (path === '/del') { // v3: the host client cleans up a room it failed to enter
    const id = url.searchParams.get('room') || '';
    if (rooms.has(id) && roomConnectedCount(rooms.get(id)) === 0) {
      rooms.delete(id);
      console.log('[room] deleted (failed host join) ' + id);
      res.writeHead(200, { 'content-type': 'application/json', ...CORS }); res.end(JSON.stringify({ ok: true }));
    } else { res.writeHead(200, { 'content-type': 'application/json', ...CORS }); res.end(JSON.stringify({ ok: false })); }
    return;
  }
  const file = resolve(ROOT, normalize(path).replace(/^(\.\.[\/\\])+/, ''));
  try {
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) throw 0;
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' }); res.end(readFileSync(file));
  } catch (e) { res.writeHead(404); res.end('not found'); }
});

// ---- GAME BROWSER PAGE ----------------------------------------------------
function browserPage(){
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>FATEBLADE — LAN GAMES</title><style>
  body { background:#141210; color:#e8ddc8; font-family:Georgia,serif; max-width:760px; margin:0 auto; padding:24px; }
  h1 { letter-spacing:4px; text-align:center; margin-bottom:4px; }
  .sub { text-align:center; color:#9a8b74; margin-bottom:18px; }
  .bar { display:flex; gap:8px; margin-bottom:16px; }
  input[type=text] { flex:1; background:#221d18; border:1px solid #5a4a35; color:#e8ddc8; padding:10px 12px; font-family:inherit; }
  button, .join, .spec { cursor:pointer; border:none; padding:10px 16px; font-family:inherit; font-weight:bold; color:#141210; background:#c9a86a; }
  .spec { background:#5a6a7a; color:#e8ddc8; }
  .room { background:#1d1915; border:1px solid #3a3128; padding:12px 14px; margin-bottom:10px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .info { flex:1; min-width:200px; }
  .meta { color:#9a8b74; font-size:14px; margin-top:2px; }
  .pill { display:inline-block; background:#2a241d; padding:1px 8px; border-radius:8px; font-size:12px; }
  .pill.live { background:#5a3a2a; color:#e8b07a; }
  .seat.open { color:#7ac98a; }
  .empty { text-align:center; color:#9a8b74; padding:30px; }
  a { text-decoration:none; }
  </style></head><body>
  <h1>&#9876; FATEBLADE LAN</h1>
  <div class="sub">Duel servers on this wifi — pick a game, click JOIN or SPECTATE.</div>
  <div class="bar">
    <input type="text" id="pname" placeholder="Your name" maxlength="20">
    <button id="hostBtn">&#9876; HOST A NEW DUEL</button>
  </div>
  <div class="peers" id="peers"></div>
  <div id="list"></div>
  <script>
  const NAME = () => localStorage.getItem('fb-lan-name') || '';
  const $ = (id) => document.getElementById(id);
  $('pname').value = NAME();
  $('pname').oninput = () => localStorage.setItem('fb-lan-name', $('pname').value);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  // v3: srv carries the host's FULL address list — the client tries each until one connects
  const srvList = (addrs, port) => (addrs && addrs.length ? addrs : [null]).map(a => ((a || '127.0.0.1') + ':' + port)).join(',');
  const link = (srv, room, role, label, cls, disabled) =>
    disabled ? \`<button class="${'$'}{cls}" disabled>${'$'}{label}</button>\`
      : \`<a href="/src/game.html#srv=${'$'}{encodeURIComponent(srv)}&room=${'$'}{room}&role=${'$'}{role}&name=${'$'}{encodeURIComponent(NAME())}"><button class="${'$'}{cls}">${'$'}{label}</button></a>\`;
  async function tick(){
    try{
      const d = await (await fetch('/rooms.json')).json();
      const L = $('list');
      const all = [];
      for(const r of d.me.rooms) all.push({ ...r, srv: srvList(d.me.addrs, d.me.port), here: true });
      for(const p of d.peers) for(const r of p.rooms) all.push({ ...r, srv: srvList(p.addrs, p.addr), here: false, host: p.host });
      if(!all.length){ L.innerHTML = '<div class="empty">No duels yet — click HOST A NEW DUEL to create one.</div>'; }
      else L.innerHTML = all.map(r => {
        const seatA = r.seats.A ? esc(r.seats.A.name) + (r.seats.A.connected ? '' : ' <span class="pill">reconnecting…</span>') : '<span class="seat open">OPEN</span>';
        const seatB = r.seats.B ? esc(r.seats.B.name) + (r.seats.B.connected ? '' : ' <span class="pill">reconnecting…</span>') : '<span class="seat open">OPEN</span>';
        const full = r.seats.A && r.seats.B;
        return '<div class="room"><div class="info">'
          + '<b>' + esc(r.name) + '</b>'
          + (r.here ? '' : ' <span class="pill">on ' + esc(r.host) + '</span>')
          + '<div class="meta"><span class="pill ' + (r.state==='match'?'live':'') + '">' + (r.state==='match'?'IN DUEL':'PICKING REALMS') + '</span>'
          + ' &nbsp;SEAT A: ' + seatA + ' &middot; SEAT B: ' + seatB + ' &middot; &#128065; ' + r.specCount + '</div></div>'
          + (r.state==='match' || full ? '' : link(r.srv, r.id, 'player', '&#9876; JOIN', 'join'))
          + link(r.srv, r.id, 'spec', '&#128065; SPECTATE', 'spec')
          + '</div>';
      }).join('');
      const others = d.peers.length;
      $('peers').textContent = others ? ('Also seeing ' + others + ' other fateblade host' + (others>1?'s':'') + ' on this network') : '';
    }catch(e){ $('list').innerHTML = '<div class="empty">Server hiccup — retrying…</div>'; }
  }
  tick(); setInterval(tick, 2000);
  $('hostBtn').onclick = ()=>{ if(!NAME()){ $('pname').focus(); $('pname').style.borderColor='#c96a5a'; return; }
    location.href = '/host?name=' + encodeURIComponent(NAME() + "'s duel"); };
  </script></body></html>`;
}

// ---- WEBSOCKET (hand-rolled) ----------------------------------------------
const crypto = await import('node:crypto');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const clients = new Set(); // { sock, room, side, token, name, open, alive, lastPong }

function sendText(c, str) {
  const buf = Buffer.from(str, 'utf8');
  const len = buf.length;
  let head;
  if (len < 126) head = Buffer.from([0x81, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  try { c.sock.write(Buffer.concat([head, buf])); } catch (e) {}
}
function sendRaw(c, bytes) { try { c.sock.write(Buffer.from(bytes)); } catch (e) {} }
function roomCast(room, sender, str) {
  for (const c of clients) if (c.open && c !== sender && c.room === room) sendText(c, str);
}
function broadcastState(room) {
  if (!room) return;
  const s = JSON.stringify({ t: 'ROOMSTATE', room: roomSummary(room) });
  for (const c of clients) if (c.open && c.room === room) sendText(c, s);
}
function closeClient(c) {
  if (!c.open) return;
  c.open = false;
  try { c.sock.destroy(); } catch (e) {}
  clients.delete(c);
  if (c.room && c.side === 'S') { c.room.specCount = Math.max(0, c.room.specCount - 1); }
  if (c.room && (c.side === 'A' || c.side === 'B') && c.room.seats[c.side] && c.room.seats[c.side].token === c.token) {
    if (c.room.seats[c.side].cid && c.room.seats[c.side].cid !== c) return; // v4: a zombie socket dying must NOT mark a live owner's seat disconnected
    c.room.seats[c.side].connected = false; // 120s reconnect grace, then free
    const token = c.token, side = c.side, room = c.room;
    setTimeout(() => {
      if (rooms.get(room.id) !== room) return; // room already gone
      if (room.seats[side] && room.seats[side].token === token && !room.seats[side].connected) {
        room.seats[side] = null;
        if (emptyRoom(room)) rooms.delete(room.id);
        broadcastState(room);
      }
    }, SEAT_GRACE_MS);
  }
  if (c.room && rooms.get(c.room.id) === c.room) broadcastState(c.room);
}

httpServer.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const client = { sock, room: null, side: null, token: null, name: '?', open: true, alive: true, lastPong: Date.now(), buf: Buffer.alloc(0), frag: null, fragLen: 0 };
  clients.add(client);
  const FRAG_CAP = 8 * 1024 * 1024; // v5: reassembled-message cap — a fragmented send larger than this is a bug/abuse, drop the connection's fragment state
  sock.on('data', (chunk) => {
    client.buf = Buffer.concat([client.buf, chunk]);
    while (true) {
      const b = client.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0; // v5: FIN bit — continuation frames reassembled below
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      const maskOff = masked ? off : -1;
      if (masked) off += 4;
      if (b.length < off + len) return;
      let payload = b.subarray(off, off + len);
      if (masked) { const m = b.subarray(maskOff, maskOff + 4); payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3]; }
      client.buf = b.subarray(off + len);
      if (opcode === 0x8) { client.frag = null; client.fragLen = 0; closeClient(client); return; }         // close
      if (opcode === 0x9) { sendRaw(client, [0x8a, 0]); continue; } // ping→pong (control frames may interleave with fragments per RFC 6455)
      if (opcode === 0xA) { client.lastPong = Date.now(); continue; } // v3: PONG PARSED — liveness restored
      // v5 CONTINUATION FRAMES: a client MAY fragment a text message into
      // opcode-1 (FIN=0) + opcode-0 frames. Browsers never do, but the old
      // parser silently dropped opcode-0 frames → fragmented message lost.
      // Reassemble: first text fragment starts the buffer, opcode-0 appends,
      // FIN=1 delivers. Cap protects memory; anything else resets state.
      if (opcode === 0x0) {
        if (!client.frag) continue;                                 // stray continuation with nothing in progress — drop
        client.frag = Buffer.concat([client.frag, payload]);
        client.fragLen += payload.length;
        if (client.fragLen > FRAG_CAP) { client.frag = null; client.fragLen = 0; continue; }
        if (!fin) continue;
        payload = client.frag; client.frag = null; client.fragLen = 0;
      } else if (opcode === 0x1 && !fin) {
        client.frag = payload; client.fragLen = payload.length;
        if (client.fragLen > FRAG_CAP) { client.frag = null; client.fragLen = 0; }
        continue;
      } else if (opcode !== 0x1) continue;                           // non-text, non-control — drop
      const str = payload.toString('utf8');
      let msg = null;
      try { msg = JSON.parse(str); } catch (e) { continue; }
      if (msg && msg.t === 'HELLO') {
        const room = rooms.get(msg.room);
        if (!room) { sendText(client, JSON.stringify({ t: 'ERR', x: 'That duel is no longer listed — refresh the game browser and pick a live one.' })); closeClient(client); return; }
        client.room = room;
        client.name = String(msg.name || '?').slice(0, 20);
        for (const s of ['A', 'B']) { // reconnect: token reclaims a seat
          if (room.seats[s] && msg.token && room.seats[s].token === msg.token) {
            // v4 SEAT OWNERSHIP: a reclaim means this socket now OWNS the seat.
            // The old code just flipped connected=true — two live sockets could
            // share one seat (a reclaim racing the old connection's death), and
            // when EITHER closed, the seat read disconnected while the other
            // was still playing; the room could then GC under a live player.
            const stale = room.seats[s].cid;
            if (stale && stale !== client && stale.open) closeClient(stale); // kick the zombie
            client.side = s; client.token = msg.token; room.seats[s].connected = true; room.seats[s].cid = client;
            sendText(client, JSON.stringify({ t: 'WELCOME', side: s, token: msg.token, graceMs: SEAT_GRACE_MS, room: roomSummary(room) })); // v4: the real reconnect window, not a client-side guess
            broadcastState(room);
            client.buf = Buffer.alloc(0);
            return;
          }
        }
        if (msg.role === 'spec' || (room.seats.A && room.seats.B)) {
          client.side = 'S'; client.token = rnd(12);
          room.specCount++;
        } else {
          client.side = room.seats.A ? 'B' : 'A';
          client.token = rnd(12);
          const st = seat(client.name);
          st.token = client.token;
          st.cid = client; // v4: seat ownership — only the owning socket's death marks the seat disconnected
          room.seats[client.side] = st;
          if (room.state === 'lobby') room.state = 'picking'; // v3: seats present, realms not locked
        }
        sendText(client, JSON.stringify({ t: 'WELCOME', side: client.side, token: client.token, graceMs: SEAT_GRACE_MS, room: roomSummary(room) })); // v4: ditto
        broadcastState(room);
        console.log('[lan] ' + client.name + ' → side ' + client.side + ' (room ' + room.id + ')');
        continue;
      }
      if (!client.room) continue;
      if (msg && msg.t === 'START') client.room.state = 'match';
      if (msg && msg.t === 'RESUME') client.room.state = 'match';
      if (msg && msg.t === 'MATCHEND') { // v3: duel over → room reopens for JOIN/rematch
        if (client.room.state === 'match') { client.room.state = 'lobby'; broadcastState(client.room); }
      }
      if (msg && msg.t === 'READY' && client.side !== 'S' && client.room.state === 'match') {
        client.room.state = 'lobby'; broadcastState(client.room); // v3: rematch-ready reopens the lobby
      }
      if (msg && msg.t === 'LEAVE' && client.side !== 'S') {
        client.room.seats[client.side] = null; // explicit leave frees the seat now
        if (emptyRoom(client.room)) rooms.delete(client.room.id);
        else broadcastState(client.room);
        closeClient(client);
        continue;
      }
      roomCast(client.room, client, str); // relay everything else verbatim
    }
  });
  sock.on('error', () => closeClient(client));
  sock.on('close', () => closeClient(client));
  sock.on('end', () => closeClient(client));
});

// ---- KEEPALIVE (v3: actually detects dead clients) -------------------------
// every 15s ping everyone; a client silent for 2 sweeps (≈35s) is destroyed —
// its seats enter the normal 120s grace. Half-open sockets can no longer pin
// rooms open forever.
setInterval(() => {
  const now = Date.now();
  for (const c of [...clients]) {
    if (!c.open) { clients.delete(c); continue; }
    sendRaw(c, [0x89, 0]); // ping
    if (now - c.lastPong > DEAD_MS) closeClient(c); // dead → treat as disconnect
  }
}, KEEPALIVE_MS);

// ---- ROOM GC (v3: rooms are mortal) ---------------------------------------
// • zero connected clients for 120s → delete (empty hosted rooms, abandoned,
//   spec-only leftovers with dead spec sockets)
// • lobby rooms older than 30min → delete (nobody ever joined)
setInterval(() => {
  const now = Date.now();
  for (const [id, r] of [...rooms]) {
    const conn = roomConnectedCount(r);
    if (conn === 0) {
      if (r.lastEmpty == null) r.lastEmpty = now;
      if (now - r.lastEmpty > ROOM_EMPTY_MS) { rooms.delete(id); console.log('[room] GC: empty room ' + id + ' deleted'); continue; }
    } else r.lastEmpty = now;
    if (r.state === 'lobby' && now - r.created > LOBBY_IDLE_MS) { rooms.delete(id); console.log('[room] GC: idle lobby ' + id + ' deleted'); }
  }
}, GC_SWEEP_MS);

// ---- UDP DISCOVERY BEACON --------------------------------------------------
const peers = new Map(); // 'addr:port' → { host, addr, addrs, port, rooms, lastSeen }
const udp = createSocket({ type: 'udp4', reuseAddr: true });
udp.on('message', (buf) => {
  try {
    const d = JSON.parse(buf.toString('utf8'));
    if (!d || !Array.isArray(d.rooms)) return;
    if (Array.isArray(d.addrs) && d.addrs.includes(lanAddr()) && Number(d.port) === PORT) return; // own beacon echoed by the LAN
    peers.set(d.addr + ':' + d.port, { host: String(d.host || '?'), addr: d.addr, addrs: Array.isArray(d.addrs) ? d.addrs : [d.addr], port: Number(d.port) || 7777, rooms: d.rooms, lastSeen: Date.now() });
  } catch (e) {}
});
udp.bind(BEACON_PORT, () => { try { udp.setBroadcast(true); } catch (e) {} });

function bcastAddrs() {
  const out = new Set(['255.255.255.255']);
  for (const [iname, list] of Object.entries(networkInterfaces()))
    for (const ni of list || []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      const p = ni.address.split('.').map(Number);
      if (!VIRT.test(iname)) out.add(p[0] + '.' + p[1] + '.' + p[2] + '.255');
    }
  return [...out];
}
setInterval(() => {
  const now = Date.now();
  for (const [k, p] of [...peers]) if (now - p.lastSeen > 6000) peers.delete(k);
  const beacon = Buffer.from(JSON.stringify({ host: HOSTNAME, addr: lanAddr(), addrs: lanAddrs(), port: PORT, rooms: [...rooms.values()].map(roomSummary) }));
  for (const a of bcastAddrs()) { try { udp.send(beacon, BEACON_PORT, a); } catch (e) {} }
}, 2000);

httpServer.listen(PORT, () => {
  const ips = ['localhost', ...lanAddrs()];
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  ⚔ FATEBLADE LAN SERVER v4 — GAME BROWSER at:        ║');
  for (const ip of ips) console.log(`║  http://${ip}:${PORT}`.padEnd(55) + '║');
  console.log('║  Friends open that URL, pick a duel, click JOIN.     ║');
  console.log('╚══════════════════════════════════════════════════════╝');
});
