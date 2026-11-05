/**
 * FINAL - PHASE 2: ALL SCHEDULES PLAYERS + TEAMS + TODAY RUNNING + API + SCOREBOARD MAP
 * 
 * Step 1 DONE: 1 match DUB vs EMB 14Z9 -> 30 players (players.json) via /match-details trick
 * 
 * Step 2 NOW: All schedules today (jo chal raha hai) + 1 month ka players teams nikalna
 * - Fetch https://crex.com/schedule (Today + upcoming)
 * - For each detailUrl + /match-details -> team1 + team2 players vectors jerseys team names
 * - Save with today's date: players.json master + match-teams.json + match-schedule.json
 * 
 * Step 3: API + Scoreboard attach + map
 * - API: https://api.goscorer.com/api/v3/getSV3?key=12JH -> p: MWK etc
 * - Map: MWK -> players.json[MWK] -> vector + jersey + teamCode
 * - Scoreboard: live-data.json -> scoreboard.html
 * 
 * Step 4: Play
 */

const fs = require('fs');

async function getBrowser() {
    try {
        const puppeteer = require('puppeteer-core');
        return await puppeteer.launch({ headless: 'new', channel: 'chrome', args: ['--no-sandbox'] });
    } catch {
        const puppeteer = require('puppeteer');
        return await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    }
}

