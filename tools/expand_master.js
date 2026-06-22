// 누락 18계열을 master-data에 추가해 확장본 HTML(v0.9)을 생성한다.
// 원본 v0.8은 절대 수정하지 않는다.
const fs = require("fs");
const SRC = "C:/Users/이인혁/Documents/카카오톡 받은 파일/iinhyuk_english_book_guide_v0.8_pipeline.html";
const OUT = "C:/Users/이인혁/Desktop/원서모음/Dictionaries_Vocabulary/iinhyuk_english_book_guide_v0.9_expanded.html";

const html = fs.readFileSync(SRC, "utf8");
const re = /<script id="master-data" type="application\/json">([\s\S]*?)<\/script>/;
const data = JSON.parse(html.match(re)[1]);
const mats = data.materials;

// 다음 UID 번호
let maxNum = 0;
for (const m of mats) {
  const n = parseInt(String(m.materialUid || "").replace("IH-ENG-", ""), 10);
  if (n > maxNum) maxNum = n;
}

const NOTE = "2026-06-20 시중교재 누락 보강(전체 18계열)";

// [title, series, publisher, skill, grade, tftMin, tftMax, situations[], weaknesses[]]
const ADD = [
  ["리딩튜터 (Reading Tutor) 시리즈", "Reading Tutor", "NE능률", "독해", "중1-고3", 3, 6, ["내신","수능","원서형"], ["독해기초","근거찾기","빈칸순서삽입"]],
  ["주니어 리딩튜터 (Junior Reading Tutor)", "Junior Reading Tutor", "NE능률", "독해", "초6-중3", 3, 5, ["기초","내신","원서형"], ["독해기초","문단구조","내용일치"]],
  ["능률 VOCA (어원편/실력/수능)", "능률 VOCA", "NE능률", "어휘", "중1-고3", 3, 6, ["내신","수능","선행"], ["단어","암기","어휘문맥"]],
  ["그래머 존 (Grammar Zone)", "Grammar Zone", "NE능률", "문법", "중1-고3", 3, 6, ["내신","수능"], ["문법기초","어법선지","품사/문장성분"]],
  ["This is Grammar (디스 이즈 그래머)", "This is Grammar", "NE능률", "문법", "초4-고1", 2, 5, ["기초","내신"], ["문법기초","품사/문장성분"]],
  ["This is Reading (디스 이즈 리딩)", "This is Reading", "NE능률", "독해", "중1-고2", 3, 6, ["내신","수능형전환","원서형"], ["독해기초","근거찾기"]],
  ["Reading Inside (리딩 인사이드)", "Reading Inside", "NE능률", "독해", "중1-중3", 3, 5, ["내신","원서형"], ["독해기초","문단구조","내용일치"]],
  ["리스닝튜터/굿모닝 리스닝 (Listening Tutor)", "Listening Tutor", "NE능률", "듣기", "중1-고3", 3, 6, ["듣기평가","모의고사","내신"], ["듣기","dictation","시간관리"]],
  ["쎄듀 첫단추 (독해/문법/모의)", "첫단추", "쎄듀", "모의/기출", "예비고-고1", 5, 6, ["수능형전환","모의고사","고난도"], ["기출분석","오답선지","시간관리"]],
  ["쎄듀 어휘끝", "어휘끝", "쎄듀", "어휘", "고1-고3", 5, 6, ["수능","고난도"], ["단어","어휘문맥","암기"]],
  ["쎄듀 리딩 릴레이 (Reading Relay)", "Reading Relay", "쎄듀", "독해", "초5-중3", 3, 5, ["기초","내신","원서형","배경지식"], ["독해기초","배경지식","문단구조"]],
  ["Bricks (브릭스) Reading/Listening/Phonics", "Bricks", "사회평론", "종합", "예비초-중1", 1, 4, ["기초","원서형","배경지식"], ["파닉스/음가","읽기시작","독해기초"]],
  ["Subject Link (서브젝트 링크)", "Subject Link", "NE능률", "인문사회/CLIL", "초4-중1", 2, 4, ["원서형","배경지식"], ["배경지식","독해기초","어휘문맥"]],
  ["Insight Reading (인사이트 리딩)", "Insight", "NE능률", "독해", "중1-고1", 3, 5, ["원서형","배경지식","내신"], ["배경지식","추론/논리","문단구조"]],
  ["굿모닝 독해 (Good Morning Reading)", "Good Morning Reading", "기타(보강)", "독해", "중1-중3", 3, 5, ["기초","내신"], ["독해기초","근거찾기"]],
  ["동아 백점/셀파 중등 영어", "백점·셀파", "동아출판", "종합", "중1-중3", 3, 5, ["내신","서술형","시험대비"], ["내신종합","본문분석","학교별교과서"]],
  ["그래머 게이트웨이 (Grammar Gateway)", "Grammar Gateway", "해커스어학연구소", "문법", "중3-고3", 4, 6, ["기초","수능"], ["문법기초","품사/문장성분"]],
  ["해커스 그래머/보카 (수능·내신)", "해커스 그래머·보카", "해커스어학연구소", "어휘", "고1-고3", 5, 6, ["수능","고난도"], ["단어","어휘문맥","어법선지"]],
  // --- 2차 보강(정밀 점검으로 확인된 추가 누락) ---
  ["우공비 중등 영어", "우공비", "천재교육", "종합", "중1-중3", 3, 5, ["내신","서술형","시험대비"], ["내신종합","본문분석","학교별교과서"]],
  ["한끝 중등 영어", "한끝", "비상교육", "종합", "중1-중3", 3, 5, ["내신","서술형","시험대비"], ["내신종합","본문분석","학교별교과서"]],
  ["오 마이 그래머 (Oh My Grammar)", "Oh My Grammar", "비상교육", "문법", "초6-중2", 2, 4, ["기초","내신"], ["문법기초","품사/문장성분"]],
  ["Reading Expert (리딩 엑스퍼트)", "Reading Expert", "NE능률", "독해", "중3-고2", 4, 6, ["수능형전환","원서형","고난도"], ["추론/논리","빈칸순서삽입","근거찾기"]],
  ["보카바이블 (Voca Bible)", "Voca Bible", "기타(보강)", "어휘", "고1-고3", 5, 6, ["수능","고난도"], ["단어","어휘문맥","암기"]],
  ["쎄듀 빈칸백서", "빈칸백서", "쎄듀", "모의/기출", "고2-고3", 5, 6, ["수능","고난도","모의고사"], ["빈칸순서삽입","추론/논리","오답선지"]],
  ["구문현답 (메가 이명학)", "구문현답", "메가스터디북스", "구문", "고1-고3", 4, 6, ["수능","고난도"], ["구문","본문분석","어법선지"]],
  ["리딩의 기술", "리딩의 기술", "이투스북", "독해", "고1-고3", 5, 6, ["수능","고난도"], ["근거찾기","추론/논리","빈칸순서삽입"]],
  ["100발 100중 중등 영어", "100발 100중", "기타(보강)", "모의/기출", "중1-중3", 3, 5, ["내신","시험대비","모의고사"], ["내신종합","기출분석"]],
  ["쎄듀 특급 (단기독해/듣기)", "특급", "쎄듀", "모의/기출", "고1-고3", 5, 6, ["수능","모의고사","특강"], ["시간관리","오답선지","듣기"]],
  ["EBS 독해의 기초/올림포스 독해", "독해의 기초", "EBS", "독해", "예비고-고1", 4, 5, ["기초","수능형전환"], ["독해기초","근거찾기"]],
  ["Reading Town (리딩 타운)", "Reading Town", "기타(보강)", "독해", "초3-중1", 2, 4, ["원서형","배경지식","기초"], ["독해기초","배경지식","어휘문맥"]],
];

