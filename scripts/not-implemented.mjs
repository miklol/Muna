// Placeholder for root scripts whose feature has not landed yet (docs/11-ci-cd.md
// "Root scripts the workflows call"). Usage:
//   node scripts/not-implemented.mjs <script> <milestone> [--fail] [message…]
// Exits 0 so gating jobs stay green; `--fail` makes release-only steps fail loudly instead.
const [script, milestone, ...rest] = process.argv.slice(2);
const fail = rest.includes('--fail');
const message = rest.filter((arg) => arg !== '--fail' && arg !== '--').join(' ');

console.log(
  `[${script ?? 'script'}] not implemented yet; lands with ${milestone ?? 'a later milestone'}.`,
);
if (message) {
  console.log(`[${script}] ${message}`);
}
if (fail) {
  console.error(`[${script}] refusing to pretend this succeeded; see docs/07-roadmap.md.`);
  process.exit(1);
}
