const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'match-schedule.json');

const now = new Date();
now.setHours(0,0,0,0);
const START_DATE = new Date(now); // Today
const END_DATE = new Date(now.getFullYear(), now.getMonth() + 1, 0); // End of THIS month (30/31)
END_DATE.setHours(23,59,59,999);

console.log(`📅 TODAY: ${START_DATE.toDateString()}`);
console.log(`🎯 TARGET: ${START_DATE.toDateString()} to ${END_DATE.toDateString()} (Current date to Month End)`);
console.log(`📅 INTERNATIONAL ONLY + TIME`);

async function scrape() {
    const puppeteer = require('puppeteer-core'); console.log('Using puppeteer-core');

    const browser = await puppeteer.launch({
        headless: 'new', channel: 'chrome',
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu']
    }).catch(() => puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] }));

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        await page.setViewport({ width: 1920, height: 1080 });

        console.log('📡 Opening https://crex.com/schedule');
        await page.goto('https://crex.com/schedule', { waitUntil: 'domcontentloaded', timeout: 90000 });
        await new Promise(r => setTimeout(r, 8000));

        // ===== FIX 1: INTERNATIONAL FILTER VIA UI CLICK (Reliable) =====
        console.log('🎯 Applying International filter via UI...');
        const filterResult = await page.evaluate(async () => {
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));
            let result = { seriesTypeFound: false, clicked: false, finalText: '' };
            
            // Find all filter wrappers
            const wrappers = document.querySelectorAll('.option-wrapper');
            console.log('Found wrappers:', wrappers.length);
            
            for (let w of wrappers) {
                const nameEl = w.querySelector('.name');
                if (!nameEl) continue;
                const nameText = nameEl.innerText.toLowerCase();
                console.log('Wrapper name:', nameText, 'selection:', w.querySelector('.selection')?.innerText);
                
                if (nameText.includes('series type')) {
                    result.seriesTypeFound = true;
                    const selection = w.querySelector('.selection');
                    if (!selection) continue;
                    
                    const selText = selection.innerText.toLowerCase();
                    console.log('Current series type:', selText);
                    
                    if (selText.includes('international')) {
                        console.log('Already International');
                        result.clicked = true;
                        result.finalText = selection.innerText;
                        break;
                    }
                    
                    // Click to open
                    selection.click();
                    await sleep(2000);
                    
                    // Find dropdown options
                    const allElements = document.querySelectorAll('div, li, span');
                    for (let el of allElements) {
                        if (el.innerText && el.innerText.trim() === 'International' && el.offsetParent !== null) {
                            const rect = el.getBoundingClientRect();
                            // Check if it's a dropdown option (not the selection itself)
                            if (rect.width > 20 && rect.width < 500 && rect.height > 10 && rect.height < 100) {
                                const isSelection = el.classList.contains('selection') || el.closest('.selection');
                                const parentWrapper = el.closest('.option-wrapper');
                                // Make sure it's not the selection box itself
                                if (!isSelection && (!parentWrapper || parentWrapper.querySelector('.name')?.innerText.toLowerCase().includes('series type') === false || el !== selection)) {
                                    // Check if this element is in a dropdown
                                    const style = window.getComputedStyle(el);
                                    if (el.offsetParent !== null) {
                                        console.log('Clicking International option:', el.tagName, el.innerText, rect);
                                        el.click();
                                        result.clicked = true;
                                        await sleep(1000);
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    await sleep(3000);
                    result.finalText = document.querySelector('.option-wrapper .selection')?.innerText || selection.innerText;
                    break;
                }
            }
            return result;
        });
        
        console.log(`Filter result: ${JSON.stringify(filterResult)}`);
        await new Promise(r => setTimeout(r, 5000));

        // Verify
        const verify = await page.evaluate(() => {
            const wrappers = document.querySelectorAll('.option-wrapper');
            for (let w of wrappers) {
                const n = w.querySelector('.name');
                if (n && n.innerText.toLowerCase().includes('series type')) {
                    return w.querySelector('.selection')?.innerText.trim() || '';
                }
            }
            return 'not found';
        });
        console.log(`Verified Series Type: ${verify}`);

        let allMatches = [];
        let pageNum = 1;
        const maxPages = 35;
        let noNewDataStreak = 0;
        let lastTotal = 0;

        console.log('\n📄 Starting to scrape from Today to Month End...');

        while (pageNum <= maxPages) {
            console.log(`\n--- PAGE ${pageNum} ---`);
            
            const data = await page.evaluate(() => {
                const results = [];
                const blocks = document.querySelectorAll('#date-wise-wrap > div');
                blocks.forEach(block => {
                    const dateEl = block.querySelector('h2.date span') || block.querySelector('h2 span') || block.querySelector('h2');
                    const dateHeader = dateEl ? dateEl.innerText.trim() : '';
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

            console.log(`Page ${pageNum}: Found ${data.length} matches`);
            const uniqueDates = [...new Set(data.map(d => d.date))];
            console.log(`Unique dates on page: ${uniqueDates.length} - ${uniqueDates.join(', ')}`);
            data.slice(0,3).forEach(d => console.log(`  - ${d.date} | ${d.matchTime} | ${d.team1.name} vs ${d.team2.name}`));

            // Add new matches
            let added = 0;
            for (let m of data) {
                if (!allMatches.some(x => x.id === m.id)) {
                    // Date check: only from today to month end
                    try {
                        const parsed = new Date(m.date);
                        if (!isNaN(parsed.getTime())) {
                            if (parsed < START_DATE) {
                                console.log(`Skip before today: ${m.date}`);
                                continue;
                            }
                            if (parsed > END_DATE) {
                                console.log(`Beyond month end: ${m.date}, will stop after this page`);
                                // Don't break, just don't add beyond
                                continue;
                            }
                        }
                    } catch(e){}
                    allMatches.push(m);
                    added++;
                }
            }
            console.log(`Added ${added} new, Total: ${allMatches.length}`);

            // Check if we reached month end
            try {
                const lastDate = uniqueDates[uniqueDates.length - 1];
                if (lastDate) {
                    const parsedLast = new Date(lastDate);
                    if (!isNaN(parsedLast.getTime()) && parsedLast > END_DATE) {
                        console.log(`✅ Reached beyond month end: ${lastDate}, stopping`);
                        break;
                    }
                }
            } catch(e){}

            if (data.length === lastTotal && added === 0) {
                noNewDataStreak++;
                console.log(`No new data streak: ${noNewDataStreak}`);
                if (noNewDataStreak >= 2) {
                    console.log('No new data, trying pagination click...');
                }
            } else {
                noNewDataStreak = 0;
            }
            lastTotal = data.length;

            if (pageNum >= maxPages) break;

            // ===== FIX 2: PAGINATION - Try multiple methods =====
            const paginated = await page.evaluate(() => {
                // Debug: list all buttons
                const buttons = document.querySelectorAll('button');
                console.log('Buttons found:', buttons.length);
                buttons.forEach((b, i) => {
                    if (i < 10) console.log(`Button ${i}: text="${b.innerText.trim()}" html="${b.innerHTML.substring(0,100)}" disabled=${b.disabled} visible=${b.offsetParent !== null}`);
                });

                // Method 1: Arrow buttons
                for (let b of buttons) {
                    const txt = (b.innerText || '').trim();
                    const html = b.innerHTML || '';
                    // Look for > or arrow icons
                    if ((txt === '>' || txt === '›' || html.includes('arrow-right') || html.includes('keyboard_arrow_right') || html.includes('chevron_right') || html.includes('arrow_right')) && !b.disabled) {
                        if (b.offsetParent !== null) {
                            console.log('Clicking arrow button:', txt);
                            b.click();
                            return true;
                        }
                    }
                }
                
                // Method 2: Pagination container
                const pagContainers = document.querySelectorAll('.pagination, [class*="pagination"], [class*="pager"], [class*="page-nav"]');
                for (let pag of pagContainers) {
                    const nextBtn = pag.querySelector('button:last-child, a:last-child, [class*="next"]');
                    if (nextBtn && !nextBtn.disabled && nextBtn.offsetParent !== null) {
                        console.log('Clicking pagination container next');
                        nextBtn.click();
                        return true;
                    }
                }
                
                // Method 3: Date navigation arrows
                const dateNav = document.querySelectorAll('[class*="date"] button, [class*="calendar"] button, [class*="nav"] button');
                for (let btn of dateNav) {
                    const html = btn.innerHTML || '';
                    if ((html.includes('right') || html.includes('next')) && !btn.disabled && btn.offsetParent !== null) {
                        console.log('Clicking date nav');
                        btn.click();
                        return true;
                    }
                }
                
                return false;
            });

            console.log(`Pagination clicked: ${paginated}`);
            
            if (!paginated) {
                // Try scroll to load more
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await new Promise(r => setTimeout(r, 2000));
                await page.evaluate(() => window.scrollTo(0, 0));
                await new Promise(r => setTimeout(r, 2000));
                
                // Check if new data loaded after scroll
                const afterScroll = await page.evaluate(() => document.querySelectorAll('#date-wise-wrap li.match-card-container').length);
                console.log(`After scroll, total cards: ${afterScroll}`);
                
                if (afterScroll === data.length && pageNum > 1) {
                    console.log('No more data after scroll, stopping');
                    break;
                }
            } else {
                await new Promise(r => setTimeout(r, 4000));
            }

            pageNum++;
        }

        console.log(`\n📊 Total scraped: ${allMatches.length}`);

        // Domestic filter
        const domestic = ['ranji','plate','wbbl','hong-kong','nepal','npl','global t20','emirates','ford trophy','csa t20','county','maharaja','duleep','deodhar','vijay hazare','syed mushtaq','miz vs','manipur','nagaland','assam','tripura','bengal','odisha','delhi vs','uttarakhand','himachal','railways','chhattisgarh','tamil nadu','uttar pradesh','gujarat','kerala','karnataka','andhra','bihar','vidarbha','jammu','hyderabad','punjab vs','goa vs','cg vs','up vs','mgly vs','asm vs','tri vs','ben vs','odsa vs','mnp vs','miz vs','ap vs','ker vs','ser vs','har vs','raj vs','mum vs','tn vs','brd vs','bihr vs','mp vs','pdc vs','chg vs','andr vs','saurashtra','baroda','odisha'];
        
        const filtered = allMatches.filter(m => {
            const txt = `${m.id} ${m.seriesInfo} ${m.team1.name} ${m.team2.name}`.toLowerCase();
            const isDom = domestic.some(k => txt.includes(k));
            if (isDom) console.log(`Filtered domestic: ${m.team1.name} vs ${m.team2.name}`);
            return !isDom;
        });

        console.log(`\nFiltering: ${allMatches.length} -> ${filtered.length} International`);

        filtered.sort((a,b) => new Date(a.date) - new Date(b.date));
        
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(filtered, null, 2));
        console.log(`\n✅ FINAL: ${filtered.length} International matches from ${START_DATE.toDateString()} to ${END_DATE.toDateString()}`);
        if (filtered.length > 0) {
            console.log('Samples:');
            filtered.slice(0,5).forEach(m => console.log(`  ${m.date} | ${m.matchTime} | ${m.team1.name} vs ${m.team2.name} | ${m.seriesInfo}`));
        }
        console.log(`🎉 SAVED!`);

    } catch (err) {
        console.error('Error:', err.message, err.stack);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
}

scrape();
