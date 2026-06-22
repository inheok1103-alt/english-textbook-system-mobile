/* 단일시리즈 중복표지 → 권별 실표지 재수집 (자가치유형, 영어 교재)
   - 대상: covers/ md5 중복 그룹 중 base<3 (같은 시리즈 권별 공유) → 167종 가량
   - YES24 EUC-KR 디코딩 / 차단(일반추천 응답) 감지 시 백오프 후 재시도
   - 그룹 내 이미 점유된 goods/이미지 배제 → 권별 distinct 강제
   사용: node tools/recollect_series_v2.js
*/
const fs = require("fs"), path = require("path"), cr = require("crypto");
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "data", "iinhyuk_english_book_guide_v0.9_expanded.html");
const COVERS = path.join(ROOT, "covers");
const JSON_OUT = path.join(ROOT, "data", "book_images.json");
const SLEEP = Number(process.env.COVER_SLEEP_MS || 900);
const MAX_RETRY = Number(process.env.COVER_RETRY || 6);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const md5 = (b) => cr.createHash("md5").update(b).digest("hex");
const dec = new TextDecoder("euc-kr");
const decEnt = (v) => String(v || "").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const norm = (v) => String(v || "").toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
const seriesBase = (t) => norm(String(t || "").replace(/\b\d+\s*(st|nd|rd|th)\s+edition\b/gi, " ").replace(/\b(level|lv|book|band|stage|grade|단계)\b/gi, " ").replace(/\b\d+\b/g, " "));
const volOf = (t) => { let s = " " + String(t || "").toLowerCase() + " "; s = s.replace(/\b\d+\s*(st|nd|rd|th)\s+edition\b/g, " "); const n = s.match(/\b\d+\b/g); return n ? Number(n[n.length - 1]) : null; };

