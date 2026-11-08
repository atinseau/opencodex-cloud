import { HttpServerResponse } from "effect/http"

export const UPLOAD_LIFETIME_SECONDS = 60 * 60
export const MAX_UPLOAD_MEGABYTES = 25

/** The page holds a capability in its URL: it must not leak through referrers, caches or frames. */
const HEADERS = {
  "content-security-policy":
    "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
}

const STYLE = `
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; color: #1f1e1d; background: #f5f4ef; }
  main { max-width: 32rem; margin: 12vh auto; padding: 0 1.25rem; }
  h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
  form { display: flex; flex-wrap: wrap; gap: .75rem; margin: 1.5rem 0 .5rem; }
  input { flex: 1 1 14rem; }
  button { padding: .5rem 1.25rem; border: 0; border-radius: .5rem; background: #c96442; color: #fff; font: inherit; cursor: pointer; }
  img { display: block; max-width: 100%; margin-top: 1.5rem; border-radius: .5rem; }
  .hint { color: #6b6a65; font-size: .875rem; }
`

const FORM = `
  <form method="post" enctype="multipart/form-data">
    <input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" required>
    <button type="submit">Envoyer</button>
  </form>
  <p class="hint">JPEG, PNG, WebP ou GIF, ${MAX_UPLOAD_MEGABYTES} Mo au plus. Ce lien ne sert qu'une fois et expire au bout d'une heure.</p>`

const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")

interface Page {
  readonly status: number
  readonly title: string
  readonly message: string
  /** Shows the form again, for a link that can still receive an image. */
  readonly form?: boolean
  readonly image?: string
}

const render = (page: Page) =>
  HttpServerResponse.text(
    `<!doctype html>
<html lang="fr">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(page.title)}</title>
<style>${STYLE}</style>
<main>
  <h1>${escapeHtml(page.title)}</h1>
  <p>${escapeHtml(page.message)}</p>${page.form === true ? FORM : ""}${
    page.image === undefined ? "" : `\n  <img src="${escapeHtml(page.image)}" alt="">`
  }
</main>
</html>
`,
    { status: page.status, contentType: "text/html; charset=utf-8", headers: HEADERS },
  )

/** The pages of an upload link, in French like the rest of the hub. */
export const UploadPages = {
  form: render({
    status: 200,
    title: "Envoyer une image à Claude",
    message: "Choisis l'image que Claude doit retoucher.",
    form: true,
  }),
  done: (image: string) =>
    render({
      status: 200,
      title: "Image envoyée",
      message: "Retourne dans Claude et dis-lui que c'est fait : il peut maintenant la retoucher.",
      image,
    }),
  used: (image: string) =>
    render({
      status: 409,
      title: "Ce lien a déjà servi",
      message:
        "L'image ci-dessous a déjà été envoyée. Pour en envoyer une autre, demande un nouveau lien à Claude.",
      image,
    }),
  expired: render({
    status: 404,
    title: "Lien expiré ou invalide",
    message: "Demande un nouveau lien d'envoi à Claude.",
  }),
  unreadable: render({
    status: 400,
    title: "Image illisible",
    message: "Ce fichier n'est pas une image prise en charge. Essaie un JPEG ou un PNG.",
    form: true,
  }),
  unsupported: render({
    status: 415,
    title: "Format non pris en charge",
    message:
      "Les images HEIC, AVIF et TIFF ne sont pas prises en charge. Exporte l'image en JPEG ou en PNG.",
    form: true,
  }),
  tooLarge: render({
    status: 413,
    title: "Image trop lourde",
    message: `Le fichier dépasse ${MAX_UPLOAD_MEGABYTES} Mo.`,
    form: true,
  }),
}