// === 특목고(외고/국제고/자사고/영재고) 해외 부교재 — 별도 트랙으로 정리 ===
// [title, series, publisher, skill, grade, tftMin, tftMax, situations[], weaknesses[]]
const SPECIAL = [
  ["Vocabulary Workshop (Sadlier-Oxford)", "Vocabulary Workshop", "해외원서(특목고)", "어휘", "중3-고3", 4, 6, ["유학","원서형","고난도"], ["단어","어휘문맥","암기"]],
  ["Wordly Wise 3000", "Wordly Wise 3000", "해외원서(특목고)", "어휘", "중1-고2", 3, 6, ["유학","원서형"], ["단어","어휘문맥"]],
  ["4000 Essential English Words", "4000 Essential English Words", "해외원서(특목고)", "어휘", "중1-고3", 3, 6, ["원서형","유학"], ["단어","어휘문맥","암기"]],
  ["Word Smart (Princeton Review)", "Word Smart", "해외원서(특목고)", "어휘", "고1-고3", 5, 6, ["유학","고난도"], ["단어","어휘문맥"]],
  ["Merriam-Webster's Vocabulary Builder", "MW Vocabulary Builder", "해외원서(특목고)", "어휘", "고1-고3", 5, 6, ["유학","원서형"], ["단어","어휘문맥"]],
  ["Direct Hits Core Vocabulary (SAT)", "Direct Hits", "해외원서(특목고)", "어휘", "고2-고3", 5, 6, ["유학","고난도"], ["단어","어휘문맥"]],
  ["Grammar in Use (Cambridge, Murphy)", "Grammar in Use", "해외원서(특목고)", "문법", "중3-고3", 4, 6, ["유학","원서형"], ["문법기초","품사/문장성분"]],
  ["Understanding and Using English Grammar (Azar)", "Azar Grammar", "해외원서(특목고)", "문법", "고1-고3", 5, 6, ["유학","원서형"], ["품사/문장성분","어법선지"]],
  ["Reading Explorer (NatGeo/Cengage)", "Reading Explorer", "해외원서(특목고)", "독해", "중3-고3", 4, 6, ["원서형","배경지식","유학"], ["배경지식","추론/논리","문단구조"]],
  ["Q: Skills for Success (Oxford)", "Q Skills for Success", "해외원서(특목고)", "종합", "중3-고3", 4, 6, ["원서형","유학"], ["독해기초","영작","듣기"]],
  ["Unlock (Cambridge)", "Unlock", "해외원서(특목고)", "종합", "중3-고3", 4, 6, ["원서형","유학"], ["독해기초","영작","추론/논리"]],
  ["NorthStar (Pearson)", "NorthStar", "해외원서(특목고)", "종합", "고1-고3", 5, 6, ["원서형","유학"], ["독해기초","영작","듣기"]],
  ["Oxford Bookworms Library (원서 리딩)", "Oxford Bookworms", "해외원서(특목고)", "문학/스토리", "중1-고3", 3, 6, ["원서형","배경지식"], ["독해기초","배경지식"]],
  ["Penguin Readers (원서 리딩)", "Penguin Readers", "해외원서(특목고)", "문학/스토리", "중1-고3", 3, 6, ["원서형","배경지식"], ["독해기초","배경지식"]],
  ["The Elements of Style (Strunk & White)", "The Elements of Style", "해외원서(특목고)", "쓰기", "고1-고3", 5, 6, ["유학","원서형"], ["영작","서술형"]],
  ["They Say / I Say (학술 글쓰기)", "They Say I Say", "해외원서(특목고)", "쓰기", "고1-고3", 5, 6, ["유학","토론","원서형"], ["영작","추론/논리"]],
  ["Longman Academic Writing Series", "Longman Academic Writing", "해외원서(특목고)", "쓰기", "고1-고3", 5, 6, ["유학","원서형"], ["영작","서술형"]],
  ["The Official SAT Study Guide (College Board)", "Official SAT Study Guide", "해외원서(특목고)", "모의/기출", "고2-고3", 5, 6, ["유학","고난도","모의고사"], ["기출분석","시간관리","추론/논리"]],
  ["Barron's AP English Language", "Barron's AP English", "해외원서(특목고)", "모의/기출", "고2-고3", 6, 6, ["유학","고난도"], ["기출분석","추론/논리"]],
  ["Cambridge IELTS / ETS TOEFL", "IELTS·TOEFL Official", "해외원서(특목고)", "모의/기출", "고1-고3", 5, 6, ["유학","고난도","모의고사"], ["듣기","영작","시간관리"]],
];

