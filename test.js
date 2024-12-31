const { Connection, PublicKey } = require('@solana/web3.js');

async function testConnection() {
  console.log(process.env.RPC_ENDPOINT)
    const connection = new Connection(process.env.RPC_ENDPOINT, 'confirmed');
    const blockHeight = await connection.getBlockHeight();
    console.log('Current block height:', blockHeight);
}

testConnection().catch(console.error);
