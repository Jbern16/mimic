const { Command } = require('commander');
const { version } = require('../package.json');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { setupConfig, addWallet } = require('./utils/setup');
const { startMonitor } = require('./monitor');
const { backfillHoldings } = require('./utils/backfill');
const inquirer = require('inquirer');

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

    program
        .command('skip-token')
        .description('Manage tokens to skip/ignore when copying trades')
        .addCommand(
            program
                .command('add')
                .description('Add a token to the skip list')
                .option('-c, --chain <chain>', 'Chain (solana/base)')
                .option('-a, --address <address>', 'Token address')
                .option('-n, --name <name>', 'Token name/description')
                .action(async (options) => {
                    try {
                        const configPath = path.join(process.cwd(), 'config.json');
                        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                        
                        if (!options.chain || !options.address) {
                            const answers = await inquirer.prompt([
                                {
                                    type: 'list',
                                    name: 'chain',
                                    message: 'Select chain:',
                                    choices: ['solana', 'base'],
                                    when: !options.chain
                                },
                                {
                                    type: 'input',
                                    name: 'address',
                                    message: 'Enter token address to skip:',
                                    when: !options.address
                                },
                                {
                                    type: 'input',
                                    name: 'name',
                                    message: 'Enter token description (optional):',
                                    when: !options.name
                                }
                            ]);
                            
                            options = { ...options, ...answers };
                        }
                        
                        const chain = options.chain.toLowerCase();
                        const address = chain === 'base' ? options.address.toLowerCase() : options.address;
                        const comment = options.name ? ` // ${options.name}` : '';
                        
                        if (!config.general.skipTokens[chain]) {
                            config.general.skipTokens[chain] = [];
                        }
                        
                        if (!config.general.skipTokens[chain].includes(address)) {
                            config.general.skipTokens[chain].push(address + comment);
                            fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
                            console.log(`Added ${address} to ${chain} skip tokens list`);
                        } else {
                            console.log(`Token ${address} already in skip list`);
                        }
                    } catch (error) {
                        console.error('Error adding skip token:', error);
                    }
                })
        )
        .addCommand(
            program
                .command('list')
                .description('List all tokens being skipped')
                .action(() => {
                    try {
                        const configPath = path.join(process.cwd(), 'config.json');
                        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                        
                        console.log('\nTokens Being Skipped:');
                        for (const [chain, tokens] of Object.entries(config.general.skipTokens)) {
                            console.log(`\n${chain.toUpperCase()}:`);
                            tokens.forEach(token => console.log(`  ${token}`));
                        }
                    } catch (error) {
                        console.error('Error listing skip tokens:', error);
                    }
                })
        )
        .addCommand(
            program
                .command('remove')
                .description('Remove a token from skip list')
                .option('-c, --chain <chain>', 'Chain (solana/base)')
                .option('-a, --address <address>', 'Token address')
                .action(async (options) => {
                    try {
                        const configPath = path.join(process.cwd(), 'config.json');
                        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                        
                        if (!options.chain || !options.address) {
                            const answers = await inquirer.prompt([
                                {
                                    type: 'list',
                                    name: 'chain',
                                    message: 'Select chain:',
                                    choices: ['solana', 'base'],
                                    when: !options.chain
                                },
                                {
                                    type: 'input',
                                    name: 'address',
                                    message: 'Enter token address to remove from skip list:',
                                    when: !options.address
                                }
                            ]);
                            
                            options = { ...options, ...answers };
                        }
                        
                        const chain = options.chain.toLowerCase();
                        const address = chain === 'base' ? options.address.toLowerCase() : options.address;
                        
                        if (config.general.skipTokens[chain]) {
                            const index = config.general.skipTokens[chain].findIndex(t => t.split(' ')[0] === address);
                            if (index !== -1) {
                                config.general.skipTokens[chain].splice(index, 1);
                                fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
                                console.log(`Removed ${address} from ${chain} skip tokens list`);
                            } else {
                                console.log(`Token ${address} not found in skip list`);
                            }
                        }
                    } catch (error) {
                        console.error('Error removing skip token:', error);
                    }
                })
        )
        .addCommand(
            program
                .command('holdings')
                .description('Holdings management commands')
                .addCommand(
                    program
                        .command('backfill')
                        .description('Scan wallets and populate Redis with current holdings')
                        .option('-c, --chain <chain>', 'Chain to backfill (solana/base/all)', 'all')
                        .action(async (options) => {
                            try {
                                const configPath = path.join(process.cwd(), 'config.json');
                                const config = await loadConfig(configPath);
                                await backfillHoldings(config, options.chain);
                            } catch (error) {
                                console.error('Error backfilling holdings:', error);
                                process.exit(1);
                            }
                        })
                )
                );
        

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
        debug: config.general?.debug,
        skipTokens: config.general?.skipTokens
    };
}

module.exports = { createCLI, parseConfig }; 