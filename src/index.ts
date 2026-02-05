import { createAgent } from '@lucid-agents/core';
import { http } from '@lucid-agents/http';
import { createAgentApp } from '@lucid-agents/hono';
import { z } from 'zod';

// API Endpoints
const COINGECKO_API = 'https://api.coingecko.com/api/v3';
const OWLRACLE_API = 'https://api.owlracle.info/v2';
const DEFILLAMA_API = 'https://api.llama.fi';

// Chain mappings for Owlracle
const CHAIN_MAP: Record<string, string> = {
  ethereum: 'eth',
  eth: 'eth',
  base: 'base',
  polygon: 'poly',
  poly: 'poly',
  arbitrum: 'arb',
  optimism: 'opt',
  avalanche: 'avax',
  bsc: 'bsc',
  fantom: 'ftm',
};

// Payment configuration
const NETWORK = process.env.NETWORK || 'eip155:84532';
const PAY_TO = process.env.PAYMENTS_RECEIVABLE_ADDRESS || '';
const FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://x402.org/facilitator';
const ANALYSIS_PRICE = '10000'; // 0.01 USDC (6 decimals)

// OpenRouter configuration
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet'; // Default model

// Create the agent WITHOUT the payments extension (we'll handle it manually)
const agent = await createAgent({
  name: 'chain-data-agent',
  version: '1.0.0',
  description: 'Multi-Chain Data Aggregator - Real-time crypto prices, gas fees, and TVL data for AI agents',
})
  .use(http())
  .build();

const { app, addEntrypoint } = await createAgentApp(agent);

// ============================================================================
// FREE ENDPOINT 1: /prices - Get crypto prices from CoinGecko
// ============================================================================
addEntrypoint({
  key: 'prices',
  description: 'Get real-time cryptocurrency prices from CoinGecko. Supports any coin ID (bitcoin, ethereum, solana, etc.)',
  input: z.object({
    coins: z.array(z.string()).describe('Array of coin IDs (e.g., ["bitcoin", "ethereum", "solana"])'),
    currencies: z.array(z.string()).default(['usd']).describe('Array of fiat currencies (e.g., ["usd", "eur"])'),
  }),
  handler: async (ctx) => {
    const { coins, currencies } = ctx.input;

    const coinIds = coins.join(',');
    const vsCurrencies = currencies.join(',');

    const response = await fetch(
      `${COINGECKO_API}/simple/price?ids=${coinIds}&vs_currencies=${vsCurrencies}&include_24hr_change=true&include_market_cap=true`
    );

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = await response.json();

    return {
      output: {
        timestamp: new Date().toISOString(),
        source: 'coingecko',
        prices: data,
      },
    };
  },
});

// ============================================================================
// FREE ENDPOINT 2: /gas - Get multi-chain gas prices from Owlracle
// ============================================================================
addEntrypoint({
  key: 'gas',
  description: 'Get real-time gas prices for multiple EVM chains. Returns speed tiers (slow, standard, fast, instant) with estimated fees.',
  input: z.object({
    chains: z.array(z.string()).default(['eth', 'base', 'poly']).describe('Array of chain IDs (eth, base, poly, arb, opt, avax, bsc, ftm)'),
  }),
  handler: async (ctx) => {
    const { chains } = ctx.input;

    const gasData: Record<string, any> = {};

    await Promise.all(
      chains.map(async (chain) => {
        const chainKey = CHAIN_MAP[chain.toLowerCase()] || chain.toLowerCase();

        try {
          const response = await fetch(`${OWLRACLE_API}/${chainKey}/gas`);

          if (response.ok) {
            const data = await response.json();
            gasData[chain] = {
              timestamp: data.timestamp,
              baseFee: data.baseFee,
              avgBlockTime: data.avgTime,
              speeds: {
                slow: data.speeds[0],
                standard: data.speeds[1],
                fast: data.speeds[2],
                instant: data.speeds[3],
              },
            };
          } else {
            gasData[chain] = { error: `Failed to fetch: ${response.status}` };
          }
        } catch (error) {
          gasData[chain] = { error: String(error) };
        }
      })
    );

    return {
      output: {
        timestamp: new Date().toISOString(),
        source: 'owlracle',
        gas: gasData,
      },
    };
  },
});

