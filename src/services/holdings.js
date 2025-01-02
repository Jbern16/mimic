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
        // Handle native SOL
        if (tokenAddress === 'So11111111111111111111111111111111111111112') {
            return {
                symbol: 'SOL',
                name: 'Solana'
            };
        }

        const cacheKey = `solana:${tokenAddress}`;
        if (this.metadataCache.has(cacheKey)) {
            return this.metadataCache.get(cacheKey);
        }

        try {
            // Try strict list first, then fall back to full list
            let token;
            try {
                const strictResponse = await axios.get('https://token.jup.ag/strict');
                token = strictResponse.data.find(t => t.address === tokenAddress);
            } catch (error) {
                console.log('Failed to fetch strict token list, trying full list');
            }

            if (!token) {
                const fullResponse = await axios.get('https://token.jup.ag/all');
                token = fullResponse.data.find(t => t.address === tokenAddress);
            }
            
            if (token) {
                const metadata = {
                    symbol: token.symbol,
                    name: token.name
                };
                this.metadataCache.set(cacheKey, metadata);
                return metadata;
            }

            // If token not found in either list, return shortened address
            return {
                symbol: `${tokenAddress.slice(0, 4)}...${tokenAddress.slice(-4)}`,
                name: 'Unknown Token'
            };
        } catch (error) {
            console.error(`Error fetching Solana token metadata for ${tokenAddress}:`, error);
            return {
                symbol: `${tokenAddress.slice(0, 4)}...${tokenAddress.slice(-4)}`,
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
        try {
            let message = '*Current Holdings*\n';

            // Get holdings from ledger
            const solanaHoldings = await ledger.getAllHoldings('solana');
            const baseHoldings = await ledger.getAllHoldings('base');

            // Add Solana holdings with metadata (no prices)
            message += '\n*SOLANA*\n';
            if (solanaHoldings && solanaHoldings.length > 0) {
                const SOL_ADDRESS = 'So11111111111111111111111111111111111111112';
                const allSolanaHoldings = solanaHoldings.includes(SOL_ADDRESS) 
                    ? solanaHoldings 
                    : [SOL_ADDRESS, ...solanaHoldings];

                // Get metadata for all tokens
                const metadataResults = await Promise.all(
                    allSolanaHoldings.map(token => this.getSolanaMetadata(token))
                );

                allSolanaHoldings.forEach((token, index) => {
                    const metadata = metadataResults[index];
                    // Escape dots in the shortened address
                    const shortAddr = `${token.slice(0, 4)}\\.\\.\\.${token.slice(-4)}`;
                    message += `• ${metadata.symbol} \\(${shortAddr}\\)\n`;
                });
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

    async getTokenAddressFromSymbol(symbol) {
        const baseHoldings = await ledger.getAllHoldings('base');
        
        // Handle ETH specially
        if (symbol === 'ETH') {
            return '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
        }

        // Check each token's metadata to find matching symbol
        for (const tokenAddress of baseHoldings) {
            const metadata = await this.getBaseMetadata(tokenAddress);
            if (metadata.symbol === symbol) {
                return tokenAddress;
            }
        }

        return null;
    }
}

module.exports = new HoldingsService(); 