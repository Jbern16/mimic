const Redis = require('ioredis');

class Ledger {
    constructor() {
        this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
        this.KEYS = {
            SOLANA_HOLDINGS: 'holdings:solana',
            BASE_HOLDINGS: 'holdings:base'
        };
    }

    async addHolding(chain, tokenAddress, amount) {
        const key = this.KEYS[`${chain.toUpperCase()}_HOLDINGS`];
        await this.redis.hset(key, tokenAddress.toLowerCase(), amount.toString());
    }

    async getHolding(chain, tokenAddress) {
        const key = this.KEYS[`${chain.toUpperCase()}_HOLDINGS`];
        const amount = await this.redis.hget(key, tokenAddress.toLowerCase());
        return amount ? amount.toString() : '0';
    }

    async hasHolding(chain, tokenAddress) {
        const amount = await this.getHolding(chain, tokenAddress);
        return amount !== '0';
    }

    async getAllHoldings(chain) {
        const key = this.KEYS[`${chain.toUpperCase()}_HOLDINGS`];
        return this.redis.hgetall(key);
    }

    async removeHolding(chain, tokenAddress) {
        const key = this.KEYS[`${chain.toUpperCase()}_HOLDINGS`];
        await this.redis.hdel(key, tokenAddress.toLowerCase());
    }

    async close() {
        await this.redis.quit();
    }
}

module.exports = new Ledger(); 