/* 교보문고 기반 표지 재수집 (정확·비차단)
   대상: (A) 실표지 없는 책(localPath 없음 = SVG카드行) + (B) 단일시리즈 중복그룹(권별 공유)
   - 교보 검색 HTML의 data-bid(ISBN)/data-name(제목)/data-code 파싱 → 권 번호 점수
   - 표지 = contents.kyobobook.co.kr/sih/fit-in/458x0/pdt/{ISBN}.jpg
   - 그룹 내 이미 점유된 ISBN/이미지 배제 → 권별 distinct 강제
   사용: node tools/recollect_kyobo.js [--probe]
*/
const fs = require("fs"), path = require("path"), cr = require("crypto");
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "data", "iinhyuk_english_book_guide_v0.9_expanded.html");
const COVERS = path.join(ROOT, "covers");
const JSON_OUT = path.join(ROOT, "data", "book_images.json");
const SLEEP = Number(process.env.COVER_SLEEP_MS || 450);
const PROBE = process.argv.includes("--probe");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const md5 = (b) => cr.createHash("md5").update(b).digest("hex");
const ent = (s) => String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const norm = (v) => String(v || "").toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
const nospace = (v) => norm(v).replace(/\s+/g, "");
const seriesBase = (t) => norm(String(t || "")
  .replace(/\([^)]*\)/g, " ")                                  // (초4)(중1) 등 괄호 표기 제거
  .replace(/\b\d+\s*(st|nd|rd|th)\s+edition\b/gi, " ")
  .replace(/\b(level|lv|book|band|stage|grade|단계)\b/gi, " ")
  .replace(/\b[\d-]+\b/g, " "));
const volOf = (t) => { let s = " " + String(t || "").toLowerCase() + " "; s = s.replace(/\b\d+\s*(st|nd|rd|th)\s+edition\b/g, " "); const n = s.match(/\b\d+\b/g); return n ? Number(n[n.length - 1]) : null; };
// 시리즈 베이스 일치 게이트: 한글 부분토큰 오매칭(예: 리딩 와이즈 ↔ 영어리딩훈련) 차단
function passesGate(mTitle, candTitle) {
  const b = nospace(seriesBase(mTitle));
  if (b.length >= 3) return nospace(candTitle).includes(b);
  const toks = norm(mTitle).split(" ").filter((x) => x.length >= 2);
  if (!toks.length) return false;
  const g = norm(candTitle); let hit = 0; for (const x of toks) if (g.includes(x)) hit++;
  return hit >= Math.max(2, Math.ceil(toks.length * 0.6));
}

