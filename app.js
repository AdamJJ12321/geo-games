const features = window.COUNTRY_FEATURES || [];
const svgNS = "http://www.w3.org/2000/svg";
const viewBox = { x: 0, y: 40, width: 1060, height: 660 };
const earthRadiusKm = 6371.0088;

const els = {
  map: document.querySelector("#world-map"),
  form: document.querySelector("#guess-form"),
  input: document.querySelector("#country-input"),
  options: document.querySelector("#country-options"),
  status: document.querySelector("#status-line"),
  history: document.querySelector("#guess-history"),
  callout: document.querySelector("#guess-callout"),
  giveUp: document.querySelector("#give-up"),
  fresh: document.querySelector("#new-game")
};

const state = {
  mystery: null,
  guesses: [],
  distanceCache: new Map(),
  calloutTimer: null
};

const countries = features
  .map((feature, index) => {
    const id = makeId(feature.properties.iso3 || feature.properties.iso2 || feature.properties.name, index);
    const rings = geometryToRings(feature.geometry);
    return {
      id,
      name: feature.properties.name,
      iso2: feature.properties.iso2,
      iso3: feature.properties.iso3,
      feature,
      rings,
      path: geometryToPath(feature.geometry),
      aliases: makeAliases(feature.properties.name, feature.properties.iso2, feature.properties.iso3),
      boundary: buildBoundary(rings)
    };
  })
  .filter((country) => country.path && country.boundary.points.length);

const byAlias = new Map(countries.flatMap((country) => (
  country.aliases.map((alias) => [normalize(alias), country])
)));

function makeId(value, index) {
  return `${normalize(value).replaceAll(" ", "-") || "country"}-${index}`;
}

