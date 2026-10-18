export function resolveDestination(next: unknown) {
  if (
    typeof next !== "string" ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    /[\\\u0000-\u001f]/.test(next)
  )
    return "/dashboard";
  const url = new URL(next, "https://orbitledger.invalid");
  if (
    url.origin !== "https://orbitledger.invalid" ||
    /^\/(signin|signup|auth)(\/|$)/.test(url.pathname)
  )
    return "/dashboard";
  return `${url.pathname}${url.search}${url.hash}`;
}
