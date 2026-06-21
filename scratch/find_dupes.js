import fs from 'fs'
import path from 'path'

const rootDir = 'lists'
const results = []

// Simple Levenshtein distance
function levenshtein(a, b) {
  const tmp = []
  let i, j, alen = a.length, blen = b.length
  if (alen === 0) return blen
  if (blen === 0) return alen
  for (i = 0; i <= alen; i++) tmp[i] = [i]
  for (j = 0; j <= blen; j++) tmp[0][j] = j
  for (i = 1; i <= alen; i++) {
    for (j = 1; j <= blen; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1,
        tmp[i][j - 1] + 1,
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
  }
  return tmp[alen][blen]
}

// Regional / Spelling variation mappings
const spellingVariants = [
  [/([a-z]+)or$/g, '$1our'], // color -> colour, behavior -> behaviour
  [/gray/g, 'grey'],
  [/aluminum/g, 'aluminium'],
  [/sulfur/g, 'sulphur'],
  [/cozy/g, 'cosy'],
  [/([a-z]+)ize$/g, '$1ise'], // organize -> organise
  [/([a-z]+)y$/g, '$1ies'], // cherry -> cherries (singular/plural)
]

function normalizeSpelling(word) {
  let w = word.toLowerCase();
  for (const [pattern, replacement] of spellingVariants) {
    w = w.replace(pattern, replacement);
  }
  return w;
}

function normalizePunctuationAndSpaces(word) {
  return word
    .normalize("NFD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, '');
}

function normalizePlural(word) {
  let w = word.toLowerCase();
  if (w.endsWith('ies')) {
    return w.slice(0, -3) + 'y';
  }
  if (w.endsWith('ves')) {
    return w.slice(0, -3) + 'f'; // wolves -> wolf
  }
  if (w.endsWith('es')) {
    if (w.endsWith('boxes') || w.endsWith('foxes') || w.endsWith('glasses') || w.endsWith('brushes') || w.endsWith('matches')) {
      return w.slice(0, -2);
    }
  }
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is') && !w.endsWith('as')) {
    return w.slice(0, -1);
  }
  return w;
}

function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  const sections = content.split('---')
  if (sections.length < 3) return

  const list = sections[2]
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)

  const normalizedMap = new Map() // norm -> original
  const dupes = []

  for (let i = 0; i < list.length; i++) {
    const wordA = list[i]
    
    // Check for exact duplicates (should be done by sanitise but good to check)
    for (let j = i + 1; j < list.length; j++) {
      const wordB = list[j]
      if (wordA === wordB) {
        dupes.push({ type: 'Exact Duplicate', a: wordA, b: wordB })
        continue
      }

      // 1. Casing/accent differences (should be lowercase, but check)
      if (wordA.toLowerCase() === wordB.toLowerCase()) {
        dupes.push({ type: 'Case Variant', a: wordA, b: wordB })
        continue
      }

      // 2. Accent differences (e.g. cafe vs café)
      const aNoAcc = wordA.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      const bNoAcc = wordB.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      if (aNoAcc === bNoAcc) {
        dupes.push({ type: 'Accent Variant', a: wordA, b: wordB })
        continue
      }

      // 3. Punctuation/whitespace/hyphen difference
      const cleanA = normalizePunctuationAndSpaces(wordA)
      const cleanB = normalizePunctuationAndSpaces(wordB)
      if (cleanA === cleanB) {
        dupes.push({ type: 'Punctuation/Space Variant', a: wordA, b: wordB })
        continue
      }

      // 4. Singular / Plural duplicate
      const plurA = normalizePlural(wordA)
      const plurB = normalizePlural(wordB)
      if (plurA === plurB) {
        dupes.push({ type: 'Singular/Plural Variant', a: wordA, b: wordB })
        continue
      }

      // 5. Spelling variations (US vs UK)
      const spellA = normalizeSpelling(wordA)
      const spellB = normalizeSpelling(wordB)
      if (spellA === spellB) {
        dupes.push({ type: 'Spelling Variant (US/UK)', a: wordA, b: wordB })
        continue
      }

      // 6. Very similar or semantic (e.g., Levenshtein distance of 1-2, or containing each other)
      // Only flag if words are long enough to avoid false positives (e.g. 'cat' vs 'bat' is different)
      if (wordA.length > 4 && wordB.length > 4) {
        const dist = levenshtein(wordA, wordB)
        if (dist === 1) {
          dupes.push({ type: 'Levenshtein-1 Similarity', a: wordA, b: wordB })
        }
      }
    }
  }

  if (dupes.length > 0) {
    results.push({
      file: filePath,
      dupes: dupes
    })
  }
}

function processDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      processDir(fullPath)
    } else if (entry.isFile() && entry.name.endsWith('.yml')) {
      analyzeFile(fullPath)
    }
  }
}

processDir(rootDir)

fs.writeFileSync(
  path.join(import.meta.dirname || 'scratch', 'results.json'),
  JSON.stringify(results, null, 2),
  'utf8'
);

console.log(JSON.stringify(results, null, 2))
