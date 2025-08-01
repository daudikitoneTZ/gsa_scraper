import fs from 'node:fs/promises';

/** 
 * The function currently assumes it will receive an array of two elements.
 * It must be modified to handle more.
 * @param {Array<string>} names 
*/
export const joinPathnames = (names = []) => {
    const a = names[0];
    const b = names[1];
    return a.endsWith("/") ? `${a}${b}` : `${a}/${b}`;
}

/**
 * @param {string} filename 
 * @param {any} data 
 */
export const saveJSON = async (filePath, data, append = false) => {
    if (append) {
        await fs.appendFile(filePath, JSON.stringify(data, null, 2) + '\n\n')
          .catch(err => console.error('Failed to append a file:', err.message, `[${filePath}]`));
        return;
    }
    await fs.writeFile(filePath, JSON.stringify(data, null, 2))
     .catch(err => console.error('Failed to write a file:', err.message, `[${filePath}]`));
}

/** @param {Object | Array} obj */
export const deepCopy = (obj) => JSON.parse(JSON.stringify(obj));

/** @param {string} filepath */
export const normalizeFilepath = (filepath) => filepath.replace(/[\s:/$\\]/g, '_');

/**
 * Enhanced retry utility with network reconnection handling
 * @param {Function} operation 
 * @param {number} [maxRetries=3] 
 * @param {number} [maxWaitForReconnect=600000] 
 * @returns 
 */
export const withRetry = async (operation, maxRetries = 3, maxWaitForReconnect = 600000) => {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        let returnValue;
        try {
            returnValue = await operation();
            return returnValue;
        } 
        catch (error) {
            lastError = error;
            const isNetworkError = (
                error.message.includes('net::ERR_INTERNET_DISCONNECTED') ||
                error.message.includes('net::ERR_NAME_NOT_RESOLVED') ||
                error.message.includes('timeout')
            );
            if (isNetworkError && attempt <= maxRetries) {
                console.warn(`Retry ${attempt}/${maxRetries} after ${Math.pow(2, attempt)}s: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
                if (isNetworkError) {
                    console.warn('Network error detected. Waiting for reconnection...');
                    const startTime = Date.now();
                    while (Date.now() - startTime < maxWaitForReconnect) {
                        try {
                            // Test network by fetching a small resource
                            await fetch('https://www.google.com', { method: 'HEAD', timeout: 5000 });
                            console.log('Network reconnected.');
                            break;
                        } catch {
                            await new Promise(resolve => setTimeout(resolve, 5000)); // Poll every 5 seconds
                        }
                    }
                    if (Date.now() - startTime >= maxWaitForReconnect) {
                        throw new Error('Network reconnection timeout exceeded');
                    }
                }
            } else if (attempt === maxRetries) {
                throw lastError;
            }
        }
    }
    throw lastError;
}