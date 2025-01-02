const Redis = require('ioredis');

class Ledger {
    constructor() {
        this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
        this.KEYS = {
            SOLANA_HOLDINGS: 'holdings:solana',
            BASE_HOLDINGS: 'holdings:base'
        };
    }

    async addHolding(chain, tokenAddress) {
        const key = this.KEYS[`${chain.toUpperCase()}_HOLDINGS`];
        await this.redis.sadd(key, tokenAddress.toLowerCase());
    }

    async hasHolding(chain, tokenAddress) {
        const key = this.KEYS[`${chain.toUpperCase()}_HOLDINGS`];
        return await this.redis.sismember(key, tokenAddress.toLowerCase());
    }

    async getAllHoldings(chain) {
        const key = this.KEYS[`${chain.toUpperCase()}_HOLDINGS`];
        return this.redis.smembers(key);
    }

    async removeHolding(chain, tokenAddress) {
        const key = this.KEYS[`${chain.toUpperCase()}_HOLDINGS`];
        await this.redis.srem(key, tokenAddress.toLowerCase());
    }

    async close() {
        await this.redis.quit();
    }

    async clearAllHoldings() {
        await Promise.all([
            this.redis.del(this.KEYS.SOLANA_HOLDINGS),
            this.redis.del(this.KEYS.BASE_HOLDINGS)
        ]);
    }

    async clearChainHoldings(chain) {
        const key = this.KEYS[`${chain.toUpperCase()}_HOLDINGS`];
        await this.redis.del(key);
    }
}

module.exports = new Ledger();