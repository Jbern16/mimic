const Redis = require('ioredis');

class Ledger {
    constructor() {
        this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    }

    async addHolding(chain, token) {
        try {
            await this.redis.sadd(`holdings:${chain}`, token);
        } catch (error) {
            console.error(`Error adding ${chain} holding:`, error);
        }
    }

    async hasHolding(chain, tokenAddress) {
        return await this.redis.sismember(`holdings:${chain}`, tokenAddress);
    }

    async getAllHoldings(chain) {
        try {
            const holdings = await this.redis.smembers(`holdings:${chain}`);
            return holdings;
        } catch (error) {
            console.error(`Error getting ${chain} holdings:`, error);
            return [];
        }
    }

    async removeHolding(chain, tokenAddress) {
        await this.redis.srem(`holdings:${chain}`, tokenAddress);
    }

    async clearAllHoldings() {
        await Promise.all([
            this.redis.del('holdings:solana'),
            this.redis.del('holdings:base')
        ]);
    }

    async clearChainHoldings(chain) {
        await this.redis.del(`holdings:${chain}`);
    }

    async close() {
        await this.redis.quit();
    }
}

module.exports = new Ledger();