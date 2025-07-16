import fs from "node:fs/promises";
import scrapeTournament from "./lib/league_scraper.js";
import { joinPathnames } from "./utils/utilities.js";
import getCompetitionUrls from "./lib/competitions/competitions_url.js";

const baseUrl = 'https://globalsportsarchive.com';
const outputDir = await createDataDirectory('data');

startScraper(); // Starting the program

async function startScraper() {
    const competitions = await getCompetitionUrls("Europe", true);
    console.log(`${competitions.length} countries about to be processed...\n`);
    
    for (let i = 0; i < competitions.length; i++) {
        console.log(`Scraping ${i + 1}/${competitions.length} countries`);
        const { country, tournaments } = competitions[i];
        for (let j = 0; j < tournaments.length; j++) {
            const { name, url } = tournaments[j];
            console.log(`[${j + 1}/${tournaments.length}] Scraping ${name} in ${country}`);
            await scrapeLeagues(country, name, url);
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
 */
async function scrapeLeagues(country, tournament, url) {
    const dataDir = joinPathnames([outputDir, country.replace(/\s/g, '_').replace('/', '_')]);
    await fs.mkdir(dataDir, { recursive: true });
    await writeMetaData(country, joinPathnames([dataDir, 'metadata.txt']));
    await scrapeTournament({ tournament, baseUrl, dataDir, pageUrl: url });
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
    await fs.appendFile(filename, `Country = ${country}\n`)
}