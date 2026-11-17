
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const BASE = "https://crex.com";
const SCHEDULE_URL = `${BASE}/schedule`;
const OUTPUT_DIR = __dirname;
const MATCH_SELECTOR = "a.match-card-wrapper[href*='match-updates-']";

// Slow internet settings
const PAGE_TIMEOUT = 180000;
const PAGE_LOAD_WAIT = 10000;
const PAGINATION_WAIT = 90000;
const DETAIL_LOAD_WAIT = 10000;
const DETAIL_RETRIES = 3;
const MAX_SAFETY_PAGES = 100;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ================================================
// COMMAND LINE SETTINGS
// ================================================

const modeArg = process.argv.find(x => x.startsWith("--mode="));
const MODE = modeArg ? modeArg.split("=")[1].toLowerCase() : "daily";

const detailsArg = process.argv.find(x => x.startsWith("--details="));

const DETAILS_LIMIT = !detailsArg
  ? (MODE === "daily" ? Infinity : 5)
  : detailsArg.split("=")[1] === "all"
    ? Infinity
    : Number(detailsArg.split("=")[1]);

if (!["daily", "monthly"].includes(MODE)) {
  throw new Error("Use --mode=daily or --mode=monthly");
}

if (!Number.isInteger(DETAILS_LIMIT) && DETAILS_LIMIT !== Infinity) {
  throw new Error("Invalid details limit");
}

if (DETAILS_LIMIT < 0) {
  throw new Error("Details limit cannot be negative");
}

// ================================================
// PAKISTAN DATE HELPERS
// ================================================

function getPakistanToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const get = type => parts.find(p => p.type === type).value;

  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getTargetDateRange(mode, today) {
  const [year, month, day] = today.split("-").map(Number);

  if (mode === "daily") {
    return {
      startDate: today,
      endDate: addDays(today, 2)
    };
  }

  if (day === 25) {
    const firstNextMonth = new Date(Date.UTC(year, month, 1));
    const lastNextMonth = new Date(Date.UTC(year, month + 1, 0));

    return {
      startDate: firstNextMonth.toISOString().slice(0, 10),
      endDate: lastNextMonth.toISOString().slice(0, 10)
    };
  }

  const lastCurrentMonth = new Date(Date.UTC(year, month, 0));

  return {
    startDate: today,
    endDate: lastCurrentMonth.toISOString().slice(0, 10)
  };
}

// ================================================
// CREX DATE PARSER
// ================================================

function parseCrexDate(dateText, referenceDate = getPakistanToday()) {
  if (!dateText) return null;

  const match = String(dateText).match(
    /(\d{1,2})\s+([A-Za-z]+)(?:,)?\s+(\d{4})?/
  );

  if (!match) return null;

  const day = Number(match[1]);
  const monthText = match[2].slice(0, 3).toLowerCase();

  const months = {
    jan: 0, feb: 1, mar: 2, apr: 3,
    may: 4, jun: 5, jul: 6, aug: 7,
    sep: 8, oct: 9, nov: 10, dec: 11
  };

  const month = months[monthText];

  if (month === undefined || day < 1 || day > 31) {
    return null;
  }

  const reference = new Date(`${referenceDate}T00:00:00Z`);
  const referenceYear = reference.getUTCFullYear();

  const possibleYears = match[3]
    ? [Number(match[3])]
    : [referenceYear - 1, referenceYear, referenceYear + 1];

  const candidates = [];

  for (const year of possibleYears) {
    const date = new Date(Date.UTC(year, month, day));

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month ||
      date.getUTCDate() !== day
    ) {
      continue;
    }

    const iso = date.toISOString().slice(0, 10);
    const difference = Math.abs(date.getTime() - reference.getTime());

    candidates.push({ iso, difference });
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => a.difference - b.difference);
  return candidates[0].iso;
}

// ================================================
// JSON HELPERS
// ================================================

