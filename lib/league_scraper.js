import { joinPathnames, normalizeFilepath, saveJSON } from '../utils/utilities.js';
import scrapeSeasonsLinks from './scrape_season_links.js';
import scrapeGameweeks from './scrape_gameweeks.js';
import fs from 'node:fs/promises';


/**
 * Leagues tournament scraper
 * @param {{
 *  tournament: string, 
 *  baseUrl: string, 
 *  pageUrl: string,
 *  dataDir: string,
 *  delay?: number, 
 *  country?: string,
 *  leaguesOnly?: boolean,
 *  maxRescrapeCount?: number 
 * }} options
 */
export default async function scrapeTournament(options) {
    const { baseUrl, pageUrl, tournament } = options;
    const maxRescrapeCount = options.maxRescrapeCount || 3;
    const delay = options.delay || 5000;
    const dataDirname = normalizeFilepath(tournament);
    const dataDir = joinPathnames([options.dataDir, dataDirname]); 
    await fs.mkdir(dataDir, { recursive: true }); // Creating data directory

    console.log(`Scraping ${tournament}...`);

    const seasonLinks = await scrapeSeasonsLinks(baseUrl, pageUrl, dataDir, !!options.leaguesOnly);
    if (!seasonLinks) return;
    
    const erroneousData = [];
    const repairedData = [];
    const results = [];

    console.log(`Season links scraping for ${tournament} completed...\n\n`);

    for (let i = 0; i < seasonLinks.length; i++) {
        const { season, url, leagueStanding } = seasonLinks[i];
        const outputDir = joinPathnames([dataDir, normalizeFilepath(season)]);

        console.log(`Processing ${i + 1} of ${seasonLinks.length} seasons [${season}]`);
        console.log(`Scraping gameweeks for ${season} season`);

        const gameweeks = await scrapeGameweeks(baseUrl, url, outputDir);

        // Retrying after erroneous encounter
        if (gameweeks.hasErrorOccurred) {
            console.warn(`\nEncountered error on season ${season}`);
            let isErrorResolved = false;

            for (let j = 0; j < maxRescrapeCount; j++) {
                console.log(`[${j + 1}/${maxRescrapeCount}] Retrying ${season} season...\n`);
                const gw = await scrapeGameweeks(baseUrl, url, joinPathnames([outputDir, 'retries']), {
                    uniqueFileId: `${Date.now()}`
                });
                if (gw.hasErrorOccurred) continue;
                
                const s = j + 1 > 1 ? 'retries' : 'retry';
                console.log(`Error seemingly resolved after ${j + 1} ${s}\n`);
                repairedData.push({ season, gameweeks: gw.result, leagueStanding });
                isErrorResolved = true;

                if (j < maxRescrapeCount) break;
            }

            !isErrorResolved && erroneousData.push(gameweeks.result);
        }

        console.log(`${season} season scraping completed\n`);
        
        if (!gameweeks.hasErrorOccurred) {
            results.push({ season, gameweeks: gameweeks.result, leagueStanding });
        }

        if (!(i === seasonLinks.length - 1)) {
            console.log(`Taking ${delay/1000}s delay before processing next season...\n\n`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    if (results.length) {
        const outputFile = joinPathnames([dataDir, 'composed.json']);
        await saveJSON(outputFile, { tournament, data: results });
        console.log(`${results.length} seasons of ${tournament} saved to ${outputFile}`);
    }

    if (!results.length) {
        console.warn(`No season of ${tournament} was scraped`)
    }

    if (!erroneousData.length) {
        console.log(`There was no erroneous encounter from ${tournament} throughout scraping`)
    }

    if (erroneousData.length) {
        const outputFile = joinPathnames([dataDir, 'erroneous.json']);
        await saveJSON(outputFile, { tournament, data: erroneousData });
        console.warn(`${erroneousData.length} season(s) of ${tournament} was erroneous`);
        console.warn(`Results saved to ${outputFile}`);
    }

    if (repairedData.length) {
        const outputFile = joinPathnames([dataDir, 'repaired.json']);
        await saveJSON(outputFile, { tournament, data: repairedData });
        console.log(`${repairedData.length} season(s) of ${tournament} was seemingly repaired after scraping error`);
        console.log(`Results saved to ${outputFile}`);
    }

    console.log(`${tournament} scraping completed.\n`);
}


// /**
//  * @param {any} results 
//  * @param {{
//  *  tournament: string, 
//  *  country: string
//  * }} [options={}] 
//  * @returns 
//  */
/*async function enrichedResults(results, options = {}) {
    const postfix = options.country ? `${options.tournament} (${options.country})` : '';
    for (let i = 0; i < results.length; i++) {
        const { season, gameweeks } = results[i];
        console.log(`[${i + 1}/${results.length}] Enriching ${season} season ${postfix}`);
        for (let j = 0; j < gameweeks.length; j++) {
            const { matches } = gameweeks[j];
            for (let k = 0; k < matches.length; k++) {
                const { homeTeam, awayTeam, score, statsUrl } = matches[k];
                let stats = results[i].gameweeks[j].matches[k].stats;
                try {
                    if (!stats) {
                        stats = await scrapeMatchStats(score, statsUrl, { homeTeam, awayTeam });
                        results[i].gameweeks[j].matches[k].stats = stats;
                        await new Promise(resolve => setTimeout(resolve, Math.floor((Math.random() * 10) + 1) * 1000));
                    }
                }
                catch (error) {
                    console.warn(`Error occured while enriching match stats [${statsUrl}]:`, error.message);
                    results[i].gameweeks[j].matches[k].stats = stats;
                }
            }
        }
        console.log('\n')
    }
    return results;
}*/