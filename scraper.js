const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'match-schedule.json');

const now = new Date();
now.setHours(0,0,0,0);
const START_DATE = new Date(now);
const END_DATE = new Date(now.getFullYear(), now.getMonth() + 1, 0);
END_DATE.setHours(23,59,59,999);

console.log(`📅 TODAY: ${START_DATE.toDateString()} to ${END_DATE.toDateString()}`);
console.log(`🎯 AUTO INTERNATIONAL - NO UI CLICK - DIRECT FILTER - FINAL AUTO`);

async function scrape() {
    let puppeteer;
    try {
        puppeteer = require('puppeteer-core');
        console.log('Using puppeteer-core');
    } catch(e) {
        puppeteer = require('puppeteer');
        console.log('Using puppeteer');
    }

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new', channel: 'chrome',
            args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']
        });
    } catch(err1) {
        try {
            browser = await puppeteer.launch({
                headless: 'new',
                executablePath: process.env.CHROME_PATH,
                args: ['--no-sandbox']
            });
        } catch(err2) {
            browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
        }
    }

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        await page.setViewport({ width: 1920, height: 1080 });

        // NO FILTER CLICK - Directly scrape https://crex.com/schedule (All matches) then filter International by keywords
        console.log('📡 Opening https://crex.com/schedule (ALL - then filter International)');
        await page.goto('https://crex.com/schedule', { waitUntil: 'domcontentloaded', timeout: 90000 });
        await new Promise(r => setTimeout(r, 10000));

        let allMatches = [];
        let pageNum = 1;
        const maxPages = 40;

        console.log('\n📄 Scraping ALL matches then filtering International...');

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
                        
                        // TIME FIX - Find real AM/PM time
                        let matchTime = '';
                        const cardText = card.innerText;
                        const timeRegex = /(\d{1,2}:\d{2}\s*(AM|PM))/gi;
                        const timeMatches = cardText.match(timeRegex);
                        if (timeMatches && timeMatches.length > 0) {
                            matchTime = timeMatches[0];
                        } else {
                            // Check individual elements
                            const timeEl = card.querySelector('.time span') || card.querySelector('.start-text');
                            if (timeEl) {
                                const t = timeEl.innerText.trim();
                                if (t.match(/(AM|PM)/i) && !t.match(/^\d+(st|nd|rd|th)$/)) {
                                    matchTime = t;
                                }
                            }
                        }
                        // Check if Live
                        const isLiveText = card.innerText.toLowerCase().includes('live');
                        if (isLiveText && !matchTime) matchTime = 'Live';
                        if (!matchTime) {
                            // Check status
                            const statusEl = card.querySelector('.result span') || card.querySelector('.time .reason');
                            const status = statusEl ? statusEl.innerText.trim() : '';
                            if (status.toLowerCase() === 'live') matchTime = 'Live';
                            else matchTime = status || '10:00 AM';
                        }
                        // Final fallback - if still "1st", "2nd", etc, replace with 10 AM
                        if (matchTime.match(/^\d+(st|nd|rd|th)$/i)) {
                            matchTime = '10:00 AM';
                        }
                        
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

        console.log(`\n📊 Total scraped (ALL): ${allMatches.length}`);

        // FILTER INTERNATIONAL - Auto logic
        const domesticKeywords = [
            'nepal-premier-league', 'biratnagar', 'janakpur', 'lumbini', 'pokhara', 'karnali', 'sudurpaschim',
            'emirates blues', 'emirates red', 'emirates-d20', 'd20-league', 'emirates-d10',
            'quaid-e-azam', 'first-class-quaid', 'president-trophy', 'national-t20-cup', 'pakistan-cup',
            'karb-vs-srb', 'fais-vs-prb', 'lahm-vs-fata', 'islr-vs-mul', 'lahb-vs-rwl', 'lrk-vs-qet', 'bhwr-vs-prw',
            'csa-provincial', 'csa-pro', '4-day', 'ford trophy', 'plunket shield',
            'eng-a-vs', 'wi-a-vs', 'ind-a-vs', 'nz-a-vs', 'aus-a-vs', 'sa-a-vs',
            'u19', 'under-19', 'wbbl', 'womens-premier', 'wpl', 'the hundred women',
            'victoria', 'hong-kong', 'singapore', 'malaysia', 'thailand',
            'sheffield shield', 'marsh cup', 'county championship', 'vitality blast',
            'ranji trophy', 'vijay hazare', 'syed mushtaq ali'
        ];

        const internationalKeywords = [
            'tour of', 'odi', 't20i', 'test', 'world cup', 'champions trophy', 'asia cup',
            'tri-series', 'tri series', 'bilateral', 'international',
            'afg vs', 'zim vs', 'ind vs nz', 'nz vs ind', 'aus vs eng', 'eng vs aus',
            'pak vs', 'sl vs', 'ban vs', 'wi vs', 'sa vs', 'ire vs', 'ned vs', 'sco vs'
        ];

        const filtered = allMatches.filter(m => {
            const txt = `${m.id} ${m.seriesInfo} ${m.team1.name} ${m.team2.name}`.toLowerCase();
            
            // First, remove domestic
            const isDomestic = domesticKeywords.some(k => txt.includes(k));
            if (isDomestic) {
                console.log(`❌ Domestic: ${m.team1.name} vs ${m.team2.name} | ${m.seriesInfo}`);
                return false;
            }
            
            // Then keep only if looks international
            // If team names are country codes (3 letters) and series mentions tour/ODI/Test etc, keep
            const hasInternationalHint = internationalKeywords.some(k => txt.includes(k)) || 
                                         (m.seriesInfo.toLowerCase().includes('tour') || 
                                          m.seriesInfo.toLowerCase().includes('odi') ||
                                          m.seriesInfo.toLowerCase().includes('t20i') ||
                                          m.seriesInfo.toLowerCase().includes('test') ||
                                          m.id.includes('tour-of'));
            
            // Also keep if both teams are international country names (not city/club names)
            const countryNames = ['afghanistan', 'zimbabwe', 'india', 'new zealand', 'australia', 'england', 'pakistan', 'sri lanka', 'bangladesh', 'west indies', 'south africa', 'ireland', 'netherlands', 'scotland', 'afg', 'zim', 'ind', 'nz', 'aus', 'eng', 'pak', 'sl', 'ban', 'wi', 'sa', 'ire', 'ned', 'sco', 'oma', 'uae', 'nam', 'usa', 'can', 'nep', 'ken'];
            const t1IsCountry = countryNames.some(c => m.team1.name.toLowerCase().includes(c) || m.team1.name.toLowerCase() === c);
            const t2IsCountry = countryNames.some(c => m.team2.name.toLowerCase().includes(c) || m.team2.name.toLowerCase() === c);
            
            if (t1IsCountry && t2IsCountry) {
                return true;
            }
            
            if (hasInternationalHint) {
                return true;
            }
            
            // If unsure, but not domestic and has country vs country, keep
            if (!isDomestic && m.team1.name && m.team2.name && m.team1.name.length <= 20 && m.team2.name.length <= 20) {
                // Check if id contains vs and looks international (not domestic league)
                if (m.id.includes('-vs-') && !m.id.includes('premier-league') && !m.id.includes('t20-league') && !m.id.includes('d20')) {
                    return true;
                }
            }
            
            console.log(`❓ Filtered out (not international): ${m.team1.name} vs ${m.team2.name} | ${m.seriesInfo} | ${m.id}`);
            return false;
        });

        console.log(`\n✅ After AUTO International filter: ${allMatches.length} -> ${filtered.length} matches`);

        filtered.sort((a,b) => new Date(a.date) - new Date(b.date));
        
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(filtered, null, 2));
        console.log(`\n🎉 FINAL AUTO: ${filtered.length} INTERNATIONAL matches from ${START_DATE.toDateString()} to ${END_DATE.toDateString()}`);
        if (filtered.length > 0) {
            console.log('Samples (first 20):');
            filtered.slice(0,20).forEach(m => console.log(`  ${m.date} | ${m.matchTime} | ${m.team1.name} vs ${m.team2.name} | ${m.seriesInfo} | ${m.matchStatus}`));
            const liveNow = filtered.filter(m => m.matchTime.toLowerCase() === 'live' || m.matchStatus.toLowerCase() === 'live');
            if (liveNow.length > 0) {
                console.log(`\n🔴 LIVE NOW: ${liveNow.length} matches`);
                liveNow.forEach(m => console.log(`  LIVE: ${m.team1.name} vs ${m.team2.name} | ${m.detailUrl}`));
            }
            console.log(`\nNext match: ${filtered[0]?.team1.name} vs ${filtered[0]?.team2.name} on ${filtered[0]?.date} at ${filtered[0]?.matchTime}`);
        } else {
            console.log('❌ No matches found');
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
