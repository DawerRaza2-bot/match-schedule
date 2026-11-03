const fs = require('fs');
const path = require('path');

const SCHEDULE_FILE = path.join(__dirname, 'match-schedule.json');
const LIVE_FILE = path.join(__dirname, 'live-data.json');

async function scrapeLiveMatches() {
    const puppeteer = require('puppeteer-core');
    console.log('Using puppeteer-core for live scraping - FINAL FIXED');

    // 1. Try to read schedule to find Live matches, but also fallback to direct crex live page
    let schedule = [];
    try {
        if (fs.existsSync(SCHEDULE_FILE)) {
            schedule = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
            console.log(`Loaded schedule: ${schedule.length} matches`);
        }
    } catch(e) {
        console.log('Schedule read error:', e.message);
    }

    let liveMatches = schedule.filter(m => {
        const time = (m.matchTime || '').toLowerCase();
        const status = (m.matchStatus || '').toLowerCase();
        return time === 'live' || status === 'live' || status.includes('live') || time.includes('live');
    }).slice(0,3);

    console.log(`Found ${liveMatches.length} Live matches from schedule file`);

    // If no live from schedule, try to find live from crex.com directly
    const browser = await puppeteer.launch({
        headless: 'new',
        channel: 'chrome',
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu']
    }).catch(() => puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] }));

    try {
        // If schedule has no live, scrape crex.com/live or crex.com directly for live matches
        if (liveMatches.length === 0) {
            console.log('No live in schedule, checking https://crex.com/ for live matches...');
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
            await page.goto('https://crex.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
            await new Promise(r => setTimeout(r, 8000));

            const directLive = await page.evaluate(() => {
                const results = [];
                // Look for live cards on homepage
                const liveCards = document.querySelectorAll('li.match-card-container, .match-card, [class*="live"]');
                liveCards.forEach(card => {
                    const liveBadge = card.innerText.toLowerCase().includes('live');
                    const link = card.querySelector('a[href*="cricket-live-score"]');
                    if (liveBadge && link) {
                        const href = link.getAttribute('href');
                        results.push({
                            id: href.split('/cricket-live-score/')[1] || href,
                            detailUrl: href.startsWith('http') ? href : `https://crex.com${href}`,
                            date: new Date().toDateString(),
                            team1: { name: 'Team1', flagUrl: '' },
                            team2: { name: 'Team2', flagUrl: '' }
                        });
                    }
                });
                // Also check all links with live
                const allLinks = document.querySelectorAll('a[href*="cricket-live-score"]');
                allLinks.forEach(link => {
                    const card = link.closest('li') || link.parentElement;
                    if (card && card.innerText.toLowerCase().includes('live')) {
                        const href = link.getAttribute('href');
                        const id = href.split('/cricket-live-score/')[1] || href;
                        if (!results.some(r => r.id === id)) {
                            results.push({
                                id: id,
                                detailUrl: href.startsWith('http') ? href : `https://crex.com${href}`,
                                date: new Date().toDateString(),
                                team1: { name: 'Team1', flagUrl: '' },
                                team2: { name: 'Team2', flagUrl: '' }
                            });
                        }
                    }
                });
                return results.slice(0,3);
            });

            console.log(`Found ${directLive.length} live matches directly from crex.com homepage`);
            liveMatches = directLive;

            await page.close();
        }

        // If still 0, check if user passed --test or if we should keep old data
        if (liveMatches.length === 0) {
            const isTest = process.argv.includes('--test');
            if (isTest) {
                console.log('No live now, using TEST sample for checking...');
                liveMatches = [{
                    id: 'afg-vs-zim-1st-test-afghanistan-vs-zimbabwe-in-uae-2026-match-updates-13TP',
                    detailUrl: 'https://crex.com/cricket-live-score/afg-vs-zim-1st-test-afghanistan-vs-zimbabwe-in-uae-2026-match-updates-13TP',
                    team1: { name: 'AFG', flagUrl: 'https://cricketvectors.akamaized.net/Teams/Y.png' },
                    team2: { name: 'ZIM', flagUrl: 'https://cricketvectors.akamaized.net/Teams/X.png' },
                    date: new Date().toDateString(),
                    seriesInfo: 'AFG vs ZIM Test'
                }];
            } else {
                console.log('No Live matches now, keeping old live-data.json if exists or writing empty');
                // Don't overwrite with empty if old file exists and has data
                if (fs.existsSync(LIVE_FILE)) {
                    try {
                        const old = JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8'));
                        if (old.matches && old.matches.length > 0 && old.count > 0) {
                            console.log(`Keeping old live-data with ${old.count} matches, since no new live`);
                            // Update timestamp only
                            old.updatedAt = new Date().toISOString();
                            old.message = 'No new live, kept old data';
                            fs.writeFileSync(LIVE_FILE, JSON.stringify(old, null, 2));
                            await browser.close();
                            return;
                        }
                    } catch(e){}
                }
                const emptyData = { updatedAt: new Date().toISOString(), count: 0, matches: [], message: 'No live matches currently - check back at 10 AM' };
                fs.writeFileSync(LIVE_FILE, JSON.stringify(emptyData, null, 2));
                await browser.close();
                return;
            }
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

                    let series = getText('.name-wrapper span') || getText('.series-name') || "";
                    
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

                    let comment = getText('.team-result .result-box') || getText('.final-result') || getText('.commentary-text') || "LIVE MATCH";

                    let overNum = "0";
                    let ballNum = "0";

                    const liveOversText = getText('.team-inning .runs.f-runs span.over-text') || getText('.total-overs') || "";
                    const overMatch = liveOversText.match(/(\d+)\.(\d+)/);
                    if (overMatch) {
                        overNum = overMatch[1];
                        ballNum = overMatch[2];
                    }

                    const pships = document.querySelectorAll('app-match-live-player .batsmen-partnership, .batsmen-partnership');

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
            message: allLiveData.length > 0 ? `Live: ${allLiveData.length} matches` : 'No live matches found - will keep checking'
        };
        fs.writeFileSync(LIVE_FILE, JSON.stringify(finalJson, null, 2));
        console.log(`\n✅ FINAL LIVE-DATA: ${allLiveData.length} matches saved`);

    } catch (err) {
        console.error('Live scraper error:', err.message);
        // Don't overwrite with empty if error - keep old
        if (fs.existsSync(LIVE_FILE)) {
            console.log('Keeping old live-data due to error');
        } else {
            fs.writeFileSync(LIVE_FILE, JSON.stringify({ updatedAt: new Date().toISOString(), count: 0, matches: [], error: err.message }, null, 2));
        }
    } finally {
        if (browser) await browser.close();
    }
}

scrapeLiveMatches();
