/*
  이인혁 영어 교재선택가이드 — 커리큘럼 공유/집계 백엔드 (삼육중 패턴 변형)
  사용법:
  1. Google Sheets 새 파일 생성
  2. 확장 프로그램 > Apps Script에서 이 파일 내용 붙여넣기
  3. 배포 > 새 배포 > 웹 앱 > 실행: 나 / 액세스: 모든 사용자
  4. 발급된 /exec URL을 guide_config.js의 GUIDE_ENDPOINT에 입력
  설계:
  - POST: 커리큘럼 제출 1건을 responses 시트에 append (무한 누적이되, 집계는 일/주/월/년 버킷)
  - GET ?summary=1&bucket=all|day|week|month|year[&grade=&goal=&period=YYYY-MM 등]
      → 인기 교재 랭킹 / 학년·목표별 인기 / 4대영역 파트 분포 / 기간별 추이
  - GET ?material=IH-ENG-0078 → 해당 교재가 어떤 커리에서 함께 쓰였는지(동시선택 Top)
*/

var SHEET_NAME = 'curriculum_v1';
var HEADERS = [
  'submittedAt', 'date', 'attemptId', 'nickname',
  'ageBand', 'grade', 'goal', 'region',
  'picks',         // JSON 배열: ["IH-ENG-0078", ...]
  'curriculum',    // JSON: {"S1":[...uids],"S2":[...]}
  'partCounts',    // JSON: {"어휘":2,"문법":1,...}
  'pickCount', 'raw',
  'dayKey', 'weekKey', 'monthKey', 'yearKey'
];
var TZ = 'Asia/Seoul';

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var sh = getSheet_();
    var rec = parseBody_(e);
    sh.appendRow(rowFromRecord_(rec));
    return output_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.material) return output_(buildMaterial_(p), p.callback);
  if (p.summary || p.admin) return output_(buildSummary_(p), p.callback);
  return output_({
    ok: true,
    message: '교재선택가이드 커리큘럼 수집 엔드포인트 작동 중.',
    usage: 'POST 제출 / GET ?summary=1&bucket=all|day|week|month|year / GET ?material=UID'
  }, p.callback);
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) sh.appendRow(HEADERS);
  else ensureHeaders_(sh);
  return sh;
}

function ensureHeaders_(sh) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var current = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  HEADERS.forEach(function (h) {
    if (current.indexOf(h) < 0) { sh.getRange(1, current.length + 1).setValue(h); current.push(h); }
  });
}

function parseBody_(e) {
  var body = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
  var rec = {};
  try { rec = JSON.parse(body); } catch (err) { rec = { rawText: body }; }
  var now = new Date();
  rec.submittedAt = rec.submittedAt || now.toISOString();
  rec.date = rec.date || Utilities.formatDate(now, TZ, 'yyyy. M. d. a h:mm:ss');
  return rec;
}

function bucketKeys_(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) d = new Date();
  var day = Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  var month = Utilities.formatDate(d, TZ, 'yyyy-MM');
  var year = Utilities.formatDate(d, TZ, 'yyyy');
  // ISO week
  var week = Utilities.formatDate(d, TZ, 'yyyy') + '-W' + Utilities.formatDate(d, TZ, 'ww');
  return { day: day, week: week, month: month, year: year };
}

function rowFromRecord_(rec) {
  var bk = bucketKeys_(rec.submittedAt);
  var picks = Array.isArray(rec.picks) ? rec.picks : [];
  return [
    rec.submittedAt || '', rec.date || '', rec.attemptId || '', rec.nickname || '',
    rec.ageBand || '', rec.grade || '', rec.goal || '', rec.region || '',
    stringify_(picks), stringify_(rec.curriculum || {}), stringify_(rec.partCounts || {}),
    picks.length, stringify_(rec),
    bk.day, bk.week, bk.month, bk.year
  ];
}

function getRecords_() {
  var sh = getSheet_();
  var values = sh.getDataRange().getValues();
  if (values.length <= 1) return [];
  var headers = values[0].map(String);
  return values.slice(1).filter(function (row) { return row.join('').trim() !== ''; }).map(function (row) {
    var r = {}; headers.forEach(function (h, i) { r[h] = row[i]; });
    r.picksArr = parseJson_(r.picks, []);
    r.partObj = parseJson_(r.partCounts, {});
    r.curriculumObj = parseJson_(r.curriculum, {});
    return r;
  });
}