function readJson(file, fallback) {
  try {
    const filePath = path.join(OUTPUT_DIR, file);

    if (!fs.existsSync(filePath)) return fallback;

    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.log(`JSON read warning (${file}): ${error.message}`);
    throw new Error(`${file} is invalid. Backup/fix it before continuing.`);
  }
}

function writeJson(file, data) {
  const filePath = path.join(OUTPUT_DIR, file);
  const tempPath = `${filePath}.tmp`;

  fs.writeFileSync(
    tempPath,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  fs.renameSync(tempPath, filePath);
}

function isEmpty(value) {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;

  if (typeof value === "object") {
    return Object.keys(value).length === 0;
  }

  return false;
}

function mergeNonEmpty(oldObject, newObject) {
  const result = { ...(oldObject || {}) };

  for (const [key, value] of Object.entries(newObject || {})) {
    if (isEmpty(value)) continue;

    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      result[key] = mergeNonEmpty(result[key], value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function mergePlayerArrays(oldPlayers = [], newPlayers = []) {
  const map = new Map();

  for (const player of oldPlayers) {
    const key = String(
      player.id || player.fullName || player.shortName || ""
    );

    if (key) map.set(key, player);
  }

  for (const player of newPlayers) {
    const key = String(
      player.id || player.fullName || player.shortName || ""
    );

    if (!key) continue;

    map.set(
      key,
      mergeNonEmpty(map.get(key), player)
    );
  }

  return Array.from(map.values());
}

// ================================================
// SAFE BROWSER HELPERS
// ================================================

async function waitForBody(page) {
  await page.waitForSelector("body", {
    timeout: PAGE_TIMEOUT
  });
}

async function safePageEvaluate(page, callback, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await waitForBody(page);
      return await page.evaluate(callback);
    } catch (error) {
      lastError = error;

      console.log(
        `Browser retry ${attempt}/${attempts}: ${error.message}`
      );

      await sleep(3000);
    }
  }

  throw lastError;
}

// ================================================
// SCHEDULE PAGE SCRAPER
// ================================================

async function scrapeSchedulePage(page) {
  return safePageEvaluate(page, () => {
    const text = el =>
      (el?.innerText || "").replace(/\s+/g, " ").trim();

    const headings = Array.from(
      document.querySelectorAll("#date-wise-wrap h2.date, h2.date")
    );

    const cards = Array.from(
      document.querySelectorAll(
        "a.match-card-wrapper[href*='match-updates-']"
      )
    );

    function getDateForCard(card) {
      let previousHeading = null;

      for (const heading of headings) {
        const position = heading.compareDocumentPosition(card);

        if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
          previousHeading = heading;
        }
      }

      return text(previousHeading);
    }

    const matches = [];

    for (const a of cards) {
      const href = a.getAttribute("href") || "";
      const idMatch = href.match(/match-updates-([A-Za-z0-9]+)/);

      if (!idMatch) continue;

      const card = a.closest(".match-card-container") || a;

      const teams = Array.from(
        card.querySelectorAll(".team-info .team")
      ).map(team => {
        const img = team.querySelector("img");

        return {
          code: text(team.querySelector(".team-name")),
          name:
            img?.getAttribute("alt") ||
            text(team.querySelector(".team-name")),
          flag: img?.src || "",
          score: text(team.querySelector(".team-score")),
          overs: text(team.querySelector(".total-overs"))
        };
      });

      const resultText = text(card.querySelector(".result"));

      const status = card.querySelector(".liveTag, .result.live")
        ? "LIVE"
        : /won|draw|tie|no result/i.test(resultText)
          ? "COMPLETED"
          : "UPCOMING";

      const timeMatch = text(card).match(
        /\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/i
      );

      const title =
        a.getAttribute("title") ||
        text(card.querySelector(".match-title, .match-name")) ||
        `${teams[0]?.code || "Team 1"} vs ${teams[1]?.code || "Team 2"}`;

      matches.push({
        id: idMatch[1],
        title,
        dateText: getDateForCard(a),
        date: null,
        timeText: timeMatch?.[0] || "",
        detailUrl: new URL(href, location.origin).href,
        status,
        result: resultText,
        teams,
        source: "CREX"
      });
    }

    return {
      matches,
      headings: headings.map(text)
    };
  });
}

// ================================================
// PAGINATION SIGNATURE
// ================================================

async function getScheduleSignature(page) {
  return safePageEvaluate(page, () => {
    const ids = Array.from(
      document.querySelectorAll(
        "a.match-card-wrapper[href*='match-updates-']"
      )
    ).map(a => a.getAttribute("href"));

    const dates = Array.from(
      document.querySelectorAll("h2.date")
    ).map(h => (h.innerText || "").trim());

    return JSON.stringify({ ids, dates });
  });
}

// ================================================
// NEXT PAGE - RETRY AND WAIT
// ================================================

async function clickNextScheduleDate(page) {
  console.log("\nChecking pagination...");

  const before = await getScheduleSignature(page);

  const button = await safePageEvaluate(page, () => {
    const el = document.querySelector(".pagination .next-button");

    return {
      found: !!el,
      disabled: el?.disabled ?? null,
      text: el?.innerText?.trim() || ""
    };
  });

  console.log("Next button:", button);

  if (!button.found || button.disabled) {
    console.log("Next button missing or disabled.");
    return false;
  }

  const clicked = await safePageEvaluate(page, () => {
    const el = document.querySelector(".pagination .next-button");

    if (!el || el.disabled) return false;

    el.scrollIntoView({ block: "center" });
    el.click();

    return true;
  });

  if (!clicked) return false;

  console.log("Next clicked. Waiting up to 90 seconds...");

  const maxAttempts = Math.ceil(PAGINATION_WAIT / 1000);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(1000);

    if (attempt % 10 === 0) {
      console.log(
        `Waiting for next page: ${attempt}/${maxAttempts} seconds`
      );
    }

    try {
      const after = await getScheduleSignature(page);

      if (after !== before) {
        const count = await page.$$eval(
          MATCH_SELECTOR,
          els => els.length
        ).catch(() => 0);

        if (count > 0) {
          await sleep(5000);

          const stableSignature = await getScheduleSignature(page);

          if (stableSignature !== before) {
            console.log("New schedule page loaded.");
            console.log("Match cards:", count);
            return true;
          }
        }
      }
    } catch {
      // DOM transition ke waqt dobara check hoga.
    }
  }

  console.log("Next page did not load within 90 seconds.");

  const diagnostics = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    pagination:
      document.querySelector(".pagination")?.outerHTML || "NOT FOUND",
    cards: document.querySelectorAll(
      "a.match-card-wrapper[href*='match-updates-']"
    ).length
  })).catch(error => ({ error: error.message }));

  console.log("Pagination diagnostics:", diagnostics);
  return false;
}