// === 고난도·시험(TEPS/TOEIC/TOEFL/SAT/GRE) 어휘 — 별도 트랙으로 정리 ===
// [title, series, publisher, skill, grade, tftMin, tftMax, situations[], weaknesses[]]
const VOCAB_HARD = [
  ["MD 33000 필수어휘 (국내 고난도)", "MD 33000", "기타(보강)", "어휘", "고1-성인", 6, 6, ["고난도","유학","수능"], ["단어","암기","어휘문맥"]],
  ["거로보카 (수능·편입 고난도)", "거로보카", "기타(보강)", "어휘", "고2-성인", 6, 6, ["고난도","수능"], ["단어","암기"]],
  ["1100 Words You Need to Know", "1100 Words", "해외원서(특목고)", "어휘", "고1-성인", 5, 6, ["유학","고난도"], ["단어","어휘문맥"]],
  ["Word Power Made Easy", "Word Power Made Easy", "해외원서(특목고)", "어휘", "고1-성인", 5, 6, ["유학","고난도"], ["단어","어휘문맥","암기"]],
  ["Vocabulary for the College-Bound Student", "College-Bound Vocabulary", "해외원서(특목고)", "어휘", "고1-고3", 5, 6, ["유학","고난도"], ["단어","어휘문맥"]],
  ["TEPS VOCA (서울대·넥서스)", "TEPS VOCA", "넥서스", "어휘", "고1-성인", 6, 6, ["고난도","유학"], ["단어","어휘문맥","시간관리"]],
  ["해커스 토익(TOEIC) 보카", "해커스 토익 보카", "해커스어학연구소", "어휘", "고1-성인", 5, 6, ["고난도","유학"], ["단어","어휘문맥"]],
  ["ETS 토익(TOEIC) 기출 보카", "ETS TOEIC VOCA", "ETS", "어휘", "고1-성인", 5, 6, ["고난도","유학"], ["단어","어휘문맥"]],
  ["해커스 토플(TOEFL) 보카", "해커스 토플 보카", "해커스어학연구소", "어휘", "고1-성인", 6, 6, ["고난도","유학"], ["단어","어휘문맥"]],
  ["Barron's TOEFL Vocabulary", "Barron's TOEFL Voca", "해외원서(특목고)", "어휘", "고1-성인", 6, 6, ["유학","고난도"], ["단어","어휘문맥"]],
  ["GRE 어휘 (Barron's/Manhattan)", "GRE Vocabulary", "해외원서(특목고)", "어휘", "성인", 6, 6, ["유학","고난도"], ["단어","어휘문맥"]],
  ["Barron's SAT 1100 Words", "Barron's SAT 1100", "해외원서(특목고)", "어휘", "고2-고3", 6, 6, ["유학","고난도"], ["단어","어휘문맥"]],
];

