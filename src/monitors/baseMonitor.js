const ethers = require('ethers');
const axios = require('axios');
const ledger = require('../services/ledger');

class BaseMonitor {
    constructor(rpcEndpoint, wallets, telegramToken, telegramChatId, tradeConfig) {
        this.provider = new ethers.providers.WebSocketProvider(rpcEndpoint);
        this.wallets = wallets;
        this.telegramToken = telegramToken;
        this.telegramChatId = telegramChatId;
        this.tradeConfig = tradeConfig;
        this.processedTxs = new Set();
        
        // Base chain configuration
        this.CHAIN_NAME = 'BASE';
        this.ZERO_X_API = 'https://api.0x.org';
        this.ZERO_X_API_KEY = process.env.BASE_ZERO_X_API_KEY;
        this.CHAIN_ID = 8453; // Base chain ID
    }

    async start() {
        try {
            console.log(`Starting ${this.CHAIN_NAME} monitor...`);
            console.log(`[${this.CHAIN_NAME}] Watching wallets:`, this.wallets.map(w => `${w.label}: ${w.address}`).join(', '));

            // Create filters for each wallet we're monitoring
            for (const wallet of this.wallets) {
                const normalizedAddress = wallet.address.toLowerCase();
                
                // Listen for outgoing transfers (wallet is sender)
                const outgoingFilter = {
                    address: null,
                    topics: [
                        ethers.utils.id("Transfer(address,address,uint256)"),
                        ethers.utils.hexZeroPad(normalizedAddress, 32),
                        null
                    ]
                };

                // Listen for incoming transfers (wallet is receiver)
                const incomingFilter = {
                    address: null,
                    topics: [
                        ethers.utils.id("Transfer(address,address,uint256)"),
                        null,
                        ethers.utils.hexZeroPad(normalizedAddress, 32)
                    ]
                };

                // Set up listeners for both filters
                this.provider.on(outgoingFilter, async (log) => {
                    try {
                        // Ensure we have a valid transaction hash
                        if (!log.transactionHash) {
                            console.log(`[${this.CHAIN_NAME}] Skipping log with no transaction hash:`, log);
                            return;
                        }
                        
                        // Create a transaction-like object from the log
                        const tx = {
                            hash: log.transactionHash,
                            from: log.topics[1] ? ethers.utils.defaultAbiCoder.decode(['address'], log.topics[1])[0] : null,
                            to: log.topics[2] ? ethers.utils.defaultAbiCoder.decode(['address'], log.topics[2])[0] : null,
                            address: log.address
                        };

                        await this.analyzeTransaction(tx, wallet);
                    } catch (error) {
                        console.error(`[${this.CHAIN_NAME}] Error processing outgoing transaction:`, error);
                    }
                });

                this.provider.on(incomingFilter, async (log) => {
                    try {
                        // Ensure we have a valid transaction hash
                        if (!log.transactionHash) {
                            console.log(`[${this.CHAIN_NAME}] Skipping log with no transaction hash:`, log);
                            return;
                        }
                        
                        const tx = {
                            hash: log.transactionHash,
                            from: log.topics[1] ? ethers.utils.defaultAbiCoder.decode(['address'], log.topics[1])[0] : null,
                            to: log.topics[2] ? ethers.utils.defaultAbiCoder.decode(['address'], log.topics[2])[0] : null,
                            address: log.address
                        };

                        await this.analyzeTransaction(tx, wallet);
                    } catch (error) {
                        console.error(`[${this.CHAIN_NAME}] Error processing incoming transaction:`, error);
                    }
                });

                console.log(`[${this.CHAIN_NAME}] Subscribed to transfers for wallet: ${wallet.address}`);
            }

            // Handle WebSocket connection errors and reconnection
            this.provider._websocket.on('error', async () => {
                console.error(`[${this.CHAIN_NAME}] WebSocket error, attempting to reconnect...`);
                await this.reconnect();
            });
            
            this.provider._websocket.on('close', async () => {
                console.error(`[${this.CHAIN_NAME}] WebSocket closed, attempting to reconnect...`);
                await this.reconnect();
            });

        } catch (error) {
            console.error(`[${this.CHAIN_NAME}] Error starting monitor:`, error);
            throw error;
        }
    }