// ================================================
// MATCH INFO TAB
// ================================================

async function openMatchInfoTab(page) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await waitForBody(page);

      const clicked = await page.evaluate(() => {
        const elements = Array.from(
          document.querySelectorAll("button, a, div, span")
        );

        const tab = elements.find(el =>
          (el.innerText || "").trim().toLowerCase() === "match info"
        );

        if (tab) {
          tab.click();
          return true;
        }

        return false;
      });

      await sleep(3000);

      if (clicked) return true;

    } catch (error) {
      console.log(`Match Info retry ${attempt}: ${error.message}`);
      await sleep(3000);
    }
  }

  return false;
}

// ================================================
// COMPLETE MATCH INFO
// ================================================

async function scrapeMatchInfo(page) {
  return safePageEvaluate(page, () => {
    const text = el =>
      (el?.innerText || "").replace(/\s+/g, " ").trim();

    const getText = selector =>
      text(document.querySelector(selector));

    const getSection = selector =>
      text(document.querySelector(selector));

    const venueDetail = document.querySelector(".venue-detail");

    const dateText = text(
      venueDetail?.querySelector(".match-date") ||
      document.querySelector(".match-date")
    );

    const venue = text(
      venueDetail?.querySelector(".match-venue .venue") ||
      document.querySelector(".match-venue .venue")
    );

    const broadcasterText = getText(".match-broadcaster");

    const broadcasters = broadcasterText
      ? broadcasterText.split(/\s*,\s*/).map(x => x.trim()).filter(Boolean)
      : [];

    const seriesCard = document.querySelector("a.content-wrap.s-wrap");

    const series = seriesCard
      ? {
          format: text(seriesCard.querySelector(".s-format")),
          name: text(seriesCard.querySelector(".s-name")),
          image: seriesCard.querySelector(".s-img")?.src || "",
          url: seriesCard.href || ""
        }
      : {};

    const umpires = Array.from(
      document.querySelectorAll(".umpire-key")
    ).map(key => {
      const parent = key.parentElement;
      const value = parent?.querySelector(".umpire-val");

      return {
        role: text(key),
        name: text(value || key.nextElementSibling)
      };
    }).filter(item => item.role || item.name);

    const toss = getText(".toss-wrap p");

    const weatherElement = document.querySelector(".weather-wrap");

    const weather = weatherElement
      ? {
          details: text(weatherElement),
          venue: text(weatherElement.querySelector(".weather-venue")),
          temperature: text(weatherElement.querySelector(".temperature")),
          condition: text(weatherElement.querySelector(".weather-condition")),
          humidity: text(weatherElement.querySelector(".humidity")),
          rainChance: text(weatherElement.querySelector(".rain-chance"))
        }
      : {};

    const venueStatsElement = document.querySelector("app-venue-stats");

    const venueStats = venueStatsElement
      ? {
          summary: text(venueStatsElement),
          matchCount: text(venueStatsElement.querySelector(".match-count")),
          venuePercentages: Array.from(
            venueStatsElement.querySelectorAll(".venue-per")
          ).map(text),
          averages: Array.from(
            venueStatsElement.querySelectorAll(".venue-avg-val")
          ).map(text),
          tableHeaders: Array.from(
            venueStatsElement.querySelectorAll(".venue-table-head")
          ).map(text),
          scores: Array.from(
            venueStatsElement.querySelectorAll(".venue-score")
          ).map(text)
        }
      : {};

    return {
      dateText,
      venue,
      broadcasters,
      series,
      toss,
      umpires,
      weather,
      venueStats,
      headToHead: getSection("#head-to-head"),
      teamComparison: getSection("#team-comparison"),
      recentMatches: getSection("#recent-matches")
    };
  });
}

