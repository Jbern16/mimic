require('dotenv').config();
const SolanaMonitor = require('./src/monitors/solanaMonitor');
const BaseMonitor = require('./src/monitors/baseMonitor');

async function startMonitor() {
    try {
        // Configuration
        const config = {
            // Solana config
            solanaRpc: process.env.SOLANA_RPC_ENDPOINT,
            solanaWs: process.env.SOLANA_WS_ENDPOINT,
            solanaTraderKey: process.env.SOLANA_TRADER_PRIVATE_KEY,
            solanaWallets: process.env.SOLANA_WALLETS,
            solanaTradeAmount: parseFloat(process.env.SOLANA_TRADE_AMOUNT_SOL || "0.1"),
            
            // Base config
            baseRpc: process.env.BASE_RPC_ENDPOINT,
            baseTraderKey: process.env.BASE_TRADER_PRIVATE_KEY,
            baseWallets: process.env.BASE_WALLETS,
            baseTradeAmount: parseFloat(process.env.BASE_TRADE_AMOUNT_ETH || "0.1"),
            
            // Common config
            telegramToken: process.env.TELEGRAM_BOT_TOKEN,
            telegramChatId: process.env.TELEGRAM_CHAT_ID,
            slippageBps: parseInt(process.env.SLIPPAGE_BPS || "100")
        };

        // Start Solana Monitor
        if (config.solanaWallets) {
            const solanaWallets = config.solanaWallets.split(',').map(address => ({ address }));
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

        // Start Base Monitor
        if (config.baseWallets) {
            const baseWallets = config.baseWallets.split(',').map(address => ({ address }));
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

startMonitor().catch(console.error);