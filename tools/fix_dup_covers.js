// 중복 표지(같은 이미지) 그룹을 초기화 → 재수집 대상으로 만든다 (영어 교재만)
const fs = require("fs"), cr = require("crypto"), p = require("path");
const ROOT = __dirname + "/..";
const COVERS = ROOT + "/covers";
const J = ROOT + "/data/book_images.json";
const data = JSON.parse(fs.readFileSync(J, "utf8"));
const master = JSON.parse(fs.readFileSync(ROOT + "/data/iinhyuk_english_book_guide_v0.9_expanded.html", "utf8").match(/<script id="master-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const eng = new Set(master.materials.filter(m => m.domain === "영어").map(m => m.materialUid));

const byHash = {};
for (const uid of eng) {
  const f = p.join(COVERS, uid + ".jpg");
  if (fs.existsSync(f)) {
    const h = cr.createHash("md5").update(fs.readFileSync(f)).digest("hex");
    (byHash[h] = byHash[h] || []).push(uid);
  }
}
const dups = Object.values(byHash).filter(a => a.length > 1);
let cleared = 0;
for (const g of dups) {
  for (const uid of g) {
    try { fs.unlinkSync(p.join(COVERS, uid + ".jpg")); } catch (e) {}
    if (data.images && data.images[uid]) delete data.images[uid];
    cleared++;
  }
}
fs.writeFileSync(J, JSON.stringify(data, null, 2), "utf8");
console.log(`중복 그룹: ${dups.length} | 초기화(재수집 대상): ${cleared}종`);
