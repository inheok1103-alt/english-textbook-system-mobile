/* 고전 원서(Decoding the Classics) 183권 → 메인 카탈로그 통합
   소스: ~/Downloads/decoding-the-classics.html 의 BOOKS 배열(UTF-8 정상)
   - skill: 정독→구문, 다독→독해 / level: lv / grade: lv기준 / foreign:true / source:CLASSICS
   - 표지: 분야색 타이틀카드(SVG data URI) → coverInline (파일 불필요, file://·https 모두 동작)
   - 멱등: 이미 들어온 CLASSICS 제목은 건너뜀
   사용: node tools/import_classics.js [--src <path>]
*/
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "data", "iinhyuk_english_book_guide_v0.9_expanded.html");
const DEF_CLS = process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "Downloads", "decoding-the-classics.html") : "";
const CLS = (() => { const i = process.argv.indexOf("--src"); return i >= 0 ? process.argv[i + 1] : DEF_CLS; })();

const raw = fs.readFileSync(SRC, "utf8");
const mm = raw.match(/<script id="master-data" type="application\/json">([\s\S]*?)<\/script>/);
const master = JSON.parse(mm[1]);
const clsHtml = fs.readFileSync(CLS, "utf8");
const BOOKS = eval(clsHtml.match(/const BOOKS\s*=\s*(\[[\s\S]*?\]);/)[1]);
const AWARD = new Set(eval((clsHtml.match(/const AWARD\s*=\s*new Set\((\[[\s\S]*?\])\)/) || [])[1] || "[]"));
const MUST = new Set(eval((clsHtml.match(/const MUSTREAD\s*=\s*new Set\((\[[\s\S]*?\])\)/) || [])[1] || "[]"));

const FC = {
  "전방위교양": "#2E5E5A", "고전 인문·에세이": "#6B5B95", "인지·심리": "#C56A2E", "철학·인식론": "#33506B",
  "수학·논리·과학사": "#2E7D5B", "경제": "#9A5A20", "진화·생명": "#6B9A3C", "물리·우주": "#3A4A8B",
  "인류·문명사": "#9E342F", "언어·언어학": "#1F6B6B", "예술·미학": "#A23B5E", "법·정치": "#274B63",
  "기술·AI": "#1F6B45", "내러티브·회고": "#7A5A12",
};
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function wrap(t, n) { const w = String(t).split(/\s+/), lines = []; let cur = ""; for (const x of w) { if ((cur + " " + x).trim().length > n) { if (cur) lines.push(cur); cur = x; } else cur = (cur + " " + x).trim(); } if (cur) lines.push(cur); return lines.slice(0, 5); }
function cardSVG(b) {
  const fc = FC[b.f] || "#2E5E5A";
  const lines = wrap(b.t, 15);
  const startY = 200 - (lines.length - 1) * 16;
  const tspans = lines.map((ln, i) => `<text x="26" y="${startY + i * 32}" font-family="Georgia,'Times New Roman',serif" font-size="25" font-weight="600" fill="#16202B">${esc(ln)}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400">
<rect width="300" height="400" fill="#F7F5F1"/>
<rect x="0" y="0" width="10" height="400" fill="${fc}"/>
<rect x="26" y="34" width="40" height="3" fill="${fc}"/>
<text x="26" y="62" font-family="monospace" font-size="11" letter-spacing="1.5" fill="#5C6773">${esc((b.a || "").toUpperCase()).slice(0, 30)}</text>
${tspans}
<text x="26" y="330" font-family="monospace" font-size="12" fill="#5C6773">${b.y < 0 ? Math.abs(b.y) + " BC" : b.y} · ${b.m}</text>
<rect x="26" y="346" width="60" height="22" rx="5" fill="${fc}"/>
<text x="56" y="361" font-family="monospace" font-size="12" font-weight="700" fill="#fff" text-anchor="middle">Lv ${b.lv}</text>
<text x="96" y="362" font-family="monospace" font-size="11" fill="${b.cr === 'PD' ? '#1F6B45' : '#9A5A20'}">${b.cr === "PD" ? "PUBLIC DOMAIN" : "COPYRIGHT"}</text>
</svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64");
}

const CEFR = { 1: "B1", 2: "B2", 3: "C1", 4: "C1", 5: "C2" };
function gradeOf(lv) { return lv <= 2 ? { grade: "고등", ageMin: 16 } : { grade: "성인", ageMin: 19 }; }

const existing = new Set(master.materials.filter((m) => m.source === "CLASSICS").map((m) => (m.title || "").toLowerCase()));
let added = 0, n = 0;
for (const b of BOOKS) {
  if (existing.has((b.t || "").toLowerCase())) continue;
  const gi = gradeOf(b.lv);
  const tags = [b.f]; if (AWARD.has(b.t)) tags.push("수상"); if (MUST.has(b.t)) tags.push("핵심");
  const uid = "IH-CLS-" + String(++n).padStart(4, "0");
  master.materials.push({
    materialUid: uid, uid, domain: "영어", publisher: b.a || "", title: b.t,
    skill: b.m === "정독" ? "구문" : "독해", tftNums: [b.lv, b.lv], grade: gi.grade, ageMin: gi.ageMin,
    situations: tags.filter((t) => t === "수상" || t === "핵심"), weaknesses: [], features: [], aliases: [],
    status: "정상", foreign: true, source: "CLASSICS",
    kobicCategory: "고전원서 · " + b.f, classicField: b.f, classicEra: b.e, classicMode: b.m, copyright: b.cr,
    pickComment: (b.n || "") + " · " + CEFR[b.lv] + " · " + (b.y < 0 ? Math.abs(b.y) + "BC" : b.y),
    pubDate: String(b.y < 0 ? "" : b.y), coverInline: cardSVG(b),
  });
  added++;
}
fs.writeFileSync(SRC, raw.replace(mm[0], `<script id="master-data" type="application/json">${JSON.stringify(master)}</script>`), "utf8");
console.log(`고전 원서 통합: +${added}종 (총 영어 ${master.materials.filter((m) => m.domain === "영어").length}종)`);
