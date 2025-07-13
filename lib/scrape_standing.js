//import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import { joinPathnames, saveJSON, withRetry } from '../utils/utilities.js';


export default async function scrapeLeagueStanding(page, pageUrl, outputDir) {
    await fs.mkdir(outputDir, { recursive: true });

    console.log('Scraping league standing...');

    try {
        // Check if the season has results by looking for at least one score
        const hasResults = await page.evaluate(() => {
            const scoreElements = document.querySelectorAll('.gsa-c-match-c3');
            return Array.from(scoreElements).some(el => el.textContent.trim() !== ':');
        });

        if (!hasResults) {
            const message = 'No match results found for this season (e.g., only fixtures available). Skipping standings scrape.';
            await logIssue({
                seasonUrl: pageUrl, 
                message, 
                type: 'warning', 
                outputDir
            });
            console.warn(message);
            return [];
        }

        // Wait for standings table to load and stabilize
        await withRetry(async () => {
            await page.waitForSelector('.player_row', { timeout: 45000 });
            await page.waitForFunction(
                () => {
                    const rows = document.querySelectorAll('.player_row');
                    const prevCount = window.__prevRowCount || 0;
                    window.__prevRowCount = rows.length;
                    return rows.length > 0 && rows.length === prevCount && Array.from(rows).every(row => row.querySelector('.col_name .fullname'));
                },
                { timeout: 45000 }
            );
        });

        // Extract standings data
        const standings = await page.evaluate(() => {
            const rows = document.querySelectorAll('.player_row');
            const results = [];

            rows.forEach(row => {
                const rank = row.querySelector('.col_shirt')?.textContent.trim() || '';
                const team = row.querySelector('.col_name .fullname')?.textContent.trim() || '';
                const matchPlayed = parseInt(row.querySelector('.col_p1')?.textContent.trim() || '0', 10);
                const won = parseInt(row.querySelector('.col_p2')?.textContent.trim() || '0', 10);
                const draw = parseInt(row.querySelector('.col_p3')?.textContent.trim() || '0', 10);
                const lost = parseInt(row.querySelector('.col_p4')?.textContent.trim() || '0', 10);
                const goalsScored = parseInt(row.querySelector('.col_p5')?.textContent.trim() || '0', 10);
                const goalsAllowed = parseInt(row.querySelector('.col_p6')?.textContent.trim() || '0', 10);
                const goalDifference = parseInt(row.querySelector('.col_p7')?.textContent.trim() || '0', 10);
                const points = parseInt(row.querySelector('.col_p8')?.textContent.trim() || '0', 10);

                if (team && rank) {
                    results.push({
                        rank,
                        team,
                        matchPlayed,
                        won,
                        draw,
                        lost,
                        goalsScored,
                        goalsAllowed,
                        goalDifference,
                        points
                    });
                }
            });

            return results;
        });

        // Validate standings
        if (standings.length === 0) {
            const htmlSnapshot = await page.evaluate(() => {
                const container = document.querySelector('.gsa_subheader_2')?.parentElement;
                return container ? container.innerHTML : 'No standings container found';
            });
            const message = 'No standings data extracted. Possible issue with table structure or loading.';
            await logIssue({
                seasonUrl: pageUrl, 
                message, 
                htmlSnapshot, 
                type: 'error', 
                outputDir
            });
            console.error(message);
            return [];
        }

        const isValidStanding = standings.some(s => {
            const matchPlayed = Number(s.matchPlayed);
            return Number.isNaN(matchPlayed) ? 0 : Boolean(matchPlayed)
        });

        // Save standings to JSON file
        if (isValidStanding) {
            const seasonId = pageUrl.split('/').slice(-2, -1)[0];
            const outputFile = joinPathnames([outputDir, `standing_${seasonId}.json`]);
            await saveJSON(outputFile, standings);
            return standings
        }

        return [];
    }
    
    catch (error) {
        console.error('Error scraping standings:', error.message);
        const htmlSnapshot = await page.evaluate(() => {
            const container = document.querySelector('.gsa_subheader_2')?.parentElement;
            return container ? container.innerHTML : 'No standings container found';
        });

        await logIssue({
            seasonUrl: pageUrl, 
            type: 'error', 
            htmlSnapshot, 
            outputDir, 
            message: `Error scraping standings: ${error.message}`
        });

        return [];
    }
}


/**
 * Log errors or warnings to a file, including HTML snapshot if provided
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
    await saveJSON(joinPathnames([issue.outputDir, 'standings_scrape_issues.log']), logEntry, true);
}