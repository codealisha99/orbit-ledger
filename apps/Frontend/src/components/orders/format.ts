import { money } from "@orbitledger/shared";
export const price = (value: number | null) =>
  value === null ? "—" : money(value / 100);
export const date = (value: string | number) =>
  new Date(value).toLocaleString("en-GB", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  });
