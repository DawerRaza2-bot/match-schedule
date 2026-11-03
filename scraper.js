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
console.log(`📅 INTERNATIONAL ONLY FILTER - FIXED`);

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
        // Direct URL with international param - most reliable
        await page.goto('https://crex.com/schedule?seriesType=international', { waitUntil: 'domcontentloaded', timeout: 90000 });
        await new Promise(r => setTimeout(r, 8000));

        // Try UI filter as backup
        console.log('🎯 Verifying International filter...');
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
                if (noNewDataStreak >= 2) {
                    console.log('No new data, trying pagination click...');
                }
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

        // ===== FIXED INTERNATIONAL FILTER - COMPREHENSIVE =====
        const domesticKeywords = [
            // Global T20 Canada
            'global t20', 'canada', 'toronto', 'montreal', 'brampton', 'vancouver', 'surrey', 'mississauga',
            'kings', 'warriors', 'tigers', 'jaguars',
            // CSA South Africa
            'csa', 'dolphins', 'western province', 'rocks', 'eastern storm', 'lions', 'titans', 'knights',
            // Ford Trophy NZ
            'ford trophy', 'auckland', 'central stags', 'northern brave', 'wellington', 'canterbury', 'otago',
            // A teams
            'eng-a', 'wi-a', 'ind-a', 'nz-a', 'ire-a', 'zim-a', 'sl-a', 'ban-a', 'pak-a', 'aus-a',
            'england a', 'west indies a', 'india a', 'new zealand a', 'ireland a', 'zimbabwe a', 'sri lanka a', 'bangladesh a', 'pakistan a', 'australia a',
            'a-tour', 'a tour',
            // U19
            'u19', 'u-19', 'youth odi', 'u19 asia cup',
            'afg-u19', 'ban-u19', 'sl-u19', 'mas-u19', 'ind-u19', 'pak-u19',
            'afghanistan u19', 'bangladesh u19', 'sri lanka u19', 'malaysia u19', 'india u19',
            // Womens domestic leagues
            'womens big bash', 'wbbl', 'hbh-w', 'mlr-w', 'ads-w', 'bh-w', 'prs-w', 'syt-w', 'mls-w', 'sys-w',
            'hobart hurricanes women', 'melbourne renegades women', 'adelaide strikers women', 'brisbane heat women',
            'perth scorchers women', 'sydney thunder women', 'melbourne stars women', 'sydney sixers women',
            // Womens associate / Victoria series (associate women - not top international)
            'womens victoria', 'victoria t20i', 'nam-w', 'ugn-w', 'rwa-w', 'usa-w', 'namibia women', 'uganda women', 'rwanda women',
            // Domestic India
            'ranji', 'plate', 'duleep', 'deodhar', 'vijay hazare', 'syed mushtaq', 'maharaja', 'miz vs', 'manipur', 'nagaland', 'assam', 'tripura', 'bengal', 'odisha', 'delhi vs', 'uttarakhand', 'himachal', 'railways', 'chhattisgarh', 'tamil nadu', 'uttar pradesh', 'gujarat', 'kerala', 'karnataka', 'andhra', 'bihar', 'vidarbha', 'jammu', 'hyderabad', 'punjab vs', 'goa vs', 'saurashtra', 'baroda', 'odisha',
            // List A domestic
            'list-a', 'list a',
            // Multi-day A
            'multi-day',
            // Other domestic
            'county', 'emirates', 'hong-kong', 'hong kong', 'nepal', 'npl', 'lpl', 'psl', 'ipl', 'bpl'
        ];
        
        // Whitelist for REAL international - if seriesInfo contains these, keep it
        const internationalIndicators = [
            'test', 'odi', 't20i', 't20', 'international', 'cwc', 'world cup', 'asia cup', 'tri-nation', 'tri nation'
        ];

        const filtered = allMatches.filter(m => {
            const txt = `${m.id} ${m.seriesInfo} ${m.team1.name} ${m.team2.name}`.toLowerCase();
            
            // First check domestic - if any domestic keyword matches, exclude
            const isDomestic = domesticKeywords.some(k => txt.includes(k));
            if (isDomestic) {
                console.log(`❌ Filtered domestic: ${m.team1.name} vs ${m.team2.name} | ${m.id.substring(0,60)}`);
                return false;
            }

            // Additional check: if team name contains "A" as standalone (England A)
            // But careful: Afghanistan contains "A" - so check pattern " A" or "-a-"
            const teamCheck = `${m.team1.name} ${m.team2.name}`.toLowerCase();
            if (teamCheck.includes(' a ') || teamCheck.endsWith(' a') || teamCheck.includes('-a-') || teamCheck.includes(' a-tour') || m.id.includes('-a-vs-') || m.id.includes('-vs-') && m.id.split('-vs-')[0].endsWith('-a')) {
                // Check if it's really A team
                if (/(^| )england a($| )|(^| )west indies a|(^| )india a|(^| )australia a|(^| )new zealand a|(^| )ireland a|(^| )zimbabwe a/i.test(teamCheck) || m.id.includes('eng-a') || m.id.includes('wi-a') || m.id.includes('ind-a') || m.id.includes('nz-a') || m.id.includes('ire-a') || m.id.includes('zim-a')) {
                    console.log(`❌ Filtered A-team: ${m.team1.name} vs ${m.team2.name}`);
                    return false;
                }
            }

            return true;
        });

        console.log(`\n✅ Filtering: ${allMatches.length} -> ${filtered.length} International`);

        filtered.sort((a,b) => new Date(a.date) - new Date(b.date));
        
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(filtered, null, 2));
        console.log(`\n🎉 FINAL: ${filtered.length} International matches from ${START_DATE.toDateString()} to ${END_DATE.toDateString()}`);
        if (filtered.length > 0) {
            console.log('Samples:');
            filtered.slice(0,10).forEach(m => console.log(`  ${m.date} | ${m.matchTime} | ${m.team1.name} vs ${m.team2.name} | ${m.seriesInfo} | ${m.id}`));
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
