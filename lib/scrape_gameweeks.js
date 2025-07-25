import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'node:fs/promises';
import { joinPathnames, saveJSON, withRetry } from '../utils/utilities.js';
import { verifyGameweekData } from './gameweek_verification.js';
import { sortGameweeksByDate } from './sort_gameweeks.js';

puppeteer.use(StealthPlugin());

/**
 * Scrapes Gameweeks with robust navigation using #weeks div
 * @param {string} baseUrl 
 * @param {string} pageUrl 
 * @param {string} outputDir 
 * @param {{
 *  expectedMatchesPerGameweek?: number | undefined, 
 *  uniqueFileId?: string
 * }} options
 * @returns {Promise<{
 *  hasErrorOccurred: boolean, 
 *  result: Array<{
 *   gameweek: number, 
 *   matches: Array<{
 *     date: string, 
 *     time: string, 
 *     homeTeam: string, 
 *     awayTeam: string, 
 *     score: string, 
 *     statsUrl: string,
 *     awarded?: boolean
 *   }>
 *  }
 * }>>}
 */
export default async function scrapeGameweeks(baseUrl, pageUrl, outputDir, options = {}) {
    await fs.mkdir(outputDir, { recursive: true });
    
    const browser = await puppeteer.launch({ headless: true, timeout: 60000 * 5 });
    const page = await browser.newPage();

    // Set headers to mimic a real browser
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
    });

    const allMatches = [];
    const matchSignatures = new Set(); // Track unique matches
    let errorSignal = false; // Track error occurrence

    /**
     * Log errors or warnings to a file
     * @param {{ seasonUrl: string, message: string, gameweek?: number, type?: string, details?: any }} issue
     */
    async function logIssue(issue) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            seasonUrl: issue.seasonUrl,
            type: issue.type || 'error',
            gameweek: issue.gameweek || 'N/A',
            message: issue.message,
            details: issue.details || {}
        };
        const filename = `gameweek_scrape_issues${options.uniqueFileId ? '.' + options.uniqueFileId : ""}.log`;
        await saveJSON(joinPathnames([outputDir, filename]), logEntry, true);
    }

    try {
        // Navigate to the season page
        await withRetry(async () => {
            await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        });

        // Check if the season has results
        const hasResults = await page.evaluate(() => {
            const scoreElements = document.querySelectorAll('.gsa-c-match-c3');
            return Array.from(scoreElements).some(el => el.textContent.trim() !== ':');
        });

        if (!hasResults) {
            await logIssue({
                seasonUrl: pageUrl,
                message: 'No match results found for this season (e.g., only fixtures available). Skipping season.',
                type: 'warning'
            });
            console.warn('No match results found for this season. Skipping.');
            return [];
        }

        // Get max gameweeks
        const maxGameweeks = await page.evaluate(() => {
            const maxWeekInput = document.querySelector('#maxweek');
            return maxWeekInput ? parseInt(maxWeekInput.value, 10) : 1;
        });
        console.log(`Found ${maxGameweeks} gameweeks to scrape.`);

        // Calculate expected matches per gameweek
        const calculatedMatchesPerGameweek = Math.floor((maxGameweeks + 2) / 2 / 2);
        const finalExpectedMatches = options.expectedMatchesPerGameweek || calculatedMatchesPerGameweek;
        console.log(`Expecting ~${finalExpectedMatches} matches per gameweek${options.expectedMatchesPerGameweek ? ' (user-specified)' : ' (calculated assuming double round-robin format)'}.`);

        // Navigate to Gameweek 1
        await withRetry(async () => {
            const hasWeeksDiv = await page.evaluate(() => !!document.querySelector('#weeks .week_num'));
            if (hasWeeksDiv) {
                await page.evaluate(() => document.querySelector('.week_num.week_1')?.click());
                await page.waitForFunction(
                    () => document.querySelector('#week_sel')?.textContent.includes('Gameweek 1'),
                    { timeout: 60000 }
                );
            } else {
                const hasDropdown = await page.evaluate(() => !!document.querySelector('#week_select'));
                if (hasDropdown) {
                    await page.select('#week_select', '1');
                    await page.waitForFunction(
                        () => document.querySelector('#week_sel')?.textContent.includes('Gameweek 1'),
                        { timeout: 60000 }
                    );
                } else {
                    let currentGameweek = await page.evaluate(() => {
                        const weekText = document.querySelector('#week_sel')?.textContent || 'Gameweek 1';
                        return parseInt(weekText.match(/\d+/)[0], 10);
                    });
                    while (currentGameweek > 1) {
                        await page.click('#week_prev');
                        await page.waitForFunction(
                            (week) => {
                                const text = document.querySelector('#week_sel')?.textContent;
                                return text && parseInt(text.match(/\d+/)[0], 10) <= week;
                            },
                            { timeout: 60000 },
                            currentGameweek
                        );
                        currentGameweek = await page.evaluate(() => {
                            const weekText = document.querySelector('#week_sel')?.textContent || 'Gameweek 1';
                            return parseInt(weekText.match(/\d+/)[0], 10);
                        });
                    }
                }
            }
        });

        // Scrape all gameweeks
        for (let week = 1; week <= maxGameweeks; week++) {
            console.log(`Scraping gameweek ${week}...`);

            let retryCount = 0;
            const maxRetries = 3;
            let matches = [];
            let gameweekSuccess = false;

            while (retryCount < maxRetries && !gameweekSuccess) {
                try {
                    // Navigate to the specific gameweek
                    await withRetry(async () => {
                        const hasWeeksDiv = await page.evaluate(() => !!document.querySelector('#weeks .week_num'));
                        if (hasWeeksDiv) {
                            await page.evaluate((w) => {
                                const weekElement = document.querySelector(`.week_num.week_${w}`);
                                if (weekElement) weekElement.click();
                            }, week);
                        } else {
                            const hasDropdown = await page.evaluate(() => !!document.querySelector('#week_select'));
                            if (hasDropdown) {
                                await page.select('#week_select', String(week));
                            } else if (week > 1) {
                                await page.click('#week_next');
                            }
                        }
                        await page.waitForFunction(
                            (w) => {
                                const text = document.querySelector('#week_sel')?.textContent;
                                return text && parseInt(text.match(/\d+/)[0], 10) === w;
                            },
                            { timeout: 60000 },
                            week
                        );
                    });

                    // Wait for matches to load and stabilize
                    await withRetry(async () => {
                        await page.waitForSelector('#week_container .gsa-c-match-row', { timeout: 60000 });
                        await page.waitForFunction(
                            () => {
                                const rows = document.querySelectorAll('#week_container .gsa-c-match-row');
                                const prevCount = window.__prevMatchCount || 0;
                                window.__prevMatchCount = rows.length;
                                return rows.length > 0 && rows.length === prevCount && Array.from(rows).every(row => row.querySelector('.gsa-c-team_full'));
                            },
                            { timeout: 60000 }
                        );
                    });

                    // Extract match data
                    matches = await page.evaluate(() => {
                        const weekContainer = document.querySelector('#week_container');
                        const children = Array.from(weekContainer.children);
                        const results = [];
                        let currentDate = '';

                        for (let i = 0; i < children.length; i++) {
                            const element = children[i];
                            if (element.getAttribute('style')?.includes('font-weight:bold')) {
                                currentDate = element.textContent.trim();
                                continue;
                            }
                            if (element.tagName === 'A' && element.querySelector('.gsa-c-match-row')) {
                                const row = element.querySelector('.gsa-c-match-row');
                                const statsUrl = element.getAttribute('href') || '';
                                const time = row.querySelector('.gsa-c-match-c1')?.textContent.trim() || 'TBD';
                                const homeTeam = row.querySelector('.gsa-c-match-c2 .gsa-c-team_full')?.textContent.trim() || '';
                                const awayTeam = row.querySelector('.gsa-c-match-c4 .gsa-c-team_full')?.textContent.trim() || '';
                                const score = row.querySelector('.gsa-c-match-c3')?.textContent.trim() || ':';
                                const awarded = score.includes('AWD');

                                if (homeTeam && awayTeam && statsUrl) {
                                    results.push({
                                        date: currentDate,
                                        time,
                                        homeTeam,
                                        awayTeam,
                                        score,
                                        statsUrl: statsUrl.startsWith('//') ? `https:${statsUrl}` : statsUrl.startsWith('/') ? `${baseUrl}${statsUrl}` : statsUrl,
                                        ...(awarded && { awarded: true })
                                    });
                                } else {
                                    return { error: `Missing data in gameweek: homeTeam=${homeTeam}, awayTeam=${awayTeam}, statsUrl=${statsUrl}` };
                                }
                            }
                        }

                        return results;
                    });

                    // Handle errors in match data
                    if (matches.error) {
                        throw new Error(matches.error);
                    }

                    // Check for duplicates
                    const newMatches = [];
                    const duplicates = [];
                    matches.forEach((match, index) => {
                        const signature = `${match.homeTeam}|${match.awayTeam}|${match.date}|${match.score}`;
                        if (matchSignatures.has(signature)) {
                            duplicates.push({ match, index });
                        } else {
                            matchSignatures.add(signature);
                            newMatches.push(match);
                        }
                    });

                    if (duplicates.length > 0) {
                        errorSignal = true;
                        await logIssue({
                            seasonUrl: pageUrl,
                            gameweek: week,
                            message: `Found ${duplicates.length} duplicate matches in gameweek ${week}`,
                            type: 'warning',
                            details: { duplicates }
                        });
                        console.warn(`Found ${duplicates.length} duplicates in gameweek ${week}. Retrying...`);
                        retryCount++;
                        continue;
                    }

                    // Check match count
                    if (newMatches.length < Math.floor(finalExpectedMatches * 0.5)) {
                        errorSignal = true;
                        await logIssue({
                            seasonUrl: pageUrl,
                            gameweek: week,
                            message: `Gameweek ${week} has fewer matches than expected: ${newMatches.length} found, expected ~${finalExpectedMatches}`,
                            type: 'warning',
                            details: { matches: newMatches }
                        });
                        console.warn(`Gameweek ${week}: ${newMatches.length} matches found, expected ~${finalExpectedMatches}. Retrying...`);
                        retryCount++;
                        continue;
                    }

                    allMatches.push({ gameweek: week, matches: newMatches });
                    gameweekSuccess = true;

                } 
                catch (error) {
                    errorSignal = true;
                    await logIssue({
                        seasonUrl: pageUrl,
                        gameweek: week,
                        message: `Failed to scrape gameweek ${week}: ${error.message}`,
                        details: { retryCount }
                    });
                    console.error(`Failed to scrape gameweek ${week}: ${error.message}`);
                    retryCount++;
                    if (retryCount >= maxRetries) {
                        console.error(`Max retries reached for gameweek ${week}. Skipping.`);
                        break;
                    }
                }
            }

            if (!gameweekSuccess) {
                errorSignal = true;
                console.warn(`Skipping gameweek ${week} after ${maxRetries} failed attempts.`);
                continue;
            }

            await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
        }

        // Verify gameweek data
        const { data: verifiedData, report: verificationReport } = await verifyGameweekData(allMatches, finalExpectedMatches, pageUrl, outputDir);

        // Log verification report
        verificationReport.forEach(({ type, message, details }) => {
            console.log(`[${type.toUpperCase()}] ${message}`, JSON.stringify(details, null, 2));
        });

        // Sort gameweeks by date
        const sortedMatches = sortGameweeksByDate(verifiedData);
    
        // Save results to JSON file
        const seasonId = pageUrl.split('/').slice(-2, -1)[0];
        const fn = `matches_${seasonId}${options.uniqueFileId ? '.' + options.uniqueFileId : ""}.json`;
        const outputFile = joinPathnames([outputDir, fn]);
        await saveJSON(outputFile, sortedMatches);
        console.log(`Results saved to ${outputFile}`);

        return { hasErrorOccurred: errorSignal,  result: sortedMatches };
    } 
    
    catch (error) {
        console.error('Error scraping season:', error.message);
        await logIssue({
            seasonUrl: pageUrl,
            message: error.message,
            outputDir
        });
        return { hasErrorOccurred: true, result: [] };
    } 
    
    finally { await browser.close() }
}