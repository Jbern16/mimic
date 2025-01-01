const ethers = require('ethers');
const axios = require('axios');

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
        
        // Common tokens to ignore
        this.SKIP_TOKENS = new Set([
            '0x4200000000000000000000000000000000000006'.toLowerCase(), // WETH
            '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase(), // USDC
            '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb'.toLowerCase(), // USDT
            '0x0000000000000000000000000000000000000000'.toLowerCase(), // Native ETH
        ]);
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
            const receipt = await this.provider.getTransactionReceipt(tx.hash);
            if (!receipt) return;

            console.log(`[${this.CHAIN_NAME}] Analyzing transaction:`, {
                hash: tx.hash,
                from: tx.from,
                to: tx.to,
                logs: receipt.logs.length
            });

            // Look for token purchases in logs
            const purchaseEvents = receipt.logs.filter(log => {
                // Check if this is a Transfer event
                const isTransfer = log.topics[0] === ethers.utils.id("Transfer(address,address,uint256)");
                if (!isTransfer) return false;

                // Get the recipient address from the topics
                let toAddress;
                if (log.topics.length === 3) {
                    // For indexed parameters, the address is in the topic
                    toAddress = ethers.utils.defaultAbiCoder.decode(
                        ['address'],
                        ethers.utils.hexZeroPad(log.topics[2], 32)
                    )[0].toLowerCase();
                }

                // Check if this is a transfer to our watched wallet
                return toAddress === wallet.address.toLowerCase();
            });

            if (purchaseEvents.length > 0) {
                console.log(`[${this.CHAIN_NAME}] Found ${purchaseEvents.length} relevant transfer events`);
            }

            for (const event of purchaseEvents) {
                const tokenAddress = event.address.toLowerCase();
                
                // Skip if token is in the skip list
                if (this.SKIP_TOKENS.has(tokenAddress)) {
                    console.log(`[${this.CHAIN_NAME}] Skipping ${tokenAddress} transaction (common token)`);
                    continue;
                }

                console.log(`[${this.CHAIN_NAME}] Purchase detected from ${wallet.label}:
                    Token: ${tokenAddress}
                    Transaction: ${tx.hash}
                    LogIndex: ${event.logIndex}
                    Data: ${event.data}
                `);

                this.processedTxs.add(tx.hash);
                
                await this.executeCopyTrade({
                    tokenAddress,
                    symbol: tokenAddress.slice(0, 6) + '...'
                });
            }

            // Clean up old transactions
            if (this.processedTxs.size > 1000) {
                const txsArray = Array.from(this.processedTxs);
                this.processedTxs = new Set(txsArray.slice(-1000));
            }

        } catch (error) {
            console.error(`[${this.CHAIN_NAME}] Error analyzing transaction for ${wallet.label}:`, error);
        }
    }

    async executeCopyTrade(purchaseInfo) {
        try {
            const startTime = Date.now();
            console.log(`[${this.CHAIN_NAME}] Starting copy trade:`, {
                token: purchaseInfo.tokenAddress,
                symbol: purchaseInfo.symbol,
                amount: this.tradeConfig.amountInETH,
                slippage: this.tradeConfig.slippageBps
            });

            if (!this.traderWallet) {
                throw new Error('Trader wallet not configured');
            }

            // Check wallet balance
            const balance = await this.provider.getBalance(this.traderWallet.address);
            const requiredBalance = ethers.utils.parseEther(this.tradeConfig.amountInETH);

            console.log(`[${this.CHAIN_NAME}] Balance check:`, {
                balance: ethers.utils.formatEther(balance),
                required: this.tradeConfig.amountInETH,
                balanceWei: balance.toString(),
                requiredWei: requiredBalance.toString()
            });

            if (balance.lt(requiredBalance)) {
                const errorMsg = `Insufficient ETH balance. Required: ${this.tradeConfig.amountInETH} ETH, Available: ${ethers.utils.formatEther(balance)} ETH`;
                console.error(errorMsg);
                await this.sendTelegramMessage(`⚠️ Trade Skipped - ${errorMsg}`, true);
                return;
            }

            try {
                const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

                // 1. Get price quote
                const params = new URLSearchParams({
                    chainId: this.CHAIN_ID.toString(),
                    sellToken: ETH_ADDRESS,
                    buyToken: purchaseInfo.tokenAddress,
                    sellAmount: ethers.utils.parseEther(this.tradeConfig.amountInETH).toString(),
                    taker: this.traderWallet.address,
                    slippageBps: this.tradeConfig.slippageBps.toString()
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

                console.log(`[${this.CHAIN_NAME}] Price response:`, priceResponse.data);

                if (!priceResponse.data.liquidityAvailable) {
                    throw new Error('Insufficient liquidity for trade');
                }

                // 2. Get quote using same parameters
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

                // 3. Get transaction details from quote
                if (!quote.transaction?.to || !quote.transaction?.data) {
                    throw new Error(`Invalid quote response: missing transaction details. Response: ${JSON.stringify(quote, null, 2)}`);
                }

                console.log(`[${this.CHAIN_NAME}] Quote response:`, {
                    to: quote.transaction.to,
                    data: quote.transaction.data ? 'Present' : 'Missing',
                    value: quote.value,
                    gas: quote.gas,
                    estimatedGas: quote.estimatedGas,
                    buyAmount: quote.buyAmount,
                    sellAmount: quote.sellAmount
                });

                // Handle permit2 signature if needed
                if (quote.permit2?.eip712) {
                    const signature = await this.traderWallet.signTypedData(
                        quote.permit2.eip712.domain,
                        quote.permit2.eip712.types,
                        quote.permit2.eip712.message
                    );

                    // Append signature to transaction data
                    const sigLengthHex = ethers.utils.hexZeroPad(
                        ethers.utils.hexlify(signature.length),
                        32
                    );
                    quote.transaction.data = ethers.utils.hexConcat([
                        quote.transaction.data,
                        sigLengthHex,
                        signature
                    ]);
                }

                // Prepare and send transaction
                const tx = {
                    to: quote.transaction.to,
                    data: quote.transaction.data,
                    value: ethers.utils.parseEther(this.tradeConfig.amountInETH),
                    gasLimit: Math.floor((quote.gas || quote.estimatedGas || 300000) * 1.1),
                    maxFeePerGas: ethers.utils.parseUnits('0.5', 'gwei'),
                    maxPriorityFeePerGas: ethers.utils.parseUnits('0.5', 'gwei')
                };

                // Validate transaction parameters
                console.log(`[${this.CHAIN_NAME}] Transaction validation:`, {
                    hasTo: !!tx.to,
                    hasData: !!tx.data,
                    value: ethers.utils.formatEther(tx.value),
                    rawValue: tx.value.toString(),
                    gasLimit: tx.gasLimit.toString()
                });

                if (!tx.to || !tx.data) {
                    throw new Error('Invalid quote response: missing to or data field');
                }

                console.log(`[${this.CHAIN_NAME}] Transaction details:`, {
                    to: tx.to,
                    value: ethers.utils.formatEther(tx.value),
                    gasLimit: tx.gasLimit.toString(),
                    maxFeePerGas: tx.maxFeePerGas.toString(),
                    maxPriorityFeePerGas: tx.maxPriorityFeePerGas.toString()
                });

                console.log(`[${this.CHAIN_NAME}] Sending swap transaction...`);
                const txResponse = await this.traderWallet.sendTransaction(tx);
                console.log(`[${this.CHAIN_NAME}] Transaction sent:`, txResponse.hash);

                const receipt = await txResponse.wait();
                console.log(`[${this.CHAIN_NAME}] Transaction confirmed!`);

                const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);
                
                const successMessage = `✅ ${this.CHAIN_NAME} Copy Trade Executed!\n\n` +
                    `*Token:* ${purchaseInfo.symbol}\n` +
                    `*Amount:* ${this.tradeConfig.amountInETH} ETH\n` +
                    `*Price:* ${quote.price}\n` +
                    `*Transaction:* [View](https://basescan.org/tx/${receipt.hash})\n` +
                    `*Gas Used:* ${receipt.gasUsed.toString()}\n` +
                    `*Execution Time:* ${executionTime}s`;

                await this.sendTelegramMessage(successMessage, true);

            } catch (error) {
                if (error.response?.data?.validationErrors?.[0]?.reason === 'INSUFFICIENT_ASSET_LIQUIDITY') {
                    console.log(`[${this.CHAIN_NAME}] No liquidity for token: ${purchaseInfo.symbol}`);
                    await this.sendTelegramMessage(`ℹ️ Trade Skipped - No liquidity: ${purchaseInfo.symbol}`, true);
                    return;
                }
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
            this.traderWallet = new ethers.Wallet(privateKey).connect(this.provider);
            console.log('Trader wallet configured:', this.traderWallet.address);
        } catch (error) {
            console.error('Error setting trader wallet:', error);
            throw error;
        }
    }
}

module.exports = BaseMonitor; 