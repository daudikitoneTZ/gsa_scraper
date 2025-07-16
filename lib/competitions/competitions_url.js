import fs from "node:fs/promises";
import puppeteer from "puppeteer";

/**
 * Returns competition URLs
 * @param { 'Asia' | 'Africa' | 'America' | 'Oceania' | 'Europe' | 'World' | undefined } continent
 * @param { boolean } leaguesOnly
 * @returns {Promise<Array<{ country: string, tournaments: Array<{ name: string, url: string }>}>}
 */
export default async function getCompetitionUrls(continent, leaguesOnly = false) {
    const files = await getFiles();
    const results = [];

    files.forEach(async (file) => {
        results.concat(await readFile(file))
    });

    async function getFiles() {
        const dir = './scrapedURLs';
        if (continent) return [`${dir}/${continent.toLowerCase()}_competitions.json`];
        const dirList = await fs.readdir(dir);
        return dirList.map(d => `${dir}/${d}`);
    }

    async function readFile(filename) {
        try {
            const data = JSON.parse(await readFile(filename, 'utf8'));
            if (!leaguesOnly) return data;
        
            const leagues = [];
            for (const { country, tournaments } of data) {
                const leaguesList = [];
                tournaments.forEach(async ({ name, url }) => {
                    if (await isLeagueCompetition(url)) {
                        leaguesList.push({ name, url })
                    }
                });
                leaguesList.length && leagues.push({ country, tournaments: leaguesList });
            }
            return leagues;
        }
        catch (error) {
            error.code === "ENOENT"
             ? console.warn(`Failed to retrieve competition URLs. The file named ${filename} does not exists.`)
             : console.warn(`Error occurred when retrieving competition URLs: ${error.message}`);
            return []
        }
    }
}

/**
 * Checks URL to see if it's a league URL or not
 * @param {string} url 
 * @param {any} page 
 * @returns {Promise<boolean>}
 */
export const isLeagueCompetition = async (url, page = null) => {
    let browser;

    if (!page) {
        browser = await puppeteer.launch({ headless: true });
        page = await browser.newPage();
    }

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });

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

    finally { browser && await browser.close() }
}
