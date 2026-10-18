import { describe, expect, it } from 'vitest';
import { maskSecrets } from './secrets';

const KEY = 'sk-ant-api03-Zx8vQ2mN7pL4kR9tW1yB6cD3fG5hJ0aE3f9a';

describe('maskSecrets', () => {
  it('masks a provider key to its prefix and last 4 (design 11 §03)', () => {
    const masked = maskSecrets(`curl -H "Authorization: Bearer ${KEY}" https://api.vendor.example/hooks`);
    expect(masked.text).toBe('curl -H "Authorization: Bearer sk-ant-••••••3f9a" https://api.vendor.example/hooks');
    expect(masked.hidden).toBe(1);
  });

  it('masks the value of a secret assignment but keeps references to other variables', () => {
    expect(maskSecrets('GITHUB_TOKEN=abcd1234efgh5678wxyz pnpm release').text).toBe('GITHUB_TOKEN=••••••wxyz pnpm release');
    expect(maskSecrets('API_KEY=$PROD_KEY ./deploy.sh')).toEqual({ text: 'API_KEY=$PROD_KEY ./deploy.sh', hidden: 0 });
    expect(maskSecrets('DATABASE_URL=$STAGING_URL pnpm tsx scripts/seed.ts')).toEqual({
      text: 'DATABASE_URL=$STAGING_URL pnpm tsx scripts/seed.ts',
      hidden: 0,
    });
  });

  it('masks password flags, bearer tokens, URL passwords and private keys', () => {
    expect(maskSecrets('mysql --password=hunter2hunter2 -u root').text).toBe('mysql --password=••••••ter2 -u root');
    expect(maskSecrets('curl -H "Authorization: Bearer abc.def.ghijklmnopqrstuvwxyz1234"').text).toBe(
      'curl -H "Authorization: Bearer ••••••1234"',
    );
    expect(maskSecrets('git clone https://nick:s3cretP4ssw0rd@git.example.com/r.git').text).toBe(
      'git clone https://nick:••••••w0rd@git.example.com/r.git',
    );
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\nabcd\n-----END RSA PRIVATE KEY-----';
    expect(maskSecrets(`echo "${pem}" > k.pem`).text).toBe('echo "-----BEGIN RSA PRIVATE KEY-----••••••-----END RSA PRIVATE KEY-----" > k.pem');
  });

  it('hides short secrets completely instead of showing half of them', () => {
    expect(maskSecrets('psql --password=abc12 db').text).toBe('psql --password=•••••• db');
  });

  it('counts each secret once, however many patterns match it', () => {
    const masked = maskSecrets(`ANTHROPIC_API_KEY=${KEY} ghp_${'a'.repeat(36)}`);
    expect(masked.text).toBe('ANTHROPIC_API_KEY=sk-ant-••••••3f9a ghp_••••••aaaa');
    expect(masked.hidden).toBe(2);
  });

  it('is stable: masking masked text changes nothing', () => {
    const once = maskSecrets(`TOKEN=${KEY} && curl -u admin:password123456 https://x.example`);
    expect(maskSecrets(once.text)).toEqual({ text: once.text, hidden: 0 });
  });

  it('leaves ordinary commands alone', () => {
    for (const cmd of ['pnpm test', 'git push origin main', 'cat .env.example', 'grep -r password src/']) {
      expect(maskSecrets(cmd)).toEqual({ text: cmd, hidden: 0 });
    }
  });
});