function buildSummary_(p) {
  var rows = getRecords_();
  var bucket = p.bucket || 'all';      // all|day|week|month|year
  var period = p.period || '';          // 특정 버킷키로 한정 (예: 2026-06)
  var gradeF = p.grade || '';
  var goalF = p.goal || '';

  // 버킷/필터 적용
  var filtered = rows.filter(function (r) {
    if (gradeF && String(r.grade || '') !== gradeF) return false;
    if (goalF && String(r.goal || '') !== goalF) return false;
    if (bucket !== 'all' && period) {
      var key = bucket === 'day' ? r.dayKey : bucket === 'week' ? r.weekKey : bucket === 'month' ? r.monthKey : r.yearKey;
      if (String(key || '') !== period) return false;
    }
    return true;
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    bucket: bucket, period: period, grade: gradeF, goal: goalF,
    total: filtered.length,
    totalAll: rows.length,
    popularMaterials: popularMaterials_(filtered, 40),
    byGrade: groupTopPicks_(filtered, 'grade'),
    byGoal: groupTopPicks_(filtered, 'goal'),
    byAgeBand: groupTopPicks_(filtered, 'ageBand'),
    partAverages: partAverages_(filtered),
    trend: trend_(rows),                // 전체기준 기간 추이(필터 무관)
    recent: filtered.slice(-20).reverse().map(function (r) {
      return { date: r.date, grade: r.grade || '', goal: r.goal || '', ageBand: r.ageBand || '', pickCount: Number(r.pickCount || 0) };
    })
  };
}

// 인기 교재: picks 전체를 카운트해 Top N
function popularMaterials_(rows, topN) {
  var m = {}, denom = rows.length || 1;
  rows.forEach(function (r) { (r.picksArr || []).forEach(function (uid) { m[uid] = (m[uid] || 0) + 1; }); });
  return Object.keys(m).map(function (uid) {
    return { uid: uid, count: m[uid], pct: Math.round(m[uid] / denom * 100) };
  }).sort(function (a, b) { return b.count - a.count || String(a.uid).localeCompare(String(b.uid)); }).slice(0, topN);
}

// 그룹(학년/목표/나이대)별 인기 교재 Top
function groupTopPicks_(rows, key) {
  var g = {};
  rows.forEach(function (r) { var k = String(r[key] || '미지정'); (g[k] = g[k] || []).push(r); });
  return Object.keys(g).map(function (k) {
    return { name: k, n: g[k].length, topPicks: popularMaterials_(g[k], 8) };
  }).sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name); });
}

// 4대영역(+쓰기/실전 등) 평균 권수
function partAverages_(rows) {
  var sum = {}, n = rows.length || 1;
  rows.forEach(function (r) {
    var o = r.partObj || {};
    Object.keys(o).forEach(function (k) { sum[k] = (sum[k] || 0) + Number(o[k] || 0); });
  });
  return Object.keys(sum).map(function (k) { return { part: k, avg: Math.round(sum[k] / n * 10) / 10, total: sum[k] }; })
    .sort(function (a, b) { return b.avg - a.avg; });
}

// 기간 추이: 일/주/월/년 버킷별 제출 수
function trend_(rows) {
  function count(field) {
    var m = {}; rows.forEach(function (r) { var k = String(r[field] || ''); if (k) m[k] = (m[k] || 0) + 1; });
    return Object.keys(m).sort().map(function (k) { return { key: k, n: m[k] }; });
  }
  return { day: count('dayKey'), week: count('weekKey'), month: count('monthKey'), year: count('yearKey') };
}

// 특정 교재의 동시선택(함께 고른 교재) Top — "이 교재 고른 사람들은 이것도 골랐다"
function buildMaterial_(p) {
  var uid = String(p.material || '');
  var rows = getRecords_().filter(function (r) { return (r.picksArr || []).indexOf(uid) >= 0; });
  var co = {};
  rows.forEach(function (r) { (r.picksArr || []).forEach(function (u) { if (u !== uid) co[u] = (co[u] || 0) + 1; }); });
  var together = Object.keys(co).map(function (u) { return { uid: u, count: co[u] }; })
    .sort(function (a, b) { return b.count - a.count; }).slice(0, 12);
  return { ok: true, uid: uid, chosenBy: rows.length, alsoChosen: together };
}

function parseJson_(t, fb) { try { return t ? JSON.parse(t) : fb; } catch (e) { return fb; } }
function stringify_(v) { return typeof v === 'string' ? v : JSON.stringify(v || ''); }

function output_(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback) return ContentService.createTextOutput(callback + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
