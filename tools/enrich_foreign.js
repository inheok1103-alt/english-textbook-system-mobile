/* 원서(foreign) 표지·메타 보강 — 키 불필요(Open Library Covers + Google Books 폴백)
   대상: books.js 의 foreign===true 이고 원격표지 없는 책. 슬라이스 로테이션·throttle·증분 캐시.
   결과: data/foreign_enrich.json (isbn → {cover, foreignDesc, track})  → build_app.js가 머지.
   사용: node tools/enrich_foreign.js   (선택 env: GOOGLE_BOOKS_KEY, ENRICH_LIMIT) */
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, ".."), DATA = path.join(ROOT, "data");
const GB_KEY = process.env.GOOGLE_BOOKS_KEY || "";
const LIMIT = +(process.env.ENRICH_LIMIT || 150);
const UA = { "User-Agent": "iinhyuk-english-curriculum/1.0 (+inhyug1103@gmail.com)" };
const CACHE = path.join(DATA, "foreign_enrich.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BOOKS = JSON.parse(fs.readFileSync(path.join(ROOT, "books.js"), "utf8").match(/window\.__BOOKS__=(\[[\s\S]*?\]);\s*\nwindow\.__TABS__/)[1]);
let cache = {}; try { cache = JSON.parse(fs.readFileSync(CACHE, "utf8")) || {}; } catch (e) {}

function isbn13(s) { return String(s || "").replace(/[^0-9Xx]/g, ""); }
function remoteCover(c) { return c && /^https?:/.test(c); }

async function olCover(isbn) {   // 200 + 충분한 크기면 표지 존재
  const url = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
  try { const r = await fetch(url, { headers: UA }); if (r.ok && (+(r.headers.get("content-length") || 0) > 1000 || !r.headers.get("content-length"))) return url; } catch (e) {}
  return "";
}
async function olMeta(isbn) {
  try { const r = await fetch(`https://openlibrary.org/isbn/${isbn}.json`, { headers: UA }); if (!r.ok) return {}; const d = await r.json();
    return { track: Array.isArray(d.subjects) ? d.subjects.slice(0, 2).join(" · ") : "" }; } catch (e) { return {}; }
}
async function gbook(isbn) {
  try { const u = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&country=KR` + (GB_KEY ? `&key=${GB_KEY}` : "");
    const r = await fetch(u, { headers: UA }); if (!r.ok) return {}; const d = await r.json(); const v = d.items && d.items[0] && d.items[0].volumeInfo; if (!v) return {};
    let cover = (v.imageLinks && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail)) || ""; cover = cover.replace(/^http:/, "https:");
    return { cover, foreignDesc: (v.description || "").slice(0, 240), track: (v.categories || []).slice(0, 2).join(" · ") };
  } catch (e) { return {}; }
}

(async () => {
  const targets = BOOKS.filter((b) => b.foreign && b.isbn && !cache[isbn13(b.isbn)] && !remoteCover(b.cover)).slice(0, LIMIT);
  console.log(`원서 보강 대상 ${targets.length}종 (캐시 ${Object.keys(cache).length}, GB키 ${GB_KEY ? "○" : "×"})`);
  let n = 0, hit = 0;
  for (const b of targets) {
    const isbn = isbn13(b.isbn); n++;
    let cover = await olCover(isbn); let meta = {};
    if (cover) { meta = await olMeta(isbn); } else { const g = await gbook(isbn); cover = g.cover || ""; meta = g; }
    cache[isbn] = { cover: cover || "", foreignDesc: meta.foreignDesc || "", track: meta.track || "", at: new Date().toISOString().slice(0, 10) };
    if (cover) hit++;
    if (n % 25 === 0) { fs.writeFileSync(CACHE, JSON.stringify(cache)); process.stdout.write(`  …${n}/${targets.length} (표지 ${hit})\r`); }
    await sleep(320);
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  console.log(`\n완료 — 처리 ${n} / 표지확보 ${hit} / 캐시 ${Object.keys(cache).length}`);
})();
