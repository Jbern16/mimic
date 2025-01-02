const SolanaMonitor = require('./monitors/solanaMonitor');
const BaseMonitor = require('./monitors/baseMonitor');
const ledger = require('./services/ledger');
const TelegramService = require('./services/telegram');

async function startMonitor(options) {
    let telegramService;

    try {
        // Initialize Redis connection
        console.log('\nConnecting to Redis...');
        try {
            // Test Redis connection by setting and getting a value
            await ledger.redis.set('test', 'connection');
            const test = await ledger.redis.get('test');
            if (test !== 'connection') {
                throw new Error('Redis connection test failed');
            }
            console.log('Redis connected successfully!');

            // Log current holdings
            console.log('\nCurrent Holdings:');
            const solanaHoldings = await ledger.getAllHoldings('solana');
            const baseHoldings = await ledger.getAllHoldings('base');
            
            console.log('\nSOLANA:');
            Object.entries(solanaHoldings || {}).forEach(([token, amount]) => {
                console.log(`  ${token}: ${amount}`);
            });

            console.log('\nBASE:');
            Object.entries(baseHoldings || {}).forEach(([token, amount]) => {
                console.log(`  ${token}: ${amount}`);
            });
        } catch (error) {
            console.error('Failed to connect to Redis:', error);
            process.exit(1);
        }

        // Configuration from CLI options
        const config = {
            // Solana config
            solanaRpc: options.solanaRpc,
            solanaWs: options.solanaWs,
            solanaTraderKey: options.solanaKey,
            solanaWallets: options.solanaWallets,
            solanaTradeAmount: options.solanaAmount,
            
            // Base config
            baseRpc: options.baseRpc,
            baseTraderKey: options.baseKey,
            baseWallets: options.baseWallets,
            baseTradeAmount: options.baseAmount,
            baseZeroXApiKey: options.base0xKey,
            
            // Common config
            telegramToken: options.telegramToken,
            telegramChatId: options.telegramChat,
            slippageBps: options.slippage,
            skipTokens: options.skipTokens
        };

        // Initialize Telegram service if configured
        if (options.telegramToken && options.telegramChat) {
            // Pass config to holdings service
            const holdings = require('./services/holdings');
            const swapService = require('./services/swapService');
            
            holdings.setConfig(config);
            swapService.setConfig(config);
            
            telegramService = new TelegramService(options.telegramToken, options.telegramChat);
            console.log('Telegram service started');
        }

        // Log configured skip tokens
        console.log('\nConfigured Skip Tokens:');
        if (config.skipTokens) {
            for (const [chain, tokens] of Object.entries(config.skipTokens)) {
                console.log(`\n${chain.toUpperCase()}:`);
                tokens.forEach(token => console.log(`  ${token}`));
            }
        }

        // Start Solana Monitor if enabled and configured
        if (options.enableSolana && config.solanaWallets) {
            const solanaWallets = config.solanaWallets;
            
            const solanaTradeConfig = {
                amountInSol: config.solanaTradeAmount,
                amountInLamports: Math.floor(config.solanaTradeAmount * 1e9),
                slippageBps: config.slippageBps,
                SKIP_TOKENS: new Set(config.skipTokens?.solana || [])
            };

            const solanaMonitor = new SolanaMonitor(
                config.solanaRpc,
                config.solanaWs,
                solanaWallets,
                config.telegramToken,
                config.telegramChatId,
                solanaTradeConfig
            );

            solanaMonitor.setTraderWallet(config.solanaTraderKey);
            await solanaMonitor.start();
            console.log('Solana Monitor started successfully!');
        }

        // Start Base Monitor if enabled and configured
        if (options.enableBase && config.baseWallets) {
            const baseWallets = config.baseWallets;
            
            const baseTradeConfig = {
                amountInETH: config.baseTradeAmount.toString(),
                slippageBps: config.slippageBps,
                SKIP_TOKENS: new Set((config.skipTokens?.base || []).map(addr => addr.toLowerCase()))
            };

            const baseMonitor = new BaseMonitor(
                config.baseRpc,
                baseWallets,
                config.telegramToken,
                config.telegramChatId,
                baseTradeConfig
            );

            baseMonitor.setTraderWallet(config.baseTraderKey);
            await baseMonitor.start();
            console.log('Base Monitor started successfully!');
        }

    } catch (error) {
        console.error('Failed to start monitors:', error);
        await ledger.close();
        if (telegramService) {
            await telegramService.stop();
        }
        process.exit(1);
    }

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\nShutting down...');
        await ledger.close();
        if (telegramService) {
            await telegramService.stop();
        }
        process.exit(0);
    });
}

module.exports = { startMonitor }; 