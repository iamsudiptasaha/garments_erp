import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
let findings = 0,
  files = 0;
for (const name of readdirSync(process.argv[2] || 'sarif'))
  if (name.endsWith('.sarif')) {
    files++;
    const report = JSON.parse(readFileSync(join(process.argv[2] || 'sarif', name), 'utf8'));
    for (const run of report.runs || []) {
      const rules = new Map((run.tool?.driver?.rules || []).map((r) => [r.id, r]));
      for (const result of run.results || []) {
        const rule = rules.get(result.ruleId),
          severity = Number(rule?.properties?.['security-severity'] || 0);
        if (severity >= 7 || result.level === 'error') findings++;
      }
    }
  }
if (!files) throw Error('CodeQL produced no SARIF results');
if (findings) throw Error(`CodeQL blocked release: ${findings} high/error findings`);
console.log('CodeQL severity gate passed');
