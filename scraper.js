const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'match-schedule.json');

const now = new Date();
now.setHours(0,0,0,0);
const START_DATE = new Date(now);
const END_DATE = new Date(now.getFullYear(), now.getMonth() + 1, 0);
END_DATE.setHours(23,59,59,999);

console.log(`📅 TODAY: ${START_DATE.toDateString()} to ${END_DATE.toDateString()}`);
console.log(`🎯 INTERNATIONAL ONLY - UI FILTER - TIME FIX FINAL`);

async function scrape() {
    const puppeteer = require('puppeteer-core');
    console.log('Using puppeteer-core');

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
        await new Promise(r => setTimeout(r, 10000));

        // UI CLICK - Series Type -> International
        console.log('🎯 Selecting Series Type -> International');
        const filterClicked = await page.evaluate(async () => {
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));
            let allSeriesEl = null;
            const allElements = document.querySelectorAll('*');
            for (let el of allElements) {
                if (el.innerText && el.innerText.trim() === 'All Series' && el.offsetParent !== null) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 50 && rect.width < 600 && rect.height > 15 && rect.height < 80) {
                        allSeriesEl = el;
                        break;
                    }
                }
            }
            if (!allSeriesEl) {
                const labels = document.querySelectorAll('*');
                for (let label of labels) {
                    if (label.innerText && label.innerText.trim() === 'Series Type') {
                        const parent = label.parentElement;
                        if (parent) {
                            for (let child of parent.querySelectorAll('*')) {
                                if (child.innerText && child.innerText.trim() === 'All Series' && child !== label) {
                                    allSeriesEl = child;
                                    break;
                                }
                            }
                        }
                        if (allSeriesEl) break;
                    }
                }
            }
            if (!allSeriesEl) return { found: false };
            allSeriesEl.click();
            await sleep(3000);
            let internationalEl = null;
            for (let opt of document.querySelectorAll('*')) {
                if (opt.innerText && opt.innerText.trim() === 'International' && opt.offsetParent !== null) {
                    const rect = opt.getBoundingClientRect();
                    if (rect.width > 20 && rect.width < 500 && rect.height > 10 && rect.height < 100) {
                        internationalEl = opt;
                        break;
                    }
                }
            }
            if (!internationalEl) return { found: false };
            internationalEl.click();
            await sleep(5000);
            return { found: true };
        });

        console.log(`Filter: ${JSON.stringify(filterClicked)}`);
        await new Promise(r => setTimeout(r, 8000));

        let allMatches = [];
        let pageNum = 1;
        const maxPages = 40;

        console.log('\n📄 Scraping with TIME FIX...');

        while (pageNum <= maxPages) {
            console.log(`--- PAGE ${pageNum} ---`);
            
            const data = await page.evaluate(() => {
                const results = [];
                const blocks = document.querySelectorAll('#date-wise-wrap > div');
                blocks.forEach(block => {
                    const dateEl = block.querySelector('h2.date span') || block.querySelector('h2 span') || block.querySelector('h2');
                    const dateHeader = dateEl ? dateEl.innerText.trim() : 'Unknown Date';
                    const cards = block.querySelectorAll('li.match-card-container');
                    cards.forEach(card => {
                        const link = card.querySelector('a[href*="cricket-live-score"]');
                        if (!link) return;
                        const href = link.getAttribute('href');
                        if (!href) return;
                        
                        // TIME FIX: Look for real time with AM/PM, not "1st"
                        let matchTime = '';
                        // Try all possible time selectors
                        const timeSelectors = ['.time span', '.start-text', '.time', '.match-time', '.time-text'];
                        let timeCandidates = [];
                        timeSelectors.forEach(sel => {
                            card.querySelectorAll(sel).forEach(el => {
                                const txt = el.innerText.trim();
                                if (txt) timeCandidates.push(txt);
                            });
                        });
                        // Also check card innerText for time pattern
                        const cardText = card.innerText;
                        const timeRegex = /(\d{1,2}:\d{2}\s*(AM|PM)|\d{1,2}\s*(AM|PM))/gi;
                        const timeMatches = cardText.match(timeRegex);
                        if (timeMatches) timeCandidates = timeCandidates.concat(timeMatches);
                        
                        // Find first valid AM/PM time
                        for (let t of timeCandidates) {
                            if (t.match(/\d+.*(AM|PM)/i) && !t.includes('st') && !t.includes('nd') && !t.includes('rd') && !t.includes('th') || t.match(/^\d{1,2}:\d{2}/)) {
                                // Must contain : or AM/PM and not be ordinal like 1st
                                if (t.match(/(AM|PM)/i)) {
                                    matchTime = t;
                                    break;
                                }
                            }
                        }
                        // If still no time, check if any candidate has : and is short
                        if (!matchTime) {
                            for (let t of timeCandidates) {
                                if (t.includes(':') && t.length < 20 && !t.toLowerCase().includes('won') && !t.toLowerCase().includes('result')) {
                                    matchTime = t;
                                    break;
                                }
                            }
                        }
                        if (!matchTime) matchTime = '10:00 AM'; // Default for International
                        
                        const seriesEl = card.querySelector('.series-name') || card.querySelector('.reason');
                        const seriesInfo = seriesEl ? seriesEl.innerText.trim() : '';
                        const statusEl = card.querySelector('.result span') || card.querySelector('.time .reason');
                        const matchStatus = statusEl ? statusEl.innerText.trim() : matchTime;
                        const teamEls = card.querySelectorAll('.team');
                        let team1Name = '', team1Flag = '', team1Score = '', team1Overs = '';
                        let team2Name = '', team2Flag = '', team2Score = '', team2Overs = '';
                        if (teamEls.length >= 2) {
                            const t1Img = teamEls[0].querySelector('img');
                            team1Flag = t1Img?.getAttribute('src') || '';
                            team1Name = teamEls[0].querySelector('.team-name')?.innerText.trim() || t1Img?.getAttribute('alt') || 'Team A';
                            team1Score = teamEls[0].querySelector('.team-score')?.innerText.trim() || '';
                            team1Overs = teamEls[0].querySelector('.total-overs')?.innerText.trim() || '';
                            const t2Img = teamEls[1].querySelector('img');
                            team2Flag = t2Img?.getAttribute('src') || '';
                            team2Name = teamEls[1].querySelector('.team-name')?.innerText.trim() || t2Img?.getAttribute('alt') || 'Team B';
                            team2Score = teamEls[1].querySelector('.team-score')?.innerText.trim() || '';
                            team2Overs = teamEls[1].querySelector('.total-overs')?.innerText.trim() || '';
                        }
                        const slug = href.split('/cricket-live-score/')[1] || href;
                        results.push({
                            id: slug,
                            date: dateHeader,
                            matchTime: matchTime,
                            seriesInfo: seriesInfo,
                            matchStatus: matchStatus,
                            team1: { name: team1Name, flagUrl: team1Flag, score: team1Score, overs: team1Overs },
                            team2: { name: team2Name, flagUrl: team2Flag, score: team2Score, overs: team2Overs },
                            detailUrl: `https://crex.com${href}`,
                            scrapedAt: new Date().toISOString()
                        });
                    });
                });
                return results;
            });

            console.log(`Found ${data.length} cards on page ${pageNum}`);
            let added = 0;
            data.forEach(m => {
                if (!allMatches.some(existing => existing.id === m.id)) {
                    allMatches.push(m);
                    added++;
                }
            });
            console.log(`Added ${added} new, Total: ${allMatches.length}`);
            if (pageNum >= maxPages) break;
            const paginated = await page.evaluate(() => {
                const buttons = document.querySelectorAll('button');
                for (let b of buttons) {
                    const txt = (b.innerText || '').trim();
                    if ((txt === '>' || txt === '›') && !b.disabled) {
                        if (b.offsetParent !== null) {
                            b.click();
                            return true;
                        }
                    }
                }
                return false;
            });
            console.log(`Pagination: ${paginated}`);
            if (!paginated) break;
            await new Promise(r => setTimeout(r, 4000));
            pageNum++;
        }

        console.log(`\n📊 Total: ${allMatches.length}`);

        // Filter domestic
        const domesticKeywords = ['nepal-premier', 'biratnagar', 'janakpur', 'lumbini', 'pokhara', 'emirates blues', 'emirates red', 'emirates-d20', 'quaid-e-azam', 'karb-vs-srb', 'fais-vs-prb', 'lahm-vs-fata', 'islr-vs-mul', 'lahb-vs-rwl', 'lrk-vs-qet', 'bhwr-vs-prw', 'eng-a-vs', 'wi-a-vs', 'u19', 'wbbl', 'womens', 'women', 'victoria', 'hong-kong'];
        const filtered = allMatches.filter(m => {
            const txt = `${m.id} ${m.seriesInfo}`.toLowerCase();
            return !domesticKeywords.some(k => txt.includes(k));
        });

        console.log(`After filter: ${filtered.length}`);
        filtered.sort((a,b) => new Date(a.date) - new Date(b.date));
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(filtered, null, 2));
        console.log(`\n🎉 FINAL: ${filtered.length} INTERNATIONAL matches`);
        filtered.slice(0,15).forEach(m => console.log(`  ${m.date} | ${m.matchTime} | ${m.team1.name} vs ${m.team2.name}`));
        console.log(`✅ SAVED`);

    } catch (err) {
        console.error('Error:', err.message, err.stack);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
}

scrape();