    async reconnect() {
        try {
            // Create new WebSocket provider
            const newProvider = new ethers.providers.WebSocketProvider(
                this.provider._websocket.url
            );

            // Update the provider reference
            this.provider = newProvider;

            // Reconnect the wallet if it exists
            if (this.traderWallet) {
                this.traderWallet = this.traderWallet.connect(newProvider);
            }

            // Restart monitoring
            await this.start();
            
            console.log(`[${this.CHAIN_NAME}] Successfully reconnected WebSocket`);
        } catch (error) {
            console.error(`[${this.CHAIN_NAME}] Failed to reconnect:`, error);
            // Try to reconnect again after a delay
            setTimeout(() => this.reconnect(), 5000);
        }
    }

    async analyzeTransaction(tx, wallet) {
        if (this.processedTxs.has(tx.hash)) return;

        try {
            console.log(`[${this.CHAIN_NAME}] Analyzing transaction ${tx.hash} from ${wallet.label}`);
            const receipt = await this.provider.getTransactionReceipt(tx.hash);
            if (!receipt) return;

            // Track unique tokens we need to check
            const tokensToCheck = new Set();
            
            // Check if this is a real purchase (wallet spent ETH or tokens)
            let isRealPurchase = false;
            
            // Check if wallet spent ETH
            const transaction = await this.provider.getTransaction(tx.hash);
            console.log(`[${this.CHAIN_NAME}] Transaction value:`, {
                from: transaction.from,
                value: ethers.utils.formatEther(transaction.value),
                to: transaction.to
            });

            if (transaction.from.toLowerCase() === wallet.address.toLowerCase() && transaction.value.gt(0)) {
                isRealPurchase = true;
                console.log(`[${this.CHAIN_NAME}] Detected ETH spend:`, ethers.utils.formatEther(transaction.value));
            }
            
            // Check if wallet spent any tokens
            console.log(`[${this.CHAIN_NAME}] Checking ${receipt.logs.length} logs for token transfers`);
            for (const log of receipt.logs) {
                if (log.topics[0] !== ethers.utils.id("Transfer(address,address,uint256)")) continue;
                
                // Check if wallet sent any tokens
                const from = ethers.utils.defaultAbiCoder.decode(['address'], log.topics[1])[0].toLowerCase();
                if (from === wallet.address.toLowerCase()) {
                    isRealPurchase = true;
                    console.log(`[${this.CHAIN_NAME}] Detected token spend from wallet:`, log.address);
                    break;
                }
            }
            
            // If this isn't a real purchase, ignore incoming transfers
            if (!isRealPurchase) {
                console.log(`[${this.CHAIN_NAME}] Ignoring potential airdrop/disperse transaction: ${tx.hash}`);
                return;
            }

            // Look for token transfers
            console.log(`[${this.CHAIN_NAME}] Analyzing token transfers in transaction`);
            for (const log of receipt.logs) {
                if (log.topics[0] !== ethers.utils.id("Transfer(address,address,uint256)")) continue;

                const tokenAddress = log.address.toLowerCase();
                if (this.tradeConfig.SKIP_TOKENS.has(tokenAddress)) {
                    console.log(`[${this.CHAIN_NAME}] Skipping ignored token:`, tokenAddress);
                    continue;
                }

                const from = ethers.utils.defaultAbiCoder.decode(['address'], log.topics[1])[0].toLowerCase();
                
                // If this is a sell from watched wallet, add token to check list
                if (from === wallet.address.toLowerCase()) {
                    tokensToCheck.add(tokenAddress);
                }
            }

            // Batch check our balances for all tokens
            if (tokensToCheck.size > 0) {
                console.log(`[${this.CHAIN_NAME}] Checking balances for ${tokensToCheck.size} tokens`);
                const multicallContract = new ethers.Contract(
                    '0xcA11bde05977b3631167028862bE2a173976CA11', // Base Multicall3
                    ['function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[] returnData)'],
                    this.provider
                );

                const balanceOfAbi = ['function balanceOf(address) view returns (uint256)'];
                const balanceOfInterface = new ethers.utils.Interface(balanceOfAbi);

                const calls = Array.from(tokensToCheck).map(tokenAddress => ({
                    target: tokenAddress,
                    allowFailure: true,
                    callData: balanceOfInterface.encodeFunctionData('balanceOf', [this.traderWallet.address])
                }));

                const results = await multicallContract.aggregate3(calls);

                // Process results
                const tokens = Array.from(tokensToCheck);
                for (let i = 0; i < results.length; i++) {
                    const { success, returnData } = results[i];
                    if (success) {
                        const balance = ethers.BigNumber.from(returnData);
                        console.log(`[${this.CHAIN_NAME}] Our balance of ${tokens[i]}:`, balance.toString());
                        if (balance.gt(0)) {
                            await this.notifySell({
                                tokenAddress: tokens[i],
                                sourceWallet: wallet.label,
                                txHash: tx.hash
                            });
                        }
                    }
                }
            }

            // Look for token purchases in logs
            const purchaseEvents = receipt.logs.filter(log => {
                const isTransfer = log.topics[0] === ethers.utils.id("Transfer(address,address,uint256)");
                if (!isTransfer) return false;

                let toAddress;
                if (log.topics.length === 3) {
                    toAddress = ethers.utils.defaultAbiCoder.decode(
                        ['address'],
                        ethers.utils.hexZeroPad(log.topics[2], 32)
                    )[0].toLowerCase();
                }

                return toAddress === wallet.address.toLowerCase();
            });

            console.log(`[${this.CHAIN_NAME}] Found ${purchaseEvents.length} purchase events`);

            for (const event of purchaseEvents) {
                const tokenAddress = event.address.toLowerCase();
                
                if (this.tradeConfig.SKIP_TOKENS.has(tokenAddress)) {
                    console.log(`[${this.CHAIN_NAME}] Skipping purchase of ignored token:`, tokenAddress);
                    continue;
                }

                // Get token metadata
                const tokenContract = new ethers.Contract(
                    tokenAddress,
                    ['function symbol() view returns (string)', 'function name() view returns (string)'],
                    this.provider
                );
                
                let symbol, name;
                try {
                    [symbol, name] = await Promise.all([
                        tokenContract.symbol(),
                        tokenContract.name()
                    ]);
                    console.log(`[${this.CHAIN_NAME}] Token info:`, { name, symbol, address: tokenAddress });
                } catch (error) {
                    symbol = tokenAddress.slice(0, 6) + '...';
                    name = 'Unknown Token';
                    console.log(`[${this.CHAIN_NAME}] Failed to get token info:`, error.message);
                }

                console.log(`[${this.CHAIN_NAME}] Purchase detected by ${wallet.label}:
                    Token: ${name} (${symbol})
                    Address: ${tokenAddress}
                    Transaction: ${tx.hash}
                `);

                this.processedTxs.add(tx.hash);
                
                await this.executeCopyTrade({
                    tokenAddress,
                    symbol,
                    name,
                    sourceWallet: wallet.label
                });
            }

            // Clean up old transactions
            if (this.processedTxs.size > 1000) {
                const txsArray = Array.from(this.processedTxs);
                this.processedTxs = new Set(txsArray.slice(-1000));
            }

        } catch (error) {
            console.error(`[${this.CHAIN_NAME}] Error analyzing transaction:`, error);
            console.error('Transaction details:', {
                hash: tx.hash,
                from: tx.from,
                to: tx.to,
                error: error.message,
                stack: error.stack
            });
        }
    }

