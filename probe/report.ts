import { readFile, writeFile } from 'node:fs/promises'

const b64 = async (p: string) => (await readFile(p)).toString('base64')

/** Side by side: the original, then everything the agent produced in order,
 *  so a redraw sequence reads as a sequence. */
export async function buildReport(results: any[]): Promise<void> {
  const cards = await Promise.all(
    results.map(async (r) => {
      const orig = await b64(r.crop)
      const mime = r.crop.endsWith('.png') ? 'png' : 'jpeg'
      const made = await Promise.all(
        r.artefacts.map(async (a: any) => `
          <figure>
            <img src="data:image/png;base64,${await b64(a.file)}" alt="">
            <figcaption>${a.name}<span>${a.note}</span></figcaption>
          </figure>`),
      )
      const trace = r.toolCalls
        .map((c: any) => `<li><code>${c.name}</code> ${c.input.why ?? c.input.name ?? c.input.reason ?? ''}</li>`)
        .join('')
      const f = r.final ?? {}
      return `
      <section>
        <header>
          <h2>${r.id}</h2>
          <span class="badge ${r.outcome}">${r.outcome}</span>
          <span class="meta">${r.steps} addım · ${r.redraws} düzəliş dövrəsi · $${r.usd.toFixed(3)} · ${(r.ms / 1000).toFixed(0)} san</span>
        </header>
        <p class="known">Bugünkü sistemdə: ${r.known}</p>
        <div class="grid">
          <div class="pane">
            <h3>Orijinal</h3>
            <img src="data:image/${mime};base64,${orig}" alt="">
          </div>
          <div class="pane">
            <h3>Agentin çıxardığı</h3>
            <div class="made">${made.join('')}</div>
            ${f.stem !== undefined ? `<div class="text"><b>Şərt:</b> ${f.stem || '<i>(yoxdur — şəkilli sual)</i>'}</div>` : ''}
            ${f.options ? `<ol class="opts">${(f.options as any[]).map((o) => `<li>${o.tex ?? `<i>${o.image ?? '?'}</i>`}</li>`).join('')}</ol>` : ''}
            ${f.notes ? `<p class="notes">${f.notes}</p>` : ''}
            ${f.reason ? `<p class="notes gave"><b>Təslim:</b> ${f.reason}<br><small>Sınadığı: ${f.tried ?? ''}</small></p>` : ''}
          </div>
        </div>
        <details><summary>İz — ${r.toolCalls.length} alət çağırışı</summary><ol class="trace">${trace}</ol></details>
      </section>`
    }),
  )

  await writeFile('probe/out/report.html', `<!doctype html><meta charset="utf-8">
<title>Agent sınağı</title>
<style>
  :root{--line:#e4e4e7;--dim:#71717a;--bg:#fff;--fg:#18181b}
  body{margin:0;padding:32px;font:15px/1.6 ui-sans-serif,system-ui;background:var(--bg);color:var(--fg);max-width:1400px;margin-inline:auto}
  h1{font-size:22px;letter-spacing:-.01em}
  .lede{color:var(--dim);max-width:70ch}
  section{border:1px solid var(--line);border-radius:12px;padding:20px;margin:22px 0}
  header{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  h2{font-size:16px;margin:0;font-family:ui-monospace,monospace}
  .badge{font-size:11px;text-transform:uppercase;letter-spacing:.08em;padding:3px 9px;border-radius:99px;border:1px solid}
  .badge.done{background:#ecfdf5;border-color:#a7f3d0;color:#047857}
  .badge.gave_up{background:#fffbeb;border-color:#fde68a;color:#b45309}
  .badge.exhausted,.badge.error{background:#fef2f2;border-color:#fecaca;color:#b91c1c}
  .meta{margin-left:auto;color:var(--dim);font-size:13px;font-variant-numeric:tabular-nums}
  .known{color:var(--dim);font-size:13px;margin:8px 0 16px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  @media(max-width:900px){.grid{grid-template-columns:1fr}}
  .pane h3{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--dim);margin:0 0 8px}
  .pane>img{width:100%;border:1px solid var(--line);border-radius:8px;background:#fff}
  .made{display:flex;flex-wrap:wrap;gap:10px}
  figure{margin:0;flex:0 1 220px}
  figure img{width:100%;border:1px solid var(--line);border-radius:6px;background:#fff}
  figcaption{font-size:11px;color:var(--dim);margin-top:4px;font-family:ui-monospace,monospace}
  figcaption span{display:block;font-family:inherit}
  .text{margin-top:14px;padding:10px;border:1px solid var(--line);border-radius:8px;font-size:14px}
  .opts{margin:10px 0 0;padding-left:22px;font-size:14px}
  .notes{font-size:13px;color:var(--dim);margin-top:10px}
  .notes.gave{color:#b45309}
  details{margin-top:14px}
  summary{font-size:13px;color:var(--dim);cursor:pointer}
  .trace{font-size:12px;color:var(--dim);font-family:ui-monospace,monospace}
  code{background:#f4f4f5;padding:1px 5px;border-radius:4px}
</style>
<h1>Agent sınağı</h1>
<p class="lede">Bugünkü boru kəmərinin uğursuz olduğu suallar, bu dəfə alətləri olan və öz nəticəsini görən bir agentə verilib. Ölçülən: həll etdimi, neçə addımda, fiquru neçə düzəliş dövrəsində uyğunlaşdırdı, nə qədər.</p>
${cards.join('')}`)
}
