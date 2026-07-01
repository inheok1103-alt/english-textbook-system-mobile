/*
  이인혁 영어 교재 시스템 — 통합 백엔드 (커리큘럼 집계 + 실시간 랭킹)
  배포: Google Sheets → 확장 > Apps Script → 이 파일 전체 붙여넣기 →
        배포 > 새 배포 > 웹앱(실행: 나 / 액세스: 모든 사용자) → /exec URL 사용.
  최초 1회: setupAll() 실행(시트 생성 + 시간 트리거 등록). 정보나루 키는 DATA4LIB_KEY에 입력.

  엔드포인트(전부 JSONP: &callback=fn):
    POST                              커리 제출 1건 append
    GET ?summary=1&bucket=&period=    앱 자체 집계(인기교재·학년/목표별·동시선택)
    GET ?material=UID                 해당 교재 동시선택 Top
    GET ?rankings=1&source=&gradeBand=&englishArea=&period=
        → 외부/앱 통합 랭킹 (source: yes24|data4library|app|all)
    GET ?newbooks=1                   KOBIC 신간(별도 GitHub Actions가 채우는 캐시 시트)
*/

// ===== 설정 =====
var TZ = 'Asia/Seoul';
var SHEET_NAME = 'curriculum_v1';     // 커리 제출
var RANK_SHEET = 'rankings_v1';       // 정규화 랭킹 캐시
var INDEX_SHEET = 'master_index';     // isbn/titleNorm → uid (GitHub에서 자동 동기화)
var INDEX_CSV_URL = 'https://raw.githubusercontent.com/inheok1103-alt/english-textbook-system/main/data/master_index.csv'; // 매일 GitHub Actions가 갱신 → 자동 끌어옴(수동 업로드 불필요)
var NEW_SHEET = 'newbooks_v1';        // KOBIC 신간 캐시
var RATING_SHEET = 'ratings_v1';      // 교재 A/B/C 등급 평가(누적)
var DATA4LIB_KEY = '';                // ★ 정보나루 인증키 (data4library.kr 발급) 입력
var RATING_HEADERS = ['submittedAt', 'date', 'uid', 'title', 'grade', 'gradeScore', 'nickname', 'comment', 'dayKey', 'weekKey', 'monthKey', 'yearKey', 'deviceId'];
var GRADE_SCORE = { A: 4, B: 3, C: 2, D: 1, F: 0 };

var HEADERS = ['submittedAt','date','attemptId','nickname','ageBand','grade','goal','region',
  'picks','curriculum','partCounts','pickCount','raw','dayKey','weekKey','monthKey','yearKey','deviceId'];
var RANK_HEADERS = ['capturedAt','source','rankType','gradeBand','englishArea','rank',
  'title','titleNorm','isbn','publisher','period','periodKey','matchedUid','link'];

// englishArea 표준값: 문법 구문 어휘 독해 듣기 말하기 쓰기 파닉스 시험 통합
// gradeBand 표준값: 초 중 고 성인 전체

// ===== 라우팅 =====
function doPost(e) {
  var lock = LockService.getScriptLock(); lock.waitLock(5000);
  try {
    var rec = parseBody_(e);
    if (rec.type === 'rating') { sheet_(RATING_SHEET, RATING_HEADERS).appendRow(ratingRow_(rec)); return output_({ ok: true, type: 'rating' }); }
    getSheet_().appendRow(rowFromRecord_(rec)); return output_({ ok: true });
  } finally { lock.releaseLock(); }
}
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.material)  return output_(buildMaterial_(p), p.callback);
  if (p.ratings)   return output_(buildRatings_(p), p.callback);
  if (p.rankings)  return output_(buildRankings_(p), p.callback);
  if (p.newbooks)  return output_(buildNewbooks_(p), p.callback);
  if (p.summary || p.admin) return output_(buildSummary_(p), p.callback);
  if (p.chat)      return output_(chatProxy_(p), p.callback);
  return output_({ ok: true, message: '교재 시스템 백엔드 작동 중',
    usage: 'POST 제출 / ?summary=1 / ?material=UID / ?rankings=1&source=&gradeBand=&englishArea= / ?newbooks=1 / ?chat=1&q=&c=' }, p.callback);
}

