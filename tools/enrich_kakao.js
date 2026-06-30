/* 카카오(다음) 책 검색 v3 보강 — 알라딘 결손분의 가격·표지·상태 폴백
   env KAKAO_REST_KEY 없으면 건너뜀. ISBN당 1콜.
   결과: data/kakao_enrich.json (isbn → {price, cover, status}) → build_app.js 머지(알라딘 다음 우선순위).
   사용: KAKAO_REST_KEY=xxx node tools/enrich_kakao.js  (선택 env: ENRICH_LIMIT, 기본 8000) */
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, ".."), DATA = path.join(ROOT, "data");
const KEY = (process.env.KAKAO_REST_KEY || "").trim();
if (!KEY) { console.log("KAKAO_REST_KEY 없음 — 카카오 보강 건너뜀"); process.exit(0); }
const LIMIT = +(process.env.ENRICH_LIMIT || 8000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BOOKS = JSON.parse(fs.readFileSync(path.join(ROOT, "books.js"), "utf8").match(/window\.__BOOKS__=(\[[\s\S]*?\]);\s*\nwindow\.__TABS__/)[1]);
const CACHE = path.join(DATA, "kakao_enrich.json");
let cache = {}; try { cache = JSON.parse(fs.readFileSync(CACHE, "utf8")) || {}; } catch (e) {}
let aladin = {}; try { aladin = JSON.parse(fs.readFileSync(path.join(DATA, "aladin_enrich.json"), "utf8")) || {}; } catch (e) {}
const isbn13 = (s) => String(s || "").replace(/[^0-9Xx]/g, "");

async function search(isbn) {
  const u = `https://dapi.kakao.com/v3/search/book?target=isbn&query=${isbn}`;
  const r = await fetch(u, { headers: { Authorization: "KakaoAK " + KEY } }); if (!r.ok) return null;
  const d = await r.json(); const doc = d.documents && d.documents[0]; if (!doc) return null;
  let status = "정상"; if (/절판/.test(doc.status || "")) status = "절판"; else if (/품절/.test(doc.status || "")) status = "품절";
  return { price: +doc.sale_price > 0 ? +doc.sale_price : (+doc.price || null), cover: (doc.thumbnail || "").replace(/^http:/, "https:"), status, at: Date.now() };
}

(async () => {
  // 알라딘이 가격·표지를 못 채운 isbn만 대상(폴백)
  const targets = BOOKS.filter((b) => { const i = isbn13(b.isbn); if (!i || i.length < 10 || cache[i]) return false;
    const a = aladin[i]; return !a || (!a.price && !a.cover); }).slice(0, LIMIT);
  console.log(`카카오 보강 대상 ${targets.length}종 (캐시 ${Object.keys(cache).length})`);
  let n = 0, ok = 0;
  for (const b of targets) {
    const isbn = isbn13(b.isbn); n++;
    try { const r = await search(isbn); if (r) { cache[isbn] = r; ok++; } else cache[isbn] = { at: Date.now(), miss: 1 }; } catch (e) {}
    if (n % 50 === 0) { fs.writeFileSync(CACHE, JSON.stringify(cache)); process.stdout.write(`  …${n}/${targets.length} (적중 ${ok})\r`); }
    await sleep(120);
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  console.log(`\n완료 — 호출 ${n} / 적중 ${ok} / 캐시 ${Object.keys(cache).length}`);
})();
