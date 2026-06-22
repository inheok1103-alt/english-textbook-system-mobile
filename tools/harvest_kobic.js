/* KOBIC 영어교재 하베스터 (Stage A: 후보 발굴)
   - 영어학습 키워드로 KOBIC 검색 → 페이지네이션 → li 파싱
   - 주요 영어교재 출판사로 필터 → ISBN 중복제거 → data/_kobic_candidates.json
   사용: node tools/harvest_kobic.js --probe   (1쿼리 1페이지 파서 검증)
        node tools/harvest_kobic.js            (전체 발굴)
   env: KOBIC_MAXPAGES(기본 30), KOBIC_SLEEP(기본 350)
*/
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "data", "_kobic_candidates.json");
const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36", "accept-language": "ko-KR,ko;q=0.9" };
const MAXPAGES = Number(process.env.KOBIC_MAXPAGES || 30);
const SLEEP = Number(process.env.KOBIC_SLEEP || 350);
const PROBE = process.argv.includes("--probe");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dec = (b) => new TextDecoder("utf-8").decode(b);
const strip = (s) => (s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

// 영어학습 검색어 (메타데이터 커버리지 극대화)
const TERMS = ["영문법", "영어독해", "영어듣기", "영어회화", "영단어", "영어어휘", "파닉스", "영어리딩", "영어구문",
  "영작", "영어쓰기", "중학영어", "초등영어", "고등영어", "수능영어", "영어 문제집", "영어 독해", "영어 단어",
  "english grammar", "english reading", "phonics", "리딩튜터", "그래머", "보카"];

// 주요 한국 영어교재 출판사(정규화 키워드)
const PUBS = ["키출판사", "좋은책신사고", "신사고", "쎄듀", "ybm", "천재교육", "천재교과서", "ebs", "비상교육", "비상",
  "수경출판사", "자이스토리", "ne능률", "능률", "에이리스트", "a*list", "alist", "이퓨쳐", "이퓨처", "e-future", "efuture",
  "다락원", "이투스", "마더텅", "동아출판", "길벗", "메가스터디", "사람in", "사람인", "미래엔", "디딤돌", "해커스",
  "진학사", "웅진", "컴퍼스", "compass", "윤선생", "브릭스", "bricks", "투판즈", "월드컴", "정상제이엘에스", "청담",
  "시원스쿨", "넥서스", "다산", "위즈덤하우스", "smart", "스마트", "롱테일", "두산동아", "지학사", "good books"];
const pubMatch = (p) => { const n = String(p || "").toLowerCase().replace(/[^a-z0-9가-힣]/g, ""); return PUBS.some((k) => n.includes(k.toLowerCase().replace(/[^a-z0-9가-힣]/g, ""))); };

async function getPage(term, page) {
  const u = `https://www.kobic.net/book/searchBook/list.do?q=${encodeURIComponent(term)}&rowsCountPerPage=50&page=${page}`;
  return dec(Buffer.from(await (await fetch(u, { headers: UA })).arrayBuffer()));
}
function parseItems(html) {
  const out = [];
  const re = /<li class="list-item"\s+isbn="(\d{10,13})"\s+bookIdx="(\d+)">([\s\S]*?)<\/li>/gi; let m;
  while ((m = re.exec(html))) {
    const isbn = m[1], idx = m[2], inner = m[3];
    const txt = strip(inner);
    const pub = (txt.match(/출판사\s*:\s*([^:]+?)\s*(?:발행일|ISBN|출간분류|분류)\s*:/) || [])[1] || (txt.match(/출판사\s*:\s*(\S[^|]*)/) || [])[1] || "";
    const date = (txt.match(/발행일\s*:\s*([0-9]{4}년\s*[0-9]{1,2}월\s*[0-9]{1,2}일|[0-9]{4}[.\-][0-9]{1,2})/) || [])[1] || "";
    const cls = (txt.match(/(?:출간)?분류\s*:\s*([^:]+?)\s*(?:ISBN|$)/) || [])[1] || "";
    // 제목: 저자/출판사 라벨 앞 텍스트 (a 태그 우선)
    let title = strip((inner.match(/<a[^>]*>([\s\S]*?)<\/a>/) || [])[1]);
    if (!title || title.length < 2) title = (txt.split(/저자\s*:/)[0] || "").trim();
    title = title.replace(/\s+/g, " ").trim();
    out.push({ isbn, idx, title, pub: pub.trim(), date: date.trim(), cls: cls.trim() });
  }
  return out;
}
function totalPages(html) {
  const m = html.match(/\((\d+)\/([\d,]+)\s*페이지\)/);
  return m ? Number(m[2].replace(/,/g, "")) : 1;
}

(async () => {
  if (PROBE) {
    const html = await getPage("미국교과서 읽는 리딩", 1);
    const items = parseItems(html);
    console.log("총페이지:", totalPages(html), "| 파싱:", items.length);
    items.slice(0, 6).forEach((x) => console.log(JSON.stringify(x)));
    console.log("\n출판사필터 통과:", items.filter((x) => pubMatch(x.pub)).length);
    return;
  }
  const seen = {}; let calls = 0;
  for (const term of TERMS) {
    let p1; try { p1 = await getPage(term, 1); } catch (e) { console.log("ERR term", term, e.message); continue; }
    const tp = Math.min(totalPages(p1), MAXPAGES);
    let added = 0;
    for (let pg = 1; pg <= tp; pg++) {
      let html; try { html = pg === 1 ? p1 : await getPage(term, pg); } catch (e) { break; }
      calls++;
      for (const it of parseItems(html)) {
        if (!pubMatch(it.pub)) continue;
        if (!seen[it.isbn]) { seen[it.isbn] = it; added++; }
      }
      if (pg < tp) await sleep(SLEEP);
    }
    console.log(`"${term}" → ${tp}p, 누적 ${Object.keys(seen).length}종 (+${added})`);
    fs.writeFileSync(OUT, JSON.stringify({ count: Object.keys(seen).length, items: Object.values(seen) }, null, 1), "utf8");
    await sleep(SLEEP);
  }
  console.log(`\n발굴 완료: ${Object.keys(seen).length}종 (호출 ${calls}) → ${OUT}`);
})();
