// Default provider / practice contact info for fax-ready order summaries.
// Override via the inputs on the Order Summary screen or by passing
// ProviderSignature into orderExport helpers.

export interface ProviderSignature {
  name: string;
  credentials?: string; // e.g. "MD", "DO", "NP"
  npi: string;
  practice: string;
  phone: string;
  fax: string;
  address?: string;
}

export const DEFAULT_PROVIDER: ProviderSignature = {
  name: 'Dr. Smith',
  credentials: 'MD',
  npi: '0000000000',
  practice: 'Home Medical Services',
  phone: '(555) 555-0100',
  fax: '(555) 555-0101',
  address: 'Mobile Primary Care',
};

export function formatSignatureText(p: ProviderSignature): string {
  const nameLine = `${p.name}${p.credentials ? `, ${p.credentials}` : ''}`;
  return [
    'Ordering Provider:',
    `  ${nameLine}`,
    `  NPI: ${p.npi}`,
    `  ${p.practice}`,
    p.address ? `  ${p.address}` : '',
    `  Phone: ${p.phone}  |  Fax: ${p.fax}`,
  ]
    .filter(Boolean)
    .join('\n');
}
