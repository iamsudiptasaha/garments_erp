// Retired compatibility endpoint: no Auth administration, credentials or database access.
export function retiredAdminRequest() {
  return new Response(
    JSON.stringify({ error: 'This legacy endpoint is retired. Use the ERP Administration panel.' }),
    {
      status: 410,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}
