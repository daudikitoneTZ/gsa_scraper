import puppeteer from "puppeteer";
import fs from "node:fs";
import { isLeagueCompetition } from "./competitions_url.js";

/** This scrapes links in Europe continent only */

// Helper to pause execution for a given time
const delay = (ms) => new Promise(res => setTimeout(res, ms));

/**
 * Scrapes competitions URLs
 * @param {boolean} separateLeagues 
 * @returns
 */
export default async function scrapeCompetitionURLs(separateLeagues = false) {
    const url = 'https://globalsportsarchive.com/competitions/soccer/';
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#area_container');

    const allResults = [];
    const leagueResults = [];

    // Get all country rows
    const countryElements = await page.$$('#area_container .area_row');

    for (const countryElement of countryElements) {
        await countryElement.evaluate(el => el.scrollIntoView());

        const countryName = await countryElement.$eval(
            'div:nth-child(1)',
            div => div.innerText.trim()
        );
        const countryId = await countryElement.evaluate(el => el.getAttribute('id'));

        // Click to expand competitions
        await countryElement.click();

        // Wait until competitions are loaded for this country (i.e., at least one <a> tag present)
        await page.waitForFunction(
            (id) => {
                const all = Array.from(document.querySelectorAll('.complist_row'));
                const target = all.find(div => div.classList.contains(id));
                return target && target.querySelectorAll('a').length > 0;
            },
            { timeout: 5000 }, // wait max 5s to avoid freezing
            countryId
        ).catch(() => null); // skip failed waits gracefully

        // Extract competitions for this country
        const competitions = await page.evaluate((id) => {
            const all = Array.from(document.querySelectorAll('.complist_row'));
            const target = all.find(div => div.classList.contains(id));
            if (!target) return [];

            return Array.from(target.querySelectorAll('a')).map(a => ({
                name: a.innerText.trim(),
                url: a.href
            }));
        }, countryId);

        allResults.push({
            country: countryName,
            tournaments: competitions
        });

        if (separateLeagues) {
            const leagues = [];
            for (const c of competitions) {
                if (await isLeagueCompetition(c.url, page)) {
                    leagues.push({ name: c.name, url: c.url })
                }            
            }
            if (leagues.length) {
                leagueResults.push({
                    country: countryName, 
                    tournaments: leagues
                })
            }
        }

        // Optional delay between iterations to avoid overloading
        await delay(150);
    }

    // Save output to JSON file
    allResults.length && 
     fs.writeFileSync(`./scrapedURLs/competitions.${Date.now()}.json`, JSON.stringify(allResults, null, 2));

    leagueResults.length && 
     fs.writeFileSync(`./scrapedURLs/league_competitions.${Date.now()}.json`, JSON.stringify(leagueResults, null, 2));

    console.log('✅ Competitions scraped successfully');
    await browser.close();
}
