import { PageLayout } from '@/components/MobileLayout';
import { CodeLookup } from '@/components/CodeLookup';
import { BookOpen } from 'lucide-react';

export default function CodeLookupPage() {
  return (
    <PageLayout>
      <div className="space-y-4 max-w-3xl">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            Code Lookup
          </h1>
          <p className="text-sm text-muted-foreground">
            CPT, HCPCS, and ICD-10 reference with 2026 Medicare rates and HCC crosswalks.
            Falls back to AI for codes outside the built-in catalog.
          </p>
        </div>
        <CodeLookup />
      </div>
    </PageLayout>
  );
}
