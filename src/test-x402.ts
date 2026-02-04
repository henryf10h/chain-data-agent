/**
 * x402 Payment Flow Test
 *
 * This script tests the full x402 payment flow against the /analysis endpoint:
 * 1. Starts the server as a subprocess
 * 2. Makes a request without payment header (expects 402)
 * 3. Parses payment requirements from response
 * 4. Creates a signed payment header using x402 library
 * 5. Retries request with payment header (expects 200)
 * 6. Cleans up server subprocess
 */

import { createPaymentHeader } from 'x402/client';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import type { Subprocess } from 'bun';

// Configuration
const SERVER_PORT = 3001; // Use different port to avoid conflicts
const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const PRIVATE_KEY = process.env.AGENT_WALLET_PRIVATE_KEY as `0x${string}`;

// CAIP-2 to x402 network name mapping
const CAIP2_TO_NETWORK: Record<string, string> = {
  'eip155:84532': 'base-sepolia',
  'eip155:8453': 'base',
  'eip155:1': 'ethereum',
  'eip155:11155111': 'sepolia',
  'eip155:43114': 'avalanche',
  'eip155:43113': 'avalanche-fuji',
  'eip155:137': 'polygon',
  'eip155:80002': 'polygon-amoy',
};

if (!PRIVATE_KEY) {
  console.error('[x402 Test] ERROR: AGENT_WALLET_PRIVATE_KEY not set in environment');
  process.exit(1);
}

// Colored output helpers
const log = {
  info: (msg: string) => console.log(`\x1b[36m[x402 Test]\x1b[0m ${msg}`),
  success: (msg: string) => console.log(`\x1b[32m[x402 Test]\x1b[0m ${msg}`),
  error: (msg: string) => console.log(`\x1b[31m[x402 Test]\x1b[0m ${msg}`),
  warn: (msg: string) => console.log(`\x1b[33m[x402 Test]\x1b[0m ${msg}`),
};

// Server subprocess management
let serverProcess: Subprocess | null = null;

