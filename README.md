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
- Redis server (running on localhost:6379 or configured via REDIS_URL)
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

3. Install and start Redis:
   ```bash
   # Ubuntu/Debian
   sudo apt-get install redis-server
   sudo systemctl start redis-server

   # macOS with Homebrew
   brew install redis
   brew services start redis

   # Verify Redis is running
   redis-cli ping
   # Should return "PONG"
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

To stop both the bot and Redis:
```bash
npm run stop
```

### Redis Persistence
Redis automatically persists data to disk, so your holdings will be preserved even if Redis or the bot is restarted. By default, Redis saves the dataset to disk:
- Every 60 seconds if at least 1000 keys changed
- Every 300 seconds if at least 100 keys changed
- Every 900 seconds if at least 1 key changed

You can find the Redis data files in:
- Linux: `/var/lib/redis/dump.rdb`
- macOS: `/usr/local/var/db/redis/dump.rdb`

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
- `npm run holdings:backfill` - Scan wallets and populate Redis with current holdings

### Backfilling Holdings

To populate Redis with your current token holdings:
```bash
# Backfill all chains
npm run holdings:backfill

# Backfill specific chain
npm run holdings:backfill -- -c solana
npm run holdings:backfill -- -c base
```

This is useful when:
- First setting up the bot
- After Redis data loss
- To verify/sync Redis with actual on-chain holdings

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

## Managing Skip Tokens

The bot maintains a list of tokens to ignore when copying trades. These are typically stablecoins, wrapped native tokens, or other tokens you don't want to trade.

### Commands

```bash
# Add a token to skip list
npm run skip-token:add -- -c solana -a ADDRESS -n "Description"
npm run skip-token:add -- -c base -a ADDRESS -n "Description"

# List all tokens being skipped
npm run skip-token:list

# Remove a token from skip list
npm run skip-token:remove -- -c solana -a ADDRESS
npm run skip-token:remove -- -c base -a ADDRESS
```

### Default Skip Tokens

#### Solana
- `So11111111111111111111111111111111111111112` (Native SOL)
- `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (USDC)
- `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (USDC alternate)
- `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` (USDT)
- `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263` (Bonk)
- `mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So` (mSOL)
- `DUSTawucrTsGU8hcqRdHDCbuYhCPADMLM2VcCb8VnFnQ` (DUST)

#### Base
- `0x4200000000000000000000000000000000000006` (WETH)
- `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (USDC)
- `0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb` (USDT)
- `0x0000000000000000000000000000000000000000` (Native ETH)
- `0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b` (VIRTUAL)

### Examples

```bash
# Add USDC on Solana to skip list
npm run skip-token:add -- -c solana -a EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v -n "USDC"

# Add WETH on Base to skip list
npm run skip-token:add -- -c base -a 0x4200000000000000000000000000000000000006 -n "WETH"

# View all skip tokens
npm run skip-token:list

# Remove a token from skip list
npm run skip-token:remove -- -c base -a 0x4200000000000000000000000000000000000006
```

Skip tokens are stored in `config.json` under `general.skipTokens` and can also be edited manually if needed.