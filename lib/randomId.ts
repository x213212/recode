type BrowserCrypto = Pick<Crypto, "getRandomValues"> & {
  randomUUID?: () => string;
};

export function createRandomId(
  cryptoSource: BrowserCrypto | undefined = globalThis.crypto
): string {
  if (typeof cryptoSource?.randomUUID === "function") {
    return cryptoSource.randomUUID();
  }

  if (cryptoSource) {
    const bytes = new Uint8Array(16);
    cryptoSource.getRandomValues(bytes);

    // RFC 4122 version 4 UUID：保留隨機內容，只設定版本與 variant bits。
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0")
    );
    return [
      hex.slice(0, 4).join(""),
      hex.slice(4, 6).join(""),
      hex.slice(6, 8).join(""),
      hex.slice(8, 10).join(""),
      hex.slice(10).join("")
    ].join("-");
  }

  // 極舊瀏覽器的最後備援；這個 ID 只用來避免分頁與自訂測資互撞。
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}