// ============================================================================
// FREE ENDPOINT 3: /tvl - Get chain TVL data from DeFiLlama
// ============================================================================
addEntrypoint({
  key: 'tvl',
  description: 'Get Total Value Locked (TVL) data for blockchain networks from DeFiLlama.',
  input: z.object({
    limit: z.number().default(20).describe('Number of chains to return (sorted by TVL)'),
    includeProtocols: z.boolean().default(false).describe('Include top protocols data'),
  }),
  handler: async (ctx) => {
    const { limit, includeProtocols } = ctx.input;

    // Fetch chain TVL data
    const chainsResponse = await fetch(`${DEFILLAMA_API}/v2/chains`);
    if (!chainsResponse.ok) {
      throw new Error(`DeFiLlama API error: ${chainsResponse.status}`);
    }

    const chainsData = await chainsResponse.json();

    // Sort by TVL and limit
    const sortedChains = chainsData
      .filter((c: any) => c.tvl > 0)
      .sort((a: any, b: any) => b.tvl - a.tvl)
      .slice(0, limit)
      .map((chain: any) => ({
        name: chain.name,
        tvl: chain.tvl,
        tokenSymbol: chain.tokenSymbol,
        chainId: chain.chainId,
      }));

    let protocols: any[] = [];

    if (includeProtocols) {
      const protocolsResponse = await fetch(`${DEFILLAMA_API}/protocols`);
      if (protocolsResponse.ok) {
        const protocolsData = await protocolsResponse.json();
        protocols = protocolsData
          .filter((p: any) => p.tvl > 0)
          .sort((a: any, b: any) => b.tvl - a.tvl)
          .slice(0, 10)
          .map((p: any) => ({
            name: p.name,
            tvl: p.tvl,
            category: p.category,
            chains: p.chains?.slice(0, 5),
          }));
      }
    }

    return {
      output: {
        timestamp: new Date().toISOString(),
        source: 'defillama',
        totalTvl: sortedChains.reduce((sum: number, c: any) => sum + c.tvl, 0),
        chains: sortedChains,
        ...(includeProtocols && { topProtocols: protocols }),
      },
    };
  },
});

// ============================================================================
// PAID ENDPOINT: /analysis - AI-powered market analysis (0.01 USDC)
// Using manual x402 payment handling
// ============================================================================

// Helper function to call OpenRouter API
async function callOpenRouter(prompt: string, systemPrompt: string): Promise<string> {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY not configured');
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://chain-data-agent.local', // Required by OpenRouter
      'X-Title': 'Chain Data Agent',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 1500,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || '';
}

// Helper function to perform the analysis
async function performAnalysis(focus: string, chains: string[], coins: string[]) {
  // Fetch all data in parallel
  const [priceData, gasData, tvlData] = await Promise.all([
    // Prices
    fetch(`${COINGECKO_API}/simple/price?ids=${coins.join(',')}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`)
      .then(r => r.json())
      .catch(() => null),

    // Gas for each chain
    Promise.all(
      chains.map(async (chain) => {
        const chainKey = CHAIN_MAP[chain.toLowerCase()] || chain.toLowerCase();
        try {
          const r = await fetch(`${OWLRACLE_API}/${chainKey}/gas`);
          return { chain, data: await r.json() };
        } catch {
          return { chain, data: null };
        }
      })
    ),

    // TVL
    fetch(`${DEFILLAMA_API}/v2/chains`)
      .then(r => r.json())
      .catch(() => []),
  ]);

  // Prepare structured data
  const structuredData = {
    prices: priceData,
    gas: gasData.reduce((acc: any, { chain, data }) => {
      if (data) acc[chain] = {
        baseFee: data.baseFee,
        speeds: data.speeds,
      };
      return acc;
    }, {}),
    tvl: tvlData
      .filter((c: any) => c.tvl > 100_000_000) // Only chains with >$100M TVL
      .sort((a: any, b: any) => b.tvl - a.tvl)
      .slice(0, 15)
      .map((c: any) => ({ name: c.name, tvl: c.tvl, chainId: c.chainId })),
  };

  // Build the analysis
  const analysis: any = {
    timestamp: new Date().toISOString(),
    focus,
    model: OPENROUTER_MODEL,
    data: structuredData,
  };

  // Check if OpenRouter is configured
  if (!OPENROUTER_API_KEY) {
    // Fallback to basic analysis without AI
    analysis.summary = `Market data aggregated for ${focus} analysis. Configure OPENROUTER_API_KEY for AI-powered insights.`;
    analysis.insights = [];
    analysis.recommendations = ['Configure OPENROUTER_API_KEY to enable AI-powered analysis'];
    analysis.aiPowered = false;
    return analysis;
  }

  // Generate AI-powered analysis using OpenRouter
  const systemPrompt = `You are a professional crypto market analyst AI. Provide concise, actionable insights based on real-time market data. Be direct and specific. Format your response as JSON with these fields:
- summary: 1-2 sentence market overview
- insights: array of objects with {type, detail, signal} - max 5 insights
- recommendations: array of 3-5 actionable recommendations
- riskLevel: "low", "medium", or "high"`;

  const focusPrompts: Record<string, string> = {
    overview: `Analyze this crypto market data and provide a comprehensive overview. Focus on major price movements, gas conditions, and TVL trends.`,
    defi: `Analyze this data from a DeFi perspective. Focus on TVL trends, gas costs for DeFi operations, and which chains offer the best opportunities.`,
    trading: `Analyze this data for trading opportunities. Focus on price momentum, 24h changes, market cap shifts, and entry/exit signals.`,
    'gas-optimization': `Analyze gas prices across chains. Recommend the most cost-effective chains for transactions and optimal timing strategies.`,
  };

  const userPrompt = `${focusPrompts[focus] || focusPrompts.overview}

Current Market Data:
${JSON.stringify(structuredData, null, 2)}`;

  try {
    const aiResponse = await callOpenRouter(userPrompt, systemPrompt);

    // Try to parse as JSON, fallback to text
    try {
      const parsed = JSON.parse(aiResponse);
      analysis.summary = parsed.summary || aiResponse;
      analysis.insights = parsed.insights || [];
      analysis.recommendations = parsed.recommendations || [];
      analysis.riskLevel = parsed.riskLevel || 'medium';
    } catch {
      // If not valid JSON, use the raw response
      analysis.summary = aiResponse;
      analysis.insights = [];
      analysis.recommendations = [];
    }

    analysis.aiPowered = true;
  } catch (error) {
    // Fallback if OpenRouter fails
    analysis.summary = `AI analysis failed: ${error}. Raw data provided.`;
    analysis.insights = [];
    analysis.recommendations = ['Check OPENROUTER_API_KEY configuration'];
    analysis.aiPowered = false;
    analysis.error = String(error);
  }

  return analysis;
}

