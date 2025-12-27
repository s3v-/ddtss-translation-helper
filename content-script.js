// ===============================
// Caricamento database.json
// ===============================
let db = null;

(async () => {
  try {
    const url = browser.runtime.getURL("database.json");
    db = await fetch(url).then(r => r.json());
    console.log("Database caricato:", db);
  } catch (err) {
    console.error("Errore nel caricamento del database:", err);
  }
})();


// ===============================
// Similarità (Levenshtein)
// ===============================
function similarity(a, b) {
  if (!a || !b) return 0;

  const matrix = [];
  const alen = a.length;
  const blen = b.length;

  for (let i = 0; i <= blen; i++) matrix[i] = [i];
  for (let j = 0; j <= alen; j++) matrix[0][j] = j;

  for (let i = 1; i <= blen; i++) {
    for (let j = 1; j <= alen; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  const distance = matrix[blen][alen];
  const maxLen = Math.max(alen, blen);
  return Math.round((1 - distance / maxLen) * 100);
}


// ===============================
// Normalizzazione SOLO del testo italiano
// ===============================
function normalizeForComparison(text) {
  return text.replace(/\s*\n\s*/g, " ").trim();
}


// ===============================
// wrap75 — spezza il testo ogni 75 caratteri
// ===============================
function wrap75(text) {
  return text.replace(/(.{1,75})(\s+|$)/g, "$1\n").trim();
}


// ===============================
// Rimuove SOLO UNO spazio iniziale per riga
// ===============================
function removeOneLeadingSpace(text) {
  return text.replace(/^ /gm, "");
}


// ===============================
// Escape regex
// ===============================
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


// ===============================
// Diff per linea con highlight interno
// ===============================
function generateLineDiffWithHighlight(oldText, newText) {
  let start = 0;
  let endOld = oldText.length - 1;
  let endNew = newText.length - 1;

  // Trova inizio differenza
  while (start < oldText.length &&
         start < newText.length &&
         oldText[start] === newText[start]) {
    start++;
  }

  // Trova fine differenza
  while (endOld >= start &&
         endNew >= start &&
         oldText[endOld] === newText[endNew]) {
    endOld--;
    endNew--;
  }

  const oldDiff = oldText.slice(start, endOld + 1);
  const newDiff = newText.slice(start, endNew + 1);

  const oldHighlighted =
    oldText.slice(0, start) +
    `%c${oldDiff}%c` +
    oldText.slice(endOld + 1);

  const newHighlighted =
    newText.slice(0, start) +
    `%c${newDiff}%c` +
    newText.slice(endNew + 1);

  return (
    `- ${oldHighlighted}\n` +
    `+ ${newHighlighted}`
  );
}


// ===============================
// Motore di suggerimento 3.0-dev.7
// ===============================
function getSuggestion(englishRaw) {
  if (!db) return null;

  // Normalizza l'inglese dalla pagina
  const english = englishRaw.replace(/\s*\n\s*/g, " ").trim();

  for (const entry of db) {
    if (!entry || !entry.english || !entry.traduzione) continue;

    const entryEng = entry.english;

    // Placeholder {arch}
    if (entryEng.includes("{arch}")) {
      let pattern = escapeRegex(entryEng);
	  pattern = pattern.replace("\\{arch\\}", "(\\S+)");

      const regex = new RegExp("^" + pattern + "$");
      const match = english.match(regex);

      if (match) {
        const arch = match[1];

        if (arch == "host")
		  return entry.traduzione.replace("{arch}", "ospite");
	    else if (arch == "build")
          return entry.traduzione.replace("{arch}", "di compilazione");
        else
          return entry.traduzione.replace("{arch}", arch);
      }
    }

    // Match esatto
    if (entryEng === english) {
      return entry.traduzione;
    }
  }

  return null;
}


// ===============================
// Pannello laterale
// ===============================
function createSidePanel() {
  if (document.getElementById("ddtss-sidepanel")) return;

  const panel = document.createElement("div");
  panel.id = "ddtss-sidepanel";
  panel.style.position = "fixed";
  panel.style.top = "0";
  panel.style.right = "-450px";
  panel.style.width = "450px";
  panel.style.height = "100%";
  panel.style.background = "#f8f9fa";
  panel.style.borderLeft = "2px solid #ccc";
  panel.style.boxShadow = "-2px 0 6px rgba(0,0,0,0.2)";
  panel.style.padding = "10px";
  panel.style.transition = "right 0.3s ease";
  panel.style.zIndex = "999999";

  panel.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <h2 style="margin:0; font-size:18px;">Suggerimenti</h2>
      <button id="ddtss-close" style="font-size:16px; cursor:pointer;">✖</button>
    </div>
    <div id="ddtss-content" style="margin-top:10px; white-space:pre-wrap; font-family:monospace;"></div>
  `;

  document.body.appendChild(panel);

  document.getElementById("ddtss-close").addEventListener("click", () => {
    panel.style.right = "-450px";
  });
}

function openSidePanel(text) {
  createSidePanel();

  const content = document.getElementById("ddtss-content");
  content.innerHTML = "";

  const lines = text.split("\n");
  let html = "";

  for (let line of lines) {
    // Determina se la riga è - o +
    const isOld = line.startsWith("- ");
    const isNew = line.startsWith("+ ");

    // Split per highlight interno
    const parts = line.split("%c");
    let out = "";
    let toggle = false;

    for (const p of parts) {
      if (toggle) {
        // highlight interno
        if (isOld) {
          out += `<span style="background:#ffe5e5; color:#b30000;">${p}</span>`;
        } else if (isNew) {
          out += `<span style="background:#e5ffe5; color:#006600;">${p}</span>`;
        } else {
          out += p;
        }
      } else {
        out += p;
      }
      toggle = !toggle;
    }

    html += out + "\n";
  }

  content.innerHTML = html;
  document.getElementById("ddtss-sidepanel").style.right = "0";
}


// ===============================
// Estrazione campi dal DDTSS
// ===============================
const allTT = [...document.querySelectorAll("tt")];
const englishTitle = allTT.length ? allTT[allTT.length - 1].innerText.trim() : null;

const italianTitle = document.querySelector("input[name='short']");
const englishBodyElement = document.querySelector("li pre");

let englishBody = englishBodyElement ? englishBodyElement.innerText : null;
if (englishBody) englishBody = removeOneLeadingSpace(englishBody).trim();

const italianBodyElement = document.querySelector("textarea[name='long']");


// ===============================
// Bottone: Suggerisci titolo
// ===============================
if (englishTitle && italianTitle) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Suggerisci titolo";
  btn.style.marginLeft = "6px";
  italianTitle.insertAdjacentElement("afterend", btn);

  btn.addEventListener("click", () => {
    const italian = getSuggestion(englishTitle);

    if (!italian) {
      openSidePanel("Nessun suggerimento trovato nel database.");
      return;
    }

    if (italianTitle.value.includes("<trans>")) {
      openSidePanel("Suggerimento titolo:\n\n" + italian);
      return;
    }

    const itaNorm = normalizeForComparison(italianTitle.value.trim());
    const suggNorm = italian;

    const sim = similarity(itaNorm, suggNorm);

    if (sim === 100) {
      openSidePanel("Traduzione corretta.");
    } else {
      const diff = generateLineDiffWithHighlight(itaNorm, suggNorm);

      openSidePanel(
        "Suggerimento titolo:\n\n" +
        italian +
        "\n\nSimilarità: " + sim + "%\n\nDiff:\n" + diff +
        `\n\n<button class="apply-title" data-suggestion="${encodeURIComponent(italian)}">Applica suggerimento</button>`
      );
    }
  });
}


// ===============================
// Bottone: Suggerisci testo (corpo)
// ===============================
if (englishBody && italianBodyElement) {

  const btnBody = document.createElement("button");
  btnBody.type = "button";
  btnBody.textContent = "Suggerisci testo";
  btnBody.style.marginLeft = "6px";
  italianBodyElement.insertAdjacentElement("afterend", btnBody);

  btnBody.addEventListener("click", () => {

    const currentItalianBody = italianBodyElement.value;

    const englishParagraphs = englishBody
      .split(/\n\.\n/)
      .map(p => p.trim());

    const italianParagraphs = currentItalianBody
      .split(/\n\.\n/)
      .map(p => p.trim());

    let output = "";

    for (let i = 0; i < englishParagraphs.length; i++) {
      const eng = englishParagraphs[i];
      const ita = italianParagraphs[i] || "";
      const suggestion = getSuggestion(eng);

      output += `Paragrafo ${i + 1}:\n`;

      if (!suggestion) {
        output += "  Nessun suggerimento trovato.\n\n";
        continue;
      }

      if (ita.includes("<trans>")) {
        output += `  Suggerimento:\n  ${suggestion}\n\n`;
        continue;
      }

      const itaNorm = normalizeForComparison(ita);
      const suggNorm = suggestion;

      const sim = similarity(itaNorm, suggNorm);

      if (sim === 100) {
        output += "  Traduzione corretta.\n\n";
      } else {
        const diff = generateLineDiffWithHighlight(itaNorm, suggNorm);

        output +=
          `  Suggerimento:\n  ${suggestion}\n` +
          `  Similarità: ${sim}%\n\n` +
          `Diff:\n${diff}\n\n` +
          `<button class="apply-suggestion" data-index="${i}" data-suggestion="${encodeURIComponent(suggestion)}">Applica suggerimento</button>\n\n`;
      }
    }

    openSidePanel(output);
  });
}


// ===============================
// Event listener per "Applica suggerimento" (corpo)
// ===============================
document.addEventListener("click", (e) => {
  if (!e.target.classList.contains("apply-suggestion")) return;

  const index = parseInt(e.target.dataset.index, 10);
  const suggestion = decodeURIComponent(e.target.dataset.suggestion);

  const paragraphs = italianBodyElement.value.split(/\n\.\n/);
  paragraphs[index] = wrap75(suggestion);

  italianBodyElement.value = paragraphs.join("\n.\n");

  const btn = [...document.querySelectorAll("button")]
    .find(b => b.textContent === "Suggerisci testo");

  if (btn) btn.click();
});


// ===============================
// Event listener per "Applica suggerimento" (titolo)
// ===============================
document.addEventListener("click", (e) => {
  if (!e.target.classList.contains("apply-title")) return;

  const suggestion = decodeURIComponent(e.target.dataset.suggestion);

  italianTitle.value = suggestion;

  const btn = [...document.querySelectorAll("button")]
    .find(b => b.textContent === "Suggerisci titolo");

  if (btn) btn.click();
});