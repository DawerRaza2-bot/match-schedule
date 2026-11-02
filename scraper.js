const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'match-schedule.json');
const END_DATE = new Date(2026, 10, 30); // 30 Nov 2026

console.log(`📅 Scraping from Today to ${END_DATE.toDateString()} WITH TIME`);

async function scrape() {
    let puppeteer;
    try {
        puppeteer = require('puppeteer-core');
        console.log('Using puppeteer-core');
    } catch (e) {
        console.log('puppeteer-core not found, trying puppeteer', e.message);
        try {
            puppeteer = require('puppeteer');
        } catch (e2) {
            console.error('No puppeteer found');
            process.exit(1);
        }
    }

    const browser = await puppeteer.launch({
        headless: 'new',
        channel: 'chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    }).catch(async () => {
        return await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        await page.setViewport({ width: 1920, height: 1080 });

        console.log('📡 Opening CREX...');
        await page.goto('https://crex.com/schedule', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));

        // International filter
        console.log('🎯 Applying International filter...');
        try {
            await page.evaluate(async () => {
                for (let w of document.querySelectorAll('.option-wrapper')) {
                    const n = w.querySelector('.name');
                    if (n && n.innerText.toLowerCase().includes('series type')) {
                        const s = w.querySelector('.selection');
                        if (s && !s.innerText.toLowerCase().includes('international')) {
                            s.click();
                            await new Promise(r => setTimeout(r, 1000));
                            for (let d of document.querySelectorAll('div, li')) {
                                if (d.innerText && d.innerText.trim() === 'International' && d.offsetParent !== null && d !== s) {
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
        } catch(e){}

        let allMatches = [];
        let pageNum = 1;
        let shouldStop = false;
        const maxPages = 25;

        while (!shouldStop && pageNum <= maxPages) {
            console.log(`\n📄 Page ${pageNum} scraping...`);
            await new Promise(r => setTimeout(r, 2000));
            
            const data = await page.evaluate(() => {
                const results = [];
                document.querySelectorAll('#date-wise-wrap > div').forEach(block => {
                    const dateHeader = block.querySelector('h2.date span')?.innerText.trim() || 'Upcoming';
                    block.querySelectorAll('li.match-card-container').forEach(card => {
                        const anchor = card.querySelector('a.match-card-wrapper');
                        const href = anchor?.getAttribute('href') || '';
                        if (!href) return;
                        const teams = card.querySelectorAll('.team');
                        let t1Name='', t1Flag='', t1Score='', t1Overs='', t2Name='', t2Flag='', t2Score='', t2Overs='';
                        if (teams.length >= 2) {
                            const t1Img = teams[0].querySelector('img');
                            t1Flag = t1Img?.src || '';
                            t1Name = teams[0].querySelector('.team-name')?.innerText.trim() || t1Img?.alt || 'Team A';
                            t1Score = teams[0].querySelector('.team-score')?.innerText.trim() || '';
                            t1Overs = teams[0].querySelector('.total-overs')?.innerText.trim() || '';
                            const t2Img = teams[1].querySelector('img');
                            t2Flag = t2Img?.src || '';
                            t2Name = teams[1].querySelector('.team-name')?.innerText.trim() || t2Img?.alt || 'Team B';
                            t2Score = teams[1].querySelector('.team-score')?.innerText.trim() || '';
                            t2Overs = teams[1].querySelector('.total-overs')?.innerText.trim() || '';
                        }
                        // Time extraction
                        let matchTime = '';
                        const timeSelectors = ['.time', '.start-text', '.match-time'];
                        for (let sel of timeSelectors) {
                            const el = card.querySelector(sel);
                            if (el) {
                                const txt = el.innerText.trim();
                                if (txt.match(/\d{1,2}:\d{2}\s*(AM|PM)/i) || txt.toLowerCase().includes('live')) {
                                    matchTime = txt;
                                    break;
                                }
                            }
                        }
                        if (!matchTime) {
                            const fullText = card.innerText || '';
                            for (let line of fullText.split('\n')) {
                                if (line.match(/\d{1,2}:\d{2}\s*(AM|PM)/i) || line.toLowerCase() === 'live' || line.includes('• Live')) {
                                    matchTime = line.trim();
                                    break;
                                }
                            }
                        }
                        const startText = card.querySelector('.start-text')?.innerText.trim() || '';
                        const infoText = card.querySelector('.reason')?.innerText.trim() || '';
                        const resultText = card.querySelector('.result span')?.innerText.trim() || '';
                        const slug = href.split('/cricket-live-score/')[1] || href;
                        results.push({
                            id: slug,
                            date: dateHeader,
                            matchTime: matchTime || startText || 'TBD',
                            seriesInfo: infoText,
                            matchStatus: resultText || (matchTime && matchTime.toLowerCase().includes('live') ? 'Live' : 'Scheduled'),
                            team1: { name: t1Name, flagUrl: t1Flag, score: t1Score, overs: t1Overs },
                            team2: { name: t2Name, flagUrl: t2Flag, score: t2Score, overs: t2Overs },
                            detailUrl: `https://crex.com${href}`,
                            scrapedAt: new Date().toISOString()
                        });
                    });
                });
                return results;
            });

            console.log(`Found ${data.length} on page ${pageNum}`);

            for (let m of data) {
                try {
                    const parsed = new Date(m.date);
                    if (!isNaN(parsed.getTime())) {
                        if (parsed > new Date(2026, 10, 30, 23, 59, 59)) {
                            console.log(`Stop beyond Nov: ${m.date}`);
                            shouldStop = true;
                            break;
                        }
                        if (parsed.getMonth() === 11) {
                            console.log(`Stop Dec: ${m.date}`);
                            shouldStop = true;
                            break;
                        }
                    } else if (m.date.toLowerCase().includes('dec')) {
                        shouldStop = true;
                        break;
                    }
                } catch(e){}
                if (!allMatches.some(x => x.id === m.id)) allMatches.push(m);
            }

            if (shouldStop) break;

            console.log(`Total till Nov: ${allMatches.length}`);

            const clicked = await page.evaluate(() => {
                for (let b of document.querySelectorAll('button')) {
                    if (b.innerText.trim() === '>' || b.innerHTML.includes('arrow-right')) {
                        if (!b.disabled && b.offsetParent !== null) {
                            b.click();
                            return true;
                        }
                    }
                }
                return false;
            });

            if (!clicked) {
                console.log('No next button');
                break;
            }
            await new Promise(r => setTimeout(r, 3500));
            pageNum++;
        }

        const domestic = ['ranji','plate','wbbl','hong-kong','nepal','npl','global t20','emirates','ford trophy','csa','county','first class','list a','womens big bash'];
        const filtered = allMatches.filter(m => {
            const txt = `${m.id} ${m.seriesInfo}`.toLowerCase();
            if (domestic.some(k => txt.includes(k))) return false;
            try {
                const d = new Date(m.date);
                if (!isNaN(d.getTime())) {
                    if (d > new Date(2026, 10, 30, 23, 59, 59)) return false;
                    if (d.getMonth() === 11) return false;
                } else if (m.date.toLowerCase().includes('dec')) return false;
            } catch(e){}
            return true;
        });

        console.log(`FINAL: ${allMatches.length} -> ${filtered.length}`);
        filtered.sort((a,b) => new Date(a.date) - new Date(b.date));
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(filtered, null, 2));
        console.log(`🎉 DONE ${filtered.length} matches`);

    } catch (err) {
        console.error('Error:', err.message, err.stack);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
}

scrape();