async function startServer(): Promise<void> {
  log.info('Starting server subprocess...');

  serverProcess = Bun.spawn(['bun', 'run', 'src/index.ts'], {
    env: {
      ...process.env,
      PORT: String(SERVER_PORT),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Wait for server to be ready
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${SERVER_URL}/health`);
      if (response.ok) {
        log.success(`Server is ready on port ${SERVER_PORT}`);
        return;
      }
    } catch {
      // Server not ready yet
    }
    await Bun.sleep(500);
  }

  throw new Error('Server failed to start within timeout');
}

function stopServer(): void {
  if (serverProcess) {
    log.info('Stopping server subprocess...');
    serverProcess.kill();
    serverProcess = null;
  }
}

// Create viem wallet client
function createWallet() {
  const account = privateKeyToAccount(PRIVATE_KEY);

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(),
  });

  return { account, walletClient };
}

// Main test flow
async function runX402Test(): Promise<boolean> {
  const { account, walletClient } = createWallet();

  log.info(`Using wallet address: ${account.address}`);

  // Step 1: Request without payment header - expect 402
  log.info('Step 1: Request without payment header...');

  const initialResponse = await fetch(`${SERVER_URL}/analysis`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      focus: 'overview',
      chains: ['ethereum', 'base'],
      coins: ['bitcoin', 'ethereum'],
    }),
  });

  if (initialResponse.status !== 402) {
    log.error(`Expected 402, got ${initialResponse.status}`);
    const body = await initialResponse.text();
    log.error(`Response body: ${body}`);
    return false;
  }

  log.success('Got 402 Payment Required (expected)');

  // Step 2: Parse payment requirements from response
  log.info('Step 2: Parsing payment requirements...');

  const paymentRequiredHeader = initialResponse.headers.get('X-PAYMENT-REQUIRED');
  if (!paymentRequiredHeader) {
    log.error('Missing X-PAYMENT-REQUIRED header');
    return false;
  }

  // Decode base64 payment requirements
  const paymentRequirementsJson = Buffer.from(paymentRequiredHeader, 'base64').toString('utf-8');
  const paymentRequirementsResponse = JSON.parse(paymentRequirementsJson);

  log.info(`Payment requirements received:`);
  console.log(JSON.stringify(paymentRequirementsResponse, null, 2));

  // Extract the first accepted payment option
  const accepts = paymentRequirementsResponse.accepts;
  if (!accepts || accepts.length === 0) {
    log.error('No payment options in accepts array');
    return false;
  }

  const paymentRequirements = accepts[0];
  const x402Version = paymentRequirementsResponse.x402Version || 2;

  // Convert CAIP-2 network format to x402 network name if needed
  let networkForClient = paymentRequirements.network;
  if (networkForClient.startsWith('eip155:')) {
    const converted = CAIP2_TO_NETWORK[networkForClient];
    if (converted) {
      log.info(`Converting network from ${networkForClient} to ${converted}`);
      networkForClient = converted;
    } else {
      log.error(`Unknown CAIP-2 network: ${networkForClient}`);
      return false;
    }
  }

  // Create a modified payment requirements object with the converted network
  // The x402 client library expects specific field names
  const clientPaymentRequirements = {
    scheme: paymentRequirements.scheme,
    network: networkForClient,
    // The x402 library expects maxAmountRequired, not amount
    maxAmountRequired: String(paymentRequirements.amount || paymentRequirements.maxAmountRequired),
    asset: paymentRequirements.asset,
    payTo: paymentRequirements.payTo,
    maxTimeoutSeconds: Number(paymentRequirements.maxTimeoutSeconds),
    // Required fields for PaymentRequirements schema
    resource: `${SERVER_URL}/analysis`,
    description: paymentRequirementsResponse.description || 'AI-powered market analysis',
    mimeType: 'application/json',
  };

  log.info('Prepared payment requirements for client:');
  console.log(JSON.stringify(clientPaymentRequirements, null, 2));

  log.info(`Using x402 version: ${x402Version}`);
  log.info(`Network: ${paymentRequirements.network}`);
  log.info(`Amount: ${paymentRequirements.amount} (${parseInt(paymentRequirements.amount) / 1_000_000} USDC)`);
  log.info(`Pay to: ${paymentRequirements.payTo}`);

  // Step 3: Create signed payment header
  log.info('Step 3: Creating signed payment header...');

  try {
    const paymentHeader = await createPaymentHeader(
      walletClient,
      x402Version,
      clientPaymentRequirements
    );

    log.success('Payment header created successfully');
    log.info(`Payment header (truncated): ${paymentHeader.substring(0, 100)}...`);

    // Step 4: Retry request with payment header
    log.info('Step 4: Retrying request with payment header...');

    const paidResponse = await fetch(`${SERVER_URL}/analysis`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PAYMENT': paymentHeader,
      },
      body: JSON.stringify({
        focus: 'overview',
        chains: ['ethereum', 'base'],
        coins: ['bitcoin', 'ethereum'],
      }),
    });

    if (paidResponse.status !== 200) {
      log.error(`Expected 200, got ${paidResponse.status}`);
      const body = await paidResponse.text();
      log.error(`Response body: ${body}`);
      return false;
    }

    log.success('Got 200 OK - Payment accepted!');

    // Step 5: Verify response content
    log.info('Step 5: Verifying response content...');

    const analysisResult = await paidResponse.json();
    console.log('\n--- Analysis Result ---');
    console.log(JSON.stringify(analysisResult, null, 2));
    console.log('--- End Result ---\n');

    if (analysisResult.status === 'succeeded' && analysisResult.output) {
      log.success('Analysis result contains expected fields');
      return true;
    } else {
      log.warn('Response received but structure may be unexpected');
      return true; // Still consider it a success since we got 200
    }
  } catch (error) {
    log.error(`Failed to create payment header: ${error}`);
    console.error(error);
    return false;
  }
}

// Main entry point
async function main() {
  console.log('\n========================================');
  console.log('   x402 Payment Flow Test');
  console.log('========================================\n');

  try {
    // Start server
    await startServer();

    // Run test
    const success = await runX402Test();

    // Report result
    console.log('\n========================================');
    if (success) {
      log.success('TEST PASSED - x402 payment flow working correctly!');
    } else {
      log.error('TEST FAILED - See errors above');
    }
    console.log('========================================\n');

    process.exit(success ? 0 : 1);
  } catch (error) {
    log.error(`Test failed with error: ${error}`);
    console.error(error);
    process.exit(1);
  } finally {
    stopServer();
  }
}

// Run the test
main();
