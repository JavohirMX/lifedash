import assert from 'node:assert/strict';import{chromium}from'playwright-core';
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try{
const context=await b.newContext();const first=await context.newPage(),second=await context.newPage();
for(const p of[first,second]){await p.goto(`${process.env.BASE_URL}/?sample`);await p.getByText('Set up the backup volume',{exact:true}).first().waitFor()}
for(let i=0;i<8;i++){
 const date=`2030-01-${String(i+1).padStart(2,'0')}`;
 const a=await first.evaluate(async date=>{const{db}=await import('/src/db.ts');const{getOrCreateJournalEntry,updateJournalEntry}=await import('/src/repo.ts');await db.journal.where('date').equals(date).delete();const rows=await Promise.all(Array.from({length:4},()=>getOrCreateJournalEntry(date)));await Promise.all([updateJournalEntry(rows[0].id,{mood:4}),updateJournalEntry(rows[1].id,{note:'Same-day note'})]);return rows.map(r=>r.id)},date);assert.equal(new Set(a).size,1);
 const ids=await Promise.all([first,second].map((p,n)=>p.evaluate(async({date,n})=>{const{getOrCreateJournalEntry,updateJournalEntry}=await import('/src/repo.ts');const row=await getOrCreateJournalEntry(date.replace('01-', '03-'));await updateJournalEntry(row.id,n===0?{mood:5}:{highlight:'Cross-tab highlight'});return row.id},{date,n})));assert.equal(ids[0],ids[1]);
 const rows=await first.evaluate(async date=>{const{db}=await import('/src/db.ts');return db.journal.where('date').equals(date.replace('01-', '03-')).toArray()},date);assert.equal(rows.length,1);assert.equal(rows[0].mood,5);assert.equal(rows[0].highlight,'Cross-tab highlight');
}
// A rejected create leaves no partial record and does not block a later retry.
await first.evaluate(async()=>{const{db}=await import('/src/db.ts');const{getOrCreateJournalEntry}=await import('/src/repo.ts');const original=db.journal.add.bind(db.journal);db.journal.add=async()=>{throw Error('Injected write failure')};try{await getOrCreateJournalEntry('2030-02-01');throw Error('Expected rejection')}catch(e){if(e.message!=='Injected write failure')throw e}finally{db.journal.add=original}if(await db.journal.where('date').equals('2030-02-01').count())throw Error('partial record');await getOrCreateJournalEntry('2030-02-01')});
console.log('Journal same-day parallel/cross-tab atomic creation and failure retry PASS');
}finally{await b.close()}
