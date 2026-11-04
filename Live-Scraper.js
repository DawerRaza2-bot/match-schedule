const fs = require('fs');
const path = require('path');

const SCHEDULE_FILE = path.join(__dirname, 'match-schedule.json');
const LIVE_FILE = path.join(__dirname, 'live-data.json');

async function scrapeLiveMatches() {
    const puppeteer = require('puppeteer-core');
    console.log('Using puppeteer-core for live scraping');

    // 1. Read schedule to find Live matches
    let schedule = [];
    try {
        schedule = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
    } catch(e) {
        console.log('No schedule file, using fallback URL');
        schedule = [{ detailUrl: 'https://crex.com/cricket-live-score/ned-vs-oma-144th-odi-mens-cwc-league-2-2023-27-match-updates-14VF', date: 'Mon, 2 Nov 2026', team1: { name: 'OMA', flagUrl: '' }, team2: { name: 'NED', flagUrl: '' } }];
    }

    const liveMatches = schedule.filter(m => 
        m.matchTime && m.matchTime.toLowerCase() === 'live' || 
        m.matchStatus && m.matchStatus.toLowerCase() === 'live'
    ).slice(0, 3); // Max 3 live matches to save minutes

    console.log(`Found ${liveMatches.length} Live matches from schedule`);

    if (liveMatches.length === 0) {
        console.log('No Live matches, writing empty live-data.json');
        fs.writeFileSync(LIVE_FILE, JSON.stringify({ updatedAt: new Date().toISOString(), matches: [], message: 'No live matches' }, null, 2));
        return;
    }

    const browser = await puppeteer.launch({
        headless: 'new',
        channel: 'chrome',
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu']
    }).catch(() => puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] }));

    const allLiveData = [];

    try {
        for (let match of liveMatches) {
            const url = match.detailUrl;
            console.log(`\n📡 Scraping LIVE: ${match.team1.name} vs ${match.team2.name} - ${url}`);
            
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
            await page.setViewport({ width: 1920, height: 1080 });
            
            // Block CSS/fonts for speed
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                if (['stylesheet', 'font', 'image'].includes(req.resourceType())) {
                    // Allow images for flags/avatars - need them!
                    if (req.url().includes('cricketvectors') || req.url().includes('Teams') || req.url().includes('Players')) {
                        req.continue();
                    } else if (req.resourceType() === 'stylesheet' || req.resourceType() === 'font') {
                        req.abort();
                    } else {
                        req.continue();
                    }
                } else {
                    req.continue();
                }
            });

            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await new Promise(r => setTimeout(r, 8000));

                const data = await page.evaluate(() => {
                    const getText = (sel) => document.querySelector(sel)?.innerText?.trim() || "";

                    let series = getText('.name-wrapper span') || getText('.series-name') || getText('.match-series') || "";
                    
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

                    const headerTeamImgs = document.querySelectorAll('.team-img img, .team-logo img, app-match-header img, .team img');
                    if (!t1Flag && headerTeamImgs.length > 0) t1Flag = headerTeamImgs[0]?.src || "";
                    if (headerTeamImgs.length > 1) t2Flag = headerTeamImgs[1]?.src || "";

                    if (teamInnings.length > 1) {
                        if (!t2Flag) t2Flag = teamInnings[1].querySelector('img')?.src || "";
                        t2Name = teamInnings[1].querySelector('.team-name')?.innerText?.trim() || "";
                    }

                    const nameBlocks = document.querySelectorAll('.team-name');
                    if (!t1Name && nameBlocks.length > 0) t1Name = nameBlocks[0].innerText.trim();
                    if (!t2Name && nameBlocks.length > 1) t2Name = nameBlocks[1].innerText.trim();

                    let comment1 = getText('.team-result .result-box');
                    let comment2 = getText('.team-inning.second-inning .final-result.comment');
                    let comment = comment2 ? comment2 : (comment1 ? comment1 : getText('.final-result') || getText('.commentary') || "LIVE MATCH");

                    let overNum = "0";
                    let ballNum = "0";

                    try {
                        let foundRb = null;
                        if (window.__matchData && window.__matchData.rb) {
                            foundRb = window.__matchData.rb;
                        } else {
                            for (let key in window) {
                                try {
                                    if (window[key] && window[key].rb && Array.isArray(window[key].rb)) {
                                        foundRb = window[key].rb;
                                        break;
                                    }
                                } catch(e) {}
                            }
                        }
                        if (foundRb && foundRb.length > 0) {
                            let lastEntry = foundRb[foundRb.length - 1];
                            overNum = String(lastEntry.o || 0);
                            ballNum = String(lastEntry.b ? lastEntry.b.length : 0);
                        }
                    } catch(e) {}

                    if (overNum === "0") {
                        const liveOversText = getText('.team-inning .runs.f-runs span.over-text') || getText('.overs-stats') || getText('.total-overs') || "";
                        const overMatch = liveOversText.match(/(\d+)\.(\d+)/);
                        if (overMatch) {
                            overNum = overMatch[1];
                            ballNum = overMatch[2];
                        } else {
                            const overSlides = document.querySelectorAll('.overs-slide');
                            if (overSlides.length > 0) {
                                const latestSlide = overSlides[overSlides.length - 1];
                                let titleEl = latestSlide.querySelector('.over-title') || latestSlide.querySelector('.font-weight-bold');
                                if (titleEl) {
                                    let matchText = titleEl.innerText.trim().match(/\d+/);
                                    if (matchText) overNum = matchText[0];
                                }
                                let balls = latestSlide.querySelectorAll('.over-ball');
                                ballNum = balls.length.toString();
                            }
                        }
                    }

                    const pships = document.querySelectorAll('app-match-live-player .batsmen-partnership, .batsmen-partnership, .player-card');

                    const b1Node = pships[0];
                    const b1Name = b1Node?.querySelector('.batsmen-name p')?.innerText?.trim() || b1Node?.querySelector('.player-name')?.innerText?.trim() || "";
                    const b1Runs = b1Node?.querySelector('.batsmen-score p:nth-child(1)')?.innerText?.trim() || b1Node?.querySelectorAll('.score')[0]?.innerText?.trim() || "0";
                    const b1Balls = b1Node?.querySelector('.batsmen-score p:nth-child(2)')?.innerText?.replace(/[()]/g, '').trim() || "0";
                    const b1Fours = b1Node?.querySelectorAll('.player-strike-wrapper .strike-rate span')[1]?.innerText?.trim() || "0";
                    const b1Sixes = b1Node?.querySelectorAll('.player-strike-wrapper .strike-rate span')[3]?.innerText?.trim() || "0";
                    const b1Sr = b1Node?.querySelectorAll('.player-strike-wrapper .strike-rate span')[5]?.innerText?.trim() || "0.00";
                    const b1Vector = b1Node?.querySelector('app-player-profile-img img:not(.mr-top)')?.src || b1Node?.querySelector('img.player-img')?.src || "";
                    const b1Jersey = b1Node?.querySelector('app-player-profile-img img.mr-top')?.src || "";

                    const b2Node = pships[1];
                    const b2Name = b2Node?.querySelector('.batsmen-name p')?.innerText?.trim() || b2Node?.querySelector('.player-name')?.innerText?.trim() || "";
                    const b2Runs = b2Node?.querySelector('.batsmen-score p:nth-child(1)')?.innerText?.trim() || "0";
                    const b2Balls = b2Node?.querySelector('.batsmen-score p:nth-child(2)')?.innerText?.replace(/[()]/g, '').trim() || "0";
                    const b2Fours = b2Node?.querySelectorAll('.player-strike-wrapper .strike-rate span')[1]?.innerText?.trim() || "0";
                    const b2Sixes = b2Node?.querySelectorAll('.player-strike-wrapper .strike-rate span')[3]?.innerText?.trim() || "0";
                    const b2Sr = b2Node?.querySelectorAll('.player-strike-wrapper .strike-rate span')[5]?.innerText?.trim() || "0.00";
                    const b2Vector = b2Node?.querySelector('app-player-profile-img img:not(.mr-top)')?.src || "";
                    const b2Jersey = b2Node?.querySelector('app-player-profile-img img.mr-top')?.src || "";

                    const bowlNode = pships[2];
                    const bowlName = bowlNode?.querySelector('.batsmen-name p')?.innerText?.trim() || bowlNode?.querySelector('.player-name')?.innerText?.trim() || "";
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
                    team1: { name: match.team1.name, flagUrl: match.team1.flagUrl || data.team1Flag },
                    team2: { name: match.team2.name, flagUrl: match.team2.flagUrl || data.team2Flag },
                    live: data,
                    scrapedAt: new Date().toISOString()
                });

                console.log(`✅ Scraped: ${data.team1Name} ${data.team1Score} | ${data.batsman1.name} ${data.batsman1.runs} | Bowler: ${data.bowler.name}`);

            } catch (err) {
                console.log(`❌ Failed ${url}: ${err.message}`);
            } finally {
                await page.close();
            }
        }

        fs.writeFileSync(LIVE_FILE, JSON.stringify({ updatedAt: new Date().toISOString(), count: allLiveData.length, matches: allLiveData }, null, 2));
        console.log(`\n✅ FINAL LIVE-DATA: ${allLiveData.length} matches saved to live-data.json`);

    } catch (err) {
        console.error('Live scraper error:', err.message, err.stack);
        // Write empty file to avoid breaking frontend
        fs.writeFileSync(LIVE_FILE, JSON.stringify({ updatedAt: new Date().toISOString(), count: 0, matches: [], error: err.message }, null, 2));
    } finally {
        if (browser) await browser.close();
    }
}

scrapeLiveMatches();
