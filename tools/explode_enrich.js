// 워크플로A 결과(_enrich_research.json)로 시리즈 폭파 + 실출판사 + 권별 코멘트 적용
// 입력: [{uid, publisher, volumes:[{title, level, grade, comment}]}]
const fs = require("fs");
const ROOT = __dirname + "/..";
const F = ROOT + "/data/iinhyuk_english_book_guide_v0.9_expanded.html";
const raw = fs.readFileSync(F, "utf8");
const mm = raw.match(/<script id="master-data" type="application\/json">([\s\S]*?)<\/script>/);
const data = JSON.parse(mm[1]);
const enrich = JSON.parse(fs.readFileSync(ROOT + "/data/_enrich_research.json", "utf8"));
const list = enrich.result || enrich;

const GB = { "유아": [5, 7], "예비초": [7, 8], "초등": [8, 12], "초등저학년": [8, 10], "초등고학년": [10, 12], "중등": [13, 15], "고등": [16, 18], "예비고": [15, 16], "성인": [19, 40] };
function ageFromGrade(g) {
  g = String(g || "");
  for (const k of Object.keys(GB).sort((a, b) => b.length - a.length)) if (g.includes(k)) return GB[k];
  if (/초/.test(g)) return GB["초등"]; if (/중/.test(g)) return GB["중등"]; if (/고/.test(g)) return GB["고등"];
  return null;
}
const byUid = {}; data.materials.forEach(m => { byUid[m.materialUid] = m; });
let maxNum = 0; data.materials.forEach(m => { const n = parseInt(String(m.materialUid).replace("IH-ENG-", ""), 10); if (n > maxNum) maxNum = n; });

function applyVol(target, v) {
  if (v.title) { if (!target.aliases.includes(target.title)) target.aliases.unshift(target.title); target.title = v.title; }
  const lv = Math.max(1, Math.min(5, Number(v.level) || target.level || 3));
  target.level = lv; target.tftNums = [lv, lv];
  if (v.comment) target.pickComment = v.comment;
  if (v.grade) { target.grade = v.grade; const a = ageFromGrade(v.grade); if (a) { target.ageMin = a[0]; target.ageMax = a[1]; target.ageLabel = `만 ${a[0]}~${a[1]}세`; } }
}

let updated = 0, exploded = 0, newVols = 0;
for (const e of list) {
  const base = byUid[e.uid];
  if (!base) continue;
  if (e.publisher && e.publisher.length > 1 && !/기존마스터후보/.test(e.publisher)) base.publisher = e.publisher;
  if (!Array.isArray(base.aliases)) base.aliases = [];
  const vols = (e.volumes || []).filter(v => v && v.title);
  if (vols.length === 0) { updated++; continue; }
  applyVol(base, vols[0]); updated++;
  if (vols.length > 1) {
    exploded++;
    for (let i = 1; i < vols.length; i++) {
      const num = ++maxNum;
      const uid = "IH-ENG-" + String(num).padStart(4, "0");
      const clone = JSON.parse(JSON.stringify(base));
      clone.materialUid = uid; clone.uid = (base.uid || "MAT") + "_V" + (i + 1);
      clone.aliases = [base.series || base.title]; clone.mergedUids = [];
      applyVol(clone, vols[i]);
      data.materials.push(clone); newVols++;
    }
  }
}
const out = raw.replace(mm[0], `<script id="master-data" type="application/json">${JSON.stringify(data)}</script>`);
fs.writeFileSync(F, out, "utf8");
console.log(`폭파 적용: 갱신 ${updated} · 다권시리즈 ${exploded} · 새 권 ${newVols} · 총 교재 ${data.materials.length}`);
