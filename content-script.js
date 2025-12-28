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

    // Trova tutti i placeholder nel database: {arch}, {compiler}, ecc.
    const placeholders = [...entryEng.matchAll(/\{(\w+)\}/g)].map(m => m[1]);

    if (placeholders.length > 0) {
      // Costruisci regex sostituendo ogni placeholder con (\S+)
      let pattern = escapeRegex(entryEng);
      for (const ph of placeholders) {
        pattern = pattern.replace("\\{" + ph + "\\}", "(\\S+)");
      }

      const regex = new RegExp("^" + pattern + "$");
      const match = english.match(regex);

      if (match) {
        let trad = entry.traduzione;

        placeholders.forEach((ph, i) => {
          let value = match[i + 1];

          // Eccezioni semantiche per {arch}
          if (ph === "arch") {
            if (value === "host") value = "ospite";
            else if (value === "build") value = "di compilazione";
          }

          trad = trad.replace("{" + ph + "}", value);
        });

        return trad;
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

function refreshSidePanel() {
  const panel = document.getElementById("ddtss-sidepanel");
  if (panel) {
    // Forza la chiusura
    panel.style.right = "-450px";
  }
  // E poi riapre con contenuto aggiornato
  toggleSidePanel();
}

function updateSidePanel() {
  // Ricostruisce il contenuto SENZA chiudere il pannello
  const panel = document.getElementById("ddtss-sidepanel");
  if (!panel) return;

  // Rigenera il contenuto
  let output = "";
  // Riutilizza la logica di toggleSidePanel, ma senza chiudere
  toggleSidePanel(); // chiude
  toggleSidePanel(); // riapre aggiornato
}


function toggleSidePanel() {
  console.log("toggleSidePanel() eseguito");

  const panel = document.getElementById("ddtss-sidepanel");

  // Se è aperto → chiudi
  if (panel && panel.style.right === "0px") {
    panel.style.right = "-450px";
    return;
  }

  createSidePanel();

  let output = "";

  // ===============================
  // SUGGERIMENTO TITOLO
  // ===============================
  if (englishTitle && italianTitle) {
    const ita = italianTitle.value.trim();
    const eng = englishTitle;
    const suggestion = getSuggestion(eng);

    output += "<div class='ddtss-section-title'>Titolo</div>";

    if (!suggestion) {
      output += "Nessun suggerimento trovato.\n\n";
    } else if (ita.includes("<trans>")) {
      output += `Suggerimento:\n${suggestion}\n\n`;
    } else {
      const itaNorm = normalizeForComparison(ita);
      const suggNorm = suggestion;
      const sim = similarity(itaNorm, suggNorm);

      if (sim === 100) {
        output += "Traduzione corretta.\n\n";
      } else {
        const diff = generateLineDiffWithHighlight(itaNorm, suggNorm);

        output +=
          `Suggerimento:\n${suggestion}\n` +
          `Similarità: ${sim}%\n\n` +
          `Diff:\n${diff}\n\n` +
          `<button class="apply-title" data-suggestion="${encodeURIComponent(suggestion)}">Applica suggerimento</button>\n\n`;
      }
    }
  }

  // ===============================
  // SUGGERIMENTI TESTO (CORPO)
  // ===============================
  if (englishBody && italianBodyElement) {
    const englishParagraphs = englishBody
      .split(/\n\.\n/)
      .map(p => p.trim());

    const italianParagraphs = italianBodyElement.value
      .split(/\n\.\n/)
      .map(p => p.trim());

    output += "<div class='ddtss-section-text'>Testo</div>";

    for (let i = 0; i < englishParagraphs.length; i++) {
      const eng = englishParagraphs[i];
      const ita = italianParagraphs[i] || "";
      const suggestion = getSuggestion(eng);

      output += `Paragrafo ${i + 1}:\n`;

      // Controllo righe >75
      const longLinesITA = ita
        .split("\n")
        .filter(line => line.length > 75);

      if (longLinesITA.length > 0) {
        output +=
          `  Attenzione: alcune righe superano i 75 caratteri.\n` +
          `  <button class="apply-wrap-ita" data-index="${i}">Applica wrap al paragrafo</button>\n\n`;
      }

      if (!suggestion) {
        output += "  Nessun suggerimento trovato.\n";
        continue;
      }

      if (ita.includes("<trans>")) {
        output += `  Suggerimento:\n  ${suggestion}\n`;
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
          `<button class="apply-suggestion" data-index="${i}" data-suggestion="${encodeURIComponent(suggestion)}">Applica suggerimento</button>\n`;
      }
    }
  }

  openSidePanel(output);
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

  const index = parseInt(e.target.dataset.index, 10);
  const suggestion = decodeURIComponent(e.target.dataset.suggestion);

  const paragraphs = italianBodyElement.value.split(/\n\.\n/);
  paragraphs[index] = wrap75(suggestion);

  applyDDTSSChange(italianBodyElement, paragraphs.join("\n.\n"));
  refreshSidePanel();

});

// ===============================
// Event listener per "Applica wrap" sul testo italiano
// ===============================
document.addEventListener("click", (e) => {
  if (!e.target.classList.contains("apply-wrap-ita")) return;

  const index = parseInt(e.target.dataset.index, 10);

  const paragraphs = italianBodyElement.value.split(/\n\.\n/);
  paragraphs[index] = wrap75(paragraphs[index]);

  applyDDTSSChange(italianBodyElement, paragraphs.join("\n.\n"));
  refreshSidePanel();

});


// ===============================
// Event listener per "Applica suggerimento" (titolo)
// ===============================
document.addEventListener("click", (e) => {
  if (!e.target.classList.contains("apply-title")) return;

  const suggestion = decodeURIComponent(e.target.dataset.suggestion);

  applyDDTSSChange(italianTitle, suggestion);
  refreshSidePanel();

});

document.addEventListener("click", (e) => {
  if (e.target.id === "ddtss-refresh") {
    updateSidePanel();
  }
});


browser.runtime.onMessage.addListener((msg) => {
  console.log("MESSAGGIO RICEVUTO NEL CONTENT-SCRIPT:", msg);
  if (msg.action === "toggle-panel") {
    console.log("→ toggleSidePanel() chiamato");
    toggleSidePanel();
  }
});


