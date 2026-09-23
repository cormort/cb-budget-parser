// 無頭載具：把 index.html 的 <script type="module"> 抽出來，在 Node 裡跑同一份解析邏輯。
// 用途是「跑得出來才算完成」——驗算規則改了要能對 14 份 PDF 重跑，而不是靠肉眼開瀏覽器。
//
//   node tools/harness.mjs <pdf...>            印出各表的解析與驗算摘要
//   node tools/harness.mjs --json out.json <pdf...>   另存完整解析結果
//
// index.html 是唯一真相：這裡不改任何解析邏輯，只替換 CDN import 與補上瀏覽器全域。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── 瀏覽器全域的最小替身 ──
function fakeEl() {
    const el = {
        style: {}, textContent: '', innerHTML: '', value: '', files: null, disabled: false,
        addEventListener() {}, appendChild() {}, querySelectorAll: () => [], classList: { add() {}, remove() {} },
    };
    // render() 會碰很多沒列到的屬性；沒實作的當成 no-op，不要讓它炸掉解析
    return new Proxy(el, {
        get: (t, k) => (k in t ? t[k] : () => {}),
        set: (t, k, v) => { t[k] = v; return true; },
    });
}
const ELS = new Map();
const el = id => { if (!ELS.has(id)) ELS.set(id, fakeEl()); return ELS.get(id); };

globalThis.document = { getElementById: el, querySelectorAll: () => [] };
globalThis.window = globalThis;

// ── 抽出並改寫 index.html 的模組腳本 ──
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m) throw new Error('index.html 找不到 <script type="module">');
const src = m[1]
    .replace(/from 'https:\/\/cdnjs[^']*pdf\.min\.mjs'/, "from 'pdfjs-dist/legacy/build/pdf.mjs'")
    .replace(/^.*GlobalWorkerOptions.*$/m, '')
    .concat(`
export const api = {
    parseCbPdf, verifyTable, crossChecks, sectionOf, pageLines, parsePage, matchTitle, headText,
    get tables() { return tables; },
    get notes() { return notes; },
    get pdfjsLib() { return pdfjsLib; },
    get TABLE_NAMES() { return TABLE_NAMES; },
};
`);

const bundle = path.join(ROOT, 'tools', '.bundle.mjs');
fs.writeFileSync(bundle, src);
const mod = (await import(pathToFileURL(bundle).href + '?t=' + Date.now())).api;

// ── 跑解析 ──
const argv = process.argv.slice(2);
let jsonOut = null, htmlOut = null;
if (argv[0] === '--json') jsonOut = argv.splice(0, 2)[1];
if (argv[0] === '--html') htmlOut = argv.splice(0, 2)[1];
const pdfs = argv;
if (!pdfs.length) { console.error('用法：node tools/harness.mjs [--json out.json] <pdf...>'); process.exit(2); }

const files = pdfs.map(p => ({
    name: path.basename(p),
    arrayBuffer: async () => fs.readFileSync(p),
}));
el('fileInput').files = files;
await mod.parseCbPdf();

// --html：把 render() 產生的內容存成靜態頁，用來檢查畫面（不進版控）
if (htmlOut) {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
    const body = el('tableContainer').innerHTML;
    fs.writeFileSync(htmlOut, `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8"><style>${style}</style></head><body><div class="container">${body}</div></body></html>`);
    console.log(`畫面 → ${htmlOut}`);
}

const tables = mod.tables, notes = mod.notes;
console.log(`\n=== ${tables.length} 張表、${tables.reduce((n, t) => n + t.rows.length, 0)} 列；編列說明 ${notes.length} 頁 ===\n`);

let bad = 0, checked = 0, unable = 0;
for (const t of tables) {
    const res = mod.verifyTable(t);
    checked += res.checked; unable += res.unable; bad += res.bad.length;
    if (res.bad.length) {
        console.log(`✗ ${t.file}｜${t.title}　${res.bad.length} 項`);
        for (const r of res.bad.slice(0, 12)) console.log(`    ${r.kind} ${r.code} ${r.name}｜${r.col}：本列 ${r.parent} 實算 ${r.sum}｜${r.note}`);
        if (res.bad.length > 12) console.log(`    …另有 ${res.bad.length - 12} 項`);
    }
}
console.log(`\n表內驗算：已驗 ${checked} 項，不符 ${bad} 項，因數字從缺無法驗 ${unable} 項`);

const cross = mod.crossChecks(tables, notes);
console.log(`\n表間勾稽：${cross.length} 項`);
for (const c of cross) console.log(`  ${c.ver ? '≠' : c.ok ? '✓' : '✗'} ${c.rule}｜${c.file}｜${c.detail}｜${c.left.value} vs ${c.right.value} 差 ${c.diff}`);

if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify({ tables, notes, cross }, null, 1));
    console.log(`\n完整結果 → ${jsonOut}`);
}
