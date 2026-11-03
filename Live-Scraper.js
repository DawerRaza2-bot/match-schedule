const fs = require('fs');
const path = require('path');

const SCHEDULE_FILE = path.join(__dirname, 'match-schedule.json');
const LIVE_FILE = path.join(__dirname, 'live-data.json');

async function scrapeLiveMatches() {
    const puppeteer = require('puppeteer-core');
    console.log('Using puppeteer-core for live scraping - TEST ALL MATCHES MODE');

    let schedule = [];
    try {
        if (fs.existsSync(SCHEDULE_FILE)) {
            schedule = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
            console.log(`Loaded schedule: ${schedule.length} matches`);
        }
    } catch(e) {
        console.log('Schedule read error:', e.message);
    }

    // For TEST mode: get ALL Live matches from schedule, no filter
    let liveMatches = schedule.filter(m => {
        const time = (m.matchTime || '').toLowerCase();
        const status = (m.matchStatus || '').toLowerCase();
        return time === 'live' || status === 'live' || status.includes('live') || time.includes('live');
    });

    console.log(`Found ${liveMatches.length} Live matches from schedule file (ALL TYPES - for testing)`);

    // Also try direct from crex.com
    const browser = await puppeteer.launch({
        headless: 'new',
        channel: 'chrome',
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu']
    }).catch(() => puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] }));

    try {
        if (liveMatches.length === 0) {
            console.log('No live in schedule file, checking https://crex.com/schedule for LIVE badges directly...');
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
            await page.goto('https://crex.com/schedule', { waitUntil: 'domcontentloaded', timeout: 60000 });
            await new Promise(r => setTimeout(r, 8000));

            const directLive = await page.evaluate(() => {
                const results = [];
                const cards = document.querySelectorAll('#date-wise-wrap li.match-card-container');
                cards.forEach(card => {
                    const isLive = card.innerText.includes('Live') || card.innerText.includes('LIVE');
                    if (isLive) {
                        const link = card.querySelector('a[href*="cricket-live-score"]');
                        if (link) {
                            const href = link.getAttribute('href');
                            const teamEls = card.querySelectorAll('.team-name');
                            const t1 = teamEls[0]?.innerText.trim() || 'Team1';
                            const t2 = teamEls[1]?.innerText.trim() || 'Team2';
                            results.push({
                                id: href.split('/cricket-live-score/')[1] || href,
                                detailUrl: href.startsWith('http') ? href : `https://crex.com${href}`,
                                date: new Date().toDateString(),
                                team1: { name: t1, flagUrl: '' },
                                team2: { name: t2, flagUrl: '' },
                                matchTime: 'Live',
                                matchStatus: 'Live'
                            });
                        }
                    }
                });
                return results;
            });

            console.log(`Found ${directLive.length} live matches directly from crex.com/schedule`);
            liveMatches = directLive.slice(0,5); // Max 5 for testing

            await page.close();
        }

        if (liveMatches.length === 0) {
            console.log('No Live matches found anywhere - writing sample for testing');
            // For testing, create sample with current live domestic matches
            liveMatches = [{
                id: 'karb-vs-srb-1st-first-class-quaid-e-azam-trophy-gold-2026-match-updates-152K',
                detailUrl: 'https://crex.com/cricket-live-score/karb-vs-srb-1st-first-class-quaid-e-azam-trophy-gold-2026-match-updates-152K',
                team1: { name: 'KARB', flagUrl: 'https://cricketvectors.akamaized.net/Teams/3H.png' },
                team2: { name: 'SRB', flagUrl: 'https://cricketvectors.akamaized.net/Teams/3E.png' },
                date: new Date().toDateString(),
                seriesInfo: 'Quaid-e-Azam Trophy Gold'
            }];
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
                    let t1Flag = "";
                    let t2Flag = "";
                    let t1Name = "";
                    let t2Name = "";
                    let score = "0/0";

                    if (teamInnings.length > 0) {
                        t1Flag = teamInnings[0].querySelector('img')?.src || "";
                        t1Name = teamInnings[0].querySelector('.team-name')?.innerText?.trim() || "";
                        score = teamInnings[0].querySelector('.runs.f-runs span')?.innerText?.trim() || teamInnings[0].querySelector('.team-score')?.innerText?.trim() || "0/0";
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

                    let comment = getText('.team-result .result-box') || getText('.final-result') || getText('.commentary-text') || getText('.result-box') || "LIVE MATCH";

                    let overNum = "0";
                    let ballNum = "0";

                    const liveOversText = getText('.team-inning .runs.f-runs span.over-text') || getText('.total-overs') || getText('.over-text') || "";
                    const overMatch = liveOversText.match(/(\d+)\.(\d+)/);
                    if (overMatch) {
                        overNum = overMatch[1];
                        ballNum = overMatch[2];
                    }

                    const pships = document.querySelectorAll('app-match-live-player .batsmen-partnership, .batsmen-partnership, .player-card, .batsman');

                    const b1Node = pships[0];
                    const b1Name = b1Node?.querySelector('.batsmen-name p')?.innerText?.trim() || b1Node?.querySelector('.player-name')?.innerText?.trim() || b1Node?.querySelector('.name')?.innerText?.trim() || "";
                    const b1Runs = b1Node?.querySelector('.batsmen-score p:nth-child(1)')?.innerText?.trim() || b1Node?.querySelector('.score')?.innerText?.trim() || "0";
                    const b1Balls = b1Node?.querySelector('.batsmen-score p:nth-child(2)')?.innerText?.replace(/[()]/g, '').trim() || "0";
                    const b1Fours = b1Node?.querySelectorAll('.player-strike-wrapper .strike-rate span')[1]?.innerText?.trim() || "0";
                    const b1Sixes = b1Node?.querySelectorAll('.player-strike-wrapper .strike-rate span')[3]?.innerText?.trim() || "0";
                    const b1Sr = b1Node?.querySelectorAll('.player-strike-wrapper .strike-rate span')[5]?.innerText?.trim() || "0.00";
                    const b1Vector = b1Node?.querySelector('app-player-profile-img img:not(.mr-top)')?.src || b1Node?.querySelector('img')?.src || "";
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
                        series,
                        team1Name: t1Name,
                        team1Flag: t1Flag,
                        team1Score: score,
                        team2Name: t2Name,
                        team2Flag: t2Flag,
                        commentary: comment,
                        currentOver: overNum,
                        currentBall: ballNum,
                        batsman1: { name: b1Name, runs: b1Runs, balls: b1Balls, fours: b1Fours, sixes: b1Sixes, sr: b1Sr, vector: b1Vector, jersey: b1Jersey },
                        batsman2: { name: b2Name, runs: b2Runs, balls: b2Balls, fours: b2Fours, sixes: b2Sixes, sr: b2Sr, vector: b2Vector, jersey: b2Jersey },
                        bowler: { name: bowlName, figures: bowlFigs, overs: bowlOvs, econ: bowlEcon, vector: bowlVector, jersey: bowlJersey },
                        isLive: true
                    };
                });

                allLiveData.push({
                    id: match.id,
                    detailUrl: url,
                    date: match.date,
                    seriesInfo: match.seriesInfo || data.series,
                    team1: { name: match.team1?.name || data.team1Name, flagUrl: match.team1?.flagUrl || data.team1Flag },
                    team2: { name: match.team2?.name || data.team2Name, flagUrl: match.team2?.flagUrl || data.team2Flag },
                    live: data,
                    scrapedAt: new Date().toISOString()
                });

                console.log(`✅ Scraped: ${data.team1Name} ${data.team1Score} | Batsman: ${data.batsman1.name} ${data.batsman1.runs} | Bowler: ${data.bowler.name}`);

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
            message: allLiveData.length > 0 ? `Live: ${allLiveData.length} matches - TEST MODE ALL` : 'No live found',
            isTest: false
        };
        fs.writeFileSync(LIVE_FILE, JSON.stringify(finalJson, null, 2));
        console.log(`\n✅ FINAL LIVE-DATA: ${allLiveData.length} matches saved - TEST MODE`);
        if (allLiveData.length > 0) {
            console.log(`Sample: ${allLiveData[0].live.team1Name} ${allLiveData[0].live.team1Score} | ${allLiveData[0].live.commentary}`);
        }

    } catch (err) {
        console.error('Live scraper error:', err.message);
        fs.writeFileSync(LIVE_FILE, JSON.stringify({ updatedAt: new Date().toISOString(), count: 0, matches: [], error: err.message }, null, 2));
    } finally {
        if (browser) await browser.close();
    }
}

scrapeLiveMatches();
