/* 플레이스홀더/오매칭 표지 → 표지없음(앱 SVG 타이틀카드) 전환 (영어 교재, 로컬 전용)
   - covers/ md5 중복 그룹 중 "서로 다른 책(base≥3)이 같은 이미지"를 공유 = 오류
   - 해당 그룹 전원 표지 제거(localPath 삭제) → 빌드 시 cover="" → 앱이 고유 SVG카드 생성
   - 단일/소수 시리즈(같은 시리즈 권별 공유)는 보존(차단 해제 후 권별 실표지 재수집 예정)
   옵션: --all  (단일시리즈 그룹도 1권만 남기고 나머지 카드화)
*/
const fs = require("fs"), path = require("path"), cr = require("crypto");
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "data", "iinhyuk_english_book_guide_v0.9_expanded.html");
const COVERS = path.join(ROOT, "covers");
const JSON_OUT = path.join(ROOT, "data", "book_images.json");
const ALL = process.argv.includes("--all");
const norm = (v) => String(v || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
const seriesBase = (t) => norm(String(t || "").replace(/\b\d+\s*(st|nd|rd|th)\s+edition\b/gi, " ").replace(/\b(level|lv|book|band|stage|grade|단계)\b/gi, " ").replace(/\b\d+\b/g, " "));
const volOf = (t) => { let s = " " + String(t || "").toLowerCase() + " "; s = s.replace(/\b\d+\s*(st|nd|rd|th)\s+edition\b/g, " "); const n = s.match(/\b\d+\b/g); return n ? Number(n[n.length - 1]) : 99; };

const master = JSON.parse(fs.readFileSync(SRC, "utf8").match(/<script id="master-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const byUid = {}; master.materials.forEach((m) => (byUid[m.materialUid] = m));
const imgData = JSON.parse(fs.readFileSync(JSON_OUT, "utf8"));
const imgMap = imgData.images || {};
const eng = master.materials.filter((m) => m.domain === "영어").map((m) => m.materialUid);

const byHash = {};
for (const uid of eng) { const f = path.join(COVERS, uid + ".jpg"); if (fs.existsSync(f)) { const h = cr.createHash("md5").update(fs.readFileSync(f)).digest("hex"); (byHash[h] = byHash[h] || []).push(uid); } }
const groups = Object.values(byHash).filter((a) => a.length > 1);

let carded = 0, keptGroups = 0, keptSeries = 0;
function toCard(uid) { try { fs.unlinkSync(path.join(COVERS, uid + ".jpg")); } catch {} imgMap[uid] = imgMap[uid] || {}; delete imgMap[uid].localPath; imgMap[uid].status = "no_cover_real"; carded++; }

for (const g of groups) {
  const bases = new Set(g.map((u) => seriesBase(byUid[u].title)));
  const multiSeries = bases.size >= 3;
  if (multiSeries) { g.forEach(toCard); }            // 오류군 전원 카드화
  else if (ALL) {                                     // 단일시리즈: 대표 1권만 실표지 보존
    const sorted = g.slice().sort((a, b) => volOf(byUid[a].title) - volOf(byUid[b].title));
    sorted.slice(1).forEach(toCard); keptSeries++;
  } else { keptGroups++; }
}
fs.writeFileSync(JSON_OUT, JSON.stringify(imgData, null, 2), "utf8");

// 검증: 남은 중복
const after = {};
for (const uid of eng) { const f = path.join(COVERS, uid + ".jpg"); if (fs.existsSync(f)) { const h = cr.createHash("md5").update(fs.readFileSync(f)).digest("hex"); (after[h] = after[h] || []).push(uid); } }
const dupAfter = Object.values(after).filter((a) => a.length > 1);
const have = eng.filter((u) => imgMap[u] && imgMap[u].localPath).length;
console.log(`카드화: ${carded}종 | 오류군 처리 | 단일시리즈 보존군: ${keptGroups} | 보존(대표만): ${keptSeries}`);
console.log(`실표지 보유: ${have}/${eng.length} | 남은 중복그룹: ${dupAfter.length} (종수 ${dupAfter.reduce((n, a) => n + a.length, 0)})`);
