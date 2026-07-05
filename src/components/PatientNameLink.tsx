import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface Props {
  patientId?: string | null;
  children: React.ReactNode;
  className?: string;
  /** Where to navigate. Defaults to the patient profile. */
  to?: string;
}

/**
 * Renders a patient name as a clickable link to their chart.
 * Falls back to plain text when no patientId is available.
 */
export function PatientNameLink({ patientId, children, className, to }: Props) {
  if (!patientId) return <span className={className}>{children}</span>;
  const href = to ?? `/chart/${patientId}`;
  return (
    <Link
      to={href}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'hover:underline hover:text-primary focus:underline focus:outline-none cursor-pointer',
        className,
      )}
    >
      {children}
    </Link>
  );
}
