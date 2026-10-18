import { Order, User, PriceData } from ".././types";
import { toInternalUSD, Asset, SUPPORTED_ASSETS } from "@orbitledger/shared";

export const StoreData = new Map<string, User>();
const INITIAL_BALANCE_USD = Number(process.env.INITIAL_BALANCE_USD ?? 5000);
if (
  !Number.isFinite(INITIAL_BALANCE_USD) ||
  INITIAL_BALANCE_USD < 10 ||
  INITIAL_BALANCE_USD > 1000000
)
  throw new Error("INITIAL_BALANCE_USD must be between 10 and 1000000");
export const INITIAL_BALANCE_CENTS = toInternalUSD(INITIAL_BALANCE_USD);
export const emailToUserId = new Map<string, string>();
export const orderStorageMap = new Map<string, Map<string, Order>>(); // Order Storage map
export const PriceStorageMp = new Map<Asset, PriceData>(); // Stores the PRices of BTC<ETH AND SOL realtime  for liquidation and logic calucltion
SUPPORTED_ASSETS.forEach((asset) => {
  PriceStorageMp.set(asset, { bid: 0, ask: 0 }); //Without this, if someone tries to get BTC price, they'll get undefined! initilizing with zero to evey coin
});

export function CreateUser(
  userId: string,
  email: string,
  password: string,
  balanceCents?: number,
) {
  const USerObj: User = {
    userId: userId,
    email: email,
    password: password,
    balance: {
      usd_balance:
        balanceCents !== undefined ? balanceCents : INITIAL_BALANCE_CENTS,
    },
    assets: {} as Record<Asset, number>,
  };
  StoreData.set(userId, USerObj);
  emailToUserId.set(email, userId);
  return USerObj;
}
export function findUSerId(ID: string): User | undefined {
  const checkUser = StoreData.get(ID);
  if (!checkUser) {
    return undefined;
  } else {
    return checkUser;
  }
}
