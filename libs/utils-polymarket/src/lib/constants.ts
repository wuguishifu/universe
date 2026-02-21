// polymarket endpoints
export const CLOB_MARKET_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
export const CLOB_USER_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/user';
export const CLOB_API_BASE = 'https://clob.polymarket.com';
export const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';
export const DATA_API_BASE = 'https://data-api.polymarket.com';
export const RELAYER_API_BASE = 'https://relayer-v2.polymarket.com';

// binance endpoints
export const BINANCE_BTC_WS_URL = 'wss://stream.binance.com:9443/ws/btcusdt@bookTicker';
export const BINANCE_COMBINED_WS_URL =
  'wss://stream.binance.com:9443/stream?streams=btcusdt@bookTicker/ethusdt@bookTicker/solusdt@bookTicker/xrpusdt@bookTicker';

// polygon chain info
export const POLYGON_CHAIN_ID = 137;
export const CONDITIONAL_TOKENS_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
export const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
export const EMPTY_COLLECTION_ID = '0x0000000000000000000000000000000000000000000000000000000000000000';
// * Note: If we ever use non-binary markets, we will need to update this partition value.
export const BINARY_PARTITION = [1n, 2n];

export const CONDITIONAL_TOKENS_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'collateralToken', type: 'address' },
      { internalType: 'bytes32', name: 'parentCollectionId', type: 'bytes32' },
      { internalType: 'bytes32', name: 'conditionId', type: 'bytes32' },
      { internalType: 'uint256[]', name: 'partition', type: 'uint256[]' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
    ],
    name: 'mergePositions',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'collateralToken', type: 'address' },
      { internalType: 'bytes32', name: 'parentCollectionId', type: 'bytes32' },
      { internalType: 'bytes32', name: 'conditionId', type: 'bytes32' },
      { internalType: 'uint256[]', name: 'indexSets', type: 'uint256[]' },
    ],
    name: 'redeemPositions',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;
