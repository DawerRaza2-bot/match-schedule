const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'match-schedule.json');
const MAX_PAGES_TO_SCRAPE = 10; // 10 pages as you wanted

async function scrapeCrexScheduleWithPagination() {
    console.log('🚀 [CREX Pagination Scraper] Launching browser...');

    let launchOptions = {
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    };

    const possiblePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ];
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            launchOptions.executablePath = p;
            console.log(`Using local Chrome: ${p}`);
            break;
        }
    }

    const browser = await puppeteer.launch(launchOptions);

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1920, height: 1080 });

        console.log('📡 Navigating to CREX Schedule...');
        await page.goto('https://crex.com/schedule', {
            waitUntil: 'networkidle2',
            timeout: 90000
        });

        // ===== ONLY ADDITION: Apply International Filter One Time =====
        console.log('🎯 Applying Filter: Series Type = International (One Time)...');
        await new Promise(r => setTimeout(r, 3000));

        try {
            // Wait for filter wrapper
            await page.waitForSelector('.fixture-filter-wrapper, #date-wise-wrap', { timeout: 15000 });
            
            // Try URL based filter first - many sites support it
            console.log('Trying URL param filter...');
            await page.goto('https://crex.com/schedule?seriesType=international&series_type=international', { waitUntil: 'networkidle2', timeout: 30000 }).catch(()=>{});
            await new Promise(r => setTimeout(r, 3000));

            
            const filterDone = await page.evaluate(async () => {
                const sleep = (ms) => new Promise(r => setTimeout(r, ms));
                
                // Find Series Type wrapper
                const wrappers = document.querySelectorAll('.option-wrapper');
                let targetWrapper = null;
                
                for (let w of wrappers) {
                    const nameEl = w.querySelector('.name');
                    if (nameEl && nameEl.innerText.trim().toLowerCase().includes('series type')) {
                        targetWrapper = w;
                        break;
                    }
                }
                
                if (!targetWrapper) {
                    console.log('Series Type wrapper not found');
                    return false;
                }
                
                const selection = targetWrapper.querySelector('.selection');
                if (!selection) return false;
                
                // If already International, done
                if (selection.innerText.toLowerCase().includes('international')) {
                    console.log('Already International');
                    return true;
                }
                
                // Click to open dropdown
                selection.click();
                await sleep(1500);
                
                // Find International option in dropdown
                // CREX creates dropdown options dynamically
                const possibleOptionSelectors = [
                    '.option-wrapper .options div',
                    '.dropdown div',
                    '.options-list div',
                    '[class*="dropdown"] div',
                    'ul li'
                ];
                
                let clicked = false;
                for (let sel of possibleOptionSelectors) {
                    const opts = document.querySelectorAll(sel);
                    for (let opt of opts) {
                        if (opt.innerText.trim().toLowerCase() === 'international') {
                            if (opt.offsetParent !== null) { // visible
                                opt.click();
                                clicked = true;
                                console.log('Clicked International via selector: ' + sel);
                                break;
                            }
                        }
                    }
                    if (clicked) break;
                }
                
                // Fallback: search all visible divs for exact text "International"
                if (!clicked) {
                    const allDivs = document.querySelectorAll('div, li, span');
                    for (let d of allDivs) {
                        if (d.innerText && d.innerText.trim() === 'International' && d.offsetParent !== null) {
                            // Make sure it's not the selection itself but dropdown option
                            const rect = d.getBoundingClientRect();
                            if (rect.width > 10 && rect.height > 5) {
                                // Check if its parent is near filter area
                                if (d.closest('.option-wrapper') || d.closest('[class*="filter"]') || d.parentElement) {
                                    // Don't click the already selected one
                                    if (d !== selection && !d.classList.contains('selection')) {
                                        d.click();
                                        clicked = true;
                                        console.log('Clicked International via fallback');
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
                
                return clicked;
            });
            
            console.log('Filter click result:', filterDone);
            await new Promise(r => setTimeout(r, 4000)); // Wait for filtered data to load
            
            // Verify filter applied
            const verifyFilter = await page.evaluate(() => {
                const sel = document.querySelector('.option-wrapper .selection');
                if (sel) {
                    // Check all wrappers for Series Type
                    const wrappers = document.querySelectorAll('.option-wrapper');
                    for (let w of wrappers) {
                        const name = w.querySelector('.name');
                        if (name && name.innerText.toLowerCase().includes('series type')) {
                            const selection = w.querySelector('.selection');
                            return selection ? selection.innerText.trim() : 'not found';
                        }
                    }
                }
                return 'verification failed';
            });
            console.log('Current filter value:', verifyFilter);
            
        } catch (e) {
            console.log('Filter apply error (will continue):', e.message);
        }
        // ===== END OF FILTER CODE =====

        let allMatchesMaster = [];

        for (let pageNum = 1; pageNum <= MAX_PAGES_TO_SCRAPE; pageNum++) {
            console.log(`📄 Scraping Page ${pageNum} of ${MAX_PAGES_TO_SCRAPE}...`);
            await page.waitForSelector('li.match-card-container', { timeout: 20000 }).catch(() => console.log('No match cards found on this page view'));

            const pageData = await page.evaluate(() => {
                const results = [];
                const dateBlocks = document.querySelectorAll('#date-wise-wrap > div');
                dateBlocks.forEach((block) => {
                    const dateHeader = block.querySelector('h2.date span')?.innerText.trim() || 'Upcoming';
                    const matchCards = block.querySelectorAll('li.match-card-container');
                    matchCards.forEach((card) => {
                        const matchAnchor = card.querySelector('a.match-card-wrapper');
                        const href = matchAnchor?.getAttribute('href') || '';
                        if (!href) return;

                        const teamElements = card.querySelectorAll('.team');
                        let team1Name = '', team1Flag = '', team1Score = '', team1Overs = '';
                        let team2Name = '', team2Flag = '', team2Score = '', team2Overs = '';

                        if (teamElements.length >= 2) {
                            const t1Img = teamElements[0].querySelector('img');
                            team1Flag = t1Img?.getAttribute('src') || '';
                            team1Name = teamElements[0].querySelector('.team-name')?.innerText.trim() || t1Img?.getAttribute('alt') || 'Team A';
                            team1Score = teamElements[0].querySelector('.team-score')?.innerText.trim() || '';
                            team1Overs = teamElements[0].querySelector('.total-overs')?.innerText.trim() || '';

                            const t2Img = teamElements[1].querySelector('img');
                            team2Flag = t2Img?.getAttribute('src') || '';
                            team2Name = teamElements[1].querySelector('.team-name')?.innerText.trim() || t2Img?.getAttribute('alt') || 'Team B';
                            const scoreEl2 = teamElements[1].querySelector('.team-score');
                            team2Score = scoreEl2?.innerText.trim() || '';
                            team2Overs = teamElements[1].querySelector('.total-overs')?.innerText.trim() || '';
                        }

                        const startText = card.querySelector('.start-text')?.innerText.trim() || '';
                        const matchInfoText = card.querySelector('.time, .reason')?.innerText.trim() || '';
                        const resultText = card.querySelector('.result span')?.innerText.trim() || '';

                        const slug = href.split('/cricket-live-score/')[1] || href;

                        results.push({
                            id: slug,
                            date: dateHeader,
                            seriesInfo: matchInfoText,
                            matchStatus: resultText || (startText ? `Starts at ${startText}` : 'Scheduled'),
                            team1: { name: team1Name, flagUrl: team1Flag, score: team1Score, overs: team1Overs },
                            team2: { name: team2Name, flagUrl: team2Flag, score: team2Score, overs: team2Overs },
                            detailUrl: `https://crex.com${href}`,
                            scrapedAt: new Date().toISOString()
                        });
                    });
                });
                return results;
            });

            pageData.forEach(m => {
                if (!allMatchesMaster.some(existing => existing.id === m.id)) {
                    allMatchesMaster.push(m);
                }
            });

            console.log(`✅ Page ${pageNum} done. Total: ${allMatchesMaster.length}`);

            if (pageNum < MAX_PAGES_TO_SCRAPE) {
                console.log('➡ Clicking Next Page...');
                const nextClicked = await page.evaluate(() => {
                    // Try multiple selectors for next button
                    const selectors = [
                        'button.arrow-right',
                        'button.arrow:last-child',
                        '.pagination .next',
                        'button.arrow'
                    ];
                    for (let sel of selectors) {
                        const btn = document.querySelector(sel);
                        if (btn && !btn.disabled && btn.offsetParent !== null) {
                            btn.click();
                            return true;
                        }
                    }
                    // Fallback: find button with > text
                    const buttons = document.querySelectorAll('button');
                    for (let b of buttons) {
                        if (b.innerText.trim() === '>' || b.innerHTML.includes('keyboard_arrow_right')) {
                            if (!b.disabled) {
                                b.click();
                                return true;
                            }
                        }
                    }
                    return false;
                });
                if (!nextClicked) {
                    console.log('⚠ Next button not found. Stopping.');
                    break;
                }
                await new Promise(r => setTimeout(r, 3500));
                await page.waitForSelector('li.match-card-container', { timeout: 10000 }).catch(()=>{});
            }
        }


        // ===== FINAL SAFETY FILTER: Remove domestic if UI filter failed =====
        console.log(`\n🔍 Before filter: ${allMatchesMaster.length} total matches`);
        const domesticKeywords = [
            'ranji', 'plate', 'wbbl', 'hong-kong', 'hong kong', 'nepal', 'npl', 
            'global t20', 'emirates', 'ford trophy', 'csa', 'county', 'duleep', 
            'deodhar', 'syed mushtaq', 'vijay hazare', 'irandai', 'first-class', 
            'first class', 'list a', 'womens big bash', 'big bash', 'lpl', 'psl', 'ipl'
        ];
        
        const internationalOnly = allMatchesMaster.filter(m => {
            const text = `${m.id} ${m.seriesInfo} ${m.date}`.toLowerCase();
            const isDomestic = domesticKeywords.some(k => text.includes(k));
            return !isDomestic;
        });
        
        console.log(`✅ After domestic removal: ${internationalOnly.length} INTERNATIONAL matches`);
        
        // Also try to enrich seriesInfo if empty - extract from id
        internationalOnly.forEach(m => {
            if (!m.seriesInfo || m.seriesInfo === '') {
                const idLower = m.id.toLowerCase();
                if (idLower.includes('odi')) m.seriesInfo = 'ODI';
                else if (idLower.includes('t20i') || idLower.includes('t20')) m.seriesInfo = 'T20I';
                else if (idLower.includes('test')) m.seriesInfo = 'Test';
                else m.seriesInfo = 'International';
            }
        });

        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(internationalOnly, null, 2));

        console.log(`🎉 Complete! ${allMatchesMaster.length} INTERNATIONAL matches saved to ${OUTPUT_FILE}`);

    } catch (err) {
        console.error('❌ Error:', err.message);
        console.error(err.stack);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

scrapeCrexScheduleWithPagination();