const master = JSON.parse(fs.readFileSync(SRC, "utf8").match(/<script id="master-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const byUid = {}; master.materials.forEach((m) => (byUid[m.materialUid] = m));
const imgData = JSON.parse(fs.readFileSync(JSON_OUT, "utf8"));
const imgMap = imgData.images || (imgData.images = {});
const eng = master.materials.filter((m) => m.domain === "영어").map((m) => m.materialUid);

const byHash = {};
for (const uid of eng) { const f = path.join(COVERS, uid + ".jpg"); if (fs.existsSync(f)) { const h = md5(fs.readFileSync(f)); (byHash[h] = byHash[h] || []).push(uid); } }
const groups = Object.values(byHash).filter((a) => a.length > 1).filter((g) => new Set(g.map((u) => seriesBase(byUid[u].title))).size < 3);

async function fetchBuf(url) { const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36", "accept-language": "ko-KR,ko;q=0.9" } }); if (!r.ok) throw new Error("HTTP " + r.status); return Buffer.from(await r.arrayBuffer()); }
function parseCands(html) {
  const out = [], seen = new Set();
  const re = /<input\b[^>]*ORD_GOODS_OPT[^>]*>/gi; let m;
  while ((m = re.exec(html))) { const vm = m[0].match(/\bvalue=(["'])([\s\S]*?)\1/i); if (!vm) continue;
    try { const j = JSON.parse(decEnt(vm[2])); const no = String(j.goods_no || j.goodsNo || "").trim(); if (!no || seen.has(no)) continue; seen.add(no);
      out.push({ goodsNo: no, goodsName: String(j.goods_name || "").trim(), goodsAuth: decEnt(j.goodsAuth || "").replace(/<[^>]+>/g, "").trim(), imageUrl: `https://image.yes24.com/goods/${no}/L`, sourcePage: `https://www.yes24.com/Product/Goods/${no}` });
    } catch {} }
  return out;
}
function tokens(v) { return norm(v).split(" ").filter((t) => t.length >= 2 || /\d/.test(t) || /[\p{Script=Hangul}]/u.test(t)); }
function score(m, c, wantVol) {
  const got = norm(c.goodsName); let s = 0; const base = seriesBase(m.title);
  if (base && got.includes(base)) s += 45;
  for (const tk of tokens(m.title)) if (got.includes(tk)) s += tk.length >= 4 ? 7 : 4;
  const gv = volOf(c.goodsName);
  if (wantVol != null && gv != null) s += gv === wantVol ? 45 : -55;
  if (/workbook|teacher|정답|해설|답지/i.test(c.goodsName)) s -= 12;
  if (/ebook|전자책/i.test(c.goodsName)) s -= 6;
  return s;
}
function queries(m) {
  const t = String(m.title || "").replace(/\s+/g, " ").trim();
  const base = String(m.title || "").replace(/\b\d+\s*(st|nd|rd|th)\s+edition\b/gi, " ").replace(/\s+/g, " ").trim();
  const list = [t]; if (base !== t) list.push(base);
  return list.filter((q, i, a) => q && a.indexOf(q) === i).slice(0, 2);
}
// 차단 감지: 페이지에 쿼리 핵심 토큰이 없으면 일반추천(차단)으로 간주
function looksThrottled(html, m) {
  const base = seriesBase(m.title).split(" ").filter((w) => w.length >= 3).slice(0, 2);
  if (!base.length) return !/ORD_GOODS_OPT/.test(html);
  const low = html.toLowerCase();
  return !base.some((w) => low.includes(w));
}

async function searchBook(m) {
  const wantVol = volOf(m.title); let all = []; let throttled = false;
  for (const q of queries(m)) {
    const html = dec.decode(await fetchBuf(`https://www.yes24.com/Product/Search?domain=ALL&query=${encodeURIComponent(q)}`));
    if (looksThrottled(html, m)) { throttled = true; await sleep(SLEEP); continue; }
    throttled = false;
    const cands = parseCands(html).map((c) => ({ ...c, q, score: score(m, c, wantVol) }));
    all.push(...cands);
    await sleep(SLEEP);
    if (cands.some((c) => c.score >= 60)) break;
  }
  return { all, throttled };
}
async function downloadImage(url, outFile) {
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 Chrome/124", referer: "https://www.yes24.com/" } });
  if (!r.ok) throw new Error("HTTP " + r.status); const ct = r.headers.get("content-type") || "";
  if (!ct.includes("image")) throw new Error("not image");
  const buf = Buffer.from(await r.arrayBuffer()); if (buf.length < 1024) throw new Error("tiny");
  fs.writeFileSync(outFile, buf); return { bytes: buf.length, md5: md5(buf) };
}

(async () => {
  console.log(`대상 단일시리즈 그룹: ${groups.length}개 / ${groups.reduce((n, g) => n + g.length, 0)}종`);
  let fixed = 0, skipped = 0;
  for (const g of groups) {
    const origHash = md5(fs.readFileSync(path.join(COVERS, g[0] + ".jpg")));
    const claimed = new Set([origHash]); const claimedGoods = new Set();
    const uids = g.slice().sort((a, b) => (volOf(byUid[a].title) || 99) - (volOf(byUid[b].title) || 99));
    for (const uid of uids) {
      const m = byUid[uid];
      let res = null;
      for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
        try { res = await searchBook(m); } catch (e) { res = { all: [], throttled: true }; }
        if (!res.throttled) break;
        const back = Math.min(90000, 15000 * (attempt + 1));
        console.log(`  ⏳ 차단감지 — ${Math.round(back / 1000)}s 후 재시도 (${m.title})`);
        await sleep(back);
      }
      if (!res || res.throttled) { console.log(`  · ${m.title} → 차단지속, 보류`); skipped++; continue; }
      const cand = res.all.filter((c) => !claimedGoods.has(c.goodsNo)).sort((a, b) => b.score - a.score)[0];
      if (!cand || cand.score < 20) { console.log(`  · ${m.title} → 적합후보없음(유지)`); skipped++; continue; }
      try {
        const dl = await downloadImage(cand.imageUrl, path.join(COVERS, uid + ".jpg"));
        if (claimed.has(dl.md5)) { console.log(`  = ${m.title} → 동일이미지(유지)`); skipped++; }
        else { claimed.add(dl.md5); claimedGoods.add(cand.goodsNo);
          imgMap[uid] = { ...(imgMap[uid] || {}), status: cand.score >= 60 ? "found" : "needs_review", localPath: `covers/${uid}.jpg`, imageUrl: cand.imageUrl, sourcePage: cand.sourcePage, source: "YES24", sourceTitle: cand.goodsName, score: cand.score, bytes: dl.bytes, materialTitle: m.title, publisher: m.publisher, searchQuery: cand.q };
          fixed++; console.log(`  ✓ ${m.title} → [${cand.score}] ${cand.goodsName.slice(0, 46)}`);
        }
      } catch (e) { console.log(`  ! ${m.title} 다운로드실패(유지) ${e.message}`); skipped++; }
      await sleep(SLEEP);
    }
    fs.writeFileSync(JSON_OUT, JSON.stringify(imgData, null, 2), "utf8");
  }
  fs.writeFileSync(JSON_OUT, JSON.stringify(imgData, null, 2), "utf8");
  console.log(`\n완료 — 교체:${fixed} / 보류:${skipped}`);
})();
