const maxGuesses = 3;
const flagWidth = 300;
const flagHeight = 200;
const hiddenColor = "#d9c9a7";
const hiddenLine = "#a99067";

const colorFamilies = {
  black: [41, 37, 30],
  white: [238, 230, 210],
  red: [159, 61, 52],
  blue: [63, 95, 120],
  green: [83, 111, 77],
  yellow: [192, 160, 74],
  orange: [184, 115, 62]
};

const countryCodeOverrides = {
  France: { iso2: "FR", iso3: "FRA" }
};

const excludedFlagNames = new Set([
  "Coral Sea Islands",
  "Spratly Islands",
  "Clipperton Island",
  "Ashmore and Cartier Islands",
  "Bajo Nuevo Bank (Petrel Is.)",
  "Serranilla Bank",
  "Scarborough Reef"
]);

const els = {
  canvas: document.querySelector("#flag-canvas"),
  clues: document.querySelector("#flag-clues"),
  form: document.querySelector("#guess-form"),
  input: document.querySelector("#country-input"),
  options: document.querySelector("#country-options"),
  status: document.querySelector("#status-line"),
  history: document.querySelector("#guess-history"),
  fresh: document.querySelector("#new-game")
};

const ctx = els.canvas.getContext("2d", { willReadFrequently: true });

const flags = buildFlagList();
const byAlias = new Map(flags.flatMap((flag) => flag.aliases.map((alias) => [normalize(alias), flag])));
const pixelCache = new Map();

const state = {
  answer: null,
  answerPixels: null,
  revealedMask: new Uint8Array(flagWidth * flagHeight),
  guesses: [],
  finished: false
};

