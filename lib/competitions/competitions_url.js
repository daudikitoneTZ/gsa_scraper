import fs from "node:fs/promises";

/**
 * Returns competition URLs
 * @param { 'Asia' | 'Africa' | 'America' | 'Oceania' | 'Europe' | 'World' | undefined } continent
 * @param { string } splitCountry
 * @returns {Promise<Array<{ country: string, tournaments: Array<{ name: string, url: string }>}>}
 */
export default async function getCompetitionUrls(continent, splitCountry) {
    const dataDir = await (async () => {
        const { fileURLToPath } = await import("node:url");
        const path = await import("node:path");
        return path.join(path.dirname(fileURLToPath(import.meta.url)), 'scrapedURLs');
    })();

    const files = await getFiles(continent);
    let results = [];

    for (const file of files) {
        results = results.concat(await readFile(file) || []);
    }

    // This is to be changed
    if (splitCountry) {
        let i = results.findIndex((o) => o.country === splitCountry);
        if (i === -1) {
            console.warn(`Split country ${splitCountry} was not found`);
            i = results.length;
        }
        else {
            console.log(`Data splitted with ${splitCountry} as the end country index`);
        }
        results = results.slice(0, i !== results.length ? i + 1 : i);
    }

    return results.reverse();

    async function getFiles() {
        if (continent) return [`${dataDir}/${continent.toLowerCase()}_competitions.json`];
        const dirList = await fs.readdir(dataDir);
        return dirList.map(d => `${dataDir}/${d}`);
    }

    async function readFile(filename) {
        try {
            const data = JSON.parse(await fs.readFile(filename, 'utf8'));
            return data
        }
        catch (error) {
            error.code === "ENOENT"
             ? console.warn(`Failed to retrieve competition URLs. The file named ${filename} does not exists.`)
             : console.warn(`Error occurred when retrieving competition URLs: ${error.message}`);
            return []
        }
    }
}