function makeAliases(name, iso2, iso3) {
  const aliases = new Set([name, iso2, iso3]);
  const lower = name.toLowerCase();
  const replacements = [
    ["united states of america", ["united states", "usa", "us", "america"]],
    ["united kingdom", ["uk", "great britain", "britain"]],
    ["russian federation", ["russia"]],
    ["viet nam", ["vietnam"]],
    ["iran (islamic republic of)", ["iran"]],
    ["venezuela (bolivarian republic of)", ["venezuela"]],
    ["bolivia (plurinational state of)", ["bolivia"]],
    ["tanzania, united republic of", ["tanzania"]],
    ["moldova, republic of", ["moldova"]],
    ["syrian arab republic", ["syria"]],
    ["lao people's democratic republic", ["laos"]],
    ["korea, republic of", ["south korea", "korea"]],
    ["korea (democratic people's republic of)", ["north korea"]],
    ["côte d'ivoire", ["cote d ivoire", "ivory coast"]],
    ["czechia", ["czech republic"]],
    ["brunei darussalam", ["brunei"]],
    ["micronesia (federated states of)", ["micronesia"]],
    ["palestine, state of", ["palestine"]],
    ["eswatini", ["swaziland"]],
    ["cabo verde", ["cape verde"]],
    ["timor-leste", ["east timor"]],
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

function geometryToRings(geometry) {
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

function project([lon, lat]) {
  return [
    viewBox.x + ((lon + 180) / 360) * viewBox.width,
    viewBox.y + ((90 - lat) / 180) * viewBox.height
  ];
}

function geometryToPath(geometry) {
  return geometryToRings(geometry)
    .map((ring) => ringToPath(ring))
    .filter(Boolean)
    .join(" ");
}

function ringToPath(ring) {
  if (!ring.length) return "";
  return ring.map((point, index) => {
    const [x, y] = project(point);
    return `${index ? "L" : "M"}${roundPath(x)} ${roundPath(y)}`;
  }).join(" ") + " Z";
}

function roundPath(value) {
  return Number(value.toFixed(2));
}

function buildBoundary(rings) {
  const points = [];
  const segments = [];
  rings.forEach((ring) => {
    if (ring.length < 2) return;
    for (let i = 0; i < ring.length; i += 1) {
      const point = ring[i];
      points.push(point);
      if (i > 0) segments.push([ring[i - 1], point]);
    }
  });
  return { points, segments };
}

function renderMap() {
  els.map.innerHTML = "";

  countries.forEach((country) => {
    const land = document.createElementNS(svgNS, "path");
    land.setAttribute("d", country.path);
    land.setAttribute("class", "land-country");
    els.map.appendChild(land);
  });

  countries.forEach((country) => {
    const guessShape = document.createElementNS(svgNS, "path");
    guessShape.setAttribute("d", country.path);
    guessShape.setAttribute("class", "country-outline");
    guessShape.dataset.country = country.id;
    const title = document.createElementNS(svgNS, "title");
    title.textContent = country.name;
    guessShape.appendChild(title);
    els.map.appendChild(guessShape);
  });
}

function populateCountryOptions() {
  els.options.innerHTML = countries
    .map((country) => `<option value="${escapeHtml(country.name)}"></option>`)
    .join("");
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

function findCountry(input) {
  const query = normalize(input);
  if (!query) return null;
  if (byAlias.has(query)) return byAlias.get(query);

  let best = null;
  let bestScore = Infinity;
  countries.forEach((country) => {
    country.aliases.forEach((alias) => {
      const candidate = normalize(alias);
      const score = levenshtein(query, candidate);
      if (score < bestScore) {
        bestScore = score;
        best = country;
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

function randomCountry() {
  return countries[Math.floor(Math.random() * countries.length)];
}

function startGame() {
  state.mystery = randomCountry();
  state.guesses = [];
  els.history.innerHTML = "";
  els.status.textContent = "A mystery country is ready.";
  els.callout.textContent = "";
  els.callout.classList.remove("show", "correct");
  window.clearTimeout(state.calloutTimer);
  els.giveUp.disabled = false;
  els.input.disabled = false;
  els.input.value = "";
  resetCountryStyles();
  els.input.focus();
}

function submitGuess(event) {
  event.preventDefault();
  const rawGuess = els.input.value;
  const guess = findCountry(rawGuess);
  if (!guess) {
    els.status.textContent = "I could not match that country. Try another spelling.";
    return;
  }

  if (state.guesses.some((entry) => entry.country.id === guess.id)) {
    els.status.textContent = `${guess.name} has already been guessed.`;
    els.input.value = "";
    return;
  }

  const answer = state.mystery;
  const distance = borderDistanceKm(guess, answer);
  const color = distanceColor(guess, answer, distance);
  state.guesses.push({ country: guess, distance });
  setCountryColor(guess.id, color, guess.id === answer.id);
  const assumedText = normalize(rawGuess) === normalize(guess.name) ? "" : `Assumed ${guess.name}. `;
  renderGuessHistory();
  showGuessCallout(guess, answer, distance);
  els.status.textContent = guess.id === answer.id
    ? `Correct. The mystery country was ${answer.name}.`
    : `${assumedText}Keep narrowing it down.`;
  els.input.value = "";

  if (guess.id === answer.id) {
    els.input.disabled = true;
    els.giveUp.disabled = true;
  }
}

function renderGuessHistory() {
  els.history.innerHTML = "";
  [...state.guesses]
    .sort((a, b) => a.distance - b.distance || a.country.name.localeCompare(b.country.name))
    .forEach(({ country, distance }) => {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${escapeHtml(country.name)}</strong><span>${distanceLabel(distance)} from the mystery country</span>`;
      els.history.appendChild(li);
    });
}

function showGuessCallout(guess, answer, distance) {
  window.clearTimeout(state.calloutTimer);
  els.callout.classList.remove("show", "correct");
  if (guess.id === answer.id) {
    els.callout.textContent = `${guess.name} is the mystery country`;
    els.callout.classList.add("correct");
  } else if (distance === 0) {
    els.callout.textContent = `${guess.name} is adjacent`;
  } else {
    els.callout.textContent = `${guess.name} is ${formatDistance(distance)} away`;
  }
  window.requestAnimationFrame(() => els.callout.classList.add("show"));
  state.calloutTimer = window.setTimeout(() => {
    els.callout.classList.remove("show");
  }, 1500);
}

function giveUp() {
  const answer = state.mystery;
  if (!answer || els.input.disabled) return;
  window.clearTimeout(state.calloutTimer);
  setCountryColor(answer.id, distanceColor(answer, answer, 0), true);
  els.callout.textContent = `The answer was ${answer.name}`;
  els.callout.classList.add("correct", "show");
  state.calloutTimer = window.setTimeout(() => {
    els.callout.classList.remove("show");
  }, 1500);
  els.status.textContent = `The mystery country was ${answer.name}.`;
  els.input.value = "";
  els.input.disabled = true;
  els.giveUp.disabled = true;
}

function resetCountryStyles() {
  els.map.querySelectorAll(".country-outline").forEach((shape) => {
    shape.removeAttribute("style");
    shape.classList.remove("guessed", "correct");
  });
}

function setCountryColor(id, color, correct) {
  const shape = els.map.querySelector(`[data-country="${id}"]`);
  if (!shape) return;
  shape.classList.add("guessed");
  if (correct) shape.classList.add("correct");
  shape.style.fill = color;
  shape.style.stroke = color;
}

function formatDistance(distance) {
  return `${Math.round(distance).toLocaleString()} km`;
}

function distanceLabel(distance) {
  return distance === 0 ? "Adjacent" : formatDistance(distance);
}

function distanceColor(guess, answer, distance) {
  if (guess.id === answer.id) return "#58714e";
  if (distance === 0) return "#4b2830";
  if (distance <= 250) return "#672b3c";
  if (distance <= 750) return "#893441";
  if (distance <= 1500) return "#9e4c3d";
  if (distance <= 3000) return "#ad673d";
  if (distance <= 5000) return "#bf9344";
  if (distance <= 8000) return "#d8c26b";
  return "#efe6bf";
}

function borderDistanceKm(a, b) {
  if (a.id === b.id) return 0;
  const key = [a.id, b.id].sort().join("|");
  if (state.distanceCache.has(key)) return state.distanceCache.get(key);

  let min = Infinity;
  min = Math.min(min, minPointToSegments(a.boundary.points, b.boundary.segments));
  if (min > 0.5) min = Math.min(min, minPointToSegments(b.boundary.points, a.boundary.segments));

  const rounded = min <= 1 ? 0 : min;
  state.distanceCache.set(key, rounded);
  return rounded;
}

function minPointToSegments(points, segments) {
  let min = Infinity;
  for (const point of points) {
    for (const segment of segments) {
      const distance = pointToSegmentKm(point, segment[0], segment[1]);
      if (distance < min) {
        min = distance;
        if (min <= 0.5) return min;
      }
    }
  }
  return min;
}

function pointToSegmentKm(point, a, b) {
  const lat0 = toRad(point[1]);
  const ax = lonDeltaKm(a[0], point[0], lat0);
  const ay = latDeltaKm(a[1], point[1]);
  const bx = lonDeltaKm(b[0], point[0], lat0);
  const by = latDeltaKm(b[1], point[1]);
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (!lengthSq) return haversineKm(point, a);
  const t = Math.max(0, Math.min(1, ((-ax * dx) + (-ay * dy)) / lengthSq));
  const x = ax + dx * t;
  const y = ay + dy * t;
  return Math.sqrt(x * x + y * y);
}

function lonDeltaKm(lon, originLon, originLatRad) {
  let delta = lon - originLon;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return toRad(delta) * earthRadiusKm * Math.cos(originLatRad);
}

function latDeltaKm(lat, originLat) {
  return toRad(lat - originLat) * earthRadiusKm;
}

function haversineKm(a, b) {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

function toRad(degrees) {
  return degrees * Math.PI / 180;
}

els.form.addEventListener("submit", submitGuess);
els.giveUp.addEventListener("click", giveUp);
els.fresh.addEventListener("click", startGame);

renderMap();
populateCountryOptions();
startGame();

window.__mysteryGame = {
  countries,
  state,
  findCountry,
  borderDistanceKm,
  startGame
};
