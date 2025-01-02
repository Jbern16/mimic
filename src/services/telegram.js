const TelegramBot = require('node-telegram-bot-api');
const holdings = require('./holdings');
const swapService = require('./swapService');

class TelegramService {
    constructor(token, chatId) {
        this.bot = new TelegramBot(token, { polling: true });
        this.chatId = chatId;
        this.setupCommands();
    }

    setupCommands() {
        // Holdings command
        this.bot.onText(/\/holdings/, async (msg) => {
            if (msg.chat.id.toString() !== this.chatId) return;

            try {
                const loadingMsg = await this.bot.sendMessage(this.chatId, '🔄 Fetching holdings...');
                
                const message = await holdings.formatHoldingsMessage();
                
                await this.bot.editMessageText(message, {
                    chat_id: this.chatId,
                    message_id: loadingMsg.message_id,
                    parse_mode: 'MarkdownV2',
                    disable_web_page_preview: true
                });
            } catch (error) {
                console.error('Error handling /holdings command:', error);
                await this.bot.sendMessage(this.chatId, '❌ Error retrieving holdings');
            }
        });

        // Sell All command
        this.bot.onText(/\/sellAll (.+)/, async (msg, match) => {
            if (msg.chat.id.toString() !== this.chatId) return;

            try {
                const symbol = match[1].toUpperCase();
                const loadingMsg = await this.bot.sendMessage(this.chatId, `🔄 Selling all ${symbol} for ETH...`);

                // Find token address from symbol
                const tokenAddress = await holdings.getTokenAddressFromSymbol(symbol);
                if (!tokenAddress) {
                    throw new Error(`Token ${symbol} not found in holdings`);
                }

                const result = await swapService.executeSwap(
                    tokenAddress,
                    swapService.ETH_ADDRESS
                );

                if (result.success) {
                    const message = `✅ Successfully sold ${symbol} for ETH\n` +
                        `Transaction: \`${result.txHash}\``;

                    await this.bot.editMessageText(message, {
                        chat_id: this.chatId,
                        message_id: loadingMsg.message_id,
                        parse_mode: 'MarkdownV2'
                    });
                } else {
                    throw new Error(result.error);
                }
            } catch (error) {
                console.error('Error handling /sellAll command:', error);
                await this.bot.sendMessage(this.chatId, `❌ Error selling token: ${error.message}`);
            }
        });

        // Log when bot is ready
        this.bot.on('polling_error', (error) => {
            console.error('Telegram polling error:', error);
        });
    }

    async stop() {
        if (this.bot) {
            await this.bot.stopPolling();
        }
    }

    async sendTelegramMessage(message, markdown = false) {
        try {
            // Truncate message if too long (Telegram limit is 4096 characters)
            if (message.length > 4000) {
                message = message.slice(0, 3997) + '...';
            }

            await this.bot.sendMessage(this.chatId, message, {
                parse_mode: markdown ? 'MarkdownV2' : undefined,
                disable_web_page_preview: true
            });
        } catch (error) {
            console.error('Error sending telegram message:', error);
        }
    }
}

module.exports = TelegramService; 