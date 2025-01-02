const { ethers } = require('ethers');
const axios = require('axios');

class SwapService {
    constructor() {
        this.CHAIN_ID = 8453;
        this.ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
    }

    setConfig(config) {
        this.config = config;
    }

    async executeSwap(sellToken, buyToken, slippageBps = '300') {
        try {
            if (buyToken !== this.ETH_ADDRESS) {
                throw new Error('Can only swap tokens for ETH');
            }

            const provider = new ethers.providers.JsonRpcProvider(
                this.config.baseRpc.replace('wss://', 'https://').replace('ws://', 'http://'),
                {
                    name: 'base',
                    chainId: 8453
                }
            );
            const wallet = new ethers.Wallet(this.config.baseTraderKey, provider);

            // Get token balance
            const tokenContract = new ethers.Contract(
                sellToken,
                ['function balanceOf(address) view returns (uint256)', 'function symbol() view returns (string)'],
                provider
            );
            const balance = await tokenContract.balanceOf(wallet.address);
            const symbol = await tokenContract.symbol();
            
            console.log(`Token (${symbol}) balance:`, balance.toString());
            console.log(`Selling entire balance of ${symbol}`);

            if (balance.isZero()) {
                throw new Error('Token balance is zero');
            }

            // Get quote
            const params = new URLSearchParams({
                chainId: this.CHAIN_ID.toString(),
                sellToken: sellToken,
                buyToken: this.ETH_ADDRESS,
                sellAmount: balance.toString(),
                taker: wallet.address,
                slippageBps: slippageBps,
                skipValidation: true,
                enableSlippageProtection: false,
                sellEntireBalance: true
            });

            // Check if we need approval first
            const priceResponse = await axios.get(
                `https://api.0x.org/swap/permit2/price?${params.toString()}`,
                {
                    headers: {
                        '0x-api-key': this.config.baseZeroXApiKey,
                        '0x-version': 'v2',
                        'Content-Type': 'application/json'
                    }
                }
            );

            // Handle approval if needed
            if (priceResponse.data.issues?.allowance) {
                const tokenContract = new ethers.Contract(
                    sellToken,
                    ['function approve(address,uint256)'],
                    wallet
                );
                const tx = await tokenContract.approve(
                    priceResponse.data.issues.allowance.spender,
                    ethers.constants.MaxUint256
                );
                await tx.wait();
                console.log('Approved token for trading');
            }

            // Get final quote
            const quoteResponse = await axios.get(
                `https://api.0x.org/swap/permit2/quote?${params.toString()}`,
                {
                    headers: {
                        '0x-api-key': this.config.baseZeroXApiKey,
                        '0x-version': 'v2',
                        'Content-Type': 'application/json'
                    }
                }
            );

            const quote = quoteResponse.data;
            console.log('Quote details:', quote);

            // Handle permit2 signature if needed
            if (quote.permit2?.eip712) {
                try {
                    const signature = await wallet._signTypedData(
                        quote.permit2.eip712.domain,
                        { 
                            PermitTransferFrom: quote.permit2.eip712.types.PermitTransferFrom,
                            TokenPermissions: quote.permit2.eip712.types.TokenPermissions
                        },
                        quote.permit2.eip712.message
                    );
                    console.log("Signed permit2 message");

                    // Append signature to transaction data
                    const signatureLengthInHex = ethers.utils.hexZeroPad(
                        ethers.utils.hexlify(ethers.utils.arrayify(signature).length),
                        32
                    );
                    quote.transaction.data = ethers.utils.hexConcat([
                        quote.transaction.data,
                        signatureLengthInHex,
                        signature
                    ]);
                } catch (error) {
                    console.error("Error signing permit2:", error);
                    console.error("EIP712 data:", JSON.stringify(quote.permit2.eip712, null, 2));
                    throw error;
                }
            }

            // Execute the swap
            const tx = {
                to: quote.transaction.to,
                data: quote.transaction.data,
                value: BigInt(quote.transaction.value || 0),
                gasLimit: Math.floor((quote.transaction.gas || 500000) * 1.5),
                maxFeePerGas: await provider.getGasPrice(),  // Use current gas price
                maxPriorityFeePerGas: await provider.getGasPrice()  // Use current gas price
            };

            console.log('Transaction details:', {
                to: tx.to,
                value: ethers.utils.formatEther(tx.value),
                gasLimit: tx.gasLimit.toString(),
                maxFeePerGas: ethers.utils.formatUnits(tx.maxFeePerGas, 'gwei'),
                maxPriorityFeePerGas: ethers.utils.formatUnits(tx.maxPriorityFeePerGas, 'gwei'),
                dataLength: tx.data.length
            });

            const txResponse = await wallet.sendTransaction(tx);
            console.log('Transaction sent:', txResponse.hash);
            
            // Wait for transaction confirmation
            const receipt = await txResponse.wait();
            console.log('Transaction confirmed:', receipt.hash);

            if (receipt.status === 0) {
                throw new Error('Transaction failed on-chain');
            }

            // Format success message only after successful confirmation
            const successMsg = `✅ Sold ${symbol} for ETH\n` +
                             `Transaction: \`${receipt.hash.slice(0, 12)}...\``;

            return {
                success: true,
                txHash: receipt.hash,
                buyAmount: quote.buyAmount,
                sellAmount: quote.sellAmount,
                message: successMsg
            };

        } catch (error) {
            console.error('Swap execution error:', error);
            // Truncate error message if needed
            const errorMsg = error.message.length > 100 ? 
                error.message.slice(0, 97) + '...' : 
                error.message;

            return {
                success: false,
                error: errorMsg
            };
        }
    }
}

module.exports = new SwapService(); 