import { cn } from '@/lib/utils';
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
export { cn } from '@/lib/utils';

// ── Surfaces ─────────────────────────────────────────────────────────────────
export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-border bg-card', className)} {...p} />;
}
export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
      <div>
        <div className="text-sm font-medium text-fg">{title}</div>
        {subtitle ? <div className="mt-0.5 text-xs text-muted">{subtitle}</div> : null}
      </div>
      {action}
    </div>
  );
}
export function Section({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      {title ? <CardHeader title={title} /> : null}
      <div className="p-4">{children}</div>
    </Card>
  );
}

// ── Button ───────────────────────────────────────────────────────────────────
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'outline' | 'danger'; size?: 'sm' | 'md' };
export function Button({ className, variant = 'outline', size = 'md', ...p }: BtnProps) {
  const variants = {
    primary: 'bg-accent text-bg hover:opacity-90 border-transparent font-medium',
    ghost: 'bg-transparent hover:bg-border/50 border-transparent text-fg',
    outline: 'bg-transparent hover:bg-border/40 border-border text-fg',
    danger: 'bg-transparent hover:bg-danger/10 border-danger/40 text-danger',
  };
  const sizes = { sm: 'h-7 px-2.5 text-xs', md: 'h-9 px-3.5 text-sm' };
  return <button className={cn('inline-flex items-center justify-center gap-1.5 rounded-md border transition-colors disabled:opacity-50 disabled:pointer-events-none', variants[variant], sizes[size], className)} {...p} />;
}

// ── Input / Select ───────────────────────────────────────────────────────────
export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg placeholder:text-muted/70 outline-none focus:border-accent/60', className)} {...p} />;
}
export function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-xs font-medium text-muted">{children}</label>;
}

// ── Badge ────────────────────────────────────────────────────────────────────
type Tone = 'default' | 'accent' | 'success' | 'warn' | 'danger' | 'muted';
export function Badge({ children, tone = 'default', className }: { children: ReactNode; tone?: Tone; className?: string }) {
  const tones: Record<Tone, string> = {
    default: 'border-border text-fg',
    accent: 'border-accent/30 text-accent bg-accent/10',
    success: 'border-success/30 text-success bg-success/10',
    warn: 'border-warn/30 text-warn bg-warn/10',
    danger: 'border-danger/30 text-danger bg-danger/10',
    muted: 'border-border text-muted',
  };
  return <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium', tones[tone], className)}>{children}</span>;
}

// ── Progress ─────────────────────────────────────────────────────────────────
export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-border', className)}>
      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

// ── ScoreBar (0..100 with band color) ────────────────────────────────────────
export function ScoreBar({ value, className }: { value: number | null | undefined; className?: string }) {
  const v = value ?? 0;
  const tone = v >= 76 ? 'bg-success' : v >= 51 ? 'bg-accent' : v >= 26 ? 'bg-warn' : 'bg-danger';
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-border', className)}>
      <div className={cn('h-full rounded-full', tone)} style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
    </div>
  );
}

// ── Table ────────────────────────────────────────────────────────────────────
export function Table({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto"><table className="w-full text-sm">{children}</table></div>;
}
export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cn('whitespace-nowrap border-b border-border px-3 py-2 text-left text-xs font-medium text-muted', className)}>{children}</th>;
}
export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn('whitespace-nowrap border-b border-border/60 px-3 py-2.5 text-fg', className)}>{children}</td>;
}

// ── Misc ─────────────────────────────────────────────────────────────────────
export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-muted">{children}</div>;
}
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-accent" />
      {label ?? 'Loading…'}
    </div>
  );
}
export function priorityTone(p: string | null | undefined): Tone {
  switch (p) {
    case 'Critical': return 'danger';
    case 'High': return 'accent';
    case 'Medium': return 'warn';
    case 'Low': case 'Monitor': return 'muted';
    default: return 'muted';
  }
}
export function jobTone(s: string): Tone {
  return s === 'complete' ? 'success' : s === 'running' ? 'accent' : s === 'failed' ? 'danger' : 'muted';
}
