const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'match-schedule.json');
const END_DATE = new Date(2026, 10, 30); // 30 Nov 2026

console.log(`📅 Scraping from Today to ${END_DATE.toDateString()} - WITH TIME`);

async function scrapeDateWiseWithTime() {
    console.log('🚀 [DATE-WISE + TIME Scraper] Starting...');
    
    let puppeteer;
    try {
        puppeteer = require('puppeteer-core');
        console.log('Using puppeteer-core');
    } catch {
        puppeteer = require('puppeteer');
        console.log('Using puppeteer');
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

        console.log('📡 Opening CREX schedule...');
        await page.goto('https://crex.com/schedule', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));

        // Apply International filter
        console.log('🎯 Applying International filter...');
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
        let pageNum = 1;
        let shouldStop = false;
        const maxPagesSafety = 25;

        while (!shouldStop && pageNum <= maxPagesSafety) {
            console.log(`\n📄 Scraping Page ${pageNum} (Till 30 Nov)...`);
            await new Promise(r => setTimeout(r, 2000));
            
            const data = await page.evaluate(() => {
                const results = [];
                const dateBlocks = document.querySelectorAll('#date-wise-wrap > div');
                
                dateBlocks.forEach((block) => {
                    const dateHeaderEl = block.querySelector('h2.date span');
                    const dateHeader = dateHeaderEl?.innerText.trim() || 'Upcoming';
                    
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

                        // ===== TIME EXTRACTION - NEW =====
                        let matchTime = '';
                        let matchTimeRaw = '';
                        
                        // Method 1: Look for time element in center
                        const timeSelectors = [
                            '.time',
                            '.start-text',
                            '.match-time',
                            '[class*="time"]',
                            '.center-time',
                            '.middle div'
                        ];
                        
                        for (let sel of timeSelectors) {
                            const el = card.querySelector(sel);
                            if (el) {
                                const txt = el.innerText.trim();
                                // Check if it looks like time: 10:00 PM, Live, etc.
                                if (txt.match(/\d{1,2}:\d{2}\s*(AM|PM)/i) || txt.toLowerCase().includes('live')) {
                                    matchTime = txt;
                                    matchTimeRaw = txt;
                                    break;
                                }
                            }
                        }
                        
                        // Method 2: Parse from full card text if not found
                        if (!matchTime) {
                            const fullText = card.innerText || '';
                            const lines = fullText.split('\n').map(s => s.trim());
                            for (let line of lines) {
                                // Time patterns: 10:00 PM, 10:30 AM, Live, etc.
                                if (line.match(/\d{1,2}:\d{2}\s*(AM|PM)/i)) {
                                    matchTime = line;
                                    matchTimeRaw = line;
                                    break;
                                }
                                if (line.toLowerCase() === 'live' || line.includes('• Live')) {
                                    matchTime = 'Live';
                                    matchTimeRaw = line;
                                    break;
                                }
                            }
                        }
                        
                        // Method 3: Look for center column text
                        if (!matchTime) {
                            // In screenshot, time is in middle column
                            const centerDiv = card.querySelector('.center, .middle, [class*="center"]');
                            if (centerDiv) {
                                const centerText = centerDiv.innerText.trim();
                                const timeMatch = centerText.match(/\d{1,2}:\d{2}\s*(AM|PM)/i);
                                if (timeMatch) {
                                    matchTime = timeMatch[0];
                                } else if (centerText.toLowerCase().includes('live')) {
                                    matchTime = 'Live';
                                }
                            }
                        }

                        const startText = card.querySelector('.start-text')?.innerText.trim() || '';
                        const infoText = card.querySelector('.reason')?.innerText.trim() || card.querySelector('.time')?.innerText.trim() || '';
                        const resultText = card.querySelector('.result span')?.innerText.trim() || '';
                        
                        // Series info - from reason or time
                        let seriesInfo = infoText;
                        if (!seriesInfo || seriesInfo.match(/\d{1,2}:\d{2}/)) {
                            // If infoText is actually time, look for reason
                            const reasonEl = card.querySelector('.reason');
                            if (reasonEl) seriesInfo = reasonEl.innerText.trim();
                        }

                        const slug = href.split('/cricket-live-score/')[1] || href;
                        
                        results.push({
                            id: slug,
                            date: dateHeader,
                            matchTime: matchTime || startText || 'TBD',
                            matchTimeRaw: matchTimeRaw || startText,
                            seriesInfo: seriesInfo,
                            matchStatus: resultText || (matchTime && matchTime.toLowerCase().includes('live') ? 'Live' : (startText ? `Starts at ${startText}` : (matchTime ? matchTime : 'Scheduled'))),
                            team1: { name: t1Name, flagUrl: t1Flag, score: t1Score, overs: t1Overs },
                            team2: { name: t2Name, flagUrl: t2Flag, score: t2Score, overs: t2Overs },
                            detailUrl: `https://crex.com${href}`,
                            scrapedAt: new Date().toISOString()
                        });
                    });
                });
                return results;
            });

            console.log(`Found ${data.length} matches on page ${pageNum}`);

            for (let match of data) {
                const dateStr = match.date;
                try {
                    const parsed = new Date(dateStr);
                    if (!isNaN(parsed.getTime())) {
                        if (parsed > new Date(2026, 10, 30, 23, 59, 59)) {
                            console.log(`🛑 Beyond target: ${dateStr} > 30 Nov, stopping.`);
                            shouldStop = true;
                            break;
                        }
                        if (parsed.getMonth() === 11) {
                            console.log(`🛑 December reached: ${dateStr}, stopping.`);
                            shouldStop = true;
                            break;
                        }
                    } else if (dateStr.toLowerCase().includes('dec')) {
                        console.log(`🛑 Dec in string: ${dateStr}, stopping.`);
                        shouldStop = true;
                        break;
                    }
                } catch(e) {}
                
                if (!shouldStop && !allMatches.some(x => x.id === match.id)) {
                    allMatches.push(match);
                }
            }

            if (shouldStop) break;

            console.log(`Total till Nov: ${allMatches.length}`);

            const clicked = await page.evaluate(() => {
                const btns = document.querySelectorAll('button');
                for (let b of btns) {
                    if (b.innerText.trim() === '>' || b.innerHTML.includes('arrow-right') || b.innerHTML.includes('keyboard_arrow_right')) {
                        if (!b.disabled && b.offsetParent !== null) { 
                            b.click(); 
                            return true; 
                        }
                    }
                }
                return false;
            });
            
            if (!clicked) {
                console.log('No next button, ending');
                break;
            }
            await new Promise(r => setTimeout(r, 3500));
            pageNum++;
        }

        const domestic = ['ranji','plate','wbbl','hong-kong','hong kong','nepal','npl','global t20','emirates','ford trophy','csa','county','first class','list a','womens big bash','big bash','lpl','psl','ipl','maharaja','duleep'];
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

        console.log(`\n✅ FINAL: ${allMatches.length} -> ${filtered.length} matches (International + Till Nov 30 + With Time)`);

        filtered.sort((a,b) => new Date(a.date) - new Date(b.date));

        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(filtered, null, 2));
        console.log(`🎉 DONE! ${filtered.length} matches saved`);
        console.log('Sample with time:', JSON.stringify(filtered.slice(0,2), null, 2));

    } catch (err) {
        console.error('Error:', err.message, err.stack);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
}

scrapeDateWiseWithTime();
