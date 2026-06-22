const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_HTML =
  process.argv[2] ||
  path.join(ROOT, "data", "iinhyuk_english_book_guide_v0.9_expanded.html");
const OUT_DIR = path.join(ROOT, "data");
const COVER_DIR = path.join(ROOT, "covers");
const JSON_OUT = path.join(OUT_DIR, "book_images.json");
const CSV_OUT = path.join(OUT_DIR, "book_image_manifest.csv");
const CANDIDATES_OUT = path.join(OUT_DIR, "book_image_candidates.csv");

const LIMIT = Number(process.env.COVER_LIMIT || process.argv[3] || 0);
const START = Number(process.env.COVER_START || process.argv[4] || 0);
const FORCE = process.env.COVER_FORCE === "1";
const SLEEP_MS = Number(process.env.COVER_SLEEP_MS || 250);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(file, rows, headers) {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
}

function imageJsonPayload(imageMap, totalMaterials) {
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      source: "YES24 search",
      totalMaterials,
      found: Object.values(imageMap).filter((x) => x.status === "found").length,
      needsReview: Object.values(imageMap).filter((x) => x.status === "needs_review").length,
      notFound: Object.values(imageMap).filter((x) => x.status === "not_found").length,
      errors: Object.values(imageMap).filter((x) => x.status === "error").length,
    },
    images: imageMap,
  };
}

function saveImageJson(imageMap, totalMaterials) {
  fs.writeFileSync(JSON_OUT, JSON.stringify(imageJsonPayload(imageMap, totalMaterials), null, 2), "utf8");
}

