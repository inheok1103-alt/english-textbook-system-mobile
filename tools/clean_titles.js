// 이상한 제목 정규화 (슬래시 볼륨나열/레벨범위/괄호목록 정리). 원제목은 aliases 보존.
const fs = require("fs");
const F = __dirname + "/../data/iinhyuk_english_book_guide_v0.9_expanded.html";
const raw = fs.readFileSync(F, "utf8");
const m = raw.match(/<script id="master-data" type="application\/json">([\s\S]*?)<\/script>/);
const data = JSON.parse(m[1]);

function clean(t) {
  let s = String(t || "");
  s = s.replace(/\s*\([^)]*\d[^)]*,[^)]*\)/g, "");          // (STARTER 1-3, BASIC 1-3 ...) 볼륨목록 괄호 제거
  s = s.replace(/(\d+)(\s*\/\s*\d+)+/g, "$1");              // 1/2/3 → 1 (대표권)
  s = s.replace(/\s*시리즈\s*\d+\s*[~\-]\s*\d+\s*(학년|권)?/g, " "); // "시리즈 1~3권/학년"
  s = s.replace(/\s*\d+\s*[~\-]\s*\d+\s*권/g, "");           // "1~3권"
  s = s.replace(/\s*시리즈\s*$/g, "").replace(/\s*Series\s*$/gi, "");
  s = s.replace(/\s{2,}/g, " ").trim();
  return s || String(t || "");
}

let changed = 0; const samples = [];
for (const mat of data.materials) {
  const orig = mat.title || "";
  const cl = clean(orig);
  if (cl && cl !== orig) {
    if (!Array.isArray(mat.aliases)) mat.aliases = [];
    if (!mat.aliases.includes(orig)) mat.aliases.unshift(orig);
    mat.title = cl;
    mat.titleOriginal = orig;
    changed++;
    if (samples.length < 35) samples.push(`  ${orig}\n    → ${cl}`);
  }
}

fs.writeFileSync(F.replace(/\.html$/, "_orig.html"), raw, "utf8"); // 백업
const out = raw.replace(m[0], `<script id="master-data" type="application/json">${JSON.stringify(data)}</script>`);
fs.writeFileSync(F, out, "utf8");
console.log(`정리된 제목: ${changed}종 (백업: *_orig.html)`);
console.log("\n=== 샘플 ===");
console.log(samples.join("\n"));
