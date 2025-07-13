/**
 * Sorts gameweeks by the earliest match date and reassigns gameweek numbers sequentially.
 * @param {Array<{ gameweek: number, matches: Array<{ date: string, time: string, homeTeam: string, awayTeam: string, score: string, statsUrl: string, awarded?: boolean }> }>} gameweeks
 * @returns {Array<{ gameweek: number, matches: Array<{ date: string, time: string, homeTeam: string, awayTeam: string, score: string, statsUrl: string, awarded?: boolean }> }>}
 */
export const sortGameweeksByDate = (gameweeks) => {
    // Filter out gameweeks with no valid matches
    const validGameweeks = gameweeks.filter(gw => 
        gw.matches && 
        gw.matches.length > 0 && 
        gw.matches.some(match => match.date && /^\d{4}-\d{2}-\d{2}$/.test(match.date))
    );

    // Remove duplicate gameweeks (same set of matches)
    const uniqueGameweeks = [];
    const matchSetSignatures = new Set();
    for (const gw of validGameweeks) {
        const matchSignature = gw.matches
            .map(m => `${m.homeTeam}|${m.awayTeam}|${m.date}|${m.score}`)
            .sort()
            .join(';');
        if (!matchSetSignatures.has(matchSignature)) {
            matchSetSignatures.add(matchSignature);
            uniqueGameweeks.push(gw);
        }
    }

    // Sort by earliest valid date
    uniqueGameweeks.sort((a, b) => {
        const earliestDateA = a.matches
            .map(match => match.date)
            .filter(date => date && /^\d{4}-\d{2}-\d{2}$/.test(date))
            .sort()[0] || '9999-12-31';
        const earliestDateB = b.matches
            .map(match => match.date)
            .filter(date => date && /^\d{4}-\d{2}-\d{2}$/.test(date))
            .sort()[0] || '9999-12-31';
        return earliestDateA.localeCompare(earliestDateB);
    });

    // Reassign gameweek numbers
    return uniqueGameweeks.map((gw, index) => ({
        gameweek: index + 1,
        matches: gw.matches
    }));
}