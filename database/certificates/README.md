# Supabase database CA

Public trust anchor only; no private key or credentials.

Downloaded 1 November 2026 from the exact production certificate URL in Supabase's official Studio configuration:

- Source configuration: https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json (`ssl:certificate_url`)
- Download: https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
- Subject/issuer: Supabase Root 2021 CA, Supabase Inc.
- SHA-256 fingerprint: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`
- Valid until 26 April 2031.

The production database runner trusts this certificate explicitly while retaining `rejectUnauthorized: true` and default hostname verification. Do not work around expiry or rotation by disabling TLS checks; review and update the vendor certificate and pin together. This file is never used by the browser bundle.
