const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'match-schedule.json');
const END_DATE = new Date(2026, 10, 30); // 30 Nov

console.log(`📅 Scraping WHOLE MONTH: Today to ${END_DATE.toDateString()} WITH TIME`);

async function scrapeWholeMonth() {
    let puppeteer;
    try {
        puppeteer = require('puppeteer-core');
        console.log('Using puppeteer-core');
    } catch {
        puppeteer = require('puppeteer');
    }

    const browser = await puppeteer.launch({
        headless: 'new',
        channel: 'chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }).catch(() => puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] }));

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        await page.setViewport({ width: 1920, height: 1080 });

        console.log('📡 Opening CREX schedule...');
        await page.goto('https://crex.com/schedule', { waitUntil: 'networkidle2', timeout: 90000 });
        await new Promise(r => setTimeout(r, 6000));

        // Apply International filter
        console.log('🎯 Applying International filter...');
        try {
            await page.evaluate(async () => {
                for (let w of document.querySelectorAll('.option-wrapper')) {
                    const n = w.querySelector('.name');
                    if (n && n.innerText.toLowerCase().includes('series type')) {
                        const s = w.querySelector('.selection');
                        if (s && !s.innerText.toLowerCase().includes('international')) {
                            s.click();
                            await new Promise(r => setTimeout(r, 1500));
                            for (let d of document.querySelectorAll('div, li, span')) {
                                if (d.innerText && d.innerText.trim() === 'International' && d.offsetParent !== null && d !== s && d !== n) {
                                    const rect = d.getBoundingClientRect();
                                    if (rect.width > 20 && rect.height > 10) {
                                        d.click();
                                        break;
                                    }
                                }
                            }
                        }
                        break;
                    }
                }
            });
            await new Promise(r => setTimeout(r, 5000));
        } catch(e){ console.log('Filter error', e.message); }

        let allMatches = [];
        let pageNum = 1;
        let shouldStop = false;
        const maxPages = 30;

        while (!shouldStop && pageNum <= maxPages) {
            console.log(`\n📄 PAGE ${pageNum} - Scraping till 30 Nov...`);
            
            // Scroll to load all
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await new Promise(r => setTimeout(r, 2000));
            await page.evaluate(() => window.scrollTo(0, 0));
            await new Promise(r => setTimeout(r, 1000));

            const data = await page.evaluate(() => {
                const results = [];
                const dateBlocks = document.querySelectorAll('#date-wise-wrap > div, [id*="date-wise"] > div, .date-wise-wrap > div');
                
                console.log('Date blocks found:', dateBlocks.length);
                
                dateBlocks.forEach((block) => {
                    const dateHeaderEl = block.querySelector('h2.date span, h2 span, .date span, [class*="date"] span');
                    const dateHeader = dateHeaderEl?.innerText.trim() || block.querySelector('h2')?.innerText.trim() || 'Upcoming';
                    
                    if (!dateHeader || dateHeader.length < 3) return;
                    
                    const cards = block.querySelectorAll('li.match-card-container, li[class*="match"], div[class*="match-card"]');
                    
                    cards.forEach((card) => {
                        try {
                            const anchor = card.querySelector('a.match-card-wrapper, a[href*="cricket-live-score"], a[href*="live-score"]');
                            const href = anchor?.getAttribute('href') || card.querySelector('a')?.getAttribute('href') || '';
                            if (!href || !href.includes('cricket-live-score')) return;
                            
                            // Team extraction - try multiple methods
                            let t1Name = '', t1Flag = '', t1Score = '', t1Overs = '';
                            let t2Name = '', t2Flag = '', t2Score = '', t2Overs = '';
                            
                            // Method 1: .team elements
                            const teams = card.querySelectorAll('.team');
                            if (teams.length >= 2) {
                                const t1Img = teams[0].querySelector('img');
                                t1Flag = t1Img?.getAttribute('src') || t1Img?.getAttribute('data-src') || '';
                                t1Name = teams[0].querySelector('.team-name')?.innerText.trim() || t1Img?.getAttribute('alt') || teams[0].innerText.split('\n')[0]?.trim() || 'Team A';
                                t1Score = teams[0].querySelector('.team-score')?.innerText.trim() || '';
                                t1Overs = teams[0].querySelector('.total-overs')?.innerText.trim() || '';
                                
                                const t2Img = teams[1].querySelector('img');
                                t2Flag = t2Img?.getAttribute('src') || t2Img?.getAttribute('data-src') || '';
                                t2Name = teams[1].querySelector('.team-name')?.innerText.trim() || t2Img?.getAttribute('alt') || teams[1].innerText.split('\n')[0]?.trim() || 'Team B';
                                t2Score = teams[1].querySelector('.team-score')?.innerText.trim() || '';
                                t2Overs = teams[1].querySelector('.total-overs')?.innerText.trim() || '';
                            } else {
                                // Method 2: Generic - find all images and team names
                                const imgs = card.querySelectorAll('img');
                                const flagImgs = [];
                                imgs.forEach(img => {
                                    const src = img.getAttribute('src') || '';
                                    if (src.includes('cricketvectors') || src.includes('Teams') || src.includes('flag') || src.includes('team')) {
                                        if (!src.includes('arrow') && !src.includes('icon') && !src.includes('keyboard')) {
                                            flagImgs.push(src);
                                        }
                                    }
                                });
                                if (flagImgs.length >= 2) {
                                    t1Flag = flagImgs[0];
                                    t2Flag = flagImgs[1];
                                } else if (flagImgs.length === 1) {
                                    t1Flag = flagImgs[0];
                                }
                                
                                // Team names from text
                                const text = card.innerText || '';
                                const lines = text.split('\n').map(s => s.trim()).filter(s => s.length > 0);
                                // First line usually team1, last team-like line team2
                                if (lines.length >= 2) {
                                    // Filter out time, scores, etc.
                                    const teamCandidates = lines.filter(l => {
                                        const low = l.toLowerCase();
                                        return !low.includes('live') && 
                                               !low.match(/\d{1,2}:\d{2}\s*(am|pm)/i) && 
                                               !low.includes('yet to bat') &&
                                               !low.match(/^\d+\/\d+/) &&
                                               !low.includes('2nd t20') &&
                                               !low.includes('odi') &&
                                               l.length > 1 && l.length < 30;
                                    });
                                    if (teamCandidates.length >= 2) {
                                        t1Name = teamCandidates[0];
                                        t2Name = teamCandidates[teamCandidates.length - 1];
                                    } else if (teamCandidates.length === 1) {
                                        t1Name = teamCandidates[0];
                                    }
                                }
                            }

                            // Time extraction
                            let matchTime = '';
                            const fullText = card.innerText || '';
                            
                            // Look for time pattern
                            const timeMatch = fullText.match(/\d{1,2}:\d{2}\s*(AM|PM)/i);
                            if (timeMatch) {
                                matchTime = timeMatch[0];
                            } else if (fullText.toLowerCase().includes('live')) {
                                matchTime = 'Live';
                            }
                            
                            // Also check specific elements
                            if (!matchTime) {
                                const timeEl = card.querySelector('.start-text, .time, [class*="time"]');
                                if (timeEl) {
                                    const txt = timeEl.innerText.trim();
                                    if (txt.match(/\d{1,2}:\d{2}/) || txt.toLowerCase().includes('live')) {
                                        matchTime = txt;
                                    }
                                }
                            }

                            // Series info
                            let seriesInfo = '';
                            const reasonEl = card.querySelector('.reason, .match-info, [class*="reason"]');
                            if (reasonEl) {
                                seriesInfo = reasonEl.innerText.trim();
                            } else {
                                // From text, find line with T20, ODI, etc.
                                const lines = fullText.split('\n');
                                for (let line of lines) {
                                    const low = line.toLowerCase();
                                    if (low.includes('t20') || low.includes('odi') || low.includes('test') || low.includes('cwc') || low.includes('eng-a vs wi-a')) {
                                        seriesInfo = line.trim();
                                        break;
                                    }
                                }
                            }

                            const resultText = card.querySelector('.result span, [class*="result"]')?.innerText.trim() || '';
                            const slug = href.split('/cricket-live-score/')[1] || href.split('/').pop() || href;

                            // Clean team names
                            const clean = (s) => {
                                if (!s) return '';
                                return s.replace(/\n.*/g, '').replace(/\d+\/\d+.*/g, '').replace(/\s+\d+\.\d+.*/g, '').trim().split('  ')[0].trim();
                            };
                            
                            t1Name = clean(t1Name) || 'Team A';
                            t2Name = clean(t2Name) || 'Team B';

                            results.push({
                                id: slug,
                                date: dateHeader,
                                matchTime: matchTime || 'TBD',
                                seriesInfo: seriesInfo,
                                matchStatus: resultText || (matchTime && matchTime.toLowerCase().includes('live') ? 'Live' : 'Scheduled'),
                                team1: { name: t1Name, flagUrl: t1Flag, score: t1Score, overs: t1Overs },
                                team2: { name: t2Name, flagUrl: t2Flag, score: t2Score, overs: t2Overs },
                                detailUrl: href.startsWith('http') ? href : `https://crex.com${href}`,
                                scrapedAt: new Date().toISOString()
                            });
                        } catch(e) {
                            console.log('Card parse error', e.message);
                        }
                    });
                });
                return results;
            });

            console.log(`Page ${pageNum}: Found ${data.length} matches`);
            data.forEach(d => console.log(`  - ${d.date}: ${d.team1.name} vs ${d.team2.name} at ${d.matchTime}`));

            // Date check and add
            let foundBeyond = false;
            for (let m of data) {
                try {
                    const parsed = new Date(m.date);
                    if (!isNaN(parsed.getTime())) {
                        if (parsed > new Date(2026, 10, 30, 23, 59, 59)) {
                            console.log(`🛑 Beyond Nov 30: ${m.date}`);
                            foundBeyond = true;
                            shouldStop = true;
                            break;
                        }
                        if (parsed.getMonth() === 11) { // Dec
                            console.log(`🛑 December: ${m.date}`);
                            shouldStop = true;
                            foundBeyond = true;
                            break;
                        }
                    } else if (m.date.toLowerCase().includes('dec')) {
                        shouldStop = true;
                        foundBeyond = true;
                        break;
                    }
                } catch(e){}
                
                if (!foundBeyond && !allMatches.some(x => x.id === m.id)) {
                    allMatches.push(m);
                }
            }

            if (shouldStop) {
                console.log('Stopping - reached beyond Nov');
                break;
            }

            console.log(`Total accumulated: ${allMatches.length}`);

            // Next page
            const clicked = await page.evaluate(() => {
                // Try multiple selectors
                const selectors = ['button.arrow-right', 'button.arrow:last-child', '.pagination .next', 'button[class*="arrow"]'];
                for (let sel of selectors) {
                    const btn = document.querySelector(sel);
                    if (btn && !btn.disabled && btn.offsetParent !== null) {
                        btn.click();
                        return true;
                    }
                }
                // Fallback: find button with > text
                for (let b of document.querySelectorAll('button')) {
                    const txt = b.innerText.trim();
                    const html = b.innerHTML;
                    if ((txt === '>' || txt === '›') || html.includes('arrow-right') || html.includes('keyboard_arrow_right')) {
                        if (!b.disabled && b.offsetParent !== null) {
                            b.click();
                            return true;
                        }
                    }
                }
                return false;
            });

            if (!clicked) {
                console.log('⚠️ No next button found - checking if more dates exist on same page');
                // Maybe all dates already loaded via infinite scroll? Try scroll
                await page.evaluate(() => window.scrollBy(0, 1000));
                await new Promise(r => setTimeout(r, 2000));
                // Try again
                const clicked2 = await page.evaluate(() => {
                    for (let b of document.querySelectorAll('button')) {
                        if (b.innerText.trim() === '>' && !b.disabled) {
                            b.click();
                            return true;
                        }
                    }
                    return false;
                });
                if (!clicked2) {
                    console.log('No more pages, ending');
                    break;
                }
            }

            await new Promise(r => setTimeout(r, 4000));
            pageNum++;
        }

        // Final filter - remove domestic
        const domestic = ['ranji','plate','wbbl','hong-kong','hong kong','nepal','npl','global t20','emirates','ford trophy','csa','county','first class','list a','womens big bash','big bash','lpl','psl','ipl','maharaja','duleep','deodhar'];
        const filtered = allMatches.filter(m => {
            const txt = `${m.id} ${m.seriesInfo}`.toLowerCase();
            return !domestic.some(k => txt.includes(k));
        });

        console.log(`\n✅ FINAL: ${allMatches.length} -> ${filtered.length} International matches till 30 Nov`);

        // Sort by date
        filtered.sort((a,b) => {
            const da = new Date(a.date);
            const db = new Date(b.date);
            if (isNaN(da) || isNaN(db)) return 0;
            return da - db;
        });

        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(filtered, null, 2));
        console.log(`🎉 DONE! ${filtered.length} matches from Today to 30 Nov saved`);
        console.log('Samples:', JSON.stringify(filtered.slice(0,3), null, 2));

    } catch (err) {
        console.error('Error:', err.message, err.stack);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
}

scrapeWholeMonth();
