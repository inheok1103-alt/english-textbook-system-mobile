/* KOBIC 하베스트 Stage B: 상세 보강 + 마스터 병합
   - _kobic_candidates.json 의 신규 ISBN을 기존 마스터와 중복제거(ISBN/제목)
   - KOBIC 상세 → 표지·목차·분류·KDC·발행일·쪽수·정가·절판(pjul_yn)
   - 영어 확인(KDC 740 or 분류 영어 or 제목 영어키워드) → skill/gradeBand 분류
   - master.materials 에 추가(status: 정상/절판), 표지 다운로드, imgMap 갱신
   사용: node tools/harvest_kobic_merge.js [--limit N]
   resumable: 이미 추가된 ISBN/uid는 건너뜀
*/
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "data", "iinhyuk_english_book_guide_v0.9_expanded.html");
const CAND = path.join(ROOT, "data", "_kobic_candidates.json");
const IMG = path.join(ROOT, "data", "book_images.json");
const COVERS = path.join(ROOT, "covers");
const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36", "accept-language": "ko-KR,ko;q=0.9" };
const SLEEP = Number(process.env.KOBIC_SLEEP || 300);
const LIMIT = (() => { const i = process.argv.indexOf("--limit"); return i >= 0 ? Number(process.argv[i + 1]) : 0; })();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dec = (b) => new TextDecoder("utf-8").decode(b);
const strip = (s) => (s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const normTitle = (t) => String(t || "").toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9가-힣]/g, "");

const html = fs.readFileSync(SRC, "utf8");
const mm = html.match(/<script id="master-data" type="application\/json">([\s\S]*?)<\/script>/);
const master = JSON.parse(mm[1]);
const imgData = fs.existsSync(IMG) ? JSON.parse(fs.readFileSync(IMG, "utf8")) : { images: {} };
const imgMap = imgData.images || (imgData.images = {});

// 중복제거 기준
const existISBN = new Set(); const existTitle = new Set(); let maxNum = 0;
for (const m of master.materials) {
  if (m.isbn) existISBN.add(String(m.isbn));
  if (m.title) existTitle.add(normTitle(m.title));
  const mt = String(m.materialUid || "").match(/IH-ENG-(\d+)/); if (mt) maxNum = Math.max(maxNum, Number(mt[1]));
}
for (const [uid, v] of Object.entries(imgMap)) { if (v && v.isbn) existISBN.add(String(v.isbn)); }

