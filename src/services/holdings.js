const ledger = require('./ledger');
const { ethers } = require('ethers');
const axios = require('axios');

class HoldingsService {
    constructor(config) {
        this.metadataCache = new Map();
        this.config = config;
        this.CHAIN_ID = 8453; // Base chain ID
        this.USDC_ADDRESS = {
            base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'  // USDC on Base
        };
    }

    setConfig(config) {
        this.config = config;
    }

    async getBaseTokenPrice(tokenAddress) {
        try {
            console.log('Fetching price for token:', tokenAddress);

            // Create wallet instance to get proper address
            const wallet = new ethers.Wallet(this.config.baseTraderKey);
            const takerAddress = wallet.address;

            // Get token balance first
            const provider = new ethers.providers.JsonRpcProvider(
                this.config.baseRpc.replace('wss://', 'https://').replace('ws://', 'http://'),
                {
                    name: 'base',
                    chainId: 8453
                }
            );

            // Get token balance
            let balance;
            if (tokenAddress === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE') {
                balance = await provider.getBalance(takerAddress);
            } else {
                const tokenContract = new ethers.Contract(
                    tokenAddress,
                    ['function balanceOf(address) view returns (uint256)'],
                    provider
                );
                balance = await tokenContract.balanceOf(takerAddress);
            }

            if (balance.isZero()) {
                console.log('Token balance is zero, removing from holdings');
                await ledger.removeHolding('base', tokenAddress);
                return null;
            }

            const params = new URLSearchParams({
                chainId: this.CHAIN_ID.toString(),
                sellToken: tokenAddress,             // Sell the token
                buyToken: this.USDC_ADDRESS.base,    // Buy USDC
                sellAmount: balance.toString(),      // Use actual balance
                taker: takerAddress,                 // Use wallet address, not private key
                slippageBps: '300',
                skipValidation: 'true',
                enableSlippageProtection: 'false'
            });


            const response = await axios.get(
                `https://api.0x.org/swap/permit2/price?${params.toString()}`,
                {
                    headers: {
                        '0x-api-key': this.config.baseZeroXApiKey,
                        '0x-version': 'v2',
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (response.data && response.data.buyAmount) {
                // Convert buyAmount from USDC base units (6 decimals) to USDC
                const usdcAmount = parseFloat(response.data.buyAmount) / 1e6;
                return usdcAmount;
            }
            console.log('No buyAmount found in response');
            return null;
        } catch (error) {
            console.error(`Error fetching Base token price for ${tokenAddress}:`, error);
            return null;
        }
    }

    async getSolanaMetadata(tokenAddress) {
        const cacheKey = `solana:${tokenAddress}`;
        if (this.metadataCache.has(cacheKey)) {
            return this.metadataCache.get(cacheKey);
        }

        try {
            // Try to get token metadata from token list first
            const response = await axios.get('https://token.jup.ag/all');
            const token = response.data.find(t => t.address === tokenAddress);
            
            if (token) {
                const metadata = {
                    symbol: token.symbol,
                    name: token.name
                };
                this.metadataCache.set(cacheKey, metadata);
                return metadata;
            }

            return {
                symbol: tokenAddress.slice(0, 6) + '...',
                name: 'Unknown Token'
            };
        } catch (error) {
            console.error(`Error fetching Solana token metadata for ${tokenAddress}:`, error);
            return {
                symbol: tokenAddress.slice(0, 6) + '...',
                name: 'Unknown Token'
            };
        }
    }

    async getBaseMetadata(tokenAddress) {
        const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
        if (tokenAddress === ETH_ADDRESS) {
            return {
                symbol: 'ETH',
                name: 'Ethereum'
            };
        }

        const cacheKey = `base:${tokenAddress}`;
        if (this.metadataCache.has(cacheKey)) {
            return this.metadataCache.get(cacheKey);
        }

        try {
            const provider = new ethers.providers.JsonRpcProvider(this.config.baseRpc.replace('wss://', 'https://').replace('ws://', 'http://'), {
                name: 'base',
                chainId: 8453
            });
            
            const tokenContract = new ethers.Contract(
                tokenAddress,
                ['function symbol() view returns (string)', 'function name() view returns (string)'],
                provider
            );

            const [symbol, name] = await Promise.all([
                tokenContract.symbol(),
                tokenContract.name()
            ]);

            const metadata = { symbol, name };
            this.metadataCache.set(cacheKey, metadata);
            return metadata;
        } catch (error) {
            console.error(`Error fetching Base token metadata for ${tokenAddress}:`, error);
            return {
                symbol: tokenAddress.slice(0, 6) + '...',
                name: 'Unknown Token'
            };
        }
    }

    async formatHoldingsMessage() {
        if (!this.config) {
            throw new Error('Config not set in HoldingsService');
        }

        try {
            const [solanaHoldings, baseHoldings] = await Promise.all([
                ledger.getAllHoldings('solana'),
                ledger.getAllHoldings('base')
            ]);

            let message = '📊 *Current Holdings*\n\n';

            // Add Solana holdings with metadata
            message += '*SOLANA*\n';
            if (solanaHoldings && solanaHoldings.length > 0) {
                const metadataPromises = solanaHoldings.map(token => 
                    this.getSolanaMetadata(token)
                );
                const metadataResults = await Promise.all(metadataPromises);

                const validHoldings = solanaHoldings.map((token, index) => ({
                    token,
                    metadata: metadataResults[index]
                })).filter(holding => holding.metadata.symbol);

                if (validHoldings.length > 0) {
                    validHoldings.forEach(({ metadata }) => {
                        message += `• ${metadata.symbol}\n`;
                    });
                } else {
                    message += '_No holdings_\n';
                }
            } else {
                message += '_No holdings_\n';
            }

            // Add Base holdings with metadata and prices
            message += '\n*BASE*\n';

            // Add ETH to baseHoldings if not already present
            const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
            const allBaseHoldings = baseHoldings.includes(ETH_ADDRESS) 
                ? baseHoldings 
                : [ETH_ADDRESS, ...baseHoldings];

            if (allBaseHoldings.length > 0) {
                // Get metadata and prices in parallel
                const [metadataResults, priceResults] = await Promise.all([
                    Promise.all(allBaseHoldings.map(token => this.getBaseMetadata(token))),
                    Promise.all(allBaseHoldings.map(token => this.getBaseTokenPrice(token)))
                ]);

                const validHoldings = allBaseHoldings
                    .map((token, index) => ({
                        token,
                        metadata: metadataResults[index],
                        price: priceResults[index]
                    }))
                    .filter(holding => holding.price !== null);

                if (validHoldings.length > 0) {
                    validHoldings.forEach(({ metadata, price }) => {
                        let tokenDisplay = `• ${metadata.symbol}`;
                        const formattedPrice = price.toFixed(2).replace('.', '\\.');
                        tokenDisplay += ` \\- $${formattedPrice}`;
                        message += tokenDisplay + '\n';
                    });
                } else {
                    message += '_No holdings_\n';
                }
            } else {
                message += '_No holdings_\n';
            }

            return message;
        } catch (error) {
            console.error('Error formatting holdings message:', error);
            return '❌ Error retrieving holdings';
        }
    }
}

module.exports = new HoldingsService(); 