// ===== 교재 상담 LLM 프록시 (Groq) — 키는 Script Property 'GROQ_KEY'에만 저장(리포·클라이언트 노출 금지) =====
var GROQ_MODEL = 'llama-3.3-70b-versatile';
function chatProxy_(p) {
  var key = PropertiesService.getScriptProperties().getProperty('GROQ_KEY');
  if (!key) return { ok: false, answer: '' };                 // 키 없으면 앱이 검색기반으로 폴백
  var q = String(p.q || '').slice(0, 400);
  var cands = parseJson_(p.c, []);
  var lines = (cands || []).slice(0, 6).map(function (b, i) {
    return (i + 1) + '. ' + b.t + ' (' + (b.p || '') + ', ' + (b.g || '') + ', ' + (b.s || '') + ', Lv' + (b.l || '') + ', 판매지수 ' + (b.sp || 0) + ')';
  }).join('\n');
  var sys = '너는 한국 영어교재 상담사다. 학부모가 교재를 몰라도 되게, 아래 "후보 교재"만 근거로 2~4문장으로 친절하고 구체적으로 추천 이유를 설명하라. 후보에 없는 책은 절대 언급하지 말고 과장하지 마라. 학년·영역·수준·판매인기를 자연스럽게 녹여라.';
  var usr = '질문: ' + q + '\n\n후보 교재:\n' + lines;
  try {
    var res = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + key },
      payload: JSON.stringify({ model: GROQ_MODEL, temperature: 0.4, max_tokens: 400,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }] }),
      muteHttpExceptions: true });
    var d = JSON.parse(res.getContentText());
    var ans = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    return { ok: true, answer: ans || '' };
  } catch (err) { return { ok: false, answer: '', error: String(err) }; }
}

