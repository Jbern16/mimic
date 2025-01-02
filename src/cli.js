const { Command } = require('commander');
const { version } = require('../package.json');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { setupConfig, addWallet } = require('./utils/setup');
const { startMonitor } = require('./monitor');

async function loadConfig(path) {
    try {
        const configFile = fs.readFileSync(path, 'utf8');
        const config = JSON.parse(configFile);

        // Merge environment variables with config
        return {
            solana: {
                ...config.solana,
                traderKey: process.env.SOLANA_TRADER_KEY
            },
            base: {
                ...config.base,
                traderKey: process.env.BASE_TRADER_KEY
            },
            telegram: {
                botToken: process.env.TELEGRAM_BOT_TOKEN,
                chatId: process.env.TELEGRAM_CHAT_ID
            },
            general: config.general
        };
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('No config file found. Starting setup...\n');
            await setupConfig();
            // Try loading the config again after setup
            return loadConfig(path);
        }
        console.error('Error loading config file:', error.message);
        process.exit(1);
    }
}

function createCLI() {
    const program = new Command();

    program
        .name('copy-trade-bot')
        .description('A bot that copies trades from watched wallets on Solana and Base chains')
        .version(version);

    program
        .command('start')
        .description('Start the copy trade bot')
        .option('-c, --config <path>', 'Path to config file', 'config.json')
        .action(async (options) => {
            const configOptions = await parseConfig(options.config);
            startMonitor(configOptions);
        });

    program
        .command('setup')
        .description('Setup bot configuration')
        .action(setupConfig);

    program
        .command('wallet')
        .description('Wallet management commands')
        .command('add')
        .description('Add a new wallet to watch')
        .action(addWallet);

    program.parse(process.argv);
    return program;
}

async function parseConfig(configPath) {
    const config = await loadConfig(configPath);
    
    // Convert config format to CLI options format
    return {
        // Solana options
        enableSolana: config.solana?.enabled,
        solanaRpc: config.solana?.rpc,
        solanaWs: config.solana?.ws,
        solanaKey: config.solana?.traderKey,
        solanaAmount: config.solana?.tradeAmount,
        solanaWallets: config.solana?.wallets,

        // Base options
        enableBase: config.base?.enabled,
        baseRpc: config.base?.rpc,
        baseKey: config.base?.traderKey,
        baseAmount: config.base?.tradeAmount,
        base0xKey: config.base?.zeroXApiKey,
        baseWallets: config.base?.wallets,

        // Common options
        telegramToken: config.telegram?.botToken,
        telegramChat: config.telegram?.chatId,
        slippage: config.general?.slippageBps,
        debug: config.general?.debug
    };
}

module.exports = { createCLI, parseConfig }; 