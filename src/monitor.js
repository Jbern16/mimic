const SolanaMonitor = require('./monitors/solanaMonitor');
const BaseMonitor = require('./monitors/baseMonitor');

async function startMonitor(options) {
    try {
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
            slippageBps: options.slippage
        };

        // Start Solana Monitor if enabled and configured
        if (options.enableSolana && config.solanaWallets) {
            const solanaWallets = config.solanaWallets;
            
            const solanaTradeConfig = {
                amountInSol: config.solanaTradeAmount,
                amountInLamports: Math.floor(config.solanaTradeAmount * 1e9),
                slippageBps: config.slippageBps
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
                slippageBps: config.slippageBps
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
        process.exit(1);
    }
}

module.exports = { startMonitor }; 