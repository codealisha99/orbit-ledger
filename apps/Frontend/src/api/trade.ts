
import axios from "axios";
import type { SYMBOL } from "../utils/constants";
import type { Asset } from "../types/asset";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v2";

function getTimeRangeForDuration(duration: any): number {
  switch (duration) {
    case "1m":
      return 24 * 3600;
    case "1d":
      return 30 * 24 * 3600;
    case "1w":
      return 180 * 24 * 3600;
    default:
      return 3600;
  }
}

export async function getKlineData(
  asset: any,
  duration: any,
  startTime?: any,
  endTime?: string,
) {
  const currentTimeSec = Math.floor(Date.now() / 1000);

  const startTimestamp = startTime ? Number(startTime) : currentTimeSec - getTimeRangeForDuration(duration);
  const endTimestamp = endTime ? Number(endTime) : currentTimeSec;

  const res = await axios.get(`${BASE_URL}/asset/candles`, {
    params: {
      asset,
      ts: duration,
      startTime: startTimestamp,
      endTime: endTimestamp,
    },
  });

  if (res.data && Array.isArray(res.data.candles)) {
    res.data.candles = res.data.candles.map((candle: any) => ({
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      time: candle.time,      // Backend returns 'time' not 'timestamp'
      volume: candle.volume,
    }));
  }
  return res.data;
}

export async function submitsignup(email: string, pass: string) {
  try {
    const res = await axios.post(
      `${BASE_URL}/user/signup`,
      {
        email: email,
        password: pass,
      },
      {
        withCredentials: true,
      },
    );
    return res.data;
  } catch (e) {
    if (axios.isAxiosError(e)) {
      return e.response?.data || { message: "Failed to create account" };
    }
    return { message: (e as Error).message };
  }
}

export async function submitsignin(email: string, pass: string) {
  try {
    const res = await axios.post(
      `${BASE_URL}/user/signin`,
      {
        email: email,
        password: pass,
      },
      {
        withCredentials: true,
      },
    );
    return res.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      return error.response?.data || error;
    }
  }
}

export async function findUserAmount() {
  try {
    const token = localStorage.getItem("token");

    const res = await axios.get(`${BASE_URL}/user/balance`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      withCredentials: true,
    });
    return res.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      return error.response?.data || error;
    }
  }
}

export async function getopentrades(token: string) {
  try {
    const data = await axios.get(`${BASE_URL}/trade/open`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      withCredentials: true,
    });
    return data;
  } catch (e) {
    throw new Error((e as Error).message);
  }
}

export async function getclosedtrades(token: string) {
  try {
    const data = await axios.get(`${BASE_URL}/trade/history`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      withCredentials: true,
    });
    return data;
  } catch (e) {
    throw new Error((e as Error).message);
  }
}

export async function closetrade(token: string, orderId: string) {
  try {
    const data = await axios.post(
      `${BASE_URL}/trade/close`,
      {
        orderId: orderId,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        withCredentials: true,
      },
    );
    return data;
  } catch (e) {
    throw new Error((e as Error).message);
  }
}

export async function createTrade({
  symbol,
  activeTab,
  margin,
  leverage,
  tpEnabled,
  tpPrice,
  slEnabled,
  slPrice,
  tslEnabled,
  tslDistance,
  token,
}: {
  symbol: SYMBOL;
  activeTab: "buy" | "sell";
  margin: number;
  leverage: number;
  tpEnabled: boolean;
  tpPrice: string;
  slEnabled: boolean;
  slPrice: string;
  tslEnabled: boolean;
  tslDistance: string;
  token: string;
}) {
  try {
    const payload: any = {
      asset: symbol,
      type: activeTab,
      leverage,
    };

    payload["margin"] = margin;

    if (tpEnabled) {
      payload.takeProfit = Number(tpPrice);
    }
    if (slEnabled) {
      payload.stopLoss = Number(slPrice);
    }
    if (tslEnabled) {
      const trailingDistanceNum = Number(tslDistance);
      if (isNaN(trailingDistanceNum) || trailingDistanceNum <= 0) {
        throw new Error(`Invalid trailing distance: ${tslDistance}`);
      }
      payload.trailingStopLoss = {
        enabled: true,
        trailingDistance: trailingDistanceNum,
      };
    }

    const { data } = await axios.post(`${BASE_URL}/trade/open`, payload, {
      headers: { Authorization: `Bearer ${token}` },
      withCredentials: true,
    });

    return data;
  } catch (e) {
    if (axios.isAxiosError(e) && e.response) {
      throw new Error(JSON.stringify(e.response.data));
    }
    throw new Error((e as Error).message);
  }
}

export async function partialCloseTrade(orderId: string, percentage: number, token: string) {
  try {
    const { data } = await axios.post(
      `${BASE_URL}/trade/partial-close`,
      { orderId, percentage },
      {
        headers: { Authorization: `Bearer ${token}` },
        withCredentials: true,
      }
    );
    return data;
  } catch (e) {
    throw new Error((e as Error).message);
  }
}

export async function addMarginToTrade(orderId: string, additionalMargin: number, token: string) {
  try {
    const { data } = await axios.post(
      `${BASE_URL}/trade/add-margin`,
      { orderId, additionalMargin },
      {
        headers: { Authorization: `Bearer ${token}` },
        withCredentials: true,
      }
    );
    return data;
  } catch (e) {
    throw new Error((e as Error).message);
  }
}

export const fallbackAssets: Asset[] = [
  {
    name: "Bitcoin",
    symbol: "BTC",
    buyPrice: 65000,
    sellPrice: 64500,
    decimals: 4,
    imageUrl: "https://cryptologos.cc/logos/bitcoin-btc-logo.png",
  },
  {
    name: "Ethereum",
    symbol: "ETH",
    buyPrice: 3500,
    sellPrice: 3450,
    decimals: 4,
    imageUrl: "https://cryptologos.cc/logos/ethereum-eth-logo.png",
  },
  {
    name: "Solana",
    symbol: "SOL",
    buyPrice: 180,
    sellPrice: 178,
    decimals: 4,
    imageUrl: "https://cryptologos.cc/logos/solana-sol-logo.png",
  },
];

export async function getAssetDetails(): Promise<Asset[]> {
  try {
    const response = await axios.get(`${BASE_URL}/asset`);
    if (response.data && response.data.assets) {
      return response.data.assets;
    }
    return fallbackAssets;
  } catch (error) {
    console.error("Error fetching asset details:", error);
    return fallbackAssets;
  }
}
