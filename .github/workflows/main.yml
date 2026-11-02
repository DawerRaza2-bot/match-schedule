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
console.log(`📅 INTERNATIONAL ONLY`);

async function scrape() {
    let puppeteer;
    try { puppeteer = require('puppeteer-core'); console.log('Using puppeteer-core'); }
    catch { puppeteer = require('puppeteer'); }

    const browser = await puppeteer.launch({
        headless: 'new', channel: 'chrome',
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu']
    }).catch(() => puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] }));

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        await page.setViewport({ width: 1920, height: 1080 });

        // DIRECT INTERNATIONAL URL - Most important fix!
        console.log('📡 Opening DIRECT International URL...');
        await page.goto('https://crex.com/schedule?seriesType=International', { waitUntil: 'networkidle2', timeout: 90000 });
        await new Promise(r => setTimeout(r, 8000));

        let check = await page.evaluate(() => {
            return {
                blocks: document.querySelectorAll('#date-wise-wrap > div').length,
                cards: document.querySelectorAll('#date-wise-wrap li.match-card-container').length,
                filterText: document.querySelector('.option-wrapper .selection')?.innerText || 'not found'
            };
        });
        console.log(`Initial check: ${JSON.stringify(check)}`);

        if (check.filterText.toLowerCase().includes('all series') || check.cards === 0) {
            console.log('🎯 Filter not applied, trying backup click...');
            await page.evaluate(async () => {
                for (let w of document.querySelectorAll('.option-wrapper')) {
                    const n = w.querySelector('.name');
                    if (n && n.innerText.toLowerCase().includes('series type')) {
                        const s = w.querySelector('.selection');
                        if (s) {
                            s.click();
                            await new Promise(r => setTimeout(r, 2000));
                            for (let el of document.querySelectorAll('div, li, span')) {
                                if (el.innerText && el.innerText.trim() === 'International' && el.offsetParent !== null) {
                                    const rect = el.getBoundingClientRect();
                                    if (rect.width > 20 && rect.width < 400 && rect.height > 10) {
                                        if (!el.closest('.option-wrapper')?.querySelector('.name')) {
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
            await new Promise(r => setTimeout(r, 6000));
        }

        let allMatches = [];
        let lastBlockCount = 0;
        let noNewDataCount = 0;
        const maxScrollAttempts = 40;

        console.log('\n📄 Starting INFINITE SCROLL to load all dates...');

        for (let scrollAttempt = 1; scrollAttempt <= maxScrollAttempts; scrollAttempt++) {
            console.log(`\n--- Scroll Attempt ${scrollAttempt} ---`);
            
            await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); });
            await new Promise(r => setTimeout(r, 3000));
            
            const paginationResult = await page.evaluate(() => {
                for (let b of document.querySelectorAll('button')) {
                    const txt = (b.innerText || '').trim();
                    const html = b.innerHTML || '';
                    if ((txt === '>' || txt === '›' || html.includes('arrow-right') || html.includes('keyboard_arrow_right') || html.includes('chevron')) && !b.disabled) {
                        if (b.offsetParent !== null) { b.click(); return { clicked: true }; }
                    }
                }
                return { clicked: false };
            });

            if (paginationResult.clicked) {
                console.log(`Clicked pagination`);
                await new Promise(r => setTimeout(r, 4000));
            }

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

            console.log(`Scroll ${scrollAttempt}: Found ${data.length} total`);
            const uniqueDates = [...new Set(data.map(d => d.date))];
            console.log(`Unique dates: ${uniqueDates.length} - ${uniqueDates.slice(0,3).join(', ')}`);
            
            let shouldStop = false;
            for (let m of data) {
                try {
                    const parsed = new Date(m.date);
                    if (!isNaN(parsed.getTime()) && parsed > END_DATE) { shouldStop = true; break; }
                } catch(e){}
            }
            if (shouldStop) { allMatches = data; break; }

            if (data.length === lastBlockCount) {
                noNewDataCount++;
                if (noNewDataCount >= 3) { allMatches = data; break; }
            } else {
                noNewDataCount = 0;
                lastBlockCount = data.length;
                allMatches = data;
            }
        }

        const domestic = ['ranji','plate','wbbl','hong-kong','nepal','npl','global t20','emirates','ford trophy','csa t20','county','maharaja','duleep','deodhar','vijay hazare','syed mushtaq','miz vs','manipur','nagaland','assam','tripura','bengal','odisha','delhi vs','mgly vs','asm vs','tri vs','ben vs','odsa vs','mnp vs'];
        const filtered = allMatches.filter(m => {
            const txt = `${m.id} ${m.seriesInfo} ${m.team1.name} ${m.team2.name}`.toLowerCase();
            return !domestic.some(k => txt.includes(k));
        });

        const dateFiltered = filtered.filter(m => {
            try {
                const d = new Date(m.date);
                if (isNaN(d.getTime())) return true;
                return d >= START_DATE && d <= END_DATE;
            } catch(e){ return true; }
        });

        dateFiltered.sort((a,b) => new Date(a.date) - new Date(b.date));
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(dateFiltered, null, 2));
        console.log(`\n✅ FINAL: ${dateFiltered.length} International matches`);
        console.log(`🎉 SAVED!`);

    } catch (err) {
        console.error('Error:', err.message, err.stack);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
}

scrape();
