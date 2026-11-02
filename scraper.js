const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'match-schedule.json');

const now = new Date();
now.setHours(0,0,0,0);
let targetMonth = now.getMonth() + 1;
let targetYear = now.getFullYear();
if (targetMonth > 11) { targetMonth = 0; targetYear += 1; }
const START_DATE = new Date(now);
const END_DATE = new Date(targetYear, targetMonth + 1, 0);

console.log(`📅 TODAY: ${now.toDateString()}`);
console.log(`🎯 TARGET: ${START_DATE.toDateString()} to ${END_DATE.toDateString()}`);
console.log(`📅 INTERNATIONAL ONLY via DIRECT URL`);

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

        // DIRECT FILTER URL - No click needed!
        const urlsToTry = [
            'https://crex.com/schedule?seriesType=International',
            'https://crex.com/schedule?filter=international',
            'https://crex.com/schedule'
        ];

        let loaded = false;
        for (let url of urlsToTry) {
            try {
                console.log(`📡 Trying ${url}`);
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await new Promise(r => setTimeout(r, 8000));
                
                // Check if we got international matches or need to click filter
                const check = await page.evaluate(() => {
                    const texts = [];
                    document.querySelectorAll('#date-wise-wrap li.match-card-container .reason').forEach(el => texts.push(el.innerText));
                    return { 
                        blockCount: document.querySelectorAll('#date-wise-wrap > div').length,
                        cardCount: document.querySelectorAll('#date-wise-wrap li.match-card-container').length,
                        sampleReasons: texts.slice(0,3)
                    };
                });
                console.log(`Check ${url}: blocks=${check.blockCount}, cards=${check.cardCount}, samples=${JSON.stringify(check.sampleReasons)}`);
                
                if (check.cardCount > 0) {
                    loaded = true;
                    // If still showing domestic, try to click filter as backup
                    if (url === urlsToTry[2]) {
                        console.log('🎯 Applying filter via click (backup)...');
                        await page.evaluate(async () => {
                            for (let w of document.querySelectorAll('.option-wrapper')) {
                                const n = w.querySelector('.name');
                                if (n && n.innerText.toLowerCase().includes('series type')) {
                                    const s = w.querySelector('.selection');
                                    if (s && !s.innerText.toLowerCase().includes('international')) {
                                        s.click();
                                        await new Promise(r => setTimeout(r, 2000));
                                        for (let el of document.querySelectorAll('div, li')) {
                                            if (el.innerText && el.innerText.trim() === 'International' && el.offsetParent !== null) {
                                                const r = el.getBoundingClientRect();
                                                if (r.width > 20 && r.width < 300) {
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
                    }
                    break;
                }
            } catch(e){ console.log(`Failed ${url}:`, e.message); }
        }

        let allMatches = [];
        let pageNum = 1;
        let shouldStop = false;
        const maxPages = 30;

        while (!shouldStop && pageNum <= maxPages) {
            console.log(`\n📄 PAGE ${pageNum}...`);
            
            // Scroll to load
            for (let i = 0; i < 3; i++) {
                await page.evaluate(() => window.scrollBy(0, 500));
                await new Promise(r => setTimeout(r, 500));
            }
            await page.evaluate(() => window.scrollTo(0, 0));
            await new Promise(r => setTimeout(r, 1000));

            const data = await page.evaluate(() => {
                const results = [];
                const blocks = document.querySelectorAll('#date-wise-wrap > div');
                blocks.forEach(block => {
                    const dateEl = block.querySelector('h2.date span') || block.querySelector('h2 span') || block.querySelector('h2');
                    const dateHeader = dateEl ? dateEl.innerText.trim() : 'Unknown';
                    if (!dateHeader || dateHeader.length < 5) return;
                    
                    const cards = block.querySelectorAll('li.match-card-container');
                    cards.forEach(card => {
                        try {
                            const anchor = card.querySelector('a.match-card-wrapper') || card.querySelector('a[href*="cricket-live-score"]');
                            const href = anchor ? anchor.getAttribute('href') : '';
                            if (!href || !href.includes('cricket-live-score')) return;
                            
                            let t1Name='Team A', t1Flag='', t1Score='', t1Overs='', t2Name='Team B', t2Flag='', t2Score='', t2Overs='';
                            const teams = card.querySelectorAll('.team');
                            if (teams.length >= 2) {
                                const t1Img = teams[0].querySelector('img');
                                t1Flag = t1Img ? t1Img.src : '';
                                t1Name = teams[0].querySelector('.team-name') ? teams[0].querySelector('.team-name').innerText.trim() : (t1Img ? t1Img.alt : 'Team A');
                                t1Score = teams[0].querySelector('.team-score') ? teams[0].querySelector('.team-score').innerText.trim() : '';
                                t1Overs = teams[0].querySelector('.total-overs') ? teams[0].querySelector('.total-overs').innerText.trim() : '';
                                
                                const t2Img = teams[1].querySelector('img');
                                t2Flag = t2Img ? t2Img.src : '';
                                t2Name = teams[1].querySelector('.team-name') ? teams[1].querySelector('.team-name').innerText.trim() : (t2Img ? t2Img.alt : 'Team B');
                                t2Score = teams[1].querySelector('.team-score') ? teams[1].querySelector('.team-score').innerText.trim() : '';
                                t2Overs = teams[1].querySelector('.total-overs') ? teams[1].querySelector('.total-overs').innerText.trim() : '';
                            }
                            
                            let matchTime = '';
                            const fullText = card.innerText || '';
                            const timeMatch = fullText.match(/\d{1,2}:\d{2}\s*(AM|PM)/i);
                            if (timeMatch) matchTime = timeMatch[0];
                            else if (fullText.toLowerCase().includes('live')) matchTime = 'Live';
                            else {
                                const st = card.querySelector('.start-text');
                                if (st) matchTime = st.innerText.trim();
                            }
                            
                            const seriesInfo = card.querySelector('.reason') ? card.querySelector('.reason').innerText.trim() : '';
                            const resultText = card.querySelector('.result span') ? card.querySelector('.result span').innerText.trim() : '';
                            
                            const clean = (s) => s ? s.replace(/\n.*/g,'').replace(/\d+\/\d+.*/g,'').trim().split('  ')[0].trim() : '';
                            
                            results.push({
                                id: href.split('/cricket-live-score/')[1] || href,
                                date: dateHeader,
                                matchTime: matchTime || 'TBD',
                                seriesInfo: seriesInfo,
                                matchStatus: resultText || matchTime || 'Scheduled',
                                team1: { name: clean(t1Name), flagUrl: t1Flag, score: t1Score, overs: t1Overs },
                                team2: { name: clean(t2Name), flagUrl: t2Flag, score: t2Score, overs: t2Overs },
                                detailUrl: href.startsWith('http') ? href : `https://crex.com${href}`,
                                scrapedAt: new Date().toISOString()
                            });
                        } catch(e){}
                    });
                });
                return results;
            });

            console.log(`Found ${data.length} on page ${pageNum}`);
            data.forEach(d => console.log(`  - ${d.date} | ${d.matchTime} | ${d.team1.name} vs ${d.team2.name} | ${d.seriesInfo}`));

            // Date check
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

            // IMPROVED PAGINATION - Try multiple ways
            let clicked = false;
            try {
                clicked = await page.evaluate(() => {
                    // Method 1: Button with >
                    for (let b of document.querySelectorAll('button')) {
                        const txt = (b.innerText || '').trim();
                        const html = b.innerHTML || '';
                        if (txt === '>' || txt === '›' || html.includes('arrow-right') || html.includes('keyboard_arrow_right') || html.includes('chevron_right')) {
                            if (!b.disabled && b.offsetParent !== null) {
                                console.log('Clicking next:', txt, html.substring(0,100));
                                b.click();
                                return true;
                            }
                        }
                    }
                    // Method 2: Look for pagination container
                    const pag = document.querySelector('.pagination, [class*="pagination"], [class*="pager"]');
                    if (pag) {
                        const next = pag.querySelector('button:last-child, a:last-child');
                        if (next && !next.disabled) {
                            next.click();
                            return true;
                        }
                    }
                    return false;
                });
                
                if (!clicked) {
                    // Method 3: Try keyboard right arrow
                    await page.keyboard.press('ArrowRight');
                    await new Promise(r => setTimeout(r, 1000));
                    const afterPress = await page.evaluate(() => {
                        return document.querySelectorAll('#date-wise-wrap > div').length;
                    });
                    console.log(`After arrow press, blocks: ${afterPress}`);
                }
            } catch(e){ console.log('Pagination error:', e.message); }

            console.log(`Next clicked: ${clicked}`);
            if (!clicked) {
                console.log('No more pages found, stopping');
                break;
            }
            
            await new Promise(r => setTimeout(r, 5000));
            pageNum++;
        }

        // Domestic filter
        const domestic = ['ranji','plate','wbbl','hong-kong','hong kong','nepal','npl','global t20','emirates','ford trophy','csa t20','county','maharaja','duleep','deodhar','vijay hazare','syed mushtaq','miz vs','manipur','nagaland','assam','tripura','bengal','odisha','delhi vs','uttarakhand','himachal','railways','chhattisgarh','tamil nadu','uttar pradesh','gujarat','kerala','karnataka','andhra','bihar','vidarbha','jammu','hyderabad','punjab vs','mgly vs','asm vs','tri vs','ben vs','odsa vs','mnp vs','goa vs','cg vs','up vs'];
        
        console.log(`\nFiltering ${allMatches.length} matches...`);
        const filtered = allMatches.filter(m => {
            const txt = `${m.id} ${m.seriesInfo} ${m.team1.name} ${m.team2.name}`.toLowerCase();
            const isDomestic = domestic.some(k => txt.includes(k));
            if (isDomestic) console.log(`  Filtered domestic: ${m.team1.name} vs ${m.team2.name} - ${m.seriesInfo}`);
            return !isDomestic;
        });

        filtered.sort((a,b) => new Date(a.date) - new Date(b.date));

        console.log(`\n✅ FINAL: ${allMatches.length} -> ${filtered.length} International matches`);
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(filtered, null, 2));
        console.log(`🎉 SAVED ${filtered.length} matches`);
        if (filtered.length > 0) console.log(JSON.stringify(filtered.slice(0,3), null, 2));

    } catch (err) {
        console.error('Error:', err.message, err.stack);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
}

scrape();
