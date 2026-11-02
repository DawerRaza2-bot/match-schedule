const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'match-schedule.json');
const END_DATE = new Date(2026, 10, 30); // 30 Nov 2026

console.log(`📅 Scraping INTERNATIONAL only: Today to ${END_DATE.toDateString()} WITH TIME`);

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

        // ================= INTERNATIONAL FILTER (COMPULSORY) =================
        console.log('🎯 Applying International filter (MOST IMPORTANT)...');
        try {
            const filterApplied = await page.evaluate(async () => {
                let found = false;
                for (let w of document.querySelectorAll('.option-wrapper')) {
                    const nameEl = w.querySelector('.name');
                    if (!nameEl) continue;
                    if (nameEl.innerText.toLowerCase().includes('series type')) {
                        const selection = w.querySelector('.selection');
                        const selText = selection ? selection.innerText.toLowerCase() : '';
                        console.log('Current series type:', selText);
                        
                        if (!selText.includes('international')) {
                            console.log('Clicking Series Type dropdown...');
                            if (selection) selection.click();
                            await new Promise(r => setTimeout(r, 1500));
                            
                            // Find International option
                            for (let el of document.querySelectorAll('div, li, span, p')) {
                                if (el.innerText && el.innerText.trim() === 'International' && el.offsetParent !== null) {
                                    const rect = el.getBoundingClientRect();
                                    if (rect.width > 30 && rect.width < 300 && rect.height > 10) {
                                        const parent = el.closest('.option-wrapper');
                                        if (!parent || !parent.querySelector('.name')) {
                                            console.log('Clicking International:', el.innerText);
                                            el.click();
                                            found = true;
                                            break;
                                        }
                                    }
                                }
                            }
                        } else {
                            console.log('Already International');
                            found = true;
                        }
                        break;
                    }
                }
                return found;
            });
            console.log('Filter applied:', filterApplied);
            await new Promise(r => setTimeout(r, 5000));
            
            // Verify filter
            const verify = await page.evaluate(() => {
                for (let w of document.querySelectorAll('.option-wrapper')) {
                    const n = w.querySelector('.name');
                    if (n && n.innerText.toLowerCase().includes('series type')) {
                        return w.querySelector('.selection')?.innerText.trim() || '';
                    }
                }
                return 'not found';
            });
            console.log('Verified Series Type selection:', verify);
            
        } catch(e){ console.log('Filter error:', e.message); }

        let allMatches = [];
        let pageNum = 1;
        let shouldStop = false;
        const maxPages = 35;

        while (!shouldStop && pageNum <= maxPages) {
            console.log(`\n📄 PAGE ${pageNum} (International only, till 30 Nov)...`);
            
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await new Promise(r => setTimeout(r, 1500));
            await page.evaluate(() => window.scrollTo(0, 0));
            await new Promise(r => setTimeout(r, 1000));

            const data = await page.evaluate(() => {
                const results = [];
                const dateBlocks = document.querySelectorAll('#date-wise-wrap > div');
                dateBlocks.forEach(block => {
                    const dateHeader = block.querySelector('h2.date span')?.innerText.trim() || block.querySelector('h2')?.innerText.trim() || '';
                    if (!dateHeader) return;
                    
                    block.querySelectorAll('li.match-card-container').forEach(card => {
                        try {
                            const anchor = card.querySelector('a.match-card-wrapper');
                            const href = anchor?.getAttribute('href') || card.querySelector('a')?.getAttribute('href') || '';
                            if (!href || !href.includes('cricket-live-score')) return;
                            
                            // Teams
                            let t1Name='', t1Flag='', t1Score='', t1Overs='', t2Name='', t2Flag='', t2Score='', t2Overs='';
                            const teams = card.querySelectorAll('.team');
                            if (teams.length >= 2) {
                                const t1Img = teams[0].querySelector('img');
                                t1Flag = t1Img?.getAttribute('src') || '';
                                t1Name = teams[0].querySelector('.team-name')?.innerText.trim() || t1Img?.alt || 'Team A';
                                t1Score = teams[0].querySelector('.team-score')?.innerText.trim() || '';
                                t1Overs = teams[0].querySelector('.total-overs')?.innerText.trim() || '';
                                
                                const t2Img = teams[1].querySelector('img');
                                t2Flag = t2Img?.getAttribute('src') || '';
                                t2Name = teams[1].querySelector('.team-name')?.innerText.trim() || t2Img?.alt || 'Team B';
                                t2Score = teams[1].querySelector('.team-score')?.innerText.trim() || '';
                                t2Overs = teams[1].querySelector('.total-overs')?.innerText.trim() || '';
                            } else {
                                const imgs = card.querySelectorAll('img');
                                const flags = [];
                                imgs.forEach(img => {
                                    const src = img.src || '';
                                    if (src.includes('cricketvectors') && !src.includes('arrow') && !src.includes('keyboard')) flags.push(src);
                                });
                                if (flags[0]) t1Flag = flags[0];
                                if (flags[1]) t2Flag = flags[1];
                                const txt = card.innerText || '';
                                const lines = txt.split('\n').map(s=>s.trim()).filter(s=>s.length>1 && s.length<30 && !s.toLowerCase().includes('live') && !s.match(/\d{1,2}:\d{2}/) && !s.match(/\d+\/\d+/));
                                if (lines[0]) t1Name = lines[0];
                                if (lines[1]) t2Name = lines[lines.length-1];
                            }

                            // Time extraction
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

            console.log(`Found ${data.length} International matches on page ${pageNum}`);
            data.forEach(d => console.log(`  - ${d.date} | ${d.matchTime} | ${d.team1.name} vs ${d.team2.name} | ${d.seriesInfo}`));

            // Date-wise stop logic
            for (let m of data) {
                try {
                    const parsed = new Date(m.date);
                    if (!isNaN(parsed.getTime())) {
                        if (parsed > new Date(2026, 10, 30, 23, 59, 59)) { shouldStop = true; break; }
                        if (parsed.getMonth() === 11) { shouldStop = true; break; }
                    } else if (m.date.toLowerCase().includes('dec')) { shouldStop = true; break; }
                } catch(e){}
                if (!allMatches.some(x => x.id === m.id)) allMatches.push(m);
            }

            if (shouldStop) { console.log('🛑 Reached beyond Nov 30, stopping'); break; }
            console.log(`Total till now: ${allMatches.length}`);

            // Next page
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

        // Double safety: remove domestic even after International filter
        const domestic = ['ranji','plate','wbbl','hong-kong','nepal','npl','global t20','emirates','ford trophy','csa t20','county','maharaja','duleep','deodhar','vijay hazare','syed mushtaq'];
        const filtered = allMatches.filter(m => {
            const txt = `${m.id} ${m.seriesInfo}`.toLowerCase();
            return !domestic.some(k => txt.includes(k));
        });

        filtered.sort((a,b) => new Date(a.date) - new Date(b.date));

        console.log(`\n✅ FINAL International: ${allMatches.length} -> ${filtered.length} matches (Today to 30 Nov)`);
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(filtered, null, 2));
        console.log(`🎉 DONE! Saved ${filtered.length} matches`);

    } catch (err) {
        console.error('Error:', err.message, err.stack);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
}

scrape();