const master = JSON.parse(fs.readFileSync(SRC, "utf8").match(/<script id="master-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const byUid = {}; master.materials.forEach((m) => (byUid[m.materialUid] = m));
const imgData = JSON.parse(fs.readFileSync(JSON_OUT, "utf8"));
const imgMap = imgData.images || (imgData.images = {});
const eng = master.materials.filter((m) => m.domain === "영어").map((m) => m.materialUid);

// 기존 Kyobo 오매칭 정리: 저장된 sourceTitle이 게이트를 통과 못하면 표지 제거(→ 무표지 재시도 대상)
function revalidateKyobo() {
  let reverted = 0;
  for (const uid of eng) {
    const v = imgMap[uid];
    if (v && v.source === "Kyobo" && v.localPath && v.sourceTitle && !passesGate(byUid[uid].title, v.sourceTitle)) {
      try { fs.unlinkSync(path.join(COVERS, uid + ".jpg")); } catch {}
      imgMap[uid] = { status: "no_cover_real", materialTitle: byUid[uid].title, publisher: byUid[uid].publisher, note: "kyobo-misfit-reverted" };
      reverted++;
    }
  }
  return reverted;
}
// 현재 md5 그룹 / 무표지 집합 계산
function computeTargets() {
  const byHash = {}; const hashOf = {};
  for (const uid of eng) { const f = path.join(COVERS, uid + ".jpg"); if (fs.existsSync(f)) { const h = md5(fs.readFileSync(f)); hashOf[uid] = h; (byHash[h] = byHash[h] || []).push(uid); } }
  const dupGroups = Object.values(byHash).filter((a) => a.length > 1).filter((g) => new Set(g.map((u) => seriesBase(byUid[u].title))).size < 3);
  const inDup = new Set(dupGroups.flat());
  const noCover = eng.filter((u) => !(imgMap[u] && imgMap[u].localPath) && !inDup.has(u)); // SVG카드行 + 미수집
  return { dupGroups, inDup, noCover, hashOf };
}

async function fetchText(url) { const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36", "accept-language": "ko-KR,ko;q=0.9" } }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.text(); }
async function fetchImg(url) { const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 Chrome/124", referer: "https://www.kyobobook.co.kr/" } }); if (!r.ok) throw new Error("HTTP " + r.status); const ct = r.headers.get("content-type") || ""; if (!ct.includes("image")) throw new Error("not image"); const buf = Buffer.from(await r.arrayBuffer()); if (buf.length < 1500) throw new Error("tiny"); return buf; }

function parseKyobo(html) {
  const out = [], seen = new Set();
  const tagRe = /<input\b[^>]*\bdata-bid="(\d{10,13})"[^>]*>/g; let m;
  while ((m = tagRe.exec(html))) {
    const tag = m[0]; const bid = m[1]; if (seen.has(bid)) continue; seen.add(bid);
    const nm = tag.match(/data-name="([^"]*)"/); const cd = tag.match(/data-code="([^"]*)"/);
    out.push({ isbn: bid, title: ent(nm ? nm[1] : ""), code: cd ? cd[1] : "" });
  }
  return out.filter((x) => x.title);
}
function tokens(v) { return norm(v).split(" ").filter((t) => t.length >= 2 || /\d/.test(t) || /[\p{Script=Hangul}]/u.test(t)); }
function score(m, c, wantVol) {
  const got = norm(c.title); let s = 0; const base = seriesBase(m.title);
  if (base && base.length > 2 && got.includes(base)) s += 42;
  let hit = 0, tot = 0; for (const tk of tokens(m.title)) { tot++; if (got.includes(tk)) { hit++; s += tk.length >= 4 ? 8 : 4; } }
  if (tot && hit / tot < 0.45) s -= 28;          // 토큰 거의 안 맞으면 강한 감점(오매칭 방지)
  const gv = volOf(c.title);
  if (wantVol != null && gv != null) s += gv === wantVol ? 34 : -26;
  if (c.code === "ENG") s += 6;
  if (/workbook|work book|teacher|정답|해설|답지|word ?book|단어장|세트|전2권|전3권/i.test(c.title)) s -= 12;
  if (/\bcd\b|전자책|ebook|\bapp\b|\bqr\b/i.test(c.title)) s -= 4;
  return s;
}
function cleanTitle(m) { return String(m.title || "").replace(/\([^)]*단계[^)]*\)/g, " ").replace(/\s+/g, " ").trim(); }
function queries(m) {
  const t = cleanTitle(m);
  const q1 = t.replace(/\bLv\.?\s*/gi, "").replace(/\s+/g, " ").trim();
  const base = seriesBase(m.title), vol = volOf(m.title);
  const q2 = (base + (vol != null ? " " + vol : "")).trim();
  return [q1, q2, base].filter((q, i, a) => q && q.length > 1 && a.indexOf(q) === i).slice(0, 3);
}
function coverUrls(isbn) { return [`https://contents.kyobobook.co.kr/sih/fit-in/458x0/pdt/${isbn}.jpg`, `https://contents.kyobobook.co.kr/pdt/${isbn}.jpg`]; }

async function pick(m, wantVol, claimedIsbn) {
  let cands = [];
  for (const q of queries(m)) {
    let items;
    try { items = parseKyobo(await fetchText("https://search.kyobobook.co.kr/search?keyword=" + encodeURIComponent(q))); }
    catch (e) { await sleep(SLEEP); continue; }
    cands.push(...items.filter((c) => passesGate(m.title, c.title)).map((c) => ({ ...c, q, score: score(m, c, wantVol) })));
    await sleep(SLEEP);
    if (cands.some((c) => c.score >= 55 && !claimedIsbn.has(c.isbn))) break;
  }
  return cands.filter((c) => !claimedIsbn.has(c.isbn)).sort((a, b) => b.score - a.score)[0];
}
async function saveCover(uid, m, best, claimed) {
  for (const cu of coverUrls(best.isbn)) {
    try { const buf = await fetchImg(cu); const h = md5(buf);
      if (claimed.has(h)) return false;                 // 동일이미지 → 다음
      fs.writeFileSync(path.join(COVERS, uid + ".jpg"), buf); claimed.add(h);
      imgMap[uid] = { ...(imgMap[uid] || {}), status: best.score >= 55 ? "found" : "needs_review", localPath: `covers/${uid}.jpg`, imageUrl: cu, sourcePage: `https://product.kyobobook.co.kr/detail/${best.isbn}`, source: "Kyobo", sourceTitle: best.title, isbn: best.isbn, score: best.score, bytes: buf.length, materialTitle: m.title, publisher: m.publisher, searchQuery: best.q };
      return true;
    } catch (e) { /* next url */ }
  }
  return false;
}

(async () => {
  const reverted = revalidateKyobo();
  if (reverted) { fs.writeFileSync(JSON_OUT, JSON.stringify(imgData, null, 2), "utf8"); console.log(`기존 Kyobo 오매칭 정리: ${reverted}종 → 무표지(재시도 대상)`); }
  const { dupGroups, inDup, noCover, hashOf } = computeTargets();
  console.log(`대상: 시리즈중복 ${dupGroups.length}그룹/${inDup.size}종 + 표지없음 ${noCover.length}종`);
  if (PROBE) { console.log("표지없음 샘플:", noCover.slice(0, 20).map((u) => byUid[u].title).join(" · ")); return; }
  let fixed = 0, skip = 0;

  // (A) 시리즈 중복 그룹 → 권별 distinct
  for (const g of dupGroups) {
    const claimed = new Set([hashOf[g[0]]]); const claimedIsbn = new Set();
    const uids = g.slice().sort((a, b) => (volOf(byUid[a].title) || 99) - (volOf(byUid[b].title) || 99));
    for (const uid of uids) {
      const m = byUid[uid]; const best = await pick(m, volOf(m.title), claimedIsbn);
      if (!best || best.score < 24) { console.log(`  · ${m.title} → 후보없음(유지)`); skip++; continue; }
      claimedIsbn.add(best.isbn);
      if (await saveCover(uid, m, best, claimed)) { fixed++; console.log(`  ✓ ${m.title} → [${best.score}] ${best.title.slice(0, 44)} (${best.isbn})`); }
      else { console.log(`  = ${m.title} → 동일/실패(유지)`); skip++; }
    }
    fs.writeFileSync(JSON_OUT, JSON.stringify(imgData, null, 2), "utf8");
  }

  // (B) 표지 없음(카드行) → 실표지 시도
  let n = 0;
  for (const uid of noCover) {
    const m = byUid[uid]; const claimed = new Set(); const best = await pick(m, volOf(m.title), new Set());
    if (!best || best.score < 30) { console.log(`  · (무표지) ${m.title} → 후보없음`); skip++; }
    else if (await saveCover(uid, m, best, claimed)) { fixed++; console.log(`  ✓ (무표지) ${m.title} → [${best.score}] ${best.title.slice(0, 40)}`); }
    else { console.log(`  = (무표지) ${m.title} → 실패`); skip++; }
    if (++n % 15 === 0) fs.writeFileSync(JSON_OUT, JSON.stringify(imgData, null, 2), "utf8");
  }
  fs.writeFileSync(JSON_OUT, JSON.stringify(imgData, null, 2), "utf8");
  console.log(`\n완료 — 교체/획득:${fixed} / 보류:${skip}`);
})();
