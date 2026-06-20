const features = window.COUNTRY_FEATURES || [];
const svgNS = "http://www.w3.org/2000/svg";
const viewBox = { x: 0, y: 40, width: 1060, height: 660 };
const earthRadiusKm = 6371.0088;
const coordinatePrecision = 4;
const landBorderIncludes = [
  ["austria", "slovakia"],
  ["denmark", "germany"],
  ["france", "andorra"],
  ["france", "belgium"],
  ["france", "germany"],
  ["france", "italy"],
  ["france", "luxembourg"],
  ["france", "monaco"],
  ["france", "spain"],
  ["france", "switzerland"],
  ["poland", "lithuania"],
  ["russia", "poland"],
  ["spain", "andorra"],
  ["switzerland", "liechtenstein"]
];
const excludedCountryNames = new Set([
  "United States Minor Outlying Islands",
  "French Southern and Antarctic Lands",
  "British Indian Ocean Territory",
  "Bouvet Island",
  "Heard Island and McDonald Islands",
  "South Georgia and South Sandwich Islands",
  "Falkland Islands",
  "Saint Pierre and Miquelon",
  "Svalbard and Jan Mayen",
  "Christmas Island",
  "Cocos Islands",
  "Norfolk Island",
  "Pitcairn Islands",
  "Tokelau",
  "Wallis and Futuna",
  "French Polynesia",
  "New Caledonia",
  "Guam",
  "American Samoa",
  "Northern Mariana Islands",
  "Puerto Rico",
  "United States Virgin Islands",
  "British Virgin Islands",
  "Anguilla",
  "Montserrat",
  "Bermuda",
  "Cayman Islands",
  "Turks and Caicos Islands",
  "Aruba",
  "Curacao",
  "Sint Maarten",
  "Bonaire, Sint Eustatius and Saba"
]);

const countryCodeOverrides = {
  France: { iso2: "FR", iso3: "FRA" }
};

const els = {
  map: document.querySelector("#world-map"),
  form: document.querySelector("#guess-form"),
  input: document.querySelector("#country-input"),
  options: document.querySelector("#country-options"),
  status: document.querySelector("#status-line"),
  history: document.querySelector("#guess-history"),
  callout: document.querySelector("#guess-callout"),
  banner: document.querySelector("#route-banner"),
  showAnswer: document.querySelector("#show-answer"),
  fresh: document.querySelector("#new-game")
};

const state = {
  start: null,
  end: null,
  path: [],
  guesses: [],
  graph: new Map(),
  connectedPool: [],
  shortestDistance: 0,
  optimalCountryIds: new Set(),
  calloutTimer: null
};

const mapCountries = features
  .map((feature, index) => buildCountry(feature, index))
  .filter((country) => country.path);

const countries = features
  .filter(isPlayableFeature)
  .filter((feature) => !excludedCountryNames.has(feature.properties.name))
  .map((feature, index) => buildCountry(feature, features.indexOf(feature)))
  .filter((country) => country.path && country.boundary.points.length);

const byAlias = new Map(countries.flatMap((country) => (
  country.aliases.map((alias) => [normalize(alias), country])
)));
const byKey = new Map(countries.map((country) => [country.key, country]));
const byId = new Map(countries.map((country) => [country.id, country]));

function makeId(value, index) {
  return `${normalize(value).replaceAll(" ", "-") || "country"}-${index}`;
}

function isPlayableFeature(feature) {
  const codes = countryCodeOverrides[feature.properties.name] || feature.properties;
  return Boolean(codes.iso2 && codes.iso3 && codes.iso2 !== "-99" && codes.iso3 !== "-99");
}

