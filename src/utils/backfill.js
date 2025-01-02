const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { ethers } = require('ethers');
const ledger = require('../services/ledger');
const bs58 = require('bs58');
const axios = require('axios');

async function backfillHoldings(config, chain = 'all') {
    console.log('\nBackfilling holdings...');

    try {
        // Solana backfill
        if (chain === 'all' || chain === 'solana') {
            if (config.solana?.enabled && config.solana?.rpc && process.env.SOLANA_TRADER_KEY) {
                console.log('\nScanning Solana holdings...');
                const connection = new Connection(config.solana.rpc);
                // Decode base58 private key and create Keypair
                const privateKeyBytes = bs58.decode(process.env.SOLANA_TRADER_KEY);
                const traderKeypair = Keypair.fromSecretKey(privateKeyBytes);
                const traderKey = traderKeypair.publicKey;

                console.log('Scanning holdings for address:', traderKey.toString());

                const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
                    traderKey,
                    { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
                );

                console.log(`Found ${tokenAccounts.value.length} Solana token accounts`);
                
                let addedCount = 0;
                for (const account of tokenAccounts.value) {
                    const tokenData = account.account.data.parsed.info;
                    if (Number(tokenData.tokenAmount.amount) > 0) {
                        console.log(`Processing token ${tokenData.mint} with amount ${tokenData.tokenAmount.amount}`);
                        try {
                            await ledger.addHolding('solana', tokenData.mint, tokenData.tokenAmount.amount);
                            addedCount++;
                            console.log(`Added Solana holding: ${tokenData.mint}`);
                        } catch (error) {
                            console.error(`Failed to add token ${tokenData.mint} to ledger:`, error);
                        }
                    }
                }
                console.log(`Added ${addedCount} Solana tokens to ledger`);

                // Verify the holdings were added
                const holdings = await ledger.getAllHoldings('solana');
                console.log('Current Solana holdings in ledger:', holdings);
            }
        }

        // Base backfill
        if (chain === 'all' || chain === 'base') {
            if (config.base?.enabled && config.base?.rpc && process.env.BASE_TRADER_KEY) {
                console.log('\nScanning Base holdings...');
                // Convert WebSocket URL to HTTP
                const httpRpc = config.base.rpc.replace('wss://', 'https://').replace('ws://', 'http://');
                const provider = new ethers.providers.JsonRpcProvider(httpRpc, {
                    name: 'base',
                    chainId: 8453
                });
                const wallet = new ethers.Wallet(process.env.BASE_TRADER_KEY, provider);
                console.log('Scanning holdings for address:', wallet.address);

                // Get historical trades from 0x API
                const startTime = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60); // Last 30 days
                const endTime = Math.floor(Date.now() / 1000);

                let cursor = null;
                const processedTokens = new Set();

                do {
                    const url = `https://api.0x.org/trade-analytics/swap?` +
                        `startTimestamp=${startTime}&` +
                        `endTimestamp=${endTime}` +
                        (cursor ? `&cursor=${cursor}` : '');

                    const response = await axios.get(url, {
                        headers: {
                            '0x-api-key': config.base.zeroXApiKey,
                            '0x-version': 'v2'
                        }
                    });

                    const { trades, nextCursor } = response.data;

                    // Process trades
                    for (const trade of trades) {
                        if (trade.chainId === 8453 && // Base chain
                            trade.taker.toLowerCase() === wallet.address.toLowerCase()) {
                            
                            // Check actual token balances
                            if (!processedTokens.has(trade.buyToken)) {
                                try {
                                    // Handle native ETH
                                    if (trade.buyToken.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
                                        const balance = await provider.getBalance(wallet.address);
                                        if (balance.gt(0)) {
                                            await ledger.addHolding('base', trade.buyToken, balance.toString());
                                            console.log(`Added Base native ETH holding: ${balance.toString()}`);
                                        }
                                    } else {
                                        const tokenContract = new ethers.Contract(
                                            trade.buyToken,
                                            ['function balanceOf(address) view returns (uint256)'],
                                            provider
                                        );
                                        const balance = await tokenContract.balanceOf(wallet.address);
                                        if (balance.gt(0)) {
                                            await ledger.addHolding('base', trade.buyToken, balance.toString());
                                            console.log(`Added Base holding from buy: ${trade.buyToken} (${balance.toString()})`);
                                        }
                                    }
                                    processedTokens.add(trade.buyToken);
                                } catch (error) {
                                    console.warn(`Failed to check balance for token ${trade.buyToken}:`, error.message);
                                }
                            }

                            if (!processedTokens.has(trade.sellToken)) {
                                try {
                                    // Handle native ETH
                                    if (trade.sellToken.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
                                        const balance = await provider.getBalance(wallet.address);
                                        if (balance.gt(0)) {
                                            await ledger.addHolding('base', trade.sellToken, balance.toString());
                                            console.log(`Added Base native ETH holding: ${balance.toString()}`);
                                        }
                                    } else {
                                        const tokenContract = new ethers.Contract(
                                            trade.sellToken,
                                            ['function balanceOf(address) view returns (uint256)'],
                                            provider
                                        );
                                        const balance = await tokenContract.balanceOf(wallet.address);
                                        if (balance.gt(0)) {
                                            await ledger.addHolding('base', trade.sellToken, balance.toString());
                                            console.log(`Added Base holding from sell: ${trade.sellToken} (${balance.toString()})`);
                                        }
                                    }
                                    processedTokens.add(trade.sellToken);
                                } catch (error) {
                                    console.warn(`Failed to check balance for token ${trade.sellToken}:`, error.message);
                                }
                            }
                        }
                    }

                    cursor = nextCursor;
                } while (cursor);
            }
        }

        console.log('\nBackfill complete!');
        
    } catch (error) {
        console.error('Error during backfill:', error);
        throw error;
    }

    // Close Redis connection after a short delay to ensure all operations complete
    setTimeout(async () => {
        await ledger.close();
        process.exit(0);
    }, 1000);
}

module.exports = { backfillHoldings }; 