const newMats = ADD.map((row, i) => {
  const [title, series, publisher, skill, grade, tmin, tmax, situations, weaknesses] = row;
  const num = maxNum + 1 + i;
  const materialUid = "IH-ENG-" + String(num).padStart(4, "0");
  const uid = "MAT_ADD_" + series.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  return {
    uid,
    publisher,
    title,
    skill,
    tft: `S${tmin}-S${tmax}`,
    tftNums: [tmin, tmax],
    grade,
    situations,
    weaknesses,
    note: NOTE,
    sourceFiles: [],
    sourceSections: [],
    status: "분류완료",
    origin: "manual_add",
    aliases: [title, series],
    mergedUids: [uid],
    materialUid,
    gradeTags: [],
    features: [...weaknesses, "영어"],
    series,
    domain: "영어",
  };
});

// 특목고 해외 부교재 — 별도 트랙(category/track)으로 build, UID는 newMats 다음 번호
const specialMats = SPECIAL.map((row, i) => {
  const [title, series, publisher, skill, grade, tmin, tmax, situations, weaknesses] = row;
  const num = maxNum + 1 + newMats.length + i;
  const materialUid = "IH-ENG-" + String(num).padStart(4, "0");
  const uid = "MAT_SPECIAL_" + series.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  return {
    uid, publisher, title, skill, tft: `S${tmin}-S${tmax}`, tftNums: [tmin, tmax], grade,
    situations, weaknesses, note: "특목고(외고/국제고/자사고/영재고) 해외 부교재 — 별도 정리",
    sourceFiles: [], sourceSections: [], status: "분류완료", origin: "special_foreign",
    aliases: [title, series], mergedUids: [uid], materialUid, gradeTags: [],
    features: [...weaknesses, "영어", "해외원서"], series, domain: "영어",
    track: "특목고_해외부교재", category: "특목고 해외 부교재",
  };
});

