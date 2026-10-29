# Timestamps and business timeline

Applied 20261029141834 on 29 October 2026: all 103 physical tables in garments_erp and garments_access have updated_at timestamptz and zz_stamp_updated_at. Supabase-owned auth/storage and unrelated schemas are outside scope. Views derive data and do not have independent update timestamps.

Database trigger stamps inserts and meaningful row updates using clock_timestamp(). Caller-supplied timestamps cannot override it. No-op updates preserve the previous value. Existing rows remain NULL until a real update: historical update times are unknown, and migration time is not a truthful substitute. No created_at or business dates were changed. Future tables must include the same column/trigger convention.

Verified coverage 103/103 columns and triggers. Rollback-only tests checked insertion with a forged date, timestamp advancement on a real update, and preservation on a no-op/forged timestamp update. No fixture rows survive.

updated_at is last-change metadata, not an event history. The UI should format timestamps in Asia/Kolkata and show unknown legacy values honestly. A comprehensive buyer-delay timeline remains a separate feature: retain event type, actual event time, recorded time, actor, linked edition/version/item/program and changes/evidence. Backdated business dates must not masquerade as recording times. Existing app_activity_log covers access management, not the full production lifecycle. No generic row-history store was silently added in this migration.

UI direction agreed in discussion: lab dips appear as compact cards (colour name, brand, dyer, edition, current status), expanding on click to a version progress map and dates/comments. No rendered colour patches or Pantone approximation. Shade-card attachments remain evidence available on demand, not generated colour previews. UI implementation is pending.