// ===== 공통 유틸 =====
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_(name, headers) {
  var ss = ss_(); var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(headers);
  return sh;
}
function getSheet_() { return sheet_(SHEET_NAME, HEADERS); }
function normTitle_(t) { return String(t || '').toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9가-힣]/g, ''); }
function output_(obj, cb) {
  var json = JSON.stringify(obj);
  if (cb) return ContentService.createTextOutput(cb + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
function parseJson_(t, fb) { try { return t ? JSON.parse(t) : fb; } catch (e) { return fb; } }
function stringify_(v) { return typeof v === 'string' ? v : JSON.stringify(v || ''); }

// ===== 커리큘럼 집계 (앱 자체 랭킹 P0) =====
function parseBody_(e) {
  var body = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
  var rec = {}; try { rec = JSON.parse(body); } catch (err) { rec = { rawText: body }; }
  var now = new Date();
  rec.submittedAt = rec.submittedAt || now.toISOString();
  rec.date = rec.date || Utilities.formatDate(now, TZ, 'yyyy. M. d. a h:mm:ss');
  return rec;
}
function bucketKeys_(iso) {
  var d = new Date(iso); if (isNaN(d.getTime())) d = new Date();
  return { day: Utilities.formatDate(d, TZ, 'yyyy-MM-dd'),
    week: Utilities.formatDate(d, TZ, 'yyyy') + '-W' + Utilities.formatDate(d, TZ, 'ww'),
    month: Utilities.formatDate(d, TZ, 'yyyy-MM'), year: Utilities.formatDate(d, TZ, 'yyyy') };
}
function rowFromRecord_(rec) {
  var bk = bucketKeys_(rec.submittedAt); var picks = Array.isArray(rec.picks) ? rec.picks : [];
  return [rec.submittedAt || '', rec.date || '', rec.attemptId || '', rec.nickname || '',
    rec.ageBand || '', rec.grade || '', rec.goal || '', rec.region || '',
    stringify_(picks), stringify_(rec.curriculum || {}), stringify_(rec.partCounts || {}),
    picks.length, stringify_(rec), bk.day, bk.week, bk.month, bk.year, rec.deviceId || ''];
}
function getRecords_() {
  var sh = getSheet_(); var v = sh.getDataRange().getValues(); if (v.length <= 1) return [];
  var h = v[0].map(String);
  return v.slice(1).filter(function (r) { return r.join('').trim() !== ''; }).map(function (r) {
    var o = {}; h.forEach(function (k, i) { o[k] = r[i]; });
    o.picksArr = parseJson_(o.picks, []); o.partObj = parseJson_(o.partCounts, {}); o.curObj = parseJson_(o.curriculum, {}); return o;
  });
}
// 커리큘럼 → 순서열. 신버전은 배열(시간순), 구버전은 {단계:{분기:uid}}
function orderedSeq_(cur) {
  if (Array.isArray(cur)) return cur.filter(function (x) { return x; });
  var seq = []; cur = cur || {}; ['1', '2', '3'].forEach(function (p) { var ph = cur[p] || {}; ['1', '2', '3', '4'].forEach(function (q) { if (ph[q]) seq.push(ph[q]); }); }); return seq;
}
// 인기 조합(연속 교재 페어) 누적
function popularPairs_(rows, topN) {
  var m = {}, seen = {}; rows.forEach(function (r) { var dv = String(r.deviceId || r.attemptId || ''); var s = orderedSeq_(r.curObj || {}); for (var i = 0; i + 1 < s.length; i++) { var k = s[i] + '>' + s[i + 1]; var sk = dv + '|' + k; if (seen[sk]) continue; seen[sk] = 1; m[k] = (m[k] || 0) + 1; } });
  return Object.keys(m).map(function (k) { var p = k.split('>'); return { from: p[0], to: p[1], count: m[k] }; })
    .sort(function (a, b) { return b.count - a.count; }).slice(0, topN || 30);
}
// 인기 커리 템플릿(전체 시퀀스 동일) 누적 — 기기당 1회
function popularCurricula_(rows, topN) {
  var m = {}, meta = {}, seen = {};
  rows.forEach(function (r) { var dv = String(r.deviceId || r.attemptId || ''); var s = orderedSeq_(r.curObj || {}); if (s.length < 2) return; var k = s.join('>'); var sk = dv + '|' + k; if (seen[sk]) return; seen[sk] = 1; m[k] = (m[k] || 0) + 1; if (!meta[k]) meta[k] = { seq: s, grade: r.grade || '', goal: r.goal || '' }; });
  return Object.keys(m).map(function (k) { return { seq: meta[k].seq, grade: meta[k].grade, goal: meta[k].goal, count: m[k] }; })
    .sort(function (a, b) { return b.count - a.count; }).slice(0, topN || 20);
}
function buildSummary_(p) {
  var rows = getRecords_(), bucket = p.bucket || 'all', period = p.period || '', gradeF = p.grade || '', goalF = p.goal || '';
  var f = rows.filter(function (r) {
    if (gradeF && String(r.grade || '') !== gradeF) return false;
    if (goalF && String(r.goal || '') !== goalF) return false;
    if (bucket !== 'all' && period) {
      var k = bucket === 'day' ? r.dayKey : bucket === 'week' ? r.weekKey : bucket === 'month' ? r.monthKey : r.yearKey;
      if (String(k || '') !== period) return false;
    } return true;
  });
  return { ok: true, generatedAt: new Date().toISOString(), bucket: bucket, period: period, total: f.length, totalAll: rows.length,
    popularMaterials: popular_(f, 40), byGrade: groupTop_(f, 'grade'), byGoal: groupTop_(f, 'goal'),
    popularPairs: popularPairs_(f, 30), popularCurricula: popularCurricula_(f, 20),
    partAverages: partAvg_(f), areaEmphasis: areaEmphasis_(f), areaTrend: areaTrend_(rows), trend: trend_(rows) };
}
// IP/기기당 교재는 1번만 카운트 (deviceId 기준 중복제거). count=해당 교재를 쓴 '서로 다른 기기 수'
function popular_(rows, n) { var m = {}, seen = {}, dev = {};
  rows.forEach(function (r) { var dv = String(r.deviceId || r.attemptId || ''); dev[dv] = 1;
    (r.picksArr || []).forEach(function (u) { var k = dv + '|' + u; if (seen[k]) return; seen[k] = 1; m[u] = (m[u] || 0) + 1; }); });
  var denom = Object.keys(dev).length || 1;
  return Object.keys(m).map(function (u) { return { uid: u, count: m[u], pct: Math.round(m[u] / denom * 100) }; })
    .sort(function (a, b) { return b.count - a.count; }).slice(0, n); }
function groupTop_(rows, key) { var g = {};
  rows.forEach(function (r) { var k = String(r[key] || '미지정'); (g[k] = g[k] || []).push(r); });
  return Object.keys(g).map(function (k) { return { name: k, n: g[k].length, topPicks: popular_(g[k], 8) }; })
    .sort(function (a, b) { return b.n - a.n; }); }
function partAvg_(rows) { var s = {}, n = rows.length || 1;
  rows.forEach(function (r) { var o = r.partObj || {}; Object.keys(o).forEach(function (k) { s[k] = (s[k] || 0) + Number(o[k] || 0); }); });
  return Object.keys(s).map(function (k) { return { part: k, avg: Math.round(s[k] / n * 10) / 10, total: s[k] }; }).sort(function (a, b) { return b.avg - a.avg; }); }
function trend_(rows) { function c(f) { var m = {}; rows.forEach(function (r) { var k = String(r[f] || ''); if (k) m[k] = (m[k] || 0) + 1; }); return Object.keys(m).sort().map(function (k) { return { key: k, n: m[k] }; }); }
  return { day: c('dayKey'), week: c('weekKey'), month: c('monthKey'), year: c('yearKey') }; }
// 영어교육 경향: 어느 영역(4대영역+문법/어휘 등)이 강조되는가 (기기당 영역 1회) → count=해당 영역을 커리에 넣은 기기 수
function areaEmphasis_(rows) {
  var tot = {}, seen = {};
  rows.forEach(function (r) { var dv = String(r.deviceId || r.attemptId || ''); var o = r.partObj || {}; Object.keys(o).forEach(function (k) { var sk = dv + '|' + k; if (seen[sk]) return; seen[sk] = 1; tot[k] = (tot[k] || 0) + 1; }); });
  var sum = 0; Object.keys(tot).forEach(function (k) { sum += tot[k]; }); sum = sum || 1;
  return Object.keys(tot).map(function (k) { return { area: k, count: tot[k], pct: Math.round(tot[k] / sum * 100) }; }).sort(function (a, b) { return b.count - a.count; });
}
// 영역 경향 추이(월별): 영역별 강조 비중 변화 → 상승/하락 파악
function areaTrend_(rows) {
  var months = {};
  rows.forEach(function (r) { var mk = String(r.monthKey || ''); if (!mk) return; (months[mk] = months[mk] || []).push(r); });
  var keys = Object.keys(months).sort().slice(-6);
  return keys.map(function (mk) {
    var em = areaEmphasis_(months[mk]); var o = {}; em.forEach(function (x) { o[x.area] = x.pct; });
    return { month: mk, areas: o };
  });
}
function buildMaterial_(p) { var uid = String(p.material || '');
  var rows = getRecords_().filter(function (r) { return (r.picksArr || []).indexOf(uid) >= 0; });
  var co = {}; rows.forEach(function (r) { (r.picksArr || []).forEach(function (u) { if (u !== uid) co[u] = (co[u] || 0) + 1; }); });
  return { ok: true, uid: uid, chosenBy: rows.length, rating: buildRatings_({ uid: uid }).ratings,
    alsoChosen: Object.keys(co).map(function (u) { return { uid: u, count: co[u] }; }).sort(function (a, b) { return b.count - a.count; }).slice(0, 12) }; }

// ===== 외부 랭킹 조회 (P1 정보나루 / P2 YES24) =====
function buildRankings_(p) {
  var src = p.source || 'all', gb = p.gradeBand || '', ea = p.englishArea || '', period = p.period || '';
  var sh = ss_().getSheetByName(RANK_SHEET); if (!sh || sh.getLastRow() <= 1) return { ok: true, items: [], note: '랭킹 캐시 비어있음(트리거 미실행)' };
  var v = sh.getDataRange().getValues(), h = v[0].map(String);
  var items = v.slice(1).map(function (r) { var o = {}; h.forEach(function (k, i) { o[k] = r[i]; }); return o; })
    .filter(function (o) {
      if (src !== 'all' && String(o.source) !== src) return false;
      if (gb && String(o.gradeBand) !== gb) return false;
      if (ea && String(o.englishArea) !== ea) return false;
      if (period && String(o.periodKey) !== period) return false;
      return true;
    }).sort(function (a, b) { return Number(a.rank) - Number(b.rank); });
  // 소스별 그룹
  var bySource = {}; items.forEach(function (o) { (bySource[o.source] = bySource[o.source] || []).push(o); });
  return { ok: true, generatedAt: new Date().toISOString(), source: src, gradeBand: gb, englishArea: ea, count: items.length, items: items.slice(0, 200), bySource: bySource };
}
function buildNewbooks_(p) {
  var sh = ss_().getSheetByName(NEW_SHEET); if (!sh || sh.getLastRow() <= 1) return { ok: true, items: [] };
  var v = sh.getDataRange().getValues(), h = v[0].map(String);
  return { ok: true, items: v.slice(1, 101).map(function (r) { var o = {}; h.forEach(function (k, i) { o[k] = r[i]; }); return o; }) };
}

// master_index(isbn/titleNorm→uid) 로 매칭
function loadIndex_() {
  var sh = ss_().getSheetByName(INDEX_SHEET); var byIsbn = {}, byTitle = {};
  if (!sh || sh.getLastRow() <= 1) return { byIsbn: byIsbn, byTitle: byTitle };
  var v = sh.getDataRange().getValues(), h = v[0].map(String);
  var ii = h.indexOf('isbn'), it = h.indexOf('titleNorm'), iu = h.indexOf('uid');
  v.slice(1).forEach(function (r) { if (r[ii]) byIsbn[String(r[ii])] = r[iu]; if (r[it]) byTitle[String(r[it])] = r[iu]; });
  return { byIsbn: byIsbn, byTitle: byTitle };
}
function matchUid_(idx, isbn, title) { return (isbn && idx.byIsbn[String(isbn)]) || idx.byTitle[normTitle_(title)] || ''; }

function writeRank_(rows) { // rows: 정규화 객체 배열 → RANK_SHEET 교체append(소스+기간 키로)
  var sh = sheet_(RANK_SHEET, RANK_HEADERS);
  var out = rows.map(function (o) { return RANK_HEADERS.map(function (k) { return o[k] != null ? o[k] : ''; }); });
  if (out.length) sh.getRange(sh.getLastRow() + 1, 1, out.length, RANK_HEADERS.length).setValues(out);
}

// ----- 정보나루 대출 랭킹 (공식 OpenAPI, 약관 안전) -----
// 인기대출도서 — loanItemSrch의 kdc는 단자리만 지원(테스트 확정). 그래서 kdc=7(언어)로 받아
// class_no가 "74"(영어)로 시작하는 책만 거르고, 3자리 class_no로 영어 영역까지 자동 태깅 → 학년 4건만 호출.
var D4L_AGES = [
  { gradeBand: '초',   age: '8;9;10;11;12;13' },
  { gradeBand: '중',   age: '14;15;16' },
  { gradeBand: '고',   age: '17;18;19' },
  { gradeBand: '성인', age: '20;30;40;50' }
];
// KDC 74x → 영어 영역 (data4library class_nm 실측: 744=어휘,745=문법,746=작문,747=독본·해석·회화,740=영어)
function engAreaFromClass_(cn) {
  var c = String(cn || ''); if (!/^74/.test(c)) return '';
  var d3 = c.slice(0, 3);
  return ({ '741': '파닉스', '742': '어휘', '743': '어휘', '744': '어휘', '745': '문법', '746': '쓰기', '747': '독해', '748': '독해' })[d3] || '통합';
}
function collectData4Library_() {
  if (!DATA4LIB_KEY) { Logger.log('DATA4LIB_KEY 없음'); return; }
  var idx = loadIndex_(), all = [], now = new Date().toISOString();
  var periodKey = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
  var endDt = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var startDt = Utilities.formatDate(new Date(new Date().getTime() - 365 * 24 * 3600 * 1000), TZ, 'yyyy-MM-dd');
  D4L_AGES.forEach(function (t) {
    try {
      var url = 'http://data4library.kr/api/loanItemSrch?authKey=' + DATA4LIB_KEY +
        '&startDt=' + startDt + '&endDt=' + endDt + '&age=' + encodeURIComponent(t.age) +
        '&kdc=7&pageNo=1&pageSize=300&format=json';
      var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      var j = JSON.parse(res.getContentText());
      var docs = (j.response && j.response.docs) || [];
      var rank = 0;
      docs.forEach(function (d) {
        var b = d.doc || d; var area = engAreaFromClass_(b.class_no);
        if (!area) return;                 // 영어책(class 74x)만
        rank++;
        all.push({ capturedAt: now, source: 'data4library', rankType: 'loan', gradeBand: t.gradeBand, englishArea: area,
          rank: rank, title: b.bookname || '', titleNorm: normTitle_(b.bookname), isbn: b.isbn13 || '',
          publisher: b.publisher || '', period: 'year', periodKey: periodKey,
          matchedUid: matchUid_(idx, b.isbn13, b.bookname), link: '' });
      });
    } catch (err) { Logger.log('d4l ' + t.gradeBand + ' ' + err); }
    Utilities.sleep(400);
  });
  clearSource_('data4library'); writeRank_(all);
}

// ----- YES24 판매 베스트셀러 (SSR HTML 파싱) -----
// cateCode → gradeBand/englishArea 매핑 (리서치 기반, 필요시 좌측트리에서 보강)
var YES24_TARGETS = [
  { cateCode: '001001026', gradeBand: '전체', englishArea: '통합' },  // 외국어 영어 (대분류 예시)
  { cateCode: '001001044010', gradeBand: '초', englishArea: '통합' }, // 초등참고서 영어(예시)
  { cateCode: '001001044002', gradeBand: '중', englishArea: '통합' }  // 중등참고서 영어(예시)
];
function collectYes24_() {
  var idx = loadIndex_(), all = [], now = new Date().toISOString();
  var periodKey = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  YES24_TARGETS.forEach(function (t) {
    try {
      var url = 'https://www.yes24.com/Product/Category/BestSeller?categoryNumber=' + t.cateCode + '&pageNumber=1&pageSize=24';
      var html = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } }).getContentText();
      var re = /goods_name[^>]*>\s*<a[^>]*goodsNo=(\d+)[^>]*>([^<]+)<\/a>/g, m, rank = 0;
      while ((m = re.exec(html)) && rank < 24) { rank++;
        var title = m[2].replace(/&amp;/g, '&').trim();
        all.push({ capturedAt: now, source: 'yes24', rankType: 'sales', gradeBand: t.gradeBand, englishArea: t.englishArea,
          rank: rank, title: title, titleNorm: normTitle_(title), isbn: '', publisher: '', period: 'day', periodKey: periodKey,
          matchedUid: matchUid_(idx, '', title), link: 'https://www.yes24.com/Product/Goods/' + m[1] });
      }
    } catch (err) { Logger.log('yes24 ' + t.cateCode + ' ' + err); }
    Utilities.sleep(500);
  });
  clearSource_('yes24'); writeRank_(all);
}
// ----- 알라딘 판매 베스트셀러 (공식 TTB OpenAPI) — ★비영리/개인 학습용만 약관 허용. 키: aladin.co.kr/ttb -----
var ALADIN_TTB_KEY = '';
var ALADIN_TARGETS = [
  { cid: 76817, gradeBand: '중', englishArea: '통합' },
  { cid: 50246, gradeBand: '초', englishArea: '통합' },
  { cid: 90861, gradeBand: '성인', englishArea: '통합', target: 'Foreign' }
];
function collectAladin_() {
  if (!ALADIN_TTB_KEY) { Logger.log('ALADIN_TTB_KEY 없음(미사용)'); return; }
  var idx = loadIndex_(), all = [], now = new Date().toISOString();
  var periodKey = Utilities.formatDate(new Date(), TZ, 'yyyy') + '-W' + Utilities.formatDate(new Date(), TZ, 'ww');
  ALADIN_TARGETS.forEach(function (t) {
    try {
      var url = 'http://www.aladin.co.kr/ttb/api/ItemList.aspx?ttbkey=' + ALADIN_TTB_KEY +
        '&QueryType=Bestseller&SearchTarget=' + (t.target || 'Book') + '&CategoryId=' + t.cid +
        '&MaxResults=50&start=1&output=js&Version=20131101';
      var j = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText());
      (j.item || []).forEach(function (b, i) {
        var title = String(b.title || '').replace(/&amp;/g, '&').trim();
        all.push({ capturedAt: now, source: 'aladin', rankType: 'sales', gradeBand: t.gradeBand, englishArea: t.englishArea,
          rank: b.bestRank || (i + 1), title: title, titleNorm: normTitle_(title), isbn: b.isbn13 || '',
          publisher: b.publisher || '', period: 'week', periodKey: periodKey,
          matchedUid: matchUid_(idx, b.isbn13, title), link: b.link || '' });
      });
    } catch (err) { Logger.log('aladin ' + t.cid + ' ' + err); }
    Utilities.sleep(400);
  });
  clearSource_('aladin'); writeRank_(all);
}
function clearSource_(src) {
  var sh = ss_().getSheetByName(RANK_SHEET); if (!sh || sh.getLastRow() <= 1) return;
  var v = sh.getDataRange().getValues(), h = v[0], si = h.indexOf('source');
  var keep = [h]; for (var i = 1; i < v.length; i++) if (String(v[i][si]) !== src) keep.push(v[i]);
  sh.clearContents(); sh.getRange(1, 1, keep.length, h.length).setValues(keep);
}

