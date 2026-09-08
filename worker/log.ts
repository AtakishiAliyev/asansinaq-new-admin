/** One timestamped line. The worker's whole voice is this and the ledger. */
export const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] ${msg}`)
