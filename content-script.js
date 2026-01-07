// ===============================
// STATE CENTRALE
// ===============================
const state = {
  db: null,
  lang: null,
  english: {
    title: null,
    body: null
  },
  italian: {
    title: null,
    body: null
  }
};

// ===============================
// Caricamento database.json
// ===============================

(async () => {
  try {
    const url = browser.runtime.getURL("database.json");
    state.db = await fetch(url).then(r => r.json());
    console.log("Database caricato:", state.db);
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
  const MAX = 75;
  return text.split("\n").map(line => {
    // separa indentazione iniziale dal resto
    const m = line.match(/^(\s*)(.*)$/);
    const indent = m ? m[1] : "";
    let rest = m ? m[2] : line;

    // calcola larghezza utile per il testo
    const usable = Math.max(10, MAX - indent.length);

    // spezza il testo in pezzi di lunghezza usable
    const parts = rest.match(new RegExp(".{1," + usable + "}(?:\\s+|$)", "g")) || [rest];

    // rimuove spazi finali da ogni parte e riapplica indentazione
    return parts.map(p => indent + p.replace(/\s+$/,"")).join("\n");
  }).join("\n");
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
// Rileva la lingua dall'URL (min 2, max 5 caratteri)
// ===============================
function detectLanguageFromURL() {
  const match = window.location.href.match(/index\.cgi\/([A-Za-z_]{2,5})\//);
  return match ? match[1] : "en";
}


// ===============================
// Generazione HTML del diff
// ===============================
function generateDiffHTML(oldText, newText) {
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

  const oldHTML =
    oldText.slice(0, start) +
    `<span style="background:#ffebee; color:#b71c1c;">${oldDiff}</span>` +
    oldText.slice(endOld + 1);

  const newHTML =
    newText.slice(0, start) +
    `<span style="background:#e8f5e9; color:#1b5e20;">${newDiff}</span>` +
    newText.slice(endNew + 1);

  return `
    <div>- ${oldHTML}</div>
    <div>+ ${newHTML}</div>
  `;
}


// ===============================
// Motore di suggerimento
// ===============================
function getSuggestion(englishRaw) {
  if (!state.db) return null;

  state.lang = detectLanguageFromURL();

  // Normalizza l'inglese dalla pagina
  const english = englishRaw.replace(/\s*\n\s*/g, " ").trim();

  for (const entry of state.db.patterns) {
    if (!entry || !entry.english || !entry.translations) continue;

    const entryEng = entry.english;

    // Trova placeholder
    const placeholders = [...entryEng.matchAll(/\{(\w+)\}/g)].map(m => m[1]);

    let pattern = escapeRegex(entryEng);

    // Placeholder multi-parola
    for (const ph of placeholders) {
      pattern = pattern.replace("\\{" + ph + "\\}", "(.+?)");
    }

    const regex = new RegExp("^" + pattern + "$");
    const match = english.match(regex);

    if (!match) continue;

    let trad = entry.translations[state.lang];

    placeholders.forEach((ph, i) => {
      let value = match[i + 1].trim();

      // Traduzione tramite mappa globale
      if (state.db.globals && state.db.globals[ph] && state.db.globals[ph][value]) {
        value = state.db.globals[ph][value];
      }

      trad = trad.replace("{" + ph + "}", value);
    });

    return trad;
  }

  return null;
}


// ===============================
// Genera l'HTML dei suggerimenti da mostrare nel pannello
// ===============================
function generateSuggestionsHTML() {
  let output = "";

  if (state.english.title && state.italian.title &&
      state.english.body && state.italian.body) {
    const ita = state.italian.title.value.trim();
    const eng = state.english.title;
    const englishParagraphs = state.english.body
      .split(/\n\.\n/)
      .map(p => p.trim());
    const italianParagraphs = state.italian.body.value
      .split(/\n\.\n/)
      .map(p => p.trim());

    // aggiunge titolo all'inizio degli array di paragrafi
    englishParagraphs.unshift(eng)
    italianParagraphs.unshift(ita)

    for (let i = 0; i < englishParagraphs.length; i++) {
      let button_class = ""
      if (i == 0) {
        output += `<div class="ddtss-section-title">Titolo</div>`;
        button_class = "apply-title";
      } else if (i == 1) {
        output += `<div class="ddtss-section-title">Body</div>`;
        button_class = "apply-suggestion";
      } else {
        button_class = "apply-suggestion";
      }

      const eng = englishParagraphs[i];
      const ita = italianParagraphs[i] || "";
      const suggestion = getSuggestion(englishParagraphs[i]);

      output += `<div class="ddtss-box">`;

      if (i >= 1) {
        output += `<div class="ddtss-box-paragraph-title">Paragrafo ${i}</div>`;

      // Controllo righe >75
      const longLinesITA = ita
          .split("\n")
          .filter(line => line.length > 75);

      if (longLinesITA.length > 0) {
        output +=
          `  Attenzione: alcune righe superano i 75 caratteri.\n` +
          `  <button class="ddtss-btn apply-wrap-ita" data-index="${i}">Applica wrap al paragrafo</button>\n\n`;
        }
      }

      if (!suggestion) {
        output +=
          `<div class="ddtss-box-text">` +
          `   Nessun suggerimento trovato</div></div>`;
        continue;
      }

      if (ita.includes("<trans>")) {
        output +=
          `<div class="ddtss-box">` +
          `<div class="ddtss-box-text">` +
          `<strong>Suggerimento:</strong>\n${suggestion}</div>` +
          `<button class="ddtss-btn ${button_class}" data-index="${i}" data-suggestion="${encodeURIComponent(suggestion)}">Applica suggerimento</button>\n` +
          `</div></div>`;
        continue;
      }

      const itaNorm = normalizeForComparison(ita);
      const suggNorm = suggestion;
      const sim = similarity(itaNorm, suggNorm);

      if (sim === 100) {
        output +=
          `<div class="ddtss-box-text">` +
          `   Traduzione corretta</div></div>`;
      } else {
        const diff = generateDiffHTML(itaNorm, suggNorm);

        output +=
          `<div class="ddtss-box">` +
          `<div class="ddtss-box-text">` +
          `<strong>Similarità:</strong> ${sim}%</div>` +
          `<div class="ddtss-box-text">` +
          `<strong>Suggerimento</strong>\n` +
          `${suggestion}</div>` +
          `<strong>Diff</strong>\n` +
          `${diff}\n` +
          `<button class="ddtss-btn ${button_class}" data-index="${i}" data-suggestion="${encodeURIComponent(suggestion)}">Applica suggerimento</button>\n` +
          `</div></div>`;
      }
    }
  }
  return output;
}


// ===============================
// Pannello laterale
// ===============================
function createSidePanel() {
  if (document.getElementById("ddtss-sidepanel")) return;

  const panel = document.createElement("div");

  panel.id = "ddtss-sidepanel";

  panel.innerHTML = `
    <div id="ddtss-tab">⟨</div>

    <div id="ddtss-sidepanel-header">
      <h2>Suggerimenti</h2>
      <div id="ddtss-sidepanel-buttons">
        <button id="ddtss-refresh" title="Aggiorna">↻</button>
        <button id="ddtss-close" title="Chiudi">✖</button>
      </div>
    </div>

    <div id="ddtss-content"></div>
  `;

  document.body.appendChild(panel);

  document.getElementById("ddtss-close").addEventListener("click", () => {
    panel.style.right = "-450px";
  });

  document.getElementById("ddtss-tab").addEventListener("click", () => {
    toggleSidePanel();
  });
}

function openSidePanel() {
  refreshSidePanel()
  document.getElementById("ddtss-sidepanel").style.right = "0";
}


function refreshSidePanel() {
  const panel = document.getElementById("ddtss-sidepanel");

  if (!panel) { return }

  const content = document.getElementById("ddtss-content");
  const output = generateSuggestionsHTML();
  content.innerHTML = output;
}


function toggleSidePanel() {
  const panel = document.getElementById("ddtss-sidepanel");

  // Se è aperto → chiudi
  if (panel && getComputedStyle(panel).right === "0px") {
    panel.style.right = "-450px";
    return;
  }

  openSidePanel();
}



// ===============================
// Estrazione campi dal DDTSS
// ===============================
function extractDDTSSFields() {
  const allTT = [...document.querySelectorAll("tt")];

  state.english.title =
    allTT.length ? allTT[allTT.length - 1].innerText.trim() : null;

  state.italian.title = document.querySelector("input[name='short']");

  const engBodyEl = document.querySelector("li pre");
  state.english.body = engBodyEl ? engBodyEl.innerText : null;
  if (state.english.body) {
    state.english.body = removeOneLeadingSpace(state.english.body).trim();
  }

  state.italian.body = document.querySelector("textarea[name='long']");
}

// estrazione iniziale
extractDDTSSFields();

// ===============================
// Funzione per applicare modifiche al DDTSS
// ===============================
function applyDDTSSChange(element, newValue) {
  if (!element) return;

  element.value = newValue;

  // Eventi che DDTSS si aspetta
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));

  // Solo textarea richiede keyup
  if (element.tagName.toLowerCase() === "textarea") {
    element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  }

  // Fondamentale: forza il confronto interno
  element.dispatchEvent(new Event("blur", { bubbles: true }));
}


// ===============================
// Event listener per "Applica suggerimento" (corpo)
// ===============================
document.addEventListener("click", (e) => {
  if (!e.target.classList.contains("apply-suggestion")) return;

  const index = parseInt(e.target.dataset.index, 10) - 1;
  const suggestion = decodeURIComponent(e.target.dataset.suggestion);
  const paragraphs = state.italian.body.value.split(/\n\.\n/);

  paragraphs[index] = wrap75(suggestion);

  applyDDTSSChange(state.italian.body, paragraphs.join("\n.\n"));
  refreshSidePanel();

});

// ===============================
// Event listener per "Applica wrap" sul testo italiano
// ===============================
document.addEventListener("click", (e) => {
  if (!e.target.classList.contains("apply-wrap-ita")) return;

  const index = parseInt(e.target.dataset.index, 10) - 1;

  const paragraphs = state.italian.body.value.split(/\n\.\n/);
  paragraphs[index] = wrap75(paragraphs[index]);

  applyDDTSSChange(state.italian.body, paragraphs.join("\n.\n"));
  refreshSidePanel();

});


// ===============================
// Event listener per "Applica suggerimento" (titolo)
// ===============================
document.addEventListener("click", (e) => {
  if (!e.target.classList.contains("apply-title")) return;

  const suggestion = decodeURIComponent(e.target.dataset.suggestion);

  applyDDTSSChange(state.italian.title, suggestion);
  refreshSidePanel();

});

document.addEventListener("click", (e) => {
  if (e.target.id === "ddtss-refresh") {
    refreshSidePanel();
  }
});

// ===============================
// Inizializzazione pannello
// ===============================
if (
  state.english.body ||
  state.italian.body ||
  state.english.title ||
  state.italian.title
) {
  createSidePanel();
}

