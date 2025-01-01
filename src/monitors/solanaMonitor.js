const { Connection, PublicKey, Keypair, VersionedTransaction } = require('@solana/web3.js');
const fetch = require('cross-fetch');
const axios = require('axios');
const bs58 = require('bs58');

class SolanaMonitor {
    constructor(rpcEndpoint, wsEndpoint, wallets, telegramToken, telegramChatId, tradeConfig) {
        console.log(rpcEndpoint, wsEndpoint, wallets, telegramToken, telegramChatId, tradeConfig);
        this.connection = new Connection(rpcEndpoint, {
            wsEndpoint: wsEndpoint,
            commitment: 'confirmed'
        });
        this.wallets = wallets;
        this.telegramToken = telegramToken;
        this.telegramChatId = telegramChatId;
        this.tradeConfig = tradeConfig;
        this.WSOL_ADDRESS = 'So11111111111111111111111111111111111111112';
        this.processedTxs = new Set();
        this.CHAIN_NAME = 'SOLANA';
    }

    async start() {
        try {
            console.log(`Starting ${this.CHAIN_NAME} monitor...`);
            console.log(`[${this.CHAIN_NAME}] Watching wallets:`, this.wallets.map(w => `${w.label}: ${w.address}`).join(', '));
            
            // Convert wallet addresses to PublicKeys
            const walletPublicKeys = this.wallets.map(wallet => new PublicKey(wallet.address));
            
            // Subscribe to all transactions for these wallets
            for (const wallet of walletPublicKeys) {
                this.connection.onLogs(
                    wallet,
                    (logs) => {
                        this.handleLogs(logs).catch(console.error);
                    },
                    'confirmed'
                );
                console.log(`[${this.CHAIN_NAME}] Subscribed to logs for wallet: ${wallet.toString()}`);
            }
        } catch (error) {
            console.error(`[${this.CHAIN_NAME}] Error starting monitor:`, error);
            throw error;
        }
    }

    async handleLogs(logs) {
        if (!logs?.signature) return;

        try {
            const transaction = await this.connection.getTransaction(logs.signature, {
                maxSupportedTransactionVersion: 0,
                commitment: 'confirmed'
            });

            if (!transaction?.meta) return;

            // For versioned transactions, we need to check the static account keys
            const accountKeys = transaction.transaction.message.staticAccountKeys || [];
            
            // Check if transaction is from a watched wallet
            const watchedWallet = this.wallets.find(wallet => 
                accountKeys.some(key => 
                    key.toBase58() === wallet.address
                )
            );

            if (watchedWallet) {
                console.log(`Detected transaction from ${watchedWallet.label}:`, logs.signature);
                await this.analyzePurchaseTransaction(transaction, watchedWallet);
            }
        } catch (error) {
            console.error('Error processing transaction:', error);
        }
    }

    async analyzePurchaseTransaction(transaction, wallet) {
        if (!transaction?.meta) return;

        try {
            // Check if we've already processed this transaction
            const txSignature = transaction.transaction.signatures[0];
            if (this.processedTxs.has(txSignature)) {
                console.log(`[${this.CHAIN_NAME}] Transaction already processed:`, txSignature);
                return;
            }

            const postTokenBalances = transaction.meta.postTokenBalances || [];
            const preTokenBalances = transaction.meta.preTokenBalances || [];

            // Define tokens to skip
            const SKIP_TOKENS = new Set([
                'So11111111111111111111111111111111111111112', // Native SOL
                'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
                '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // USDC (alternate)
                'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
                'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // Bonk
                'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
                'DUSTawucrTsGU8hcqRdHDCbuYhCPADMLM2VcCb8VnFnQ', // DUST
            ]);

            // Look for token purchases (new tokens or balance increases)
            for (const postBalance of postTokenBalances) {
                // Skip if token is in the skip list
                if (SKIP_TOKENS.has(postBalance.mint)) {
                    console.log(`Skipping ${postBalance.mint} transaction (common token)`);
                    continue;
                }

                const preBalance = preTokenBalances.find(b => b.mint === postBalance.mint);
                const preBal = preBalance ? Number(preBalance.uiTokenAmount.amount) : 0;
                const postBal = Number(postBalance.uiTokenAmount.amount);

                if (postBal > preBal) {
                    const balanceIncrease = postBal - preBal;
                    console.log(`[${this.CHAIN_NAME}] Purchase detected from ${wallet.label}:
                        Token: ${postBalance.mint}
                        Previous Balance: ${preBal}
                        New Balance: ${postBal}
                        Increase: ${balanceIncrease}
                    `);

                    // Add transaction to processed set before executing copy trade
                    this.processedTxs.add(txSignature);

                    await this.executeCopyTrade({
                        tokenAddress: postBalance.mint,
                        symbol: postBalance.mint.slice(0, 4) + '...' // Simple symbol display
                    });

                    // Clean up old transactions from the Set (keep last 1000)
                    if (this.processedTxs.size > 1000) {
                        const txsArray = Array.from(this.processedTxs);
                        this.processedTxs = new Set(txsArray.slice(-1000));
                    }
                }
            }
        } catch (error) {
            console.error(`Error analyzing transaction for ${wallet.label}:`, error);
        }
    }

