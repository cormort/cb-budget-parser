// 否證測試：故意把數字改壞，確認驗算真的會叫——不然「0 項不符」可能只是驗算空過。
//   npm i pdfjs-dist && node tools/falsify.mjs [pdf…]
// 沒給檔案時，取專案根目錄的 _a13.pdf、_a06.pdf（本機測試樣本，不進版控）。
// 走的是 index.html 裡同一份 verifyTable / crossChecks。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function fakeEl(){const el={style:{},textContent:'',innerHTML:'',value:'',files:null,disabled:false,addEventListener(){},appendChild(){},querySelectorAll:()=>[],classList:{add(){},remove(){}}};return new Proxy(el,{get:(t,k)=>(k in t?t[k]:()=>{}),set:(t,k,v)=>{t[k]=v;return true;}});}
const ELS=new Map();
globalThis.document={getElementById:id=>{if(!ELS.has(id))ELS.set(id,fakeEl());return ELS.get(id);},querySelectorAll:()=>[]};
globalThis.window=globalThis;
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
fs.writeFileSync(path.join(ROOT,'tools','.bundle.mjs'), html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
 .replace(/from 'https:\/\/cdnjs[^']*pdf\.min\.mjs'/,"from 'pdfjs-dist/legacy/build/pdf.mjs'")
 .replace(/^.*GlobalWorkerOptions.*$/m,'')
 .concat(`\nexport const api={parseCbPdf,verifyTable,crossChecks,get tables(){return tables;}};\n`));
const api=(await import(pathToFileURL(path.join(ROOT,'tools','.bundle.mjs')).href+'?t='+Date.now())).api;
const picked = process.argv.slice(2).length ? process.argv.slice(2)
    : fs.readdirSync(ROOT).filter(f => f.endsWith('.pdf')).sort().slice(-2);
if (picked.length < 2) { console.error('需要兩份 PDF 當樣本：node tools/falsify.mjs <pdf> <pdf>'); process.exit(2); }
const files = picked.map(f => ({ name: path.basename(f), arrayBuffer: async () => fs.readFileSync(path.isAbsolute(f) ? f : path.join(ROOT, f)) }));
const FILE_A = files[files.length - 2].name, FILE_B = files[files.length - 1].name;
document.getElementById('fileInput').files = files;
await api.parseCbPdf();
const clone = () => JSON.parse(JSON.stringify(api.tables));
const find=(ts,file,title)=>ts.find(t=>t.file===file&&t.title===title);

let pass=0, fail=0;
const t=(name,cond)=>{ console.log(`${cond?'✓':'✗'} ${name}`); cond?pass++:fail++; };

// 1. 散總：把金融保險收入(4103)的本年度金額改掉 → 41 營業收入＝4103＋4107 應該要叫
{
  const ts=clone(); const P=find(ts,FILE_B,'損益預計表');
  const r=P.rows.find(x=>x.code==='4103'); r.values['本年度預算數金額']='999,999,999';
  const v=api.verifyTable(P); const c=api.crossChecks(ts);
  t('散總：改壞 4103 → 損益預計表 41 的母子加總被抓到', v.bad.some(b=>b.code==='41'));
  t('恆等式：改壞 61 → 61 = 41 − 51 被抓到', (() => { const q=clone(); const Q=find(q,FILE_B,'損益預計表');
      Q.rows.find(x=>x.code==='61').values['本年度預算數金額']='1'; return api.verifyTable(Q).bad.some(b=>b.code==='61'&&b.kind==='恆等式'); })());
  t('表間：改壞 4103 → 金融保險收入明細表勾稽被抓到', c.some(x=>!x.ok&&x.rule==='金融保險收入'));
}
// 2. 欄間：把業務費用明細表某列的「固定」改掉 → 合計＝固定＋變動 要叫
{
  const ts=clone(); const B=find(ts,FILE_B,'業務費用明細表');
  const r=B.rows.find(x=>x.values['本年度預算數固定']&&x.values['本年度預算數合計']);
  r.values['本年度預算數固定']='1';
  const v=api.verifyTable(B);
  t('欄間：改壞「固定」→ 合計＝固定＋變動 被抓到', v.bad.some(b=>b.kind==='恆等式'&&b.col==='本年度預算數合計'));
}
// 3. 表尾合計列：把金融保險成本明細表的總計改掉 → 合計列＝最上層科目之和 要叫
{
  const ts=clone(); const T=find(ts,FILE_B,'金融保險成本明細表');
  const tot=T.rows.find(r=>!r.code&&/^(合|總)+計$/.test(r.name.trim()));
  tot.values['本年度預算數合計']='1';
  const v=api.verifyTable(T);
  t('表尾合計列：改壞總計 → 被抓到', v.bad.some(b=>b.kind==='合計列'));
}
// 4. 表間：把盈虧撥補的 8101 改掉 → 損益預計表 68 勾稽要叫
{
  const ts=clone(); const B=find(ts,FILE_B,'盈虧撥補預計表');
  B.rows.find(x=>x.code==='8101').values['本年度預算數']='7';
  const c=api.crossChecks(ts);
  t('表間：改壞 8101 → 本期淨利勾稽被抓到', c.some(x=>!x.ok&&x.rule==='本期淨利'));
}
// 5. 從缺不是通過：把某個子科目金額清空 → 應該計入「無法驗」而不是默默通過
{
  const ts=clone(); const P=find(ts,FILE_B,'損益預計表');
  P.rows.find(x=>x.code==='4107').values['本年度預算數金額']='';
  const v=api.verifyTable(P);
  t('從缺：清空 4107 → 計入無法驗，且不算通過', v.unable>0 && !v.bad.some(b=>b.code==='41'));
}
// 6. 表間：改壞資產負債預計表的事業投資 → 與資金轉投資明細表的勾稽要叫
{
  const ts=clone(); const B=find(ts,FILE_B,'資產負債預計表');
  B.rows.find(x=>x.code==='130301').values['本年度預計數']='1';
  const c=api.crossChecks(ts);
  t('表間：改壞 130301 → 事業投資勾稽被抓到', c.some(x=>!x.ok&&x.rule==='事業投資'));
}
// 7. 表間：改壞資產負債預計表的資本 → 與資本增減明細表的勾稽要叫
{
  const ts=clone(); const B=find(ts,FILE_B,'資產負債預計表');
  B.rows.find(x=>x.code==='31').values['本年度預計數']='1';
  const c=api.crossChecks(ts);
  t('表間：改壞 31 資本 → 資本勾稽被抓到', c.some(x=>!x.ok&&x.rule==='資本'));
}
// 8. 未改動時全數通過（對照組）
{
  const ts=clone();
  const bad=ts.reduce((n,x)=>n+api.verifyTable(x).bad.length,0);
  const c=api.crossChecks(ts).filter(x=>!x.ok).length;
  t('對照組：未改動時表內 0 不符、表間 0 不符', bad===0&&c===0);
}
console.log(`\n否證結果：${pass} 通過、${fail} 失敗`);
process.exit(fail?1:0);