function buildCountry(feature, index) {
  const id = makeId(feature.properties.name, index);
  const rings = geometryToRings(feature.geometry);
  const codes = countryCodeOverrides[feature.properties.name] || feature.properties;
  return {
    id,
    key: normalize(feature.properties.name),
    name: feature.properties.name,
    iso2: codes.iso2,
    iso3: codes.iso3,
    path: geometryToPath(feature.geometry),
    aliases: makeAliases(feature.properties.name, codes.iso2, codes.iso3),
    boundary: buildBoundary(rings),
    borderKeys: buildBorderKeys(rings)
  };
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
    ["palestine, state of", ["palestine"]],
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

function buildBorderKeys(rings) {
  const points = new Set();
  const segments = new Set();
  rings.forEach((ring) => {
    for (let i = 0; i < ring.length; i += 1) {
      points.add(pointKey(ring[i]));
      if (i > 0) segments.add(segmentKey(ring[i - 1], ring[i]));
    }
  });
  return { points, segments };
}

function pointKey(point) {
  return `${point[0].toFixed(coordinatePrecision)},${point[1].toFixed(coordinatePrecision)}`;
}

function segmentKey(a, b) {
  const aKey = pointKey(a);
  const bKey = pointKey(b);
  return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
}

function renderMap() {
  els.map.innerHTML = "";

  mapCountries.forEach((country) => {
    const land = document.createElementNS(svgNS, "path");
    land.setAttribute("d", country.path);
    land.setAttribute("class", "land-country");
    els.map.appendChild(land);
  });

  mapCountries.forEach((country) => {
    const shape = document.createElementNS(svgNS, "path");
    shape.setAttribute("d", country.path);
    shape.setAttribute("class", "country-outline");
    shape.dataset.country = country.id;
    const title = document.createElementNS(svgNS, "title");
    title.textContent = country.name;
    shape.appendChild(title);
    els.map.appendChild(shape);
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
      const score = levenshtein(query, normalize(alias));
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

function buildGraph() {
  const graph = new Map(countries.map((country) => [country.id, new Set()]));
  for (let i = 0; i < countries.length; i += 1) {
    for (let j = i + 1; j < countries.length; j += 1) {
      const a = countries[i];
      const b = countries[j];
      if (sharesLandBorder(a, b)) {
        addEdge(graph, a.id, b.id);
      }
    }
  }

  landBorderIncludes.forEach(([aKey, bKey]) => {
    const a = byKey.get(aKey);
    const b = byKey.get(bKey);
    if (a && b) addEdge(graph, a.id, b.id);
  });

  state.graph = graph;
  state.connectedPool = largestComponent(graph);
}

function addEdge(graph, aId, bId) {
  graph.get(aId).add(bId);
  graph.get(bId).add(aId);
}

function sharesLandBorder(a, b) {
  let sharedPoints = 0;
  for (const segment of a.borderKeys.segments) {
    if (b.borderKeys.segments.has(segment)) return true;
  }
  for (const point of a.borderKeys.points) {
    if (b.borderKeys.points.has(point)) {
      sharedPoints += 1;
      if (sharedPoints >= 2) return true;
    }
  }
  return false;
}

function largestComponent(graph) {
  const seen = new Set();
  let best = [];
  for (const id of graph.keys()) {
    if (seen.has(id)) continue;
    const component = [];
    const queue = [id];
    seen.add(id);
    while (queue.length) {
      const current = queue.shift();
      component.push(current);
      graph.get(current).forEach((next) => {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      });
    }
    if (component.length > best.length) best = component;
  }
  return best;
}

function shortestPath(startId, endId) {
  const queue = [[startId]];
  const seen = new Set([startId]);
  while (queue.length) {
    const path = queue.shift();
    const last = path[path.length - 1];
    if (last === endId) return path;
    [...state.graph.get(last)]
      .sort((a, b) => countryName(a).localeCompare(countryName(b)))
      .forEach((next) => {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push([...path, next]);
        }
      });
  }
  return [];
}

function distancesFrom(startId) {
  const distances = new Map([[startId, 0]]);
  const queue = [startId];
  while (queue.length) {
    const current = queue.shift();
    const nextDistance = distances.get(current) + 1;
    state.graph.get(current).forEach((next) => {
      if (!distances.has(next)) {
        distances.set(next, nextDistance);
        queue.push(next);
      }
    });
  }
  return distances;
}

function optimalCountrySet(startId, endId) {
  const fromStart = distancesFrom(startId);
  const fromEnd = distancesFrom(endId);
  const shortestDistance = fromStart.get(endId);
  const optimal = new Set();
  countries.forEach((country) => {
    const a = fromStart.get(country.id);
    const b = fromEnd.get(country.id);
    if (Number.isInteger(a) && Number.isInteger(b) && a + b === shortestDistance) {
      optimal.add(country.id);
    }
  });
  return { optimal, shortestDistance };
}

function countryName(id) {
  return byId.get(id)?.name || "";
}

function randomRoutePair() {
  const pool = state.connectedPool;
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const start = pool[Math.floor(Math.random() * pool.length)];
    const end = pool[Math.floor(Math.random() * pool.length)];
    if (start === end) continue;
    const path = shortestPath(start, end);
    if (path.length >= 4 && path.length <= 9) return path;
  }

  const start = pool[0];
  const end = pool[pool.length - 1];
  return shortestPath(start, end);
}

function startGame() {
  state.path = randomRoutePair();
  state.start = state.path[0];
  state.end = state.path[state.path.length - 1];
  const routeInfo = optimalCountrySet(state.start, state.end);
  state.shortestDistance = routeInfo.shortestDistance;
  state.optimalCountryIds = routeInfo.optimal;
  state.guesses = [];
  els.history.innerHTML = "";
  els.input.disabled = false;
  els.input.value = "";
  els.showAnswer.disabled = false;
  els.status.textContent = "Guess the countries that connect the endpoints.";
  els.banner.textContent = `${countryName(state.start)} to ${countryName(state.end)}. Fewest countries in between: ${Math.max(0, state.shortestDistance - 1)}.`;
  resetCountryStyles();
  paintEndpoint(state.start);
  paintEndpoint(state.end);
  els.input.focus();
}

function resetCountryStyles() {
  els.map.querySelectorAll(".country-outline").forEach((shape) => {
    shape.removeAttribute("style");
    shape.classList.remove("guessed", "correct", "endpoint", "route-good", "route-bad", "revealed");
  });
}

function paintEndpoint(id) {
  const shape = els.map.querySelector(`[data-country="${id}"]`);
  if (!shape) return;
  shape.classList.add("guessed", "endpoint");
}

function submitGuess(event) {
  event.preventDefault();
  const rawGuess = els.input.value;
  const guess = findCountry(rawGuess);
  if (!guess) {
    els.status.textContent = "I could not match that country. Try another spelling.";
    return;
  }
  if (guess.id === state.start || guess.id === state.end) {
    els.status.textContent = `${guess.name} is already one of the black endpoint countries.`;
    els.input.value = "";
    return;
  }
  if (state.guesses.some((entry) => entry.country.id === guess.id)) {
    els.status.textContent = `${guess.name} has already been guessed.`;
    els.input.value = "";
    return;
  }

  const onPath = state.optimalCountryIds.has(guess.id);
  state.guesses.push({ country: guess, onPath });
  paintGuess(guess.id, onPath);
  renderGuessHistory();
  showGuessCallout(onPath ? `${guess.name} is on the route` : `${guess.name} is not on the shortest route`, onPath);
  const assumedText = normalize(rawGuess) === normalize(guess.name) ? "" : `Assumed ${guess.name}. `;
  els.status.textContent = `${assumedText}${onPath ? "Good connection." : "Orange means it is outside the shortest route."}`;
  els.input.value = "";

  const completedRoute = completedShortestRoute();
  if (completedRoute.length) {
    els.status.textContent = `Complete. Optimal route: ${routeText(completedRoute)}.`;
    els.input.disabled = true;
  }
}

function paintGuess(id, onPath) {
  const shape = els.map.querySelector(`[data-country="${id}"]`);
  if (!shape) return;
  shape.classList.add("guessed", onPath ? "route-good" : "route-bad");
}

function renderGuessHistory() {
  els.history.innerHTML = "";
  state.guesses.forEach(({ country, onPath }, index) => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${index + 1}. ${escapeHtml(country.name)}</strong><span>${onPath ? "On the shortest route" : "Not on the shortest route"}</span>`;
    els.history.appendChild(li);
  });
}

function hasWon() {
  return completedShortestRoute().length > 0;
}

function completedShortestRoute() {
  const allowed = new Set(
    state.guesses
      .filter((entry) => entry.onPath)
      .map((entry) => entry.country.id)
  );
  allowed.add(state.start);
  allowed.add(state.end);

  const queue = [[state.start]];
  const seen = new Set([state.start]);
  while (queue.length) {
    const path = queue.shift();
    const last = path[path.length - 1];
    if (last === state.end) {
      return path.length - 1 === state.shortestDistance ? path : [];
    }
    if (path.length - 1 >= state.shortestDistance) continue;
    state.graph.get(last).forEach((next) => {
      if (!allowed.has(next) || seen.has(next)) return;
      seen.add(next);
      queue.push([...path, next]);
    });
  }
  return [];
}

function showAnswer() {
  [...state.optimalCountryIds].filter((id) => id !== state.start && id !== state.end).forEach((id) => {
    const shape = els.map.querySelector(`[data-country="${id}"]`);
    if (!shape) return;
    shape.classList.add("guessed", "revealed");
  });
  els.status.textContent = `One optimal route: ${routeText(state.path)}. All revealed countries are accepted shortest-route answers.`;
  els.input.disabled = true;
  els.showAnswer.disabled = true;
}

function routeText(path = state.path) {
  return path.map(countryName).join(" > ");
}

function showGuessCallout(message, good) {
  window.clearTimeout(state.calloutTimer);
  els.callout.classList.remove("show", "correct");
  els.callout.textContent = message;
  if (good) els.callout.classList.add("correct");
  window.requestAnimationFrame(() => els.callout.classList.add("show"));
  state.calloutTimer = window.setTimeout(() => {
    els.callout.classList.remove("show");
  }, 1300);
}

els.form.addEventListener("submit", submitGuess);
els.showAnswer.addEventListener("click", showAnswer);
els.fresh.addEventListener("click", startGame);

renderMap();
populateCountryOptions();
buildGraph();
startGame();

window.__travleGame = {
  mapCountries,
  countries,
  state,
  findCountry,
  shortestPath,
  coordinatePrecision,
  landBorderIncludes
};
