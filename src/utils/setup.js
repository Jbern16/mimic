const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');

const questions = [
    // Solana Section
    {
        type: 'confirm',
        name: 'enableSolana',
        message: 'Enable Solana monitoring?',
        default: true
    },
    {
        type: 'input',
        name: 'solanaRpc',
        message: 'Enter Solana RPC endpoint:',
        when: (answers) => answers.enableSolana
    },
    {
        type: 'input',
        name: 'solanaWs',
        message: 'Enter Solana WebSocket endpoint:',
        when: (answers) => answers.enableSolana
    },
    {
        type: 'number',
        name: 'solanaTradeAmount',
        message: 'Enter SOL amount per trade:',
        default: 0.1,
        when: (answers) => answers.enableSolana
    },

    // Base Section
    {
        type: 'confirm',
        name: 'enableBase',
        message: 'Enable Base chain monitoring?',
        default: true
    },
    {
        type: 'input',
        name: 'baseRpc',
        message: 'Enter Base RPC endpoint:',
        when: (answers) => answers.enableBase
    },
    {
        type: 'input',
        name: 'baseZeroXApiKey',
        message: 'Enter 0x API key:',
        when: (answers) => answers.enableBase
    },
    {
        type: 'number',
        name: 'baseTradeAmount',
        message: 'Enter ETH amount per trade:',
        default: 0.01,
        when: (answers) => answers.enableBase
    },

    // Private Keys Section
    {
        type: 'password',
        name: 'solanaTraderKey',
        message: 'Enter Solana trader private key:',
        when: (answers) => answers.enableSolana
    },
    {
        type: 'password',
        name: 'baseTraderKey',
        message: 'Enter Base trader private key:',
        when: (answers) => answers.enableBase
    },

    // Telegram Section
    {
        type: 'input',
        name: 'telegramToken',
        message: 'Enter Telegram bot token:'
    },
    {
        type: 'input',
        name: 'telegramChatId',
        message: 'Enter Telegram chat ID:'
    },

    // General Section
    {
        type: 'number',
        name: 'slippageBps',
        message: 'Enter slippage in basis points:',
        default: 300
    },

    // Redis Configuration
    {
        type: 'input',
        name: 'redisUrl',
        message: 'Enter Redis URL (default: redis://localhost:6379):',
        default: 'redis://localhost:6379'
    }
];

async function setupConfig() {
    console.log('Welcome to Copy Trade Bot Setup!');
    console.log('Please answer the following questions to configure your bot.\n');

    const answers = await inquirer.prompt(questions);

    // Separate sensitive data for .env
    const envData = [
        `SOLANA_TRADER_KEY=${answers.solanaTraderKey || ''}`,
        `BASE_TRADER_KEY=${answers.baseTraderKey || ''}`,
        `TELEGRAM_BOT_TOKEN=${answers.telegramToken}`,
        `TELEGRAM_CHAT_ID=${answers.telegramChatId}`
    ].join('\n');

    // Write .env file
    const envPath = path.join(process.cwd(), '.env');
    fs.writeFileSync(envPath, envData);

    // Restructure answers into config format without sensitive data
    const config = {
        solana: {
            enabled: answers.enableSolana,
            rpc: answers.solanaRpc,
            ws: answers.solanaWs,
            tradeAmount: answers.solanaTradeAmount,
            wallets: []
        },
        base: {
            enabled: answers.enableBase,
            rpc: answers.baseRpc,
            tradeAmount: answers.baseTradeAmount,
            zeroXApiKey: answers.baseZeroXApiKey,
            wallets: []
        },
        general: {
            slippageBps: answers.slippageBps,
            debug: false,
            skipTokens: {
                solana: [
                    'So11111111111111111111111111111111111111112', // Native SOL
                    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
                    '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // USDC (alternate)
                    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
                    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // Bonk
                    'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
                    'DUSTawucrTsGU8hcqRdHDCbuYhCPADMLM2VcCb8VnFnQ'  // DUST
                ],
                base: [
                    '0x4200000000000000000000000000000000000006', // WETH
                    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
                    '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', // USDT
                    '0x0000000000000000000000000000000000000000', // Native ETH
                    '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b'  // VIRTUAL
                ]
            }
        }
    };

    // Write config file
    const configPath = path.join(process.cwd(), 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4));

    console.log('\nConfiguration saved to config.json');
    console.log('Sensitive data saved to .env');
    console.log('Use "copy-trade-bot wallet add" to add watched wallets');
}

async function addWallet() {
    const configPath = path.join(process.cwd(), 'config.json');
    if (!fs.existsSync(configPath)) {
        console.error('Config file not found. Run setup first.');
        process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    const chainQuestion = {
        type: 'list',
        name: 'chain',
        message: 'Select chain:',
        choices: [
            { name: 'Solana', value: 'solana', disabled: !config.solana.enabled },
            { name: 'Base', value: 'base', disabled: !config.base.enabled }
        ].filter(choice => !choice.disabled)
    };

    const walletQuestions = [
        {
            type: 'input',
            name: 'label',
            message: 'Enter wallet label:'
        },
        {
            type: 'input',
            name: 'address',
            message: 'Enter wallet address:'
        }
    ];

    const { chain } = await inquirer.prompt(chainQuestion);
    const wallet = await inquirer.prompt(walletQuestions);

    config[chain].wallets.push(wallet);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4));

    console.log(`Added ${wallet.label} (${wallet.address}) to ${chain} wallets`);
}

module.exports = { setupConfig, addWallet }; 