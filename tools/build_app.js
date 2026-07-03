/* 교재 시스템 빌드 하네스
   ../data 의 master-data(v0.9) + book_images.json 을 앱 스키마로 매핑하여
   app_base.html 의 토큰(__MASTER_DATA__/__TABS__)을 치환 → ../index.html 생성 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data");
const SRC_HTML = path.join(DATA, "iinhyuk_english_book_guide_v0.9_expanded.html");
const IMG_JSON = path.join(DATA, "book_images.json");
const BASE = path.join(__dirname, "app_base.html");
const OUT = path.join(ROOT, "index.html");

const html = fs.readFileSync(SRC_HTML, "utf8");
const master = JSON.parse(html.match(/<script id="master-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const images = (JSON.parse(fs.readFileSync(IMG_JSON, "utf8")).images) || {};

// 무료 API enrich 캐시(있으면 머지) — 알라딘(인기·가격·표지·절판) > 카카오(가격·표지 폴백) > 원서(OpenLibrary/GoogleBooks 표지·메타)
function loadEnrich(name) { try { return JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8")) || {}; } catch (e) { return {}; } }
const ENRICH_ALADIN = loadEnrich("aladin_enrich.json");
const ENRICH_KAKAO = loadEnrich("kakao_enrich.json");
const ENRICH_FOREIGN = loadEnrich("foreign_enrich.json");
function enrichOf(isbn) { if (!isbn) return {}; return Object.assign({}, ENRICH_FOREIGN[isbn] || {}, ENRICH_KAKAO[isbn] || {}, ENRICH_ALADIN[isbn] || {}); }  // 알라딘 우선

// 스킬 정규화: 4대영역(+문법/구문/어휘/파닉스/모의기출)으로 수렴
const SKILL_MAP = {
  "인문사회/CLIL": "독해", "과학/CLIL": "독해", "역사/사회": "독해", "지리/문화": "독해",
  "경제/사회": "독해", "문학/스토리": "독해", "미디어/AI": "독해", "논술/토론": "독해",
  "종합": "독해", "글쓰기/문해력": "쓰기",
};
function normSkill(s) { return SKILL_MAP[s] || s || "독해"; }

function toLevel(t) {
  if (!t || !t.length) return 3;
  const mn = Math.min.apply(null, t), mx = Math.max.apply(null, t);
  return Math.max(1, Math.min(5, Math.round((mn + mx) / 2)));
}
function isMajor(m) { return normSkill(m.skill) === "전공" || m.grade === "대학" || (m.ageMin != null && m.ageMin >= 20); }
function gradeBand(m) {
  if (isMajor(m)) return "대학/전공";
  const a = m.ageMin;
  if (a == null) return "전체";
  if (a <= 7) return "유아/예비초";
  if (a <= 12) return "초등";
  if (a <= 15) return "중등";
  if (a <= 18) return "고등";
  return "성인";
}
// 책별 세분 나이대 (gradeBand + level 추정)
function ageBandOf(m) {
  const a = m.ageMin, lv = toLevel(m.tftNums);
  if (isMajor(m)) return "대학(20+)";
  if (a != null) {
    if (a <= 7) return "유아(5-7)";
    if (a <= 10) return "초등저(8-10)";
    if (a <= 13) return "초등고(11-13)";
    if (a <= 16) return "중등(13-16)";
    if (a <= 19) return "고등(16-19)";
    return "성인(19+)";
  }
  const gb = gradeBand(m);
  if (gb === "유아/예비초") return "유아(5-7)";
  if (gb === "초등") return lv <= 2 ? "초등저(8-10)" : "초등고(11-13)";
  if (gb === "중등") return "중등(13-16)";
  if (gb === "고등") return "고등(16-19)";
  if (gb === "성인") return "성인(19+)";
  return "전체";
}
function shortComment(pc) {
  if (!pc) return "";
  const i = pc.indexOf("교재. ");
  let s = i >= 0 ? pc.slice(i + 4) : pc;
  return s.length > 60 ? s.slice(0, 58) + "…" : s;
}
// CEFR 추출(코멘트에서)
function extractCefr(t) {
  const m = String(t || "").match(/\b(pre-?\s?a1|a1\+|a1|a2\+|a2|b1\+|b1|b2\+|b2|c1|c2)\b/i);
  if (!m) return "";
  return m[1].toUpperCase().replace(/\s/g, "").replace("PRE-A1", "PRE-A1").replace("PREA1", "PRE-A1");
}
// Lexile 추출
function extractLexile(t) {
  const m = String(t || "").match(/(\d{2,4})\s*L\b/i) || String(t || "").match(/lexile[^\d]*(\d{2,4})/i);
  return m ? Number(m[1]) : null;
}

const sitCount = {};
const weakCount = {};
const skillSet = new Set();
const goalSet = new Set();
const timingSet = new Set();
const examTypeSet = new Set();
// 성인(시험/실용) 재분류 — 토익/토플/텝스/공무원/편입/비즈니스 등
function isAdultTitle(m) { return /토익|toeic|토플|toefl|텝스|teps|오픽|opic|아이엘츠|ielts|공무원|편입|비즈니스|business|gre|gmat|\bsat\b|성인/i.test((m.title || "") + " " + (m.kobicCategory || "")); }
function gradeBandAdj(m) { if (isMajor(m)) return "대학/전공"; return isAdultTitle(m) ? "성인" : gradeBand(m); }
function ageBandAdj(m) { if (isMajor(m)) return "대학(20+)"; return isAdultTitle(m) ? "성인(19+)" : ageBandOf(m); }

// ====== 학부모 언어 "목표(상황) × 시기" 자동 태깅 ======
// 9,474권 전부에 부여 → 추천이 동점/가나다순으로 무너지는 '무지성' 현상 제거.
// 교재 잘 모르는 학부모가 떠올리는 말로 축을 다시 깔고, 빌드 시점에 전부 채운다.
const GOAL_ORDER = ["영어 첫걸음", "학교영어 따라가기", "독해 늘리기", "문법 잡기", "말하기·회화", "듣기", "어휘 늘리기", "쓰기·서술형", "원서 읽기", "내신 대비", "수능·모의고사", "시험영어(토익·토플)"];
const TIMING_ORDER = ["기초 입문", "학기중 꾸준히", "방학 단기집중", "시험 직전"];
function deriveGoals(m, skill, level, band) {
  const t = (m.title || "") + " " + (m.kobicCategory || "") + " " + (m.category || "");
  const has = (re) => re.test(t);
  const g = new Set();
  // ① 스킬 기반(신뢰도 최상)
  if (skill === "파닉스") g.add("영어 첫걸음");
  if (skill === "독해") g.add("독해 늘리기");
  if (skill === "문법" || skill === "구문") g.add("문법 잡기");
  if (skill === "말하기") g.add("말하기·회화");
  if (skill === "듣기") g.add("듣기");
  if (skill === "어휘") g.add("어휘 늘리기");
  if (skill === "쓰기") g.add("쓰기·서술형");
  if (skill === "모의/기출") g.add("수능·모의고사");
  // ② 제목/분류 기반 보강(한 책이 여러 목표를 가질 수 있음)
  if (has(/파닉스|phonics|알파벳|사이트\s*워드|sight\s*word|첫\s*걸음|왕초보|쌩초보|기초\s*영어|입문/i)) g.add("영어 첫걸음");
  if ((band === "초등" || band === "중등") && has(/교과서|학교\s*영어|내신\s*기초|초등\s*영어|예비\s*중|중학\s*기초|기초\s*튼튼/i)) g.add("학교영어 따라가기");
  if (has(/독해|리딩|reading|리더스|reader|장문|구문\s*독해|지문/i)) g.add("독해 늘리기");
  if (has(/문법|어법|grammar|그래머|영문법/i)) g.add("문법 잡기");
  if (has(/회화|스피킹|speaking|conversation|말하기|spoken|패턴\s*영어/i)) g.add("말하기·회화");
  if (has(/듣기|리스닝|listening|받아쓰기|dictation/i)) g.add("듣기");
  if (has(/어휘|단어|보카|voca|vocab|어원|숙어|word\s*master|영단어/i)) g.add("어휘 늘리기");
  if (has(/영작|쓰기|writing|서술형|작문|에세이|essay|영어\s*일기/i)) g.add("쓰기·서술형");
  if (m.foreign || has(/원서|리더스|챕터북|chapter\s*book|오알티|\bort\b|리딩북|graded\s*reader|뉴베리|newbery|classic|명작/i)) g.add("원서 읽기");
  if (has(/내신|중간고사|기말고사|학교\s*시험|서술형\s*대비|학교별/i)) g.add("내신 대비");
  if (has(/수능|모의고사|모평|수능특강|수능완성|\bebs\b|평가원|빈칸\s*추론|고난도\s*독해/i)) g.add("수능·모의고사");
  if (/토익|toeic|토플|toefl|텝스|teps|오픽|opic|아이엘츠|ielts|공무원|편입|비즈니스|business|\bgre\b|\bgmat\b|\bsat\b/i.test(t)) g.add("시험영어(토익·토플)");
  // ③ 오분류 보정 — 교과서 부교재는 '내신', 유아 사운드/동요/세이펜은 '영어 첫걸음'(잘못된 '독해' 분류 교정)
  if (/자습서|평가\s*문제집|자습서\s*&?\s*평가|교과서\s*(평가|자습|채점)|시험\s*족보/.test(t)) { g.clear(); g.add("내신 대비"); }
  else if (/사운드\s*북|sound\s*book|동요|노래로\s*배우|챈트|chant|세이펜|놀이북|율동|플랩북|팝업북/.test(t) && (band === "유아/예비초" || level <= 1)) { g.clear(); g.add("영어 첫걸음"); }
  // ④ 폴백 — 그래도 비면 레벨로 기본값(절대 빈 채로 두지 않음)
  if (!g.size) g.add(level <= 2 ? "영어 첫걸음" : "독해 늘리기");
  return Array.from(g);
}
function deriveTiming(m, skill, level) {
  const t = (m.title || "") + " " + (m.kobicCategory || "") + " " + (m.category || "");
  const has = (re) => re.test(t);
  const ti = new Set();
  if (skill === "모의/기출" || has(/기출|모의고사|모평|실전|파이널|\bfinal\b|적중|봉투|봉모|직전|마무리|총정리|단기\s*특강|벼락/i)) ti.add("시험 직전");
  if (has(/하루\s*\d|\d+\s*일\s*완성|\d+\s*주\s*완성|단기|속성|집중|특강|방학|초단기|단숨|벼락치기/i)) ti.add("방학 단기집중");
  if (skill === "파닉스" || level <= 1 || has(/입문|첫\s*걸음|왕초보|쌩초보|기초|starter|스타터|begin|예비|preschool|유아|병아리/i)) ti.add("기초 입문");
  // 정규 코스북/시리즈 또는 위 셋 중 어디에도 안 걸리면 → 학기중 꾸준히(가장 흔한 실제 모드)
  if (!ti.size || has(/코스북|시리즈|series|course|레벨|level\s*\d|book\s*\d|단계|grade\s*\d|주교재|정규/i)) ti.add("학기중 꾸준히");
  return Array.from(ti);
}
// 원서(수입 영어책) 제목 시그널 — KOBIC foreign 플래그가 누락한 유명 원서 시리즈를 제목으로 재산정
const FOREIGN_TITLE_RE = /bookworms|penguin\s*readers|oxford\s*reading\s*tree|뉴베리|newbery|usborne|scholastic|step\s*into\s*reading|i\s*can\s*read|ready[-\s]*to[-\s]*read|magic\s*tree\s*house|graded\s*reader|chapter\s*book|caldecott|dr\.?\s*seuss|cambridge\s*english\s*readers|macmillan\s*readers|compass\s*classic|little\s*fox|raz[-\s]*kids|reading\s*a-?z/i;
// 오디언스 분류(학생용 추천에서 제외, 각자 트랙으로 분리)
// ① 교사용·교육학 이론서  ② 임용·공무원 등 전문시험 준비서  ③ 학부모 공부용(부모가 읽는 책)
const TEACHER_RE = /교수법|교육학|교육론|교재론|교사를\s*위한|교사용|\(교사\)|지도서|학습지도안|수업의\s*모든\s*것|심층분석|평가의\s*이해|원리와\s*실제|교실기반|과제기반|페다고지|교직과정|교생실습|teacher.?s?\s*(guide|book|edition|manual)/i;
// 임용(교원) + 공무원·군무원·경찰·소방 등 전문직 시험 영어 — 일반 학습자/학부모 추천에서 제외
const EXAM_PREP_RE = /임용고시|임용\s*시험|임용\s*기출|교원\s*임용|[중초]등\s*임용|영어\s*임용|임용\s*영어|\b임용\b|임고|영어교육론|영어과\s*교육과정|교과교육론|전공영어|일반영어\s*영미문학|공무원|군무원|\b[79]급\b|경찰\s*공무원|소방\s*공무원|순경|경찰직|소방직|국가직|지방직|교정직|세무직|공시\s*영어|공단기|공도리/i;
// 시험 유형·급수 세분(임용·공무원 트랙 내 필터용)
const EXAM_TYPE_ORDER = ["임용(교원)", "공무원 9급", "공무원 7급", "공무원 5급", "경찰", "소방", "군무원", "공무원(기타)", "전공·영문학"];
function deriveExamType(t) {
  if (/임용|교원\s*임용|영어교육론|교과교육론|영어과\s*교육과정/.test(t)) return "임용(교원)";
  if (/경찰/.test(t)) return "경찰";
  if (/소방/.test(t)) return "소방";
  if (/군무원/.test(t)) return "군무원";
  if (/9급/.test(t)) return "공무원 9급";
  if (/7급/.test(t)) return "공무원 7급";
  if (/5급|행정고시|입법고시|외무고시|외교관/.test(t)) return "공무원 5급";
  if (/공무원|국가직|지방직|세무직|교정직|공시|공단기|공도리|순경/.test(t)) return "공무원(기타)";
  return "전공·영문학";   // 전공영어·영미문학 등
}
const PARENT_RE = /공부법|학습법|교육법|영어\s*육아|입시\s*설명회?|학습\s*코칭|영어\s*코칭|영어\s*멘토링|학습\s*노하우|암기\s*노하우|가르치는\s*법|미래형\s*엄마표|엄마표\s*영어|엄마가\s*(가르치는|알려주는|먼저|알아야)|아빠표\s*영어로|강남\s*엄마|따라잡는\s*초등영어|부모를?\s*위한|학부모|자녀\s*영어\s*교육/i;
// 내재 품질점수 q(0~100 근방) — 최신성 + 상품성. popMap이 비어도 추천이 가나다순으로 무너지지 않게 하는 결정적 타이브레이커
function qualityScore(m, hasCover) {
  let q = 50;
  const t = (m.title || "") + " " + (m.kobicCategory || "");
  const y = +(String(m.pubDate || "").match(/(19|20)\d\d/) || [])[0] || 0;
  if (y >= 2024) q += 24; else if (y >= 2021) q += 18; else if (y >= 2018) q += 11; else if (y >= 2014) q += 4;
  else if (y && y < 2008) q -= 26; else if (y && y < 2012) q -= 14;       // 2007 PELT 등 구버전 침몰
  if (hasCover) q += 6;                                                    // 실제 유통 상품성
  if (/\bPELT\b|초등.*\bJET\b|중등.*\bJET\b|구\s*수능|구버전/i.test(t)) q -= 22;  // 폐지·구 시험
  if (/level\s*\d|book\s*\d|step\s*\d|\b\d\s*급|stage\s*\d/i.test(t)) q += 5;     // 정규 코스북 신뢰
  q = Math.max(0, Math.min(99, q));
  // 연속화 — 같은 버킷 동점을 발행일(정밀)→id로 결정적 분해. popMap/평점이 비는 오프라인에서도
  // 추천 정렬이 '가나다 배열순'으로 무너지지 않게 하는 타이브레이커(전 추천경로가 q를 쓰므로 한 곳만 고침).
  const ymd = String(m.pubDate || "").match(/(19|20\d\d)\D?(\d{1,2})?\D?(\d{1,2})?/);
  let frac = 0;
  if (ymd) { const y = +ymd[1], mo = +(ymd[2] || 6), d = +(ymd[3] || 15); frac = Math.max(0, Math.min(0.9, ((y - 1995) + (mo - 1) / 12 + d / 372) / 35)); }
  const uid = String(m.materialUid || "");
  let h = 2166136261;                                            // FNV-1a — 연속 id도 잘 흩어지게(avalanche)
  for (let i = 0; i < uid.length; i++) { h ^= uid.charCodeAt(i); h = Math.imul(h, 16777619); }
  const jit = ((h >>> 0) / 4294967296) * 0.0999;                 // id별 고유 미세값(0~0.0999) — 절대 동점 방지
  return Math.round((q + frac + jit) * 1e6) / 1e6;
}
// 영어 교재만 — 비영어(북트리거 인문/과학/문학 등) domain 제외
const englishOnly = master.materials.filter((m) => m.domain === "영어");
const MASTER_DATA = englishOnly.map((m) => {
  const uid = m.materialUid;
  const info = images[uid] || {};
  const hasCover = !!info.localPath;
  let skill = normSkill(m.skill);
  const level = toLevel(m.tftNums);
  let band = gradeBandAdj(m);
  // 시리즈 라벨 교정 — 원천(KOBIC) 분류 오류가 학년·영역 가드를 무력화하는 것 방지
  // 실사례: '리딩튜터 주니어'(중등 독해서)가 고등·문법으로 등록돼 고1 문법 추천 1순위 노출
  if (/리딩\s*튜터|reading\s*tutor/i.test(m.title || "")) {
    skill = "독해";
    band = /주니어|junior/i.test(m.title || "") ? "중등" : "고등";
  }
  skillSet.add(skill);
  (m.situations || []).forEach((s) => { sitCount[s] = (sitCount[s] || 0) + 1; });
  (m.weaknesses || []).forEach((s) => { weakCount[s] = (weakCount[s] || 0) + 1; });
  const goals = deriveGoals(m, skill, level, band);
  const timing = deriveTiming(m, skill, level);
  goals.forEach((x) => goalSet.add(x));
  timing.forEach((x) => timingSet.add(x));
  const _atxt = (m.title || "") + " " + (m.kobicCategory || "");
  const examPrep = EXAM_PREP_RE.test(_atxt);
  const examType = examPrep ? deriveExamType(_atxt) : "";
  if (examType) examTypeSet.add(examType);
  const parentBook = !examPrep && PARENT_RE.test(_atxt);
  const teacherRef = !examPrep && !parentBook && TEACHER_RE.test(_atxt);
  const q = qualityScore(m, hasCover);
  const en = enrichOf(m.isbn);   // 무료 API 보강(가격·인기·표지·상태)
  const enStatus = (/[\[\(]\s*절판\s*[\]\)]/.test(m.title || "")) ? "절판" : (en.status && en.status !== "정상" ? en.status : (m.status || "정상"));
  return {
    id: uid,
    pub: m.publisher || "",
    title: m.title || "",
    skill,
    level,
    goals,                                          // 학부모 언어 목표(상황) 태그 — 전 카탈로그
    timing,                                         // 학습 시기 태그 — 전 카탈로그
    q,                                              // 내재 품질점수(최신성+상품성) — 추천 타이브레이커
    teacherRef,                                     // 교사용/이론서 → 학생 추천 제외
    examPrep,                                       // 임용·공무원 등 전문시험 → 🎓임용·공무원 트랙
    examType,                                       // 시험 유형·급수(임용/9급/7급/5급/경찰/소방/군무원…)
    parentBook,                                     // 학부모 공부용(엄마표/공부법) → 👩‍🏫학부모용 트랙
    tags: (m.situations || []).slice(0, 3).map((s) => "#" + s),
    situations: m.situations || [],
    weaknesses: m.weaknesses || [],
    cover: m.coverInline || (hasCover ? `covers/${uid}.jpg` : (en.cover || "")),
    price: en.price || null,                        // 판매가(알라딘/카카오/네이버) — 예상비용
    salesPoint: en.salesPoint || 0,                 // 알라딘 판매지수(인기)
    pop: en.salesPoint || en.loanCount || 0,        // 오프라인 인기정렬 베이크값(서버 popMap 없을 때)
    age: m.ageLabel || "",
    comment: shortComment(m.pickComment),
    fullComment: m.pickComment || "",
    part: m.part || "",
    track: m.category || m.kobicCategory || "",   // 특목고 해외 부교재 / 고난도·시험 어휘 / KOBIC 분류
    gradeBand: band,
    cefr: extractCefr(m.pickComment || ""),
    lexile: extractLexile(m.pickComment || ""),
    ageBand: ageBandAdj(m),                          // 세분 나이대
    status: enStatus,                               // [절판]표기·알라딘/카카오 유통상태 반영
    foreign: !!m.foreign || FOREIGN_TITLE_RE.test(m.title || ""),   // 원서 — KOBIC 누락분 제목으로 재산정
    isbn: m.isbn || "",
    kdc: m.kdc || "",
    pubDate: m.pubDate || "",
    source: m.source || "",
  };
}).filter((b) => b.status !== "절판");   // 절판은 살 수 없는 책 — 카탈로그에서 전량 제외(remove_junk가 못 잡는 키 미스매치까지)

// 스킬 탭: 핵심 순서 우선 + 나머지
const SKILL_ORDER = ["듣기", "말하기", "독해", "쓰기", "문법", "구문", "어휘", "파닉스", "모의/기출", "통합", "전공"];
const skills = Array.from(skillSet);
const orderedSkills = SKILL_ORDER.filter((s) => skillSet.has(s)).concat(skills.filter((s) => !SKILL_ORDER.includes(s)).sort());
const topSit = Object.entries(sitCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([s]) => "#" + s);
const topWeak = Object.entries(weakCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([s]) => "#" + s);

const TABS = {
  skill: ["전체"].concat(orderedSkills),
  level: ["전체", "1단계(입문)", "2단계(기초)", "3단계(기본)", "4단계(실력)", "5단계(실전)"],
  situation: ["전체"].concat(topSit),
  weakness: ["전체"].concat(topWeak),
  grade: ["전체", "유아/예비초", "초등", "중등", "고등", "성인", "대학/전공"],
  age: ["전체", "유아(5-7)", "초등저(8-10)", "초등고(11-13)", "중등(13-16)", "고등(16-19)", "성인(19+)", "대학(20+)"],
  goal: ["전체"].concat(GOAL_ORDER.filter((x) => goalSet.has(x))),
  timing: ["전체"].concat(TIMING_ORDER.filter((x) => timingSet.has(x))),
  examType: ["전체"].concat(EXAM_TYPE_ORDER.filter((x) => examTypeSet.has(x))),
};

// 정렬: 한글 가나다 → 영어 ABC → 기타
MASTER_DATA.sort((a, b) => {
  const g = (t) => /^[가-힣]/.test(t) ? 0 : /^[A-Za-z]/.test(t) ? 1 : 2;
  const ga = g(a.title || ""), gb = g(b.title || "");
  if (ga !== gb) return ga - gb;
  return String(a.title || "").localeCompare(String(b.title || ""), ga === 0 ? "ko" : "en");
});

// 데이터는 외부 books.js로 분리 → index.html 경량화·모바일 캐시
const out = fs.readFileSync(BASE, "utf8");
fs.writeFileSync(path.join(ROOT, "books.js"), `window.__BOOKS__=${JSON.stringify(MASTER_DATA)};\nwindow.__TABS__=${JSON.stringify(TABS)};\n`, "utf8");
// 목차(toc)는 용량 절반 이상 → 별도 toc.js(지연 로딩)로 분리해 첫 로딩 가속
const tocMap = {};
englishOnly.forEach((m) => { if (m.toc) tocMap[m.materialUid] = m.toc; });
fs.writeFileSync(path.join(ROOT, "toc.js"), `window.__TOC__=${JSON.stringify(tocMap)};\n`, "utf8");
fs.writeFileSync(OUT, out, "utf8");

// 참고용 데이터 산출
fs.writeFileSync(path.join(DATA, "materials_app.json"), JSON.stringify(MASTER_DATA, null, 1), "utf8");

const withCover = MASTER_DATA.filter((b) => b.cover).length;
const withGoal = MASTER_DATA.filter((b) => b.goals && b.goals.length).length;
const withTiming = MASTER_DATA.filter((b) => b.timing && b.timing.length).length;
console.log(`생성: ${OUT}`);
console.log(`교재 ${MASTER_DATA.length}종 / 실표지 ${withCover}종 / 스킬 ${orderedSkills.length}종`);
console.log(`스킬: ${orderedSkills.join(", ")}`);
console.log(`목표 태그: ${withGoal}종(${(100 * withGoal / MASTER_DATA.length).toFixed(1)}%) / 시기 태그: ${withTiming}종(${(100 * withTiming / MASTER_DATA.length).toFixed(1)}%)`);
console.log(`목표축: ${TABS.goal.slice(1).join(", ")}`);
console.log(`시기축: ${TABS.timing.slice(1).join(", ")}`);
const nExam = MASTER_DATA.filter((b) => b.examPrep).length, nParent = MASTER_DATA.filter((b) => b.parentBook).length, nTeacher = MASTER_DATA.filter((b) => b.teacherRef).length;
console.log(`오디언스: 🧒학생용 ${MASTER_DATA.length - nExam - nParent - nTeacher} / 👩‍🏫학부모용 ${nParent} / 🎓임용준비 ${nExam} / 교사이론서(제외) ${nTeacher}`);
