/**
 * Secrets the UI masks to their last 4 characters. Anything that touches one
 * (reads a secret file, passes a key inline, reads the Keychain) is red tier.
 * Fixed patterns only; no model ever decides what is a secret.
 */

/** Files that hold secrets. `.env.example` and friends are templates, not secrets. */
const SECRET_FILES: RegExp[] = [
  /(^|[\s/'"=:<>])\.env(\.(?!example\b|sample\b|template\b|dist\b|defaults\b)[\w.-]+)?(?=$|[\s'";|&)<>])/,
  /(^|[\s/'"=:<>])\.envrc(?=$|[\s'";|&)<>])/,
  /(^|[\s/'"=:<>])id_(rsa|dsa|ecdsa|ed25519)(?!\.pub)(?=$|[\s'";|&)<>])/,
  /[\w-]\.(pem|key|p12|pfx|jks|keystore)(?=$|[\s'";|&)<>])/,
  /(^|[\s/'"=:<>])\.(netrc|npmrc|pypirc|pgpass|git-credentials)(?=$|[\s'";|&)<>])/,
  /(^|[\s/'"=:<>])secrets?\.(ya?ml|json|toml|env)(?=$|[\s'";|&)<>])/,
  /\.(ssh|gnupg|aws)\//,
  /\.kube\/config\b/,
  /\.docker\/config\.json\b/,
  /(^|[\s/'"=:<>])credentials(\.json)?(?=$|[\s'";|&)<>])/,
];

/** Inline secrets: provider key shapes, private keys, secret assignments and flags. */
const INLINE_SECRETS: RegExp[] = [
  /\bsk-(ant-)?[A-Za-z0-9_-]{20,}/,
  /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\b(AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i,
  /\b[A-Z0-9_]*(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*=[^\s]/,
  /\$\{?[A-Z0-9_]*(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*\b/,
  /(^|\s)--?(password|passwd|token|secret|api-key|apikey)([= ]\S)/i,
  /\b(password|passwd|secret|api[_-]?key)\s*[:=]\s*['"]?[^\s'"]{6,}/i,
];

/** Reading the Keychain or a password manager. */
const SECRET_STORES: RegExp[] = [
  /\bsecurity\s+(find-generic-password|find-internet-password|dump-keychain)\b/,
  /\bop\s+(read|item\s+get)\b/,
];

/** True when this command or path names a secret file, contains a secret or reads a secret store. */
export function touchesSecret(text: string): boolean {
  return [...SECRET_FILES, ...INLINE_SECRETS, ...SECRET_STORES].some((re) => re.test(text));
}

/**
 * True when free text (file contents being written) contains a secret value.
 * File-name patterns are skipped here: `config.key` in source code is not a secret.
 */
export function containsSecret(text: string): boolean {
  return INLINE_SECRETS.some((re) => re.test(text));
}