// ===== 교재 A/B/C 등급 평가 (누적: 일/주/월/년) =====
function ratingRow_(rec) {
  var bk = bucketKeys_(rec.submittedAt); var g = String(rec.grade || '').toUpperCase();
  return [rec.submittedAt || '', rec.date || '', rec.uid || '', rec.title || '', g,
    GRADE_SCORE[g] != null ? GRADE_SCORE[g] : '', rec.nickname || '', rec.comment || '', bk.day, bk.week, bk.month, bk.year, rec.deviceId || ''];
}
function getRatings_() {
  var sh = ss_().getSheetByName(RATING_SHEET); if (!sh || sh.getLastRow() <= 1) return [];
  var v = sh.getDataRange().getValues(), h = v[0].map(String);
  return v.slice(1).filter(function (r) { return r.join('').trim() !== ''; }).map(function (r) { var o = {}; h.forEach(function (k, i) { o[k] = r[i]; }); return o; });
}
function letterOf_(avg) { return avg >= 3.5 ? 'A' : avg >= 2.5 ? 'B' : avg >= 1.5 ? 'C' : avg >= 0.5 ? 'D' : 'F'; }
// ?ratings=1 [&uid=][&bucket=day|week|month|year&period=키]
function buildRatings_(p) {
  var rows = getRatings_(), uidF = p.uid || '', bucket = p.bucket || 'all', period = p.period || '';
  rows = rows.filter(function (r) {
    if (bucket !== 'all' && period) { var k = bucket === 'day' ? r.dayKey : bucket === 'week' ? r.weekKey : bucket === 'month' ? r.monthKey : r.yearKey; if (String(k || '') !== period) return false; }
    return true;
  });
  // 기기당 교재 1평가만 (최신 유지) → 과다/중복 집계 방지
  var latest = {};
  rows.forEach(function (r) { var u = String(r.uid || ''); if (!u) return; var dv = String(r.deviceId || ''); var key = dv + '|' + u; var prev = latest[key]; if (!prev || String(r.submittedAt) > String(prev.submittedAt)) latest[key] = r; });
  var agg = {};
  Object.keys(latest).forEach(function (key) {
    var r = latest[key]; var u = String(r.uid); if (uidF && u !== uidF) return;
    var s = Number(r.gradeScore); if (isNaN(s)) return;
    var a = agg[u] || (agg[u] = { uid: u, count: 0, sum: 0, dist: { A: 0, B: 0, C: 0, D: 0, F: 0 } });
    a.count++; a.sum += s; if (a.dist[r.grade] != null) a.dist[r.grade]++;
  });
  var list = Object.keys(agg).map(function (u) { var a = agg[u], avg = a.sum / a.count; return { uid: u, count: a.count, avg: Math.round(avg * 100) / 100, grade: letterOf_(avg), dist: a.dist }; })
    .sort(function (x, y) { return y.avg - x.avg || y.count - x.count; });
  return { ok: true, generatedAt: new Date().toISOString(), bucket: bucket, period: period, total: rows.length,
    ratings: uidF ? (list[0] || { uid: uidF, count: 0, grade: null, dist: {} }) : list };
}

