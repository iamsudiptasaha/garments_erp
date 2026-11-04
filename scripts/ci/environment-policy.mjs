// Run with a read-only GitHub settings token, never in an untrusted PR job.
const repo = process.env.GITHUB_REPOSITORY,
  token = process.env.GH_POLICY_TOKEN || process.env.GITHUB_TOKEN;
if (!repo || !token) throw Error('Repository policy audit credentials are missing');
async function get(path) {
  const r = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!r.ok) throw Error(`Cannot verify repository protection (${r.status})`);
  return r.json();
}
const env = await get('environments/production');
const review = env.protection_rules?.find((r) => r.type === 'required_reviewers');
// Environment reviewers are unavailable on some plans. Validate the rule when configured.
if (review && (!review.reviewers?.length || !review.prevent_self_review))
  throw Error(
    'Configured production environment reviewers must be independent and prevent self-review',
  );
if (env.can_admins_bypass === true)
  throw Error('Production must disallow any explicitly reported administrator bypass');
if (!env.deployment_branch_policy?.protected_branches)
  throw Error('Production deployments must be restricted to protected branches');
const branch = await get('branches/main/protection');
if (
  !branch.enforce_admins?.enabled ||
  !branch.required_pull_request_reviews?.require_code_owner_reviews ||
  !branch.required_pull_request_reviews?.dismiss_stale_reviews ||
  (branch.required_pull_request_reviews?.required_approving_review_count || 0) < 1 ||
  !branch.required_status_checks?.strict
)
  throw Error('main requires enforced PR review and up-to-date checks');
const contexts = branch.required_status_checks.contexts || [];
for (const name of ['Release gate'])
  if (
    !contexts.includes(name) &&
    !branch.required_status_checks.checks?.some((c) => c.context === name)
  )
    throw Error(`Required branch check missing: ${name}`);
console.log('Protected production environment and branch policy verified');
