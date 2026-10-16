import React, { useState } from "react";
import { useSettingsStore, type TonePreset, type SeniorityPreset } from "../../store/settingsStore";
import { cn } from "../../lib/utils";

const MAX_RESUME_BYTES = 200 * 1024;

const TONES: { id: TonePreset; name: string; description: string }[] = [
  { id: "concise", name: "Concise", description: "Short and direct" },
  { id: "balanced", name: "Balanced", description: "Clear, structured answers" },
  { id: "deep", name: "Deep", description: "Thorough reasoning and edge cases" },
  { id: "staff", name: "Staff", description: "Trade-offs and operations" },
  { id: "system_architect", name: "Architect", description: "Systems, APIs and scale" },
];

const SENIORITY: { id: SeniorityPreset; label: string }[] = [
  { id: "junior", label: "Junior" },
  { id: "mid", label: "Mid" },
  { id: "senior", label: "Senior" },
  { id: "staff", label: "Staff" },
  { id: "principal", label: "Principal" },
];

const optionClass = (selected: boolean) =>
  selected
    ? "bg-sk-accent-tint text-sk-fg"
    : "bg-sk-fill text-sk-fg-2 hover:bg-sk-hover";

const focusRing = "outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sk-focus";

export const ProfileEditor: React.FC = () => {
  const profile = useSettingsStore((s) => s.profile);
  const setProfile = useSettingsStore((s) => s.setProfile);
  const setSeniority = useSettingsStore((s) => s.setSeniority);
  const setTone = useSettingsStore((s) => s.setTone);

  const [dragging, setDragging] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const processFile = async (file: File) => {
    if (!/\.(txt|md)$/i.test(file.name)) {
      setResumeError("Only .txt and .md files are supported. Paste the text instead.");
      return;
    }
    if (file.size > MAX_RESUME_BYTES) {
      setResumeError("That file is too large. Paste the relevant part instead.");
      return;
    }
    try {
      setProfile({ resumeText: await file.text() });
      setResumeError(null);
    } catch {
      setResumeError("Could not read that file. Paste the text instead.");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void processFile(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Clear the input so choosing the same file again still fires change
    e.target.value = "";
    if (file) void processFile(file);
  };

  const wordCount = profile.resumeText.trim() ? profile.resumeText.trim().split(/\s+/).length : 0;

  return (
    <div className="space-y-4">
      <p className="sk-meta">Changes save automatically.</p>

      <div className="space-y-2">
        <div className="space-y-1.5">
          <label htmlFor="profile-company" className="sk-label">
            Target company
          </label>
          <input
            id="profile-company"
            type="text"
            value={profile.targetCompany}
            onChange={(e) => setProfile({ targetCompany: e.target.value })}
            placeholder="e.g. Stripe, Google, Datadog"
            className="sk-field"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="profile-job" className="sk-label">
            Job description
          </label>
          <textarea
            id="profile-job"
            rows={3}
            value={profile.jobDescription}
            onChange={(e) => setProfile({ jobDescription: e.target.value })}
            placeholder="Paste the requirements, key systems and stack"
            className="sk-field resize-none"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="profile-resume" className="sk-label">
            Resume or experience
          </label>
          {profile.resumeText && (
            <div className="flex items-center gap-2">
              <span className="sk-meta tabular-nums">
                {wordCount} words · {profile.resumeText.length} chars
              </span>
              <button
                type="button"
                onClick={() => setProfile({ resumeText: "" })}
                className="sk-btn-secondary"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed border-sk-line px-3 py-4 text-center hover:bg-sk-fill focus-within:ring-2 focus-within:ring-sk-focus",
            dragging && "border-sk-focus bg-sk-accent-tint"
          )}
        >
          <input type="file" accept=".txt,.md" onChange={handleFileInput} className="sr-only" />
          <span className="text-[13px] text-sk-fg-2">Drop a file here, or choose one</span>
          <span className="sk-meta">.txt or .md, up to 200 KB</span>
        </label>
        {resumeError && (
          <p role="alert" className="sk-meta text-sk-danger">
            {resumeError}
          </p>
        )}

        <textarea
          id="profile-resume"
          rows={5}
          value={profile.resumeText}
          onChange={(e) => setProfile({ resumeText: e.target.value })}
          placeholder="Or paste your resume text and key highlights"
          className="sk-field resize-none"
        />
      </div>

      <div className="space-y-2">
        <h3 className="sk-label">Tone</h3>
        <div role="radiogroup" aria-label="Tone" className="grid grid-cols-2 gap-2">
          {TONES.map((tone) => {
            const selected = profile.tonePreset === tone.id;
            return (
              <button
                key={tone.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setTone(tone.id)}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-lg p-3 text-left last:col-span-2",
                  focusRing,
                  optionClass(selected)
                )}
              >
                <span className="text-[13px] font-medium">{tone.name}</span>
                <span className="sk-meta">{tone.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="sk-label">Seniority</h3>
        <div
          role="radiogroup"
          aria-label="Seniority"
          className="grid grid-cols-5 gap-1 rounded-lg bg-sk-fill p-1"
        >
          {SENIORITY.map((level) => {
            const selected = profile.seniorityPreset === level.id;
            return (
              <button
                key={level.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setSeniority(level.id)}
                className={cn(
                  "flex h-8 items-center justify-center rounded text-[13px] font-medium",
                  focusRing,
                  optionClass(selected)
                )}
              >
                {level.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
