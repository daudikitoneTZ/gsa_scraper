import { joinPathnames, saveJSON } from "../utils/utilities.js";

/**
 * Verifies gameweek data for anomalies like duplicates and fewer-than-expected matches.
 * Returns the original data if no critical issues are found, along with a report of warnings.
 * Throws an error for critical issues (e.g., duplicates).
 * @param {Array<{ gameweek: number, matches: Array<{ date: string, time: string, homeTeam: string, awayTeam: string, score: string, statsUrl: string, awarded?: boolean }> }>} gameweeks
 * @param {number} expectedMatchesPerGameweek
 * @param {string} seasonUrl
 * @param {string} outputDir
 * @returns {Promise<{ data: Array, report: Array<{ type: string, message: string, details: any }>}>}
 */
export const verifyGameweekData = async (gameweeks, expectedMatchesPerGameweek, seasonUrl, outputDir) => {
    const report = [];

    // Helper function to log issues to file
    async function logIssue(message, type = 'warning', details = {}) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            seasonUrl,
            type,
            message,
            details
        };
        const logFile = joinPathnames([outputDir, 'gameweek_verification_issues.log']);
        await saveJSON(logFile, logEntry, true);
        report.push({ type, message, details });
    }

    // Check for duplicate matches across all gameweeks
    const matchSignatures = new Set();
    const duplicateMatches = [];
    gameweeks.forEach((gw) => {
        gw.matches.forEach((match, matchIndex) => {
            const signature = `${match.homeTeam}|${match.awayTeam}|${match.date}|${match.score}`;
            if (matchSignatures.has(signature)) {
                duplicateMatches.push({
                    gameweek: gw.gameweek,
                    matchIndex,
                    match
                });
            } else {
                matchSignatures.add(signature);
            }
        });
    });

    if (duplicateMatches.length > 0) {
        await logIssue(
            `Found ${duplicateMatches.length} duplicate matches`,
            'error',
            { duplicates: duplicateMatches }
        );
        throw new Error(`Duplicate matches detected: ${duplicateMatches.length} instances. See gameweek_verification_issues.log for details.`);
    }

    // Check for gameweeks with fewer matches than expected
    const matchThreshold = Math.floor(expectedMatchesPerGameweek * 0.5); // Flag if <50% of expected
    const lowMatchGameweeks = gameweeks.filter(gw => 
        gw.matches.length > 0 && gw.matches.length < matchThreshold
    );

    for (const gw of lowMatchGameweeks) {
        await logIssue(
            `Gameweek ${gw.gameweek} has fewer matches than expected: ${gw.matches.length} found, expected ~${expectedMatchesPerGameweek}`,
            'warning',
            { gameweek: gw.gameweek, matches: gw.matches }
        );
    }

    // Check for invalid or missing dates
    const invalidDateGameweeks = gameweeks.filter(gw => 
        gw.matches.some(match => !match.date || !/^\d{4}-\d{2}-\d{2}$/.test(match.date))
    );

    for (const gw of invalidDateGameweeks) {
        const invalidMatches = gw.matches.filter(match => !match.date || !/^\d{4}-\d{2}-\d{2}$/.test(match.date));
        await logIssue(
            `Gameweek ${gw.gameweek} contains matches with invalid or missing dates`,
            'warning',
            { gameweek: gw.gameweek, invalidMatches }
        );
    }

    // Check for empty gameweeks
    const emptyGameweeks = gameweeks.filter(gw => gw.matches.length === 0);
    for (const gw of emptyGameweeks) {
        await logIssue(
            `Gameweek ${gw.gameweek} is empty (no matches)`,
            'warning',
            { gameweek: gw.gameweek }
        );
    }

    return { data: gameweeks, report };
}