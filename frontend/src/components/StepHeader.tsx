export default function StepHeader({ step, title, subtitle }: { step: number; title: string; subtitle: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent">
        {step}
      </span>
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-xs text-muted">{subtitle}</p>
      </div>
    </div>
  );
}
