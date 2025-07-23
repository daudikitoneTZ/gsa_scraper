import puppeteer from "puppeteer";
import { withRetry } from "../utils/utilities.js";

/**
 * Scrapes match stats (e.g. possession, expected goals, cards, e.t.c)
 * @param {string} score 
 * @param {string} statsUrl 
 * @param {{
 *  homeTeam: string, 
 *  awayTeam: string
 * }} [options={}]
 * @returns 
 */
export default async function scrapeMatchStats(score, statsUrl, options = {}) {
    options.homeTeam
     ? console.log(`Scraping match stats for ${options.homeTeam} vs ${options.awayTeam}`) 
     : console.log(`Scraping match stats (${statsUrl})`);
     
    // Launch headless browser
    const browser = await puppeteer.launch({ headless: true, timeout: 60000 * 5 });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      
    try {
        // Navigate to the stats page
        withRetry(async () => {
            await page.goto(statsUrl, { waitUntil: 'networkidle2', timeout: 45000 })
        });

        // Wait for stats section to load (up to 15 seconds)
        withRetry(async () => {
            await page.waitForSelector('div.gsa_subheader_2', { timeout: 60000 })
        });

        // Extract data
        const result = await page.evaluate((score) => {
            // Normalize score for comparison (remove spaces, colons, and suffixes like 'AWD')
            const normalizeScore = (s) => s.replace(/\s/g, '').replace(':', '').replace(/AWD$/, '');

            // Initialize result object
            const stats = {
                possession: null,
                xg: null,
                shots: null,
                shotsOnTarget: null,
                yellowCards: null,
                redCards: null,
                corners: null,
                fouls: null,
                offsides: null
            };

            // Verify score
            const scoreElement = document.querySelector('#match_header_result');
            if (!scoreElement || normalizeScore(scoreElement.textContent.trim()) !== normalizeScore(score)) {
                return null;
            }

            // Extract possession from script tag
            const scripts = Array.from(document.querySelectorAll('script'));
            for (const script of scripts) {
                if (script.textContent.includes('mySmallDoughnut')) {
                    const homeMatch = script.textContent.match(/lctText:\s*'(\d+)%'/);
                    const awayMatch = script.textContent.match(/rctText:\s*'(\d+)%'/);
                        
                    if (homeMatch && awayMatch) {
                        const homePoss = parseInt(homeMatch[1]);
                        const awayPoss = parseInt(awayMatch[1]);
                        if (homePoss + awayPoss !== 100) {
                            console.warn(`Possession data corrupt: sum is ${homePoss + awayPoss}% (expected 100%)`);
                            stats.possession = null;
                        } 
                        else {
                            stats.possession = `${homePoss} : ${awayPoss}`;
                        }
                    } 
                    else {
                        const dataMatch = script.textContent.match(/smallDoughnutData\s*=\s*\[\s*{value:\s*(\d+)[^}]*},\s*{value:\s*(\d+)/);
                        if (dataMatch) {
                            const homePoss = parseInt(dataMatch[1]);
                            const awayPoss = parseInt(dataMatch[2]);
                            if (homePoss + awayPoss !== 100) {
                                console.warn(`Possession data corrupt: sum is ${homePoss + awayPoss}% (expected 100%)`);
                                stats.possession = null;
                            } 
                            else {
                                stats.possession = `${homePoss} : ${awayPoss}`;
                            }
                        }
                    }
                    break;
                }
            }

            // Extract other stats (xG, shots, shots on target, corners, fouls, offsides)
            const statElements = document.querySelectorAll('#raids_successful');
            for (const stat of statElements) {
                const desc = stat.querySelector('#desc')?.textContent.trim();
                const homeValue = stat.querySelector('#raids_successful_a')?.textContent.trim();
                const awayValue = stat.querySelector('#raids_successful_b')?.textContent.trim();
                if (!desc || !homeValue || !awayValue) continue;

                if (desc === 'xGoals') {
                    stats.xg = isNaN(parseFloat(homeValue)) || isNaN(parseFloat(awayValue)) ? null : `${homeValue} : ${awayValue}`;
                } 
                else if (desc === 'Total Shots') {
                    stats.shots = isNaN(parseInt(homeValue)) || isNaN(parseInt(awayValue)) ? null : `${homeValue} : ${awayValue}`;
                } 
                else if (desc === 'Shots On Target') {
                    stats.shotsOnTarget = isNaN(parseInt(homeValue)) || isNaN(parseInt(awayValue)) ? null : `${homeValue} : ${awayValue}`;
                } 
                else if (desc === 'Corners') {
                    stats.corners = isNaN(parseInt(homeValue)) || isNaN(parseInt(awayValue)) ? null : `${homeValue} : ${awayValue}`;
                } 
                else if (desc === 'Fouls') {
                    stats.fouls = isNaN(parseInt(homeValue)) || isNaN(parseInt(awayValue)) ? null : `${homeValue} : ${awayValue}`;
                } 
                else if (desc === 'Offsides') {
                    stats.offsides = isNaN(parseInt(homeValue)) || isNaN(parseInt(awayValue)) ? null : `${homeValue} : ${awayValue}`;
                }
            }

            // Extract yellow and red cards from timeline
            let homeYellow = 0, awayYellow = 0, homeRed = 0, awayRed = 0;
            const playerCards = { home: {}, away: {} }; // Track cards per player
            const timelineRows = document.querySelectorAll('.timeline_row');
                
            for (const row of timelineRows) {
                const homeTeam = row.querySelector('.timeline_team_a');
                const awayTeam = row.querySelector('.timeline_team_b');

                // Home team cards (process only d_v1 to avoid duplicates)
                const homeSpan = homeTeam.querySelector('span.d_v1');
                if (homeSpan) {
                    const img = homeSpan.querySelector('img[src*="yellow.png"], img[src*="red.png"], img[src*="yellow_red_card.png"]');
                    if (img) {
                        const playerName = homeSpan.querySelector('span.team_a_1')?.textContent.trim();
                        if (!playerName) continue;

                        if (!playerCards.home[playerName]) playerCards.home[playerName] = { yellow: 0, red: 0 };
                        if (img.src.includes('yellow.png')) {
                            playerCards.home[playerName].yellow++;
                            homeYellow++;
                        } 
                        else if (img.src.includes('red.png')) {
                            playerCards.home[playerName].red++;
                            homeRed++;
                        } 
                        else if (img.src.includes('yellow_red_card.png')) {
                            playerCards.home[playerName].yellow++;
                            playerCards.home[playerName].red++;
                            homeYellow++;
                            homeRed++;
                        }
                    }
                }

                // Away team cards
                const awaySpan = awayTeam.querySelector('span.team_b_1');
                if (awaySpan) {
                    const img = awaySpan.querySelector('img[src*="yellow.png"], img[src*="red.png"], img[src*="yellow_red_card.png"]');
                    if (img) {
                        const playerName = awaySpan.textContent.trim();
                        if (!playerName) continue;

                        if (!playerCards.away[playerName]) playerCards.away[playerName] = { yellow: 0, red: 0 };
                        if (img.src.includes('yellow.png')) {
                            playerCards.away[playerName].yellow++;
                            awayYellow++;
                        } 
                        else if (img.src.includes('red.png')) {
                            playerCards.away[playerName].red++;
                            awayRed++;
                        } 
                        else if (img.src.includes('yellow_red_card.png')) {
                            playerCards.away[playerName].yellow++;
                            playerCards.away[playerName].red++;
                            awayYellow++;
                            awayRed++;
                        }
                    }
                }
            }

            stats.yellowCards = `${homeYellow} : ${awayYellow}`;
            stats.redCards = `${homeRed} : ${awayRed}`;

            return stats;
        }, score); // Pass score to page.evaluate

        // Return result
        if (result) {
            return result;
        } 
        else {
            console.warn('Score verification failed or no stats found');
            return null;
        }
    }

    catch (error) {
        console.warn(`Error scraping ${statsUrl}: ${error.message}`);
        return null
    }

    finally { 
        browser.close() // Close the browser
    }
}