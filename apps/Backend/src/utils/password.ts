import bcrypt from "bcrypt";
// Equal-cost invalid-user checks avoid exposing account existence through timing.
const dummyHash = bcrypt.hashSync("orbitledger-invalid-user-comparison", 12);
export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
export function comparePassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash || dummyHash);
}
