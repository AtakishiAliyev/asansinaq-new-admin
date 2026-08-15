// SHA-256 of the raw file, hex-encoded. The buffer is already in memory for
// pdf.js, so duplicate detection costs one digest pass.
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