(async () => {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 Chrome/120.0.0.0');
    await page.setViewport({ width: 1920, height: 1080 });

    console.log('📅 PHASE 2: ALL SCHEDULES - Today jo chal raha hai + 1 month');
    console.log('📡 Fetching https://crex.com/schedule');
    await page.goto('https://crex.com/schedule', { waitUntil: 'networkidle2', timeout: 120000 });
    await new Promise(r => setTimeout(r, 12000));

    // Collect all matches today (no filter first, then filter)
    console.log('\n📄 Collecting ALL schedules today...');
    
    let allMatches = [];
    let pageNum = 0;
    const maxPages = 8;

    while (pageNum < maxPages) {
        pageNum++;
        console.log(`\n📄 Page ${pageNum}...`);
        
        const matchesRaw = await page.evaluate(() => {
            const res = [];
            document.querySelectorAll('a[href*="match-updates-"]').forEach(a => {
                const href = a.getAttribute('href') || '';
                const idMatch = href.match(/match-updates-([A-Za-z0-9]+)/);
                if (!idMatch) return;
                const id = idMatch[1];
                const title = a.getAttribute('title') || a.innerText || '';
                const detailUrl = href.startsWith('http') ? href : `https://crex.com${href}`;
                const cleanDetailUrl = detailUrl.split('?')[0].split('#')[0].replace(/\/match-details.*/, '');
                
                let timeText = '';
                const card = a.closest('li, div') || a.parentElement;
                if (card) {
                    const tm = card.innerText.match(/\d{1,2}:\d{2}\s*(AM|PM)/i);
                    if (tm) timeText = tm[0];
                }
                
                let dateHeader = '';
                const headings = Array.from(document.querySelectorAll('h2,h3'));
                headings.forEach(h => {
                    if (h.innerText && (h.innerText.includes('Today') || h.innerText.match(/\d{1,2}\s*\w+/))) {
                        dateHeader = h.innerText;
                    }
                });

                res.push({ id, href, detailUrl: cleanDetailUrl, title: title.trim(), timeText, dateHeader });
            });
            return res;
        });

        console.log(`  Raw: ${matchesRaw.length}`);

        for (const m of matchesRaw) {
            if (!m.id || allMatches.find(x => x.id === m.id)) continue;
            
            // Keep all for now, including DUB vs EMB domestic for today test
            const todayStr = new Date().toISOString().split('T')[0];
            
            allMatches.push({
                id: m.id,
                slug: m.href.split('/').filter(Boolean).pop()?.replace(/-match-updates-.*/, '') || m.id,
                detailUrl: m.detailUrl,
                directMatchDetailsUrl: m.detailUrl + '/match-details', // GOLD TRICK!
                title: m.title,
                matchTime: m.timeText || 'TBD',
                date: todayStr,
                dateHeader: m.dateHeader || 'Today',
                isToday: m.dateHeader.toLowerCase().includes('today') || true, // Assume today for test
                isInternational: !(m.title.toLowerCase().includes('emirates d20') || m.title.toLowerCase().includes('toronto') || m.title.toLowerCase().includes('dolphins')),
                timestamp: Date.now()
            });
        }

        console.log(`  Total collected: ${allMatches.length}`);

        const hasNext = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, a'));
            const nxt = btns.find(b => b.innerText && (b.innerText.trim() === 'Next' || b.innerText === '>' || b.innerText === '›') && !b.disabled);
            if (nxt) { nxt.click(); return true; }
            return false;
        });
        if (!hasNext) break;
        await new Promise(r => setTimeout(r, 5000));
    }

    allMatches = allMatches.filter((v,i,a) => a.findIndex(x => x.id === v.id) === i);
    
    // Fallback if no matches - use your DUB vs EMB 14Z9 + add few more
    if (allMatches.length === 0) {
        allMatches = [{
            id: "14Z9",
            slug: "dub-vs-emb-2nd-semi-final-emirates-d20-league-2026",
            detailUrl: "https://crex.com/cricket-live-score/dub-vs-emb-2nd-semi-final-emirates-d20-league-2026-match-updates-14Z9",
            directMatchDetailsUrl: "https://crex.com/cricket-live-score/dub-vs-emb-2nd-semi-final-emirates-d20-league-2026-match-updates-14Z9/match-details",
            title: "DUB Vs EMB, 2nd Semi Final",
            matchTime: "9:30 PM",
            date: new Date().toISOString().split('T')[0],
            dateHeader: "Today",
            isToday: true,
            isInternational: false,
            timestamp: Date.now()
        }];
    }

    console.log(`\n✅ TOTAL SCHEDULES: ${allMatches.length} (Today + upcoming)`);
    allMatches.forEach(m => console.log(`  - ${m.id}: ${m.title} @ ${m.matchTime} | Today: ${m.isToday} | ${m.directMatchDetailsUrl}`));

    // Save schedule with today's date
    fs.writeFileSync('match-schedule.json', JSON.stringify(allMatches, null, 2));
    console.log(`\n✅ Saved match-schedule.json: ${allMatches.length} matches`);

    // PHASE 2: For each schedule, extract players teams vectors jerseys via /match-details
    console.log(`\n🎯 PHASE 2: Extracting players for ${Math.min(allMatches.length, 10)} schedules via /match-details trick...`);
    const limit = process.argv.includes('--full') ? allMatches.length : Math.min(10, allMatches.length);
    
    // Load existing players.json (your 30 players from Phase 1)
    let masterPlayers = {};
    try {
        masterPlayers = JSON.parse(fs.readFileSync('players.json', 'utf8'));
        console.log(`📂 Existing players.json: ${Object.keys(masterPlayers).length} players from Phase 1 (DUB vs EMB)`);
    } catch {
        console.log('📂 No existing players.json, starting fresh');
    }

    let matchTeams = {};
    try {
        matchTeams = JSON.parse(fs.readFileSync('match-teams.json', 'utf8'));
    } catch {}

    for (let i = 0; i < limit; i++) {
        const match = allMatches[i];
        const directUrl = match.directMatchDetailsUrl;
        console.log(`\n[${i+1}/${limit}] ${match.id}: ${match.title} -> ${directUrl}`);

        const detailPage = await browser.newPage();
        await detailPage.setUserAgent('Mozilla/5.0 Chrome/120.0.0.0');
        
        try {
            await detailPage.goto(directUrl, { waitUntil: 'networkidle2', timeout: 80000 });
            await new Promise(r => setTimeout(r, 12000));
            await detailPage.evaluate(() => window.scrollTo(0, 400));
            await new Promise(r => setTimeout(r, 2000));

            await detailPage.waitForSelector('.playingxi-card', { timeout: 20000 }).catch(() => console.log('  ⚠️ playingxi-card timeout'));

            const scrapeTeam = async () => {
                return await detailPage.evaluate(() => {
                    const map = {};
                    let teamCode = '';
                    const activeBtn = document.querySelector('.playingxi-button.selected, .playingxi-button.active, .playingxi-button[class*="selected"]') || document.querySelector('.playingxi-button');
                    if (activeBtn) teamCode = activeBtn.innerText.trim();
                    
                    document.querySelectorAll('.playingxi-card-row a').forEach(a => {
                        const href = a.getAttribute('href') || '';
                        if (!href.includes('/player/')) return;
                        const id = href.split('-').pop();
                        if (!id || id.length > 6) return;
                        const short = a.querySelector('.p-name')?.innerText?.trim() || '';
                        const full = a.getAttribute('title') || short;
                        let vector = '', jersey = '';
                        a.querySelectorAll('img').forEach(img => {
                            if (img.src.includes('/players/org/')) vector = img.src.split('?')[0];
                            if (img.src.includes('/jersey/')) jersey = img.src.split('?')[0];
                        });
                        if (short && id) {
                            map[id] = {
                                id, short, full,
                                vector: vector || `https://cricketvectors.akamaized.net/players/org/${id}.png`,
                                jersey: jersey || `https://cricketvectors.akamaized.net/jersey/limited/org/AD.png`,
                                jerseyCode: jersey ? jersey.split('/').pop()?.replace('.png','') || 'AD' : 'AD',
                                teamCode, teamName: teamCode,
                                href, detailUrl: window.location.href,
                                date: new Date().toISOString().split('T')[0]
                            };
                        }
                    });
                    return { map, teamCode };
                });
            };

            // Team 1
            await detailPage.evaluate(() => { const b = document.querySelectorAll('.playingxi-button')[0]; if(b) b.click(); });
            await new Promise(r => setTimeout(r, 3500));
            const t1 = await scrapeTeam();
            console.log(`  ${t1.teamCode || 'Team1'}: ${Object.keys(t1.map).length} players - jersey ${Object.values(t1.map)[0]?.jerseyCode || '?'}`);

            // Team 2
            await detailPage.evaluate(() => { const b = document.querySelectorAll('.playingxi-button')[1]; if(b) b.click(); });
            await new Promise(r => setTimeout(r, 3500));
            const t2 = await scrapeTeam();
            console.log(`  ${t2.teamCode || 'Team2'}: ${Object.keys(t2.map).length} players - jersey ${Object.values(t2.map)[0]?.jerseyCode || '?'}`);

            // Bench
            let benchMap = {};
            try {
                const hasBench = await detailPage.evaluate(() => !!document.querySelector('.bench-toggle, [class*="bench"]'));
                if (hasBench) {
                    await detailPage.evaluate(() => { const b = document.querySelector('.bench-toggle'); if(b) b.click(); });
                    await new Promise(r => setTimeout(r, 2500));
                    const bench = await scrapeTeam();
                    benchMap = bench.map;
                    console.log(`  BENCH: ${Object.keys(benchMap).length}`);
                }
            } catch {}

            const allPlayersForMatch = { ...t1.map, ...t2.map, ...benchMap };
            Object.assign(masterPlayers, allPlayersForMatch);

            // Save with today's date mapping
            matchTeams[match.id] = {
                matchId: match.id,
                slug: match.slug,
                title: match.title,
                detailUrl: match.detailUrl,
                directUrl,
                date: match.date,
                isToday: match.isToday,
                team1: { code: t1.teamCode, name: t1.teamCode, jerseyCode: Object.values(t1.map)[0]?.jerseyCode || '', playerIds: Object.keys(t1.map), count: Object.keys(t1.map).length, players: t1.map },
                team2: { code: t2.teamCode, name: t2.teamCode, jerseyCode: Object.values(t2.map)[0]?.jerseyCode || '', playerIds: Object.keys(t2.map), count: Object.keys(t2.map).length, players: t2.map },
                benchIds: Object.keys(benchMap),
                totalPlayers: Object.keys(allPlayersForMatch).length,
                allPlayerIds: Object.keys(allPlayersForMatch)
            };

            console.log(`  Progress: Master ${Object.keys(masterPlayers).length} players`);

            // Save incremental with today's date
            fs.writeFileSync('players.json', JSON.stringify(masterPlayers, null, 2));
            fs.writeFileSync('match-teams.json', JSON.stringify(matchTeams, null, 2));
            fs.writeFileSync(`players-${match.date}.json`, JSON.stringify(masterPlayers, null, 2));

        } catch (e) {
            console.log(`  ❌ ${match.id} failed: ${e.message}`);
            matchTeams[match.id] = { matchId: match.id, title: match.title, error: e.message, date: match.date };
        } finally {
            await detailPage.close();
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    console.log(`\n✅ FINAL PHASE 2:`);
    console.log(`- match-schedule.json: ${allMatches.length} schedules (Today jo chal raha hai + upcoming)`);
    console.log(`- players.json: ${Object.keys(masterPlayers).length} players master (all teams vectors + jerseys + teamCode + jerseyCode + date)`);
    console.log(`- match-teams.json: ${Object.keys(matchTeams).length} matches mapping (kaunse match me kaunsi team ke kaunse players)`);
    console.log(`- players-${new Date().toISOString().split('T')[0]}.json: Today's dated copy`);

    console.log(`\n🎯 NEXT: API + SCOREBOARD ATTACH + MAP + PLAY`);
    console.log(`1. live-scraper.js: API p: "MWK" -> players.json["MWK"] -> MWK.png + DD.png + EMB`);
    console.log(`2. match-teams.json["14Z9"]: team1=DUB DE, team2=EMB DD -> only show those vectors`);
    console.log(`3. live-data.json -> scoreboard.html -> fixed flags DE/DD + vectors + jerseys`);
    console.log(`4. GitHub: schedule.yml hourly + live.yml every 3 min -> Cloudflare auto deploy -> OBS -> YT stream PLAY!`);

    await browser.close();
})();
