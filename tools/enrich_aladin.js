/* 알라딘 TTB OpenAPI 보강 — 인기(SalesPoint)·가격·고해상 표지·유통상태(절판/품절)
   env ALADIN_TTBKEY 없으면 그냥 건너뜀(에러 아님). 일 5,000회 한도라 슬라이스 로테이션.
   결과: data/aladin_enrich.json (isbn → {salesPoint, price, priceStd, cover, status, rating}) → build_app.js 머지.
   사용: ALADIN_TTBKEY=xxx node tools/enrich_aladin.js  (선택 env: ENRICH_LIMIT, 기본 4500) */
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, ".."), DATA = path.join(ROOT, "data");
const KEY = (process.env.ALADIN_TTBKEY || "").trim();
if (!KEY) { console.log("ALADIN_TTBKEY 없음 — 알라딘 보강 건너뜀"); process.exit(0); }
const LIMIT = +(process.env.ENRICH_LIMIT || 4500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BOOKS = JSON.parse(fs.readFileSync(path.join(ROOT, "books.js"), "utf8").match(/window\.__BOOKS__=(\[[\s\S]*?\]);\s*\nwindow\.__TABS__/)[1]);
const CACHE = path.join(DATA, "aladin_enrich.json");
let cache = {}; try { cache = JSON.parse(fs.readFileSync(CACHE, "utf8")) || {}; } catch (e) {}
const isbn13 = (s) => String(s || "").replace(/[^0-9Xx]/g, "");
const STALE = 1000 * 60 * 60 * 24 * 21;   // 21일 지난 캐시는 인기·가격 갱신차 재호출

function normStatus(s) { s = String(s || ""); if (/절판/.test(s)) return "절판"; if (/품절|일시품절|구판절판/.test(s)) return "품절"; return "정상"; }

async function lookup(isbn) {
  const u = `http://www.aladin.co.kr/ttb/api/ItemLookUp.aspx?ttbkey=${KEY}&itemIdType=ISBN13&ItemId=${isbn}&output=js&Version=20131101&OptResult=ratingInfo&Cover=Big`;
  const r = await fetch(u); const t = await r.text();
  let d; try { d = JSON.parse(t); } catch (e) { return null; }   // output=js는 JSON
  const it = d && d.item && d.item[0]; if (!it) return null;
  return {
    salesPoint: +it.salesPoint || 0,
    price: +it.priceSales || null,
    priceStd: +it.priceStandard || null,
    cover: (it.cover || "").replace(/coversum|cover200/, "cover500").replace(/^http:/, "https:"),
    status: normStatus(it.stockStatus),
    rating: (it.subInfo && +it.subInfo.ratingInfo && +it.subInfo.ratingInfo.ratingScore) || 0,
    at: Date.now(),
  };
}

(async () => {
  const now = Date.now();
  const cand = BOOKS.filter((b) => b.isbn && isbn13(b.isbn).length >= 10);
  const fresh = cand.filter((b) => !cache[isbn13(b.isbn)]);
  const stale = cand.filter((b) => cache[isbn13(b.isbn)] && (now - (cache[isbn13(b.isbn)].at || 0) > STALE));
  const targets = fresh.concat(stale).slice(0, LIMIT);
  console.log(`알라딘 보강 대상 ${targets.length}종 (신규 ${fresh.length}, 갱신 ${stale.length}, 캐시 ${Object.keys(cache).length})`);
  let n = 0, ok = 0;
  for (const b of targets) {
    const isbn = isbn13(b.isbn); n++;
    try { const r = await lookup(isbn); if (r) { cache[isbn] = r; ok++; } else if (!cache[isbn]) { cache[isbn] = { at: now, miss: 1 }; } } catch (e) {}
    if (n % 50 === 0) { fs.writeFileSync(CACHE, JSON.stringify(cache)); process.stdout.write(`  …${n}/${targets.length} (적중 ${ok})\r`); }
    await sleep(120);   // 일 5,000 한도 여유
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  console.log(`\n완료 — 호출 ${n} / 적중 ${ok} / 캐시 ${Object.keys(cache).length}`);
})();