function extractMasterData(html) {
  const match = html.match(
    /<script id="master-data" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match) throw new Error("master-data JSON not found in HTML");
  return JSON.parse(match[1]);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleForQuery(material) {
  return String(material.title || "")
    .replace(/\([^)]*단계[^)]*\)/g, " ")
    .replace(/시리즈\s*\d+\s*[~\-]\s*\d+\s*학년/g, " ")
    .replace(/\bseries\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function publisherForQuery(material) {
  const p = String(material.publisher || "");
  if (!p || p === "기존마스터후보") return "";
  if (p.includes("자이스토리")) return "자이스토리";
  return p;
}

function queryVariants(material) {
  const title = titleForQuery(material) || material.title || "";
  const pub = publisherForQuery(material);
  const series = material.series && material.series !== title ? material.series : "";
  return [
    [pub, title].filter(Boolean).join(" "),
    [title, "교재"].filter(Boolean).join(" "),
    [pub, series, material.skill].filter(Boolean).join(" "),
  ]
    .map((q) => q.replace(/\s+/g, " ").trim())
    .filter((q, i, arr) => q && arr.indexOf(q) === i);
}

function tokens(value) {
  return normalizeText(value)
    .split(" ")
    .filter((t) => t.length >= 2 || /[\p{Script=Hangul}]/u.test(t));
}

function scoreCandidate(material, candidate) {
  const wantedTitle = normalizeText(titleForQuery(material) || material.title);
  const wantedSeries = normalizeText(material.series || "");
  const wantedPub = normalizeText(publisherForQuery(material));
  const gotTitle = normalizeText(candidate.goodsName);
  const gotAuthor = normalizeText(candidate.goodsAuth);
  const gotAll = `${gotTitle} ${gotAuthor}`;
  let score = 0;
  if (wantedTitle && gotTitle.includes(wantedTitle)) score += 70;
  if (wantedTitle && wantedTitle.includes(gotTitle) && gotTitle.length > 5) score += 35;
  if (wantedSeries && gotTitle.includes(wantedSeries)) score += 18;
  if (wantedPub && gotAll.includes(wantedPub)) score += 14;
  for (const token of tokens(material.title)) {
    if (gotTitle.includes(token)) score += token.length >= 4 ? 7 : 4;
  }
  for (const token of tokens(material.series || "")) {
    if (gotTitle.includes(token)) score += 3;
  }
  if (/\bworkbook\b/i.test(candidate.goodsName)) score -= 8;
  if (/ebook|전자책/i.test(candidate.goodsName)) score -= 5;
  return score;
}

function parseYes24Candidates(html) {
  const candidates = [];
  const seen = new Set();
  const inputRegex = /<input\b[^>]*ORD_GOODS_OPT[^>]*>/gi;
  let match;
  while ((match = inputRegex.exec(html))) {
    try {
      const tag = match[0];
      const valueMatch = tag.match(/\bvalue=(["'])([\s\S]*?)\1/i);
      if (!valueMatch) continue;
      const json = JSON.parse(decodeEntities(valueMatch[2]));
      const goodsNo = String(json.goods_no || json.goodsNo || "").trim();
      if (!goodsNo || seen.has(goodsNo)) continue;
      seen.add(goodsNo);
      candidates.push({
        goodsNo,
        goodsName: String(json.goods_name || "").trim(),
        goodsAuth: decodeEntities(json.goodsAuth || "").replace(/<[^>]+>/g, "").trim(),
        sourcePage: `https://www.yes24.com/Product/Goods/${goodsNo}`,
        imageUrl: `https://image.yes24.com/goods/${goodsNo}/L`,
      });
    } catch {
      // Ignore malformed snippets.
    }
  }

  if (candidates.length) return candidates;

  const imageRegex = /image\.yes24\.com\/goods\/(\d+)\/L/gi;
  while ((match = imageRegex.exec(html))) {
    const goodsNo = match[1];
    if (seen.has(goodsNo)) continue;
    seen.add(goodsNo);
    candidates.push({
      goodsNo,
      goodsName: "",
      goodsAuth: "",
      sourcePage: `https://www.yes24.com/Product/Goods/${goodsNo}`,
      imageUrl: `https://image.yes24.com/goods/${goodsNo}/L`,
    });
  }
  return candidates;
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return await response.text();
}

async function downloadImage(url, outFile) {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      referer: "https://www.yes24.com/",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const type = response.headers.get("content-type") || "";
  if (!type.includes("image")) throw new Error(`not an image: ${type}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 1024) throw new Error("image too small");
  fs.writeFileSync(outFile, buffer);
  return { bytes: buffer.length, contentType: type };
}

function existingImageMap() {
  if (!fs.existsSync(JSON_OUT)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(JSON_OUT, "utf8"));
    return data.images || {};
  } catch {
    return {};
  }
}

async function findCover(material) {
  const allCandidates = [];
  for (const query of queryVariants(material)) {
    const url = `https://www.yes24.com/Product/Search?domain=ALL&query=${encodeURIComponent(query)}`;
    const html = await fetchText(url);
    const candidates = parseYes24Candidates(html).map((candidate) => ({
      ...candidate,
      query,
      score: scoreCandidate(material, candidate),
    }));
    allCandidates.push(...candidates);
    const strong = candidates.find((candidate) => candidate.score >= 55);
    if (strong) break;
    await sleep(SLEEP_MS);
  }

  const best = allCandidates.sort((a, b) => b.score - a.score)[0];
  return { best, candidates: allCandidates.slice(0, 5) };
}

async function main() {
  ensureDir(OUT_DIR);
  ensureDir(COVER_DIR);
  const html = fs.readFileSync(SOURCE_HTML, "utf8");
  const data = extractMasterData(html);
  const existing = existingImageMap();
  const materials = data.materials.slice(START, LIMIT ? START + LIMIT : undefined);
  const imageMap = { ...existing };
  const manifestRows = [];
  const candidateRows = [];

  for (let index = 0; index < materials.length; index += 1) {
    const material = materials[index];
    const uid = material.materialUid || material.uid;
    if (material.domain && material.domain !== "영어") continue; // 영어 교재만 수집
    const coverRel = `covers/${uid}.jpg`;
    const coverFile = path.join(COVER_DIR, `${uid}.jpg`);
    const progress = `${START + index + 1}/${data.materials.length}`;
    if (!FORCE && fs.existsSync(coverFile)) {
      imageMap[uid] = {
        ...(imageMap[uid] || {}),
        status: "found",
        localPath: coverRel,
        materialTitle: material.title,
        publisher: material.publisher,
      };
      console.log(`[${progress}] skip existing ${uid} ${material.title}`);
      saveImageJson(imageMap, data.materials.length);
      continue;
    }

    try {
      const { best, candidates } = await findCover(material);
      for (const candidate of candidates) {
        candidateRows.push({
          materialUid: uid,
          publisher: material.publisher,
          title: material.title,
          query: candidate.query,
          score: candidate.score,
          goodsNo: candidate.goodsNo,
          goodsName: candidate.goodsName,
          goodsAuth: candidate.goodsAuth,
          imageUrl: candidate.imageUrl,
          sourcePage: candidate.sourcePage,
        });
      }

      if (!best) {
        imageMap[uid] = {
          status: "not_found",
          materialTitle: material.title,
          publisher: material.publisher,
          searchQuery: queryVariants(material)[0] || material.title,
        };
        console.log(`[${progress}] not found ${uid} ${material.title}`);
        saveImageJson(imageMap, data.materials.length);
        continue;
      }

      const review = best.score < 60;
      const downloaded = await downloadImage(best.imageUrl, coverFile);
      imageMap[uid] = {
        status: review ? "needs_review" : "found",
        localPath: coverRel,
        imageUrl: best.imageUrl,
        sourcePage: best.sourcePage,
        source: "YES24",
        sourceTitle: best.goodsName,
        sourceAuthor: best.goodsAuth,
        score: best.score,
        bytes: downloaded.bytes,
        contentType: downloaded.contentType,
        materialTitle: material.title,
        publisher: material.publisher,
        searchQuery: best.query,
      };
      console.log(
        `[${progress}] ${review ? "review" : "found "} ${uid} score=${best.score} ${material.title} -> ${best.goodsName}`
      );
      saveImageJson(imageMap, data.materials.length);
    } catch (error) {
      imageMap[uid] = {
        status: "error",
        materialTitle: material.title,
        publisher: material.publisher,
        searchQuery: queryVariants(material)[0] || material.title,
        error: error.message,
      };
      console.log(`[${progress}] error ${uid} ${material.title}: ${error.message}`);
      saveImageJson(imageMap, data.materials.length);
    }
    await sleep(SLEEP_MS);
  }

  for (const material of data.materials) {
    const uid = material.materialUid || material.uid;
    const item = imageMap[uid] || {};
    manifestRows.push({
      materialUid: uid,
      publisher: material.publisher,
      title: material.title,
      series: material.series || "",
      skill: material.skill || "",
      grade: material.grade || "",
      status: item.status || "pending",
      localPath: item.localPath || "",
      imageUrl: item.imageUrl || "",
      sourcePage: item.sourcePage || "",
      sourceTitle: item.sourceTitle || "",
      score: item.score ?? "",
      note: item.error || "",
    });
  }

  saveImageJson(imageMap, data.materials.length);
  writeCsv(CSV_OUT, manifestRows, [
    "materialUid",
    "publisher",
    "title",
    "series",
    "skill",
    "grade",
    "status",
    "localPath",
    "imageUrl",
    "sourcePage",
    "sourceTitle",
    "score",
    "note",
  ]);
  writeCsv(CANDIDATES_OUT, candidateRows, [
    "materialUid",
    "publisher",
    "title",
    "query",
    "score",
    "goodsNo",
    "goodsName",
    "goodsAuth",
    "imageUrl",
    "sourcePage",
  ]);
  console.log(`\nSaved ${JSON_OUT}`);
  console.log(`Saved ${CSV_OUT}`);
  console.log(`Saved ${CANDIDATES_OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
