const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'match-schedule.json');

// ===== DYNAMIC NEXT MONTH LOGIC =====
// Agar aaj 25 Nov hai -> 1 Dec to 31 Dec
// Agar aaj 25 Dec hai -> 1 Jan to 31 Jan (next year)
// Agar manual run 2 Nov ko kiya to bhi next month = Dec hi lega

const now = new Date();
let targetMonth = now.getMonth() + 1; // Next month (0-11)
let targetYear = now.getFullYear();

if (targetMonth > 11) {
    targetMonth = 0; // Jan
    targetYear += 1;
}

const START_DATE = new Date(targetYear, targetMonth, 1); // 1st of next month
const END_DATE = new Date(targetYear, targetMonth + 1, 0); // Last day of next month

console.log(`📅 TODAY: ${now.toDateString()}`);
console.log(`🎯 TARGET: Scraping WHOLE NEXT MONTH -> ${START_DATE.toDateString()} to ${END_DATE.toDateString()}`);
console.log(`📅 INTERNATIONAL ONLY + TIME`);

async function scrapeNextMonth() {
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

        // ================= INTERNATIONAL FILTER (MOST IMPORTANT) =================
        console.log('🎯 Applying International filter...');
        try {
            const filterApplied = await page.evaluate(async () => {
                for (let w of document.querySelectorAll('.option-wrapper')) {
                    const nameEl = w.querySelector('.name');
                    if (nameEl && nameEl.innerText.toLowerCase().includes('series type')) {
                        const selection = w.querySelector('.selection');
                        const selText = selection ? selection.innerText.toLowerCase() : '';
                        console.log('Current:', selText);
                        if (!selText.includes('international')) {
                            if (selection) selection.click();
                            await new Promise(r => setTimeout(r, 1500));
                            for (let el of document.querySelectorAll('div, li, span')) {
                                if (el.innerText && el.innerText.trim() === 'International' && el.offsetParent !== null) {
                                    const rect = el.getBoundingClientRect();
                                    if (rect.width > 30 && rect.width < 300) {
                                        const parent = el.closest('.option-wrapper');
                                        if (!parent || !parent.querySelector('.name')) {
                                            el.click();
                                            return true;
                                        }
                                    }
                                }
                            }
                        } else {
                            return true;
                        }
                        break;
                    }
                }
                return false;
            });
            console.log('Filter result:', filterApplied);
            await new Promise(r => setTimeout(r, 5000));
        } catch(e){ console.log('Filter error:', e.message); }

        let allMatches = [];
        let pageNum = 1;
        let shouldStop = false;
        const maxPages = 40;

        while (!shouldStop && pageNum <= maxPages) {
            console.log(`\n📄 PAGE ${pageNum} - Looking for ${START_DATE.toDateString()} to ${END_DATE.toDateString()}...`);
            
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await new Promise(r => setTimeout(r, 1500));
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

            console.log(`Found ${data.length} matches on page ${pageNum}`);
            
            for (let m of data) {
                try {
                    const parsed = new Date(m.date);
                    if (!isNaN(parsed.getTime())) {
                        // Check if within START to END
                        const startCheck = new Date(START_DATE);
                        startCheck.setHours(0,0,0,0);
                        const endCheck = new Date(END_DATE);
                        endCheck.setHours(23,59,59,999);
                        
                        if (parsed < startCheck) {
                            // Still before target month, skip but continue searching
                            console.log(`Skip past month: ${m.date}`);
                            continue;
                        }
                        if (parsed > endCheck) {
                            console.log(`🛑 Beyond target month: ${m.date} > ${END_DATE.toDateString()}`);
                            shouldStop = true;
                            break;
                        }
                    }
                } catch(e){}
                if (!allMatches.some(x => x.id === m.id)) allMatches.push(m);
            }

            if (shouldStop) break;
            console.log(`Total for ${START_DATE.toLocaleString('default',{month:'long'})}: ${allMatches.length}`);

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

        // Domestic filter double safety
        const domestic = ['ranji','plate','wbbl','hong-kong','nepal','npl','global t20','emirates','ford trophy','csa t20','county','maharaja','duleep','deodhar','vijay hazare','syed mushtaq'];
        const filtered = allMatches.filter(m => {
            const txt = `${m.id} ${m.seriesInfo}`.toLowerCase();
            return !domestic.some(k => txt.includes(k));
        });

        // Only keep matches within target month
        const monthFiltered = filtered.filter(m => {
            try {
                const d = new Date(m.date);
                if (isNaN(d.getTime())) return true;
                return d.getMonth() === START_DATE.getMonth() && d.getFullYear() === START_DATE.getFullYear();
            } catch(e){ return true; }
        });

        monthFiltered.sort((a,b) => new Date(a.date) - new Date(b.date));

        console.log(`\n✅ FINAL: ${allMatches.length} -> ${filtered.length} -> ${monthFiltered.length} matches for ${START_DATE.toLocaleString('default',{month:'long',year:'numeric'})}`);
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(monthFiltered, null, 2));
        console.log(`🎉 DONE! Saved ${monthFiltered.length} International matches for next month`);

    } catch (err) {
        console.error('Error:', err.message, err.stack);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
}

scrapeNextMonth();