// ================================================
// PLAYER SCRAPER
// ================================================

async function scrapeSelectedTeam(page) {
  return safePageEvaluate(page, () => {
    const text = el =>
      (el?.innerText || "").replace(/\s+/g, " ").trim();

    const selectedButton =
      document.querySelector(".playingxi-button.selected") ||
      document.querySelector(".playingxi-button.active");

    const teamCode = text(selectedButton);

    const cards = Array.from(
      document.querySelectorAll(
        ".playingxi-card-row a[href*='/player/']"
      )
    );

    const players = [];

    for (const a of cards) {
      const href = a.getAttribute("href") || "";

      const id = href.match(/\/player\/([^/?#]+)/)?.[1] || "";

      const fullName =
        a.getAttribute("title") ||
        text(a.querySelector(".p-name"));

      const shortName = text(a.querySelector(".p-name"));
      const role = text(a.querySelector(".bat-ball-type"));
      const markerText = text(a);

      const images = Array.from(a.querySelectorAll("img"));

      const vectorImg = images.find(img =>
        (img.getAttribute("src") || "").includes("/players/org/")
      );

      const jerseyImg = images.find(img =>
        (img.getAttribute("src") || "").includes("/jersey/")
      );

      const vector = vectorImg?.src || "";
      const jersey = jerseyImg?.src || "";

      if (!id && !fullName && !shortName) continue;

      players.push({
        id,
        fullName: fullName || shortName,
        shortName,
        role,
        isCaptain: /\(C\)/i.test(markerText),
        isWicketkeeper: /\(WK\)/i.test(markerText),
        vector: vector ? vector.split("?")[0] : "",
        jersey: jersey ? jersey.split("?")[0] : "",
        jerseyCode: jersey.match(/\/([A-Za-z0-9]+)\.png/)?.[1] || "",
        profileUrl: new URL(href, location.origin).href
      });
    }

    return { teamCode, players };
  });
}

// ================================================
// BOTH TEAMS - VERIFY SELECTED BUTTON
// ================================================

async function scrapeTeamsForMatch(page) {
  const buttons = await page.$$eval(
    ".playingxi-button",
    els => els.map((el, index) => ({
      index,
      text: (el.innerText || "").replace(/\s+/g, " ").trim()
    })).filter(item => item.text)
  );

  const teams = {};

  for (const button of buttons.slice(0, 2)) {
    try {
      console.log(`      Selecting team: ${button.text}`);

      await page.evaluate(index => {
        const btn = document.querySelectorAll(".playingxi-button")[index];

        if (btn) {
          btn.scrollIntoView({ block: "center" });
          btn.click();
        }
      }, button.index);

      let selectedCode = "";

      for (let attempt = 0; attempt < 20; attempt++) {
        await sleep(500);

        selectedCode = await page.evaluate(() => {
          const selected =
            document.querySelector(".playingxi-button.selected") ||
            document.querySelector(".playingxi-button.active");

          return (selected?.innerText || "").replace(/\s+/g, " ").trim();
        });

        if (selectedCode === button.text) break;
      }

      if (selectedCode !== button.text) {
        console.log(
          `      Warning: expected ${button.text}, selected ${selectedCode || "none"}`
        );

        continue;
      }

      await sleep(3000);

      const team = await scrapeSelectedTeam(page);
      const code = team.teamCode || selectedCode;

      if (!code) {
        console.log("      Team code unavailable; skipping team.");
        continue;
      }

      if (team.players.length > 0) {
        teams[code] = mergePlayerArrays(
          teams[code] || [],
          team.players
        );
      }

      console.log(`      ${code}: ${team.players.length} players`);

    } catch (error) {
      console.log(
        `      Team ${button.text} error: ${error.message}`
      );
    }
  }

  return teams;
}

// ================================================
// MATCH DETAILS
// ================================================

async function scrapeOneMatch(browser, match) {
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
  );

  await page.setViewport({
    width: 1440,
    height: 1000
  });

  page.setDefaultNavigationTimeout(PAGE_TIMEOUT);
  page.setDefaultTimeout(30000);

  const output = {
    id: match.id,
    detailUrl: match.detailUrl,
    matchInfo: {},
    teams: {},
    scrapedAt: new Date().toISOString()
  };

  try {
    let loaded = false;

    for (let attempt = 1; attempt <= DETAIL_RETRIES; attempt++) {
      try {
        console.log(`      Loading match page (${attempt}/${DETAIL_RETRIES})...`);

        await page.goto(match.detailUrl, {
          waitUntil: "domcontentloaded",
          timeout: PAGE_TIMEOUT
        });

        await waitForBody(page);
        await sleep(DETAIL_LOAD_WAIT);

        loaded = true;
        break;

      } catch (error) {
        console.log(`      Navigation retry: ${error.message}`);
        await sleep(5000);
      }
    }

    if (!loaded) {
      throw new Error("Match page could not load after retries");
    }

    await openMatchInfoTab(page);
    await sleep(3000);

    try {
      output.matchInfo = await scrapeMatchInfo(page);
    } catch (error) {
      console.log("      Match Info error:", error.message);
    }

    await sleep(3000);

    let xiFound = await page.$(".playingxi-button");

    if (!xiFound) {
      console.log("      Waiting for Playing XI...");

      await page.waitForSelector(".playingxi-button", {
        timeout: 30000
      }).catch(() => {});

      xiFound = await page.$(".playingxi-button");
    }

    if (xiFound) {
      output.teams = await scrapeTeamsForMatch(page);
    } else {
      console.log("      Playing XI not available.");
    }

  } catch (error) {
    output.error = error.message;
    console.log(`      Match ${match.id}: ${error.message}`);

  } finally {
    await page.close().catch(() => {});
  }

  return output;
}

// ================================================
// MERGE MATCH DETAILS
// ================================================

function mergeMatchDetails(oldDetails, newDetails, match) {
  const oldData = oldDetails || {};

  const mergedInfo = mergeNonEmpty(
    oldData.matchInfo,
    newDetails.matchInfo
  );

  const mergedTeams = { ...(oldData.teams || {}) };

  for (const [teamCode, newPlayers] of Object.entries(newDetails.teams || {})) {
    mergedTeams[teamCode] = mergePlayerArrays(
      mergedTeams[teamCode] || [],
      newPlayers || []
    );
  }

  return {
    ...oldData,
    ...newDetails,
    id: match.id,
    detailUrl: match.detailUrl,
    date: match.date,
    title: match.title,
    matchInfo: mergedInfo,
    teams: mergedTeams
  };
}

// ================================================
// MAIN
// ================================================

(async () => {
  const today = getPakistanToday();
  const { startDate, endDate } = getTargetDateRange(MODE, today);

  console.log("================================");
  console.log("CREX DAILY SCRAPER");
  console.log("Pakistan date:", today);
  console.log("Mode:", MODE);
  console.log("Target start:", startDate);
  console.log("Target end:", endDate);
  console.log("Details limit:", DETAILS_LIMIT);
  console.log("Page timeout:", PAGE_TIMEOUT / 1000, "seconds");
  console.log("Pagination wait:", PAGINATION_WAIT / 1000, "seconds");
  console.log("================================");

  let browser;

  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox"
      ]
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
    );

    await page.setViewport({
      width: 1440,
      height: 1000
    });

    page.setDefaultNavigationTimeout(PAGE_TIMEOUT);
    page.setDefaultTimeout(30000);

    console.log("Opening CREX schedule...");

    await page.goto(SCHEDULE_URL, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_TIMEOUT
    });

    await waitForBody(page);
    await sleep(PAGE_LOAD_WAIT);

    const matchMap = new Map();

    // --------------------------------------------
    // DATE-WISE PAGINATION
    // --------------------------------------------

    let pageNo = 0;
    let reachedEnd = false;

    while (pageNo < MAX_SAFETY_PAGES) {
      pageNo++;

      const found = await scrapeSchedulePage(page);

      console.log(`\nSCHEDULE PAGE ${pageNo}`);
      console.log(
        "Date headings:",
        found.headings.join(" | ") || "Not found"
      );

      if (found.matches.length === 0) {
        console.log("No match cards found. Stopping safely.");
        break;
      }

      let added = 0;
      let updated = 0;

      for (const match of found.matches) {
        const parsedDate = parseCrexDate(match.dateText, today);

        if (!parsedDate) {
          console.log(
            `Skipping unknown date: ${match.title} (${match.dateText})`
          );
          continue;
        }

        if (parsedDate < startDate || parsedDate > endDate) {
          continue;
        }

        match.date = parsedDate;

        if (matchMap.has(match.id)) {
          matchMap.set(match.id, {
            ...matchMap.get(match.id),
            ...match
          });

          updated++;
        } else {
          matchMap.set(match.id, match);
          added++;
        }
      }

      console.log(
        `Visible: ${found.matches.length} | Added: ${added} | Updated: ${updated} | Total: ${matchMap.size}`
      );

      const pageDates = [
        ...found.headings.map(h => parseCrexDate(h, today)),
        ...found.matches.map(m => parseCrexDate(m.dateText, today))
      ].filter(Boolean);

      if (pageDates.some(date => date > endDate)) {
        reachedEnd = true;
        console.log(`Target end date ${endDate} reached.`);
        break;
      }

      const moved = await clickNextScheduleDate(page);

      if (!moved) {
        console.log("Pagination stopped before target was confirmed.");
        break;
      }

      await sleep(5000);
    }

    await page.close();

    // --------------------------------------------
    // FRESH SCHEDULE
    // --------------------------------------------

    const freshSchedule = Array.from(matchMap.values())
      .sort((a, b) => a.date.localeCompare(b.date));

    console.log("\nDATE FILTER SUMMARY");
    console.log("Mode:", MODE);
    console.log("Pakistan today:", today);
    console.log("Target start:", startDate);
    console.log("Target end:", endDate);
    console.log("Reached target end:", reachedEnd);
    console.log("Fresh matches:", freshSchedule.length);

    if (freshSchedule.length) {
      console.log("First date:", freshSchedule[0].date);
      console.log("Last date:", freshSchedule[freshSchedule.length - 1].date);
    }

    // --------------------------------------------
    // SAFETY CHECK
    // --------------------------------------------

    if (!reachedEnd || freshSchedule.length === 0) {
      throw new Error(
        "Schedule incomplete. Existing JSON files have not been replaced. Run again."
      );
    }

    // --------------------------------------------
    // LOAD EXISTING DETAILS
    // --------------------------------------------

    const matchTeams = readJson("match-teams.json", {});
    const players = readJson("players.json", {});

    // --------------------------------------------
    // SCRAPE ALL MATCH DETAILS
    // --------------------------------------------

    const selected = freshSchedule.slice(0, DETAILS_LIMIT);

    console.log(`\nProcessing details: ${selected.length}`);

    for (let i = 0; i < selected.length; i++) {
      const match = selected[i];

      console.log(
        `\n[${i + 1}/${selected.length}] ${match.title} | ${match.date}`
      );

      const details = await scrapeOneMatch(browser, match);

      matchTeams[match.id] = mergeMatchDetails(
        matchTeams[match.id],
        details,
        match
      );

      for (const [teamCode, teamPlayers] of Object.entries(details.teams || {})) {
        for (const player of teamPlayers) {
          const playerId = player.id || player.fullName;

          if (!playerId) continue;

          players[playerId] = mergeNonEmpty(
            players[playerId] || {},
            {
              ...player,
              teamCode
            }
          );
        }
      }

      // Save after each match so progress is not lost.
      writeJson("match-teams.json", matchTeams);
      writeJson("players.json", players);

      console.log(
        `Saved details. Master players: ${Object.keys(players).length}`
      );

      await sleep(3000);
    }

    // --------------------------------------------
    // FINAL SCHEDULE - EXACT TARGET RANGE
    // --------------------------------------------

    const finalSchedule = freshSchedule
      .filter(match =>
        match.date >= startDate &&
        match.date <= endDate
      )
      .sort((a, b) => a.date.localeCompare(b.date));

    const uniqueSchedule = Array.from(
      new Map(
        finalSchedule.map(match => [String(match.id), match])
      ).values()
    );

    if (uniqueSchedule.length === 0) {
      throw new Error("No valid matches found. Schedule was not replaced.");
    }

    writeJson("match-schedule.json", uniqueSchedule);
    writeJson("match-teams.json", matchTeams);
    writeJson("players.json", players);

    console.log("\n========== COMPLETE ==========");
    console.log("Mode:", MODE);
    console.log("Target:", `${startDate} to ${endDate}`);
    console.log("Fixtures:", uniqueSchedule.length);
    console.log("Reached target end:", reachedEnd);
    console.log("Details processed:", selected.length);
    console.log("Player records:", Object.keys(players).length);
    console.log("Updated: match-schedule.json");
    console.log("Updated: match-teams.json");
    console.log("Updated: players.json");

  } catch (error) {
    console.error("\nSCRAPER ERROR:", error.message);
    process.exitCode = 1;

  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
})();
