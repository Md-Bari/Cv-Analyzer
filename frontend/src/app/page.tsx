import Analyzer from "@/components/Analyzer";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
      <header className="mx-auto mb-10 max-w-2xl text-center">
        <p className="mb-3 inline-block rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
          AI-powered ATS check
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">CV Analyzer</h1>
        <p className="mt-3 text-muted">
          Upload your CV and a job description to get an ATS score, see which keywords you match or
          miss, and get concrete suggestions to tailor your CV.
        </p>
      </header>
      <Analyzer />
    </main>
  );
}
