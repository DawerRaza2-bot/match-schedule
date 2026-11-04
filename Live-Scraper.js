const fs = require('fs');
const path = require('path');

const SCHEDULE_FILE = path.join(__dirname, 'match-schedule.json');
const LIVE_FILE = path.join(__dirname, 'live-data.json');

async function scrapeLiveMatches() {
    const puppeteer = require('puppeteer-core');
    console.log('Using puppeteer-core for live scraping - FIXED');

    let schedule = [];
    try {
        if (fs.existsSync(SCHEDULE_FILE)) {
            schedule = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
            console.log(`Loaded schedule: ${schedule.length} matches (International 1 month)`);
        }
    } catch(e) {
        console.log('Schedule read error:', e.message);
    }

    // Find LIVE matches
    let liveMatches = schedule.filter(m => {
        const time = (m.matchTime || '').toLowerCase();
        const status = (m.matchStatus || '').toLowerCase();
        return time === 'live' || status === 'live' || status.includes('live') || time.includes('live');
    }).slice(0,3);

    console.log(`Found ${liveMatches.length} Live INTERNATIONAL matches from schedule`);

    // FIXED CHROME LAUNCH - Works with browser-actions/setup-chrome@v1
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            channel: 'chrome',
            args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-features=VizDisplayCompositor']
        });
        console.log('Browser launched with channel: chrome');
    } catch(err1) {
        console.log('First launch failed (channel chrome):', err1.message);
        try {
            // Try with executablePath from env (setup-chrome provides it)
            const execPath = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || null;
            console.log('Trying with executablePath:', execPath);
            browser = await puppeteer.launch({
                headless: 'new',
                executablePath: execPath || undefined,
                args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']
            });
            console.log('Browser launched with executablePath');
        } catch(err2) {
            console.log('Second launch failed:', err2.message);
            // Final fallback - no channel, no executablePath (for puppeteer full)
            browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']
            });
            console.log('Browser launched with fallback');
        }
    }

    try {
        if (liveMatches.length === 0) {
            // NO LIVE - Write count:0 with NEXT match info for countdown - FIXED TIME
            let nextMatch = null;
            if (schedule.length > 0) {
                const now = new Date();
                const upcoming = schedule.filter(m => {
                    try { 
                        const d = new Date(m.date);
                        return !isNaN(d.getTime()) && d >= now; 
                    } catch(e) { return true; }
                }).sort((a,b) => new Date(a.date) - new Date(b.date));
                nextMatch = upcoming[0] || schedule[0];
            }

            // Fix matchTime if it's "1st", "2nd", etc - replace with real time or default
            if (nextMatch) {
                const mt = (nextMatch.matchTime || '').toLowerCase();
                if (['1st','2nd','3rd','1st,','2nd,','3rd,'].includes(mt) || mt.match(/^\d+(st|nd|rd|th)$/)) {
                    nextMatch.matchTime = '10:00 AM';
                    console.log(`Fixed matchTime from "${mt}" to "10:00 AM"`);
                }
            }

            const emptyData = { 
                updatedAt: new Date().toISOString(), 
                count: 0, 
                matches: [],
                nextMatch: nextMatch ? {
                    id: nextMatch.id,
                    team1: nextMatch.team1?.name || nextMatch.team1,
                    team2: nextMatch.team2?.name || nextMatch.team2,
                    date: nextMatch.date,
                    matchTime: nextMatch.matchTime,
                    seriesInfo: nextMatch.seriesInfo,
                    detailUrl: nextMatch.detailUrl,
                    team1Flag: nextMatch.team1?.flagUrl || '',
                    team2Flag: nextMatch.team2?.flagUrl || ''
                } : null,
                message: nextMatch ? `Next: ${nextMatch.team1?.name || nextMatch.team1} vs ${nextMatch.team2?.name || nextMatch.team2} on ${nextMatch.date} at ${nextMatch.matchTime}` : 'No live international currently',
                isTest: false
            };
            
            fs.writeFileSync(LIVE_FILE, JSON.stringify(emptyData, null, 2));
            console.log(`\n✅ NO LIVE - Written count:0 with next match: ${emptyData.message}`);
            console.log(`⏰ Countdown will show on scoreboard`);
            await browser.close();
            return;
        }

        const allLiveData = [];

        for (let match of liveMatches) {
            const url = match.detailUrl;
            console.log(`\n📡 Scraping LIVE: ${match.team1?.name || ''} vs ${match.team2?.name || ''} - ${url}`);
            
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
            await page.setViewport({ width: 1920, height: 1080 });
            
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await new Promise(r => setTimeout(r, 8000));

                const data = await page.evaluate(() => {
                    const getText = (sel) => document.querySelector(sel)?.innerText?.trim() || "";
                    let series = getText('.name-wrapper span') || getText('.series-name') || document.querySelector('h1')?.innerText || "";
                    const teamInnings = document.querySelectorAll('.team-inning');
                    let t1Flag = "", t2Flag = "", t1Name = "", t2Name = "", score = "0/0";
                    if (teamInnings.length > 0) {
                        t1Flag = teamInnings[0].querySelector('img')?.src || "";
                        t1Name = teamInnings[0].querySelector('.team-name')?.innerText?.trim() || "";
                        score = teamInnings[0].querySelector('.runs.f-runs span')?.innerText?.trim() || "0/0";
                    }
                    const headerImgs = document.querySelectorAll('.team-img img, .team-logo img, app-match-header img, .team img');
                    if (!t1Flag && headerImgs.length > 0) t1Flag = headerImgs[0]?.src || "";
                    if (headerImgs.length > 1) t2Flag = headerImgs[1]?.src || "";
                    if (teamInnings.length > 1) {
                        if (!t2Flag) t2Flag = teamInnings[1].querySelector('img')?.src || "";
                        t2Name = teamInnings[1].querySelector('.team-name')?.innerText?.trim() || "";
                    }
                    const nameBlocks = document.querySelectorAll('.team-name');
                    if (!t1Name && nameBlocks.length > 0) t1Name = nameBlocks[0].innerText.trim();
                    if (!t2Name && nameBlocks.length > 1) t2Name = nameBlocks[1].innerText.trim();
                    let comment = getText('.team-result .result-box') || getText('.final-result') || "LIVE MATCH";
                    let overNum = "0", ballNum = "0";
                    const liveOversText = getText('.team-inning .runs.f-runs span.over-text') || "";
                    const overMatch = liveOversText.match(/(\d+)\.(\d+)/);
                    if (overMatch) { overNum = overMatch[1]; ballNum = overMatch[2]; }
                    const pships = document.querySelectorAll('app-match-live-player .batsmen-partnership');
                    const b1Node = pships[0];
                    const b1Name = b1Node?.querySelector('.batsmen-name p')?.innerText?.trim() || "";
                    const b1Runs = b1Node?.querySelector('.batsmen-score p:nth-child(1)')?.innerText?.trim() || "0";
                    const b1Balls = b1Node?.querySelector('.batsmen-score p:nth-child(2)')?.innerText?.replace(/[()]/g, '').trim() || "0";
                    const b1Fours = b1Node?.querySelectorAll('.player-strike-wrapper .strike-rate span')[1]?.innerText?.trim() || "0";
                    const b1Sixes = b1Node?.querySelectorAll('.player-strike-wrapper .strike-rate span')[3]?.innerText?.trim() || "0";
                    const b1Sr = b1Node?.querySelectorAll('.player-strike-wrapper .strike-rate span')[5]?.innerText?.trim() || "0.00";
                    const b1Vector = b1Node?.querySelector('app-player-profile-img img:not(.mr-top)')?.src || "";
                    const b1Jersey = b1Node?.querySelector('app-player-profile-img img.mr-top')?.src || "";
                    const b2Node = pships[1];
                    const b2Name = b2Node?.querySelector('.batsmen-name p')?.innerText?.trim() || "";
                    const b2Runs = b2Node?.querySelector('.batsmen-score p:nth-child(1)')?.innerText?.trim() || "0";
                    const b2Balls = b2Node?.querySelector('.batsmen-score p:nth-child(2)')?.innerText?.replace(/[()]/g, '').trim() || "0";
                    const b2Fours = b2Node?.querySelectorAll('.player-strike-wrapper .strike-rate span')[1]?.innerText?.trim() || "0";
                    const b2Sixes = b2Node?.querySelectorAll('.player-strike-wrapper .strike-rate span')[3]?.innerText?.trim() || "0";
                    const b2Sr = b2Node?.querySelectorAll('.player-strike-wrapper .strike-rate span')[5]?.innerText?.trim() || "0.00";
                    const b2Vector = b2Node?.querySelector('app-player-profile-img img:not(.mr-top)')?.src || "";
                    const b2Jersey = b2Node?.querySelector('app-player-profile-img img.mr-top')?.src || "";
                    const bowlNode = pships[2];
                    const bowlName = bowlNode?.querySelector('.batsmen-name p')?.innerText?.trim() || "";
                    const bowlFigs = bowlNode?.querySelector('.batsmen-score p:nth-child(1)')?.innerText?.trim() || "0-0";
                    const bowlOvs = bowlNode?.querySelector('.batsmen-score p:nth-child(2)')?.innerText?.replace(/[()]/g, '').trim() || "0.0";
                    const bowlEcon = bowlNode?.querySelectorAll('.player-strike-wrapper .strike-rate span')[1]?.innerText?.trim() || "0.00";
                    const bowlVector = bowlNode?.querySelector('app-player-profile-img img:not(.mr-top)')?.src || "";
                    const bowlJersey = bowlNode?.querySelector('app-player-profile-img img.mr-top')?.src || "";
                    return {
                        series, team1Name: t1Name, team1Flag: t1Flag, team1Score: score, team2Name: t2Name, team2Flag: t2Flag,
                        commentary: comment, currentOver: overNum, currentBall: ballNum,
                        batsman1: { name: b1Name, runs: b1Runs, balls: b1Balls, fours: b1Fours, sixes: b1Sixes, sr: b1Sr, vector: b1Vector, jersey: b1Jersey },
                        batsman2: { name: b2Name, runs: b2Runs, balls: b2Balls, fours: b2Fours, sixes: b2Sixes, sr: b2Sr, vector: b2Vector, jersey: b2Jersey },
                        bowler: { name: bowlName, figures: bowlFigs, overs: bowlOvs, econ: bowlEcon, vector: bowlVector, jersey: bowlJersey },
                        isLive: true
                    };
                });

                allLiveData.push({
                    id: match.id, detailUrl: url, date: match.date, seriesInfo: match.seriesInfo || data.series,
                    team1: { name: match.team1?.name || data.team1Name, flagUrl: match.team1?.flagUrl || data.team1Flag },
                    team2: { name: match.team2?.name || data.team2Name, flagUrl: match.team2?.flagUrl || data.team2Flag },
                    live: data, scrapedAt: new Date().toISOString()
                });
                console.log(`✅ Scraped: ${data.team1Name} ${data.team1Score}`);

            } catch (err) {
                console.log(`❌ Failed ${url}: ${err.message}`);
            } finally {
                await page.close();
            }
        }

        const finalJson = { 
            updatedAt: new Date().toISOString(), 
            count: allLiveData.length, 
            matches: allLiveData,
            message: allLiveData.length > 0 ? `Live: ${allLiveData.length} INTERNATIONAL matches` : 'No international live currently',
            isTest: false
        };
        fs.writeFileSync(LIVE_FILE, JSON.stringify(finalJson, null, 2));
        console.log(`\n✅ FINAL LIVE-DATA: ${allLiveData.length} INTERNATIONAL matches saved`);

    } catch (err) {
        console.error('Live scraper error:', err.message);
        // Write countdown file even on error if schedule exists
        try {
            if (fs.existsSync(SCHEDULE_FILE)) {
                const sched = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
                const next = sched[0];
                if (next) {
                    if (next.matchTime === '1st' || next.matchTime === '2nd') next.matchTime = '10:00 AM';
                    fs.writeFileSync(LIVE_FILE, JSON.stringify({
                        updatedAt: new Date().toISOString(),
                        count: 0,
                        matches: [],
                        nextMatch: {
                            id: next.id,
                            team1: next.team1?.name || next.team1,
                            team2: next.team2?.name || next.team2,
                            date: next.date,
                            matchTime: next.matchTime,
                            seriesInfo: next.seriesInfo,
                            detailUrl: next.detailUrl
                        },
                        message: `Next: ${next.team1?.name || next.team1} vs ${next.team2?.name || next.team2} on ${next.date}`,
                        error: err.message
                    }, null, 2));
                    console.log('Wrote fallback countdown file');
                }
            } else {
                throw err;
            }
        } catch(e2) {
            fs.writeFileSync(LIVE_FILE, JSON.stringify({ updatedAt: new Date().toISOString(), count: 0, matches: [], message: 'No live - error: ' + err.message }, null, 2));
        }
    } finally {
        if (browser) await browser.close();
    }
}

scrapeLiveMatches();
