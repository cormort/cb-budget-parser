// 臨時除錯：印出某頁的原始 cells，用來確認「解析缺欄」是 PDF 真的沒有、還是定位掉了。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fakeEl() {
    const el = { style: {}, textContent: '', innerHTML: '', value: '', files: null, disabled: false,
        addEventListener() {}, appendChild() {}, querySelectorAll: () => [], classList: { add() {}, remove() {} } };
    return new Proxy(el, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
}
const ELS = new Map();
globalThis.document = { getElementById: id => { if (!ELS.has(id)) ELS.set(id, fakeEl()); return ELS.get(id); }, querySelectorAll: () => [] };
globalThis.window = globalThis;

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const src = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
    .replace(/from 'https:\/\/cdnjs[^']*pdf\.min\.mjs'/, "from 'pdfjs-dist/legacy/build/pdf.mjs'")
    .replace(/^.*GlobalWorkerOptions.*$/m, '')
    .replace('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/', path.join(ROOT, 'node_modules/pdfjs-dist/cmaps/'))
    .concat(`
export const api = { pageLines, parsePage, matchTitle, headText, TABLE_NAMES, CMAP,
    get pdfjsLib() { return pdfjsLib; } };
`);
fs.writeFileSync(path.join(ROOT, 'tools', '.bundle.mjs'), src);
const api = (await import(pathToFileURL(path.join(ROOT, 'tools', '.bundle.mjs')).href + '?t=' + Date.now())).api;

const [pdf, pageArg] = process.argv.slice(2);
const doc = await api.pdfjsLib.getDocument({ data: new Uint8Array(fs.readFileSync(pdf)), ...api.CMAP }).promise;
if (pageArg === 'scan') {
    for (let p = 1; p <= doc.numPages; p++) {
        const t = api.parsePage(await api.pageLines(doc, p), await api.pageLines(doc, p + 1));
        if (t) console.log(`${p}\t${t.title}\trows=${t.rows.length}\tcodeX=${t.codeX.toFixed(1)}`);
    }
    process.exit(0);
}
if (pageArg.startsWith('raw')) {
    const pg = await api.pageLines(doc, Number(pageArg.slice(3)) || 39);
    for (const l of pg.lines) console.log(`y=${l.y}  ` + l.cells.map(c => `${c.s}[x=${c.x.toFixed(1)},w=${c.w.toFixed(1)}]`).join(' '));
    process.exit(0);
}
for (const p of pageArg.split(',').map(Number)) {
    const pg = await api.pageLines(doc, p);
    const t = api.parsePage(pg, await api.pageLines(doc, p + 1));
    console.log(`\n########## ${pdf} p.${p}  title=${t ? t.title : '(非預算表)'} rows=${t ? t.rows.length : 0} codeX=${t ? t.codeX.toFixed(1) : '-'}`);
    if (!t) continue;
    console.log('headRows:', JSON.stringify(t.headRows));
    for (const r of t.rows)
        console.log(`  y=${r.y} code=${JSON.stringify(r.code)} indent=${r.indent} name=${JSON.stringify(r.name)} nums=${JSON.stringify(r.nums)}`);
}
