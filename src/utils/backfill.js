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
                const privateKeyBytes = bs58.decode(process.env.SOLANA_TRADER_KEY);
                const traderKeypair = Keypair.fromSecretKey(privateKeyBytes);
                const traderKey = traderKeypair.publicKey;

                console.log('Scanning holdings for address:', traderKey.toString());

                // Check SOL balance first
                const solBalance = await connection.getBalance(traderKey);
                if (solBalance > 0) {
                    const SOL_ADDRESS = 'So11111111111111111111111111111111111111112';
                    await ledger.addHolding('solana', SOL_ADDRESS);
                    console.log('Added native SOL to ledger');
                }

                const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
                    traderKey,
                    { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
                );

                console.log(`Found ${tokenAccounts.value.length} Solana token accounts`);
                
                let addedCount = 0;
                for (const account of tokenAccounts.value) {
                    // Log the full account structure to debug
                    console.log('Token account:', JSON.stringify(account.account.data.parsed, null, 2));

                    const tokenAmount = account.account.data.parsed.info.tokenAmount;
                    if (tokenAmount && tokenAmount.uiAmount > 0) {
                        try {
                            const mint = account.account.data.parsed.info.mint;
                            await ledger.addHolding('solana', mint);
                            addedCount++;
                            console.log(`Added Solana holding: ${mint} with amount ${tokenAmount.uiAmount}`);
                        } catch (error) {
                            console.error(`Failed to add token to ledger:`, error);
                        }
                    }
                }
                console.log(`Added ${addedCount} Solana tokens to ledger`);
            }
        }

        // Base backfill
        if (chain === 'all' || chain === 'base') {
            if (config.base?.enabled && config.base?.rpc && process.env.BASE_TRADER_KEY) {
                console.log('\nScanning Base holdings...');
                const httpRpc = config.base.rpc.replace('wss://', 'https://').replace('ws://', 'http://');
                const provider = new ethers.providers.JsonRpcProvider(httpRpc);
                const wallet = new ethers.Wallet(process.env.BASE_TRADER_KEY, provider);
                console.log('Scanning holdings for address:', wallet.address);

                // Get historical trades from 0x API
                const startTime = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60); // Last 30 days
                const endTime = Math.floor(Date.now() / 1000);

                let cursor = null;
                const processedTokens = new Set();
                let addedCount = 0;

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
                            
                            // Add buy token to holdings if not processed
                            if (!processedTokens.has(trade.buyToken)) {
                                try {
                                    // Skip native ETH
                                    if (trade.buyToken.toLowerCase() !== '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
                                        await ledger.addHolding('base', trade.buyToken);
                                        addedCount++;
                                        console.log(`Added Base holding: ${trade.buyToken}`);
                                    }
                                    processedTokens.add(trade.buyToken);
                                } catch (error) {
                                    console.warn(`Failed to add token ${trade.buyToken}:`, error.message);
                                }
                            }
                        }
                    }

                    cursor = nextCursor;
                } while (cursor);

                console.log(`Added ${addedCount} Base tokens to ledger`);
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

async function backfillSolanaHoldings(walletAddress) {
    try {
        console.log('Scanning holdings for address:', walletAddress);
        
        const connection = new Connection(process.env.SOLANA_RPC_URL);
        const publicKey = new PublicKey(walletAddress);

        // Check SOL balance first
        const solBalance = await connection.getBalance(publicKey);
        if (solBalance > 0) {
            const SOL_ADDRESS = 'So11111111111111111111111111111111111111112';
            await ledger.addHolding('solana', SOL_ADDRESS);
            console.log('Added native SOL to ledger');
        }

        // Then check token accounts
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
            programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
        });

        console.log(`Found ${tokenAccounts.value.length} Solana token accounts`);
        
        let addedTokens = 0;
        for (const account of tokenAccounts.value) {
            const tokenBalance = account.account.data.parsed.info.tokenAmount;
            if (tokenBalance.uiAmount > 0) {
                const mint = account.account.data.parsed.info.mint;
                await ledger.addHolding('solana', mint);
                addedTokens++;
            }
        }

        console.log(`Added ${addedTokens} Solana tokens to ledger`);

    } catch (error) {
        console.error('Error backfilling Solana holdings:', error);
    }
}

module.exports = {
    backfillHoldings,
    backfillSolanaHoldings
}; 