// master_index 자동 동기화 — GitHub raw CSV → 시트 (수동 업로드 불필요, 전공·신간 자동 반영)
function syncIndexFromGitHub_() {
  try {
    var res = UrlFetchApp.fetch(INDEX_CSV_URL, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) { Logger.log('index fetch ' + res.getResponseCode()); return; }
    var rows = Utilities.parseCsv(res.getContentText());
    if (!rows || rows.length < 2) { Logger.log('index empty'); return; }
    var sh = sheet_(INDEX_SHEET, ['isbn', 'titleNorm', 'uid', 'title']);
    sh.clearContents();
    sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
    Logger.log('master_index 동기화 완료: ' + (rows.length - 1) + '행');
  } catch (e) { Logger.log('syncIndexFromGitHub_ ' + e); }
}

// ===== 셋업 =====
function setupAll() {
  sheet_(SHEET_NAME, HEADERS); sheet_(RANK_SHEET, RANK_HEADERS); sheet_(INDEX_SHEET, ['isbn', 'titleNorm', 'uid', 'title']); sheet_(NEW_SHEET, ['isbn', 'title', 'publisher', 'pubDate', 'addedAt']); sheet_(RATING_SHEET, RATING_HEADERS);
  // 트리거(중복 방지)
  ScriptApp.getProjectTriggers().forEach(function (t) { if (/collect|sync/.test(t.getHandlerFunction())) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('collectData4Library_').timeBased().atHour(3).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('syncIndexFromGitHub_').timeBased().atHour(4).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('collectYes24_').timeBased().atHour(6).everyDays(1).inTimezone(TZ).create();
  if (ALADIN_TTB_KEY) ScriptApp.newTrigger('collectAladin_').timeBased().atHour(5).everyDays(1).inTimezone(TZ).create();
  syncIndexFromGitHub_();   // 최초 1회 즉시 동기화(GitHub의 master_index.csv 끌어옴)
  Logger.log('setup 완료: 시트+트리거+master_index 동기화. DATA4LIB_KEY 입력 시 도서관 대출랭킹도 켜짐.');
}
