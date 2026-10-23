// 回歸測試：以版控中的範例 PDF 跑 tools/harness.mjs（與 index.html 同一份解析邏輯），
// 解析結果或驗算結果一有變動就失敗。改動規則若刻意影響結果，請一併更新 EXPECT。
//
//   npm install && npm test
//
// 否證測試（故意改壞數字確認驗算會叫）需要相鄰兩年度的 PDF，見 tools/falsify.mjs。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = 'examples/cb-116-a2.pdf';   // 116 年度附件二：附件二才有逐科目編列說明

const EXPECT = {
    year: 116,
    tables: 18,
    rows: 505,
    noteRows: 130,
    verify: { checked: 885, bad: 0, unable: 115 },   // 表內驗算
    cross: 27, crossBad: 0,                           // 表間勾稽
};

const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-')), 'out.json');
execFileSync(process.execPath, [path.join(ROOT, 'tools/harness.mjs'), '--json', out, path.join(ROOT, FIXTURE)], { stdio: 'ignore' });
const j = JSON.parse(fs.readFileSync(out, 'utf8'));

const got = {
    year: j.tables[0]?.year,
    tables: j.tables.length,
    rows: j.tables.reduce((n, t) => n + t.rows.length, 0),
    noteRows: j.notes.reduce((n, t) => n + t.rows.length, 0),
    verify: j.verify,
    cross: j.cross.length,
    crossBad: j.cross.filter(c => !c.ok && !c.ver).length,
};

const errs = [];
for (const [k, want] of Object.entries(EXPECT)) {
    if (JSON.stringify(got[k]) !== JSON.stringify(want)) errs.push(`${k}: 期望 ${JSON.stringify(want)}，實際 ${JSON.stringify(got[k])}`);
}

// 靜態契約：與姊妹專案一致
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
if (!/xlsx\.full\.min\.js"\s+integrity="sha384-[^"]+"\s+crossorigin="anonymous"/.test(html)) errs.push('SheetJS 缺少 SRI + crossorigin');
if (!/"integrity":\s*\{\s*"https:\/\/cdnjs[^"]+pdf\.min\.mjs":\s*"sha384-/.test(html)) errs.push('pdf.js 缺少 import map integrity');
if (!/id="statusMessage"[^>]*aria-live="polite"/.test(html) || !/id="errorOutput"[^>]*role="alert"/.test(html)) errs.push('狀態／錯誤訊息缺少 aria-live 或 role');

if (errs.length) {
    console.error(`✗ ${FIXTURE}`);
    errs.forEach(e => console.error('    ' + e));
    process.exit(1);
}
console.log(`✓ ${FIXTURE}：${got.year} 年度｜${got.tables} 張表、${got.rows} 列｜編列說明 ${got.noteRows} 列`);
console.log(`    表內驗算已驗 ${got.verify.checked} 項、不符 0、無法驗 ${got.verify.unable}｜表間勾稽 ${got.cross} 項、不符 0`);
console.log('✓ SRI、aria-live 契約');
console.log('\n全部通過。');