// 고난도·시험 어휘 — 별도 트랙, UID는 specialMats 다음
const vhMats = VOCAB_HARD.map((row, i) => {
  const [title, series, publisher, skill, grade, tmin, tmax, situations, weaknesses] = row;
  const num = maxNum + 1 + newMats.length + specialMats.length + i;
  const materialUid = "IH-ENG-" + String(num).padStart(4, "0");
  const uid = "MAT_VOCABHARD_" + series.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  return {
    uid, publisher, title, skill, tft: `S${tmin}-S${tmax}`, tftNums: [tmin, tmax], grade,
    situations, weaknesses, note: "고난도·시험(TEPS/TOEIC/TOEFL/SAT/GRE) 어휘 — 별도 정리",
    sourceFiles: [], sourceSections: [], status: "분류완료", origin: "vocab_hard",
    aliases: [title, series], mergedUids: [uid], materialUid, gradeTags: [],
    features: [...weaknesses, "영어", "고난도어휘"], series, domain: "영어",
    track: "어휘_고난도시험", category: "고난도·시험 어휘",
  };
});

data.materials = mats.concat(newMats, specialMats, vhMats);

// ===== 전 교재 enrich: 나이/학년 + 선택 코멘트 + 파트 역할 =====
const GRADE_AGE = {
  "유아":[5,7],"5세":[5,5],"6세":[6,6],"예비초":[7,7],
  "초1":[7,7],"초2":[8,8],"초3":[9,9],"초4":[10,10],"초5":[11,11],"초6":[12,12],
  "초저":[7,9],"초중":[9,11],"초고학년":[11,12],"초등":[7,12],"초":[7,12],
  "예비중":[12,12],"중1":[13,13],"중2":[14,14],"중3":[15,15],"중등":[13,15],"중":[13,15],
  "예비고":[15,15],"고1":[16,16],"고2":[17,17],"고3":[18,18],"고등":[16,18],"고":[16,18],
  "청소년":[13,18],"성인":[19,64],
};
function gradeToAge(grade) {
  const g = String(grade || "");
  let lo = Infinity, hi = -Infinity;
  // 긴 토큰 우선 매칭
  const keys = Object.keys(GRADE_AGE).sort((a, b) => b.length - a.length);
  let work = g;
  for (const k of keys) {
    if (work.includes(k)) { const [a, b] = GRADE_AGE[k]; lo = Math.min(lo, a); hi = Math.max(hi, b); work = work.split(k).join(" "); }
  }
  if (!isFinite(lo)) return null;
  return { min: lo, max: hi };
}
function levelWord(t) {
  const lo = (t && t[0]) || 1, hi = (t && t[1]) || lo;
  if (hi <= 2) return "기초·파닉스";
  if (hi <= 3) return "입문";
  if (lo >= 5) return "수능·심화";
  if (hi >= 5) return "실력~수능";
  return "기본";
}
const SIT_PURPOSE = { "수능":"수능 대비","내신":"학교 내신","모의고사":"모의고사 실전","기초":"기초 다지기","원서형":"원서·영어권 학습","서술형":"서술형 대비","유학":"유학·심화","듣기평가":"듣기평가 대비","배경지식":"배경지식 확장","토론":"토론·논술","선행":"선행 학습","고난도":"고난도 도전","특강":"방학 특강" };
function pickComment(m) {
  const age = gradeToAge(m.grade);
  const ageStr = age ? `만 ${age.min}~${age.max}세` : "";
  const gradeStr = m.grade || "전학년";
  const lvl = levelWord(m.tftNums);
  const purposes = (m.situations || []).map(s => SIT_PURPOSE[s]).filter(Boolean).slice(0, 2);
  const purpose = purposes.length ? purposes.join("·") : "단계별 학습";
  const focus = (m.weaknesses || []).slice(0, 2).join("·");
  const head = [ageStr, gradeStr].filter(Boolean).join(" / ");
  let s = `${head} · ${m.skill} ${lvl} 교재. ${purpose} 목적에 적합`;
  if (focus) s += `, ${focus} 보강`;
  s += ".";
  return s;
}
// 4대영역(어휘·문법·독해·듣기) + 쓰기 기준 파트 역할/배치 추천
const SKILL_PART = {
  "파닉스":["기초","과정 초반(읽기 시동)"],
  "어휘":["어휘","전 과정 병행(매일 누적)"],
  "문법":["문법","과정 초중반(구문 전 토대)"],
  "구문":["문법","과정 중반(독해 연결)"],
  "독해":["독해","과정 중후반(핵심 본문)"],
  "듣기":["듣기","과정 중반 주1~2회 병행"],
  "쓰기":["쓰기","독해 후 서술형 단계"],
  "글쓰기/문해력":["쓰기","독해 후 서술형 단계"],
  "모의/기출":["실전","과정 마무리(실전 점검)"],
  "종합":["종합","내신 시즌 집중"],
};
function partRole(m) {
  const p = SKILL_PART[m.skill];
  if (p) return { part: p[0], placement: p[1] };
  // CLIL/사회/과학 등은 독해 확장으로 분류
  return { part: "독해(확장)", placement: "배경지식 확장 단계" };
}
for (const m of data.materials) {
  const age = gradeToAge(m.grade);
  m.ageMin = age ? age.min : null;
  m.ageMax = age ? age.max : null;
  m.ageLabel = age ? `만 ${age.min}~${age.max}세` : "";
  m.pickComment = pickComment(m);
  const pr = partRole(m);
  m.part = pr.part;          // 4대영역 분류(어휘/문법/독해/듣기/쓰기/실전/종합)
  m.partPlacement = pr.placement; // 과정상 추천 위치
}

