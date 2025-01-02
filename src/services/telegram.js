const TelegramBot = require('node-telegram-bot-api');
const holdings = require('./holdings');

class TelegramService {
    constructor(token, chatId) {
        this.bot = new TelegramBot(token, { polling: true });
        this.chatId = chatId;
        this.setupCommands();
    }

    setupCommands() {
        // Holdings command
        this.bot.onText(/\/holdings/, async (msg) => {
            // Only respond to messages from configured chat
            if (msg.chat.id.toString() !== this.chatId) return;

            try {
                // Send initial message
                const loadingMsg = await this.bot.sendMessage(this.chatId, '🔄 Fetching holdings...');
                
                const message = await holdings.formatHoldingsMessage();
                
                // Edit the loading message with the results
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
}

module.exports = TelegramService; 