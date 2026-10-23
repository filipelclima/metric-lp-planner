import { parseAbi, parseAbiItem } from "viem";

export const LIQUIDITY_ADDED_TOPIC = "0xa55772434bee2a347743b1e8086fa44bac69a060e124ec92ab6b9cc7fc5268af" as const;
export const LIQUIDITY_REMOVED_TOPIC = "0xf53d04bdbda6d88dd536895ec533833d3e09d0cbe2474fae32a368c5f83fc610" as const;

/** Same address on every Metric chain. */
export const DATA_PROVIDER = "0x83d66c5934b1525ee82e6e772c76c7acc778bbb7" as const;
/** Multicall3, deployed at the same address on most EVM chains. */
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

const binDelta = "(int256 delta0Scaled, int256 delta1Scaled)[] binBalanceDeltas";
export const LIQUIDITY_ADDED = parseAbiItem(
  `event LiquidityAdded(address indexed provider, uint80 indexed salt, int256[] binIdxs, ${binDelta}, uint256[] shares)`,
);
export const LIQUIDITY_REMOVED = parseAbiItem(
  `event LiquidityRemoved(address indexed provider, uint80 indexed salt, int256[] binIdxs, ${binDelta}, uint256[] shares)`,
);
export const LIQUIDITY_EVENTS = [LIQUIDITY_ADDED, LIQUIDITY_REMOVED] as const;

export const DATA_PROVIDER_ABI = parseAbi([
  "function positionBinShares(address pool, address owner, uint80 salt, int16 bin) view returns (uint256)",
  "function binTotalShares(address pool, int16 binIdx) view returns (uint256)",
  "function binState(address pool, int16 binIdx) view returns (uint104 token0BalanceScaled, uint104 token1BalanceScaled, uint16 lengthE6, uint16 addFeeBuyE6, uint16 addFeeSellE6)",
]);
