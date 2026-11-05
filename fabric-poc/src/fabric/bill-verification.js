// A verifier signs into an isolated in-memory client. The operator's MFA session
// is never replaced, and only a short-lived exact-command proof reaches the save.
export async function saveVerifiedDyedBill(
  client,
  createVerifierClient,
  payload,
  verification,
  candidates,
) {
  const candidate = candidates.find((v) => v.id === verification?.employee);
  if (!candidate || !verification?.password)
    throw Error('Select an eligible employee and enter their password.');
  const verifier = createVerifierClient();
  let saved = false,
    snapshot,
    failure,
    cleanupFailed;
  try {
    const login = await verifier.auth.signInWithPassword({
      email: candidate.email,
      password: verification.password,
    });
    if (login.error) throw Error('Employee password verification failed.');
    const actor = await client.auth.getUser();
    if (actor.error || !actor.data.user) throw Error('Sign in again before saving.');
    const proof = await verifier.rpc('erp_dyed_bill_attestation', {
      p_actor: actor.data.user.id,
      p_employee: candidate.id,
      p_payload: payload,
    });
    if (proof.error) throw Error(proof.error.message);
    const result = await client.rpc('erp_save_verified_dyed_bill', {
      p_payload: payload,
      p_proof: proof.data,
    });
    if (result.error) throw Error(result.error.message);
    saved = true;
    snapshot = result.data;
  } catch (error) {
    failure = error;
  } finally {
    try {
      const cleanup = await verifier.auth.signOut({ scope: 'local' });
      cleanupFailed = Boolean(cleanup?.error);
    } catch {
      cleanupFailed = true;
    }
  }
  if (cleanupFailed)
    throw Error(
      saved
        ? 'Bill saved, but the verification session could not be closed. Reload before continuing.'
        : 'Verification session could not be closed. Reload before trying again.',
    );
  if (failure) throw failure;
  return snapshot;
}
