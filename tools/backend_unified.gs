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
var INDEX_SHEET = 'master_index';     // isbn/titleNorm → uid (로컬 스크립트가 업로드)
var NEW_SHEET = 'newbooks_v1';        // KOBIC 신간 캐시
var RATING_SHEET = 'ratings_v1';      // 교재 A/B/C 등급 평가(누적)
var DATA4LIB_KEY = '';                // ★ 정보나루 인증키 (data4library.kr 발급) 입력
var RATING_HEADERS = ['submittedAt', 'date', 'uid', 'title', 'grade', 'gradeScore', 'nickname', 'comment', 'dayKey', 'weekKey', 'monthKey', 'yearKey'];
var GRADE_SCORE = { A: 4, B: 3, C: 2, D: 1, F: 0 };

var HEADERS = ['submittedAt','date','attemptId','nickname','ageBand','grade','goal','region',
  'picks','curriculum','partCounts','pickCount','raw','dayKey','weekKey','monthKey','yearKey'];
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
  return output_({ ok: true, message: '교재 시스템 백엔드 작동 중',
    usage: 'POST 제출 / ?summary=1 / ?material=UID / ?rankings=1&source=&gradeBand=&englishArea= / ?newbooks=1' }, p.callback);
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
    picks.length, stringify_(rec), bk.day, bk.week, bk.month, bk.year];
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
  var m = {}; rows.forEach(function (r) { var s = orderedSeq_(r.curObj || {}); for (var i = 0; i + 1 < s.length; i++) { var k = s[i] + '>' + s[i + 1]; m[k] = (m[k] || 0) + 1; } });
  return Object.keys(m).map(function (k) { var p = k.split('>'); return { from: p[0], to: p[1], count: m[k] }; })
    .sort(function (a, b) { return b.count - a.count; }).slice(0, topN || 30);
}
// 인기 커리 템플릿(전체 시퀀스 동일) 누적
function popularCurricula_(rows, topN) {
  var m = {}, meta = {};
  rows.forEach(function (r) { var s = orderedSeq_(r.curObj || {}); if (s.length < 2) return; var k = s.join('>'); m[k] = (m[k] || 0) + 1; if (!meta[k]) meta[k] = { seq: s, grade: r.grade || '', goal: r.goal || '' }; });
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
    partAverages: partAvg_(f), trend: trend_(rows) };
}
function popular_(rows, n) { var m = {}, d = rows.length || 1;
  rows.forEach(function (r) { (r.picksArr || []).forEach(function (u) { m[u] = (m[u] || 0) + 1; }); });
  return Object.keys(m).map(function (u) { return { uid: u, count: m[u], pct: Math.round(m[u] / d * 100) }; })
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
// 연령(age)·KDC 조합으로 인기대출도서. age: 6~7 유아,8~13 초,14~19 중고,20~ 성인. KDC 740=영어.
var D4L_TARGETS = [
  { gradeBand: '초', age: '8;9;10;11;12;13', kdc: '740', englishArea: '통합' },
  { gradeBand: '중', age: '14;15;16', kdc: '740', englishArea: '통합' },
  { gradeBand: '고', age: '17;18;19', kdc: '740', englishArea: '통합' },
  { gradeBand: '성인', age: '20;30', kdc: '740', englishArea: '통합' }
];
function collectData4Library_() {
  if (!DATA4LIB_KEY) { Logger.log('DATA4LIB_KEY 없음'); return; }
  var idx = loadIndex_(), all = [], now = new Date().toISOString();
  var periodKey = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
  D4L_TARGETS.forEach(function (t) {
    try {
      var url = 'http://data4library.kr/api/loanItemSrch?authKey=' + DATA4LIB_KEY +
        '&age=' + encodeURIComponent(t.age) + '&kdc=7&pageNo=1&pageSize=30&format=json';
      var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      var j = JSON.parse(res.getContentText());
      var docs = (j.response && j.response.docs) || [];
      docs.forEach(function (d, i) {
        var b = d.doc || d;
        all.push({ capturedAt: now, source: 'data4library', rankType: 'loan', gradeBand: t.gradeBand, englishArea: t.englishArea,
          rank: b.ranking || (i + 1), title: b.bookname || '', titleNorm: normTitle_(b.bookname), isbn: b.isbn13 || '',
          publisher: b.publisher || '', period: 'month', periodKey: periodKey,
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
    GRADE_SCORE[g] != null ? GRADE_SCORE[g] : '', rec.nickname || '', rec.comment || '', bk.day, bk.week, bk.month, bk.year];
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
  var agg = {};
  rows.forEach(function (r) {
    var u = String(r.uid || ''); if (!u || (uidF && u !== uidF)) return;
    var s = Number(r.gradeScore); if (isNaN(s)) return;
    var a = agg[u] || (agg[u] = { uid: u, count: 0, sum: 0, dist: { A: 0, B: 0, C: 0, D: 0, F: 0 } });
    a.count++; a.sum += s; if (a.dist[r.grade] != null) a.dist[r.grade]++;
  });
  var list = Object.keys(agg).map(function (u) { var a = agg[u], avg = a.sum / a.count; return { uid: u, count: a.count, avg: Math.round(avg * 100) / 100, grade: letterOf_(avg), dist: a.dist }; })
    .sort(function (x, y) { return y.avg - x.avg || y.count - x.count; });
  return { ok: true, generatedAt: new Date().toISOString(), bucket: bucket, period: period, total: rows.length,
    ratings: uidF ? (list[0] || { uid: uidF, count: 0, grade: null, dist: {} }) : list };
}

// ===== 셋업 =====
function setupAll() {
  sheet_(SHEET_NAME, HEADERS); sheet_(RANK_SHEET, RANK_HEADERS); sheet_(INDEX_SHEET, ['isbn', 'titleNorm', 'uid', 'title']); sheet_(NEW_SHEET, ['isbn', 'title', 'publisher', 'pubDate', 'addedAt']); sheet_(RATING_SHEET, RATING_HEADERS);
  // 트리거(중복 방지)
  ScriptApp.getProjectTriggers().forEach(function (t) { if (/collect/.test(t.getHandlerFunction())) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('collectData4Library_').timeBased().atHour(3).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('collectYes24_').timeBased().atHour(6).everyDays(1).inTimezone(TZ).create();
  Logger.log('setup 완료: 시트+트리거 생성. DATA4LIB_KEY 입력 후 collectData4Library_ 수동 1회 실행 권장.');
}
