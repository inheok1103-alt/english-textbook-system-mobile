/* 레거시 승격 — 자동매칭 잔여 6종을 검증된 대표판 ISBN으로 손수 채움.
   제목(정확 일치)→ISBN 매핑 후 master-data에 기록하고 ItemLookUp으로 표지·가격·판매지수 보강.
   사용: ALADIN_TTBKEY=xxx node tools/match_legacy_manual.js [--apply] */
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, ".."), DATA = path.join(ROOT, "data");
const SRC = path.join(DATA, "iinhyuk_english_book_guide_v0.9_expanded.html");
const CACHE = path.join(DATA, "aladin_enrich.json");
const KEY = (process.env.ALADIN_TTBKEY || "").trim();
const APPLY = process.argv.includes("--apply");
if (!KEY) { console.log("ALADIN_TTBKEY 없음 — 중단"); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MAP = {
  "능률 VOCA 어원편 (고등)": "9791125350842",
  "The Official SAT Study Guide (College Board)": "9781457316708",
  "Delta's Key to the TOEFL iBT: Complete Skill Practice": "9781621677000",
  "Unlock (Cambridge)": "9781009031394",
  "Bricks Writing School (1~3)": "9791162733097",
  "Penguin Readers (원서 리딩)": "9780241397893",
};

const raw = fs.readFileSync(SRC, "utf8");
const mm = raw.match(/<script id="master-data" type="application\/json">([\s\S]*?)<\/script>/);
const master = JSON.parse(mm[1]);
let cache = {}; try { cache = JSON.parse(fs.readFileSync(CACHE, "utf8")) || {}; } catch (e) {}
function normStatus(s) { s = String(s || ""); if (/절판/.test(s)) return "절판"; if (/품절/.test(s)) return "품절"; return "정상"; }
async function lookup(isbn) {
  const u = `https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx?ttbkey=${KEY}&itemIdType=ISBN13&ItemId=${isbn}&output=js&Version=20131101&Cover=Big`;
  try { const d = JSON.parse(await (await fetch(u)).text()); const it = d && d.item && d.item[0]; if (!it) return null;
    return { it, en: { salesPoint: +it.salesPoint || 0, price: +it.priceSales || null, priceStd: +it.priceStandard || null,
      cover: (it.cover || "").replace(/coversum|cover200/, "cover500").replace(/^http:/, "https:"), status: normStatus(it.stockStatus), rating: 0, at: Date.now() } };
  } catch (e) { return null; }
}

(async () => {
  let applied = 0;
  for (const [title, isbn] of Object.entries(MAP)) {
    const m = master.materials.find((x) => x.domain === "영어" && String(x.title || "").trim() === title);
    if (!m) { console.log("? 못 찾음: " + title); continue; }
    const r = await lookup(isbn); await sleep(150);
    if (!r) { console.log("✗ 조회실패: " + title + " (" + isbn + ")"); continue; }
    console.log(`✓ ${title.slice(0, 34).padEnd(34)} → ${isbn} | ${r.en.price || "?"}원 | SP${r.en.salesPoint} | ${String(r.it.title).slice(0, 38)}`);
    if (APPLY) { m.isbn = isbn; if (!m.publisher && r.it.publisher) m.publisher = r.it.publisher; cache[isbn] = r.en; applied++; }
  }
  if (!APPLY) { console.log("\n(dry — 미실행. 적용은 --apply)"); return; }
  fs.writeFileSync(SRC, raw.replace(mm[0], `<script id="master-data" type="application/json">${JSON.stringify(master)}</script>`), "utf8");
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  console.log(`\n완료 — ${applied}종 수동 승격. 재빌드: node tools/build_app.js`);
})();
