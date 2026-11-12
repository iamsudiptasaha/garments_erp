#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
template_dir="$repo_root/database/ci/project/supabase/templates"

mkdir -p "$template_dir"
cp "$repo_root"/supabase/templates/employee-{invite,recovery,email-change}.html "$template_dir/"
