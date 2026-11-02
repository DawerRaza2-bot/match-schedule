const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'match-schedule.json');
const MAX_PAGES_TO_SCRAPE = 10;

async function scrapeWithFetch() {
    console.log('🚀 [FINAL Scraper - puppeteer-core support] Starting...');
    
    let puppeteer;
    try {
        puppeteer = require('puppeteer-core');
        console.log('Using puppeteer-core');
    } catch {
        try {
            puppeteer = require('puppeteer');
            console.log('Using puppeteer');
        } catch (e) {
            console.error('No puppeteer found:', e.message);
            process.exit(1);
        }
    }

    const browser = await puppeteer.launch({
        headless: 'new',
        executablePath: '/opt/hostedtoolcache/setup-chrome/chrome/stable/x64/chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    }).catch(async (err) => {
        console.log('First launch failed, trying without path:', err.message);
        // Try auto-detect Chrome
        return await puppeteer.launch({
            headless: 'new',
            channel: 'chrome',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        await page.setViewport({ width: 1920, height: 1080 });

        console.log('📡 Navigating to schedule...');
        await page.goto('https://crex.com/schedule', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));

        console.log('🎯 Applying International filter...');
        await page.goto('https://crex.com/schedule', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});
        await new Promise(r => setTimeout(r, 3000));

        try {
            await page.evaluate(async () => {
                const wrappers = document.querySelectorAll('.option-wrapper');
                for (let w of wrappers) {
                    const name = w.querySelector('.name');
                    if (name && name.innerText.toLowerCase().includes('series type')) {
                        const sel = w.querySelector('.selection');
                        if (sel && !sel.innerText.toLowerCase().includes('international')) {
                            sel.click();
                            await new Promise(r => setTimeout(r, 1000));
                            const all = document.querySelectorAll('div, li');
                            for (let d of all) {
                                if (d.innerText && d.innerText.trim() === 'International' && d.offsetParent !== null && d !== sel) {
                                    d.click();
                                    break;
                                }
                            }
                        }
                        break;
                    }
                }
            });
            await new Promise(r => setTimeout(r, 4000));
        } catch(e){ console.log('Filter error', e.message); }

        let allMatches = [];

        for (let pageNum = 1; pageNum <= MAX_PAGES_TO_SCRAPE; pageNum++) {
            console.log(`📄 Scraping page ${pageNum}/${MAX_PAGES_TO_SCRAPE}`);
            await new Promise(r => setTimeout(r, 2000));
            
            const data = await page.evaluate(() => {
                const results = [];
                const dateBlocks = document.querySelectorAll('#date-wise-wrap > div');
                dateBlocks.forEach((block) => {
                    const dateHeader = block.querySelector('h2.date span')?.innerText.trim() || 'Upcoming';
                    const cards = block.querySelectorAll('li.match-card-container');
                    cards.forEach((card) => {
                        const anchor = card.querySelector('a.match-card-wrapper');
                        const href = anchor?.getAttribute('href') || '';
                        if (!href) return;
                        const teams = card.querySelectorAll('.team');
                        let t1Name='', t1Flag='', t1Score='', t1Overs='', t2Name='', t2Flag='', t2Score='', t2Overs='';
                        if (teams.length >= 2) {
                            const t1Img = teams[0].querySelector('img');
                            t1Flag = t1Img?.getAttribute('src') || '';
                            t1Name = teams[0].querySelector('.team-name')?.innerText.trim() || t1Img?.getAttribute('alt') || 'Team A';
                            t1Score = teams[0].querySelector('.team-score')?.innerText.trim() || '';
                            t1Overs = teams[0].querySelector('.total-overs')?.innerText.trim() || '';
                            const t2Img = teams[1].querySelector('img');
                            t2Flag = t2Img?.getAttribute('src') || '';
                            t2Name = teams[1].querySelector('.team-name')?.innerText.trim() || t2Img?.getAttribute('alt') || 'Team B';
                            t2Score = teams[1].querySelector('.team-score')?.innerText.trim() || '';
                            t2Overs = teams[1].querySelector('.total-overs')?.innerText.trim() || '';
                        }
                        const startText = card.querySelector('.start-text')?.innerText.trim() || '';
                        const infoText = card.querySelector('.time, .reason')?.innerText.trim() || '';
                        const resultText = card.querySelector('.result span')?.innerText.trim() || '';
                        const slug = href.split('/cricket-live-score/')[1] || href;
                        results.push({
                            id: slug,
                            date: dateHeader,
                            seriesInfo: infoText,
                            matchStatus: resultText || (startText ? `Starts at ${startText}` : 'Scheduled'),
                            team1: { name: t1Name, flagUrl: t1Flag, score: t1Score, overs: t1Overs },
                            team2: { name: t2Name, flagUrl: t2Flag, score: t2Score, overs: t2Overs },
                            detailUrl: `https://crex.com${href}`,
                            scrapedAt: new Date().toISOString()
                        });
                    });
                });
                return results;
            });

            data.forEach(m => {
                if (!allMatches.some(x => x.id === m.id)) allMatches.push(m);
            });

            console.log(`Page ${pageNum} total: ${allMatches.length}`);

            if (pageNum < MAX_PAGES_TO_SCRAPE) {
                const clicked = await page.evaluate(() => {
                    const btns = document.querySelectorAll('button');
                    for (let b of btns) {
                        if (b.innerText.trim() === '>' || b.innerHTML.includes('arrow-right') || b.innerHTML.includes('keyboard_arrow_right')) {
                            if (!b.disabled) { b.click(); return true; }
                        }
                    }
                    return false;
                });
                if (!clicked) break;
                await new Promise(r => setTimeout(r, 3500));
            }
        }

        const domestic = ['ranji','plate','wbbl','hong-kong','hong kong','nepal','npl','global t20','emirates','ford trophy','csa','county','first class','list a','womens big bash','big bash','lpl','psl','ipl','maharaja','duleep'];
        const filtered = allMatches.filter(m => {
            const txt = `${m.id} ${m.seriesInfo}`.toLowerCase();
            return !domestic.some(k => txt.includes(k));
        });

        console.log(`Before filter: ${allMatches.length}, After: ${filtered.length}`);

        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(filtered, null, 2));
        console.log(`🎉 Done! ${filtered.length} matches saved to ${OUTPUT_FILE}`);

    } catch (err) {
        console.error('Error:', err.message, err.stack);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
}

scrapeWithFetch();
