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
console.log(`📅 INTERNATIONAL ONLY FILTER - FINAL FIXED V2`);

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

        console.log('📡 Opening https://crex.com/schedule?seriesType=international');
        await page.goto('https://crex.com/schedule?seriesType=international', { waitUntil: 'domcontentloaded', timeout: 90000 });
        await new Promise(r => setTimeout(r, 8000));

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

            if (data.length === lastTotal && added === 0) {
                noNewDataStreak++;
            } else {
                noNewDataStreak = 0;
            }
            lastTotal = data.length;

            if (pageNum >= maxPages) break;

            const paginated = await page.evaluate(() => {
                const buttons = document.querySelectorAll('button');
                for (let b of buttons) {
                    const txt = (b.innerText || '').trim();
                    const html = b.innerHTML || '';
                    if ((txt === '>' || txt === '›' || html.includes('arrow-right') || html.includes('keyboard_arrow_right') || html.includes('chevron_right') || html.includes('arrow_right')) && !b.disabled) {
                        if (b.offsetParent !== null) {
                            b.click();
                            return true;
                        }
                    }
                }
                return false;
            });

            console.log(`Pagination clicked: ${paginated}`);
            
            if (!paginated) {
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await new Promise(r => setTimeout(r, 2000));
                await page.evaluate(() => window.scrollTo(0, 0));
                await new Promise(r => setTimeout(r, 2000));
                const afterScroll = await page.evaluate(() => document.querySelectorAll('#date-wise-wrap li.match-card-container').length);
                if (afterScroll === data.length && pageNum > 1) {
                    console.log('No more data after scroll, stopping');
                    break;
                }
            } else {
                await new Promise(r => setTimeout(r, 4000));
            }
            pageNum++;
        }

        console.log(`\n📊 Total scraped (before filter): ${allMatches.length}`);

        // ===== FINAL FIXED FILTER - V2 =====
        // Only filter TRUE domestic, not international tours
        const domesticKeywords = [
            // Nepal Premier League
            'nepal-premier-league', 'biratnagar kings', 'janakpur bolts', 'lumbini lions', 'pokhara avengers',
            // UAE Domestic D20
            'emirates blues', 'emirates red', 'ajman', 'dubai vs', 'sharjah',
            'emb-vs', 'emirates-d20', 'd20-league',
            // Global T20 Canada
            'global t20 canada', 'toronto kings', 'montreal warriors', 'brampton wolves', 'vancouver knights',
            // CSA Pro T20 SA domestic
            'csa-pro-t20', 'csa t20', 'dolphins vs', 'western province', 'rocks vs', 'warriors vs', 'eastern storm', 'lions vs', 'titans vs',
            // Ford Trophy NZ domestic
            'ford-trophy', 'the-ford-trophy',
            // A teams - exact patterns
            '-a-vs-', 'eng-a-vs', 'wi-a-vs', 'ind-a-vs', 'nz-a-vs', 'ire-a-vs', 'zim-a-vs', 'sl-a-vs', 'ban-a-vs', 'pak-a-vs', 'aus-a-vs',
            'england-a-tour', 'west-indies-a-tour', 'india-a-tour', 'new-zealand-a-tour', 'ireland-a-tour', 'zimbabwe-a-tour',
            'england a vs', 'west indies a vs', 'india a vs', 'new zealand a vs',
            // U19
            'u19-vs', '-u19-', 'u-19', 'youth-odi', 'u19-asia-cup', 'u19 asia cup',
            'afg-u19-vs', 'ban-u19-vs', 'sl-u19-vs', 'mas-u19-vs', 'ind-u19-vs', 'pak-u19-vs',
            // Womens domestic leagues - Big Bash etc
            'womens-big-bash', 'womens big bash', 'wbbl', 
            'hbh-w-vs', 'mlr-w-vs', 'ads-w-vs', 'bh-w-vs', 'prs-w-vs', 'syt-w-vs', 'mls-w-vs', 'sys-w-vs',
            'hobart hurricanes women', 'melbourne renegades women', 'adelaide strikers women', 'brisbane heat women',
            'perth scorchers women', 'sydney thunder women', 'melbourne stars women', 'sydney sixers women',
            // Womens associate Victoria series
            'womens-victoria', 'victoria-t20i-series', 'nam-w-vs', 'ugn-w-vs', 'rwa-w-vs', 'usa-w-vs',
            // Pakistan domestic first-class - Quaid-e-Azam Trophy
            'quaid-e-azam-trophy', 'quaid e azam trophy', 'first-class-quaid', 'karb-vs-srb', 'fais-vs-prb', 'lahm-vs-fata', 'islr-vs-mul', 'lahb-vs-rwl', 'lrk-vs-qet', 'bhwr-vs-prw', 'karw-vs-ajk', 'hyd-vs-dmj', 'abt-vs-srw',
            // Domestic India
            'ranji trophy', 'duleep trophy', 'deodhar trophy', 'vijay hazare', 'syed mushtaq ali', 'maharaja trophy',
            // Other domestic
            'county championship', 'lpl', 'psl', 'ipl', 'bpl', 'hong-kong', 'hong kong premier'
        ];

        const filtered = allMatches.filter(m => {
            const txt = `${m.id} ${m.seriesInfo} ${m.team1.name} ${m.team2.name}`.toLowerCase();
            const isDomestic = domesticKeywords.some(k => txt.includes(k));
            if (isDomestic) {
                console.log(`❌ Filtered domestic: ${m.team1.name} vs ${m.team2.name} | ${m.id.substring(0,70)}`);
                return false;
            }
            return true;
        });

        console.log(`\n✅ Filtering: ${allMatches.length} -> ${filtered.length} International`);

        filtered.sort((a,b) => new Date(a.date) - new Date(b.date));
        
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(filtered, null, 2));
        console.log(`\n🎉 FINAL: ${filtered.length} International matches from ${START_DATE.toDateString()} to ${END_DATE.toDateString()}`);
        if (filtered.length > 0) {
            console.log('Samples:');
            filtered.slice(0,15).forEach(m => console.log(`  ${m.date} | ${m.matchTime} | ${m.team1.name} vs ${m.team2.name} | ${m.seriesInfo} | ${m.id}`));
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
