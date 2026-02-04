# Chain Data Agent

Multi-Chain Data Aggregator providing real-time crypto prices, gas fees, and TVL data for AI agents.

Built with the [Lucid Agents SDK](https://github.com/daydreamsai/lucid-agents) using x402 payments on Base Sepolia.

## Market Opportunity

Based on research from X and Reddit, AI agents in the crypto/DeFi space need:
- **Real-time price data** for trading decisions
- **Gas price optimization** across multiple chains
- **TVL metrics** for DeFi strategy
- **Unified interfaces** instead of fragmented APIs

This agent aggregates data from:
- **CoinGecko** - Crypto prices (free, no auth)
- **Owlracle** - Multi-chain gas prices (free, no auth)
- **DeFiLlama** - TVL and protocol data (free, no auth)

## Endpoints

### Free Endpoints (3)

| Endpoint | Method | Description | Data Source |
|----------|--------|-------------|-------------|
| `/entrypoints/prices/invoke` | POST | Real-time crypto prices | CoinGecko |
| `/entrypoints/gas/invoke` | POST | Multi-chain gas prices | Owlracle |
| `/entrypoints/tvl/invoke` | POST | Chain TVL data | DeFiLlama |

### Paid Endpoint (1) - 0.01 USDC via x402

| Endpoint | Method | Description | Price |
|----------|--------|-------------|-------|
| `/analysis` | POST | AI-powered market analysis | 0.01 USDC |

## Quick Start

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your wallet address
```

Required environment variables:
```bash
PAYMENTS_RECEIVABLE_ADDRESS=0xYourWalletAddress
FACILITATOR_URL=https://x402.org/facilitator
NETWORK=eip155:84532
```

### 3. Run the agent

```bash
bun run dev
```

## API Usage

### Get Prices (Free)

```bash
curl -X POST http://localhost:3000/entrypoints/prices/invoke \
  -H "Content-Type: application/json" \
  -d '{"coins": ["bitcoin", "ethereum", "solana"], "currencies": ["usd"]}'
```

**Response:**
```json
{
  "status": "succeeded",
  "output": {
    "timestamp": "2026-02-04T05:00:00.000Z",
    "source": "coingecko",
    "prices": {
      "bitcoin": {"usd": 76364, "usd_24h_change": -2.99},
      "ethereum": {"usd": 2269.88, "usd_24h_change": -1.5}
    }
  }
}
```

### Get Gas Prices (Free)

```bash
curl -X POST http://localhost:3000/entrypoints/gas/invoke \
  -H "Content-Type: application/json" \
  -d '{"chains": ["eth", "base", "poly"]}'
```

**Response:**
```json
{
  "status": "succeeded",
  "output": {
    "timestamp": "2026-02-04T05:00:00.000Z",
    "source": "owlracle",
    "gas": {
      "eth": {
        "baseFee": 0.105,
        "speeds": {
          "slow": {"gasPrice": 0.104, "acceptance": 0.35},
          "standard": {"gasPrice": 0.113, "acceptance": 0.6},
          "fast": {"gasPrice": 0.132, "acceptance": 0.9},
          "instant": {"gasPrice": 1.125, "acceptance": 1}
        }
      }
    }
  }
}
```

### Get TVL Data (Free)

```bash
curl -X POST http://localhost:3000/entrypoints/tvl/invoke \
  -H "Content-Type: application/json" \
  -d '{"limit": 5, "includeProtocols": true}'
```

### Get Market Analysis (Paid - 0.01 USDC)

**Without payment (returns 402):**
```bash
curl -X POST http://localhost:3000/analysis \
  -H "Content-Type: application/json" \
  -d '{"focus": "overview"}'
```

**Response (402 Payment Required):**
```json
{
  "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:84532",
    "amount": "10000",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "payTo": "0xc4eAb635B40bF49907375c3C7bd2495e3fDe79df",
    "maxTimeoutSeconds": 300
  }],
  "error": "Payment required",
  "description": "Premium AI-powered market analysis - 0.01 USDC"
}
```

**With x402 payment:**
```bash
curl -X POST http://localhost:3000/analysis \
  -H "Content-Type: application/json" \
  -H "X-PAYMENT: <x402-payment-token>" \
  -d '{"focus": "trading", "coins": ["bitcoin", "ethereum"]}'
```

**Analysis focus options:**
- `overview` - Comprehensive market overview
- `defi` - DeFi-focused with TVL trends
- `trading` - Trading signals and momentum
- `gas-optimization` - Cost-effective chain selection

## Data Sources

| Source | API | Rate Limits |
|--------|-----|-------------|
| CoinGecko | `api.coingecko.com/api/v3` | 10-50 req/min (free tier) |
| Owlracle | `api.owlracle.info/v2` | Generous free tier |
| DeFiLlama | `api.llama.fi` | No auth required |

## Architecture

```
chain-data-agent/
├── src/
│   └── index.ts       # Main agent with all endpoints
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## x402 Payment Integration

The `/analysis` endpoint uses the x402 payment protocol on Base Sepolia:

- **Network**: Base Sepolia (eip155:84532)
- **Asset**: USDC (0x036CbD53842c5426634e7929541eC2318f3dCF7e)
- **Price**: 10000 units (0.01 USDC with 6 decimals)
- **Scheme**: exact (EIP-3009 transferWithAuthorization)

## License

MIT