function cleanTitle(t) { return String(t || "").split("|")[0].replace(/\s+/g, " ").trim(); }
const MAJOR_RE = /영어학|영문학|언어학|음성학|음운론|통사론|의미론|화용론|영어사|통번역|번역학|영어교육론|영어교과교육|응용언어학|영미문학|영미시|영미희곡|영미소설론|제2언어|이중언어|어휘론|형태론|담화분석|영어발달사|sociolinguistic|linguistic|phonetic|phonolog|syntax|semantic|pragmatic|morpholog|second language acquisition|\bsla\b/i;
function isMajorText(title, cat, kdc) { return MAJOR_RE.test((title + " " + cat + " " + (kdc || "")).toLowerCase()); }
// 원서(수입·영어원서 ELT) 감지: 해외/원서 ELT 출판사 또는 영어 위주 제목 + ELT 키워드
const FOREIGN_PUB = /e-?future|이퓨처|compass|컴퍼스|build\s*&?\s*grow|빌드\s*앤?\s*그로우|seed learning|시드러닝|a\*?list|에이리스트|oxford|옥스(?:포드|퍼드)|cambridge|케임브리지|pearson|피어슨|longman|롱맨|macmillan|맥밀란|cengage|센게이지|national geographic|내셔널지오|scholastic|스콜라스틱|mcgraw|맥그로|richmond|helbling/i;
function isForeignBook(title, pub) {
  const t = String(title || ""), p = String(pub || "");
  if (FOREIGN_PUB.test(p) || FOREIGN_PUB.test(t)) return true;
  const latin = (t.match(/[A-Za-z]/g) || []).length, kor = (t.match(/[가-힣]/g) || []).length;
  const englishHeavy = latin >= 6 && latin > kor * 2;                  // 제목이 영어 위주(한글 거의 없음)
  return englishHeavy && /reading|phonics|grammar|listening|writing|reader|story|level|workbook|student'?s book|coursebook|vocabulary|spelling|comprehension/i.test(t);
}
function classifySkill(title, cat) {
  const s = (title + " " + cat).toLowerCase();
  if (isMajorText(title, cat)) return "전공";
  if (/파닉스|phonics/.test(s)) return "파닉스";
  if (/문법|grammar|그래머/.test(s)) return "문법";
  if (/구문|syntax|구조독해/.test(s)) return "구문";
  if (/듣기|listening|리스닝/.test(s)) return "듣기";
  if (/회화|speaking|말하기|스피킹/.test(s)) return "말하기";
  if (/쓰기|영작|writing|라이팅|서술형/.test(s)) return "쓰기";
  if (/어휘|단어|voca|vocabulary|word|보카/.test(s)) return "어휘";
  if (/수능|모의고사|기출|토익|toeic|토플|toefl|텝스|teps|내신/.test(s)) return "모의/기출";
  if (/독해|리딩|reading|read/.test(s)) return "독해";
  return "독해";
}
function gradeInfo(title, cat) {
  const s = (title + " " + cat).toLowerCase();
  if (isMajorText(title, cat)) return { grade: "대학", ageMin: 20, lv: 5 };
  if (/유아|예비초|preschool|kinder/.test(s)) return { grade: "유아", ageMin: 6, lv: 1 };
  if (/초등|초[1-6]|elementary|초\b/.test(s)) return { grade: "초등", ageMin: 9, lv: 2 };
  if (/중학|중[1-3]|middle|중등/.test(s)) return { grade: "중등", ageMin: 13, lv: 3 };
  if (/고등|고[1-3]|수능|high|모의고사/.test(s)) return { grade: "고등", ageMin: 16, lv: 4 };
  if (/토익|toeic|토플|toefl|텝스|teps|공무원|성인/.test(s)) return { grade: "성인", ageMin: 19, lv: 4 };
  return { grade: "전체", ageMin: null, lv: 3 };
}
async function getDetail(isbn) {
  const t = dec(Buffer.from(await (await fetch("https://www.kobic.net/book/bookInfo/view.do?isbn=" + isbn, { headers: UA })).arrayBuffer()));
  if (t.length < 5000) return null;
  // 정식 제목 + 표지: bookStorageUtil.setItem('idx','isbn','제목','표지경로')
  const sm = t.match(/bookStorageUtil\.setItem\('[^']*',\s*'\d+',\s*'([^']*)',\s*'([^']*)'\)/);
  const canonTitle = sm ? sm[1].replace(/&amp;/g, "&").trim() : "";
  const coverPath = (sm && sm[2]) || (t.match(/\/bookImage\/book\/coverImg\/[^"' ]+?\.(?:jpg|png)/i) || [])[0];
  const pjul = (t.match(/(?:id|name)="pjul_yn"[^>]*value="([^"]*)"/i) || [])[1] || "";
  // 라벨 필드는 태그제거(flat) 후 추출 (raw 정규식은 태그 때문에 실패)
  const flat = strip(t);
  const cat = ((flat.match(/분류\s*:\s*(.+?)\s*(?:KDC|발행일|쪽수|정가)\s*:/) || [])[1] || "").trim();
  const kdc = ((flat.match(/KDC\s*:\s*(.+?)\s*(?:발행일|쪽수|정가|ISBN|분류)\s*[:]/) || flat.match(/KDC\s*:\s*([^,]+?\([0-9]+\))/) || [])[1] || "").trim();
  const pubDate = ((flat.match(/발행일\s*:\s*(\d{4}년\s*\d{1,2}월\s*\d{1,2}일)/) || [])[1] || "").trim();
  const pages = ((flat.match(/쪽수\s*([\d,]+)/) || [])[1] || "").trim();
  const price = ((flat.match(/정가\s*:\s*([\d,]+)\s*원/) || [])[1] || "").trim();
  let toc = ""; const ti = t.indexOf("목차"); if (ti >= 0) toc = strip(t.slice(ti + 2, ti + 1200)).split(/저자소개|책속에서|출판사 서평|추천사/)[0].slice(0, 800);
  const coverUrl = coverPath ? (coverPath.startsWith("http") ? coverPath : "https://www.kobic.net" + coverPath) : "";
  return { title: canonTitle, coverPath: coverUrl, outOfPrint: pjul === "P", cat, kdc, pubDate, pages, price, toc };
}
function isEnglish(d, title) {
  const s = (d.cat + " " + d.kdc + " " + title).toLowerCase();
  // ★비영어 차단: 영어 ELT 신호가 없는데 한글/일본어/중국어/프로그래밍 등이면 제외(보카·외국어 오매칭 방지)
  const engOk = /영어|english|영문|영작|영단어|tesol|toeic|toefl|teps|미국|영국|grammar|reading|phonics|longman|oxford|cambridge|pearson|bricks|구문|독해|어법/i.test(s);
  if (!engOk) {
    const kn = (String(d.kdc || "").match(/\b(\d{3})\b/) || [])[1];
    if (kn && /^(71|72|73|00|05|09)/.test(kn)) return false;                // 710한국어 720중국어 730일본어 000총류
    if (/일본어|중국어|광둥어|불어|독일어|스페인어|러시아어|베트남어|아랍어|태국어|한글|한국어\s*학습|한자|한문|프로그래밍|컴퓨터|코딩|파이썬|자바|엑셀|vba|일본어능력시험|jlpt|jpt|hsk|topik|토픽/i.test(s)) return false;
  }
  const hasEngSig = engOk || /[a-z]{3}/.test(String(title).toLowerCase());   // 영어 학습키워드 또는 라틴문자
  if (/\b740\b|영어|english/.test(s)) return true;                         // 740 영어는 확실
  if (/\b840\b|외국어/.test(s) && hasEngSig) return true;                  // 840 영미문학/외국어는 영어 신호 있을 때만(번역서·오태깅 차단)
  // 제목 영어학습 키워드(분류 추출 실패 대비). 단 비영어 학습서 오인 방지 위해 영역 키워드 한정
  if (/영문법|영단어|영작|영어회화|영어듣기|영어독해|영어쓰기|리딩|reading|grammar|그래머|phonics|파닉스|보카|voca|토익|toeic|토플|toefl|텝스|teps|리스닝|listening|스피킹|speaking|라이팅|writing/.test(s)) return true;
  if (isMajorText(title, d.cat, d.kdc)) return true;                      // 영어 전공(영어학/영문학/언어학/통번역/영어교육)
  return false;
}
async function downloadCover(url, uid) {
  try { const r = await fetch(url, { headers: { ...UA, referer: "https://www.kobic.net/" } }); if (!r.ok) return false;
    const ct = r.headers.get("content-type") || ""; if (!ct.includes("image")) return false;
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length < 1500) return false;
    fs.writeFileSync(path.join(COVERS, uid + ".jpg"), buf); return buf.length;
  } catch { return false; }
}

(async () => {
  const cand = JSON.parse(fs.readFileSync(CAND, "utf8")).items || [];
  console.log(`후보 ${cand.length}종 / 기존 영어 ${master.materials.filter((m) => m.domain === "영어").length}종`);
  let added = 0, dup = 0, notEng = 0, oop = 0, withCover = 0, n = 0;
  for (const c of cand) {
    if (LIMIT && added >= LIMIT) break;
    const isbn = String(c.isbn);
    if (existISBN.has(isbn) || existTitle.has(normTitle(cleanTitle(c.title)))) { dup++; continue; }
    let d; try { d = await getDetail(isbn); } catch (e) { await sleep(SLEEP); continue; }
    if (!d) { await sleep(SLEEP); continue; }
    const title = cleanTitle(d.title) || cleanTitle(c.title);   // 상세페이지 정식 제목 우선
    if (existTitle.has(normTitle(title))) { dup++; continue; }    // 정식제목 재중복검사
    if (!isEnglish(d, title)) { notEng++; await sleep(SLEEP); continue; }
    const skill = classifySkill(title, d.cat);
    const gi = gradeInfo(title, d.cat);
    const uid = "IH-ENG-" + String(++maxNum).padStart(4, "0");
    const mat = {
      materialUid: uid, uid, domain: "영어", publisher: (c.pub || "").trim(), title,
      skill, tftNums: [gi.lv, gi.lv], grade: gi.grade, ageMin: gi.ageMin,
      situations: [], weaknesses: [], features: [], aliases: [],
      status: d.outOfPrint ? "절판" : "정상", isbn, kdc: d.kdc, kobicCategory: d.cat,
      toc: d.toc, pubDate: d.pubDate, pages: d.pages, price: d.price, source: "KOBIC",
      foreign: isForeignBook(title, c.pub),                          // 원서(수입 ELT) 여부
    };
    master.materials.push(mat);
    existISBN.add(isbn); existTitle.add(normTitle(title));
    if (d.outOfPrint) oop++;
    // 표지
    let coverOk = false;
    if (d.coverPath) { const bytes = await downloadCover(d.coverPath, uid); if (bytes) { coverOk = true; withCover++;
      imgMap[uid] = { status: "found", localPath: `covers/${uid}.jpg`, imageUrl: d.coverPath, source: "KOBIC", isbn, materialTitle: title, publisher: mat.publisher, bytes }; } }
    added++;
    if (added % 25 === 0) {
      fs.writeFileSync(SRC, html.replace(mm[0], `<script id="master-data" type="application/json">${JSON.stringify(master)}</script>`), "utf8");
      fs.writeFileSync(IMG, JSON.stringify(imgData, null, 2), "utf8");
      console.log(`  …진행 추가 ${added} (절판 ${oop}, 표지 ${withCover}, 중복 ${dup}, 비영어 ${notEng})`);
    }
    await sleep(SLEEP);
  }
  fs.writeFileSync(SRC, html.replace(mm[0], `<script id="master-data" type="application/json">${JSON.stringify(master)}</script>`), "utf8");
  fs.writeFileSync(IMG, JSON.stringify(imgData, null, 2), "utf8");
  console.log(`\n완료 — 추가 ${added}종 (절판 ${oop}, 표지획득 ${withCover}) / 중복 ${dup} / 비영어제외 ${notEng}`);
  console.log(`영어교재 총: ${master.materials.filter((m) => m.domain === "영어").length}종`);
})();
