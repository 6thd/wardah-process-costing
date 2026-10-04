import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/store/auth-store.ts', 'utf8');

describe('auth-store profile contract', () => {
  it('hydrates from user_profiles by auth user_id and never recreates legacy public.users', () => {
    expect(source).not.toContain(".from('users')");
    expect(source).toContain(".from('user_profiles')");
    expect(source).toContain(".eq('user_id', data.user.id)");
    expect(source).toContain(".eq('user_id', session.user.id)");
  });

  it('keeps auth hydration read-only instead of creating profile rows client-side', () => {
    expect(source).not.toContain('.insert(');
    expect(source).toContain('Profile creation is an administrative/onboarding concern.');
  });
});
