/* 판매 인기 랭킹 생성 — rankings.json 출력. 두 축:
   ① 누적 인기: 알라딘 판매지수(salesPoint) 누적 순위. 로컬 books.js만 사용(API 無, 매 사이클 갱신).
   ② 주간 베스트: 알라딘 베스트셀러 API(QueryType=Bestseller) 실호출 — 학년대별 영어 카테고리의
      "이번 주 실제 판매순위". 카탈로그 ISBN과 매칭(클릭연결), 미매칭은 신간으로 표시.
   ※ 주간은 알라딘이 주1회 갱신 → 20시간 신선도 가드로 하루 1회만 호출(브레인 2h×12 낭비 방지).
   ※ 키 없으면(ALADIN_TTBKEY 미설정) 주간은 건너뛰고 누적만 — 파이프라인 안전.
   사용: [ALADIN_TTBKEY=키] node tools/harvest_rankings.js   (books.js 필요 — build 이후) */
const fs = require("fs"), path = require("path"), https = require("https");
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "books.js");
const OUT = path.join(ROOT, "rankings.json");
const KEY = (process.env.ALADIN_TTBKEY || "").trim();

const B = JSON.parse(fs.readFileSync(SRC, "utf8").match(/window\.__BOOKS__=(\[[\s\S]*?\]);\s*\nwindow\.__TABS__/)[1]);
const pool = B.filter((b) => (b.salesPoint || 0) > 0 && b.status !== "절판");

// 카탈로그 gradeBand → 랭킹 필터 칩(초/중/고/성인) 매핑
const mapG = (g) => ({ "유아/예비초": "초", "초등": "초", "중등": "중", "고등": "고", "성인": "성인", "대학/전공": "성인" })[g] || "";
const BUCKETS = [
  ["전체", () => true],
  ["초", (b) => mapG(b.gradeBand) === "초"],
  ["중", (b) => mapG(b.gradeBand) === "중"],
  ["고", (b) => mapG(b.gradeBand) === "고"],
  ["성인", (b) => mapG(b.gradeBand) === "성인"],
];

