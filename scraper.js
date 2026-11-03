const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'match-schedule.json');

const now = new Date();
now.setHours(0,0,0,0);
const START_DATE = new Date(now);
const END_DATE = new Date(now.getFullYear(), now.getMonth() + 1, 0);
END_DATE.setHours(23,59,59,999);

console.log(`📅 TODAY: ${START_DATE.toDateString()}`);
console.log(`🎯 TARGET: ${START_DATE.toDateString()} to ${END_DATE.toDateString()} (1 MONTH)`);
console.log(`📅 INTERNATIONAL ONLY - VIA UI FILTER CLICK - FINAL FIX`);

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

        // CORRECT URL - No query param - Manual filter needed as you said
        console.log('📡 Opening https://crex.com/schedule (Correct link as you said)');
        await page.goto('https://crex.com/schedule', { waitUntil: 'domcontentloaded', timeout: 90000 });
        await new Promise(r => setTimeout(r, 10000));

        // ===== FINAL FIX: UI CLICK FOR SERIES TYPE -> INTERNATIONAL =====
        console.log('🎯 Clicking Filter: Series Type -> International (Manual filter as per your screenshot)');

        const filterClicked = await page.evaluate(async () => {
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));
            console.log('Starting filter click...');

            // Method: Find all elements that contain "Series Type" or "All Series"
            // As per your screenshot: Filter Fixtures -> Team, Format, Series Type
            
            // Try multiple selectors for the filter wrapper
            let seriesTypeWrapper = null;
            let allWrappers = document.querySelectorAll('div');
            
            for (let div of allWrappers) {
                const text = div.innerText || '';
                if (text.includes('Series Type') && text.includes('All Series')) {
                    // This div contains Series Type label and value
                    seriesTypeWrapper = div;
                    console.log('Found wrapper with Series Type:', div.innerHTML.substring(0,200));
                    break;
                }
            }

            // More direct: Find the element with "All Series" that is a dropdown
            let allSeriesEl = null;
            const allElements = document.querySelectorAll('*');
            for (let el of allElements) {
                if (el.innerText && el.innerText.trim() === 'All Series' && el.offsetParent !== null) {
                    // Check if it's a clickable dropdown (has arrow icon nearby)
                    const parent = el.closest('div');
                    const hasDropdown = parent && (parent.innerHTML.includes('svg') || parent.innerHTML.includes('arrow') || parent.querySelector('svg'));
                    if (el.tagName === 'DIV' || el.tagName === 'SPAN' || el.tagName === 'BUTTON') {
                        // Check bounding rect - dropdowns have reasonable size
                        const rect = el.getBoundingClientRect();
                        if (rect.width > 50 && rect.width < 600 && rect.height > 15 && rect.height < 80) {
                            allSeriesEl = el;
                            console.log('Found All Series element:', el.tagName, rect, el.innerText);
                            // Find the closest clickable parent
                            let clickable = el;
                            let depth = 0;
                            while (clickable && depth < 5) {
                                if (clickable.onclick || clickable.getAttribute('role') === 'button' || clickable.tagName === 'BUTTON' || clickable.classList.contains('selection') || clickable.closest('[class*="dropdown"]') || clickable.closest('[class*="select"]')) {
                                    break;
                                }
                                clickable = clickable.parentElement;
                                depth++;
                            }
                            if (clickable) allSeriesEl = clickable;
                            break;
                        }
                    }
                }
            }

            // Alternative: Use the exact structure from crex.com
            // Look for div that has Series Type label
            if (!allSeriesEl) {
                const labels = document.querySelectorAll('*');
                for (let label of labels) {
                    if (label.innerText && label.innerText.trim() === 'Series Type') {
                        // Found Series Type label, now find its sibling dropdown
                        let sibling = label.nextElementSibling;
                        let tries = 0;
                        while (sibling && tries < 10) {
                            if (sibling.innerText && sibling.innerText.includes('All Series')) {
                                allSeriesEl = sibling;
                                console.log('Found via Series Type label sibling:', sibling.innerHTML.substring(0,200));
                                break;
                            }
                            sibling = sibling.nextElementSibling;
                            tries++;
                        }
                        // Also check parent's children
                        if (!allSeriesEl) {
                            const parent = label.parentElement;
                            if (parent) {
                                const children = parent.querySelectorAll('*');
                                for (let child of children) {
                                    if (child.innerText && child.innerText.trim() === 'All Series' && child !== label) {
                                        allSeriesEl = child;
                                        console.log('Found via parent children:', child.innerHTML.substring(0,200));
                                        break;
                                    }
                                }
                            }
                        }
                        if (allSeriesEl) break;
                    }
                }
            }

            if (!allSeriesEl) {
                console.log('❌ Could not find All Series element');
                return { found: false, error: 'All Series not found' };
            }

            console.log('✅ Found All Series dropdown, clicking...');
            allSeriesEl.click();
            await sleep(3000);

            // Now find International option in dropdown
            let internationalEl = null;
            const allOptions = document.querySelectorAll('*');
            for (let opt of allOptions) {
                if (opt.innerText && opt.innerText.trim() === 'International' && opt.offsetParent !== null) {
                    const rect = opt.getBoundingClientRect();
                    // Must be visible and reasonable size for a dropdown option
                    if (rect.width > 20 && rect.width < 500 && rect.height > 10 && rect.height < 100) {
                        // Make sure it's not the selection box itself but an option
                        // Options usually appear after click in a list
                        internationalEl = opt;
                        console.log('Found International option:', opt.tagName, rect, opt.innerText);
                        break;
                    }
                }
            }

            if (!internationalEl) {
                console.log('❌ International option not found after click');
                // Try to list what is visible
                const visibleTexts = [];
                document.querySelectorAll('*').forEach(el => {
                    if (el.offsetParent !== null && el.innerText && el.innerText.length < 30) {
                        const t = el.innerText.trim();
                        if (['All Series', 'International', 'Domestic', 'League'].includes(t)) {
                            visibleTexts.push(t + ' (' + el.tagName + ')');
                        }
                    }
                });
                console.log('Visible filter options:', visibleTexts);
                return { found: false, error: 'International option not found', visible: visibleTexts };
            }

            console.log('✅ Clicking International...');
            internationalEl.click();
            await sleep(5000);

            // Verify it changed
            let finalText = 'unknown';
            const checkEls = document.querySelectorAll('*');
            for (let el of checkEls) {
                if (el.innerText && (el.innerText.trim() === 'International' || el.innerText.trim() === 'All Series')) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 50 && rect.width < 600 && el.offsetParent !== null) {
                        // This is likely the selection display
                        finalText = el.innerText.trim();
                        if (finalText === 'International') break;
                    }
                }
            }

            return { found: true, clicked: true, finalText: finalText };
        });

        console.log(`Filter result: ${JSON.stringify(filterClicked)}`);
        await new Promise(r => setTimeout(r, 8000));

        // Final verification
        const finalVerify = await page.evaluate(() => {
            const allTexts = [];
            document.querySelectorAll('*').forEach(el => {
                if (el.offsetParent !== null && el.innerText) {
                    const t = el.innerText.trim();
                    if (t === 'International' || t === 'All Series') {
                        allTexts.push({ text: t, tag: el.tagName, class: el.className.substring(0,50) });
                    }
                }
            });
            return allTexts.slice(0,10);
        });
        console.log(`Final verify (International should be selected):`, JSON.stringify(finalVerify));

        let allMatches = [];
        let pageNum = 1;
        const maxPages = 40;

        console.log('\n📄 Scraping INTERNATIONAL (after filter) from Today to Month End...');

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

            // Check month end
            const uniqueDates = [...new Set(data.map(d => d.date))];
            try {
                const lastDateStr = uniqueDates[uniqueDates.length - 1];
                if (lastDateStr) {
                    const parsedLast = new Date(lastDateStr);
                    if (!isNaN(parsedLast.getTime()) && parsedLast > END_DATE) {
                        console.log(`✅ Reached beyond month end: ${lastDateStr}, stopping`);
                        break;
                    }
                }
            } catch(e){}

            if (pageNum >= maxPages) break;

            const paginated = await page.evaluate(() => {
                const buttons = document.querySelectorAll('button');
                for (let b of buttons) {
                    const txt = (b.innerText || '').trim();
                    const html = b.innerHTML || '';
                    if ((txt === '>' || txt === '›' || html.includes('arrow-right') || html.includes('keyboard_arrow_right') || html.includes('chevron_right')) && !b.disabled) {
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
                if (afterScroll === data.length && pageNum > 3) {
                    console.log('No more data, stopping');
                    break;
                }
            } else {
                await new Promise(r => setTimeout(r, 4000));
            }
            pageNum++;
        }

        console.log(`\n📊 Total scraped (before domestic filter): ${allMatches.length}`);

        // Extra safety: Filter out any remaining domestic even after International UI filter
        const domesticKeywords = [
            'nepal-premier-league', 'biratnagar', 'janakpur', 'lumbini', 'pokhara',
            'emirates blues', 'emirates red', 'emirates-d20', 'd20-league',
            'quaid-e-azam', 'first-class-quaid', 'karb-vs-srb', 'fais-vs-prb', 'lahm-vs-fata', 'islr-vs-mul', 'lahb-vs-rwl', 'lrk-vs-qet', 'bhwr-vs-prw',
            '-a-vs-', 'eng-a-vs', 'wi-a-vs', 'u19', 'wbbl', 'womens', 'women', 'victoria', 'hong-kong'
        ];

        const filtered = allMatches.filter(m => {
            const txt = `${m.id} ${m.seriesInfo} ${m.team1.name} ${m.team2.name}`.toLowerCase();
            const isDom = domesticKeywords.some(k => txt.includes(k));
            if (isDom) {
                console.log(`❌ Extra filter domestic (should not happen after International UI): ${m.team1.name} vs ${m.team2.name}`);
                return false;
            }
            return true;
        });

        console.log(`\n✅ After International UI filter: ${allMatches.length} -> ${filtered.length} matches`);

        filtered.sort((a,b) => new Date(a.date) - new Date(b.date));
        
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(filtered, null, 2));
        console.log(`\n🎉 FINAL: ${filtered.length} INTERNATIONAL matches from ${START_DATE.toDateString()} to ${END_DATE.toDateString()}`);
        if (filtered.length > 0) {
            console.log('Samples (first 20):');
            filtered.slice(0,20).forEach(m => console.log(`  ${m.date} | ${m.matchTime} | ${m.team1.name} vs ${m.team2.name} | ${m.seriesInfo}`));
            console.log(`\nNext match: ${filtered[0]?.team1.name} vs ${filtered[0]?.team2.name} on ${filtered[0]?.date} at ${filtered[0]?.matchTime}`);
        } else {
            console.log('❌ No matches found - filter may have failed');
        }
        console.log(`✅ SAVED to ${OUTPUT_FILE}`);
        console.log(`📅 CRON: 25th monthly as you requested`);

    } catch (err) {
        console.error('Error:', err.message, err.stack);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
}

scrape();
