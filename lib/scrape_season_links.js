import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import { joinPathnames, saveJSON, withRetry } from '../utils/utilities.js';
import scrapeLeagueStanding from './scrape_standing.js';


/**
 * Scrapes seasons drop-down menus and/or anchors
 * @param {string} baseUrl 
 * @param {string} pageUrl
 * @param {string} outputDir 
 * @returns {Promise<Array<{ season: string, url: string, leagueStanding: [] }>>}
 */
export default async function scrapeSeasonsLinks(baseUrl, pageUrl, outputDir, leaguesOnly = false) {
    await fs.mkdir(outputDir, { recursive: true });
    const browser = await puppeteer.launch({ headless: true, timeout: 60000 * 5 });
    const page = await browser.newPage();

    // Set headers to mimic a real browser
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
    });

    try {
        // Navigate to the base season page
        await withRetry(async () => {
            await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 45000 });
        });

        // Wait for season dropdown to load and stabilize
        await withRetry(async () => {
            await page.waitForSelector('select', { timeout: 45000 });
            await page.waitForFunction(
                () => {
                    const selects = document.querySelectorAll('select');
                    let seasonSelect = null;
                    selects.forEach(select => {
                        if (Array.from(select.options).some(option => option.textContent.match(/20\d{2}\/20\d{2}/))) {
                            seasonSelect = select;
                        }
                    });
                    if (!seasonSelect) return false;
                    const prevCount = window.__prevOptionCount || 0;
                    window.__prevOptionCount = seasonSelect.options.length;
                    return seasonSelect.options.length > 0 && seasonSelect.options.length === prevCount;
                },
                { timeout: 45000 }
            );
        });

        if (leaguesOnly) {
            const isLeague = await isLeagueCompetition(pageUrl, page);
            if (!isLeague) {
                await logIssue({
                    seasonUrl: pageUrl, 
                    outputDir,
                    type: 'warning',
                    message: `Non-league season skipped` 
                })
                return;
            }
        }

        // Get season URLs from the dropdown
        const seasonOptions = await page.evaluate(() => {
            const selects = document.querySelectorAll('select');
            let seasonSelect = null;
            selects.forEach(select => {
                if (Array.from(select.options).some(option => option.textContent.match(/20\d{2}\/20\d{2}/))) {
                    seasonSelect = select;
                }
            });
            if (!seasonSelect) return [];
            return Array.from(seasonSelect.options).map(option => ({
                season: option.textContent.trim(),
                url: option.value
            })).filter(option => option.url);
        });

        if (seasonOptions.length === 0) {
            const htmlSnapshot = await page.evaluate(() => {
            const header = document.querySelector('body')?.innerHTML.slice(0, 2000);
                return header || 'No header content found';
            });
            await logIssue({
                seasonUrl: pageUrl, 
                message: 'No seasons found in dropdown. Possible issue with selector or dynamic loading.', 
                type: 'error', 
                htmlSnapshot,
                outputDir,
            });
            console.error('No seasons found in dropdown.');
            return [];
        }

        // Filter seasons (2019/2020 to 2025/2026)
        const targetSeasons = seasonOptions.filter(option => {
            return option.season.match(/2019\/2020|20[2-5][0-6]\/20[2-6][0-7]/);
        });

        console.log(`Found ${targetSeasons.length} seasons to check: ${targetSeasons.map(s => s.season).join(', ')}`);

        const validSeasons = [];

        for (const season of targetSeasons) {
            console.log(`Checking season ${season.season}...`);
            // Fix URL construction
            const seasonUrl = season.url.startsWith('http') ? season.url : `${baseUrl}${season.url}`;
            try {
                await withRetry(async () => {
                    await page.goto(seasonUrl, { waitUntil: 'networkidle2', timeout: 60000 });
                });

                const standings = await scrapeLeagueStanding(
                    page, 
                    seasonUrl, 
                    joinPathnames([outputDir, season.season.replace('/', '_')])
                );
                
                if (standings.length) {
                    validSeasons.push({ leagueStanding: standings, ...season });
                    console.log(`Season ${season.season} has match results and will be scraped.`);
                }

                else {
                    await logIssue({
                        seasonUrl, 
                        message: `No match results found for season ${season.season}. Skipping.`, 
                        type: 'warning', 
                        outputDir
                    });
                    console.warn(`No match results found for season ${season.season}. Skipping.`);
                }
            } 
            catch (error) {
                await logIssue({
                    seasonUrl, 
                    message: `Error checking season ${season.season}: ${error.message}`, 
                    type: 'error', 
                    outputDir
                });
                console.error(`Error checking season ${season.season}: ${error.message}`);
            }
            await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
        }

        // Save season list for debugging
        const outputFile = joinPathnames([outputDir, 'seasons_list.json']);
        await saveJSON(outputFile, validSeasons.map(o => { 
            return { season: o.season, url: o.url }
        }));

        console.log(`Valid seasons saved to ${outputFile}`);

        return validSeasons;
    } 
    catch (error) {
        console.error(error);
        console.error('Error scraping seasons dropdown:', error.message);
        const htmlSnapshot = await page.evaluate(() => {
            const header = document.querySelector('body')?.innerHTML.slice(0, 2000);
            return header || 'No header content found';
        });
        await logIssue({
            seasonUrl: pageUrl, 
            outputDir,
            message: `Error scraping seasons dropdown: ${error.message}`, 
            type: 'error', 
            htmlSnapshot
        });
        return [];
    }

    finally { await browser.close() }
}


/**
 * Log errors or warnings to a file
 * @param {{
 *  seasonUrl: string, 
 *  message: string, 
 *  outputDir: string,
 *  type?: string, 
 *  htmlSnapshot?: string
 * }} issue 
 */
async function logIssue(issue) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        seasonUrl: issue.seasonUrl,
        type: issue.type || 'error',
        message: issue.message,
        htmlSnapshot: issue.htmlSnapshot || null
    };
    await saveJSON(joinPathnames([issue.outputDir, 'seasons_scrape_issues.log']), logEntry, true);
}

/**
 * Checks URL to see if it's a league URL or not
 * @param {string} url 
 * @param {any} page 
 * @returns {Promise<boolean>}
 */
async function isLeagueCompetition(url, page) {
    try {
        // Try to find element with 'Gameweek N'
        const isGameweekExists = await page.evaluate(() => {
            const el = document.querySelector('#week_sel');
            if (!el) return false;
            return /^Gameweek\s+\d+/i.test(el.innerText.trim());
        });

        return isGameweekExists;
    } 
    catch (err) {
        console.error(`Error checking URL: ${url}`, err?.message || err);
        return false;
    }
}