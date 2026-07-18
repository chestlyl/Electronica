/**
 * Abstraction over secret retrieval.
 *
 * In development, a "none" provider reads from environment variables.
 * In production, swap for vault, AWS Secrets Manager, or GCP Secret Manager.
 */
export interface SecretProvider {
  getSecret(reference: string): Promise<string | null>;
}

export class EnvSecretProvider implements SecretProvider {
  async getSecret(reference: string): Promise<string | null> {
    return process.env[reference] ?? null;
  }
}

let _provider: SecretProvider = new EnvSecretProvider();

export function setSecretProvider(provider: SecretProvider): void {
  _provider = provider;
}

export function getSecretProvider(): SecretProvider {
  return _provider;
}

export async function resolveSecret(reference: string): Promise<string | null> {
  return _provider.getSecret(reference);
}
