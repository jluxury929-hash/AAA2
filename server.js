// ═══════════════════════════════════════════════════════════════════════════════
// ETH CONVERSION BACKEND V2 - Sign + Broadcast Method
// Converts backend ETH → Treasury using signTransaction + broadcastTransaction
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = process.env.PORT || 8080;
const PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;
const TREASURY = '0x4024Fd78E2AD5532FBF3ec2B3eC83870FAe45fC7';

const RPC_URLS = [
  'https://ethereum-rpc.publicnode.com',
  'https://eth.drpc.org',
  'https://rpc.ankr.com/eth',
  'https://eth.llamarpc.com'
];

let provider = null;
let wallet = null;

async function initProvider() {
  for (const rpc of RPC_URLS) {
    try {
      provider = new ethers.JsonRpcProvider(rpc, 1, { staticNetwork: ethers.Network.from(1) });
      await provider.getBlockNumber();
      if (PRIVATE_KEY) wallet = new ethers.Wallet(PRIVATE_KEY, provider);
      console.log('✅ Connected:', rpc, '| Wallet:', wallet?.address);
      return true;
    } catch (e) { continue; }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// V2 METHOD: Sign Transaction + Broadcast (more control)
// GAS IS PAID DURING BROADCAST - you earn while gas is deducted
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/convert', async (req, res) => {
  try {
    const { amount, amountETH, to, toAddress, treasury } = req.body;
    if (!provider || !wallet) await initProvider();
    if (!wallet) return res.status(500).json({ error: 'Wallet not configured' });

    const ethAmount = parseFloat(amountETH || amount) || 0.01;
    const destination = to || toAddress || treasury || TREASURY;

    const balance = await provider.getBalance(wallet.address);
    const balanceETH = parseFloat(ethers.formatEther(balance));
    
    // Only check for minimum gas - gas deducted at broadcast time
    if (balanceETH < 0.002) {
      return res.status(400).json({ error: 'Need 0.002 ETH for gas', balance: balanceETH });
    }
    
    // Max transferable after gas reserve
    const maxTransfer = Math.min(ethAmount, balanceETH - 0.002);
    if (maxTransfer <= 0) {
      return res.status(400).json({ error: 'Insufficient after gas', balance: balanceETH });
    }

    // Get nonce and gas price
    const nonce = await provider.getTransactionCount(wallet.address, 'pending');
    const feeData = await provider.getFeeData();

    // Build transaction object
    const tx = {
      to: destination,
      value: ethers.parseEther(ethAmount.toString()),
      nonce: nonce,
      gasLimit: 21000,
      gasPrice: feeData.gasPrice,
      chainId: 1
    };

    console.log('Signing TX:', { to: destination, amount: ethAmount, nonce });

    // Sign transaction
    const signedTx = await wallet.signTransaction(tx);
    console.log('Signed TX:', signedTx.slice(0, 30) + '...');

    // Broadcast signed transaction
    const txResponse = await provider.broadcastTransaction(signedTx);
    console.log('Broadcast TX:', txResponse.hash);

    // Wait for confirmation
    const receipt = await txResponse.wait(1);
    console.log('Confirmed block:', receipt.blockNumber);

    res.json({
      success: true,
      txHash: txResponse.hash,
      hash: txResponse.hash,
      transactionHash: txResponse.hash,
      from: wallet.address,
      to: destination,
      amount: ethAmount,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString()
    });
  } catch (e) {
    console.error('Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Alias endpoints
app.post('/send-eth', (req, res) => { req.url = '/convert'; app._router.handle(req, res); });
app.post('/withdraw', (req, res) => { req.url = '/convert'; app._router.handle(req, res); });
app.post('/transfer', (req, res) => { req.url = '/convert'; app._router.handle(req, res); });
app.post('/coinbase-withdraw', (req, res) => { req.url = '/convert'; app._router.handle(req, res); });

app.get('/balance', async (req, res) => {
  try {
    if (!provider || !wallet) await initProvider();
    const bal = await provider.getBalance(wallet.address);
    res.json({ wallet: wallet.address, balance: ethers.formatEther(bal), treasury: TREASURY });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/status', async (req, res) => {
  let bal = 0;
  try { if (provider && wallet) bal = parseFloat(ethers.formatEther(await provider.getBalance(wallet.address))); } catch (e) {}
  res.json({ status: 'online', method: 'V2-SignBroadcast', wallet: wallet?.address, balance: bal.toFixed(6) });
});

app.get('/health', (req, res) => res.json({ status: 'healthy' }));

initProvider().then(() => app.listen(PORT, '0.0.0.0', () => console.log('V2 Backend on port', PORT)));

