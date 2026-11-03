const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'match-schedule.json');

const now = new Date();
now.setHours(0,0,0,0);
const START_DATE = new Date(now);
const END_DATE = new Date(now.getFullYear(), now.getMonth() + 1, 0);
END_DATE.setHours(23,59,59,999);

console.log(`📅 TODAY: ${START_DATE.toDateString()}`);
console.log(`🎯 TARGET: ${START_DATE.toDateString()} to ${END_DATE.toDateString()}`);
console.log(`📅 TEST MODE: ALL MATCHES - NO FILTER - FOR TESTING`);

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

        console.log('📡 Opening https://crex.com/schedule (ALL SERIES - NO FILTER)');
        await page.goto('https://crex.com/schedule', { waitUntil: 'domcontentloaded', timeout: 90000 });
        await new Promise(r => setTimeout(r, 8000));

        let allMatches = [];
        let pageNum = 1;
        const maxPages = 35;
        let lastTotal = 0;

        console.log('\n📄 Starting to scrape ALL matches from Today to Month End (NO FILTER)...');

        while (pageNum <= maxPages) {
            console.log(`\n--- PAGE ${pageNum} ---`);
            
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
                        const timeEl = card.querySelector('.time span') || card.querySelector('.start-text');
                        const matchTime = timeEl ? timeEl.innerText.trim() : '';
                        const seriesEl = card.querySelector('.series-name') || card.querySelector('.reason');
                        const seriesInfo = seriesEl ? seriesEl.innerText.trim() : '';
                        const statusEl = card.querySelector('.result span') || card.querySelector('.time .reason');
                        const matchStatus = statusEl ? statusEl.innerText.trim() : matchTime;
                        const liveBadge = card.innerText.includes('Live') ? 'Live' : matchStatus;
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
                            matchTime: liveBadge.toLowerCase().includes('live') ? 'Live' : matchTime,
                            seriesInfo: seriesInfo,
                            matchStatus: liveBadge,
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
            console.log(`Live matches on this page: ${data.filter(m => m.matchTime === 'Live' || m.matchStatus.includes('Live')).length}`);

            const uniqueDates = [...new Set(data.map(d => d.date))];
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

            if (data.length === lastTotal && added === 0 && pageNum > 2) {
                console.log('No more new data, stopping');
                break;
            }
            lastTotal = data.length;

            if (pageNum >= maxPages) break;

            // Try multiple pagination methods
            const paginated = await page.evaluate(() => {
                // Method 1: Look for next arrow buttons
                const buttons = document.querySelectorAll('button');
                for (let b of buttons) {
                    const txt = (b.innerText || '').trim();
                    const html = b.innerHTML || '';
                    // Check if it's next button
                    if ((txt === '>' || txt === '›' || txt === '»' || html.includes('arrow-right') || html.includes('keyboard_arrow_right') || html.includes('chevron_right')) && !b.disabled) {
                        if (b.offsetParent !== null) {
                            const style = window.getComputedStyle(b);
                            if (style.display !== 'none' && style.visibility !== 'hidden') {
                                console.log('Clicking next button:', txt);
                                b.click();
                                return true;
                            }
                        }
                    }
                }
                // Method 2: Try to find pagination container
                const pagNext = document.querySelector('.pagination .next, .pagination button:last-child, [class*="pagination"] button:last-child');
                if (pagNext && !pagNext.disabled && pagNext.offsetParent !== null) {
                    pagNext.click();
                    return true;
                }
                return false;
            });

            console.log(`Pagination clicked: ${paginated}`);
            
            if (!paginated) {
                // Scroll to try to trigger infinite scroll or load more
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await new Promise(r => setTimeout(r, 3000));
                await page.evaluate(() => window.scrollTo(0, 0));
                await new Promise(r => setTimeout(r, 2000));
                
                const afterScroll = await page.evaluate(() => document.querySelectorAll('#date-wise-wrap li.match-card-container').length);
                console.log(`After scroll, total cards in DOM: ${afterScroll}`);
                
                if (afterScroll === data.length && pageNum > 3) {
                    console.log('No more data after scroll, trying to click date navigation');
                    // Try clicking next date arrow
                    const dateNavClicked = await page.evaluate(() => {
                        const dateNav = document.querySelectorAll('button');
                        for (let btn of dateNav) {
                            const html = btn.innerHTML || '';
                            if ((html.includes('right') || btn.innerText.trim() === '>') && btn.offsetParent !== null) {
                                // Check if it's near date header
                                const rect = btn.getBoundingClientRect();
                                if (rect.top < 300) { // near top
                                    btn.click();
                                    return true;
                                }
                            }
                        }
                        return false;
                    });
                    if (!dateNavClicked) {
                        console.log('No more pages, stopping');
                        break;
                    }
                }
            } else {
                await new Promise(r => setTimeout(r, 4000));
            }
            pageNum++;
        }

        console.log(`\n📊 Total scraped (ALL - NO FILTER): ${allMatches.length}`);
        console.log(`Live matches: ${allMatches.filter(m => m.matchTime === 'Live' || m.matchStatus.toLowerCase().includes('live')).length}`);

        allMatches.sort((a,b) => new Date(a.date) - new Date(b.date));
        
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allMatches, null, 2));
        console.log(`\n🎉 FINAL: ${allMatches.length} matches (ALL TYPES) from ${START_DATE.toDateString()} to ${END_DATE.toDateString()}`);
        if (allMatches.length > 0) {
            console.log('Samples:');
            allMatches.slice(0,20).forEach(m => console.log(`  ${m.date} | ${m.matchTime} | ${m.team1.name} vs ${m.team2.name} | ${m.seriesInfo} | ${m.matchStatus}`));
            console.log(`\nLive now: ${allMatches.filter(m => m.matchTime === 'Live').length} matches`);
            allMatches.filter(m => m.matchTime === 'Live').slice(0,10).forEach(m => console.log(`  LIVE: ${m.team1.name} vs ${m.team2.name} | ${m.detailUrl}`));
        }
        console.log(`✅ SAVED to ${OUTPUT_FILE}`);

    } catch (err) {
        console.error('Error:', err.message, err.stack);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
}

scrape();
