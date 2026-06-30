/* 레거시 맨카드 → 정식 카드 승격: 알라딘 제목검색(ItemSearch)으로 ISBN·표지·가격·판매지수 매칭.
   대상: 영어 + ISBN 없음 + 특목고·문법서 레거시(track/tag에 특목고). 진짜 책 34종.
   외국 원서는 SearchTarget=Foreign, 국내서(한글 제목)는 Book. 제목 토큰 일치율로 신뢰도 산정.
   - 매칭되면 master-data의 isbn/publisher 채우고 data/aladin_enrich.json 에 표지·가격·판매지수 기록 → build가 머지.
   - 신뢰도 high(자동적용) / low(보고만). 기본 dry, --apply 로 실제 반영.
   env ALADIN_TTBKEY 필요.  사용: ALADIN_TTBKEY=xxx node tools/match_legacy_isbn.js [--apply]
*/
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, ".."), DATA = path.join(ROOT, "data");
const SRC = path.join(DATA, "iinhyuk_english_book_guide_v0.9_expanded.html");
const CACHE = path.join(DATA, "aladin_enrich.json");
const KEY = (process.env.ALADIN_TTBKEY || "").trim();
const APPLY = process.argv.includes("--apply");
if (!KEY) { console.log("ALADIN_TTBKEY 없음 — 중단"); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const raw = fs.readFileSync(SRC, "utf8");
const mm = raw.match(/<script id="master-data" type="application\/json">([\s\S]*?)<\/script>/);
const master = JSON.parse(mm[1]);
let cache = {}; try { cache = JSON.parse(fs.readFileSync(CACHE, "utf8")) || {}; } catch (e) {}

const isLegacy = (m) => m.domain === "영어" && !(m.isbn && String(m.isbn).replace(/[^0-9Xx]/g, "").length >= 10)
  && (/특목고/.test(m.category || "") || (m.tags || []).some((t) => /특목고/.test(t)) || /특목고/.test(m.kobicCategory || ""));
const targets = master.materials.filter(isLegacy);

const hasHangul = (s) => /[가-힣]/.test(s);
// 검색어 정제 — 괄호/부가설명/시리즈 표기/레벨범위 제거, '/'→공백
function cleanQ(t) {
  return String(t || "")
    .replace(/\([^)]*\)|（[^）]*）/g, " ")               // 괄호 주석 제거
    .replace(/원서\s*리딩|시리즈|필독\s*원서|대비\s*교재/g, " ")
    .replace(/\b\d+\s*~\s*\d+\b/g, " ")                  // 1~4 레벨범위
    .replace(/[\/·,]/g, " ")
    .replace(/\s+/g, " ").trim();
}
const STOP = new Set(["the", "a", "an", "of", "in", "to", "for", "and", "&", "on", "i", "/"]);
const toks = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9가-힣\s]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
function score(qTitle, cTitle) {
  const q = toks(qTitle), c = new Set(toks(cTitle));
  if (!q.length) return 0;
  let hit = 0; q.forEach((w) => { if (c.has(w)) hit++; });
  return hit / q.length;
}
function normStatus(s) { s = String(s || ""); if (/절판/.test(s)) return "절판"; if (/품절/.test(s)) return "품절"; return "정상"; }

async function search(q, target) {
  const u = `https://www.aladin.co.kr/ttb/api/ItemSearch.aspx?ttbkey=${KEY}` +
    `&Query=${encodeURIComponent(q)}&QueryType=Keyword&MaxResults=10&start=1` +
    `&SearchTarget=${target}&Sort=SalesPoint&Cover=Big&output=js&Version=20131101`;
  try { const r = await fetch(u); const t = await r.text(); const d = JSON.parse(t); return (d && d.item) || []; }
  catch (e) { return []; }
}

(async () => {
  console.log(`승격 대상 ${targets.length}종 — 알라딘 제목검색 매칭${APPLY ? " (APPLY)" : " (dry)"}\n`);
  const results = [];
  for (const m of targets) {
    const q = cleanQ(m.title);
    const primary = hasHangul(m.title) ? "Book" : "Foreign";
    const order = primary === "Book" ? ["Book", "Foreign"] : ["Foreign", "Book"];
    let best = null;
    for (const tg of order) {
      const items = await search(q, tg); await sleep(150);
      for (const it of items) {
        const sc = score(q, it.title);
        const cand = { sc, it, target: tg };
        if (!best || sc > best.sc || (sc === best.sc && (+it.salesPoint || 0) > (+best.it.salesPoint || 0))) best = cand;
      }
      if (best && best.sc >= 0.8) break;   // 충분히 좋으면 다른 타깃 생략
    }
    if (!best || best.sc < 0.5) { results.push({ m, best, tier: "miss" }); continue; }
    const it = best.it, isbn = String(it.isbn13 || it.isbn || "").replace(/[^0-9Xx]/g, "");
    const sp = +it.salesPoint || 0, ctok = toks(q).length;
    // HIGH: 강한 일치 + 정상 ISBN13 + 판매실적 + (다토큰 또는 단일토큰이라도 충분히 인기) → 우연 일치(자기계발서·공책 등) 차단
    const tier = (best.sc >= 0.75 && isbn.length >= 13 && sp >= 10 && (ctok >= 2 || sp >= 1000)) ? "high" : "low";
    results.push({ m, best, isbn, tier });
  }

  const T = { high: [], low: [], miss: [] };
  results.forEach((r) => T[r.tier].push(r));
  const show = (r) => `  [${(r.best ? r.best.sc.toFixed(2) : "—")}] ${String(r.m.title).slice(0, 38).padEnd(38)} → ${r.best ? String(r.best.it.title).slice(0, 40) + "  (" + r.isbn + ", " + (r.best.it.priceSales || "?") + "원, SP" + (r.best.it.salesPoint || 0) + ")" : "✗ 매칭없음"}`;
  console.log("■ HIGH(자동적용):"); T.high.forEach((r) => console.log(show(r)));
  console.log("\n■ LOW(보고만 — 검토 후 수동):"); T.low.forEach((r) => console.log(show(r)));
  console.log("\n■ MISS(검색 실패):"); T.miss.forEach((r) => console.log(show(r)));
  console.log(`\n요약: HIGH ${T.high.length} / LOW ${T.low.length} / MISS ${T.miss.length} (총 ${results.length})`);

  if (!APPLY) { console.log("\n(dry — 미실행. 적용은 --apply, HIGH만 반영)"); return; }
  let applied = 0;
  T.high.forEach((r) => {
    const it = r.best.it;
    r.m.isbn = r.isbn;
    if (!r.m.publisher && it.publisher) r.m.publisher = it.publisher;
    cache[r.isbn] = {
      salesPoint: +it.salesPoint || 0,
      price: +it.priceSales || null,
      priceStd: +it.priceStandard || null,
      cover: (it.cover || "").replace(/coversum|cover200/, "cover500").replace(/^http:/, "https:"),
      status: normStatus(it.stockStatus),
      rating: 0, at: Date.now(),
    };
    applied++;
  });
  fs.writeFileSync(SRC, raw.replace(mm[0], `<script id="master-data" type="application/json">${JSON.stringify(master)}</script>`), "utf8");
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  console.log(`\n완료 — ${applied}종 승격(ISBN·표지·가격·판매지수 반영). 재빌드 필요: node tools/build_app.js`);
})();
