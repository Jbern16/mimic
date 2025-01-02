# Copy Trade Bot

A configurable bot that monitors and copies trades from specified wallets on Solana and Base chains.

## Features

- Multi-chain support (Solana and Base)
- Configurable trade parameters (amount, slippage)
- Telegram notifications
- Interactive setup process
- Wallet management through CLI
- Automatic retry mechanism for failed trades
- Duplicate trade prevention
- Position tracking (avoids buying tokens you already hold)

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Solana RPC endpoint (e.g., from Helius)
- Base RPC endpoint (e.g., from QuickNode)
- 0x API key (for Base chain)
- Telegram bot token and chat ID

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd copy-trade-bot
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Configuration

The bot uses a combination of config.json and environment variables for configuration:

### Environment Variables Setup

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Edit `.env` and add your sensitive data:
```plaintext
SOLANA_TRADER_KEY=your_solana_private_key_here
BASE_TRADER_KEY=your_base_private_key_here
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
TELEGRAM_CHAT_ID=your_telegram_chat_id_here
```

⚠️ IMPORTANT: Never commit your `.env` file to git. It's already in `.gitignore`.

### Interactive Setup

Run the setup wizard:
```bash
node index.js setup
```

This will guide you through configuring both the environment variables and config file:
- Chain selection (Solana/Base)
- RPC endpoints
- Trader wallet private keys (stored in .env)
- Trade amounts
- Telegram settings (stored in .env)
- Slippage tolerance

### Manual Configuration

Create `config.json` in the root directory for non-sensitive settings:

```json
{
  "solana": {
    "enabled": true,
    "rpc": "https://rpc.mainnet",
    "ws": "wss://rpc.mainnet",
    "tradeAmount": 0.1,
    "wallets": []
  },
  "base": {
    "enabled": true,
    "rpc": "your-base-rpc-endpoint",
    "tradeAmount": 0.05,
    "zeroXApiKey": "your-0x-api-key",
    "wallets": []
  },
  "general": {
    "slippageBps": 300,
    "debug": false
  }
}
```

The bot will automatically merge the configuration from both sources when running.

## Adding Wallets to Monitor

Add wallets through the CLI:

```bash
node index.js wallet add
```

This will prompt you for the chain, label, and address of the wallet to add.

## Usage

Start the bot:

```bash
npm start
```

The bot will:
1. Load configuration
2. Connect to specified RPCs
3. Start monitoring configured wallets
4. Execute copy trades when purchases are detected
5. Send notifications via Telegram

## Command Reference

- `npm run setup` - Run interactive setup
- `npm start` - Start the bot
- `npm run wallet:add` - Add a wallet to monitor

## Security Considerations

- Never share your private keys
- Keep your `.env` file secure and never commit it to git
- Don't store private keys or tokens in `config.json`
- Use secure RPC endpoints
- Monitor your slippage settings
- Test with small amounts first

## Error Handling

The bot includes:
- Automatic retry for failed trades (up to 3 attempts)
- Balance checks before trading
- Duplicate transaction prevention
- Position tracking to avoid multiple buys
- Comprehensive error logging

## Telegram Notifications

The bot sends notifications for:
- Successful trades
- Failed trades with error details
- Skipped trades (already holding token)
- Insufficient balance warnings
- Watched wallet purchases (even when trade is skipped)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License