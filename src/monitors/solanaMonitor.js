const { Connection, PublicKey, Keypair, VersionedTransaction } = require('@solana/web3.js');
const fetch = require('cross-fetch');
const axios = require('axios');
const bs58 = require('bs58');
const ledger = require('../services/ledger');

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
            const txSignature = transaction.transaction.signatures[0];
            console.log(`[${this.CHAIN_NAME}] Analyzing transaction ${txSignature} from ${wallet.label}`);
            
            if (this.processedTxs.has(txSignature)) {
                console.log(`[${this.CHAIN_NAME}] Skipping already processed transaction: ${txSignature}`);
                return;
            }

            // Add transaction to processed set immediately to prevent duplicate processing
            this.processedTxs.add(txSignature);

            const postTokenBalances = transaction.meta.postTokenBalances || [];
            const preTokenBalances = transaction.meta.preTokenBalances || [];

            console.log(`[${this.CHAIN_NAME}] Pre-token balances:`, preTokenBalances.map(b => ({
                mint: b.mint,
                amount: b.uiTokenAmount.amount,
                decimals: b.uiTokenAmount.decimals
            })));
            console.log(`[${this.CHAIN_NAME}] Post-token balances:`, postTokenBalances.map(b => ({
                mint: b.mint,
                amount: b.uiTokenAmount.amount,
                decimals: b.uiTokenAmount.decimals
            })));

            // Track if we've already executed a copy trade for this transaction
            let copyTradeExecuted = false;

            // Look for token purchases (new tokens or balance increases)
            for (const postBalance of postTokenBalances) {
                console.log(`[${this.CHAIN_NAME}] Checking token: ${postBalance.mint}`);
                
                if (this.tradeConfig.SKIP_TOKENS.has(postBalance.mint)) {
                    console.log(`[${this.CHAIN_NAME}] Skipping ignored token: ${postBalance.mint}`);
                    continue;
                }

                const preBalance = preTokenBalances.find(b => b.mint === postBalance.mint);
                const preBal = preBalance ? Number(preBalance.uiTokenAmount.amount) : 0;
                const postBal = Number(postBalance.uiTokenAmount.amount);

                console.log(`[${this.CHAIN_NAME}] Balance change for ${postBalance.mint}:`, {
                    pre: preBal,
                    post: postBal,
                    change: postBal - preBal
                });

                if (postBal > preBal && !copyTradeExecuted) {
                    const balanceIncrease = postBal - preBal;
                    console.log(`[${this.CHAIN_NAME}] Purchase detected by ${wallet.label}:
                        Token: ${postBalance.mint}
                        Previous Balance: ${preBal}
                        New Balance: ${postBal}
                        Increase: ${balanceIncrease}
                    `);

                    await this.executeCopyTrade({
                        tokenAddress: postBalance.mint,
                        symbol: postBalance.mint.slice(0, 4) + '...',
                        sourceWallet: wallet.label
                    });

                    copyTradeExecuted = true;
                } else {
                    console.log(`[${this.CHAIN_NAME}] No purchase detected:`, {
                        balanceIncreased: postBal > preBal,
                        alreadyExecuted: copyTradeExecuted
                    });
                }
            }

            if (postTokenBalances.length === 0) {
                console.log(`[${this.CHAIN_NAME}] No token balances found in transaction`);
            }

            // Clean up old transactions from the Set (keep last 1000)
            if (this.processedTxs.size > 1000) {
                const txsArray = Array.from(this.processedTxs);
                this.processedTxs = new Set(txsArray.slice(-1000));
            }

        } catch (error) {
            console.error(`Error analyzing transaction for ${wallet.label}:`, error);
            console.error('Transaction details:', {
                signature: transaction.transaction.signatures[0],
                accounts: transaction.transaction.message.accountKeys.map(key => key.toString()),
                error: error.message,
                stack: error.stack
            });
        }
    }

    async notifySell(sellInfo) {
        try {
            const message = `🔔 ${this.CHAIN_NAME} Sell Alert!\n\n` +
                `*${sellInfo.sourceWallet}* is selling *${sellInfo.tokenMint.slice(0, 8)}...*\n` +
                `You currently hold this token\n` +
                `[View Transaction](https://solscan.io/tx/${sellInfo.txSignature})`;

            await this.sendTelegramMessage(message, true);

        } catch (error) {
            console.error(`[${this.CHAIN_NAME}] Error sending sell notification:`, error);
        }
    }

    async executeCopyTrade(purchaseInfo) {
        const startTime = Date.now();
        const MAX_RETRIES = 3;
        let currentTry = 0;

        try {
            console.log(`[${this.CHAIN_NAME}] Starting copy trade for ${purchaseInfo.symbol} - Following ${purchaseInfo.sourceWallet}`);

            if (!this.traderWallet) {
                throw new Error('Trader wallet not configured');
            }

            // Check if we already hold this token
            const hasHolding = await ledger.hasHolding('solana', purchaseInfo.tokenAddress);
            if (hasHolding) {
                console.log(`[${this.CHAIN_NAME}] Already holding token ${purchaseInfo.tokenAddress}, skipping purchase`);
                await this.sendTelegramMessage(
                    `ℹ️ ${this.CHAIN_NAME} Trade Alert!\n\n` +
                    `*${purchaseInfo.sourceWallet}* bought more *${purchaseInfo.symbol}*\n` +
                    `You already hold this token - Trade skipped`,
                    true
                );
                return;
            }

            // Check wallet balance
            const balance = await this.connection.getBalance(this.traderWallet.publicKey);
            const requiredBalance = this.tradeConfig.amountInLamports + 5000000;
            
            if (balance < requiredBalance) {
                const errorMsg = `Insufficient SOL balance. Required: ${(requiredBalance / 1e9).toFixed(3)} SOL, Available: ${(balance / 1e9).toFixed(3)} SOL`;
                console.error(errorMsg);
                await this.sendTelegramMessage(
                    `ℹ️ ${this.CHAIN_NAME} Trade Alert!\n\n` +
                    `*${purchaseInfo.sourceWallet}* bought *${purchaseInfo.symbol}*\n\n` +
                    `⚠️ Trade Skipped - ${errorMsg}`,
                    true
                );
                return;
            }

            while (currentTry < MAX_RETRIES) {
                try {
                    currentTry++;
                    console.log(`[${this.CHAIN_NAME}] Attempt ${currentTry} of ${MAX_RETRIES}`);

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
                                    maxBps: 1000
                                },
                                prioritizationFeeLamports: {
                                    priorityLevelWithMaxLamports: {
                                        maxLamports: 10000000,
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

                    // 4. Confirm transaction with new strategy
                    const latestBlockhash = await this.connection.getLatestBlockhash();
                    const confirmation = await this.connection.confirmTransaction({
                        signature: txid,
                        blockhash: latestBlockhash.blockhash,
                        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
                    }, 'confirmed');

                    if (confirmation.value.err) {
                        throw new Error(`Transaction failed: ${confirmation.value.err}`);
                    }

                    console.log('Transaction confirmed!');

                    const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);
                    
                    const successMessage = `✅ ${this.CHAIN_NAME} Copy Trade Executed!\n\n` +
                        `*Token:* ${purchaseInfo.symbol}\n` +
                        `*Following:* ${purchaseInfo.sourceWallet}\n` +
                        `*Amount:* ${this.tradeConfig.amountInSol} SOL\n` +
                        `*Used Slippage:* ${dynamicSlippageReport?.slippageBps || 'N/A'}bps\n` +
                        `*Transaction:* [View](https://solscan.io/tx/${txid})\n` +
                        `*Execution Time:* ${executionTime}s`;
                    
                    await this.sendTelegramMessage(successMessage, true);

                    // Add to ledger on successful purchase
                    await ledger.addHolding('solana', purchaseInfo.tokenAddress, '1');

                    return; // Success - exit the retry loop

                } catch (error) {
                    if (error.response?.data?.error === 'No route found') {
                        console.log(`No route found for token: ${purchaseInfo.symbol}`);
                        await this.sendTelegramMessage(`ℹ️ Trade Skipped - No route found: ${purchaseInfo.symbol}`, true);
                        return;
                    }
                    
                    console.error(`[${this.CHAIN_NAME}] Attempt ${currentTry} failed:`, error);

                    if (currentTry === MAX_RETRIES) {
                        throw error; // Rethrow on final attempt
                    }

                    // Wait before retrying (exponential backoff)
                    const waitTime = Math.min(1000 * Math.pow(2, currentTry - 1), 10000);
                    console.log(`[${this.CHAIN_NAME}] Waiting ${waitTime}ms before retry...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
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