    async notifySell(sellInfo) {
        try {
            // Get token info
            const tokenContract = new ethers.Contract(
                sellInfo.tokenAddress,
                ['function symbol() view returns (string)', 'function name() view returns (string)'],
                this.provider
            );

            let symbol, name;
            try {
                [symbol, name] = await Promise.all([
                    tokenContract.symbol(),
                    tokenContract.name()
                ]);
            } catch (error) {
                symbol = sellInfo.tokenAddress.slice(0, 6) + '...';
                name = 'Unknown Token';
            }

            const message = `🔔 ${this.CHAIN_NAME} Sell Alert!\n\n` +
                `*${sellInfo.sourceWallet}* is selling *${name} (${symbol})*\n` +
                `You currently hold this token\n` +
                `[View Transaction](https://basescan.org/tx/${sellInfo.txHash})`;

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
            // Check if we already hold this token
            const tokenContract = new ethers.Contract(
                purchaseInfo.tokenAddress,
                ['function balanceOf(address) view returns (uint256)'],
                this.provider
            );

            try {
                const hasHolding = await ledger.hasHolding('base', purchaseInfo.tokenAddress);
                if (hasHolding) {
                    console.log(`[${this.CHAIN_NAME}] Already holding ${purchaseInfo.symbol}, skipping purchase`);
                    return;
                }
            } catch (error) {
                console.error(`[${this.CHAIN_NAME}] Error checking token balance:`, error);
                // Continue with trade if balance check fails
            }

            console.log(`[${this.CHAIN_NAME}] Starting copy trade for ${purchaseInfo.name} (${purchaseInfo.symbol}) - Following ${purchaseInfo.sourceWallet}`);

            if (!this.traderWallet) {
                throw new Error('Trader wallet not configured');
            }

            // Check wallet balance
            const balance = await this.provider.getBalance(this.traderWallet.address);
            const requiredBalance = ethers.utils.parseEther(this.tradeConfig.amountInETH);

            if (balance.lt(requiredBalance)) {
                const errorMsg = `Insufficient ETH balance. Required: ${this.tradeConfig.amountInETH} ETH, Available: ${ethers.utils.formatEther(balance)} ETH`;
                console.error(errorMsg);
                await this.sendTelegramMessage(`⚠️ Trade Skipped - ${errorMsg}`, true);
                return;
            }

            while (currentTry < MAX_RETRIES) {
                try {
                    currentTry++;
                    console.log(`[${this.CHAIN_NAME}] Attempt ${currentTry} of ${MAX_RETRIES}`);

                    const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

                    // 1. Get price quote with more details
                    const params = new URLSearchParams({
                        chainId: this.CHAIN_ID.toString(),
                        sellToken: ETH_ADDRESS,
                        buyToken: purchaseInfo.tokenAddress,
                        sellAmount: ethers.utils.parseEther(this.tradeConfig.amountInETH).toString(),
                        taker: this.traderWallet.address,
                        slippageBps: this.tradeConfig.slippageBps.toString(),
                        skipValidation: true,
                        enableSlippageProtection: false
                    });

                    const priceResponse = await axios.get(
                        `${this.ZERO_X_API}/swap/permit2/price?${params.toString()}`,
                        {
                            headers: {
                                '0x-api-key': this.ZERO_X_API_KEY,
                                '0x-version': 'v2',
                                'Content-Type': 'application/json'
                            }
                        }
                    );

                    console.log(`[${this.CHAIN_NAME}] Price quote response:`, {
                        price: priceResponse.data.price,
                        estimatedGas: priceResponse.data.estimatedGas,
                        liquidityAvailable: priceResponse.data.liquidityAvailable,
                        sellAmount: priceResponse.data.sellAmount,
                        buyAmount: priceResponse.data.buyAmount
                    });

                    if (!priceResponse.data.liquidityAvailable) {
                        throw new Error('Insufficient liquidity for trade');
                    }

                    // 2. Get quote with same parameters
                    const response = await axios.get(
                        `${this.ZERO_X_API}/swap/permit2/quote?${params.toString()}`,
                        {
                            headers: {
                                '0x-api-key': this.ZERO_X_API_KEY,
                                '0x-version': 'v2',
                                'Content-Type': 'application/json'
                            }
                        }
                    );

                    const quote = response.data;

                    // Prepare and send transaction with higher gas
                    const tx = {
                        to: quote.transaction.to,
                        data: quote.transaction.data,
                        value: ethers.utils.parseEther(this.tradeConfig.amountInETH),
                        gasLimit: Math.floor((quote.gas || quote.estimatedGas || 500000) * 1.5),
                        maxFeePerGas: ethers.utils.parseUnits('1', 'gwei'),
                        maxPriorityFeePerGas: ethers.utils.parseUnits('1', 'gwei')
                    };

                    console.log(`[${this.CHAIN_NAME}] Full transaction details:`, {
                        to: tx.to,
                        value: ethers.utils.formatEther(tx.value),
                        gasLimit: tx.gasLimit.toString(),
                        maxFeePerGas: ethers.utils.formatUnits(tx.maxFeePerGas, 'gwei') + ' gwei',
                        maxPriorityFeePerGas: ethers.utils.formatUnits(tx.maxPriorityFeePerGas, 'gwei') + ' gwei',
                        data: tx.data.slice(0, 66) + '...'
                    });

                    console.log(`[${this.CHAIN_NAME}] Sending swap transaction...`);
                    const txResponse = await this.traderWallet.sendTransaction(tx);
                    console.log(`[${this.CHAIN_NAME}] Transaction sent:`, txResponse.hash);

                    const receipt = await txResponse.wait();
                    
                    if (receipt.status === 0) {
                        throw new Error('Transaction failed on-chain. Check transaction for details.');
                    }

                    console.log(`[${this.CHAIN_NAME}] Transaction confirmed! Status:`, receipt.status);

                    const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);
                    
                    const successMessage = `✅ ${this.CHAIN_NAME} Copy Trade Executed!\n\n` +
                        `*Token:* ${purchaseInfo.name} (${purchaseInfo.symbol})\n` +
                        `*Following:* ${purchaseInfo.sourceWallet}\n` +
                        `*Amount:* ${this.tradeConfig.amountInETH} ETH\n` +
                        `*Transaction:* [View](https://basescan.org/tx/${receipt.hash})\n` +
                        `*Gas Used:* ${receipt.gasUsed.toString()}\n` +
                        `*Execution Time:* ${executionTime}s`;

                    await this.sendTelegramMessage(successMessage, true);

                    // Get the actual token balance after purchase
                    const tokenContract = new ethers.Contract(
                        purchaseInfo.tokenAddress,
                        ['function balanceOf(address) view returns (uint256)'],
                        this.provider
                    );
                    const balance = await tokenContract.balanceOf(this.traderWallet.address);

                    // Add to ledger on successful purchase
                    await ledger.addHolding('base', purchaseInfo.tokenAddress, balance.toString());

                    return; // Success - exit the retry loop

                } catch (error) {
                    let errorMessage = error.message;
                    
                    if (error.response?.data?.validationErrors?.[0]?.reason === 'INSUFFICIENT_ASSET_LIQUIDITY') {
                        console.log(`[${this.CHAIN_NAME}] No liquidity for token: ${purchaseInfo.symbol}`);
                        await this.sendTelegramMessage(`ℹ️ Trade Skipped - No liquidity: ${purchaseInfo.symbol}`, true);
                        return;
                    }

                    if (error.code === 'CALL_EXCEPTION') {
                        errorMessage = 'Transaction reverted on-chain. Possible reasons: insufficient liquidity, high slippage, or contract error';
                        console.error(`[${this.CHAIN_NAME}] Transaction failed:`, {
                            error: error.message,
                            transaction: error.transaction,
                            receipt: error.receipt
                        });
                    }

                    console.error(`[${this.CHAIN_NAME}] Attempt ${currentTry} failed:`, errorMessage);

                    if (currentTry === MAX_RETRIES) {
                        throw new Error(errorMessage); // Rethrow on final attempt
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
            // Escape special characters if using markdown
            let formattedMessage = message;
            if (parseMarkdown) {
                formattedMessage = message.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
            }

            const url = `https://api.telegram.org/bot${this.telegramToken}/sendMessage`;
            const response = await axios.post(url, {
                chat_id: this.telegramChatId,
                text: formattedMessage,
                parse_mode: parseMarkdown ? 'MarkdownV2' : undefined,
                disable_web_page_preview: true
            });

            if (!response.data?.ok) {
                console.error(`[${this.CHAIN_NAME}] Telegram API error:`, response.data);
            }
        } catch (error) {
            console.error(`[${this.CHAIN_NAME}] Error sending telegram message:`, {
                error: error.message,
                response: error.response?.data
            });
        }
    }

    setTraderWallet(privateKey) {
        try {
            this.traderWallet = new ethers.Wallet(privateKey).connect(this.provider);
            console.log('Trader wallet configured:', this.traderWallet.address);
        } catch (error) {
            console.error('Error setting trader wallet:', error);
            throw error;
        }
    }
}

module.exports = BaseMonitor; 