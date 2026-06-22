// 특목고 부교재 리서치(_special_research.json) 병합 (중복 제거, 실출판사·학교별 코멘트)
const fs = require("fs");
const ROOT = __dirname + "/..";
const F = ROOT + "/data/iinhyuk_english_book_guide_v0.9_expanded.html";
const raw = fs.readFileSync(F, "utf8");
const mm = raw.match(/<script id="master-data" type="application\/json">([\s\S]*?)<\/script>/);
const data = JSON.parse(mm[1]);
const j = JSON.parse(fs.readFileSync(ROOT + "/data/_special_research.json", "utf8"));
const research = j.result || j;

function norm(s) { return String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim(); }
const existing = data.materials.map(m => norm(`${m.title} ${m.series || ""} ${(m.aliases || []).join(" ")}`)).join(" || ");
function isDup(series, title) {
  const a = norm(series), b = norm(title);
  if (a.length >= 5 && existing.includes(a)) return true;
  if (b.length >= 6 && existing.includes(b)) return true;
  return false;
}
const GB = { "유아": [5, 7], "초등": [8, 12], "중등": [13, 15], "고등": [16, 18], "성인": [19, 40] };
function mapSkill(s) { if (s === "모의·기출" || s === "모의/기출") return "모의/기출"; if (s === "회화") return "말하기"; return s; }
const PART = { "어휘": "어휘", "문법": "문법", "구문": "문법", "독해": "독해", "듣기": "듣기", "쓰기": "쓰기", "파닉스": "기초", "통합": "종합", "말하기": "말하기", "모의/기출": "실전" };

let maxNum = 0;
for (const m of data.materials) { const n = parseInt(String(m.materialUid || "").replace("IH-ENG-", ""), 10); if (n > maxNum) maxNum = n; }

const seen = new Set();
let added = 0, dup = 0; const list = [];
for (const grp of research) {
  for (const b of grp.books) {
    const sig = norm(b.series || b.title);
    if (seen.has(sig)) { dup++; continue; }
    seen.add(sig);
    if (isDup(b.series, b.title)) { dup++; continue; }
    const skill = mapSkill(b.skill);
    const age = GB[b.gradeBand] || [13, 18];
    const num = ++maxNum;
    const uid = "IH-ENG-" + String(num).padStart(4, "0");
    const cat = b.category || (b.isExam ? "시험대비" : "원서");
    data.materials.push({
      uid: "MAT_SPC_" + sig.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30),
      publisher: (b.publisher || "해외원서").replace(/\s*\(.*?\)\s*/g, " ").trim(),
      title: b.title, skill,
      tft: "", tftNums: [Math.max(2, b.level), Math.min(6, b.level + 1)],
      grade: b.gradeBand, ageMin: age[0], ageMax: age[1], ageLabel: `만 ${age[0]}~${age[1]}세`,
      situations: ["특목고", cat].concat(b.isExam ? ["수험"] : []),
      weaknesses: [], features: [skill, "영어", "특목고"],
      note: "특목고 부교재 리서치 2026-06-20", status: "분류완료", origin: "special_school",
      aliases: [b.title, b.series], mergedUids: [], materialUid: uid, gradeTags: [],
      series: b.series, domain: "영어",
      level: Math.max(1, Math.min(5, b.level)),
      part: PART[skill] || skill,
      pickComment: b.note || "",
      category: "특목고·" + cat,
      track: "특목고",
    });
    added++;
    list.push(`  [${b.publisher}] ${b.title}`);
  }
}
const out = raw.replace(mm[0], `<script id="master-data" type="application/json">${JSON.stringify(data)}</script>`);
fs.writeFileSync(F, out, "utf8");
console.log(`특목고 추가: ${added}종 / 중복제외: ${dup}종 / 총: ${data.materials.length}`);
console.log(list.join("\n"));