function buildFlagList() {
  const seen = new Set();
  return (window.COUNTRY_FEATURES || [])
    .filter((feature) => !excludedFlagNames.has(feature.properties.name))
    .map((feature) => {
      const codes = countryCodeOverrides[feature.properties.name] || feature.properties;
      return {
        name: feature.properties.name,
        iso2: codes.iso2,
        iso3: codes.iso3,
        aliases: makeAliases(feature.properties.name, codes.iso2, codes.iso3)
      };
    })
    .filter((flag) => flag.iso2 && flag.iso2 !== "-99")
    .filter((flag) => {
      const key = flag.iso2.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function makeAliases(name, iso2, iso3) {
  const aliases = new Set([name, iso2, iso3]);
  const lower = name.toLowerCase();
  const replacements = [
    ["united states of america", ["united states", "usa", "us", "america"]],
    ["united kingdom", ["uk", "great britain", "britain"]],
    ["russian federation", ["russia"]],
    ["viet nam", ["vietnam"]],
    ["czechia", ["czech republic"]],
    ["korea, republic of", ["south korea", "korea"]],
    ["korea (democratic people's republic of)", ["north korea"]],
    ["côte d'ivoire", ["cote d ivoire", "ivory coast"]],
    ["brunei darussalam", ["brunei"]],
    ["eswatini", ["swaziland"]],
    ["cabo verde", ["cape verde"]],
    ["holy see", ["vatican", "vatican city"]]
  ];
  replacements.forEach(([official, extra]) => {
    if (lower === official) extra.forEach((alias) => aliases.add(alias));
  });
  return [...aliases].filter(Boolean);
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function findFlag(input) {
  const query = normalize(input);
  if (!query) return null;
  if (byAlias.has(query)) return byAlias.get(query);

  let best = null;
  let bestScore = Infinity;
  flags.forEach((flag) => {
    flag.aliases.forEach((alias) => {
      const score = levenshtein(query, normalize(alias));
      if (score < bestScore) {
        best = flag;
        bestScore = score;
      }
    });
  });

  const tolerance = query.length <= 5 ? 1 : Math.max(2, Math.floor(query.length * 0.3));
  return bestScore <= tolerance ? best : null;
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

async function startGame() {
  state.answer = flags[Math.floor(Math.random() * flags.length)];
  state.answerPixels = null;
  state.revealedMask = new Uint8Array(flagWidth * flagHeight);
  state.guesses = [];
  state.finished = false;
  els.input.value = "";
  els.input.disabled = true;
  els.history.innerHTML = "";
  els.status.textContent = "Loading the hidden flag...";
  renderVisibleFlag();

  try {
    state.answerPixels = await renderFlagPixels(state.answer);
    els.status.textContent = "Three tries. Matching pixels reveal the hidden flag.";
    els.input.disabled = false;
    renderVisibleFlag();
    renderClues();
    els.input.focus();
  } catch {
    els.status.textContent = "This flag image could not be loaded. Start a new game.";
  }
}

async function submitGuess(event) {
  event.preventDefault();
  if (state.finished || !state.answerPixels) return;

  const rawGuess = els.input.value;
  const guess = findFlag(rawGuess);
  if (!guess) {
    els.status.textContent = "I could not match that flag country. Try another spelling.";
    return;
  }
  if (state.guesses.some((entry) => entry.flag.name === guess.name)) {
    els.status.textContent = `${guess.name} has already been guessed.`;
    els.input.value = "";
    return;
  }

  els.input.disabled = true;
  els.status.textContent = `Checking ${guess.name}...`;

  try {
    const correct = guess.name === state.answer.name;
    const revealed = correct ? revealAllPixels() : await revealOverlappingPixels(guess);
    state.guesses.push({ flag: guess, revealed, correct });
    renderVisibleFlag();
    renderClues();
    renderHistory();
    els.input.value = "";

    const assumed = normalize(rawGuess) === normalize(guess.name) ? "" : `Assumed ${guess.name}. `;
    if (correct) {
      finish(`Correct. The hidden flag was ${state.answer.name}.`);
    } else if (state.guesses.length >= maxGuesses) {
      revealAllPixels();
      renderVisibleFlag();
      finish(`${assumed}Out of tries. The hidden flag was ${state.answer.name}.`);
    } else {
      els.input.disabled = false;
      els.status.textContent = `${assumed}${revealed.toLocaleString()} overlapping flag pixels revealed. ${maxGuesses - state.guesses.length} tries left.`;
      els.input.focus();
    }
  } catch {
    els.input.disabled = false;
    els.status.textContent = `${guess.name}'s flag image could not be loaded. Try another country.`;
  }
}

function finish(message) {
  state.finished = true;
  els.input.disabled = true;
  els.status.textContent = message;
}

function revealAllPixels() {
  let newlyRevealed = 0;
  for (let i = 0; i < state.revealedMask.length; i += 1) {
    if (!state.revealedMask[i]) newlyRevealed += 1;
    state.revealedMask[i] = 1;
  }
  return newlyRevealed;
}

async function revealOverlappingPixels(guess) {
  const guessPixels = await renderFlagPixels(guess);
  let newlyRevealed = 0;
  for (let pixel = 0; pixel < state.revealedMask.length; pixel += 1) {
    if (state.revealedMask[pixel]) continue;
    const index = pixel * 4;
    if (samePixelColor(state.answerPixels, guessPixels, index)) {
      state.revealedMask[pixel] = 1;
      newlyRevealed += 1;
    }
  }
  return newlyRevealed;
}

function samePixelColor(a, b, index) {
  const answerFamily = pixelFamily(a, index);
  return answerFamily !== null && answerFamily === pixelFamily(b, index);
}

function pixelFamily(data, index) {
  const r = data[index];
  const g = data[index + 1];
  const b = data[index + 2];
  const a = data[index + 3];
  if (a < 200) return null;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const spread = max - min;

  if (max < 58) return "black";
  if (min > 205 && spread < 58) return "white";
  if (r > 145 && g > 105 && b < 105) return g > 145 ? "yellow" : "orange";
  if (r > 115 && r > g * 1.16 && r > b * 1.16) return "red";
  if (g > 85 && g > r * 1.05 && g > b * 1.12) return "green";
  if (b > 85 && b > r * 1.06 && b >= g * 0.86) return "blue";
  if (r > 130 && g > 80 && b < 90) return "orange";
  if (r > 130 && g > 120 && b < 120) return "yellow";
  if (spread < 42 && max > 155) return "white";
  if (spread < 36 && max < 120) return "black";
  return nearestColorFamily(r, g, b);
}

function nearestColorFamily(r, g, b) {
  let best = null;
  let bestDistance = Infinity;
  Object.entries(colorFamilies).forEach(([name, color]) => {
    const distance =
      ((r - color[0]) ** 2) +
      ((g - color[1]) ** 2) +
      ((b - color[2]) ** 2);
    if (distance < bestDistance) {
      best = name;
      bestDistance = distance;
    }
  });
  return best;
}

function renderHistory() {
  els.history.innerHTML = "";
  state.guesses.forEach(({ flag, revealed, correct }, index) => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${index + 1}. ${escapeHtml(flag.name)}</strong><span>${correct ? "Correct flag" : `${revealed.toLocaleString()} overlapping pixels`}</span>`;
    els.history.appendChild(li);
  });
}

function renderClues() {
  const revealed = state.revealedMask.reduce((total, value) => total + value, 0);
  const percent = Math.round((revealed / state.revealedMask.length) * 100);
  els.clues.innerHTML = `
    <span class="flag-clue shown"><i style="background:#6e7355"></i>${percent}% revealed</span>
    <span class="flag-clue"><i style="background:${hiddenColor}"></i>${maxGuesses - state.guesses.length} tries left</span>
  `;
}

function renderVisibleFlag() {
  const image = ctx.createImageData(flagWidth, flagHeight);
  const hidden = hexToRgb(hiddenColor);
  for (let pixel = 0; pixel < state.revealedMask.length; pixel += 1) {
    const index = pixel * 4;
    if (state.answerPixels && state.revealedMask[pixel]) {
      image.data[index] = state.answerPixels[index];
      image.data[index + 1] = state.answerPixels[index + 1];
      image.data[index + 2] = state.answerPixels[index + 2];
    } else {
      image.data[index] = hidden.r;
      image.data[index + 1] = hidden.g;
      image.data[index + 2] = hidden.b;
    }
    image.data[index + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  drawCanvasBorder(ctx);
  drawUnrevealedTexture();
}

function drawUnrevealedTexture() {
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = hiddenLine;
  ctx.lineWidth = 1;
  for (let x = 0; x <= flagWidth; x += 12) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, flagHeight);
    ctx.stroke();
  }
  for (let y = 0; y <= flagHeight; y += 12) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(flagWidth, y);
    ctx.stroke();
  }
  ctx.restore();
}

async function renderFlagPixels(flag) {
  const key = flag.iso2.toLowerCase();
  if (pixelCache.has(key)) return pixelCache.get(key);

  const canvas = document.createElement("canvas");
  canvas.width = flagWidth;
  canvas.height = flagHeight;
  const renderCtx = canvas.getContext("2d", { willReadFrequently: true });

  let pixels;
  try {
    const image = await loadFlagImage(flag);
    renderCtx.clearRect(0, 0, flagWidth, flagHeight);
    renderCtx.imageSmoothingEnabled = true;
    renderCtx.drawImage(image, 0, 0, flagWidth, flagHeight);
    pixels = renderCtx.getImageData(0, 0, flagWidth, flagHeight).data;
  } catch {
    pixels = renderEmojiFlagPixels(renderCtx, flag);
  }

  pixelCache.set(key, pixels);
  return pixels;
}

function loadFlagImage(flag) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = `https://flagcdn.com/w640/${flag.iso2.toLowerCase()}.png`;
  });
}

function renderEmojiFlagPixels(renderCtx, flag) {
  renderCtx.clearRect(0, 0, flagWidth, flagHeight);
  renderCtx.fillStyle = hiddenColor;
  renderCtx.fillRect(0, 0, flagWidth, flagHeight);
  renderCtx.font = "160px Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif";
  renderCtx.textAlign = "center";
  renderCtx.textBaseline = "middle";
  renderCtx.fillText(countryFlagEmoji(flag.iso2), flagWidth / 2, flagHeight / 2 + 3);
  return renderCtx.getImageData(0, 0, flagWidth, flagHeight).data;
}

function countryFlagEmoji(iso2) {
  return iso2
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

function drawCanvasBorder(renderCtx) {
  renderCtx.save();
  renderCtx.strokeStyle = "#3d3328";
  renderCtx.lineWidth = 2;
  renderCtx.strokeRect(1, 1, flagWidth - 2, flagHeight - 2);
  renderCtx.restore();
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}

function populateOptions() {
  els.options.innerHTML = flags.map((flag) => `<option value="${escapeHtml(flag.name)}"></option>`).join("");
}

els.form.addEventListener("submit", submitGuess);
els.fresh.addEventListener("click", startGame);

populateOptions();
startGame();

window.__flagleGame = {
  flags,
  state,
  findFlag,
  startGame,
  revealOverlappingPixels
};