    async executeCopyTrade(purchaseInfo) {
        try {
            const startTime = Date.now();
            console.log(`[${this.CHAIN_NAME}] Starting copy trade for ${purchaseInfo.symbol}...`);
            
            if (!this.traderWallet) {
                throw new Error('Trader wallet not configured');
            }

            // Check wallet balance
            const balance = await this.connection.getBalance(this.traderWallet.publicKey);
            const requiredBalance = this.tradeConfig.amountInLamports + 5000000;
            
            if (balance < requiredBalance) {
                const errorMsg = `Insufficient SOL balance. Required: ${(requiredBalance / 1e9).toFixed(3)} SOL, Available: ${(balance / 1e9).toFixed(3)} SOL`;
                console.error(errorMsg);
                await this.sendTelegramMessage(`⚠️ Trade Skipped - ${errorMsg}`, true);
                return;
            }

            try {
                // 1. Get quote with restrictIntermediateTokens
                const quoteResponse = await (
                    await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${this.WSOL_ADDRESS}&outputMint=${purchaseInfo.tokenAddress}&amount=${this.tradeConfig.amountInLamports}&slippageBps=${this.tradeConfig.slippageBps}&restrictIntermediateTokens=true`)
                ).json();

                if (!quoteResponse) {
                    throw new Error('Failed to get quote from Jupiter');
                }

                // 2. Get swap transaction with dynamic slippage and priority fees
                const { swapTransaction, dynamicSlippageReport } = await (
                    await fetch('https://quote-api.jup.ag/v6/swap', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            quoteResponse,
                            userPublicKey: this.traderWallet.publicKey.toString(),
                            wrapUnwrapSOL: true,
                            dynamicSlippage: {
                                minBps: 50,
                                maxBps: 1000  // Increased for low liquidity tokens
                            },
                            prioritizationFeeLamports: {
                                priorityLevelWithMaxLamports: {
                                    maxLamports: 10000000, // 0.01 SOL max
                                    priorityLevel: "veryHigh"
                                }
                            },
                            dynamicComputeUnitLimit: true
                        })
                    })
                ).json();

                if (!swapTransaction) {
                    throw new Error('Failed to get swap transaction');
                }

                // Log slippage report for monitoring
                console.log('Dynamic Slippage Report:', dynamicSlippageReport);

                // 3. Execute the transaction
                const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
                const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
                
                transaction.sign([this.traderWallet]);

                console.log('Sending transaction...');
                const rawTransaction = transaction.serialize();
                const txid = await this.connection.sendRawTransaction(rawTransaction, {
                    skipPreflight: true,
                    maxRetries: 2
                });
                
                console.log(`Transaction sent: ${txid}`);

                // 4. Confirm transaction
                await this.connection.confirmTransaction(txid);
                console.log('Transaction confirmed!');

                const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);
                
                // Include slippage info in success message
                const successMessage = `✅ ${this.CHAIN_NAME} Copy Trade Executed!\n\n` +
                    `*Token:* ${purchaseInfo.symbol}\n` +
                    `*Amount:* ${this.tradeConfig.amountInSol} SOL\n` +
                    `*Used Slippage:* ${dynamicSlippageReport?.slippageBps || 'N/A'}bps\n` +
                    `*Transaction:* [View](https://solscan.io/tx/${txid})\n` +
                    `*Execution Time:* ${executionTime}s`;
                
                await this.sendTelegramMessage(successMessage, true);

            } catch (error) {
                if (error.response?.data?.error === 'No route found') {
                    console.log(`No route found for token: ${purchaseInfo.symbol}`);
                    await this.sendTelegramMessage(`ℹ️ Trade Skipped - No route found: ${purchaseInfo.symbol}`, true);
                    return;
                }
                
                console.error('Full error:', error);
                throw error;
            }

        } catch (error) {
            console.error(`[${this.CHAIN_NAME}] Error executing copy trade:`, error);
            await this.sendTelegramMessage(`❌ ${this.CHAIN_NAME} Copy Trade Failed!\n\n*Token:* ${purchaseInfo.symbol}\n*Error:* ${error.message}`, true);
        }
    }

    async sendTelegramMessage(message, parseMarkdown = false) {
        try {
            const url = `https://api.telegram.org/bot${this.telegramToken}/sendMessage`;
            await axios.post(url, {
                chat_id: this.telegramChatId,
                text: message,
                parse_mode: parseMarkdown ? 'Markdown' : undefined
            });
        } catch (error) {
            console.error('Error sending telegram message:', error);
        }
    }

    setTraderWallet(privateKey) {
        try {
            const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
            this.traderWallet = keypair;
            console.log('Trader wallet configured:', this.traderWallet.publicKey.toString());
        } catch (error) {
            console.error('Error setting trader wallet:', error);
            throw error;
        }
    }
}

module.exports = SolanaMonitor; 