// Set up the paid analysis endpoint with x402 payment handling
if (PAY_TO) {
  // Add the paid analysis endpoint with x402 payment requirement
  app.post('/analysis', async (c) => {
    // Check for x402 payment header
    const paymentHeader = c.req.header('X-PAYMENT') || c.req.header('Payment') || c.req.header('Payment-Signature');

    if (!paymentHeader) {
      // Return 402 Payment Required with x402 requirements
      const paymentRequired = {
        x402Version: 2,
        accepts: [{
          scheme: 'exact',
          network: NETWORK,
          amount: ANALYSIS_PRICE,
          asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // USDC on Base Sepolia
          payTo: PAY_TO,
          maxTimeoutSeconds: 300,
          extra: {
            name: 'USD Coin',
            version: '2',
          },
        }],
        error: 'Payment required',
        description: 'Premium AI-powered market analysis - 0.01 USDC',
      };

      c.header('X-PAYMENT-REQUIRED', Buffer.from(JSON.stringify(paymentRequired)).toString('base64'));
      c.header('Content-Type', 'application/json');

      return c.json(paymentRequired, 402);
    }

    // Payment header present - process the request
    // In production, you would verify the payment with a facilitator here
    // For now, we accept any payment header as valid (for testing)

    try {
      const body = await c.req.json();
      const focus = body.focus || 'overview';
      const chains = body.chains || ['ethereum', 'base', 'polygon'];
      const coins = body.coins || ['bitcoin', 'ethereum'];

      const analysis = await performAnalysis(focus, chains, coins);

      return c.json({
        status: 'succeeded',
        output: analysis,
      });
    } catch (error) {
      return c.json({
        status: 'failed',
        error: String(error),
      }, 500);
    }
  });

  console.log(`Paid endpoint enabled: POST /analysis (${ANALYSIS_PRICE} units = 0.01 USDC)`);
} else {
  console.log('WARNING: PAYMENTS_RECEIVABLE_ADDRESS not set - paid endpoint disabled');
}

// Start the server
const port = Number(process.env.PORT ?? 3000);
console.log(`Chain Data Agent running on port ${port}`);
console.log(`
Endpoints:
  FREE:
    POST /entrypoints/prices/invoke  - Crypto prices (CoinGecko)
    POST /entrypoints/gas/invoke     - Multi-chain gas prices (Owlracle)
    POST /entrypoints/tvl/invoke     - Chain TVL data (DeFiLlama)

  PAID (0.01 USDC via x402):
    POST /analysis - AI-powered market analysis
`);

export { app };
export default { port, fetch: app.fetch };
