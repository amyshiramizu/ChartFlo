import { Card } from '@/components/ui/card';
import { FileText, PenLine } from 'lucide-react';
import { DEFAULT_PROVIDER, formatSignatureText } from '@/lib/providerInfo';

interface Props {
  brandName: string;
  logoUrl: string;
  phone: string;
  fax: string;
  address: string;
  signatureBlock: string;
}

const FALLBACK_LOGO = '/hms-logo.webp';

/**
 * Renders the same header + signature block that will be embedded in
 * printed/faxed order summaries, so the user can verify their branding
 * before sending anything to a real recipient.
 */
export function BrandingPreview({
  brandName,
  logoUrl,
  phone,
  fax,
  address,
  signatureBlock,
}: Props) {
  const resolvedLogo = logoUrl?.trim() ? logoUrl : FALLBACK_LOGO;
  const displayName = brandName?.trim() || DEFAULT_PROVIDER.practice;

  const sampleSig = formatSignatureText({
    ...DEFAULT_PROVIDER,
    practice: displayName,
    phone: phone || DEFAULT_PROVIDER.phone,
    fax: fax || DEFAULT_PROVIDER.fax,
    address: address || DEFAULT_PROVIDER.address,
  });

  const sampleOrders = [
    'CBC w/ differential',
    'CMP',
    'Refill: Lisinopril 10 mg, 1 tab daily, #90, 3 refills',
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FileText className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold">Preview — Order header &amp; signature</h3>
      </div>

      <Card className="p-5 bg-background">
        <div className="border-b-2 border-primary pb-3 mb-4 flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={resolvedLogo}
            alt={displayName}
            className="h-14 w-auto object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).src = FALLBACK_LOGO;
            }}
          />
          <div>
            <p className="text-base font-semibold leading-tight">{displayName}</p>
            <p className="text-xs text-muted-foreground">Order Summary</p>
          </div>
        </div>

        <p className="text-xs font-semibold text-muted-foreground mb-1">Orders:</p>
        <ul className="text-sm font-mono space-y-0.5 mb-4">
          {sampleOrders.map((o) => (
            <li key={o}>- {o}</li>
          ))}
        </ul>

        <div className="border-t border-border pt-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
            <PenLine className="w-3 h-3" />
            Signature
          </div>
          <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed">
{sampleSig}
{signatureBlock ? `\n\n${signatureBlock}` : ''}
          </pre>
        </div>
      </Card>

      <p className="text-xs text-muted-foreground italic">
        This is exactly what will appear at the top of printed and faxed order summaries
        for this clinic. Sample orders are illustrative only.
      </p>
    </div>
  );
}
