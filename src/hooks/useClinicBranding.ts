import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useClinic } from './useClinic';
import { DEFAULT_PROVIDER, type ProviderSignature } from '@/lib/providerInfo';
import { resolveClinicLogoUrl } from '@/lib/clinicLogoUrl';


export interface ClinicBranding {
  brandName: string;
  logoUrl: string;
  faviconUrl: string;
  phone: string;
  fax: string;
  address: string;
  signatureBlock: string;
  providerSignature: ProviderSignature;
  loading: boolean;
}

const FALLBACK_LOGO = '/chartflo-logo.svg';
const FALLBACK_FAVICON = '/favicon.svg';

export function useClinicBranding(): ClinicBranding {
  const { activeClinic } = useClinic();
  const [state, setState] = useState<ClinicBranding>({
    brandName: DEFAULT_PROVIDER.practice,
    logoUrl: FALLBACK_LOGO,
    faviconUrl: FALLBACK_FAVICON,
    phone: DEFAULT_PROVIDER.phone,
    fax: DEFAULT_PROVIDER.fax,
    address: DEFAULT_PROVIDER.address || '',
    signatureBlock: '',
    providerSignature: DEFAULT_PROVIDER,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!activeClinic) {
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
        return;
      }
      const { data } = await supabase
        .from('clinic_settings')
        .select('*')
        .eq('clinic_id', activeClinic.id)
        .maybeSingle();
      if (cancelled) return;
      const brandName = data?.brand_name || activeClinic.name || DEFAULT_PROVIDER.practice;
      const phone = data?.brand_phone || DEFAULT_PROVIDER.phone;
      const fax = data?.brand_fax || DEFAULT_PROVIDER.fax;
      const address = data?.brand_address || DEFAULT_PROVIDER.address || '';
      const rawLogo = data?.logo_url || '';
      const rawFavicon = (data as any)?.favicon_url || '';
      const [signedLogo, signedFavicon] = await Promise.all([
        resolveClinicLogoUrl(rawLogo),
        resolveClinicLogoUrl(rawFavicon),
      ]);
      if (cancelled) return;
      const logoUrl = signedLogo || (rawLogo && /^https?:\/\//i.test(rawLogo) ? rawLogo : FALLBACK_LOGO);
      const faviconUrl = signedFavicon || (rawFavicon && /^https?:\/\//i.test(rawFavicon) ? rawFavicon : FALLBACK_FAVICON);

      const signatureBlock = data?.signature_block || '';
      setState({
        brandName,
        logoUrl,
        faviconUrl,
        phone,
        fax,
        address,
        signatureBlock,
        providerSignature: {
          ...DEFAULT_PROVIDER,
          practice: brandName,
          phone,
          fax,
          address,
        },
        loading: false,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [activeClinic?.id]);

  // Apply favicon to the document
  useEffect(() => {
    if (!state.faviconUrl) return;
    const links = Array.from(document.querySelectorAll<HTMLLinkElement>("link[rel~='icon']"));
    links.forEach((l) => l.parentNode?.removeChild(l));
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = state.faviconUrl;
    const ext = state.faviconUrl.split('.').pop()?.toLowerCase().split('?')[0];
    if (ext === 'svg') link.type = 'image/svg+xml';
    else if (ext === 'png') link.type = 'image/png';
    else if (ext === 'ico') link.type = 'image/x-icon';
    document.head.appendChild(link);
  }, [state.faviconUrl]);

  return state;
}
