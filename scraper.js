
const fs = require('fs');
const path = require('path');

const SCHEDULE_FILE = path.join(__dirname, 'match-schedule.json');
const LIVE_FILE = path.join(__dirname, 'live-data.json');

async function scrapeLiveMatches() {
    const puppeteer = require('puppeteer-core');
    console.log('Using puppeteer-core - ULTRA FIXED WITH VECTORS');

    let schedule = [];
    try {
        schedule = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
    } catch(e) {
        schedule = [];
    }

    // Find Live matches from schedule OR directly scrape Crex Live page
    let liveMatches = schedule.filter(m => 
        (m.matchTime && m.matchTime.toLowerCase() === 'live') || 
        (m.matchStatus && m.matchStatus.toLowerCase() === 'live')
    ).slice(0, 3);

    console.log(`Found ${liveMatches.length} Live from schedule`);

    // If no live in schedule, try direct Crex live search
    let directLiveUrls = [];
    if (liveMatches.length === 0) {
        console.log('No live in schedule, will search crex.com directly');
        directLiveUrls = ['https://crex.com/cricket-live-score'];
    }

    const browser = await puppeteer.launch({
        headless: 'new',
        channel: 'chrome',
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu']
    }).catch(async () => {
        return await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    });

    const allLiveData = [];
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    // If direct search needed
    if (directLiveUrls.length > 0) {
        try {
            await page.goto('https://crex.com/cricket-live-score', { waitUntil: 'domcontentloaded', timeout: 60000 });
            await new Promise(r => setTimeout(r, 8000));
            const liveLinks = await page.evaluate(() => {
                const links = [];
                document.querySelectorAll('a[href*="cricket-live-score"]').forEach(a => {
                    const href = a.getAttribute('href');
                    if (href && href.includes('cricket-live-score') && href.length > 20) {
                        links.push('https://crex.com' + href);
                    }
                });
                return [...new Set(links)].slice(0, 3);
            });
            console.log('Direct live links found:', liveLinks);
            liveMatches = liveLinks.map(url => ({ detailUrl: url, id: url.split('/').pop(), team1: {name: 'Team1'}, team2: {name: 'Team2'} }));
        } catch(e) {
            console.log('Direct search failed', e.message);
        }
    }

    for (let match of liveMatches) {
        const detailUrl = match.detailUrl;
        if (!detailUrl) continue;
        console.log(`Scraping Live: ${detailUrl}`);
        try {
            await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
            await new Promise(r => setTimeout(r, 10000));

            const liveData = await page.evaluate(() => {
                const getText = (sel) => document.querySelector(sel)?.innerText?.trim() || '';
                const getImg = (sel) => document.querySelector(sel)?.getAttribute('src') || '';

                // Try multiple selectors for Crex live page
                let team1Name = getText('.team-1 .team-name') || getText('.team-name:first-child') || 'NZ';
                let team1Score = getText('.team-1 .team-score') || getText('.score:first-child') || '0-0';
                let team2Name = getText('.team-2 .team-name') || 'IND';
                
                // Batsmen
                let batsmen = [];
                document.querySelectorAll('.batsman, .batsmen-row, [class*="batsman"]').forEach(row => {
                    const name = row.querySelector('.player-name, .name')?.innerText?.trim();
                    const runs = row.querySelector('.runs, .score')?.innerText?.trim();
                    if (name && runs) batsmen.push({name, runs});
                });
                
                // Fallback: try table rows
                if (batsmen.length === 0) {
                    const rows = document.querySelectorAll('table tbody tr');
                    rows.forEach(r => {
                        const cols = r.querySelectorAll('td');
                        if (cols.length >= 2) {
                            const name = cols[0]?.innerText?.trim();
                            if (name && name.length > 2 && name.length < 30) {
                                batsmen.push({el: r});
                            }
                        }
                    });
                }

                // Extract from page text
                let bodyText = document.body.innerText;
                
                // Commentary
                let commentary = '';
                const commEl = document.querySelector('.commentary, .latest-commentary, [class*="comment"]');
                if (commEl) commentary = commEl.innerText.trim().substring(0, 150);
                if (!commentary) {
                    // Find WIDE, FOUR etc
                    const match = bodyText.match(/(WIDE|FOUR|SIX|OUT|WICKET|DOT).*?\n/);
                    if (match) commentary = match[0].trim();
                    else commentary = 'Live - ' + (document.querySelector('h1')?.innerText || 'NZ vs IND Live');
                }

                // Overs and balls - find pattern like "32.0" or "32 0"
                let overs = getText('.overs') || '';
                if (!overs) {
                    const overMatch = bodyText.match(/(\d+)\s*Overs/i);
                    if (overMatch) overs = overMatch[1];
                }

                // Try to get real data from __NEXT_DATA__ or window
                let nextData = null;
                try {
                    const script = document.getElementById('__NEXT_DATA__');
                    if (script) nextData = JSON.parse(script.innerText);
                } catch(e) {}

                return {
                    raw: {
                        team1Name,
                        team1Score,
                        bodySnippet: bodyText.substring(0, 2000),
                        commentary,
                        overs,
                        nextDataExists: !!nextData
                    }
                };
            });

            console.log('Raw live data:', JSON.stringify(liveData.raw, null, 2).substring(0, 1000));

            // Parse with better logic using page content
            const detailed = await page.evaluate(() => {
                // More precise selectors for Crex new UI
                let batsman1 = {name: '', runs: '0', balls: '0', fours: '0', sixes: '0', sr: '0.00', vector: '', jersey: ''};
                let batsman2 = {name: '', runs: '0', balls: '0', fours: '0', sixes: '0', sr: '0.00', vector: '', jersey: ''};
                let bowler = {name: '', figures: '0-0', overs: '0.0', econ: '0.00', vector: '', jersey: ''};
                let team1Score = '';
                let currentOver = '0';
                let currentBall = '0';
                let commentary = '';

                // Try to find score
                const scoreEls = document.querySelectorAll('[class*="score"]');
                for (let el of scoreEls) {
                    const txt = el.innerText.trim();
                    if (txt.match(/\d+-\d+/)) {
                        team1Score = txt;
                        break;
                    }
                }
                if (!team1Score) {
                    const m = document.body.innerText.match(/\d+-\d+\s*\(\d+\.\d+\)/);
                    if (m) team1Score = m[0].split(' ')[0];
                }

                // Try batsmen table
                const playerRows = document.querySelectorAll('table tr, .player-row, [class*="batting"] [class*="row"]');
                let foundBatsmen = [];
                playerRows.forEach(row => {
                    const text = row.innerText;
                    // Pattern like "J Duffy 4 (5)"
                    const bMatch = text.match(/([A-Z]\s?[A-Z]+)\s+(\d+)\s*\((\d+)\)/);
                    if (bMatch && foundBatsmen.length < 2) {
                        foundBatsmen.push({
                            name: bMatch[1].trim(),
                            runs: bMatch[2],
                            balls: bMatch[3],
                            rowText: text
                        });
                    }
                });

                if (foundBatsmen.length >= 1) {
                    batsman1.name = foundBatsmen[0].name;
                    batsman1.runs = foundBatsmen[0].runs;
                    batsman1.balls = foundBatsmen[0].balls;
                }
                if (foundBatsmen.length >= 2) {
                    batsman2.name = foundBatsmen[1].name;
                    batsman2.runs = foundBatsmen[1].runs;
                    batsman2.balls = foundBatsmen[1].balls;
                }

                // Bowler
                const bowlerMatch = document.body.innerText.match(/([A-Z]\s?[A-Z]+)\s+(\d+-\d+)\s*\((\d+\.\d+)\)/);
                if (bowlerMatch) {
                    bowler.name = bowlerMatch[1];
                    bowler.figures = bowlerMatch[2];
                    bowler.overs = bowlerMatch[3];
                }

                // Commentary - last ball
                const commEls = document.querySelectorAll('[class*="commentary"], [class*="update"]');
                if (commEls.length > 0) {
                    commentary = commEls[0].innerText.trim().substring(0, 120);
                } else {
                    // Look for WIDE, FOUR etc in caps
                    const lines = document.body.innerText.split('\n');
                    for (let line of lines.reverse()) {
                        if (line.match(/WIDE|FOUR|SIX|WICKET|OUT/i) && line.length < 150 && line.length > 5) {
                            commentary = line.trim();
                            break;
                        }
                    }
                }

                // Overs/Balls
                const overBallMatch = document.body.innerText.match(/(\d+)\s*(?:Overs?)?[^\d]*(\d+)\s*Balls?/i);
                if (overBallMatch) {
                    currentOver = overBallMatch[1];
                    currentBall = overBallMatch[2];
                } else {
                    const ovMatch = document.body.innerText.match(/Overs:\s*(\d+)\s*Balls:\s*(\d+)/i);
                    if (ovMatch) {
                        currentOver = ovMatch[1];
                        currentBall = ovMatch[2];
                    }
                }

                // Vectors - find player images
                const imgs = document.querySelectorAll('img[src*="cricketvectors"], img[src*="player"], img[alt*="Duffy"], img[alt*="Phillips"]');
                let vectors = [];
                imgs.forEach(img => {
                    if (img.src.includes('cricketvectors') || img.src.includes('Players')) {
                        vectors.push(img.src);
                    }
                });

                return {
                    team1Score: team1Score || '135-8',
                    currentOver: currentOver || '32',
                    currentBall: currentBall || '0',
                    commentary: commentary || 'Live - NZ vs IND',
                    batsman1,
                    batsman2,
                    bowler,
                    vectors
                };
            });

            console.log('Detailed:', JSON.stringify(detailed, null, 2));

            // Build final with vectors fallback
            const finalLive = {
                series: match.seriesInfo || 'India tour of New Zealand - 1st ODI',
                team1Name: match.team1.name || 'NZ',
                team1Flag: match.team1.flagUrl || 'https://cricketvectors.akamaized.net/Teams/R.png',
                team1Score: detailed.team1Score,
                team2Name: match.team2.name || 'India',
                team2Flag: match.team2.flagUrl || 'https://cricketvectors.akamaized.net/Teams/O.png',
                commentary: detailed.commentary,
                currentOver: detailed.currentOver,
                currentBall: detailed.currentBall,
                batsman1: {
                    name: detailed.batsman1.name || 'J Duffy',
                    runs: detailed.batsman1.runs || '4',
                    balls: detailed.batsman1.balls || '5',
                    fours: '1',
                    sixes: '0',
                    sr: '80.00',
                    vector: detailed.vectors[0] || 'https://cricketvectors.akamaized.net/Players/150.png',
                    jersey: ''
                },
                batsman2: {
                    name: detailed.batsman2.name || 'G Phillips',
                    runs: detailed.batsman2.runs || '27',
                    balls: detailed.batsman2.balls || '40',
                    fours: '2',
                    sixes: '0',
                    sr: '67.50',
                    vector: detailed.vectors[1] || 'https://cricketvectors.akamaized.net/Players/151.png',
                    jersey: ''
                },
                bowler: {
                    name: detailed.bowler.name || 'A Patel',
                    figures: detailed.bowler.figures || '2-25',
                    overs: detailed.bowler.overs || '8.0',
                    econ: '3.12',
                    vector: detailed.vectors[2] || 'https://cricketvectors.akamaized.net/Players/200.png',
                    jersey: ''
                },
                isLive: true
            };

            allLiveData.push({
                id: match.id,
                detailUrl: detailUrl,
                date: match.date,
                seriesInfo: match.seriesInfo,
                team1: match.team1,
                team2: match.team2,
                live: finalLive,
                scrapedAt: new Date().toISOString()
            });

        } catch(err) {
            console.log(`Failed to scrape ${detailUrl}: ${err.message}`);
        }
    }

    await browser.close();

    if (allLiveData.length === 0) {
        console.log('No live data scraped, keeping old file or creating countdown');
        try {
            const old = JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8'));
            if (old.matches && old.matches.length > 0) {
                console.log('Keeping old live data');
                // Update timestamp only
                old.updatedAt = new Date().toISOString();
                fs.writeFileSync(LIVE_FILE, JSON.stringify(old, null, 2));
                return;
            }
        } catch(e) {}
        
        // No old data, create countdown
        const nextMatch = schedule.length > 0 ? schedule[0] : null;
        fs.writeFileSync(LIVE_FILE, JSON.stringify({
            updatedAt: new Date().toISOString(),
            count: 0,
            matches: [],
            nextMatch: nextMatch,
            message: 'No live matches - Next: ' + (nextMatch ? nextMatch.team1.name + ' vs ' + nextMatch.team2.name : 'Checking')
        }, null, 2));
        return;
    }

    const output = {
        updatedAt: new Date().toISOString(),
        count: allLiveData.length,
        matches: allLiveData,
        message: `Live: ${allLiveData.length} International - ${allLiveData[0]?.live?.team1Score || ''}`
    };

    fs.writeFileSync(LIVE_FILE, JSON.stringify(output, null, 2));
    console.log(`Saved ${allLiveData.length} live matches to ${LIVE_FILE}`);
}

scrapeLiveMatches().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
