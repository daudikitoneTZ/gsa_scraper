import fs from "node:fs/promises";
import scrapeTournament from "./lib/league_scraper.js";
import getCompetitionUrls from "./lib/competitions/competitions_url.js";
import { joinPathnames, normalizeFilepath } from "./utils/utilities.js";

const baseUrl = 'https://globalsportsarchive.com';
const outputDir = await createDataDirectory('data');

startScraper(true, 'Bosnia and Herzegovina'); // Starting the program

async function startScraper(leaguesOnly = false, countryIndex = '') {
    const competitions = await getCompetitionUrls(null, countryIndex);
    console.log(`${competitions.length} countries about to be processed...\n`);
    
    for (let i = 0; i < competitions.length; i++) {
        console.log(`Scraping ${i + 1}/${competitions.length} countries`);
        const { country, tournaments } = competitions[i];
        for (let j = 0; j < tournaments.length; j++) {
            const { name, url } = tournaments[j];
            console.log(`[${j + 1}/${tournaments.length}] Scraping ${name} in ${country}`);
            await scrapeLeagues(country, name, url, leaguesOnly);
            console.log('\n');
        }
        console.log('\n\n');
    }

    console.log(`Scraping completed.\n`);
}

/**
 * Scrapes an entire league from 2020 to current year
 * @param {string} country 
 * @param {string} tournament 
 * @param {string} url
 * @param {boolean} leaguesOnly
 */
async function scrapeLeagues(country, tournament, url, leaguesOnly) {
    const dataDir = joinPathnames([outputDir, normalizeFilepath(country)]);
    await fs.mkdir(dataDir, { recursive: true });
    await writeMetaData(country, joinPathnames([dataDir, 'metadata.txt']));
    await scrapeTournament({ 
        country, 
        tournament, 
        baseUrl, 
        dataDir, 
        leaguesOnly, 
        pageUrl: url 
    });
}

/** @param {string} dirname */
async function createDataDirectory(dirname) {
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const outputDir = path.join(path.dirname(fileURLToPath(import.meta.url)), dirname);
    await fs.mkdir(outputDir, { recursive: true });
    return outputDir;
}

/**
 * Assigns metadata
 * @param {string} country 
 * @param {string} filename 
 */
async function writeMetaData(country, filename) {
    const metadata = `Country = ${country}\n`;
    try {
        const content = await fs.readFile(filename, 'utf8');
        const pattern = /Country\s=/i;
        !content || !pattern.test(content || "") &&
         await fs.appendFile(filename, metadata);
    } 
    catch (error) {
        error.code === "ENOENT"
         ? await fs.appendFile(filename, metadata) 
         : console.warn('Error occurred when writing metadata:', error.message);
    }
}