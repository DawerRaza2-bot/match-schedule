
const fs = require('fs');
const path = require('path');

const SCHEDULE_FILE = path.join(__dirname, 'match-schedule.json');
const LIVE_FILE = path.join(__dirname, 'live-data.json');

async function scrapeLive() {
    const puppeteer = require('puppeteer-core');
    console.log('Using puppeteer-core for live scraping');

    let schedule = [];
    try {
        if (fs.existsSync(SCHEDULE_FILE)) {
            schedule = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
            console.log(`Loaded schedule: ${schedule.length} matches`);
        }
    } catch(e){ console.log('Schedule load error', e.message); }

    let liveMatches = schedule.filter(m => {
        const time = (m.matchTime || '').toLowerCase();
        const status = (m.matchStatus || '').toLowerCase();
        return time === 'live' || status === 'live' || status.includes('live');
    }).slice(0,3);

    console.log(`Found ${liveMatches.length} Live matches from schedule`);

    // FALLBACK FOR TESTING - when no live matches, use sample so scoreboard doesn't stay empty
    const isTestMode = process.argv.includes('--test') || process.argv.includes('-t') || liveMatches.length === 0;
    
    if (liveMatches.length === 0) {
        if (isTestMode) {
            console.log('No Live matches now, using SAMPLE Live URL for testing...');
            liveMatches = [{
                id: 'test-ned-vs-oma-144th-odi',
                detailUrl: 'https://crex.com/cricket-live-score/ned-vs-oma-144th-odi-mens-cwc-league-2-2023-27-match-updates-14VF',
                team1: { name: 'OMA', flagUrl: 'https://cricketvectors.akamaized.net/Teams/15.png' },
                team2: { name: 'NED', flagUrl: 'https://cricketvectors.akamaized.net/Teams/12.png' },
                date: new Date().toDateString(),
                seriesInfo: 'Mens CWC League 2'
            }];
        } else {
            console.log('No Live matches, writing empty live-data.json');
            const emptyData = { updatedAt: new Date().toISOString(), count: 0, matches: [], isTest: false, message: 'No live matches now. Run with --test for sample data.' };
            fs.writeFileSync(LIVE_FILE, JSON.stringify(emptyData, null, 2));
            return;
        }
    }

    const browser = await puppeteer.launch({
        headless: 'new',
        channel: 'chrome',
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']
    }).catch(async () => {
        console.log('Chrome channel failed, trying default...');
        return await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    });

    const allLiveData = [];
    try {
        for (let match of liveMatches) {
            const url = match.detailUrl;
            console.log(`\n📡 Scraping LIVE: ${match.team1.name} vs ${match.team2.name} - ${url}`);
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
                    let t1Flag = ""; let t2Flag = ""; let t1Name = ""; let t2Name = ""; let score = "0/0";
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
                    let comment = getText('.team-result .result-box') || getText('.final-result') || "LIVE MATCH";
                    let overNum = "0"; let ballNum = "0";
                    const liveOversText = getText('.team-inning .runs.f-runs span.over-text') || getText('.total-overs') || "";
                    const overMatch = liveOversText.match(/(\d+)\.(\d+)/);
                    if (overMatch) { overNum = overMatch[1]; ballNum = overMatch[2]; }
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
                        series, team1Name: t1Name, team1Flag: t1Flag, team1Score: score,
                        team2Name: t2Name, team2Flag: t2Flag, commentary: comment,
                        currentOver: overNum, currentBall: ballNum,
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

                console.log(`✅ Scraped: ${data.team1Name} ${data.team1Score} | Batsman: ${data.batsman1.name} ${data.batsman1.runs} | Bowler: ${data.bowler.name}`);
                console.log(`   Avatars: B1 Vector=${data.batsman1.vector ? 'YES' : 'NO'}, Jersey=${data.batsman1.jersey ? 'YES' : 'NO'}`);
            } catch (err) {
                console.log(`❌ Failed ${url}: ${err.message}`);
            } finally {
                await page.close();
            }
        }

        const finalJson = { updatedAt: new Date().toISOString(), count: allLiveData.length, matches: allLiveData, isTest: isTestMode && schedule.filter(m => (m.matchTime||'').toLowerCase()==='live').length===0 };
        fs.writeFileSync(LIVE_FILE, JSON.stringify(finalJson, null, 2));
        console.log(`\n✅ FINAL LIVE-DATA: ${allLiveData.length} matches saved to live-data.json ${finalJson.isTest ? '(TEST MODE)' : ''}`);
        if (allLiveData.length > 0) {
            console.log(`Sample: ${allLiveData[0].live.team1Name} ${allLiveData[0].live.team1Score}`);
            console.log(`Batsman1: ${allLiveData[0].live.batsman1.name} - ${allLiveData[0].live.batsman1.runs} (${allLiveData[0].live.batsman1.balls})`);
            console.log(`Bowler: ${allLiveData[0].live.bowler.name} - ${allLiveData[0].live.bowler.figures}`);
        }
    } catch (err) {
        console.error('Live scraper error:', err.message);
        fs.writeFileSync(LIVE_FILE, JSON.stringify({ updatedAt: new Date().toISOString(), count: 0, matches: [], error: err.message }, null, 2));
    } finally {
        if (browser) await browser.close();
    }
}

scrapeLive();
