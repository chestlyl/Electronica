import { headers } from 'next/headers';
import { resolveTenantByHostname, resolveTenantBySlug } from '../lib/resolve-tenant';

export default async function PublicWebHome() {
  const headersList = await headers();
  const hostname = headersList.get('host') ?? '';

  let tenant = await resolveTenantByHostname(hostname);

  if (!tenant) {
    tenant = await resolveTenantBySlug('cornerstone-akron');
  }

  if (!tenant) {
    return (
      <main>
        <h1>Church Not Found</h1>
        <p>No church was found for this address.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>{tenant.name}</h1>
      <p>Welcome to {tenant.name}.</p>
      <p>Public website coming in Layer 2.</p>
    </main>
  );
}
