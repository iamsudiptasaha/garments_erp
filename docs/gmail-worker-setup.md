# Gmail sender through an isolated Worker

The mailer in `deploy/cloudflare-mailer` was deployed on 2026-10-31 at https://garments-erp-mailer.sahacreationsllp0int.workers.dev (current version `cfc48c80-d9aa-4728-967f-75369f778f5c`). The Gmail password and generated HMAC authentication key are configured as Worker secrets. A signed connection-test request returned HTTP 200 on 2026-10-31: Gmail accepted the fixed-recipient test email. Inbox delivery still needs recipient confirmation. The account backend is not activated. This is an email transport change, not approval to apply the pending account/MFA migrations or change normal login.

## Architecture

Backend → authenticated HTTPS `/send` → mailer adapter → Gmail SMTP over TLS (465) → fixed Administrator inbox.

The Worker is `garments-erp-mailer`, separate from the portal hosting deployment. The portal contains no Cloudflare runtime imports. The HTTP protocol in `server/mail/protocol.mjs` uses standard Web Crypto and Fetch, so another server can replace this adapter at the same interface.

Requests use HMAC-SHA256 signatures covering the exact body and timestamp. Expired/future signatures, oversized requests, unknown templates and caller-selected recipients are rejected. Only account-recovery and static connection-test templates are supported. Every message goes to `sahacreationsllp0int@gmail.com`; there is no public arbitrary-mail endpoint.

The adapter does not claim exactly-once delivery: an authenticated replay during the short timestamp window can duplicate a message, and SMTP acceptance does not prove inbox receipt. It must not be used as a general public mail service. No codes, passwords, SMTP errors or request bodies are logged by the application.

## Your credential step

1. Sign in to `sahacreationsllp0int@gmail.com` at [Google App passwords](https://myaccount.google.com/apppasswords).
2. Enable Google 2-Step Verification if required. Create an app password labelled `Garments ERP mailer`. If Google does not offer app passwords for this account, stop and use the OAuth alternative after review; do not use your normal Google password.
3. Enter the app password only as the encrypted Worker secret `GMAIL_APP_PASSWORD`. Never paste it in chat, source, `.env.example`, Vite variables or a command argument.

Google requires 2-Step Verification and may restrict app passwords for some accounts: [Google guidance](https://support.google.com/accounts/answer/185833).

## Worker configuration

The default sender variable `GMAIL_ADDRESS` is the administrator Gmail account. Wrangler authorization succeeded using macOS Keychain storage; deployment completed with the required Workers Scripts write permission. Production infrastructure changes remain subject to the release approval process.

In the mailer directory, use the pinned local Wrangler. The `secret put` commands prompt privately; supply values yourself rather than putting them in shell arguments:

```sh
cd deploy/cloudflare-mailer
npm ci
./node_modules/.bin/wrangler login
./node_modules/.bin/wrangler secret put GMAIL_APP_PASSWORD
./node_modules/.bin/wrangler secret put MAILER_SHARED_SECRET
```

Use a unique, cryptographically random shared secret of at least 32 characters, generated and retained in your password manager. Store the same value in the backend's secret manager. Secret commands can create/update deployed resources, so perform them only after the intended account and Worker have been confirmed. Do not enable the portal's old deployment workflow as an email workaround.

After approval, publish the reviewed Worker using its separate configuration. No database credentials, Supabase service key or Gmail password belongs in the frontend.

## Connect the backend

Configure these **server-only** backend secrets:

| Name | Value |
| --- | --- |
| `MAILER_URL` | `https://<approved-mailer-worker-host>/send` |
| `MAILER_SHARED_SECRET` | Same secret held by the Worker |

The prepared account service chooses this HTTP adapter when `MAILER_URL` is configured. Direct SMTP remains an independent fallback when that variable is absent. Google credentials are needed only by the Worker on the HTTP path.

Send one signed `connection-test` request after configuration, verify it arrives in the administrator inbox, and then test the recovery template in the approved non-production workflow. Never use a real employee's recovery code as a generic mail connectivity probe.

## Local verification

`npm test` in the mailer directory runs ten protocol/handler/socket tests without sending email. `npm run build` performs a Wrangler dry run; it does not deploy. Both passed. Pinned dependency installation reported no vulnerabilities. CI includes these tests, the dry-run build and a dependency audit. Real SMTP acceptance was verified. The standard Node TLS socket connects using `smtp.gmail.com` on port 465 with certificate verification; this avoids the library’s failing resolved-address path on Workers. Only fixed diagnostic categories are logged, never raw SMTP errors or message contents. Backend recovery integration remains pending.

Current library/runtime references: [Nodemailer Worker support](https://github.com/nodemailer/nodemailer/blob/master/README.md), [Workers TLS support](https://developers.cloudflare.com/workers/runtime-apis/nodejs/tls/).
