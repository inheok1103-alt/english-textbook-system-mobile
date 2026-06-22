/* master_index 내보내기 — GAS 랭킹 매칭용 (isbn/titleNorm → uid)
   외부 랭킹(YES24/정보나루의 ISBN·제목)을 우리 교재 UID에 연결하기 위한 색인.
   출력: data/master_index.csv (GAS master_index 시트에 붙여넣기) + data/master_index.json
   사용: node tools/export_master_index.js
*/
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "iinhyuk_english_book_guide_v0.9_expanded.html"), "utf8")
  .match(/<script id="master-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const img = (JSON.parse(fs.readFileSync(path.join(ROOT, "data", "book_images.json"), "utf8")).images) || {};

const normTitle = (t) => String(t || "").toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9가-힣]/g, "");
const csvEsc = (s) => { s = String(s == null ? "" : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

const eng = master.materials.filter((m) => m.domain === "영어");
const rows = eng.map((m) => {
  const uid = m.materialUid;
  const isbn = m.isbn || (img[uid] && img[uid].isbn) || "";
  return { isbn: String(isbn), titleNorm: normTitle(m.title), uid, title: m.title || "" };
});

const header = ["isbn", "titleNorm", "uid", "title"];
const csv = [header.join(",")].concat(rows.map((r) => header.map((h) => csvEsc(r[h])).join(","))).join("\n");
fs.writeFileSync(path.join(ROOT, "data", "master_index.csv"), csv, "utf8");
fs.writeFileSync(path.join(ROOT, "data", "master_index.json"), JSON.stringify(rows), "utf8");

const withIsbn = rows.filter((r) => r.isbn).length;
console.log(`master_index: ${rows.length}종 (ISBN 보유 ${withIsbn}) → data/master_index.csv / .json`);