// 같은 시리즈 도배 완화 — 정규화 제목 접두로 버킷당 시리즈 2종까지만
function seriesKey(t) {
  return String(t || "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/\b(level|lv|book|권|단계|\d+)\b/gi, " ").replace(/[^a-z0-9가-힣]/g, "").slice(0, 12);
}

// ===== ① 누적 인기(로컬 salesPoint) =====
const items = [];
BUCKETS.forEach(([key, f]) => {
  const seen = {};
  pool.filter(f).sort((a, b) => b.salesPoint - a.salesPoint).forEach((b) => {
    if (items.filter((x) => x.gradeBand === key).length >= 25) return;
    const sk = seriesKey(b.title); if (sk) { if ((seen[sk] = (seen[sk] || 0) + 1) > 2) return; }
    const rank = items.filter((x) => x.gradeBand === key).length + 1;
    items.push({ rank, gradeBand: key, englishArea: b.skill || "통합", title: b.title, isbn: b.isbn || "",
      matchedUid: b.id, publisher: b.pub || "", cover: b.cover || "", salesPoint: b.salesPoint, price: b.price || null, foreign: !!b.foreign, source: "aladin" });
  });
});

// ===== ② 주간 베스트(알라딘 베스트셀러 API) =====
// 학년대별 영어 카테고리 CID(harvest 발견분에서 대표 선별)
const WEEKLY_CIDS = [
  { cid: 55556, bucket: "초" }, { cid: 52195, bucket: "초" }, { cid: 52194, bucket: "초" }, { cid: 35148, bucket: "초" },
  { cid: 76738, bucket: "중" }, { cid: 76737, bucket: "중" }, { cid: 76835, bucket: "중" }, { cid: 76825, bucket: "중" },
  { cid: 77121, bucket: "고" }, { cid: 77127, bucket: "고" }, { cid: 77029, bucket: "고" }, { cid: 77115, bucket: "고" },
  { cid: 49854, bucket: "성인" }, { cid: 49849, bucket: "성인" }, { cid: 49835, bucket: "성인" }, { cid: 49838, bucket: "성인" }, { cid: 34626, bucket: "성인" },
];
const isbnMap = {};                                        // ISBN → 카탈로그 책(클릭연결·로컬표지)
B.forEach((b) => { if (b.isbn) isbnMap[String(b.isbn).replace(/[^0-9Xx]/g, "")] = b; });

function apiGet(url) {
  return new Promise((res) => {
    https.get(url, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { res(null); } }); }).on("error", () => res(null));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function weekLabel(d) {                                     // "7월 1주" 근사(월 내 몇 번째 주)
  const wk = Math.ceil((d.getDate()) / 7);
  return `${d.getMonth() + 1}월 ${wk}주`;
}

async function buildWeekly() {
  // 신선도 가드: 기존 weekly가 20시간 내면 재사용(알라딘 주1회 갱신이라 하루 1회로 충분)
  try {
    const prev = JSON.parse(fs.readFileSync(OUT, "utf8"));
    const prevHas = prev.weekly && prev.weekly.byBucket && Object.values(prev.weekly.byBucket).some((a) => Array.isArray(a) && a.length);
    // ⚠️ 비어있는 weekly는 재사용 금지(빈 채로 20h 고정되는 사고 방지). 내용 있을 때만 신선도 재사용.
    if (prevHas && prev.weekly.fetchedAt && (Date.now() - new Date(prev.weekly.fetchedAt).getTime()) < 20 * 3600 * 1000) {
      console.log("주간 베스트: 기존본 신선(20h내) — 재사용");
      return prev.weekly;
    }
  } catch (e) {}
  if (!KEY) { console.log("주간 베스트: ALADIN_TTBKEY 없음 — 건너뜀(누적만)"); return null; }

  const byCid = {};                                        // cid → items
  let calls = 0, ok = 0;
  for (const { cid, bucket } of WEEKLY_CIDS) {
    const url = `https://www.aladin.co.kr/ttb/api/ItemList.aspx?ttbkey=${KEY}&QueryType=Bestseller&SearchTarget=Book&CategoryId=${cid}&MaxResults=30&start=1&output=js&Version=20131101&Cover=Big`;
    let j = await apiGet(url); calls++;
    if (!j || !j.item || !j.item.length) { await sleep(400); j = await apiGet(url); calls++; }   // 빈 응답도 1회 재시도
    if (j && j.item && j.item.length) { byCid[cid] = { bucket, items: j.item }; ok++; }          // 빈 배열은 성공 아님
    await sleep(300);                                       // 예의상 간격
  }
  if (!ok) { console.log("주간 베스트: 응답 0 — 건너뜀(기존 weekly 유지)"); return null; }

  // 버킷별 병합·중복제거(ISBN)·시리즈완화·상위 20
  const byBucket = {};
  ["초", "중", "고", "성인"].forEach((bk) => {
    const merged = {};
    Object.values(byCid).filter((v) => v.bucket === bk).forEach((v) => {
      v.items.forEach((it) => {
        const isbn = String(it.isbn13 || it.isbn || "").replace(/[^0-9Xx]/g, "");
        if (!isbn) return;
        const sp = +it.salesPoint || 0;
        if (!merged[isbn] || sp > merged[isbn].salesPoint) merged[isbn] = { it, isbn, salesPoint: sp };
      });
    });
    const seen = {};
    const list = Object.values(merged).sort((a, b) => b.salesPoint - a.salesPoint).filter((x) => {
      const sk = seriesKey(x.it.title); if (sk) { if ((seen[sk] = (seen[sk] || 0) + 1) > 2) return false; } return true;
    }).slice(0, 20).map((x, i) => {
      const cb = isbnMap[x.isbn];                            // 카탈로그 매칭
      return {
        rank: i + 1, bucket: bk, title: (x.it.title || "").replace(/\s*-\s*.*$/, "").slice(0, 70),
        isbn: x.isbn, salesPoint: x.salesPoint, price: +x.it.priceSales || null,
        aladinRank: +x.it.bestRank || null, publisher: x.it.publisher || "",
        matchedUid: cb ? cb.id : null, inCatalog: !!cb,
        // 알라딘 원격표지(CDN) 우선 — PC·모바일 라이브 모두에서 로드됨. 로컬 covers/IH-ALADIN-*.jpg는
        // 모바일 리포에 동기 안 돼(용량 제외) 404 나므로 원격을 primary로. 원격 없으면 로컬 폴백.
        cover: x.it.cover || (cb ? cb.cover : ""),
        coverLocal: cb ? cb.cover : "",                      // onerror 2차 폴백용(로컬 존재 시)
        englishArea: cb ? (cb.skill || "통합") : "",
      };
    });
    byBucket[bk] = list;
  });
  // 전체 = 4버킷 합쳐 salesPoint 재정렬 상위 25
  const all = [].concat(...Object.values(byBucket));
  const seenA = {}; const dedupA = {};
  all.forEach((x) => { if (!dedupA[x.isbn] || x.salesPoint > dedupA[x.isbn].salesPoint) dedupA[x.isbn] = x; });
  byBucket["전체"] = Object.values(dedupA).sort((a, b) => b.salesPoint - a.salesPoint).filter((x) => {
    const sk = seriesKey(x.title); if (sk) { if ((seenA[sk] = (seenA[sk] || 0) + 1) > 2) return false; } return true;
  }).slice(0, 25).map((x, i) => ({ ...x, bucket: "전체", rank: i + 1 }));

  // 최종 빈-가드: 4버킷 전부 비면 weekly 자체를 쓰지 않음(빈 채로 라이브 노출 방지) → 기존본 유지.
  if (!all.length) { console.log("주간 베스트: 병합결과 0 — weekly 미기록(기존 유지)"); return null; }

  const now = new Date();
  console.log(`주간 베스트: 호출 ${calls} · 카테고리 ${ok}/${WEEKLY_CIDS.length} · 초${byBucket["초"].length}·중${byBucket["중"].length}·고${byBucket["고"].length}·성인${byBucket["성인"].length}`);
  return { fetchedAt: now.toISOString(), weekLabel: weekLabel(now), source: "aladin_bestseller",
    note: "알라딘 주간 베스트셀러(학년대별 영어 카테고리) — 이번 주 실제 판매순위", buckets: ["전체", "초", "중", "고", "성인"], byBucket };
}

(async () => {
  const weekly = await buildWeekly();
  const out = { generatedAt: new Date().toISOString(), source: "aladin_salespoint",
    note: "알라딘 판매지수 기준 인기 순위(카탈로그) — 매일 자동 갱신", buckets: BUCKETS.map((x) => x[0]), count: items.length, items };
  if (weekly) out.weekly = weekly;
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`rankings.json 생성 — 누적 ${items.length}항목${weekly ? " + 주간 " + Object.values(weekly.byBucket).reduce((a, b) => a + b.length, 0) + "항목(" + weekly.weekLabel + ")" : ""} / 갱신 ${out.generatedAt.slice(0, 10)}`);
})();
