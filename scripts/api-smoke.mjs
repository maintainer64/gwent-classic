// Run against `docker compose up` or a local Go backend.
import assert from 'node:assert/strict';
const url = process.argv[2] || 'http://127.0.0.1:8080';
async function waitForServer() {
  for(let i=0;i<40;i++) {
    try { const r=await fetch(url+'/healthz'); if(r.ok)return; } catch {}
    await new Promise(r=>setTimeout(r,250));
  }
  throw Error('server did not become healthy');
}
function user() {
  let cookie = '';
  return async (path, body) => {
    const response=await fetch(url+path, {method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
    if(response.headers.get('set-cookie')) cookie=response.headers.get('set-cookie').split(';')[0];
    return {status:response.status,body:await response.json()};
  };
}
await waitForServer();
const alice=user(), bob=user(), outsider=user();
let res=await alice('/api/rooms',{name:'Alice',mode:'pvp',faction:'realms'});
assert.equal(res.status,201);const code=res.body.code;
assert.match(code,/^[A-Z2-9]{12}$/);
let list=await alice('/api/rooms');assert.equal(list.status,200);assert.equal(list.body.rooms.length,1);assert.equal(list.body.rooms[0].code,code);
list=await outsider('/api/rooms');assert.equal(list.body.rooms.length,0,'room leaked to another anonymous browser');
let catalog=await alice('/api/catalog');assert.equal(catalog.status,200);assert.ok(Array.isArray(catalog.body.leaders));assert.ok(Array.isArray(catalog.body.cards));
res=await outsider(`/api/rooms/${code}`);assert.equal(res.status,403);
res=await bob(`/api/rooms/${code}/join`,{name:'Bob',faction:'monsters',expectedVersion:0});
assert.equal(res.status,200,JSON.stringify(res.body));
assert.equal(res.body.players.length,2);
assert.equal(res.body.players[0].hand,undefined,'opponent hand leaked');
res=await alice(`/api/rooms/${code}`);assert.equal(res.status,200);
assert.equal(res.body.players[1].hand,undefined,'opponent hand leaked');
assert.equal(res.body.players[0].hand.length,10);
let stale=await alice(`/api/rooms/${code}/actions`,{expectedVersion:0,action:{type:'pass'}});assert.equal(stale.status,409);
const firstReady=await alice(`/api/rooms/${code}/actions`,{expectedVersion:res.body.version,action:{type:'ready'}});
assert.equal(firstReady.status,200,JSON.stringify(firstReady.body));
const secondReady=await bob(`/api/rooms/${code}/actions`,{expectedVersion:firstReady.body.version,action:{type:'ready'}});
assert.equal(secondReady.status,200,JSON.stringify(secondReady.body));
assert.equal(secondReady.body.phase,'turn');
assert.ok(Date.parse(secondReady.body.turnDeadline)>Date.parse(secondReady.body.serverTime),'server deadline must be exposed after mulligan');
const turnDuration=Date.parse(secondReady.body.turnDeadline)-Date.parse(secondReady.body.serverTime);
assert.ok(turnDuration>55000 && turnDuration<=60000,'turn deadline must be about 60 seconds');
const refresh=await alice(`/api/rooms/${code}`);
assert.equal(refresh.body.turnDeadline,secondReady.body.turnDeadline,'refresh cannot reset server timer');

const current=secondReady.body;
const mover=current.turn===0?alice:bob;
const pass=await mover(`/api/rooms/${code}/actions`,{expectedVersion:current.version,action:{type:'pass'}});
assert.equal(pass.status,200,JSON.stringify(pass.body));
assert.equal(pass.body.version,current.version+1);
const bot=await alice('/api/rooms',{name:'Alice',mode:'bot',faction:'realms'});
assert.equal(bot.status,201,JSON.stringify(bot.body));
assert.equal(bot.body.status,'playing');
assert.equal(bot.body.players[1].hand,undefined);
const definitionCards=catalog.body.cards.filter(c=>c.faction==='skellige' && !['leader','special','weather'].includes(c.row) && !['special','weather'].includes(c.faction));
let custom=[],required=22;
for(const card of definitionCards){const n=Math.min(required,card.maxCopies);if(n>0)custom.push({def:card.id,count:n});required-=n;if(required<=0)break;}
assert.equal(required,0,'insufficient Skellige cards for smoke test');
const hard=await alice('/api/rooms',{name:'Alice',mode:'bot',faction:'realms',bot:{difficulty:'hard',deckMode:'custom',faction:'skellige',deck:custom}});
assert.equal(hard.status,201,JSON.stringify(hard.body));
assert.equal(hard.body.bot.difficulty,'hard');
assert.equal(hard.body.bot.faction,'skellige');
assert.equal(hard.body.players[1].hand,undefined);
const bad=await alice('/api/rooms',{name:'Alice',mode:'bot',faction:'realms',bot:{difficulty:'hard',deckMode:'custom',faction:'skellige',deck:custom.slice(0,1)}});
assert.equal(bad.status,400,'invalid custom deck accepted');
console.log(`OK: anonymous PvP, hidden cards, room listing, leaders, turn validation, easy/normal/hard bot setup, custom deck guards, bot room (${code})`);
