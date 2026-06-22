const fs = require('fs');

// Read HTML file directly
let htmlStr = fs.readFileSync('C:\\Users\\이인혁\\Downloads\\교재\\data\\iinhyuk_english_book_guide_v0.9_expanded.html', 'utf8');

// Find JSON array in HTML
const startPattern = '[{"uid"';
const startIdx = htmlStr.indexOf(startPattern);

if (startIdx < 0) {
  console.error('JSON array not found');
  process.exit(1);
}

// Extract from start and find valid JSON end
let jsonStr = htmlStr.substring(startIdx);

// Find the properly closed JSON array
let bracketDepth = 0;
let braceDepth = 0;
let inString = false;
let escapeNext = false;
let endIdx = -1;

for (let i = 0; i < jsonStr.length; i++) {
  const char = jsonStr[i];
  
  if (escapeNext) {
    escapeNext = false;
    continue;
  }
  
  if (char === '\\' && inString) {
    escapeNext = true;
    continue;
  }
  
  if (char === '"') {
    inString = !inString;
    continue;
  }
  
  if (!inString) {
    if (char === '[') bracketDepth++;
    else if (char === ']') {
      bracketDepth--;
      if (bracketDepth === 0) {
        endIdx = i + 1;
        break;
      }
    }
    else if (char === '{') braceDepth++;
    else if (char === '}') braceDepth--;
  }
}

if (endIdx <= 0) {
  console.error('Could not find JSON end');
  process.exit(1);
}

jsonStr = jsonStr.substring(0, endIdx);

let data;
try {
  data = JSON.parse(jsonStr);
} catch (e) {
  console.error('JSON parse error:', e.message);
  process.exit(1);
}

console.error(`Total items: ${data.length}`);

const pattern = /목적에 적합.*보강\.$/;
const results = [];

data.forEach(item => {
  if (item.domain === '영어' && item.pickComment && pattern.test(item.pickComment)) {
    results.push({
      uid: item.materialUid || "",
      title: item.title || "",
      publisher: item.publisher || "",
      skill: item.skill || "",
      grade: item.grade || ""
    });
  }
});

console.error(`Matched items: ${results.length}`);
const limited = results.slice(0, 400);
console.log(JSON.stringify(limited));