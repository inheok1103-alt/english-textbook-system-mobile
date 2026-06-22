// ELT 리서치 결과(_elt_research.json)를 master-data에 병합 (중복 제거 + 카테고리 분류)
const fs = require("fs");
const ROOT = __dirname + "/..";
const F = ROOT + "/data/iinhyuk_english_book_guide_v0.9_expanded.html";
const raw = fs.readFileSync(F, "utf8");
const mm = raw.match(/<script id="master-data" type="application\/json">([\s\S]*?)<\/script>/);
const data = JSON.parse(mm[1]);
const research = JSON.parse(fs.readFileSync(ROOT + "/data/_elt_research.json", "utf8")).result;

function norm(s) { return String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim(); }

// 기존 보유 시그니처(제목/시리즈/alias)
const existing = data.materials.map(m => norm(`${m.title} ${m.series || ""} ${(m.aliases || []).join(" ")}`)).join(" || ");
function isDup(series, title) {
  const a = norm(series), b = norm(title);
  if (a.length >= 5 && existing.includes(a)) return true;
  if (b.length >= 6 && existing.includes(b)) return true;
  return false;
}

const GB = { "유아": [5, 7], "초등": [8, 12], "중등": [13, 15], "고등": [16, 18], "성인": [19, 40] };
function mapSkill(s) {
  if (s === "모의·기출" || s === "모의/기출") return "모의/기출";
  if (s === "회화") return "말하기";
  return s;
}
const PART = { "어휘": "어휘", "문법": "문법", "구문": "문법", "독해": "독해", "듣기": "듣기", "쓰기": "쓰기", "파닉스": "기초", "통합": "종합", "말하기": "말하기", "모의/기출": "실전" };

let maxNum = 0;
for (const m of data.materials) { const n = parseInt(String(m.materialUid || "").replace("IH-ENG-", ""), 10); if (n > maxNum) maxNum = n; }

const seen = new Set();
let added = 0, dup = 0;
const addedList = [];
for (const pub of research) {
  for (const b of pub.books) {
    const sig = norm(b.series || b.title);
    if (seen.has(sig)) { dup++; continue; }     // 리서치 내부 중복
    seen.add(sig);
    if (isDup(b.series, b.title)) { dup++; continue; } // 기존 DB와 중복
    const skill = mapSkill(b.skill);
    const age = GB[b.gradeBand] || [8, 18];
    const num = ++maxNum;
    const uid = "IH-ENG-" + String(num).padStart(4, "0");
    const cat = b.isExam ? "수험" : (b.category || "ELT");
    data.materials.push({
      uid: "MAT_ELT_" + sig.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30),
      publisher: pub.publisher.replace(/\(.*\)/, "").trim(),
      title: b.title, skill,
      tft: "", tftNums: [Math.max(1, b.level), Math.min(6, b.level + 1)],
      grade: b.gradeBand, ageMin: age[0], ageMax: age[1], ageLabel: `만 ${age[0]}~${age[1]}세`,
      situations: ["ELT", cat].concat(b.isExam ? ["수험"] : []),
      weaknesses: [], features: [skill, "영어", "ELT"],
      note: "ELT 리서치 보강 2026-06-20", status: "분류완료", origin: "elt_research",
      aliases: [b.title, b.series], mergedUids: [], materialUid: uid, gradeTags: [],
      series: b.series, domain: "영어",
      level: Math.max(1, Math.min(5, b.level)),
      part: PART[skill] || skill,
      pickComment: b.note || "",
      category: cat === "수험" ? "ELT·수험" : ("ELT·" + cat),
      track: "ELT",
    });
    added++;
    addedList.push(`  [${pub.publisher}] ${b.title} (${cat}/${skill})`);
  }
}

const out = raw.replace(mm[0], `<script id="master-data" type="application/json">${JSON.stringify(data)}</script>`);
fs.writeFileSync(F, out, "utf8");
console.log(`ELT 추가: ${added}종 / 중복제외: ${dup}종 / 총 교재: ${data.materials.length}`);
console.log("\n추가된 시리즈:");
console.log(addedList.join("\n"));
