// enrich-remaining 워크플로 성공분 코멘트/출판사/레벨을 master-data에 적용
const fs = require("fs");
const ROOT = __dirname + "/..";
const F = ROOT + "/data/iinhyuk_english_book_guide_v0.9_expanded.html";
const raw = fs.readFileSync(F, "utf8");
const mm = raw.match(/<script id="master-data" type="application\/json">([\s\S]*?)<\/script>/);
const data = JSON.parse(mm[1]);
const j = JSON.parse(fs.readFileSync(ROOT + "/data/_enrich_remaining.json", "utf8"));
const list = j.result || j;
const byUid = {}; data.materials.forEach(m => byUid[m.materialUid] = m);
let n = 0, pub = 0;
for (const e of list) {
  if (!e || !e.uid) continue;
  const m = byUid[e.uid]; if (!m) continue;
  if (e.comment && e.comment.length > 15) { m.pickComment = e.comment; n++; }
  if (e.publisher && e.publisher.length > 1 && !/기존마스터후보/.test(e.publisher)) { m.publisher = e.publisher; pub++; }
  if (e.level) m.level = Math.max(1, Math.min(5, Number(e.level)));
}
fs.writeFileSync(F, raw.replace(mm[0], `<script id="master-data" type="application/json">${JSON.stringify(data)}</script>`), "utf8");
console.log(`코멘트 적용: ${n}종 / 출판사 갱신: ${pub}종`);
