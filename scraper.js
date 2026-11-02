const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'match-schedule.json');

// ===== FIXED LOGIC: TODAY to END OF NEXT MONTH =====
// Agar aaj 2 Nov hai -> 2 Nov se 31 Dec tak (taake empty na aaye)
// 25 Nov ko chalega -> 25 Nov se 31 Dec tak (current + next month)

const now = new Date();
now.setHours(0,0,0,0);

let targetMonth = now.getMonth() + 1;
let targetYear = now.getFullYear();
if (targetMonth > 11) { targetMonth = 0; targetYear += 1; }

const START_DATE = new Date(now); // Aaj se start (2 Nov)
const END_DATE = new Date(targetYear, targetMonth + 1, 0); // End of next month (31 Dec)

console.log(`📅 TODAY: ${now.toDateString()}`);
console.log(`🎯 TARGET: ${START_DATE.toDateString()} to ${END_DATE.toDateString()} (Today to End of Next Month)`);
console.log(`📅 INTERNATIONAL ONLY + TIME`);

async function scrape() {
    let puppeteer;
    try { puppeteer = require('puppeteer-core'); console.log('Using puppeteer-core'); }
    catch { puppeteer = require('puppeteer'); }

    const browser = await puppeteer.launch({
        headless: 'new', channel: 'chrome',
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']
    }).catch(() => puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] }));

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        await page.setViewport({ width: 1920, height: 1080 });

        console.log('📡 Opening https://crex.com/schedule');
        await page.goto('https://crex.com/schedule', { waitUntil: 'networkidle2', timeout: 90000 });
        await new Promise(r => setTimeout(r, 6000));

        // INTERNATIONAL FILTER
        console.log('🎯 Applying International filter...');
        try {
            await page.evaluate(async () => {
                for (let w of document.querySelectorAll('.option-wrapper')) {
                    const n = w.querySelector('.name');
                    if (n && n.innerText.toLowerCase().includes('series type')) {
                        const s = w.querySelector('.selection');
                        const sel = s ? s.innerText.toLowerCase() : '';
                        if (!sel.includes('international')) {
                            if (s) s.click();
                            await new Promise(r => setTimeout(r, 1500));
                            for (let el of document.querySelectorAll('div, li, span')) {
                                if (el.innerText && el.innerText.trim() === 'International' && el.offsetParent !== null) {
                                    const rect = el.getBoundingClientRect();
                                    if (rect.width > 30 && rect.width < 300) {
                                        const parent = el.closest('.option-wrapper');
                                        if (!parent || !parent.querySelector('.name')) {
                                            el.click();
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                        break;
                    }
                }
            });
            await new Promise(r => setTimeout(r, 5000));
            const verify = await page.evaluate(() => {
                for (let w of document.querySelectorAll('.option-wrapper')) {
                    const n = w.querySelector('.name');
                    if (n && n.innerText.toLowerCase().includes('series type')) {
                        return w.querySelector('.selection')?.innerText.trim() || '';
                    }
                }
                return '';
            });
            console.log('Verified filter:', verify);
        } catch(e){ console.log('Filter error', e.message); }

        let allMatches = [];
        let pageNum = 1;
        let shouldStop = false;
        const maxPages = 40;

        while (!shouldStop && pageNum <= maxPages) {
            console.log(`\n📄 PAGE ${pageNum} - ${START_DATE.toDateString()} to ${END_DATE.toDateString()}`);
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await new Promise(r => setTimeout(r, 1000));
            await page.evaluate(() => window.scrollTo(0, 0));
            await new Promise(r => setTimeout(r, 1000));

            const data = await page.evaluate(() => {
                const results = [];
                document.querySelectorAll('#date-wise-wrap > div').forEach(block => {
                    const dateHeader = block.querySelector('h2.date span')?.innerText.trim() || block.querySelector('h2')?.innerText.trim() || '';
                    if (!dateHeader) return;
                    block.querySelectorAll('li.match-card-container').forEach(card => {
                        try {
                            const anchor = card.querySelector('a.match-card-wrapper');
                            const href = anchor?.getAttribute('href') || '';
                            if (!href || !href.includes('cricket-live-score')) return;
                            let t1Name='', t1Flag='', t1Score='', t1Overs='', t2Name='', t2Flag='', t2Score='', t2Overs='';
                            const teams = card.querySelectorAll('.team');
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
                            let matchTime = '';
                            const fullText = card.innerText || '';
                            const timeMatch = fullText.match(/\d{1,2}:\d{2}\s*(AM|PM)/i);
                            if (timeMatch) matchTime = timeMatch[0];
                            else if (fullText.toLowerCase().includes('live')) matchTime = 'Live';
                            if (!matchTime) {
                                const timeEl = card.querySelector('.start-text, .time');
                                if (timeEl) matchTime = timeEl.innerText.trim();
                            }
                            const seriesInfo = card.querySelector('.reason')?.innerText.trim() || '';
                            const resultText = card.querySelector('.result span')?.innerText.trim() || '';
                            const slug = href.split('/cricket-live-score/')[1] || href;
                            const clean = (s) => s ? s.replace(/\n.*/g,'').replace(/\d+\/\d+.*/g,'').trim().split('  ')[0].trim() : '';
                            results.push({
                                id: slug,
                                date: dateHeader,
                                matchTime: matchTime || 'TBD',
                                seriesInfo: seriesInfo,
                                matchStatus: resultText || (matchTime && matchTime.toLowerCase().includes('live') ? 'Live' : 'Scheduled'),
                                team1: { name: clean(t1Name)||'Team A', flagUrl: t1Flag, score: t1Score, overs: t1Overs },
                                team2: { name: clean(t2Name)||'Team B', flagUrl: t2Flag, score: t2Score, overs: t2Overs },
                                detailUrl: href.startsWith('http') ? href : `https://crex.com${href}`,
                                scrapedAt: new Date().toISOString()
                            });
                        } catch(e){}
                    });
                });
                return results;
            });

            console.log(`Found ${data.length} on page ${pageNum}`);
            data.forEach(d => console.log(`  - ${d.date} | ${d.matchTime} | ${d.team1.name} vs ${d.team2.name}`));

            for (let m of data) {
                try {
                    const parsed = new Date(m.date);
                    if (!isNaN(parsed.getTime())) {
                        if (parsed < START_DATE) {
                            console.log(`Skip before today: ${m.date}`);
                            continue;
                        }
                        if (parsed > END_DATE) {
                            console.log(`🛑 Beyond ${END_DATE.toDateString()}: ${m.date}`);
                            shouldStop = true;
                            break;
                        }
                    }
                } catch(e){}
                if (!allMatches.some(x => x.id === m.id)) allMatches.push(m);
            }

            if (shouldStop) break;
            console.log(`Total till now: ${allMatches.length}`);

            const clicked = await page.evaluate(() => {
                for (let b of document.querySelectorAll('button')) {
                    const txt = b.innerText.trim();
                    const html = b.innerHTML || '';
                    if ((txt === '>' || html.includes('arrow-right') || html.includes('keyboard_arrow_right')) && !b.disabled && b.offsetParent !== null) {
                        b.click();
                        return true;
                    }
                }
                return false;
            });
            if (!clicked) { console.log('No more pages'); break; }
            await new Promise(r => setTimeout(r, 4000));
            pageNum++;
        }

        const domestic = ['ranji','plate','wbbl','hong-kong','nepal','npl','global t20','emirates','ford trophy','csa t20','county','maharaja','duleep','deodhar'];
        const filtered = allMatches.filter(m => {
            const txt = `${m.id} ${m.seriesInfo}`.toLowerCase();
            return !domestic.some(k => txt.includes(k));
        });

        filtered.sort((a,b) => new Date(a.date) - new Date(b.date));

        console.log(`\n✅ FINAL International: ${allMatches.length} -> ${filtered.length} matches (${START_DATE.toDateString()} to ${END_DATE.toDateString()})`);
        
        if (filtered.length === 0) {
            console.log('⚠️ No matches found - maybe next month data not yet available, saving whatever found');
            // Save at least something to avoid []
            fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allMatches, null, 2));
        } else {
            fs.writeFileSync(OUTPUT_FILE, JSON.stringify(filtered, null, 2));
        }
        console.log(`🎉 DONE! ${filtered.length} matches`);

    } catch (err) {
        console.error('Error:', err.message, err.stack);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
}

scrape();