// taxonomies.publishers 보강
const newPubs = ["NE능률", "쎄듀", "사회평론", "해커스어학연구소", "기타(보강)", "비상교육", "EBS", "해외원서(특목고)", "넥서스", "ETS"];
if (data.taxonomies && Array.isArray(data.taxonomies.publishers)) {
  for (const p of newPubs) if (!data.taxonomies.publishers.includes(p)) data.taxonomies.publishers.push(p);
  data.taxonomies.publishers.sort();
}
// 4대영역 파트 taxonomy 추가
data.taxonomies = data.taxonomies || {};
data.taxonomies.parts = ["어휘", "문법", "독해", "듣기", "쓰기", "실전", "종합", "기초"];

// meta count 갱신
if (data.meta && typeof data.meta === "object") {
  data.meta.totalMaterials = data.materials.length;
  data.meta.expandedAt = "2026-06-20";
  data.meta.expandedNote = NOTE + " + 특목고 해외 부교재 " + specialMats.length + " + 나이/학년/코멘트/파트 enrich";
}

const outHtml = html.replace(re, `<script id="master-data" type="application/json">${JSON.stringify(data)}</script>`);
fs.writeFileSync(OUT, outHtml, "utf8");

// 특목고 해외 부교재 별도 산출 (CSV + MD)
const specCsv = ["materialUid,part,skill,publisher,title,series,grade,ageLabel,pickComment"]
  .concat(specialMats.map(m => [m.materialUid, m.part, m.skill, m.publisher, m.title, m.series, m.grade, m.ageLabel, m.pickComment]
    .map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(",")));
fs.writeFileSync("C:/Users/이인혁/Desktop/원서모음/Dictionaries_Vocabulary/특목고_해외부교재.csv", specCsv.join("\n") + "\n", "utf8");
const specMd = ["# 특목고(외고·국제고·자사고·영재고) 해외 부교재 — 별도 정리", "", `생성: 2026-06-20 · ${specialMats.length}종`, ""]
  .concat(specialMats.map(m => `- **${m.title}** (${m.part}/${m.skill}) — ${m.grade} · ${m.ageLabel}\n  - ${m.pickComment}`));
fs.writeFileSync("C:/Users/이인혁/Desktop/원서모음/Dictionaries_Vocabulary/특목고_해외부교재.md", specMd.join("\n") + "\n", "utf8");

console.log(`국내 보강 ${newMats.length} + 특목고 해외 ${specialMats.length} → 총 ${data.materials.length}개`);
console.log(`국내 UID ${newMats[0].materialUid}~${newMats[newMats.length-1].materialUid}, 특목고 UID ${specialMats[0].materialUid}~${specialMats[specialMats.length-1].materialUid}`);
console.log(`저장: ${OUT}`);
console.log(`별도: 특목고_해외부교재.csv / .md`);
